# Incident: Neon database quota exhausted — 21 September 2026

**Status:** resolved · **Severity:** high: signals, signups and the brief were all affected

## Summary

MarketEdgePro's Neon Postgres database went over its free-tier compute quota and
refused every query. The public site stayed up, but every feature that needs the
database failed: storing TradingView signals (and, because of a second bug,
posting them to Discord), waitlist signups, the morning brief, and screener
uploads from SERVER-1.

The cause was ours. A poll added during the server migration queried the
database every 5 minutes, and Neon only stops billing compute after 5 minutes
of inactivity, so the database never went to sleep.

Service came back when the project was moved to Neon's paid **Launch** plan. The
same day, five changes went into production so that the next outage costs much
less, gets noticed within minutes, and cannot stop the server from starting.

## Timeline (ET)

| When | What happened |
|---|---|
| ~22 Aug | During the SERVER-1 migration, the screener poller's interval changed from 1 hour to 5 minutes so the dashboard's **Run Screener** button would respond quickly. Each poll ran a database query. From here on the database never idled. |
| 21 Sep 08:00 | Morning brief posted normally. |
| between 08:00 and 11:30 | Free-tier quota (100 CU-hours/month) ran out. The exact time is unknown. |
| 11:30 | The brief's retry sweep couldn't read its "already sent" marker and posted **"Morning brief failed"** to the admin channel. The alert was misleading: members had received the brief at 08:00. |
| afternoon | Investigation showed the database itself was refusing queries (`exceeded the quota`), with a quota error on `/api/waitlist/count`. |
| ~14:38 | A deploy with the first fix **failed**. The new container crashed on boot (see root cause 2). The old container kept serving only because it had started before the quota ran out. |
| ~15:22 | Boot fix deployed; new containers start even with the database down. |
| afternoon | Project upgraded to the Neon **Launch** plan. Database, signups, signals and screener endpoints all confirmed working. |
| evening | Health monitoring, the brief-marker fix, and signals-before-save deployed. Neon autoscaling capped at 1 CU. |

## Impact

- **Waitlist signups failed** on the public landing page, returning errors to prospects.
- **TradingView signals were not posted to Discord** while the database was down (root cause 3). No signals are stored after Fri 19 Sep 01:15 UTC, but no webhooks appear in the logs we checked, so we don't know how many, if any, were lost.
- **Screener uploads** from SERVER-1 and **Smart Investor signal storage** failed.
- **The morning brief** was not affected on the day (it had already gone out), but a false failure alert was raised.
- Smart Investor's **own Discord alerts kept working**: they post through a direct webhook that doesn't use this database.

## Root causes

**1. A 5-minute poll kept the database awake permanently.**
`GET /api/screener/pending` ran a query every time SERVER-1 polled it, every 5
minutes. Neon suspends compute after 5 idle minutes, so it never suspended.
That is ~720 hours a month; even at the minimum 0.25 CU size it comes to about
180 CU-hours, well over the free plan's 100.

**2. The server could not start while the database was unreachable.**
`seedDatabase()` runs at the end of `registerRoutes()`. Its `CREATE TABLE`
was guarded but `storage.getWatchlist()` was not. When that threw,
`httpServer.listen()` was never reached, so the container never bound its port,
failed Railway's healthcheck, and was stopped. Any restart during the outage
would have taken down the whole site, landing page included.

**3. Signals were saved before they were posted.**
In the webhook's background task, `storage.createSignal()` was the first
`await`, outside every inner `try`. When it threw, execution skipped straight to
the outer `catch`, and none of the three Discord posts ran.

**4. The health check never looked at the database.**
`GET /api/health` returns a constant and never touches Postgres. It stayed
**200 OK** for the whole outage, so any monitoring pointed at it would have
reported the service as healthy.

**5. The brief guessed when it couldn't read its own state.**
When the "already sent today" marker was unreadable, `runMorningBrief` logged
*"proceeding anyway"*, re-ran the brief, failed on the database, and reported
the brief as failed, although members already had it.

## Fixes

| Commit | Change |
|---|---|
| `ac81bbc` | `/api/screener/pending` answers from an in-memory mirror of the queue (`services/screener-queue.ts`). The poller keeps its 5-minute interval, and the database only wakes for a real Run Screener click. Tests: 288 polls (one day) = 1 database read. |
| `b6a68f3` | `seedDatabase()` is fully guarded. Reproduced locally against the over-quota database: the old build exited after 8 s without binding a port, and the new one served in 3 s. |
| `e7cd417` | New **`GET /api/health/deep`** runs a real query and returns 503 when the database is down (`services/db-health.ts`). A healthy result is cached for 25 minutes, so monitoring cannot keep the database awake. Also: an unreadable brief marker now reports *"Couldn't confirm today's morning brief"* (admin channel only) and skips the attempt instead of guessing. |
| `a78b48b` | Signals are **posted first and saved afterwards**, both raw and AI-analysed. A database failure now loses only the history. Unsaved signals are reported at most once per 30 minutes (`services/unsaved-signals.ts`). |

**Configuration changes, outside the repo:**
- Neon plan: Free → **Launch** (pay-as-you-go, $0.106/CU-hour).
- Neon compute: **scale to zero on** (5 min), **autoscaling capped at 0.25–1 CU** (was 0.25–8).
- Neon spending notification at **$4**.
- **UptimeRobot** HTTP monitor on `/api/health/deep`, every 5 minutes, alerting by email. A test alert was confirmed delivered to the inbox.

## What an outage costs now

If the database goes down again, members still receive every live signal and
the site keeps serving. You lose the stored history and dashboard entries for
that window. You'll get an UptimeRobot email within about 5 minutes and a
*"Signals posted but not saved"* message listing what's missing.

Waitlist signups, the brief and screener uploads still need the database and
will still fail for as long as it's down.

## Lessons

- **Anything that polls the database on a schedule shorter than ~10 minutes defeats scale-to-zero.** This is now a hard rule; see `docs/operations.md`. It applies to monitors too, which is why the deep health check caches.
- **Startup must not depend on optional work.** Seeding, warm-up and migrations must be guarded, or a sick dependency becomes a total outage on the next restart.
- **Post first, persist second** for anything members are waiting on.
- **A health check that doesn't test the real dependency is worse than none**: it reports all-clear during an outage.
- **Alert on what you know, not what you assume.** "Couldn't confirm" is honest. "Failed" was a guess, and it was wrong.
