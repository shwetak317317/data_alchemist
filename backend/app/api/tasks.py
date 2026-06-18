"""Human Task Board API — CRUD for the persistent task board."""
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db
from app.core.auth_deps import get_current_user, CurrentUser
from app.models.task import TaskCreate, TaskUpdate, TaskResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _row_to_task(row) -> TaskResponse:
    return TaskResponse(
        task_id=row[0], title=row[1], description=row[2],
        priority=row[3], phase=row[4], owner=row[5], status=row[6],
        related_entity_type=row[7], related_entity_id=row[8],
        due_date=row[9], completed_at=row[10], created_by=row[11],
        created_at=row[12], updated_at=row[13],
    )


@router.get("", response_model=list[TaskResponse])
def list_tasks(connection_id: str | None = None, status: str | None = None,
               db: Session = Depends(get_db),
               current_user: CurrentUser = Depends(get_current_user)):
    filters, params = [], {}
    if connection_id:
        filters.append("connection_id=:conn")
        params["conn"] = connection_id
    if status:
        filters.append("status=:status")
        params["status"] = status
    where = "WHERE " + " AND ".join(filters) if filters else ""
    rows = db.execute(text(
        f"SELECT task_id, title, description, priority, phase, owner, status, "
        f"related_entity_type, related_entity_id, due_date, completed_at, "
        f"created_by, created_at, updated_at "
        f"FROM task_board {where} ORDER BY "
        f"CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END, "
        f"created_at DESC"
    ), params).fetchall()
    return [_row_to_task(r) for r in rows]


@router.post("", response_model=TaskResponse, status_code=201)
def create_task(task: TaskCreate, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    db.execute(text("""
        INSERT INTO task_board
            (task_id, title, description, priority, phase, owner, status,
             related_entity_type, related_entity_id, due_date,
             connection_id, created_by, created_at, updated_at)
        VALUES
            (:id, :title, :desc, :priority, :phase, :owner, 'open',
             :rel_type, :rel_id, :due,
             :conn, :created_by, :now, :now)
    """), {
        "id": tid, "title": task.title, "desc": task.description,
        "priority": task.priority, "phase": task.phase, "owner": task.owner,
        "rel_type": task.related_entity_type, "rel_id": task.related_entity_id,
        "due": task.due_date, "conn": task.connection_id,
        "created_by": current_user.email, "now": now,
    })
    db.commit()

    row = db.execute(text(
        "SELECT task_id, title, description, priority, phase, owner, status, "
        "related_entity_type, related_entity_id, due_date, completed_at, "
        "created_by, created_at, updated_at FROM task_board WHERE task_id=:id"
    ), {"id": tid}).fetchone()
    return _row_to_task(row)


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, update: TaskUpdate, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    row = db.execute(text("SELECT task_id FROM task_board WHERE task_id=:id"),
                     {"id": task_id}).fetchone()
    if not row:
        raise HTTPException(404, "Task not found")

    now = datetime.now(timezone.utc)
    updates, params = ["updated_at=:now"], {"id": task_id, "now": now}
    if update.status:
        updates.append("status=:status")
        params["status"] = update.status
        if update.status == "done":
            updates.append("completed_at=:now")
    if update.owner:
        updates.append("owner=:owner")
        params["owner"] = update.owner
    if update.priority:
        updates.append("priority=:priority")
        params["priority"] = update.priority
    if update.due_date:
        updates.append("due_date=:due")
        params["due"] = update.due_date

    db.execute(text(f"UPDATE task_board SET {', '.join(updates)} WHERE task_id=:id"), params)
    db.commit()

    updated = db.execute(text(
        "SELECT task_id, title, description, priority, phase, owner, status, "
        "related_entity_type, related_entity_id, due_date, completed_at, "
        "created_by, created_at, updated_at FROM task_board WHERE task_id=:id"
    ), {"id": task_id}).fetchone()
    return _row_to_task(updated)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db),
                current_user: CurrentUser = Depends(get_current_user)):
    result = db.execute(text("DELETE FROM task_board WHERE task_id=:id"), {"id": task_id})
    if result.rowcount == 0:
        raise HTTPException(404, "Task not found")
    db.commit()
