// DataTrust — Screen: Downstream Impact Graph (animated cascade)
(function () {
  const D = window.DT.impact;
  const STC = { fail: "var(--red-500)", warn: "var(--yellow-500)", ok: "var(--green-500)" };
  const STBG = { fail: "var(--red-50)", warn: "var(--yellow-50)", ok: "var(--green-50)" };

  // Node geometry on a 1060 x 470 canvas
  const W = 1060, H = 470;
  const source = { id: "src", x: 0, y: 185, w: 240, h: 96, ...D.source };
  const gold = [
    { ...D.tiers[0].nodes[0], x: 410, y: 110, w: 240, h: 84 },
    { ...D.tiers[0].nodes[1], x: 410, y: 290, w: 240, h: 84 },
  ];
  const repY = { r1: 28, r2: 110, m1: 192, m2: 274, o1: 356 };
  const reports = D.tiers[1].nodes.map(n => ({ ...n, x: 800, y: repY[n.id], w: 260, h: 62 }));

  const cx = (n, side) => side === "r" ? n.x + n.w : n.x;
  const cy = (n) => n.y + n.h / 2;
  const edgePath = (a, b) => {
    const x1 = cx(a, "r"), y1 = cy(a), x2 = cx(b, "l"), y2 = cy(b);
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  };

  const edges = [
    ...gold.map(g => ({ from: source, to: g, lit: 1 })),
    ...reports.map(r => {
      const fromNode = gold.find(g => g.id === r.from) || gold[0];
      return { from: fromNode, to: r, lit: 2 };
    }),
  ];

  const Node = ({ n, active, isSource }) => (
    <div style={{
      position: "absolute", left: n.x, top: n.y, width: n.w, height: n.h,
      background: active ? STBG[n.status] : "#fff", borderRadius: 12,
      border: `1.5px solid ${active ? STC[n.status] : "var(--grey-200)"}`,
      boxShadow: active && n.status === "fail" ? `0 0 0 4px ${STC[n.status]}22, var(--shadow-card)` : "var(--shadow-card)",
      padding: isSource ? 14 : "10px 12px", transition: "all 350ms cubic-bezier(0.2,0,0,1)",
      opacity: active ? 1 : 0.5, display: "flex", flexDirection: "column", justifyContent: "center",
      animation: active && n.status === "fail" ? "dtFlash 600ms ease" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: isSource ? 6 : 3 }}>
        <Health status={active ? (n.status === "fail" ? "FAIL" : n.status === "warn" ? "WARN" : "PASS") : "OK"} />
        <Mono style={{ fontSize: isSource ? 12.5 : 11.5, fontWeight: 700, color: "var(--fg-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</Mono>
      </div>
      <div style={{ fontSize: isSource ? 12 : 11, color: active ? STC[n.status] : "var(--fg-3)", fontWeight: active && n.status !== "ok" ? 600 : 500, lineHeight: 1.35 }}>{n.sub || n.note}</div>
    </div>
  );

  const Impact = () => {
    const { activeConnectionId } = useApp();
    const [step, setStep] = React.useState(0); // 0 idle,1 source,2 gold,3 reports
    useIcons();

    // Refresh node health from lineage API when available — layout positions are fixed
    React.useEffect(() => {
      if (!window.DTApi?.getLineage || !activeConnectionId) return;
      window.DTApi.getLineage("silver.orders_enriched", activeConnectionId)
        .then(data => {
          if (!data || !data.nodes || !data.nodes.length) return;
          // Update health status on the already-rendered nodes (mutable in place)
          data.nodes.forEach(n => {
            const found = [source, ...gold, ...reports].find(x => x.label === n.label || x.id === n.external_id);
            if (found) { found.status = n.health_status || found.status; found.sub = n.sub_label || found.sub; }
          });
        })
        .catch(() => {});
    }, [activeConnectionId]);

    const run = React.useCallback(() => {
      setStep(1);
      const t1 = setTimeout(() => setStep(2), 700);
      const t2 = setTimeout(() => setStep(3), 1500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }, []);
    React.useEffect(() => { const c = run(); return c; }, []);

    const nodeActive = (n) => {
      if (n.id === "src") return step >= 1;
      if (gold.find(g => g.id === n.id)) return step >= 2;
      return step >= 3;
    };
    const counts = { fail: reports.filter(r => r.status === "fail").length + gold.filter(g => g.status === "fail").length,
      warn: reports.filter(r => r.status === "warn").length + gold.filter(g => g.status === "warn").length };

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="network" sub="Not just what broke — what it broke downstream. One NULL column traced from source to every dashboard, report, and ML model that now depends on bad data."
            right={<Button size="sm" variant="outline" icon="play" onClick={run}>Replay cascade</Button>}>
            Downstream impact — net_revenue NULL</SectionTitle>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <Chip intent="danger" dot>{counts.fail} blocked</Chip>
            <Chip intent="warning" dot>{counts.warn} degraded</Chip>
            <Chip intent="neutral" icon="dollar-sign">$221M revenue understated</Chip>
          </div>
        </Card>

        <Card style={{ overflowX: "auto", padding: 24 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {[["SOURCE", 0], ["GOLD LAYER", 410], ["REPORTS / MODELS", 800]].map(([l, x]) => (
              <div key={l} style={{ position: "relative", left: x, width: 260 }}><Eyebrow>{l}</Eyebrow></div>
            ))}
          </div>
          <div style={{ position: "relative", width: W, height: H, margin: "0 auto" }}>
            <svg width={W} height={H} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
              {edges.map((e, i) => {
                const lit = step > e.lit;
                return (
                  <path key={i} d={edgePath(e.from, e.to)} fill="none"
                    stroke={lit ? STC[e.to.status] : "var(--grey-200)"} strokeWidth={lit ? 2.5 : 1.5}
                    strokeDasharray={lit ? "6 4" : "0"} opacity={lit ? 1 : 0.5}
                    style={{ transition: "stroke 350ms, opacity 350ms", animation: lit ? "dtFlow 700ms linear infinite" : "none" }} />
                );
              })}
            </svg>
            <Node n={source} active={nodeActive(source)} isSource />
            {gold.map(g => <Node key={g.id} n={g} active={nodeActive(g)} />)}
            {reports.map(r => <Node key={r.id} n={r} active={nodeActive(r)} />)}
          </div>
        </Card>

        <Card style={{ marginTop: 16 }}>
          <SectionTitle icon="git-fork">Lineage paths</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
            {reports.map(r => {
              const g = gold.find(x => x.id === r.from);
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-2)", flexWrap: "wrap" }}>
                  <Mono>silver.orders_enriched</Mono><i data-lucide="chevron-right" style={{ width: 13, height: 13, color: "var(--fg-3)" }}></i>
                  <Mono>{g.label}</Mono><i data-lucide="chevron-right" style={{ width: 13, height: 13, color: "var(--fg-3)" }}></i>
                  <Mono style={{ color: STC[r.status], fontWeight: 700 }}>{r.label}</Mono>
                  <Chip intent={r.status === "fail" ? "danger" : "warning"} size="sm">{r.note}</Chip>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    );
  };

  window.DTScreens.impact = Impact;
})();
