"""
SQL-based statistics computation for the Profiling Agent.
All queries are written in standard ANSI SQL so they work across platforms.
Platform-specific syntax differences are handled in the connector layer.
"""
import logging
from app.connectors.base import BaseConnector

logger = logging.getLogger(__name__)


def get_row_count(connector: BaseConnector, schema: str, table: str, where_sql: str | None = None) -> int:
    tref = connector.table_ref(schema, table)
    sql = f"SELECT COUNT(*) FROM {tref}"
    if where_sql:
        sql += f" WHERE {where_sql}"
    try:
        return int(connector.query_scalar(sql) or 0)
    except Exception:
        return 0


def get_column_null_stats(connector: BaseConnector, schema: str, table: str, columns: list[dict],
                           where_sql: str | None = None) -> dict:
    """Return {col_name: null_count} for all columns.

    where_sql: optional pre-validated WHERE fragment (e.g. a partition-window
    bound on a real column, built in profiling_agent.fetch_schema) — scopes
    every stat to the same window so an incremental/partitioned profiling run
    is internally consistent rather than mixing a windowed row_count with
    full-table column stats."""
    if not columns:
        return {}
    tref = connector.table_ref(schema, table)
    # quote_ident() is the platform-correct quoting (brackets on SQL Server,
    # backticks on Databricks, ANSI double-quote elsewhere) — previously this
    # hardcoded bracket quoting as the first attempt with an ANSI-double-quote
    # fallback on failure, which silently returned {} (no error surfaced) for
    # every column on any Databricks workspace where double-quoted identifiers
    # aren't enabled, since neither hardcoded attempt is backtick-quoted.
    q = connector.quote_ident
    null_exprs = ", ".join(
        f"SUM(CASE WHEN {q(c['name'])} IS NULL THEN 1 ELSE 0 END) AS {q(c['name'])}"
        for c in columns
    )
    sql = f"SELECT {null_exprs} FROM {tref}"
    if where_sql:
        sql += f" WHERE {where_sql}"
    try:
        result = connector.query(sql)
    except Exception as e:
        logger.warning("get_column_null_stats failed for %s.%s: %s", schema, table, e)
        return {}

    if not result.rows:
        return {}
    # SUM() over zero matching rows returns SQL NULL, not 0 — a real case now
    # that windowed/partial scans can legitimately match no rows (e.g. "Last
    # 24 hours" on a table with no recent activity). Coalesce here so every
    # caller gets an int, not a None that blows up on the first arithmetic op.
    return {k: int(v or 0) for k, v in zip(result.columns, result.rows[0])}


def get_column_distinct_counts(connector: BaseConnector, schema: str, table: str, columns: list[dict],
                                where_sql: str | None = None) -> dict:
    """Return {col_name: distinct_count} for all columns in a single round trip.

    Mirrors get_column_null_stats' one-query-for-all-columns shape instead of
    issuing a separate COUNT(DISTINCT ...) query per column.
    """
    if not columns:
        return {}
    tref = connector.table_ref(schema, table)
    q = connector.quote_ident
    exprs = ", ".join(f"COUNT(DISTINCT {q(c['name'])}) AS {q(c['name'])}" for c in columns)
    sql = f"SELECT {exprs} FROM {tref}"
    if where_sql:
        sql += f" WHERE {where_sql}"
    try:
        result = connector.query(sql)
    except Exception as e:
        logger.warning("get_column_distinct_counts failed for %s.%s: %s", schema, table, e)
        return {}
    if not result.rows:
        return {}
    return {k: int(v or 0) for k, v in zip(result.columns, result.rows[0])}


def get_top_values(connector: BaseConnector, schema: str, table: str, col: str, n: int = 10,
                    where_sql: str | None = None) -> list:
    tref = connector.table_ref(schema, table)
    q = connector.quote_ident(col)
    where_clause = f" WHERE {where_sql}" if where_sql else ""
    try:
        # TOP is SQL Server-only syntax; every other platform here uses LIMIT.
        # This is a genuine dialect difference (unlike quoting, which is never
        # ambiguous once routed through quote_ident) so the two-attempt shape
        # stays — but both attempts now quote correctly for every platform.
        result = connector.query(
            f"SELECT TOP {n} {q}, COUNT(*) AS cnt FROM {tref}{where_clause} "
            f"GROUP BY {q} ORDER BY cnt DESC"
        )
    except Exception:
        try:
            result = connector.query(
                f'SELECT {q}, COUNT(*) AS cnt FROM {tref}{where_clause} '
                f'GROUP BY {q} ORDER BY cnt DESC LIMIT {n}'
            )
        except Exception as e:
            logger.warning("get_top_values failed for %s.%s.%s: %s", schema, table, col, e)
            return []
    return [row[0] for row in result.rows[:n]]


