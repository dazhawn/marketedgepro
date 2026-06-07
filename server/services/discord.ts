export interface DiscordAlert {
  symbol: string;
  direction: string;
  confluenceScore: number;
  summary: string;
  price?: string;
}

export interface DiscordSignalAlert {
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

function fmt(value: number): string {
  if (value >= 100) return value.toFixed(2);
  if (value >= 1)   return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00");
  return value.toFixed(5).replace(/0+$/, "").replace(/\.$/, ".00000");
}

function toTVSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace("/", "").replace("-", "");
  const forexPairs = [
    "EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","NZDUSD","USDCAD",
    "EURGBP","EURJPY","GBPJPY","EURAUD","EURCAD","EURCHF","EURNZD",
    "GBPAUD","GBPCAD","GBPCHF","GBPNZD","AUDCAD","AUDCHF","AUDJPY",
    "AUDNZD","CADJPY","CHFJPY","NZDJPY","NZDCAD","NZDCHF","CADCHF",
  ];
  if (forexPairs.includes(s)) return `FX:${s}`;
  if (s === "XAUUSD") return "TVC:GOLD";
  if (s === "XAGUSD") return "TVC:SILVER";
  if (s === "XPTUSD") return "TVC:PLATINUM";
  if (s === "USOIL" || s === "WTIUSD") return "TVC:USOIL";
  if (s === "UKOIL" || s === "BRENTUSD") return "TVC:UKOIL";
  if (s === "US30" || s === "DJI") return "TVC:DJI";
  if (s === "US500" || s === "SPX500" || s === "SPX") return "TVC:SPX";
  if (s === "US100" || s === "NDX" || s === "NAS100") return "TVC:NDX";
  if (s === "UK100") return "TVC:UKX";
  if (s === "DE40" || s === "DAX") return "TVC:DAX";
  if (s === "BTCUSD") return "BITSTAMP:BTCUSD";
  if (s === "ETHUSD") return "BITSTAMP:ETHUSD";
  return s;
}

function toTVInterval(timeframe: string): string {
  const map: Record<string, string> = {
    "1": "1", "3": "3", "5": "5", "15": "15", "30": "30",
    "45": "45", "60": "60", "120": "2H", "180": "3H", "240": "4H",
    "1D": "1D", "D": "1D", "1W": "1W", "W": "1W", "1M": "1M", "M": "1M",
  };
  return map[timeframe.toString().toUpperCase()] ?? timeframe.toString();
}

// chart-img.com uses a different interval format than TradingView URLs
function toChartImgInterval(timeframe: string): string {
  const map: Record<string, string> = {
    "1": "1m", "3": "3m", "5": "5m", "15": "15m", "30": "30m", "45": "45m",
    "60": "1h", "120": "2h", "180": "3h", "240": "4h",
    "1D": "1D", "D": "1D", "1W": "1W", "W": "1W", "1M": "1M", "M": "1M",
  };
  return map[timeframe.toString().toUpperCase()] ?? timeframe.toString();
}

function buildTVChartUrl(symbol: string, timeframe: string): string {
  const tvSymbol = toTVSymbol(symbol);
  const interval = toTVInterval(timeframe);
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSymbol)}&interval=${interval}`;
}

async function fetchChartSnapshot(symbol: string, timeframe: string): Promise<Buffer | null> {
  const apiKey = process.env.CHART_IMG_API_KEY;
  if (!apiKey) return null;
  try {
    const tvSymbol = toTVSymbol(symbol);
    const interval = toChartImgInterval(timeframe);
    // Build query string manually — studies must be repeated params (not array notation)
    const params = new URLSearchParams({
      symbol: tvSymbol,
      interval,
      style: "heikinAshi",
      theme: "dark",
      width: "800",
      height: "600",
    });
    // EMA 20 / 50 / 200 overlays + MACD panel
    params.append("studies", "EMA:20");
    params.append("studies", "EMA:50");
    params.append("studies", "EMA:200");
    params.append("studies", "MACD");
    const res = await fetch(
      `https://api.chart-img.com/v1/tradingview/advanced-chart?${params.toString()}`,
      { headers: { "Authorization": `Bearer ${apiKey}` } },
    );
    if (!res.ok) {
      console.error("chart-img API error:", res.status, await res.text());
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch (err) {
    console.error("Failed to fetch chart snapshot:", err);
    return null;
  }
}

