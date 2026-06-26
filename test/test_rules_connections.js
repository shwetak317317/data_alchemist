/**
 * Checks Rule Studio for BOTH connections:
 * 1. "ofc" connection — checks for status errors
 * 2. "demo" connection — checks for fishy phantom rules
 */
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, checkAppHealth, collectJsErrors, SCREENSHOTS_DIR } = require('./config');

(async () => {
  await checkAppHealth();
  const { browser, page } = await launchBrowser({ chromium }, { headless: true, slowMo: 60 });
  const jsErrors = collectJsErrors(page);

  try {
    await login(page);

    // ── 1. Get all connections from API ──────────────────────────────────────
    const connections = await page.evaluate(async () => {
      const r = await fetch('/api/connections', {
        headers: { Authorization: `Bearer ${sessionStorage.getItem('dt_token')}` }
      });
      return r.ok ? await r.json() : [];
    });
    console.log('\n[connections] Found:', connections.map(c => `"${c.name}" (${c.id.slice(0,8)})`).join(', '));

    // Helper: switch active connection and reload
    const switchTo = async (conn) => {
      await page.evaluate(({ id, name, platform }) => {
        localStorage.setItem('dt_conn_id',       id       || '');
        localStorage.setItem('dt_conn_name',     name     || '');
        localStorage.setItem('dt_conn_platform', platform || '');
      }, { id: conn.id, name: conn.name, platform: conn.platform });
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(
        (t) => document.body.innerText.includes(t), 'Workspace Home', { timeout: 15000 }
      );
      console.log(`[switch] Active connection: "${conn.name}"`);
    };

    // ── 2. Screenshot each connection's Rule Studio ──────────────────────────
    for (const conn of connections) {
      const slug = conn.name.toLowerCase().replace(/\s+/g, '_');
      console.log(`\n=== Rule Studio: "${conn.name}" ===`);

      await switchTo(conn);
      await goTo(page, 'rules');
      await page.waitForTimeout(2000);
      await ss(page, `rules_${slug}_01_default`);

      // Check rules count and status via API
      const rules = await page.evaluate(async (connId) => {
        const r = await fetch(`/api/rules?connection_id=${connId}`, {
          headers: { Authorization: `Bearer ${sessionStorage.getItem('dt_token')}` }
        });
        return r.ok ? await r.json() : [];
      }, conn.id);

      const statusCounts = rules.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      console.log(`  Rules: ${rules.length} total —`, JSON.stringify(statusCounts));

      // Click on first table in left panel if any
      const tableBtn = page.locator('button').filter({ hasText: /dbo\.|br_|raw_|gold_|silver_/i }).first();
      const hasTables = await tableBtn.isVisible().catch(() => false);
      if (hasTables) {
        await tableBtn.click();
        await page.waitForTimeout(1200);
        await ss(page, `rules_${slug}_02_table_selected`);
      }

      // Try clicking first rule's approve button if any draft rules exist
      const approveBtn = page.locator('button[title="Approve"]').first();
      const hasApprove = await approveBtn.isVisible().catch(() => false);
      if (hasApprove) {
        console.log('  Clicking approve on first draft rule...');
        await approveBtn.click();
        await page.waitForTimeout(1500);
        await ss(page, `rules_${slug}_03_after_approve`);

        // Reload and check status persisted
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(
          (t) => document.body.innerText.includes(t), 'Workspace Home', { timeout: 15000 }
        );
        await goTo(page, 'rules');
        await page.waitForTimeout(2000);
        await ss(page, `rules_${slug}_04_after_reload`);
        console.log('  Reloaded — checking if approve persisted...');

        const rulesAfter = await page.evaluate(async (connId) => {
          const r = await fetch(`/api/rules?connection_id=${connId}`, {
            headers: { Authorization: `Bearer ${sessionStorage.getItem('dt_token')}` }
          });
          return r.ok ? await r.json() : [];
        }, conn.id);
        const statusAfter = rulesAfter.reduce((acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        }, {});
        console.log(`  After reload: ${rulesAfter.length} rules —`, JSON.stringify(statusAfter));
      }
    }

    // ── 3. Summary ──────────────────────────────────────────────────────────
    console.log('\n=== JS Errors ===');
    if (jsErrors.length === 0) {
      console.log('  None');
    } else {
      jsErrors.slice(0, 10).forEach(e => console.log(' ⚠ ', e.split('\n')[0]));
    }

  } finally {
    await browser.close();
    console.log('\nDone. Screenshots at:', SCREENSHOTS_DIR);
  }
})();
