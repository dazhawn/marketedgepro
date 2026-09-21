/**
 * Warn before a TradingView alert expires.
 *
 * WHY A SNAPSHOT, NOT A LIVE CALL
 * -------------------------------
 * The alert list lives behind the tvremix MCP connector, which is attached to
 * a Claude session and is not reachable from Railway. Rather than skip the
 * warning entirely, the list is snapshotted into data/tradingview-alerts.json
 * and read from disk. Refresh it whenever alerts change.
 *
 * A snapshot that silently goes stale would be worse than no check at all, so
 * staleness is itself reported: past SNAPSHOT_MAX_AGE_DAYS this posts a
 * "refresh me" notice instead of pretending to know.
 *
 * WHY 96 HOURS
 * ------------
 * The check runs once a day, so a 72-hour window can deliver as little as
 * 48 hours' notice when an expiry falls just after a run. 96 hours guarantees
 * at least three days, and it means a weekend expiry is flagged on Friday
 * rather than discovered on Monday.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * On 29 August 2026 thirteen alerts were found to be expiring within four
 * days, eight of them Renko strategy alerts still actively firing — including
 * XAUUSD 30m, the only feed behind #metals-alerts. Nothing would have said a
 * word. The signal-freshness check would not have caught it either: seventeen
 * other alerts survive, so the feed never goes quiet.
 */

// Imported, not read at runtime. The server is bundled by esbuild into a
// single dist/index.cjs and server/data/ is never copied alongside it, so a
// readFile of a path relative to this module resolves to nothing in
// production. Importing the JSON makes esbuild inline it at build time.
// Refreshing the snapshot therefore means editing this file and redeploying,
// which is the same push that would have been needed anyway.
import snapshot from "../data/tradingview-alerts.json";
import { reportIssue } from "./discord-bot";

export const WARN_WINDOW_HOURS = 96;
export const SNAPSHOT_MAX_AGE_DAYS = 45;

/**
 * How long an expiry recorded in the snapshot is reported individually.
 *
 * Alerts get renewed in TradingView without this file changing, so an expiry
 * that is days old is far more likely to mean "the snapshot is behind" than
 * "this alert is still dead". Before this existed, the Aug 30 snapshot listed
 * ~28 alerts as expired every single day through late September — all of them
 * had been renewed. Past the grace window they collapse into one "refresh the
 * snapshot" line instead of being re-listed forever.
 */
export const EXPIRED_GRACE_HOURS = 72;

/** An alert is "live" if it produced a signal recently enough to matter. */
const RECENTLY_FIRED_DAYS = 10;

/** "AMEX:SPY" -> "SPY": the signals table stores bare tickers. */
export function bareSymbol(symbol: string): string {
  return symbol.split(":").pop() ?? symbol;
}

export interface AlertSnapshotEntry {
  id: number;
  symbol: string;
  kind: string;
  resolution: string;
  active: boolean;
  expiration: string;
  lastFire: string | null;
}

export interface ExpiryReport {
  snapshotAt: Date | null;
  snapshotStale: boolean;
  expiringSoon: AlertSnapshotEntry[];
  /** Of those, the ones still producing signals — the ones that actually hurt. */
  expiringAndLive: AlertSnapshotEntry[];
  /** Expired within the grace window with no evidence of renewal. Actionable. */
  alreadyExpired: AlertSnapshotEntry[];
  /** Recorded as expired, but a webhook arrived afterwards — it was renewed. */
  presumedRenewed: AlertSnapshotEntry[];
  /** Expired longer ago than the grace window with no evidence either way. */
  outdated: AlertSnapshotEntry[];
  total: number;
}

/**
 * Latest webhook time per bare ticker. Evidence that an alert is alive: a
 * signal cannot arrive from an alert that has expired.
 *
 * Matching is per SYMBOL, not per alert, because webhooks don't carry the
 * TradingView alert id. So a dead price alert on SPY is masked while the SPY
 * strategy alert keeps firing. That trade is deliberate: the alerts that fire
 * regularly are the ones that matter, and a one-off price-crossing alert
 * lapsing is low cost.
 */
