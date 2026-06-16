export interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
  sentiment?: string;
  sentimentScore?: number;
}

const REPUTABLE_SOURCES = new Set([
  "reuters",
  "bloomberg",
  "cnbc",
  "financial times",
  "wall street journal",
  "wsj",
  "marketwatch",
  "barron's",
  "barrons",
  "investing.com",
  "forex factory",
  "dailyfx",
  "fxstreet",
  "kitco",
  "kitco news",
  "benzinga",
  "seeking alpha",
  "yahoo finance",
  "yahoo! finance",
  "the motley fool",
  "motley fool",
  "zacks",
  "zacks investment research",
  "morningstar",
  "coindesk",
  "cointelegraph",
  "the block",
  "ap news",
  "associated press",
  "bbc",
  "bbc news",
  "cnn",
  "cnn business",
  "the guardian",
  "new york times",
  "the new york times",
  "washington post",
  "the washington post",
  "forbes",
  "business insider",
  "insider",
  "the economist",
  "ft.com",
  "marketbeat",
  "nasdaq",
  "globe newswire",
  "globenewswire",
  "pr newswire",
  "prnewswire",
  "accesswire",
  "business wire",
  "businesswire",
  "investor's business daily",
  "ibd",
  "trading economics",
  "fxempire",
  "fx empire",
  "thestreet",
  "the street",
  "stocktwits",
]);

function isReputableSource(source: string): boolean {
  const normalized = source.toLowerCase().trim();
  if (REPUTABLE_SOURCES.has(normalized)) return true;
  for (const reputable of REPUTABLE_SOURCES) {
    if (normalized.includes(reputable) || reputable.includes(normalized)) return true;
  }
  return false;
}

function mapAlphaVantageTopics(query: string): string {
  const q = query.toLowerCase();
  const topics: string[] = [];
  if (q.includes("forex") || q.includes("currency") || q.includes("eur") || q.includes("usd") || q.includes("gbp") || q.includes("jpy") || q.includes("aud") || q.includes("nzd")) {
    topics.push("forex");
  }
  if (q.includes("stock") || q.includes("s&p") || q.includes("nasdaq") || q.includes("equit") || q.includes("wall street") || q.includes("spy") || q.includes("qqq")) {
    topics.push("financial_markets", "economy_macro");
  }
  if (q.includes("gold") || q.includes("xau") || q.includes("precious") || q.includes("commodit")) {
    topics.push("economy_macro");
  }
  if (q.includes("crypto") || q.includes("bitcoin") || q.includes("btc") || q.includes("ethereum")) {
    topics.push("blockchain");
  }
  if (topics.length === 0) {
    topics.push("financial_markets");
  }
  return topics.join(",");
}

function parseSentimentLabel(score: number): string {
  if (score >= 0.35) return "Bullish";
  if (score >= 0.15) return "Somewhat Bullish";
  if (score > -0.15) return "Neutral";
  if (score > -0.35) return "Somewhat Bearish";
  return "Bearish";
}

export async function fetchAlphaVantageNews(query: string): Promise<NewsArticle[]> {
  const apiKey = process.env.ALPHA_VANTAGE_KEY;
  if (!apiKey) return [];

  try {
    const topics = mapAlphaVantageTopics(query);
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=${topics}&limit=15&apikey=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error("Alpha Vantage News error:", response.status);
      return [];
    }

    const data = await response.json() as any;

    if (!data.feed || !Array.isArray(data.feed)) {
      return [];
    }

    return data.feed.map((item: any) => {
      const sentimentScore = parseFloat(item.overall_sentiment_score) || 0;
      return {
        title: item.title || "Untitled",
        description: item.summary || null,
        url: item.url || "",
        source: item.source || "Alpha Vantage",
        publishedAt: item.time_published
          ? `${item.time_published.slice(0, 4)}-${item.time_published.slice(4, 6)}-${item.time_published.slice(6, 8)}T${item.time_published.slice(9, 11)}:${item.time_published.slice(11, 13)}:${item.time_published.slice(13, 15)}Z`
          : new Date().toISOString(),
        sentiment: parseSentimentLabel(sentimentScore),
        sentimentScore,
      };
    });
  } catch (error) {
    console.error("Error fetching Alpha Vantage news:", error);
    return [];
  }
}

