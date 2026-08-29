import { Client, GatewayIntentBits, EmbedBuilder, TextChannel, ForumChannel, ChannelType, ColorResolvable, PermissionsBitField } from "discord.js";

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
    void reportIssue("Discord send failed", err, { channel: ch.id, message: title });
    return false;
  }
}

/**
 * Total characters an embed contributes toward Discord's per-message budget:
 * title + description + footer + every field name and value.
 */
export function embedLength(e: EmbedBuilder): number {
  const d = e.data;
  let n = (d.title?.length ?? 0) + (d.description?.length ?? 0) + (d.footer?.text?.length ?? 0)
        + (d.author?.name?.length ?? 0);
  for (const f of d.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

/**
 * Split embeds into messages that respect Discord's PER-MESSAGE limits: 6000
 * characters summed across all embeds, and 10 embeds.
 *
 * Clamping individual fields is not enough — on 2026-08-25 every field was
 * within its own limit and the message still bounced with 50035 Invalid Form
 * Body, because the brief as a whole had grown past 6000. Splitting keeps every
 * section rather than dropping the ones that no longer fit.
 */
export function batchEmbeds(
  embeds: EmbedBuilder[],
  maxChars = 5800, // headroom under 6000
  maxPerMessage = 10,
): EmbedBuilder[][] {
  const batches: EmbedBuilder[][] = [];
  let current: EmbedBuilder[] = [];
  let used = 0;

  for (const e of embeds) {
    const len = embedLength(e);
    const wouldOverflow = current.length > 0 && (used + len > maxChars || current.length >= maxPerMessage);
    if (wouldOverflow) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(e);
    used += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Send embeds as however many messages it takes. Returns true only if every
 * message landed — a partially delivered brief is a failure worth reporting.
 */
async function sendBatched(ch: SendableChannel, title: string, embeds: EmbedBuilder[]): Promise<boolean> {
  const batches = batchEmbeds(embeds);
  if (batches.length > 1) {
    console.log(`[discord-bot] ${title}: ${embeds.length} embeds split across ${batches.length} messages (Discord 6000-char limit)`);
  }
  let allOk = true;
  for (const batch of batches) {
    const ok = await sendToChannel(ch, title, batch);
    if (!ok) allOk = false;
  }
  return allOk;
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
  // "other" is the catch-all: symbols the classifier can't place, which in
  // practice means futures notation (CL1!, ES1!) and broker-suffixed pairs
  // (XAUUSD.p, EURUSDm). Named DISCORD_PAID_CHANNEL_ID historically, from before
  // signals were split by asset class — misleading now that every category
  // channel is paid. Deliberately left unset: nothing currently emits these, and
  // the warning above means a signal that hits it can no longer vanish quietly.
  other: "DISCORD_OTHER_CHANNEL_ID",
  brief: "DISCORD_BRIEF_CHANNEL_ID",
};

// Discord's hard limits. Exceeding any one of them rejects the WHOLE message
// with a CombinedPropertyError, so a single long AI summary silently kills the
// entire morning brief — which is exactly what happened on 2026-08-25.
export const DISCORD_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
} as const;

/** Truncate to `max`, marking the cut so a clipped value is visibly clipped. */
export function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Post an operational problem to the admin channel for later reference.
 *
 * Separate from postBriefFailureViaBot, which tells *subscribers* the brief is
 * late. This is the engineering record: what broke, when, with enough detail to
 * act on — in a channel members never see.
 *
 * Two rules it must never break:
 *   • It never throws. A reporter that fails loudly inside an error handler
 *     turns a recoverable problem into an outage.
 *   • It never routes through sendBatched/sendToChannel, whose own failures
 *     call back here — that would recurse.
 */
export async function reportIssue(
  context: string,
  detail: unknown,
  extra?: Record<string, string>,
): Promise<void> {
  const msg = detail instanceof Error ? (detail.stack ?? detail.message) : String(detail);
  // Always log, even when Discord is unreachable — the log is the fallback.
  console.error(`[issue] ${context}: ${msg}`);

  const channelId = process.env.DISCORD_ADMIN_CHANNEL_ID;
  if (!channelId) return;

  try {
    const ch = await getChannel(channelId);
    if (!ch) return; // deliberately silent: logging already happened above
    const embed = new EmbedBuilder()
      .setTitle(clamp(`⚠️ ${context}`, DISCORD_LIMITS.title))
      .setDescription("```" + clamp(msg, 1800) + "```")
      .setColor(0xef4444)
      .setFooter({ text: "MarketEdgePro · automatic issue report" })
      .setTimestamp();
    for (const [k, v] of Object.entries(extra ?? {})) {
      embed.addFields({
        name: clamp(k, DISCORD_LIMITS.fieldName),
        value: clamp(v, DISCORD_LIMITS.fieldValue),
        inline: true,
      });
    }
    await (ch as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    // Terminal on purpose — do not re-enter reportIssue.
    console.error("[issue] could not post to the admin channel:", err);
  }
}

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

  // Post full signal to the category channel.
  //
  // Both failure paths below are logged loudly on purpose. Silence here is how a
  // GOOGL signal reached the free teaser and nothing else for days: the category
  // channel was unreachable, the `if` skipped it, and no error was raised
  // anywhere. A dropped paid signal must never be quieter than a delivered one.
  const catEnv = CHANNEL_ENV[category];
  const catChannelId = process.env[catEnv];
  if (!catChannelId) {
    console.warn(
      `[discord-bot] ${signal.symbol} classified "${category}" but ${catEnv} is not set — ` +
        `teaser posted, full signal NOT delivered.`,
    );
    void reportIssue("Signal not delivered — channel not configured",
      `${signal.symbol} classified "${category}" but ${catEnv} is not set. The free teaser posted; the full signal did not.`,
      { symbol: signal.symbol, category, envVar: catEnv });
    return;
  }
  const ch = await getChannel(catChannelId);
  if (!ch) {
    console.error(
      `[discord-bot] ${signal.symbol} classified "${category}": channel ${catChannelId} ` +
        `(${catEnv}) is unreachable — check the bot has access. Full signal NOT delivered.`,
    );
    void reportIssue("Signal not delivered — channel unreachable",
      `${signal.symbol} classified "${category}": the bot cannot reach channel ${catChannelId}. Check it has View Channel + Send Messages there.`,
      { symbol: signal.symbol, category, channel: catChannelId });
    return;
  }
  await sendToChannel(ch, title, [buildFullEmbed(signal, category)]);
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
    .setDescription(clamp(lines.join("\n") + "\n\n*RSI / MA-pullback / 52-week / support triggers on large caps.*", DISCORD_LIMITS.description))
    .setColor(0x8b5cf6)
    .setFooter({ text: "MarketEdgePro · Smart Investor Alerts" });
}

/**
 * Top pullback picks from the latest Smart Pullback live-screener run.
 *
 * Returns one embed per chunk: the screener channel shows the FULL run, and a
 * long run's table would otherwise be clamped at an embed's 4096-char
 * description — silently dropping the tail, which is the opposite of "full".
 * batchEmbeds() then spreads the chunks across messages as needed.
 */
function buildPullbackEmbeds(result: PullbackBriefResult): EmbedBuilder[] {
  if (!result.picks.length) return [];
  const header = `${pad("SYM", 6)}${pad("SIGNAL", 9)}${pad("PRICE", 9)}${pad("PF", 7)}${pad("WR%", 6)}WHEN`;
  const lines = result.picks.map(p =>
    `${pad(p.symbol, 6)}${pad(p.signal, 9)}${pad(p.price.toFixed(2), 9)}${pad(p.pf.toFixed(2), 7)}${pad(p.wr.toFixed(0), 6)}${p.when}`
  );

  // Room for the fence, header and a little slack for the "+N more" footer line.
  const budget = DISCORD_LIMITS.description - header.length - 120;
  const chunks: string[][] = [];
  let current: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (current.length && used + line.length + 1 > budget) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += line.length + 1;
  }
  if (current.length) chunks.push(current);

  const truncated = result.total > result.picks.length;
  const runNote = result.runAt ? ` · Run: ${result.runAt}` : "";

  return chunks.map((chunkLines, i) => {
    const table = "```\n" + header + "\n" + chunkLines.join("\n") + "\n```";
    const isLast = i === chunks.length - 1;
    const more = isLast && truncated
      ? `\n*+${result.total - result.picks.length} more in the full screener.*`
      : "";
    const part = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : "";
    const title = truncated
      ? `🎯 Top Pullback Picks (${result.picks.length} of ${result.total})${part}`
      : `🎯 Pullback Picks — full run (${result.total})${part}`;
    return new EmbedBuilder()
      .setTitle(clamp(title, DISCORD_LIMITS.title))
      .setDescription(clamp(table + more, DISCORD_LIMITS.description))
      .setColor(0x22c55e)
      .setFooter({ text: `MarketEdgePro · Smart Pullback Screener${runNote}` });
  });
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
    .setDescription(clamp(lines.join("\n") + "\n\n*RF: 🟢 ≥3 · 🟡 1–3 · 🟠 0–1 · 🔴 net loss. Live data from Myfxbook.*", DISCORD_LIMITS.description))
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

/**
 * The Market Pulse embed. Shared by the brief channel and the free preview, so
 * both show the identical snapshot rather than drifting apart.
 */
export function buildPulseEmbed(pulse: MarketPulse, now: string): EmbedBuilder | null {
  if (!pulse.items.length) return null;

  // Snapshot grid: 2 instruments per row.
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

  return new EmbedBuilder()
    .setTitle(`🌅 Market Pulse — ${now}`)
    .setDescription(
      clamp(
        rows.join("\n") + highlight + staleNote +
          (pulse.narrative ? `\n\n📝 *${pulse.narrative}*` : ""),
        DISCORD_LIMITS.description,
      )
    )
    .setColor(0x0ea5e9)
    .setFooter({ text: footer });
}

/**
 * The Economic Calendar embed, grouped by day in EST. Returns null when there
 * is nothing to show, so callers can simply skip it.
 */
export function buildCalendarEmbed(calendarEvents: CalendarEventData[]): EmbedBuilder | null {
  if (!calendarEvents.length) return null;

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
  const grouped: Record<string, CalendarEventData[]> = {};
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

  return new EmbedBuilder()
    .setTitle("📅 Economic Calendar — Today & Tomorrow")
    .setDescription(clamp(lines.join("\n") || "*No high/medium impact events*", DISCORD_LIMITS.description))
    .setColor(0x6366f1)
    .setFooter({ text: "High 🔴  Medium 🟡  Low ⚪ — Times in EST" });
}

/**
 * Market Pulse + Economic Calendar to the free preview channel.
 *
 * These are macro context rather than paid signal detail, so the free tier gets
 * them in full — unlike signals, which are teased there. Deliberately isolated:
 * this runs after the paying channel has already been served, and any failure
 * is logged and swallowed so a free-channel problem can never cost subscribers
 * their brief.
 */
async function postFreePreviewExtras(pulse: MarketPulse | undefined, calendarEvents: CalendarEventData[], now: string): Promise<void> {
  const freeChannelId = process.env[CHANNEL_ENV.free];
  if (!freeChannelId) return;

  const extras: EmbedBuilder[] = [];
  if (pulse) {
    const e = buildPulseEmbed(pulse, now);
    if (e) extras.push(e);
  }
  const cal = buildCalendarEmbed(calendarEvents);
  if (cal) extras.push(cal);
  if (!extras.length) return;

  try {
    const freeCh = await getChannel(freeChannelId);
    if (!freeCh) {
      console.error("[discord-bot] free preview channel unreachable — skipping pulse/calendar");
      return;
    }
    await sendBatched(freeCh, `Market Pulse — ${now}`, extras);
  } catch (err) {
    console.error("[discord-bot] free preview extras failed (brief unaffected):", err);
  }
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
    const pulseEmbed = buildPulseEmbed(pulse, now);
    if (pulseEmbed) embeds.push(pulseEmbed);
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
    // The header carries the score and confidence, so it must survive; the
    // summary and headlines are what grow unboundedly. Trim the news first and
    // only then hard-clamp, so a long day loses headlines rather than the
    // analysis — and never the whole brief.
    const head = `${header}\n*${summary}*\n\n`;
    const room = DISCORD_LIMITS.fieldValue - head.length;
    const news = room > 0 ? clamp(newsLines, room) : "";
    briefEmbed.addFields({
      name: clamp(`${symbol} — ${name}`, DISCORD_LIMITS.fieldName),
      value: clamp(head + news, DISCORD_LIMITS.fieldValue),
      inline: false,
    });
  }

  embeds.push(briefEmbed);

  // Smart Investor buy-side alerts (stock side)
  const stockEmbed = buildStockAlertsEmbed(stockAlerts);
  if (stockEmbed) embeds.push(stockEmbed);

  // Top pullback picks go to the screener channel, not the brief — they are
  // screener output and belong with the rest of it. Posted separately below so
  // a screener-channel problem cannot affect the brief.

  // EA portfolio health (Myfxbook)
  const portfolioEmbed = buildPortfolioEmbed(portfolio);
  if (portfolioEmbed) embeds.push(portfolioEmbed);

  const calendarEmbed = buildCalendarEmbed(calendarEvents);
  if (calendarEmbed) embeds.push(calendarEmbed);

  // Serve the paying channel first, then mirror the free-tier sections. Awaited
  // rather than fire-and-forget so failures surface in the logs of this request.
  const sent = await sendBatched(ch, `Morning Brief — ${now}`, embeds);
  await postFreePreviewExtras(pulse, calendarEvents, now);
  await postPullbackPicks(pullbacks, now);
  return sent;
}

/**
 * Top pullback picks, posted to the screener channel rather than the brief.
 *
 * They are screener output and belong with the rest of it. Kept out of the
 * brief's own send so a screener-channel problem — a permission change, a
 * missing variable — can never cost subscribers their brief. Failures are
 * reported to the admin channel rather than swallowed.
 */
async function postPullbackPicks(pullbacks: PullbackBriefResult | undefined, now: string): Promise<void> {
  if (!pullbacks) return;
  const pullbackEmbeds = buildPullbackEmbeds(pullbacks);
  if (!pullbackEmbeds.length) return;

  const channelId = process.env.DISCORD_SCREENER_CHANNEL_ID;
  if (!channelId) {
    void reportIssue("Pullback picks not posted — channel not configured",
      "DISCORD_SCREENER_CHANNEL_ID is not set, so the daily Top Pullback Picks had nowhere to go.",
      { envVar: "DISCORD_SCREENER_CHANNEL_ID", picks: String(pullbacks.picks.length) });
    return;
  }
  try {
    const screenerCh = await getChannel(channelId);
    if (!screenerCh) {
      void reportIssue("Pullback picks not posted — channel unreachable",
        `The bot cannot reach screener channel ${channelId}. Check it has View Channel + Send Messages.`,
        { channel: channelId });
      return;
    }
    await sendBatched(screenerCh, `Top Pullback Picks — ${now}`, pullbackEmbeds);
  } catch (err) {
    void reportIssue("Pullback picks failed to post", err, { channel: channelId });
  }
}

// Pad/truncate helper for the monospace screener tables.
function pad(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s.padEnd(width);
}

// Right-aligned variant. Numbers are compared down a column, so their decimal
// points have to line up: left-aligned, 1039.49 and 55.23 sit at different
// offsets and the eye cannot rank them without reading every digit.
function rpad(s: string, width: number): string {
  return s.length > width ? s.slice(0, width) : s.padStart(width);
}

// Discord's MOBILE client WRAPS code blocks — it does not scroll them. A row
// wider than roughly 40 characters breaks across two lines and the table stops
// being a table. Every column below is budgeted against that limit; check the
// widths in __tests__/discord-bot.test.ts before adding one.
const MOBILE_COLS = 40;

// "3 bars ago" reads as "3d" — same information, four fewer characters.
function ageLabel(when: unknown): string {
  const w = String(when ?? "").trim().toUpperCase();
  if (!w) return "";
  if (w === "TODAY") return "0d";
  const m = w.match(/^(\d+)\s*D/);
  return m ? `${m[1]}d` : w.slice(0, 3);
}

/** Builds the monospace screener table. Pure and exported so the mobile width
 *  budget can be asserted in tests — see MOBILE_COLS. */
export function buildScreenerTable(
  mode: "live" | "options",
  rows: Array<Record<string, any>>
): { header: string; lines: string[] } {
  const header = mode === "live"
    ? `${pad("#", 3)}${pad("SYM", 6)}${pad("D", 2)}${rpad("PRICE", 8)}${rpad("PF", 6)}${rpad("WR%", 6)}${rpad("AGE", 4)}`
    : `${pad("#", 3)}${pad("SYM", 6)}${pad("D", 2)}${rpad("PRICE", 8)}${rpad("PF", 6)}${rpad("WR%", 6)}${rpad("TRD", 5)}`;

  const dir = (v: unknown) => (String(v ?? "").toUpperCase().includes("SHORT") ? "S" : "L");
  const n = (v: unknown, dp: number) => {
    const x = Number(v);
    return Number.isFinite(x) ? x.toFixed(dp) : "-";
  };

  const lines = mode === "live"
    ? rows.map((r, i) =>
        `${pad(String(i + 1), 3)}${pad(String(r.symbol ?? ""), 6)}${pad(dir(r.signal), 2)}${rpad(n(r.price, 2), 8)}${rpad(n(r.histPf, 2), 6)}${rpad(n(r.wr, 1), 6)}${rpad(ageLabel(r.when), 4)}`
      )
    : rows.map((r, i) =>
        `${pad(String(i + 1), 3)}${pad(String(r.symbol ?? ""), 6)}${pad(dir(r.trend), 2)}${rpad(n(r.price, 2), 8)}${rpad(n(r.pf, 2), 6)}${rpad(n(r.wr, 1), 6)}${rpad(String(r.trades ?? ""), 5)}`
      );

  return { header, lines };
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

  const { header, lines } = buildScreenerTable(mode, rows);

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

/* ------------------------------------------------------------------ *
 * Channel preflight
 *
 * Every incident this quarter had the same shape: the bot could not post
 * somewhere, said nothing, and a human noticed days later that an alert had
 * never arrived. A channel ID never changes when you rename or move a channel,
 * so config always LOOKS right; what actually breaks is permissions —
 * dragging a channel into a category re-syncs its overwrites, and the bot
 * silently loses access to a channel whose ID is still perfectly valid.
 *
 * This asks the only question that matters — can the bot post here, right
 * now — and reports failures to #admin. It never throws: a preflight that
 * takes the process down is worse than the problem it detects.
 * ------------------------------------------------------------------ */

export interface ChannelCheck {
  envVar: string;
  channelId: string;
  channelName: string | null;
  ok: boolean;
  problem: string | null;
}

// Posting an embed needs all three. EmbedLinks is the easy one to miss: the
// bot can send plain text without it, so a half-broken channel looks fine
// until an actual alert (which is always an embed) is silently rejected.
const REQUIRED_PERMS = ["ViewChannel", "SendMessages", "EmbedLinks"] as const;

export async function verifyDiscordChannels(): Promise<ChannelCheck[]> {
  const out: ChannelCheck[] = [];
  // Discovered from the environment, not hardcoded, so a newly added
  // DISCORD_*_CHANNEL_ID is covered without anyone remembering to edit a list.
  const vars = Object.keys(process.env)
    .filter((k) => k.startsWith("DISCORD_") && k.endsWith("CHANNEL_ID"))
    .sort();

  for (const envVar of vars) {
    const channelId = process.env[envVar];
    if (!channelId) continue; // deliberately unset, e.g. DISCORD_OTHER_CHANNEL_ID

    const ch = await getChannel(channelId);
    if (!ch) {
      out.push({ envVar, channelId, channelName: null, ok: false,
        problem: "not found, or the bot cannot see it (deleted, or access revoked)" });
      continue;
    }
    const me = ch.guild?.members?.me ?? null;
    if (!me) {
      out.push({ envVar, channelId, channelName: ch.name, ok: false,
        problem: "bot is not a member of the guild owning this channel" });
      continue;
    }
    const perms = ch.permissionsFor(me);
    const missing = REQUIRED_PERMS.filter((flag) => !perms?.has(PermissionsBitField.Flags[flag]));
    out.push({
      envVar, channelId, channelName: ch.name,
      ok: missing.length === 0,
      problem: missing.length ? `missing ${missing.join(", ")}` : null,
    });
  }
  return out;
}

/** Runs the preflight and escalates to #admin. Returns the checks for tests. */
export async function checkChannelsAndReport(trigger: string): Promise<ChannelCheck[]> {
  let checks: ChannelCheck[] = [];
  try {
    checks = await verifyDiscordChannels();
  } catch (err) {
    await reportIssue("Discord channel preflight could not run", err, { trigger });
    return [];
  }
  const bad = checks.filter((c) => !c.ok);
  const healthy = checks.length - bad.length;
  if (!bad.length) {
    console.log(`[discord-check] ${healthy}/${checks.length} channels OK (${trigger})`);
    return checks;
  }
  console.error(`[discord-check] ${bad.length} channel(s) unusable (${trigger})`);
  await reportIssue(
    "Discord channels are not usable — alerts routed here will not arrive",
    bad.map((b) => `${b.envVar} -> #${b.channelName ?? "?"} (${b.channelId}): ${b.problem}`).join("\n"),
    { trigger, failing: String(bad.length), healthy: String(healthy) },
  );
  return checks;
}
