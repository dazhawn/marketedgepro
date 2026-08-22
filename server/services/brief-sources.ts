// Brief Builder (Agent 1) — extra data sources for the morning brief.
//
// The morning brief runs on the cloud instance (Railway), which cannot reach
// the trading PC's localhost services. Both sources below therefore read from
// MarketEdgePro's OWN database, which the PC-side apps already push into:
//   • Smart Investor forwards each alert to /api/signals/webhook → signals table
//     (signalType = "Smart Investor", full context in confluenceData.customData)
//   • The Smart Pullback uploader POSTs to /api/screener/results → screener_runs
//
// (EA portfolio health from MT5 Optimizer Studio — the third source — has no
//  pipe into this DB yet and is handled separately once that pipe exists.)

import { storage } from "../storage";
import * as myfxbook from "./myfxbook";

const SMART_INVESTOR_TYPE = "Smart Investor";

// ── Smart Investor stock alerts ─────────────────────────────────────────────

export interface StockAlertBrief {
  symbol: string;
  company?: string;
  triggers: string[];       // e.g. ["RSI oversold", "52-week pullback"]
  trend?: string;           // "uptrend" | "downtrend" | "sideways"
  aiDirection: string;      // AI-resolved direction stored on the signal
  price?: number;
  headline?: string;        // top news headline, if any
  receivedAt: Date;
}

// Shape of the context Smart Investor forwards inside confluenceData.customData.
interface SmartInvestorCustom {
  triggers?: { name: string; detail?: string }[];
  trend?: { direction?: string; detail?: string };
  explanation?: string;
  headlines?: { title: string; url?: string }[];
  company?: { name?: string };
}

/**
 * Recent Smart Investor buy-side alerts, most recent first, de-duplicated to
 * the latest alert per symbol. Default window catches the previous evening's
 * daily scan plus anything fired overnight.
 */
export async function getSmartInvestorBriefs(sinceHours = 30, limit = 12): Promise<StockAlertBrief[]> {
  let signals;
  try {
    signals = await storage.getRecentSignalsByType(SMART_INVESTOR_TYPE, sinceHours);
  } catch (err) {
    console.error("[brief-sources] Smart Investor query failed:", err);
    return [];
  }

  const bySymbol = new Map<string, StockAlertBrief>();
  for (const s of signals) {
    if (bySymbol.has(s.symbol)) continue; // already have the newest (list is desc)
    const custom = ((s.confluenceData as any)?.customData ?? {}) as SmartInvestorCustom;
    bySymbol.set(s.symbol, {
      symbol: s.symbol,
      company: custom.company?.name,
      triggers: (custom.triggers ?? []).map(t => t.name).filter(Boolean),
      trend: custom.trend?.direction,
      aiDirection: s.direction,
      price: s.price ?? undefined,
      headline: custom.headlines?.[0]?.title,
      receivedAt: s.receivedAt ?? new Date(),
    });
  }

  return Array.from(bySymbol.values()).slice(0, limit);
}

// ── Smart Pullback screener top picks ───────────────────────────────────────

export interface PullbackPickBrief {
  symbol: string;
  signal: string;   // "LONG PB" | "SHORT PB"
  price: number;
  pf: number;       // historical profit factor
  wr: number;       // win rate %
  when: string;     // "TODAY" | "YESTERDAY" | ...
  barsAgo: number;
}

export interface PullbackBriefResult {
  picks: PullbackPickBrief[];
  runAt?: string;   // when the screener last ran (from stored meta)
  total: number;    // total signals in the latest run
}

function num(v: unknown, ...fallbacks: unknown[]): number {
  for (const c of [v, ...fallbacks]) {
    const n = typeof c === "number" ? c : parseFloat(String(c ?? ""));
    if (!isNaN(n)) return n;
  }
  return 0;
}

function str(v: unknown, ...fallbacks: unknown[]): string {
  for (const c of [v, ...fallbacks]) {
    if (c != null && String(c).trim() !== "") return String(c).trim();
  }
  return "";
}

/**
 * Top pullback picks from the latest live-screener run stored in the DB.
 * Rows use the LiveSignalRow camelCase keys the uploader posts; we fall back to
 * raw CSV column names defensively. Fresh signals (today / yesterday) are
 * preferred, then ranked by historical profit factor.
 */
