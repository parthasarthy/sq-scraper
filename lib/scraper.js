'use strict';
/**
 * SQ Award Seat Scraper — Playwright, no AI.
 *
 * Navigates the Singapore Airlines award search, selects "Saver" only,
 * and returns available flights.
 *
 * Flow:
 *  1. Go to https://www.singaporeair.com/en_UK/sg/home
 *  2. Click "Redeem Flights" tab
 *  3. Fill in origin, destination, date, cabin, pax
 *  4. Submit search
 *  5. Wait for results, filter for "Saver" fare type
 *  6. Return structured results
 */

const { chromium } = require('playwright');
const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);
const path = require('path');
const fs   = require('fs');

const SQ_HOME   = 'https://www.singaporeair.com/en_UK/sg/home';
const TIMEOUT   = 60_000; // ms per action
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');

// Map our cabin class names → SQ display labels
const CABIN_LABELS = {
  Economy:        'Economy',
  PremiumEconomy: 'Premium Economy',
  Business:       'Business',
  First:          'First Class',
};

// ── Cookie helpers ─────────────────────────────────────────────────────────────

function loadCookies() {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}

// ── Calendar navigation ────────────────────────────────────────────────────────

async function navigateCalendarToDate(page, targetDate) {
  const targetMonth = targetDate.month(); // 0-indexed
  const targetYear  = targetDate.year();
  const targetDay   = targetDate.date();

  for (let attempts = 0; attempts < 18; attempts++) {
    const headerText = await page.locator(
      '.calendar-header, .DayPicker-Caption, [class*="month-label"], [class*="CalendarMonth_caption"]'
    ).first().textContent({ timeout: 3000 }).catch(() => '');

    const d = dayjs(headerText.trim(), ['MMMM YYYY', 'MMM YYYY'], true);
    if (d.isValid() && d.month() === targetMonth && d.year() === targetYear) break;

    const headerDate = d.isValid() ? d : dayjs();
    if (headerDate.year() > targetYear ||
       (headerDate.year() === targetYear && headerDate.month() > targetMonth)) {
      await page.locator(
        'button[aria-label*="previous" i], button[aria-label*="back" i], ' +
        '.prev-month, .DayPicker-NavButton--prev, [class*="CalendarMonth_caption"] ~ button:first-of-type'
      ).first().click({ timeout: 3000 }).catch(() => {});
    } else {
      await page.locator(
        'button[aria-label*="next" i], .next-month, .DayPicker-NavButton--next'
      ).first().click({ timeout: 3000 }).catch(() => {});
    }
    await page.waitForTimeout(400);
  }

  // Click the target day cell
  const daySelectors = [
    `[aria-label="${targetDate.format('dddd, MMMM D, YYYY')}"]`,
    `[aria-label="${targetDate.format('D MMMM YYYY')}"]`,
    `[data-date="${targetDate.format('YYYY-MM-DD')}"]`,
    `td:not([class*="disabled"]):not([class*="outside"]):not([class*="blocked"]) ` +
      `abbr:has-text("${targetDay}")`,
    `td:not([class*="disabled"]) span:has-text("${targetDay}")`,
  ];

  for (const sel of daySelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click({ timeout: 5000 }).catch(() => {});
      return;
    }
  }
}

// ── Result scraping ────────────────────────────────────────────────────────────

