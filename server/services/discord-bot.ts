import { Client, GatewayIntentBits, EmbedBuilder, TextChannel, ForumChannel, ChannelType, ColorResolvable } from "discord.js";

type SendableChannel = TextChannel | ForumChannel;
import { classifySymbol, categoryLabel, type SignalCategory } from "./signal-classifier.js";
import type { SymbolBriefData, CalendarEventData } from "./discord.js";
import type { MarketPulse } from "./market-pulse.js";
import type { StockAlertBrief, PullbackBriefResult, PortfolioHealthResult } from "./brief-sources.js";

let client: Client | null = null;
let clientReady: Promise<void> | null = null;

function getClient(): { bot: Client; ready: Promise<void> } | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;

  if (!client) {
    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    clientReady = new Promise<void>((resolve, reject) => {
      client!.once("ready", () => {
        console.log("[discord-bot] Bot ready");
        resolve();
      });
      client!.login(token).catch(err => {
        console.error("[discord-bot] Login failed:", err);
        client = null;
        clientReady = null;
        reject(err);
      });
    });
  }
  return { bot: client, ready: clientReady! };
}

async function getChannel(id: string | undefined): Promise<SendableChannel | null> {
  if (!id) { console.error("[discord-bot] No channel ID provided"); return null; }
  const result = getClient();
  if (!result) { console.error("[discord-bot] No client"); return null; }
  try {
    await Promise.race([result.ready, new Promise((_, rej) => setTimeout(() => rej(new Error("ready timeout")), 15000))]);
    const ch = await result.bot.channels.fetch(id);
    console.log(`[discord-bot] Fetched channel ${id}: type=${ch?.type}, classname=${ch?.constructor?.name}`);
    if (ch instanceof TextChannel || ch instanceof ForumChannel) return ch;
  } catch (err) {
    console.error(`[discord-bot] Could not fetch channel ${id}:`, err);
  }
  return null;
}

async function sendToChannel(ch: SendableChannel, title: string, embeds: EmbedBuilder[]): Promise<boolean> {
  try {
    if (ch.type === ChannelType.GuildForum) {
      await (ch as ForumChannel).threads.create({
        name: title.slice(0, 100),
        message: { embeds },
      });
    } else {
      await (ch as TextChannel).send({ embeds });
    }
    return true;
  } catch (err) {
    console.error("[discord-bot] send failed:", err);
    return false;
  }
}

function fmt(v: number): string {
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00");
  return v.toFixed(5).replace(/0+$/, "").replace(/\.$/, ".00000");
}

function toTVSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace("/", "").replace("-", "");
  const forex = ["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD","EURGBP","EURJPY","GBPJPY","EURAUD","EURCAD","EURCHF","EURNZD","GBPAUD","GBPCAD","GBPCHF","GBPNZD","AUDCAD","AUDCHF","AUDJPY","AUDNZD","CADJPY","CHFJPY","NZDJPY","NZDCAD","NZDCHF","CADCHF"];
  if (forex.includes(s)) return `FX:${s}`;
  if (s === "XAUUSD") return "TVC:GOLD";
  if (s === "XAGUSD") return "TVC:SILVER";
  if (s === "US30" || s === "DJI") return "TVC:DJI";
  if (s === "NAS100" || s === "NDX" || s === "US100") return "TVC:NDX";
  if (s === "SPX500" || s === "SPX" || s === "US500") return "TVC:SPX";
  return s;
}

export interface BotSignalAlert {
  symbol: string;
  timeframe: string;
  direction: string;
  signalType: string;
  price?: number | null;
  sl?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  emaAlignment?: string | null;
  rsiValue?: number | null;
  renkoTrend?: string | null;
  mtfScore?: string | null;
  confluenceCount?: number | null;
}

// Channel ID env var per category
const CHANNEL_ENV: Record<SignalCategory | "free" | "brief", string> = {
  free: "DISCORD_FREE_CHANNEL_ID",
  currency: "DISCORD_CURRENCY_CHANNEL_ID",
  metals: "DISCORD_METALS_CHANNEL_ID",
  crypto: "DISCORD_CRYPTO_CHANNEL_ID",
  stocks: "DISCORD_STOCKS_CHANNEL_ID",
  other: "DISCORD_PAID_CHANNEL_ID",
  brief: "DISCORD_BRIEF_CHANNEL_ID",
};