def get_numeric_stats(connector: BaseConnector, schema: str, table: str, col: str,
                       where_sql: str | None = None) -> dict:
    tref = connector.table_ref(schema, table)
    q = connector.quote_ident(col)
    where_clause = f" WHERE {where_sql}" if where_sql else ""
    try:
        # STDEV (SQL Server) vs STDDEV (ANSI/Snowflake/Databricks/Postgres) is a
        # genuine function-name difference, not a quoting issue — kept as a
        # real two-attempt fallback, both now quoted correctly per platform.
        result = connector.query(
            f"SELECT MIN({q}), MAX({q}), AVG(CAST({q} AS FLOAT)), "
            f"STDEV(CAST({q} AS FLOAT)) FROM {tref}{where_clause}"
        )
    except Exception:
        try:
            result = connector.query(
                f'SELECT MIN({q}), MAX({q}), AVG(CAST({q} AS FLOAT)), '
                f'STDDEV(CAST({q} AS FLOAT)) FROM {tref}{where_clause}'
            )
        except Exception as e:
            logger.warning("get_numeric_stats failed for %s.%s.%s: %s", schema, table, col, e)
            return {}

    if not result.rows:
        return {}
    row = result.rows[0]
    return {
        "min": row[0], "max": row[1],
        "mean": round(float(row[2]), 4) if row[2] is not None else None,
        "std_dev": round(float(row[3]), 4) if row[3] is not None else None,
    }


def get_sample_rows(connector: BaseConnector, schema: str, table: str, where_sql: str, limit: int = 10,
                     window_where: str | None = None) -> list[dict]:
    """Fetch a small sample of ACTUAL rows matching a WHERE condition — the
    'show me the 12%' companion to a risk that otherwise only states a
    percentage. where_sql must reference only quoted column names this module
    already trusts (built via connector.quote_ident on real column names from
    describe_table, never from free-text user input).

    window_where: optional partition-window bound (see get_column_null_stats)
    ANDed in alongside where_sql, so samples for a windowed run only ever come
    from inside that window."""
    tref = connector.table_ref(schema, table)
    full_where = f"({where_sql}) AND ({window_where})" if window_where else where_sql
    try:
        result = connector.query(f"SELECT TOP {limit} * FROM {tref} WHERE {full_where}")
    except Exception:
        try:
            result = connector.query(f"SELECT * FROM {tref} WHERE {full_where} LIMIT {limit}")
        except Exception as e:
            logger.warning("get_sample_rows failed for %s.%s WHERE %s: %s", schema, table, full_where, e)
            return []
    return [dict(zip(result.columns, row)) for row in result.rows[:limit]]


