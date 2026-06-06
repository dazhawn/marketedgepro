export interface MarketQuote {
  symbol: string;
  price: string;
  change: string;
  changePercent: string;
  high: string;
  low: string;
  volume: string;
  timestamp: string;
}

export interface ForexQuote {
  fromSymbol: string;
  toSymbol: string;
  price: string;
  bid: string;
  ask: string;
  timestamp: string;
}

export interface SupportResistance {
  symbol: string;
  pivot: string;
  support1: string;
  support2: string;
  support3: string;
  resistance1: string;
  resistance2: string;
  resistance3: string;
  dailyHigh: string;
  dailyLow: string;
  dailyClose: string;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

const quoteCache = new Map<string, { data: any; expiry: number }>();
const CACHE_TTL = 15 * 60 * 1000;

// Map internal symbols → Yahoo Finance tickers
function toYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  const map: Record<string, string> = {
    "EUR/USD": "EURUSD=X",
    "USD/JPY": "USDJPY=X",
    "GBP/USD": "GBPUSD=X",
    "AUD/USD": "AUDUSD=X",
    "USD/CAD": "USDCAD=X",
    "USD/CHF": "USDCHF=X",
    "NZD/USD": "NZDUSD=X",
    "AUD/NZD": "AUDNZD=X",
    "GBP/JPY": "GBPJPY=X",
    "EUR/JPY": "EURJPY=X",
    "XAUUSD":  "GC=F",
    "XAGUSD":  "SI=F",
    "XPTUSD":  "PL=F",
    "BTC":     "BTC-USD",
    "ETH":     "ETH-USD",
    "SOL":     "SOL-USD",
    "US30":    "YM=F",
    "NAS100":  "NQ=F",
    "SPX500":  "ES=F",
    "UK100":   "^FTSE",
    "DE40":    "^GDAXI",
  };
  return map[upper] || symbol;
}

async function fetchYahoo(symbol: string): Promise<{
  price: number; change: number; changePercent: number;
  high: number; low: number; open: number; close: number; volume: number; timestamp: string;
}> {
  const cached = quoteCache.get(symbol);
  if (cached && cached.expiry > Date.now()) return cached.data;

  const yahooSym = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=2d&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`Yahoo Finance error ${res.status} for ${symbol}`);

  const json = await res.json() as any;
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No Yahoo data for ${symbol}`);

  const meta = result.meta;
  const data = {
    price:         meta.regularMarketPrice       ?? 0,
    change:        meta.regularMarketChange      ?? 0,
    changePercent: meta.regularMarketChangePercent ?? 0,
    high:          meta.regularMarketDayHigh     ?? 0,
    low:           meta.regularMarketDayLow      ?? 0,
    open:          meta.regularMarketOpen        ?? 0,
    close:         meta.previousClose            ?? meta.chartPreviousClose ?? 0,
    volume:        meta.regularMarketVolume      ?? 0,
    timestamp:     new Date(meta.regularMarketTime * 1000).toISOString(),
  };
  quoteCache.set(symbol, { data, expiry: Date.now() + CACHE_TTL });
  return data;
}

export async function fetchStockQuote(symbol: string): Promise<MarketQuote> {
  const d = await fetchYahoo(symbol);
  return {
    symbol,
    price:         d.price.toFixed(4),
    change:        d.change.toFixed(4),
    changePercent: `${d.changePercent.toFixed(2)}%`,
    high:          d.high.toFixed(4),
    low:           d.low.toFixed(4),
    volume:        String(d.volume),
    timestamp:     d.timestamp,
  };
}

export async function fetchForexRate(fromSymbol: string, toSymbol: string): Promise<ForexQuote> {
  const symbol = `${fromSymbol}/${toSymbol}`;
  const d = await fetchYahoo(symbol);
  return {
    fromSymbol,
    toSymbol,
    price: d.price.toFixed(5),
    bid:   (d.price - 0.0001).toFixed(5),
    ask:   (d.price + 0.0001).toFixed(5),
    timestamp: d.timestamp,
  };
}

function computePivots(high: number, low: number, close: number, decimals: number, symbol: string): SupportResistance {
  const pivot = (high + low + close) / 3;
  const s1 = 2 * pivot - high;
  const s2 = pivot - (high - low);
  const s3 = low - 2 * (high - pivot);
  const r1 = 2 * pivot - low;
  const r2 = pivot + (high - low);
  const r3 = high + 2 * (pivot - low);
  return {
    symbol,
    pivot:       pivot.toFixed(decimals),
    support1:    s1.toFixed(decimals),
    support2:    s2.toFixed(decimals),
    support3:    s3.toFixed(decimals),
    resistance1: r1.toFixed(decimals),
    resistance2: r2.toFixed(decimals),
    resistance3: r3.toFixed(decimals),
    dailyHigh:   high.toFixed(decimals),
    dailyLow:    low.toFixed(decimals),
    dailyClose:  close.toFixed(decimals),
  };
}

const srCache = new Map<string, { data: SupportResistance; expiry: number }>();
const SR_CACHE_TTL = 30 * 60 * 1000;

export async function fetchSupportResistance(symbol: string, isForex: boolean = false): Promise<SupportResistance> {
  const cached = srCache.get(symbol);
  if (cached && cached.expiry > Date.now()) return cached.data;

  const d = await fetchYahoo(symbol);
  const isForexLike = isForex || symbol.includes("/") ||
    symbol.startsWith("XAU") || symbol.startsWith("XAG") || symbol.startsWith("XPT");
  const decimals = isForexLike ? 5 : 2;

  const high  = d.high  > 0 ? d.high  : d.price * 1.01;
  const low   = d.low   > 0 ? d.low   : d.price * 0.99;
  const close = d.close > 0 ? d.close : d.price;

  const result = computePivots(high, low, close, decimals, symbol);
  srCache.set(symbol, { data: result, expiry: Date.now() + SR_CACHE_TTL });
  return result;
}
