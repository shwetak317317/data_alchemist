"""Metadata API — data dictionary and CDE registry with human review."""
import uuid
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.llm import chat
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/metadata", tags=["metadata"])


@router.get("/dictionary")
def list_dictionary(connection_id: str | None = None, table_fqn: str | None = None,
                    db: Session = Depends(get_db)):
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
def enrich_from_profiling(report_id: str, connection_id: str, db: Session = Depends(get_db)):
    """
    Use the Metadata Agent (LiteLLM) to generate descriptions and CDE scores
    for all columns in a profiling report.
    """
    row = db.execute(text(
        "SELECT table_fqn, layer, column_stats FROM profiling_reports WHERE report_id=:id"
    ), {"id": report_id}).fetchone()
    if not row:
        raise HTTPException(404, "Profiling report not found")

    table_fqn, layer, column_stats = row
    if not column_stats:
        raise HTTPException(400, "No column stats in report")

    cols = column_stats if isinstance(column_stats, list) else json.loads(column_stats)
    col_summary = [{"name": c.get("name"), "type": c.get("data_type"),
                    "null_pct": c.get("null_pct")} for c in cols]

    prompt = [
        {"role": "system", "content": "You are a data steward. Return valid JSON only, no markdown."},
        {"role": "user", "content": (
            f"Table: {table_fqn}  Layer: {layer}\n\nColumns:\n{json.dumps(col_summary, indent=2)}\n\n"
            "For each column, generate metadata. Return JSON:\n"
            '{"columns": [{"name": "", "business_name": "", "description": "", '
            '"format_standard": "", "is_pii": false, "sensitivity_tag": "NONE|PII|FINANCIAL|OPERATIONAL", '
            '"cde_score": 0-100, "is_cde": false, "business_owner": ""}]}'
        )},
    ]

    try:
        raw = chat(prompt)
        data = json.loads(raw)
        enriched_cols = {c["name"]: c for c in data.get("columns", [])}
    except Exception as e:
        logger.error("Metadata enrichment failed: %s", e)
        raise HTTPException(500, f"LLM enrichment failed: {e}")

    schema_name = table_fqn.split(".")[0] if "." in table_fqn else ""
    table_name = table_fqn.split(".")[-1]
    created = []

    for col in cols:
        col_name = col.get("name", "")
        meta = enriched_cols.get(col_name, {})
        col_id = f"{table_fqn}.{col_name}"

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
                 :sensitivity, TRUE, 'draft', NOW(), NOW())
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
        })
        created.append(col_id)

    db.commit()
    return {"enriched": len(created), "column_ids": created}


@router.post("/dictionary/{column_id}/{decision}")
def decide_column(column_id: str, decision: str,
                  body: dict = {}, db: Session = Depends(get_db)):
    """Human approves, edits, or rejects a metadata entry."""
    if decision not in ("approve", "edit", "reject"):
        raise HTTPException(400, "decision must be approve|edit|reject")

    row = db.execute(text("SELECT column_id, connection_id FROM data_dictionary WHERE column_id=:id"),
                     {"id": column_id}).fetchone()
    if not row:
        raise HTTPException(404, "Column not found")

    if decision == "approve":
        db.execute(text(
            "UPDATE data_dictionary SET status='approved', approved_by=:by, approved_at=NOW(), "
            "updated_at=NOW() WHERE column_id=:id"
        ), {"by": body.get("decided_by", "user"), "id": column_id})
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

    log_event(db, user_name=body.get("decided_by", "user"), event_type=decision.upper(),
              entity_type="DICTIONARY", entity_id=column_id,
              new_value=body, connection_id=row[1])
    db.commit()
    return {"status": "updated", "decision": decision}


@router.get("/cdes")
def list_cdes(connection_id: str | None = None, db: Session = Depends(get_db)):
    filters, params = ["is_cde=TRUE"], {}
    if connection_id:
        filters.append("connection_id=:conn")
        params["conn"] = connection_id
    where = "WHERE " + " AND ".join(filters)
    rows = db.execute(text(
        f"SELECT column_id, table_fqn, column_name, business_name, description, "
        f"cde_score, status, sensitivity_tag FROM data_dictionary {where} "
        f"ORDER BY cde_score DESC NULLS LAST"
    ), params).fetchall()
    return [{"column_id": r[0], "table_fqn": r[1], "column_name": r[2],
             "business_name": r[3], "description": r[4], "cde_score": float(r[5] or 0),
             "status": r[6], "sensitivity_tag": r[7]} for r in rows]


@router.post("/cdes/{column_id}/{action}")
def cde_action(column_id: str, action: str,
               body: dict = {}, db: Session = Depends(get_db)):
    """Promote or demote a column's CDE status."""
    if action not in ("promote", "demote"):
        raise HTTPException(400, "action must be promote|demote")
    is_cde = action == "promote"
    db.execute(text(
        "UPDATE data_dictionary SET is_cde=:cde, updated_at=NOW() WHERE column_id=:id"
    ), {"cde": is_cde, "id": column_id})
    db.commit()
    log_event(db, user_name=body.get("decided_by", "user"),
              event_type=("PROMOTE" if is_cde else "DEMOTE"),
              entity_type="CDE", entity_id=column_id)
    db.commit()
    return {"status": "updated", "is_cde": is_cde}