export async function getPullbackBriefs(limit = 8): Promise<PullbackBriefResult> {
  let run;
  try {
    run = await storage.getLatestScreenerRun("live");
  } catch (err) {
    console.error("[brief-sources] Pullback screener query failed:", err);
    return { picks: [], total: 0 };
  }
  if (!run) return { picks: [], total: 0 };

  const rows = (run.rows as Record<string, unknown>[]) ?? [];
  const picks: PullbackPickBrief[] = rows.map(r => ({
    symbol:  str(r.symbol, r["Symbol"]),
    signal:  str(r.signal, r["Signal"]),
    price:   num(r.price, r["Price"]),
    pf:      num(r.histPf, r["Hist_PF"], r["PF"]),
    wr:      num(r.wr, r["WR%"], r["WR %"]),
    when:    str(r.when, r["When"]) || "—",
    barsAgo: num(r.barsAgo, r["BarsAgo"]),
  })).filter(p => p.symbol);

  // Prefer the freshest signals (today/yesterday), then rank by profit factor.
  picks.sort((a, b) => {
    if (a.barsAgo !== b.barsAgo) return a.barsAgo - b.barsAgo;
    return b.pf - a.pf;
  });

  return {
    picks: picks.slice(0, limit),
    runAt: (run.meta as any)?.runAt,
    total: picks.length,
  };
}

// ── EA portfolio health (Myfxbook) ──────────────────────────────────────────

export interface AccountHealth {
  label: string;
  equity: number;
  currentDdPct: number;  // live drawdown = (balance-equity)/balance, source-agnostic
  maxDdPct: number;      // Myfxbook "drawdown" = max historical DD
  gainPct: number;
  recoveryFactor: number; // gain% / maxDD%  (>3 excellent, 1-3 solid, <0 net loss)
  demo: boolean;
}

export interface PortfolioHealthResult {
  accounts: AccountHealth[];
  configured: boolean;   // are Myfxbook creds set at all?
}

/**
 * Live EA portfolio health from Myfxbook. Runs from the cloud (outbound HTTPS).
 * Requires MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD env vars. Returns configured=false
 * (not an error) when creds are absent so the brief simply omits the section.
 */
export async function getPortfolioHealth(): Promise<PortfolioHealthResult> {
  const email = process.env.MYFXBOOK_EMAIL;
  const password = process.env.MYFXBOOK_PASSWORD;
  if (!email || !password) return { accounts: [], configured: false };

  let session: string | undefined;
  try {
    session = await myfxbook.login(email, password);
    const raw = await myfxbook.getAccounts(session);
    const accounts: AccountHealth[] = raw.map(a => {
      const balance = Number(a.balance ?? 0);
      const equity = Number(a.equity ?? 0);
      const maxDdPct = Number(a.drawdown ?? 0);
      const gainPct = Number(a.gain ?? 0);
      const currentDdPct = balance > 0 ? Math.max(0, ((balance - equity) / balance) * 100) : 0;
      const recoveryFactor = maxDdPct > 0 ? gainPct / maxDdPct : 0;
      return {
        label: a.name || `account ${a.id}`,
        equity,
        currentDdPct,
        maxDdPct,
        gainPct,
        recoveryFactor,
        demo: !!a.demo,
      };
    });
    return { accounts, configured: true };
  } catch (err) {
    console.error("[brief-sources] Myfxbook portfolio health failed:", err);
    return { accounts: [], configured: true };
  } finally {
    if (session) await myfxbook.logout(session);
  }
}

// ── Combined gather for the morning brief ───────────────────────────────────

export interface ExtraBriefSections {
  stockAlerts: StockAlertBrief[];
  pullbacks: PullbackBriefResult;
  portfolio: PortfolioHealthResult;
}

/** Gather every DB-backed extra section for the morning brief, in parallel.
 *  Each source is independently fault-tolerant, so a failure in one never
 *  blocks the rest of the brief. */
export async function gatherExtraBriefSections(): Promise<ExtraBriefSections> {
  const [stockAlerts, pullbacks, portfolio] = await Promise.all([
    getSmartInvestorBriefs().catch(err => {
      console.error("[brief-sources] getSmartInvestorBriefs failed:", err);
      return [] as StockAlertBrief[];
    }),
    getPullbackBriefs().catch(err => {
      console.error("[brief-sources] getPullbackBriefs failed:", err);
      return { picks: [], total: 0 } as PullbackBriefResult;
    }),
    getPortfolioHealth().catch(err => {
      console.error("[brief-sources] getPortfolioHealth failed:", err);
      return { accounts: [], configured: true } as PortfolioHealthResult;
    }),
  ]);
  return { stockAlerts, pullbacks, portfolio };
}
