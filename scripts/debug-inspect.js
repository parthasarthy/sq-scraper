#!/usr/bin/env node
/**
 * Debug helper: open SQ award search in a visible Chromium window
 * so you can inspect the DOM and update selectors in scraper.js.
 *
 * Usage:
 *   node scripts/debug-inspect.js
 *
 * This will open the browser, navigate to SQ, click Redeem Flights,
 * then pause so you can inspect the DOM in DevTools.
 */
'use strict';
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-SG',
  });

  const page = await context.newPage();
  await page.goto('https://www.singaporeair.com/en_UK/sg/home', {
    waitUntil: 'domcontentloaded',
  });

  console.log('✅ Navigated to SQ home.');
  console.log('👉 Trying to click "Redeem flights" tab...');

  try {
    await page.locator(
      'button:has-text("Redeem flights"), a:has-text("Redeem flights"), ' +
      'label:has-text("Redeem"), span:has-text("Redeem flights")'
    ).first().click({ timeout: 10_000 });
    console.log('✅ Clicked Redeem tab.');
  } catch {
    console.log('❌ Could not find Redeem tab automatically — inspect manually.');
  }

  console.log('\n🔍 Browser is open. Inspect elements and update selectors in scraper.js.');
  console.log('Press Ctrl+C to close.\n');

  // Keep open until killed
  await new Promise(() => {});
})();