function buildTeaserEmbed(signal: BotSignalAlert): EmbedBuilder {
  const dir = signal.direction.toUpperCase();
  const isBull = dir === "BULLISH" || dir === "BUY";
  const color: ColorResolvable = isBull ? 0x22c55e : 0xef4444;
  const emoji = isBull ? "📈" : "📉";

  return new EmbedBuilder()
    .setTitle(`${emoji} ${signal.symbol} — ${dir}`)
    .setDescription(
      `A new **${signal.signalType}** signal has fired on the **${signal.timeframe}** chart.\n\n` +
      `🔒 *Subscribe to see full entry, SL, and TP levels.*`
    )
    .setColor(color)
    .setFooter({ text: "MarketEdgePro · Free Preview" })
    .setTimestamp();
}

function buildFullEmbed(signal: BotSignalAlert, category: SignalCategory): EmbedBuilder {
  const dir = signal.direction.toUpperCase();
  const isBull = dir === "BULLISH" || dir === "BUY";
  const color: ColorResolvable = isBull ? 0x22c55e : 0xef4444;
  const emoji = isBull ? "📈" : "📉";
  const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(toTVSymbol(signal.symbol))}&interval=${signal.timeframe}`;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${categoryLabel(category)} Signal: ${signal.symbol} — ${dir}`)
    .setURL(tvUrl)
    .setColor(color)
    .addFields(
      { name: "Symbol", value: signal.symbol, inline: true },
      { name: "Timeframe", value: signal.timeframe, inline: true },
      { name: "Direction", value: `${emoji} ${dir}`, inline: true },
      { name: "Signal Type", value: signal.signalType || "Indicator Alert", inline: true },
    )
    .setFooter({ text: `MarketEdgePro · ${categoryLabel(category)} Signals` })
    .setTimestamp();

  if (signal.price != null) embed.addFields({ name: "Price", value: fmt(signal.price), inline: true });
  if (signal.sl != null) embed.addFields({ name: "🔴 Stop Loss", value: fmt(signal.sl), inline: true });
  if (signal.tp1 != null) embed.addFields({ name: "🎯 TP1", value: fmt(signal.tp1), inline: true });
  if (signal.tp2 != null) embed.addFields({ name: "🎯 TP2", value: fmt(signal.tp2), inline: true });
  if (signal.tp3 != null) embed.addFields({ name: "🎯 TP3", value: fmt(signal.tp3), inline: true });
  if (signal.emaAlignment) embed.addFields({ name: "EMA", value: signal.emaAlignment, inline: true });
  if (signal.rsiValue != null) embed.addFields({ name: "RSI", value: fmt(signal.rsiValue), inline: true });
  if (signal.renkoTrend) embed.addFields({ name: "Renko", value: signal.renkoTrend, inline: true });
  if (signal.mtfScore) embed.addFields({ name: "MTF Score", value: signal.mtfScore, inline: true });
  if (signal.confluenceCount != null) embed.addFields({ name: "Confluence", value: String(signal.confluenceCount), inline: true });
  embed.addFields({ name: "📊 Chart", value: `[Open in TradingView](${tvUrl})`, inline: false });

  return embed;
}

export async function postSignalViaBot(signal: BotSignalAlert): Promise<void> {
  const category = classifySymbol(signal.symbol);
  const title = `${signal.symbol} ${signal.direction} ${signal.timeframe}`;

  // Post teaser to free channel
  const freeChannelId = process.env[CHANNEL_ENV.free];
  if (freeChannelId) {
    const ch = await getChannel(freeChannelId);
    if (ch) await sendToChannel(ch, title, [buildTeaserEmbed(signal)]);
  }

  // Post full signal to the category channel
  const catChannelId = process.env[CHANNEL_ENV[category]];
  if (catChannelId) {
    const ch = await getChannel(catChannelId);
    if (ch) await sendToChannel(ch, title, [buildFullEmbed(signal, category)]);
  }

}

function trendGlyph(trend?: string): string {
  if (trend === "uptrend") return "↗";
  if (trend === "downtrend") return "↘";
  if (trend === "sideways") return "→";
  return "";
}

