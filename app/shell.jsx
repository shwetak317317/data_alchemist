// DataTrust — App shell: context, sidebar, topbar, router.

// ---------- Global state ----------
window.DTContext = React.createContext(null);
const useApp = () => React.useContext(window.DTContext);
window.useApp = useApp;

// re-render lucide icons after paint
function useIcons(dep) {
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons(); });
}
window.useIcons = useIcons;

// ---------- Platform metadata (for sidebar glyph/color) ----------
const SIDEBAR_PLATFORMS = {
  sqlserver:  { glyph: "⬡", color: "#cc2020" },
  snowflake:  { glyph: "❄", color: "#29b5e8" },
  databricks: { glyph: "▲", color: "#e8802a" },
  postgres:   { glyph: "🐘", color: "#336791" },
  fabric:     { glyph: "◰", color: "#41a141" },
  bigquery:   { glyph: "◈", color: "#4285f4" },
  duckdb:     { glyph: "🦆", color: "#e6af3a" },
};

// ---------- Navigation model ----------
const NAV = [
  { group: "Workflow", items: [
    { id: "home",      icon: "layout-dashboard", label: "Workspace Home" },
    { id: "profiling", icon: "scan-search",      label: "Profiling", step: 1 },
    { id: "metadata",  icon: "book-marked",      label: "Dictionary & CDEs", step: 2 },
    { id: "rules",     icon: "shield-check",     label: "Rule Studio", step: 3 },
    { id: "execution", icon: "circle-play",      label: "DQ Execution", step: 4 },
  ]},
  { group: "Monitoring", items: [
    { id: "anomalies", icon: "siren",            label: "Anomaly Inbox" },
    { id: "impact",    icon: "network",          label: "Impact Graph" },
    { id: "dashboard", icon: "gauge",            label: "Trust Dashboard" },
  ]},
  { group: "Intelligence", items: [
    { id: "advisory",  icon: "cloud-lightning",  label: "Pre-run Advisory" },
    { id: "receipt",   icon: "receipt-text",     label: "Trust Receipt" },
  ]},
  { group: "Admin", items: [
    { id: "connections", icon: "plug",           label: "Connections" },
  ]},
  { group: "Operate", items: [
    { id: "simulator", icon: "clapperboard",     label: "Scenario Simulator", hot: true },
    { id: "tasks",     icon: "list-checks",      label: "Task Board" },
    { id: "summary",   icon: "file-text",        label: "Daily Summary" },
  ]},
];
window.DT_NAV = NAV;

