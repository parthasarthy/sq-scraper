'use strict';
/**
 * Parse natural-language search requests into structured query objects.
 * Zero AI — pure regex + lookup tables.
 *
 * Strategy:
 *  1. Strip pax count
 *  2. Strip cabin class
 *  3. Find date/range in the remaining text
 *  4. Everything before the date = "<origin> to <destination>"
 *  5. Split on " to " to get origin and destination
 *
 * Examples:
 *   /search SIN to LHR on 15 Jun 2025 business 2 pax
 *   /search Singapore to London 10-20 Jul 2025 economy
 *   /search sin to tokyo 2025-08-01 to 2025-08-10 first 1 passenger
 *   /search BKK to SIN 1 Jul 2025 premium economy 3 pax
 */

const dayjs = require('dayjs');
const customParseFormat = require('dayjs/plugin/customParseFormat');
dayjs.extend(customParseFormat);

const { resolveAirport } = require('./airports');

// ── Class aliases ─────────────────────────────────────────────────────────────
const CLASS_MAP = {
  economy:           'Economy',
  eco:               'Economy',
  'economy class':   'Economy',
  'premium economy': 'PremiumEconomy',
  'premium eco':     'PremiumEconomy',
  premiumeconomy:    'PremiumEconomy',
  pe:                'PremiumEconomy',
  business:          'Business',
  biz:               'Business',
  'business class':  'Business',
  'j class':         'Business',
  first:             'First',
  'first class':     'First',
  suites:            'First',
};

function resolveClass(raw) {
  if (!raw) return 'Economy';
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return CLASS_MAP[key] || 'Economy';
}

// ── Date patterns (ordered most-specific → least-specific) ───────────────────
// Each entry: { regex, parse(match) → [dayjs, dayjs] or [dayjs] }
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const DATE_PATTERNS = [
  // ISO range: 2025-08-01 to 2025-08-10
  {
    re: /(\d{4}-\d{2}-\d{2})\s*to\s*(\d{4}-\d{2}-\d{2})/i,
    parse: (m) => [dayjs(m[1], 'YYYY-MM-DD', true), dayjs(m[2], 'YYYY-MM-DD', true)],
  },
  // ISO single: 2025-08-01
  {
    re: /(\d{4}-\d{2}-\d{2})/,
    parse: (m) => [dayjs(m[1], 'YYYY-MM-DD', true)],
  },
  // "10-20 Jun 2025" or "10-20 Jun"
  {
    re: new RegExp(`(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})\\s+(${MONTH})\\s*(\\d{4})?`, 'i'),
    parse: (m) => {
      const yr = m[4] || autoYear();
      return [
        parseNamedDate(`${m[1]} ${m[3]} ${yr}`),
        parseNamedDate(`${m[2]} ${m[3]} ${yr}`),
      ];
    },
  },
  // "10 Jun to 20 Jun 2025" or "10 Jun 2025 to 20 Jun 2025"
  {
    re: new RegExp(`(\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?)\\s*(?:to|-)\\s*(\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?)`, 'i'),
    parse: (m) => [parseNamedDate(m[1]), parseNamedDate(m[2])],
  },
  // "15 Jun 2025" or "15 June 2025"
  {
    re: new RegExp(`(\\d{1,2}\\s+${MONTH}\\s+\\d{4})`, 'i'),
    parse: (m) => [parseNamedDate(m[1])],
  },
  // "15 Jun" or "15 June" (no year)
  {
    re: new RegExp(`(\\d{1,2}\\s+${MONTH})(?!\\s+\\d)`, 'i'),
    parse: (m) => {
      const yr = autoYear();
      return [parseNamedDate(`${m[1]} ${yr}`)];
    },
  },
];

function autoYear() {
  return dayjs().year().toString();
}

