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
    await ss(page, 'final-01-loaded');

    // Connection isolation still holds
    await useConnection(page, CONNECTIONS.ofc);
    await goTo(page, 'rules');
    await page.waitForTimeout(1500);
    await ss(page, 'final-02-ofc');
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1500);
    await ss(page, 'final-03-demo-restored');

    // NL grounded flow still works
    const input = page.locator('input[placeholder*="revenue should never be negative"]');
    await input.fill('CategoryName must not be null');
    await page.getByText('Convert to rule', { exact: true }).click();
    await page.waitForTimeout(6000);
    await ss(page, 'final-04-nl-grounded-result');
    const unresolvedWarning = await page.getByText('Could not verify this rule against the real schema').count();
    console.log('False-positive unresolved warning on a valid request:', unresolvedWarning > 0);

    console.log('JS ERRORS across full regression pass:', errors.length ? errors.slice(0, 15) : 'none');
  } finally {
    await browser.close();
  }
})();
