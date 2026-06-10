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
import { forwardToSignalCopier } from "./services/signal-copier";
import { buildSymbolBrief } from "./services/scheduler";
import { buildMarketPulse } from "./services/market-pulse";
import { fetchEconomicCalendar, getTodayEvents, getTomorrowEvents, filterByHighImpact, filterByWatchlistCurrencies } from "./services/economic-calendar";
import { requireAuth } from "./auth";

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
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

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

            // Write AI direction back to the signal record
            await storage.updateSignalDirection(signal.id, aiResult.direction);

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
              signalId: signal.id,
            });

            await storage.markSignalAnalyzed(signal.id);

            // Send Discord with the AI-resolved direction
            const outSignal = {
              symbol: input.symbol,
              timeframe: input.timeframe,
              direction: aiResult.direction,
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
            postSignalViaBot(outSignal).catch(err => console.error("Discord bot signal failed:", err));
            sendPhoneNotification(outSignal).catch(err => console.error("Phone notify failed:", err));
            forwardToSignalCopier(outSignal).catch(err => console.error("Signal copier failed:", err));
          } catch (err) {
            console.error("Auto-analyze failed for signal:", err);
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
            postSignalViaBot(rawSignal).catch(e => console.error("Discord bot signal failed:", e));
            sendPhoneNotification(rawSignal).catch(e => console.error("Phone notify failed:", e));
            forwardToSignalCopier(rawSignal).catch(e => console.error("Signal copier failed:", e));
          }
        } else {
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
        postSignalViaBot(rawSignal).catch(err => console.error("Discord bot signal failed:", err));
        sendPhoneNotification(rawSignal).catch(err => console.error("Phone notify failed:", err));
        forwardToSignalCopier(rawSignal).catch(err => console.error("Signal copier failed:", err));
        }

        console.log(`Signal ${signal.id} processed`);
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
      signalCopierUrl: process.env.SIGNAL_COPIER_SIGNUP_URL ?? null,
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
      signalCopier: !!process.env.SIGNAL_COPIER_ENABLED,
      signalCopierUrl: process.env.SIGNAL_COPIER_SIGNUP_URL ?? null,
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
      // Build all briefs + market pulse in parallel
      const [briefResults, pulseResult] = await Promise.all([
        Promise.allSettled(watchlist.map((item: any) => buildSymbolBrief(item.symbol, item.name))),
        buildMarketPulse().catch(err => {
          console.error("[morning-brief] pulse failed:", err);
          return undefined;
        }),
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
        const todayEvents = filterByWatchlistCurrencies(getTodayEvents(allEvents), symbols);
        const tomorrowEvents = filterByWatchlistCurrencies(getTomorrowEvents(allEvents), symbols);
        calendarEvents = [...todayEvents, ...tomorrowEvents]
          .filter(e => e.impact === "High" || e.impact === "Medium")
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      } catch { /* calendar is optional */ }
      // Use Discord bot if configured, fall back to webhook
      const sent = process.env.DISCORD_BOT_TOKEN
        ? await postMorningBriefViaBot(briefs, calendarEvents, pulse)
        : await sendMorningBrief(briefs, calendarEvents);
      res.json({ sent, symbolCount: briefs.length, calendarEventCount: calendarEvents.length, pulseItems: pulse?.items.length ?? 0 });
    } catch (error: any) {
      res.status(500).json({ message: error.message || "Failed to send morning brief" });
    }
  });

  await seedDatabase();

  return httpServer;
}
