// DataTrust — Primitives (forked from PalTech UI kit + DQ-specific additions)
// All components exported to window at the end.

const Button = ({ variant = "primary", size = "md", icon, iconRight, children, onClick, disabled, style }) => {
  const [hover, setHover] = React.useState(false);
  const base = {
    fontFamily: "var(--font-ui)", fontWeight: 700,
    fontSize: size === "sm" ? 13 : 14,
    padding: size === "sm" ? "7px 13px" : "9px 16px",
    borderRadius: 8, borderWidth: 1, borderStyle: "solid", borderColor: "transparent",
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 150ms cubic-bezier(0.2,0,0,1)", whiteSpace: "nowrap",
  };
  const variants = {
    primary:   { background: hover ? "var(--brand-hover)" : "var(--brand)", color: "#fff" },
    secondary: { background: hover ? "#000" : "var(--grey-900)", color: "#fff" },
    outline:   { background: hover ? "var(--brand-soft)" : "#fff", color: "var(--brand)", borderColor: "var(--brand)" },
    ghost:     { background: hover ? "var(--grey-100)" : "transparent", color: "var(--fg-1)" },
    danger:    { background: hover ? "var(--red-600)" : "var(--danger)", color: "#fff" },
    soft:      { background: hover ? "var(--grey-200)" : "var(--grey-100)", color: "var(--fg-1)", borderColor: "var(--grey-200)" },
  };
  const dis = disabled ? { background: "var(--grey-100)", color: "var(--fg-disabled)", borderColor: "var(--grey-200)" } : {};
  return (
    <button onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...base, ...variants[variant], ...dis, ...style }}
      onClick={disabled ? undefined : onClick}>
      {icon && <i data-lucide={icon} style={{ width: size === "sm" ? 14 : 16, height: size === "sm" ? 14 : 16 }}></i>}
      {children}
      {iconRight && <i data-lucide={iconRight} style={{ width: 15, height: 15 }}></i>}
    </button>
  );
};

const IconBtn = ({ icon, onClick, title, active, size = 36, danger }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <button title={title} onClick={onClick} style={{
      width: size, height: size, borderRadius: 8, border: "1px solid var(--grey-200)",
      background: active ? "var(--brand-soft)" : hover ? "var(--grey-50)" : "#fff",
      color: danger ? "var(--danger)" : active ? "var(--brand)" : "var(--fg-1)",
      cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
      transition: "all 150ms", flexShrink: 0,
    }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <i data-lucide={icon} style={{ width: size * 0.5, height: size * 0.5 }}></i>
    </button>
  );
};

const Chip = ({ intent = "neutral", variant = "soft", children, dot, icon, size = "md" }) => {
  const intents = {
    brand:   ["var(--blue-600)",  "var(--blue-100)",  "var(--blue-700)"],
    success: ["var(--green-500)", "var(--green-50)",  "var(--green-600)"],
    warning: ["var(--yellow-600)","var(--yellow-50)", "var(--yellow-700)"],
    danger:  ["var(--red-500)",   "var(--red-50)",    "var(--red-600)"],
    info:    ["var(--navy-500)",  "var(--blue-50)",   "var(--navy-500)"],
    purple:  ["var(--purple-500)","var(--purple-50)", "var(--purple-600)"],
    neutral: ["var(--grey-600)",  "var(--grey-100)",  "var(--grey-700)"],
  };
  const [b, soft, softText] = intents[intent];
  const styles =
    variant === "fill"    ? { background: b, color: "#fff" } :
    variant === "outline" ? { background: "#fff", color: b, border: `1px solid ${b}` } :
                            { background: soft, color: softText };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: size === "sm" ? "2px 8px" : "3px 10px",
      borderRadius: 999, fontSize: size === "sm" ? 11 : 12, fontWeight: 600, lineHeight: 1.4,
      whiteSpace: "nowrap", ...styles,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: variant === "fill" ? "#fff" : b }}></span>}
      {icon && <i data-lucide={icon} style={{ width: 12, height: 12 }}></i>}
      {children}
    </span>
  );
};

const Card = ({ children, style, hoverable, onClick, pad = 20 }) => {
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: "#fff", borderRadius: 16, border: "1px solid var(--grey-100)",
        boxShadow: hoverable && hover ? "var(--shadow-hover)" : "var(--shadow-card)",
        padding: pad, transition: "box-shadow 150ms, transform 150ms",
        transform: hoverable && hover ? "translateY(-1px)" : "none",
        cursor: onClick ? "pointer" : "default", ...style,
      }}>{children}</div>
  );
};

