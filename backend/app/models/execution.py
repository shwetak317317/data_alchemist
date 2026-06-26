from datetime import datetime
from typing import Optional, Any
from pydantic import BaseModel


class RuleResult(BaseModel):
    result_id: str
    run_id: str
    rule_id: str
    rule_name: str
    table_fqn: str
    layer: Optional[str] = None
    status: str                        # PASS | FAIL | ERROR
    total_records: int = 0
    failed_records: int = 0
    fail_pct: float = 0.0
    quality_score: float = 100.0
    severity: str = "MEDIUM"
    is_cde_rule: bool = False
    sample_failed_records: list[dict] = []
    remediation_suggestion: Optional[str] = None
    is_expected_failure: bool = False
    acknowledged_by: Optional[str] = None


class ExecutionRunResponse(BaseModel):
    run_id: str
    connection_id: str
    run_timestamp: datetime
    total_rules: int
    passed: int
    failed: int
    errors: int
    overall_quality_score: float
    results: list[RuleResult]
    duration_seconds: Optional[float] = None
    run_number: Optional[int] = None


class AcknowledgeFailureRequest(BaseModel):
    rule_result_id: str
    acknowledged_by: str
    is_expected: bool = False
    reason: Optional[str] = None
