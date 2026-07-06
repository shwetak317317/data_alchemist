"""
Abstract base class for all data platform connectors.
Every connector must implement these methods so agents can query any platform.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TableSchema:
    schema_name: str
    table_name: str
    layer: str            # RAW / BRONZE / SILVER / GOLD / UNKNOWN
    row_count: int = 0
    columns: list[dict] = field(default_factory=list)   # [{name, type, nullable}]


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[list[Any]]
    row_count: int


@dataclass
class ForeignKeyRef:
    """A declared FK constraint, direction-normalized for lineage: source = the
    referenced/parent table (upstream — the data other tables depend on), target =
    the table holding the FK column (downstream — breaks if source data is wrong)."""
    constraint_name: str
    source_schema: str
    source_table: str
    source_columns: list[str]
    target_schema: str
    target_table: str
    target_columns: list[str]


@dataclass
class QueryLogEntry:
    query_text: str
    executed_at: str | None = None   # ISO string, best-effort — platforms vary in precision
    execution_count: int = 1
    # Database the statement executed in (cross-DB SQL Server Query Store) — lets
    # the lineage parser resolve unqualified 'dbo.table' references to the right
    # database. None when the source is server-wide (plan cache) or single-DB.
    database: str | None = None


# ── Permission-error surfacing (shared by every feature that queries the
#    customer's database) ────────────────────────────────────────────────────
# The product contract: a permission denial must NEVER surface as a raw driver
# string or be silently swallowed into an empty result — it must say what was
# denied and give the exact GRANT statement to hand to a DBA.

_PERMISSION_MARKERS = (
    "permission was denied",
    "permission denied",
    "does not have permission",
    "access denied",
    "access is denied",
    "insufficient privileges",   # snowflake / databricks phrasing
    "not authorized",            # snowflake phrasing
)


def is_permission_error(exc: Exception | str) -> bool:
    low = str(exc).lower()
    return any(m in low for m in _PERMISSION_MARKERS)


_GRANT_TEMPLATES = {
    # action -> platform -> template ({obj} = object name, {login} = login/user)
    "select": {
        "sqlserver": "GRANT SELECT ON {obj} TO [{login}];",
        "postgres": "GRANT SELECT ON {obj} TO {login};",
        "snowflake": "GRANT SELECT ON TABLE {obj} TO ROLE <role_of_{login}>;",
        "databricks": "GRANT SELECT ON TABLE {obj} TO `{login}`;",
    },
    "metadata": {
        "sqlserver": "GRANT VIEW DEFINITION ON DATABASE::[{obj}] TO [{login}];",
        "postgres": "GRANT USAGE ON SCHEMA {obj} TO {login};",
        "snowflake": "GRANT USAGE ON SCHEMA {obj} TO ROLE <role_of_{login}>;",
        "databricks": "GRANT USE SCHEMA ON SCHEMA {obj} TO `{login}`;",
    },
}


def permission_denied_message(action: str, obj: str | None, login: str | None,
                              platform: str = "sqlserver") -> str:
    """Actionable message for a denied database permission: names what was
    denied and the exact statement a DBA should run. Falls back to a generic
    but still directive sentence for platforms without a template."""
    login = login or "<login>"
    obj_display = obj or "<object>"
    verbs = {"select": "read", "metadata": "read the schema catalog of"}
    template = _GRANT_TEMPLATES.get(action, {}).get(platform)
    grant = template.format(obj=obj_display, login=login) if template else \
        f"grant the '{action}' privilege on {obj_display} to {login}"
    return (
        f"Permission denied: the connection's login '{login}' cannot {verbs.get(action, action)} "
        f"{obj_display}. Ask a DBA to run: {grant}"
    )


class BaseConnector(ABC):
    """
    Pluggable connector interface.
    All connectors expose the same surface so agents are platform-agnostic.
    """

    @abstractmethod
    def test(self) -> bool:
        """Return True if the connection is healthy (SELECT 1 equivalent)."""

    @abstractmethod
    def list_schemas(self) -> list[str]:
        """Return all schema/database names visible to this connection."""

    @abstractmethod
    def list_tables(self, schema: str) -> list[TableSchema]:
        """Return all tables in the given schema with basic metadata."""

    @abstractmethod
    def describe_table(self, schema: str, table: str) -> TableSchema:
        """Return column-level metadata for a single table."""

    @abstractmethod
    def query(self, sql: str, params: dict | None = None) -> QueryResult:
        """Execute a SQL query and return structured results."""

    def query_scalar(self, sql: str) -> Any:
        """Convenience: run a query and return the first cell."""
        result = self.query(sql)
        if result.rows:
            return result.rows[0][0]
        return None

    # ── Lineage discovery (optional capabilities) ──────────────────────────────
    # Defaults are "unsupported" so every connector works out of the box; override
    # only where a platform genuinely exposes this metadata. Callers MUST check
    # supports_query_log() rather than inferring support from an empty list, so a
    # real "no matches" result is never confused with "this platform isn't wired up".

    def list_foreign_keys(self, schema: str) -> list["ForeignKeyRef"]:
        """Return declared FK constraints within the given schema/database.
        Default: unsupported — returns []. Override per connector."""
        return []

    def supports_query_log(self) -> bool:
        """Whether list_recent_queries() is actually implemented for this connector."""
        return False

    def list_recent_queries(self, since_hours: int = 168, limit: int = 500) -> list["QueryLogEntry"]:
        """Return recent executed query text, for SQL-parsed lineage discovery.
        Default: unsupported — returns []. Check supports_query_log() first."""
        return []

    def table_ref(self, schema: str, table: str) -> str:
        """Return a SQL-safe fully-qualified table reference for use in FROM clauses.
        Override in connectors that use non-ANSI quoting or cross-database naming."""
        return f'"{schema}"."{table}"'

    def close(self) -> None:
        """Release connection resources. Override if needed."""
