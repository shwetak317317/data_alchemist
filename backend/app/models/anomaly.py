from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class AnomalyRecord(BaseModel):
    anomaly_id: str
    connection_id: Optional[str] = None
    detected_at: datetime
    layer: Optional[str] = None
    table_fqn: Optional[str] = None
    column_name: Optional[str] = None
    anomaly_type: str                         # VOLUME|DISTRIBUTION|SEGMENT|SOURCE|THRESHOLD|FRESHNESS
    description: str
    severity: str
    metric_value: Optional[float] = None
    baseline_value: Optional[float] = None
    deviation_pct: Optional[float] = None
    business_explanation: Optional[str] = None
    status: str = "open"                      # open | acknowledged | resolved
    history_values: Optional[list] = None     # raw numeric array for sparkline (from profiling history)
    has_fingerprint: bool = False             # true when anomaly_fingerprints exist for this table


class AnomalyAcknowledgeRequest(BaseModel):
    acknowledged_by: Optional[str] = None    # overridden by current_user.email on the server
    note: Optional[str] = None


class AnomalyExplanationResponse(BaseModel):
    anomaly_id: str
    what_happened: str
    where: str
    when_first_seen: str
    why_it_matters: str
    how_bad: str
    recommended_actions: list[str]


class AnomalyScanRequest(BaseModel):
    connection_id: str
    tables: list[str] = []                    # empty = scan all active tables


class AnomalyThresholdsRequest(BaseModel):
    connection_id: str
    vol_pct: float = 30.0          # alert when row count shifts by this %
    dist_pct: float = 20.0         # alert when null rate / distribution shifts by this %
    freshness_hours: float = 24.0  # alert when table data is older than this


class AnomalyThresholdsResponse(BaseModel):
    connection_id: str
    vol_pct: float
    dist_pct: float
    freshness_hours: float


class AnomalyShareRequest(BaseModel):
    channel: str = "#data-quality"
    message: Optional[str] = None
