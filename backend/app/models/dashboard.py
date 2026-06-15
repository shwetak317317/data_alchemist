from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel


class LayerHealth(BaseModel):
    layer: str                                # RAW | BRONZE | SILVER | GOLD
    score: float
    status: str                               # HEALTHY | WARN | ISSUES
    open_issues: int
    critical_count: int
    high_count: int


class TrustSummary(BaseModel):
    overall_score: float
    score_delta: float                        # change vs yesterday
    pipeline_status: str                      # HEALTHY | RECOVERING | ISSUES
    layers: list[LayerHealth]
    open_critical: int
    open_high: int
    open_medium: int
    active_anomalies: int
    cde_health_pct: float
    last_run_at: Optional[datetime] = None
    recent_activity: list[dict[str, Any]] = []


class TrendPoint(BaseModel):
    date: str
    score: float


class CDEStatus(BaseModel):
    column_id: str
    table_fqn: str
    column_name: str
    business_name: Optional[str] = None
    cde_score: float
    last_null_pct: float
    rule_coverage: int                        # number of active rules
    health: str                               # HEALTHY | WARN | CRIT
