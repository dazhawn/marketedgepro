import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * /api/health/deep exists because /api/health stayed green through the whole
 * Sep 2026 database outage. But an uptime monitor polling a DB check every few
 * minutes would recreate the bug that CAUSED that outage — Neon never reaching
 * its idle suspend. These pin down both halves.
 */

// db-health imports ../db, which builds a pg Pool from DATABASE_URL at load.
// Stub it so the tests never touch a real database.
jest.unstable_mockModule("../server/db", () => ({ pool: { query: jest.fn() } }));

const MIN = 60 * 1000;

async function fresh() {
  const m = await import("../server/services/db-health");
  m._resetDbHealthCache();
  return m;
}

describe("database health check", () => {
  let query: jest.Mock<() => Promise<unknown>>;
  beforeEach(() => { query = jest.fn<() => Promise<unknown>>().mockResolvedValue({ rows: [{ "?column?": 1 }] }); });

  it("reports healthy when the database answers", async () => {
    const { getDbHealth } = await fresh();
    const h = await getDbHealth(0, query);
    expect(h.ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("reports down when the database refuses — the Sep 2026 quota error", async () => {
    const { getDbHealth } = await fresh();
    query.mockRejectedValue(new Error("Your account or project has exceeded the quota"));
    const h = await getDbHealth(0, query);
    expect(h.ok).toBe(false);
  });

  it("lets the database sleep: a monitor polling every 5 min probes once per 25 min", async () => {
    const { getDbHealth } = await fresh();
    // One day of 5-minute polls.
    for (let t = 0; t < 24 * 60 * MIN; t += 5 * MIN) await getDbHealth(t, query);
    // 1440 min / 25 min ≈ 58 probes, against 288 polls. The gaps between them
    // are longer than Neon's 5-minute idle window, so compute can suspend.
    expect(query.mock.calls.length).toBeLessThanOrEqual(60);
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(57);
  });

  it("re-checks a DOWN database quickly so recovery shows up", async () => {
    const { getDbHealth, UNHEALTHY_TTL_MS } = await fresh();
    query.mockRejectedValueOnce(new Error("down"));
    expect((await getDbHealth(0, query)).ok).toBe(false);
    // Well inside the healthy TTL, but past the unhealthy one — must re-probe.
    expect((await getDbHealth(UNHEALTHY_TTL_MS + 1, query)).ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("shares one probe between simultaneous requests", async () => {
    const { getDbHealth } = await fresh();
    await Promise.all([getDbHealth(0, query), getDbHealth(0, query), getDbHealth(0, query)]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