function parseNamedDate(str) {
  const s = str.trim();
  const fmts = [
    'D MMM YYYY', 'DD MMM YYYY',
    'D MMMM YYYY', 'DD MMMM YYYY',
  ];
  for (const fmt of fmts) {
    const d = dayjs(s, fmt, true);
    if (d.isValid()) return d;
  }
  return null;
}

function expandRange(d1, d2) {
  if (!d1 || !d2) return d1 ? [d1] : [];
  const start = d1.isBefore(d2) ? d1 : d2;
  const end   = d1.isBefore(d2) ? d2 : d1;
  const days  = [];
  let cur = start;
  while (!cur.isAfter(end)) {
    days.push(cur);
    cur = cur.add(1, 'day');
  }
  return days;
}

/**
 * Main parser.
 * Returns { from, to, dates, cabinClass, passengers } or throws a user-friendly Error.
 */
function parseQuery(text) {
  let raw = text.replace(/^\/search\s*/i, '').trim();

  // ── 1. Extract pax ────────────────────────────────────────────────────────
  let passengers = 1;
  const paxMatch = raw.match(/\b(\d+)\s*(?:pax|passengers?|adults?)\b/i);
  if (paxMatch) {
    passengers = parseInt(paxMatch[1], 10);
    raw = raw.slice(0, paxMatch.index) + raw.slice(paxMatch.index + paxMatch[0].length);
    raw = raw.trim();
  }

  // ── 2. Extract cabin class ────────────────────────────────────────────────
  const classRe = /\b(premium economy|premiumeconomy|premium eco|economy class|economy|eco|business class|business|biz|j class|first class|first|suites|pe)\b/i;
  const classMatch = raw.match(classRe);
  const cabinClass = resolveClass(classMatch ? classMatch[1] : null);
  if (classMatch) {
    raw = raw.slice(0, classMatch.index) + raw.slice(classMatch.index + classMatch[0].length);
    raw = raw.trim();
  }

  // ── 3. Find date/range in the remaining text ──────────────────────────────
  let dates = [];
  let dateMatchStr = '';
  let dateMatchIndex = -1;

  for (const pat of DATE_PATTERNS) {
    const m = raw.match(pat.re);
    if (m) {
      const parsed = pat.parse(m);
      const valid  = parsed.filter(Boolean).filter(d => d.isValid());
      if (valid.length === 0) continue;

      dates = valid.length === 2 ? expandRange(valid[0], valid[1]) : [valid[0]];
      if (dates.length === 0) continue;

      dateMatchStr   = m[0];
      dateMatchIndex = m.index;
      break;
    }
  }

  if (dates.length === 0) {
    throw new Error(
      'Could not parse date. Try:\n' +
      '• `15 Jun 2025`\n' +
      '• `10-20 Jul 2025`\n' +
      '• `2025-08-01 to 2025-08-10`'
    );
  }

  // ── 4. Extract route (everything before the date match) ───────────────────
  const routePart = raw.slice(0, dateMatchIndex).trim().replace(/\s+on\s*$/i, '').trim();

  // Split on " to " — but only the FIRST occurrence
  const toIdx = routePart.search(/\s+to\s+/i);
  if (toIdx === -1) {
    throw new Error(
      'Could not find route separator "to".\n' +
      'Use: `/search <origin> to <destination> <date>`'
    );
  }

  const fromRaw = routePart.slice(0, toIdx).trim();
  const toRaw   = routePart.slice(toIdx).replace(/^\s*to\s*/i, '').trim();

  // ── 5. Resolve IATA codes ─────────────────────────────────────────────────
  const from = resolveAirport(fromRaw);
  const to   = resolveAirport(toRaw);

  if (!from) throw new Error(`Unknown origin: "${fromRaw}"\nTry an IATA code (e.g. SIN) or city name (e.g. Singapore).`);
  if (!to)   throw new Error(`Unknown destination: "${toRaw}"\nTry an IATA code (e.g. LHR) or city name (e.g. London).`);

  return { from, to, dates, cabinClass, passengers };
}

module.exports = { parseQuery };