// Send a teaser signal to the free Discord channel (symbol + direction only).
// Configured via DISCORD_FREE_WEBHOOK_URL.
async function sendFreeChannelTeaser(signal: DiscordSignalAlert): Promise<void> {
  const webhookUrl = process.env.DISCORD_FREE_WEBHOOK_URL;
  if (!webhookUrl) return;

  const dir = signal.direction.toUpperCase();
  const emoji = dir === "BULLISH" || dir === "BUY" ? "🟢" : dir === "BEARISH" || dir === "SELL" ? "🔴" : "🟡";
  const color = dir === "BULLISH" || dir === "BUY" ? 0x22c55e : dir === "BEARISH" || dir === "SELL" ? 0xef4444 : 0xf59e0b;

  const embed = {
    embeds: [{
      title: `${emoji} ${signal.symbol} — ${dir}`,
      description: `A new **${signal.signalType}** signal has fired on the **${signal.timeframe}** chart.\n\n🔒 *[Upgrade to Paid tier for full SL/TP details and AI analysis](https://discord.gg/your-invite)*`,
      color,
      footer: { text: "MarketEdgePro Signals · Free Preview" },
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embed),
    });
  } catch (err) {
    console.error("Free channel Discord error:", err);
  }
}

export async function sendSignalToDiscord(signal: DiscordSignalAlert): Promise<boolean> {
  // Always send teaser to free channel (fire-and-forget)
  void sendFreeChannelTeaser(signal);

  // Full signal goes to paid channel (DISCORD_PAID_WEBHOOK_URL) with fallback to DISCORD_WEBHOOK_URL
  const webhookUrl = process.env.DISCORD_PAID_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`Skipping paid Discord alert for ${signal.symbol}: no paid webhook URL set`);
    return false;
  }

  const dir = signal.direction.toUpperCase();
  const color = (dir === "BULLISH" || dir === "BUY") ? 0x22c55e :
                (dir === "BEARISH" || dir === "SELL") ? 0xef4444 : 0xf59e0b;
  const emoji = (dir === "BULLISH" || dir === "BUY") ? "🟢" :
                (dir === "BEARISH" || dir === "SELL") ? "🔴" : "🟡";

  const tvUrl = buildTVChartUrl(signal.symbol, signal.timeframe);
  const hasTpSl = signal.sl != null || signal.tp1 != null || signal.tp2 != null || signal.tp3 != null;

  const fields = [
    { name: "Symbol", value: signal.symbol, inline: true },
    { name: "Timeframe", value: signal.timeframe, inline: true },
    { name: "Direction", value: `${emoji} ${signal.direction.toUpperCase()}`, inline: true },
    ...(signal.price != null ? [{ name: "Price", value: fmt(signal.price), inline: true }] : []),
    ...(signal.sl != null ? [{ name: "🔴 Stop Loss", value: fmt(signal.sl), inline: true }] : []),
    ...(signal.tp1 != null ? [{ name: "🎯 TP1", value: fmt(signal.tp1), inline: true }] : []),
    ...(signal.tp2 != null ? [{ name: "🎯 TP2", value: fmt(signal.tp2), inline: true }] : []),
    ...(signal.tp3 != null ? [{ name: "🎯 TP3", value: fmt(signal.tp3), inline: true }] : []),
    // EMA / RSI hidden when TP/SL present (those are price levels, not scores)
    ...(!hasTpSl && signal.emaAlignment ? [{ name: "EMA Alignment", value: signal.emaAlignment, inline: true }] : []),
    ...(!hasTpSl && signal.rsiValue != null ? [{ name: "RSI", value: fmt(signal.rsiValue), inline: true }] : []),
    // Renko, MTF, Confluence always shown for every signal type
    ...(signal.renkoTrend ? [{ name: "Renko Trend", value: signal.renkoTrend, inline: true }] : []),
    ...(signal.mtfScore ? [{ name: "MTF Score", value: signal.mtfScore, inline: true }] : []),
    ...(signal.confluenceCount != null ? [{ name: "Confluence Count", value: fmt(signal.confluenceCount), inline: true }] : []),
    { name: "📊 Chart", value: `[Open in TradingView](${tvUrl})`, inline: false },
  ];

  // Attempt to fetch a chart snapshot — only possible if CHART_IMG_API_KEY is set
  const chartImage = await fetchChartSnapshot(signal.symbol, signal.timeframe);

  const embedObj: Record<string, unknown> = {
    title: `📡 TV Signal: ${signal.symbol} — ${signal.signalType}`,
    url: tvUrl,
    color,
    fields,
    footer: { text: "MarketEdgePro · TradingView Signal" },
    timestamp: new Date().toISOString(),
  };

  if (chartImage) {
    embedObj.image = { url: "attachment://chart.png" };
  }

  try {
    let response: Response;

    if (chartImage) {
      // Send as multipart so we can attach the chart image
      const form = new FormData();
      form.append(
        "payload_json",
        JSON.stringify({ embeds: [embedObj] }),
      );
      form.append(
        "files[0]",
        new Blob([chartImage], { type: "image/png" }),
        "chart.png",
      );
      response = await fetch(webhookUrl, { method: "POST", body: form });
    } else {
      response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embedObj] }),
      });
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`Discord signal webhook error for ${signal.symbol}:`, response.status, errorBody);
      return false;
    }

    console.log(`Discord signal alert sent for ${signal.symbol} (${signal.signalType})`);
    return true;
  } catch (error) {
    console.error("Error sending signal to Discord:", error);
    return false;
  }
}