// ---------- Sidebar ----------
const Sidebar = () => {
  const { route, go, setStage, activeConnectionName, activeConnectionId, activeConnectionPlatform, openAnomalyCount } = useApp();
  const dtUser = React.useMemo(() => {
    try { return JSON.parse(sessionStorage.getItem('dt_user') || '{}'); } catch (_) { return {}; }
  }, []);
  const userName = dtUser.name || "User";
  const userSub  = dtUser.email || "Data Engineer";

  const platMeta = SIDEBAR_PLATFORMS[activeConnectionPlatform] || null;

  const row = (it) => {
    const active = route === it.id;
    const badge = it.id === "anomalies"
      ? (openAnomalyCount > 0 ? openAnomalyCount : null)
      : it.badge;
    return (
      <button key={it.id} onClick={() => go(it.id)} style={{
        display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", borderRadius: 8,
        border: "none", cursor: "pointer", width: "100%", textAlign: "left",
        background: active ? "var(--brand-soft)" : "transparent",
        color: active ? "var(--brand)" : "var(--fg-1)",
        fontWeight: active ? 600 : 500, fontSize: 13.5, fontFamily: "var(--font-ui)",
        transition: "background 150ms, color 150ms", position: "relative",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--grey-50)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}>
        <i data-lucide={it.icon} style={{ width: 17, height: 17, flexShrink: 0 }}></i>
        <span style={{ flex: 1, whiteSpace: "nowrap" }}>{it.label}</span>
        {it.step && <span style={{ fontSize: 10, fontWeight: 700, color: active ? "var(--brand)" : "var(--fg-3)",
          width: 16, height: 16, borderRadius: 5, border: `1px solid ${active ? "var(--brand-ring)" : "var(--grey-200)"}`,
          display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{it.step}</span>}
        {badge && <span style={{ background: "var(--red-500)", color: "#fff", fontSize: 10, fontWeight: 700,
          padding: "1px 6px", borderRadius: 999 }}>{badge}</span>}
        {it.hot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--yellow-500)" }}></span>}
      </button>
    );
  };
  return (
    <aside style={{
      width: 248, background: "#fff", borderRight: "1px solid var(--grey-100)",
      height: "100vh", display: "flex", flexDirection: "column", padding: 14, gap: 2,
      position: "sticky", top: 0, flexShrink: 0, overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px 14px 8px" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--brand)", display: "inline-flex",
          alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0,
          boxShadow: "0 2px 8px rgba(83,83,239,.35)" }}>
          <i data-lucide="shield-check" style={{ width: 17, height: 17 }}></i>
        </span>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em", lineHeight: 1 }}>DataTrust</div>
          <div style={{ fontSize: 10, color: "var(--fg-3)", fontWeight: 600, letterSpacing: ".04em", marginTop: 2 }}>AGENTIC DQ PLATFORM</div>
        </div>
      </div>

      {/* Platform switcher */}
      <div onClick={() => go("connections")} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px",
        border: `1px solid ${activeConnectionId ? "var(--grey-200)" : "var(--grey-150)"}`,
        borderRadius: 10, marginBottom: 12, cursor: "pointer",
        background: activeConnectionId ? "#fff" : "var(--grey-50)" }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6,
          background: platMeta ? platMeta.color : "var(--grey-300)",
          color: platMeta ? "#fff" : "var(--fg-3)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>{platMeta ? platMeta.glyph : "○"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            color: activeConnectionId ? "var(--fg-1)" : "var(--fg-3)" }}>
            {activeConnectionName || "Demo mode"}
          </div>
          <div style={{ fontSize: 10, color: "var(--fg-3)" }}>
            {activeConnectionId ? "Active connection" : "No live data · demo"}
          </div>
        </div>
        <i data-lucide="chevrons-up-down" style={{ width: 13, height: 13, color: "var(--fg-2)" }}></i>
      </div>

      {NAV.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: "var(--font-label)", fontSize: 10, fontWeight: 700, color: "var(--fg-3)",
            textTransform: "uppercase", letterSpacing: ".07em", padding: "8px 10px 5px" }}>{g.group}</div>
          {g.items.map(row)}
        </div>
      ))}

      <div style={{ flex: 1 }}></div>
      <div style={{ padding: "10px 8px 2px", borderTop: "1px solid var(--grey-100)", display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
        <Avatar name={userName} size={30} status="online" color="blue" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userName}</div>
          <div style={{ fontSize: 10, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{userSub}</div>
        </div>
        <button onClick={() => { sessionStorage.removeItem('dt_token'); sessionStorage.removeItem('dt_user'); setStage("login"); }} title="Sign out" style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "inline-flex", color: "var(--fg-2)" }}>
          <i data-lucide="log-out" style={{ width: 15, height: 15 }}></i>
        </button>
      </div>
    </aside>
  );
};

// ---------- TopBar ----------
const TopBar = () => {
  const { route, trustScore, pipeline, activeConnectionName } = useApp();
  const meta = NAV.flatMap(g => g.items).find(i => i.id === route) || {};
  const pipMap = {
    ISSUES:     ["var(--red-500)", "var(--red-50)", "Issues detected"],
    RECOVERING: ["var(--yellow-600)", "var(--yellow-50)", "Recovering"],
    HEALTHY:    ["var(--green-500)", "var(--green-50)", "Healthy"],
  };
  const [pc, pbg, plabel] = pipMap[pipeline] || pipMap.ISSUES;
  return (
    <header style={{ height: 60, display: "flex", alignItems: "center", padding: "0 24px", background: "#fff",
      borderBottom: "1px solid var(--grey-100)", gap: 16, position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, fontSize: 11, color: "var(--fg-3)", marginBottom: 1 }}>
          <span style={{ maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", display: "inline-block", verticalAlign: "bottom" }}>
            {activeConnectionName || "DataTrust"}
          </span>
          <span>/</span>
          <span style={{ textTransform: "capitalize" }}>{meta.group || "Workflow"}</span>
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>{meta.label || "Workspace"}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 999,
        background: pbg, fontSize: 12, fontWeight: 600, color: pc }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: pc }}></span>
        Pipeline · {plabel}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 12px 5px 14px", borderRadius: 12,
        border: "1px solid var(--grey-200)", background: "var(--grey-50)" }}>
        <div>
          <div style={{ fontSize: 9.5, color: "var(--fg-3)", fontWeight: 700, letterSpacing: ".05em" }}>TRUST SCORE</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 800, lineHeight: 1, color: scoreColor(trustScore) }}>{trustScore}<span style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 600 }}>/100</span></div>
        </div>
      </div>

      <IconBtn icon="bell" title="Notifications" />
    </header>
  );
};

