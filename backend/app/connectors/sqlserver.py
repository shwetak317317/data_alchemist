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
from app.connectors.base import BaseConnector, TableSchema, QueryResult, ForeignKeyRef, QueryLogEntry

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
                from app.connectors.base import is_permission_error, permission_denied_message
                if is_permission_error(e):
                    raise PermissionError(permission_denied_message(
                        "metadata", schema, self._config.get("username"))) from e
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

        Each identifier segment is bracket-escaped (`]` → `]]`) per SQL Server's
        quoted-identifier rules — without this, a table_fqn containing `]` can
        break out of the bracket quoting and inject SQL into the rule-execution
        queries built in execution_agent.py.
        """
        esc = lambda s: s.replace("]", "]]")
        if self._is_cross_db():
            db_schema, tname = _split_table(table)
            return f"[{esc(schema)}].[{esc(db_schema)}].[{esc(tname)}]"
        return f"[{esc(schema)}].[{esc(table)}]"

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

    def _encode_table_name(self, db_schema: str, table_name: str) -> str:
        """Match list_tables' encoding: dbo tables are bare, others get 'schema.table'."""
        return table_name if db_schema == "dbo" else f"{db_schema}.{table_name}"

    def list_foreign_keys(self, schema: str) -> list[ForeignKeyRef]:
        """Declared FK constraints. SQL Server FKs cannot cross databases, so in
        cross-DB mode this only ever finds relationships within the single
        database named by `schema` — it will not surface Bronze→Silver→Gold
        style cross-database pipelines (those have no FK to discover; that's
        what query-log discovery is for)."""
        db_prefix = f"[{schema}]." if self._is_cross_db() else ""
        schema_filter = "" if self._is_cross_db() else "WHERE sch1.name = ?"
        sql = f"""
            SELECT fk.name,
                   sch1.name, tab1.name, col1.name,
                   sch2.name, tab2.name, col2.name
            FROM {db_prefix}sys.foreign_keys fk
            JOIN {db_prefix}sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
            JOIN {db_prefix}sys.tables tab1 ON tab1.object_id = fkc.parent_object_id
            JOIN {db_prefix}sys.schemas sch1 ON sch1.schema_id = tab1.schema_id
            JOIN {db_prefix}sys.columns col1 ON col1.object_id = fkc.parent_object_id
                AND col1.column_id = fkc.parent_column_id
            JOIN {db_prefix}sys.tables tab2 ON tab2.object_id = fkc.referenced_object_id
            JOIN {db_prefix}sys.schemas sch2 ON sch2.schema_id = tab2.schema_id
            JOIN {db_prefix}sys.columns col2 ON col2.object_id = fkc.referenced_object_id
                AND col2.column_id = fkc.referenced_column_id
            {schema_filter}
            ORDER BY fk.name, col1.column_id
        """
        try:
            result = self.query(sql, None if self._is_cross_db() else {"schema": schema})
        except Exception as e:
            logger.warning("list_foreign_keys schema=%s: %s", schema, e)
            from app.connectors.base import is_permission_error, permission_denied_message
            if is_permission_error(e):
                # Surface, don't swallow: "0 FK edges" because the catalog is
                # unreadable needs a GRANT, not a shrug (product-wide contract).
                raise PermissionError(permission_denied_message(
                    "metadata", schema, self._config.get("username"))) from e
            return []

        # holder = table that HAS the FK column (sys.fk_columns "parent"); referenced =
        # the looked-up table. Lineage direction: referenced (upstream truth) -> holder
        # (breaks if referenced data is wrong) — the inverse of FK "parent/child" naming.
        grouped: dict[str, ForeignKeyRef] = {}
        for fk_name, holder_schema, holder_table, holder_col, ref_schema, ref_table, ref_col in result.rows:
            if fk_name not in grouped:
                grouped[fk_name] = ForeignKeyRef(
                    constraint_name=fk_name,
                    source_schema=schema if self._is_cross_db() else ref_schema,
                    source_table=self._encode_table_name(ref_schema, ref_table),
                    source_columns=[],
                    target_schema=schema if self._is_cross_db() else holder_schema,
                    target_table=self._encode_table_name(holder_schema, holder_table),
                    target_columns=[],
                )
            grouped[fk_name].source_columns.append(ref_col)
            grouped[fk_name].target_columns.append(holder_col)
        return list(grouped.values())

    def supports_query_log(self) -> bool:
        return True

    @staticmethod
    def _is_permission_error(exc: Exception) -> bool:
        # SQL Server phrases permission failures several ways depending on the
        # object: "VIEW SERVER PERFORMANCE STATE permission was denied" (DMVs),
        # "permission denied in database" (Query Store), and error 297 "The user
        # does not have permission to perform this action" (dm_exec_sql_text).
        low = str(exc).lower()
        return "permission" in low and ("denied" in low or "does not have permission" in low)

    def list_recent_queries(self, since_hours: int = 168, limit: int = 500) -> list[QueryLogEntry]:
        """Recent executed query text — plan cache first, Query Store fallback.

        Reads BOTH sources and merges them (deduped by statement text):
          - plan cache (sys.dm_exec_query_stats) — needs server-wide VIEW SERVER
            STATE; volatile, evaporates on restart/memory pressure (seen live: a
            server holding exactly 1 cached stat while Query Store held the real
            ETL history).
          - Query Store (sys.query_store_*) — per-database, persistent, needs only
            VIEW DATABASE PERFORMANCE STATE (a grant DBAs hand out far more
            readily), ON by default from SQL Server 2022.
        A permission error on one source is fine as long as the other works; only
        when BOTH are denied does this raise a PermissionError naming the exact
        grants to request. Non-permission errors propagate untouched.

        Deliberately lets that error PROPAGATE rather than swallowing it into an
        empty list: the caller reports the real reason in
        query_log_unsupported_reason, so "0 results because nothing matched" is
        never confused with "0 results because the grant is missing".
        """
        entries: list[QueryLogEntry] = []
        denied: list[Exception] = []
        for source in (self._recent_queries_from_plan_cache, self._recent_queries_from_query_store):
            try:
                entries.extend(source(since_hours, limit))
            except Exception as exc:
                if not self._is_permission_error(exc):
                    raise
                logger.info("query-history source %s denied: %s", source.__name__, exc)
                denied.append(exc)
        if len(denied) == 2:
            raise PermissionError(
                "the connection's SQL login can read neither the plan cache nor Query Store. "
                "Ask a DBA for one of: GRANT VIEW SERVER STATE TO [<login>]; "
                "or, per database: GRANT VIEW DATABASE PERFORMANCE STATE TO [<user>];"
            ) from denied[-1]
        # Dedupe by normalized statement text — the same ETL statement often
        # appears in both sources; keep the copy with the higher execution count.
        best: dict[str, QueryLogEntry] = {}
        for e in entries:
            key = " ".join(e.query_text.split()).lower()
            if key not in best or (e.execution_count or 0) > (best[key].execution_count or 0):
                best[key] = e
        merged = sorted(best.values(), key=lambda e: e.executed_at or "", reverse=True)
        return merged[:limit]

    def _recent_queries_from_plan_cache(self, since_hours: int, limit: int) -> list[QueryLogEntry]:
        sql = f"""
            SELECT TOP ({int(limit)})
                st.text,
                qs.last_execution_time,
                qs.execution_count
            FROM sys.dm_exec_query_stats qs
            CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
            WHERE qs.last_execution_time >= DATEADD(HOUR, ?, SYSDATETIME())
              AND st.text IS NOT NULL
              AND (
                    st.text LIKE '%INSERT%INTO%' OR
                    st.text LIKE '%MERGE%' OR
                    st.text LIKE '%SELECT%INTO%' OR
                    st.text LIKE '%CREATE TABLE%AS%'
                  )
            ORDER BY qs.last_execution_time DESC
        """
        result = self.query(sql, {"since_hours": -abs(int(since_hours))})

        return [
            QueryLogEntry(
                query_text=row[0],
                executed_at=row[1].isoformat() if row[1] else None,
                execution_count=int(row[2] or 1),
            )
            for row in result.rows if row[0]
        ]

    def _recent_queries_from_query_store(self, since_hours: int, limit: int) -> list[QueryLogEntry]:
        """Query Store fallback — per-database, so in cross-DB mode every in-scope
        database is read and the results merged. A database with Query Store OFF
        contributes nothing (its query_store_* views are empty), which is fine;
        a permission error propagates to the caller's fallback logic."""
        databases = self.list_schemas() if self._is_cross_db() else [None]
        entries: list[QueryLogEntry] = []
        denied_dbs: list[str] = []
        for dbname in databases:
            prefix = f"[{dbname.replace(']', ']]')}]." if dbname else ""
            # last_execution_time in Query Store is DATETIMEOFFSET — ODBC type -155,
            # which pyodbc cannot convert (seen live: "ODBC SQL type -155 is not yet
            # supported"). CAST to DATETIME2 at the server. The window comparison
            # uses SYSDATETIMEOFFSET() so both sides stay timezone-aware.
            sql = f"""
                SELECT TOP ({int(limit)})
                    qt.query_sql_text,
                    CAST(rs.last_execution_time AS DATETIME2) AS last_execution_time,
                    rs.total_count
                FROM {prefix}sys.query_store_query_text qt
                JOIN {prefix}sys.query_store_query q ON q.query_text_id = qt.query_text_id
                JOIN {prefix}sys.query_store_plan p ON p.query_id = q.query_id
                JOIN (
                    SELECT plan_id, MAX(last_execution_time) AS last_execution_time,
                           SUM(count_executions) AS total_count
                    FROM {prefix}sys.query_store_runtime_stats
                    GROUP BY plan_id
                ) rs ON rs.plan_id = p.plan_id
                WHERE rs.last_execution_time >= DATEADD(HOUR, ?, SYSDATETIMEOFFSET())
                  AND qt.query_sql_text IS NOT NULL
                  AND (
                        qt.query_sql_text LIKE '%INSERT%INTO%' OR
                        qt.query_sql_text LIKE '%MERGE%' OR
                        qt.query_sql_text LIKE '%SELECT%INTO%' OR
                        qt.query_sql_text LIKE '%CREATE TABLE%AS%'
                      )
                ORDER BY rs.last_execution_time DESC
            """
            # Per-database permission handling: DBAs often grant VIEW DATABASE
            # PERFORMANCE STATE only on the databases that matter (seen live: the
            # medallion DBs granted, the SourceDB_* databases not) — one denied
            # database must not throw away every readable database's history.
            try:
                result = self.query(sql, {"since_hours": -abs(int(since_hours))})
            except Exception as exc:
                if self._is_permission_error(exc):
                    logger.info("Query Store denied on database %s — skipping: %s", dbname, exc)
                    denied_dbs.append(dbname or "(current)")
                    continue
                raise
            entries.extend(
                QueryLogEntry(
                    query_text=row[0],
                    executed_at=row[1].isoformat() if row[1] else None,
                    execution_count=int(row[2] or 1),
                    database=dbname,
                )
                for row in result.rows if row[0]
            )
        if denied_dbs and len(denied_dbs) == len(databases):
            raise PermissionError(
                "Query Store read was denied on every in-scope database. Ask a DBA for, per database: "
                "GRANT VIEW DATABASE PERFORMANCE STATE TO [<user>];"
            )
        entries.sort(key=lambda e: e.executed_at or "", reverse=True)
        return entries[:limit]

    def close(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()
            self._conn = None
