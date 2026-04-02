#!/usr/bin/env node
/**
 * API Capture Script - catches ALL XHR/fetch requests made by SQ
 * Saves them all to captured-requests.json so we can find the right one.
 */
'use strict';
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'captured-requests.json');
const captured = [];

(async () => {
  console.log('🌐 Opening browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  // Load saved cookies
  const cookiesFile = path.join(__dirname, '..', 'cookies.json');
  if (fs.existsSync(cookiesFile)) {
    await context.addCookies(JSON.parse(fs.readFileSync(cookiesFile)));
    console.log('✅ Loaded saved cookies');
  }

  const page = await context.newPage();

  // Capture ALL fetch/XHR requests from SQ domain
  page.on('request', async req => {
    const url = req.url();
    if (!url.includes('singaporeair.com')) return;
    if (req.resourceType() !== 'fetch' && req.resourceType() !== 'xhr') return;

    const entry = {
      url,
      method: req.method(),
      headers: req.headers(),
      postData: req.postData() || null,
    };
    captured.push(entry);

    // Save on every request so nothing is lost
    fs.writeFileSync(OUT, JSON.stringify(captured, null, 2));

    if (url.includes('Reward') || url.includes('reward') || url.includes('redeem') || url.includes('award')) {
      console.log('🎯 INTERESTING:', req.method(), url);
    }
  });

  // Also capture responses for reward-related calls
  page.on('response', async res => {
    const url = res.url();
    if (!url.includes('singaporeair.com')) return;
    if (!url.includes('eward') && !url.includes('edeem') && !url.includes('ward')) return;
    try {
      const body = await res.text();
      console.log('\n📦 RESPONSE from:', url);
      console.log('Status:', res.status());
      console.log('Preview:', body.slice(0, 400));
      // Annotate saved entry with response
      const entry = captured.find(e => e.url === url);
      if (entry) { entry.responseStatus = res.status(); entry.responsePreview = body.slice(0, 800); }
      fs.writeFileSync(OUT, JSON.stringify(captured, null, 2));
    } catch {}
  });

  await page.goto('https://www.singaporeair.com/en_UK/sg/home');

  console.log('\n👉 Instructions:');
  console.log('  1. Log in to KrisFlyer if prompted');
  console.log('  2. Click "Redeem Flights"');
  console.log('  3. Search SIN → DEL, 19 Dec 2026, Business, 1 pax');
  console.log('  4. Hit Search and WAIT for results to load fully');
  console.log(`  5. All requests are being saved to: ${OUT}`);
  console.log('\nPress Ctrl+C in this terminal when results are visible.\n');

  // Keep alive
  await new Promise(() => {});
})();
