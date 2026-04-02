'use strict';
/**
 * SQ Award Seat Scraper — Pure UI automation (non-headless Playwright).
 *
 * Mimics exactly what a user does:
 *  1. Open SQ website
 *  2. Click "Redeem flights"
 *  3. Type origin, pick from dropdown
 *  4. Type destination, pick from dropdown
 *  5. Select cabin class
 *  6. Set passenger count
 *  7. Pick date from calendar
 *  8. Click Search
 *  9. Wait for results, read flight cards
 * 10. Filter for Saver only
 */

const { chromium } = require('playwright');
const dayjs = require('dayjs');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const SQ_HOME      = 'https://www.singaporeair.com/en_UK/sg/home';
const PROFILE_DIR  = path.join(os.homedir(), '.sq-scraper-profile');
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const TIMEOUT      = 60_000;

const CABIN_LABELS = {
  Economy:        'Economy',
  PremiumEconomy: 'Premium Economy',
  Business:       'Business',
  First:          'First Class',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function waitAndClick(page, selectors, timeout = 15_000) {
  const sel = Array.isArray(selectors) ? selectors.join(', ') : selectors;
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout });
  await el.click();
}

async function typeIntoInput(page, selectors, text) {
  const sel = Array.isArray(selectors) ? selectors.join(', ') : selectors;
  const el = page.locator(sel).first();
  await el.waitFor({ state: 'visible', timeout: 15_000 });
  await el.click();
  await el.fill('');
  await page.keyboard.type(text, { delay: 80 });
}

async function pickAutocomplete(page, text) {
  // Wait for dropdown to appear and pick matching option
  await page.waitForTimeout(1200);
  const selectors = [
    `[role="listbox"] [role="option"]:has-text("(${text})")`,
    `[role="listbox"] [role="option"]:has-text("${text}")`,
    `[class*="dropdown-item"]:has-text("${text}")`,
    `[class*="suggestion"]:has-text("${text}")`,
    `li:has-text("(${text})")`,
    `li:has-text("${text}")`,
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click({ timeout: 5000 });
      return true;
    }
  }
  // If no dropdown appeared, press Enter and hope for best
  await page.keyboard.press('Enter');
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Calendar navigation
// ─────────────────────────────────────────────────────────────────────────────

async function navigateToDate(page, targetDate) {
  const targetMonth = targetDate.month(); // 0-indexed
  const targetYear  = targetDate.year();
  const targetDay   = targetDate.date();

  // Try up to 24 months of navigation
  for (let attempt = 0; attempt < 24; attempt++) {
    // Read current calendar header
    const headerSelectors = [
      '.DayPicker-Caption', '[class*="CalendarMonth_caption"]',
      '[class*="month-label"]', '[class*="calendar-header"]',
      '[class*="calendar-title"]', '[class*="monthYear"]',
    ];
    let headerText = '';
    for (const sel of headerSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        headerText = (await el.textContent().catch(() => '')).trim();
        if (headerText) break;
      }
    }

    const parsed = dayjs(headerText, ['MMMM YYYY', 'MMM YYYY'], true);
    if (parsed.isValid()) {
      if (parsed.month() === targetMonth && parsed.year() === targetYear) break;
      const isAfterTarget = parsed.isAfter(dayjs(targetDate).startOf('month'));
      const navSel = isAfterTarget
        ? 'button[aria-label*="previous" i], button[aria-label*="back" i], button[aria-label*="prev" i], .DayPicker-NavButton--prev, [class*="prevMonth"], [class*="prev-month"]'
        : 'button[aria-label*="next" i], .DayPicker-NavButton--next, [class*="nextMonth"], [class*="next-month"]';
      await page.locator(navSel).first().click({ timeout: 5000 }).catch(() => {});
    } else {
      // Header unreadable — just go forward
      await page.locator(
        'button[aria-label*="next" i], .DayPicker-NavButton--next, [class*="nextMonth"]'
      ).first().click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }

  // Click the target day — try multiple selector strategies
  const daySelectors = [
    `[aria-label*="${targetDate.format('dddd, MMMM D, YYYY')}"]`,
    `[aria-label*="${targetDate.format('D MMMM YYYY')}"]`,
    `[aria-label*="${targetDate.format('MMMM D, YYYY')}"]`,
    `[data-date="${targetDate.format('YYYY-MM-DD')}"]`,
    `td[class*="day"]:not([class*="disabled"]):not([class*="blocked"]):not([class*="outside"]) abbr:has-text("${targetDay}")`,
    `td:not([class*="disabled"]):not([class*="blocked"]) [class*="day-number"]:has-text("${targetDay}")`,
    `[class*="CalendarDay"]:not([class*="blocked"]):not([class*="outside"]) :has-text("${targetDay}")`,
  ];

  for (const sel of daySelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click({ timeout: 5000 });
      await page.waitForTimeout(300);
      return;
    }
  }

  // Last resort: find all visible day cells and match by text
  await page.evaluate((day) => {
    const cells = [...document.querySelectorAll('td, [class*="CalendarDay"], [class*="day-cell"]')];
    for (const cell of cells) {
      if (cell.textContent.trim() === String(day) &&
          !cell.className.includes('disabled') &&
          !cell.className.includes('blocked') &&
          !cell.className.includes('outside')) {
        cell.click();
        return;
      }
    }
  }, targetDay);
}

