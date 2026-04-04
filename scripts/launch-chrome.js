#!/usr/bin/env node
/**
 * Launch real Chrome with remote debugging enabled.
 * The SQ scraper connects to this Chrome via CDP.
 *
 * Run this ONCE before starting the bot, keep it running in background.
 * Usage: node scripts/launch-chrome.js
 */
'use strict';
const { exec } = require('child_process');
const http     = require('http');
const path     = require('path');
const os       = require('os');
const fs       = require('fs');

const CHROME  = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT    = 9222;
const PROFILE = path.join(os.homedir(), '.sq-chrome-profile');

fs.mkdirSync(PROFILE, { recursive: true });

function checkRunning() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${PORT}/json/version`, res => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  if (await checkRunning()) {
    console.log(`✅ Chrome already running on port ${PORT}`);
    process.exit(0);
  }

  console.log('🚀 Launching Chrome with remote debugging...');
  const child = exec(
    `"${CHROME}" --remote-debugging-port=${PORT} --user-data-dir="${PROFILE}" --no-first-run --no-default-browser-check`,
    { detached: true }
  );
  child.unref();

  // Wait for Chrome to start
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await checkRunning()) {
      console.log(`✅ Chrome started on port ${PORT}`);
      console.log(`👉 Go to http://localhost:${PORT} to verify`);
      console.log(`👉 Log in to KrisFlyer at singaporeair.com in this Chrome if not already logged in`);
      process.exit(0);
    }
  }

  console.error('❌ Chrome failed to start');
  process.exit(1);
})();
