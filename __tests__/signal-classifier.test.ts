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

  it("classifies indices as indices", () => {
    expect(classifySymbol("US30")).toBe("indices");
    expect(classifySymbol("NAS100")).toBe("indices");
    expect(classifySymbol("NDX")).toBe("indices");
    expect(classifySymbol("SPX500")).toBe("indices");
    expect(classifySymbol("UK100")).toBe("indices");
    expect(classifySymbol("DE40")).toBe("indices");
    expect(classifySymbol("DAX")).toBe("indices");
    expect(classifySymbol("DJI")).toBe("indices");
  });

  it("classifies unknown symbols as other", () => {
    expect(classifySymbol("BTCUSD")).toBe("other");
    expect(classifySymbol("UNKNOWN")).toBe("other");
  });
});
