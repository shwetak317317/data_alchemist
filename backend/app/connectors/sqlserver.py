"""
SQL Server connector — supports SQL Server Auth, Windows Auth, and Azure AD.
Uses pyodbc with the Microsoft ODBC Driver 18 for SQL Server.
"""
import logging
import pyodbc
from app.connectors.base import BaseConnector, TableSchema, QueryResult

logger = logging.getLogger(__name__)

# Layer detection by schema name convention
_LAYER_MAP = {
    "raw": "RAW",
    "bronze": "BRONZE",
    "silver": "SILVER",
    "gold": "GOLD",
    "dq_metadata": "METADATA",
}


def _detect_layer(schema: str) -> str:
    return _LAYER_MAP.get(schema.lower(), "UNKNOWN")


class SqlServerConnector(BaseConnector):
    """
    Config keys:
        host          (str)  server name or IP, e.g. "myserver" or "192.168.1.10"
        port          (int)  default 1433
        database      (str)  database name
        auth_type     (str)  "sql" | "windows" | "azure_ad"
        username      (str)  login name (sql / azure_ad auth)
        password      (str)  password (sql / azure_ad auth)
        instance      (str)  named instance, e.g. "SQLEXPRESS" (optional)
        trust_cert    (bool) TrustServerCertificate (default True for dev)
        encrypt       (bool) Encrypt (default True)
    """

    def __init__(self, config: dict):
        self._config = config
        self._conn: pyodbc.Connection | None = None

    def _build_connection_string(self) -> str:
        cfg = self._config
        host = cfg.get("host", cfg.get("server", ""))
        if not host:
            raise ValueError("'host' (server name) is required for SQL Server connections")
        port = cfg.get("port", 1433)
        instance = cfg.get("instance", "")
        database = (cfg.get("database") or "").strip()
        auth_type = cfg.get("auth_type", "sql").lower()
        trust = "Yes" if cfg.get("trust_cert", True) else "No"
        encrypt = "Yes" if cfg.get("encrypt", True) else "No"

        # Named instance takes priority over port for addressing
        server = f"{host}\\{instance}" if instance else f"{host},{port}"

        base = (
            f"DRIVER={{ODBC Driver 18 for SQL Server}};"
            f"SERVER={server};"
            f"TrustServerCertificate={trust};"
            f"Encrypt={encrypt};"
        )
        # DATABASE is optional — omitting it connects to the login's default database
        if database:
            base += f"DATABASE={database};"

        if auth_type == "windows":
            return base + "Trusted_Connection=Yes;"
        elif auth_type == "azure_ad":
            username = cfg["username"]
            password = cfg["password"]
            return base + (
                f"UID={username};PWD={password};"
                "Authentication=ActiveDirectoryPassword;"
            )
        else:  # sql
            username = cfg["username"]
            password = cfg["password"]
            return base + f"UID={username};PWD={password};"

    def _connect(self) -> pyodbc.Connection:
        if self._conn is None or self._conn.closed:
            conn_str = self._build_connection_string()
            self._conn = pyodbc.connect(conn_str, timeout=15)
        return self._conn

    def test(self) -> bool:
        """Connect and run SELECT 1. Raises on failure so callers get the real error."""
        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        return True

    def list_schemas(self) -> list[str]:
        result = self.query(
            "SELECT DISTINCT TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES "
            "ORDER BY TABLE_SCHEMA"
        )
        return [row[0] for row in result.rows]

    def list_tables(self, schema: str) -> list[TableSchema]:
        result = self.query(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' "
            "ORDER BY TABLE_NAME",
            {"schema": schema},
        )
        tables = []
        for (table_name,) in result.rows:
            tables.append(TableSchema(
                schema_name=schema,
                table_name=table_name,
                layer=_detect_layer(schema),
            ))
        return tables

    def describe_table(self, schema: str, table: str) -> TableSchema:
        result = self.query(
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
            "FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
            "ORDER BY ORDINAL_POSITION",
            {"schema": schema, "table": table},
        )
        # Approximate row count
        try:
            count_sql = f"SELECT COUNT(*) FROM [{schema}].[{table}]"
            row_count = int(self.query_scalar(count_sql) or 0)
        except Exception:
            row_count = 0

        columns = [
            {
                "name": row[0],
                "type": row[1],
                "nullable": row[2] == "YES",
            }
            for row in result.rows
        ]
        return TableSchema(
            schema_name=schema,
            table_name=table,
            layer=_detect_layer(schema),
            row_count=row_count,
            columns=columns,
        )

    def query(self, sql: str, params: dict | None = None) -> QueryResult:
        conn = self._connect()
        cursor = conn.cursor()
        try:
            if params:
                # pyodbc uses positional ? placeholders
                values = list(params.values())
                cursor.execute(sql, values)
            else:
                cursor.execute(sql)

            if cursor.description is None:
                return QueryResult(columns=[], rows=[], row_count=0)

            columns = [desc[0] for desc in cursor.description]
            rows = [list(row) for row in cursor.fetchall()]
            return QueryResult(columns=columns, rows=rows, row_count=len(rows))
        except Exception:
            conn.rollback()
            raise

    def close(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()
            self._conn = None
