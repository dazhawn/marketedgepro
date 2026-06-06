// Classifies a trading symbol into one or more signal categories.
// Each category maps to a Discord channel and a subscription tier.

export type SignalCategory = "currency" | "metals" | "indices" | "crypto" | "other";

const METALS = new Set(["XAUUSD", "XAGUSD", "XPTUSD", "XAUEUR", "XAUGBP", "GOLD", "SILVER", "PLATINUM"]);

const CRYPTO = new Set([
  "BTC", "BTCUSD", "BTCUSDT", "XBTUSD", "BITCOIN",
  "ETH", "ETHUSD", "ETHUSDT", "ETHEREUM",
  "SOL", "SOLUSD", "SOLUSDT", "SOLANA",
  "BNB", "BNBUSD", "BNBUSDT",
  "XRP", "XRPUSD", "XRPUSDT", "RIPPLE",
  "ADA", "ADAUSD", "ADAUSDT", "CARDANO",
  "DOGE", "DOGEUSD", "DOGEUSDT",
  "MATIC", "MATICUSD", "MATICUSDT", "POLYGON",
  "DOT", "DOTUSD", "DOTUSDT", "POLKADOT",
  "AVAX", "AVAXUSD", "AVAXUSDT", "AVALANCHE",
  "LINK", "LINKUSD", "LINKUSDT", "CHAINLINK",
  "LTC", "LTCUSD", "LTCUSDT", "LITECOIN",
]);

const INDICES = new Set([
  "US30", "DJI", "DOW", "DJ30",
  "NAS100", "NDX", "US100", "NASDAQ",
  "SPX500", "SPX", "SP500", "US500",
  "UK100", "FTSE", "UKX",
  "DE40", "DAX", "GER40",
  "JP225", "NIKKEI",
  "AU200", "ASX200",
  "FR40", "CAC",
  "EU50", "STOXX50",
  "HK50", "HSI",
]);

const FOREX_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF",
  "SEK", "NOK", "DKK", "SGD", "HKD", "MXN", "ZAR", "TRY",
]);

export function classifySymbol(raw: string): SignalCategory {
  const s = raw.toUpperCase().replace(/[/\-_\s]/g, "");

  if (METALS.has(s)) return "metals";
  if (INDICES.has(s)) return "indices";
  if (CRYPTO.has(s)) return "crypto";

  // Forex: 6-char pair of two known currencies (e.g. EURUSD, GBPJPY)
  if (s.length === 6) {
    const base = s.slice(0, 3);
    const quote = s.slice(3, 6);
    if (FOREX_CURRENCIES.has(base) && FOREX_CURRENCIES.has(quote)) return "currency";
  }

  // Slash-separated pair: EUR/USD
  if (raw.includes("/")) {
    const [base, quote] = raw.toUpperCase().split("/");
    if (FOREX_CURRENCIES.has(base) && FOREX_CURRENCIES.has(quote)) return "currency";
  }

  return "other";
}

export function categoryLabel(cat: SignalCategory): string {
  return { currency: "Currency", metals: "Metals", indices: "Indices", crypto: "Crypto", other: "Signal" }[cat];
}
