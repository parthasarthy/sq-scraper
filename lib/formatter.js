'use strict';
/**
 * Format scrape results into Telegram-friendly text.
 * No markdown tables (Telegram doesn't render them well as plain text).
 */

const dayjs = require('dayjs');

function formatResults(query, results) {
  const { from, to, cabinClass, passengers } = query;
  const available = results.filter(r => r.available);
  const dateRange = results.length > 1
    ? `${results[0].date} → ${results[results.length - 1].date}`
    : results[0]?.date || '?';

  const lines = [];
  lines.push(`✈️ *SQ Award Search — Saver Only*`);
  lines.push(`Route: ${from} → ${to} | ${cabinClass} | ${passengers} pax`);
  lines.push(`Period: ${dateRange}`);
  lines.push(`Checked: ${results.length} date(s)\n`);

  if (available.length === 0) {
    lines.push(`❌ No Saver seats found for this search.`);
    lines.push(`\nTip: Try a wider date range or different cabin class.`);
    return lines.join('\n');
  }

  lines.push(`✅ *${available.length} date(s) with Saver availability:*\n`);

  for (const r of available) {
    const dayLabel = dayjs(r.date).format('ddd D MMM YYYY');
    lines.push(`📅 *${dayLabel}*`);
    if (r.saverFlights.length === 0) {
      lines.push(`  • Saver space detected (details unavailable — check SQ site)`);
    }
    for (const f of r.saverFlights) {
      const parts = [`  • ${f.flightNo}`];
      if (f.departs && f.arrives) parts.push(`${f.departs}→${f.arrives}`);
      if (f.miles) parts.push(`${f.miles} miles`);
      if (f.seatsLeft) parts.push(`${f.seatsLeft} seat(s) left`);
      lines.push(parts.join(' | '));
    }
    lines.push('');
  }

  // Unavailable dates (compact)
  const unavailable = results.filter(r => !r.available);
  if (unavailable.length > 0 && unavailable.length <= 10) {
    lines.push(`\n🚫 No Saver on: ${unavailable.map(r => dayjs(r.date).format('D MMM')).join(', ')}`);
  } else if (unavailable.length > 10) {
    lines.push(`\n🚫 ${unavailable.length} dates with no Saver availability.`);
  }

  lines.push(`\n🔗 Book: https://www.singaporeair.com/en_UK/sg/home`);
  return lines.join('\n');
}

/**
 * Format an error message for the user.
 */
function formatError(err, input) {
  return [
    `❌ *Search failed*`,
    err.message || String(err),
    ``,
    `*Usage:*`,
    `/search <origin> to <destination> <date or range> [class] [N pax]`,
    ``,
    `*Examples:*`,
    `/search SIN to LHR on 15 Jun 2025 business 2 pax`,
    `/search Singapore to London 10-20 Jul 2025 economy`,
    `/search sin to tokyo 2025-08-01 to 2025-08-10 first 1 passenger`,
  ].join('\n');
}

module.exports = { formatResults, formatError };
