import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";

// Importing discord-bot pulls in discord.js, which is slow to compile on a cold
// ts-jest cache — same reason market-pulse.test.ts raises its timeout.
jest.setTimeout(30_000);

const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

const SIGNAL = {
  symbol: "GOOGL",
  timeframe: "1D",
  direction: "BULLISH",
  signalType: "Smart Investor",
  price: 245.5,
} as never;

const CHANNEL_VARS = [
  "DISCORD_BOT_TOKEN", "DISCORD_FREE_CHANNEL_ID", "DISCORD_STOCKS_CHANNEL_ID",
  "DISCORD_OTHER_CHANNEL_ID", "DISCORD_CURRENCY_CHANNEL_ID",
];

beforeEach(() => {
  for (const k of CHANNEL_VARS) delete process.env[k];
});

afterEach(() => {
  warnSpy.mockClear();
  errorSpy.mockClear();
});

describe("postSignalViaBot — a dropped signal must never be silent", () => {
  it("warns, naming the symbol, category and env var, when the category channel is not configured", async () => {
    const { postSignalViaBot } = await import("../server/services/discord-bot.js");

    await postSignalViaBot(SIGNAL);

    // GOOGL classifies as "stocks", so it should name DISCORD_STOCKS_CHANNEL_ID.
    const msg = warnSpy.mock.calls.map(c => String(c[0])).join(" ");
    expect(msg).toContain("GOOGL");
    expect(msg).toContain("stocks");
    expect(msg).toContain("DISCORD_STOCKS_CHANNEL_ID");
    expect(msg).toContain("NOT delivered");
  });

  it("errors when the channel is configured but unreachable", async () => {
    process.env.DISCORD_STOCKS_CHANNEL_ID = "1514408230074450050";
    const { postSignalViaBot } = await import("../server/services/discord-bot.js");

    // No DISCORD_BOT_TOKEN, so the client can't resolve the channel — the same
    // shape as the bot lacking access to a private channel.
    await postSignalViaBot(SIGNAL);

    const msg = errorSpy.mock.calls.map(c => String(c[0])).join(" ");
    expect(msg).toContain("GOOGL");
    expect(msg).toContain("unreachable");
    expect(msg).toContain("NOT delivered");
  });

  it("names the renamed catch-all variable for unclassifiable symbols", async () => {
    const { postSignalViaBot } = await import("../server/services/discord-bot.js");

    // Broker-suffixed pairs are exactly what falls through to "other".
    await postSignalViaBot({ ...(SIGNAL as object), symbol: "EURUSDm" } as never);

    const msg = warnSpy.mock.calls.map(c => String(c[0])).join(" ");
    expect(msg).toContain("EURUSDm");
    expect(msg).toContain("other");
    // Guards the rename: the old DISCORD_PAID_CHANNEL_ID name must not come back.
    expect(msg).toContain("DISCORD_OTHER_CHANNEL_ID");
    expect(msg).not.toContain("DISCORD_PAID_CHANNEL_ID");
  });
});
