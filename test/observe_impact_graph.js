const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
  let browser;
  const outputDir = "C:\\Users\\shweta.katkar\\paltech\\scalex\\Data Alchemist\\screenshots";
  
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.setViewportSize({ width: 1400, height: 900 });
    
    const consoleLogs = [];
    const networkLog = [];
    
    page.on("console", msg => {
      consoleLogs.push({ type: msg.type(), text: msg.text() });
    });
    
    page.on("response", response => {
      if (response.url().includes("/api")) {
        networkLog.push({ 
          status: response.status(),
          url: response.url().replace("http://localhost", ""),
          method: response.request().method()
        });
      }
    });
    
    console.log("1. Navigating to home...");
    await page.goto("http://localhost/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    
    console.log("2. Finding and filling login form...");
    
    // Find input fields
    const emailInput = await page.$('input[placeholder*="pal.tech"]');
    const passwordInput = await page.$('input[type="password"]');
    
    if (!emailInput || !passwordInput) {
      console.error("   ERROR: Could not find login inputs");
      process.exit(1);
    }
    
    await emailInput.fill("test@pal.tech");
    await passwordInput.fill("Test1234!");
    console.log("   Filled email and password");
    
    // Find sign in button - look for button text
    const buttons = await page.$$("button");
    let signInBtn = null;
    for (let btn of buttons) {
      const text = await btn.textContent();
      if (text.includes("Sign in")) {
        signInBtn = btn;
        break;
      }
    }
    
    if (!signInBtn) {
      console.error("   ERROR: Could not find Sign in button");
      process.exit(1);
    }
    
    console.log("   Clicking Sign in button");
    await signInBtn.click();
    
    // Wait for navigation and sessionStorage to be set
    console.log("3. Waiting for auth response and navigation...");
    
    try {
      // Wait for either a successful navigation or the auth to be stored in sessionStorage
      await page.waitForFunction(() => {
        const user = sessionStorage.getItem('dt_user');
        return user && user.includes('Test Admin');
      }, { timeout: 10000 });
      console.log("   Auth detected in sessionStorage");
    } catch (e) {
      console.log("   Timeout waiting for auth - checking page state");
    }
    
    await page.waitForTimeout(2000);
    
    // Check current URL and auth status
    const authStatus = await page.evaluate(() => {
      const user = JSON.parse(sessionStorage.getItem('dt_user') || '{}');
      return {
        user: user,
        isAuth: !!user.name,
        url: window.location.href
      };
    });
    
    console.log("   Current URL:", authStatus.url);
    console.log("   Auth status:", authStatus.isAuth);
    console.log("   User:", authStatus.user);
    
    const screenshotAfterLogin = path.join(outputDir, "13_after_login_form.png");
    await page.screenshot({ path: screenshotAfterLogin });
    
    console.log("\n4. Navigating to Impact Graph...");
    await page.goto("http://localhost/#/impact", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    
    const screenshotPath = path.join(outputDir, "14_impact_authenticated.png");
    await page.screenshot({ path: screenshotPath });
    console.log("   Screenshot taken");
    
    console.log("5. Scrolling to Lineage Paths section...");
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(500);
    
    const lineageScreenshot = path.join(outputDir, "15_impact_lineage_section.png");
    await page.screenshot({ path: lineageScreenshot });
    console.log("   Lineage screenshot taken");
    
    // Get detailed data
    const pageData = await page.evaluate(() => {
      const dtObject = window.DT || {};
      const impact = dtObject.impact || {};
      const allText = document.body.innerText;
      
      return {
        hasDTObject: typeof window.DT !== "undefined",
        hasImpactData: typeof window.DT !== "undefined" && typeof window.DT.impact !== "undefined",
        sourceNode: impact.source,
        tiers: (impact.tiers || []).map(t => ({
          label: t.label,
          nodeCount: (t.nodes || []).length,
          nodes: t.nodes
        })),
        isShowingLoginUI: allText.includes("Sign in to Data Alchemist"),
        hasDownstreamText: allText.includes("Downstream"),
        hasLineageText: allText.includes("Lineage"),
        fullVisibleText: allText
      };
    });
    
    console.log("\n=== AUTHENTICATED IMPACT GRAPH ===");
    console.log("Showing login UI:", pageData.isShowingLoginUI);
    console.log("Has 'Downstream' text:", pageData.hasDownstreamText);
    console.log("Has 'Lineage' text:", pageData.hasLineageText);
    console.log("Source node:", pageData.sourceNode?.label);
    console.log("\nTiers:");
    pageData.tiers.forEach(t => {
      console.log(`  ${t.label}: ${t.nodeCount} nodes`);
      if (t.nodes) {
        t.nodes.forEach(n => console.log(`    - ${n.label} (${n.status})`));
      }
    });
    
    console.log("\n=== VISIBLE TEXT ===");
    console.log(pageData.fullVisibleText);
    
    console.log("\n=== NETWORK ACTIVITY ===");
    const relevantCalls = networkLog.filter(n => n.url.includes("lineage") || n.url.includes("config"));
    console.log("Relevant API calls:", relevantCalls);
    
    // Write findings
    const findings = {
      timestamp: new Date().toISOString(),
      loginSuccess: authStatus.isAuth,
      url: page.url(),
      pageData: pageData,
      networkActivity: networkLog,
      consoleLogs: consoleLogs.filter(c => c.type === "error" || c.type === "warning"),
      screenshots: ["13_after_login_form.png", "14_impact_authenticated.png", "15_impact_lineage_section.png"]
    };
    
    fs.writeFileSync(path.join(outputDir, "impact_authenticated_findings.json"), JSON.stringify(findings, null, 2));
    
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
