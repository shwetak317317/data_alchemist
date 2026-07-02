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

    const input = page.locator('input[placeholder*="revenue should never be negative"]');
    await input.fill('category_uuid must not be null and profit_margin_percentage must be between 0 and 100');
    await page.getByText('Convert to rule', { exact: true }).click();
    await page.waitForTimeout(6000);
    await ss(page, 'unresolved-warning-shown');

    const warningVisible = await page.getByText('Could not verify this rule against the real schema').count();
    console.log('Unresolved warning banner rendered:', warningVisible > 0);

    console.log('JS ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
  } finally {
    await browser.close();
  }
})();
