"""Write every human action to the immutable audit trail."""
import uuid
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import text


def log_event(
    db: Session,
    *,
    user_name: str,
    event_type: str,
    entity_type: str,
    entity_id: str,
    old_value: dict | None = None,
    new_value: dict | None = None,
    reason: str | None = None,
    connection_id: str | None = None,
) -> None:
    db.execute(
        text("""
            INSERT INTO audit_trail
                (event_id, event_timestamp, user_name, event_type,
                 entity_type, entity_id, old_value, new_value, reason, connection_id)
            VALUES
                (:event_id, :ts, :user_name, :event_type,
                 :entity_type, :entity_id, :old_value::jsonb, :new_value::jsonb, :reason, :connection_id)
        """),
        {
            "event_id": str(uuid.uuid4()),
            "ts": datetime.now(timezone.utc),
            "user_name": user_name,
            "event_type": event_type,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "old_value": str(old_value) if old_value else None,
            "new_value": str(new_value) if new_value else None,
            "reason": reason,
            "connection_id": connection_id,
        },
    )
