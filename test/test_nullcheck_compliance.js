const { chromium } = require('playwright');
const { launchBrowser, login, goTo, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1200);

    const TARGET_TABLE = 'BrzLoadLog';
    await page.evaluate((tableName) => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const nameBtn = Array.from(container.querySelectorAll('button')).find(b => b.innerText.trim().split('\n')[0] === tableName);
      const rowDiv = nameBtn.parentElement;
      const target = Array.from(rowDiv.querySelectorAll('button')).find(b => b !== nameBtn && /Regenerate|Generate/.test(b.innerText));
      if (target) target.click();
    }, TARGET_TABLE);
    console.log(`Regenerating ${TARGET_TABLE} — polling for completion (no screenshots this run)...`);
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const label = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => /Generating|Regenerate$/.test(b.innerText.trim()));
        return btn ? btn.innerText.trim() : '';
      });
      if (label && !label.includes('Generating')) { console.log(`  done after ~${i*2}s`); break; }
    }
    await page.waitForTimeout(500);

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');
  } catch (e) {
    console.error('FAILED:', e);
  } finally {
    await browser.close();
  }
})();
