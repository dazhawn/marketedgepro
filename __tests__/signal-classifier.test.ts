import { describe, it, expect } from "@jest/globals";
import { classifySymbol } from "../server/services/signal-classifier.js";

describe("classifySymbol", () => {
  it("classifies forex pairs as currency", () => {
    expect(classifySymbol("EURUSD")).toBe("currency");
    expect(classifySymbol("EUR/USD")).toBe("currency");
    expect(classifySymbol("GBPJPY")).toBe("currency");
    expect(classifySymbol("GBP/JPY")).toBe("currency");
    expect(classifySymbol("USDJPY")).toBe("currency");
    expect(classifySymbol("NZDUSD")).toBe("currency");
  });

  it("classifies metals as metals", () => {
    expect(classifySymbol("XAUUSD")).toBe("metals");
    expect(classifySymbol("XAGUSD")).toBe("metals");
    expect(classifySymbol("XPTUSD")).toBe("metals");
    expect(classifySymbol("GOLD")).toBe("metals");
    expect(classifySymbol("SILVER")).toBe("metals");
  });

  // There is deliberately no "indices" category any more — indices route to the
  // Stocks channel, because a separate Indices channel created noise. This test
  // guards that routing rather than the category that used to exist.
  it("routes indices to the stocks channel", () => {
    expect(classifySymbol("US30")).toBe("stocks");
    expect(classifySymbol("NAS100")).toBe("stocks");
    expect(classifySymbol("NDX")).toBe("stocks");
    expect(classifySymbol("SPX500")).toBe("stocks");
    expect(classifySymbol("UK100")).toBe("stocks");
    expect(classifySymbol("DE40")).toBe("stocks");
    expect(classifySymbol("DAX")).toBe("stocks");
    expect(classifySymbol("DJI")).toBe("stocks");
  });

  it("classifies unrecognised symbols as other", () => {
    // Anything 1-5 letters falls through to "stocks" by design, so a genuine
    // unknown has to be longer than a plausible ticker.
    expect(classifySymbol("UNKNOWN")).toBe("other");
    expect(classifySymbol("SOMETHINGELSE")).toBe("other");
  });

  it("classifies BTCUSD as crypto, not other", () => {
    // Was asserted as "other" before BTCUSD was added to the crypto set.
    expect(classifySymbol("BTCUSD")).toBe("crypto");
    expect(classifySymbol("BTC")).toBe("crypto");
  });
});