export type LastSignalBySymbol = Record<string, Date>;

export function loadSnapshot(): { snapshotAt: string; alerts: AlertSnapshotEntry[] } {
  const s = snapshot as unknown as { snapshotAt: string; alerts: AlertSnapshotEntry[] };
  return { snapshotAt: s.snapshotAt, alerts: s.alerts ?? [] };
}

export function assessExpiry(
  snapshotAt: string | null,
  alerts: AlertSnapshotEntry[],
  now: Date = new Date(),
  lastSignalBySymbol: LastSignalBySymbol = {},
): ExpiryReport {
  const at = snapshotAt ? new Date(snapshotAt) : null;
  const ageDays = at ? (now.getTime() - at.getTime()) / 86_400_000 : Infinity;

  const active = alerts.filter(a => a.active);
  const hoursUntil = (a: AlertSnapshotEntry) =>
    (new Date(a.expiration).getTime() - now.getTime()) / 3_600_000;

  // Split everything the snapshot believes has expired into three buckets.
  const recordedExpired = active.filter(a => hoursUntil(a) <= 0);
  const renewedSince = (a: AlertSnapshotEntry) => {
    const last = lastSignalBySymbol[bareSymbol(a.symbol)];
    return !!last && last.getTime() > new Date(a.expiration).getTime();
  };
  const presumedRenewed = recordedExpired.filter(renewedSince);
  const unexplained = recordedExpired.filter(a => !renewedSince(a));
  const alreadyExpired = unexplained.filter(a => -hoursUntil(a) <= EXPIRED_GRACE_HOURS);
  const outdated = unexplained.filter(a => -hoursUntil(a) > EXPIRED_GRACE_HOURS);
  const expiringSoon = active
    .filter(a => hoursUntil(a) > 0 && hoursUntil(a) <= WARN_WINDOW_HOURS)
    .sort((x, y) => hoursUntil(x) - hoursUntil(y));

  const liveCut = now.getTime() - RECENTLY_FIRED_DAYS * 86_400_000;
  const expiringAndLive = expiringSoon.filter(
    a => a.lastFire && new Date(a.lastFire).getTime() >= liveCut,
  );

  return {
    snapshotAt: at,
    snapshotStale: !at || ageDays > SNAPSHOT_MAX_AGE_DAYS,
    expiringSoon,
    expiringAndLive,
    alreadyExpired,
    presumedRenewed,
    outdated,
    total: alerts.length,
  };
}

/**
 * Latest webhook per ticker in the snapshot. Never throws — without evidence
 * the checker simply renews nothing, which errs toward warning rather than
 * toward silence.
 */
async function loadRenewalEvidence(alerts: AlertSnapshotEntry[]): Promise<LastSignalBySymbol> {
  const evidence: LastSignalBySymbol = {};
  try {
    const { storage } = await import("../storage");
    const symbols = Array.from(new Set(alerts.map(a => bareSymbol(a.symbol))));
    await Promise.all(symbols.map(async sym => {
      const s = await storage.getLatestSignalForSymbol(sym);
      if (s?.receivedAt) evidence[sym] = new Date(s.receivedAt);
    }));
  } catch (err) {
    console.error("[expiry] could not load webhook evidence, renewing nothing:", err);
  }
  return evidence;
}

function describe(a: AlertSnapshotEntry, now: Date): string {
  const sym = a.symbol.split(":").pop() ?? a.symbol;
  const hrs = (new Date(a.expiration).getTime() - now.getTime()) / 3_600_000;
  const when = hrs <= 0 ? "EXPIRED" : hrs < 48 ? `${Math.round(hrs)}h` : `${(hrs / 24).toFixed(1)}d`;
  const fired = a.lastFire
    ? `last fired ${new Date(a.lastFire).toISOString().slice(0, 10)}`
    : "never fired";
  const label = a.kind === "strategy" ? `Renko Strat ${a.resolution}m` : a.kind;
  return `${sym} · ${label} · in ${when} · ${fired}`;
}

