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

    def close(self) -> None:
        """Release connection resources. Override if needed."""