async function scrapeSaverResults(page, cabinClass) {
  await page.waitForTimeout(3000);

  const flights = [];
  const cabinLabel = (CABIN_LABELS[cabinClass] || 'Economy').toLowerCase();

  try {
    // Wait for any flight result container to appear
    await page.waitForSelector(
      '.flight-result, .award-flight, [class*="flight-option"], ' +
      '[class*="itinerary"], [class*="flight-row"], [class*="result-item"]',
      { timeout: 20_000 }
    ).catch(() => {});

    const rows = page.locator(
      '.flight-result, .award-flight-item, [data-testid*="flight-result"], ' +
      '[class*="flight-option"], [class*="itinerary-item"], [class*="flight-row"]'
    );
    const count = await rows.count();

    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const text = (await row.textContent().catch(() => '')).toLowerCase();

      // Only Saver — explicitly skip Advantage and Waitlist rows
      if (!text.includes('saver')) continue;
      if (text.includes('advantage') && !text.includes('saver')) continue;

      // Cabin class filter
      if (cabinLabel && !text.includes(cabinLabel)) continue;

      const rawText = await row.textContent();

      const flightNoMatch = rawText.match(/\bSQ\s*\d{1,4}\b/i);
      const timeMatch     = rawText.match(/(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})/);
      const milesMatch    = rawText.match(/(\d{1,3}(?:,\d{3})*)\s*(?:miles|pts|mi\b)/i);
      const seatsMatch    = rawText.match(/(\d+)\s*(?:seat[s]?\s*(?:left|available|remaining)?|available)/i);

      flights.push({
        flightNo:  flightNoMatch ? flightNoMatch[0].replace(/\s+/, '') : '?',
        departs:   timeMatch ? timeMatch[1] : null,
        arrives:   timeMatch ? timeMatch[2] : null,
        miles:     milesMatch ? milesMatch[1].replace(/,/g, '') : null,
        seatsLeft: seatsMatch ? seatsMatch[1] : null,
        fareType:  'Saver',
      });
    }
  } catch { /* non-fatal */ }

  return { available: flights.length > 0, saverFlights: flights };
}

// ── Single date check ──────────────────────────────────────────────────────────

