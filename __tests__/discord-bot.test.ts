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

describe("Screener tables must fit a phone", () => {
  // Discord's mobile client WRAPS code blocks rather than scrolling them, so a
  // row wider than ~40 chars breaks in half and the table stops being a table.
  // The layout shipped at 56 chars and did exactly that. These tests fail if a
  // future column pushes it back over the line.
  const MOBILE_COLS = 40;

  const live = [
    { symbol: "NTRS", signal: "LONG PB", price: 187.66, histPf: 8.15, wr: 37.5, when: "TODAY" },
    { symbol: "PH", signal: "LONG PB", price: 1039.49, histPf: 2.13, wr: 25.0, when: "TODAY" },
    { symbol: "CCI", signal: "SHORT PB", price: 75.54, histPf: 1.5, wr: 40.0, when: "2d AGO" },
  ];

  it("keeps every live row inside the mobile width", async () => {
    const { buildScreenerTable } = await import("../server/services/discord-bot");
    const { header, lines } = buildScreenerTable("live", live);
    for (const l of [header, ...lines]) expect(l.length).toBeLessThanOrEqual(MOBILE_COLS);
  });

  it("keeps every options row inside the mobile width", async () => {
    const { buildScreenerTable } = await import("../server/services/discord-bot");
    const rows = [{ symbol: "GOOGL", trend: "SHORT", price: 1039.49, pf: 2.13, wr: 25.0, trades: 12 }];
    const { header, lines } = buildScreenerTable("options", rows);
    for (const l of [header, ...lines]) expect(l.length).toBeLessThanOrEqual(MOBILE_COLS);
  });

  it("marks direction per row, so the one short is not lost among longs", async () => {
    const { buildScreenerTable } = await import("../server/services/discord-bot");
    const { lines } = buildScreenerTable("live", live);
    expect(lines[0]).toContain("NTRS  L");
    expect(lines[2]).toContain("CCI   S");
  });

  it("renders age as 0d/1d/2d rather than TODAY/1d AGO", async () => {
    const { buildScreenerTable } = await import("../server/services/discord-bot");
    const { lines } = buildScreenerTable("live", live);
    expect(lines[0].trimEnd().endsWith("0d")).toBe(true);
    expect(lines[2].trimEnd().endsWith("2d")).toBe(true);
    expect(lines.join("\n")).not.toContain("TODAY");
  });

  it("right-aligns prices so decimal points line up down the column", async () => {
    const { buildScreenerTable } = await import("../server/services/discord-bot");
    const { lines } = buildScreenerTable("live", live);
    expect(lines[0].indexOf(".")).toBe(lines[1].indexOf("."));
  });

  it("survives missing numbers instead of printing NaN", async () => {
    const { buildScreenerTable } = await import("../server/services/discord-bot");
    const { lines } = buildScreenerTable("live", [{ symbol: "X", signal: "LONG PB" }]);
    expect(lines[0]).not.toContain("NaN");
  });
});

describe("Channel preflight — catching a permission break before it costs an alert", () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => { process.env = { ...ORIGINAL }; jest.resetModules(); });

  it("discovers channels from the environment, so a new one needs no code change", async () => {
    process.env.DISCORD_BOT_TOKEN = "";
    process.env.DISCORD_BRAND_NEW_CHANNEL_ID = "999";
    const { verifyDiscordChannels } = await import("../server/services/discord-bot");
    const checks = await verifyDiscordChannels();
    expect(checks.map(c => c.envVar)).toContain("DISCORD_BRAND_NEW_CHANNEL_ID");
  });

  it("skips a deliberately unset channel rather than reporting it broken", async () => {
    process.env.DISCORD_BOT_TOKEN = "";
    process.env.DISCORD_OTHER_CHANNEL_ID = "";
    const { verifyDiscordChannels } = await import("../server/services/discord-bot");
    const checks = await verifyDiscordChannels();
    expect(checks.map(c => c.envVar)).not.toContain("DISCORD_OTHER_CHANNEL_ID");
  });

  it("flags an unreachable channel instead of passing it", async () => {
    process.env.DISCORD_BOT_TOKEN = "";           // no client -> getChannel returns null
    process.env.DISCORD_STOCKS_CHANNEL_ID = "123";
    const { verifyDiscordChannels } = await import("../server/services/discord-bot");
    const checks = await verifyDiscordChannels();
    const stocks = checks.find(c => c.envVar === "DISCORD_STOCKS_CHANNEL_ID");
    expect(stocks?.ok).toBe(false);
    expect(stocks?.problem).toMatch(/not found|cannot see/i);
  });

  it("never throws, so a failing preflight cannot take the process down", async () => {
    process.env.DISCORD_BOT_TOKEN = "";
    process.env.DISCORD_STOCKS_CHANNEL_ID = "123";
    const { checkChannelsAndReport } = await import("../server/services/discord-bot");
    await expect(checkChannelsAndReport("test")).resolves.toBeDefined();
  });
});