// Smart Investor buy-side alerts — the stock-side counterpart to the watchlist
// brief. Forwarded into MarketEdgePro by the Smart Investor app.
function buildStockAlertsEmbed(alerts: StockAlertBrief[]): EmbedBuilder | null {
  if (!alerts.length) return null;
  const lines = alerts.map(a => {
    const dir = a.aiDirection?.toUpperCase();
    const dirEmoji = dir === "BULLISH" ? "🟢" : dir === "BEARISH" ? "🔴" : "⚪";
    const priceStr = a.price != null ? ` · $${fmt(a.price)}` : "";
    const trend = trendGlyph(a.trend);
    const trendStr = trend ? ` ${trend}` : "";
    const triggers = a.triggers.length ? `\n   ↳ ${a.triggers.join(" · ")}` : "";
    const name = a.company ? ` *(${a.company})*` : "";
    return `${dirEmoji} **${a.symbol}**${name}${priceStr}${trendStr}${triggers}`;
  });
  return new EmbedBuilder()
    .setTitle(`🧭 Smart Investor — Buy-Side Watch (${alerts.length})`)
    .setDescription(lines.join("\n") + "\n\n*RSI / MA-pullback / 52-week / support triggers on large caps.*")
    .setColor(0x8b5cf6)
    .setFooter({ text: "MarketEdgePro · Smart Investor Alerts" });
}

// Top pullback picks from the latest Smart Pullback live-screener run.
function buildPullbackEmbed(result: PullbackBriefResult): EmbedBuilder | null {
  if (!result.picks.length) return null;
  const header = `${pad("SYM", 6)}${pad("SIGNAL", 9)}${pad("PRICE", 9)}${pad("PF", 7)}${pad("WR%", 6)}WHEN`;
  const lines = result.picks.map(p =>
    `${pad(p.symbol, 6)}${pad(p.signal, 9)}${pad(p.price.toFixed(2), 9)}${pad(p.pf.toFixed(2), 7)}${pad(p.wr.toFixed(0), 6)}${p.when}`
  );
  const table = "```\n" + header + "\n" + lines.join("\n") + "\n```";
  const more = result.total > result.picks.length ? `\n*+${result.total - result.picks.length} more in the full screener.*` : "";
  return new EmbedBuilder()
    .setTitle(`🎯 Top Pullback Picks (${result.picks.length} of ${result.total})`)
    .setDescription(table + more)
    .setColor(0x22c55e)
    .setFooter({ text: `MarketEdgePro · Smart Pullback Screener${result.runAt ? ` · Run: ${result.runAt}` : ""}` });
}

// EA portfolio health from Myfxbook — equity, live/max drawdown, recovery factor.
function buildPortfolioEmbed(result?: PortfolioHealthResult): EmbedBuilder | null {
  if (!result || !result.accounts.length) return null;
  const rfFlag = (rf: number) => rf >= 3 ? "🟢" : rf >= 1 ? "🟡" : rf >= 0 ? "🟠" : "🔴";
  const lines = result.accounts.map(a => {
    const demo = a.demo ? " *(demo)*" : "";
    const gainSign = a.gainPct >= 0 ? "+" : "";
    return (
      `${rfFlag(a.recoveryFactor)} **${a.label}**${demo}\n` +
      `   Equity ${a.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })} · ` +
      `cur DD ${a.currentDdPct.toFixed(1)}% · max DD ${a.maxDdPct.toFixed(1)}% · ` +
      `gain ${gainSign}${a.gainPct.toFixed(1)}% · RF ${a.recoveryFactor.toFixed(2)}`
    );
  });
  return new EmbedBuilder()
    .setTitle(`🩺 EA Portfolio Health (${result.accounts.length})`)
    .setDescription(lines.join("\n") + "\n\n*RF: 🟢 ≥3 · 🟡 1–3 · 🟠 0–1 · 🔴 net loss. Live data from Myfxbook.*")
    .setColor(0x0ea5e9)
    .setFooter({ text: "MarketEdgePro · EA Portfolio Health" });
}

/**
 * Posts a short notice when the morning brief could not be produced.
 * Without this a failed brief is completely silent, which is how the brief
 * went missing for weeks before anyone noticed.
 */
