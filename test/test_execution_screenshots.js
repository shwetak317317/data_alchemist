/**
 * DQ Execution screen screenshots.
 * Run: node test/test_execution_screenshots.js
 * Output: test/screenshots/<timestamp>/
 */
const { chromium } = require('playwright');
const { checkAppHealth, launchBrowser, login, goTo, collectJsErrors, ss } = require('./config');

(async () => {
  await checkAppHealth();
  const { browser, page } = await launchBrowser({ chromium }, { headless: true, slowMo: 60 });
  const jsErrors = collectJsErrors(page);
  await login(page);

  // 1. Default/initial state
  console.log('\n[execution] navigating...');
  await goTo(page, 'execution');
  await page.waitForTimeout(2000);
  await ss(page, '01_execution_default');

  // 2. Scroll down to see full table area
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  await ss(page, '02_execution_table_area');

  // 3. Click "Re-run checks"
  try {
    const runBtn = await page.$('button:has-text("Re-run checks"), button:has-text("Run checks"), button:has-text("Run DQ")');
    if (runBtn) {
      console.log('[execution] clicking Re-run checks...');
      await page.evaluate(() => window.scrollTo(0, 0));
      await runBtn.click();
      await page.waitForTimeout(700); // catch the RunOverlay spinner
      await ss(page, '03_execution_running_overlay');
      await page.waitForTimeout(8000); // wait for actual backend run (up to ~8s for rules)
      await ss(page, '04_execution_results_loaded');
    }
  } catch (e) { console.log('[execution] Run btn error:', e.message); }

  // 4. Filter by FAIL
  try {
    const failPill = await page.$('button:has-text("Failed")');
    if (failPill) {
      await failPill.click();
      await page.waitForTimeout(500);
      await ss(page, '05_execution_filter_fail');
    }
  } catch (e) {}

  // 5. Click "Records" drill-down on first FAIL row
  try {
    const recordsBtn = await page.$('button:has-text("Records")');
    if (recordsBtn) {
      await recordsBtn.click();
      await page.waitForTimeout(800);
      await ss(page, '06_execution_failed_records_modal');
    }
  } catch (e) { console.log('[execution] Records btn not found'); }

  // 6. Close modal, filter ALL, scroll to bottom bar
  try {
    const closeBtn = await page.$('button[aria-label="Close"], button:has-text("Cancel"), [data-close]');
    if (closeBtn) { await closeBtn.click(); await page.waitForTimeout(300); }
    const allPill = await page.$('button:has-text("All")');
    if (allPill) { await allPill.click(); await page.waitForTimeout(300); }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await ss(page, '07_execution_bottom_actions');
  } catch (e) {}

  await browser.close();
  if (jsErrors.length) {
    console.warn('\n⚠  JS errors:');
    jsErrors.slice(0, 8).forEach(e => console.warn(' -', e.split('\n')[0]));
  } else {
    console.log('\n✅ No JS errors.');
  }
  console.log('\nDone.');
})().catch(e => { console.error('❌ Test failed:', e.message); process.exit(1); });
