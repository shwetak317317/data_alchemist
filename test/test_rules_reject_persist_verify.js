const { chromium } = require('playwright');
const { launchBrowser, login, goTo, collectJsErrors, ss, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1500);

    // Reject the first pending rule's row (the ✕ IconBtn)
    const rejectBtn = page.locator('button[title="Reject"]').first();
    if (await rejectBtn.count() === 0) { console.log('[warn] No rejectable rule found'); await browser.close(); return; }
    // Grab the rule name from the row before rejecting
    const row = page.locator('div').filter({ has: rejectBtn }).first();
    await rejectBtn.click();
    await page.waitForTimeout(1000);
    await ss(page, 'reject-immediate');

    // Reload and re-navigate — this is exactly the DE-1 repro
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2000);
    await goTo(page, 'rules');
    await page.waitForTimeout(1500);
    await ss(page, 'reject-after-reload');

    // Click the new "Rejected" filter pill and confirm at least one row shows
    const rejectedPill = page.getByText('Rejected', { exact: true }).first();
    await rejectedPill.click();
    await page.waitForTimeout(800);
    await ss(page, 'reject-filtered-view');
    const rejectedChipCount = await page.getByText('Rejected', { exact: true }).count();
    console.log('Rejected filter + chip elements found after reload:', rejectedChipCount);

    console.log('JS ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
  } finally {
    await browser.close();
  }
})();
