import type { Express } from "express";
import type { Server } from "http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { api } from "../shared/routes";
import { z } from "zod";
import { fetchMarketNews } from "./services/news";
import { fetchStockQuote, fetchForexRate, fetchSupportResistance, RateLimitError } from "./services/market-data";
import { analyzeMarket, getAiProviderStatus, type SignalContext } from "./services/ai-analysis";
import { sendDiscordAlert, sendSignalToDiscord, sendMorningBrief } from "./services/discord";
import { postSignalViaBot, postMorningBriefViaBot, getBotStatus } from "./services/discord-bot";
import { sendPhoneNotification } from "./services/notifications";
import { buildSymbolBrief } from "./services/scheduler";
import { buildMarketPulse } from "./services/market-pulse";
import { gatherExtraBriefSections } from "./services/brief-sources";
import { fetchEconomicCalendar, getTodayEvents, getTomorrowEvents, filterByHighImpact, filterByWatchlistCurrencies } from "./services/economic-calendar";
import { requireAuth } from "./auth";
import { readLiveSignals, readOptionsSignals, runScreener, screenerAvailable } from "./services/pullback-screener";
import { markPending, pendingModes, clearPending } from "./services/screener-queue";
import { getDbHealth } from "./services/db-health";
import { noteUnsavedSignal } from "./services/unsaved-signals";
import { normalizeAlerts, UPLOADED_SNAPSHOT_KEY } from "./services/alert-expiry";
import { postScreenerResultsViaBot, reportIssue } from "./services/discord-bot";
import { getCatalogue, type Tier } from "./services/settings-library";

const aiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

const morningBriefRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many morning brief requests, please try again later." },
});

const discordRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many Discord alert requests, please try again later." },
});

// Recognized tickers we can extract from plain-text alerts
const KNOWN_TICKERS = [
  // Forex
  "EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD",
  "EURGBP","EURJPY","GBPJPY","EURAUD","EURCAD","EURCHF","EURNZD",
  "GBPAUD","GBPCAD","GBPCHF","GBPNZD","AUDCAD","AUDCHF","AUDJPY",
  "AUDNZD","CADJPY","CHFJPY","NZDJPY","NZDCAD","NZDCHF","CADCHF",
  // Metals
  "XAUUSD","XAGUSD","XPTUSD","XAUEUR","XAUGBP","GOLD","SILVER","PLATINUM",
  // Indices
  "US30","NAS100","SPX500","UK100","DE40","JP225","AU200","FR40","EU50","HK50",
  "DJI","DOW","NDX","NASDAQ","SPX","SP500","FTSE","DAX",
  // Crypto
  "BTC","BTCUSD","BTCUSDT","ETH","ETHUSD","ETHUSDT","SOL","SOLUSD",
  "BNB","XRP","ADA","DOGE","MATIC","DOT","AVAX","LINK","LTC",
  // Stocks
  "SPY","QQQ","DIA","IWM","SNDK","AAPL","TSLA","NVDA","AMZN","MSFT","GOOGL","META",
];

function extractSymbol(raw: string): string | null {
  const upper = raw.toUpperCase();
  // First try slash-separated forex (EUR/USD)
  const slash = upper.match(/\b([A-Z]{3})\/([A-Z]{3})\b/);
  if (slash) return `${slash[1]}/${slash[2]}`;
  // Then ^prefixed indices (^IXIC, ^GSPC, ^DJI)
  const caret = upper.match(/\^[A-Z]{2,5}\b/);
  if (caret) return caret[0];
  // Finally, longest known ticker that appears as a whole word
  const candidates = KNOWN_TICKERS
    .filter(t => new RegExp(`\\b${t}\\b`).test(upper))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

// Parse a plain-text TradingView alert (e.g. "[Pullback] Price retraced to Tsl
// line within bear trend" or "[Chart TF] Main Trend turned Bullish") into a
// signal-shaped object. Returns null for unparseable / non-actionable alerts
// (e.g. price-cross alerts with no clear direction).
function parsePlainTextSignal(text: string): Record<string, unknown> | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  let signalType = "Indicator Alert";
  const tagMatch = raw.match(/^\[([^\]]+)\]/);
  if (tagMatch) signalType = tagMatch[1].trim().slice(0, 30);

  const lower = raw.toLowerCase();
  let direction: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (/\b(bull|bullish|buy|long|▲|turned bullish|turned up)\b/.test(lower)) direction = "BULLISH";
  else if (/\b(bear|bearish|sell|short|▼|turned bearish|turned down)\b/.test(lower)) direction = "BEARISH";

  const symbol = extractSymbol(raw);

  // Drop alerts that carry neither a recognized symbol nor a directional bias.
  // These are usually TradingView's built-in price-cross alerts ("XAUUSD
  // Crossing 4,102.581") which aren't real trade signals.
  if (!symbol && direction === "NEUTRAL") {
    console.log(`[webhook] Dropping plain-text alert with no symbol/direction: "${raw.substring(0, 80)}"`);
    return null;
  }

  return {
    symbol: symbol ?? "UNKNOWN",
    direction,
    signalType,
    message: raw || null,
  };
}