/** Runs the check and escalates. Never throws. */
export async function checkAlertExpiryAndReport(trigger: string): Promise<ExpiryReport | null> {
  let report: ExpiryReport;
  try {
    const { snapshotAt, alerts } = loadSnapshot();
    const evidence = await loadRenewalEvidence(alerts);
    report = assessExpiry(snapshotAt, alerts, new Date(), evidence);
  } catch (err) {
    await reportIssue("TradingView expiry check could not run", err, { trigger });
    return null;
  }

  const now = new Date();

  if (report.snapshotStale) {
    console.warn("[expiry] alert snapshot is stale");
    await reportIssue(
      "TradingView alert snapshot needs refreshing",
      `The stored alert list was captured ${report.snapshotAt?.toISOString().slice(0, 10) ?? "never"} ` +
      `and is now older than ${SNAPSHOT_MAX_AGE_DAYS} days, so expiry warnings cannot be trusted.\n\n` +
      `Re-run the tvremix MCP \`my_alerts\` call and update server/data/tradingview-alerts.json.`,
      { trigger, snapshot: report.snapshotAt?.toISOString() ?? "none" },
    );
    return report;
  }

  if (report.presumedRenewed.length) {
    console.log(
      `[expiry] ${report.presumedRenewed.length} recorded expiries ignored — a webhook ` +
      `arrived after each, so they were renewed (${trigger})`,
    );
  }

  if (!report.expiringSoon.length && !report.alreadyExpired.length && !report.outdated.length) {
    console.log(`[expiry] no TradingView alert expires within ${WARN_WINDOW_HOURS}h (${trigger})`);
    return report;
  }

  const lines: string[] = [];
  if (report.alreadyExpired.length) {
    lines.push(`**Already expired (${report.alreadyExpired.length}):**`);
    lines.push(...report.alreadyExpired.map(a => `• ${describe(a, now)}`));
    lines.push("");
  }
  // Deliberately ONE line, not a list: these are almost certainly renewals the
  // snapshot never heard about, and listing them daily is what made this
  // warning worthless before.
  if (report.outdated.length) {
    lines.push(
      `**Snapshot looks out of date:** ${report.outdated.length} alert(s) are recorded as ` +
      `expired more than ${EXPIRED_GRACE_HOURS}h ago with no webhook since. If they were ` +
      `renewed in TradingView, re-run the tvremix \`my_alerts\` call and update ` +
      `server/data/tradingview-alerts.json.`,
    );
    lines.push("");
  }
  if (report.expiringSoon.length) {
    lines.push(`**Expiring within ${WARN_WINDOW_HOURS}h (${report.expiringSoon.length}):**`);
    lines.push(...report.expiringSoon.map(a => `• ${describe(a, now)}`));
  }
  if (report.expiringAndLive.length) {
    lines.push("");
    lines.push(
      `${report.expiringAndLive.length} of these fired in the last ${RECENTLY_FIRED_DAYS} days — ` +
      `those are the ones that will cost you signals.`,
    );
  }

  const onlyOutdated =
    !report.expiringSoon.length && !report.alreadyExpired.length && report.outdated.length > 0;

  console.error(
    `[expiry] ${report.expiringSoon.length} expiring, ${report.alreadyExpired.length} expired, ` +
    `${report.outdated.length} outdated, ${report.presumedRenewed.length} renewed (${trigger})`,
  );
  await reportIssue(
    onlyOutdated ? "TradingView alert snapshot is out of date" : "TradingView alerts are about to expire",
    lines.join("\n"),
    {
      trigger,
      expiring_soon: String(report.expiringSoon.length),
      still_firing: String(report.expiringAndLive.length),
      already_expired: String(report.alreadyExpired.length),
      outdated: String(report.outdated.length),
      renewed: String(report.presumedRenewed.length),
      snapshot: report.snapshotAt?.toISOString().slice(0, 10) ?? "none",
    },
  );
  return report;
}