// ─────────────────────────────────────────────────────────────────────────────
// Result scraping
// ─────────────────────────────────────────────────────────────────────────────

async function scrapeResults(page, cabinClass) {
  const cabinLabel = (CABIN_LABELS[cabinClass] || 'Economy').toLowerCase();

  // Wait for results to appear
  const resultSelectors = [
    '[class*="flight-row"]', '[class*="flight-result"]',
    '[class*="orb-result"]', '[class*="itinerary-item"]',
    '[class*="fare-option"]', '[class*="flight-card"]',
    '[class*="flight-option"]', '[class*="journey-option"]',
  ].join(', ');

  try {
    await page.waitForSelector(resultSelectors, { timeout: 25_000 });
  } catch {
    // No results appeared — check for "no flights" message
    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
    if (pageText.includes('no flight') || pageText.includes('no available') || pageText.includes('no result')) {
      return { available: false, saverFlights: [], noFlightsMessage: true };
    }
    return { available: false, saverFlights: [] };
  }

  // Give any lazy-loaded content time to render
  await page.waitForTimeout(2000);

  const flights = await page.evaluate((cabinLabel) => {
    const results = [];
    const rowSelectors = [
      '[class*="flight-row"]', '[class*="flight-result"]', '[class*="orb-result"]',
      '[class*="itinerary-item"]', '[class*="fare-option"]', '[class*="flight-card"]',
      '[class*="flight-option"]', '[class*="journey-option"]',
    ];

    let rows = [];
    for (const sel of rowSelectors) {
      const found = [...document.querySelectorAll(sel)];
      if (found.length > 0) { rows = found; break; }
    }

    for (const row of rows) {
      const text = row.textContent;
      const textLow = text.toLowerCase();

      // Must contain "saver" (case-insensitive)
      if (!textLow.includes('saver')) continue;

      // Skip if it's an Advantage-only row
      if (textLow.includes('advantage') && !textLow.includes('saver')) continue;

      // Filter by cabin if relevant
      if (cabinLabel !== 'economy' && !textLow.includes(cabinLabel)) continue;

      // Extract flight number (SQ + digits)
      const flightMatch = text.match(/\bSQ\s*\d{1,4}\b/i);
      const flightNo = flightMatch ? flightMatch[0].replace(/\s+/, '') : '?';

      // Extract times (HH:MM - HH:MM or HH:MM–HH:MM)
      const timeMatch = text.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
      const departs = timeMatch ? timeMatch[1] : null;
      const arrives = timeMatch ? timeMatch[2] : null;

      // Extract miles
      const milesMatch = text.match(/(\d{1,3}(?:[,.\s]\d{3})*)\s*(?:miles?|KrisFlyer\s*miles?|pts?|points?)/i);
      const miles = milesMatch ? milesMatch[1].replace(/[,.\s]/g, '') : null;

      // Extract seats left
      const seatsMatch = text.match(/(\d+)\s*(?:seat[s]?\s*(?:left|available|remaining)?|available\s*seat[s]?)/i);
      const seatsLeft = seatsMatch ? seatsMatch[1] : null;

      results.push({ flightNo, departs, arrives, miles, seatsLeft, fareType: 'Saver' });
    }

    return results;
  }, cabinLabel);

  return {
    available: flights.length > 0,
    saverFlights: flights,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: check one date
// ─────────────────────────────────────────────────────────────────────────────

async function checkDate({ from, to, date, cabinClass, passengers, context }) {
  const page = await context.newPage();
  const result = {
    date: date.format('YYYY-MM-DD'),
    available: false,
    saverFlights: [],
    error: null,
  };

  try {
    console.log(`Checking ${from}→${to} on ${date.format('DD MMM YYYY')} [${cabinClass}]`);

    // ── 1. Navigate ───────────────────────────────────────────────────────
    await page.goto(SQ_HOME, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await page.waitForTimeout(2500);

    const title = await page.title();
    if (/maintenance|challenge/i.test(title)) {
      throw new Error('SQ is showing a bot-challenge page. Run: node scripts/setup-login.js');
    }

    // ── Check if logged in ────────────────────────────────────────────────
    // SQ shows a login CTA when not authenticated
    const isLoggedIn = await page.evaluate(() => {
      const loginLinks = document.querySelectorAll('a[href*="login"], a[href*="signin"], a[href*="sign-in"]');
      const loginBtns  = [...document.querySelectorAll('button, a')].filter(el => /^log in$/i.test(el.textContent.trim()));
      return loginLinks.length === 0 && loginBtns.length === 0;
    });
    if (!isLoggedIn) {
      throw new Error('Not logged in to KrisFlyer. Run: node scripts/setup-login.js');
    }

    // ── 2. Click Redeem Flights ───────────────────────────────────────────
    // The tab is a radio button — JS click bypasses pointer-intercept issues
    const redeemClicked = await page.evaluate(() => {
      const radio = document.querySelector('#redeemFlights, input[value="redeemFlight"], input[id*="redeem" i]');
      if (radio) { radio.click(); return true; }
      const label = [...document.querySelectorAll('label')].find(l => /redeem flights/i.test(l.textContent));
      if (label) { label.click(); return true; }
      return false;
    });
    if (!redeemClicked) {
      await page.locator('label:has-text("Redeem"), span:has-text("Redeem flights")').first()
        .click({ timeout: 10_000, force: true });
    }
    await page.waitForTimeout(1200);

    // ── 3. Fill origin ────────────────────────────────────────────────────
    await typeIntoInput(page, [
      'input[placeholder*="From" i]', 'input[aria-label*="From" i]',
      'input[aria-label*="Origin" i]', '#fromCity',
      '[data-testid*="origin"] input', 'input[name*="origin" i]',
    ], from);
    await pickAutocomplete(page, from);
    await page.waitForTimeout(500);

    // ── 4. Fill destination ───────────────────────────────────────────────
    await typeIntoInput(page, [
      'input[placeholder*="To" i]', 'input[aria-label*="To" i]',
      'input[aria-label*="Destination" i]', '#toCity',
      '[data-testid*="destination"] input', 'input[name*="destination" i]',
    ], to);
    await pickAutocomplete(page, to);
    await page.waitForTimeout(500);

    // ── 5. Set cabin class ────────────────────────────────────────────────
    const cabinText = CABIN_LABELS[cabinClass] || 'Economy';
    const cabinDropdown = page.locator('select[name*="cabin" i], select[name*="class" i], [aria-label*="Cabin" i], [aria-label*="class" i]').first();
    if (await cabinDropdown.count() > 0) {
      await cabinDropdown.selectOption({ label: cabinText }).catch(async () => {
        // Try partial match
        const options = await cabinDropdown.locator('option').allTextContents();
        const match = options.find(o => o.toLowerCase().includes(cabinText.toLowerCase().split(' ')[0]));
        if (match) await cabinDropdown.selectOption({ label: match });
      });
    } else {
      // Pills / buttons
      await page.locator(`button:has-text("${cabinText}"), label:has-text("${cabinText}"), [class*="cabin"]:has-text("${cabinText}")`).first()
        .click({ timeout: 5000 }).catch(() => {});
    }

    // ── 6. Set passengers ─────────────────────────────────────────────────
    if (passengers > 1) {
      const paxDropdown = page.locator('select[name*="adult" i], select[name*="passenger" i], select[name*="pax" i]').first();
      if (await paxDropdown.count() > 0) {
        await paxDropdown.selectOption(String(passengers))
          .catch(() => paxDropdown.selectOption({ index: passengers - 1 }).catch(() => {}));
      } else {
        const plusBtn = page.locator('button[aria-label*="Add adult" i], button[aria-label*="increase" i], [data-testid*="adult-plus"]').first();
        for (let i = 1; i < passengers; i++) {
          await plusBtn.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(200);
        }
      }
    }

    // ── 7. Open date picker & pick date ───────────────────────────────────
    await waitAndClick(page, [
      'input[placeholder*="Depart" i]', 'input[aria-label*="Depart" i]',
      'input[aria-label*="date" i]', '#departDate',
      '[data-testid*="depart"] input', '[class*="date-input"]',
    ]);
    await page.waitForTimeout(800);
    await navigateToDate(page, date);
    await page.waitForTimeout(500);

    // ── 8. Click Search ───────────────────────────────────────────────────
    await waitAndClick(page, [
      'button[type="submit"]:has-text("Search")',
      'button:has-text("Search flights")',
      'button:has-text("Search")',
      '[data-testid="search-submit"]',
      '[class*="search-btn"]',
    ]);

    // ── 9. Wait for results page ──────────────────────────────────────────
    await page.waitForURL(/loadFlightSearchPage|orb_chooseflight|flight-select|redemption/i, {
      timeout: TIMEOUT,
    }).catch(() => {});
    await page.waitForTimeout(3000);

    // ── 10. Scrape results ────────────────────────────────────────────────
    const scraped = await scrapeResults(page, cabinClass);
    result.available    = scraped.available;
    result.saverFlights = scraped.saverFlights;

  } catch (err) {
    console.error(`Error on ${date.format('YYYY-MM-DD')}:`, err.message);
    result.error = err.message;
  } finally {
    await page.close();
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function runSearch(query) {
  const { from, to, dates, cabinClass, passengers } = query;

  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // Non-headless, persistent profile — bypasses Akamai fingerprinting
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--window-position=0,0',
    ],
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport:   { width: 1440, height: 900 },
    locale:     'en-SG',
    timezoneId: 'Asia/Singapore',
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Inject cookies
  if (fs.existsSync(COOKIES_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE));
    await context.addCookies(cookies);
  }

  const allResults = [];

  try {
    // Run one date at a time — reuses the same browser session
    for (const date of dates) {
      const r = await checkDate({ from, to, date, cabinClass, passengers, context })
        .catch(err => ({
          date: date.format('YYYY-MM-DD'),
          available: false,
          saverFlights: [],
          error: err.message,
        }));
      allResults.push(r);
      // Small pause between searches
      if (dates.indexOf(date) < dates.length - 1) {
        await new Promise(res => setTimeout(res, 2000));
      }
    }
  } finally {
    await context.close();
  }

  return allResults;
}

module.exports = { runSearch };
