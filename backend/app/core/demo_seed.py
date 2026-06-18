"""
DataTrust startup seed — creates the test admin user if not present.
All demo / mock data has been removed; the database starts empty.
"""
import logging

from sqlalchemy import text

from app.core.metadata_db import db_session

logger = logging.getLogger(__name__)

DEMO_CONN_ID   = "demo-conn-datatrust"   # kept for reference; no longer seeded
DEMO_REPORT_ID = "demo-report-silver-orders-enriched"
DEMO_RUN_ID    = "demo-run-001"


def seed_demo_data() -> None:
    """Seed only the test admin user on every startup (idempotent)."""
    try:
        with db_session() as db:
            _seed_test_user(db)
    except Exception as exc:
        logger.warning("Test user seed failed (non-fatal): %s", exc)


def _seed_test_user(db) -> None:
    from passlib.context import CryptContext
    _pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

    TEST_EMAIL = "test@pal.tech"
    TEST_NAME  = "Test Admin"
    TEST_ORG   = "pal.tech"
    TEST_ROLE  = "admin"

    existing = db.execute(
        text("SELECT email, role FROM users WHERE email = :email"),
        {"email": TEST_EMAIL},
    ).fetchone()

    if existing:
        if existing[1] == "viewer":
            db.execute(
                text("UPDATE users SET role = :role, org_id = :org WHERE email = :email"),
                {"role": TEST_ROLE, "org": TEST_ORG, "email": TEST_EMAIL},
            )
            db.commit()
            logger.info("Test user role upgraded to admin: %s", TEST_EMAIL)
    else:
        pw_hash = _pwd.hash("Test1234!")
        db.execute(
            text(
                "INSERT INTO users (email, name, password_hash, org_id, role) "
                "VALUES (:email, :name, :hash, :org, :role) "
                "ON CONFLICT (email) DO NOTHING"
            ),
            {"email": TEST_EMAIL, "name": TEST_NAME, "hash": pw_hash,
             "org": TEST_ORG, "role": TEST_ROLE},
        )
        db.commit()
        logger.info("Test user seeded: %s (org=%s role=%s)", TEST_EMAIL, TEST_ORG, TEST_ROLE)

    # Migrate any connections stuck with the pre-migration-19 'default' org sentinel
    try:
        migrated = db.execute(
            text("UPDATE connections SET org_id = :org WHERE org_id = 'default'"),
            {"org": TEST_ORG},
        ).rowcount
        if migrated:
            db.commit()
            logger.info("Migrated %d connection(s) from org 'default' to '%s'", migrated, TEST_ORG)
    except Exception as exc:
        db.rollback()
        logger.warning("Connection org migration skipped: %s", exc)
