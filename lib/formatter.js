'use strict';

const dayjs = require('dayjs');

function formatFlight(f) {
  const parts = [`  • ${f.flightNo}`];
  if (f.departs && f.arrives) parts.push(`${f.departs}→${f.arrives}`);
  if (f.miles)    parts.push(`${Number(f.miles).toLocaleString()} miles`);
  parts.push(f.confirmed ? '✅ Confirmed' : '⏳ Waitlist');
  return parts.join(' | ');
}

function formatResults(query, results) {
  const { from, to, cabinClass, passengers } = query;
  const isMultiDate = results.length > 1;

  const lines = [];
  lines.push(`✈️ *SQ Award Search*`);
  lines.push(`${from} → ${to} | ${cabinClass} | ${passengers} pax\n`);

  if (isMultiDate) {
    // Multi-date: group by fare type
    const saverDates     = results.filter(r => r.saverFlights?.length > 0);
    const advantageDates = results.filter(r => r.advantageFlights?.length > 0 && !r.saverFlights?.length);
    const noDates        = results.filter(r => !r.available);

    if (saverDates.length === 0 && advantageDates.length === 0) {
      lines.push('❌ No award availability found across all dates.');
      lines.push('\nTip: Try different dates, cabin, or fewer passengers.');
      return lines.join('\n');
    }

    if (saverDates.length > 0) {
      lines.push(`🟢 *Saver available on ${saverDates.length} date(s):*`);
      for (const r of saverDates) {
        lines.push(`\n📅 *${dayjs(r.date).format('ddd D MMM YYYY')}*`);
        for (const f of r.saverFlights) lines.push(formatFlight(f));
      }
    }

    if (advantageDates.length > 0) {
      lines.push(`\n🟡 *Advantage only on ${advantageDates.length} date(s):*`);
      for (const r of advantageDates) {
        lines.push(`\n📅 *${dayjs(r.date).format('ddd D MMM YYYY')}*`);
        for (const f of r.advantageFlights) lines.push(formatFlight(f));
      }
    }

    if (noDates.length > 0 && noDates.length <= 7) {
      lines.push(`\n🚫 No availability: ${noDates.map(r => dayjs(r.date).format('D MMM')).join(', ')}`);
    } else if (noDates.length > 7) {
      lines.push(`\n🚫 ${noDates.length} dates with no availability`);
    }

  } else {
    // Single date
    const r = results[0];
    const dateLabel = dayjs(r.date).format('ddd D MMM YYYY');
    lines.push(`📅 *${dateLabel}*\n`);

    if (r.error) {
      lines.push(`❌ Search error: ${r.error}`);
      return lines.join('\n');
    }

    if (r.saverFlights?.length > 0) {
      lines.push(`🟢 *Saver seats available:*`);
      for (const f of r.saverFlights) lines.push(formatFlight(f));
    } else if (r.advantageFlights?.length > 0) {
      lines.push(`ℹ️ No Saver seats — showing Advantage instead:`);
      lines.push(`🟡 *Advantage seats available:*`);
      for (const f of r.advantageFlights) lines.push(formatFlight(f));
    } else {
      lines.push('❌ No award seats available on this date.');
      lines.push('\nTip: Try nearby dates or a different cabin class.');
    }
  }

  lines.push(`\n🔗 Book: https://www.singaporeair.com/en_UK/sg/home`);
  return lines.join('\n');
}

function formatError(err, input) {
  return [
    `❌ *Could not parse your search*`,
    err.message || String(err),
    ``,
    `*Format:*`,
    `/search <from> to <to> <date> [class] [N pax]`,
    ``,
    `*Examples:*`,
    `/search SIN to DEL on 19 Dec 2026 business 1 pax`,
    `/search Singapore to Tokyo 10-20 Jul 2026 economy`,
    `/search SIN to LHR 2026-09-01 to 2026-09-05 first`,
  ].join('\n');
}

module.exports = { formatResults, formatError };
