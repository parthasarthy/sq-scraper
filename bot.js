'use strict';
/**
 * SQ Saver Seat Bot
 * ─────────────────
 * A Telegram bot that checks Singapore Airlines award search for
 * SAVER seats only. Zero AI — pure Playwright + regex.
 *
 * Commands:
 *   /start     — welcome + usage
 *   /help      — usage instructions
 *   /search    — run a seat check
 *
 * Environment variables (see .env.example):
 *   TELEGRAM_BOT_TOKEN   — required
 *   ALLOWED_CHAT_ID      — optional, restrict to one chat
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { parseQuery }    = require('./lib/parser');
const { runSearch }     = require('./lib/scraper');
const { formatResults, formatError } = require('./lib/formatter');

// ── Validate env ──────────────────────────────────────────────────────────────
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set. Create a .env file.');
  process.exit(1);
}

const ALLOWED_CHAT = process.env.ALLOWED_CHAT_ID
  ? String(process.env.ALLOWED_CHAT_ID)
  : null;

const bot = new TelegramBot(TOKEN, { polling: true });

// ── Guard: only respond in the configured channel if set ──────────────────────
function isAllowed(chatId) {
  return !ALLOWED_CHAT || String(chatId) === ALLOWED_CHAT;
}

// ── Active search tracker (one concurrent search per chat) ────────────────────
const activeSearches = new Set();

// ── /start & /help ────────────────────────────────────────────────────────────
const HELP_TEXT = `
✈️ *SQ Saver Seat Checker*

I search Singapore Airlines KrisFlyer award availability for *Saver* seats only — not Advantage, not Waitlist.

*Command:*
\`/search <from> to <to> <date or range> [class] [N pax]\`

*Inputs:*
• *From / To* — city name or IATA code (e.g. Singapore, SIN, London, LHR)
• *Date* — exact date or range:
  \`15 Jun 2025\`
  \`10-20 Jul 2025\`
  \`2025-08-01 to 2025-08-10\`
• *Class* — economy, premium economy, business, first (default: economy)
• *Pax* — number of passengers, e.g. \`2 pax\` (default: 1)

*Examples:*
\`/search SIN to LHR on 15 Jun 2025 business 2 pax\`
\`/search Singapore to Tokyo 10-20 Jul 2025 economy\`
\`/search sin to london 2025-09-01 to 2025-09-05 first 1 passenger\`

ℹ️ Date ranges are capped at 30 days to keep searches fast.
`.trim();

bot.onText(/^\/(start|help)/, (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  bot.sendMessage(msg.chat.id, HELP_TEXT, { parse_mode: 'Markdown' });
});

// ── /search ───────────────────────────────────────────────────────────────────
bot.onText(/^\/search(.*)$/i, async (msg, match) => {
  const chatId  = msg.chat.id;
  const msgId   = msg.message_id;

  if (!isAllowed(chatId)) return;

  // Prevent duplicate concurrent searches per chat
  if (activeSearches.has(chatId)) {
    return bot.sendMessage(chatId,
      '⏳ A search is already in progress for this chat. Please wait.',
      { reply_to_message_id: msgId }
    );
  }

  const input = match[1]?.trim() || '';
  if (!input) {
    return bot.sendMessage(chatId, HELP_TEXT, { parse_mode: 'Markdown', reply_to_message_id: msgId });
  }

  let query;
  try {
    query = parseQuery(`/search ${input}`);
  } catch (err) {
    return bot.sendMessage(chatId, formatError(err, input), {
      parse_mode: 'Markdown',
      reply_to_message_id: msgId,
    });
  }

  // Cap range at 30 days
  if (query.dates.length > 30) {
    query.dates = query.dates.slice(0, 30);
  }

  // Acknowledge
  const ackMsg = await bot.sendMessage(chatId,
    `🔍 Searching for *Saver* seats...\n` +
    `${query.from} → ${query.to} | ${query.cabinClass} | ${query.passengers} pax\n` +
    `${query.dates.length} date(s) to check. This may take a minute ⏳`,
    { parse_mode: 'Markdown', reply_to_message_id: msgId }
  );

  activeSearches.add(chatId);

  try {
    const results = await runSearch(query);
    const reply   = formatResults(query, results);

    // Delete the "searching..." message and send final result
    await bot.deleteMessage(chatId, ackMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, reply, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_to_message_id: msgId,
    });
  } catch (err) {
    console.error('Search error:', err);
    await bot.deleteMessage(chatId, ackMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId,
      `❌ Search encountered an error:\n${err.message}\n\nPlease try again.`,
      { reply_to_message_id: msgId }
    );
  } finally {
    activeSearches.delete(chatId);
  }
});

// ── Catch unhandled /commands ─────────────────────────────────────────────────
bot.onText(/^\/[a-z]+/i, (msg) => {
  if (!isAllowed(msg.chat.id)) return;
  if (/^\/(start|help|search)/i.test(msg.text || '')) return;
  bot.sendMessage(msg.chat.id, `Unknown command. Type /help for usage.`);
});

// ── Error handling ────────────────────────────────────────────────────────────
bot.on('polling_error', (err) => console.error('Polling error:', err.message));
bot.on('error', (err) => console.error('Bot error:', err.message));

console.log('🛫 SQ Saver Bot is running...');
