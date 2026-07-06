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
    await page.evaluate(() => {
      const container = Array.from(document.querySelectorAll('div')).find(d => d.style && d.style.width === '248px');
      const btns = Array.from(container.querySelectorAll('button'));
      const target = btns.find(b => b.innerText.trim().split('\n')[0] === 'dim_customer');
      if (target) target.click();
    });
    await page.waitForTimeout(500);

    const apiCalls = [];
    page.on('request', req => { if (req.url().includes('/api/rules/recommend') && req.method() === 'POST') apiCalls.push(Date.now()); });

    const genBtn = page.locator('button', { hasText: /^Generate rules$/ }).first();
    await Promise.all([genBtn.click(), genBtn.click(), genBtn.click(), genBtn.click(), genBtn.click()]);
    await page.waitForTimeout(1000);
    console.log('POST /recommend calls fired from 5-click burst:', apiCalls.length, '(expected exactly 1)');
    await ss(page, 'race-retest-after-5click');
    await page.waitForTimeout(15000); // let the single legit generation finish

    console.log('\n=== JS ERRORS ===');
    console.log(errors.length ? errors.join('\n') : 'None');
  } catch (e) {
    console.error('FAILED:', e);
  } finally {
    await browser.close();
  }
})();