export async function postBriefFailureViaBot(reason: string): Promise<boolean> {
  const channelId = process.env[CHANNEL_ENV.brief];
  if (!channelId) return false;

  const ch = await getChannel(channelId);
  if (!ch) return false;

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/New_York",
  });

  const embed = new EmbedBuilder()
    .setTitle("⚠️ Morning Brief Unavailable")
    .setDescription(
      `Today's brief (${today}) could not be generated and will be retried.\n\n` +
      "This is usually the AI provider being unreachable, out of credit, or rate limited.",
    )
    .addFields({ name: "Reason", value: "```" + reason.slice(0, 900) + "```" })
    .setColor(0xf59e0b)
    .setTimestamp();

  try {
    if (ch.isTextBased() && "send" in ch) {
      await (ch as TextChannel).send({ embeds: [embed] });
      return true;
    }
  } catch (err) {
    console.error("[discord-bot] Failed to post brief failure notice:", err);
  }
  return false;
}

/**
 * One-line technicals callout for the Market Pulse embed, or "" when nothing
 * is at an extreme.
 *
 * Only instruments at an RSI extreme appear. Annotating all ten would print
 * "Buy" beside most of them, which is noise — the point is to surface the two
 * or three worth a second look. Bands are the conventional 30/70, matching
 * Smart Investor's own oversold threshold rather than a number picked to make
 * a particular day look interesting.
 *
 * Instruments without technicals (TVC:US10Y has none) are skipped, as is the
 * whole line when TradingView was unreachable.
 */
export function pulseHighlightLine(items: MarketPulse["items"]): string {
  const stretched = items.filter(i => i.rsi != null && i.rsi >= 70);
  const oversold = items.filter(i => i.rsi != null && i.rsi <= 30);
  const fmt = (list: typeof items) =>
    list.map(i => `${i.label} RSI ${i.rsi!.toFixed(0)}`).join(" · ");

  const parts: string[] = [];
  if (stretched.length) parts.push(`Stretched: ${fmt(stretched)}`);
  if (oversold.length) parts.push(`Oversold: ${fmt(oversold)}`);
  return parts.length ? `⚡ ${parts.join("   |   ")}` : "";
}

