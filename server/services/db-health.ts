/**
 * Database health for uptime monitoring.
 *
 * WHY THIS EXISTS
 * ---------------
 * Throughout the September 2026 Neon quota outage, GET /api/health kept
 * answering 200 OK while signals, waitlist signups, the brief and screener
 * uploads were all failing — it never touches Postgres. Anything watching it
 * would have reported the service healthy. /api/health/deep runs a real query.
 *
 * WHY IT CACHES
 * -------------
 * That same outage was CAUSED by a 5-minute poll keeping Neon's compute from
 * ever reaching its 5-minute idle suspend. Uptime monitors typically poll
 * every 1–5 minutes, so a naive DB check here would recreate the bug, and on
 * the paid plan it would cost money around the clock. So a healthy result is
 * reused for 25 minutes regardless of how often the endpoint is hit, letting
 * the database sleep between probes. A failed result is reused for only 2
 * minutes, so recovery shows up quickly — a database that is down isn't
 * billing compute anyway.
 */
import { pool } from "../db";

export const HEALTHY_TTL_MS = 25 * 60 * 1000;
export const UNHEALTHY_TTL_MS = 2 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5_000;

export interface DbHealth {
  ok: boolean;
  checkedAt: number;
  latencyMs: number | null;
}

let cached: DbHealth | null = null;
let inFlight: Promise<DbHealth> | null = null;

async function probe(query: () => Promise<unknown>, now: number): Promise<DbHealth> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      query(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, checkedAt: now, latencyMs: Date.now() - started };
  } catch (err) {
    // Logged here, never returned: the endpoint is public and the raw error
    // can carry provider and connection detail.
    console.error("[db-health] probe failed:", (err as Error)?.message ?? err);
    return { ok: false, checkedAt: now, latencyMs: null };
  } finally {
    if (timer) clearTimeout(timer);   // don't leave a timer holding the event loop
  }
}

/**
 * Current database health, probing only when the cached result has expired.
 * `query` is injectable for tests; production uses a trivial SELECT.
 */
export async function getDbHealth(
  now: number = Date.now(),
  query: () => Promise<unknown> = () => pool.query("SELECT 1"),
): Promise<DbHealth> {
  if (cached) {
    const ttl = cached.ok ? HEALTHY_TTL_MS : UNHEALTHY_TTL_MS;
    if (now - cached.checkedAt < ttl) return cached;
  }
  // Concurrent requests share one probe rather than each opening a query.
  if (!inFlight) {
    inFlight = probe(query, now).then(result => {
      cached = result;
      inFlight = null;
      return result;
    });
  }
  return inFlight;
}

/** Test hook. */
export function _resetDbHealthCache(): void {
  cached = null;
  inFlight = null;
}
