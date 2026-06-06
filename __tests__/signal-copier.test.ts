import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});

afterEach(() => {
  consoleSpy.mockClear();
  delete process.env.SIGNAL_COPIER_ENABLED;
});

describe("forwardToSignalCopier", () => {
  it("does nothing when SIGNAL_COPIER_ENABLED is not set", async () => {
    const { forwardToSignalCopier } = await import("../server/services/signal-copier.js");
    await forwardToSignalCopier({ symbol: "EURUSD", direction: "BULLISH", timeframe: "1H", signalType: "Breakout" });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("logs intent when SIGNAL_COPIER_ENABLED=true", async () => {
    process.env.SIGNAL_COPIER_ENABLED = "true";
    const { forwardToSignalCopier } = await import("../server/services/signal-copier.js");
    await forwardToSignalCopier({ symbol: "XAUUSD", direction: "BEARISH", timeframe: "4H", signalType: "Pullback", sl: 1900, tp1: 1850 });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("[Signal Copier]"), expect.any(String));
  });
});
