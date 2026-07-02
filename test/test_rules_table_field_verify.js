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

    // Ensure no table is selected (click "All tables"), then convert an NL rule with no table scope
    await page.getByText('All tables', { exact: true }).click();
    await page.waitForTimeout(500);
    const input = page.locator('input[placeholder*="revenue should never be negative"]');
    await input.fill('some vague requirement about data being good');
    await page.getByText('Convert to rule', { exact: true }).click();
    await page.waitForTimeout(6000);
    await ss(page, 'table-field-unscoped');

    const misleadingLabel = await page.getByText('(auto)').count();
    const properWarning = await page.getByText('Unresolved — select a table before approving').count();
    console.log('Misleading "(auto)" label still present:', misleadingLabel > 0);
    console.log('Proper unresolved-table warning shown:', properWarning > 0);

    console.log('JS ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
  } finally {
    await browser.close();
  }
})();
