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

const quoteCache = new Map<string, { data: MarketQuote; expiry: number }>();
const forexCache = new Map<string, { data: ForexQuote; expiry: number }>();
const QUOTE_CACHE_TTL = 15 * 60 * 1000;

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

function checkRateLimit(data: any): void {
  if (data["Information"] && typeof data["Information"] === "string" && 
      data["Information"].includes("rate limit")) {
    throw new RateLimitError("Alpha Vantage API rate limit reached. Free tier allows 25 requests/day.");
  }
  if (data["Note"] && typeof data["Note"] === "string" && 
      data["Note"].includes("call volume")) {
    throw new RateLimitError("Alpha Vantage API call frequency limit reached. Please wait and try again.");
  }
}

export async function fetchStockQuote(symbol: string): Promise<MarketQuote> {
  const cached = quoteCache.get(symbol);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_KEY is not set");
  }

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Alpha Vantage returned ${response.status}`);
    }

    const data = await response.json() as any;
    checkRateLimit(data);
    const quote = data["Global Quote"];

    if (!quote || Object.keys(quote).length === 0) {
      throw new Error(`No data found for symbol: ${symbol}`);
    }

    const result: MarketQuote = {
      symbol: quote["01. symbol"] || symbol,
      price: quote["05. price"] || "0",
      change: quote["09. change"] || "0",
      changePercent: quote["10. change percent"] || "0%",
      high: quote["03. high"] || "0",
      low: quote["04. low"] || "0",
      volume: quote["06. volume"] || "0",
      timestamp: quote["07. latest trading day"] || new Date().toISOString(),
    };
    quoteCache.set(symbol, { data: result, expiry: Date.now() + QUOTE_CACHE_TTL });
    return result;
  } catch (error) {
    console.error("Error fetching stock quote:", error);
    throw error;
  }
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

const INDEX_SYMBOLS: Record<string, string> = {
  "^IXIC": "^IXIC",
  "^GSPC": "^GSPC",
  "^DJI": "^DJI",
  "^RUT": "^RUT",
};

async function fetchYahooQuote(yahooSymbol: string): Promise<{ high: number; low: number; close: number; price: number }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=2d&interval=1d`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    throw new Error(`Yahoo Finance returned ${response.status}`);
  }
  const data = await response.json() as any;
  const result = data?.chart?.result?.[0];
  if (!result) {
    throw new Error(`No Yahoo Finance data for ${yahooSymbol}`);
  }
  const meta = result.meta;
  return {
    high: meta.regularMarketDayHigh || 0,
    low: meta.regularMarketDayLow || 0,
    close: meta.previousClose || meta.chartPreviousClose || 0,
    price: meta.regularMarketPrice || 0,
  };
}

const srCache = new Map<string, { data: SupportResistance; expiry: number }>();
const SR_CACHE_TTL = 30 * 60 * 1000;

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
    pivot: pivot.toFixed(decimals),
    support1: s1.toFixed(decimals),
    support2: s2.toFixed(decimals),
    support3: s3.toFixed(decimals),
    resistance1: r1.toFixed(decimals),
    resistance2: r2.toFixed(decimals),
    resistance3: r3.toFixed(decimals),
    dailyHigh: high.toFixed(decimals),
    dailyLow: low.toFixed(decimals),
    dailyClose: close.toFixed(decimals),
  };
}

