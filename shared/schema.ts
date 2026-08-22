import { pgTable, text, serial, timestamp, varchar, jsonb, integer, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  confluenceScore: integer("confluence_score").notNull(),
  aiSummary: text("ai_summary").notNull(),
  newsFactors: jsonb("news_factors").$type<string[]>(),
  technicalFactors: jsonb("technical_factors").$type<string[]>(),
  priceAtAnalysis: text("price_at_analysis"),
  sentAlerted: boolean("sent_alerted").default(false),
  signalId: integer("signal_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const watchlist = pgTable("watchlist", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  name: text("name").notNull(),
  type: varchar("type", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  signalType: varchar("signal_type", { length: 30 }).notNull(),
  price: real("price"),
  confluenceData: jsonb("confluence_data").$type<{
    emaAlignment?: string;
    rsiValue?: number;
    renkoTrend?: string;
    mtfScore?: string;
    confluenceCount?: number;
    sl?: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    customData?: Record<string, unknown>;
  }>(),
  analyzed: boolean("analyzed").default(false),
  message: text("message"),
  receivedAt: timestamp("received_at").defaultNow(),
});

// Smart Pullback screener results. The Python screeners run on the trading PC
// (they can't run in the cloud) and push their CSV results here after each run.
export const screenerRuns = pgTable("screener_runs", {
  id: serial("id").primaryKey(),
  mode: varchar("mode", { length: 10 }).notNull(), // "live" | "options"
  rows: jsonb("rows").$type<Record<string, unknown>[]>().notNull(),
  meta: jsonb("meta").$type<{ file: string; runAt: string; count: number }>().notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

export type ScreenerRun = typeof screenerRuns.$inferSelect;

// On-demand run requests: the cloud can't run the Python screeners, so the
// "Run" button records a request here and the PC poller picks it up, runs the
// screener, uploads results, and marks it fulfilled.
export const screenerRequests = pgTable("screener_requests", {
  id: serial("id").primaryKey(),
  mode: varchar("mode", { length: 10 }).notNull(), // "live" | "options"
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  fulfilledAt: timestamp("fulfilled_at"),
});

export type ScreenerRequest = typeof screenerRequests.$inferSelect;

// Small key/value store for scheduler state that must survive restarts.
// The morning brief's "already sent today" marker lives here: keeping it in
// memory meant every container restart forgot it, so a restart could either
// re-send the brief or (with a narrow recovery window) skip the day silently.
export const appState = pgTable("app_state", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppState = typeof appState.$inferSelect;

export const waitlist = pgTable("waitlist", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  source: varchar("source", { length: 60 }).default("intro"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWaitlistSchema = createInsertSchema(waitlist).omit({ id: true, createdAt: true });
export type WaitlistEntry = typeof waitlist.$inferSelect;
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistSchema>;

export const insertAnalysisSchema = createInsertSchema(analyses, {
  newsFactors: z.array(z.string()).nullable().optional(),
  technicalFactors: z.array(z.string()).nullable().optional(),
}).omit({ id: true, createdAt: true });
export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true, createdAt: true });
export const insertSignalSchema = createInsertSchema(signals, {
  confluenceData: z.object({
    emaAlignment: z.string().optional(),
    rsiValue: z.number().optional(),
    renkoTrend: z.string().optional(),
    mtfScore: z.string().optional(),
    confluenceCount: z.number().optional(),
    sl: z.number().optional(),
    tp1: z.number().optional(),
    tp2: z.number().optional(),
    tp3: z.number().optional(),
    customData: z.record(z.unknown()).optional(),
  }).nullable().optional(),
}).omit({ id: true, receivedAt: true });

export type Analysis = typeof analyses.$inferSelect;
export type InsertAnalysis = z.infer<typeof insertAnalysisSchema>;
export type CreateAnalysisRequest = InsertAnalysis;

export type WatchlistItem = typeof watchlist.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistSchema>;
export type CreateWatchlistRequest = InsertWatchlistItem;

export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;

export type AnalysisResponse = Analysis;
export type WatchlistResponse = WatchlistItem;
export type SignalResponse = Signal;
