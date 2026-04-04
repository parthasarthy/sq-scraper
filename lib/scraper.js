'use strict';
/**
 * SQ Award Seat Scraper — definitive version.
 *
 * Architecture: Non-headless Playwright persistent context (~/.sq-scraper-profile)
 *
 * Key constraints discovered through live DOM inspection:
 * - Akamai blocks all headless browsers → headless: false required
 * - Airport select: vm.$parent.onClickToggle(true) + vm.select(enrichedAirport)
 *   Airport object needs .label and .value fields added before calling select()
 * - Cabin dropdown: JS mousedown+click on #flightClass2, then .suggest-item[idx]
 * - One-way checkbox: #oneway_id — click WHILE calendar is open
 * - Calendar nav: .calendar_month_right a.right (next), count months from current
 * - Day cell: li[date-data="YYYY-MM-DD"]
 * - Form submit: form.submit() — button.click() intercepts to tab widget
 * - Session: launchPersistentContext reads decrypted cookies from profile
 *   Session expires → auto re-login flow triggered
 */

const { chromium } = require('playwright');
const dayjs = require('dayjs');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');
const readline = require('readline');

const PROFILE_DIR  = path.join(os.homedir(), '.sq-scraper-profile');
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const TIMEOUT      = 60_000;

const CABIN_LABELS = {
  Economy: 'Economy', PremiumEconomy: 'Premium Economy',
  Business: 'Business', First: 'First/Suites',
};
const CABIN_IDX = { Economy: 0, PremiumEconomy: 1, Business: 2, First: 3 };

// ─────────────────────────────────────────────────────────────────────────────
// Launch browser — always non-headless (Akamai blocks headless)
// ─────────────────────────────────────────────────────────────────────────────

async function launchBrowser() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // Clear stale lock files so we can open the profile
  ['SingletonLock','SingletonCookie','SingletonSocket'].forEach(f => {
    try { fs.unlinkSync(path.join(PROFILE_DIR, f)); } catch { /* ok */ }
  });

  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--window-position=0,0',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:   { width: 1440, height: 900 },
    locale:     'en-SG',
    timezoneId: 'Asia/Singapore',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Check if KrisFlyer session is active on a page
// ─────────────────────────────────────────────────────────────────────────────

