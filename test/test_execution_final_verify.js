/**
 * Final combined verification: full run against the broken `demo` connection
 * should now complete quickly (fast-fail), show no raw ODBC/driver text anywhere
 * in the DOM, show a friendly per-row reason, and the header badge must say Issues.
 */
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, useConnection, CONNECTIONS, ss, collectJsErrors } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 20 });
  const jsErrors = collectJsErrors(page);
  page.setDefaultTimeout(20000);
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'execution');
    await page.waitForTimeout(1000);

    const t0 = Date.now();
    await page.locator('button', { hasText: 'Re-run checks' }).first().click();
    await page.waitForFunction(() => !document.body.innerText.includes('Executing rules'), { timeout: 30000 });
    const elapsedMs = Date.now() - t0;
    console.log(`[timing] full run against dead connection took ${elapsedMs}ms (was ~4.5min before fix)`);
    await page.waitForTimeout(800);
    await ss(page, '01_demo_full_run_done');

    const bodyText = await page.locator('body').innerText();
    const leaksOdbcDetail = /ODBC Driver|SQLDriverConnect|HYT00|pyodbc/i.test(bodyText);
    console.log('[leak check] raw driver text visible in DOM:', leaksOdbcDetail);

    const hasFriendlyMsg = bodyText.includes('unreachable') || bodyText.includes('timed out');
    console.log('[friendly msg] visible in DOM:', hasFriendlyMsg);

    const hasIssuesBadge = bodyText.includes('Issues detected') || /Pipeline\s*[·-]\s*Issues/i.test(bodyText);
    console.log('[badge] Issues shown:', hasIssuesBadge);

    let pass = true;
    if (elapsedMs > 20000) { console.log('❌ FAIL — run took too long:', elapsedMs, 'ms'); pass = false; }
    else console.log('✅ PASS — fail-fast timing');

    if (leaksOdbcDetail) { console.log('❌ FAIL — raw driver error text leaked into DOM'); pass = false; }
    else console.log('✅ PASS — no raw driver text in DOM');

    if (!hasFriendlyMsg) { console.log('❌ FAIL — no friendly error message visible'); pass = false; }
    else console.log('✅ PASS — friendly error message visible');

    if (!hasIssuesBadge) { console.log('❌ FAIL — pipeline badge does not show Issues'); pass = false; }
    else console.log('✅ PASS — pipeline badge shows Issues');

    console.log('\n=== JS ERRORS ===');
    if (jsErrors.length === 0) console.log('None');
    else jsErrors.forEach(e => console.log(' -', e.split('\n')[0]));

    if (!pass) process.exitCode = 1;
  } catch (err) {
    console.error('TEST FAILED:', err);
    await ss(page, 'ERROR_STATE');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
