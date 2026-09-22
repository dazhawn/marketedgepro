# MarketEdgePro — operations runbook

What runs where, what each alert means, and what to do about it. Keep this
current: when an operational fact changes, update it here in the same commit.

Incident history lives in [`docs/incidents/`](incidents/).

---

## System map

| Piece | Where | Notes |
|---|---|---|
| Web app + API + Discord bot + scheduler | **Railway**, service `dazzling-hope` | Public site: **`https://www.investntradesmart.com`** (GoDaddy DNS: `www` CNAME → Railway; the apex 301s to `www`). The Railway URL `https://dazzling-hope-production-53fb.up.railway.app` serves the same app. One container; cron jobs run inside it. |
| Postgres | **Neon**, project *MarketEdgePro*, branch `production` | Launch plan. See [Neon](#neon--the-database). |
| Smart Pullback screener + poller | **SERVER-1** (headless Windows) | Task Scheduler, runs as S4U so it works with nobody logged in. Pushes results to Railway. |
| Smart Investor | **SERVER-1** | FastAPI on `127.0.0.1:8123` (not exposed). Pushes signals to Railway and alerts to Discord directly. |
| Signals in | **TradingView** alerts → `POST /api/signals/webhook` | ~30 alerts. They **expire**, so see the alert-expiry runbook below. |
| Uptime monitoring | **UptimeRobot** | Watches `/api/health/deep` every 5 min, emails on down/up. |

Everything on SERVER-1 pushes outbound. Nothing needs to reach into it, so it has
no port forwarding and no public endpoint.

The old desktop Task Scheduler jobs were **deleted** on 21 Sep 2026. Their XML
definitions are backed up in OneDrive at
`MarketEdgePro App 2026\server-migration\tasks-desktop-backup\`.

---

## Health and monitoring

| Endpoint | Touches the DB? | Use it for |
|---|---|---|
| `GET /api/health` | **No** | Keep-alive only. It stays 200 even when the database is down, so **never** point monitoring at it. |
| `GET /api/health/deep` | Yes, cached | **Monitoring.** 200 `{"db":"ok"}` or 503 `{"db":"down"}`. A healthy result is cached for 25 min and a failure for 2 min, so polling it often can't keep Neon awake. |

**UptimeRobot** monitors `/api/health/deep` every 5 minutes. You don't need
faster checks: the endpoint only probes the database every 25 minutes when healthy.

That monitor watches the **Railway** URL, so it won't notice a broken DNS
record or an expired certificate on `www.investntradesmart.com`. A second
monitor on `https://www.investntradesmart.com/api/health/deep` covers what
members actually load. It shares the same cache, so it adds no database load.

---

## Admin-channel alerts (`DISCORD_ADMIN_CHANNEL_ID`)

Members never see these. What each one means:

| Alert | Meaning | Action |
|---|---|---|
| **Signals posted but not saved** | Members **got** the signal; the database write failed. Lists affected signals, at most one report per 30 min. | The database is down, so check UptimeRobot and Neon. The listed signals are missing from history and the dashboard. |
| **Couldn't confirm today's morning brief** | The brief couldn't read its "sent today" marker because the database was unavailable, so it didn't attempt a send. | Usually nothing. If the brief hadn't already gone out, the next retry (9:30 / 10:30 / 11:30) sends it once the DB is back. Check `#morning-brief`. |
| **Morning brief failed** | The brief started and failed partway through. The error is in the embed. | Read the error. If every symbol failed, suspect the AI provider. |
| **TradingView alerts are about to expire** | Alerts expire within 96 h, or expired within the last 72 h with no webhook since. | Renew them in TradingView (Grok can do this), then refresh the snapshot. |
| **TradingView alert snapshot is out of date** | Some alerts are recorded as expired more than 72 h ago with no webhook since. | Probably renewed already. Refresh the snapshot. |
| **Signal not delivered — channel not configured / unreachable** | A signal classified to a channel whose ID is missing or the bot can't reach. | Fix the `DISCORD_*_CHANNEL_ID` variable or the bot's channel permissions. |

The member-facing notice **"⚠️ Morning Brief Unavailable"** posts to
`#morning-brief`, at most once a day, when the brief genuinely couldn't be generated.

---

## Scheduled jobs

**Railway**, inside the app. All times America/New_York:

| When | Job |
|---|---|
| Mon–Fri 07:55 | Channel access check: confirms the bot can reach each signal channel before the brief. |
| Mon–Fri 08:00 | **Morning brief**. |
| Mon–Fri 09:30, 10:30, 11:30 | Brief retry sweep. Sends only if today's brief hasn't gone out. |
| Daily 09:00 | TradingView alert expiry check. |
| Mon–Fri 16:45 | Signal freshness check: warns if the TradingView feed went quiet. |
| every 4 min | Keep-alive ping to `/api/health` (only when `APP_URL` is set). Doesn't touch the database. |

On startup, if it's a weekday before noon and the brief hasn't gone out, it sends.
The persisted marker stops restarts from double-sending.

**SERVER-1**:

| When | Job |
|---|---|
| every 5 min | **Smart Pullback Poller**: picks up Run Screener requests and runs the daily catch-up. |
| Mon–Fri 08:00 | **Smart Pullback Screener**: runs both screeners and uploads. |
| logon + daily 17:00 | **SmartInvestorService** (the 17:00 trigger restarts it if it died). |
| Mon–Fri 21:15 | Smart Investor daily scan (APScheduler, inside the service). |

---

## Neon — the database

- **Plan:** Launch, pay-as-you-go. $0.106 per CU-hour plus $0.35 per GB-month of storage. The database is ~35 MB.
- **Compute:** autoscaling **0.25 – 1 CU**, **scale to zero after 5 min**. Change these at Projects → MarketEdgePro → Branches → production → Computes → Edit.
- **Spending alert:** emails at $4.
- **Billing period** starts on the 1st. Charges go to the card on file.

### The rule that caused the Sep 2026 outage

> **Nothing may query the database on a schedule shorter than about 10 minutes.**

Neon only stops billing once the database has been idle for 5 minutes, so a
query every 5 minutes keeps it running 24/7. That broke the free tier, and on
Launch it would cost ~$19/month for nothing. Anything that needs frequent
polling must answer from memory. For examples, see `services/screener-queue.ts`
(memory mirror of the queue) and `services/db-health.ts` (25-minute cache).

If the bill rises unexpectedly, check this rule first. In the console,
**Computes** shows whether the database is `SUSPENDED` when idle. If it never
is, something is polling it.

---

## Runbooks

### The database is down

1. Confirm: `/api/health/deep` returns 503, and UptimeRobot should already have emailed.
2. Check the Neon console for quota, billing or status issues ([neonstatus.com](https://neonstatus.com)).
3. **Signals keep reaching members** while it's down. Waitlist signups, the brief and screener uploads fail until it recovers.
4. When it comes back the app reconnects on its own; no redeploy is needed. Check the admin channel's *Signals posted but not saved* reports for what's missing from history.

### Refresh the TradingView alert snapshot

The expiry check reads `server/data/tradingview-alerts.json` because Railway
can't reach TradingView. It is **inlined at build time**, so a refresh needs a
commit and a redeploy.

1. In a Claude session with the **TradingView Remix** Chrome extension connected (Chrome, Default profile), call the tvremix MCP `my_alerts`.
2. Rewrite the file with the live list and set `snapshotAt` to now.
3. Commit, deploy, push.

You don't need to refresh after every renewal. Alerts that fire regularly prove
they're alive through their own webhooks and drop off the warning
automatically. Refreshing matters for **dormant** alerts, which can't vouch for
themselves.

### Rotate the Discord invite

1. Discord → server → **Invite People → Edit invite link**, set **Expire after: Never**, **Max uses: No limit**. Create it from **`#free_preview`**, not a private channel.
2. `railway variables --service dazzling-hope --set "DISCORD_INVITE_URL=https://discord.gg/..."`
3. **Let it redeploy.** Environment variables are read at boot, and `--skip-deploys` stores the value without restarting, so the old invite keeps serving. If you used it, run `railway redeploy --service dazzling-hope --yes`.

### Turn the news relevance filter on or off

The TypeSafe (Jev) filter ranks news before the brief and fails open.

- **On:** `TYPESAFE_API_KEY` set **and** `TYPESAFE_NEWS_FILTER=1`
- **Off:** unset `TYPESAFE_NEWS_FILTER`
- Questions and thresholds: `server/services/typesafe-questions.ts`

### Deploy

1. From the repo directory: `npm run build`, then `railway up --detach --service dazzling-hope`.
2. Check the result: `railway deployment list --service dazzling-hope`. A **FAILED** deploy leaves the previous container serving, so a failure can look like success from outside. Read its logs with `railway logs --deployment <id>`.
3. Other sessions push to the same branch. Run `git pull --ff-only` before committing.

---

## Environment variables (Railway)

**Core:** `DATABASE_URL`, `SESSION_SECRET` (also the webhook and upload secret: SERVER-1 and Smart Investor must use the same value), `DASHBOARD_PASSWORD`, `NODE_ENV`, `APP_URL` (turns on the keep-alive).

**AI:** `AI_PROVIDER` (`anthropic`), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional, defaults to `claude-opus-5`), `ATLASCLOUD_API_KEY` + `ATLAS_MODEL` (automatic failover).

**News:** `ALPHA_VANTAGE_KEY` (free tier is rate-limited; a busy day can exhaust it and fall back to Google News RSS), `TYPESAFE_API_KEY`, `TYPESAFE_NEWS_FILTER`.

**Discord:** `DISCORD_BOT_TOKEN`, `DISCORD_INVITE_URL`, and channel IDs `DISCORD_{FREE,CURRENCY,METALS,CRYPTO,STOCKS,BRIEF,SCREENER,ADMIN}_CHANNEL_ID`.

**Read by code, currently unset (optional):** `SETTINGS_DEFAULT_TIER`, `SETTINGS_CONFIGS_PATH`, `FOUNDING_MAX_SPOTS`, `MYFXBOOK_EMAIL` / `MYFXBOOK_PASSWORD`, `NEWS_API_KEY`, `CHART_IMG_API_KEY`, the phone-notification keys (`PUSHOVER_*`, `TELEGRAM_*`, `NTFY_*`), and the legacy Discord webhook fallbacks (`DISCORD_WEBHOOK_URL`, `DISCORD_FREE_WEBHOOK_URL`, `DISCORD_PAID_WEBHOOK_URL`), which the bot has replaced.

---

## Known open items (as of 21 Sep 2026)

- **Paid Discord channels are publicly readable.** `#metals-alerts`, `#stocks-alerts`, `#crypto-alerts`, `#morning-brief` and `#screener-results` allow `@everyone`, and the homepage invite is public. Lock them behind a Member role before the 31 Oct launch.
- **SERVER-1 boot recovery is untested.** Its tasks run under S4U, but nobody has confirmed they come back after a reboot.
- **TradingView alerts next expire 2–3 Oct**, including **XAUUSD 30m**, the only feed behind `#metals-alerts`.
