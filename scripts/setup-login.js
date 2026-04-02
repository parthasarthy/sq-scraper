#!/usr/bin/env node
/**
 * One-time login setup.
 * Opens the persistent browser profile used by the scraper.
 * Log in to KrisFlyer — that's it. Session is saved permanently.
 * You only need to do this once (or if you get logged out).
 *
 * Usage:
 *   node scripts/setup-login.js
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const os   = require('os');

const PROFILE_DIR = path.join(os.homedir(), '.sq-scraper-profile');

(async () => {
  console.log('🌐 Opening browser with persistent profile...');
  console.log('📁 Profile:', PROFILE_DIR);
  console.log('');
  console.log('👉 Log in to your KrisFlyer account.');
  console.log('   Once logged in and you can see the homepage, close the browser window.');
  console.log('   The session will be saved automatically.\n');

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:   { width: 1440, height: 900 },
    locale:     'en-SG',
    timezoneId: 'Asia/Singapore',
  });

  const page = await context.newPage();
  await page.goto('https://www.singaporeair.com/en_UK/sg/home');

  // Wait until the user closes the browser
  await context.waitForEvent('close').catch(() => {});
  console.log('✅ Login session saved. The scraper will use this session automatically.');
  process.exit(0);
})();