const Avatar = ({ name = "?", size = 32, status, color = "blue" }) => {
  const colors = {
    blue:   ["var(--blue-100)",   "var(--blue-700)"],
    green:  ["var(--green-100)",  "var(--green-700)"],
    yellow: ["var(--yellow-100)", "var(--yellow-700)"],
    red:    ["var(--red-100)",    "var(--red-500)"],
    grey:   ["var(--grey-100)",   "var(--fg-1)"],
    purple: ["var(--purple-100)", "var(--purple-600)"],
  };
  const [bg, fg] = colors[color] || colors.blue;
  const initials = name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  const sc = { online: "var(--green-500)", away: "var(--yellow-500)", busy: "var(--red-500)", offline: "var(--grey-400)" };
  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <span style={{
        width: size, height: size, borderRadius: "50%", background: bg, color: fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: size * 0.38, fontFamily: "var(--font-ui)",
      }}>{initials}</span>
      {status && <span style={{ position: "absolute", right: -1, bottom: -1, width: size * 0.3, height: size * 0.3,
        borderRadius: "50%", background: sc[status], border: "2px solid #fff" }}></span>}
    </span>
  );
};

const Input = ({ label, value, onChange, placeholder, error, icon, type = "text", hint, onKeyDown, style }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
    {label && <label style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{label}</label>}
    <div style={{ position: "relative" }}>
      {icon && <i data-lucide={icon} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 16, height: 16, color: "var(--fg-2)" }}></i>}
      <input type={type} value={value ?? ""} onKeyDown={onKeyDown}
        onChange={(e) => onChange && onChange(e.target.value)} placeholder={placeholder}
        style={{
          width: "100%", boxSizing: "border-box", padding: icon ? "10px 12px 10px 36px" : "10px 12px",
          borderRadius: 8, border: `1px solid ${error ? "var(--danger)" : "var(--grey-400)"}`,
          fontSize: 14, fontFamily: "var(--font-ui)", outline: "none", background: "#fff", color: "var(--fg-1)",
          transition: "border-color 150ms, box-shadow 150ms",
        }}
        onFocus={(e) => { if (!error) { e.target.style.borderColor = "var(--brand)"; e.target.style.boxShadow = "0 0 0 3px var(--brand-ring)"; } }}
        onBlur={(e) => { e.target.style.borderColor = error ? "var(--danger)" : "var(--grey-400)"; e.target.style.boxShadow = "none"; }}
      />
    </div>
    {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
    {hint && !error && <span style={{ fontSize: 12, color: "var(--fg-2)" }}>{hint}</span>}
  </div>
);

const Switch = ({ on, onChange, label }) => (
  <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
    <span onClick={() => onChange && onChange(!on)} style={{
      width: 36, height: 20, borderRadius: 999, position: "relative",
      background: on ? "var(--brand)" : "var(--grey-300)", transition: "background 150ms", flexShrink: 0,
    }}>
      <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.15)", transition: "left 150ms" }}></span>
    </span>
    {label && <span style={{ fontSize: 13, color: "var(--fg-1)" }}>{label}</span>}
  </label>
);

// ---------- DQ-specific additions ----------

// Severity → color mapping used across the app
const SEV = {
  CRITICAL: { c: "var(--red-500)",   bg: "var(--red-50)",    fg: "var(--red-600)",    dot: "🔴" },
  HIGH:     { c: "var(--orange-500)",bg: "var(--orange-50)", fg: "var(--orange-600)", dot: "🟠" },
  MEDIUM:   { c: "var(--yellow-500)",bg: "var(--yellow-50)", fg: "var(--yellow-700)", dot: "🟡" },
  LOW:      { c: "var(--green-500)", bg: "var(--green-50)",  fg: "var(--green-600)",  dot: "🟢" },
};
const sevIntent = { CRITICAL: "danger", HIGH: "warning", MEDIUM: "warning", LOW: "success" };

const Severity = ({ level, size = "md" }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: size === "sm" ? 11 : 12, fontWeight: 700,
    color: SEV[level].fg, letterSpacing: ".02em" }}>
    <span style={{ width: 8, height: 8, borderRadius: "50%", background: SEV[level].c, flexShrink: 0 }}></span>
    {level}
  </span>
);

// Score → color (>=85 green, >=70 yellow, else red)
const scoreColor = (s) => s >= 85 ? "var(--green-500)" : s >= 70 ? "var(--yellow-500)" : "var(--red-500)";
const scoreTint  = (s) => s >= 85 ? "var(--green-50)"  : s >= 70 ? "var(--yellow-50)"  : "var(--red-50)";

