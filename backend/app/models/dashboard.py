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
    rule_count: int = 0                       # active rules executed against this layer (latest run)
    trend_delta: Optional[float] = None       # score change vs the previous profiling of the same tables


class TrustSummary(BaseModel):
    overall_score: float
    score_delta: float                        # change vs yesterday
    yesterday_score: Optional[float] = None  # yesterday's score for "vs yesterday (X)" display
    pipeline_status: str                      # HEALTHY | RECOVERING | ISSUES
    layers: list[LayerHealth]
    open_critical: int
    open_high: int
    open_medium: int
    open_errors: int = 0                      # rules that could not execute (e.g. source unreachable) — distinct from FAIL
    active_anomalies: int
    cde_health_pct: float
    last_run_at: Optional[datetime] = None
    recent_activity: list[dict[str, Any]] = []
    anomaly_breakdown: list[dict[str, Any]] = []   # [{type, label, count, intent}]
    workflow_states: dict[str, str] = {}            # {step_id: "done"|"active"|"pending"}
    profiled_table_count: int = 0
    layer_anomaly_counts: dict[str, int] = {}       # {layer: open_anomaly_count}


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
