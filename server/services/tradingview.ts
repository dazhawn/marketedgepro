// TradingView technicals — server-side data client.
//
// WHY THIS EXISTS, AND WHY IT DOESN'T USE AN MCP CONNECTOR
// -------------------------------------------------------
// The TradingView MCP connector is attached to a Claude session, not to a
// machine. Railway cannot reach it, and neither can a scheduled task. So this
// talks to TradingView's public scanner endpoint directly over HTTPS.
//
// Verified against the connector on 2026-08-22: the endpoint and the MCP return
// the SAME underlying values, agreeing to 1e-6 on price, RSI, SMA50 and
// Recommend.All. Fixtures live in the repo alongside this file's tests.
//
// Properties that make it safe to depend on:
//   • no auth, no key, no account
//   • no User-Agent requirement (a bare default agent gets HTTP 200 — measured)
//   • the "global" region resolves indices, FX, futures, metals and crypto in a
//     SINGLE request, so all ten Market Pulse instruments cost one round trip
//     instead of ten
//
// Ratings from this service are DECORATIVE. They are displayed as context and
// must never gate a recommendation — see the note on staleness below.

const SCANNER_URL = (region: string) => `https://scanner.tradingview.com/${region}/scan`;

/** Columns requested from the scanner, in order. See the positional-array warning below. */
const COLUMNS = ["close", "change", "RSI", "SMA50", "SMA200", "Recommend.All", "Recommend.MA"] as const;
type Column = (typeof COLUMNS)[number];

export type RatingLabel = "Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell";

export interface TechnicalSnapshot {
  /** Full TradingView symbol, e.g. "SP:SPX". */
  symbol: string;
  price: number | null;
  changePct: number | null;
  rsi: number | null;
  sma50: number | null;
  sma200: number | null;
  /** Recommend.All, in -1..1. Null when TradingView computes no technicals. */
  rating: number | null;
  ratingLabel: RatingLabel | null;
}

export interface TechnicalsResult {
  bySymbol: Record<string, TechnicalSnapshot>;
  /** When the underlying data was fetched — not when this call was made. */
  fetchedAt: Date;
  ageMs: number;
  fromCache: boolean;
  /**
   * True when the live fetch failed. Callers should surface this rather than
   * silently presenting the values as current; if nothing is cached, bySymbol
   * is empty and the caller should omit the field entirely.
   */
  degraded: boolean;
  /** Populated when degraded — the reason, for logging and display. */
  error?: string;
}

/**
 * Rating bands. Verified against the MCP connector's own labels on 2026-08-22:
 * MSFT +0.424 → "Buy", WMT -0.421 → "Sell", SPY +0.288 → "Buy".
 */
export function ratingLabel(value: number | null): RatingLabel | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value > 0.5) return "Strong Buy";
  if (value > 0.1) return "Buy";
  if (value >= -0.1) return "Neutral";
  if (value >= -0.5) return "Sell";
  return "Strong Sell";
}

/** Coerce a scanner cell to a number, or null. The scanner returns null freely. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

interface CacheEntry {
  fetchedAt: Date;
  bySymbol: Record<string, TechnicalSnapshot>;
}

const cache = new Map<string, CacheEntry>();

/** Ratings are decorative, so a generous TTL is fine — this is not a trading input. */
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 8_000;

function cacheKey(region: string, tickers: string[]): string {
  return `${region}::${[...tickers].sort().join(",")}`;
}

async function fetchScan(
  region: string,
  tickers: string[],
  timeoutMs: number,
): Promise<Record<string, TechnicalSnapshot>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(SCANNER_URL(region), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Not required by the endpoint — sent as courtesy identification.
        "User-Agent": "MarketEdgePro/1.0 (+server-side data client)",
      },
      body: JSON.stringify({
        symbols: { tickers, query: { types: [] } },
        columns: [...COLUMNS],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`scanner returned HTTP ${res.status}`);

    const payload = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
    const rows = payload.data ?? [];
    const bySymbol: Record<string, TechnicalSnapshot> = {};

    for (const row of rows) {
      // The `d` array is POSITIONAL and matches COLUMNS order. Zipping by name
      // is what stops a column-list edit from silently shifting every value.
      const cells = {} as Record<Column, unknown>;
      COLUMNS.forEach((col, i) => {
        cells[col] = row.d[i];
      });

      const rating = num(cells["Recommend.All"]);
      bySymbol[row.s] = {
        symbol: row.s,
        price: num(cells.close),
        changePct: num(cells.change),
        rsi: num(cells.RSI),
        sma50: num(cells.SMA50),
        sma200: num(cells.SMA200),
        rating,
        ratingLabel: ratingLabel(rating),
      };
    }
    return bySymbol;
  } finally {
    clearTimeout(timer);
  }
}

export interface GetTechnicalsOptions {
  /** Scanner region. "global" covers indices, FX, futures, metals and crypto. */
  region?: string;
  ttlMs?: number;
  timeoutMs?: number;
}

/**
 * Technicals for a set of TradingView symbols in a single request.
 *
 * Never throws. On failure it serves the last good response with
 * `degraded: true`, or an empty `bySymbol` if nothing was ever cached — the
 * caller decides whether to show a stale value with its age, or omit the field.
 * Nothing here should be allowed to block the brief.
 *
 * Symbols must be fully qualified (`EXCHANGE:TICKER`). Do not guess exchanges:
 * WMT is NASDAQ:WMT, not NYSE:WMT. Requesting both forms of an ambiguous ticker
 * is free — the scanner silently returns only what resolves.
 */
export async function getTechnicals(
  tickers: string[],
  options: GetTechnicalsOptions = {},
): Promise<TechnicalsResult> {
  const region = options.region ?? "global";
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const key = cacheKey(region, tickers);
  const cached = cache.get(key);
  const now = Date.now();

  if (cached && now - cached.fetchedAt.getTime() < ttlMs) {
    return {
      bySymbol: cached.bySymbol,
      fetchedAt: cached.fetchedAt,
      ageMs: now - cached.fetchedAt.getTime(),
      fromCache: true,
      degraded: false,
    };
  }

  try {
    const bySymbol = await fetchScan(region, tickers, timeoutMs);
    const fetchedAt = new Date();
    cache.set(key, { fetchedAt, bySymbol });
    return { bySymbol, fetchedAt, ageMs: 0, fromCache: false, degraded: false };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Loud on purpose. A silent fallback to stale data is how the pullback
    // screener ran on a hardcoded list for months without anyone noticing.
    console.error(
      `[tradingview] scan failed (${reason}) — ` +
        (cached
          ? `serving cached data from ${cached.fetchedAt.toISOString()}`
          : "no cache available, returning empty"),
    );
    if (cached) {
      return {
        bySymbol: cached.bySymbol,
        fetchedAt: cached.fetchedAt,
        ageMs: now - cached.fetchedAt.getTime(),
        fromCache: true,
        degraded: true,
        error: reason,
      };
    }
    return {
      bySymbol: {},
      fetchedAt: new Date(0),
      ageMs: Infinity,
      fromCache: false,
      degraded: true,
      error: reason,
    };
  }
}

/** Test seam — drops cached responses so tests start clean. */
export function __clearCache(): void {
  cache.clear();
}
