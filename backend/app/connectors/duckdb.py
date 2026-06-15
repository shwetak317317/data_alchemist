"""DuckDB connector — file-based or in-memory. Useful for local dev."""
import logging
from app.connectors.base import BaseConnector, TableSchema, QueryResult

logger = logging.getLogger(__name__)
_LAYER_MAP = {"raw": "RAW", "bronze": "BRONZE", "silver": "SILVER", "gold": "GOLD"}


class DuckDBConnector(BaseConnector):
    """
    Config keys:
        file_path   path to .duckdb file, or ":memory:" for in-memory
    """

    def __init__(self, config: dict):
        self._config = config
        self._conn = None

    def _connect(self):
        if self._conn is None:
            try:
                import duckdb
            except ImportError:
                raise ImportError("duckdb package is required for DuckDB connections")
            self._conn = duckdb.connect(self._config.get("file_path", ":memory:"))
        return self._conn

    def test(self) -> bool:
        try:
            self._connect().execute("SELECT 1").fetchone()
            return True
        except Exception as e:
            logger.error("DuckDB test failed: %s", e)
            return False

    def list_schemas(self) -> list[str]:
        rows = self._connect().execute("SELECT schema_name FROM information_schema.schemata").fetchall()
        return [r[0] for r in rows]

    def list_tables(self, schema: str) -> list[TableSchema]:
        rows = self._connect().execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema=? AND table_type='BASE TABLE'", [schema]
        ).fetchall()
        return [TableSchema(schema_name=schema, table_name=r[0],
                            layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"))
                for r in rows]

    def describe_table(self, schema: str, table: str) -> TableSchema:
        rows = self._connect().execute(f"DESCRIBE {schema}.{table}").fetchall()
        columns = [{"name": r[0], "type": r[1], "nullable": r[2] == "YES"} for r in rows]
        count = int(self._connect().execute(f"SELECT COUNT(*) FROM {schema}.{table}").fetchone()[0])
        return TableSchema(schema_name=schema, table_name=table,
                           layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"),
                           row_count=count, columns=columns)

    def query(self, sql: str, params: dict | None = None) -> QueryResult:
        conn = self._connect()
        result = conn.execute(sql, list(params.values()) if params else [])
        if result.description is None:
            return QueryResult(columns=[], rows=[], row_count=0)
        cols = [d[0] for d in result.description]
        rows = [list(r) for r in result.fetchall()]
        return QueryResult(columns=cols, rows=rows, row_count=len(rows))

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None
