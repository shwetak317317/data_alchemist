---
name: module-production-audit
description: >
  Use when asked to make a module "enterprise production-ready", audit it across
  every expert lens, or get a single production-readiness verdict combining data
  engineering, AI/LLM engineering, UI/UX, product, and security review. Runs the
  agentic-fullstack-dq-platform, data-engineer-stakeholder-review, ai-engineer,
  uiux-review, and security-review skills against one named module, merges every
  finding into a single P0-P3 backlog, fixes P0/P1 now, and loops until clean.
  Activates for: "audit <module> for production", "make <module> enterprise
  ready", "full review of <module> from every angle". Pass the module name/slug
  as the skill argument.
---

# Module Production Audit — Multi-Expert Orchestrator (Compact)

One module, five expert lenses, one merged verdict. This skill doesn't do the
review itself — it drives the other project skills against the SAME module and
reconciles their output so nothing falls between two specialists' desks.

**Module under audit**: the argument passed to this skill (e.g. `profiling`,
`rules`, `execution`, `anomalies`, `dashboard`, `connections`, `simulator`,
`tasks`, `intel`, `impact`, `metadata`, `home` — see `test/config.js`
`SCREEN_INDICATORS` for the full list).

## Sequence — run in this order, each pass sees the last one's findings

```
1. agentic-fullstack-dq-platform  → wiring gate: live data only, DB-backed,
   connection-isolated, logged. Blocks everything downstream if this fails —
   no point reviewing UX/AI quality on top of mock data.
2. data-engineer-stakeholder-review → screenshot every state, apply the 13 DE
   lenses (nulls, duplicates, volume, boundaries, joins, isolation, etc.)
3. ai-engineer  → ONLY if the module has an LLM/prompt/agent code path
   (grep for `core/llm`, `agents/*`, `stream_chat`, `chat(` under this module's
   backend files first — skip this pass entirely if none found, don't force it).
4. uiux-review → walk the live flow as a 15-yr designer + PM, screenshot every
   step, inspect the API calls, file bugs vs UX improvements.
5. security-review (built-in skill) → run on any diff touching this module's
   files — credentials, injection, auth, encrypted storage, secrets.
```

Invoke each via the Skill tool with the module name in the prompt/args so every
pass is scoped to the same target, not a generic pass over the whole app.

## Merge — one backlog, not five

After all applicable passes:
1. Collect every finding (DE screenshot bugs, AI eval/pipeline gaps, UX issues,
   security findings, wiring violations) into one list.
2. Deduplicate: the same root cause often surfaces from two lenses (e.g. a
   missing loading state is both a DE "stuck spinner" and a UX "no feedback"
   finding) — merge into one entry, tag which lenses flagged it.
3. Re-rank P0 → P3 using the worst severity assigned by any lens.
4. Tag each with its origin lens(es): `[DE]` `[AI]` `[UX]` `[PM]` `[SEC]`.

## Fix Loop — don't just report, close it out

```
FIX all P0 + P1 now, in this session → RE-RUN the Playwright screenshot suite
for this module → CONFIRM each fixed finding is actually gone (screenshot diff,
not memory) → CONFIRM no new P0/P1 introduced → REPEAT merge+fix until zero
P0/P1 remain across all five lenses.
```
P2/P3 are documented, not blocking — ship with them logged and owned.

## Sign-off (only after zero P0/P1)

```
## Production Readiness — <module> — <date>

Lenses run: DE-wiring OK   DE-stakeholder OK   AI-pipeline OK/N-A   UI/UX+PM OK   Security OK

Fixed this pass: <count> (P0: n, P1: n)
Deferred (P2/P3, logged): <count> — <one-line list with owner/priority>
Final screenshot set: screenshots/final/<module>-<timestamp>.png
Verdict: PRODUCTION READY / NOT READY — <blocking reason if not>
```

## Anti-Rationalization

| Excuse | Reject it because |
|---|---|
| "The DE pass already covered UX" | Different lens, different failure mode — run uiux-review anyway |
| "No LLM code, so skip ai-engineer for every module" | Re-check per module — grep first, don't assume from a prior module |
| "Security review is for PRs, not modules" | Scope it to this module's files in the diff — same skill, narrower target |
| "P2 findings can wait forever" | Log them with an owner/priority so "wait" has an end date, not silence |
| "One lens said it's fine" | Fine per DE != fine per UX != fine per security — all five must pass |

---

## How to Run (one command per module — don't batch)

```
/module-production-audit profiling
/module-production-audit rules
/module-production-audit execution
/module-production-audit anomalies
/module-production-audit dashboard
/module-production-audit connections
/module-production-audit simulator
/module-production-audit tasks
/module-production-audit intel
/module-production-audit impact
/module-production-audit metadata
```

A pass that mixes findings from two modules loses the screenshot-to-finding
traceability every lens above depends on — finish one module before starting
the next.