async function isLoggedIn(page) {
  try {
    await page.goto('https://www.singaporeair.com/en_UK/sg/home', {
      waitUntil: 'domcontentloaded', timeout: 30000
    });
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.innerText);
    return text.includes('KrisFlyer') && !text.toUpperCase().includes('LOG-INSIGN UP');
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive login — opens browser, waits for user
// ─────────────────────────────────────────────────────────────────────────────

async function interactiveLogin(context, telegramNotify) {
  const page = await context.newPage();
  await page.goto('https://www.singaporeair.com/en_UK/sg/home');

  if (telegramNotify) {
    await telegramNotify(
      '🔐 *KrisFlyer login required*\n\n' +
      'Your session has expired. Please log in:\n' +
      '1. Find the Chrome window that just opened\n' +
      '2. Log in to KrisFlyer\n' +
      '3. Once logged in, reply "logged in" here\n\n' +
      'The search will resume automatically.'
    );
  } else {
    console.log('\n⚠️  KrisFlyer login required!');
    console.log('A browser window has opened. Please log in to KrisFlyer.');
    console.log('Press ENTER here once logged in...\n');
    await new Promise(resolve => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', () => { rl.close(); resolve(); });
    });
  }

  // Save fresh cookies after login
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  console.log('Cookies saved after login');
  await page.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar navigation — navigate to target month then click day
// ─────────────────────────────────────────────────────────────────────────────

async function navigateToDate(page, targetDate) {
  const isoDate = targetDate.format('YYYY-MM-DD');

  // Figure out how many months to advance from current right calendar month
  for (let attempt = 0; attempt < 20; attempt++) {
    // Check if target cell exists and is enabled
    const cell = page.locator(`li[date-data="${isoDate}"]`).first();
    if (await cell.count() > 0) {
      const cls = await cell.getAttribute('class').catch(() => '');
      if (!cls.includes('disabled') && !cls.includes('invalid')) {
        await cell.click({ timeout: 5000 });
        return true;
      }
    }

    // Read right calendar month header
    const rightText = await page.locator('.calendar_month_right .months-text').first()
      .textContent({ timeout: 3000 }).catch(() => '');
    const rightMonth  = dayjs(rightText.trim(), ['MMMM YYYY', 'MMM YYYY'], true);
    const targetStart = dayjs(targetDate).startOf('month');

    if (rightMonth.isValid()) {
      if (targetStart.isBefore(rightMonth.startOf('month'))) {
        // Go back
        await page.evaluate(() => document.querySelector('.calendar_month_right a.left, .calendar_month_left a.left')?.click());
      } else {
        // Go forward
        await page.evaluate(() => document.querySelector('.calendar_month_right a.right')?.click());
      }
    } else {
      // No header visible yet — just go forward
      await page.evaluate(() => document.querySelector('.calendar_month_right a.right')?.click());
    }
    await page.waitForTimeout(500);
  }

  // Last resort direct click
  await page.evaluate((iso) => document.querySelector(`li[date-data="${iso}"]`)?.click(), isoDate);
  return await page.locator(`li[date-data="${isoDate}"]`).count() > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrape results page — find Saver and Advantage flights
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeResults(page) {
  const resultSel = [
    '[class*="orb-result"]', '[class*="flight-option"]', '[class*="fare-option"]',
    '[class*="flight-row"]', '[class*="flight-card"]',
  ].join(', ');

  try {
    await page.waitForSelector(resultSel, { timeout: 25_000 });
  } catch {
    const txt = (await page.evaluate(() => document.body.innerText)).toLowerCase().slice(0, 400);
    console.log('No result rows found. Body:', txt);
    return { available: false, saverFlights: [], advantageFlights: [] };
  }
  await page.waitForTimeout(2000);

  const { saverFlights, advantageFlights } = await page.evaluate(() => {
    const saver = [], adv = [];
    const sels = [
      '[class*="orb-result"]','[class*="flight-option"]','[class*="fare-option"]',
      '[class*="flight-row"]','[class*="flight-card"]',
    ];
    let rows = [];
    for (const s of sels) { const f = [...document.querySelectorAll(s)]; if (f.length) { rows = f; break; } }

    for (const row of rows) {
      const t = row.textContent, tl = t.toLowerCase();
      if (!tl.includes('saver') && !tl.includes('advantage')) continue;
      const fn = (t.match(/\bSQ\s*\d{1,4}\b/i) || ['?'])[0].replace(/\s+/, '');
      const tm = t.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
      const mm = t.match(/(\d{1,3}(?:[,\s]\d{3})*)\s*(?:miles?|KrisFlyer)/i);
      const isWait = tl.includes('waitlist') || tl.includes('request');
      const e = {
        flightNo: fn,
        departs:  tm ? tm[1] : null,
        arrives:  tm ? tm[2] : null,
        miles:    mm ? mm[1].replace(/[,\s]/g, '') : null,
        confirmed: !isWait,
        waitlist:  isWait,
      };
      if (tl.includes('saver'))     saver.push({ ...e, fareType: 'Saver' });
      if (tl.includes('advantage')) adv.push({ ...e, fareType: 'Advantage' });
    }
    return { saverFlights: saver, advantageFlights: adv };
  });

  return {
    available: saverFlights.length > 0 || advantageFlights.length > 0,
    saverFlights,
    advantageFlights,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: fill form and submit for one date
// ─────────────────────────────────────────────────────────────────────────────

async function searchOneDate({ from, to, date, cabinClass, passengers, context }) {
  const page = await context.newPage();
  const result = {
    date: date.format('YYYY-MM-DD'),
    available: false,
    saverFlights: [],
    advantageFlights: [],
    error: null,
  };

  try {
    console.log(`Checking ${from}→${to} on ${date.format('DD MMM YYYY')} [${cabinClass}]`);

    // 1. Navigate to homepage
    await page.goto('https://www.singaporeair.com/en_UK/sg/home', {
      waitUntil: 'domcontentloaded', timeout: TIMEOUT
    });
    await page.waitForTimeout(3000);

    if (/maintenance|challenge/i.test(await page.title())) {
      throw new Error('SQ bot-challenge page detected');
    }

    // 2. Activate Redeem Flights tab via Vue events
    await page.evaluate(() => {
      const r = document.querySelector('#redeemFlights');
      if (r) {
        r.checked = true;
        r.dispatchEvent(new Event('change', { bubbles: true }));
        r.dispatchEvent(new Event('input', { bubbles: true }));
        r.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    await page.waitForURL(/redeemflight/i, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // 3. Set Origin + Destination via Vue component API
    // Must fetch airport list inside evaluate() to avoid serialization issues
    const airportSetResult = await page.evaluate(async ({ fromCode, toCode }) => {
      // Fetch ORB airport list
      const resp = await fetch('/home/getORBAirportListJson.form?locale=en_UK&country=SG');
      const data = await resp.json();
      const list = data.ORBAirportList || [];

      // Enrich airport object with label+value needed by vue-simple-suggest
      const enrich = (a) => {
        a.label = `${a.cityName}, ${a.countryName} (${a.airportName} - ${a.airportCode})`;
        a.value = a.airportCode;
        return a;
      };

      const fromA = list.find(a => a.airportCode === fromCode || a.cityCode === fromCode);
      const toA   = list.find(a => a.airportCode === toCode   || a.cityCode === toCode);

      if (!fromA) return { error: `Origin not found: ${fromCode}` };
      if (!toA)   return { error: `Destination not found: ${toCode}` };

      enrich(fromA);
      enrich(toA);

      function setAirport(selector, airport) {
        const input = document.querySelector(selector);
        if (!input) return false;
        let vueEl = input;
        while (vueEl && !vueEl.__vue__) vueEl = vueEl.parentElement;
        if (!vueEl?.__vue__) return false;
        const vm = vueEl.__vue__;
        // Open the dropdown then select
        if (vm.$parent?.onClickToggle) vm.$parent.onClickToggle(true);
        vm.select(airport);
        return true;
      }

      const r1 = setAirport('#flightOrigin2', fromA);
      await new Promise(r => setTimeout(r, 500));
      const r2 = setAirport('#redeemFlightDestination', toA);

      return {
        originSet: r1,
        destSet: r2,
        originCode: document.querySelector('#flightOrigin2')?.value,
        destCode:   document.querySelector('#redeemFlightDestination')?.value,
      };
    }, { fromCode: from, toCode: to });

    if (airportSetResult.error) throw new Error(airportSetResult.error);
    console.log(`  Airports: ${airportSetResult.originCode} → ${airportSetResult.destCode}`);

    // 4. Set Cabin Class
    await page.evaluate(async ({ idx }) => {
      const input = document.querySelector('#flightClass2');
      if (!input) return;
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
      const items = [...document.querySelectorAll('.suggest-item')];
      const item = items[idx] || items[0];
      if (item) {
        item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 300));
    }, { idx: CABIN_IDX[cabinClass] ?? 0 });

    // 5. Passengers (if > 1)
    if (passengers > 1) {
      await page.evaluate(async ({ n }) => {
        const input = document.querySelector('#flightPassengers2');
        if (!input) return;
        input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 500));
        for (let i = 1; i < n; i++) {
          const plusBtn = document.querySelector('[class*="passenger"] [class*="plus"]');
          if (plusBtn) plusBtn.click();
          await new Promise(r => setTimeout(r, 200));
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }, { n: passengers });
      await page.waitForTimeout(400);
    }

    // 6. Open Date Picker, click One-Way, navigate to target month, pick day
    await page.evaluate(() => {
      const dp = document.querySelector('#departDate2');
      if (dp) {
        dp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        dp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    await page.waitForTimeout(1200);

    // One-Way: must be clicked while calendar is open
    await page.evaluate(() => {
      const cb = document.querySelector('#oneway_id');
      if (cb && !cb.checked) cb.click();
    });
    await page.waitForTimeout(600);

    const dateFound = await navigateToDate(page, date);
    console.log(`  Date: ${date.format('DD MMM YYYY')} — picked: ${dateFound}`);
    await page.waitForTimeout(800);

    // 7. Verify form state before submitting
    const formState = await page.evaluate(() => ({
      origin:  document.querySelector('#flightOrigin2')?.value,
      dest:    document.querySelector('#redeemFlightDestination')?.value,
      cabin:   document.querySelector('#flightClass2')?.value,
      depart:  document.querySelector('#departDate2')?.value,
      oneway:  document.querySelector('#oneway_id')?.checked,
      // Vue internal state check
      originItem: (() => {
        let el = document.querySelector('#flightOrigin2');
        while (el && !el.__vue__) el = el.parentElement;
        return el?.__vue__?.$parent?.$data?.item?.airportCode;
      })(),
      destItem: (() => {
        let el = document.querySelector('#redeemFlightDestination');
        while (el && !el.__vue__) el = el.parentElement;
        return el?.__vue__?.$parent?.$data?.item?.airportCode;
      })(),
    }));
    console.log(`  Form: origin=${formState.originItem} dest=${formState.destItem} cabin=${formState.cabin} date=${formState.depart} oneway=${formState.oneway}`);

    // 8. Submit form directly (button.click() gets intercepted by tab widget overlay)
    const submitResult = await page.evaluate(() => {
      // Dismiss any blocking overlays first
      document.querySelectorAll('.dwc--LightBox__Cell, [class*="LightBox"]').forEach(el => {
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
      });
      const form = document.querySelector('#flightOrigin2')?.closest('form');
      if (!form) return { error: 'form not found' };
      form.submit();
      return { action: form.action, method: form.method };
    });

    if (submitResult.error) throw new Error(submitResult.error);
    console.log(`  Submitted to: ${submitResult.action}`);

    // 9. Wait for results page to load
    await page.waitForURL(/loadFlightSearchPage|orb_chooseflight/i, { timeout: TIMEOUT })
      .catch(() => {});
    await page.waitForTimeout(5000);

    const finalUrl = page.url();
    console.log(`  Results URL: ${finalUrl.replace('https://www.singaporeair.com', '')}`);

    if (!finalUrl.includes('loadFlightSearchPage') && !finalUrl.includes('orb_chooseflight')) {
      // Form submit redirected back — likely session issue
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));
      if (bodyText.toUpperCase().includes('LOG-IN') || bodyText.includes('Log in to your')) {
        throw new Error('SESSION_EXPIRED');
      }
      throw new Error(`Form did not reach results page. URL: ${finalUrl.replace('https://www.singaporeair.com', '')}`);
    }

    // 10. Scrape results
    const scraped = await scrapeResults(page);
    result.available        = scraped.available;
    result.saverFlights     = scraped.saverFlights;
    result.advantageFlights = scraped.advantageFlights;

  } catch (err) {
    result.error = err.message;
    if (err.message !== 'SESSION_EXPIRED') {
      console.error(`  Error: ${err.message.slice(0, 120)}`);
    }
  } finally {
    await page.close();
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: run search across all dates with session management
// ─────────────────────────────────────────────────────────────────────────────

async function runSearch(query, opts = {}) {
  const { from, to, dates, cabinClass, passengers } = query;
  const { telegramNotify } = opts;

  let context = await launchBrowser();

  // Check if logged in; re-login if needed
  const checkPage = await context.newPage();
  const loggedIn  = await isLoggedIn(checkPage);
  await checkPage.close();

  if (!loggedIn) {
    console.log('Not logged in — requesting login...');
    await interactiveLogin(context, telegramNotify);
    // Restart context to pick up fresh session
    await context.close();
    context = await launchBrowser();
  }

  const allResults = [];

  try {
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      const r = await searchOneDate({ from, to, date, cabinClass, passengers, context });

      if (r.error === 'SESSION_EXPIRED') {
        console.log('Session expired mid-search — requesting re-login...');
        await context.close();
        context = await launchBrowser();
        await interactiveLogin(context, telegramNotify);
        await context.close();
        context = await launchBrowser();
        // Retry this date
        const retry = await searchOneDate({ from, to, date, cabinClass, passengers, context });
        allResults.push(retry);
      } else {
        allResults.push(r);
      }

      if (i < dates.length - 1) await new Promise(res => setTimeout(res, 2000));
    }
  } finally {
    await context.close();
  }

  return allResults;
}

module.exports = { runSearch, isLoggedIn, launchBrowser, interactiveLogin };
