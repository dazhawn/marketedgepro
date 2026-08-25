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

describe("Discord size limits — the 2026-08-25 brief failure", () => {
  async function mod() {
    return await import("../server/services/discord-bot.js");
  }
  // discord.js is imported per-call: a describe() callback cannot be async, so
  // there is no top-level await available here.
  async function embedOf(chars: number, fields = 0) {
    const { EmbedBuilder } = await import("discord.js");
    const e = new EmbedBuilder().setTitle("t").setDescription("x".repeat(chars));
    for (let i = 0; i < fields; i++) e.addFields({ name: "n", value: "v".repeat(100) });
    return e;
  }

  it("clamp marks a truncated string and leaves short ones alone", async () => {
    const { clamp } = await mod();
    expect(clamp("short", 10)).toBe("short");
    const out = clamp("y".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("embedLength counts description, title, footer and every field", async () => {
    const { embedLength } = await mod();
    const { EmbedBuilder } = await import("discord.js");
    const e = new EmbedBuilder().setTitle("abc").setDescription("de")
      .setFooter({ text: "fg" }).addFields({ name: "hi", value: "jkl" });
    // 3 + 2 + 2 + 2 + 3
    expect(embedLength(e)).toBe(12);
  });

  it("keeps one message when the total fits", async () => {
    const { batchEmbeds } = await mod();
    expect(batchEmbeds([await embedOf(1000), await embedOf(1000)])).toHaveLength(1);
  });

  it("splits rather than dropping when the total exceeds Discord's 6000", async () => {
    const { batchEmbeds } = await mod();
    // 3 x 2500 = 7500, past the 6000 cap that rejected the real brief.
    const batches = batchEmbeds([await embedOf(2500), await embedOf(2500), await embedOf(2500)]);
    expect(batches.length).toBeGreaterThan(1);
    // Nothing may be lost — every section still ships.
    expect(batches.flat()).toHaveLength(3);
  });

  it("never exceeds the char budget within a single message", async () => {
    const { batchEmbeds, embedLength } = await mod();
    const batches = batchEmbeds(await Promise.all(Array.from({ length: 8 }, () => embedOf(2000))));
    for (const b of batches) {
      const total = b.reduce((n, e) => n + embedLength(e), 0);
      // A lone oversized embed can't be split further, so only assert the cap
      // where batching actually had a choice.
      if (b.length > 1) expect(total).toBeLessThanOrEqual(5800);
    }
  });

  it("respects the 10-embed-per-message cap", async () => {
    const { batchEmbeds } = await mod();
    const batches = batchEmbeds(await Promise.all(Array.from({ length: 25 }, () => embedOf(10))));
    expect(batches.every(b => b.length <= 10)).toBe(true);
    expect(batches.flat()).toHaveLength(25);
  });

  it("reportIssue logs and never throws when no admin channel is configured", async () => {
    delete process.env.DISCORD_ADMIN_CHANNEL_ID;
    const { reportIssue } = await mod();
    await expect(reportIssue("Test context", new Error("boom"))).resolves.toBeUndefined();
    const logged = errorSpy.mock.calls.map(c => String(c[0])).join(" ");
    expect(logged).toContain("Test context");
    expect(logged).toContain("boom");
  });
});
