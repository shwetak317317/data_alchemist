"""
Connections API — CRUD for data platform connections + credential test.
Credentials are stored Fernet-encrypted in the metadata DB.
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
from app.connectors.registry import get_connector, SUPPORTED_PLATFORMS
from app.models.connection import (
    ConnectionCreate, ConnectionTestRequest, ConnectionTestResult, ConnectionResponse, ConnectionUpdate
)
from app.services.audit_service import log_event

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/connections", tags=["connections"])


def _get_fernet() -> Fernet:
    key = settings.encryption_key.encode()
    # Fernet requires a 32-byte URL-safe base64 key — derive one from the secret
    import base64, hashlib
    digest = hashlib.sha256(key).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt(data: dict) -> str:
    return _get_fernet().encrypt(json.dumps(data).encode()).decode()


def _decrypt(token: str) -> dict:
    return json.loads(_get_fernet().decrypt(token.encode()).decode())


@router.get("", response_model=list[ConnectionResponse])
def list_connections(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT id, name, platform, environment, status, error_message, "
        "schemas_scope, last_tested_at, last_sync_at, created_at "
        "FROM connections ORDER BY created_at DESC"
    )).fetchall()
    return [ConnectionResponse(
        id=r[0], name=r[1], platform=r[2], environment=r[3],
        status=r[4], error_message=r[5], schemas_scope=r[6] or [],
        last_tested_at=r[7], last_sync_at=r[8], created_at=r[9],
    ) for r in rows]


@router.get("/platforms")
def list_platforms():
    """Return all supported platform types with display labels."""
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
    """Test connectivity without saving. Returns step-by-step trace."""
    steps = []
    start = time.monotonic()
    try:
        steps.append("Building connector configuration")
        creds = req.credentials.model_dump(exclude_none=True)
        connector = get_connector(req.platform, creds)
        steps.append(f"Connector ready — platform: {req.platform}")

        steps.append("Establishing connection to server")
        connector.test()
        latency = int((time.monotonic() - start) * 1000)

        steps.append("Authentication succeeded — running SELECT 1")
        steps.append("Enumerating accessible schemas")
        schemas = connector.list_schemas()
        steps.append(f"Found {len(schemas)} schema(s): {', '.join(schemas[:6]) or '(none)'}")
        connector.close()
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
        # Provide a clean, actionable error message
        raw = str(e)
        # Strip pyodbc noise — keep just the ODBC error block
        if "[" in raw:
            clean = raw[raw.find("["):]          # "[HY000] Login failed…"
        else:
            clean = raw
        steps.append(f"Failed: {clean}")
        logger.error("Connection test failed (%s): %s", req.platform, raw)
        return ConnectionTestResult(success=False, message=clean,
                                    latency_ms=latency, details=steps)


@router.post("", response_model=ConnectionResponse, status_code=201)
def create_connection(req: ConnectionCreate, db: Session = Depends(get_db)):
    if req.platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(400, f"Unsupported platform: {req.platform}")

    conn_id = str(uuid.uuid4())
    encrypted = _encrypt(req.credentials.model_dump(exclude_none=True))
    now = datetime.now(timezone.utc)

    db.execute(text("""
        INSERT INTO connections
            (id, name, platform, environment, config_encrypted,
             status, schemas_scope, last_tested_at, created_at, updated_at)
        VALUES
            (:id, :name, :platform, :env, :config,
             'active', :schemas, :now, :now, :now)
    """), {
        "id": conn_id, "name": req.name, "platform": req.platform,
        "env": req.environment, "config": encrypted,
        "schemas": req.schemas_scope, "now": now,
    })
    db.commit()

    log_event(db, user_name="system", event_type="CREATE", entity_type="CONNECTION",
              entity_id=conn_id, new_value={"name": req.name, "platform": req.platform})
    db.commit()

    return ConnectionResponse(id=conn_id, name=req.name, platform=req.platform,
                               environment=req.environment, status="active",
                               schemas_scope=req.schemas_scope,
                               last_tested_at=now, created_at=now)


@router.patch("/{connection_id}", response_model=ConnectionResponse)
def update_connection(connection_id: str, req: ConnectionUpdate, db: Session = Depends(get_db)):
    row = db.execute(text("SELECT id FROM connections WHERE id=:id"), {"id": connection_id}).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")

    parts, params = [], {"id": connection_id, "now": datetime.now(timezone.utc)}
    if req.name is not None:
        parts.append("name=:name"); params["name"] = req.name
    if req.schemas_scope is not None:
        parts.append("schemas_scope=:schemas"); params["schemas"] = req.schemas_scope

    if parts:
        db.execute(text(f"UPDATE connections SET {', '.join(parts)}, updated_at=:now WHERE id=:id"), params)
        db.commit()

    r = db.execute(text(
        "SELECT id, name, platform, environment, status, error_message, "
        "schemas_scope, last_tested_at, last_sync_at, created_at FROM connections WHERE id=:id"
    ), {"id": connection_id}).fetchone()
    return ConnectionResponse(
        id=r[0], name=r[1], platform=r[2], environment=r[3],
        status=r[4], error_message=r[5], schemas_scope=r[6] or [],
        last_tested_at=r[7], last_sync_at=r[8], created_at=r[9],
    )


@router.get("/{connection_id}/schemas")
def get_connection_schemas(connection_id: str, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT platform, config_encrypted, schemas_scope FROM connections WHERE id=:id"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "Connection not found")

    platform, encrypted, current_scope = row
    config = _decrypt(encrypted)
    try:
        connector = get_connector(platform, config)
        available = connector.list_schemas()
        connector.close()
    except Exception:
        available = list(current_scope or [])

    return {"available": available, "selected": list(current_scope or [])}


@router.delete("/{connection_id}", status_code=204)
def delete_connection(connection_id: str, db: Session = Depends(get_db)):
    result = db.execute(text("DELETE FROM connections WHERE id=:id"), {"id": connection_id})
    if result.rowcount == 0:
        raise HTTPException(404, "Connection not found")
    db.commit()


def get_active_connector(connection_id: str, db: Session):
    """Helper for other APIs: load + decrypt a saved connection."""
    row = db.execute(
        text("SELECT platform, config_encrypted FROM connections WHERE id=:id AND status='active'"),
        {"id": connection_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, f"Connection {connection_id} not found or inactive")
    platform, encrypted = row
    config = _decrypt(encrypted)
    return get_connector(platform, config)
