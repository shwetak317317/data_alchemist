"""Metadata API — data dictionary and CDE registry with human review."""
import csv
import io
import uuid
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser, assert_connection_access
from app.core.llm import chat, parse_llm_json
from app.services.audit_service import log_event
from app.prompts.metadata import build_metadata_enrichment_prompt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/metadata", tags=["metadata"])


def _assert_conn_org(db: Session, connection_id: str, current_user: CurrentUser) -> None:
    """Look up a connection's org and 403 if it doesn't match the caller's org."""
    row = db.execute(text("SELECT org_id FROM connections WHERE id=:id"), {"id": connection_id}).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(row[0], current_user)


def _assert_column_org(db: Session, column_id: str, current_user: CurrentUser, connection_id: str | None) -> None:
    """403 unless the dictionary column's connection belongs to the caller's org."""
    if not connection_id:
        raise HTTPException(404, "Column not found")
    _assert_conn_org(db, connection_id, current_user)


@router.get("/dictionary")
def list_dictionary(connection_id: str | None = None, table_fqn: str | None = None,
                    db: Session = Depends(get_db),
                    current_user: CurrentUser = Depends(get_current_user)):
    if not connection_id:
        raise HTTPException(400, "connection_id is required")
    _assert_conn_org(db, connection_id, current_user)

    filters, params = [], {}
    if connection_id:
        filters.append("connection_id=:conn")
        params["conn"] = connection_id
    if table_fqn:
        filters.append("table_fqn=:table")
        params["table"] = table_fqn
    where = "WHERE " + " AND ".join(filters) if filters else ""
    rows = db.execute(text(
        f"SELECT column_id, table_fqn, schema_name, table_name, layer, column_name, "
        f"business_name, description, data_type, format_standard, is_pii, is_cde, "
        f"cde_score, business_owner, sensitivity_tag, ai_suggested, status, "
        f"approved_by, approved_at FROM data_dictionary {where} ORDER BY table_fqn, column_name"
    ), params).fetchall()
    return [
        {
            "column_id": r[0], "table_fqn": r[1], "schema_name": r[2],
            "table_name": r[3], "layer": r[4], "column_name": r[5],
            "business_name": r[6], "description": r[7], "data_type": r[8],
            "format_standard": r[9], "is_pii": r[10], "is_cde": r[11],
            "cde_score": float(r[12]) if r[12] else None, "business_owner": r[13],
            "sensitivity_tag": r[14], "ai_suggested": r[15], "status": r[16],
            "approved_by": r[17], "approved_at": r[18],
        }
        for r in rows
    ]


