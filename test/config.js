/**
 * Shared test configuration for all Data Alchemist UI tests.
 *
 * Key features:
 *  - Session caching: login once, reuse token + connection across runs
 *  - Smart waits: event-based instead of fixed timeouts
 *  - App health check: fail fast if Docker isn't running
 *  - Auto connection: selects a connection if none is active
 *  - Per-run screenshot folder: each run in its own subfolder
 */

const path = require('path');
const fs   = require('fs');
const http = require('http');

// ── App settings ──────────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost';

// ── Test user credentials ─────────────────────────────────────────────────────
const CREDENTIALS = {
  email:    'shweta.katkar@pal.tech',
  password: 'May@123!!',
};

// ── Viewport ──────────────────────────────────────────────────────────────────
const VIEWPORT = { width: 1400, height: 900 };

// ── Timeouts (ms) ─────────────────────────────────────────────────────────────
const TIMEOUTS = {
  default:    40000,
  appReady:   30000,   // wait for authenticated app shell (Docker can be slow)
  screenLoad: 10000,   // wait for screen-specific content after goTo
};

// ── Session cache ─────────────────────────────────────────────────────────────
// Stores dt_user + active connection so tests skip the login form.
// Delete .session.json to force a fresh login on the next run.
const SESSION_FILE = path.join(__dirname, '.session.json');

// ── Per-run screenshot folder ─────────────────────────────────────────────────
// Each run writes to test/screenshots/<YYYY-MM-DDTHH-MM-SS>/ — never overwritten.
const _runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots', _runId);

async function ss(page, name) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`  📸 ${name}.png`);
}

// ── App health check ──────────────────────────────────────────────────────────
async function checkAppHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE_URL, (res) => {
      if (res.statusCode < 500) resolve();
      else reject(new Error(`App returned HTTP ${res.statusCode}`));
    });
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error(`App unreachable at ${BASE_URL} — is Docker running?\n  Try: docker compose up`));
    });
    req.on('error', (e) =>
      reject(new Error(`App unreachable at ${BASE_URL}: ${e.message}\n  Try: docker compose up`))
    );
  });
}

// ── Screen confirmation text ──────────────────────────────────────────────────
const SCREEN_INDICATORS = {
  home:        'Overall Trust',
  profiling:   'select dataset',
  metadata:    'Data Dictionary',
  rules:       'Rule Studio',
  execution:   'DQ Execution',
  anomalies:   'Anomaly Inbox',
  dashboard:   'Trust Dashboard',
  connections: 'Connections',
  simulator:   'Scenario Simulator',
  tasks:       'Task Board',
  intel:       'Advisory',
  impact:      'Impact Graph',
};

// Sidebar label fragments used for clicking
const _SIDEBAR_LABELS = {
  home:        'workspace home',
  profiling:   'profiling',
  metadata:    'dictionary',
  rules:       'rule studio',
  execution:   'dq execution',
  anomalies:   'anomaly',
  dashboard:   'trust dashboard',
  connections: 'connections',
  simulator:   'scenario simulator',
  tasks:       'task board',
  intel:       'advisory',
  impact:      'impact graph',
};

// ── Browser launch ────────────────────────────────────────────────────────────
/**
 * Launch Chromium, optionally inject a saved session before page loads.
 * Returns { browser, page }.
 */
async function launchBrowser({ chromium }, { headless = false, slowMo = 80 } = {}) {
  const browser = await chromium.launch({ headless, slowMo });
  const page    = await browser.newPage();
  await page.setViewportSize(VIEWPORT);
  page.setDefaultTimeout(TIMEOUTS.default);
  await _injectSavedSession(page);   // no-op if no session file
  return { browser, page };
}

// ── Session helpers ───────────────────────────────────────────────────────────

async function _injectSavedSession(page) {
  if (!fs.existsSync(SESSION_FILE)) return false;
  let saved;
  try { saved = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return false; }
  if (!saved?.sessionStorage?.dt_user) return false;

  // addInitScript runs BEFORE any page script — sets storage before React mounts
  await page.addInitScript((data) => {
    try {
      Object.entries(data.sessionStorage || {}).forEach(([k, v]) => { if (v) sessionStorage.setItem(k, v); });
      Object.entries(data.localStorage  || {}).forEach(([k, v]) => { if (v) localStorage.setItem(k, v); });
    } catch (_) {}
  }, saved);

  return true;
}

