import { z } from 'zod';
import { insertAnalysisSchema, insertWatchlistSchema, insertSignalSchema, analyses, watchlist, signals } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  analyses: {
    list: {
      method: 'GET' as const,
      path: '/api/analyses' as const,
      responses: {
        200: z.array(z.custom<typeof analyses.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/analyses/:id' as const,
      responses: {
        200: z.custom<typeof analyses.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/analyses' as const,
      input: insertAnalysisSchema,
      responses: {
        201: z.custom<typeof analyses.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/analyses/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  watchlist: {
    list: {
      method: 'GET' as const,
      path: '/api/watchlist' as const,
      responses: {
        200: z.array(z.custom<typeof watchlist.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/watchlist' as const,
      input: insertWatchlistSchema,
      responses: {
        201: z.custom<typeof watchlist.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/watchlist/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  news: {
    get: {
      method: 'GET' as const,
      path: '/api/news' as const,
      responses: {
        200: z.array(z.object({
          title: z.string(),
          description: z.string().nullable(),
          url: z.string(),
          source: z.string(),
          publishedAt: z.string(),
          sentiment: z.string().optional(),
          sentimentScore: z.number().optional(),
        })),
      },
    },
  },
  marketData: {
    get: {
      method: 'GET' as const,
      path: '/api/market-data/:symbol' as const,
      responses: {
        200: z.object({
          symbol: z.string(),
          price: z.string(),
          change: z.string(),
          changePercent: z.string(),
          high: z.string(),
          low: z.string(),
          volume: z.string(),
          timestamp: z.string(),
        }),
        404: errorSchemas.notFound,
      },
    },
    forex: {
      method: 'GET' as const,
      path: '/api/market-data/forex/:fromSymbol/:toSymbol' as const,
      responses: {
        200: z.object({
          fromSymbol: z.string(),
          toSymbol: z.string(),
          price: z.string(),
          bid: z.string(),
          ask: z.string(),
          timestamp: z.string(),
        }),
      },
    },
  },
  aiAnalysis: {
    analyze: {
      method: 'POST' as const,
      path: '/api/ai/analyze' as const,
      input: z.object({
        symbol: z.string(),
        timeframe: z.string(),
        context: z.string().optional(),
        signalId: z.number().optional(),
      }),
      responses: {
        200: z.object({
          direction: z.string(),
          confluenceScore: z.number(),
          summary: z.string(),
          newsFactors: z.array(z.string()),
          technicalFactors: z.array(z.string()),
          confidence: z.string(),
        }),
      },
    },
  },
  discord: {
    send: {
      method: 'POST' as const,
      path: '/api/discord/alert' as const,
      input: z.object({
        symbol: z.string(),
        direction: z.string(),
        confluenceScore: z.number(),
        summary: z.string(),
        price: z.string().optional(),
      }),
      responses: {
        200: z.object({ success: z.boolean() }),
      },
    },
  },
  signals: {
    list: {
      method: 'GET' as const,
      path: '/api/signals' as const,
      responses: {
        200: z.array(z.custom<typeof signals.$inferSelect>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/signals/:id' as const,
      responses: {
        200: z.custom<typeof signals.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    webhook: {
      method: 'POST' as const,
      path: '/api/signals/webhook' as const,
      input: z.object({
        symbol: z.string().default("UNKNOWN"),
        timeframe: z.string().default("1H"),
        direction: z.string().default("NEUTRAL"),
        action: z.string().nullable().optional(), // accepts BUY/SELL/LONG/SHORT — normalized into direction below
        signalType: z.string().default("Indicator Alert"),
        message: z.string().nullable().optional(),
        price: z.number().nullable().optional(),
        entry: z.number().nullable().optional(),
        emaAlignment: z.string().nullable().optional(),
        rsiValue: z.number().nullable().optional(),
        renkoTrend: z.string().nullable().optional(),
        mtfScore: z.string().nullable().optional(),
        confluenceCount: z.number().nullable().optional(),
        sl: z.number().nullable().optional(),
        tp1: z.number().nullable().optional(),
        tp2: z.number().nullable().optional(),
        tp3: z.number().nullable().optional(),
        autoAnalyze: z.boolean().nullable().optional(),
        alert_message: z.string().nullable().optional(),
      }).transform((data) => {
        // Normalize `action` field to `direction` if direction wasn't supplied
        if (data.action && data.direction === "NEUTRAL") {
          const a = data.action.toUpperCase();
          if (a === "BUY" || a === "LONG" || a === "1") data.direction = "BULLISH";
          else if (a === "SELL" || a === "SHORT" || a === "-1") data.direction = "BEARISH";
        }
        // Use entry as price fallback so SL/TP show correctly
        if (data.entry != null && data.price == null) data.price = data.entry;
        return data;
      }),
      responses: {
        202: z.object({ ok: z.boolean(), message: z.string() }),
        400: errorSchemas.validation,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type AnalysisInput = z.infer<typeof api.analyses.create.input>;
export type AiAnalyzeInput = z.infer<typeof api.aiAnalysis.analyze.input>;
export type DiscordAlertInput = z.infer<typeof api.discord.send.input>;
export type WatchlistInput = z.infer<typeof api.watchlist.create.input>;
export type SignalWebhookInput = z.infer<typeof api.signals.webhook.input>;
