/**
 * In-memory mirror of the pending screener-run queue.
 *
 * WHY THIS EXISTS
 * ---------------
 * The trading-server poller asks GET /api/screener/pending every 5 minutes.
 * That endpoint used to query Postgres on every call. Neon's free tier only
 * stops billing compute once the database has been idle for 5 minutes, so a
 * query every 5 minutes kept it awake around the clock — ~720 compute-hours a
 * month — and in September that exhausted the quota and took every DB-backed
 * feature down with it: the morning brief, waitlist signups on the public
 * site, signal storage, and screener uploads.
 *
 * The poll almost always returns "nothing pending". Answering it from memory
 * lets the database sleep, while keeping the 5-minute interval that makes the
 * dashboard's "Run Screener" button responsive.
 *
 * Postgres stays the source of truth for writes. Memory is only the read path
 * for the poll, hydrated once from the database so a request queued before a
 * restart is not lost.
 */
import { storage } from "../storage";

export type ScreenerMode = "live" | "options";

const pending = new Set<ScreenerMode>();

let hydrated = false;
let lastHydrateAttempt = -Infinity;   // "never tried" — earlier than any real time
// If hydration fails (database down), don't retry on every poll — that would
// reintroduce exactly the constant wake-ups this module exists to prevent.
const HYDRATE_RETRY_MS = 30 * 60 * 1000;

async function ensureHydrated(): Promise<void> {
  if (hydrated) return;
  const now = Date.now();
  if (now - lastHydrateAttempt < HYDRATE_RETRY_MS) return;
  lastHydrateAttempt = now;
  try {
    const rows = await storage.getPendingScreenerRequests();
    for (const r of rows) {
      if (r.mode === "live" || r.mode === "options") pending.add(r.mode);
    }
    hydrated = true;
    console.log(`[screener-queue] hydrated from database: ${Array.from(pending).join(", ") || "none pending"}`);
  } catch (err) {
    console.error("[screener-queue] hydration failed, retrying in 30 min:", err);
  }
}

/** Record a request. Call AFTER the database insert succeeds. */
export function markPending(mode: ScreenerMode): void {
  pending.add(mode);
}

/** Modes awaiting a run. Touches the database at most once per process. */
export async function pendingModes(): Promise<ScreenerMode[]> {
  await ensureHydrated();
  return Array.from(pending);
}

/**
 * Clear a mode. Done BEFORE the database update and unconditionally: if the
 * update failed and memory kept the mode, the poller would re-run the
 * screener every 5 minutes indefinitely.
 */
export function clearPending(mode: ScreenerMode): void {
  pending.delete(mode);
}
