from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel


class ColumnStats(BaseModel):
    name: str
    data_type: str
    null_pct: float
    distinct_count: int
    cardinality_ratio: float
    min_val: Optional[Any] = None
    max_val: Optional[Any] = None
    mean_val: Optional[float] = None
    std_dev: Optional[float] = None
    top_values: list[Any] = []
    format_pattern: Optional[str] = None     # e.g. 'EMAIL', 'UUID', 'YYYY-MM-DD', 'MIXED'
    has_duplicates: bool = False
    health: str = "HEALTHY"                   # HEALTHY | WARN | CRIT
    health_reasons: list[str] = []
    is_cde: bool = False


class ProfilingRisk(BaseModel):
    column: Optional[str] = None
    risk_type: str                            # NULL_HIGH | FORMAT_MIXED | DUPLICATE | VOLUME_DROP | etc.
    severity: str                             # CRITICAL | HIGH | MEDIUM | LOW
    description: str


class ProfilingReport(BaseModel):
    report_id: str
    connection_id: str
    table_fqn: str
    layer: str
    run_at: datetime
    row_count: int
    quality_score: float
    completeness_score: float
    uniqueness_score: float
    consistency_score: float
    freshness_score: float
    columns: list[ColumnStats]
    risks: list[ProfilingRisk]
    summary_text: Optional[str] = None


class ProfilingRunRequest(BaseModel):
    connection_id: str
    schema_name: str
    table_name: str


class ProfilingProgressEvent(BaseModel):
    step: str
    status: str                               # running | done | error
    detail: Optional[str] = None
    progress_pct: int = 0
