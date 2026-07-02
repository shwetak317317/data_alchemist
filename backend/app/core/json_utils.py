"""Shared JSON-safe serialization for raw DB driver values (pyodbc, etc.)."""
import json
import datetime
import decimal


class SafeEncoder(json.JSONEncoder):
    """Handles date/datetime/Decimal/bytes that DB drivers may return as column values."""
    def default(self, obj):
        if isinstance(obj, (datetime.date, datetime.datetime)):
            return obj.isoformat()
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        if isinstance(obj, (bytes, bytearray)):
            return obj.hex()
        return super().default(obj)


def json_safe(data) -> str:
    return json.dumps(data, cls=SafeEncoder)
