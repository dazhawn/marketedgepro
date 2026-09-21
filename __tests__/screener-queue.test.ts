import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * The point of screener-queue is that the 5-minute poll does NOT reach
 * Postgres. Querying on every poll kept Neon's compute from ever suspending
 * and exhausted the free-tier quota in September 2026, taking the brief, the
 * waitlist, and signal storage down together. These tests pin that down.
 */

const getPendingScreenerRequests = jest.fn<() => Promise<Array<{ mode: string }>>>();

jest.unstable_mockModule("../server/storage", () => ({
  storage: { getPendingScreenerRequests },
}));

async function freshQueue() {
  jest.resetModules();
  return await import("../server/services/screener-queue");
}

describe("screener queue", () => {
  beforeEach(() => {
    getPendingScreenerRequests.mockReset();
    getPendingScreenerRequests.mockResolvedValue([]);
  });

  it("reads the database once, then answers every later poll from memory", async () => {
    const q = await freshQueue();
    for (let i = 0; i < 288; i++) await q.pendingModes();   // one day of 5-minute polls
    expect(getPendingScreenerRequests).toHaveBeenCalledTimes(1);
  });

  it("recovers requests that were queued before a restart", async () => {
    getPendingScreenerRequests.mockResolvedValue([{ mode: "live" }, { mode: "options" }]);
    const q = await freshQueue();
    expect((await q.pendingModes()).sort()).toEqual(["live", "options"]);
  });

  it("reports a newly queued run without going back to the database", async () => {
    const q = await freshQueue();
    await q.pendingModes();                      // hydrate: nothing pending
    q.markPending("live");
    expect(await q.pendingModes()).toEqual(["live"]);
    expect(getPendingScreenerRequests).toHaveBeenCalledTimes(1);
  });

  it("stops reporting a mode once it is fulfilled", async () => {
    const q = await freshQueue();
    q.markPending("options");
    q.clearPending("options");
    expect(await q.pendingModes()).toEqual([]);
  });

  it("does not hammer a database that is down", async () => {
    getPendingScreenerRequests.mockRejectedValue(new Error("exceeded the quota"));
    const q = await freshQueue();
    for (let i = 0; i < 20; i++) {
      await expect(q.pendingModes()).resolves.toEqual([]);   // never throws to the poller
    }
    // Hydration failed, but it must not retry on every poll — that would be
    // the same constant wake-up this module exists to prevent.
    expect(getPendingScreenerRequests).toHaveBeenCalledTimes(1);
  });
});