export async function fetchNewsApiArticles(query: string): Promise<NewsArticle[]> {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=15&language=en&apiKey=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error("News API error:", response.status);
      return [];
    }

    const data = await response.json() as any;

    if (!data.articles || !Array.isArray(data.articles)) {
      return [];
    }

    return data.articles.map((article: any) => ({
      title: article.title || "Untitled",
      description: article.description || null,
      url: article.url || "",
      source: article.source?.name || "Unknown",
      publishedAt: article.publishedAt || new Date().toISOString(),
    }));
  } catch (error) {
    console.error("Error fetching NewsAPI articles:", error);
    return [];
  }
}

// Normalize symbol → human-readable search query for news engines
function newsQueryFor(symbol: string): string {
  const s = symbol.toUpperCase().replace(/[\/\-_\s]/g, "");
  const map: Record<string, string> = {
    XAUUSD: "gold price",
    XAGUSD: "silver price",
    XPTUSD: "platinum price",
    BTC: "bitcoin",
    BTCUSD: "bitcoin",
    ETH: "ethereum",
    ETHUSD: "ethereum",
    SOL: "solana cryptocurrency",
    "^IXIC": "nasdaq composite",
    "^GSPC": "S&P 500",
    "^DJI": "dow jones",
    SPY: "S&P 500",
    US30: "dow jones",
    NAS100: "nasdaq",
    SPX500: "S&P 500",
    UK100: "FTSE 100",
    DE40: "DAX",
    EURUSD: "EUR USD forex",
    GBPUSD: "GBP USD forex",
    USDJPY: "USD JPY forex",
    AUDUSD: "AUD USD forex",
    AUDNZD: "AUD NZD forex",
    USDCAD: "USD CAD forex",
  };
  return map[s] || `${symbol} forex trading`;
}

async function fetchGoogleNewsRss(query: string): Promise<NewsArticle[]> {
  try {
    // Google News RSS — free, no key, supports any search query
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
    // 8s timeout — Railway has a short ingress timeout and we don't want to hang the brief
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketEdgePro/1.0)" },
      signal: controller.signal,
    }).finally(() => clearTimeout(t));
    if (!res.ok) {
      console.warn(`[news] Google News non-200 for "${query}": ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    if (items.length === 0) {
      console.warn(`[news] Google News returned 0 items for "${query}" (xml ${xml.length} bytes)`);
    }

    return items.slice(0, 12).map(item => {
      // Google News uses CDATA for titles & wraps source name in the title after " - "
      const rawTitle = (item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1] ?? "").trim();
      const link     = item.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
      const pubDate  = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
      const sourceEl = item.match(/<source[^>]*>(.*?)<\/source>/)?.[1] ?? "";

      // Title format from Google News: "Headline text - Source Name"
      let title = rawTitle;
      let source = sourceEl || "Google News";
      const dashSplit = rawTitle.lastIndexOf(" - ");
      if (dashSplit > 0 && !sourceEl) {
        title  = rawTitle.substring(0, dashSplit).trim();
        source = rawTitle.substring(dashSplit + 3).trim();
      } else if (dashSplit > 0 && sourceEl) {
        title  = rawTitle.substring(0, dashSplit).trim();
      }

      return {
        title,
        description: null,
        url: link,
        source,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      };
    }).filter(a => a.title && a.title !== "Untitled");
  } catch (err) {
    console.error("[news] Google News RSS fetch failed:", err);
    return [];
  }
}

export async function fetchMarketNews(query: string = "forex trading market"): Promise<NewsArticle[]> {
  // Translate raw symbol into a friendlier search query (e.g. "XAUUSD" -> "gold price")
  const newsQuery = newsQueryFor(query);

  const [avArticles, newsApiArticles, googleArticles] = await Promise.all([
    fetchAlphaVantageNews(query),
    fetchNewsApiArticles(newsQuery),
    fetchGoogleNewsRss(newsQuery),
  ]);

  const seen = new Set<string>();
  const merged: NewsArticle[] = [];

  for (const article of [...avArticles, ...newsApiArticles, ...googleArticles]) {
    const key = article.title.toLowerCase().trim();
    if (!seen.has(key) && article.title !== "[Removed]") {
      seen.add(key);
      merged.push(article);
    }
  }

  merged.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  if (merged.length === 0) {
    console.warn(`[news] No articles returned for "${query}" (mapped to "${newsQuery}")`);
  }

  return merged;
}