async function checkDate({ from, to, date, cabinClass, passengers, context }) {
  const page = await context.newPage();

  try {
    await page.goto(SQ_HOME, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

    // ── Click "Redeem Flights" tab ───────────────────────────────────────────
    await page.locator(
      'button:has-text("Redeem flights"), a:has-text("Redeem flights"), ' +
      'label:has-text("Redeem"), [data-tab="redeem"], ' +
      'li:has-text("Redeem"), span:has-text("Redeem flights")'
    ).first().click({ timeout: TIMEOUT });
    await page.waitForTimeout(1000);

    // ── Origin ───────────────────────────────────────────────────────────────
    const originInput = page.locator(
      'input[placeholder*="From" i], input[aria-label*="From" i], ' +
      'input[aria-label*="Origin" i], input[id*="origin" i], input[id*="from" i], ' +
      '[data-testid*="origin"] input, [data-testid*="from"] input'
    ).first();
    await originInput.click({ timeout: TIMEOUT });
    await originInput.fill('');
    await originInput.type(from, { delay: 80 });
    await page.waitForTimeout(1200);

    await page.locator(
      `[role="listbox"] [role="option"]:has-text("(${from})"), ` +
      `[role="listbox"] [role="option"]:has-text("${from}"), ` +
      `[class*="autocomplete"] li:has-text("${from}"), ` +
      `[class*="dropdown"] li:has-text("${from}")`
    ).first().click({ timeout: 8000 }).catch(() => {});

    // ── Destination ──────────────────────────────────────────────────────────
    const destInput = page.locator(
      'input[placeholder*="To" i], input[aria-label*="To" i], ' +
      'input[aria-label*="Destination" i], input[id*="destination" i], ' +
      'input[id*="to" i], [data-testid*="destination"] input, [data-testid*="to"] input'
    ).first();
    await destInput.click({ timeout: TIMEOUT });
    await destInput.fill('');
    await destInput.type(to, { delay: 80 });
    await page.waitForTimeout(1200);

    await page.locator(
      `[role="listbox"] [role="option"]:has-text("(${to})"), ` +
      `[role="listbox"] [role="option"]:has-text("${to}"), ` +
      `[class*="autocomplete"] li:has-text("${to}"), ` +
      `[class*="dropdown"] li:has-text("${to}")`
    ).first().click({ timeout: 8000 }).catch(() => {});

    // ── Cabin Class ──────────────────────────────────────────────────────────
    const cabinLabel = CABIN_LABELS[cabinClass] || 'Economy';
    const cabinSelect = page.locator(
      'select[name*="cabin" i], select[name*="class" i], ' +
      '[aria-label*="Cabin" i], [aria-label*="Class" i]'
    ).first();
    if (await cabinSelect.count() > 0) {
      await cabinSelect.selectOption({ label: cabinLabel }).catch(() => {});
    } else {
      await page.locator(
        `button:has-text("${cabinLabel}"), label:has-text("${cabinLabel}"), ` +
        `[class*="cabin"] button:has-text("${cabinLabel}")`
      ).first().click({ timeout: 5000 }).catch(() => {});
    }

    // ── Passengers ───────────────────────────────────────────────────────────
    if (passengers > 1) {
      // Try selecting from dropdown first
      const paxSelect = page.locator(
        'select[name*="passenger" i], select[name*="adult" i], select[name*="pax" i]'
      ).first();
      if (await paxSelect.count() > 0) {
        await paxSelect.selectOption({ value: String(passengers) }).catch(() =>
          paxSelect.selectOption({ index: passengers - 1 }).catch(() => {})
        );
      } else {
        const plusBtn = page.locator(
          'button[aria-label*="Add adult" i], button[aria-label*="increase" i], ' +
          '[data-testid*="adult-plus"], [class*="passenger"] button:last-child'
        ).first();
        for (let i = 1; i < passengers; i++) {
          await plusBtn.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(200);
        }
      }
    }

    // ── Date ─────────────────────────────────────────────────────────────────
    const dateInput = page.locator(
      'input[placeholder*="Depart" i], input[aria-label*="Depart" i], ' +
      'input[aria-label*="date" i], input[id*="depart" i], ' +
      '[data-testid*="depart"] input, [data-testid*="date"] input'
    ).first();
    await dateInput.click({ timeout: TIMEOUT });
    await page.waitForTimeout(600);
    await navigateCalendarToDate(page, date);
    await page.waitForTimeout(500);

    // ── Search ───────────────────────────────────────────────────────────────
    await page.locator(
      'button[type="submit"]:has-text("Search"), button:has-text("Search flights"), ' +
      'button:has-text("Search"), [data-testid="search-submit"]'
    ).first().click({ timeout: TIMEOUT });

    await page.waitForTimeout(5000); // SPA results load

    // ── Scrape ───────────────────────────────────────────────────────────────
    const results = await scrapeSaverResults(page, cabinClass);
    return { date: date.format('YYYY-MM-DD'), ...results };

  } finally {
    await page.close();
  }
}

// ── Main: run search across all dates ─────────────────────────────────────────

async function runSearch(query) {
  const { from, to, dates, cabinClass, passengers } = query;
  const BATCH = 2; // concurrent pages (be polite)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });

  const contextOptions = {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
  };

  const context = await browser.newContext(contextOptions);

  // Inject saved cookies if present (for login-gated searches)
  const cookies = loadCookies();
  if (cookies) {
    await context.addCookies(cookies);
    console.log(`Loaded ${cookies.length} cookies from cookies.json`);
  }

  const allResults = [];

  try {
    for (let i = 0; i < dates.length; i += BATCH) {
      const batch = dates.slice(i, i + BATCH);
      const batchResults = await Promise.all(
        batch.map(date =>
          checkDate({ from, to, date, cabinClass, passengers, context })
            .catch(err => ({
              date: date.format('YYYY-MM-DD'),
              available: false,
              saverFlights: [],
              error: err.message,
            }))
        )
      );
      allResults.push(...batchResults);
      if (i + BATCH < dates.length) {
        await new Promise(r => setTimeout(r, 2500));
      }
    }
  } finally {
    await browser.close();
  }

  return allResults;
}

module.exports = { runSearch };
