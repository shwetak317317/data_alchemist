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

    // Ghost table must be gone from the sidebar
    const ghostVisible = await page.getByText('ThisTableDoesNotExist_XYZ').count();
    console.log('Ghost table still in sidebar:', ghostVisible > 0);
    await ss(page, '01-ghost-table-gone');

    // Filter Status -> Rejected, then click "Run all" — must NOT spin forever / must show a clear message
    await page.getByText('Rejected', { exact: true }).first().click();
    await page.waitForTimeout(500);
    await ss(page, '02-filtered-rejected');
    const runAllBtn = page.getByText(/^Run /, { exact: false }).first();
    await runAllBtn.click();
    await page.waitForTimeout(2000);
    await ss(page, '03-after-run-all-on-rejected-filter');

    // Reset to a filter combo with zero matches: Layer RAW (all data is BRONZE in this dataset)
    await page.getByRole('button', { name: 'ALL', exact: true }).first().click(); // reset status filter back to All (best-effort)
    await page.getByRole('button', { name: 'RAW', exact: true }).click();
    await page.waitForTimeout(800);
    await ss(page, '04-layer-raw-empty-state');
    const noMatchMsg = await page.getByText('No rules match your filters').count();
    console.log('Empty-state message shown for RAW layer (expected 0 matches):', noMatchMsg > 0);

    console.log('JS ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
  } finally {
    await browser.close();
  }
})();
