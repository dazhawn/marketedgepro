// Phone push notifications — fires all configured channels simultaneously.
// Configure any combination via env vars; unconfigured channels are silently skipped.
//
// Pushover:  PUSHOVER_TOKEN + PUSHOVER_USER_KEY
// Telegram:  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
// ntfy:      NTFY_TOPIC (uses ntfy.sh; set NTFY_URL to self-host)

export interface SignalNotification {
  symbol: string;
  timeframe: string;
  direction: string;
  signalType: string;
  price?: number | null;
  sl?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  confluenceCount?: number | null;
}

function fmt(v: number): string {
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00");
  return v.toFixed(5).replace(/0+$/, "").replace(/\.$/, ".00000");
}

function buildTitle(n: SignalNotification): string {
  const dir = n.direction.toUpperCase();
  const arrow = dir === "BULLISH" || dir === "BUY" ? "📈" : dir === "BEARISH" || dir === "SELL" ? "📉" : "➡️";
  return `${arrow} ${n.symbol} ${dir} — ${n.timeframe}`;
}

function buildBody(n: SignalNotification): string {
  const lines: string[] = [`Type: ${n.signalType}`];
  if (n.price != null) lines.push(`Price: ${fmt(n.price)}`);
  if (n.sl != null) lines.push(`SL: ${fmt(n.sl)}`);
  if (n.tp1 != null) lines.push(`TP1: ${fmt(n.tp1)}`);
  if (n.tp2 != null) lines.push(`TP2: ${fmt(n.tp2)}`);
  if (n.tp3 != null) lines.push(`TP3: ${fmt(n.tp3)}`);
  if (n.confluenceCount != null) lines.push(`Confluence: ${n.confluenceCount}`);
  return lines.join(" | ");
}

async function sendPushover(n: SignalNotification): Promise<void> {
  const token = process.env.PUSHOVER_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) return;

  const dir = n.direction.toUpperCase();
  const priority = dir === "BULLISH" || dir === "BEARISH" ? 1 : 0;

  const body = new URLSearchParams({
    token,
    user,
    title: buildTitle(n),
    message: buildBody(n),
    priority: String(priority),
    sound: "cashregister",
  });

  const res = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    console.error("Pushover error:", res.status, await res.text().catch(() => ""));
  }
}

async function sendTelegram(n: SignalNotification): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const dir = n.direction.toUpperCase();
  const arrow = dir === "BULLISH" || dir === "BUY" ? "📈" : dir === "BEARISH" || dir === "SELL" ? "📉" : "➡️";
  const lines = [
    `${arrow} <b>${n.symbol}</b> — <b>${dir}</b>`,
    `Timeframe: ${n.timeframe} | Type: ${n.signalType}`,
  ];
  if (n.price != null) lines.push(`Price: <code>${fmt(n.price)}</code>`);
  if (n.sl != null) lines.push(`🔴 SL: <code>${fmt(n.sl)}</code>`);
  if (n.tp1 != null) lines.push(`🎯 TP1: <code>${fmt(n.tp1)}</code>`);
  if (n.tp2 != null) lines.push(`🎯 TP2: <code>${fmt(n.tp2)}</code>`);
  if (n.tp3 != null) lines.push(`🎯 TP3: <code>${fmt(n.tp3)}</code>`);
  if (n.confluenceCount != null) lines.push(`Confluence: ${n.confluenceCount}`);

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: lines.join("\n"), parse_mode: "HTML" }),
  });

  if (!res.ok) {
    console.error("Telegram error:", res.status, await res.text().catch(() => ""));
  }
}

async function sendNtfy(n: SignalNotification): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;

  const base = process.env.NTFY_URL ?? "https://ntfy.sh";
  const dir = n.direction.toUpperCase();
  const priority = dir === "BULLISH" || dir === "BEARISH" ? "high" : "default";

  const res = await fetch(`${base}/${topic}`, {
    method: "POST",
    headers: {
      "Title": buildTitle(n),
      "Priority": priority,
      "Tags": dir === "BULLISH" || dir === "BUY" ? "chart_with_upwards_trend" : "chart_with_downwards_trend",
    },
    body: buildBody(n),
  });

  if (!res.ok) {
    console.error("ntfy error:", res.status, await res.text().catch(() => ""));
  }
}

export async function sendPhoneNotification(n: SignalNotification): Promise<void> {
  await Promise.allSettled([
    sendPushover(n),
    sendTelegram(n),
    sendNtfy(n),
  ]);
}
