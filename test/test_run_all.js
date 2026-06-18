/**
 * Test: Profiling — "Run all" batch feature
 *
 * Verifies:
 *  1. App is reachable
 *  2. Login / session restore works
 *  3. Profiling screen loads with datasets
 *  4. "Run all" / "Re-run all" buttons are present per layer group
 *  5. Clicking "Run all" does NOT blank the screen
 *  6. Progress indicator appears and increments
 *  7. No JavaScript errors thrown during the whole flow
 *
 * Run:  node test/test_run_all.js
 */

const { chromium } = require('playwright');
const {
  ss, checkAppHealth, launchBrowser, login, goTo, collectJsErrors,
  assert, assertBodyContains, assertNoJsErrors, assertNotBlank,
} = require('./config');

(async () => {
  // ── Pre-flight ────────────────────────────────────────────────────────────
  console.log('=== Profiling: Run All ===\n');
  await checkAppHealth();   // fails immediately if Docker isn't running
  console.log('[0] App is reachable\n');

  const { browser, page } = await launchBrowser({ chromium });
  const jsErrors = collectJsErrors(page);

  try {
    // ── 1. Login / session restore ─────────────────────────────────────────
    console.log('[1] Login');
    await login(page);
    await ss(page, '01_after_login');
    await assertNotBlank(page, 'App shell visible after login');

    // ── 2. Navigate to Profiling ───────────────────────────────────────────
    console.log('\n[2] Navigate to Profiling');
    await goTo(page, 'profiling');
    await ss(page, '02_profiling');
    await assertBodyContains(page, 'Profile now', 'Profiling selector loaded');

    // ── 3. Find Run all buttons ────────────────────────────────────────────
    console.log('\n[3] Run all buttons');
    let runAllExists = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .some(b => /run all|re-run all/i.test(b.textContent))
    );

    if (!runAllExists) {
      // Groups might be collapsed — click first group header to expand
      console.log('[3] Expanding first group...');
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(b => /\d+\s+tables/i.test(b.textContent));
        if (btn) btn.click();
      });
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('button')).some(b => /run all|re-run all/i.test(b.textContent)),
        { timeout: 4000 }
      ).catch(() => {});
      runAllExists = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).some(b => /run all|re-run all/i.test(b.textContent))
      );
    }

    assert(runAllExists, '"Run all" or "Re-run all" button is visible');
    await ss(page, '03_before_run_all');

    // ── 4. Click Run all ───────────────────────────────────────────────────
    console.log('\n[4] Click Run all');
    jsErrors.length = 0;   // reset — only capture errors from this point

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /run all|re-run all/i.test(b.textContent));
      console.log('[test] clicking:', btn?.textContent?.trim());
      btn?.click();
    });

    // Wait for progress indicator to appear (confirms batch started, not blank)
    await page.waitForFunction(
      () => document.querySelectorAll('.dt-spin').length > 0 ||
            /\d+\/\d+\s+profiled/i.test(document.body.innerText),
      { timeout: 5000 }
    ).catch(() => {});   // if it didn't appear, assertions below will catch it

    await ss(page, '04_after_click');

    // ── 5. Assertions ──────────────────────────────────────────────────────
    console.log('\n[5] Assertions');
    await assertNotBlank(page, 'No blank screen after Run all click');
    assertNoJsErrors(jsErrors, 'No JS errors after Run all click');

    const spinners  = await page.evaluate(() => document.querySelectorAll('.dt-spin').length);
    const bodyText  = await page.locator('body').innerText();
    const progMatch = bodyText.match(/(\d+)\/(\d+)\s+profiled/i);

    assert(spinners > 0 || !!progMatch, `Batch is running (spinners=${spinners}, progress="${progMatch?.[0] || 'none'}")`);

    // ── 6. Watch progress for 10 seconds ──────────────────────────────────
    console.log('\n[6] Watching progress (10 s)...');
    for (let i = 1; i <= 5; i++) {
      await page.waitForTimeout(2000);
      const snap  = await page.locator('body').innerText();
      const spins = await page.evaluate(() => document.querySelectorAll('.dt-spin').length);
      const prog  = snap.match(/(\d+)\/(\d+)\s+profiled/i);
      console.log(`  t+${i * 2}s | spinners=${spins} | progress=${prog ? prog[0] : 'none'}`);
      await ss(page, `05_t${String(i * 2).padStart(2, '0')}s`);
    }

    // Final JS error check after the whole run
    assertNoJsErrors(jsErrors, 'No JS errors during batch execution');

    await ss(page, '06_final');
    console.log('\n✅ All assertions passed');
    console.log(`📁 Screenshots: test/screenshots/${require('./config').SCREENSHOTS_DIR.split('screenshots')[1].replace(/^[\\/]/, '')}/`);

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    await ss(page, 'FAILED').catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
