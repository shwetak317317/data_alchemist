const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto('http://localhost', { waitUntil: 'networkidle' });
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/page.png' });
  
  // Get page structure
  const structure = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type,
      name: i.name,
      id: i.id,
      placeholder: i.placeholder,
    }));
    
    const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText,
      class: b.className,
    }));
    
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({
      method: f.method,
      action: f.action,
      children: f.children.length,
    }));
    
    return { inputs, buttons, forms, bodyText: document.body.innerText.substring(0, 500) };
  });
  
  console.log(JSON.stringify(structure, null, 2));
  
  await browser.close();
})();
