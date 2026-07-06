// DataTrust — Screen: Rule Studio + Natural Language → DQ converter
(function () {

  const IcoChevron = ({ open }) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
      style={{ transition: "transform .2s", transform: open ? "rotate(90deg)" : "rotate(0deg)", flexShrink: 0 }}>
      <path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const IcoClock = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M7 4.5V7l1.8 1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );

  const IcoSparkles = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1L7 4.5H10.5L7.75 6.5L8.75 10L6 8L3.25 10L4.25 6.5L1.5 4.5H5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none"/>
    </svg>
  );

  const RULE_TYPE = {
    NULL_CHECK: { bg: "var(--blue-50)",   fg: "var(--blue-700)",   label: "Null"   },
    RANGE:      { bg: "var(--green-50)",  fg: "var(--green-700)",  label: "Range"  },
    FORMAT:     { bg: "var(--yellow-50)", fg: "var(--yellow-800)", label: "Format" },
    FK:         { bg: "var(--purple-50)", fg: "var(--purple-700)", label: "FK"     },
    VOLUME:     { bg: "#fff7ed",          fg: "#c2410c",           label: "Volume" },
    CUSTOM:     { bg: "var(--grey-100)",  fg: "var(--grey-700)",   label: "Custom" },
  };

  const Rules = () => {
    const { go, ruleDecisions, setRuleDecisions, customRules, setCustomRules, activeConnectionId, activeConnectionName, datasets,
      backgroundJobs, startJob, updateJob, endJob } = useApp();

    const [apiRules, setApiRules]         = React.useState([]);
    const [sideCollapsed, setSideCollapsed] = React.useState({});
    const [selectedFqn, setSelectedFqn]   = React.useState(null);
    const [generatingFor, setGeneratingFor] = React.useState(null);
    const [generatingAll, setGeneratingAll] = React.useState(false);
    const [genAllProgress, setGenAllProgress] = React.useState({ done: 0, total: 0 });
    // A generate-all loop keeps running in the background after this screen unmounts
    // (plain promise chain + the shell's global job registry). On remount mid-run,
    // local state has reset — adopt the live job's progress so the UI still shows the
    // run and the buttons stay disabled instead of allowing a duplicate run.
    const liveGenJob = (backgroundJobs || []).find(j => j.id.startsWith(`generate-all-${activeConnectionId}`));
    const genAllRunning = generatingAll || !!liveGenJob;
    const genAllShown = generatingAll ? genAllProgress
      : liveGenJob ? { done: liveGenJob.done || 0, total: liveGenJob.total || 0 } : genAllProgress;
    const [filterStatus, setFilterStatus] = React.useState("ALL");
    const [filterType, setFilterType]     = React.useState("ALL");
    const [fLayer, setFLayer]             = React.useState("ALL");
    const [searchText, setSearchText]     = React.useState("");
    const [snoozeId, setSnoozeId]         = React.useState(null);
    const [snoozeDate, setSnoozeDate]     = React.useState("");
    // Snoozing to a past date is meaningless (nothing auto-reactivates a snoozed rule —
    // snooze_until is stored but never read back to expire it), so the date picker must
    // never allow one to be picked in the first place.
    const _todayIso = new Date().toISOString().slice(0, 10);
    const [nl, setNl]                     = React.useState("A single order's net revenue should never exceed $25,000");
    const [generated, setGenerated]       = React.useState(null);
    const [nlLoading, setNlLoading]       = React.useState(false);
    const [editId, setEditId]             = React.useState(null);
    const [exprDraft, setExprDraft]       = React.useState("");
    const [runState, setRunState]         = React.useState({});
    const [genEditingExpr, setGenEditingExpr] = React.useState(false);
    const [genExprDraft, setGenExprDraft]     = React.useState("");
    const [selectedRuleIds, setSelectedRuleIds] = React.useState(new Set());
    const nlResultRef = React.useRef(null);
    // Synchronous lock for generateRules/generateAll — React state (generatingFor/
    // generatingAll) doesn't update until the next render, so a rapid double/triple-
    // click fires multiple handler invocations that all still see the OLD state value
    // before any of them re-renders the disabled button. Confirmed live: a 3-click
    // burst fired 2 concurrent POST /rules/recommend calls for the same table. A ref
    // mutates immediately, closing that window regardless of render timing.
    const generatingLockRef = React.useRef(false);
    useIcons();

    // Dual control (backend/app/api/rules.py::decide_rule) blocks approving a rule
    // you created yourself, unless you're an admin — surface that proactively
    // instead of only after a failed approve attempt.
    const currentUser = React.useMemo(() => {
      try { return JSON.parse(sessionStorage.getItem("dt_user") || "{}"); } catch { return {}; }
    }, []);
    const isAdmin = currentUser.role === "admin";

    // Scroll NL result into view whenever it appears
    React.useEffect(() => {
      if (generated && nlResultRef.current) {
        nlResultRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      setGenEditingExpr(false);
      setGenExprDraft("");
    }, [generated]);

    // The backend now records a cross-table rule's target in the structured
    // related_table_fqn column (migration 31). The "[Cross-table: <table>]" text
    // prefix in rule_description survives only for human readability and for rows
    // predating the migration — parse it as a fallback, NOT anchored to position 0,
    // because ⚠️ warning prefixes can be prepended before it.
    const _CROSS_TABLE_RE = /\[Cross-table:\s*([^\]]+)\]\s*/;

    const mapRule = (r, i) => {
      const rawDesc = r.rule_description || "";
      const crossMatch = rawDesc.match(_CROSS_TABLE_RE);
      const cleanDesc = crossMatch ? rawDesc.replace(_CROSS_TABLE_RE, "") : rawDesc;
      // Defensive: a rule referencing its OWN table (e.g. a self-referencing hierarchy
      // check like ParentCategoryID -> CategoryID within the same table) is not a real
      // cross-table dependency, even if it was mistakenly tagged as one at generation
      // time (older rows predate the backend fix that stops this at the source).
      const crossTarget = r.related_table_fqn || (crossMatch ? crossMatch[1].trim() : null);
      const isSelfReference = crossTarget && r.table_fqn && crossTarget.toLowerCase() === r.table_fqn.trim().toLowerCase();
      return {
        id: r.rule_id || (i + 1),
        name: r.rule_name || r.name,
        expr: r.rule_expression || r.expr,
        note: cleanDesc,
        why: r.rationale || r.explanation || cleanDesc || "",
        layer: (r.layer || "SILVER").toUpperCase(),
        sev: r.severity || "MEDIUM",
        by: r.nl_source ? "NL" : "AI",
        // The backend persists a rejected decision as status='retired' (rules.py::decide_rule) —
        // map it to 'rejected' here so the UI recognizes it after a reload instead of rendering
        // it as an untouched pending draft.
        status: r.status === "retired" ? "rejected" : (r.status || "draft"),
        ruleType: r.rule_type || "CUSTOM",
        tableFqn: r.table_fqn || "",
        col: r.column_name || "",
        cde: r.is_cde_rule || false,
        createdBy: r.created_by || "",
        crossTableWith: isSelfReference ? null : crossTarget,
      };
    };

    const loadData = React.useCallback(() => {
      if (!window.DTApi || !activeConnectionId) return Promise.resolve();
      return window.DTApi.listRules(activeConnectionId)
        .then(rows => { if (rows) setApiRules(rows.map(mapRule)); })
        .catch(() => {});
    }, [activeConnectionId]);

    // True from first paint until the initial rules fetch resolves — effects run AFTER
    // the first paint, so without this the screen flashes "0 rules"/empty coverage (or
    // a previous connection's rules) before the real data arrives.
    const [rulesLoading, setRulesLoading] = React.useState(!!window.DTApi);

    React.useEffect(() => {
      if (!window.DTApi || !activeConnectionId) { setRulesLoading(false); return; }
      setRulesLoading(true);
      // Clear the previous connection's rules immediately — stale rows on screen while
      // the new connection loads reads as wrong data. In-place refreshes elsewhere call
      // loadData() directly and deliberately keep current rows visible.
      setApiRules([]);
      loadData().finally(() => setRulesLoading(false));
    }, [loadData]);

    const allRules = [...apiRules, ...customRules];

    const sidebarGroups = React.useMemo(() => {
      const byLayer = {};
      // Tables from profiling datasets (have a Generate button)
      (datasets || []).forEach(group => {
        const layer = (group.layer || group.schema || "UNKNOWN").toUpperCase();
        if (!byLayer[layer]) byLayer[layer] = { layer, tables: [] };
        (group.tables || []).forEach(t => {
          const fqn = group.schema ? `${group.schema}.${t.name}` : t.name;
          if (byLayer[layer].tables.some(x => x.fqn === fqn)) return;
          const displayName = fqn.includes(".") ? fqn.split(".").pop() : fqn;
          byLayer[layer].tables.push({ fqn, name: displayName, profiled: !!(t.profiled && t.profiled !== "—") });
        });
      });
      // Also surface tables that have rules even if no profiling report exists
      allRules.forEach(r => {
        if (!r.tableFqn) return;
        const layer = r.layer || "UNKNOWN";
        if (!byLayer[layer]) byLayer[layer] = { layer, tables: [] };
        if (!byLayer[layer].tables.some(t => t.fqn === r.tableFqn)) {
          const displayName = r.tableFqn.includes(".") ? r.tableFqn.split(".").pop() : r.tableFqn;
          byLayer[layer].tables.push({ fqn: r.tableFqn, name: displayName, profiled: false });
        }
      });
      return Object.values(byLayer);
    }, [datasets, allRules]);

    const rulesByTable = React.useMemo(() =>
      allRules.reduce((acc, r) => {
        if (!r.tableFqn) return acc;
        if (!acc[r.tableFqn]) acc[r.tableFqn] = { total: 0, approved: 0, pending: 0, cde: 0, crossTable: 0 };
        acc[r.tableFqn].total++;
        const st = ruleDecisions[r.id] || r.status;
        if (["approved", "active"].includes(st)) acc[r.tableFqn].approved++;
        if (st === "draft") acc[r.tableFqn].pending++;
        if (r.cde) acc[r.tableFqn].cde++;
        if (r.crossTableWith) acc[r.tableFqn].crossTable++;
        return acc;
      }, {})
    , [allRules, ruleDecisions]);

    const visibleRules = React.useMemo(() => {
      let rows = allRules;
      if (selectedFqn) rows = rows.filter(r => r.tableFqn === selectedFqn);
      if (fLayer !== "ALL") rows = rows.filter(r => r.layer === fLayer);
      if (filterStatus !== "ALL") rows = rows.filter(r => (ruleDecisions[r.id] || r.status) === filterStatus);
      if (filterType === "CROSS_TABLE") rows = rows.filter(r => !!r.crossTableWith);
      else if (filterType !== "ALL") rows = rows.filter(r => r.ruleType === filterType);
      if (searchText) {
        const q = searchText.toLowerCase();
        rows = rows.filter(r =>
          r.name.toLowerCase().includes(q) ||
          r.expr.toLowerCase().includes(q) ||
          r.tableFqn.toLowerCase().includes(q)
        );
      }
      return rows;
    }, [allRules, selectedFqn, fLayer, filterStatus, filterType, searchText, ruleDecisions]);

    // Generates single-table rules, then folds a cross-table (FK/referential-integrity)
    // check into the SAME action — there is no separate "Cross-table rules" button;
    // a cross-table failure (e.g. no other cataloged tables yet) is reported alongside
    // the single-table result but never blocks it, since the two are independent checks
    // that happen to share one report_id.
    const generateRules = async (fqn) => {
      if (generatingLockRef.current || generatingFor || genAllRunning) return;
      generatingLockRef.current = true;
      setGeneratingFor(fqn);
      try {
        const report = await window.DTApi.getReportByTable(fqn, activeConnectionId);
        if (!report?.report_id) throw new Error("No profiling report — run Profiling first");
        const rules = await window.DTApi.recommendRules({ report_id: report.report_id, connection_id: activeConnectionId });

        let crossCount = null, crossFailed = false;
        try {
          const crossRules = await window.DTApi.recommendCrossTableRules({ report_id: report.report_id, connection_id: activeConnectionId });
          crossCount = crossRules.length;
        } catch (_) {
          crossFailed = true;
        }

        // Immediately update rule list so results appear without waiting for full reload
        const fresh = await window.DTApi.listRules(activeConnectionId).catch(() => null);
        if (fresh) setApiRules(fresh.map(mapRule));
        setSelectedFqn(fqn);
        setFilterStatus("ALL");

        const parts = [`${rules.length} rule${rules.length === 1 ? "" : "s"} generated`];
        if (crossFailed) parts.push("cross-table check unavailable");
        else if (crossCount != null) parts.push(crossCount > 0 ? `${crossCount} cross-table rule${crossCount === 1 ? "" : "s"} found` : "no cross-table relationships found");
        toast(parts.join(" · "), { kind: "success" });
      } catch (e) {
        toast(e.message.replace(/^API \d+: /, ""), { kind: "error" });
      } finally {
        setGeneratingFor(null);
        generatingLockRef.current = false;
      }
    };

    // This job is registered in the GLOBAL app context (shell.jsx), not just local
    // component state — the loop below is a plain async function, so the actual
    // work already keeps running if the user navigates away (unmounting this
    // component doesn't cancel an in-flight promise chain); what used to break is
    // that ALL progress feedback was local state, so it visibly vanished the moment
    // you left this screen even though generation kept happening invisibly. The
    // global job survives navigation and renders as a small indicator in the
    // TopBar (click it to jump back here) until the loop finishes, on any screen.
    // layerFilter unset: connection-wide "Generate all tables" — only fills gaps
    // (tables with zero rules yet), unchanged from before. layerFilter set: the
    // per-layer "Regenerate all in X" nav-bar button — regenerates EVERY profiled
    // table in that layer regardless of current rule count, since the backend now
    // safely replaces superseded drafts on regenerate without touching anything a
    // human has already decided on (see /recommend's cleanup DELETE).
    const generateAll = async (layerFilter = null) => {
      if (generatingLockRef.current || genAllRunning || generatingFor) return;
      const eligible = [];
      sidebarGroups.forEach(g => {
        if (layerFilter && g.layer !== layerFilter) return;
        g.tables.forEach(t => {
          if (!t.profiled) return;
          if (!layerFilter && rulesByTable[t.fqn]?.total > 0) return;
          eligible.push(t);
        });
      });
      if (!eligible.length) {
        toast(layerFilter
          ? `No profiled tables found in ${layerFilter}`
          : "No un-generated profiled tables found — run Profiling first", { kind: "info" });
        return;
      }
      generatingLockRef.current = true;
      const jobId = `generate-all-${activeConnectionId}${layerFilter ? "-" + layerFilter : ""}`;
      setGeneratingAll(true);
      setGenAllProgress({ done: 0, total: eligible.length });
      startJob(jobId, layerFilter ? `Regenerating rules for ${layerFilter}` : "Generating rules for all tables");
      updateJob(jobId, { total: eligible.length });
      const failedTables = [];
      for (let i = 0; i < eligible.length; i++) {
        const t = eligible[i];
        setGeneratingFor(t.fqn);
        try {
          const report = await window.DTApi.getReportByTable(t.fqn, activeConnectionId);
          if (report?.report_id) {
            await window.DTApi.recommendRules({ report_id: report.report_id, connection_id: activeConnectionId });
            // A per-layer "Regenerate all in X" run also folds in the cross-table check
            // per table, same as the single-table button — a targeted regenerate implies
            // a thorough one. The connection-wide "Generate all tables" gap-filler skips
            // this to stay fast on a fresh connection with many un-generated tables.
            if (layerFilter) {
              await window.DTApi.recommendCrossTableRules({ report_id: report.report_id, connection_id: activeConnectionId }).catch(() => {});
            }
            // Refresh immediately so this table's rules appear in the list — a no-op
            // if this component has since unmounted (user navigated away), which is
            // fine: loadData()'s own mount effect re-fetches fresh state on return.
            const fresh = await window.DTApi.listRules(activeConnectionId).catch(() => null);
            if (fresh) setApiRules(fresh.map(mapRule));
          }
        } catch (err) {
          failedTables.push({ fqn: t.fqn, message: (err?.message || "error").replace(/^API \d+: /, "") });
        }
        setGenAllProgress({ done: i + 1, total: eligible.length });
        updateJob(jobId, { done: i + 1 });
        await new Promise(r => setTimeout(r, 0));
      }
      setGeneratingFor(null);
      setGeneratingAll(false);
      generatingLockRef.current = false;
      setGenAllProgress({ done: 0, total: 0 });
      setFilterStatus("ALL");
      endJob(jobId);
      if (failedTables.length) {
        const names = failedTables.map(f => f.fqn.split(".").pop()).join(", ");
        toast(`${failedTables.length} of ${eligible.length} tables failed to generate rules (${names}) — ${failedTables[0].message}`, { kind: "error" });
      } else {
        toast(`${layerFilter ? "Regenerated" : "Generated"} rules for ${eligible.length} table${eligible.length === 1 ? "" : "s"}${layerFilter ? ` in ${layerFilter}` : ""}`, { kind: "success" });
      }
      loadData();
    };

    const _toDecisionVerb = (d) => ({ approved: "approve", rejected: "reject", active: "approve" }[d] || d);

    // Patch one rule's data in place (by index) instead of re-fetching and
    // re-rendering the whole list — a full reload sorts by created_at DESC, so
    // any rule generated elsewhere *after* this one (a very live possibility —
    // "Generate all" can be running concurrently) would slot in above it and
    // visibly shift this rule's position for no reason related to the action
    // the user just took.
    const patchRuleInPlace = (updated) => {
      if (!updated?.rule_id) return;
      const mapped = mapRule(updated, 0);
      setApiRules(prev => {
        const idx = prev.findIndex(r => r.id === mapped.id);
        if (idx === -1) return prev;
        const next = prev.slice();
        next[idx] = mapped;
        return next;
      });
    };

    const decide = (id, d) => {
      setRuleDecisions(x => ({ ...x, [id]: d }));
      toast(`Rule ${d} · logged to audit trail`, { kind: d === "rejected" ? "info" : "success" });
      if (window.DTApi?.decideRule) {
        window.DTApi.decideRule(id, { decision: _toDecisionVerb(d), decided_by: "user" })
          .then(patchRuleInPlace)
          .catch(err => {
            // Revert the optimistic status — e.g. the backend's dual-control check
            // (a rule's own author can't approve it) rejects with 403 here, and
            // without this the UI would show "Approved" forever while the rule
            // stays in draft server-side, hiding the rejection from the user.
            setRuleDecisions(x => { const n = { ...x }; delete n[id]; return n; });
            toast("Could not save decision: " + (err?.message || "error").replace(/^API \d+: /, ""), { kind: "error" });
          });
      }
    };

    // Saving an edited expression always sends the rule back to draft — even if
    // it was previously approved — so a human other than the editor has to sign
    // off on the SQL that actually runs. The backend rejects sending an edit and
    // an approval in the same request for the same reason.
    const saveEdit = (id, editedExpression) => {
      if (!window.DTApi?.decideRule) return;
      setRuleDecisions(x => ({ ...x, [id]: "draft" }));
      window.DTApi.decideRule(id, { decision: "edit", edited_expression: editedExpression, decided_by: "user" })
        .then(updated => {
          toast("Expression saved — sent back to draft for re-review", { kind: "info" });
          patchRuleInPlace(updated);
        })
        .catch(err => {
          setRuleDecisions(x => { const n = { ...x }; delete n[id]; return n; });
          toast("Could not save edit: " + (err?.message || "error").replace(/^API \d+: /, ""), { kind: "error" });
        });
    };

    const statusOf = (r) => ruleDecisions[r.id] || r.status;

    // Bulk-decide whatever the user has checked via the row selection boxes —
    // replaces the old severity-only "Bulk approve LOW" shortcut with an explicit,
    // visible selection the user controls directly (checkboxes + a bulk bar),
    // matching the Dictionary/CDE module's pattern.
    const bulkDecideSelected = async (decision) => {
      const candidates = allRules.filter(r => selectedRuleIds.has(r.id) && statusOf(r) === "draft");
      if (!candidates.length) { toast("No pending rules in the current selection", { kind: "info" }); return; }
      if (!window.DTApi?.decideRule) return;
      // Dual control always rejects a self-authored rule for a non-admin — skip
      // those upfront instead of letting them show up as generic "failures."
      const skippedOwn = isAdmin ? [] : candidates.filter(r => r.createdBy && r.createdBy === currentUser.email);
      const actionable = isAdmin ? candidates : candidates.filter(r => !(r.createdBy && r.createdBy === currentUser.email));
      if (!actionable.length) {
        toast(`All ${skippedOwn.length} selected rule(s) were created by you — ask a teammate to review them`, { kind: "info" });
        return;
      }
      const outcomes = await Promise.allSettled(
        actionable.map(r => window.DTApi.decideRule(r.id, { decision: _toDecisionVerb(decision), decided_by: "user" }))
      );
      const succeeded = actionable.filter((_, i) => outcomes[i].status === "fulfilled");
      succeeded.forEach(r => setRuleDecisions(x => ({ ...x, [r.id]: decision })));
      outcomes.forEach(o => { if (o.status === "fulfilled") patchRuleInPlace(o.value); });
      const failedCount = actionable.length - succeeded.length;
      const verb = decision === "rejected" ? "rejected" : "approved";
      const parts = [`${succeeded.length} of ${candidates.length} rule${candidates.length === 1 ? "" : "s"} ${verb}`];
      if (skippedOwn.length) parts.push(`${skippedOwn.length} skipped (created by you — ask a teammate)`);
      if (failedCount) parts.push(`${failedCount} failed`);
      toast(parts.join(" — "), { kind: (failedCount || skippedOwn.length) ? "warning" : "success" });
      setSelectedRuleIds(new Set());
    };

    const confirmSnooze = () => {
      // Defense-in-depth beyond the date input's min attribute and the Confirm
      // button's disabled check — some browsers (notably Safari/mobile WebKit)
      // don't strictly enforce min/max on <input type="date">, so a past date
      // could otherwise slip through and be saved as a meaningless snooze.
      if (!snoozeDate || snoozeDate < _todayIso) return;
      setRuleDecisions(x => ({ ...x, [snoozeId]: "snoozed" }));
      toast(`Rule #${snoozeId} snoozed until ${snoozeDate}`, { kind: "info" });
      if (window.DTApi?.decideRule) {
        window.DTApi.decideRule(snoozeId, {
          decision: "snooze",
          snooze_until: new Date(snoozeDate).toISOString(),
          decided_by: "user",
        }).then(patchRuleInPlace).catch(() => {});
      }
      setSnoozeId(null);
      setSnoozeDate("");
    };

    // Runnable requires: (1) synced to the backend (real string rule_id, not a
    // pending-local tempId) and (2) approved/active — the execution engine only ever
    // runs approved/active rules (backend/app/api/execution.py), so including a
    // draft/rejected/snoozed rule here would mark it "running" forever: the backend
    // silently excludes it from the response and its spinner never resolves.
    const isRunnable = (r) => typeof r.id === "string" && ["approved", "active"].includes(statusOf(r));

    const _applyResult = (id, result, durationSec) => (result
      ? { status: result.status, failCnt: String(result.failed_records ?? 0),
          failPct: String(result.fail_pct ?? 0), ms: (durationSec || 0).toFixed(1),
          message: result.remediation_suggestion || null }
      : undefined);

    const runOne = (r) => {
      if (!activeConnectionId) return;
      if (!isRunnable(r)) { toast("This rule hasn't finished syncing yet — try again in a moment", { kind: "info" }); return; }
      setRunState(s => ({ ...s, [r.id]: "running" }));
      window.DTApi.runExecution(activeConnectionId, null, r.id)
        .then(resp => {
          const result = (resp?.results || []).find(x => x.rule_id === r.id) || (resp?.results || [])[0];
          if (!result) throw new Error("No result returned");
          const applied = _applyResult(r.id, result, resp.duration_seconds);
          setRunState(s => ({ ...s, [r.id]: applied }));
          const label = applied.status === "PASS" ? "PASSED" : applied.status === "ERROR" ? "ERRORED" : "FAILED";
          toast(applied.status === "ERROR"
            ? `Rule "${r.name}" could not run — ${applied.message || "execution error"}`
            : `Rule "${r.name}" ran — ${label}${applied.status === "FAIL" ? ` (${applied.failCnt} records)` : ""}`,
            { kind: applied.status === "PASS" ? "success" : "error" });
        })
        .catch(err => {
          setRunState(s => { const n = { ...s }; delete n[r.id]; return n; });
          toast(`Could not run rule: ${(err?.message || "error").replace(/^API \d+: /, "")}`, { kind: "error" });
        });
    };

    const runLayer = (layer) => {
      if (!activeConnectionId) return;
      const rules = visibleRules.filter(r => (layer === "ALL" || r.layer === layer) && isRunnable(r));
      const ids = rules.map(r => r.id);
      if (!ids.length) { toast("No runnable rules in this scope", { kind: "info" }); return; }
      ids.forEach(id => setRunState(s => ({ ...s, [id]: "running" })));
      toast(`Running ${ids.length} rules${layer === "ALL" ? "" : " · " + layer + " layer"}…`, { kind: "info" });
      window.DTApi.runExecution(activeConnectionId, layer === "ALL" ? null : layer)
        .then(resp => {
          const byId = {};
          (resp?.results || []).forEach(res => { byId[res.rule_id] = res; });
          setRunState(s => {
            const next = { ...s };
            ids.forEach(id => { next[id] = _applyResult(id, byId[id], resp.duration_seconds); });
            return next;
          });
        })
        .catch(err => {
          setRunState(s => { const n = { ...s }; ids.forEach(id => delete n[id]); return n; });
          toast(`Could not run rules: ${(err?.message || "error").replace(/^API \d+: /, "")}`, { kind: "error" });
        });
    };

    const convertNl = (text) => {
      const q = (text ?? nl).trim();
      if (!q) return;
      if (!window.DTApi || !activeConnectionId) {
        toast("Connect a data source first to convert natural language to a rule", { kind: "error" });
        return;
      }
      setNlLoading(true);
      setGenerated(null);
      window.DTApi.nlToRule({ natural_language: q, connection_id: activeConnectionId, table_fqn: selectedFqn || null })
        .then(r => setGenerated({
          name: r.rule_name, col: r.column_name, expr: r.rule_expression,
          sev: r.severity || "MEDIUM", cde: false,
          why: r.rationale || r.explanation || "",
          refine: null,
          table_fqn: r.table_fqn || selectedFqn || null,
          unresolved: r.unresolved || false,
          unresolvedReason: r.unresolved_reason || null,
        }))
        .catch(err => toast(`Could not convert to a rule: ${(err?.message || "error").replace(/^API \d+: /, "")}`, { kind: "error" }))
        .finally(() => setNlLoading(false));
    };

    const pendingCount  = allRules.filter(r => statusOf(r) === "draft").length;
    const approvedCount = allRules.filter(r => ["approved", "active"].includes(statusOf(r))).length;

    const selectedName = selectedFqn
      ? (selectedFqn.includes(".") ? selectedFqn.split(".").pop() : selectedFqn)
      : null;

    const selStyle = {
      fontSize: 12, padding: "4px 8px", borderRadius: 6,
      border: "1px solid var(--grey-200)", background: "#fff",
      color: "var(--fg-1)", cursor: "pointer", height: 30,
    };
    const hasFilters = fLayer !== "ALL" || filterStatus !== "ALL" || filterType !== "ALL" || !!searchText;
    const clearFilters = () => { setFLayer("ALL"); setFilterStatus("ALL"); setFilterType("ALL"); setSearchText(""); };

    return (
      <div className="dt-fade-up" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* ── Sidebar ──────────────────────────────────────── */}
        <div style={{ width: 248, flexShrink: 0, position: "sticky", top: 16, alignSelf: "flex-start",
          maxHeight: "calc(100vh - 80px)", overflowY: "auto" }}>
          <Card pad={0} style={{ overflow: "hidden" }}>

            {/* All tables */}
            <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--grey-100)" }}>
              <button onClick={() => setSelectedFqn(null)}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: selectedFqn === null ? "var(--brand-soft)" : "transparent",
                  color: selectedFqn === null ? "var(--brand)" : "var(--fg-1)",
                  border: "none", borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                <span>All tables</span>
                <span style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 700 }}>{allRules.length}</span>
              </button>
            </div>

            {sidebarGroups.length === 0 && (
              <div style={{ padding: "16px 14px", fontSize: 12, color: "var(--fg-3)", textAlign: "center" }}>
                No tables — connect a data source first
              </div>
            )}

            {sidebarGroups.map(group => (
              <div key={group.layer}>
                <button
                  onClick={() => setSideCollapsed(c => ({ ...c, [group.layer]: !c[group.layer] }))}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 7, padding: "6px 14px",
                    background: "var(--grey-50)", border: "none", borderTop: "1px solid var(--grey-100)",
                    cursor: "pointer", fontSize: 10.5, fontWeight: 700, color: "var(--fg-2)", letterSpacing: ".06em" }}>
                  <IcoChevron open={!sideCollapsed[group.layer]} />
                  <span style={{ flex: 1, textAlign: "left" }}>{group.layer}</span>
                  <span style={{ fontSize: 10, color: "var(--fg-3)" }}>{group.tables.length}</span>
                </button>

                {!sideCollapsed[group.layer] && group.tables.map(t => {
                  const cov = rulesByTable[t.fqn] || { total: 0, pending: 0, approved: 0, crossTable: 0 };
                  const isActive   = selectedFqn === t.fqn;
                  const isGenerating = generatingFor === t.fqn;
                  return (
                    <div key={t.fqn}
                      style={{ borderTop: "1px solid var(--grey-100)", background: isActive ? "var(--blue-50)" : "#fff" }}>
                      <button onClick={() => setSelectedFqn(isActive ? null : t.fqn)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 6,
                          padding: "8px 12px 3px 22px", background: "transparent", border: "none",
                          cursor: "pointer", textAlign: "left" }}>
                        <span style={{ flex: 1, fontSize: 12.5, fontWeight: isActive ? 700 : 500,
                          color: isActive ? "var(--brand)" : "var(--fg-1)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.name}
                        </span>
                        {cov.total > 0 && (
                          <span style={{ fontSize: 10, color: "var(--fg-3)", flexShrink: 0 }}>{cov.total}</span>
                        )}
                      </button>
                      <div style={{ padding: "2px 12px 7px 22px", display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                        {cov.pending > 0 && (
                          <span style={{ fontSize: 10, color: "var(--yellow-800)", background: "var(--yellow-50)",
                            borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>{cov.pending} pending</span>
                        )}
                        {cov.crossTable > 0 && (
                          <span title={`${cov.crossTable} rule${cov.crossTable === 1 ? "" : "s"} check this table against another cataloged table`}
                            style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10,
                              color: "var(--purple-700)", background: "var(--purple-50)",
                              borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                            <i data-lucide="link-2" style={{ width: 9, height: 9 }}></i>{cov.crossTable}
                          </span>
                        )}
                        {/* The sidebar only offers the FIRST-TIME Generate action, for a
                            profiled table with no rules yet. Once a table has rules, its
                            Regenerate control lives beside the Run button in the main-panel
                            header (shown when the table is selected) — never here, so the
                            same action is never offered in two places at once. */}
                        {t.profiled && cov.total === 0 && (
                          <button onClick={() => generateRules(t.fqn)} disabled={!!generatingFor || genAllRunning}
                            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                              color: isGenerating ? "var(--fg-3)" : "var(--brand)",
                              background: "transparent", border: "1px solid var(--brand-ring)",
                              borderRadius: 999, padding: "2px 8px",
                              cursor: (generatingFor || genAllRunning) ? "not-allowed" : "pointer",
                              opacity: (generatingFor || genAllRunning) && !isGenerating ? 0.45 : 1 }}>
                            {isGenerating
                              ? <><span className="dt-spin" style={{ width: 9, height: 9, border: "1.5px solid var(--brand-ring)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span> Generating…</>
                              : <><IcoSparkles /> Generate</>}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </Card>
        </div>

        {/* ── Main panel ───────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Header card — primary actions live in the nav bar (right slot), matching
              the Dictionary/CDE module, instead of a separate button row below. */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SectionTitle icon="shield-check"
                  sub={
                    // Pending/active counts are informational, not actions — they live in the
                    // subtitle line with the rule count, not mixed into the button row where a
                    // short text chip next to a full-height button reads as visually uneven and
                    // makes it unclear which of the two is actually clickable.
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span>{rulesLoading ? "Loading rules…" : `${allRules.length} rules · every rule needs explicit human review before activating.`}</span>
                      <Chip intent="warning" size="sm">{pendingCount} pending</Chip>
                      <Chip intent="brand" size="sm" dot>{approvedCount} active</Chip>
                    </span>
                  }>
                  Rule Studio{activeConnectionName ? ` — ${activeConnectionName}` : ""}
                  {selectedFqn && <span style={{ color: "var(--brand)", fontWeight: 600 }}> · {selectedName}</span>}
                </SectionTitle>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap",
                justifyContent: "flex-end", paddingTop: 2 }}>
                {selectedFqn ? (
                  // Placement contract (mirror of the sidebar's): a table's FIRST-TIME
                  // Generate lives in the sidebar row only; once the table HAS rules, its
                  // Regenerate lives here, beside the Run button — never both places at once.
                  rulesByTable[selectedFqn]?.total > 0 && (
                    <Button size="sm" variant="primary" icon="sparkles" disabled={!!generatingFor || genAllRunning} onClick={() => generateRules(selectedFqn)}>
                      {generatingFor === selectedFqn ? "Regenerating…" : "Regenerate"}
                    </Button>
                  )
                ) : fLayer !== "ALL" ? (
                  <Button size="sm" variant="primary" icon="sparkles"
                    disabled={genAllRunning || !!generatingFor} onClick={() => generateAll(fLayer)}>
                    {genAllRunning
                      ? `Regenerating… ${genAllShown.done}/${genAllShown.total}`
                      : `Regenerate all in ${fLayer}`}
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" icon="sparkles"
                    disabled={genAllRunning || !!generatingFor} onClick={() => generateAll()}>
                    {genAllRunning
                      ? `Generating… ${genAllShown.done}/${genAllShown.total}`
                      : "Generate all tables"}
                  </Button>
                )}
                <Button size="sm" variant="soft" icon="circle-play" onClick={() => runLayer(fLayer)}>
                  Run {fLayer === "ALL" ? "all" : fLayer}
                </Button>
              </div>
            </div>

            {/* Persistent caption instead of a hover-only tooltip — explains what the active
                generation control does (sidebar Generate for a first-time table, or the
                header's Regenerate for a table that already has rules). */}
            {selectedFqn && !genAllRunning && (
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 8, fontSize: 11.5, color: "var(--fg-3)" }}>
                <i data-lucide="link-2" style={{ width: 12, height: 12, flexShrink: 0 }}></i>
                <span>Also checks for FK/referential-integrity relationships against every other cataloged table in this connection.</span>
              </div>
            )}

            {genAllRunning && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 12, color: "var(--brand)" }}>
                <span className="dt-spin" style={{ width: 12, height: 12, border: "2px solid var(--brand-ring)",
                  borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
                <span>{generatingFor ? `Processing ${generatingFor.split(".").pop()}…` : "Starting…"}</span>
              </div>
            )}

            {/* Compact filter bar — dropdowns instead of pill rows, matching the
                Dictionary/CDE module's filter bar. */}
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={fLayer} onChange={e => setFLayer(e.target.value)} style={selStyle}>
                <option value="ALL">All layers</option>
                {["RAW","BRONZE","SILVER","GOLD"].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
                <option value="ALL">All statuses</option>
                <option value="draft">Pending</option>
                <option value="approved">Approved</option>
                <option value="active">Active</option>
                <option value="snoozed">Snoozed</option>
                <option value="rejected">Rejected</option>
              </select>
              <select value={filterType} onChange={e => setFilterType(e.target.value)} style={selStyle}>
                <option value="ALL">All types</option>
                <option value="NULL_CHECK">Null</option>
                <option value="RANGE">Range</option>
                <option value="FORMAT">Format</option>
                <option value="FK">FK</option>
                <option value="VOLUME">Volume</option>
                <option value="CUSTOM">Custom</option>
                <option value="CROSS_TABLE">Cross-table only</option>
              </select>
              <input value={searchText} onChange={e => setSearchText(e.target.value)}
                placeholder="Search rules…"
                style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--grey-200)",
                  outline: "none", width: 180, height: 30, boxSizing: "border-box", color: "var(--fg-1)", background: "#fff" }} />
              {hasFilters && (
                <button onClick={clearFilters}
                  style={{ background: "none", border: "none", cursor: "pointer",
                    fontSize: 11, color: "var(--fg-3)", textDecoration: "underline" }}>
                  Clear
                </button>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--fg-3)" }}>
                {rulesLoading ? "…" : `${visibleRules.length}${allRules.length !== visibleRules.length ? ` / ${allRules.length}` : ""} rules`}
              </span>
            </div>
          </Card>

          {/* NL → DQ converter — the platform's marquee AI capability. Lives directly
              under the header (not below the rule list, where it was invisible behind
              hundreds of rows) and wears a gradient treatment no other card uses, so it
              reads as THE AI surface at first glance. */}
          <Card style={{ marginBottom: 16, border: "1px solid transparent", borderRadius: 14,
            background: "linear-gradient(#fff, #fff) padding-box, linear-gradient(120deg, var(--brand), #8b5cf6 55%, var(--brand)) border-box",
            boxShadow: "0 2px 14px rgba(99, 91, 255, 0.12)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
              <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                background: "linear-gradient(135deg, var(--brand), #8b5cf6)" }}>
                <i data-lucide="sparkles" style={{ width: 17, height: 17, color: "#fff" }}></i>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "var(--fg-1)" }}>Natural language → DQ rule</span>
                  <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".09em", color: "#fff",
                    background: "linear-gradient(135deg, var(--brand), #8b5cf6)", borderRadius: 999, padding: "2.5px 8px" }}>
                    AI AGENT
                  </span>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--fg-2)", marginTop: 2 }}>
                  Describe a quality expectation in plain English — the agent writes the SQL rule for your review. No SQL needed.
                </div>
              </div>
            </div>
            {selectedFqn && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Scoped to</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)",
                  background: "var(--brand-soft)", borderRadius: 4, padding: "2px 7px" }}>{selectedFqn}</span>
                <button onClick={() => setSelectedFqn(null)}
                  style={{ fontSize: 11, color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer" }}>
                  × remove scope
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <Input icon="message-square" value={nl} onChange={setNl}
                placeholder='Try: "revenue should never be negative" or "every order needs a valid customer"' style={{ flex: 1 }}
                onKeyDown={e => { if (e.key === "Enter") convertNl(); }} />
              <Button variant="primary" icon="sparkles" disabled={nlLoading} onClick={() => convertNl()}>
                {nlLoading ? "Converting…" : "Convert to rule"}
              </Button>
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
              {["revenue should never be negative", "emails must be valid format", "order_id must be unique"].map(s => (
                <button key={s} onClick={() => { setNl(s); convertNl(s); }}
                  style={{ fontSize: 11.5, color: "var(--fg-2)", background: "#fff",
                    border: "1px solid var(--grey-200)", borderRadius: 999, padding: "4px 11px", cursor: "pointer" }}>
                  {s}
                </button>
              ))}
            </div>

            {generated && (
              <div ref={nlResultRef} className="dt-fade-up" style={{ marginTop: 16, background: "#fff", borderRadius: 12,
                border: "1px solid var(--grey-200)", padding: 18 }}>
                <Eyebrow style={{ marginBottom: 12 }}>Generated rule — review before approving</Eyebrow>
                {generated.unresolved && (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 14,
                    padding: "10px 12px", background: "var(--red-50)", border: "1px solid var(--red-200)", borderRadius: 8 }}>
                    <i data-lucide="alert-triangle" style={{ width: 15, height: 15, color: "var(--red-600)", flexShrink: 0, marginTop: 1 }}></i>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--red-700)" }}>Could not verify this rule against the real schema</div>
                      <div style={{ fontSize: 12, color: "var(--red-700)", marginTop: 2 }}>
                        {generated.unresolvedReason || "The AI could not confidently match this request to a real column or the request was ambiguous. Review the expression carefully before approving."}
                      </div>
                    </div>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "110px 1fr",
                  rowGap: 10, columnGap: 14, fontSize: 13, alignItems: "start" }}>
                  <span style={{ color: "var(--fg-3)", paddingTop: 2 }}>Rule name</span>
                  <Mono style={{ fontWeight: 700, wordBreak: "break-word" }}>{generated.name}</Mono>
                  <span style={{ color: "var(--fg-3)", paddingTop: 2 }}>Table</span>
                  {(generated.table_fqn || selectedFqn)
                    ? <Mono style={{ wordBreak: "break-all" }}>{generated.table_fqn || selectedFqn}</Mono>
                    : <span style={{ color: "var(--yellow-800)", fontWeight: 600 }}>Unresolved — select a table before approving</span>}
                  <span style={{ color: "var(--fg-3)", paddingTop: 8 }}>Expression</span>
                  {genEditingExpr ? (
                    <textarea value={genExprDraft} onChange={e => setGenExprDraft(e.target.value)}
                      rows={2} style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
                        padding: "7px 10px", borderRadius: 6, border: "1px solid var(--brand)",
                        outline: "none", boxShadow: "0 0 0 3px var(--brand-ring)", resize: "vertical" }} />
                  ) : (
                    <Mono style={{ background: "var(--grey-50)", padding: "6px 10px", borderRadius: 6,
                      whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "anywhere",
                      color: (generated.refine || generated.expr) ? undefined : "var(--fg-3)", fontStyle: (generated.refine || generated.expr) ? undefined : "italic" }}>
                      {generated.refine || generated.expr || "No expression could be generated for this request — click \"Edit expression\" to write one manually."}
                    </Mono>
                  )}
                  <span style={{ color: "var(--fg-3)", paddingTop: 2 }}>Severity</span>
                  <span style={{ paddingTop: 2 }}><Severity level={generated.sev} size="sm" /></span>
                  <span style={{ color: "var(--fg-3)", paddingTop: 2 }}>CDE impact</span>
                  <span style={{ paddingTop: 2 }}>{generated.cde
                    ? <Chip intent="brand" size="sm" dot>YES — CDE</Chip>
                    : <span style={{ color: "var(--fg-2)" }}>No</span>}
                  </span>
                </div>
                <div style={{ marginTop: 14, padding: 12, background: "var(--blue-50)", borderRadius: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
                    <i data-lucide="lightbulb" style={{ width: 14, height: 14, color: "var(--brand)" }}></i>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--brand)", letterSpacing: ".03em" }}>WHY THIS RULE MAKES SENSE</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--fg-1)", lineHeight: 1.55 }}>{generated.why}</div>
                  {generated.refine && (
                    <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 8 }}>
                      <strong>Suggested refinement:</strong> <Mono>{generated.refine}</Mono>
                    </div>
                  )}
                </div>
                <div style={{ marginTop: 14 }}>
                  {/* Both button groups stay mounted at all times — only visibility toggles via CSS.
                      Conditionally unmounting icon-bearing <Button icon="..."> elements here crashes
                      the screen (React removeChild error) because lucide.createIcons() (shell.jsx)
                      replaces their <i data-lucide> children with raw <svg> nodes outside React's
                      tracking; if React later tries to remove that same <i> node during an unmount,
                      the DOM no longer has it where React expects. See ScreenErrorBoundary comment. */}
                  <div style={{ display: genEditingExpr ? "flex" : "none", gap: 8 }}>
                    <Button variant="primary" onClick={() => {
                      setGenerated(g => ({ ...g, expr: genExprDraft, refine: null }));
                      setGenEditingExpr(false);
                    }}>Save expression</Button>
                    <Button variant="ghost" onClick={() => setGenEditingExpr(false)}>Cancel</Button>
                  </div>
                  <div style={{ display: genEditingExpr ? "none" : "flex", gap: 8, alignItems: "center" }}>
                    <Button variant="primary" icon={isAdmin ? "check" : "save"}
                      disabled={!(generated.refine || generated.expr)}
                      onClick={() => {
                        const expr = generated.refine || generated.expr;
                        const tempId = 100 + customRules.length;
                        // Dual control always blocks a non-admin from approving their own
                        // NL-generated rule (created_by is server-set to this user), so don't
                        // claim "approved" optimistically for non-admins — it will never
                        // succeed. Save it as a draft and say so plainly.
                        setCustomRules(c => [...c, {
                          id: tempId, name: generated.name, expr, layer: "SILVER",
                          sev: generated.sev, by: "NL", status: isAdmin ? "approved" : "draft",
                          ruleType: "CUSTOM", tableFqn: generated.table_fqn || selectedFqn || "",
                          col: generated.col || "", cde: generated.cde || false, why: generated.why || "",
                        }]);
                        setGenerated(null);
                        toast(isAdmin ? `Rule ${generated.name} approved & added` : `Rule ${generated.name} saved as a draft — ask a teammate to review and approve it`,
                          { kind: isAdmin ? "success" : "info" });
                        if (window.DTApi?.createRule && activeConnectionId) {
                          window.DTApi.createRule({
                            rule_id: "", connection_id: activeConnectionId,
                            rule_name: generated.name, rule_description: generated.why || "",
                            table_fqn: generated.table_fqn || selectedFqn || null, layer: "SILVER",
                            column_name: generated.col || null, rule_expression: expr,
                            rule_type: "CUSTOM", severity: generated.sev,
                            is_cde_rule: generated.cde || false, status: "draft",
                            nl_source: nl, created_by: "user",
                          }).then(r => {
                            if (isAdmin && r?.rule_id && window.DTApi?.decideRule) {
                              return window.DTApi.decideRule(r.rule_id, { decision: "approve", decided_by: "user" });
                            }
                          }).then(() => {
                            // The rule now exists in the DB (apiRules) — drop the local placeholder
                            // so it doesn't render as a duplicate alongside the persisted copy.
                            setCustomRules(c => c.filter(x => x.id !== tempId));
                            loadData();
                          }).catch(err => {
                            // createRule succeeds even when the follow-up decideRule (auto-approve)
                            // is rejected — e.g. the backend's dual-control check blocks a user from
                            // approving their own AI/NL-generated rule. Drop the local "approved"
                            // placeholder and reload so the rule shows up correctly as a pending
                            // draft (its real, persisted state) instead of falsely reading "Approved".
                            setCustomRules(c => c.filter(x => x.id !== tempId));
                            loadData();
                            toast(`Rule saved as a draft, but could not auto-approve: ${(err?.message || "error").replace(/^API \d+: /, "")}`, { kind: "error" });
                          });
                        }
                      }}>{isAdmin ? (generated.refine ? "Approve with refinement" : "Approve & add") : "Save as draft"}</Button>
                      <Button variant="soft" icon="pencil" onClick={() => {
                        setGenExprDraft(generated.refine || generated.expr);
                        setGenEditingExpr(true);
                      }}>Edit expression</Button>
                    <Button variant="ghost" onClick={() => setGenerated(null)}>Reject</Button>
                    {!(generated.refine || generated.expr) && (
                      <span style={{ fontSize: 11.5, color: "var(--red-600)" }}>
                        Write an expression before saving — the AI didn't generate one for this request.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Bulk action bar — appears once rules are checked via the row selection
              boxes, matching the Dictionary/CDE module's bulk-select pattern. */}
          {selectedRuleIds.size > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
              borderRadius: 8, background: "var(--brand-ring)", border: "1px solid var(--brand)",
              marginBottom: 16, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)" }}>
                {selectedRuleIds.size} selected
              </span>
              <Button size="sm" variant="soft" onClick={() => bulkDecideSelected("approved")}>Approve selected</Button>
              <Button size="sm" variant="soft" onClick={() => bulkDecideSelected("rejected")}>Reject selected</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedRuleIds(new Set())}>Clear</Button>
            </div>
          )}

          {/* Loading state — first paint after navigation/connection switch. Renders
              INSTEAD of the empty states below: flashing "No rules yet" (or a stale
              count) while the fetch is in flight tells the user something false. */}
          {rulesLoading && (
            <Card style={{ marginBottom: 16, textAlign: "center", padding: 40 }}>
              <span className="dt-spin" style={{ width: 22, height: 22, border: "2.5px solid var(--brand-ring)",
                borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", marginBottom: 12 }}></span>
              <div style={{ color: "var(--fg-3)", fontSize: 13 }}>Loading rules…</div>
            </Card>
          )}

          {/* Empty state */}
          {!rulesLoading && (() => {
            const hasActiveFilters = hasFilters;
            if (visibleRules.length === 0 && allRules.length > 0 && hasActiveFilters) {
              // Filters/search excluded everything — distinct from "no rules exist yet for
              // this table," which previously reused this same blank space with no message
              // at all whenever a table wasn't selected (or filters were the actual cause).
              return (
                <Card style={{ marginBottom: 16, textAlign: "center", padding: "44px 24px" }}>
                  <div style={{ fontSize: 30, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>No rules match your filters</div>
                  <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 20 }}>
                    Try clearing the layer, status, type, or search filters.
                  </div>
                  <Button variant="soft" onClick={() => { setFLayer("ALL"); setFilterStatus("ALL"); setFilterType("ALL"); setSearchText(""); }}>
                    Clear filters
                  </Button>
                </Card>
              );
            }
            if (selectedFqn && visibleRules.length === 0 && !hasActiveFilters) {
              return (
                <Card style={{ marginBottom: 16, textAlign: "center", padding: "44px 24px" }}>
                  <div style={{ fontSize: 30, marginBottom: 12 }}>🔍</div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>No rules yet for {selectedName}</div>
                  <div style={{ fontSize: 13, color: "var(--fg-2)", marginBottom: 20, maxWidth: 380, margin: "0 auto 20px" }}>
                    {generatingFor === selectedFqn
                      ? "Generating AI rule suggestions from the profiling report…"
                      : "Click Generate rules to get AI suggestions based on the profiling report, or describe a rule in plain English in the AI converter above."}
                  </div>
                  {generatingFor === selectedFqn
                    ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        fontSize: 13, color: "var(--brand)", fontWeight: 600 }}>
                        <span className="dt-spin" style={{ width: 14, height: 14, border: "2px solid var(--brand-ring)",
                          borderTopColor: "var(--brand)", borderRadius: "50%" }}></span>
                        Generating…
                      </div>
                    : <Button variant="primary" onClick={() => generateRules(selectedFqn)} disabled={!!generatingFor}>
                        Generate rules for {selectedName}
                      </Button>
                  }
                </Card>
              );
            }
            return null;
          })()}

          {/* Rule list */}
          {visibleRules.length > 0 && (
            <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 20px",
                background: "var(--grey-50)", borderBottom: "1px solid var(--grey-100)" }}>
                <input type="checkbox"
                  checked={visibleRules.length > 0 && visibleRules.every(r => selectedRuleIds.has(r.id))}
                  onChange={e => setSelectedRuleIds(e.target.checked ? new Set(visibleRules.map(r => r.id)) : new Set())} />
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)", letterSpacing: ".04em", textTransform: "uppercase" }}>
                  Select all
                </span>
              </div>
              {visibleRules.map((r, i) => {
                const st         = statusOf(r);
                const done       = st === "approved" || st === "active";
                const rejected   = st === "rejected";
                const snoozed    = st === "snoozed";
                const run        = runState[r.id];
                const rtStyle    = RULE_TYPE[r.ruleType] || RULE_TYPE.CUSTOM;
                const isSnoozePicking = snoozeId === r.id;
                // Dual control: the backend blocks approving a rule you created yourself
                // (unless you're an admin) — surface it here instead of only on failure.
                const isOwnRule = !isAdmin && !!r.createdBy && r.createdBy === currentUser.email;
                return (
                  <div key={r.id} style={{ padding: "14px 20px",
                    borderTop: i ? "1px solid var(--grey-100)" : "none",
                    background: rejected ? "var(--grey-50)" : done ? "var(--green-50)" : snoozed ? "var(--yellow-50)" : "transparent",
                    opacity: rejected ? 0.6 : 1 }}>
                    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <input type="checkbox" checked={selectedRuleIds.has(r.id)}
                        onChange={e => setSelectedRuleIds(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(r.id) : next.delete(r.id);
                          return next;
                        })}
                        style={{ marginTop: 4, flexShrink: 0 }} />
                      <span style={{ fontWeight: 800, fontSize: 12,
                        color: "var(--fg-3)", width: 22, flexShrink: 0, paddingTop: 3,
                        textAlign: "right", lineHeight: 1 }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Name + badges */}
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 7, flexWrap: "wrap", marginBottom: 4 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 600, wordBreak: "break-word", flex: "1 1 auto" }}>{r.name}</span>
                          <LayerPill layer={r.layer} size="sm" />
                          <Severity level={r.sev} size="sm" />
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                            background: rtStyle.bg, color: rtStyle.fg }}>{rtStyle.label}</span>
                          {r.cde && <Chip intent="brand" size="sm" dot>CDE</Chip>}
                          {/* Distinct from the generic FK/type chip above: rule_type alone doesn't
                              tell you whether a rule actually queries another table (a single-table
                              rule can also be rule_type="FK" for a self-contained check) — this only
                              renders when the backend's "[Cross-table: X]" tag was actually present. */}
                          {r.crossTableWith && (
                            <span title={`Checks this table against ${r.crossTableWith}`}
                              style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11,
                                fontWeight: 600, padding: "2px 7px", borderRadius: 4,
                                background: "var(--purple-50)", color: "var(--purple-700)" }}>
                              <i data-lucide="link-2" style={{ width: 11, height: 11 }}></i> Cross-table
                            </span>
                          )}
                          {snoozed && <Chip intent="warning" size="sm">Snoozed</Chip>}
                        </div>
                        {/* Table context */}
                        {r.tableFqn && (
                          <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginBottom: 5,
                            display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                            <i data-lucide="table-2" style={{ width: 11, height: 11 }}></i>
                            <span>{r.tableFqn}{r.col ? ` · ${r.col}` : ""}</span>
                            {r.crossTableWith && (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--purple-700)" }}>
                                <i data-lucide="arrow-right" style={{ width: 10, height: 10 }}></i>
                                <Mono style={{ fontSize: 11 }}>{r.crossTableWith}</Mono>
                              </span>
                            )}
                          </div>
                        )}
                        {/* Expression */}
                        {editId === r.id ? (
                          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                            <input value={exprDraft} onChange={e => setExprDraft(e.target.value)}
                              style={{ flex: 1, fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
                                padding: "7px 10px", borderRadius: 8, border: "1px solid var(--brand)",
                                outline: "none", boxShadow: "0 0 0 3px var(--brand-ring)" }} />
                            <Button size="sm" variant="primary" onClick={() => { setEditId(null); saveEdit(r.id, exprDraft); }}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Mono style={{ color: "var(--fg-2)", display: "block", background: "var(--grey-50)",
                            padding: "5px 10px", borderRadius: 6, marginTop: 2, fontSize: 12,
                            whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "anywhere" }}>{r.expr}</Mono>
                        )}
                        {/* Rationale */}
                        {r.why && editId !== r.id && (
                          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: 6,
                            padding: "6px 10px", background: "var(--blue-50)", borderRadius: 8 }}>
                            <i data-lucide="lightbulb" style={{ width: 12, height: 12, color: "var(--brand)",
                              flexShrink: 0, marginTop: 1 }}></i>
                            <span style={{ fontSize: 12, color: "var(--fg-1)", lineHeight: 1.5 }}>{r.why}</span>
                          </div>
                        )}
                        {/* Inline snooze picker */}
                        {isSnoozePicking && (
                          <div className="dt-fade-up" style={{ display: "flex", alignItems: "center", gap: 8,
                            marginTop: 8, padding: "8px 10px", background: "var(--yellow-50)",
                            borderRadius: 8, border: "1px solid var(--yellow-200)" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--yellow-800)" }}>Snooze until</span>
                            <input type="date" value={snoozeDate} min={_todayIso} onChange={e => setSnoozeDate(e.target.value)}
                              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6,
                                border: "1px solid var(--grey-200)", outline: "none" }} />
                            <Button size="sm" variant="primary" onClick={confirmSnooze} disabled={!snoozeDate || snoozeDate < _todayIso}>Confirm</Button>
                            <Button size="sm" variant="ghost" onClick={() => { setSnoozeId(null); setSnoozeDate(""); }}>Cancel</Button>
                          </div>
                        )}
                        {/* Run result */}
                        {run && (run === "running"
                          ? <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 8,
                              fontSize: 12, color: "var(--brand)", fontWeight: 600 }}>
                              <span className="dt-spin" style={{ width: 13, height: 13, border: "2px solid var(--brand-ring)",
                                borderTopColor: "var(--brand)", borderRadius: "50%" }}></span>
                              Running against live data…
                            </div>
                          : <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 8,
                              padding: "5px 12px", borderRadius: 8,
                              background: run.status === "PASS" ? "var(--green-50)" : run.status === "ERROR" ? "var(--yellow-50)" : "var(--red-50)" }}>
                              {run.status === "PASS"
                                ? <Chip intent="success" size="sm" icon="check">PASS</Chip>
                                : run.status === "ERROR"
                                  ? <Chip intent="warning" size="sm" icon="alert-triangle">ERROR</Chip>
                                  : <Chip intent="danger" size="sm" icon="x">FAIL</Chip>}
                              <span style={{ fontSize: 12, color: "var(--fg-2)" }}>
                                {run.status === "PASS" ? "0 violations"
                                  : run.status === "ERROR" ? (run.message || "execution error")
                                  : `${run.failCnt} violations · ${run.failPct}%`}
                              </span>
                              <span style={{ fontSize: 11, color: "var(--fg-3)" }}>· {run.ms}s</span>
                            </div>
                        )}
                      </div>
                      {/* Action buttons */}
                      <div style={{ flexShrink: 0, display: "flex", gap: 5, alignItems: "center" }}>
                        {editId !== r.id && (
                          <IconBtn icon="play" size={30} onClick={() => done && runOne(r)}
                            disabled={!done}
                            title={done ? "Run this rule" : "Not runnable yet — needs approval first"} />
                        )}
                        {done
                          ? <Chip intent="success" size="sm" icon="check">{st === "active" ? "Active" : "Approved"}</Chip>
                          : rejected
                            ? <Chip intent="neutral" size="sm">Rejected</Chip>
                            : snoozed
                              ? <Chip intent="warning" size="sm">Snoozed</Chip>
                              : editId !== r.id && (
                                <>
                                  <IconBtn icon="check" size={30} disabled={isOwnRule}
                                    title={isOwnRule ? "You created this rule — ask a teammate (or an admin) to review and approve it" : "Approve"}
                                    onClick={() => !isOwnRule && decide(r.id, "approved")} />
                                  <IconBtn icon="pencil" title="Edit" size={30} onClick={() => { setEditId(r.id); setExprDraft(r.expr); }} />
                                  <button title="Snooze"
                                    onClick={() => { setSnoozeId(isSnoozePicking ? null : r.id); setSnoozeDate(""); }}
                                    style={{ width: 30, height: 30, display: "flex", alignItems: "center",
                                      justifyContent: "center",
                                      background: isSnoozePicking ? "var(--yellow-50)" : "transparent",
                                      border: "1px solid var(--grey-200)", borderRadius: 6,
                                      cursor: "pointer", color: "var(--fg-2)" }}>
                                    <IcoClock />
                                  </button>
                                  <IconBtn icon="x" title="Reject" size={30} danger onClick={() => decide(r.id, "rejected")} />
                                </>
                              )
                        }
                      </div>
                    </div>
                  </div>
                );
              })}
            </Card>
          )}


          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" iconRight="arrow-right" onClick={() => go("execution")}>
              Activate rule set &amp; run checks
            </Button>
          </div>
        </div>
      </div>
    );
  };

  window.DTScreens.rules = Rules;
})();
