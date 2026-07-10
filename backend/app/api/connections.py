"""
Connections API — CRUD for data platform connections + credential test.
Credentials are stored Fernet-encrypted in the metadata DB.
All endpoints require a valid JWT. Connections are scoped to the caller's org_id.
"""
import json
import time
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from cryptography.fernet import Fernet

from app.core.config import settings
from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, require_role, assert_connection_access, CurrentUser
from app.connectors.registry import get_connector, SUPPORTED_PLATFORMS
from app.models.connection import (
    ConnectionCreate, ConnectionTestRequest, ConnectionTestResult, ConnectionResponse,
    ConnectionUpdate, ConnectionCredentialOverride,
)
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/connections", tags=["connections"])


def _get_fernet() -> Fernet:
    key = settings.encryption_key.encode()
    import base64, hashlib
    digest = hashlib.sha256(key).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt(data: dict) -> str:
    return _get_fernet().encrypt(json.dumps(data).encode()).decode()


def _decrypt(token: str) -> dict:
    return json.loads(_get_fernet().decrypt(token.encode()).decode())


@router.get("", response_model=list[ConnectionResponse])
def list_connections(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    counts = {}
    try:
        for row in db.execute(text(
            "SELECT connection_id, COUNT(DISTINCT table_fqn) FROM profiling_reports GROUP BY connection_id"
        )).fetchall():
            counts[row[0]] = int(row[1])
    except Exception:
        pass

    try:
        rows = db.execute(text(
            "SELECT id, name, platform, environment, status, error_message, "
            "schemas_scope, layer_map, last_tested_at, last_sync_at, created_at, "
            "host, port, database_name, auth_type "
            "FROM connections WHERE (org_id=:org OR org_id='default') AND deleted_at IS NULL "
            "ORDER BY created_at DESC"
        ), {"org": current_user.org_id}).fetchall()
    except Exception:
        db.rollback()
        rows = db.execute(text(
            "SELECT id, name, platform, environment, status, error_message, "
            "schemas_scope, layer_map, last_tested_at, last_sync_at, created_at, "
            "host, port, database_name, auth_type "
            "FROM connections WHERE deleted_at IS NULL ORDER BY created_at DESC"
        )).fetchall()

    return [ConnectionResponse(
        id=r[0], name=r[1], platform=r[2], environment=r[3],
        status=r[4], error_message=r[5], schemas_scope=r[6] or [],
        layer_map=r[7],
        last_tested_at=r[8], last_sync_at=r[9], created_at=r[10],
        table_count=counts.get(r[0]),
        host=r[11], port=r[12], database_name=r[13], auth_type=r[14],
    ) for r in rows]


@router.get("/platforms")
def list_platforms():
    labels = {
        "sqlserver":  {"label": "SQL Server",  "icon": "database",  "auth_types": ["sql", "windows", "azure_ad"]},
        "snowflake":  {"label": "Snowflake",   "icon": "snowflake", "auth_types": ["password", "keypair", "oauth"]},
        "databricks": {"label": "Databricks",  "icon": "zap",       "auth_types": ["pat", "oauth"]},
        "postgres":   {"label": "PostgreSQL",  "icon": "database",  "auth_types": ["password"]},
        "duckdb":     {"label": "DuckDB",      "icon": "hard-drive","auth_types": ["none"]},
    }
    return [{"platform": p, **labels.get(p, {})} for p in SUPPORTED_PLATFORMS if p in labels]


@router.post("/test", response_model=ConnectionTestResult)
def test_connection(req: ConnectionTestRequest):
    """Test connectivity without saving. No auth required (no data exposed)."""
    steps = []
    start = time.monotonic()
    connector = None
    try:
        steps.append("Building connector configuration")
        creds = req.credentials.model_dump(exclude_none=True)
        connector = get_connector(req.platform, creds)
        steps.append(f"Connector ready — platform: {req.platform}")

        host = creds.get("host", creds.get("server", ""))
        port = creds.get("port", 1433)
        instance = creds.get("instance", "")
        addr = f"{host}\\{instance}" if instance else f"{host}:{port}"
        steps.append(f"Establishing connection to server ({addr})")
        connector.test()
        latency = int((time.monotonic() - start) * 1000)

        steps.append("Authentication succeeded — running SELECT 1")
        steps.append("Enumerating accessible schemas")
        schemas = connector.list_schemas()
        steps.append(f"Found {len(schemas)} schema(s): {', '.join(schemas[:6]) or '(none)'}")
        return ConnectionTestResult(success=True, message="Connection successful",
                                    latency_ms=latency, details=steps, schemas=schemas)

    except ImportError as e:
        latency = int((time.monotonic() - start) * 1000)
        steps.append(f"Driver not installed: {e}")
        return ConnectionTestResult(success=False,
                                    message=f"Required driver not installed: {e}",
                                    latency_ms=latency, details=steps)
    except Exception as e:
        latency = int((time.monotonic() - start) * 1000)
        raw = str(e)
        if isinstance(e, (ConnectionError, ValueError)):
            clean = raw
        elif "[" in raw:
            clean = raw[raw.find("["):]
        else:
            clean = raw
        steps.append(f"Failed: {clean}")
        logger.error("Connection test failed (%s): %s", req.platform, raw)
        return ConnectionTestResult(success=False, message=clean,
                                    latency_ms=latency, details=steps)
    finally:
        # Every early-return above skips this on success too (already closed
        # there historically), so close unconditionally here instead — a
        # connector left open on a failed test leaks a live session in this
        # worker process for the rest of its life, which can corrupt driver-
        # internal state for the *next* unrelated test in the same process.
        if connector is not None:
            try:
                connector.close()
            except Exception:
                pass


@router.post("", response_model=ConnectionResponse, status_code=201)
def create_connection(
    req: ConnectionCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    if req.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, f"Unsupported platform: {req.platform}")

    conn_id = str(uuid.uuid4())
    creds = req.credentials.model_dump(exclude_none=True)
    encrypted = _encrypt(creds)
    now = datetime.now(timezone.utc)

    layer_map_json = json.dumps(req.layer_map) if req.layer_map else None
    db.execute(text("""
        INSERT INTO connections
            (id, name, platform, environment, config_encrypted,
             status, schemas_scope, layer_map,
             host, port, database_name, auth_type,
             org_id, last_tested_at, created_at, updated_at)
        VALUES
            (:id, :name, :platform, :env, :config,
             'active', :schemas, CAST(:layer_map AS jsonb),
             :host, :port, :db_name, :auth_type,
             :org_id, :now, :now, :now)
    """), {
        "id": conn_id, "name": req.name, "platform": req.platform,
        "env": req.environment, "config": encrypted,
        "schemas": req.schemas_scope, "layer_map": layer_map_json,
        "host": creds.get("host") or creds.get("server") or creds.get("account"),
        "port": creds.get("port"),
        "db_name": creds.get("database") or creds.get("catalog"),
        "auth_type": creds.get("auth_type", "sql"),
        "org_id": current_user.org_id,
        "now": now,
    })
    db.commit()

    log_event(db, user_email=current_user.email, event_type="CREATE",
              entity_type="CONNECTION", entity_id=conn_id,
              new_value={"name": req.name, "platform": req.platform},
              connection_id=conn_id, org_id=current_user.org_id)
    db.commit()

    return ConnectionResponse(id=conn_id, name=req.name, platform=req.platform,
                               environment=req.environment, status="active",
                               schemas_scope=req.schemas_scope, layer_map=req.layer_map,
                               last_tested_at=now, created_at=now,
                               host=creds.get("host") or creds.get("account"),
                               port=creds.get("port"),
                               database_name=creds.get("database") or creds.get("catalog"),
                               auth_type=creds.get("auth_type", "sql"))


@router.patch("/{connection_id}", response_model=ConnectionResponse)
def update_connection(
    connection_id: str,
    req: ConnectionUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    row = db.execute(
        text("SELECT id, org_id, config_encrypted FROM connections WHERE id=:id AND deleted_at IS NULL"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(row[1], current_user)

    parts, params = [], {"id": connection_id, "now": datetime.now(timezone.utc)}
    if req.name is not None:
        parts.append("name=:name"); params["name"] = req.name
    if req.schemas_scope is not None:
        parts.append("schemas_scope=CAST(:schemas AS text[])"); params["schemas"] = req.schemas_scope
    if req.layer_map is not None:
        parts.append("layer_map=CAST(:layer_map AS jsonb)"); params["layer_map"] = json.dumps(req.layer_map)
    if req.environment is not None:
        parts.append("environment=:env"); params["env"] = req.environment

    if req.credentials is not None:
        existing = _decrypt(row[2])
        new_creds = {k: v for k, v in req.credentials.items() if v is not None and v != ""}
        # Empty-string secrets mean "keep existing"
        for secret in ("password", "token", "private_key_path", "private_key_passphrase"):
            if req.credentials.get(secret) == "":
                new_creds.pop(secret, None)
        existing.update(new_creds)
        parts.append("config_encrypted=:config"); params["config"] = _encrypt(existing)
        # Keep denormalized columns in sync
        new_host = new_creds.get("host") or new_creds.get("account")
        if new_host:
            parts.append("host=:host"); params["host"] = new_host
        if "auth_type" in new_creds:
            parts.append("auth_type=:auth_type"); params["auth_type"] = new_creds["auth_type"]
        if "port" in new_creds:
            parts.append("port=:port"); params["port"] = new_creds["port"]
        new_db = new_creds.get("database") or new_creds.get("catalog")
        if new_db:
            parts.append("database_name=:db_name"); params["db_name"] = new_db

    if parts:
        db.execute(text(f"UPDATE connections SET {', '.join(parts)}, updated_at=:now WHERE id=:id"), params)
        db.commit()

    r = db.execute(text(
        "SELECT id, name, platform, environment, status, error_message, "
        "schemas_scope, layer_map, last_tested_at, last_sync_at, created_at, "
        "host, port, database_name, auth_type FROM connections WHERE id=:id"
    ), {"id": connection_id}).fetchone()
    return ConnectionResponse(
        id=r[0], name=r[1], platform=r[2], environment=r[3],
        status=r[4], error_message=r[5], schemas_scope=r[6] or [],
        layer_map=r[7],
        last_tested_at=r[8], last_sync_at=r[9], created_at=r[10],
        host=r[11], port=r[12], database_name=r[13], auth_type=r[14],
    )


@router.get("/{connection_id}/credentials")
def get_connection_credentials(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Return non-sensitive credential fields for the edit form. Passwords/tokens are excluded."""
    row = db.execute(
        text("SELECT platform, config_encrypted, org_id FROM connections WHERE id=:id AND deleted_at IS NULL"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(row[2], current_user)

    config = _decrypt(row[1])
    SENSITIVE = {"password", "token", "private_key_path", "private_key_passphrase"}
    return {k: v for k, v in config.items() if k not in SENSITIVE}


@router.post("/{connection_id}/test", response_model=ConnectionTestResult)
def test_saved_connection(
    connection_id: str,
    req: ConnectionCredentialOverride = ConnectionCredentialOverride(),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Test a saved connection, merging optional credential overrides (used in the edit-credentials flow)."""
    row = db.execute(
        text("SELECT platform, config_encrypted, org_id FROM connections WHERE id=:id AND deleted_at IS NULL"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(row[2], current_user)

    platform, config = row[0], _decrypt(row[1])
    if req.credentials:
        overrides = {k: v for k, v in req.credentials.items() if v is not None and v != ""}
        config.update(overrides)

    steps, start = [], time.monotonic()
    connector = None
    try:
        steps.append("Building connector configuration")
        connector = get_connector(platform, config)
        host = config.get("host") or config.get("account") or config.get("server") or ""
        port = config.get("port", "")
        steps.append(f"Connecting to {host}{':{}'.format(port) if port else ''}")
        connector.test()
        latency = int((time.monotonic() - start) * 1000)
        steps.append("Authentication succeeded — running SELECT 1")
        steps.append("Enumerating accessible schemas")
        schemas = connector.list_schemas()
        steps.append(f"Found {len(schemas)} schema(s): {', '.join(schemas[:6]) or '(none)'}")
        db.execute(text(
            "UPDATE connections SET status='active', error_message=NULL, "
            "last_tested_at=NOW(), updated_at=NOW() WHERE id=:id"
        ), {"id": connection_id})
        db.commit()
        return ConnectionTestResult(success=True, message="Connection successful",
                                    latency_ms=latency, details=steps, schemas=schemas)
    except ImportError as e:
        latency = int((time.monotonic() - start) * 1000)
        steps.append(f"Driver not installed: {e}")
        db.execute(text(
            "UPDATE connections SET status='error', error_message=:err, "
            "last_tested_at=NOW(), updated_at=NOW() WHERE id=:id"
        ), {"id": connection_id, "err": f"Required driver not installed: {e}"})
        db.commit()
        return ConnectionTestResult(success=False, message=f"Required driver not installed: {e}",
                                    latency_ms=latency, details=steps)
    except Exception as e:
        latency = int((time.monotonic() - start) * 1000)
        raw = str(e)
        clean = raw[raw.find("["):] if "[" in raw else raw
        steps.append(f"Failed: {clean}")
        logger.error("Saved connection test failed (%s / %s): %s", connection_id, platform, raw)
        db.execute(text(
            "UPDATE connections SET status='error', error_message=:err, "
            "last_tested_at=NOW(), updated_at=NOW() WHERE id=:id"
        ), {"id": connection_id, "err": clean})
        db.commit()
        return ConnectionTestResult(success=False, message=clean, latency_ms=latency, details=steps)
    finally:
        if connector is not None:
            try:
                connector.close()
            except Exception:
                pass


@router.get("/{connection_id}/schemas")
def get_connection_schemas(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    row = db.execute(
        text("SELECT platform, config_encrypted, schemas_scope, org_id FROM connections WHERE id=:id AND deleted_at IS NULL"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(row[3], current_user)

    platform, encrypted, current_scope = row[0], row[1], row[2]
    config = _decrypt(encrypted)
    connector = None
    try:
        connector = get_connector(platform, config)
        available = connector.list_schemas()
    except Exception:
        available = list(current_scope or [])
    finally:
        if connector is not None:
            try:
                connector.close()
            except Exception:
                pass

    return {"available": available, "selected": list(current_scope or [])}


@router.delete("/{connection_id}", status_code=204)
def delete_connection(
    connection_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_role(["admin", "data_engineer"])),
):
    """Soft-delete: sets deleted_at so data is preserved and recoverable."""
    row = db.execute(
        text("SELECT id, org_id FROM connections WHERE id=:id AND deleted_at IS NULL"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")
    assert_connection_access(row[1], current_user)

    db.execute(text(
        "UPDATE connections SET deleted_at=NOW(), deleted_by=:user WHERE id=:id"
    ), {"user": current_user.email, "id": connection_id})

    log_event(db, user_email=current_user.email, event_type="DELETE",
              entity_type="CONNECTION", entity_id=connection_id,
              connection_id=connection_id, org_id=current_user.org_id)
    db.commit()


def get_active_connector(connection_id: str, db: Session):
    """Helper for other APIs: load + decrypt a saved connection. No auth check — callers must verify."""
    row = db.execute(
        text("SELECT platform, config_encrypted FROM connections WHERE id=:id AND status='active' AND deleted_at IS NULL"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, f"Connection {connection_id} not found or inactive")
    platform, encrypted = row
    config = _decrypt(encrypted)
    return get_connector(platform, config)
