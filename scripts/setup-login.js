#!/usr/bin/env node
/**
 * One-time login setup — opens the Playwright persistent browser profile
 * at singaporeair.com so you can log in to KrisFlyer.
 *
 * Run: node scripts/setup-login.js
 *
 * 1. Browser window opens
 * 2. Log in to KrisFlyer
 * 3. Wait until you see your name/miles
 * 4. Press ENTER here
 */
'use strict';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const readline = require('readline');

const PROFILE_DIR  = path.join(os.homedir(), '.sq-scraper-profile');
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');

async function waitForEnter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('\n✋ Press ENTER once you can see your KrisFlyer miles balance > ', () => {
      rl.close(); resolve();
    });
  });
}

(async () => {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // Clear stale lock files
  ['SingletonLock','SingletonCookie','SingletonSocket'].forEach(f => {
    try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch {}
  });

  console.log('🌐 Opening browser...\n');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled','--no-sandbox','--window-position=0,0'],
    ignoreDefaultArgs: ['--enable-automation'],
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();
  await page.goto('https://www.singaporeair.com/en_UK/sg/home');

  console.log('👉 Steps:');
  console.log('  1. Click "Log in" on the website');
  console.log('  2. Enter your KrisFlyer credentials');
  console.log('  3. Wait until you see your name/miles balance');
  console.log('  4. Come back here and press ENTER\n');

  await waitForEnter();

  const cookies = await context.cookies();
  const sqCookies = cookies.filter(c => c.domain.includes('singaporeair'));
  const loginCookie = sqCookies.find(c => c.name === 'LOGIN_COOKIE');
  
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  console.log(`\n✅ Saved ${sqCookies.length} SQ cookies`);
  console.log(`Login status: ${loginCookie?.value === 'true' ? '✅ Logged in' : '⚠️ Login cookie not found — may not be logged in'}`);
  
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
  if (bodyText.includes('KrisFlyer') && !bodyText.toUpperCase().includes('LOG-INSIGN UP')) {
    console.log('✅ KrisFlyer session confirmed active');
  } else {
    console.log('⚠️ Warning: Session may not be active. Please try logging in again.');
  }

  await context.close();
  console.log('\n✅ Done! Run the bot: npm start');
  process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
