#!/usr/bin/env node
/**
 * Cookie exporter: open SQ in a visible browser, let you log in manually,
 * then saves your session cookies to cookies.json for use by the scraper.
 *
 * Usage:
 *   node scripts/export-cookies.js
 *
 * After saving cookies, the scraper will inject them automatically.
 * Cookies expire — re-run this script when the scraper gets login walls.
 */
'use strict';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'cookies.json');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await context.newPage();

  await page.goto('https://www.singaporeair.com/en_UK/sg/home');
  console.log('🌐 SQ is open. Log in to your KrisFlyer account.');
  console.log('Once you\'re logged in and can see the booking form, press ENTER here.\n');

  await new Promise(resolve => {
    process.stdin.once('data', resolve);
    process.stdout.write('Press ENTER after logging in > ');
  });

  const cookies = await context.cookies();
  fs.writeFileSync(OUT, JSON.stringify(cookies, null, 2));
  console.log(`\n✅ Saved ${cookies.length} cookies to ${OUT}`);
  console.log('The scraper will now use these cookies automatically.\n');

  await browser.close();
})();
