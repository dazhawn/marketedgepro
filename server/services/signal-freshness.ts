/**
 * Is the TradingView feed still alive?
 *
 * WHY THIS EXISTS
 * ---------------
 * Every reliability control in this system protects the daily scan: the
 * watchdog, the startup catch-up, the last-scan marker, the channel preflight.
 * The daily scan produces 127 of 1,108 signals.
 *
 * The other 981 — 89% — arrive from indicator alerts configured on
 * tradingview.com. They have no schedule to miss and no marker to go stale, so
 * when one expires, gets deleted, is edited badly, or has its webhook URL
 * changed, signals simply stop. Nothing anywhere notices, and the silence is
 * indistinguishable from a quiet market.
 *
 * It has already happened: between 18 and 25 June 2026 the feed was silent for
 * 156 hours straight — four consecutive market days — and nobody knew until
 * this check was written two months later.
 *
 * CHOOSING THE THRESHOLD
 * ----------------------
 * Measured over all 981 TradingView signals, the gap between consecutive
 * signals is wildly skewed: median 3.4 minutes, p90 2.5 hours, p95 11.6 hours.
 * Signals arrive in bursts, so "nothing for N hours" is a bad rule at every
 * value of N — small N fires constantly, large N sleeps through outages.
 *
 * Worse, the six longest *normal* gaps are all Friday-to-Monday, 56 to 95
 * hours. Any wall-clock rule has to special-case the weekend anyway.
 *
 * So this counts MARKET DAYS instead. Two consecutive weekdays with no
 * TradingView signal at all is the rule: it would have caught the June outage
 * on day two, and it would not have fired on either of the isolated
 * zero-signal weekdays in the last fortnight (21 and 27 August), because
 * neither had a quiet day next to it.
 */

// storage is imported lazily inside the reporting function: it opens a DB
// connection at module load, and the assessment logic below is pure and must
// stay testable without one.
import { reportIssue } from "./discord-bot";
import type { Signal } from "@shared/schema";

/** Consecutive quiet market days before we say something. See header. */
export const QUIET_MARKET_DAYS = 2;

/** Alert at most once a day, so a long outage doesn't spam #admin nightly. */
const LAST_ALERT_KEY = "signal_freshness_last_alert_date";

export interface FreshnessReport {
  lastSignalAt: Date | null;
  /** Complete market days since the last signal, today excluded. */
  quietMarketDays: number;
  stale: boolean;
  counts: { h24: number; d7: number; d30: number };
  totalTradingView: number;
}

/** A signal the daily scan did not produce. Anything else came from TradingView. */
export function isTradingViewSignal(s: Pick<Signal, "signalType">): boolean {
  return String(s.signalType ?? "").trim() !== "Smart Investor";
}

/** Calendar date in US market time, as YYYY-MM-DD. */
export function marketDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function isWeekend(iso: string): boolean {
  // Parsed as UTC midnight; only the day-of-week matters and that is stable.
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Complete market days between the last signal and now, excluding today —
 * today is still in progress, so a quiet morning is not evidence of anything.
 */
export function quietMarketDaysSince(last: Date, now: Date): number {
  const lastDay = marketDate(last);
  const today = marketDate(now);
  let count = 0;
  const cursor = new Date(`${lastDay}T12:00:00Z`);
  for (let i = 0; i < 400; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const iso = cursor.toISOString().slice(0, 10);
    if (iso >= today) break;      // stop before today
    if (!isWeekend(iso)) count++;
  }
  return count;
}

export function assessFreshness(signals: Signal[], now: Date = new Date()): FreshnessReport {
  const tv = signals
    .filter(isTradingViewSignal)
    .map(s => ({ s, at: s.receivedAt ? new Date(s.receivedAt as any) : null }))
    .filter((x): x is { s: Signal; at: Date } => !!x.at && !isNaN(x.at.getTime()));

  const since = (h: number) => {
    const cut = now.getTime() - h * 3600_000;
    return tv.filter(x => x.at.getTime() >= cut).length;
  };

  if (!tv.length) {
    return {
      lastSignalAt: null, quietMarketDays: Infinity, stale: true,
      counts: { h24: 0, d7: 0, d30: 0 }, totalTradingView: 0,
    };
  }

  const lastSignalAt = new Date(Math.max(...tv.map(x => x.at.getTime())));
  const quietMarketDays = quietMarketDaysSince(lastSignalAt, now);

  return {
    lastSignalAt,
    quietMarketDays,
    stale: quietMarketDays >= QUIET_MARKET_DAYS,
    counts: { h24: since(24), d7: since(24 * 7), d30: since(24 * 30) },
    totalTradingView: tv.length,
  };
}

/**
 * Runs the check and escalates. Never throws: a monitor that can take the
 * process down is worse than the problem it watches for.
 */
export async function checkSignalFreshnessAndReport(trigger: string): Promise<FreshnessReport | null> {
  let report: FreshnessReport;
  try {
    const { storage } = await import("../storage");
    report = assessFreshness(await storage.getSignals());
  } catch (err) {
    await reportIssue("TradingView freshness check could not run", err, { trigger });
    return null;
  }

  const last = report.lastSignalAt ? report.lastSignalAt.toISOString() : "never";
  if (!report.stale) {
    console.log(
      `[freshness] TradingView OK — last signal ${last}, ` +
      `${report.counts.h24} in 24h / ${report.counts.d7} in 7d (${trigger})`
    );
    return report;
  }

  console.error(`[freshness] TradingView feed quiet for ${report.quietMarketDays} market days (${trigger})`);

  // Once a day at most. A real outage lasting a week should not produce seven
  // identical reports; the first one is the actionable event.
  try {
    const { storage } = await import("../storage");
    const today = marketDate(new Date());
    if (await storage.getAppState(LAST_ALERT_KEY) === today) {
      console.log("[freshness] already alerted today, staying quiet");
      return report;
    }
    await storage.setAppState(LAST_ALERT_KEY, today);
  } catch {
    // If the dedupe store is unavailable, alerting twice beats not alerting.
  }

  const days = Number.isFinite(report.quietMarketDays) ? String(report.quietMarketDays) : "all";
  await reportIssue(
    "TradingView signals have stopped arriving",
    `No TradingView alert has reached /api/signals/webhook for ${days} consecutive market ` +
    `day(s). Last one: ${last}.\n\n` +
    `This is ~89% of signal volume, so the alert channels are running on the daily scan alone. ` +
    `Usual causes, most likely first: an alert expired on TradingView, an alert was deleted or ` +
    `deactivated, an indicator was edited, or the webhook URL changed.`,
    {
      trigger,
      quiet_market_days: days,
      last_signal: last,
      last_24h: String(report.counts.h24),
      last_7d: String(report.counts.d7),
      last_30d: String(report.counts.d30),
    },
  );
  return report;
}
