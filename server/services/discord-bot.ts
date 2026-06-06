import { Client, GatewayIntentBits, EmbedBuilder, TextChannel, ForumChannel, ChannelType, ColorResolvable } from "discord.js";

type SendableChannel = TextChannel | ForumChannel;
import { classifySymbol, categoryLabel, type SignalCategory } from "./signal-classifier.js";
import type { SymbolBriefData, CalendarEventData } from "./discord.js";
import type { MarketPulse } from "./market-pulse.js";

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
const CHANNEL_ENV: Record<SignalCategory | "free" | "copier" | "brief", string> = {
  free: "DISCORD_FREE_CHANNEL_ID",
  currency: "DISCORD_CURRENCY_CHANNEL_ID",
  metals: "DISCORD_METALS_CHANNEL_ID",
  indices: "DISCORD_INDICES_CHANNEL_ID",
  other: "DISCORD_PAID_CHANNEL_ID",
  copier: "DISCORD_COPIER_CHANNEL_ID",
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
    )
    .setFooter({ text: `MarketEdgePro · ${categoryLabel(category)} Signals · Predictive Ranges v5` })
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

  // Post to copier channel (all signals go there — copier members get everything)
  const copierChannelId = process.env[CHANNEL_ENV.copier];
  if (copierChannelId) {
    const ch = await getChannel(copierChannelId);
    if (ch) await sendToChannel(ch, title, [buildFullEmbed(signal, category)]);
  }
}

export async function postMorningBriefViaBot(
  symbols: SymbolBriefData[],
  calendarEvents: CalendarEventData[] = [],
  pulse?: MarketPulse
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
    const pulseEmbed = new EmbedBuilder()
      .setTitle(`🌅 Market Pulse — ${now}`)
      .setDescription(rows.join("\n") + (pulse.narrative ? `\n\n📝 *${pulse.narrative}*` : ""))
      .setColor(0x0ea5e9)
      .setFooter({ text: "Pre-Market Snapshot · Live data from Yahoo Finance" });
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

  if (calendarEvents.length > 0) {
    const impactEmoji = (i: string) => i === "High" ? "🔴" : i === "Medium" ? "🟡" : "⚪";
    const lines = calendarEvents.map(e => {
      const time = new Date(e.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" });
      return `${impactEmoji(e.impact)} **${e.country}** ${e.title} — ${time} EST${e.forecast ? ` | Forecast: ${e.forecast}` : ""}${e.previous ? ` | Prev: ${e.previous}` : ""}`;
    });

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

export function getBotStatus(): { configured: boolean; channels: Record<string, boolean> } {
  return {
    configured: !!process.env.DISCORD_BOT_TOKEN,
    channels: {
      free: !!process.env.DISCORD_FREE_CHANNEL_ID,
      currency: !!process.env.DISCORD_CURRENCY_CHANNEL_ID,
      metals: !!process.env.DISCORD_METALS_CHANNEL_ID,
      indices: !!process.env.DISCORD_INDICES_CHANNEL_ID,
      brief: !!process.env.DISCORD_BRIEF_CHANNEL_ID,
      copier: !!process.env.DISCORD_COPIER_CHANNEL_ID,
    },
  };
}
