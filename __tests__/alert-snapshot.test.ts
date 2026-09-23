import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * The alert snapshot is now uploaded daily instead of being baked into the
 * build. These pin down the two things that matter: the connector's raw output
 * is accepted as-is, and a bad or empty upload can never replace a good
 * snapshot — an empty list would silence every expiry warning.
 */

const getAppState = jest.fn<(k: string) => Promise<string | null>>();
jest.unstable_mockModule("../server/storage", () => ({ storage: { getAppState } }));
jest.unstable_mockModule("../server/services/discord-bot", () => ({ reportIssue: jest.fn() }));

// Exactly the shape the tvremix my_alerts connector returns.
const RAW = {
  alert_id: 5195471625, name: null, active: true, type: "price",
  message: "BTCUSD Crossing 65,758", expiration: "2026-10-22T10:29:39Z",
  last_fire_time: "2026-08-19T14:55:14Z", resolution: "1", symbol: "BITSTAMP:BTCUSD",
};

describe("alert snapshot upload", () => {
  beforeEach(() => { getAppState.mockReset(); });

  it("accepts the connector's raw output and maps its field names", async () => {
    const { normalizeAlerts } = await import("../server/services/alert-expiry");
    expect(normalizeAlerts([RAW])).toEqual([{
      id: 5195471625, symbol: "BITSTAMP:BTCUSD", kind: "price", resolution: "1",
      active: true, expiration: "2026-10-22T10:29:39Z", lastFire: "2026-08-19T14:55:14Z",
    }]);
  });

  it("treats a never-fired alert's null last_fire_time as null", async () => {
    const { normalizeAlerts } = await import("../server/services/alert-expiry");
    expect(normalizeAlerts([{ ...RAW, last_fire_time: null }])![0].lastFire).toBeNull();
  });

  it("refuses an empty list, so a failed fetch can't wipe the snapshot", async () => {
    const { normalizeAlerts } = await import("../server/services/alert-expiry");
    expect(normalizeAlerts([])).toBeNull();
    expect(normalizeAlerts(undefined)).toBeNull();
    expect(normalizeAlerts({ alerts: [] })).toBeNull();
  });

  it("refuses the whole upload if any entry is unusable", async () => {
    const { normalizeAlerts } = await import("../server/services/alert-expiry");
    expect(normalizeAlerts([RAW, { ...RAW, expiration: "not a date" }])).toBeNull();
    expect(normalizeAlerts([RAW, { ...RAW, symbol: "" }])).toBeNull();
  });

  it("uses an uploaded snapshot that is newer than the bundled one", async () => {
    const { loadCurrentSnapshot, loadSnapshot } = await import("../server/services/alert-expiry");
    const newer = new Date(Date.parse(loadSnapshot().snapshotAt) + 86_400_000).toISOString();
    getAppState.mockResolvedValue(JSON.stringify({ snapshotAt: newer, alerts: [RAW] }));
    const s = await loadCurrentSnapshot();
    expect(s.source).toBe("uploaded");
    expect(s.alerts).toHaveLength(1);
  });

  it("ignores an uploaded snapshot that is older than the bundled one", async () => {
    const { loadCurrentSnapshot, loadSnapshot } = await import("../server/services/alert-expiry");
    const older = new Date(Date.parse(loadSnapshot().snapshotAt) - 86_400_000).toISOString();
    getAppState.mockResolvedValue(JSON.stringify({ snapshotAt: older, alerts: [RAW] }));
    expect((await loadCurrentSnapshot()).source).toBe("bundled");
  });

  it("still prefers a real upload when the bundled file is stamped in the future", async () => {
    const { loadCurrentSnapshot, loadSnapshot } = await import("../server/services/alert-expiry");
    // Only meaningful while the bundled stamp is in the past, so fake the
    // clock: set "now" before the bundled time, as happened on 23 Sep 2026.
    const bundledAt = Date.parse(loadSnapshot().snapshotAt);
    const realNow = Date.now;
    Date.now = () => bundledAt - 6 * 3_600_000;
    try {
      getAppState.mockResolvedValue(JSON.stringify({
        snapshotAt: new Date(bundledAt - 3_600_000).toISOString(),   // after "now", before bundled
        alerts: [RAW],
      }));
      expect((await loadCurrentSnapshot()).source).toBe("uploaded");
    } finally {
      Date.now = realNow;
    }
  });

  it("falls back to the bundled snapshot when the database is down", async () => {
    const { loadCurrentSnapshot } = await import("../server/services/alert-expiry");
    getAppState.mockRejectedValue(new Error("exceeded the quota"));
    const s = await loadCurrentSnapshot();
    expect(s.source).toBe("bundled");
    expect(s.alerts.length).toBeGreaterThan(0);
  });
});
