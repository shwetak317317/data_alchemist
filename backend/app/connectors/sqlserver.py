"""
SQL Server connector — supports SQL Server Auth, Windows Auth, and Azure AD.
Uses pyodbc with the Microsoft ODBC Driver 18 for SQL Server.

Two operating modes:
  • With database configured  → schema param is a schema within that database
  • Without database (cross-DB) → schema param is a DATABASE name on the instance;
      uses three-part identifiers [db].[dbo].[table] for all queries
"""
import logging
import pyodbc
from app.connectors.base import BaseConnector, TableSchema, QueryResult

logger = logging.getLogger(__name__)

# Heuristic layer detection by schema/database name convention
_LAYER_MAP = {
    "raw": "RAW",
    "bronze": "BRONZE",
    "silver": "SILVER",
    "gold": "GOLD",
    "dq_metadata": "METADATA",
}

_SYSTEM_DBS = frozenset(["master", "tempdb", "model", "msdb"])
_SYSTEM_SCHEMAS = frozenset([
    "sys", "INFORMATION_SCHEMA", "guest",
    "db_owner", "db_accessadmin", "db_securityadmin", "db_ddladmin",
    "db_backupoperator", "db_datareader", "db_datawriter",
    "db_denydatareader", "db_denydatawriter",
])


def _detect_layer(schema: str) -> str:
    return _LAYER_MAP.get(schema.lower(), "UNKNOWN")


def _split_table(table: str) -> tuple[str, str]:
    """Split 'schema.table' → (schema, table). Defaults to ('dbo', table)."""
    if "." in table:
        parts = table.split(".", 1)
        return parts[0], parts[1]
    return "dbo", table


class SqlServerConnector(BaseConnector):
    """
    Config keys:
        host          (str)  server name or IP, e.g. "myserver" or "192.168.1.10"
        port          (int)  default 1433
        database      (str)  database name (OPTIONAL — omit for cross-DB instance mode)
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

    def _is_cross_db(self) -> bool:
        """True when no specific database is configured — cross-DB instance mode."""
        return not (self._config.get("database") or "").strip()

    def test(self) -> bool:
        """Connect and run SELECT 1. Raises on failure so callers get the real error."""
        import socket as _socket
        cfg = self._config
        raw_host = cfg.get("host", cfg.get("server", ""))
        port = int(cfg.get("port", 1433))
        instance = cfg.get("instance", "")

        # For named instances the port is assigned dynamically by SQL Server Browser
        # (UDP 1434 discovery) — skip TCP pre-check in that case.
        # For standard host,port connections do a fast socket probe so we fail in
        # < 3 s instead of waiting the full 15 s ODBC login timeout.
        has_instance = bool(instance) or ("\\" in raw_host)
        if not has_instance:
            host = raw_host.split(",")[0].strip()  # strip port suffix if user typed "host,1433"
            try:
                s = _socket.create_connection((host, port), timeout=3)
                s.close()
            except (_socket.timeout, ConnectionRefusedError, OSError) as exc:
                h = host.lower()
                if h in ("localhost", "127.0.0.1", "::1"):
                    raise ConnectionError(
                        f"Cannot reach {host}:{port}. "
                        "The backend runs inside Docker — use 'host.docker.internal' "
                        "instead of 'localhost' to connect to SQL Server on your Windows host."
                    )
                raise ConnectionError(
                    f"Cannot reach {host}:{port}. "
                    "Verify: (1) SQL Server service is running, "
                    "(2) TCP/IP is enabled in SQL Server Configuration Manager, "
                    f"(3) port {port} is allowed through the firewall. "
                    f"Detail: {exc}"
                )

        conn = self._connect()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        return True

    def list_schemas(self) -> list[str]:
        if self._is_cross_db():
            # No database configured → return user database names on the instance
            result = self.query(
                "SELECT name FROM sys.databases WHERE state_desc = 'ONLINE' ORDER BY name"
            )
            return [r[0] for r in result.rows if r[0] not in _SYSTEM_DBS]
        else:
            result = self.query("SELECT name FROM sys.schemas ORDER BY name")
            schemas = [r[0] for r in result.rows if r[0] not in _SYSTEM_SCHEMAS]
            return schemas if schemas else ["dbo"]

    def list_tables(self, schema: str) -> list[TableSchema]:
        if self._is_cross_db():
            # schema is a DATABASE name — query across it
            try:
                result = self.query(
                    f"SELECT TABLE_SCHEMA, TABLE_NAME "
                    f"FROM [{schema}].INFORMATION_SCHEMA.TABLES "
                    "WHERE TABLE_TYPE = 'BASE TABLE' "
                    "ORDER BY TABLE_SCHEMA, TABLE_NAME"
                )
            except Exception as e:
                logger.error("list_tables cross-db DB=%s: %s", schema, e, exc_info=True)
                return []
            tables = []
            for (db_schema, tname) in result.rows:
                # Encode non-dbo schema into table name as "schema.table"
                encoded = tname if db_schema == "dbo" else f"{db_schema}.{tname}"
                tables.append(TableSchema(
                    schema_name=schema,
                    table_name=encoded,
                    layer=_detect_layer(schema),
                ))
            return tables
        else:
            result = self.query(
                "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' "
                "ORDER BY TABLE_NAME",
                {"schema": schema},
            )
            return [
                TableSchema(schema_name=schema, table_name=row[0], layer=_detect_layer(schema))
                for row in result.rows
            ]

    def describe_table(self, schema: str, table: str) -> TableSchema:
        if self._is_cross_db():
            db_schema, tname = _split_table(table)
            try:
                result = self.query(
                    f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
                    f"FROM [{schema}].INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
                    "ORDER BY ORDINAL_POSITION",
                    {"schema": db_schema, "table": tname},
                )
            except Exception as e:
                logger.warning("describe_table cross-db DB=%s tbl=%s.%s: %s",
                               schema, db_schema, tname, e)
                result = type("_R", (), {"rows": []})()
        else:
            result = self.query(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE "
                "FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? "
                "ORDER BY ORDINAL_POSITION",
                {"schema": schema, "table": table},
            )
            tname = table

        try:
            row_count = int(self.query_scalar(f"SELECT COUNT(*) FROM {self.table_ref(schema, table)}") or 0)
        except Exception:
            row_count = 0

        columns = [
            {"name": row[0], "type": row[1], "nullable": row[2] == "YES"}
            for row in result.rows
        ]
        return TableSchema(
            schema_name=schema,
            table_name=tname,
            layer=_detect_layer(schema),
            row_count=row_count,
            columns=columns,
        )

    def table_ref(self, schema: str, table: str) -> str:
        """Return bracket-quoted SQL Server table reference.

        Cross-DB mode: schema=database name, table may be 'db_schema.table_name'
            → [database].[db_schema].[table_name]
        Single-DB mode: schema=schema within configured database
            → [schema].[table]
        """
        if self._is_cross_db():
            db_schema, tname = _split_table(table)
            return f"[{schema}].[{db_schema}].[{tname}]"
        return f"[{schema}].[{table}]"

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
