from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class DQRule(BaseModel):
    rule_id: Optional[str] = None
    connection_id: str
    rule_name: str
    rule_description: Optional[str] = None
    table_fqn: str
    layer: Optional[str] = None
    column_name: Optional[str] = None
    rule_expression: str                     # SQL: returns TRUE = pass, FALSE = fail
    rule_type: str                           # NULL_CHECK|RANGE|FORMAT|FK|VOLUME|CUSTOM
    severity: str = "MEDIUM"
    is_cde_rule: bool = False
    status: str = "draft"                    # draft|approved|active|snoozed|retired
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    snooze_until: Optional[datetime] = None
    created_by: Optional[str] = None
    nl_source: Optional[str] = None


class RuleDecisionRequest(BaseModel):
    decision: str                            # approve | reject | snooze
    edited_expression: Optional[str] = None
    edited_description: Optional[str] = None
    snooze_until: Optional[datetime] = None
    decided_by: str = "anonymous"
    reason: Optional[str] = None


class NLConvertRequest(BaseModel):
    connection_id: str
    table_fqn: Optional[str] = None
    natural_language: str


class NLConvertResponse(BaseModel):
    rule_name: str
    column_name: Optional[str] = None
    rule_expression: str
    rule_type: str
    severity: str
    description: str
    is_cde_rule: bool
    explanation: str
    table_fqn: Optional[str] = None
    # True when the LLM (or a post-generation check against the data dictionary)
    # could not confidently ground the requirement to a real column/table, or the
    # requirement was ambiguous/self-contradictory. The UI must warn before approval.
    unresolved: bool = False
    unresolved_reason: Optional[str] = None


class RuleRecommendRequest(BaseModel):
    connection_id: str
    report_id: str                           # profiling report to base rules on
