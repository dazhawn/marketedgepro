import cron from "node-cron";
import { storage } from "../storage";
import { fetchMarketNews } from "./news";
import { fetchForexRate, fetchStockQuote } from "./market-data";
import { analyzeMarket } from "./ai-analysis";
import { sendMorningBrief } from "./discord";
import { fetchEconomicCalendar, getTodayEvents, getTomorrowEvents, filterByWatchlistCurrencies, type CalendarEvent } from "./economic-calendar";

let schedulerStarted = false;
let lastBriefDate: string | null = null;

export interface SymbolBrief {
  symbol: string;
  name: string;
  headlines: string[];
  direction: "BULLISH" | "BEARISH";
  confluenceScore: number;
  confidence: string;
  summary: string;
}

export async function buildSymbolBrief(symbol: string, name: string): Promise<SymbolBrief | null> {
  const articles = await fetchMarketNews(symbol);
  if (!articles.length) return null;

  const headlines = articles.slice(0, 3).map(a => `• ${a.title} *(${a.source})*`);
  const newsContext = articles.slice(0, 5).map(a => `- ${a.title} (${a.source})`).join("\n");

  let marketDataContext = "";
  try {
    if (symbol.includes("/")) {
      const [from, to] = symbol.split("/");
      const rate = await fetchForexRate(from, to);
      marketDataContext = `Current ${symbol} rate: ${rate.price}\nBid: ${rate.bid}, Ask: ${rate.ask}`;
    } else if (!symbol.startsWith("^")) {
      const quote = await fetchStockQuote(symbol);
      marketDataContext = `${symbol} Price: ${quote.price}\nChange: ${quote.change} (${quote.changePercent})\nHigh: ${quote.high}, Low: ${quote.low}`;
    }
  } catch { /* market data is optional */ }

  const aiResult = await analyzeMarket(symbol, "1D", newsContext, marketDataContext);

  return {
    symbol,
    name,
    headlines,
    direction: aiResult.direction as "BULLISH" | "BEARISH",
    confluenceScore: aiResult.confluenceScore,
    confidence: aiResult.confidence,
    summary: aiResult.summary,
  };
}

async function runMorningBrief(source: string) {
  // Guard against double-sending if server restarts multiple times in the 8-9am window
  const todayEST = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (lastBriefDate === todayEST) {
    console.log(`[scheduler] Morning brief already sent today (${todayEST}), skipping`);
    return;
  }
  lastBriefDate = todayEST;

  console.log(`[scheduler] Running 8am EST morning news brief (triggered by: ${source})...`);
  try {
    const watchlist = await storage.getWatchlist();
    if (!watchlist.length) {
      console.log("[scheduler] No watchlist items, skipping morning brief");
      return;
    }

    const briefs: SymbolBrief[] = [];
    for (const item of watchlist) {
      try {
        const brief = await buildSymbolBrief(item.symbol, item.name);
        if (brief) briefs.push(brief);
      } catch (err) {
        console.error(`[scheduler] Failed to build brief for ${item.symbol}:`, err);
      }
    }

    let calendarEvents: CalendarEvent[] = [];
    try {
      const allEvents = await fetchEconomicCalendar();
      const symbols = watchlist.map(w => w.symbol);
      const todayEvents = filterByWatchlistCurrencies(getTodayEvents(allEvents), symbols);
      const tomorrowEvents = filterByWatchlistCurrencies(getTomorrowEvents(allEvents), symbols);
      calendarEvents = [...todayEvents, ...tomorrowEvents]
        .filter(e => e.impact === "High" || e.impact === "Medium")
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } catch (err) {
      console.error("[scheduler] Failed to fetch economic calendar:", err);
    }

    if (briefs.length > 0) {
      await sendMorningBrief(briefs, calendarEvents);
      console.log(`[scheduler] Morning brief sent for ${briefs.length} symbols, ${calendarEvents.length} calendar events`);
    }
  } catch (err) {
    console.error("[scheduler] Morning brief failed:", err);
  }
}

function isMorningBriefWindow(): boolean {
  const now = new Date();
  const estHour = parseInt(
    now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }),
    10,
  );
  const estDay = now.toLocaleString("en-US", { weekday: "short", timeZone: "America/New_York" });
  const isWeekday = !["Sat", "Sun"].includes(estDay);
  // Fire if startup happens between 8:00am and 8:59am EST on a weekday
  return isWeekday && estHour === 8;
}

export function startScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Cron: 8:00 AM EST Mon-Fri
  cron.schedule("0 8 * * 1-5", async () => {
    await runMorningBrief("cron");
  }, {
    timezone: "America/New_York",
  });

  console.log("[scheduler] Morning brief scheduled for 8:00 AM EST (Mon-Fri)");

  // Startup recovery: if server boots during the 8am window (e.g. after a deployment),
  // fire the brief immediately rather than waiting until tomorrow.
  setTimeout(async () => {
    if (isMorningBriefWindow()) {
      console.log("[scheduler] Startup recovery: detected 8am EST window, firing morning brief now...");
      await runMorningBrief("startup-recovery");
    }
  }, 5000); // 5s delay to let DB connections settle

  // Keep-alive: ping own health endpoint every 4 minutes (only when APP_URL is set)
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    setInterval(async () => {
      try { await fetch(`${appUrl}/api/health`); } catch { /* silent */ }
    }, 4 * 60 * 1000);
    console.log("[scheduler] Keep-alive ping active →", appUrl);
  }
}
