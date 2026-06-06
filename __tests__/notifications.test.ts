import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// We test the internal formatting helpers by importing the module and
// observing what gets passed to fetch — without needing live API keys.

const mockFetch = jest.fn<typeof fetch>();

beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue(new Response(null, { status: 200 }) as Response);
});

afterEach(() => {
  jest.clearAllMocks();
  delete process.env.PUSHOVER_TOKEN;
  delete process.env.PUSHOVER_USER_KEY;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.NTFY_TOPIC;
});

describe("sendPhoneNotification", () => {
  it("sends nothing when no env vars are set", async () => {
    const { sendPhoneNotification } = await import("../server/services/notifications.js");
    await sendPhoneNotification({ symbol: "EURUSD", timeframe: "1H", direction: "BULLISH", signalType: "Breakout" });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls Pushover when token + user key are set", async () => {
    process.env.PUSHOVER_TOKEN = "tok";
    process.env.PUSHOVER_USER_KEY = "usr";
    const { sendPhoneNotification } = await import("../server/services/notifications.js");
    await sendPhoneNotification({ symbol: "XAUUSD", timeframe: "4H", direction: "BEARISH", signalType: "Pullback", sl: 1900.5, tp1: 1850.0 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe("https://api.pushover.net/1/messages.json");
  });

  it("calls Telegram when bot token + chat id are set", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "bot123:TOKEN";
    process.env.TELEGRAM_CHAT_ID = "-100123456";
    const { sendPhoneNotification } = await import("../server/services/notifications.js");
    await sendPhoneNotification({ symbol: "BTCUSD", timeframe: "1D", direction: "BULLISH", signalType: "Breakout" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect((url as string)).toContain("api.telegram.org");
  });

  it("calls ntfy when topic is set", async () => {
    process.env.NTFY_TOPIC = "my-signals";
    const { sendPhoneNotification } = await import("../server/services/notifications.js");
    await sendPhoneNotification({ symbol: "GBPUSD", timeframe: "15", direction: "BEARISH", signalType: "EMA Cross" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect((url as string)).toContain("ntfy.sh/my-signals");
  });

  it("fires all three channels simultaneously when all are configured", async () => {
    process.env.PUSHOVER_TOKEN = "tok";
    process.env.PUSHOVER_USER_KEY = "usr";
    process.env.TELEGRAM_BOT_TOKEN = "bot:TOKEN";
    process.env.TELEGRAM_CHAT_ID = "-1001234";
    process.env.NTFY_TOPIC = "trades";
    const { sendPhoneNotification } = await import("../server/services/notifications.js");
    await sendPhoneNotification({ symbol: "USDJPY", timeframe: "1H", direction: "BULLISH", signalType: "Renko" });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
