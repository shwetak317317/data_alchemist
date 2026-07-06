// Verify the new "Regenerate all in {LAYER}" nav-bar button.
const { chromium } = require('playwright');
const { launchBrowser, login, goTo, ss, collectJsErrors, useConnection, CONNECTIONS } = require('./config');

(async () => {
  const { browser, page } = await launchBrowser({ chromium }, { headless: false });
  const errors = collectJsErrors(page);
  const apiCalls = [];
  page.on('response', async res => {
    if (res.url().includes('/api/rules/recommend')) {
      apiCalls.push({ url: res.url().replace('http://localhost', ''), status: res.status() });
    }
  });

  try {
    await login(page);
    await useConnection(page, CONNECTIONS.demo);
    await goTo(page, 'rules');
    await page.waitForTimeout(1000);

    // Select "BRONZE" layer via the filter dropdown (first select in the header)
    const layerSelect = page.locator('select').first();
    await layerSelect.selectOption('BRONZE');
    await page.waitForTimeout(400);

    const btnLabel = await page.locator('button', { hasText: /Regenerate all in BRONZE/ }).innerText();
    console.log('Nav bar button label:', btnLabel);
    await ss(page, '01-bronze-selected');

    // Record BRONZE rule counts before
    const before = await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const rows = Array.from(container.querySelectorAll('div')).filter(d => d.innerText && /^\d+ pending$/.test(d.innerText.split('\n')[0]));
      return rows.length;
    });

    await page.locator('button', { hasText: /Regenerate all in BRONZE/ }).click();
    console.log('Clicked "Regenerate all in BRONZE" — polling for completion (up to 90s)...');

    let finished = false;
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(2000);
      const label = await page.locator('button', { hasText: /Regenerating|Regenerate all in BRONZE/ }).first().innerText().catch(() => '');
      if (i % 5 === 0) console.log(`  [${i * 2}s] "${label}"`);
      if (label && !label.includes('Regenerating')) { finished = true; break; }
    }
    console.log('Finished:', finished);
    await page.waitForTimeout(500);
    await ss(page, '02-after-regenerate-all-bronze');

    console.log('\n/api/rules/recommend calls fired:', apiCalls.length);

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');

  } catch (e) {
    console.error('TEST FAILED:', e);
    await ss(page, '99-error');
  } finally {
    await browser.close();
  }
})();