@router.post("/enrich")
def enrich_from_profiling(report_id: str, connection_id: str, db: Session = Depends(get_db),
                          current_user: CurrentUser = Depends(get_current_user)):
    """
    Use the Metadata Agent (LiteLLM) to generate descriptions and CDE scores
    for all columns in a profiling report.
    """
    _assert_conn_org(db, connection_id, current_user)

    row = db.execute(text(
        "SELECT table_fqn, layer, column_stats FROM profiling_reports WHERE report_id=:id"
    ), {"id": report_id}).fetchone()
    if not row:
        raise HTTPException(404, "Profiling report not found")

    table_fqn, layer, column_stats_blob = row

    # Try the JSONB blob stored on the report first.
    cols: list = []
    if column_stats_blob:
        raw = column_stats_blob if isinstance(column_stats_blob, list) else json.loads(column_stats_blob)
        if raw:
            cols = raw

    # Fallback: read from the normalised column_stats table.  This handles
    # demo reports and older reports where the JSONB blob was stored as [].
    if not cols:
        cs_rows = db.execute(text(
            "SELECT column_name, data_type, null_pct FROM column_stats "
            "WHERE report_id=:rid ORDER BY column_name"
        ), {"rid": report_id}).fetchall()
        cols = [{"name": r[0], "data_type": r[1] or "TEXT", "null_pct": float(r[2] or 0)}
                for r in cs_rows]

    if not cols:
        raise HTTPException(400, "No column stats in report — run Profiling first to generate column-level stats")

    col_summary = [{"name": c.get("name") or c.get("column_name", ""),
                    "type": c.get("data_type"),
                    "null_pct": c.get("null_pct", 0)} for c in cols]

    # Chunk wide tables so a single LLM call's JSON output never risks being cut
    # off by the max_tokens ceiling (each enriched column costs ~60-90 tokens).
    ENRICH_BATCH_SIZE = 40
    batches = [col_summary[i:i + ENRICH_BATCH_SIZE] for i in range(0, len(col_summary), ENRICH_BATCH_SIZE)]

    enriched_cols: dict = {}
    for batch in batches:
        prompt = build_metadata_enrichment_prompt(table_fqn, layer, batch)
        try:
            raw = chat(prompt)
            data = parse_llm_json(raw)
        except Exception as e:
            logger.error("Metadata enrichment failed for %s (batch of %d columns): %s", table_fqn, len(batch), e)
            raise HTTPException(500, "AI enrichment failed — please retry. If this keeps happening, check backend logs.")
        for c in data.get("columns", []):
            name = c.get("name")
            if name:
                enriched_cols[name] = c

    missing = [c["name"] for c in col_summary if c["name"] not in enriched_cols]
    if missing:
        logger.warning(
            "Metadata enrichment for %s: LLM omitted or mis-named %d/%d columns: %s",
            table_fqn, len(missing), len(col_summary), missing,
        )

    schema_name = table_fqn.split(".")[0] if "." in table_fqn else ""
    table_name = table_fqn.split(".")[-1]
    created = []

    for col in cols:
        col_name = col.get("name") or col.get("column_name", "")
        if not col_name:
            continue
        meta = enriched_cols.get(col_name, {})
        ai_suggested = col_name in enriched_cols
        # Include connection_id in the PK so two connections pointing at the
        # same physical DB never share or overwrite each other's dictionary rows.
        col_id = f"{connection_id}:{table_fqn}.{col_name}"

        db.execute(text("""
            INSERT INTO data_dictionary
                (column_id, connection_id, table_fqn, schema_name, table_name,
                 layer, column_name, business_name, description, data_type,
                 format_standard, is_pii, is_cde, cde_score, business_owner,
                 sensitivity_tag, ai_suggested, status, created_at, updated_at)
            VALUES
                (:col_id, :conn, :table_fqn, :schema, :table,
                 :layer, :col_name, :bus_name, :desc, :dtype,
                 :fmt, :pii, :cde, :cde_score, :owner,
                 :sensitivity, :ai_suggested, 'draft', NOW(), NOW())
            ON CONFLICT (column_id) DO UPDATE SET
                business_name=EXCLUDED.business_name,
                description=EXCLUDED.description,
                cde_score=EXCLUDED.cde_score,
                is_cde=EXCLUDED.is_cde,
                sensitivity_tag=EXCLUDED.sensitivity_tag,
                updated_at=NOW()
        """), {
            "col_id": col_id, "conn": connection_id, "table_fqn": table_fqn,
            "schema": schema_name, "table": table_name, "layer": layer,
            "col_name": col_name, "bus_name": meta.get("business_name", col_name),
            "desc": meta.get("description", ""), "dtype": col.get("data_type", ""),
            "fmt": meta.get("format_standard", ""), "pii": meta.get("is_pii", False),
            "cde": meta.get("is_cde", False), "cde_score": meta.get("cde_score", 0),
            "owner": meta.get("business_owner", ""), "sensitivity": meta.get("sensitivity_tag", "NONE"),
            "ai_suggested": ai_suggested,
        })
        created.append(col_id)

    db.commit()
    return {"enriched": len(created), "column_ids": created, "missing_columns": missing}


@router.post("/dictionary/{column_id}/{decision}")
def decide_column(column_id: str, decision: str,
                  body: dict = {}, db: Session = Depends(get_db),
                  current_user: CurrentUser = Depends(get_current_user)):
    """Human approves, edits, or rejects a metadata entry."""
    if decision not in ("approve", "edit", "reject"):
        raise HTTPException(400, "decision must be approve|edit|reject")

    row = db.execute(text("SELECT column_id, connection_id FROM data_dictionary WHERE column_id=:id"),
                     {"id": column_id}).fetchone()
    if not row:
        raise HTTPException(404, "Column not found")
    _assert_column_org(db, column_id, current_user, row[1])

    if decision == "approve":
        db.execute(text(
            "UPDATE data_dictionary SET status='approved', approved_by=:by, approved_at=NOW(), "
            "updated_at=NOW() WHERE column_id=:id"
        ), {"by": current_user.email, "id": column_id})
    elif decision == "edit":
        updates = []
        params: dict = {"id": column_id}
        for field in ("business_name", "description", "is_pii", "sensitivity_tag",
                      "is_cde", "cde_score", "business_owner"):
            if field in body:
                updates.append(f"{field}=:{field}")
                params[field] = body[field]
        if updates:
            db.execute(text(f"UPDATE data_dictionary SET {', '.join(updates)}, updated_at=NOW() "
                            f"WHERE column_id=:id"), params)
    elif decision == "reject":
        db.execute(text("UPDATE data_dictionary SET status='rejected', updated_at=NOW() WHERE column_id=:id"),
                   {"id": column_id})

    db.commit()

    log_event(db, user_email=current_user.email, event_type=decision.upper(),
              entity_type="DICTIONARY", entity_id=column_id,
              new_value=body, connection_id=row[1])
    db.commit()
    return {"status": "updated", "decision": decision}


