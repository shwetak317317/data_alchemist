"""
SQLAlchemy engine + session factory for the PostgreSQL metadata store.
All DQ metadata (rules, results, CDEs, audit trail, etc.) lives here.
"""
import logging
from contextlib import contextmanager
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency: yields a DB session and closes it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def db_session():
    """Context manager for non-request code (agents, scheduler)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def apply_schemas() -> None:
    """Apply all DDL schema files at startup if tables don't exist yet."""
    import os
    schema_dir = os.path.join(os.path.dirname(__file__), "../../db/schemas")
    schema_dir = os.path.normpath(schema_dir)
    if not os.path.isdir(schema_dir):
        logger.warning("Schema directory not found: %s", schema_dir)
        return

    files = sorted(f for f in os.listdir(schema_dir) if f.endswith(".sql"))
    with engine.connect() as conn:
        for fname in files:
            fpath = os.path.join(schema_dir, fname)
            with open(fpath) as f:
                sql = f.read()
            try:
                conn.execute(text(sql))
                conn.commit()
                logger.info("Applied schema: %s", fname)
            except Exception as e:
                logger.warning("Schema %s skipped (%s)", fname, e)
