from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: str = "MEDIUM"                 # CRITICAL | HIGH | MEDIUM | LOW
    phase: Optional[str] = None
    owner: Optional[str] = None
    due_date: Optional[date] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    connection_id: Optional[str] = None
    created_by: str = "anonymous"


class TaskUpdate(BaseModel):
    status: Optional[str] = None            # open | in_progress | done | cancelled
    owner: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[date] = None


class TaskResponse(BaseModel):
    task_id: str
    title: str
    description: Optional[str] = None
    priority: str
    phase: Optional[str] = None
    owner: Optional[str] = None
    status: str
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    due_date: Optional[date] = None
    completed_at: Optional[datetime] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