async function seedDatabase() {
  // Ensure waitlist table exists (auto-migrate for the intro page signup form)
  try {
    const { sql } = await import("drizzle-orm");
    const { db } = await import("./db.js");
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(30),
        source VARCHAR(60) DEFAULT 'intro',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    console.error("[seed] waitlist table create failed:", err);
  }

  // Seeding only matters on a brand-new, empty database — it must never be
  // able to stop the server from starting. This used to be unguarded: when
  // Neon's quota was exhausted in Sep 2026, getWatchlist threw, registerRoutes
  // rejected, httpServer.listen() was never reached, and every new deployment
  // failed its healthcheck. The running container survived only because it
  // had booted before the quota ran out — one restart from a total outage,
  // landing page included. A server with a sick database should still come up
  // and serve everything that doesn't need it.
  try {
    const existing = await storage.getWatchlist();
    if (existing.length === 0) {
      await storage.createWatchlistItem({ symbol: "EUR/USD", name: "Euro / US Dollar", type: "forex" });
      await storage.createWatchlistItem({ symbol: "USD/JPY", name: "US Dollar / Japanese Yen", type: "forex" });
      await storage.createWatchlistItem({ symbol: "AUD/NZD", name: "Australian Dollar / New Zealand Dollar", type: "forex" });
      await storage.createWatchlistItem({ symbol: "SPY", name: "S&P 500 ETF", type: "stock" });
      await storage.createWatchlistItem({ symbol: "^IXIC", name: "NASDAQ Composite", type: "stock" });
      await storage.createWatchlistItem({ symbol: "XAUUSD", name: "Gold / US Dollar", type: "commodity" });
      await storage.createWatchlistItem({ symbol: "BTC", name: "Bitcoin", type: "crypto" });
    }
  } catch (err) {
    console.error("[seed] watchlist seed skipped — database unavailable at boot:", err);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Point uptime monitoring HERE, not at /api/health — that one never touches
  // Postgres and stayed green through the whole Sep 2026 database outage.
  // Cached so frequent monitor polls can't keep Neon awake (services/db-health.ts).
  app.get("/api/health/deep", async (_req, res) => {
    const h = await getDbHealth();
    res.status(h.ok ? 200 : 503).json({
      ok: h.ok,
      db: h.ok ? "ok" : "down",
      checkedAt: new Date(h.checkedAt).toISOString(),
      latencyMs: h.latencyMs,
    });
  });

  // ── Auth endpoints (no auth required) ──────────────────────────────────────

  app.get("/api/auth/session", (req, res) => {
    if (req.session?.authenticated) {
      return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
  });

  app.post("/api/auth/login", (req, res) => {
    const { password } = req.body ?? {};
    const dashboardPassword = process.env.DASHBOARD_PASSWORD;
    if (!dashboardPassword) {
      return res.status(503).json({ message: "Server is not configured for authentication. Set DASHBOARD_PASSWORD." });
    }
    if (!password || password !== dashboardPassword) {
      return res.status(401).json({ message: "Invalid password" });
    }
    req.session.authenticated = true;
    req.session.save((err) => {
      if (err) {
        return res.status(500).json({ message: "Session error" });
      }
      // Return the webhook secret as a persistent token so the frontend
      // can store it in localStorage and stay authenticated across redeploys
      return res.json({ authenticated: true, token: process.env.SESSION_SECRET || "" });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Logout failed" });
      }
      res.clearCookie("connect.sid");
      return res.json({ authenticated: false });
    });
  });

  // ── Webhook endpoints (authenticated by webhook secret, not session) ────────

  app.post(api.signals.webhook.path, async (req, res) => {
    const webhookSecret = process.env.SESSION_SECRET;
    const authHeader = req.headers["x-webhook-secret"] as string | undefined;
    const querySecret = req.query.secret as string | undefined;
    if (!webhookSecret) {
      return res.status(503).json({ message: "Webhook secret not configured" });
    }
    if (authHeader !== webhookSecret && querySecret !== webhookSecret) {
      return res.status(401).json({ message: "Unauthorized: invalid or missing webhook secret" });
    }

    try {
      let body = req.body;
      console.log(`Webhook received: content-type=${req.headers["content-type"]}, body-type=${typeof body}, body=${typeof body === "string" ? body.substring(0, 500) : JSON.stringify(body).substring(0, 500)}`);

      // TradingView may send the alert as a JSON template OR as a plain-text
      // message (the indicator's native alerts). Accept both: if the body isn't
      // valid JSON, parse the plain text into a signal so nothing is dropped.
      if (typeof body === "string") {
        const trimmed = body.trim();
        try {
          body = JSON.parse(trimmed);
        } catch {
          body = parsePlainTextSignal(trimmed);
        }
      }

      if (!body || (typeof body === "object" && Object.keys(body).length === 0)) {
        return res.status(400).json({ message: "Empty request body. Ensure your TradingView alert message is not blank." });
      }

      // Reject signals that came through as fully UNKNOWN — these are
      // unparseable plain-text alerts (price-cross etc.) and would just
      // clutter Discord with "Signal Signal: UNKNOWN — NEUTRAL" cards.
      if (typeof body === "object" && body !== null) {
        const bSymbol    = (body as any).symbol;
        const bDirection = (body as any).direction;
        const bAction    = (body as any).action;
        const symLike    = bSymbol && bSymbol !== "UNKNOWN" && bSymbol !== "{{ticker}}";
        const dirLike    = (bDirection && bDirection !== "NEUTRAL") || bAction;
        if (!symLike && !dirLike) {
          console.log(`[webhook] Rejecting UNKNOWN/NEUTRAL signal: ${JSON.stringify(body).substring(0, 120)}`);
          return res.status(200).json({ ok: true, message: "Signal skipped — no recognizable symbol or direction" });
        }
      }

      let input;
      try {
        input = api.signals.webhook.input.parse(body);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
        }
        throw err;
      }

      // Acknowledge TradingView immediately (it times out after ~3s). All DB
      // writes, AI analysis, and Discord notifications run in the background.
      res.status(202).json({ ok: true, message: "Signal received" });

      void (async () => {
       try {
        const confluenceData: Record<string, unknown> = {};
        if (input.emaAlignment) confluenceData.emaAlignment = input.emaAlignment;
        if (input.rsiValue !== undefined) confluenceData.rsiValue = input.rsiValue;
        if (input.renkoTrend) confluenceData.renkoTrend = input.renkoTrend;
        if (input.mtfScore) confluenceData.mtfScore = input.mtfScore;
        if (input.confluenceCount !== undefined) confluenceData.confluenceCount = input.confluenceCount;
        if (input.sl != null) confluenceData.sl = input.sl;
        if (input.tp1 != null) confluenceData.tp1 = input.tp1;
        if (input.tp2 != null) confluenceData.tp2 = input.tp2;
        if (input.tp3 != null) confluenceData.tp3 = input.tp3;
        if (input.customData) confluenceData.customData = input.customData as Record<string, unknown>;

        // Save it — but a database failure must never stop members getting the
        // signal. This await used to sit outside every inner try, so when the
        // Neon quota ran out on 21 Sep 2026 each incoming signal threw here and
        // skipped all three Discord posts. Posting needs no database at all.
        let signalId: number | null = null;
        try {
          const signal = await storage.createSignal({
            symbol: input.symbol,
            timeframe: input.timeframe,
            direction: input.direction,
            signalType: input.signalType,
            price: input.price ?? null,
            confluenceData: Object.keys(confluenceData).length > 0 ? confluenceData as any : null,
            message: input.message ?? null,
            analyzed: false,
          });
          signalId = signal.id;
        } catch (err) {
          noteUnsavedSignal(`${input.symbol} ${input.timeframe}`, err);
        }

        const rawSignal = {
          symbol: input.symbol,
          timeframe: input.timeframe,
          direction: input.direction ?? "NEUTRAL",
          signalType: input.signalType ?? "Indicator Alert",
          price: input.price,
          sl: input.sl,
          tp1: input.tp1,
          tp2: input.tp2,
          tp3: input.tp3,
          emaAlignment: input.emaAlignment,
          rsiValue: input.rsiValue,
          renkoTrend: input.renkoTrend,
          mtfScore: input.mtfScore,
          confluenceCount: input.confluenceCount,
        };

        if (input.autoAnalyze) {
          // Run AI analysis first so Discord fires with the resolved direction
          try {
            let newsContext = "";
            try {
              const articles = await fetchMarketNews(input.symbol);
              newsContext = articles.slice(0, 5).map(a => `- ${a.title} (${a.source})`).join("\n");
            } catch { newsContext = "Unable to fetch news"; }

            let marketDataContext = "";
            try {
              if (input.symbol.includes("/")) {
                const [from, to] = input.symbol.split("/");
                const rate = await fetchForexRate(from, to);
                marketDataContext = `Current ${input.symbol} rate: ${rate.price}\nBid: ${rate.bid}, Ask: ${rate.ask}`;
              } else {
                const quote = await fetchStockQuote(input.symbol);
                marketDataContext = `${input.symbol} Price: ${quote.price}\nChange: ${quote.change} (${quote.changePercent})\nHigh: ${quote.high}, Low: ${quote.low}\nVolume: ${quote.volume}`;
              }
            } catch { marketDataContext = "Unable to fetch market data"; }

            const signalContext = {
              direction: input.direction,
              signalType: input.signalType,
              price: input.price,
              emaAlignment: input.emaAlignment ?? undefined,
              rsiValue: input.rsiValue ?? undefined,
              renkoTrend: input.renkoTrend ?? undefined,
              mtfScore: input.mtfScore ?? undefined,
              confluenceCount: input.confluenceCount ?? undefined,
            };

            const aiResult = await analyzeMarket(input.symbol, input.timeframe, newsContext, marketDataContext, undefined, signalContext);

            // Post FIRST with the AI-resolved direction. These writes used to
            // come before the post, so a database failure here threw into the
            // catch below and posted the raw signal, discarding the AI verdict
            // that had already been paid for.
            const outSignal = { ...rawSignal, direction: aiResult.direction };
            postSignalViaBot(outSignal).catch(err => console.error("Discord bot signal failed:", err));
            sendPhoneNotification(outSignal).catch(err => console.error("Phone notify failed:", err));

            // Then record the analysis — best effort, and only if the signal
            // itself was saved (there is nothing to attach it to otherwise).
            if (signalId !== null) {
              try {
                await storage.updateSignalDirection(signalId, aiResult.direction);
                await storage.createAnalysis({
                  symbol: input.symbol,
                  timeframe: input.timeframe,
                  direction: aiResult.direction,
                  confluenceScore: aiResult.confluenceScore,
                  aiSummary: aiResult.summary,
                  newsFactors: aiResult.newsFactors,
                  technicalFactors: aiResult.technicalFactors,
                  priceAtAnalysis: input.price?.toString() ?? null,
                  sentAlerted: false,
                  signalId,
                });
                await storage.markSignalAnalyzed(signalId);
              } catch (err) {
                console.error(`[webhook] signal ${signalId} posted, but saving its analysis failed:`, err);
              }
            }
          } catch (err) {
            // AI, news or market-data failure — post the raw signal instead.
            console.error("Auto-analyze failed for signal:", err);
            postSignalViaBot(rawSignal).catch(e => console.error("Discord bot signal failed:", e));
            sendPhoneNotification(rawSignal).catch(e => console.error("Phone notify failed:", e));
          }
        } else {
          postSignalViaBot(rawSignal).catch(err => console.error("Discord bot signal failed:", err));
          sendPhoneNotification(rawSignal).catch(err => console.error("Phone notify failed:", err));
        }

        console.log(`Signal ${signalId ?? "(not saved)"} processed`);
       } catch (bgErr) {
         console.error("Background signal processing failed:", bgErr);
       }
      })();
    } catch (error: any) {
      if (!res.headersSent) {
        res.status(500).json({ message: error.message || "Failed to process signal" });
      }
    }
  });

  // ── Read routes below are PUBLIC (viewers). Write/expensive/secret routes
  //    keep `requireAuth` so only the admin (logged in via DASHBOARD_PASSWORD)
  //    can mutate data or trigger paid AI/Discord calls. ────────────────────────

  app.get(api.analyses.list.path, async (_req, res) => {
    const result = await storage.getAnalyses();
    res.json(result);
  });

  app.get(api.analyses.get.path, async (req, res) => {
    const analysis = await storage.getAnalysis(Number(req.params.id));
    if (!analysis) {
      return res.status(404).json({ message: "Analysis not found" });
    }
    res.json(analysis);
  });

  app.post(api.analyses.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.analyses.create.input.parse(req.body);
      const analysis = await storage.createAnalysis(input);
      res.status(201).json(analysis);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.delete(api.analyses.delete.path, requireAuth, async (req, res) => {
    const deleted = await storage.deleteAnalysis(Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ message: "Analysis not found" });
    }
    res.status(204).end();
  });

  app.get(api.watchlist.list.path, async (_req, res) => {
    const result = await storage.getWatchlist();
    res.json(result);
  });

  app.post(api.watchlist.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.watchlist.create.input.parse(req.body);
      const item = await storage.createWatchlistItem(input);
      res.status(201).json(item);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      if (err?.code === '23505') {
        return res.status(400).json({ message: "Symbol already exists in watchlist" });
      }
      throw err;
    }
  });

  app.delete(api.watchlist.delete.path, requireAuth, async (req, res) => {
    const deleted = await storage.deleteWatchlistItem(Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ message: "Watchlist item not found" });
    }
    res.status(204).end();
  });

  app.get(api.news.get.path, async (req, res) => {
    try {
      const query = (req.query.q as string) || "forex trading market economy";
      const articles = await fetchMarketNews(query);
      res.json(articles);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch news" });
    }
  });

  app.get(api.marketData.get.path, async (req, res) => {
    try {
      const quote = await fetchStockQuote(req.params.symbol);
      res.json(quote);
    } catch (error: any) {
      res.status(404).json({ message: error.message || "Symbol not found" });
    }
  });

  app.get("/api/market-data/levels/:symbol", async (req, res) => {
    try {
      const symbol = req.params.symbol;
      const isForex = symbol.includes("/");
      const levels = await fetchSupportResistance(symbol, isForex);
      res.json(levels);
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        res.status(429).json({ message: error.message });
      } else {
        res.status(404).json({ message: error.message || "Could not fetch levels" });
      }
    }
  });

  app.get(api.marketData.forex.path, async (req, res) => {
    try {
      const rate = await fetchForexRate(req.params.fromSymbol, req.params.toSymbol);
      res.json(rate);
    } catch (error: any) {
      res.status(404).json({ message: error.message || "Forex pair not found" });
    }
  });

  app.post(api.aiAnalysis.analyze.path, requireAuth, aiRateLimiter, async (req, res) => {
    try {
      let input;
      try {
        input = api.aiAnalysis.analyze.input.parse(req.body);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
        }
        throw err;
      }

      let newsContext = "";
      try {
        const articles = await fetchMarketNews(input.symbol);
        newsContext = articles.slice(0, 5).map(a => `- ${a.title} (${a.source})`).join("\n");
      } catch { newsContext = "Unable to fetch news"; }

      let marketDataContext = "";
      try {
        if (input.symbol.includes("/")) {
          const [from, to] = input.symbol.split("/");
          const rate = await fetchForexRate(from, to);
          marketDataContext = `Current ${input.symbol} rate: ${rate.price}\nBid: ${rate.bid}, Ask: ${rate.ask}`;
        } else {
          const quote = await fetchStockQuote(input.symbol);
          marketDataContext = `${input.symbol} Price: ${quote.price}\nChange: ${quote.change} (${quote.changePercent})\nHigh: ${quote.high}, Low: ${quote.low}\nVolume: ${quote.volume}`;
        }
      } catch { marketDataContext = "Unable to fetch market data"; }

      let signalData: SignalContext | undefined;
      let usedSignalId: number | undefined;
      if (input.signalId) {
        const signal = await storage.getSignal(input.signalId);
        if (signal) {
          usedSignalId = signal.id;
          signalData = {
            direction: signal.direction,
            signalType: signal.signalType,
            price: signal.price,
            emaAlignment: signal.confluenceData?.emaAlignment,
            rsiValue: signal.confluenceData?.rsiValue,
            renkoTrend: signal.confluenceData?.renkoTrend,
            mtfScore: signal.confluenceData?.mtfScore,
            confluenceCount: signal.confluenceData?.confluenceCount,
          };
        }
      } else {
        const latestSignal = await storage.getLatestSignalForSymbol(input.symbol);
        if (latestSignal && !latestSignal.analyzed) {
          usedSignalId = latestSignal.id;
          signalData = {
            direction: latestSignal.direction,
            signalType: latestSignal.signalType,
            price: latestSignal.price,
            emaAlignment: latestSignal.confluenceData?.emaAlignment,
            rsiValue: latestSignal.confluenceData?.rsiValue,
            renkoTrend: latestSignal.confluenceData?.renkoTrend,
            mtfScore: latestSignal.confluenceData?.mtfScore,
            confluenceCount: latestSignal.confluenceData?.confluenceCount,
          };
        }
      }

      const result = await analyzeMarket(input.symbol, input.timeframe, newsContext, marketDataContext, input.context, signalData);
      
      if (usedSignalId) {
        await storage.markSignalAnalyzed(usedSignalId);
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message || "AI analysis failed" });
    }
  });

  app.post(api.discord.send.path, requireAuth, discordRateLimiter, async (req, res) => {
    try {
      const input = api.discord.send.input.parse(req.body);
      const success = await sendDiscordAlert(input);
      if (!success) {
        return res.status(502).json({ message: "Discord webhook delivery failed" });
      }
      res.json({ success: true });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      res.status(500).json({ message: err.message || "Failed to send Discord alert" });
    }
  });

  app.get("/api/signals/webhook-info", requireAuth, (_req, res) => {
    res.json({ secret: process.env.SESSION_SECRET || "" });
  });

  // Public waitlist signup — used by the intro page
  const waitlistRateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
  app.post("/api/waitlist", waitlistRateLimiter, async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email("Valid email is required"),
        phone: z.string().optional().nullable(),
        source: z.string().optional(),
      });
      const data = schema.parse(req.body ?? {});
      const phone = data.phone?.trim() || null;
      const entry = await storage.addToWaitlist({
        email: data.email.trim().toLowerCase(),
        phone,
        source: data.source ?? "intro",
      });
      res.json({ ok: true, id: entry.id });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: err?.message ?? "Failed to join waitlist" });
    }
  });

  // Public: spots remaining counter for the founding-member offer
  app.get("/api/waitlist/count", async (_req, res) => {
    const max   = Number(process.env.FOUNDING_MAX_SPOTS ?? 100);
    const total = (await storage.getWaitlist()).length;
    res.json({ total, max, remaining: Math.max(0, max - total) });
  });

  // Admin: list + delete waitlist entries
  app.get("/api/waitlist", requireAuth, async (_req, res) => {
    res.json(await storage.getWaitlist());
  });

  app.delete("/api/waitlist/:id", requireAuth, async (req, res) => {
    const ok = await storage.deleteWaitlistEntry(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  // Public endpoint used by landing page — just the marketing-safe bits
  app.get("/api/settings/notifications-public", (_req, res) => {
    res.json({
      discordInvite: process.env.DISCORD_INVITE_URL ?? null,
    });
  });

  // Returns which notification channels are currently configured (no secrets exposed)
  app.get("/api/settings/notifications", requireAuth, (_req, res) => {
    const ai = getAiProviderStatus();
    const bot = getBotStatus();
    res.json({
      pushover: !!(process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER_KEY),
      telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      ntfy: !!process.env.NTFY_TOPIC,
      aiProvider: ai.provider,
      aiModel: ai.model,
      aiConfigured: ai.configured,
      discordBot: bot.configured,
      discordChannels: bot.channels,
    });
  });

  app.get(api.signals.list.path, async (_req, res) => {
    const result = await storage.getSignals();
    res.json(result);
  });

  app.get(api.signals.get.path, async (req, res) => {
    const signal = await storage.getSignal(Number(req.params.id));
    if (!signal) {
      return res.status(404).json({ message: "Signal not found" });
    }
    res.json(signal);
  });

  app.get("/api/economic-calendar", async (_req, res) => {
    try {
      const events = await fetchEconomicCalendar();
      const today = getTodayEvents(events);
      const tomorrow = getTomorrowEvents(events);
      res.json({
        today: today.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        tomorrow: tomorrow.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        thisWeek: filterByHighImpact(events).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to fetch economic calendar" });
    }
  });

  // Test endpoint: fires a sample signal through the full webhook pipeline
  // so the user can verify Discord routing without setting up a TradingView alert.
  app.post("/api/signals/test-alert", requireAuth, async (req, res) => {
    try {
      const { symbol = "XAUUSD", action = "BUY" } = req.body ?? {};
      const direction = action.toUpperCase() === "SELL" ? "BEARISH" : "BULLISH";
      const isBull = direction === "BULLISH";

      // Fetch the LIVE price from Yahoo Finance instead of hardcoding stale defaults
      let price = 0;
      try {
        const quote = await fetchStockQuote(symbol);
        price = parseFloat(quote.price);
      } catch {
        // Fallback only if Yahoo lookup fails
        // Hardcoded fallbacks — update when prices drift far from these
        const FALLBACK_PRICES: Record<string, number> = {
          XAUUSD: 4365,   // Gold
          XAGUSD: 31,     // Silver
          XPTUSD: 950,    // Platinum
          BTC: 95000,     // Bitcoin
          ETH: 3400,      // Ethereum
          "EUR/USD": 1.085,
          "GBP/USD": 1.27,
          "USD/JPY": 155,
          "AUD/NZD": 1.10,
          SPY: 600,
          "^IXIC": 19500,
          US30: 44000,
          NAS100: 21000,
          SPX500: 6000,
        };
        price = FALLBACK_PRICES[symbol] ?? 100;
      }
      const offset = price * 0.005;

      const testSignal = {
        symbol,
        timeframe: "1H",
        direction,
        signalType: "Test Alert",
        price,
        entry: price,
        sl:  isBull ? price - offset : price + offset,
        tp1: isBull ? price + offset : price - offset,
        tp2: isBull ? price + offset * 2 : price - offset * 2,
        tp3: isBull ? price + offset * 3 : price - offset * 3,
        message: "🧪 Test alert from MarketEdgePro settings page",
      };

      // Route through Discord bot
      const { postSignalViaBot } = await import("./services/discord-bot.js");
      await postSignalViaBot({
        symbol: testSignal.symbol,
        timeframe: testSignal.timeframe,
        direction: testSignal.direction,
        signalType: testSignal.signalType,
        price: testSignal.price,
        sl: testSignal.sl,
        tp1: testSignal.tp1,
        tp2: testSignal.tp2,
        tp3: testSignal.tp3,
      });

      res.json({ ok: true, sent: testSignal });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Test alert failed" });
    }
  });

  app.post("/api/morning-brief/trigger", requireAuth, morningBriefRateLimiter, async (_req, res) => {
    try {
      const watchlist = await storage.getWatchlist();
      if (!watchlist.length) {
        return res.json({ sent: false, message: "No watchlist items" });
      }
      // Build all briefs + market pulse + extra sections in parallel
      const [briefResults, pulseResult, extras] = await Promise.all([
        Promise.allSettled(watchlist.map((item: any) => buildSymbolBrief(item.symbol, item.name))),
        buildMarketPulse().catch(err => {
          console.error("[morning-brief] pulse failed:", err);
          return undefined;
        }),
        gatherExtraBriefSections(),
      ]);
      const briefs = briefResults
        .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled" && r.value != null)
        .map(r => r.value);
      const pulse = pulseResult ?? undefined;
      if (!briefs.length) {
        return res.json({ sent: false, message: "No data found" });
      }
      let calendarEvents: any[] = [];
      try {
        const allEvents = await fetchEconomicCalendar();
        const symbols = watchlist.map((w: any) => w.symbol);
        const all = [...getTodayEvents(allEvents), ...getTomorrowEvents(allEvents)];
        // Always include High-impact (they affect every market);
        // only filter Medium by watchlist currency relevance.
        const highOnly  = all.filter(e => e.impact === "High");
        const mediumRel = filterByWatchlistCurrencies(all.filter(e => e.impact === "Medium"), symbols);
        calendarEvents = [...highOnly, ...mediumRel]
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      } catch (err) {
        // Optional section, but silence here means a permanently broken
        // calendar feed degrades the brief forever with nobody noticing.
        console.warn("[morning-brief] economic calendar unavailable, section omitted:", err);
      }
      // Use Discord bot if configured, fall back to webhook
      const sent = process.env.DISCORD_BOT_TOKEN
        ? await postMorningBriefViaBot(briefs, calendarEvents, pulse, extras.stockAlerts, extras.pullbacks, extras.portfolio)
        : await sendMorningBrief(briefs, calendarEvents);
      res.json({
        sent,
        symbolCount: briefs.length,
        calendarEventCount: calendarEvents.length,
        pulseItems: pulse?.items.length ?? 0,
        stockAlertCount: extras.stockAlerts.length,
        pullbackCount: extras.pullbacks.picks.length,
        eaAccountCount: extras.portfolio.accounts.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to send morning brief" });
    }
  });

  // ── Smart Pullback Screener ─────────────────────────────────────────────────
  // The Python screeners run on the trading PC and PUSH results here (the cloud
  // instance has no Python/scripts). DB is the source of truth; reading the
  // local CSVs remains as a fallback for local development on the PC.

  async function latestScreenerResults(mode: "live" | "options") {
    const run = await storage.getLatestScreenerRun(mode);
    if (run) return { rows: run.rows as any[], meta: run.meta };
    return mode === "live" ? readLiveSignals() : readOptionsSignals();
  }

  app.get("/api/screener/live", requireAuth, async (_req, res) => {
    try {
      res.json(await latestScreenerResults("live"));
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to read live signals" });
    }
  });

  app.get("/api/screener/options", requireAuth, async (_req, res) => {
    try {
      res.json(await latestScreenerResults("options"));
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to read options signals" });
    }
  });

  // TradingView alert snapshot upload (authenticated by webhook secret).
  // Posted daily by a scheduled task that reads the live alert list through
  // the TradingView Remix connector; the 9:00 expiry check reads it back.
  // Called about once a day, so it doesn't threaten Neon's idle suspend.
  app.post("/api/alerts/snapshot", async (req, res) => {
    const webhookSecret = process.env.SESSION_SECRET;
    const headerSecret = req.headers["x-webhook-secret"] as string | undefined;
    if (!webhookSecret || headerSecret !== webhookSecret) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // Accept { alerts: [...] } or the bare array the connector returns.
    const raw = Array.isArray(req.body) ? req.body : req.body?.alerts;
    const alerts = normalizeAlerts(raw);
    if (!alerts) {
      // An empty or malformed list is refused rather than stored: a failed
      // fetch must never wipe the snapshot and silence every warning.
      return res.status(400).json({
        message: "Expected a non-empty array of alerts, each with an id, symbol and expiration.",
      });
    }
    const snapshotAt = new Date().toISOString();
    try {
      await storage.setAppState(UPLOADED_SNAPSHOT_KEY, JSON.stringify({ snapshotAt, alerts }));
      const next = alerts
        .filter(a => a.active && Date.parse(a.expiration) > Date.now())
        .sort((a, b) => Date.parse(a.expiration) - Date.parse(b.expiration))[0];
      console.log(`[expiry] snapshot uploaded: ${alerts.length} alerts at ${snapshotAt}`);
      res.json({
        ok: true,
        snapshotAt,
        count: alerts.length,
        nextExpiry: next ? { symbol: next.symbol, kind: next.kind, expiration: next.expiration } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to store alert snapshot" });
    }
  });

  // Upload endpoint for the trading PC (authenticated by webhook secret).
  app.post("/api/screener/results", async (req, res) => {
    const webhookSecret = process.env.SESSION_SECRET;
    const headerSecret = req.headers["x-webhook-secret"] as string | undefined;
    if (!webhookSecret || headerSecret !== webhookSecret) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const mode = req.body?.mode === "options" ? "options" : req.body?.mode === "live" ? "live" : null;
    const rows = req.body?.rows;
    const meta = req.body?.meta;
    if (!mode || !Array.isArray(rows) || !meta?.file || !meta?.runAt) {
      return res.status(400).json({ message: "Expected { mode: 'live'|'options', rows: [], meta: { file, runAt, count } }" });
    }
    try {
      const run = await storage.saveScreenerRun(mode, rows, { ...meta, count: rows.length });
      console.log(`[screener] Stored ${mode} upload: ${rows.length} rows from ${meta.file}`);

      // Post to Discord here rather than leaving it to a separate call. The
      // only other trigger is POST /api/screener/post-discord, which sits
      // behind requireAuth — a browser session the screener does not have and
      // cannot get. So nothing called it: results uploaded every morning and
      // silently never reached the channel. Storing and publishing are one
      // job, and this is the only place automation can authenticate.
      //
      // Never fatal: a Discord outage must not fail the upload, or the run's
      // results are lost as well as unpublished. The outcome is returned so
      // the uploader's own log shows whether it posted.
      let discord: { sent: boolean; reason?: string } = { sent: false, reason: "not attempted" };
      try {
        discord = await postScreenerResultsViaBot(mode, rows, { ...meta, count: rows.length });
        if (discord.sent) {
          console.log(`[screener] Posted ${mode} results to Discord (${rows.length} rows)`);
        } else {
          console.warn(`[screener] Discord post skipped for ${mode}: ${discord.reason}`);
          await reportIssue("Screener results not posted to Discord", discord.reason ?? "unknown", { mode, rows: String(rows.length), file: String(meta.file) });
        }
      } catch (err: any) {
        discord = { sent: false, reason: err?.message ?? String(err) };
        console.error(`[screener] Discord post FAILED for ${mode}:`, err);
        await reportIssue("Screener results not posted to Discord", err, { mode, rows: String(rows.length), file: String(meta.file) });
      }

      res.json({ ok: true, id: run.id, mode, count: rows.length, discord });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to store screener results" });
    }
  });

  app.post("/api/screener/run", requireAuth, async (req, res) => {
    const mode = req.body?.mode === "options" ? "options" : "live";
    // On the trading PC (local dev) the Python scripts exist — run directly.
    if (screenerAvailable(mode)) {
      try {
        const { pid } = runScreener(mode);
        return res.json({ started: true, mode, pid });
      } catch (err: any) {
        return res.status(500).json({ message: err?.message ?? "Failed to launch screener" });
      }
    }
    // In the cloud, queue a request the PC poller will pick up (within ~5 min).
    try {
      await storage.createScreenerRequest(mode);
      markPending(mode);
      res.json({
        queued: true,
        mode,
        message:
          `${mode === "live" ? "Live" : "Options"} screener requested. The trading PC will run it ` +
          "within a few minutes and fresh results will appear here automatically.",
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to queue screener run" });
    }
  });

  // Poller endpoints (trading PC, authenticated by webhook secret).
  app.get("/api/screener/pending", async (req, res) => {
    const webhookSecret = process.env.SESSION_SECRET;
    const headerSecret = req.headers["x-webhook-secret"] as string | undefined;
    if (!webhookSecret || headerSecret !== webhookSecret) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    try {
      // Answered from memory, not Postgres. This is polled every 5 minutes,
      // and a query that often kept Neon's compute from ever suspending —
      // see services/screener-queue.ts.
      res.json({ modes: await pendingModes() });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to read pending requests" });
    }
  });

  app.post("/api/screener/fulfill", async (req, res) => {
    const webhookSecret = process.env.SESSION_SECRET;
    const headerSecret = req.headers["x-webhook-secret"] as string | undefined;
    if (!webhookSecret || headerSecret !== webhookSecret) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const mode = req.body?.mode === "options" ? "options" : req.body?.mode === "live" ? "live" : null;
    if (!mode) return res.status(400).json({ message: "Expected { mode: 'live'|'options' }" });
    clearPending(mode);
    try {
      const cleared = await storage.fulfillScreenerRequests(mode);
      res.json({ ok: true, mode, cleared });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to fulfill requests" });
    }
  });

  app.post("/api/screener/post-discord", requireAuth, async (req, res) => {
    const mode = req.body?.mode === "options" ? "options" : "live";
    try {
      const { rows, meta } = await latestScreenerResults(mode);
      if (!rows.length) return res.json({ sent: false, message: "No results to post" });
      const { sent, reason } = await postScreenerResultsViaBot(mode, rows as any, meta);
      res.json({ sent, count: rows.length, message: reason });
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to post to Discord" });
    }
  });

  // ── Settings Library ─────────────────────────────────────────────────────
  // Read-only catalogue of tuned Renko + MTF Confluence configurations.
  // Sweeps run offline and publish server/data/settings-configs.json; nothing
  // is computed here. Tier gating is applied server-side so a locked entry's
  // metrics and settings never reach the browser.
  app.get("/api/settings/configs.json", requireAuth, async (_req, res) => {
    try {
      // No subscriber accounts yet — the page is admin-only, so the viewer sees
      // the whole catalogue. When subscriber tiers land, read the tier off the
      // authenticated user here instead of the env default.
      const viewerTier = (process.env.SETTINGS_DEFAULT_TIER as Tier) || "strategy";
      res.json(getCatalogue(viewerTier));
    } catch (err: any) {
      res.status(500).json({ message: err?.message ?? "Failed to read settings catalogue" });
    }
  });

  await seedDatabase();

  return httpServer;
}
