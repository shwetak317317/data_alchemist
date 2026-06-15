"""
Statistical anomaly detection — volume, distribution, and source arrival.
All methods return AnomalyRecord objects for the Anomaly Agent to classify.
"""
import uuid
import logging
import statistics
from datetime import datetime, timezone

from app.connectors.base import BaseConnector
from app.models.anomaly import AnomalyRecord

logger = logging.getLogger(__name__)


def detect_volume_anomaly(
    connector: BaseConnector,
    connection_id: str,
    table_fqn: str,
    layer: str,
    baseline_counts: list[int],
    current_count: int,
) -> AnomalyRecord | None:
    """
    Check if current row count deviates more than 2σ from the rolling baseline.
    """
    if len(baseline_counts) < 3:
        return None

    mean = statistics.mean(baseline_counts)
    std = statistics.stdev(baseline_counts) or 1
    deviation = (current_count - mean) / std
    deviation_pct = round((current_count - mean) / max(mean, 1) * 100, 1)

    if abs(deviation) < 2:
        return None

    severity = "CRITICAL" if abs(deviation) > 3 else "HIGH"
    direction = "dropped" if current_count < mean else "spiked"
    return AnomalyRecord(
        anomaly_id=str(uuid.uuid4()),
        connection_id=connection_id,
        detected_at=datetime.now(timezone.utc),
        layer=layer,
        table_fqn=table_fqn,
        anomaly_type="VOLUME",
        description=(
            f"Row count {direction} to {current_count:,} vs baseline avg "
            f"{int(mean):,} ({abs(deviation_pct):.0f}% deviation)"
        ),
        severity=severity,
        metric_value=float(current_count),
        baseline_value=round(mean, 0),
        deviation_pct=deviation_pct,
    )


def detect_null_rate_anomaly(
    connector: BaseConnector,
    connection_id: str,
    table_fqn: str,
    layer: str,
    column_name: str,
    current_null_pct: float,
    baseline_null_pcts: list[float],
) -> AnomalyRecord | None:
    """
    Check if null rate for a column is significantly above its historical baseline.
    """
    if len(baseline_null_pcts) < 3 or current_null_pct == 0:
        return None

    mean = statistics.mean(baseline_null_pcts)
    std = statistics.stdev(baseline_null_pcts) or 0.5
    deviation = (current_null_pct - mean) / std

    if deviation < 2:
        return None

    deviation_pct = round((current_null_pct - mean) / max(mean, 0.01) * 100, 1)
    severity = "CRITICAL" if current_null_pct > 10 else "HIGH"
    return AnomalyRecord(
        anomaly_id=str(uuid.uuid4()),
        connection_id=connection_id,
        detected_at=datetime.now(timezone.utc),
        layer=layer,
        table_fqn=table_fqn,
        column_name=column_name,
        anomaly_type="DISTRIBUTION",
        description=(
            f"{column_name} null rate is {current_null_pct:.1f}% vs baseline "
            f"{mean:.1f}% ({deviation_pct:.0f}% above average)"
        ),
        severity=severity,
        metric_value=current_null_pct,
        baseline_value=round(mean, 2),
        deviation_pct=deviation_pct,
    )


def detect_metric_threshold_anomaly(
    connector: BaseConnector,
    connection_id: str,
    table_fqn: str,
    layer: str,
    column_name: str,
    current_value: float,
    baseline_values: list[float],
) -> AnomalyRecord | None:
    """
    Check if a numeric metric (e.g. revenue) has deviated from its 7-day baseline.
    """
    if len(baseline_values) < 3:
        return None

    mean = statistics.mean(baseline_values)
    std = statistics.stdev(baseline_values) or 1
    deviation = (current_value - mean) / std
    deviation_pct = round((current_value - mean) / max(mean, 1) * 100, 1)

    if abs(deviation) < 2:
        return None

    severity = "CRITICAL" if abs(deviation) > 3 else "HIGH"
    direction = "below" if current_value < mean else "above"
    return AnomalyRecord(
        anomaly_id=str(uuid.uuid4()),
        connection_id=connection_id,
        detected_at=datetime.now(timezone.utc),
        layer=layer,
        table_fqn=table_fqn,
        column_name=column_name,
        anomaly_type="THRESHOLD",
        description=(
            f"{column_name} is {abs(deviation_pct):.0f}% {direction} the 7-day average "
            f"(current: {current_value:,.0f}, avg: {mean:,.0f})"
        ),
        severity=severity,
        metric_value=current_value,
        baseline_value=round(mean, 2),
        deviation_pct=deviation_pct,
    )
