const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1280, height: 1080 });
  
  console.log('Navigating to mock auth...');
  await page.goto('http://127.0.0.1:3001/auth/mock', { waitUntil: 'networkidle2' });
  
  console.log('Wait for dashboard to load...');
  await page.waitForSelector('text/MentorQA', { timeout: 10000 });
  
  console.log('Finding stateless-api repo and clicking analyze...');
  const repoSelector = 'text/Lucky-939/stateless-api';
  await page.waitForSelector(repoSelector, { timeout: 10000 });
  
  // Find the analyze button inside the repo row
  const buttonHandlers = await page.$x("//h3[contains(text(), 'stateless-api')]/../../button[contains(text(), 'ANALYZE')]");
  if (buttonHandlers.length > 0) {
    await buttonHandlers[0].click();
    console.log('Clicked ANALYZE');
  } else {
    console.log('ANALYZE button not found!');
  }
  
  console.log('Waiting for pipeline to finish...');
  await page.waitForFunction(
    () => {
      const el = document.body.innerText;
      return el.includes('DONE') || el.includes('FAILED');
    },
    { timeout: 60000 }
  );
  
  console.log('Pipeline finished. Taking screenshot...');
  // small delay for rendering graph
  await new Promise(r => setTimeout(r, 2000));
  
  const screenshotPath = 'C:\\Users\\Lucky Bhoir\\.gemini\\antigravity-ide\\brain\\0e4ebfc8-03d9-4b95-abf5-98df0e08bd40\\dashboard_screenshot.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  
  console.log('Screenshot saved to: ' + screenshotPath);
  
  await browser.close();
})();
