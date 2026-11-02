# HQ: your personal app

One place for your day:

- **Today**: your Apple Calendar schedule, today's habits, sticker orders due this week, and a health snapshot.
- **Calendar**: a week view of your Apple (iCloud) calendars. Repeating events, moved or cancelled ones, and time zones are all handled.
- **Habits**: check habits off each day, see streaks and a 7-day grid, and fill in days you forgot.
- **Orders**: the weekly queue for the sticker business. Each order has a customer, channel (Etsy, wholesale…), designs × quantity, due date, total, and status (To do → Printing → Packed → Shipped). It also shows overdue orders and weekly totals.
- **Health coach**: an AI coach (Claude) that knows your goals, weigh-ins, workouts, habits, and calendar. Tell it "weighed 172.4 today" or "did 30 min of yoga" and it logs it. Ask it to plan workouts around your week, and it can add habits to your tracker. There's also a progress chart and a goals page.

It's a web app you run on your own computer. Add it to your iPhone home screen and it behaves like an app. All data stays in one file (`data/db.json`) on that computer.

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
cp .env.example .env      # then fill in the keys you want (see below)
npm run build
npm start                 # → http://localhost:3000
```

### Turn on the health coach

1. Create an API key at [console.anthropic.com](https://console.anthropic.com/settings/keys).
2. Put it in `.env`: `ANTHROPIC_API_KEY=sk-ant-...`
3. Restart HQ.

The coach uses Claude Opus 5.5 by default. If Claude's safety filters decline a message, the request automatically falls back to another Claude model (`fallbacks: "default"`), so you get an answer rather than a dead end. It follows safe-loss guidelines (about 0.5–1% of body weight per week, no crash diets) and points you to a doctor for medical issues.

### Connect Apple Calendar

There are two ways. Use either one or both.

**A. Your whole iCloud account (private, recommended).**
1. Go to [account.apple.com](https://account.apple.com) → Sign-In and Security → App-Specific Passwords, and create one called "HQ".
2. In `.env`, set `ICLOUD_USERNAME` (your Apple ID email) and `ICLOUD_APP_PASSWORD`.
3. Restart HQ. Every iCloud calendar shows up, in its own color. Nothing is made public.

**B. A calendar link.** On iPhone, open Calendar → Calendars → ⓘ next to a calendar, turn on **Public Calendar**, then **Share Link**. Paste the link into HQ under Settings → Calendar links. This also works for Google, Outlook, or any `.ics` feed. Anyone who has a public link can see that calendar.

Calendars refresh every 5 minutes. The refresh button on the Calendar page pulls changes immediately.

### Use it on your phone

- **At home:** run HQ on your Mac, then open `http://<your-mac's-name>.local:3000` on your iPhone over the same Wi-Fi. In Safari, tap Share → **Add to Home Screen**.
- **Anywhere:** put it behind an HTTPS tunnel such as Tailscale or Cloudflare Tunnel, or host it on a small server with a persistent disk. Set `APP_PASSWORD` in `.env` first so only you can open it, and set `TRUST_PROXY=1` when it's behind a proxy.

## Backups

Settings → **Download backup** saves everything as one JSON file. You can also copy `data/db.json`.

## Development

```bash
npm run dev        # API on :3000 + Vite dev server with hot reload on :5173
npm test           # unit + API tests
npm run typecheck
```

How it's put together:

| Path | What's there |
|---|---|
| `server/app.ts` | REST API (habits, orders, health, calendar, coach) |
| `server/calendar/` | `.ics` parsing and recurrence expansion (`ical.js`), iCloud CalDAV (`tsdav`) |
| `server/coach/` | Claude coach: system prompt, per-message context, tools, streaming loop |
| `server/db.ts` | JSON file store |
| `shared/` | Types plus habit/weight math used by both sides |
| `src/` | React app (pages in `src/pages`) |
| `test/` | Vitest tests, including an Apple-style `.ics` fixture with DST, EXDATE, and moved/cancelled repeats |

How the coach talks to Claude: the system prompt and tool list are fixed for the whole conversation. Each of your messages is followed by a fresh "context note" (your goals, weight trend, habits, today's calendar, order workload), which is appended as a mid-conversation system message. Earlier messages are never edited, so prompt caching keeps working and long chats stay cheap. When a chat gets very long, it starts fresh automatically. Your goals, logs, and the coach's saved notes carry over.
