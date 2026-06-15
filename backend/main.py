"""
DataTrust — Agentic Data Quality & Trust Platform
FastAPI entry point — registers all routers and applies startup schema migration.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.metadata_db import apply_schemas
from app.core.demo_seed import seed_demo_data
from app.api import connections, profiling, metadata, rules, execution, anomalies, dashboard, tasks, simulation, auth, intel, lineage

logging.basicConfig(
    level=getattr(logging, settings.log_level, logging.INFO),
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting DataTrust backend (env=%s, model=%s)", settings.app_env, settings.llm_model)
    try:
        apply_schemas()
        logger.info("Metadata DB schemas applied")
    except Exception as e:
        logger.warning("Schema apply failed (may already exist): %s", e)
    try:
        seed_demo_data()
    except Exception as e:
        logger.warning("Demo seed failed (non-fatal): %s", e)
    yield
    logger.info("DataTrust backend shutting down")


app = FastAPI(
    title="DataTrust — Agentic DQ Platform",
    description="Agentic Data Quality and Trust Solution API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the frontend container (and local dev) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://localhost:80", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register all routers
app.include_router(connections.router)
app.include_router(profiling.router)
app.include_router(metadata.router)
app.include_router(rules.router)
app.include_router(execution.router)
app.include_router(anomalies.router)
app.include_router(dashboard.router)
app.include_router(tasks.router)
app.include_router(simulation.router)
app.include_router(auth.router)
app.include_router(intel.router)
app.include_router(lineage.router)


@app.get("/health")
def health():
    return {"status": "ok", "model": settings.llm_model, "env": settings.app_env}


@app.get("/api/config")
def get_config():
    """Return non-sensitive config visible to the frontend."""
    return {
        "llm_model": settings.llm_model,
        "app_env": settings.app_env,
        "supported_platforms": ["sqlserver", "snowflake", "databricks", "postgres", "duckdb"],
        "ms_configured": bool(settings.azure_client_id and settings.azure_tenant_id),
        "ms_client_id": settings.azure_client_id or "",
        "ms_tenant_id": settings.azure_tenant_id or "",
        "ms_redirect_uri": settings.azure_redirect_uri or "http://localhost",
        "ms_domain_hint": settings.azure_domain_hint or "pal.tech",
    }