@router.get("/cdes")
def list_cdes(connection_id: str | None = None, db: Session = Depends(get_db),
              current_user: CurrentUser = Depends(get_current_user)):
    if not connection_id:
        raise HTTPException(400, "connection_id is required")
    _assert_conn_org(db, connection_id, current_user)

    filters, params = ["dd.is_cde=TRUE"], {}
    if connection_id:
        filters.append("dd.connection_id=:conn")
        params["conn"] = connection_id
    where = "WHERE " + " AND ".join(filters)
    rows = db.execute(text(f"""
        SELECT dd.column_id, dd.table_fqn, dd.column_name, dd.business_name, dd.description,
               dd.cde_score, dd.status, dd.sensitivity_tag, dd.approved_by, dd.approved_at,
               cr.health, cr.promoted_by, cr.promoted_at, cr.rule_count, cr.last_validated_at
        FROM data_dictionary dd
        LEFT JOIN cde_registry cr
            ON cr.connection_id=dd.connection_id
            AND cr.table_fqn=dd.table_fqn
            AND cr.column_name=dd.column_name
        {where}
        ORDER BY dd.cde_score DESC NULLS LAST
    """), params).fetchall()
    return [{
        "column_id": r[0], "table_fqn": r[1], "column_name": r[2],
        "business_name": r[3], "description": r[4],
        "cde_score": float(r[5] or 0), "status": r[6], "sensitivity_tag": r[7],
        "approved_by": r[8],
        "approved_at": r[9].isoformat() if r[9] else None,
        "health": r[10] or "PASS",
        "promoted_by": r[11] or r[8] or "",
        "promoted_at": r[12].isoformat() if r[12] else (r[9].isoformat() if r[9] else None),
        "rule_count": r[13] or 0,
        "last_validated_at": r[14].isoformat() if r[14] else None,
    } for r in rows]


