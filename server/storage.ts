import { db } from "./db";
import {
  analyses, watchlist, signals, waitlist, screenerRuns, screenerRequests, appState,
  type InsertAnalysis, type Analysis,
  type InsertWatchlistItem, type WatchlistItem,
  type InsertSignal, type Signal,
  type InsertWaitlistEntry, type WaitlistEntry,
  type ScreenerRun, type ScreenerRequest,
} from "@shared/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";

export interface IStorage {
  getAnalyses(): Promise<Analysis[]>;
  getAnalysis(id: number): Promise<Analysis | undefined>;
  createAnalysis(analysis: InsertAnalysis): Promise<Analysis>;
  deleteAnalysis(id: number): Promise<boolean>;
  getWatchlist(): Promise<WatchlistItem[]>;
  createWatchlistItem(item: InsertWatchlistItem): Promise<WatchlistItem>;
  deleteWatchlistItem(id: number): Promise<boolean>;
  getSignals(): Promise<Signal[]>;
  getSignal(id: number): Promise<Signal | undefined>;
  createSignal(signal: InsertSignal): Promise<Signal>;
  markSignalAnalyzed(id: number): Promise<boolean>;
  updateSignalDirection(id: number, direction: string): Promise<boolean>;
  getLatestSignalForSymbol(symbol: string): Promise<Signal | undefined>;
  getRecentSignalsByType(signalType: string, sinceHours: number): Promise<Signal[]>;
  getWaitlist(): Promise<WaitlistEntry[]>;
  addToWaitlist(entry: InsertWaitlistEntry): Promise<WaitlistEntry>;
  deleteWaitlistEntry(id: number): Promise<boolean>;
  saveScreenerRun(mode: string, rows: Record<string, unknown>[], meta: { file: string; runAt: string; count: number }): Promise<ScreenerRun>;
  getLatestScreenerRun(mode: string): Promise<ScreenerRun | undefined>;
  createScreenerRequest(mode: string): Promise<ScreenerRequest>;
  getPendingScreenerRequests(): Promise<ScreenerRequest[]>;
  fulfillScreenerRequests(mode: string): Promise<number>;
}

export class DatabaseStorage implements IStorage {
  async getAnalyses(): Promise<Analysis[]> {
    return await db.select().from(analyses).orderBy(desc(analyses.createdAt));
  }

  async getAnalysis(id: number): Promise<Analysis | undefined> {
    const [result] = await db.select().from(analyses).where(eq(analyses.id, id));
    return result;
  }

  async createAnalysis(analysis: InsertAnalysis): Promise<Analysis> {
    const [result] = await db.insert(analyses).values(analysis).returning();
    return result;
  }

  async deleteAnalysis(id: number): Promise<boolean> {
    const result = await db.delete(analyses).where(eq(analyses.id, id)).returning();
    return result.length > 0;
  }

  async getWatchlist(): Promise<WatchlistItem[]> {
    return await db.select().from(watchlist).orderBy(desc(watchlist.createdAt));
  }

  async createWatchlistItem(item: InsertWatchlistItem): Promise<WatchlistItem> {
    const [result] = await db.insert(watchlist).values(item).returning();
    return result;
  }

  async deleteWatchlistItem(id: number): Promise<boolean> {
    const result = await db.delete(watchlist).where(eq(watchlist.id, id)).returning();
    return result.length > 0;
  }

  async getSignals(): Promise<Signal[]> {
    return await db.select().from(signals).orderBy(desc(signals.receivedAt));
  }

  async getSignal(id: number): Promise<Signal | undefined> {
    const [result] = await db.select().from(signals).where(eq(signals.id, id));
    return result;
  }

  async createSignal(signal: InsertSignal): Promise<Signal> {
    const [result] = await db.insert(signals).values(signal).returning();
    return result;
  }

  async markSignalAnalyzed(id: number): Promise<boolean> {
    const result = await db.update(signals).set({ analyzed: true }).where(eq(signals.id, id)).returning();
    return result.length > 0;
  }

  async updateSignalDirection(id: number, direction: string): Promise<boolean> {
    const result = await db.update(signals).set({ direction }).where(eq(signals.id, id)).returning();
    return result.length > 0;
  }

  async getLatestSignalForSymbol(symbol: string): Promise<Signal | undefined> {
    const [result] = await db.select().from(signals).where(eq(signals.symbol, symbol)).orderBy(desc(signals.receivedAt)).limit(1);
    return result;
  }

  async getRecentSignalsByType(signalType: string, sinceHours: number): Promise<Signal[]> {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    return await db.select().from(signals)
      .where(and(eq(signals.signalType, signalType), gte(signals.receivedAt, since)))
      .orderBy(desc(signals.receivedAt));
  }

  async getWaitlist(): Promise<WaitlistEntry[]> {
    return await db.select().from(waitlist).orderBy(desc(waitlist.createdAt));
  }

  async addToWaitlist(entry: InsertWaitlistEntry): Promise<WaitlistEntry> {
    const [created] = await db.insert(waitlist).values(entry).returning();
    return created;
  }

  async deleteWaitlistEntry(id: number): Promise<boolean> {
    const result = await db.delete(waitlist).where(eq(waitlist.id, id)).returning();
    return result.length > 0;
  }

  async saveScreenerRun(
    mode: string,
    rows: Record<string, unknown>[],
    meta: { file: string; runAt: string; count: number },
  ): Promise<ScreenerRun> {
    const [result] = await db.insert(screenerRuns).values({ mode, rows, meta }).returning();
    return result;
  }

  async getLatestScreenerRun(mode: string): Promise<ScreenerRun | undefined> {
    const [result] = await db.select().from(screenerRuns)
      .where(eq(screenerRuns.mode, mode))
      .orderBy(desc(screenerRuns.receivedAt))
      .limit(1);
    return result;
  }

  async createScreenerRequest(mode: string): Promise<ScreenerRequest> {
    const [result] = await db.insert(screenerRequests).values({ mode }).returning();
    return result;
  }

  async getPendingScreenerRequests(): Promise<ScreenerRequest[]> {
    return await db.select().from(screenerRequests)
      .where(sql`${screenerRequests.fulfilledAt} IS NULL`)
      .orderBy(desc(screenerRequests.requestedAt));
  }

  async fulfillScreenerRequests(mode: string): Promise<number> {
    const result = await db.update(screenerRequests)
      .set({ fulfilledAt: new Date() })
      .where(sql`${screenerRequests.mode} = ${mode} AND ${screenerRequests.fulfilledAt} IS NULL`)
      .returning();
    return result.length;
  }

  async getAppState(key: string): Promise<string | null> {
    const [row] = await db.select().from(appState).where(eq(appState.key, key));
    return row?.value ?? null;
  }

  async setAppState(key: string, value: string): Promise<void> {
    await db.insert(appState)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: new Date() } });
  }
}

export const storage = new DatabaseStorage();
