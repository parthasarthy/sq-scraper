# SQ Saver Seat Checker — Telegram Bot

Checks Singapore Airlines KrisFlyer award search for **Saver** seats only (not Advantage, not Waitlist). No AI involved — pure Playwright browser automation + regex parsing.

---

## Setup

### 1. Create your Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow the prompts, get your **bot token**
3. Create a new Telegram group/channel named "SQ Scraper" (or whatever you like)
4. Add your bot to that channel/group as an admin
5. Get the chat ID (see tip below)

> **Getting the chat ID:** Add `@RawDataBot` to your channel, it'll show the chat ID in every message. It'll be a negative number for groups/channels (e.g. `-1001234567890`).

### 2. Install dependencies

```bash
cd sq-scraper
npm install
npm run install-browsers   # installs Playwright's Chromium
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
ALLOWED_CHAT_ID=-1001234567890    # optional: restrict to your SQ scraper channel
```

### 4. Run

```bash
npm start
```

---

## Usage (in Telegram)

```
/search <origin> to <destination> <date or range> [class] [N pax]
```

### Examples

```
/search SIN to LHR on 15 Jun 2025 business 2 pax
/search Singapore to London 10-20 Jul 2025 economy
/search sin to tokyo 2025-08-01 to 2025-08-10 first 1 passenger
/search BKK to SIN 1 Jul 2025 premium economy 3 pax
```

### Inputs

| Input | Examples |
|-------|---------|
| From/To | City name or IATA code: `Singapore`, `SIN`, `London`, `LHR` |
| Date (exact) | `15 Jun 2025`, `2025-06-15` |
| Date (range) | `10-20 Jul 2025`, `10 Jul to 20 Jul 2025`, `2025-08-01 to 2025-08-10` |
| Class | `economy`, `premium economy`, `business`, `first` |
| Passengers | `2 pax`, `3 passengers`, `1 adult` (default: 1) |

---

## How It Works

1. Playwright launches headless Chromium
2. Navigates to `singaporeair.com`, clicks **"Redeem Flights"**
3. Fills in origin, destination, cabin class, passengers, date
4. Submits the search
5. Scrapes results and filters for rows containing **"Saver"** fare type
6. Returns available flights with flight number, times, miles required

Date ranges are checked in batches of 3 (to be polite to SQ's servers), with 2s pauses between batches.

---

## Files

```
sq-scraper/
├── bot.js              — Telegram bot entry point
├── lib/
│   ├── airports.js     — City → IATA lookup table
│   ├── parser.js       — Input parser (regex, no AI)
│   ├── scraper.js      — Playwright scraper
│   └── formatter.js    — Result → Telegram message formatter
├── package.json
├── .env.example
└── README.md
```

---

## Notes & Limitations

- **SQ requires login for award search** — if the site redirects to a login wall, you may need to add cookie injection (see below)
- Date ranges capped at **30 days** to keep searches reasonable
- Results depend on SQ's live website DOM — may need selector updates if SQ redesigns
- Runs headless; add `headless: false` to `scraper.js` temporarily to debug visually

### If login is required

SQ sometimes gates award search behind login. To handle this:
1. Log in manually in a browser
2. Export cookies (e.g. with [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/))
3. Save as `cookies.json` in this folder
4. Uncomment the cookie-loading code in `scraper.js` (see comments)

---

## Running as a service (optional)

```bash
# With pm2
npm install -g pm2
pm2 start bot.js --name sq-scraper
pm2 save
pm2 startup
```
