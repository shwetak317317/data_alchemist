/**
 * UI/UX review pass 3 — DQ Execution module.
 * Focus: confirm scoped-run "table collapse" hypothesis on ofc (healthy conn),
 * confirm demo (broken conn) error surfacing / remediation text, failed-records
 * modal date rendering, CDE badges, filters, connection switch, loading states.
 */
const { chromium } = require('playwright');
const {
  launchBrowser, login, goTo, useConnection, CONNECTIONS, ss,
  collectJsErrors,
} = require('./config');

const apiLog = [];
function watchApi(page) {
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/execution')) return;
    let bodySnippet = '';
    try {
      const txt = await res.text();
      bodySnippet = txt.length > 600 ? txt.slice(0, 600) + '...' : txt;
    } catch (_) {}
    apiLog.push({ url, status: res.status(), method: res.request().method(), body: bodySnippet });
  });
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 30 });
  const jsErrors = collectJsErrors(page);
  watchApi(page);
  page.setDefaultTimeout(20000);

  try {
    await login(page);

    // ===== PART A: ofc (healthy) — confirm scoped-run table collapse bug =====
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, 'A01_ofc_initial');

    const rowCountBefore = await page.locator('table tbody tr').count();
    console.log('[ofc] row count before any scoped run:', rowCountBefore);
    const bodyBefore = await page.locator('body').innerText();

    // Trigger a single-rule re-run on the FIRST visible rule row
    const playBtns = await page.locator('button[title="Re-run this rule"]').all();
    console.log('[ofc] single-rule play buttons found:', playBtns.length);
    if (playBtns.length > 0) {
      await playBtns[0].scrollIntoViewIfNeeded();
      await playBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, 'A02_ofc_single_rule_running');
      await page.waitForTimeout(6000);
      await ss(page, 'A03_ofc_single_rule_after');
      const rowCountAfter = await page.locator('table tbody tr').count();
      console.log('[ofc][BUG CHECK] row count AFTER single-rule re-run:', rowCountAfter, '(before:', rowCountBefore, ')');
    }

    // Reload to restore full result set for a clean layer-run test
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2000);
    const rowCountReloaded = await page.locator('table tbody tr').count();
    console.log('[ofc] row count after reload (restored?):', rowCountReloaded);
    await ss(page, 'A04_ofc_after_reload');

    const layerBtns = await page.locator('button', { hasText: /Run layer/ }).all();
    console.log('[ofc] Run-layer buttons found:', layerBtns.length);
    if (layerBtns.length > 0) {
      await layerBtns[0].scrollIntoViewIfNeeded();
      await layerBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, 'A05_ofc_layer_run_loading');
      await page.waitForTimeout(6000);
      await ss(page, 'A06_ofc_layer_run_after');
      const rowCountAfterLayer = await page.locator('table tbody tr').count();
      console.log('[ofc][BUG CHECK] row count AFTER layer-scoped run:', rowCountAfterLayer, '(before:', rowCountReloaded, ')');
    }

    // Reload again to restore state before leaving ofc (don't leave fixtures in odd state)
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);

    // ===== PART B: demo (broken connection) — error surfacing / remediation text =====
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, 'B01_demo_initial');

    // Confirm current state — likely already has ERROR results from prior runs.
    const demoBody1 = await page.locator('body').innerText();
    console.log('[demo] contains raw ODBC/HYT00 text already visible on page?', /HYT00|SQLDriverConnect|Login timeout/i.test(demoBody1));

    // Trigger a fresh single-rule re-run to watch it fail live and capture loading state
    const demoPlayBtns = await page.locator('button[title="Re-run this rule"]').all();
    if (demoPlayBtns.length > 0) {
      await demoPlayBtns[0].scrollIntoViewIfNeeded();
      await demoPlayBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, 'B02_demo_single_rule_running_immediately');
      // Poll for up to 40s watching for the button to leave "running" state (login timeout is slow)
      const start = Date.now();
      while (Date.now() - start < 40000) {
        const stillRunning = await page.locator('button[title="Re-run this rule"]').first().evaluate(el => el.className.includes('running') || false).catch(() => false);
        await page.waitForTimeout(2000);
        const txt = await page.locator('body').innerText();
        if (!txt.includes('Running')) break;
      }
      await ss(page, 'B03_demo_single_rule_after_error');
    }

    const demoBodyAfter = await page.locator('body').innerText();
    console.log('[demo][LEAK CHECK] raw ODBC/HYT00 string visible in DOM after run?', /HYT00|SQLDriverConnect|Login timeout expired/i.test(demoBodyAfter));

    // ===== PART C: Failed-records modal on ofc (real FAIL rows) — datetime rendering =====
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    const recordsBtns = await page.locator('button', { hasText: 'Records' }).all();
    console.log('[ofc] "Records" buttons (FAIL rows) found:', recordsBtns.length);
    if (recordsBtns.length > 0) {
      await recordsBtns[0].scrollIntoViewIfNeeded();
      await recordsBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, 'C01_ofc_failed_records_modal');
      const modalText = await page.locator('body').innerText();
      console.log('[modal] contains "[object Object]"?', modalText.includes('[object Object]'));
      console.log('[modal] contains raw JSON braces?', /\{"/.test(modalText));
      await page.locator('button', { hasText: /^Close$|×/ }).first().click().catch(async () => {
        await page.keyboard.press('Escape');
      });
    }

    // ===== PART D: Filters + CDE badges (client-side check) =====
    await goTo(page, 'execution');
    await page.waitForTimeout(1000);
    for (const label of ['Failed', 'Passed', 'Error', 'Expected', 'All']) {
      const btn = page.locator('button').filter({ hasText: new RegExp(`^${label}$`) }).first();
      if (await btn.count() > 0) {
        const apiCountBefore = apiLog.length;
        await btn.click();
        await page.waitForTimeout(400);
        console.log(`[filter] "${label}" fired new /api/execution calls?`, apiLog.length > apiCountBefore);
        await ss(page, `D_filter_status_${label}`);
      }
    }
    const cdeCount = await page.locator('text=CDE').count();
    console.log('[cde] badge count visible on ofc:', cdeCount);

    console.log('\n=== API CALL LOG ===');
    apiLog.forEach((e, i) => {
      console.log(`${i + 1}. [${e.status}] ${e.method} ${e.url}`);
      if (e.body) console.log(`   body: ${e.body}`);
    });

    console.log('\n=== JS ERRORS ===');
    if (jsErrors.length === 0) console.log('None');
    else jsErrors.forEach(e => console.log(' -', e.split('\n')[0]));

  } catch (err) {
    console.error('TEST FAILED:', err);
    await ss(page, 'ERROR_STATE3');
  } finally {
    await browser.close();
  }
})();