async function _saveSession(page) {
  try {
    const data = await page.evaluate(() => ({
      sessionStorage: {
        dt_user:  sessionStorage.getItem('dt_user'),
        dt_token: sessionStorage.getItem('dt_token'),   // JWT — must be restored so API calls don't 401
      },
      localStorage: {
        dt_conn_id:       localStorage.getItem('dt_conn_id'),
        dt_conn_name:     localStorage.getItem('dt_conn_name'),
        dt_conn_platform: localStorage.getItem('dt_conn_platform'),
      },
    }));
    if (data.sessionStorage.dt_user) {
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
      const connMsg = data.localStorage.dt_conn_id
        ? ` + connection "${data.localStorage.dt_conn_name}"`
        : ' (no connection yet)';
      console.log(`[session] Saved${connMsg}`);
    }
  } catch (_) {}
}

// ── App shell indicator (only present when authenticated) ─────────────────────
// "Workspace Home" appears in the sidebar only after a successful login.
const _APP_SHELL_TEXT = 'Workspace Home';

// ── Login ─────────────────────────────────────────────────────────────────────
/**
 * Navigate to BASE_URL and ensure the app is authenticated.
 *
 * Flow:
 *  1. If session was injected, wait for the app shell — skip form entirely.
 *  2. If the login form appears (stale/no session), fill it, submit, wait for
 *     the app shell, then save the session for next run.
 *  3. After either path, call ensureConnection() so tests always have an
 *     active connection.
 */
async function login(page, { email = CREDENTIALS.email, password = CREDENTIALS.password } = {}) {
  await page.goto(BASE_URL);

  // Race: wait for EITHER the password input (login form) OR the app shell text.
  // Give it enough time for Babel transpilation + React render (~8s on slow machines).
  const which = await Promise.race([
    page.waitForSelector('input[type="password"]', { timeout: TIMEOUTS.appReady })
        .then(() => 'form').catch(() => null),
    page.waitForFunction(
      (t) => document.body.innerText.includes(t),
      _APP_SHELL_TEXT,
      { timeout: TIMEOUTS.appReady }
    ).then(() => 'app').catch(() => null),
  ]);

  if (which === 'app') {
    console.log('[login] ✅ Session restored — skipped login form');
    await ensureConnection(page);
    return;
  }

  if (which !== 'form') {
    throw new Error('App did not show login form or app shell within timeout — is Docker running?');
  }

  // Fill the login form
  console.log('[login] Filling login form...');
  const emailField = page
    .locator('input[type="text"], input[type="email"], input[placeholder*="pal.tech"], input[placeholder*="firstname" i]')
    .first();
  await emailField.click({ clickCount: 3 });
  await emailField.fill(email);

  const passField = page.locator('input[type="password"]').first();
  await passField.click({ clickCount: 3 });
  await passField.fill(password);

  await page.locator('button').filter({ hasText: /^Sign in$/ }).last().click();
  console.log('[login] Clicked Sign in');

  // Wait until app shell appears
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    _APP_SHELL_TEXT,
    { timeout: TIMEOUTS.appReady }
  );
  console.log('[login] ✅ Authenticated');

  await ensureConnection(page);
  await _saveSession(page);   // save session so next run skips the form
}

// ── Auto-select connection ────────────────────────────────────────────────────
/**
 * If no active connection is set in localStorage, fetch the connections list,
 * pick the first one, write it into localStorage, and reload the page.
 * Saves the updated session after setting a connection.
 */
