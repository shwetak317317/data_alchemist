"""
Snowflake connector — supports password, key pair, and OAuth authentication.
"""
import logging
from app.connectors.base import BaseConnector, TableSchema, QueryResult, ForeignKeyRef

logger = logging.getLogger(__name__)

_LAYER_MAP = {"raw": "RAW", "bronze": "BRONZE", "silver": "SILVER", "gold": "GOLD"}


class SnowflakeConnector(BaseConnector):
    """
    Config keys:
        account     Snowflake account identifier, e.g. "myorg-myaccount"
        username    Login name (matches ConnectionCredentials.username / the
                    connection form field — NOT "user", despite that being the
                    keyword snowflake.connector.connect() itself takes)
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
        # Users routinely copy the full hostname straight from the Snowflake
        # login page (e.g. "org-account.snowflakecomputing.com") into the
        # account field, which only wants the identifier before that suffix.
        # Passing the full hostname makes the driver build a malformed URL
        # and fail with an opaque connection error. Strip it defensively so
        # both forms work.
        account = cfg["account"].strip()
        if account.lower().endswith(".snowflakecomputing.com"):
            account = account[: -len(".snowflakecomputing.com")]

        kwargs = {
            "account": account,
            # cfg key is "username" (matches ConnectionCredentials and the
            # connection form) — "user" is only the snowflake.connector.connect()
            # keyword on the other side of this call, not our own config key.
            "user": cfg["username"],
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

    def list_foreign_keys(self, schema: str) -> list[ForeignKeyRef]:
        """Declared FK constraints. Snowflake does not enforce FKs, but does let
        you declare and query them via SHOW IMPORTED KEYS — useful metadata even
        though the database itself never validates referential integrity."""
        if not schema.replace("_", "").isalnum():
            logger.warning("list_foreign_keys: refusing unsafe schema identifier %r", schema)
            return []
        try:
            result = self.query(f"SHOW IMPORTED KEYS IN SCHEMA {schema}")
        except Exception as e:
            logger.warning("list_foreign_keys schema=%s: %s", schema, e)
            return []

        grouped: dict[str, ForeignKeyRef] = {}
        for row in result.rows:
            # positional per Snowflake docs: pk_schema=2, pk_table=3, pk_col=4,
            # fk_schema=6, fk_table=7, fk_col=8, fk_name=12
            pk_schema, pk_table, pk_col = row[2], row[3], row[4]
            fk_schema, fk_table, fk_col = row[6], row[7], row[8]
            fk_name = row[12]
            if fk_name not in grouped:
                grouped[fk_name] = ForeignKeyRef(
                    constraint_name=fk_name,
                    source_schema=pk_schema, source_table=pk_table, source_columns=[],
                    target_schema=fk_schema, target_table=fk_table, target_columns=[],
                )
            grouped[fk_name].source_columns.append(pk_col)
            grouped[fk_name].target_columns.append(fk_col)
        return list(grouped.values())

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None
