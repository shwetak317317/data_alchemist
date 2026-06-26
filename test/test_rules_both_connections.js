/**
 * Screenshots Rule Studio for each connection independently.
 * Uses API-level login so there's no session/localStorage clash.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');
const { BASE_URL, VIEWPORT, SCREENSHOTS_DIR, ss, checkAppHealth } = require('./config');

const CREDS = { email: 'shweta.katkar@pal.tech', password: 'May@123!!' };

async function loginViaApi(page) {
  const token = await page.evaluate(async ({ email, password }) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const d = await r.json();
    return d.token || d.access_token || null;
  }, CREDS);
  if (!token) throw new Error('Login failed');
  await page.evaluate((t) => {
    sessionStorage.setItem('dt_token', t);
    sessionStorage.setItem('dt_user', JSON.stringify({ email: CREDS.email, name: 'Test' }));
  }, token);
  return token;
}

async function setConnection(page, conn) {
  await page.evaluate(({ id, name, platform }) => {
    localStorage.setItem('dt_conn_id',       id);
    localStorage.setItem('dt_conn_name',     name);
    localStorage.setItem('dt_conn_platform', platform);
  }, { id: conn.id, name: conn.name, platform: conn.platform });
}

async function loadApp(page, conn) {
  // Navigate fresh — inject token + connection via addInitScript so React picks them up
  const tokenHolder = { token: null };
  tokenHolder.token = await page.evaluate(() => sessionStorage.getItem('dt_token'));

  await page.addInitScript(({ token, conn }) => {
    sessionStorage.setItem('dt_token', token);
    sessionStorage.setItem('dt_user', JSON.stringify({ email: 'shweta.katkar@pal.tech', name: 'SK' }));
    localStorage.setItem('dt_conn_id',       conn.id);
    localStorage.setItem('dt_conn_name',     conn.name);
    localStorage.setItem('dt_conn_platform', conn.platform);
  }, { token: tokenHolder.token, conn: { id: conn.id, name: conn.name, platform: conn.platform } });

  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t), 'Workspace Home', { timeout: 20000 }
  );
}

(async () => {
  await checkAppHealth();

  const browser = await chromium.launch({ headless: true, slowMo: 50 });
  const jsErrors = [];

  try {
    // ── Get connections list ───────────────────────────────────────────────
    const apiPage = await browser.newPage();
    await apiPage.goto(BASE_URL, { waitUntil: 'load' });
    await loginViaApi(apiPage);

    const connections = await apiPage.evaluate(async () => {
      const r = await fetch('/api/connections', {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('dt_token')}` }
      });
      return r.ok ? await r.json() : [];
    });
    console.log('[connections]', connections.map(c => `"${c.name}"`).join(', '));
    const token = await apiPage.evaluate(() => sessionStorage.getItem('dt_token'));
    await apiPage.close();

    // ── Screenshot each connection ─────────────────────────────────────────
    for (const conn of connections) {
      console.log(`\n=== "${conn.name}" (${conn.id.slice(0,8)}) ===`);
      const slug = conn.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

      const page = await browser.newPage();
      await page.setViewportSize(VIEWPORT);
      page.on('console', m => { if (m.type() === 'error') jsErrors.push(`[${conn.name}] ${m.text()}`); });

      // Inject session + connection directly before page load
      await page.addInitScript(({ t, c }) => {
        sessionStorage.setItem('dt_token', t);
        sessionStorage.setItem('dt_user', JSON.stringify({ email: 'shweta.katkar@pal.tech', name: 'SK' }));
        localStorage.setItem('dt_conn_id',       c.id);
        localStorage.setItem('dt_conn_name',     c.name);
        localStorage.setItem('dt_conn_platform', c.platform);
      }, { t: token, c: { id: conn.id, name: conn.name, platform: conn.platform } });

      await page.goto(BASE_URL, { waitUntil: 'load' });
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t), 'Workspace Home', { timeout: 20000 }
      );

      // Verify which connection is active
      const activeName = await page.evaluate(() => localStorage.getItem('dt_conn_name'));
      console.log(`  Active connection in browser: "${activeName}"`);

      // Navigate to Rule Studio
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        const btn = btns.find(b => b.innerText?.toLowerCase().includes('rule studio'));
        if (btn) btn.click();
      });
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t), 'Rule Studio', { timeout: 10000 }
      ).catch(() => {});
      await page.waitForTimeout(2000);
      await ss(page, `${slug}_01_rule_studio`);

      // Check rules via API for this connection
      const rules = await page.evaluate(async (connId) => {
        const r = await fetch(`/api/rules?connection_id=${connId}`, {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('dt_token')}` }
        });
        return r.ok ? await r.json() : [];
      }, conn.id);

      const byStatus = rules.reduce((a, r) => { a[r.status] = (a[r.status]||0)+1; return a; }, {});
      console.log(`  Rules API: ${rules.length} total —`, JSON.stringify(byStatus));
      rules.filter(r => r.status === 'approved' || r.status === 'active').forEach(r =>
        console.log(`    ✅ ${r.rule_name} | ${r.table_fqn} | ${r.severity}`)
      );

      // Click first table if visible
      const tableBtn = page.locator('button').filter({ hasText: /br_|dbo\.|raw_|silver_|gold_/i }).first();
      if (await tableBtn.isVisible().catch(() => false)) {
        await tableBtn.click();
        await page.waitForTimeout(1200);
        await ss(page, `${slug}_02_table_selected`);
      }

      // DQ Execution page for this connection
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
        const btn = btns.find(b => b.innerText?.toLowerCase().includes('dq execution'));
        if (btn) btn.click();
      });
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t), 'DQ Execution', { timeout: 10000 }
      ).catch(() => {});
      await page.waitForTimeout(1500);
      await ss(page, `${slug}_03_dq_execution`);

      await page.close();
    }

    // ── JS errors summary ──────────────────────────────────────────────────
    console.log('\n=== JS Errors ===');
    if (jsErrors.length === 0) console.log('  None');
    else jsErrors.slice(0, 10).forEach(e => console.log(' ⚠ ', e.split('\n')[0]));

  } finally {
    await browser.close();
    console.log('\nDone. Screenshots:', SCREENSHOTS_DIR);
  }
})();
