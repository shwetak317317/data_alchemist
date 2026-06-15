// DataTrust — Auth & onboarding: Login, Connect Data Source wizard, Connections manager
(function () {
  // ── PKCE helpers (no external lib) ──────────────────────────────────────────
  function _randomBase64Url(len) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }
  async function _sha256Base64Url(str) {
    const enc = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  // ---------------- Login ----------------
  const Login = ({ onAuth }) => {
    const [mode, setMode] = React.useState("login");  // "login" | "register"
    const [email, setEmail] = React.useState("");
    const [pw, setPw] = React.useState("");
    const [name, setName] = React.useState("");
    const [loading, setLoading] = React.useState(null);
    const [msConfig, setMsConfig] = React.useState(null);
    const [authError, setAuthError] = React.useState("");
    const [successMsg, setSuccessMsg] = React.useState("");
    useIcons();

    const clearForm = () => { setEmail(""); setPw(""); setName(""); setAuthError(""); setSuccessMsg(""); };

    // Load MS config + handle OAuth2 callback (?code=...&state=...)
    React.useEffect(() => {
      // Fetch auth config from backend
      fetch("/api/config")
        .then(r => r.json())
        .then(cfg => setMsConfig(cfg))
        .catch(() => setMsConfig({ ms_configured: false }));

      // Handle Microsoft OAuth callback: URL has ?code=xxx&state=xxx
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const storedState = sessionStorage.getItem("ms_oauth_state");
      const codeVerifier = sessionStorage.getItem("ms_code_verifier");

      if (code && state && codeVerifier) {
        sessionStorage.removeItem("ms_oauth_state");
        sessionStorage.removeItem("ms_code_verifier");
        // Clear code from URL bar without reload
        window.history.replaceState({}, "", window.location.pathname);
        setLoading("microsoft");
        // Exchange code for token
        fetch("/api/auth/microsoft/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, code_verifier: codeVerifier }),
        })
          .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || "Token exchange failed")))
          .then(user => {
            sessionStorage.setItem("dt_user", JSON.stringify(user));
            onAuth(user);
          })
          .catch(err => {
            setAuthError(String(err));
            setLoading(null);
          });
      }
    }, []);

    const loginMicrosoft = async () => {
      if (!msConfig?.ms_configured) {
        // Demo fallback — no Azure App Registration configured
        setLoading("microsoft");
        setTimeout(() => onAuth({ name: "Demo User", email: "demo@pal.tech" }), 900);
        return;
      }
      setLoading("microsoft");
      try {
        const codeVerifier = _randomBase64Url(64);
        const codeChallenge = await _sha256Base64Url(codeVerifier);
        const state = _randomBase64Url(16);
        sessionStorage.setItem("ms_code_verifier", codeVerifier);
        sessionStorage.setItem("ms_oauth_state", state);

        const { ms_client_id, ms_tenant_id, ms_redirect_uri, ms_domain_hint } = msConfig;
        const params = new URLSearchParams({
          client_id: ms_client_id,
          response_type: "code",
          redirect_uri: ms_redirect_uri,
          scope: "openid profile email User.Read",
          response_mode: "query",
          state,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          ...(ms_domain_hint ? { domain_hint: ms_domain_hint } : {}),
          prompt: "select_account",
        });
        const authority = `https://login.microsoftonline.com/${ms_tenant_id}/oauth2/v2.0/authorize`;
        window.location.href = `${authority}?${params.toString()}`;
      } catch (e) {
        setAuthError("Could not start Microsoft login: " + e.message);
        setLoading(null);
      }
    };

    const signin = () => {
      if (!email.includes("@")) { setAuthError("Enter a valid email address."); return; }
      if (!pw) { setAuthError("Password is required."); return; }
      setAuthError(""); setSuccessMsg(""); setLoading("email");
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      })
        .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || "Login failed")))
        .then(user => { sessionStorage.setItem("dt_user", JSON.stringify(user)); onAuth(user); })
        .catch(err => { setAuthError(String(err)); setLoading(null); });
    };

    const register = () => {
      if (!name.trim()) { setAuthError("Full name is required."); return; }
      if (!email.includes("@")) { setAuthError("Enter a valid email address."); return; }
      if (pw.length < 8) { setAuthError("Password must be at least 8 characters."); return; }
      setAuthError(""); setLoading("email");
      fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw, name: name.trim() }),
      })
        .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.detail || "Registration failed")))
        .then(() => {
          // Registration successful — switch to login so user explicitly signs in
          setLoading(null);
          clearForm();
          setMode("login");
          setSuccessMsg(`Account created for ${email}. Please sign in.`);
        })
        .catch(err => { setAuthError(String(err)); setLoading(null); });
    };

    return (
      <div style={{ display: "flex", minHeight: "100vh", fontFamily: "var(--font-ui)" }}>
        {/* Brand panel */}
        <div style={{ flex: "1 1 46%", background: "var(--navy-700)", color: "#fff", padding: "48px 56px", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(900px 500px at 80% -10%, rgba(83,83,239,.55), transparent 60%)", pointerEvents: "none" }}></div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <span style={{ width: 38, height: 38, borderRadius: 11, background: "var(--brand)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <i data-lucide="shield-check" style={{ width: 21, height: 21 }}></i>
            </span>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em", lineHeight: 1 }}>Data Alchemist</div>
              <div style={{ fontSize: 10.5, color: "rgba(255,255,255,.6)", fontWeight: 600, letterSpacing: ".05em", marginTop: 3 }}>AGENTIC DQ PLATFORM · PAL.TECH</div>
            </div>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", maxWidth: 460 }}>
            <h1 style={{ fontSize: 34, lineHeight: 1.15, color: "#fff", marginBottom: 18, letterSpacing: "-0.02em" }}>Move data quality from reactive chaos to proactive trust.</h1>
            <p style={{ fontSize: 15, color: "rgba(255,255,255,.72)", lineHeight: 1.6, marginBottom: 34 }}>Autonomous profiling, AI-authored rules, anomaly explainability, and live trust scoring — across every layer of your warehouse.</p>
            <div style={{ display: "flex", gap: 28 }}>
              {[["4", "data layers monitored"], ["31", "active DQ rules"], ["< 90s", "detect → explain"]].map(([n, l]) => (
                <div key={l}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 26 }}>{n}</div>
                  <div style={{ fontSize: 11.5, color: "rgba(255,255,255,.6)", marginTop: 3, maxWidth: 100 }}>{l}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative", fontSize: 11.5, color: "rgba(255,255,255,.55)" }}>
            {["SOC 2 Type II", "ISO 27001", "GDPR", "SSO / SAML"].map(b => (
              <span key={b} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><i data-lucide="shield" style={{ width: 13, height: 13 }}></i>{b}</span>
            ))}
          </div>
        </div>

        {/* Form panel */}
        <div style={{ flex: "1 1 54%", display: "flex", alignItems: "center", justifyContent: "center", padding: 40, background: "var(--bg-app)" }}>
          <div style={{ width: "100%", maxWidth: 380 }}>
            <Eyebrow style={{ marginBottom: 8 }}>pal.tech · Innovation Challenge</Eyebrow>
            <h2 style={{ fontSize: 24, marginBottom: 6 }}>
              {mode === "login" ? "Sign in to Data Alchemist" : "Create your account"}
            </h2>
            <p style={{ fontSize: 13.5, color: "var(--fg-2)", marginBottom: 22 }}>
              {mode === "login"
                ? <>Use your <strong>@pal.tech</strong> Microsoft account or a local account.</>
                : "Register with email + password — stored securely in PostgreSQL."}
            </p>

            {/* Login/Register mode toggle */}
            <div style={{ display: "flex", background: "var(--grey-100)", borderRadius: 10, padding: 4, marginBottom: 22 }}>
              {[["login", "Sign in"], ["register", "Create account"]].map(([m, label]) => (
                <button key={m} onClick={() => { setMode(m); clearForm(); }} style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 150ms",
                  background: mode === m ? "#fff" : "transparent",
                  color: mode === m ? "var(--fg-1)" : "var(--fg-3)",
                  boxShadow: mode === m ? "0 1px 3px rgba(0,0,0,.1)" : "none",
                }}>{label}</button>
              ))}
            </div>

            {authError && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", background: "var(--red-50)", border: "1px solid var(--red-200)", borderRadius: 10, marginBottom: 16 }}>
                <i data-lucide="alert-circle" style={{ width: 15, height: 15, color: "var(--red-500)", flexShrink: 0 }}></i>
                <span style={{ fontSize: 12.5, color: "var(--red-700)" }}>{authError}</span>
              </div>
            )}
            {successMsg && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px", background: "var(--green-50)", border: "1px solid var(--green-200)", borderRadius: 10, marginBottom: 16 }}>
                <i data-lucide="check-circle" style={{ width: 15, height: 15, color: "var(--green-500)", flexShrink: 0 }}></i>
                <span style={{ fontSize: 12.5, color: "var(--green-700)" }}>{successMsg}</span>
              </div>
            )}

            {/* Microsoft SSO — only show on sign-in mode */}
            {mode === "login" && (<>
              <button onClick={loginMicrosoft} disabled={!!loading}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "13px 16px", borderRadius: 10, width: "100%",
                  border: "1.5px solid #0078d4", background: loading === "microsoft" ? "#f0f7ff" : "#fff",
                  cursor: loading ? "default" : "pointer", fontSize: 14, fontWeight: 700, color: "#0078d4", transition: "all 150ms", marginBottom: 8 }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "#f0f7ff"; }}
                onMouseLeave={(e) => { if (loading !== "microsoft") e.currentTarget.style.background = "#fff"; }}>
                <svg width="20" height="20" viewBox="0 0 21 21" fill="none" style={{ flexShrink: 0 }}>
                  <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                </svg>
                <span style={{ flex: 1, textAlign: "left" }}>
                  {loading === "microsoft" ? "Redirecting to Microsoft…" : "Continue with Microsoft (pal.tech)"}
                </span>
                {loading === "microsoft"
                  ? <span className="dt-spin" style={{ width: 16, height: 16, border: "2px solid #cce4f7", borderTopColor: "#0078d4", borderRadius: "50%" }}></span>
                  : <i data-lucide="arrow-right" style={{ width: 15, height: 15 }}></i>}
              </button>
              {!msConfig?.ms_configured && (
                <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginBottom: 8, paddingLeft: 4 }}>
                  <i data-lucide="info" style={{ width: 12, height: 12, verticalAlign: "-1px", marginRight: 4 }}></i>
                  Azure App not configured — will use demo mode. See README → Microsoft SSO Setup.
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 0" }}>
                <div style={{ flex: 1, height: 1, background: "var(--grey-200)" }}></div>
                <span style={{ fontSize: 11.5, color: "var(--fg-3)", fontWeight: 600 }}>OR with email + password</span>
                <div style={{ flex: 1, height: 1, background: "var(--grey-200)" }}></div>
              </div>
            </>)}

            {/* Email / password form — shared by both modes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {mode === "register" && (
                <Input label="Full name" icon="user" value={name} onChange={v => { setName(v); setAuthError(""); }} placeholder="First Last" />
              )}
              <Input label="Work email" icon="mail" value={email} onChange={v => { setEmail(v); setAuthError(""); }} placeholder="firstname.lastname@pal.tech" />
              <Input label="Password" icon="lock" type="password" value={pw} onChange={setPw}
                placeholder={mode === "register" ? "Min. 8 characters" : "••••••••••"} />
              {mode === "login" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
                  <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 12.5, color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>Forgot password?</a>
                </div>
              )}
              <Button variant="primary" onClick={mode === "login" ? signin : register} disabled={!!loading} style={{ width: "100%", padding: "11px" }}>
                {loading === "email"
                  ? (mode === "login" ? "Signing in…" : "Creating account…")
                  : (mode === "login" ? "Sign in" : "Create account")}
              </Button>
            </div>

            <p style={{ fontSize: 12, color: "var(--fg-3)", textAlign: "center", marginTop: 20, lineHeight: 1.5 }}>
              {mode === "login"
                ? <>Don't have an account? <a href="#" onClick={e => { e.preventDefault(); setMode("register"); clearForm(); }} style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>Create one</a></>
                : <>Already have an account? <a href="#" onClick={e => { e.preventDefault(); setMode("login"); clearForm(); }} style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>Sign in</a></>}
            </p>
            <p style={{ fontSize: 11.5, color: "var(--fg-3)", textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
              Protected by pal.tech's acceptable use and data governance policies.</p>
          </div>
        </div>
      </div>
    );
  };

  // ---------------- Connect Data Source wizard ----------------
  const PLATFORMS = [
    { id: "sqlserver",  name: "SQL Server",       glyph: "⬡", color: "#cc2020",           sub: "Microsoft SQL Server"       },
    { id: "snowflake",  name: "Snowflake",         glyph: "❄", color: "var(--navy-500)",   sub: "Cloud data platform"        },
    { id: "databricks", name: "Databricks",        glyph: "▲", color: "var(--orange-500)", sub: "Lakehouse"                  },
    { id: "postgres",   name: "PostgreSQL",        glyph: "🐘", color: "#336791",          sub: "Open-source RDBMS"          },
    { id: "fabric",     name: "Microsoft Fabric",  glyph: "◰", color: "var(--green-600)",  sub: "Unified analytics"          },
    { id: "bigquery",   name: "Google BigQuery",   glyph: "◈", color: "var(--blue-600)",   sub: "Serverless warehouse"       },
    { id: "duckdb",     name: "DuckDB",            glyph: "🦆", color: "var(--yellow-600)","sub": "Local / in-process DB"   },
  ];

  // Platform-specific form field definitions
  const PLATFORM_FIELDS = {
    sqlserver: {
      authTypes: [
        { id: "sql",       label: "SQL Server Auth", icon: "lock"          },
        { id: "windows",   label: "Windows Auth",    icon: "monitor"       },
        { id: "azure_ad",  label: "Azure AD",        icon: "shield-check"  },
      ],
      fields: (authType) => [
        { key: "host",     label: "Server name / IP",   placeholder: "MYSERVER or 192.168.1.10",            full: false },
        { key: "port",     label: "Port",               placeholder: "1433",                                   full: false },
        { key: "database", label: "Database",           placeholder: "Leave blank to use default database",    full: false, optional: true },
        { key: "instance", label: "Instance",           placeholder: "SQLEXPRESS  (optional)",                 full: false, optional: true },
        ...(authType !== "windows" ? [
          { key: "username", label: "Login / Username", placeholder: "sa",                         full: false },
          { key: "password", label: "Password",         placeholder: "••••••••",    type: "password", full: false },
        ] : []),
      ],
    },
    snowflake: {
      authTypes: [
        { id: "keypair",  label: "Key pair",   icon: "key-round"    },
        { id: "oauth",    label: "OAuth 2.0",  icon: "shield-check" },
        { id: "password", label: "Password",   icon: "lock"         },
      ],
      fields: (authType) => [
        { key: "account",  label: "Account / host",    placeholder: "org-account.us-east-1", full: false },
        { key: "warehouse",label: "Warehouse",          placeholder: "COMPUTE_WH",            full: false },
        { key: "database", label: "Database",           placeholder: "MY_DB",                 full: false },
        { key: "role",     label: "Role (optional)",    placeholder: "DQ_SERVICE_ROLE",       full: false },
        ...(authType === "password" ? [
          { key: "username", label: "Username",         placeholder: "my_user",               full: false },
          { key: "password", label: "Password",         placeholder: "••••••••", type: "password", full: false },
        ] : []),
      ],
    },
    postgres: {
      authTypes: [{ id: "password", label: "Password", icon: "lock" }],
      fields: () => [
        { key: "host",     label: "Host",     placeholder: "localhost",  full: false },
        { key: "port",     label: "Port",     placeholder: "5432",       full: false },
        { key: "database", label: "Database", placeholder: "my_db",      full: false },
        { key: "username", label: "Username", placeholder: "postgres",   full: false },
        { key: "password", label: "Password", placeholder: "••••••••",  type: "password", full: false },
      ],
    },
    databricks: {
      authTypes: [
        { id: "pat",   label: "Access Token", icon: "key-round"    },
        { id: "oauth", label: "OAuth M2M",    icon: "shield-check" },
      ],
      fields: () => [
        { key: "host",      label: "Workspace host",  placeholder: "adb-12345.azuredatabricks.net", full: true },
        { key: "http_path", label: "HTTP path",       placeholder: "/sql/1.0/warehouses/abc123",     full: true },
        { key: "database",  label: "Schema / database", placeholder: "default",                     full: false },
        { key: "token",     label: "Personal access token", placeholder: "dapi…", type: "password", full: true },
      ],
    },
    duckdb: {
      authTypes: [],
      fields: () => [
        { key: "file_path", label: "File path", placeholder: "/data/mydb.duckdb  (or :memory:)", full: true },
      ],
    },
    fabric:   { authTypes: [{ id: "oauth", label: "OAuth 2.0", icon: "shield-check" }], fields: () => [{ key: "host", label: "Endpoint", placeholder: "myworkspace.fabric.microsoft.com", full: true }] },
    bigquery: { authTypes: [{ id: "service_account", label: "Service account", icon: "file-key-2" }], fields: () => [{ key: "database", label: "Project ID", placeholder: "my-gcp-project", full: true }] },
  };

  const TEST_STEPS = ["Resolving host / endpoint", "Establishing secure connection", "Authenticating credentials", "Verifying database access", "Listing accessible schemas", "Validating read permissions"];

  const ConnectWizard = ({ onDone, onSkip, inApp }) => {
    const [step, setStep] = React.useState(0); // 0 platform 1 creds 2 test 3 schema 4 done
    const [plat, setPlat] = React.useState("sqlserver");
    const [authMethod, setAuthMethod] = React.useState("sql");
    const [testIdx, setTestIdx] = React.useState(0);
    const [testSuccess, setTestSuccess] = React.useState(null); // null | true | false
    const [testError, setTestError] = React.useState("");
    const [retryKey, setRetryKey] = React.useState(0);
    const [testStepsLive, setTestStepsLive] = React.useState([]);
    const [apiSchemas, setApiSchemas] = React.useState([]);       // schemas from real API
    const [schemas, setSchemas] = React.useState([]);
    const [connName, setConnName] = React.useState("My Connection");
    const [saving, setSaving] = React.useState(false);
    const [savedConnId, setSavedConnId] = React.useState(null);
    const [savedSchemasCount, setSavedSchemasCount] = React.useState(0);
    const [form, setForm] = React.useState({});
    useIcons();
    const P = PLATFORMS.find(p => p.id === plat);
    const platCfg = PLATFORM_FIELDS[plat] || PLATFORM_FIELDS.snowflake;

    // Reset auth method when platform changes
    React.useEffect(() => {
      const first = (PLATFORM_FIELDS[plat]?.authTypes || [])[0];
      setAuthMethod(first?.id || "password");
      setForm({});
    }, [plat]);

    // Wire "Test connection" step to real API
    React.useEffect(() => {
      if (step !== 2) return;
      setTestIdx(0); setTestSuccess(null); setTestError(""); setTestStepsLive([]);
      const credentials = { ...form, auth_type: authMethod };
      const payload = { platform: plat, credentials };

      const testFn = window.DTApi?.testConnection;
      if (typeof testFn !== "function") {
        // Demo / backend not running — animate through steps, show success
        setTestStepsLive(TEST_STEPS);
        let i = 0;
        const t = setInterval(() => {
          i++;
          setTestIdx(i);
          if (i >= TEST_STEPS.length) { clearInterval(t); setTestSuccess(true); setTimeout(() => setStep(3), 500); }
        }, 480);
        return () => clearInterval(t);
      }

      testFn(payload)
        .then(result => {
          const steps = result.details?.length ? result.details : TEST_STEPS;
          setTestStepsLive(steps);
          setTestIdx(steps.length);
          setTestSuccess(result.success);
          setTestError(result.success ? "" : (result.message || "Connection failed. Check your credentials and try again."));
          if (result.success) {
            const disc = result.schemas || [];
            if (disc.length > 0) {
              setApiSchemas(disc);
              setSchemas(disc.map(() => true));
            }
            setTimeout(() => setStep(3), 700);
          }
        })
        .catch(err => {
          setTestStepsLive(TEST_STEPS);
          setTestIdx(TEST_STEPS.length);
          setTestSuccess(false);
          setTestError("Could not reach backend: " + (err?.message || String(err)));
        });
    }, [step, retryKey]);

    const STEPS = ["Platform", "Credentials", "Test", "Scope", "Done"];
    const Stepper = () => (
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 26 }}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: i < step ? "var(--green-500)" : i === step ? "var(--brand)" : "var(--grey-100)", color: i <= step ? "#fff" : "var(--fg-3)", fontSize: 12, fontWeight: 700 }}>
                {i < step ? <i data-lucide="check" style={{ width: 13, height: 13 }}></i> : i + 1}</span>
              <span style={{ fontSize: 12.5, fontWeight: i === step ? 700 : 500, color: i === step ? "var(--fg-1)" : "var(--fg-3)" }}>{s}</span>
            </div>
            {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i < step ? "var(--green-300)" : "var(--grey-100)", margin: "0 12px" }}></div>}
          </React.Fragment>
        ))}
      </div>
    );

    const shell = (children) => inApp ? <div className="dt-fade-up">{children}</div> : (
      <div style={{ minHeight: "100vh", background: "var(--bg-app)", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 24px", fontFamily: "var(--font-ui)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: "var(--brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><i data-lucide="shield-check" style={{ width: 19, height: 19 }}></i></span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18 }}>DataTrust</div>
        </div>
        <div style={{ width: "100%", maxWidth: 640 }}>{children}</div>
      </div>
    );

    return shell(
      <Card pad={28}>
        {!inApp && (
          <div style={{ marginBottom: 22 }}>
            <Eyebrow style={{ marginBottom: 6 }}>Onboarding · Step {step + 1} of 5</Eyebrow>
            <h2 style={{ fontSize: 22 }}>Connect your data platform</h2>
            <p style={{ fontSize: 13.5, color: "var(--fg-2)", marginTop: 5 }}>DataTrust reads metadata and runs quality checks in-warehouse. It never copies your data out.</p>
          </div>
        )}
        <Stepper />

        {/* Step 0 — platform */}
        {step === 0 && (
          <div className="dt-fade-up" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {PLATFORMS.map(p => (
              <button key={p.id} onClick={() => setPlat(p.id)} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                border: `1.5px solid ${plat === p.id ? "var(--brand)" : "var(--grey-200)"}`, background: plat === p.id ? "var(--brand-soft)" : "#fff", transition: "all 150ms" }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, background: p.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 19, flexShrink: 0 }}>{p.glyph}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-2)" }}>{p.sub}</div>
                </div>
                <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${plat === p.id ? "var(--brand)" : "var(--grey-300)"}`, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {plat === p.id && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--brand)" }}></span>}</span>
              </button>
            ))}
          </div>
        )}

        {/* Step 1 — credentials (dynamic per platform) */}
        {step === 1 && (
          <div className="dt-fade-up">
            {/* Platform badge + connection name */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--grey-50)", borderRadius: 10, marginBottom: 16 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: P.color, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>{P.glyph}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{P.name}</span>
              <button onClick={() => setStep(0)} style={{ marginLeft: "auto", fontSize: 12, color: "var(--brand)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>Change</button>
            </div>
            <Input label="Connection name" value={connName} onChange={setConnName} placeholder="e.g. Production SQL Server" style={{ marginBottom: 14 }} />

            {/* Auth method selector (only shown if platform has multiple options) */}
            {platCfg.authTypes.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>Authentication type</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {platCfg.authTypes.map(({ id, label, icon }) => (
                    <button key={id} onClick={() => setAuthMethod(id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 8px", borderRadius: 10, cursor: "pointer",
                      border: `1.5px solid ${authMethod === id ? "var(--brand)" : "var(--grey-200)"}`, background: authMethod === id ? "var(--brand-soft)" : "#fff" }}>
                      <i data-lucide={icon} style={{ width: 17, height: 17, color: authMethod === id ? "var(--brand)" : "var(--fg-2)" }}></i>
                      <span style={{ fontSize: 12, fontWeight: 600, color: authMethod === id ? "var(--brand)" : "var(--fg-1)", textAlign: "center" }}>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Dynamic credential fields */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {platCfg.fields(authMethod).map(field => (
                <div key={field.key} style={{ gridColumn: field.full ? "1 / -1" : undefined }}>
                  <Input
                    label={field.optional
                      ? <span>{field.label} <span style={{ fontSize: 11, fontWeight: 500, color: "var(--fg-3)", background: "var(--grey-100)", borderRadius: 4, padding: "1px 5px" }}>optional</span></span>
                      : field.label}
                    type={field.type || "text"}
                    value={form[field.key] || ""}
                    onChange={(v) => setForm(f => ({ ...f, [field.key]: v }))}
                    placeholder={field.placeholder}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 12, color: "var(--fg-2)" }}>
              <i data-lucide="lock" style={{ width: 13, height: 13, color: "var(--green-600)" }}></i>
              Credentials are Fernet-encrypted before storage. Never sent to third parties.
            </div>
          </div>
        )}

        {/* Step 2 — test connection (calls real API, shows live steps) */}
        {step === 2 && (
          <div className="dt-fade-up" style={{ padding: "8px 0" }}>
            {/* Step-by-step trace */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
              {(testStepsLive.length ? testStepsLive : TEST_STEPS).map((s, i) => {
                const allDone = testIdx >= (testStepsLive.length || TEST_STEPS.length);
                const isLastStep = i === (testStepsLive.length || TEST_STEPS.length) - 1;
                const isFailed = testSuccess === false && allDone && isLastStep;
                const state = isFailed ? "fail"
                  : i < testIdx ? "done"
                  : i === testIdx ? "run"
                  : "wait";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 4px", opacity: state === "wait" ? 0.35 : 1, transition: "opacity 200ms" }}>
                    {state === "done" && <i data-lucide="check-circle-2" style={{ width: 17, height: 17, color: "var(--green-500)" }}></i>}
                    {state === "fail" && <i data-lucide="x-circle" style={{ width: 17, height: 17, color: "var(--red-500)" }}></i>}
                    {state === "run"  && <span className="dt-spin" style={{ width: 15, height: 15, border: "2px solid var(--brand-ring)", borderTopColor: "var(--brand)", borderRadius: "50%", flexShrink: 0 }}></span>}
                    {state === "wait" && <span style={{ width: 15, height: 15, borderRadius: "50%", border: "2px solid var(--grey-200)", flexShrink: 0 }}></span>}
                    <span style={{ fontSize: 13.5, fontWeight: state === "run" ? 700 : 500, color: state === "fail" ? "var(--red-600)" : "inherit" }}>{s}</span>
                  </div>
                );
              })}
            </div>

            {/* Failure reason box — appears after test finishes with an error */}
            {testError && testSuccess === false && (
              <div style={{ background: "var(--red-50)", border: "1px solid var(--red-200)", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <i data-lucide="alert-circle" style={{ width: 16, height: 16, color: "var(--red-500)", flexShrink: 0 }}></i>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--red-700)" }}>Connection failed</span>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--red-800)", lineHeight: 1.6, wordBreak: "break-word", background: "var(--red-100)", borderRadius: 8, padding: "8px 12px" }}>
                  {testError}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "var(--fg-2)" }}>
                  Common fixes: check server name/port, verify credentials, ensure SQL Server allows remote connections and the firewall allows port 1433.
                </div>
              </div>
            )}

            {/* In-progress indicator */}
            {testSuccess === null && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--fg-3)", marginTop: 4 }}>
                <span className="dt-spin" style={{ width: 12, height: 12, border: "2px solid var(--grey-200)", borderTopColor: "var(--brand)", borderRadius: "50%" }}></span>
                Testing connection…
              </div>
            )}
          </div>
        )}

        {/* Step 3 — schema scope (real schemas from test result, or example fallback) */}
        {step === 3 && (() => {
          const allSchemas = apiSchemas.length > 0 ? apiSchemas : ["raw", "bronze", "silver", "gold"];
          const selectedCount = allSchemas.filter((_, i) => schemas[i] !== false).length;
          return (
            <div className="dt-fade-up">
              {/* Success + count banner */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--green-50)", borderRadius: 10, marginBottom: 12 }}>
                <i data-lucide="check-circle-2" style={{ width: 17, height: 17, color: "var(--green-500)" }}></i>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--green-700)" }}>Connection verified</span>
                {apiSchemas.length > 0
                  ? <span style={{ fontSize: 12, color: "var(--fg-2)", marginLeft: 4 }}>— {apiSchemas.length} schemas discovered in your database</span>
                  : <span style={{ fontSize: 12, color: "var(--fg-3)", marginLeft: 4 }}>— demo mode</span>}
              </div>

              {/* Info note */}
              <div style={{ display: "flex", gap: 8, padding: "9px 13px", background: "var(--blue-50)", borderRadius: 10, marginBottom: 14, fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.5 }}>
                <i data-lucide="info" style={{ width: 14, height: 14, color: "var(--brand)", flexShrink: 0, marginTop: 1 }}></i>
                <span>
                  {apiSchemas.length > 0
                    ? <>These are the actual schemas found in your database — the names can be anything (<strong>dbo</strong>, <strong>sales</strong>, <strong>raw</strong>, etc.). Select which ones DataTrust should profile and monitor.</>
                    : <>Showing example schema names. DataTrust works with any schema name — <strong>raw / bronze / silver / gold</strong> are just common medallion-architecture examples. You can edit the scope later from the Connections page.</>}
                </span>
              </div>

              {/* Select all / deselect all */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Select schemas to monitor</label>
                <div style={{ display: "flex", gap: 12 }}>
                  <button onClick={() => setSchemas(allSchemas.map(() => true))}
                    style={{ fontSize: 12, color: "var(--brand)", fontWeight: 600, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Select all</button>
                  <span style={{ fontSize: 12, color: "var(--grey-300)" }}>|</span>
                  <button onClick={() => setSchemas(allSchemas.map(() => false))}
                    style={{ fontSize: 12, color: "var(--fg-3)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Deselect all</button>
                </div>
              </div>

              {/* Schema pills */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 9, marginBottom: 16 }}>
                {allSchemas.map((schemaName, i) => {
                  const selected = schemas[i] !== undefined ? schemas[i] : true;
                  return (
                    <button key={schemaName} onClick={() => setSchemas(arr => {
                      const next = [...arr];
                      while (next.length <= i) next.push(true);
                      next[i] = !next[i];
                      return next;
                    })} style={{
                      display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 15px",
                      borderRadius: 10, cursor: "pointer",
                      border: `1.5px solid ${selected ? "var(--brand)" : "var(--grey-200)"}`,
                      background: selected ? "var(--brand-soft)" : "#fff",
                      transition: "all 120ms",
                    }}>
                      <span style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${selected ? "var(--brand)" : "var(--grey-300)"}`, background: selected ? "var(--brand)" : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 120ms" }}>
                        {selected && <i data-lucide="check" style={{ width: 11, height: 11, color: "#fff" }}></i>}
                      </span>
                      <Mono style={{ fontWeight: 600, fontSize: 13.5, color: selected ? "var(--brand)" : "var(--fg-1)" }}>{schemaName}</Mono>
                    </button>
                  );
                })}
              </div>

              {/* Selected count summary */}
              <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                <strong style={{ color: selectedCount > 0 ? "var(--brand)" : "var(--red-500)" }}>{selectedCount}</strong> of {allSchemas.length} schema{allSchemas.length !== 1 ? "s" : ""} selected for monitoring
                {selectedCount === 0 && <span style={{ color: "var(--fg-3)", marginLeft: 8 }}>— select at least one schema to continue</span>}
              </div>
            </div>
          );
        })()}

        {/* Step 4 — done */}
        {step === 4 && (
          <div className="dt-fade-up" style={{ textAlign: "center", padding: "20px 0" }}>
            <span style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--green-50)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <i data-lucide="check" style={{ width: 32, height: 32, color: "var(--green-500)" }}></i></span>
            <h2 style={{ fontSize: 22, marginBottom: 8 }}>You're connected</h2>
            <p style={{ fontSize: 13.5, color: "var(--fg-2)", maxWidth: 380, margin: "0 auto 8px" }}><strong>{connName || `${P.name} Connection`}</strong> is live. <strong>{savedSchemasCount}</strong> schema{savedSchemasCount !== 1 ? "s" : ""} selected for monitoring. The profiling agent will run its first scan automatically.</p>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 26, paddingTop: 18, borderTop: "1px solid var(--grey-100)" }}>
          {step > 0 && step < 4 && step !== 2 && <Button variant="ghost" icon="arrow-left" onClick={() => setStep(s => s - 1)}>Back</Button>}
          {step === 2 && testSuccess === false && <Button variant="ghost" icon="arrow-left" onClick={() => { setTestSuccess(null); setTestError(""); setStep(1); }}>Back to credentials</Button>}
          <div style={{ flex: 1 }}></div>
          {!inApp && step === 0 && onSkip && <Button variant="ghost" onClick={onSkip}>Skip — explore demo</Button>}
          {step === 0 && <Button variant="primary" iconRight="arrow-right" onClick={() => setStep(1)}>Continue</Button>}
          {step === 1 && <Button variant="primary" icon="plug-zap" onClick={() => setStep(2)}>Test connection</Button>}
          {step === 2 && testSuccess === null && <Button variant="soft" disabled>Testing…</Button>}
          {step === 2 && testSuccess === false && <Button variant="primary" icon="refresh-cw" onClick={() => { setTestSuccess(null); setTestError(""); setRetryKey(k => k + 1); }}>Retry</Button>}
          {step === 3 && <Button variant="primary" iconRight="arrow-right" disabled={saving} onClick={async () => {
            setSaving(true);
            const allSchemas = apiSchemas.length > 0 ? apiSchemas : ["raw", "bronze", "silver", "gold"];
            const selectedNames = allSchemas.filter((_, i) => schemas[i] !== false);
            setSavedSchemasCount(selectedNames.length);
            try {
              const conn = await window.DTApi?.createConnection?.({
                name: connName || `${P.name} Connection`,
                platform: plat,
                environment: "production",
                credentials: { ...form, auth_type: authMethod },
                schemas_scope: selectedNames,
              });
              if (conn?.id) setSavedConnId(conn.id);
            } catch (_) {} // proceed even if API not ready
            setSaving(false); setStep(4);
          }}>{saving ? "Saving…" : "Save & continue"}</Button>}
          {step === 4 && <Button variant="primary" icon="layout-dashboard" onClick={() => onDone(savedConnId, connName || `${P.name} Connection`, plat)}>{inApp ? "Done" : "Enter workspace"}</Button>}
        </div>
      </Card>
    );
  };

  window.DTAuth = { Login, ConnectWizard };
})();
