"""
Statistical anomaly detection — volume, distribution, metric threshold, and
freshness. All methods return AnomalyRecord objects for the Anomaly Agent to
classify.
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
    min_deviation_pct: float = 0.0,
) -> AnomalyRecord | None:
    """
    Check if current row count deviates more than 2σ from the rolling baseline
    AND by at least min_deviation_pct percent (the user-configured threshold).

    The percent floor matters independently of the σ rule: a perfectly stable
    baseline has stdev 0 (coerced to 1 below), so without the floor a ±2-row
    blip on a static table flags a CRITICAL anomaly reading "0% deviation".
    """
    if len(baseline_counts) < 3:
        return None

    mean = statistics.mean(baseline_counts)
    std = statistics.stdev(baseline_counts) or 1
    deviation = (current_count - mean) / std
    deviation_pct = round((current_count - mean) / max(mean, 1) * 100, 1)

    if abs(deviation) < 2 or abs(deviation_pct) < min_deviation_pct:
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
    min_deviation_pct: float = 0.0,
) -> AnomalyRecord | None:
    """
    Check if null rate for a column is significantly above its historical
    baseline: > 2σ AND at least min_deviation_pct percent above it relative to
    the baseline (the user-configured distribution threshold; same relative-%
    semantics as the volume detector and the description text). The σ rule
    alone flags a 2.4%-vs-2.1% wiggle on a very stable column, which no
    steward wants paged about.
    """
    if len(baseline_null_pcts) < 3 or current_null_pct == 0:
        return None

    mean = statistics.mean(baseline_null_pcts)
    std = statistics.stdev(baseline_null_pcts) or 0.5
    deviation = (current_null_pct - mean) / std

    deviation_pct = round((current_null_pct - mean) / max(mean, 0.01) * 100, 1)
    if deviation < 2 or deviation_pct < min_deviation_pct:
        return None
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
    min_deviation_pct: float = 0.0,
) -> AnomalyRecord | None:
    """
    Check if a numeric metric (e.g. revenue) has deviated from its 7-day
    baseline: > 2σ AND by at least min_deviation_pct percent (user threshold) —
    same floor rationale as detect_volume_anomaly (stdev of a stable baseline
    is coerced to 1, which otherwise flags trivial wiggles).
    """
    if len(baseline_values) < 3:
        return None

    mean = statistics.mean(baseline_values)
    std = statistics.stdev(baseline_values) or 1
    deviation = (current_value - mean) / std
    deviation_pct = round((current_value - mean) / max(abs(mean), 1) * 100, 1)

    if abs(deviation) < 2 or abs(deviation_pct) < min_deviation_pct:
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


def detect_freshness_anomaly(
    connection_id: str,
    table_fqn: str,
    layer: str,
    last_seen_at: datetime,
    freshness_hours: float,
) -> AnomalyRecord | None:
    """
    Flag a table whose most recent profiling snapshot is older than the
    user-configured freshness window — the Thresholds panel has promised this
    check ("Alert when table data is older than this many hours") since day
    one, but no detector existed for it until now.
    Severity scales with how far past the window the table is.
    """
    if not last_seen_at or freshness_hours <= 0:
        return None
    if last_seen_at.tzinfo is None:
        last_seen_at = last_seen_at.replace(tzinfo=timezone.utc)
    age_hours = (datetime.now(timezone.utc) - last_seen_at).total_seconds() / 3600
    if age_hours <= freshness_hours:
        return None

    severity = "HIGH" if age_hours > freshness_hours * 2 else "MEDIUM"
    deviation_pct = round((age_hours - freshness_hours) / freshness_hours * 100, 1)
    return AnomalyRecord(
        anomaly_id=str(uuid.uuid4()),
        connection_id=connection_id,
        detected_at=datetime.now(timezone.utc),
        layer=layer,
        table_fqn=table_fqn,
        anomaly_type="FRESHNESS",
        description=(
            f"No fresh data snapshot in {age_hours:.0f}h — freshness SLA is "
            f"{freshness_hours:.0f}h (last profiled {last_seen_at.strftime('%b %d %H:%M')} UTC)"
        ),
        severity=severity,
        metric_value=round(age_hours, 1),
        baseline_value=freshness_hours,
        deviation_pct=deviation_pct,
    )
