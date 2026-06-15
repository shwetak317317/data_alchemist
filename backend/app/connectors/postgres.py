"""PostgreSQL connector via psycopg2."""
import logging
import psycopg2
import psycopg2.extras
from app.connectors.base import BaseConnector, TableSchema, QueryResult

logger = logging.getLogger(__name__)
_LAYER_MAP = {"raw": "RAW", "bronze": "BRONZE", "silver": "SILVER", "gold": "GOLD"}


class PostgresConnector(BaseConnector):
    """
    Config keys: host, port (5432), database, username, password
    """

    def __init__(self, config: dict):
        self._config = config
        self._conn = None

    def _connect(self):
        if self._conn is None or self._conn.closed:
            cfg = self._config
            self._conn = psycopg2.connect(
                host=cfg["host"],
                port=cfg.get("port", 5432),
                dbname=cfg["database"],
                user=cfg["username"],
                password=cfg["password"],
                connect_timeout=15,
            )
        return self._conn

    def test(self) -> bool:
        try:
            with self._connect().cursor() as cur:
                cur.execute("SELECT 1")
            return True
        except Exception as e:
            logger.error("Postgres test failed: %s", e)
            return False

    def list_schemas(self) -> list[str]:
        result = self.query(
            "SELECT schema_name FROM information_schema.schemata "
            "WHERE schema_name NOT IN ('pg_catalog','information_schema') ORDER BY 1"
        )
        return [r[0] for r in result.rows]

    def list_tables(self, schema: str) -> list[TableSchema]:
        result = self.query(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = %s AND table_type='BASE TABLE' ORDER BY 1",
            {"schema": schema},
        )
        return [TableSchema(schema_name=schema, table_name=r[0],
                            layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"))
                for r in result.rows]

    def describe_table(self, schema: str, table: str) -> TableSchema:
        result = self.query(
            "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
            "WHERE table_schema=%s AND table_name=%s ORDER BY ordinal_position",
            {"schema": schema, "table": table},
        )
        columns = [{"name": r[0], "type": r[1], "nullable": r[2] == "YES"} for r in result.rows]
        count = int(self.query_scalar(f'SELECT COUNT(*) FROM "{schema}"."{table}"') or 0)
        return TableSchema(schema_name=schema, table_name=table,
                           layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"),
                           row_count=count, columns=columns)

    def query(self, sql: str, params: dict | None = None) -> QueryResult:
        conn = self._connect()
        with conn.cursor() as cur:
            cur.execute(sql, list(params.values()) if params else None)
            if cur.description is None:
                return QueryResult(columns=[], rows=[], row_count=0)
            cols = [d[0] for d in cur.description]
            rows = [list(r) for r in cur.fetchall()]
        return QueryResult(columns=cols, rows=rows, row_count=len(rows))

    def close(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()
