const { chromium } = require('playwright');
const { launchBrowser, login, goTo, useConnection, CONNECTIONS, ss } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false, slowMo: 30 });
  page.setDefaultTimeout(20000);
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'execution');
    await page.waitForTimeout(1500);
    // Restore full run via "Re-run checks" (full run-all), so ofc isn't left collapsed to 1 row
    const rerunBtn = page.locator('button', { hasText: 'Re-run checks' }).first();
    await rerunBtn.click();
    await page.waitForTimeout(300);
    await ss(page, 'E01_full_rerun_loading');
    await page.waitForFunction(() => document.body.innerText.includes('Rule results'), { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await ss(page, 'E02_full_rerun_restored');
    const rowCount = await page.locator('table tbody tr').count();
    console.log('[restore] row count after full re-run:', rowCount);

    const recordsBtns = await page.locator('button', { hasText: 'Records' }).all();
    console.log('[modal] Records buttons found:', recordsBtns.length);
    if (recordsBtns.length > 0) {
      await recordsBtns[0].scrollIntoViewIfNeeded();
      await recordsBtns[0].click();
      await page.waitForTimeout(500);
      await ss(page, 'E03_failed_records_modal');
      const modalText = await page.locator('body').innerText();
      console.log('[modal] "[object Object]" present?', modalText.includes('[object Object]'));
      console.log('[modal] raw JSON braces present?', /\{"\w+":/.test(modalText));
    }
  } catch (err) {
    console.error('FAILED', err);
    await ss(page, 'ERROR_E');
  } finally {
    await browser.close();
  }
})();
