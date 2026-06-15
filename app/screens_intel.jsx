// DataTrust — Screens: Pre-run Advisory + Trust Receipt
(function () {
  const D = window.DT;

  // ---------------- Pre-run Advisory ----------------
  const Advisory = () => {
    const { go, activeConnectionId } = useApp();
    const [decision, setDecision] = React.useState(null);
    const [advisory, setAdvisory] = React.useState(null);
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi?.getAdvisory) return;
      setAdvisory(null);
      window.DTApi.getAdvisory(activeConnectionId)
        .then(data => {
          if (!data || data.advisory_id === "none") return;
          setAdvisory({
            predicted: data.predicted_score ?? 0,
            reasons: data.risk_reasons ?? [],
            rec: data.recommendation ?? "—",
            advisory_time: data.advisory_time ?? "—",
          });
        })
        .catch(() => {});
    }, [activeConnectionId]);

    if (!advisory) return <div style={{ padding: 32, textAlign: "center", color: "var(--fg-3)" }}>Loading advisory…</div>;
    const a = advisory;
    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="cloud-lightning" sub="The only genuinely proactive layer: before the pipeline even runs, predict today's trust score from historical patterns — and recommend whether to proceed.">Pre-run advisory</SectionTitle>
        </Card>

        <Card style={{ marginBottom: 16, border: "1px solid var(--yellow-300)", background: "linear-gradient(180deg, var(--yellow-50), #fff)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 18 }}>
            <ScoreRing score={a.predicted} size={104} stroke={10} sublabel="predicted" />
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Mono style={{ fontSize: 12, color: "var(--fg-2)" }}>{a.advisory_time || "05:20 AM"}</Mono>
                <Chip intent="warning" dot>Before Bronze pipeline start</Chip>
              </div>
              <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 18, margin: "8px 0 4px" }}>Predicted trust score for today's run: <span style={{ color: "var(--yellow-700)" }}>{a.predicted}/100</span></div>
              <div style={{ fontSize: 13, color: "var(--fg-2)" }}>Below the 85 healthy threshold. Review the risk signals before launching the pipeline.</div>
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
                {decision === "hold" && <span><strong>Pipeline held 20 minutes.</strong> Waiting for WMS feed confirmation. You'll be alerted when the OMS extract reaches full size.</span>}
                {decision === "proceed" && <span><strong>Proceeding anyway.</strong> This is exactly the path that led to today's 11.2% net_revenue null incident — see the Impact Graph.</span>}
                {decision === "alert" && <span><strong>Pipeline owner alerted.</strong> Deepa Nair notified of the elevated pre-run risk.</span>}
              </div>
              {decision === "proceed" && <Button size="sm" variant="outline" onClick={() => go("impact")}>See what broke</Button>}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="primary" icon="pause" onClick={() => { setDecision("hold"); toast("Bronze pipeline held 20 minutes", { kind: "success" }); }}>Hold pipeline</Button>
              <Button variant="soft" icon="play" onClick={() => { setDecision("proceed"); toast("Proceeding against advisory", { kind: "warning" }); }}>Proceed anyway</Button>
              <Button variant="ghost" icon="bell" onClick={() => { setDecision("alert"); toast("Pipeline owner alerted", { kind: "info" }); }}>Alert owner</Button>
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
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi?.getReceipt) return;
      setReceipt(null);
      window.DTApi.getReceipt(activeConnectionId)
        .then(data => {
          if (!data || data.receipt_id === "none") return;
          setReceipt({
            query:     data.query_text,
            at:        data.executed_at,
            by:        data.executed_by,
            rows:      data.row_count,
            score:     data.trust_score,
            fields:    data.fields || [],
            rec:       data.recommendation,
            lastClean: data.last_clean_snapshot,
          });
        })
        .catch(() => {});
    }, [activeConnectionId]);

    if (!receipt) return <div style={{ padding: 32, textAlign: "center", color: "var(--fg-3)" }}>Loading receipt…</div>;
    const r = receipt;
    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="receipt-text" sub="A nutrition label for every query. When a consumer reads a Gold table, they get a trust receipt — how much to trust each field, and what to do about it.">Data trust receipt</SectionTitle>
        </Card>

        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <Card pad={0} style={{ overflow: "hidden", border: "1px solid var(--grey-200)" }}>
            {/* receipt header */}
            <div style={{ padding: "18px 22px", borderBottom: "1px dashed var(--grey-300)", background: "var(--grey-50)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <i data-lucide="receipt-text" style={{ width: 18, height: 18, color: "var(--brand)" }}></i>
                <span style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 15 }}>Data Trust Receipt</span>
              </div>
              <Mono style={{ fontSize: 12, color: "var(--fg-2)", display: "block", marginBottom: 4 }}>{r.query}</Mono>
              <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>Executed {r.at} · by {r.by} · {r.rows} row returned</div>
            </div>

            {/* score */}
            <div style={{ padding: "18px 22px", display: "flex", alignItems: "center", gap: 16, borderBottom: "1px dashed var(--grey-300)" }}>
              <ScoreRing score={r.score} size={84} stroke={8} />
              <div>
                <Eyebrow>Data trust score</Eyebrow>
                <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 6, maxWidth: 360 }}>This result mixes fully-trusted and uncertain fields. Read the field-level breakdown before using it.</div>
              </div>
            </div>

            {/* fields */}
            <div style={{ padding: "8px 22px" }}>
              <Eyebrow style={{ margin: "12px 0 8px" }}>What you should know</Eyebrow>
              {r.fields.map(f => {
                const [col, icon] = ST[f.status];
                return (
                  <div key={f.name} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--grey-100)" }}>
                    <i data-lucide={icon} style={{ width: 16, height: 16, color: col, flexShrink: 0, marginTop: 1 }}></i>
                    <div>
                      <Mono style={{ fontWeight: 700, color: "var(--fg-1)" }}>{f.name}</Mono>
                      <div style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5, marginTop: 2 }}>{f.note}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* rec */}
            <div style={{ padding: "14px 22px", background: "var(--red-50)", margin: "8px 22px 0", borderRadius: 10 }}>
              <Eyebrow color="var(--red-600)" style={{ marginBottom: 5 }}>Recommendation</Eyebrow>
              <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.55 }}>{r.rec}</div>
            </div>

            <div style={{ padding: "16px 22px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: 1, fontSize: 12, color: "var(--fg-3)" }}>Last fully-trusted snapshot: <strong style={{ color: "var(--green-600)" }}>{r.lastClean}</strong></span>
              <Button size="sm" variant="soft" icon="history">Use yesterday's data</Button>
              <Button size="sm" variant="primary" icon="check">Acknowledge & proceed</Button>
            </div>
          </Card>
        </div>
      </div>
    );
  };

  window.DTScreens.advisory = Advisory;
  window.DTScreens.receipt = Receipt;
})();
