"""Intel API — pre-run advisory and data trust receipt, served from PostgreSQL."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.metadata_db import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/intel", tags=["intel"])


class RiskReason(BaseModel):
    risk: str    # "high" | "med"
    text: str


class AdvisoryResponse(BaseModel):
    advisory_id: str
    predicted_score: float
    risk_reasons: list[RiskReason]
    recommendation: str
    advisory_time: str


class FieldTrust(BaseModel):
    name: str
    status: str  # ok | warn | fail
    note: str


class ReceiptResponse(BaseModel):
    receipt_id: str
    query_text: str
    table_fqn: str
    executed_at: str
    executed_by: str
    row_count: int
    trust_score: float
    fields: list[FieldTrust]
    recommendation: str
    last_clean_snapshot: Optional[str] = None


@router.get("/advisory", response_model=AdvisoryResponse)
def get_advisory(connection_id: Optional[str] = None, db: Session = Depends(get_db)):
    """Return the latest pre-run advisory for a connection."""
    params: dict = {}
    conn_filter = "WHERE connection_id=:conn" if connection_id else ""
    if connection_id:
        params["conn"] = connection_id

    row = db.execute(text(f"""
        SELECT advisory_id, predicted_score, risk_reasons, recommendation, advisory_time
        FROM intel_advisories
        {conn_filter}
        ORDER BY generated_at DESC
        LIMIT 1
    """), params).fetchone()

    if not row:
        return AdvisoryResponse(
            advisory_id="none",
            predicted_score=0.0,
            risk_reasons=[],
            recommendation="No advisory available yet.",
            advisory_time="—",
        )

    reasons_raw = row[2] or []
    if isinstance(reasons_raw, str):
        import json
        reasons_raw = json.loads(reasons_raw)

    return AdvisoryResponse(
        advisory_id=row[0],
        predicted_score=float(row[1] or 0),
        risk_reasons=[RiskReason(risk=r.get("risk", "med"), text=r.get("text", "")) for r in reasons_raw],
        recommendation=row[3] or "—",
        advisory_time=row[4] or "—",
    )


@router.get("/receipt", response_model=ReceiptResponse)
def get_receipt(connection_id: Optional[str] = None, table_fqn: Optional[str] = None, db: Session = Depends(get_db)):
    """Return the latest trust receipt for a connection / table."""
    params: dict = {}
    conditions = []
    if connection_id:
        conditions.append("connection_id=:conn")
        params["conn"] = connection_id
    if table_fqn:
        conditions.append("table_fqn=:table")
        params["table"] = table_fqn

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    row = db.execute(text(f"""
        SELECT receipt_id, query_text, table_fqn, executed_at, executed_by,
               row_count, trust_score, fields, recommendation, last_clean_snapshot
        FROM intel_receipts
        {where}
        ORDER BY executed_at DESC
        LIMIT 1
    """), params).fetchone()

    if not row:
        return ReceiptResponse(
            receipt_id="none", query_text="—", table_fqn="—",
            executed_at="—", executed_by="—", row_count=0, trust_score=0.0,
            fields=[], recommendation="No receipt available yet.",
        )

    fields_raw = row[7] or []
    if isinstance(fields_raw, str):
        import json
        fields_raw = json.loads(fields_raw)

    executed_at_str = str(row[3])[:16].replace("T", " ") if row[3] else "—"
    last_clean = str(row[9]) if row[9] else None

    return ReceiptResponse(
        receipt_id=row[0],
        query_text=row[1] or "—",
        table_fqn=row[2] or "—",
        executed_at=executed_at_str,
        executed_by=row[4] or "—",
        row_count=int(row[5] or 0),
        trust_score=float(row[6] or 0),
        fields=[FieldTrust(name=f.get("name", ""), status=f.get("status", "ok"), note=f.get("note", "")) for f in fields_raw],
        recommendation=row[8] or "—",
        last_clean_snapshot=last_clean,
    )
