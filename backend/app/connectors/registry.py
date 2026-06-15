"""
ConnectorRegistry — factory that instantiates the right BaseConnector
given a platform type string and a credential dict.
"""
from typing import TYPE_CHECKING
from app.connectors.base import BaseConnector

if TYPE_CHECKING:
    pass

# Map of platform type → connector class (lazy imports to keep startup fast)
_REGISTRY: dict[str, str] = {
    "sqlserver":  "app.connectors.sqlserver.SqlServerConnector",
    "snowflake":  "app.connectors.snowflake.SnowflakeConnector",
    "databricks": "app.connectors.databricks.DatabricksConnector",
    "postgres":   "app.connectors.postgres.PostgresConnector",
    "duckdb":     "app.connectors.duckdb.DuckDBConnector",
}

SUPPORTED_PLATFORMS = list(_REGISTRY.keys())


def _import_class(dotted: str):
    module_path, class_name = dotted.rsplit(".", 1)
    import importlib
    mod = importlib.import_module(module_path)
    return getattr(mod, class_name)


def get_connector(platform: str, config: dict) -> BaseConnector:
    """
    Instantiate and return the connector for `platform`.

    Args:
        platform: one of SUPPORTED_PLATFORMS (case-insensitive)
        config:   credential dict — keys vary per platform (see connector docs)

    Raises:
        ValueError: if platform is not registered
        ImportError: if the required driver is not installed
    """
    key = platform.lower().strip()
    if key not in _REGISTRY:
        raise ValueError(
            f"Unsupported platform '{platform}'. "
            f"Supported: {', '.join(SUPPORTED_PLATFORMS)}"
        )
    cls = _import_class(_REGISTRY[key])
    return cls(config)
