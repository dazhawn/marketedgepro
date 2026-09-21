import cron from "node-cron";
import { checkChannelsAndReport } from "./discord-bot";
import { checkSignalFreshnessAndReport } from "./signal-freshness";
import { checkAlertExpiryAndReport } from "./alert-expiry";
import { storage } from "../storage";
import { fetchMarketNews } from "./news";
import { filterRelevantNews } from "./typesafe";
import { fetchForexRate, fetchStockQuote } from "./market-data";
import { analyzeMarket } from "./ai-analysis";
import { sendMorningBrief } from "./discord";
import { postMorningBriefViaBot, postBriefFailureViaBot, reportIssue } from "./discord-bot";
import { buildMarketPulse } from "./market-pulse";
import { gatherExtraBriefSections } from "./brief-sources";
import { fetchEconomicCalendar, getTodayEvents, getTomorrowEvents, filterByWatchlistCurrencies, type CalendarEvent } from "./economic-calendar";

let schedulerStarted = false;

// Key for the "brief already sent on this EST date" marker in the app_state
// table. It lives in Postgres rather than memory because a container restart
// used to wipe it, which is how briefs could silently skip a day.
const BRIEF_SENT_KEY = "morning_brief_last_sent_date";
// Separate marker so the retry sweep doesn't post the same failure notice on
// every attempt — members see it once per day, not four times.
const BRIEF_FAIL_NOTICE_KEY = "morning_brief_last_failure_notice_date";

/** Today's date in America/New_York as YYYY-MM-DD. */
function estToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

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
  const rawArticles = await fetchMarketNews(symbol);
  // Relevance filter — no-op unless TYPESAFE_NEWS_FILTER=1, and fails open.
  // The providers return anything that MENTIONS the symbol, which for an index
  // means constituent news and everywhere means roundups and price recaps.
  const articles = await filterRelevantNews(symbol, rawArticles);
  console.log(
    `[brief] ${symbol}: ${articles.length} articles` +
    (articles.length !== rawArticles.length ? ` (filtered from ${rawArticles.length})` : ""),
  );
  const headlines = articles.slice(0, 3).map(a => `• ${a.title} *(${a.source})*`);
  const newsContext = articles.length
    ? articles.slice(0, 5).map(a => `- ${a.title} (${a.source})`).join("\n")
    : `No recent news available for ${symbol}. Provide analysis based on market data and general context.`;

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
  } catch (err) {
    // Optional, but the AI writes a weaker brief without it — log so a
    // persistently failing quote feed is visible rather than invisible.
    console.warn(`[brief] ${symbol}: market data unavailable, analysing on news only:`, err);
  }

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
  // Guard against double-sending if the server restarts more than once in the
  // recovery window. The marker is only written after a SUCCESSFUL send, so a
  // failed attempt leaves the day open for a retry instead of burning it.
  const todayEST = estToday();
  try {
    if (await storage.getAppState(BRIEF_SENT_KEY) === todayEST) {
      console.log(`[scheduler] Morning brief already sent today (${todayEST}), skipping`);
      return;
    }
  } catch (err) {
    // Don't guess. This used to "proceed anyway", and on 21 Sep 2026 the 8:00
    // brief went out fine, then the database quota ran out, and the 11:30
    // retry sweep couldn't read the marker, re-ran the brief, failed on the
    // database, and posted "Morning brief failed" about a brief members had
    // already received. If the marker is unreadable the database is down, and
    // every step of the brief needs it — so there is nothing to gain by
    // trying. Report what we actually know, admin-only (members may well
    // already have today's brief), and leave the retry sweep to try again.
    console.error(`[scheduler] Could not read brief state (${source}), not attempting:`, err);
    await reportIssue(
      "Couldn't confirm today's morning brief",
      `The database is unavailable, so the ${source} run could not check whether today's ` +
      `brief (${todayEST}) was already sent. It was not re-attempted; if it hadn't gone out, ` +
      `the next scheduled retry will send it once the database is back.\n\n${String((err as Error)?.message ?? err)}`,
      { trigger: source, date: todayEST },
    );
    return;
  }

  console.log(`[scheduler] Running 8am EST morning news brief (triggered by: ${source})...`);
  try {
    const watchlist = await storage.getWatchlist();
    if (!watchlist.length) {
      console.log("[scheduler] No watchlist items, skipping morning brief");
      return;
    }

    // Build briefs + market pulse + extra sections in parallel (same as manual trigger)
    const [briefSettled, pulseResult, extras] = await Promise.all([
      Promise.allSettled(watchlist.map(w => buildSymbolBrief(w.symbol, w.name))),
      buildMarketPulse().catch(err => {
        console.error("[scheduler] Market pulse failed:", err);
        return undefined;
      }),
      gatherExtraBriefSections(),
    ]);
    const briefs: SymbolBrief[] = briefSettled
      .filter((r): r is PromiseFulfilledResult<SymbolBrief | null> => r.status === "fulfilled" && r.value != null)
      .map(r => r.value!);
    // Keep the rejection reasons so a total failure can report *why*.
    const briefFailures: string[] = briefSettled
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map(r => String(r.reason?.message ?? r.reason));
    const pulse = pulseResult ?? undefined;

    let calendarEvents: CalendarEvent[] = [];
    try {
      const allEvents = await fetchEconomicCalendar();
      const symbols = watchlist.map(w => w.symbol);
      const todayRaw    = getTodayEvents(allEvents);
      const tomorrowRaw = getTomorrowEvents(allEvents);
      // Always include ALL High-impact events (they move every market).
      // Only filter Medium events by watchlist currency relevance.
      const all = [...todayRaw, ...tomorrowRaw];
      const highOnly   = all.filter(e => e.impact === "High");
      const mediumRel  = filterByWatchlistCurrencies(all.filter(e => e.impact === "Medium"), symbols);
      calendarEvents = [...highOnly, ...mediumRel]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } catch (err) {
      console.error("[scheduler] Failed to fetch economic calendar:", err);
    }

    if (briefs.length === 0) {
      // Every symbol failed — almost always the AI provider being down, out of
      // credit, or rate limited. Say so out loud: a silent no-op here is what
      // let the brief go missing for weeks without anyone noticing.
      const reason = briefFailures[0] ?? "unknown error";
      console.error(`[scheduler] Morning brief produced no symbols. First failure: ${reason}`);
      await notifyBriefFailure(`No symbol briefs could be generated. First failure: ${reason}`);
      return; // leave today's marker unset so a later attempt can retry
    }

    // Prefer the Discord bot path (supports forum + text channels) when available
    if (process.env.DISCORD_BOT_TOKEN) {
      await postMorningBriefViaBot(briefs, calendarEvents, pulse, extras.stockAlerts, extras.pullbacks, extras.portfolio);
    } else {
      await sendMorningBrief(briefs, calendarEvents);
    }
    console.log(`[scheduler] Morning brief sent: ${briefs.length} symbols, ${calendarEvents.length} calendar events, pulse=${pulse ? "yes" : "no"}, si=${extras.stockAlerts.length}, pullbacks=${extras.pullbacks.picks.length}, ea=${extras.portfolio.accounts.length}`);

    // Only now is the day considered done.
    try {
      await storage.setAppState(BRIEF_SENT_KEY, todayEST);
    } catch (err) {
      console.error("[scheduler] Brief sent but marker write failed:", err);
    }
  } catch (err) {
    console.error("[scheduler] Morning brief failed:", err);
    // Subscribers get the short "brief is late" notice; the admin channel gets
    // the engineering detail. On 2026-08-25 the brief died on a Discord embed
    // limit and the only record was a log line nobody was watching.
    await reportIssue("Morning brief failed", err, { trigger: "scheduler" });
    await notifyBriefFailure(String((err as Error)?.message ?? err));
  }
}

