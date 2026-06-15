"""Databricks SQL connector — supports Personal Access Token and OAuth M2M."""
import logging
from app.connectors.base import BaseConnector, TableSchema, QueryResult

logger = logging.getLogger(__name__)
_LAYER_MAP = {"raw": "RAW", "bronze": "BRONZE", "silver": "SILVER", "gold": "GOLD"}


class DatabricksConnector(BaseConnector):
    """
    Config keys:
        host        Databricks workspace host, e.g. "adb-12345.azuredatabricks.net"
        http_path   SQL warehouse HTTP path, e.g. "/sql/1.0/warehouses/abc123"
        catalog     Unity Catalog name (optional)
        database    Schema/database name
        auth_type   "pat" | "oauth"
        token       Personal Access Token (auth_type=pat)
    """

    def __init__(self, config: dict):
        self._config = config
        self._conn = None

    def _connect(self):
        if self._conn:
            return self._conn
        try:
            from databricks import sql as dbsql
        except ImportError:
            raise ImportError("databricks-sql-connector is required for Databricks connections")

        cfg = self._config
        self._conn = dbsql.connect(
            server_hostname=cfg["host"],
            http_path=cfg["http_path"],
            access_token=cfg.get("token", ""),
            catalog=cfg.get("catalog", ""),
            schema=cfg.get("database", ""),
        )
        return self._conn

    def test(self) -> bool:
        try:
            with self._connect().cursor() as cur:
                cur.execute("SELECT 1")
            return True
        except Exception as e:
            logger.error("Databricks test failed: %s", e)
            return False

    def list_schemas(self) -> list[str]:
        result = self.query("SHOW SCHEMAS")
        return [r[0] for r in result.rows]

    def list_tables(self, schema: str) -> list[TableSchema]:
        result = self.query(f"SHOW TABLES IN {schema}")
        return [TableSchema(schema_name=schema, table_name=r[1],
                            layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"))
                for r in result.rows]

    def describe_table(self, schema: str, table: str) -> TableSchema:
        result = self.query(f"DESCRIBE {schema}.{table}")
        columns = [{"name": r[0], "type": r[1], "nullable": True} for r in result.rows if r[0]]
        count = int(self.query_scalar(f"SELECT COUNT(*) FROM {schema}.{table}") or 0)
        return TableSchema(schema_name=schema, table_name=table,
                           layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"),
                           row_count=count, columns=columns)

    def query(self, sql: str, params: dict | None = None) -> QueryResult:
        conn = self._connect()
        with conn.cursor() as cur:
            cur.execute(sql)
            if cur.description is None:
                return QueryResult(columns=[], rows=[], row_count=0)
            cols = [d[0] for d in cur.description]
            rows = [list(r) for r in cur.fetchall()]
        return QueryResult(columns=cols, rows=rows, row_count=len(rows))

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None