// Animated circular score ring
const ScoreRing = ({ score, size = 120, stroke = 10, label, sublabel, animate = true }) => {
  const [val, setVal] = React.useState(animate ? 0 : score);
  React.useEffect(() => {
    if (!animate) { setVal(score); return; }
    const from = val, dur = 850, t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min((Date.now() - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + (score - from) * eased));
      if (p >= 1) clearInterval(id);
    }, 33);
    return () => clearInterval(id);
  }, [score]);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - val / 100);
  const col = scoreColor(val);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--grey-100)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off}
          style={{ transition: "stroke 300ms" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: size * 0.3, lineHeight: 1, color: "var(--fg-1)" }}>{val}</div>
        {label && <div style={{ fontSize: size * 0.1, color: "var(--fg-2)", fontWeight: 600, marginTop: 2 }}>{label}</div>}
        {sublabel && <div style={{ fontSize: size * 0.085, color: "var(--fg-3)", marginTop: 2 }}>{sublabel}</div>}
      </div>
    </div>
  );
};

// Horizontal mini-bar for percentages
const Bar = ({ pct, color, height = 6, bg = "var(--grey-100)", radius = 999 }) => (
  <div style={{ width: "100%", height, background: bg, borderRadius: radius, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color || "var(--brand)",
      borderRadius: radius, transition: "width 500ms cubic-bezier(0.2,0,0,1)" }}></div>
  </div>
);

// Bar-chart sparkline (array of {label,value}); highlight last
const BarSeries = ({ data, height = 64, highlightLast, baseColor = "var(--grey-300)", lastColor = "var(--red-500)", fmt }) => {
  const max = Math.max(...data.map(d => d.value)) || 1;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, width: "100%" }}>
      {data.map((d, i) => {
        const isLast = i === data.length - 1;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
            <div style={{ width: "100%", height: `${(d.value / max) * 100}%`, minHeight: 3,
              background: highlightLast && isLast ? lastColor : baseColor, borderRadius: 3,
              transition: "height 600ms cubic-bezier(0.2,0,0,1)" }}></div>
            <div style={{ fontSize: 9, color: isLast ? "var(--fg-1)" : "var(--fg-3)", fontWeight: isLast ? 700 : 500, whiteSpace: "nowrap" }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
};

// SVG line chart for trends
const LineChart = ({ data, height = 140, color = "var(--brand)", yMin = 0, yMax = 100, fill = true }) => {
  const w = 600;
  const pad = 8;
  const xs = data.map((_, i) => pad + (i / (data.length - 1)) * (w - pad * 2));
  const ys = data.map(d => height - pad - ((d.value - yMin) / (yMax - yMin)) * (height - pad * 2));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${path} L${xs[xs.length-1].toFixed(1)},${height-pad} L${xs[0].toFixed(1)},${height-pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ display: "block" }}>
      {[0.25, 0.5, 0.75].map(g => <line key={g} x1={pad} x2={w-pad} y1={height*g} y2={height*g} stroke="var(--grey-100)" strokeWidth={1} />)}
      {fill && <path d={area} fill={color} opacity={0.08} />}
      <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => i === data.length - 1 && (
        <circle key={i} cx={xs[i]} cy={ys[i]} r={4} fill={color} stroke="#fff" strokeWidth={2} />
      ))}
    </svg>
  );
};

// Section heading row
const SectionTitle = ({ children, sub, right, icon }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: sub ? 4 : 14 }}>
    {icon && <i data-lucide={icon} style={{ width: 18, height: 18, color: "var(--fg-2)" }}></i>}
    <div style={{ flex: 1 }}>
      <div style={{ fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 16, letterSpacing: "-0.01em", color: "var(--fg-1)" }}>{children}</div>
      {sub && <div style={{ fontSize: 13, color: "var(--fg-2)", marginTop: 3 }}>{sub}</div>}
    </div>
    {right}
  </div>
);

// Token-cap label (ALL CAPS category label)
const Eyebrow = ({ children, color = "var(--fg-2)", style }) => (
  <div style={{ fontFamily: "var(--font-label)", fontWeight: 700, fontSize: 11, letterSpacing: ".06em",
    textTransform: "uppercase", color, ...style }}>{children}</div>
);

