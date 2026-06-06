// Signal Copier — $50/month tier
// Forwards signals to subscriber MT4/MT5 accounts via TradersConnect
// (https://tradersconnect.com). TradersConnect handles the broker-side
// execution; we just POST a JSON payload to their webhook URL.

export interface CopierSignal {
  symbol: string;
  direction: string;
  price?: number | null;
  entry?: number | null;
  sl?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  timeframe: string;
  signalType: string;
}

// TradersConnect expects BUY/SELL — normalize from our internal direction strings
function toAction(direction: string): "BUY" | "SELL" {
  const d = direction.toUpperCase();
  if (d === "BULLISH" || d === "BUY" || d === "LONG") return "BUY";
  return "SELL";
}

export async function forwardToSignalCopier(signal: CopierSignal): Promise<void> {
  if (!process.env.SIGNAL_COPIER_ENABLED) return;

  const webhookUrl = process.env.TRADERSCONNECT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[signal-copier] TRADERSCONNECT_WEBHOOK_URL not set, skipping");
    return;
  }

  const action = toAction(signal.direction);
  const entry  = signal.entry ?? signal.price ?? null;

  // TradersConnect-compatible payload. Field names match their webhook spec
  // (https://tradersconnect.com/docs/webhooks). They support multiple TPs
  // via tp1/tp2/tp3 keys; sl is optional but recommended.
  const payload: Record<string, unknown> = {
    symbol:    signal.symbol,
    action,                              // BUY or SELL
    price:     entry,
    entry,
    sl:        signal.sl  ?? null,
    tp1:       signal.tp1 ?? null,
    tp2:       signal.tp2 ?? null,
    tp3:       signal.tp3 ?? null,
    timeframe: signal.timeframe,
    comment:   `MarketEdgePro · ${signal.signalType}`,
    timestamp: new Date().toISOString(),
  };

  // Optional auth — TradersConnect can use either header-based API key
  // OR a secret in the URL query string (?secret=xxx). Support both.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.TRADERSCONNECT_API_KEY;
  if (apiKey) headers["X-API-Key"] = apiKey;

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[signal-copier] TradersConnect returned ${res.status}: ${body.substring(0, 200)}`);
      return;
    }

    console.log(`[signal-copier] Forwarded ${action} ${signal.symbol} to TradersConnect`);
  } catch (err: any) {
    console.error("[signal-copier] TradersConnect forward failed:", err?.message ?? err);
  }
}
