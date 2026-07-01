"""PostgreSQL connector via psycopg2."""
import logging
import psycopg2
import psycopg2.extras
from app.connectors.base import BaseConnector, TableSchema, QueryResult, ForeignKeyRef

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

    def list_foreign_keys(self, schema: str) -> list[ForeignKeyRef]:
        """Declared FK constraints within this schema, via information_schema
        (portable across Postgres versions — no pg_catalog internals needed)."""
        sql = """
            SELECT tc.constraint_name,
                   ccu.table_schema, ccu.table_name, ccu.column_name,
                   kcu.table_schema, kcu.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = %s
            ORDER BY tc.constraint_name, kcu.ordinal_position
        """
        try:
            result = self.query(sql, {"schema": schema})
        except Exception as e:
            logger.warning("list_foreign_keys schema=%s: %s", schema, e)
            return []

        # holder = table with the FK column (kcu); referenced = the looked-up table (ccu).
        # Lineage direction: referenced (upstream truth) -> holder (downstream, breaks if wrong).
        grouped: dict[str, ForeignKeyRef] = {}
        for name, ref_schema, ref_table, ref_col, holder_schema, holder_table, holder_col in result.rows:
            if name not in grouped:
                grouped[name] = ForeignKeyRef(
                    constraint_name=name,
                    source_schema=ref_schema, source_table=ref_table, source_columns=[],
                    target_schema=holder_schema, target_table=holder_table, target_columns=[],
                )
            grouped[name].source_columns.append(ref_col)
            grouped[name].target_columns.append(holder_col)
        return list(grouped.values())

    def close(self) -> None:
        if self._conn and not self._conn.closed:
            self._conn.close()