export async function fetchSupportResistance(symbol: string, isForex: boolean = false): Promise<SupportResistance> {
  const cached = srCache.get(symbol);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const upperSymbol = symbol.toUpperCase();

  if (INDEX_SYMBOLS[symbol]) {
    try {
      const yahoo = await fetchYahooQuote(symbol);
      if (yahoo.high > 0 && yahoo.low > 0) {
        const result = computePivots(yahoo.high, yahoo.low, yahoo.close, 2, symbol);
        srCache.set(symbol, { data: result, expiry: Date.now() + SR_CACHE_TTL });
        return result;
      }
    } catch (e) {
      console.error(`Yahoo Finance fetch failed for ${symbol}:`, e);
    }
  }

  const COMMODITY_MAP: Record<string, [string, string]> = {
    XAUUSD: ["XAU", "USD"],
    XAGUSD: ["XAG", "USD"],
  };

  const CRYPTO_MAP: Record<string, [string, string]> = {
    BTC: ["BTC", "USD"],
    ETH: ["ETH", "USD"],
    SOL: ["SOL", "USD"],
  };

  if (COMMODITY_MAP[upperSymbol] || CRYPTO_MAP[upperSymbol]) {
    const pair = COMMODITY_MAP[upperSymbol] || CRYPTO_MAP[upperSymbol];
    try {
      const rate = await fetchForexRate(pair[0], pair[1]);
      const price = parseFloat(rate.price);
      if (price > 0) {
        const range = price * 0.015;
        const result = computePivots(price + range, price - range, price, 2, symbol);
        srCache.set(symbol, { data: result, expiry: Date.now() + SR_CACHE_TTL });
        return result;
      }
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
    }
  }

  if (!isForex && !symbol.includes("/")) {
    try {
      const quote = await fetchStockQuote(symbol);
      const high = parseFloat(quote.high);
      const low = parseFloat(quote.low);
      const close = parseFloat(quote.price);
      if (high > 0 && low > 0 && close > 0) {
        const result = computePivots(high, low, close, 2, symbol);
        srCache.set(symbol, { data: result, expiry: Date.now() + SR_CACHE_TTL });
        return result;
      }
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
    }
  }

  if (isForex || symbol.includes("/")) {
    try {
      const [from, to] = symbol.split("/");
      const rate = await fetchForexRate(from, to);
      const price = parseFloat(rate.price);
      const bid = parseFloat(rate.bid);
      const ask = parseFloat(rate.ask);
      const spread = ask - bid;
      const estimatedHigh = price + spread * 15;
      const estimatedLow = price - spread * 15;
      if (price > 0) {
        const result = computePivots(estimatedHigh, estimatedLow, price, 5, symbol);
        srCache.set(symbol, { data: result, expiry: Date.now() + SR_CACHE_TTL });
        return result;
      }
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
    }
  }

  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_KEY is not set");
  }

  try {
    let url: string;
    let seriesKey: string;

    if (isForex || symbol.includes("/")) {
      const [from, to] = symbol.split("/");
      url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${encodeURIComponent(from)}&to_symbol=${encodeURIComponent(to)}&outputsize=compact&apikey=${apiKey}`;
      seriesKey = "Time Series FX (Daily)";
    } else {
      url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${apiKey}`;
      seriesKey = "Time Series (Daily)";
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage returned ${response.status}`);
    }

    const data = await response.json() as any;
    checkRateLimit(data);
    const series = data[seriesKey];

    if (!series) {
      throw new Error(`No daily data found for ${symbol}`);
    }

    const dates = Object.keys(series).sort().reverse();
    const prev = series[dates[1]] || series[dates[0]];

    const high = parseFloat(prev["2. high"]);
    const low = parseFloat(prev["3. low"]);
    const close = parseFloat(prev["4. close"]);

    const decimals = (isForex || symbol.includes("/")) ? 5 : 2;
    const result = computePivots(high, low, close, decimals, symbol);
    srCache.set(symbol, { data: result, expiry: Date.now() + SR_CACHE_TTL });
    return result;
  } catch (error) {
    console.error("Error fetching support/resistance:", error);
    throw error;
  }
}

export async function fetchForexRate(fromSymbol: string, toSymbol: string): Promise<ForexQuote> {
  const cacheKey = `${fromSymbol}/${toSymbol}`;
  const cached = forexCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) {
    throw new Error("ALPHA_VANTAGE_KEY is not set");
  }

  try {
    const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${encodeURIComponent(fromSymbol)}&to_currency=${encodeURIComponent(toSymbol)}&apikey=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Alpha Vantage returned ${response.status}`);
    }

    const data = await response.json() as any;
    checkRateLimit(data);
    const rate = data["Realtime Currency Exchange Rate"];

    if (!rate || Object.keys(rate).length === 0) {
      throw new Error(`No forex data found for ${fromSymbol}/${toSymbol}`);
    }

    const result: ForexQuote = {
      fromSymbol: rate["1. From_Currency Code"] || fromSymbol,
      toSymbol: rate["3. To_Currency Code"] || toSymbol,
      price: rate["5. Exchange Rate"] || "0",
      bid: rate["8. Bid Price"] || "0",
      ask: rate["9. Ask Price"] || "0",
      timestamp: rate["6. Last Refreshed"] || new Date().toISOString(),
    };
    forexCache.set(cacheKey, { data: result, expiry: Date.now() + QUOTE_CACHE_TTL });
    return result;
  } catch (error) {
    console.error("Error fetching forex rate:", error);
    throw error;
  }
}
