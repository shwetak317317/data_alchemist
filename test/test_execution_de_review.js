/**
 * DE Stakeholder Review — DQ Execution module (Phase 2 of 5-phase production audit)
 * Walks the full execution flow, screenshots every state, watches API calls.
 */
const { chromium } = require('playwright');
const {
  launchBrowser, login, goTo, useConnection, CONNECTIONS, ss,
  collectJsErrors, assert, assertBodyContains, TIMEOUTS,
} = require('./config');

const apiLog = [];

function watchApi(page) {
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('/api/execution')) return;
    let bodySnippet = '';
    try {
      const txt = await res.text();
      bodySnippet = txt.length > 500 ? txt.slice(0, 500) + '...' : txt;
    } catch (_) {}
    apiLog.push({
      url, status: res.status(), method: res.request().method(),
      timing: res.request().timing ? res.request().timing() : null,
      body: bodySnippet,
    });
  });
}

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 60 });
  const jsErrors = collectJsErrors(page);
  watchApi(page);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '01_initial_load_demo');
    console.log('[state] initial load captured');

    // ---- Record initial values for isolation test ----
    const bodyText1 = await page.locator('body').innerText();
    console.log('[demo] snapshot length:', bodyText1.length);

    // ---- Run all (full execution) — capture loading state immediately ----
    const rerunBtn = page.locator('button', { hasText: 'Re-run checks' }).first();
    await rerunBtn.click();
    await page.waitForTimeout(150); // grab loading state ASAP before it resolves
    await ss(page, '02_run_all_loading');
    console.log('[state] run-all loading captured');

    // wait for it to resolve back to results
    await page.waitForFunction(() => document.body.innerText.includes('Rule results'), { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await ss(page, '03_run_all_results');
    console.log('[state] run-all results captured');

    // ---- Results table / filters ----
    await ss(page, '04_results_table_ALL');
    const filterButtons = ['Failed', 'Passed', 'Error', 'Expected'];
    for (const label of filterButtons) {
      const btn = page.locator('button', { hasText: new RegExp(`^${label}$`) }).first();
      if (await btn.count() > 0) {
        await btn.click();
        await page.waitForTimeout(400);
        await ss(page, `05_filter_status_${label}`);
      }
    }
    // back to ALL
    await page.locator('button', { hasText: /^All$/ }).first().click();
    await page.waitForTimeout(300);

    // ---- Layer scoped run ----
    const layerRunButtons = await page.locator('button', { hasText: /Run layer/ }).all();
    if (layerRunButtons.length > 0) {
      await layerRunButtons[0].scrollIntoViewIfNeeded();
      await layerRunButtons[0].click();
      await page.waitForTimeout(300);
      await ss(page, '06_run_layer_loading');
      await page.waitForTimeout(4000);
      await ss(page, '07_run_layer_done');
    } else {
      console.log('[warn] no "Run layer" buttons found');
    }

    // ---- Single rule run ----
    const playBtns = await page.locator('button[title="Re-run this rule"]').all();
    console.log('[info] single-rule play buttons found:', playBtns.length);
    if (playBtns.length > 0) {
      await playBtns[0].scrollIntoViewIfNeeded();
      await playBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, '08_run_single_rule_loading');
      await page.waitForTimeout(4000);
      await ss(page, '09_run_single_rule_done');
    }

    // ---- Full table state after all scoped runs (check for data loss) ----
    await ss(page, '10_table_after_scoped_runs');
    const tableRowsAfterScoped = await page.locator('table tbody tr').count();
    console.log('[check] table row count after scoped runs:', tableRowsAfterScoped);

    // ---- Acknowledge a failure ----
    const recordsBtns = await page.locator('button', { hasText: 'Records' }).all();
    console.log('[info] "Records" buttons (FAIL rows) found:', recordsBtns.length);
    let ackedResultId = null;
    if (recordsBtns.length > 0) {
      await recordsBtns[0].scrollIntoViewIfNeeded();
      await recordsBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, '11_failed_records_modal');

      const markExpectedBtn = page.locator('button', { hasText: 'Mark as expected' }).first();
      await markExpectedBtn.click();
      await page.waitForTimeout(300);
      await ss(page, '12_mark_expected_reason_input');

      const reasonInput = page.locator('input[placeholder*="Reason"]').first();
      await reasonInput.fill('DE review test — known seasonal spike, approved by data owner');
      await ss(page, '13_reason_filled');

      const confirmBtn = page.locator('button', { hasText: 'Confirm' }).first();
      await confirmBtn.click();
      await page.waitForTimeout(800);
      await ss(page, '14_after_acknowledge_toast');
    } else {
      console.log('[warn] no FAIL rows with "Records" button visible — cannot test acknowledge flow');
    }

    // ---- Expected filter shows acked result ----
    const expectedBtn = page.locator('button', { hasText: /^Expected$/ }).first();
    await expectedBtn.click();
    await page.waitForTimeout(400);
    await ss(page, '15_filter_expected_after_ack');
    await page.locator('button', { hasText: /^All$/ }).first().click();
    await page.waitForTimeout(300);
    await ss(page, '16_all_after_ack_display_state');

    // ---- CDE highlighting check ----
    const cdeTags = await page.locator('text=CDE').count();
    console.log('[info] CDE tag count visible:', cdeTags);
    await ss(page, '17_cde_tags_visible');

    // ---- Connection switch: demo -> ofc ----
    const demoText = await page.locator('body').innerText();
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '18_connection_ofc');
    const ofcText = await page.locator('body').innerText();
    console.log('[isolation] demo/ofc identical text?', demoText === ofcText);

    // ---- Switch back to demo — must restore ----
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '19_connection_demo_restored');
    const demoRestoredText = await page.locator('body').innerText();
    console.log('[isolation] demo restored matches original demo view (loosely)?',
      demoRestoredText.slice(0, 200) === bodyText1.slice(0, 200));

    // ---- Refresh / idempotency check ----
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await ss(page, '20_idempotency_after_refresh');

    // ---- Empty-state check on ofc if it has no runs ----
    // (already captured as 18_connection_ofc — check its content for "No runs yet")

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
    await ss(page, 'ERROR_STATE');
  } finally {
    await browser.close();
  }
})();