// ---------- Demo mode banner ----------
const DemoBanner = () => {
  const { activeConnectionId, go } = useApp();
  const [dismissed, setDismissed] = React.useState(
    () => sessionStorage.getItem('dt_demo_banner_dismissed') === '1'
  );
  if (activeConnectionId || dismissed) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 18px",
      background: "var(--yellow-50)", borderBottom: "1px solid var(--yellow-200)", fontSize: 12.5, color: "var(--yellow-800)" }}>
      <i data-lucide="flask-conical" style={{ width: 15, height: 15, color: "var(--yellow-600)", flexShrink: 0 }}></i>
      <span style={{ flex: 1 }}>
        <strong>Demo mode</strong> — showing sample data. Connect a real database to see live DQ insights for your schemas.
      </span>
      <button onClick={() => go("connections")} style={{ fontSize: 12, fontWeight: 700, color: "var(--yellow-800)",
        background: "var(--yellow-100)", border: "1px solid var(--yellow-300)", borderRadius: 7, padding: "4px 11px", cursor: "pointer" }}>
        Connect database
      </button>
      <button onClick={() => { sessionStorage.setItem('dt_demo_banner_dismissed', '1'); setDismissed(true); }}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--yellow-600)", padding: 2, display: "inline-flex" }}>
        <i data-lucide="x" style={{ width: 14, height: 14 }}></i>
      </button>
    </div>
  );
};

