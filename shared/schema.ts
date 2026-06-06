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
