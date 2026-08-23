// Market Pulse — quantitative + narrative snapshot prepended to the daily brief

import { getTechnicals, type RatingLabel } from "./tradingview";

async function generateNarrative(prompt: string): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (provider === "atlascloud" || provider === "atlas") {
    const apiKey = process.env.ATLASCLOUD_API_KEY;
    if (!apiKey) throw new Error("ATLASCLOUD_API_KEY not set");
    const model = process.env.ATLAS_MODEL ?? "deepseek-ai/deepseek-v4-pro";
    const res = await fetch("https://api.atlascloud.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 200, temperature: 0.4 }),
    });
    if (!res.ok) throw new Error(`Atlas Cloud ${res.status}`);
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices?.[0]?.message?.content ?? "";
  }
  // Anthropic — the default provider for this deployment.
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await ai.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
    // Adaptive thinking is on by default and bills against this ceiling, so the
    // old 200-token cap would be consumed before any narrative was written.
    max_tokens: 2048,
    output_config: { effort: "low" },
    messages: [{ role: "user", content: prompt }],
  });
  const textBlock = message.content.find(b => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text : "";
}

export interface PulseItem {
  label: string;     // "SPX"
  emoji?: string;    // "📈"
  price: string;     // "5,856"
  changePct: number; // 0.42
  // Technicals from TradingView. Optional throughout: absent when the scan
  // failed, and absent per-symbol when TradingView computes no indicators for
  // that instrument (US10Y is a yield index and has none).
  rsi?: number;
  rating?: number;            // Recommend.All, -1..1
  ratingLabel?: RatingLabel;  // "Buy", "Sell", …
}

export interface MarketPulse {
  items: PulseItem[];
  narrative: string;
  /** When the technicals were fetched. Absent if none are attached. */
  technicalsAsOf?: Date;
  /** True when technicals are stale — the live scan failed and cache was served. */
  technicalsStale?: boolean;
}

// Yahoo Finance tickers for the snapshot, plus the TradingView symbol for
// technicals. Yahoo remains the source of price and change: it is what the
// brief has always shown, and swapping it would move published numbers for no
// benefit. TradingView is additive context only.
//
// All ten resolve in a SINGLE request through the scanner's "global" region —
// measured at 147ms — so this adds one round trip, not ten.
const PULSE_SYMBOLS: { key: string; label: string; emoji: string; ticker: string; tvSymbol: string; decimals: number }[] = [
  { key: "spx",   label: "SPX",   emoji: "📈", ticker: "^GSPC",    tvSymbol: "SP:SPX",          decimals: 0 },
  { key: "ndx",   label: "NDX",   emoji: "💻", ticker: "^IXIC",    tvSymbol: "NASDAQ:IXIC",     decimals: 0 },
  { key: "dow",   label: "DOW",   emoji: "🏛️", ticker: "^DJI",     tvSymbol: "DJ:DJI",          decimals: 0 },
  { key: "rut",   label: "RUT",   emoji: "🏭", ticker: "^RUT",     tvSymbol: "TVC:RUT",         decimals: 0 },
  { key: "dxy",   label: "DXY",   emoji: "💵", ticker: "DX-Y.NYB", tvSymbol: "TVC:DXY",         decimals: 2 },
  // TVC:US10Y resolves but carries no RSI or rating — a real null case, not hypothetical.
  { key: "us10y", label: "US10Y", emoji: "🏦", ticker: "^TNX",     tvSymbol: "TVC:US10Y",       decimals: 2 },
  { key: "wti",   label: "WTI",   emoji: "🛢️", ticker: "CL=F",     tvSymbol: "NYMEX:CL1!",      decimals: 2 },
  { key: "gold",  label: "GOLD",  emoji: "🪙", ticker: "GC=F",     tvSymbol: "TVC:GOLD",        decimals: 0 },
  { key: "btc",   label: "BTC",   emoji: "₿",  ticker: "BTC-USD",  tvSymbol: "BINANCE:BTCUSDT", decimals: 0 },
  { key: "vix",   label: "VIX",   emoji: "😰", ticker: "^VIX",     tvSymbol: "TVC:VIX",         decimals: 2 },
];