// ---------- App ----------
function App() {
  // Auto-resume if a valid session exists (set by login or injected by test runner)
  const [stage, setStage] = React.useState(() => {
    try { return JSON.parse(sessionStorage.getItem('dt_user') || '{}').name ? "app" : "login"; } catch { return "login"; }
  });
  const [route, setRoute] = React.useState("home");
  const [trustScore, setTrustScore] = React.useState(69);
  const [pipeline, setPipeline] = React.useState("ISSUES");
  const [ruleDecisions, setRuleDecisions] = React.useState({});
  const [customRules, setCustomRules] = React.useState([]);
  const [ackedAnomalies, setAckedAnomalies] = React.useState({});
  const [profilingDone, setProfilingDone] = React.useState(false);
  const [metaDecisions, setMetaDecisions] = React.useState({});
  const [statusPromoted, setStatusPromoted] = React.useState(false);
  const [taskList, setTaskList] = React.useState([]);
  const [activeConnectionId, setActiveConnectionId] = React.useState(() => localStorage.getItem('dt_conn_id') || null);
  const [activeConnectionName, setActiveConnectionName] = React.useState(() => localStorage.getItem('dt_conn_name') || null);
  const [activeConnectionPlatform, setActiveConnectionPlatform] = React.useState(() => localStorage.getItem('dt_conn_platform') || null);
  const [activeTableFqn, setActiveTableFqn] = React.useState(null);
  const [lastRunId, setLastRunId] = React.useState(null);
  const [datasets, setDatasets] = React.useState([]);
  const [datasetsLoading, setDatasetsLoading] = React.useState(false);
  const [openAnomalyCount, setOpenAnomalyCount] = React.useState(null);

  const go = (r) => { setRoute(r); const s = document.getElementById("dt-scroll"); if (s) s.scrollTop = 0; };

  const setActiveConn = (id, name, platform) => {
    setActiveConnectionId(id || null);
    setActiveConnectionName(name || null);
    setActiveConnectionPlatform(platform || null);
    if (id) { localStorage.setItem('dt_conn_id', id); } else { localStorage.removeItem('dt_conn_id'); }
    if (name) { localStorage.setItem('dt_conn_name', name); } else { localStorage.removeItem('dt_conn_name'); }
    if (platform) { localStorage.setItem('dt_conn_platform', platform); } else { localStorage.removeItem('dt_conn_platform'); }
  };

  // On every app entry: validate stored connection, auto-select most recent if stale/missing
  React.useEffect(() => {
    if (stage !== "app" || !window.DTApi?.listConnections) return;
    window.DTApi.listConnections()
      .then(list => {
        if (!list?.length) {
          // No connections in backend — ensure clean demo mode
          if (activeConnectionId) setActiveConn(null, null, null);
          return;
        }
        // Check if currently stored connection still exists
        const stillValid = list.find(c => c.id === activeConnectionId);
        if (stillValid) {
          // Refresh name/platform in case they changed
          if (stillValid.name !== activeConnectionName || stillValid.platform !== activeConnectionPlatform) {
            setActiveConn(stillValid.id, stillValid.name, stillValid.platform);
          }
          return;
        }
        // Stored connection gone or no connection — pick most recent active one
        // API returns created_at DESC so list[0] is the most recently added
        const recent = list.find(c => c.status === "active") || list[0];
        setActiveConn(recent.id, recent.name, recent.platform);
      })
      .catch(() => {});
  }, [stage]);

  // Fetch datasets once per connection — shared by all screens; avoids per-screen re-fetch on navigation.
  // forceLive=false (default) uses the DB cache for fast navigation; forceLive=true hits the live connector.
  const refreshDatasets = React.useCallback((forceLive = false) => {
    if (!window.DTApi?.listDatasets || !activeConnectionId) { setDatasets([]); return; }
    setDatasetsLoading(true);
    window.DTApi.listDatasets(activeConnectionId, !forceLive)  // use_cache = !forceLive
      .then(data => { if (data) setDatasets(data); })
      .catch(() => {})
      .finally(() => setDatasetsLoading(false));
  }, [activeConnectionId]);

  React.useEffect(() => {
    if (stage !== 'app') { setDatasets([]); return; }
    refreshDatasets();
  }, [activeConnectionId, stage]);

  // Fetch open (unacknowledged) anomaly count for the sidebar badge
  const refreshAnomalyCount = React.useCallback(() => {
    if (!window.DTApi?.getAnomalyInbox) return;
    window.DTApi.getAnomalyInbox(activeConnectionId)
      .then(items => {
        const list = Array.isArray(items) ? items : (items?.anomalies || items?.items || []);
        const open = list.filter(a => !a.acknowledged_at && !a.status?.toLowerCase().includes('ack'));
        setOpenAnomalyCount(open.length);
      })
      .catch(() => {});
  }, [activeConnectionId]);

  React.useEffect(() => {
    if (stage !== 'app') { setOpenAnomalyCount(null); return; }
    refreshAnomalyCount();
  }, [activeConnectionId, stage]);

  const store = {
    stage, setStage, route, go, trustScore, setTrustScore, pipeline, setPipeline,
    ruleDecisions, setRuleDecisions, customRules, setCustomRules,
    ackedAnomalies, setAckedAnomalies, profilingDone, setProfilingDone,
    metaDecisions, setMetaDecisions, statusPromoted, setStatusPromoted,
    taskList, setTaskList,
    activeConnectionId, activeConnectionName, activeConnectionPlatform, setActiveConn,
    activeTableFqn, setActiveTableFqn,
    lastRunId, setLastRunId,
    datasets, setDatasets, datasetsLoading, refreshDatasets,
    openAnomalyCount, refreshAnomalyCount,
  };

  useIcons();

  // Login goes directly to app — wizard is only reachable from the Connections page
  if (stage === "login") return <window.DTAuth.Login onAuth={() => setStage("app")} />;

  const Screen = (window.DTScreens && window.DTScreens[route]) || (() => <div style={{ padding: 40 }}>Screen not found: {route}</div>);

  return (
    <window.DTContext.Provider value={store}>
      <div style={{ display: "flex", minHeight: "100vh", width: "100%", background: "var(--bg-app)" }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", height: "100vh" }}>
          <TopBar />
          <DemoBanner />
          <main id="dt-scroll" style={{ flex: 1, overflowY: "auto", padding: "26px 30px 40px" }}>
            <Screen />
          </main>
        </div>
        <ToastHost />
      </div>
    </window.DTContext.Provider>
  );
}

window.DTApp = App;
