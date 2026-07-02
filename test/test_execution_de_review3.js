/**
 * DE Stakeholder Review — DQ Execution module (final live verification pass)
 * Focus: ofc connection (healthy) for real rule execution + P0 fix verification,
 * demo connection (unreachable) for slow-run UX-during-wait evidence only.
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
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 40 });
  const jsErrors = collectJsErrors(page);
  watchApi(page);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '01_ofc_initial_load');
    const bodyOfc1 = await page.locator('body').innerText();
    console.log('[ofc] initial body length:', bodyOfc1.length);
    console.log('[ofc] contains "No runs yet"?', bodyOfc1.includes('No runs yet'));

    // ---- Run all (real execution against healthy connector) ----
    apiLog.length = 0;
    const rerunBtn = page.locator('button', { hasText: 'Re-run checks' }).first();
    await rerunBtn.click();
    await page.waitForTimeout(200);
    await ss(page, '02_ofc_run_all_loading');
    await page.waitForFunction(() => document.body.innerText.includes('Rule results'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    await ss(page, '03_ofc_run_all_results');
    console.log('[ofc] run-all API log:', JSON.stringify(apiLog, null, 2));

    // ---- Filters: status ----
    for (const label of ['Failed', 'Passed', 'Error', 'Expected', 'All']) {
      const btn = page.locator('button').filter({ hasText: new RegExp(`^${label}$`) });
      if (await btn.count() > 0) {
        await btn.first().click();
        await page.waitForTimeout(300);
        await ss(page, `04_ofc_filter_status_${label}`);
      }
    }
    // ---- Filters: layer ----
    for (const layer of ['BRONZE', 'SILVER', 'RAW', 'GOLD', 'ALL']) {
      const btn = page.locator('button').filter({ hasText: new RegExp(`^${layer}$`) });
      if (await btn.count() > 0) {
        await btn.first().click();
        await page.waitForTimeout(300);
        await ss(page, `05_ofc_filter_layer_${layer}`);
      }
    }
    const rowCountAll = await page.locator('tbody tr').count();
    console.log('[ofc] row count at ALL/ALL:', rowCountAll);

    // ---- Layer scoped run (BRONZE) ----
    const layerBtns = await page.locator('button', { hasText: /Run layer/ }).all();
    console.log('[ofc] Run-layer buttons found:', layerBtns.length);
    if (layerBtns.length > 0) {
      await layerBtns[0].scrollIntoViewIfNeeded();
      await layerBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, '06_ofc_run_layer_loading');
      await page.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return !btns.some(b => b.innerText.includes('Running…'));
      }, { timeout: 30000 }).catch(() => console.log('[warn] layer run still running after 30s'));
      await ss(page, '07_ofc_run_layer_done');
    }

    // ---- Single rule run ----
    const playBtns = await page.locator('button[title="Re-run this rule"]').all();
    console.log('[ofc] single-rule play buttons:', playBtns.length);
    if (playBtns.length > 0) {
      await playBtns[0].scrollIntoViewIfNeeded();
      await playBtns[0].click();
      await page.waitForTimeout(300);
      await ss(page, '08_ofc_run_single_loading');
      await page.waitForTimeout(3000);
      await ss(page, '09_ofc_run_single_done');
    }

    // ---- Failed records modal (cde_category_name_not_null expected to FAIL 1/19) ----
    await page.locator('button').filter({ hasText: /^All$/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
    const recordsBtns = await page.locator('button', { hasText: 'Records' }).all();
    console.log('[ofc] "Records" buttons (FAIL rows) found:', recordsBtns.length);
    let resultIdForAck = null;
    if (recordsBtns.length > 0) {
      await recordsBtns[0].scrollIntoViewIfNeeded();
      await recordsBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, '10_ofc_failed_records_modal');
      const modalText = await page.locator('body').innerText();
      console.log('[check] modal contains [object Object]?', modalText.includes('[object Object]'));
      console.log('[check] modal contains raw undefined?', /\bundefined\b/.test(modalText));

      // ---- Acknowledge flow ----
      const markExpectedBtn = page.locator('button', { hasText: 'Mark as expected' }).first();
      await markExpectedBtn.click();
      await page.waitForTimeout(300);
      const reasonInput = page.locator('input[placeholder*="Reason"]').first();
      await reasonInput.fill('DE review test — temporary ack, will revert via API');
      await ss(page, '11_ofc_mark_expected_reason');
      const confirmBtn = page.locator('button', { hasText: 'Confirm' }).first();
      await confirmBtn.click();
      await page.waitForTimeout(800);
      await ss(page, '12_ofc_after_ack_no_refresh');
    } else {
      console.log('[note] no FAIL rows visible on ofc — cde_category_name_not_null may already be passing or acked');
    }

    // ---- Check ack reflected WITHOUT manual refresh ----
    const bodyAfterAckNoRefresh = await page.locator('body').innerText();
    console.log('[ack] "Expected" chip visible w/o refresh?', bodyAfterAckNoRefresh.includes('Expected'));

    // ---- Now hard refresh — confirm ack persisted server-side ----
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await ss(page, '13_ofc_after_refresh_ack_persisted');
    const bodyAfterRefresh = await page.locator('body').innerText();
    console.log('[ack] "Expected" chip visible AFTER refresh?', bodyAfterRefresh.includes('Expected'));

    // ---- Capture the result_id we acked so we can revert via API ----
    const ackApiCalls = apiLog.filter(e => e.url.includes('/acknowledge'));
    console.log('[ack] acknowledge API calls:', JSON.stringify(ackApiCalls, null, 2));

    // ---- Connection isolation: ofc -> demo -> ofc ----
    const ofcSnapshot = await page.locator('body').innerText();
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '14_demo_after_switch');
    const demoSnapshot = await page.locator('body').innerText();
    console.log('[isolation] ofc vs demo identical text?', ofcSnapshot === demoSnapshot);
    console.log('[isolation] demo snapshot head:', demoSnapshot.slice(0, 300));

    // ---- DEMO: trigger single-rule run against unreachable connector to observe UI during wait ----
    const demoPlayBtns = await page.locator('button[title="Re-run this rule"]').all();
    if (demoPlayBtns.length > 0) {
      console.log('[demo] triggering single-rule run against unreachable connector...');
      await demoPlayBtns[0].scrollIntoViewIfNeeded();
      const t0 = Date.now();
      await demoPlayBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, '15_demo_slow_single_rule_t0');
      await page.waitForTimeout(5000);
      await ss(page, '16_demo_slow_single_rule_t5s');
      await page.waitForTimeout(10000);
      await ss(page, '17_demo_slow_single_rule_t15s');
      // check if resolved yet
      const stillRunning = await page.locator('button[title="Re-run this rule"]').first().evaluate(el => el.closest('td')?.innerText || '');
      console.log('[demo] state at t=15s:', stillRunning, 'elapsed ms:', Date.now() - t0);
    }

    // ---- DEMO: trigger full "Re-run checks" overlay — screenshot the overlay behavior for ~20s then move on ----
    const rerunBtnDemo = page.locator('button', { hasText: 'Re-run checks' }).first();
    if (await rerunBtnDemo.count() > 0) {
      console.log('[demo] triggering full run-all overlay to observe fake-progress-vs-real-wait behavior...');
      await rerunBtnDemo.click();
      await page.waitForTimeout(300);
      await ss(page, '18_demo_overlay_t0');
      await page.waitForTimeout(3000);
      await ss(page, '19_demo_overlay_t3s');
      await page.waitForTimeout(10000);
      await ss(page, '20_demo_overlay_t13s');
      await page.waitForTimeout(15000);
      await ss(page, '21_demo_overlay_t28s');
      console.log('[demo] overlay still showing after 28s (not waiting for full completion — evidence captured)');
    }

    // ---- Switch back to ofc — restore for cleanliness, then revert the ack via API ----
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '22_ofc_restored');

    console.log('\n=== FULL API CALL LOG ===');
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
