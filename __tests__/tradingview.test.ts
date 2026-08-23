import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

const mockFetch = jest.fn<typeof fetch>();

beforeEach(async () => {
  global.fetch = mockFetch as unknown as typeof fetch;
  const { __clearCache } = await import("../server/services/tradingview.js");
  __clearCache();
});

afterEach(() => {
  jest.clearAllMocks();
});

// Column order MUST match COLUMNS in tradingview.ts. The scanner's `d` array is
// positional, so this ordering is the contract the parser depends on.
// ["close", "change", "RSI", "SMA50", "SMA200", "Recommend.All", "Recommend.MA"]

/** Values verified against the TradingView MCP connector on 2026-08-22 (agree to 1e-6). */
const MSFT_ROW = { s: "NASDAQ:MSFT", d: [483.24, 0.4343759742284178, 62.41944377141601, 419.8446000000001, 431.3128000000005, 0.4242424242424242, 0.6666666666666666] };
const WMT_ROW = { s: "NASDAQ:WMT", d: [103.7, -0.13482280431433027, 29.59673626100222, 113.59700000000016, 118.52380000000001, -0.4212121212121212, -0.9333333333333333] };
/** US10Y is a yield index — TradingView computes no technicals for it. */
const US10Y_ROW = { s: "TVC:US10Y", d: [4.736, 0.1, null, null, null, null, null] };

function jsonResponse(rows: unknown[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: rows }),
  } as unknown as Response;
}

describe("ratingLabel", () => {
  it("matches the labels the MCP connector returns for the same values", async () => {
    const { ratingLabel } = await import("../server/services/tradingview.js");
    expect(ratingLabel(0.4242424242424242)).toBe("Buy");      // MSFT
    expect(ratingLabel(-0.4212121212121212)).toBe("Sell");    // WMT
    expect(ratingLabel(0.28787878787878785)).toBe("Buy");     // SPY
  });

  it("classifies band boundaries", async () => {
    const { ratingLabel } = await import("../server/services/tradingview.js");
    expect(ratingLabel(0.9)).toBe("Strong Buy");
    expect(ratingLabel(0.5)).toBe("Buy");         // boundary is exclusive above
    expect(ratingLabel(0.1)).toBe("Neutral");
    expect(ratingLabel(0)).toBe("Neutral");
    expect(ratingLabel(-0.1)).toBe("Neutral");
    expect(ratingLabel(-0.5)).toBe("Sell");
    expect(ratingLabel(-0.6)).toBe("Strong Sell");
  });

  it("returns null for null and non-finite input", async () => {
    const { ratingLabel } = await import("../server/services/tradingview.js");
    expect(ratingLabel(null)).toBeNull();
    expect(ratingLabel(NaN)).toBeNull();
    expect(ratingLabel(Infinity)).toBeNull();
  });
});

describe("getTechnicals", () => {
  it("maps scanner columns onto named fields", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([MSFT_ROW]));
    const { getTechnicals } = await import("../server/services/tradingview.js");

    const result = await getTechnicals(["NASDAQ:MSFT"]);
    const msft = result.bySymbol["NASDAQ:MSFT"];

    expect(msft.price).toBeCloseTo(483.24, 6);
    expect(msft.rsi).toBeCloseTo(62.41944377141601, 6);
    expect(msft.sma50).toBeCloseTo(419.8446, 4);
    expect(msft.sma200).toBeCloseTo(431.3128, 4);
    expect(msft.rating).toBeCloseTo(0.4242424242424242, 6);
    expect(msft.ratingLabel).toBe("Buy");
    expect(result.degraded).toBe(false);
    expect(result.fromCache).toBe(false);
  });

  it("keeps price but nulls indicators when TradingView computes none", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([US10Y_ROW]));
    const { getTechnicals } = await import("../server/services/tradingview.js");

    const y = (await getTechnicals(["TVC:US10Y"])).bySymbol["TVC:US10Y"];
    expect(y.price).toBeCloseTo(4.736, 6);
    expect(y.rsi).toBeNull();
    expect(y.rating).toBeNull();
    expect(y.ratingLabel).toBeNull();
  });

  it("posts to the requested region with the tickers and columns", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([MSFT_ROW]));
    const { getTechnicals } = await import("../server/services/tradingview.js");
    await getTechnicals(["NASDAQ:MSFT"], { region: "america" });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://scanner.tradingview.com/america/scan");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.symbols.tickers).toEqual(["NASDAQ:MSFT"]);
    expect(body.columns[0]).toBe("close");
    expect(body.columns).toContain("Recommend.All");
  });

  it("defaults to the global region, which resolves indices, FX, futures and crypto", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([US10Y_ROW]));
    const { getTechnicals } = await import("../server/services/tradingview.js");
    await getTechnicals(["TVC:US10Y"]);
    expect(mockFetch.mock.calls[0][0]).toBe("https://scanner.tradingview.com/global/scan");
  });

  it("serves a cached response without refetching", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([MSFT_ROW]));
    const { getTechnicals } = await import("../server/services/tradingview.js");

    await getTechnicals(["NASDAQ:MSFT"]);
    const second = await getTechnicals(["NASDAQ:MSFT"]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second.fromCache).toBe(true);
    expect(second.degraded).toBe(false);
  });

  it("refetches once the TTL has expired", async () => {
    mockFetch.mockResolvedValue(jsonResponse([MSFT_ROW]));
    const { getTechnicals } = await import("../server/services/tradingview.js");

    await getTechnicals(["NASDAQ:MSFT"]);
    await getTechnicals(["NASDAQ:MSFT"], { ttlMs: 0 });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("serves stale data flagged as degraded when a refetch fails", async () => {
    const { getTechnicals } = await import("../server/services/tradingview.js");
    mockFetch.mockResolvedValueOnce(jsonResponse([MSFT_ROW, WMT_ROW]));
    const fresh = await getTechnicals(["NASDAQ:MSFT", "NASDAQ:WMT"]);
    expect(Object.keys(fresh.bySymbol)).toHaveLength(2);

    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const stale = await getTechnicals(["NASDAQ:MSFT", "NASDAQ:WMT"], { ttlMs: 0 });

    expect(stale.degraded).toBe(true);
    expect(stale.fromCache).toBe(true);
    expect(stale.error).toBe("network down");
    // The whole point: the caller still gets every symbol, and knows it is stale.
    expect(Object.keys(stale.bySymbol)).toHaveLength(2);
    expect(stale.bySymbol["NASDAQ:WMT"].ratingLabel).toBe("Sell");
  });

  it("returns empty and degraded rather than throwing when nothing is cached", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    const { getTechnicals } = await import("../server/services/tradingview.js");

    const result = await getTechnicals(["NASDAQ:MSFT"]);

    expect(result.degraded).toBe(true);
    expect(result.bySymbol).toEqual({});
    expect(result.ageMs).toBe(Infinity);
  });

  it("treats a non-200 response as a failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as unknown as Response);
    const { getTechnicals } = await import("../server/services/tradingview.js");

    const result = await getTechnicals(["NASDAQ:MSFT"]);
    expect(result.degraded).toBe(true);
    expect(result.error).toContain("503");
  });

  it("caches per region, so one region's data never answers for another", async () => {
    mockFetch.mockResolvedValue(jsonResponse([MSFT_ROW]));
    const { getTechnicals } = await import("../server/services/tradingview.js");

    await getTechnicals(["NASDAQ:MSFT"], { region: "america" });
    await getTechnicals(["NASDAQ:MSFT"], { region: "global" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
