# HQ: your personal app

One place for your day:

- **Today**: your Apple Calendar schedule, today's habits, sticker orders due this week, and a health snapshot.
- **Calendar**: a week view of your Apple (iCloud) calendars. Repeating events, moved or cancelled ones, and time zones are all handled.
- **Habits**: check habits off each day, see streaks and a 7-day grid, and fill in days you forgot.
- **Orders**: the weekly queue for the sticker business. Each order has a customer, channel (Etsy, wholesale…), designs × quantity, due date, total, and status (To do → Printing → Packed → Shipped). It also shows overdue orders and weekly totals.
- **Health coach**: an AI coach (Claude) that knows your goals, weigh-ins, workouts, habits, and calendar. Tell it "weighed 172.4 today" or "did 30 min of yoga" and it logs it. Ask it to plan workouts around your week, and it can add habits to your tracker. There's also a progress chart and a goals page.

It's a web app. Host it on **Netlify** (works anywhere, nothing to keep running) or run it on **your own computer or home server**. Either way, add it to your iPhone home screen and it behaves like an app. You can move between the two at any time with a backup file.

## Hosting on Netlify

1. Create a site from this repository (or deploy with the Netlify CLI). `netlify.toml` already has the build settings.
2. Under **Site configuration → Environment variables**, add:
   - `APP_PASSWORD`: required. Until it's set, HQ shows a setup screen and no data.
   - `ANTHROPIC_API_KEY`: for the health coach.
   - `ICLOUD_USERNAME` and `ICLOUD_APP_PASSWORD`: optional, for Apple Calendar (see below).
3. **Deploys → Trigger deploy** so the new variables take effect.
4. Open the site on your iPhone in Safari → Share → **Add to Home Screen**.

On Netlify, data is kept in the site's private Netlify Blobs store (`hq`). Saves use version checks, so two changes made at the same moment, such as a habit tap while the coach is logging a workout, never overwrite each other.

## Running on your own computer or server

You need [Node.js](https://nodejs.org) 20 or newer.

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

### Use it on your phone (self-hosted)

- **At home:** run HQ on your Mac, then open `http://<your-mac's-name>.local:3000` on your iPhone over the same Wi-Fi. In Safari, tap Share → **Add to Home Screen**.
- **Anywhere:** install Tailscale on the server and your phone (free), or use Cloudflare Tunnel. Don't open ports on your router. Set `APP_PASSWORD` in `.env` first so only you can open it, and set `TRUST_PROXY=1` when it's behind a proxy.

## Backups and moving

Settings → **Download backup** saves everything (habits, orders, weigh-ins, workouts, goals, coach notes and conversation) as one JSON file. Settings → **Restore backup** loads one back in.

To move HQ between Netlify and your own computer or server: download a backup from the old one, set up the new one, then restore the backup there. When running on your own machine, the data file is `data/db.json`, in the same format as a backup.

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
| `server/db.ts`, `server/storage.ts` | Data store; saves to a local file or to Netlify Blobs, with compare-and-swap writes |
| `server/netlify.ts`, `netlify/functions/api.mts` | Runs the same API as a Netlify Function |
| `shared/` | Types plus habit/weight math used by both sides |
| `src/` | React app (pages in `src/pages`) |
| `test/` | Vitest tests: an Apple-style `.ics` fixture with DST, EXDATE, and moved/cancelled repeats; the coach loop; concurrent saves; the Netlify adapter |

How the coach talks to Claude: the system prompt and tool list are fixed for the whole conversation. Each of your messages is followed by a fresh "context note" (your goals, weight trend, habits, today's calendar, order workload), which is appended as a mid-conversation system message. Earlier messages are never edited, so prompt caching keeps working and long chats stay cheap. When a chat gets very long, it starts fresh automatically. Your goals, logs, and the coach's saved notes carry over.
