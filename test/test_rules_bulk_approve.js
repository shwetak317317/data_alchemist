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

    // Filter to LOW severity + Pending status to see exactly what will be bulk-approved
    await page.getByRole('button', { name: 'Pending', exact: true }).click();
    await page.waitForTimeout(600);
    await ss(page, 'bulk-00-pending-filter');

    const bulkBtn = page.getByRole('button', { name: /Bulk approve LOW/i });
    await bulkBtn.scrollIntoViewIfNeeded();
    await ss(page, 'bulk-01-before-click');
    await bulkBtn.click();
    await page.waitForTimeout(3000);
    await ss(page, 'bulk-02-after-click');

    const bodyText = await page.locator('body').innerText();
    console.log('[bulk] toast/body mentions "approved":', bodyText.includes('approved'));
    console.log('JS ERRORS:', errors.length ? errors : 'none');
  } finally {
    await browser.close();
  }
})();
