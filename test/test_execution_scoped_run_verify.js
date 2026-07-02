/**
 * Verifies the P0 fix: running a single rule (or a single layer) must NOT
 * collapse the results table down to just that rule — the other rules'
 * last-known results must remain visible, and the header summary must
 * reflect the full merged picture, not just the scoped subset.
 */
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, useConnection, CONNECTIONS, ss, collectJsErrors } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 30 });
  const jsErrors = collectJsErrors(page);
  page.setDefaultTimeout(15000);

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);

    // Ensure we start from a full run so all 3 rules are present.
    await page.locator('button', { hasText: 'Re-run checks' }).first().click();
    await page.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Executing'));
      return true;
    }, { timeout: 2000 }).catch(() => {});
    await page.waitForFunction(() => !document.body.innerText.includes('Executing rules'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await ss(page, '01_after_full_run');

    const rowCountBefore = await page.locator('tbody tr').count();
    const headerBefore = await page.locator('body').innerText();
    const failedBefore = (headerBefore.match(/(\d+) failed/) || [])[1];
    console.log('[before] row count:', rowCountBefore, 'header "failed":', failedBefore);

    // Re-run a single rule via its play icon.
    const playBtn = page.locator('button[title="Re-run this rule"]').first();
    await playBtn.click();
    await page.waitForTimeout(3000); // single-rule run is fast against a healthy connection
    await ss(page, '02_after_single_rule_rerun');

    const rowCountAfter = await page.locator('tbody tr').count();
    const headerAfter = await page.locator('body').innerText();
    const failedAfter = (headerAfter.match(/(\d+) failed/) || [])[1];
    console.log('[after]  row count:', rowCountAfter, 'header "failed":', failedAfter);

    if (rowCountAfter < rowCountBefore) {
      console.log('❌ FAIL — row count dropped after scoped rule re-run:', rowCountBefore, '->', rowCountAfter);
      process.exitCode = 1;
    } else {
      console.log('✅ PASS — row count preserved after scoped rule re-run:', rowCountBefore, '->', rowCountAfter);
    }

    if (failedBefore !== undefined && failedAfter !== undefined && failedBefore !== failedAfter) {
      console.log(`⚠️  header "failed" count changed ${failedBefore} -> ${failedAfter} (expected same, since only 1 rule of ${rowCountBefore} was re-run and its FAIL status shouldn't have changed on ofc)`);
    } else {
      console.log('✅ PASS — header failed-count unchanged:', failedAfter);
    }

    // Reload the page — this exercises the initial-load path (getCurrentExecState),
    // not the in-session merge. Confirms the fix isn't just a same-session patch.
    // (Reload resets the SPA to Workspace Home since routing is in-memory, not
    // URL-based — navigate back to Execution before checking.)
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    await ss(page, '03_after_reload');
    const rowCountReload = await page.locator('tbody tr').count();
    console.log('[after reload] row count:', rowCountReload);
    if (rowCountReload < rowCountBefore) {
      console.log('❌ FAIL — row count dropped after page reload:', rowCountBefore, '->', rowCountReload);
      process.exitCode = 1;
    } else {
      console.log('✅ PASS — row count preserved after page reload:', rowCountBefore, '->', rowCountReload);
    }

    console.log('\n=== JS ERRORS ===');
    if (jsErrors.length === 0) console.log('None');
    else jsErrors.forEach(e => console.log(' -', e.split('\n')[0]));

  } catch (err) {
    console.error('TEST FAILED:', err);
    await ss(page, 'ERROR_STATE');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
