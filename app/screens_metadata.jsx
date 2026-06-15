// DataTrust — Screen: Metadata enrichment & CDE registry
(function () {
  const D = window.DT;

  const Metadata = () => {
    const { go, metaDecisions, setMetaDecisions, statusPromoted, setStatusPromoted, activeConnectionId, activeConnectionName } = useApp();
    const [editing, setEditing] = React.useState(null);
    const [metaRows, setMetaRows] = React.useState([]);
    const [cdeRows, setCdeRows] = React.useState([]);
    const [descs, setDescs] = React.useState({});
    useIcons();

    React.useEffect(() => {
      if (!window.DTApi || !activeConnectionId) return;
      window.DTApi.listDictionary(activeConnectionId)
        .then(rows => {
          if (!rows) return;
          const mapped = rows.map(r => ({
            col: r.column_name, desc: r.description || r.business_description || "",
            column_id: r.id || r.column_id,
            cde: r.is_cde, cdeScore: Math.round(r.cde_score || 0),
            status: r.steward_status || "pending",
            canPromote: !r.is_cde && (r.cde_score || 0) > 40,
            internal: r.column_name.startsWith("_"),
          }));
          setMetaRows(mapped);
          setDescs(Object.fromEntries(mapped.map(m => [m.col, m.desc])));
        })
        .catch(() => {});
      window.DTApi.listCDEs(activeConnectionId)
        .then(rows => {
          if (!rows) return;
          setCdeRows(rows.map(r => ({
            name: r.column_name,
            table: r.table_fqn,
            status: r.health || "PASS",
            validated: r.last_validated || "—",
          })));
        })
        .catch(() => {});
    }, [activeConnectionId]);

    const decide = (col, decision) => {
      setMetaDecisions(d => ({ ...d, [col]: decision }));
      toast(`${col} — ${decision} · logged to audit trail`, { kind: decision === "rejected" ? "info" : "success" });
      const row = metaRows.find(m => m.col === col);
      if (row && row.column_id && window.DTApi) {
        window.DTApi.decideColumn(row.column_id, decision, { description: descs[col] }).catch(() => {});
      }
    };

    const approvedCount = metaRows.filter(m => metaDecisions[m.col] === "approved" || m.status === "approved").length;

    const StatusTag = ({ m }) => {
      const dec = metaDecisions[m.col];
      if (dec === "approved" || m.status === "approved") return <Chip intent="success" size="sm" icon="check">Approved</Chip>;
      if (dec === "rejected") return <Chip intent="neutral" size="sm">Rejected</Chip>;
      if (m.status === "needs-review") return <Chip intent="warning" size="sm" dot>Needs review</Chip>;
      return <Chip intent="neutral" variant="outline" size="sm">Pending</Chip>;
    };

    return (
      <div className="dt-fade-up">
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle icon="book-marked" sub="The metadata agent generated business descriptions for 15 of 17 columns. Steward reviews each — approve, edit, reject, or promote to a Critical Data Element."
            right={<Chip intent="brand" dot>{approvedCount} approved</Chip>}>Data dictionary enrichment{activeConnectionName ? ` — ${activeConnectionName}` : ""}</SectionTitle>
        </Card>

        <Card style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          {metaRows.map((m, i) => {
            const dec = metaDecisions[m.col];
            const isPromoted = m.col === "status" && statusPromoted;
            const isCde = m.cde || isPromoted;
            return (
              <div key={m.col} style={{ display: "flex", gap: 16, padding: "16px 20px", borderTop: i ? "1px solid var(--grey-100)" : "none",
                background: m.internal ? "var(--yellow-50)" : "transparent", alignItems: "flex-start" }}>
                <div style={{ width: 150, flexShrink: 0 }}>
                  <Mono style={{ fontWeight: 700, display: "block", marginBottom: 6 }}>{m.col}</Mono>
                  {isCde ? <Chip intent="brand" size="sm" dot>CDE · {isPromoted ? 87 : m.cdeScore}</Chip>
                    : <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11, color: "var(--fg-3)" }}>CDE score</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-2)" }}>{m.cdeScore}</span>
                      </div>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editing === m.col ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <textarea value={descs[m.col]} onChange={(e) => setDescs(d => ({ ...d, [m.col]: e.target.value }))}
                        style={{ width: "100%", minHeight: 64, padding: 10, borderRadius: 8, border: "1px solid var(--brand)", fontFamily: "var(--font-ui)", fontSize: 13, resize: "vertical", outline: "none", boxShadow: "0 0 0 3px var(--brand-ring)" }} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button size="sm" variant="primary" onClick={() => { setEditing(null); decide(m.col, "approved"); }}>Save & approve</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--fg-1)", lineHeight: 1.55 }}>
                      {m.internal && <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--yellow-700)", fontWeight: 600, marginRight: 6 }}><i data-lucide="alert-triangle" style={{ width: 13, height: 13 }}></i></span>}
                      {descs[m.col]}
                      {m.col === "net_revenue" && (metaDecisions[m.col] === "approved") && <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 5 }}>Tags: Finance · ML · CDE</div>}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0, width: 150 }}>
                  <StatusTag m={m} />
                  {editing !== m.col && dec !== "approved" && m.status !== "approved" && (
                    <div style={{ display: "flex", gap: 5 }}>
                      <IconBtn icon="check" title="Approve" size={28} onClick={() => decide(m.col, "approved")} />
                      <IconBtn icon="pencil" title="Edit" size={28} onClick={() => setEditing(m.col)} />
                      {m.canPromote && !isPromoted && <IconBtn icon="arrow-up" title="Promote to CDE" size={28} onClick={() => { setStatusPromoted(true); toast("status promoted to CDE (score 87) · 5 new HIGH-severity rules suggested in Rule Studio", { kind: "success", title: "Priya Sharma" }); }} />}
                      {!m.canPromote && <IconBtn icon="x" title="Reject" size={28} danger onClick={() => decide(m.col, "rejected")} />}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>

        {/* CDE registry + PII */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <Card style={{ flex: 2, minWidth: 340 }}>
            <SectionTitle icon="shield-alert">Critical Data Element registry</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {cdeRows.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", borderBottom: i < cdeRows.length - 1 ? "1px solid var(--grey-100)" : "none" }}>
                  <Mono style={{ flex: 1, fontWeight: 600 }}>{c.name}</Mono>
                  <Mono style={{ fontSize: 11.5, color: "var(--fg-3)", flex: 1 }}>{c.table}</Mono>
                  <Chip intent={c.status === "PASS" ? "success" : c.status === "WARN" ? "warning" : "danger"} size="sm" dot>{c.status}</Chip>
                  <span style={{ fontSize: 11, color: "var(--fg-3)", width: 110, textAlign: "right" }}>{c.validated}</span>
                </div>
              ))}
              {statusPromoted && cdeRows.findIndex(c => c.name === "status") === -1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 6px", background: "var(--green-50)", borderRadius: 8, marginTop: 4 }}>
                  <Mono style={{ flex: 1, fontWeight: 600 }}>status</Mono>
                  <Mono style={{ fontSize: 11.5, color: "var(--fg-3)", flex: 1 }}>silver.orders_enriched</Mono>
                  <Chip intent="brand" size="sm" dot>NEW · 87</Chip>
                  <span style={{ fontSize: 11, color: "var(--fg-3)", width: 110, textAlign: "right" }}>just now</span>
                </div>
              )}
            </div>
          </Card>
          <Card style={{ flex: 1, minWidth: 240 }}>
            <SectionTitle icon="lock">PII & sensitivity</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[["email", "PII"], ["full_name", "PII"], ["phone", "PII"], ["net_revenue", "Financial"]].map(([c, t]) => (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <i data-lucide="shield" style={{ width: 15, height: 15, color: "var(--purple-500)" }}></i>
                  <Mono style={{ flex: 1 }}>{c}</Mono>
                  <Chip intent="purple" size="sm">{t}</Chip>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="soft" icon="plus">Add column manually</Button>
            <Button variant="soft" icon="download">Export dictionary</Button>
          </div>
          <Button variant="primary" iconRight="arrow-right" onClick={() => go("rules")}>Proceed to Rule Studio</Button>
        </div>
      </div>
    );
  };

  window.DTScreens.metadata = Metadata;
})();
