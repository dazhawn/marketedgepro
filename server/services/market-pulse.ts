// Market Pulse — quantitative + narrative snapshot prepended to the daily brief

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
  // Anthropic fallback (rare on this deployment)
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await ai.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content[0].type === "text" ? message.content[0].text : "";
}

export interface PulseItem {
  label: string;     // "SPX"
  emoji?: string;    // "📈"
  price: string;     // "5,856"
  changePct: number; // 0.42
}

export interface MarketPulse {
  items: PulseItem[];
  narrative: string;
}

// Yahoo Finance tickers for the snapshot
const PULSE_SYMBOLS: { key: string; label: string; emoji: string; ticker: string; decimals: number }[] = [
  { key: "spx",   label: "SPX",   emoji: "📈", ticker: "^GSPC",    decimals: 0 },
  { key: "ndx",   label: "NDX",   emoji: "💻", ticker: "^IXIC",    decimals: 0 },
  { key: "dow",   label: "DOW",   emoji: "🏛️", ticker: "^DJI",     decimals: 0 },
  { key: "rut",   label: "RUT",   emoji: "🏭", ticker: "^RUT",     decimals: 0 },
  { key: "dxy",   label: "DXY",   emoji: "💵", ticker: "DX-Y.NYB", decimals: 2 },
  { key: "us10y", label: "US10Y", emoji: "🏦", ticker: "^TNX",     decimals: 2 },
  { key: "wti",   label: "WTI",   emoji: "🛢️", ticker: "CL=F",     decimals: 2 },
  { key: "gold",  label: "GOLD",  emoji: "🪙", ticker: "GC=F",     decimals: 0 },
  { key: "btc",   label: "BTC",   emoji: "₿",  ticker: "BTC-USD",  decimals: 0 },
  { key: "vix",   label: "VIX",   emoji: "😰", ticker: "^VIX",     decimals: 2 },
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
  // Parallel fetch all snapshots
  const snapshots = await Promise.all(
    PULSE_SYMBOLS.map(async (s) => {
      const snap = await fetchYahooSnapshot(s.ticker);
      return { ...s, snap };
    })
  );

  const items: PulseItem[] = snapshots
    .filter(s => s.snap != null)
    .map(s => ({
      label:     s.label,
      emoji:     s.emoji,
      price:     fmt(s.snap!.price, s.decimals),
      changePct: s.snap!.changePct,
    }));

  // Build a compact context block for the AI narrative
  const context = items
    .map(i => `${i.label} ${i.price} (${i.changePct >= 0 ? "+" : ""}${i.changePct.toFixed(2)}%)`)
    .join(", ");

  let narrative = "";
  try {
    const prompt = `You are a pre-market analyst writing a 2-sentence market tone summary for active traders.
Current snapshot: ${context}

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

  return { items, narrative };
}
