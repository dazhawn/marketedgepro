// Signal Copier — $50/month tier
// Automatically forwards signals to subscriber MT4/MT5 accounts via a bridge EA.
// TODO: implement bridge connection (WebSocket server or REST polling endpoint
//       that the MetaTrader EA connects to).

export interface CopierSignal {
  symbol: string;
  direction: string;
  price?: number | null;
  sl?: number | null;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  timeframe: string;
  signalType: string;
}

export async function forwardToSignalCopier(signal: CopierSignal): Promise<void> {
  if (!process.env.SIGNAL_COPIER_ENABLED) return;
  // Placeholder — log intent until the MT4/MT5 bridge is built
  console.log("[Signal Copier] Would forward:", JSON.stringify(signal));
}