def detect_key_duplicates(connector: BaseConnector, schema: str, table: str, candidate_columns: list[str],
                          where_sql: str | None = None) -> dict | None:
    """Duplicate detection on a CANDIDATE KEY column, not the whole row — the
    gap flagged in detect_duplicates()'s docstring (see profiling_agent.py):
    two rows sharing an order_id but differing in one timestamp are real
    duplicates that a whole-row DISTINCT check will never see.

    candidate_columns should already be pre-filtered by the caller to
    high-cardinality columns (this function doesn't re-derive that ranking).
    Returns the single column with the WORST duplication, or None if none of
    the candidates show any — never fabricates a finding.
    """
    tref = connector.table_ref(schema, table)
    window = f" AND ({where_sql})" if where_sql else ""
    best = None
    for col in candidate_columns:
        q = connector.quote_ident(col)
        try:
            group_result = connector.query(f"""
                SELECT COUNT(*) FROM (
                    SELECT {q} FROM {tref} WHERE {q} IS NOT NULL{window} GROUP BY {q} HAVING COUNT(*) > 1
                ) dup_groups
            """)
            group_count = int(group_result.rows[0][0]) if group_result.rows and group_result.rows[0][0] is not None else 0
            if group_count == 0:
                continue
            row_result = connector.query(f"""
                SELECT SUM(cnt) FROM (
                    SELECT COUNT(*) AS cnt FROM {tref} WHERE {q} IS NOT NULL{window} GROUP BY {q} HAVING COUNT(*) > 1
                ) dup_rows
            """)
            row_count = int(row_result.rows[0][0]) if row_result.rows and row_result.rows[0][0] is not None else 0
            if row_count == 0:
                continue
            if best is not None and row_count <= best["duplicate_row_count"]:
                continue
            try:
                sample_result = connector.query(f"""
                    SELECT TOP 5 {q} FROM {tref} WHERE {q} IS NOT NULL{window}
                    GROUP BY {q} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC
                """)
            except Exception:
                try:
                    sample_result = connector.query(f"""
                        SELECT {q} FROM {tref} WHERE {q} IS NOT NULL{window}
                        GROUP BY {q} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT 5
                    """)
                except Exception:
                    sample_result = None
            samples = [row[0] for row in sample_result.rows[:5]] if sample_result else []
            best = {"column": col, "duplicate_group_count": group_count,
                    "duplicate_row_count": row_count, "sample_key_values": samples}
        except Exception as e:
            logger.warning("detect_key_duplicates failed for %s.%s.%s: %s", schema, table, col, e)
            continue
    return best


def check_orphans(connector: BaseConnector, child_schema: str, child_table: str, child_col: str,
                  parent_schema: str, parent_table: str, parent_col: str,
                  child_window_sql: str | None = None) -> dict | None:
    """Count rows in the child table whose FK-like column has no matching row
    in the parent table. Both sides are explicitly aliased and every column
    qualified — an unaliased correlated NOT EXISTS is exactly the tautology
    bug already fixed once in execution_agent.py's rule executor; the same
    care applies here.

    child_window_sql: optional partition-window bound applied to the CHILD
    side only — the parent table is always checked in full, since a windowed
    scan should still ask "does this recent row have any matching parent
    anywhere", not "...within the same window", which would flag rows as
    orphaned just because their parent was inserted before the window."""
    child_tref = connector.table_ref(child_schema, child_table)
    parent_tref = connector.table_ref(parent_schema, parent_table)
    cq = connector.quote_ident(child_col)
    pq = connector.quote_ident(parent_col)
    window = f" AND ({child_window_sql})" if child_window_sql else ""
    try:
        result = connector.query(f"""
            SELECT COUNT(*) FROM {child_tref} AS c
            WHERE c.{cq} IS NOT NULL{window}
              AND NOT EXISTS (SELECT 1 FROM {parent_tref} AS p WHERE p.{pq} = c.{cq})
        """)
        orphan_count = int(result.rows[0][0]) if result.rows and result.rows[0][0] is not None else 0
        if orphan_count == 0:
            return {"orphan_count": 0, "sample_values": []}
        try:
            sample_result = connector.query(f"""
                SELECT TOP 5 c.{cq} FROM {child_tref} AS c
                WHERE c.{cq} IS NOT NULL{window}
                  AND NOT EXISTS (SELECT 1 FROM {parent_tref} AS p WHERE p.{pq} = c.{cq})
            """)
        except Exception:
            try:
                sample_result = connector.query(f"""
                    SELECT c.{cq} FROM {child_tref} AS c
                    WHERE c.{cq} IS NOT NULL{window}
                      AND NOT EXISTS (SELECT 1 FROM {parent_tref} AS p WHERE p.{pq} = c.{cq})
                    LIMIT 5
                """)
            except Exception:
                sample_result = None
        samples = [row[0] for row in sample_result.rows[:5]] if sample_result else []
        return {"orphan_count": orphan_count, "sample_values": samples}
    except Exception as e:
        logger.warning("check_orphans failed for %s.%s.%s -> %s.%s.%s: %s",
                       child_schema, child_table, child_col, parent_schema, parent_table, parent_col, e)
        return None


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