/**
 * Posts a short failure notice so a broken brief is never silent — but at most
 * once per EST day, so the hourly retry sweep doesn't spam the channel.
 */
async function notifyBriefFailure(reason: string) {
  try {
    if (!process.env.DISCORD_BOT_TOKEN) return;
    const today = estToday();
    if (await storage.getAppState(BRIEF_FAIL_NOTICE_KEY) === today) {
      console.log("[scheduler] Failure notice already posted today, staying quiet");
      return;
    }
    const posted = await postBriefFailureViaBot(reason);
    if (posted) await storage.setAppState(BRIEF_FAIL_NOTICE_KEY, today);
  } catch (err) {
    console.error("[scheduler] Could not post brief failure notice:", err);
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
  // Any weekday boot from 8:00am up to noon EST is late but still useful, and
  // the persisted marker means a brief already sent today won't be repeated.
  // The old window was the 8am hour only, so a container that woke at 9:15
  // produced nothing at all for that day.
  return isWeekday && estHour >= 8 && estHour < 12;
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

  // Channel preflight. A channel ID survives renames and moves, so config
  // always looks correct; what breaks is permissions, silently. Run it at
  // 07:55 — five minutes ahead of the brief — so a break is reported to
  // #admin BEFORE the day's posts start failing, rather than being noticed
  // days later by the absence of an alert.
  cron.schedule("55 7 * * 1-5", async () => {
    await checkChannelsAndReport("pre-brief");
  }, {
    timezone: "America/New_York",
  });

  // And once at boot, so a deploy that lands mid-day still verifies itself.
  // Delayed past the 5s startup-recovery window to let the gateway connect.
  setTimeout(() => { void checkChannelsAndReport("startup"); }, 20_000);

  // Is the TradingView feed still alive? It is ~89% of signal volume and the
  // only major component with no scheduler of its own, so nothing else would
  // ever notice it going quiet. Runs after the US close, when a full trading
  // day's worth of evidence exists. See services/signal-freshness.ts for why
  // the rule counts market days rather than hours.
  cron.schedule("45 16 * * 1-5", async () => {
    await checkSignalFreshnessAndReport("post-close");
  }, {
    timezone: "America/New_York",
  });

  // Which TradingView alerts are about to expire? Runs every day including
  // weekends -- expiries do not respect the trading calendar, and a Saturday
  // expiry would otherwise be found on Monday. Reads a snapshot of the alert
  // list because Railway cannot reach the MCP connector; see alert-expiry.ts.
  cron.schedule("0 9 * * *", async () => {
    await checkAlertExpiryAndReport("daily");
  }, {
    timezone: "America/New_York",
  });



  // Startup recovery: if the server boots any weekday morning before noon and
  // today's brief hasn't gone out, send it rather than waiting until tomorrow.
  setTimeout(async () => {
    if (isMorningBriefWindow()) {
      console.log("[scheduler] Startup recovery: weekday morning boot, checking today's brief...");
      await runMorningBrief("startup-recovery");
    }
  }, 5000); // 5s delay to let DB connections settle

  // Retry sweep: if the 8am run failed (AI provider down, etc.) the day's marker
  // stays unset, so re-attempt hourly through the morning until one succeeds.
  cron.schedule("30 9-11 * * 1-5", async () => {
    await runMorningBrief("retry-sweep");
  }, {
    timezone: "America/New_York",
  });

  // Keep-alive: ping own health endpoint every 4 minutes (only when APP_URL is set)
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    setInterval(async () => {
      try { await fetch(`${appUrl}/api/health`); } catch { /* silent */ }
    }, 4 * 60 * 1000);
    console.log("[scheduler] Keep-alive ping active →", appUrl);
  }
}