async function ensureConnection(page) {
  const hasConn = await page.evaluate(() => !!localStorage.getItem('dt_conn_id'));
  if (hasConn) {
    const name = await page.evaluate(() => localStorage.getItem('dt_conn_name'));
    console.log(`[connection] Active: "${name}"`);
    return;
  }

  console.log('[connection] None set — auto-selecting from API...');

  // Fetch connections list — note: must await r.json() inside evaluate
  let connections;
  try {
    connections = await page.evaluate(async () => {
      const r = await fetch('/api/connections');
      return r.ok ? await r.json() : [];
    });
  } catch (e) {
    console.warn('[connection] API call failed:', e.message);
    return;
  }

  if (!Array.isArray(connections) || connections.length === 0) {
    console.warn('[connection] No connections found — some tests may be limited');
    return;
  }

  // Prefer non-demo connection
  // API returns { id, name, platform, ... } — prefer non-demo connections
  const pick = connections.find(c => !c.name?.toLowerCase().includes('demo'))
    || connections[0];

  // Write into localStorage (same keys the app uses: dt_conn_id, dt_conn_name, dt_conn_platform)
  await page.evaluate(({ id, name, platform }) => {
    localStorage.setItem('dt_conn_id',       id       || '');
    localStorage.setItem('dt_conn_name',     name     || '');
    localStorage.setItem('dt_conn_platform', platform || '');
  }, { id: pick.id, name: pick.name, platform: pick.platform });

  // Save session to file NOW (captures dt_user + new connection) so addInitScript
  // can restore both after the upcoming reload clears sessionStorage.
  await _saveSession(page);
  await _injectSavedSession(page);   // registers addInitScript for the reload

  // Reload so React re-initializes useState() from the updated localStorage
  await page.reload({ waitUntil: 'load' });

  // addInitScript restored dt_user → app shows shell, not login
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    _APP_SHELL_TEXT,
    { timeout: TIMEOUTS.appReady }
  );

  console.log(`[connection] ✅ Set to "${pick.connection_name}"`);
}

// ── Navigation ────────────────────────────────────────────────────────────────
/**
 * Navigate to a screen via the sidebar and confirm arrival.
 * @param {import('playwright').Page} page
 * @param {string} screenId  — key from SCREEN_INDICATORS
 */
async function goTo(page, screenId) {
  const labelFragment = _SIDEBAR_LABELS[screenId] || screenId.toLowerCase();

  await page.evaluate((label) => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
    const target = btns.find(b => b.innerText?.toLowerCase().includes(label));
    if (target) target.click();
  }, labelFragment);

  const indicator = SCREEN_INDICATORS[screenId];
  if (indicator) {
    await page
      .waitForFunction(
        (text) => document.body.innerText.includes(text),
        indicator,
        { timeout: TIMEOUTS.screenLoad }
      )
      .catch(() => console.warn(`[goTo] "${indicator}" not seen within ${TIMEOUTS.screenLoad}ms`));
  }
  console.log(`[goTo] → "${screenId}"`);
}

// ── JS error collector ────────────────────────────────────────────────────────
function collectJsErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  return errors;
}

// ── Assertions ────────────────────────────────────────────────────────────────
function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
  console.log(`  ✅ ${message}`);
}

async function assertBodyContains(page, text, label) {
  const body = await page.locator('body').innerText();
  assert(body.includes(text), label || `Body contains "${text}"`);
}

function assertNoJsErrors(errors, label = 'No JavaScript errors') {
  if (errors.length > 0) {
    console.log('  ❌ JS errors:');
    errors.slice(0, 5).forEach(e => console.log('    ', e.split('\n')[0]));
    throw new Error(`Assertion failed: ${label} — ${errors.length} error(s)`);
  }
  console.log(`  ✅ ${label}`);
}

async function assertNotBlank(page, label = 'Page is not blank') {
  const chars = (await page.locator('body').innerText()).trim().length;
  assert(chars > 100, `${label} (${chars} chars)`);
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  BASE_URL,
  CREDENTIALS,
  VIEWPORT,
  TIMEOUTS,
  SCREENSHOTS_DIR,
  SCREEN_INDICATORS,
  ss,
  checkAppHealth,
  launchBrowser,
  login,
  goTo,
  ensureConnection,
  collectJsErrors,
  assert,
  assertBodyContains,
  assertNoJsErrors,
  assertNotBlank,
};