export async function sendDiscordAlert(alert: DiscordAlert): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is not set");
  }

  const color = alert.direction === "BULLISH" ? 0x22c55e :
                alert.direction === "BEARISH" ? 0xef4444 : 0x6b7280;

  const directionEmoji = alert.direction === "BULLISH" ? "BUY" :
                         alert.direction === "BEARISH" ? "SELL" : "NEUTRAL";

  const embed = {
    embeds: [
      {
        title: `Trading Alert: ${alert.symbol}`,
        description: alert.summary,
        color: color,
        fields: [
          {
            name: "Direction",
            value: `${directionEmoji} ${alert.direction}`,
            inline: true,
          },
          {
            name: "Confluence Score",
            value: `${alert.confluenceScore}/10`,
            inline: true,
          },
          ...(alert.price ? [{
            name: "Price at Alert",
            value: alert.price,
            inline: true,
          }] : []),
        ],
        footer: {
          text: "MarketEdgePro Confluence Dashboard",
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(embed),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Discord webhook error:", response.status, errorBody);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending Discord alert:", error);
    return false;
  }
}

export interface SymbolBriefData {
  symbol: string;
  name: string;
  headlines: string[];
  direction: "BULLISH" | "BEARISH";
  confluenceScore: number;
  confidence: string;
  summary: string;
}

export interface CalendarEventData {
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
}

export async function sendMorningBrief(
  symbols: SymbolBriefData[],
  calendarEvents: CalendarEventData[] = []
): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  // Fall back to bot if no webhook URL configured
  if (!webhookUrl) {
    const { postMorningBriefViaBot } = await import("./discord-bot.js");
    return postMorningBriefViaBot(symbols, calendarEvents);
  }

  const now = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/New_York",
  });

  const symbolFields = symbols.map(({ symbol, name, headlines, direction, confluenceScore, confidence, summary }) => {
    const biasEmoji = direction === "BULLISH" ? "🟢" : "🔴";
    const dirLabel = direction === "BULLISH" ? "BULLISH" : "BEARISH";
    const header = `${biasEmoji} **${dirLabel}** · Score ${confluenceScore}/10 · ${confidence} confidence`;
    const summaryLine = `*${summary}*`;
    const newsLines = headlines.length ? headlines.join("\n") : "*No recent headlines*";
    return {
      name: `${symbol} — ${name}`,
      value: `${header}\n${summaryLine}\n\n${newsLines}`,
      inline: false,
    };
  });

  const embeds: object[] = [{
    title: `☀️ Morning Market Brief — ${now}`,
    description: "AI-powered pre-market bias + news digest for your watchlist. New York session opens at 9:30 AM EST.",
    color: 0xf59e0b,
    fields: symbolFields,
    footer: { text: "MarketEdgePro · Daily Pre-Market Brief · 8:00 AM EST" },
    timestamp: new Date().toISOString(),
  }];

  // Add economic calendar embed if there are events
  if (calendarEvents.length > 0) {
    const impactEmoji = (impact: string) =>
      impact === "High" ? "🔴" : impact === "Medium" ? "🟡" : "⚪";

    const eventLines = calendarEvents.map(e => {
      const time = new Date(e.date).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
      });
      const forecast = e.forecast ? ` | Forecast: ${e.forecast}` : "";
      const prev = e.previous ? ` | Prev: ${e.previous}` : "";
      return `${impactEmoji(e.impact)} **${e.country}** ${e.title} — ${time} EST${forecast}${prev}`;
    });

    embeds.push({
      title: "📅 Economic Calendar — Today & Tomorrow",
      description: eventLines.join("\n") || "*No high/medium impact events scheduled*",
      color: 0x6366f1,
      footer: { text: "High 🔴  Medium 🟡  Low ⚪ — Times in EST" },
    });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error sending morning brief to Discord:", error);
    return false;
  }
}
