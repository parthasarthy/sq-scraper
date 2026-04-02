'use strict';
/**
 * Parse natural-language search requests into structured query objects.
 * Zero AI — pure regex + lookup tables.
 *
 * Supported formats (all case-insensitive):
 *   /search <from> to <to> on <date> [<class>] [<n> pax]
 *   /search <from> to <to> <date range> [<class>] [<n> pax]
 *
 * Examples:
 *   /search SIN to LHR on 15 Jun 2024 business 2 pax
 *   /search Singapore to London 10-20 Jul 2024 economy
 *   /search sin to tokyo 2024-08-01 to 2024-08-10 first 1 passenger
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

const { resolveAirport } = require('./airports');

// ── Class aliases ─────────────────────────────────────────────────────────────
const CLASS_MAP = {
  economy:          'Economy',
  eco:              'Economy',
  'economy class':  'Economy',
  'premium economy':'PremiumEconomy',
  'premium eco':    'PremiumEconomy',
  premiumeconomy:   'PremiumEconomy',
  pe:               'PremiumEconomy',
  business:         'Business',
  biz:              'Business',
  'business class': 'Business',
  'j class':        'Business',
  first:            'First',
  'first class':    'First',
  suites:           'First',
};

function resolveClass(raw) {
  if (!raw) return 'Economy';
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return CLASS_MAP[key] || 'Economy';
}

// ── Date parsing ──────────────────────────────────────────────────────────────
const DATE_FORMATS = [
  'D MMM YYYY', 'DD MMM YYYY',
  'D MMMM YYYY', 'DD MMMM YYYY',
  'YYYY-MM-DD',
  'DD/MM/YYYY', 'D/M/YYYY',
  'DD-MM-YYYY',
  'D MMM', 'DD MMM',       // year defaults to current
  'D MMMM', 'DD MMMM',
];

function parseDate(str) {
  if (!str) return null;
  const s = str.trim();
  for (const fmt of DATE_FORMATS) {
    const d = dayjs(s, fmt, true);
    if (d.isValid()) {
      // If no year was parsed, assume current or next occurrence
      if (!fmt.includes('YYYY') && !fmt.includes('YY')) {
        const withYear = dayjs(`${s} ${dayjs().year()}`, fmt + ' YYYY', true);
        if (withYear.isValid()) {
          return withYear.isBefore(dayjs()) ?
            withYear.add(1, 'year') : withYear;
        }
      }
      return d;
    }
  }
  return null;
}

/**
 * Parse the text payload (everything after /search).
 * Returns { from, to, dates: [DayJS, ...], cabinClass, passengers } or throws.
 */
function parseQuery(text) {
  const raw = text.replace(/^\/search\s*/i, '').trim();

  // ── 1. Extract pax count ──────────────────────────────────────────────────
  let passengers = 1;
  const paxMatch = raw.match(/\b(\d+)\s*(?:pax|passenger[s]?|adult[s]?)\b/i);
  if (paxMatch) passengers = parseInt(paxMatch[1], 10);
  let rest = raw.replace(/\b\d+\s*(?:pax|passenger[s]?|adult[s]?)\b/i, '').trim();

  // ── 2. Extract cabin class ────────────────────────────────────────────────
  const classPattern = new RegExp(
    `\\b(premium economy|premiumeconomy|premium eco|economy class|economy|eco|` +
    `business class|business|biz|j class|first class|first|suites|pe)\\b`, 'i'
  );
  const classMatch = rest.match(classPattern);
  const cabinClass = resolveClass(classMatch ? classMatch[1] : null);
  if (classMatch) rest = rest.replace(classMatch[0], '').trim();

  // ── 3. Split from / to ────────────────────────────────────────────────────
  // Pattern: <origin> to <destination> <...dates...>
  const routeMatch = rest.match(/^(.+?)\s+to\s+(.+?)(?:\s+(?:on\s+)?(\d.+|[a-z].*))?$/i);
  if (!routeMatch) throw new Error('Could not parse route. Use format: `<origin> to <destination> <date>`');

  let fromRaw = routeMatch[1].trim();
  // The "to <destination>" part may bleed into date; we handle that below
  let toAndDate = routeMatch[2].trim() + (routeMatch[3] ? ' ' + routeMatch[3].trim() : '');

  // ── 4. Extract dates from the tail of toAndDate ───────────────────────────
  // Date range: 10-20 Jul 2024 | 10 Jul - 20 Jul 2024 | 2024-08-01 to 2024-08-10
  const DATE_RANGE_PATTERNS = [
    // "10-20 Jul 2024" or "10-20 Jul"
    /(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec\w*)\s*(\d{4})?/i,
    // "10 Jul to 20 Jul 2024" or "10 Jul - 20 Jul"
    /(\d{1,2}\s+\w+\s*\d{0,4})\s*(?:to|-|–)\s*(\d{1,2}\s+\w+\s*\d{0,4})/i,
    // ISO range: "2024-08-01 to 2024-08-10"
    /(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})/i,
  ];

  let dates = [];
  let dateStr = '';

  // Try range patterns
  let matched = false;
  for (const pat of DATE_RANGE_PATTERNS) {
    const m = toAndDate.match(pat);
    if (m) {
      matched = true;
      dateStr = m[0];
      // Parse the two ends
      if (pat === DATE_RANGE_PATTERNS[0]) {
        // "10-20 Jul 2024"
        const year = m[4] ? m[4] : dayjs().year().toString();
        const d1 = parseDate(`${m[1]} ${m[3]} ${year}`);
        const d2 = parseDate(`${m[2]} ${m[3]} ${year}`);
        if (d1 && d2) {
          // Enumerate each day in range
          let cur = d1;
          while (!cur.isAfter(d2)) { dates.push(cur); cur = cur.add(1, 'day'); }
        }
      } else {
        // Two explicit date strings
        const d1 = parseDate(m[1].trim());
        const d2 = parseDate(m[2].trim());
        if (d1 && d2) {
          let cur = d1.isBefore(d2) ? d1 : d2;
          const end = d1.isBefore(d2) ? d2 : d1;
          while (!cur.isAfter(end)) { dates.push(cur); cur = cur.add(1, 'day'); }
        }
      }
      break;
    }
  }

  // Single date
  if (!matched) {
    // "on 15 Jun 2024" or just "15 Jun 2024"
    const singleMatch = toAndDate.match(
      /(?:on\s+)?(\d{1,2}\s+\w+\s+\d{4}|\d{1,2}\s+\w+|\d{4}-\d{2}-\d{2})/i
    );
    if (singleMatch) {
      dateStr = singleMatch[0];
      const d = parseDate(singleMatch[1]);
      if (d) dates.push(d);
    }
  }

  // Strip the dateStr from toAndDate to isolate destination
  let toRaw = toAndDate.replace(dateStr, '').replace(/\s*on\s*/i, '').trim();

  // ── 5. Resolve IATA codes ─────────────────────────────────────────────────
  const from = resolveAirport(fromRaw);
  const to   = resolveAirport(toRaw);

  if (!from) throw new Error(`Unknown origin: "${fromRaw}". Try an IATA code (e.g. SIN, LHR) or city name.`);
  if (!to)   throw new Error(`Unknown destination: "${toRaw}". Try an IATA code (e.g. LHR) or city name.`);
  if (dates.length === 0) throw new Error('Could not parse date. Try: "15 Jun 2025" or "10-20 Jul 2025".');

  return { from, to, dates, cabinClass, passengers };
}

module.exports = { parseQuery };
