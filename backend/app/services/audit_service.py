"""Write every human action to the immutable audit trail.

user_email must come from the authenticated JWT token (current_user.email),
never from the request body — it is the non-repudiable identity.
"""
import json
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import text


def log_event(
    db: Session,
    *,
    user_email: str,
    event_type: str,
    entity_type: str,
    entity_id: str,
    old_value: dict | None = None,
    new_value: dict | None = None,
    reason: str | None = None,
    connection_id: str | None = None,
    org_id: str | None = None,
    # Legacy alias kept for callers not yet migrated to user_email
    user_name: str | None = None,
) -> None:
    # Accept legacy user_name param — prefer user_email
    resolved_user = user_email or user_name or "system"

    db.execute(
        text("""
            INSERT INTO audit_trail
                (event_id, event_timestamp, user_name, user_email, event_type,
                 entity_type, entity_id, old_value, new_value, reason,
                 connection_id, org_id)
            VALUES
                (:event_id, :ts, :user_name, :user_email, :event_type,
                 :entity_type, :entity_id, CAST(:old_value AS jsonb), CAST(:new_value AS jsonb), :reason,
                 :connection_id, :org_id)
        """),
        {
            "event_id":      str(uuid.uuid4()),
            "ts":            datetime.now(timezone.utc),
            "user_name":     resolved_user,
            "user_email":    resolved_user,
            "event_type":    event_type,
            "entity_type":   entity_type,
            "entity_id":     str(entity_id),
            "old_value":     json.dumps(old_value) if old_value else None,
            "new_value":     json.dumps(new_value) if new_value else None,
            "reason":        reason,
            "connection_id": connection_id,
            "org_id":        org_id,
        },
    )
