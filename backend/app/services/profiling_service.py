"""
SQL-based statistics computation for the Profiling Agent.
All queries are written in standard ANSI SQL so they work across platforms.
Platform-specific syntax differences are handled in the connector layer.
"""
import logging
from app.connectors.base import BaseConnector

logger = logging.getLogger(__name__)


def get_row_count(connector: BaseConnector, schema: str, table: str) -> int:
    tref = connector.table_ref(schema, table)
    try:
        return int(connector.query_scalar(f"SELECT COUNT(*) FROM {tref}") or 0)
    except Exception:
        return 0


def get_column_null_stats(connector: BaseConnector, schema: str, table: str, columns: list[dict]) -> dict:
    """Return {col_name: null_count} for all columns."""
    if not columns:
        return {}
    tref = connector.table_ref(schema, table)
    null_exprs = ", ".join(
        f"SUM(CASE WHEN [{c['name']}] IS NULL THEN 1 ELSE 0 END) AS [{c['name']}]"
        for c in columns
    )
    try:
        result = connector.query(f"SELECT {null_exprs} FROM {tref}")
    except Exception:
        # Fallback: ANSI double-quote columns
        null_exprs_dq = ", ".join(
            f'SUM(CASE WHEN "{c["name"]}" IS NULL THEN 1 ELSE 0 END) AS "{c["name"]}"'
            for c in columns
        )
        try:
            result = connector.query(f'SELECT {null_exprs_dq} FROM {tref}')
        except Exception:
            return {}

    if not result.rows:
        return {}
    return dict(zip(result.columns, result.rows[0]))


def get_column_distinct_count(connector: BaseConnector, schema: str, table: str, col: str) -> int:
    tref = connector.table_ref(schema, table)
    try:
        return int(connector.query_scalar(f"SELECT COUNT(DISTINCT [{col}]) FROM {tref}") or 0)
    except Exception:
        try:
            return int(connector.query_scalar(f'SELECT COUNT(DISTINCT "{col}") FROM {tref}') or 0)
        except Exception:
            return 0


def get_top_values(connector: BaseConnector, schema: str, table: str, col: str, n: int = 10) -> list:
    tref = connector.table_ref(schema, table)
    try:
        result = connector.query(
            f"SELECT TOP {n} [{col}], COUNT(*) AS cnt FROM {tref} "
            f"GROUP BY [{col}] ORDER BY cnt DESC"
        )
    except Exception:
        try:
            result = connector.query(
                f'SELECT "{col}", COUNT(*) AS cnt FROM {tref} '
                f'GROUP BY "{col}" ORDER BY cnt DESC LIMIT {n}'
            )
        except Exception:
            return []
    return [row[0] for row in result.rows[:n]]


def get_numeric_stats(connector: BaseConnector, schema: str, table: str, col: str) -> dict:
    tref = connector.table_ref(schema, table)
    try:
        result = connector.query(
            f"SELECT MIN([{col}]), MAX([{col}]), AVG(CAST([{col}] AS FLOAT)), "
            f"STDEV(CAST([{col}] AS FLOAT)) FROM {tref}"
        )
    except Exception:
        try:
            result = connector.query(
                f'SELECT MIN("{col}"), MAX("{col}"), AVG(CAST("{col}" AS FLOAT)), '
                f'STDDEV(CAST("{col}" AS FLOAT)) FROM {tref}'
            )
        except Exception:
            return {}

    if not result.rows:
        return {}
    row = result.rows[0]
    return {
        "min": row[0], "max": row[1],
        "mean": round(float(row[2]), 4) if row[2] is not None else None,
        "std_dev": round(float(row[3]), 4) if row[3] is not None else None,
    }


def detect_format_pattern(sample_values: list) -> str:
    """Heuristic format detection from a sample of non-null values."""
    import re
    if not sample_values:
        return "UNKNOWN"
    strs = [str(v) for v in sample_values if v is not None]
    if not strs:
        return "UNKNOWN"

    patterns = {
        "EMAIL": re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$"),
        "UUID":  re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE),
        "DATE_ISO": re.compile(r"^\d{4}-\d{2}-\d{2}$"),
        "DATE_US":  re.compile(r"^\d{2}/\d{2}/\d{4}$"),
        "PHONE": re.compile(r"^\+?[\d\s\-\(\)]{7,15}$"),
    }
    matches: dict[str, int] = {k: 0 for k in patterns}
    for v in strs[:50]:
        for name, pat in patterns.items():
            if pat.match(v):
                matches[name] += 1

    best = max(matches, key=lambda k: matches[k])
    if matches[best] == 0:
        return "STRING"
    coverage = matches[best] / len(strs)
    if coverage < 0.8:
        return "MIXED"
    return best
