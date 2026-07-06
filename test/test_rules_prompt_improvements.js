const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);

    // Regenerate br_categories via the SIDEBAR's per-table Regenerate button — the nav
    // bar's own Generate/Regenerate button is now correctly hidden for a table that
    // already has rules (see the recent "remove redundant nav button" fix), so the
    // sidebar is the only entry point here. The row wrapper is the name-button's
    // grandparent div (name-button div + badges/button div are siblings under it).
    const TARGET_TABLE = 'BrzLoadLog';
    await page.evaluate((tableName) => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const nameBtn = Array.from(container.querySelectorAll('button')).find(b => b.innerText.trim().split('\n')[0] === tableName);
      // The row's OWN Regenerate button is the button immediately following the name-button
      // within the SAME table-row div (name-button's parent), not any ancestor scope.
      const rowDiv = nameBtn.parentElement; // the <div key={t.fqn}> wrapping name-button + badges/button div
      const target = Array.from(rowDiv.querySelectorAll('button')).find(b => b !== nameBtn && /Regenerate|Generate/.test(b.innerText));
      if (target) target.click();
      else console.log('REGEN BUTTON NOT FOUND for', tableName);
    }, TARGET_TABLE);
    console.log(`Regenerating ${TARGET_TABLE} via sidebar button — waiting up to 60s...`);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const label = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /Generating|Regenerate$/.test(b.innerText.trim()));
        return btn ? btn.innerText.trim() : '';
      });
      if (label && !label.includes('Generating')) break;
    }
    await page.waitForTimeout(500);
    await ss(page, 'prompt-improve-01-br_categories');

    const result = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div')).filter(el =>
        el.innerText && el.innerText.length < 700 && /IS NOT NULL|EXISTS|PARTITION BY|CASE WHEN/.test(el.innerText)
      );
      return {
        crossTableBadgeCount: (document.body.innerText.match(/Cross-table/g) || []).length,
        dboFalsePositiveCount: (document.body.innerText.match(/Unverified column reference\(s\) \('dbo'/g) || []).length,
        sampleExpressions: rows.slice(0, 15).map(r => r.innerText.trim().slice(0, 300)),
      };
    });
    console.log('Cross-table badge occurrences:', result.crossTableBadgeCount);
    console.log('dbo false-positive warnings:', result.dboFalsePositiveCount);
    console.log('\nSample rule cards:\n' + result.sampleExpressions.join('\n---\n'));

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');
  } catch (e) {
    console.error('FAILED:', e);
    await ss(page, 'prompt-improve-99-error');
  } finally {
    await browser.close();
  }
})();