async function fetchYahooSnapshot(ticker: string): Promise<{ price: number; changePct: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=2d&interval=1d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice ?? 0;
    const prev  = meta.previousClose ?? meta.chartPreviousClose ?? price;
    const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
    return { price, changePct };
  } catch {
    return null;
  }
}

function fmt(n: number, decimals: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export async function buildMarketPulse(): Promise<MarketPulse> {
  // Prices from Yahoo (ten calls, parallel) and technicals from TradingView
  // (one call) run concurrently. getTechnicals never throws and never blocks —
  // a TradingView outage costs the brief its technicals, not the brief.
  const [snapshots, technicals] = await Promise.all([
    Promise.all(
      PULSE_SYMBOLS.map(async (s) => {
        const snap = await fetchYahooSnapshot(s.ticker);
        return { ...s, snap };
      })
    ),
    getTechnicals(PULSE_SYMBOLS.map(s => s.tvSymbol)),
  ]);

  const haveTechnicals = Object.keys(technicals.bySymbol).length > 0;

  const items: PulseItem[] = snapshots
    .filter(s => s.snap != null)
    .map(s => {
      const item: PulseItem = {
        label:     s.label,
        emoji:     s.emoji,
        price:     fmt(s.snap!.price, s.decimals),
        changePct: s.snap!.changePct,
      };
      const tech = technicals.bySymbol[s.tvSymbol];
      // Each field is attached only when present — US10Y has a price but no
      // indicators, so a blanket assignment would write nulls into the brief.
      if (tech?.rsi != null) item.rsi = tech.rsi;
      if (tech?.rating != null) item.rating = tech.rating;
      if (tech?.ratingLabel != null) item.ratingLabel = tech.ratingLabel;
      return item;
    });

  // Build a compact context block for the AI narrative. Technicals are included
  // as observations only — the prompt below is explicit that they must not be
  // read as recommendations.
  const context = items
    .map(i => {
      const base = `${i.label} ${i.price} (${i.changePct >= 0 ? "+" : ""}${i.changePct.toFixed(2)}%)`;
      const extras: string[] = [];
      if (i.rsi != null) extras.push(`RSI ${i.rsi.toFixed(0)}`);
      if (i.ratingLabel) extras.push(`TV ${i.ratingLabel}`);
      return extras.length ? `${base} [${extras.join(", ")}]` : base;
    })
    .join(", ");

  let narrative = "";
  try {
    const prompt = `You are a pre-market analyst writing a 2-sentence market tone summary for active traders.
Current snapshot: ${context}

Bracketed values are TradingView's 14-period RSI and its aggregated technical
rating. Treat them as observations about positioning and momentum, not as
advice — the rating is a mechanical roll-up of indicators, so where it conflicts
with price action, describe the tension rather than siding with it.

Write 2 concise sentences (max 50 words total):
1. Overall risk-on / risk-off tone based on equities vs DXY/VIX/yields.
2. Key driver or catalyst tone (Asian/European session inference, dollar strength, yield direction).
Do NOT recommend any specific trades. Do NOT use headers or bullet points. Just two flowing sentences.`;

    narrative = await generateNarrative(prompt);
    narrative = narrative.replace(/\n+/g, " ").trim();
  } catch (err) {
    console.error("[market-pulse] narrative generation failed:", err);
    narrative = "Risk tone neutral on light data. Watch the dollar and yields for direction cues.";
  }

  const pulse: MarketPulse = { items, narrative };
  if (haveTechnicals) {
    pulse.technicalsAsOf = technicals.fetchedAt;
    // Surfaced rather than hidden: a consumer showing a rating should be able to
    // say how old it is. Ratings are decorative, so stale is acceptable — silently
    // presenting stale as current is not.
    if (technicals.degraded) pulse.technicalsStale = true;
  }
  return pulse;
}