export async function postMorningBriefViaBot(
  symbols: SymbolBriefData[],
  calendarEvents: CalendarEventData[] = [],
  pulse?: MarketPulse,
  stockAlerts: StockAlertBrief[] = [],
  pullbacks?: PullbackBriefResult,
  portfolio?: PortfolioHealthResult
): Promise<boolean> {
  const channelId = process.env[CHANNEL_ENV.brief];
  if (!channelId) return false;

  const ch = await getChannel(channelId);
  if (!ch) return false;

  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/New_York",
  });

  const embeds: EmbedBuilder[] = [];

  // Market Pulse — quantitative snapshot + AI narrative
  if (pulse && pulse.items.length > 0) {
    // Build the snapshot grid: 2 items per row
    const rows: string[] = [];
    for (let i = 0; i < pulse.items.length; i += 2) {
      const a = pulse.items[i];
      const b = pulse.items[i + 1];
      const fmtItem = (it: typeof a) => {
        const sign = it.changePct >= 0 ? "+" : "";
        const arrow = it.changePct >= 0 ? "🟢" : "🔴";
        return `${it.emoji ?? ""} **${it.label}** ${it.price} ${arrow} ${sign}${it.changePct.toFixed(2)}%`;
      };
      rows.push(b ? `${fmtItem(a)}  •  ${fmtItem(b)}` : fmtItem(a));
    }

    const line = pulseHighlightLine(pulse.items);
    const highlight = line ? `\n\n${line}` : "";

    // Ratings are decorative, so serving stale ones is fine — passing them off
    // as current is not. Say so when it happens.
    const staleNote = pulse.technicalsStale && pulse.technicalsAsOf
      ? `\n\n⚠️ *Technicals unavailable — showing values from ${pulse.technicalsAsOf.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })} ET.*`
      : "";

    const footer = pulse.technicalsAsOf
      ? "Pre-Market Snapshot · Prices from Yahoo Finance · Technicals from TradingView"
      : "Pre-Market Snapshot · Live data from Yahoo Finance";

    const pulseEmbed = new EmbedBuilder()
      .setTitle(`🌅 Market Pulse — ${now}`)
      .setDescription(
        rows.join("\n") + highlight + staleNote +
        (pulse.narrative ? `\n\n📝 *${pulse.narrative}*` : "")
      )
      .setColor(0x0ea5e9)
      .setFooter({ text: footer });
    embeds.push(pulseEmbed);
  }

  const briefEmbed = new EmbedBuilder()
    .setTitle(`☀️ Morning Market Brief — ${now}`)
    .setDescription("AI-powered pre-market bias + news digest for your watchlist.\nNew York session opens at 9:30 AM EST.")
    .setColor(0xf59e0b)
    .setTimestamp()
    .setFooter({ text: "MarketEdgePro · Daily Pre-Market Brief · 8:00 AM EST" });

  for (const { symbol, name, direction, confluenceScore, confidence, summary, headlines } of symbols) {
    const biasEmoji = direction === "BULLISH" ? "🟢" : "🔴";
    const header = `${biasEmoji} **${direction}** · Score ${confluenceScore}/10 · ${confidence} confidence`;
    const newsLines = headlines.length ? headlines.join("\n") : "*No recent headlines*";
    briefEmbed.addFields({
      name: `${symbol} — ${name}`,
      value: `${header}\n*${summary}*\n\n${newsLines}`,
      inline: false,
    });
  }

  embeds.push(briefEmbed);

  // Smart Investor buy-side alerts (stock side)
  const stockEmbed = buildStockAlertsEmbed(stockAlerts);
  if (stockEmbed) embeds.push(stockEmbed);

  // Top pullback picks from the latest live-screener run
  if (pullbacks) {
    const pullbackEmbed = buildPullbackEmbed(pullbacks);
    if (pullbackEmbed) embeds.push(pullbackEmbed);
  }

  // EA portfolio health (Myfxbook)
  const portfolioEmbed = buildPortfolioEmbed(portfolio);
  if (portfolioEmbed) embeds.push(portfolioEmbed);

  if (calendarEvents.length > 0) {
    const impactEmoji = (i: string) => i === "High" ? "🔴" : i === "Medium" ? "🟡" : "⚪";

    // Label dates as Today / Tomorrow / weekday (Mon Jun 9) in EST
    const todayEST = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const tomorrowEST = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const dayLabel = (iso: string) => {
      const d = new Date(iso);
      const dKey = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      if (dKey === todayEST)    return "**Today**";
      if (dKey === tomorrowEST) return "**Tomorrow**";
      return `**${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })}**`;
    };

    // Group by day for cleaner readability
    const grouped: Record<string, typeof calendarEvents> = {};
    for (const e of calendarEvents) {
      const key = dayLabel(e.date);
      (grouped[key] ??= []).push(e);
    }

    const lines: string[] = [];
    for (const [day, dayEvents] of Object.entries(grouped)) {
      lines.push(`\n${day}`);
      for (const e of dayEvents) {
        const time = new Date(e.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
        lines.push(`${impactEmoji(e.impact)} ${e.country} ${e.title} · ${time} EST${e.forecast ? ` | Forecast: ${e.forecast}` : ""}${e.previous ? ` | Prev: ${e.previous}` : ""}`);
      }
    }

    embeds.push(
      new EmbedBuilder()
        .setTitle("📅 Economic Calendar — Today & Tomorrow")
        .setDescription(lines.join("\n") || "*No high/medium impact events*")
        .setColor(0x6366f1)
        .setFooter({ text: "High 🔴  Medium 🟡  Low ⚪ — Times in EST" })
    );
  }

  return await sendToChannel(ch, `Morning Brief — ${now}`, embeds);
}

// Pad/truncate helper for the monospace screener tables.
function pad(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s.padEnd(width);
}

