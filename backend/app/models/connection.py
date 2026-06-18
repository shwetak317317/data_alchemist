from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ConnectionCredentials(BaseModel):
    """Platform-agnostic credential bag. Only relevant keys are used per platform."""
    # Universal
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    auth_type: Optional[str] = "sql"   # sql | windows | azure_ad | password | keypair | oauth | pat
    username: Optional[str] = None
    password: Optional[str] = None

    # SQL Server specific
    instance: Optional[str] = None
    trust_cert: bool = True
    encrypt: bool = True

    # Snowflake specific
    account: Optional[str] = None
    warehouse: Optional[str] = None
    role: Optional[str] = None
    private_key_path: Optional[str] = None

    # Databricks specific
    http_path: Optional[str] = None
    token: Optional[str] = None
    catalog: Optional[str] = None

    # DuckDB specific
    file_path: Optional[str] = None


class ConnectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    platform: str                              # sqlserver | snowflake | databricks | postgres | duckdb
    environment: str = "production"
    credentials: ConnectionCredentials
    schemas_scope: list[str] = []
    layer_map: Optional[dict] = None           # {layers: [...], assignment: {...}}


class ConnectionTestRequest(BaseModel):
    platform: str
    credentials: ConnectionCredentials


class ConnectionTestResult(BaseModel):
    success: bool
    message: str
    latency_ms: Optional[int] = None
    details: Optional[list[str]] = None       # step-by-step test trace
    schemas: Optional[list[str]] = None       # schemas discovered on success


class ConnectionResponse(BaseModel):
    id: str
    name: str
    platform: str
    environment: str
    status: str
    error_message: Optional[str] = None
    schemas_scope: list[str] = []
    layer_map: Optional[dict] = None
    last_tested_at: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None
    created_at: datetime
    table_count: Optional[int] = None
    # Denormalized credential preview (no secrets)
    host: Optional[str] = None
    port: Optional[int] = None
    database_name: Optional[str] = None
    auth_type: Optional[str] = None

    class Config:
        from_attributes = True


class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    schemas_scope: Optional[list[str]] = None
    layer_map: Optional[dict] = None
    credentials: Optional[dict] = None   # partial update — merged with existing encrypted config
    environment: Optional[str] = None


class ConnectionCredentialOverride(BaseModel):
    """Used for POST /{id}/test to test with optional partial overrides."""
    credentials: Optional[dict] = None
