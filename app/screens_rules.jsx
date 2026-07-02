// DataTrust — Screen: Rule Studio + Natural Language → DQ converter
(function () {
  const D = window.DT;

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
    const { go, ruleDecisions, setRuleDecisions, customRules, setCustomRules, activeConnectionId, activeConnectionName, datasets } = useApp();

    const [apiRules, setApiRules]         = React.useState([]);
    const [sideCollapsed, setSideCollapsed] = React.useState({});
    const [selectedFqn, setSelectedFqn]   = React.useState(null);
    const [generatingFor, setGeneratingFor] = React.useState(null);
    const [generatingAll, setGeneratingAll] = React.useState(false);
    const [genAllProgress, setGenAllProgress] = React.useState({ done: 0, total: 0 });
    const [filterStatus, setFilterStatus] = React.useState("ALL");
    const [filterType, setFilterType]     = React.useState("ALL");
    const [fLayer, setFLayer]             = React.useState("ALL");
    const [searchText, setSearchText]     = React.useState("");
    const [snoozeId, setSnoozeId]         = React.useState(null);
    const [snoozeDate, setSnoozeDate]     = React.useState("");
    const [nl, setNl]                     = React.useState("A single order's net revenue should never exceed $25,000");
    const [generated, setGenerated]       = React.useState(null);
    const [nlLoading, setNlLoading]       = React.useState(false);
    const [editId, setEditId]             = React.useState(null);
    const [exprDraft, setExprDraft]       = React.useState("");
    const [runState, setRunState]         = React.useState({});
    const [genEditingExpr, setGenEditingExpr] = React.useState(false);
    const [genExprDraft, setGenExprDraft]     = React.useState("");
    const nlResultRef = React.useRef(null);
    useIcons();

    // Scroll NL result into view whenever it appears
    React.useEffect(() => {
      if (generated && nlResultRef.current) {
        nlResultRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      setGenEditingExpr(false);
      setGenExprDraft("");
    }, [generated]);

    const mapRule = (r, i) => ({
      id: r.rule_id || (i + 1),
      name: r.rule_name || r.name,
      expr: r.rule_expression || r.expr,
      note: r.rule_description,
      why: r.rationale || r.explanation || r.rule_description || "",
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
    });

    const loadData = React.useCallback(() => {
      if (!window.DTApi || !activeConnectionId) return;
      window.DTApi.listRules(activeConnectionId)
        .then(rows => { if (rows) setApiRules(rows.map(mapRule)); })
        .catch(() => {});
    }, [activeConnectionId]);

    React.useEffect(() => { loadData(); }, [loadData]);

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
        if (!acc[r.tableFqn]) acc[r.tableFqn] = { total: 0, approved: 0, pending: 0, cde: 0 };
        acc[r.tableFqn].total++;
        const st = ruleDecisions[r.id] || r.status;
        if (["approved", "active"].includes(st)) acc[r.tableFqn].approved++;
        if (st === "draft") acc[r.tableFqn].pending++;
        if (r.cde) acc[r.tableFqn].cde++;
        return acc;
      }, {})
    , [allRules, ruleDecisions]);

    const visibleRules = React.useMemo(() => {
      let rows = allRules;
      if (selectedFqn) rows = rows.filter(r => r.tableFqn === selectedFqn);
      if (fLayer !== "ALL") rows = rows.filter(r => r.layer === fLayer);
      if (filterStatus !== "ALL") rows = rows.filter(r => (ruleDecisions[r.id] || r.status) === filterStatus);
      if (filterType !== "ALL") rows = rows.filter(r => r.ruleType === filterType);
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

    const generateRules = async (fqn) => {
      if (generatingFor || generatingAll) return;
      setGeneratingFor(fqn);
      try {
        const report = await window.DTApi.getReportByTable(fqn, activeConnectionId);
        if (!report?.report_id) throw new Error("No profiling report — run Profiling first");
        const rules = await window.DTApi.recommendRules({ report_id: report.report_id, connection_id: activeConnectionId });
        // Immediately update rule list so results appear without waiting for full reload
        const fresh = await window.DTApi.listRules(activeConnectionId).catch(() => null);
        if (fresh) setApiRules(fresh.map(mapRule));
        setSelectedFqn(fqn);
        setFilterStatus("ALL");
      } catch (e) {
        toast(e.message.replace(/^API \d+: /, ""), { kind: "error" });
      } finally {
        setGeneratingFor(null);
      }
    };

    const generateAll = async () => {
      if (generatingAll || generatingFor) return;
      const eligible = [];
      sidebarGroups.forEach(g => g.tables.forEach(t => {
        if (t.profiled && !(rulesByTable[t.fqn]?.total > 0)) eligible.push(t);
      }));
      if (!eligible.length) {
        toast("No un-generated profiled tables found — run Profiling first", { kind: "info" });
        return;
      }
      setGeneratingAll(true);
      setGenAllProgress({ done: 0, total: eligible.length });
      const failedTables = [];
      for (let i = 0; i < eligible.length; i++) {
        const t = eligible[i];
        setGeneratingFor(t.fqn);
        try {
          const report = await window.DTApi.getReportByTable(t.fqn, activeConnectionId);
          if (report?.report_id) {
            await window.DTApi.recommendRules({ report_id: report.report_id, connection_id: activeConnectionId });
            // Refresh immediately so this table's rules appear in the list
            const fresh = await window.DTApi.listRules(activeConnectionId).catch(() => null);
            if (fresh) setApiRules(fresh.map(mapRule));
          }
        } catch (err) {
          failedTables.push({ fqn: t.fqn, message: (err?.message || "error").replace(/^API \d+: /, "") });
        }
        setGenAllProgress({ done: i + 1, total: eligible.length });
        await new Promise(r => setTimeout(r, 0));
      }
      setGeneratingFor(null);
      setGeneratingAll(false);
      setGenAllProgress({ done: 0, total: 0 });
      setFilterStatus("ALL");
      if (failedTables.length) {
        const names = failedTables.map(f => f.fqn.split(".").pop()).join(", ");
        toast(`${failedTables.length} of ${eligible.length} tables failed to generate rules (${names}) — ${failedTables[0].message}`, { kind: "error" });
      }
      loadData();
    };

    const _toDecisionVerb = (d) => ({ approved: "approve", rejected: "reject", active: "approve" }[d] || d);

    const decide = (id, d) => {
      setRuleDecisions(x => ({ ...x, [id]: d }));
      toast(`Rule ${d} · logged to audit trail`, { kind: d === "rejected" ? "info" : "success" });
      if (window.DTApi?.decideRule) {
        window.DTApi.decideRule(id, { decision: _toDecisionVerb(d), decided_by: "user" })
          .then(() => loadData())
          .catch(err => toast("Could not save decision: " + (err?.message || "error"), { kind: "error" }));
      }
    };

    const statusOf = (r) => ruleDecisions[r.id] || r.status;

    const confirmSnooze = () => {
      if (!snoozeDate) return;
      setRuleDecisions(x => ({ ...x, [snoozeId]: "snoozed" }));
      toast(`Rule #${snoozeId} snoozed until ${snoozeDate}`, { kind: "info" });
      if (window.DTApi?.decideRule) {
        window.DTApi.decideRule(snoozeId, {
          decision: "snooze",
          snooze_until: new Date(snoozeDate).toISOString(),
          decided_by: "user",
        }).then(() => loadData()).catch(() => {});
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

    const pillSt = (active) => ({
      background: active ? "var(--brand-soft)" : "#fff",
      color: active ? "var(--brand)" : "var(--fg-2)",
      border: `1px solid ${active ? "var(--brand-ring)" : "var(--grey-200)"}`,
      borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
    });

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
                  const cov = rulesByTable[t.fqn] || { total: 0, pending: 0, approved: 0 };
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
                        {t.profiled && (
                          <button onClick={() => generateRules(t.fqn)} disabled={!!generatingFor || generatingAll}
                            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                              color: isGenerating ? "var(--fg-3)" : "var(--brand)",
                              background: "transparent", border: "1px solid var(--brand-ring)",
                              borderRadius: 999, padding: "2px 8px",
                              cursor: (generatingFor || generatingAll) ? "not-allowed" : "pointer",
                              opacity: (generatingFor || generatingAll) && !isGenerating ? 0.45 : 1 }}>
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

          {/* Header card */}
          <Card style={{ marginBottom: 16 }}>
            <SectionTitle icon="shield-check"
              sub={`${allRules.length} rules · every rule needs explicit human review before activating.`}
              right={
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Chip intent="warning" size="sm">{pendingCount} pending</Chip>
                  <Chip intent="brand" dot>{approvedCount} active</Chip>
                </div>
              }>
              Rule Studio{activeConnectionName ? ` — ${activeConnectionName}` : ""}
            </SectionTitle>

            {/* Filter rows */}
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Eyebrow style={{ marginRight: 2 }}>Layer</Eyebrow>
                {["ALL","RAW","BRONZE","SILVER","GOLD"].map(l => (
                  <button key={l} onClick={() => setFLayer(l)} style={pillSt(fLayer === l)}>{l}</button>
                ))}
                <div style={{ width: 1, height: 16, background: "var(--grey-200)", margin: "0 4px" }}></div>
                <Eyebrow style={{ marginRight: 2 }}>Status</Eyebrow>
                {[["ALL","All"],["draft","Pending"],["approved","Approved"],["active","Active"],["snoozed","Snoozed"],["rejected","Rejected"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setFilterStatus(val)} style={pillSt(filterStatus === val)}>{lbl}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Eyebrow style={{ marginRight: 2 }}>Type</Eyebrow>
                {[["ALL","All"],["NULL_CHECK","Null"],["RANGE","Range"],["FORMAT","Format"],["FK","FK"],["VOLUME","Volume"],["CUSTOM","Custom"]].map(([val, lbl]) => (
                  <button key={val} onClick={() => setFilterType(val)} style={pillSt(filterType === val)}>{lbl}</button>
                ))}
                <div style={{ flex: 1 }}></div>
                <input value={searchText} onChange={e => setSearchText(e.target.value)}
                  placeholder="Search rules…"
                  style={{ fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid var(--grey-200)",
                    outline: "none", width: 160, color: "var(--fg-1)", background: "#fff" }} />
              </div>
            </div>

            {/* Action row */}
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              {selectedFqn && (
                <Button size="sm" variant="primary" disabled={!!generatingFor || generatingAll} onClick={() => generateRules(selectedFqn)}>
                  {generatingFor === selectedFqn ? "Generating…" : `Generate rules for ${selectedName}`}
                </Button>
              )}
              <Button size="sm" variant="primary" icon="sparkles"
                disabled={generatingAll || !!generatingFor} onClick={generateAll}>
                {generatingAll
                  ? `Generating… ${genAllProgress.done}/${genAllProgress.total}`
                  : "Generate all tables"}
              </Button>
              {generatingAll && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand)" }}>
                  <span className="dt-spin" style={{ width: 12, height: 12, border: "2px solid var(--brand-ring)",
                    borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }}></span>
                  <span>{generatingFor ? `Processing ${generatingFor.split(".").pop()}…` : "Starting…"}</span>
                </div>
              )}
              <Button size="sm" variant="soft" icon="circle-play" onClick={() => runLayer(fLayer)}>
                Run {fLayer === "ALL" ? "all" : fLayer}
              </Button>
              <Button size="sm" variant="soft" icon="check-check" onClick={async () => {
                const lowRules = allRules.filter(r => r.sev === "LOW" && statusOf(r) === "draft");
                if (!lowRules.length) { toast("No pending LOW-severity rules to approve", { kind: "info" }); return; }
                if (!window.DTApi?.decideRule) return;
                const outcomes = await Promise.allSettled(
                  lowRules.map(r => window.DTApi.decideRule(r.id, { decision: "approve", decided_by: "user" }))
                );
                const succeeded = lowRules.filter((_, i) => outcomes[i].status === "fulfilled");
                succeeded.forEach(r => setRuleDecisions(x => ({ ...x, [r.id]: "approved" })));
                const failedCount = lowRules.length - succeeded.length;
                const noun = (n) => `rule${n === 1 ? "" : "s"}`;
                toast(
                  failedCount > 0
                    ? `${succeeded.length} of ${lowRules.length} LOW-severity ${noun(lowRules.length)} approved — ${failedCount} failed, please retry`
                    : `${succeeded.length} LOW-severity ${noun(succeeded.length)} approved`,
                  { kind: failedCount > 0 ? "error" : "success" }
                );
                loadData();
              }}>Bulk approve LOW</Button>
            </div>
          </Card>

          {/* Empty state */}
          {(() => {
            const hasActiveFilters = fLayer !== "ALL" || filterStatus !== "ALL" || filterType !== "ALL" || !!searchText;
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
                      : "Click Generate rules to get AI suggestions based on the profiling report, or use the NL converter below."}
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
              {visibleRules.map((r, i) => {
                const st         = statusOf(r);
                const done       = st === "approved" || st === "active";
                const rejected   = st === "rejected";
                const snoozed    = st === "snoozed";
                const run        = runState[r.id];
                const rtStyle    = RULE_TYPE[r.ruleType] || RULE_TYPE.CUSTOM;
                const isSnoozePicking = snoozeId === r.id;
                return (
                  <div key={r.id} style={{ padding: "14px 20px",
                    borderTop: i ? "1px solid var(--grey-100)" : "none",
                    background: rejected ? "var(--grey-50)" : done ? "var(--green-50)" : snoozed ? "var(--yellow-50)" : "transparent",
                    opacity: rejected ? 0.6 : 1 }}>
                    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
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
                          {snoozed && <Chip intent="warning" size="sm">Snoozed</Chip>}
                        </div>
                        {/* Table context */}
                        {r.tableFqn && (
                          <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginBottom: 5,
                            display: "flex", alignItems: "center", gap: 5 }}>
                            <i data-lucide="table-2" style={{ width: 11, height: 11 }}></i>
                            <span>{r.tableFqn}{r.col ? ` · ${r.col}` : ""}</span>
                          </div>
                        )}
                        {/* Expression */}
                        {editId === r.id ? (
                          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                            <input value={exprDraft} onChange={e => setExprDraft(e.target.value)}
                              style={{ flex: 1, fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
                                padding: "7px 10px", borderRadius: 8, border: "1px solid var(--brand)",
                                outline: "none", boxShadow: "0 0 0 3px var(--brand-ring)" }} />
                            <Button size="sm" variant="primary" onClick={() => { setEditId(null); decide(r.id, "approved"); }}>Save</Button>
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
                            <input type="date" value={snoozeDate} onChange={e => setSnoozeDate(e.target.value)}
                              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6,
                                border: "1px solid var(--grey-200)", outline: "none" }} />
                            <Button size="sm" variant="primary" onClick={confirmSnooze} disabled={!snoozeDate}>Confirm</Button>
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
                            title={done ? "Run this rule" : "Approve this rule before running it against live data"} />
                        )}
                        {done
                          ? <Chip intent="success" size="sm" icon="check">{st === "active" ? "Active" : "Approved"}</Chip>
                          : rejected
                            ? <Chip intent="neutral" size="sm">Rejected</Chip>
                            : snoozed
                              ? <Chip intent="warning" size="sm">Snoozed</Chip>
                              : editId !== r.id && (
                                <>
                                  <IconBtn icon="check" title="Approve" size={30} onClick={() => decide(r.id, "approved")} />
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

          {/* NL → DQ converter */}
          <Card style={{ marginBottom: 16, border: "1px solid var(--brand-ring)", background: "linear-gradient(180deg, var(--blue-50), #fff)" }}>
            <SectionTitle icon="wand-2"
              sub="Type a plain-English quality expectation. The agent converts it into a structured, reviewable DQ rule.">
              Natural language → DQ rule
            </SectionTitle>
            {selectedFqn && (
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Scoped to</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--brand)",
                  background: "var(--brand-soft)", borderRadius: 4, padding: "2px 7px" }}>{selectedFqn}</span>
                <button onClick={() => setSelectedFqn(null)}
                  style={{ fontSize: 11, color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer" }}>
                  × remove scope
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <Input icon="message-square" value={nl} onChange={setNl}
                placeholder="e.g. revenue should never be negative" style={{ flex: 1 }}
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
                      whiteSpace: "pre-wrap", wordBreak: "break-all", overflowWrap: "anywhere" }}>{generated.refine || generated.expr}</Mono>
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
                  <div style={{ display: genEditingExpr ? "none" : "flex", gap: 8 }}>
                    <Button variant="primary" icon="check" onClick={() => {
                        const expr = generated.refine || generated.expr;
                        const tempId = 100 + customRules.length;
                        setCustomRules(c => [...c, {
                          id: tempId, name: generated.name, expr, layer: "SILVER",
                          sev: generated.sev, by: "NL", status: "approved",
                          ruleType: "CUSTOM", tableFqn: generated.table_fqn || selectedFqn || "",
                          col: generated.col || "", cde: generated.cde || false, why: generated.why || "",
                        }]);
                        setGenerated(null);
                        toast(`Rule ${generated.name} approved & added`, { kind: "success" });
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
                            if (r?.rule_id && window.DTApi?.decideRule) {
                              return window.DTApi.decideRule(r.rule_id, { decision: "approve", decided_by: "user" });
                            }
                          }).then(() => {
                            // The rule now exists in the DB (apiRules) — drop the local placeholder
                            // so it doesn't render as a duplicate alongside the persisted copy.
                            setCustomRules(c => c.filter(x => x.id !== tempId));
                            loadData();
                          }).catch(err => {
                            toast(`Could not save the rule to the database: ${(err?.message || "error").replace(/^API \d+: /, "")}`, { kind: "error" });
                          });
                        }
                      }}>{generated.refine ? "Approve with refinement" : "Approve & add"}</Button>
                      <Button variant="soft" icon="pencil" onClick={() => {
                        setGenExprDraft(generated.refine || generated.expr);
                        setGenEditingExpr(true);
                      }}>Edit expression</Button>
                    <Button variant="ghost" onClick={() => setGenerated(null)}>Reject</Button>
                  </div>
                </div>
              </div>
            )}
          </Card>

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
