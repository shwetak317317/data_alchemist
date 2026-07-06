"""
Profiling API — streams agent progress via SSE, returns report as final event.
"""
import json
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser
from app.api.connections import get_active_connector
from app.agents.profiling_agent import run_profiling
from app.models.profiling import ProfilingRunRequest, ProfilingReport, ProfilingProgressEvent

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/profiling", tags=["profiling"])


@router.get("/datasets")
def list_datasets(connection_id: str, use_cache: bool = False,
                  db: Session = Depends(get_db),
                  current_user: CurrentUser = Depends(get_current_user)):
    """List all tables visible through a connection, grouped by layer/schema.

    use_cache=True — read from connection_tables cache (fast, no live connector hit).
                     Falls through to the live connector if the cache is empty.
    use_cache=False (default) — always hit the live connector and refresh the cache.
    """
    conn_row = db.execute(
        text("SELECT platform, is_demo, schemas_scope, layer_map FROM connections WHERE id=:id"),
        {"id": connection_id},
    ).fetchone()
    is_demo = conn_row and (conn_row[0] == "demo" or conn_row[1])

    # Scope filter: schemas the user explicitly selected during connection setup
    scope_set: set[str] = set(conn_row[2] or []) if conn_row else set()

    # Layer map: { schema_name → layer_id } built from wizard drag-and-drop assignment
    schema_to_layer: dict[str, str] = {}
    if conn_row and conn_row[3] and isinstance(conn_row[3], dict):
        assignment = conn_row[3].get("assignment", {})
        for layer_id, schema_list in assignment.items():
            for s in (schema_list or []):
                # "monitor" and "ignore" are not real layers — treat as UNKNOWN
                schema_to_layer[s] = layer_id if layer_id not in ("monitor", "ignore") else "UNKNOWN"

    def _resolve_layer(schema: str, fallback: str) -> str:
        """Return wizard-assigned layer first, then connector-detected layer."""
        return schema_to_layer.get(schema) or fallback

    if is_demo:
        rows = db.execute(text("""
            SELECT DISTINCT ON (table_fqn)
                table_fqn, layer, schema_name, table_name, row_count, quality_score, run_at
            FROM profiling_reports
            WHERE connection_id=:conn
            ORDER BY table_fqn, run_at DESC
        """), {"conn": connection_id}).fetchall()
        grouped: dict = {}
        for r in rows:
            layer = _resolve_layer(r[2] or "", (r[1] or r[2] or "UNKNOWN").upper())
            if layer not in grouped:
                grouped[layer] = {"layer": layer, "tables": []}
            score = float(r[5] or 0)
            grouped[layer]["tables"].append({
                "name": r[0], "layer": layer, "rows": r[4] or 0,
                "score": round(score), "profiled": str(r[6])[:10] if r[6] else "—",
                "hot": score < 70,
            })
        return list(grouped.values())

    # ── Cache read path ──────────────────────────────────────────────────────
    if use_cache:
        try:
            cache_rows = db.execute(text("""
                SELECT t.schema_name, t.table_fqn, t.table_name, t.layer, t.row_count,
                       pr.quality_score, pr.run_at
                FROM connection_tables t
                LEFT JOIN LATERAL (
                    SELECT quality_score, run_at FROM profiling_reports
                    WHERE connection_id = t.connection_id AND table_fqn = t.table_fqn
                    ORDER BY run_at DESC LIMIT 1
                ) pr ON TRUE
                WHERE t.connection_id = :conn
                ORDER BY t.layer, t.schema_name, t.table_name
            """), {"conn": connection_id}).fetchall()
            if cache_rows:
                cached_grouped: dict = {}
                for r in cache_rows:
                    schema = r[0]
                    layer = _resolve_layer(schema, r[3] or "UNKNOWN")
                    if schema not in cached_grouped:
                        cached_grouped[schema] = {"schema": schema, "layer": layer, "tables": []}
                    score = round(float(r[5] or 0)) if r[5] else 0
                    profiled = str(r[6])[:10] if r[6] else "—"
                    cached_grouped[schema]["tables"].append({
                        "name": r[2], "layer": layer, "rows": r[4] or 0,
                        "score": score, "profiled": profiled,
                        "hot": score > 0 and score < 70,
                    })
                return list(cached_grouped.values())
            # Cache empty — fall through to live connector below
        except Exception as cache_exc:
            logger.warning("Cache read failed for connection=%s: %s", connection_id, cache_exc)
            # Fall through to live connector

    # ── Live connector path ──────────────────────────────────────────────────
    conn_error: str | None = None
    try:
        connector = get_active_connector(connection_id, db)
        all_schemas = connector.list_schemas()
        # Apply scope filter — if no scope is set, show all schemas
        schemas = [s for s in all_schemas if not scope_set or s in scope_set]

        # Pre-fetch the latest report per table for this connection so we can
        # show score, row_count and last-profiled date without a per-table query.
        report_rows = db.execute(text("""
            SELECT DISTINCT ON (table_fqn)
                table_fqn, quality_score, row_count, run_at
            FROM profiling_reports
            WHERE connection_id = :conn
            ORDER BY table_fqn, run_at DESC
        """), {"conn": connection_id}).fetchall()
        # Build a lookup keyed by "schema.table" FQN
        report_map: dict = {r[0]: r for r in report_rows}

        result = []
        for schema in schemas:
            schema_warning = None
            try:
                tables = connector.list_tables(schema)
            except PermissionError as perm_exc:
                # The connector raises an already-actionable message (which GRANT
                # to request) — carry it into the group so the sidebar can show
                # WHY this schema looks empty instead of silently hiding it.
                logger.error("list_tables schema=%s connection=%s: %s", schema, connection_id, perm_exc)
                tables = []
                schema_warning = str(perm_exc)
            except Exception as tbl_exc:
                logger.error("list_tables schema=%s connection=%s: %s", schema, connection_id, tbl_exc)
                tables = []
            connector_layer = tables[0].layer if tables else "UNKNOWN"
            layer = _resolve_layer(schema, connector_layer)
            table_list = []
            for t in tables:
                fqn = f"{schema}.{t.table_name}"
                rep = report_map.get(fqn)
                score = round(float(rep[1] or 0)) if rep else 0
                rows = rep[2] or 0 if rep else (getattr(t, "row_count", 0) or 0)
                profiled = str(rep[3])[:10] if rep and rep[3] else "—"
                table_list.append({
                    "name": t.table_name,
                    "layer": _resolve_layer(schema, t.layer),
                    "rows": rows,
                    "score": score,
                    "profiled": profiled,
                    "hot": score > 0 and score < 70,
                })
            if not table_list:
                logger.warning("list_datasets schema=%s returned 0 tables for connection=%s",
                               schema, connection_id)
            group = {"schema": schema, "layer": layer, "tables": table_list}
            if schema_warning:
                group["warning"] = schema_warning
            result.append(group)
        connector.close()
        total_tables = sum(len(g["tables"]) for g in result)
        if result and total_tables == 0:
            logger.warning(
                "list_datasets found %d schema(s) but 0 tables for connection=%s — "
                "check SQL login permissions on INFORMATION_SCHEMA.TABLES",
                len(result), connection_id,
            )

        # ── Upsert topology into cache ────────────────────────────────────────
        try:
            for group in result:
                db.execute(text("""
                    INSERT INTO connection_schemas (id, connection_id, schema_name, layer, discovered_at, updated_at)
                    VALUES (gen_random_uuid()::TEXT, :conn, :schema, :layer, NOW(), NOW())
                    ON CONFLICT (connection_id, schema_name) DO UPDATE
                        SET layer=EXCLUDED.layer, updated_at=NOW()
                """), {"conn": connection_id, "schema": group["schema"], "layer": group["layer"]})
                for t in group["tables"]:
                    db.execute(text("""
                        INSERT INTO connection_tables
                            (id, connection_id, schema_id, schema_name, table_name, table_fqn,
                             layer, row_count, discovered_at, updated_at)
                        VALUES (
                            gen_random_uuid()::TEXT, :conn,
                            (SELECT id FROM connection_schemas
                             WHERE connection_id=:conn AND schema_name=:schema LIMIT 1),
                            :schema, :tname, :fqn, :layer, :rows, NOW(), NOW()
                        )
                        ON CONFLICT (connection_id, table_fqn) DO UPDATE
                            SET layer=EXCLUDED.layer, row_count=EXCLUDED.row_count, updated_at=NOW()
                    """), {
                        "conn": connection_id,
                        "schema": group["schema"],
                        "tname": t["name"],
                        "fqn": f"{group['schema']}.{t['name']}",
                        "layer": t["layer"],
                        "rows": t.get("rows", 0),
                    })
            db.commit()
        except Exception as cache_write_exc:
            logger.warning("Cache upsert failed for connection=%s: %s", connection_id, cache_write_exc)
            try:
                db.rollback()
            except Exception:
                pass

        return result
    except Exception as exc:
        conn_error = str(exc)
        logger.error("list_datasets connector failed for connection=%s: %s", connection_id, exc, exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass

    # Fallback: serve last-known tables from connection_tables cache, then profiling_reports
    try:
        fallback_rows = db.execute(text("""
            SELECT t.schema_name, t.table_fqn, t.table_name, t.layer, t.row_count,
                   pr.quality_score, pr.run_at
            FROM connection_tables t
            LEFT JOIN LATERAL (
                SELECT quality_score, run_at FROM profiling_reports
                WHERE connection_id = t.connection_id AND table_fqn = t.table_fqn
                ORDER BY run_at DESC LIMIT 1
            ) pr ON TRUE
            WHERE t.connection_id = :conn
            ORDER BY t.layer, t.schema_name, t.table_name
        """), {"conn": connection_id}).fetchall()
        if fallback_rows:
            fallback_grouped: dict = {}
            for r in fallback_rows:
                schema = r[0]
                layer = _resolve_layer(schema, r[3] or "UNKNOWN")
                if schema not in fallback_grouped:
                    fallback_grouped[schema] = {"schema": schema, "layer": layer, "tables": []}
                score = round(float(r[5] or 0)) if r[5] else 0
                profiled = str(r[6])[:10] if r[6] else "—"
                fallback_grouped[schema]["tables"].append({
                    "name": r[2], "layer": layer, "rows": r[4] or 0,
                    "score": score, "profiled": profiled, "hot": False,
                })
            return list(fallback_grouped.values())
    except Exception:
        pass

    # Last resort: profiling_reports table
    try:
        rows = db.execute(text("""
            SELECT DISTINCT ON (table_fqn) table_fqn, layer, schema_name, row_count, quality_score, run_at
            FROM profiling_reports WHERE connection_id=:conn
            ORDER BY table_fqn, run_at DESC
        """), {"conn": connection_id}).fetchall()
    except Exception:
        rows = []

    grouped = {}
    for r in rows:
        layer = _resolve_layer(r[2] or "", (r[1] or "UNKNOWN").upper())
        if layer not in grouped:
            grouped[layer] = {"layer": layer, "tables": []}
        grouped[layer]["tables"].append({
            "name": r[0], "layer": layer, "rows": r[3] or 0,
            "score": round(float(r[4] or 0)), "profiled": str(r[5])[:10] if r[5] else "—", "hot": False,
        })

    if not grouped:
        # No cached data — surface the real error so the user can act on it
        raise HTTPException(503, detail=conn_error or "Could not reach the data source and no cached data is available.")

    return list(grouped.values())


@router.get("/report/by-table/{table_fqn:path}")
def get_report_by_table(table_fqn: str, connection_id: str | None = None,
                        db: Session = Depends(get_db),
                        current_user: CurrentUser = Depends(get_current_user)):
    """Return the latest profiling report for a given table_fqn, using field names the frontend expects."""
    params: dict = {"table": table_fqn}
    conn_filter = "AND connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    row = db.execute(text(f"""
        SELECT report_id, connection_id, table_fqn, layer, run_at, row_count,
               quality_score, completeness_score, uniqueness_score, consistency_score,
               freshness_score, summary_text
        FROM profiling_reports
        WHERE table_fqn=:table {conn_filter}
        ORDER BY run_at DESC LIMIT 1
    """), params).fetchone()

    if not row:
        raise HTTPException(404, f"No report found for {table_fqn}")

    rid = row[0]
    quality_score = float(row[6] or 0)
    completeness = float(row[7] or 0)
    uniqueness = float(row[8] or 0)
    consistency = float(row[9] or 0)
    freshness = float(row[10] or 100)

    # Prefer the normalized column_stats table; fall back to the JSONB blob for
    # older/seeded reports that were never normalized (e.g. demo seed data).
    cs_rows = db.execute(text("""
        SELECT column_name, data_type, null_pct, distinct_count, detected_format,
               is_cde, is_pii, quality_score, health,
               min_value, max_value, mean_value, std_dev, pii_type, note, sample_values
        FROM column_stats WHERE report_id=:rid ORDER BY column_name
    """), {"rid": rid}).fetchall()
    column_stats = [
        {"column_name": r[0], "data_type": r[1] or "TEXT",
         "null_pct": float(r[2] or 0), "distinct_count": r[3] or 0,
         "detected_format": r[4] or "—", "is_cde": bool(r[5]),
         "is_pii": bool(r[6]), "quality_score": float(r[7] or 0),
         "health": r[8] or "HEALTHY",
         "min_value": r[9], "max_value": r[10],
         "mean_value": float(r[11]) if r[11] is not None else None,
         "std_dev": float(r[12]) if r[12] is not None else None,
         "pii_type": r[13], "note": r[14],
         "sample_values": r[15] or []}
        for r in cs_rows
    ]
    if not column_stats:
        # Fall back to JSONB blob stored on the report row itself
        blob_row = db.execute(text(
            "SELECT column_stats FROM profiling_reports WHERE report_id=:rid"
        ), {"rid": rid}).fetchone()
        if blob_row and blob_row[0]:
            raw = blob_row[0] if isinstance(blob_row[0], list) else []
            column_stats = [
                {"column_name": c.get("name", c.get("column_name", "?")),
                 "data_type": c.get("data_type", "TEXT"),
                 "null_pct": float(c.get("null_pct", 0)),
                 "distinct_count": c.get("distinct_count", 0),
                 "detected_format": c.get("format_pattern") or c.get("detected_format") or "—",
                 "is_cde": bool(c.get("is_cde", False)),
                 "is_pii": bool(c.get("is_pii", False)),
                 "quality_score": float(c.get("quality_score", 0)),
                 "health": c.get("health", "HEALTHY")}
                for c in raw
            ]

    risk_rows = db.execute(text("""
        SELECT risk_code, severity, title, description, column_name, risk_type
        FROM profiling_risks WHERE report_id=:rid
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END
    """), {"rid": rid}).fetchall()
    risks_flagged = [
        {"risk_code": r[0], "severity": r[1], "title": r[2] or r[5] or "Risk",
         "description": r[3] or "", "column_name": r[4] or "—", "risk_type": r[5] or ""}
        for r in risk_rows
    ]

    row_count = row[5] or 0
    summary_stats = {
        "quality_score": round(quality_score),
        "completeness": f"{round(completeness)}%",
        "uniqueness": f"{round(uniqueness)}%",
        "consistency": f"{round(consistency)}%",
        "freshness": f"{round(freshness)}%",
        "total_columns": len(column_stats),
        "row_count": f"{row_count:,}",
    }

    return {
        "report_id": row[0], "connection_id": row[1], "table_fqn": row[2],
        "layer": row[3] or "UNKNOWN", "run_at": row[4].isoformat() if row[4] else None,
        "row_count": row_count, "quality_score": quality_score,
        "completeness_score": completeness, "uniqueness_score": uniqueness,
        "consistency_score": consistency, "freshness_score": freshness,
        "summary_text": row[11], "summary_stats": summary_stats,
        "column_stats": column_stats, "risks_flagged": risks_flagged,
    }


@router.post("/run")
def run_profiling_stream(req: ProfilingRunRequest, db: Session = Depends(get_db),
                         current_user: CurrentUser = Depends(get_current_user)):
    """
    Stream profiling progress as Server-Sent Events.
    Each event is JSON: {"type": "progress", "data": {...}} or {"type": "report", "data": {...}}
    """
    connector = get_active_connector(req.connection_id, db)
    schema_name = req.schema_name or "dbo"

    # Validate schema/table against the live connector's own catalog BEFORE they are
    # ever interpolated into raw SQL downstream (connectors build FROM-clauses via
    # f-string table_ref(), not bind params) — closes the injection surface and
    # rejects typo'd/dropped tables with a real 404 instead of silently profiling
    # an empty result set.
    try:
        if schema_name not in connector.list_schemas():
            connector.close()
            raise HTTPException(404, f"Schema not found on this connection: {schema_name}")
        if req.table_name not in {t.table_name for t in connector.list_tables(schema_name)}:
            connector.close()
            raise HTTPException(404, f"Table not found: {schema_name}.{req.table_name}")
    except HTTPException:
        raise
    except Exception as e:
        connector.close()
        logger.error("Table validation failed for %s.%s connection=%s: %s",
                     schema_name, req.table_name, req.connection_id, e, exc_info=True)
        raise HTTPException(502, f"Could not validate table against the data source: {e}")

    # Resolve layer from wizard layer_map stored in DB
    layer_override: str | None = None
    try:
        conn_meta = db.execute(
            text("SELECT layer_map FROM connections WHERE id=:id"),
            {"id": req.connection_id},
        ).fetchone()
        if conn_meta and conn_meta[0] and isinstance(conn_meta[0], dict):
            assignment = conn_meta[0].get("assignment", {})
            for layer_id, schema_list in assignment.items():
                if layer_id not in ("monitor", "ignore") and schema_name in (schema_list or []):
                    layer_override = layer_id
                    break
    except Exception:
        pass

    def event_stream():
        try:
            for item in run_profiling(
                connector=connector,
                connection_id=req.connection_id,
                schema_name=schema_name,
                table_name=req.table_name,
                layer_override=layer_override,
            ):
                if isinstance(item, ProfilingProgressEvent):
                    payload = _json_safe({"type": "progress", "data": item.model_dump()})
                elif isinstance(item, ProfilingReport):
                    # Persist report to DB (also normalizes into column_stats + profiling_risks)
                    _save_report(db, item, triggered_by=current_user.email)
                    payload = _json_safe({"type": "report", "data": _report_to_frontend_shape(item)})
                else:
                    continue
                yield f"data: {payload}\n\n"
        except Exception as e:
            logger.exception("Profiling stream error")
            # A permission denial must reach the user as the exact GRANT to
            # request, not a raw ODBC string (product-wide contract, see
            # connectors/base.py).
            from app.connectors.base import is_permission_error, permission_denied_message
            msg = str(e)
            if is_permission_error(e):
                login = getattr(connector, "_config", {}).get("username")
                obj = f"{schema_name}.{req.table_name}" if schema_name else req.table_name
                msg = permission_denied_message("select", obj, login)
            yield f"data: {json.dumps({'type': 'error', 'message': msg})}\n\n"
        finally:
            connector.close()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/report/{report_id}", response_model=ProfilingReport)
def get_report(report_id: str, db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    row = db.execute(text(
        "SELECT report_id, connection_id, table_fqn, layer, run_at, row_count, "
        "quality_score, completeness_score, uniqueness_score, consistency_score, "
        "freshness_score, risks_flagged, column_stats, summary_text "
        "FROM profiling_reports WHERE report_id=:id"
    ), {"id": report_id}).fetchone()

    if not row:
        raise HTTPException(404, "Report not found")

    return ProfilingReport(
        report_id=row[0], connection_id=row[1], table_fqn=row[2],
        layer=row[3] or "UNKNOWN", run_at=row[4],
        row_count=row[5] or 0, quality_score=row[6] or 0,
        completeness_score=row[7] or 0, uniqueness_score=row[8] or 0,
        consistency_score=row[9] or 0, freshness_score=row[10] or 100,
        risks=row[11] or [], columns=row[12] or [], summary_text=row[13],
    )


def _report_to_frontend_shape(report: ProfilingReport) -> dict:
    """Convert ProfilingReport to the same field names that get_report_by_table returns."""
    row_count = report.row_count or 0
    column_stats = [
        {
            "column_name": c.name,
            "data_type": c.data_type,
            "null_pct": round(c.null_pct, 2),
            "distinct_count": c.distinct_count,
            "detected_format": c.format_pattern or "—",
            "is_cde": c.is_cde,
            "is_pii": False,
            "quality_score": round(max(0.0, 100.0 - c.null_pct * 2), 1),
            "health": c.health,
        }
        for c in report.columns
    ]
    risks_flagged = [
        {
            "risk_code": f"R{i + 1}",
            "severity": r.severity,
            "title": r.risk_type.replace("_", " ").title() if r.risk_type else "Data Quality Risk",
            "description": r.description or "",
            "column_name": r.column or "—",
            "risk_type": r.risk_type,
        }
        for i, r in enumerate(report.risks)
    ]
    summary_stats = {
        "quality_score": round(report.quality_score),
        "completeness": f"{round(report.completeness_score)}%",
        "uniqueness": f"{round(report.uniqueness_score)}%",
        "consistency": f"{round(report.consistency_score)}%",
        "freshness": f"{round(report.freshness_score)}%",
        "total_columns": len(report.columns),
        "row_count": f"{row_count:,}",
    }
    return {
        "report_id": report.report_id,
        "connection_id": report.connection_id,
        "table_fqn": report.table_fqn,
        "layer": report.layer,
        "run_at": report.run_at.isoformat() if report.run_at else None,
        "row_count": row_count,
        "quality_score": report.quality_score,
        "completeness_score": report.completeness_score,
        "uniqueness_score": report.uniqueness_score,
        "consistency_score": report.consistency_score,
        "freshness_score": report.freshness_score,
        "summary_text": report.summary_text,
        "summary_stats": summary_stats,
        "column_stats": column_stats,
        "risks_flagged": risks_flagged,
    }


class _SafeEncoder(json.JSONEncoder):
    """Handles date/datetime/Decimal that pyodbc may return as column values."""
    def default(self, obj):
        import datetime, decimal
        if isinstance(obj, (datetime.date, datetime.datetime)):
            return obj.isoformat()
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        return super().default(obj)


def _json_safe(data) -> str:
    return json.dumps(data, cls=_SafeEncoder)


def _save_report(db: Session, report: ProfilingReport, triggered_by: str | None = None) -> None:
    try:
        # Ensure schema + table entries exist in the topology cache, then capture their IDs
        # so every report row carries the FK chain: connection → schema → table → report
        schema_name = report.table_fqn.split(".")[0] if "." in report.table_fqn else ""
        table_name  = report.table_fqn.split(".", 1)[1] if "." in report.table_fqn else report.table_fqn

        if schema_name:
            db.execute(text("""
                INSERT INTO connection_schemas (id, connection_id, schema_name, layer, discovered_at, updated_at)
                VALUES (gen_random_uuid()::TEXT, :conn, :schema, :layer, NOW(), NOW())
                ON CONFLICT (connection_id, schema_name) DO UPDATE SET layer=EXCLUDED.layer, updated_at=NOW()
            """), {"conn": report.connection_id, "schema": schema_name, "layer": report.layer})

            db.execute(text("""
                INSERT INTO connection_tables
                    (id, connection_id, schema_id, schema_name, table_name, table_fqn, layer, discovered_at, updated_at)
                VALUES (
                    gen_random_uuid()::TEXT, :conn,
                    (SELECT id FROM connection_schemas WHERE connection_id=:conn AND schema_name=:schema LIMIT 1),
                    :schema, :tname, :fqn, :layer, NOW(), NOW()
                )
                ON CONFLICT (connection_id, table_fqn) DO UPDATE
                    SET layer=EXCLUDED.layer, updated_at=NOW()
            """), {
                "conn": report.connection_id, "schema": schema_name,
                "tname": table_name, "fqn": report.table_fqn, "layer": report.layer,
            })

        table_id_row = db.execute(text(
            "SELECT id FROM connection_tables WHERE connection_id=:conn AND table_fqn=:fqn LIMIT 1"
        ), {"conn": report.connection_id, "fqn": report.table_fqn}).fetchone()
        table_id = table_id_row[0] if table_id_row else None

        schema_id_row = db.execute(text(
            "SELECT id FROM connection_schemas WHERE connection_id=:conn AND schema_name=:schema LIMIT 1"
        ), {"conn": report.connection_id, "schema": schema_name}).fetchone() if schema_name else None
        schema_id = schema_id_row[0] if schema_id_row else None

        db.execute(text("""
            INSERT INTO profiling_reports
                (report_id, connection_id, table_fqn, layer, run_at, row_count,
                 quality_score, completeness_score, uniqueness_score,
                 consistency_score, freshness_score, risks_flagged,
                 column_stats, summary_text, triggered_by, table_id, schema_id)
            VALUES
                (:report_id, :connection_id, :table_fqn, :layer, :run_at, :row_count,
                 :quality_score, :completeness_score, :uniqueness_score,
                 :consistency_score, :freshness_score, CAST(:risks_flagged AS jsonb),
                 CAST(:column_stats AS jsonb), :summary_text, :triggered_by,
                 :table_id, :schema_id)
        """), {
            "report_id": report.report_id,
            "connection_id": report.connection_id,
            "table_fqn": report.table_fqn,
            "layer": report.layer,
            "run_at": report.run_at,
            "row_count": report.row_count,
            "quality_score": report.quality_score,
            "completeness_score": report.completeness_score,
            "uniqueness_score": report.uniqueness_score,
            "consistency_score": report.consistency_score,
            "freshness_score": report.freshness_score,
            "risks_flagged": _json_safe([r.model_dump() for r in report.risks]),
            "column_stats": _json_safe([c.model_dump() for c in report.columns]),
            "summary_text": report.summary_text,
            "triggered_by": triggered_by,
            "table_id": table_id,
            "schema_id": schema_id,
        })

        # Normalize column stats into the column_stats table for per-column queries
        for c in report.columns:
            db.execute(text("""
                INSERT INTO column_stats
                    (report_id, connection_id, table_fqn, column_name, data_type,
                     null_pct, distinct_count, min_value, max_value, mean_value, std_dev,
                     detected_format, is_cde, quality_score, health, sample_values,
                     table_id, created_at)
                VALUES
                    (:report_id, :conn, :table_fqn, :col_name, :dtype,
                     :null_pct, :distinct_count, :min_val, :max_val, :mean_val, :std_dev,
                     :detected_format, :is_cde, :quality_score, :health,
                     CAST(:samples AS jsonb), :table_id, NOW())
            """), {
                "report_id": report.report_id,
                "conn": report.connection_id,
                "table_fqn": report.table_fqn,
                "col_name": c.name,
                "dtype": c.data_type,
                "null_pct": c.null_pct,
                "distinct_count": c.distinct_count,
                "min_val": str(c.min_val) if c.min_val is not None else None,
                "max_val": str(c.max_val) if c.max_val is not None else None,
                "mean_val": c.mean_val,
                "std_dev": c.std_dev,
                "detected_format": c.format_pattern,
                "is_cde": c.is_cde,
                "quality_score": round(max(0.0, 100.0 - c.null_pct * 2), 1),
                "health": c.health,
                "samples": _json_safe(c.top_values),
                "table_id": table_id,
            })

        # Normalize risks into the profiling_risks table for per-risk queries
        for i, r in enumerate(report.risks):
            db.execute(text("""
                INSERT INTO profiling_risks
                    (report_id, connection_id, risk_code, severity, title,
                     description, column_name, risk_type, created_at)
                VALUES
                    (:report_id, :conn, :code, :severity, :title,
                     :desc, :col, :rtype, NOW())
            """), {
                "report_id": report.report_id,
                "conn": report.connection_id,
                "code": f"R{i + 1}",
                "severity": r.severity,
                "title": (r.description or r.risk_type)[:512],
                "desc": r.description or "",
                "col": r.column or None,
                "rtype": r.risk_type,
            })

        db.commit()

        # Auto-create / update lineage node for this table
        try:
            _LAYER_POS = {"RAW": 0, "BRONZE": 1, "SILVER": 2, "GOLD": 3}
            health = "ok" if report.quality_score >= 80 else ("warn" if report.quality_score >= 60 else "fail")
            pos = _LAYER_POS.get(report.layer or "", 4)
            db.execute(text("""
                INSERT INTO lineage_nodes
                    (connection_id, external_id, label, layer, node_type,
                     tier_label, health_status, position_order)
                VALUES
                    (:conn, :ext_id, :label, :layer, 'table',
                     :tier, :health, :pos)
                ON CONFLICT (connection_id, external_id) DO UPDATE
                    SET health_status = EXCLUDED.health_status,
                        layer = EXCLUDED.layer,
                        position_order = EXCLUDED.position_order
            """), {
                "conn": report.connection_id,
                "ext_id": report.table_fqn,
                "label": report.table_fqn,
                "layer": report.layer or "UNKNOWN",
                "tier": report.layer or "UNKNOWN",
                "health": health,
                "pos": pos,
            })
            db.commit()
        except Exception as le:
            logger.debug("Lineage node upsert skipped: %s", le)
            try:
                db.rollback()
            except Exception:
                pass
    except Exception as e:
        logger.warning("Failed to save profiling report: %s", e)
        db.rollback()
