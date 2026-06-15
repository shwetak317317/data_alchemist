"""
Snowflake connector — supports password, key pair, and OAuth authentication.
"""
import logging
from app.connectors.base import BaseConnector, TableSchema, QueryResult

logger = logging.getLogger(__name__)

_LAYER_MAP = {"raw": "RAW", "bronze": "BRONZE", "silver": "SILVER", "gold": "GOLD"}


class SnowflakeConnector(BaseConnector):
    """
    Config keys:
        account     Snowflake account identifier, e.g. "myorg-myaccount"
        user        Login name
        warehouse   Virtual warehouse name
        database    Database name
        role        Role to use (optional)
        auth_type   "password" | "keypair" | "oauth"
        password    (auth_type=password)
        private_key_path  (auth_type=keypair) path to PEM file
        token       (auth_type=oauth) OAuth access token
    """

    def __init__(self, config: dict):
        self._config = config
        self._conn = None

    def _connect(self):
        if self._conn:
            return self._conn
        try:
            import snowflake.connector
        except ImportError:
            raise ImportError("snowflake-connector-python is required for Snowflake connections")

        cfg = self._config
        kwargs = {
            "account": cfg["account"],
            "user": cfg["user"],
            "warehouse": cfg.get("warehouse", ""),
            "database": cfg.get("database", ""),
            "role": cfg.get("role", ""),
        }

        auth_type = cfg.get("auth_type", "password")
        if auth_type == "keypair":
            from cryptography.hazmat.primitives.serialization import load_pem_private_key
            with open(cfg["private_key_path"], "rb") as f:
                private_key = load_pem_private_key(f.read(), password=None)
            kwargs["private_key"] = private_key
        elif auth_type == "oauth":
            kwargs["token"] = cfg["token"]
            kwargs["authenticator"] = "oauth"
        else:
            kwargs["password"] = cfg["password"]

        self._conn = snowflake.connector.connect(**kwargs)
        return self._conn

    def test(self) -> bool:
        try:
            self._connect().cursor().execute("SELECT 1")
            return True
        except Exception as e:
            logger.error("Snowflake test failed: %s", e)
            return False

    def list_schemas(self) -> list[str]:
        result = self.query("SHOW SCHEMAS")
        return [row[1] for row in result.rows] if result.rows else []

    def list_tables(self, schema: str) -> list[TableSchema]:
        result = self.query(f"SHOW TABLES IN SCHEMA {schema}")
        return [
            TableSchema(
                schema_name=schema,
                table_name=row[1],
                layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"),
            )
            for row in result.rows
        ]

    def describe_table(self, schema: str, table: str) -> TableSchema:
        result = self.query(f"DESCRIBE TABLE {schema}.{table}")
        columns = [{"name": r[0], "type": r[1], "nullable": r[3] == "Y"} for r in result.rows]
        count = int(self.query_scalar(f"SELECT COUNT(*) FROM {schema}.{table}") or 0)
        return TableSchema(schema_name=schema, table_name=table,
                           layer=_LAYER_MAP.get(schema.lower(), "UNKNOWN"),
                           row_count=count, columns=columns)

    def query(self, sql: str, params: dict | None = None) -> QueryResult:
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute(sql, list(params.values()) if params else None)
        if cursor.description is None:
            return QueryResult(columns=[], rows=[], row_count=0)
        cols = [d[0] for d in cursor.description]
        rows = [list(r) for r in cursor.fetchall()]
        return QueryResult(columns=cols, rows=rows, row_count=len(rows))

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None