export async function postScreenerResultsViaBot(
  mode: "live" | "options",
  rows: Array<Record<string, any>>,
  meta: { file: string; runAt: string; count: number } | null
): Promise<{ sent: boolean; reason?: string }> {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn("[discord-bot] DISCORD_BOT_TOKEN not set");
    return { sent: false, reason: "Discord bot token not configured (DISCORD_BOT_TOKEN missing on the server)." };
  }
  const channelId = process.env.DISCORD_SCREENER_CHANNEL_ID;
  if (!channelId) {
    console.warn("[discord-bot] DISCORD_SCREENER_CHANNEL_ID not set");
    return { sent: false, reason: "Screener Discord channel isn't configured — set DISCORD_SCREENER_CHANNEL_ID in your Railway env vars." };
  }
  const ch = await getChannel(channelId);
  if (!ch) {
    return { sent: false, reason: "Couldn't reach the configured Discord channel — check DISCORD_SCREENER_CHANNEL_ID and that the bot has access to it." };
  }

  const title = mode === "live"
    ? `🔥 Smart Pullback — Live Signals (${meta?.count ?? rows.length} found)`
    : `📊 Smart Pullback — Options Screener (${meta?.count ?? rows.length} stocks)`;

  // Monospace table rows — aligned columns read far better than prose lines
  // for long lists. Direction arrows stay outside the code block via the
  // header; inside we use plain LONG/SHORT text.
  const header = mode === "live"
    ? `${pad("#", 3)}${pad("SYM", 6)}${pad("SIGNAL", 9)}${pad("PRICE", 9)}${pad("PF", 7)}${pad("WR%", 7)}WHEN`
    : `${pad("#", 3)}${pad("SYM", 6)}${pad("TREND", 7)}${pad("PRICE", 9)}${pad("PF", 7)}${pad("WR%", 7)}TRADES`;

  const lines = mode === "live"
    ? rows.map((r, i) => {
        const mark = r.barsAgo === 0 ? "*" : " ";
        return `${pad(String(i + 1), 3)}${pad(String(r.symbol ?? ""), 6)}${pad(String(r.signal ?? ""), 9)}${pad(Number(r.price).toFixed(2), 9)}${pad(Number(r.histPf).toFixed(2), 7)}${pad(Number(r.wr).toFixed(1), 7)}${r.when ?? ""}${mark === "*" ? "  <- today" : ""}`;
      })
    : rows.map((r, i) =>
        `${pad(String(i + 1), 3)}${pad(String(r.symbol ?? ""), 6)}${pad(String(r.trend ?? ""), 7)}${pad(Number(r.price).toFixed(2), 9)}${pad(Number(r.pf).toFixed(2), 7)}${pad(Number(r.wr).toFixed(1), 7)}${r.trades ?? ""}`
      );

  const longCount = mode === "options"
    ? rows.filter(r => String(r.trend).includes("LONG")).length
    : rows.filter(r => String(r.signal).includes("LONG")).length;
  const shortCount = rows.length - longCount;
  const summary = `📈 **${longCount} LONG**  ·  📉 **${shortCount} SHORT**`;

  // Discord caps an embed description at 4096 chars and a message at 10
  // embeds — chunk the table across embeds so every row is included.
  const MAX_DESC = 3800;
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLen = header.length + 20;
  for (const line of lines) {
    if (currentLen + line.length + 1 > MAX_DESC && current.length) {
      chunks.push(current);
      current = [];
      currentLen = header.length + 20;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length) chunks.push(current);

  const MAX_EMBEDS = 10;
  const embeds = chunks.slice(0, MAX_EMBEDS).map((chunkLines, i) => {
    const table = "```\n" + header + "\n" + chunkLines.join("\n") + "\n```";
    const desc = i === 0 ? `${summary}\n${table}` : table;
    return new EmbedBuilder()
      .setTitle(i === 0 ? title : `${title} — cont'd (${i + 1}/${Math.min(chunks.length, MAX_EMBEDS)})`)
      .setDescription(desc)
      .setColor(mode === "live" ? 0x22c55e : 0x6366f1)
      .setFooter({ text: `MarketEdgePro · Smart Pullback Screener${meta ? ` · Run: ${meta.runAt}` : ""}` })
      .setTimestamp();
  });
  if (chunks.length > MAX_EMBEDS) {
    const dropped = chunks.length - MAX_EMBEDS;
    const last = embeds[embeds.length - 1];
    last.setDescription(`${last.data.description}\n*…${dropped} more chunk(s) omitted (Discord 10-embed limit).*`);
  }

  const ok = await sendToChannel(ch, title, embeds);
  return { sent: ok, reason: ok ? undefined : "Discord rejected the message — check server logs for details." };
}

export function getBotStatus(): { configured: boolean; channels: Record<string, boolean> } {
  return {
    configured: !!process.env.DISCORD_BOT_TOKEN,
    channels: {
      free: !!process.env.DISCORD_FREE_CHANNEL_ID,
      currency: !!process.env.DISCORD_CURRENCY_CHANNEL_ID,
      metals: !!process.env.DISCORD_METALS_CHANNEL_ID,
      crypto: !!process.env.DISCORD_CRYPTO_CHANNEL_ID,
      stocks: !!process.env.DISCORD_STOCKS_CHANNEL_ID,
      brief: !!process.env.DISCORD_BRIEF_CHANNEL_ID,
      screener: !!process.env.DISCORD_SCREENER_CHANNEL_ID,
    },
  };
}