const Mono = ({ children, style }) => (
  <span style={{ fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace', fontSize: 12.5, ...style }}>{children}</span>
);

// Layer pill (RAW/BRONZE/SILVER/GOLD)
const LAYER_COLORS = {
  RAW:    ["var(--grey-100)",   "var(--grey-700)"],
  BRONZE: ["var(--orange-50)",  "var(--orange-600)"],
  SILVER: ["var(--blue-50)",    "var(--navy-500)"],
  GOLD:   ["var(--yellow-50)",  "var(--yellow-700)"],
};
const LayerPill = ({ layer, size = "md" }) => {
  const [bg, fg] = LAYER_COLORS[layer] || LAYER_COLORS.RAW;
  return <span style={{ display: "inline-flex", alignItems: "center", background: bg, color: fg,
    fontSize: size === "sm" ? 10 : 11, fontWeight: 700, letterSpacing: ".05em", padding: size === "sm" ? "2px 7px" : "3px 9px",
    borderRadius: 6, fontFamily: "var(--font-label)" }}>{layer}</span>;
};

// Health status icon (HEALTHY / WARN / CRIT / PASS / FAIL)
const Health = ({ status }) => {
  const map = {
    HEALTHY: ["check-circle-2", "var(--green-500)"], PASS: ["check-circle-2", "var(--green-500)"],
    WARN:    ["alert-triangle", "var(--yellow-600)"],
    CRIT:    ["x-circle", "var(--red-500)"], FAIL: ["x-circle", "var(--red-500)"],
    OK:      ["check", "var(--grey-500)"],
  };
  const [icon, color] = map[status] || map.OK;
  return <i data-lucide={icon} style={{ width: 16, height: 16, color }}></i>;
};

// Toast container + helper (global event bus)
function useToasts() {
  const [toasts, setToasts] = React.useState([]);
  React.useEffect(() => {
    const handler = (e) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(t => [...t, { id, ...e.detail }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), e.detail.duration || 3800);
    };
    window.addEventListener("dt-toast", handler);
    return () => window.removeEventListener("dt-toast", handler);
  }, []);
  return toasts;
}
const toast = (msg, opts = {}) => window.dispatchEvent(new CustomEvent("dt-toast", { detail: { msg, ...opts } }));
const ToastHost = () => {
  const toasts = useToasts();
  const icons = { success: "check-circle-2", error: "x-circle", info: "info", warning: "alert-triangle" };
  const colors = { success: "var(--green-500)", error: "var(--red-500)", info: "var(--brand)", warning: "var(--yellow-600)" };
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", flexDirection: "column", gap: 10, zIndex: 9999 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "var(--grey-900)", color: "#fff",
          padding: "12px 16px", borderRadius: 12, boxShadow: "var(--shadow-modal)", maxWidth: 380, fontSize: 13,
          animation: "dtSlideIn 220ms cubic-bezier(0.2,0,0,1)" }}>
          <i data-lucide={icons[t.kind] || "info"} style={{ width: 18, height: 18, color: colors[t.kind] || "#fff", flexShrink: 0, marginTop: 1 }}></i>
          <div>
            {t.title && <div style={{ fontWeight: 700, marginBottom: 2 }}>{t.title}</div>}
            <div style={{ color: "rgba(255,255,255,.85)", lineHeight: 1.45 }}>{t.msg}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

// Simple modal
const Modal = ({ open, onClose, title, children, width = 560, footer }) => {
  React.useEffect(() => { if (window.lucide) window.lucide.createIcons(); });
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "dtFade 150ms ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width, maxWidth: "100%",
        maxHeight: "90vh", overflow: "auto", boxShadow: "var(--shadow-modal)", animation: "dtPop 180ms cubic-bezier(0.2,0,0,1)" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "18px 22px", borderBottom: "1px solid var(--grey-100)" }}>
          <div style={{ flex: 1, fontFamily: "var(--font-doc-head)", fontWeight: 700, fontSize: 17 }}>{title}</div>
          <IconBtn icon="x" onClick={onClose} size={32} />
        </div>
        <div style={{ padding: 22 }}>{children}</div>
        {footer && <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 22px", borderTop: "1px solid var(--grey-100)" }}>{footer}</div>}
      </div>
    </div>
  );
};

Object.assign(window, {
  Button, IconBtn, Chip, Card, Avatar, Input, Switch,
  Severity, SEV, sevIntent, scoreColor, scoreTint, ScoreRing, Bar, BarSeries, LineChart,
  SectionTitle, Eyebrow, Mono, LayerPill, LAYER_COLORS, Health,
  ToastHost, toast, Modal,
});