@router.post("/cdes/{column_id}/{action}")
def cde_action(column_id: str, action: str,
               body: dict = {}, db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    """Promote or demote a column's CDE status, writing/removing from cde_registry."""
    if action not in ("promote", "demote"):
        raise HTTPException(400, "action must be promote|demote")

    col_row = db.execute(text(
        "SELECT connection_id, table_fqn, column_name, business_name, cde_score "
        "FROM data_dictionary WHERE column_id=:id"
    ), {"id": column_id}).fetchone()
    if not col_row:
        raise HTTPException(404, "Column not found")
    _assert_column_org(db, column_id, current_user, col_row[0])

    is_cde = action == "promote"
    db.execute(text(
        "UPDATE data_dictionary SET is_cde=:cde, updated_at=NOW() WHERE column_id=:id"
    ), {"cde": is_cde, "id": column_id})

    if is_cde:
        db.execute(text("""
            INSERT INTO cde_registry
                (connection_id, column_name, table_fqn, business_name,
                 cde_score, health, promoted_by, promoted_at, rule_count)
            VALUES (:conn, :col_name, :table_fqn, :bus_name, :score, 'PASS', :by, NOW(), 0)
            ON CONFLICT (connection_id, table_fqn, column_name) DO UPDATE SET
                health='PASS', promoted_by=EXCLUDED.promoted_by,
                promoted_at=EXCLUDED.promoted_at, cde_score=EXCLUDED.cde_score,
                business_name=EXCLUDED.business_name
        """), {
            "conn": col_row[0], "col_name": col_row[2], "table_fqn": col_row[1],
            "bus_name": col_row[3] or col_row[2], "score": float(col_row[4] or 0),
            "by": current_user.email,
        })
    else:
        db.execute(text(
            "DELETE FROM cde_registry "
            "WHERE connection_id=:conn AND table_fqn=:table AND column_name=:col"
        ), {"conn": col_row[0], "table": col_row[1], "col": col_row[2]})

    db.commit()
    log_event(db, user_email=current_user.email,
              event_type=("PROMOTE" if is_cde else "DEMOTE"),
              entity_type="CDE", entity_id=column_id)
    db.commit()
    return {"status": "updated", "is_cde": is_cde}


@router.post("/dictionary")
def add_column(body: dict, db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    """Add a column to the data dictionary manually (not AI-enriched)."""
    conn_id = body.get("connection_id")
    table_fqn = (body.get("table_fqn") or "").strip()
    col_name = (body.get("column_name") or "").strip()
    if not conn_id or not table_fqn or not col_name:
        raise HTTPException(400, "connection_id, table_fqn, and column_name are required")
    _assert_conn_org(db, conn_id, current_user)

    col_id = f"{conn_id}:{table_fqn}.{col_name}"
    schema_name = table_fqn.split(".")[0] if "." in table_fqn else ""
    table_name = table_fqn.split(".")[-1]

    db.execute(text("""
        INSERT INTO data_dictionary
            (column_id, connection_id, table_fqn, schema_name, table_name,
             column_name, business_name, description, data_type,
             format_standard, is_pii, sensitivity_tag, ai_suggested, status,
             created_at, updated_at)
        VALUES
            (:col_id, :conn, :table_fqn, :schema, :table,
             :col_name, :bus_name, :desc, :dtype,
             :fmt, :pii, :sensitivity, FALSE, 'draft', NOW(), NOW())
        ON CONFLICT (column_id) DO UPDATE SET
            business_name=EXCLUDED.business_name,
            description=EXCLUDED.description,
            data_type=EXCLUDED.data_type,
            updated_at=NOW()
    """), {
        "col_id": col_id, "conn": conn_id, "table_fqn": table_fqn,
        "schema": schema_name, "table": table_name,
        "col_name": col_name, "bus_name": body.get("business_name", col_name),
        "desc": body.get("description", ""), "dtype": body.get("data_type", ""),
        "fmt": body.get("format_standard", ""),
        "pii": bool(body.get("is_pii", False)),
        "sensitivity": body.get("sensitivity_tag", "NONE"),
    })
    db.commit()
    log_event(db, user_email=current_user.email, event_type="ADD_COLUMN",
              entity_type="DICTIONARY", entity_id=col_id, new_value=body, connection_id=conn_id)
    db.commit()
    return {"status": "created", "column_id": col_id}


@router.post("/dictionary/bulk-decide")
def bulk_decide(body: dict, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    """Bulk approve or reject multiple dictionary entries."""
    column_ids = body.get("column_ids", [])
    decision = body.get("decision", "")
    if decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")
    if not column_ids:
        raise HTTPException(400, "column_ids is required")

    updated = 0
    for cid in column_ids:
        row = db.execute(text(
            "SELECT column_id, connection_id FROM data_dictionary WHERE column_id=:id"
        ), {"id": cid}).fetchone()
        if not row:
            continue
        _assert_column_org(db, cid, current_user, row[1])
        if decision == "approve":
            db.execute(text(
                "UPDATE data_dictionary SET status='approved', approved_by=:by, "
                "approved_at=NOW(), updated_at=NOW() WHERE column_id=:id"
            ), {"by": current_user.email, "id": cid})
        else:
            db.execute(text(
                "UPDATE data_dictionary SET status='rejected', updated_at=NOW() WHERE column_id=:id"
            ), {"id": cid})
        log_event(db, user_email=current_user.email, event_type=decision.upper(),
                  entity_type="DICTIONARY", entity_id=cid, connection_id=row[1])
        updated += 1
    db.commit()
    return {"updated": updated, "decision": decision}


@router.get("/dictionary/export")
def export_dictionary(connection_id: str | None = None, table_fqn: str | None = None,
                      db: Session = Depends(get_db),
                      current_user: CurrentUser = Depends(get_current_user)):
    """Export the data dictionary as a CSV download."""
    rows = list_dictionary(connection_id=connection_id, table_fqn=table_fqn, db=db, current_user=current_user)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "table_fqn", "column_name", "data_type", "business_name", "description",
        "format_standard", "is_pii", "sensitivity_tag", "is_cde", "cde_score",
        "business_owner", "layer", "ai_suggested", "status", "approved_by",
    ])
    for r in rows:
        writer.writerow([
            r["table_fqn"], r["column_name"], r["data_type"] or "",
            r["business_name"] or "", r["description"] or "",
            r["format_standard"] or "", r["is_pii"], r["sensitivity_tag"] or "",
            r["is_cde"], r["cde_score"] or 0,
            r["business_owner"] or "", r["layer"] or "",
            r["ai_suggested"], r["status"], r["approved_by"] or "",
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=data_dictionary.csv"},
    )
