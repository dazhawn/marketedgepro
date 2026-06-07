import { db } from "./db";
import {
  analyses, watchlist, signals, waitlist,
  type InsertAnalysis, type Analysis,
  type InsertWatchlistItem, type WatchlistItem,
  type InsertSignal, type Signal,
  type InsertWaitlistEntry, type WaitlistEntry,
} from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

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
  getWaitlist(): Promise<WaitlistEntry[]>;
  addToWaitlist(entry: InsertWaitlistEntry): Promise<WaitlistEntry>;
  deleteWaitlistEntry(id: number): Promise<boolean>;
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
}

export const storage = new DatabaseStorage();
