// DataTrust — Screens: Pre-run Advisory + Trust Receipt
(function () {

  // ---------------- Pre-run Advisory ----------------
  const ADVISORY_STALE_H = 24;
  const Advisory = () => {
    const { go, activeConnectionId } = useApp();
    const [decision, setDecision] = React.useState(null);
    const [advisory, setAdvisory] = React.useState(null);
    const [generating, setGenerating] = React.useState(false);
    const [loadState, setLoadState] = React.useState("loading"); // loading | ready | error | noconn
    useIcons();

    const fromApi = (data) => ({
      predicted: data.predicted_score ?? 0,
      reasons: data.risk_reasons ?? [],
      rec: data.recommendation ?? "—",
      advisory_time: data.advisory_time ?? "—",
      generatedAt: data.generated_at ? new Date(data.generated_at.replace(" ", "T")) : null,
      generatedBy: data.generated_by || null,
    });

    const generate = async () => {
      if (!activeConnectionId || generating) return;
      setGenerating(true);
      try {
        const data = await window.DTApi.generateAdvisory(activeConnectionId);
        setAdvisory(fromApi(data));
        setDecision(null);
        setLoadState("ready");
        toast("Fresh advisory generated from live signals", { kind: "success" });
      } catch (_) {
        toast("Advisory generation failed — backend unreachable or LLM error", { kind: "error" });
        setLoadState(s => (s === "loading" ? "error" : s));
      }
      setGenerating(false);
    };

    React.useEffect(() => {
      if (!window.DTApi?.getAdvisory) return;
      setAdvisory(null); setDecision(null);
      if (!activeConnectionId) { setLoadState("noconn"); return; }
      setLoadState("loading");
      window.DTApi.getAdvisory(activeConnectionId)
        .then(data => {
          if (!data || data.advisory_id === "none") {
            // Never generated for this connection — derive one now, automatically.
            generate();
            return;
          }
          const adv = fromApi(data);
          setAdvisory(adv);
          setLoadState("ready");
          // Auto-refresh when stale: a pre-RUN advisory from two days ago is
          // worse than none — it confidently describes yesterday's world.
          if (adv.generatedAt && (Date.now() - adv.generatedAt.getTime()) > ADVISORY_STALE_H * 3600e3) {
            generate();
          }
        })
        .catch(() => setLoadState("error"));
    }, [activeConnectionId]);

    const ageLabel = advisory?.generatedAt
      ? (() => {
          const h = (Date.now() - advisory.generatedAt.getTime()) / 3600e3;
          return h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
        })()
      : null;

    if (loadState === "noconn") return (
      <Card style={{ margin: 24, fontSize: 13, color: "var(--fg-3)" }}>Select a connection to see its pre-run advisory.</Card>
    );
    if (loadState === "error" && !advisory) return (
      <Card style={{ margin: 24, fontSize: 13, color: "var(--red-600)", display: "flex", gap: 10, alignItems: "center" }}>
        Failed to load the advisory.
        <Button size="sm" variant="outline" onClick={generate} disabled={generating}>{generating ? "Generating…" : "Try generating one"}</Button>
      </Card>
    );
    if (!advisory) return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
        <span className="dt-spin" style={{ width: 14, height: 14, marginRight: 8, borderRadius: "50%", display: "inline-block", border: "2px solid var(--grey-200)", borderTopColor: "var(--fg-3)", verticalAlign: "-2px" }}></span>
        {generating ? "Analyzing live signals — failures, volume trends, anomaly history…" : "Loading advisory…"}
      </div>
    );
    const a = advisory;
    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="cloud-lightning" sub="The only genuinely proactive layer: before the pipeline even runs, predict today's trust score from live signals — and recommend whether to proceed."
            right={
              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                {a.generatedBy && (
                  <span title={a.generatedBy === "ai" ? "Risk narrative written by the LLM from measured signals" : "LLM unavailable — deterministic narrative from the same measured signals"}>
                    <Chip size="sm" intent={a.generatedBy === "ai" ? "brand" : "neutral"}>{a.generatedBy === "ai" ? "AI-generated" : "heuristic"}</Chip>
                  </span>
                )}
                {ageLabel && <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>generated {ageLabel}</span>}
                <Button size="sm" variant="outline" icon="refresh-cw" onClick={generate} disabled={generating}>
                  {generating ? "Analyzing…" : "Refresh advisory"}
                </Button>
              </span>
            }>Pre-run advisory</SectionTitle>
        </Card>

        <Card style={{ marginBottom: 16, border: "1px solid var(--yellow-300)", background: "linear-gradient(180deg, var(--yellow-50), #fff)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
            <ScoreRing score={a.predicted} size={104} stroke={10} sublabel="predicted" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Mono style={{ fontSize: 12, color: "var(--fg-2)" }}>{a.advisory_time || "—"}</Mono>
                <Chip intent="warning" dot>Before Bronze pipeline start</Chip>
              </div>
              <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 18, margin: "8px 0 4px" }}>Predicted trust score for today's run: <span style={{ color: a.predicted < 85 ? "var(--yellow-700)" : "var(--green-600)" }}>{a.predicted}/100</span></div>
              <div style={{ fontSize: 13, color: "var(--fg-2)" }}>
                {a.predicted < 85
                  ? "Below the 85 healthy threshold. Review the risk signals before launching the pipeline."
                  : "At or above the 85 healthy threshold — no elevated risk predicted for this run."}
              </div>
            </div>
          </div>

          <Eyebrow style={{ marginBottom: 10 }}>Why the risk</Eyebrow>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
            {a.reasons.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: 12, background: "#fff", borderRadius: 10, border: "1px solid var(--grey-100)" }}>
                <Chip intent={r.risk === "high" ? "danger" : "warning"} size="sm" variant="fill">{r.risk === "high" ? "High risk" : "Medium"}</Chip>
                <div style={{ flex: 1, fontSize: 13, color: "var(--fg-1)", lineHeight: 1.55 }}>{r.text}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: 14, background: "var(--blue-50)", borderRadius: 10, borderLeft: "3px solid var(--brand)", marginBottom: 18 }}>
            <Eyebrow color="var(--brand)" style={{ marginBottom: 5 }}>Recommendation</Eyebrow>
            <div style={{ fontSize: 13.5, color: "var(--fg-1)", lineHeight: 1.55 }}>{a.rec}</div>
          </div>

          {decision ? (
            <div style={{ padding: 14, borderRadius: 10, background: decision === "hold" ? "var(--green-50)" : decision === "proceed" ? "var(--red-50)" : "var(--blue-50)", display: "flex", alignItems: "center", gap: 10 }}>
              <i data-lucide={decision === "hold" ? "check-circle-2" : decision === "proceed" ? "alert-triangle" : "bell"} style={{ width: 18, height: 18, color: decision === "hold" ? "var(--green-500)" : decision === "proceed" ? "var(--red-500)" : "var(--brand)" }}></i>
              <div style={{ flex: 1, fontSize: 13 }}>
                {/* No pipeline-scheduling or paging integration exists yet in this build — these
                    decisions are recorded as your acknowledgment of the advisory, not a real
                    hold/alert action taken against any external system. Don't claim otherwise. */}
                {decision === "hold" && <span><strong>Hold acknowledged.</strong> This isn't wired to a pipeline scheduler yet — pause the run manually in your orchestrator if you intend to wait.</span>}
                {decision === "proceed" && <span><strong>Proceeding acknowledged.</strong> You're launching this run despite the advisory above — check back after the run to see what happened.</span>}
                {decision === "alert" && <span><strong>Alert acknowledged.</strong> No paging integration is configured yet — notify the pipeline owner directly.</span>}
              </div>
              {decision === "proceed" && <Button size="sm" variant="outline" onClick={() => go("impact")}>See what broke</Button>}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="primary" icon="pause" onClick={() => { setDecision("hold"); toast("Hold acknowledged", { kind: "success" }); }}>Hold pipeline</Button>
              <Button variant="soft" icon="play" onClick={() => { setDecision("proceed"); toast("Proceeding against advisory", { kind: "warning" }); }}>Proceed anyway</Button>
              <Button variant="ghost" icon="bell" onClick={() => { setDecision("alert"); toast("Alert acknowledged", { kind: "info" }); }}>Alert owner</Button>
            </div>
          )}
        </Card>
      </div>
    );
  };

  // ---------------- Trust Receipt ----------------
  const ST = { ok: ["var(--green-500)", "check-circle-2"], warn: ["var(--yellow-600)", "alert-triangle"], fail: ["var(--red-500)", "x-circle"] };
  const Receipt = () => {
    const { go, activeConnectionId } = useApp();
    const [receipt, setReceipt] = React.useState(null);
    const [tables, setTables] = React.useState([]);
    const [pickedTable, setPickedTable] = React.useState("");
    const [generating, setGenerating] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    useIcons();

    const fromApi = (data) => ({
      query:     data.query_text,
      at:        data.executed_at,
      by:        data.executed_by,
      rows:      data.row_count,
      score:     data.trust_score,
      fields:    data.fields || [],
      rec:       data.recommendation,
      lastClean: data.last_clean_snapshot,
      table:     data.table_fqn,
    });

    React.useEffect(() => {
      if (!window.DTApi?.getReceipt) return;
      setReceipt(null); setTables([]); setPickedTable(""); setLoading(true);
      Promise.all([
        window.DTApi.getReceipt(activeConnectionId).catch(() => null),
        activeConnectionId && window.DTApi.getReceiptTables
          ? window.DTApi.getReceiptTables(activeConnectionId).catch(() => [])
          : Promise.resolve([]),
      ]).then(([data, tbls]) => {
        if (data && data.receipt_id !== "none") setReceipt(fromApi(data));
        setTables(tbls || []);
        if (tbls && tbls.length) setPickedTable((data && data.receipt_id !== "none" && data.table_fqn) || tbls[0].table_fqn);
        setLoading(false);
      });
    }, [activeConnectionId]);

    const generate = async () => {
      if (!pickedTable || generating) return;
      setGenerating(true);
      try {
        const data = await window.DTApi.generateReceipt(activeConnectionId, pickedTable);
        setReceipt(fromApi(data));
        toast(`Receipt generated for ${pickedTable}`, { kind: "success" });
      } catch (e) {
        toast(e?.message || "Receipt generation failed", { kind: "error" });
      }
      setGenerating(false);
    };

    const picker = (
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle icon="receipt-text" sub="A nutrition label for a table you're about to use: per-column verdicts from live rule results, profiling, open anomalies, and upstream feed health — plus what to do about it.">Data trust receipt</SectionTitle>
        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
          {tables.length > 0 ? (
            <>
              <span style={{ fontSize: 12.5, color: "var(--fg-2)" }}>Which table are you about to use?</span>
              <select value={pickedTable} onChange={e => setPickedTable(e.target.value)}
                style={{ fontSize: 12.5, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--grey-200)", minWidth: 240, color: "var(--fg-1)", background: "var(--bg-1, #fff)" }}>
                {tables.map(t => <option key={t.table_fqn} value={t.table_fqn}>{t.table_fqn} ({t.layer || "?"})</option>)}
              </select>
              <Button variant="primary" icon="receipt-text" onClick={generate} disabled={generating || !pickedTable}>
                {generating ? "Checking the table…" : "Generate receipt"}
              </Button>
            </>
          ) : !loading && (
            <span style={{ fontSize: 12.5, color: "var(--fg-3)" }}>No profiled tables on this connection yet — run Profiling first, then come back for a receipt.</span>
          )}
        </div>
      </Card>
    );

    if (loading) return (
      <div className="dt-fade-up">
        {picker}
        <div style={{ padding: 32, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>Loading receipt…</div>
      </div>
    );
    if (!receipt) return (
      <div className="dt-fade-up">
        {picker}
        <Card style={{ fontSize: 13, color: "var(--fg-3)", textAlign: "center", padding: 28 }}>
          No receipt yet for this connection — pick a table above and generate one.
        </Card>
      </div>
    );
    const r = receipt;
    return (
      <div className="dt-fade-up">
        {picker}

        <div>
          <Card pad={0} style={{ overflow: "hidden", border: "1px solid var(--grey-200)" }}>
            {/* receipt header */}
            <div style={{ padding: "18px 22px", borderBottom: "1px dashed var(--grey-300)", background: "var(--grey-50)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <i data-lucide="receipt-text" style={{ width: 18, height: 18, color: "var(--brand)" }}></i>
                <span style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 15 }}>Data Trust Receipt</span>
              </div>
              <Mono style={{ fontSize: 12, color: "var(--fg-2)", display: "block", marginBottom: 4 }}>{r.query}</Mono>
              <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Executed {r.at} · by {r.by} · {(r.rows || 0).toLocaleString()} row{r.rows === 1 ? "" : "s"}</div>
            </div>

            {/* score */}
            <div style={{ padding: "18px 22px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px dashed var(--grey-300)" }}>
              <ScoreRing score={r.score} size={84} stroke={8} />
              <div>
                <Eyebrow>Data trust score</Eyebrow>
                <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 6, maxWidth: 360 }}>
                  {(() => {
                    const bad = r.fields.filter(f => f.status !== "ok").length;
                    if (r.fields.length === 0) return "No field-level breakdown available for this query.";
                    if (bad === 0) return "All fields in this result are fully trusted.";
                    return `${bad} of ${r.fields.length} field${r.fields.length === 1 ? "" : "s"} in this result ${bad === 1 ? "is" : "are"} uncertain or degraded. Read the field-level breakdown before using it.`;
                  })()}
                </div>
              </div>
            </div>

            {/* fields — multi-column grid so a full-width receipt uses the
                horizontal space instead of forcing a long scroll */}
            <div style={{ padding: "8px 22px" }}>
              <Eyebrow style={{ margin: "12px 0 8px" }}>What you should know</Eyebrow>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", columnGap: 32 }}>
              {r.fields.map(f => {
                const [col, icon] = ST[f.status];
                const displayName = f.name === "(table-level)" ? "Entire table" : f.name;
                return (
                  <div key={f.name} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--grey-100)" }}>
                    <i data-lucide={icon} style={{ width: 16, height: 16, color: col, flexShrink: 0, marginTop: 1 }}></i>
                    <div>
                      {displayName === "Entire table"
                        ? <span style={{ fontWeight: 700, fontSize: 12.5, color: "var(--fg-1)" }}>Entire table</span>
                        : <Mono style={{ fontWeight: 700, color: "var(--fg-1)" }}>{displayName}</Mono>}
                      <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5, marginTop: 2 }}>{f.note}</div>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>

            {/* rec — colored by the worst field verdict, not permanently alarming */}
            {(() => {
              const worst = r.fields.some(f => f.status === "fail") ? "fail" : r.fields.some(f => f.status === "warn") ? "warn" : "ok";
              const bg = worst === "fail" ? "var(--red-50)" : worst === "warn" ? "var(--yellow-50, #fefce8)" : "var(--green-50, #f0fdf4)";
              const fg = worst === "fail" ? "var(--red-600)" : worst === "warn" ? "var(--yellow-700)" : "var(--green-600)";
              return (
                <div style={{ padding: "14px 22px", background: bg, margin: "8px 22px 0", borderRadius: 10 }}>
                  <Eyebrow color={fg} style={{ marginBottom: 5 }}>Recommendation</Eyebrow>
                  <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.55 }}>{r.rec}</div>
                </div>
              );
            })()}

            <div style={{ padding: "16px 22px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: 1, fontSize: 12, color: "var(--fg-3)" }}>Last fully-trusted snapshot: <strong style={{ color: "var(--green-600)" }}>{r.lastClean || "—"}</strong></span>
              <span title="Not wired to a data-versioning system yet — no snapshot rollback is available in this build">
                <Button size="sm" variant="soft" icon="history" disabled>Use yesterday's data</Button>
              </span>
              <Button size="sm" variant="primary" icon="check" onClick={() => toast("Acknowledged", { kind: "success" })}>Acknowledge & proceed</Button>
            </div>
          </Card>
        </div>
      </div>
    );
  };

  window.DTScreens.advisory = Advisory;
  window.DTScreens.receipt = Receipt;
})();
