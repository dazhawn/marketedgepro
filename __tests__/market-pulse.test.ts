import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// market-pulse dynamically imports @anthropic-ai/sdk, which on a cold ts-jest
// cache can take longer to compile than Jest's 5s default — the first CI run
// would fail with a timeout (no assertion diff) while every later run passed.
jest.setTimeout(30_000);

const mockFetch = jest.fn<typeof fetch>();

// Yahoo supplies price/change; TradingView supplies technicals. Route by URL so
// one mock serves both, the way the real call graph hits them concurrently.
function routeFetch(technicalsRows: unknown[] | "fail") {
  return async (input: unknown) => {
    const url = String(input);
    if (url.includes("scanner.tradingview.com")) {
      if (technicalsRows === "fail") throw new Error("tradingview down");
      return { ok: true, status: 200, json: async () => ({ data: technicalsRows }) } as unknown as Response;
    }
    // Yahoo chart shape — price 100, previous close 80 → +25%.
    return {
      ok: true,
      status: 200,
      json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 100, previousClose: 80 } }] } }),
    } as unknown as Response;
  };
}

// Column order matches COLUMNS in tradingview.ts:
// ["close","change","RSI","SMA50","SMA200","Recommend.All","Recommend.MA"]
const SPX_ROW = { s: "SP:SPX", d: [7674.37, -0.44, 53.9, 7500, 7100, 0.28787878787878785, 0.6666666666666666] };
/** US10Y resolves with a price but no indicators — TradingView computes none for yields. */
const US10Y_ROW = { s: "TVC:US10Y", d: [4.736, 0.89, null, null, null, null, null] };

beforeEach(async () => {
  global.fetch = mockFetch as unknown as typeof fetch;
  const { __clearCache } = await import("../server/services/tradingview.js");
  __clearCache();
  // No ANTHROPIC_API_KEY in tests — narrative generation fails and falls back,
  // which is itself the behaviour we want to assert.
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("buildMarketPulse", () => {
  it("attaches technicals to the instruments that have them", async () => {
    mockFetch.mockImplementation(routeFetch([SPX_ROW, US10Y_ROW]) as never);
    const { buildMarketPulse } = await import("../server/services/market-pulse.js");

    const pulse = await buildMarketPulse();
    const spx = pulse.items.find(i => i.label === "SPX");

    expect(spx?.rsi).toBeCloseTo(53.9, 4);
    expect(spx?.rating).toBeCloseTo(0.28787878787878785, 6);
    expect(spx?.ratingLabel).toBe("Buy");
    expect(pulse.technicalsAsOf).toBeInstanceOf(Date);
    expect(pulse.technicalsStale).toBeUndefined();
  });

  it("omits indicator fields entirely for instruments TradingView has none for", async () => {
    mockFetch.mockImplementation(routeFetch([SPX_ROW, US10Y_ROW]) as never);
    const { buildMarketPulse } = await import("../server/services/market-pulse.js");

    const us10y = (await buildMarketPulse()).items.find(i => i.label === "US10Y");

    // Present with a price, but the keys must be absent — not null, not NaN.
    expect(us10y).toBeDefined();
    expect(us10y).not.toHaveProperty("rsi");
    expect(us10y).not.toHaveProperty("rating");
    expect(us10y).not.toHaveProperty("ratingLabel");
  });

  it("still returns every instrument when TradingView is unreachable", async () => {
    mockFetch.mockImplementation(routeFetch("fail") as never);
    const { buildMarketPulse } = await import("../server/services/market-pulse.js");

    const pulse = await buildMarketPulse();

    // The whole point: a TradingView outage costs the brief its technicals, not the brief.
    expect(pulse.items).toHaveLength(10);
    expect(pulse.items.every(i => i.price.length > 0)).toBe(true);
    expect(pulse.items.every(i => i.rsi === undefined)).toBe(true);
    expect(pulse.technicalsAsOf).toBeUndefined();
    expect(pulse.narrative.length).toBeGreaterThan(0);
  });

  it("falls back to a canned narrative when the AI call fails", async () => {
    mockFetch.mockImplementation(routeFetch([SPX_ROW]) as never);
    const { buildMarketPulse } = await import("../server/services/market-pulse.js");

    const pulse = await buildMarketPulse();
    expect(pulse.narrative).toContain("Risk tone neutral");
  });

  it("fetches technicals once, not once per instrument", async () => {
    mockFetch.mockImplementation(routeFetch([SPX_ROW]) as never);
    const { buildMarketPulse } = await import("../server/services/market-pulse.js");

    await buildMarketPulse();

    const scannerCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes("scanner.tradingview.com"));
    expect(scannerCalls).toHaveLength(1);
  });
});
