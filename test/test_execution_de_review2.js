/**
 * DE Stakeholder Review — DQ Execution module, part 2 (continuation)
 * Full run-all already completed (18/18 ERROR, run_id=1040b189-8f51-4d04-a5e7-71711b6fe133).
 * This picks up: results table load, filters, layer/rule scoped runs, acknowledge flow,
 * connection isolation, idempotency.
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
      bodySnippet = txt.length > 400 ? txt.slice(0, 400) + '...' : txt;
    } catch (_) {}
    apiLog.push({ url, status: res.status(), method: res.request().method(), body: bodySnippet });
  });
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 40 });
  const jsErrors = collectJsErrors(page);
  watchApi(page);
  page.setDefaultTimeout(15000);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '01_results_after_full_run');

    const bodyText1 = await page.locator('body').innerText();

    // ---- Filters ----
    for (const label of ['Failed', 'Passed', 'Error', 'Expected', 'All']) {
      const btn = page.locator('div[style*="Status"] button, button').filter({ hasText: new RegExp(`^${label}$`) });
      const count = await btn.count();
      console.log(`[filter] "${label}" matching buttons: ${count}`);
      if (count > 0) {
        await btn.first().click();
        await page.waitForTimeout(400);
        await ss(page, `02_filter_status_${label}`);
      }
    }

    // ---- Layer filters ----
    for (const layer of ['RAW', 'BRONZE', 'SILVER', 'GOLD', 'ALL']) {
      const btn = page.locator('button').filter({ hasText: new RegExp(`^${layer}$`) });
      const count = await btn.count();
      if (count > 0) {
        await btn.first().click();
        await page.waitForTimeout(400);
        await ss(page, `03_filter_layer_${layer}`);
      }
    }

    // ---- Row count check ----
    const rowCount = await page.locator('tbody tr').count();
    console.log('[check] visible row count (layer=ALL):', rowCount);

    // ---- Layer scoped run (pick BRONZE, should be fast-fail since conn already broken) ----
    const layerBtns = await page.locator('button', { hasText: /Run layer/ }).all();
    console.log('[info] Run-layer buttons found:', layerBtns.length);
    if (layerBtns.length > 0) {
      await layerBtns[0].scrollIntoViewIfNeeded();
      await layerBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, '04_run_layer_loading');
      // wait up to 90s for the button state to change from "Running…"
      await page.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return !btns.some(b => b.innerText.includes('Running…'));
      }, { timeout: 90000 }).catch(() => console.log('[warn] layer run still "Running…" after 90s'));
      await ss(page, '05_run_layer_after');
      const rowCountAfterLayer = await page.locator('tbody tr').count();
      console.log('[check] row count after LAYER-scoped run (data-loss check):', rowCountAfterLayer, 'vs before:', rowCount);
    }

    // ---- Single rule run ----
    const playBtns = await page.locator('button[title="Re-run this rule"]').all();
    console.log('[info] single-rule play buttons:', playBtns.length);
    if (playBtns.length > 0) {
      await playBtns[0].scrollIntoViewIfNeeded();
      await playBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, '06_run_single_rule_loading');
      await page.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('button[title="Re-run this rule"]'));
        return true; // just wait fixed time below, icon swap is subtle
      }, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(20000);
      await ss(page, '07_run_single_rule_after');
      const rowCountAfterRule = await page.locator('tbody tr').count();
      console.log('[check] row count after RULE-scoped run (data-loss check):', rowCountAfterRule, 'vs before:', rowCount);
    }

    await ss(page, '08_table_state_final');

    // ---- Acknowledge a failure ----
    // reset filters to ALL/ALL first
    await page.locator('button').filter({ hasText: /^All$/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
    const recordsBtns = await page.locator('button', { hasText: 'Records' }).all();
    console.log('[info] "Records" buttons (FAIL rows, non-ERROR) found:', recordsBtns.length);
    if (recordsBtns.length > 0) {
      await recordsBtns[0].scrollIntoViewIfNeeded();
      await recordsBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, '09_failed_records_modal');

      const markExpectedBtn = page.locator('button', { hasText: 'Mark as expected' }).first();
      await markExpectedBtn.click();
      await page.waitForTimeout(300);
      await ss(page, '10_mark_expected_reason_input');

      const reasonInput = page.locator('input[placeholder*="Reason"]').first();
      await reasonInput.fill('DE review test — known seasonal spike, approved by data owner');
      await ss(page, '11_reason_filled');

      const confirmBtn = page.locator('button', { hasText: 'Confirm' }).first();
      await confirmBtn.click();
      await page.waitForTimeout(1000);
      await ss(page, '12_after_acknowledge');
    } else {
      console.log('[note] No PASS/FAIL "Records" rows visible (all rows are ERROR from broken connector) — trying ERROR-status ack path N/A since only FAIL rows show Records btn');
    }

    // Expected filter
    const expectedBtn = page.locator('button').filter({ hasText: /^Expected$/ }).first();
    await expectedBtn.click();
    await page.waitForTimeout(400);
    await ss(page, '13_filter_expected_after_ack');
    await page.locator('button').filter({ hasText: /^All$/ }).first().click();
    await page.waitForTimeout(300);
    await ss(page, '14_all_after_ack');

    // CDE tags
    const cdeCount = await page.locator('text=CDE').count();
    console.log('[info] CDE badges visible:', cdeCount);
    await ss(page, '15_cde_visible');

    // ---- Connection switch ----
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '16_connection_ofc');
    const ofcText = await page.locator('body').innerText();
    console.log('[isolation] demo/ofc identical?', bodyText1 === ofcText);

    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '17_connection_demo_restored');
    const restoredText = await page.locator('body').innerText();
    console.log('[isolation] demo restored header matches?', restoredText.slice(0, 150) === bodyText1.slice(0, 150));

    // ---- Idempotency: refresh ----
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2500);
    await ss(page, '18_after_refresh_idempotency');
    const afterRefreshText = await page.locator('body').innerText();
    console.log('[idempotency] same key numbers after refresh?', afterRefreshText.slice(0,150) === restoredText.slice(0,150));

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
    await ss(page, 'ERROR_STATE2');
  } finally {
    await browser.close();
  }
})();
