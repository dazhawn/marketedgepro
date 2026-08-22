import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, Loader2, LineChart, Activity, Brain,
  ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";
import type { Signal } from "@shared/schema";

// Full alert context forwarded by the Smart Investor app in customData.
interface SmartInvestorData {
  triggers?: { name: string; detail: string }[];
  trend?: { direction: string; detail: string };
  explanation?: string;
  earningsSummary?: string;
  headlines?: { title: string; url: string; published?: string; sentiment?: string }[];
  company?: { name?: string; industry?: string; market_cap?: number; pe_ratio?: number | null };
}

const TRIGGER_STYLES: Record<string, string> = {
  "RSI oversold": "bg-amber-500/15 text-amber-300 border-amber-500/30",
  "Moving-average pullback": "bg-sky-500/15 text-sky-300 border-sky-500/30",
  "52-week pullback": "bg-violet-500/15 text-violet-300 border-violet-500/30",
  "Support zone": "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function TriggerChip({ name }: { name: string }) {
  const style = TRIGGER_STYLES[name] ?? "bg-zinc-500/15 text-zinc-300 border-zinc-500/30";
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>{name}</span>;
}

function TrendBadge({ direction }: { direction: string }) {
  const map: Record<string, [string, string]> = {
    uptrend: ["↗ Uptrend", "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"],
    downtrend: ["↘ Downtrend", "bg-rose-500/15 text-rose-300 border-rose-500/30"],
    sideways: ["→ Sideways", "bg-zinc-500/15 text-zinc-300 border-zinc-500/30"],
  };
  const [label, style] = map[direction] ?? map.sideways;
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>{label}</span>;
}

function AiDirBadge({ direction }: { direction: string }) {
  const d = direction.toUpperCase();
  if (d === "BULLISH")
    return <span className="text-xs font-semibold text-emerald-400"><TrendingUp className="w-3.5 h-3.5 inline mr-1" />AI: BULLISH</span>;
  if (d === "BEARISH")
    return <span className="text-xs font-semibold text-red-400"><TrendingDown className="w-3.5 h-3.5 inline mr-1" />AI: BEARISH</span>;
  return <span className="text-xs font-semibold text-zinc-400"><Minus className="w-3.5 h-3.5 inline mr-1" />AI: NEUTRAL</span>;
}

function marketCapLabel(value?: number): string {
  if (!value) return "";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  return `$${(value / 1e9).toFixed(0)}B`;
}

function AlertCard({ alert }: { alert: Signal }) {
  const [open, setOpen] = useState(false);
  const data = ((alert.confluenceData as any)?.customData ?? {}) as SmartInvestorData;
  const triggers = data.triggers ?? [];
  const hasDetail = triggers.length > 0 || !!data.earningsSummary || (data.headlines?.length ?? 0) > 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <a
            href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(alert.symbol)}&interval=1D`}
            target="_blank"
            rel="noreferrer"
            className="text-lg font-bold text-white hover:text-sky-400 transition-colors"
          >
            {alert.symbol}
          </a>
          {alert.price != null && <span className="font-mono text-sm text-zinc-300">${alert.price.toFixed(2)}</span>}
          {data.company?.name && (
            <span className="text-xs text-zinc-500 hidden sm:inline">
              {data.company.name}{data.company.market_cap ? ` · ${marketCapLabel(data.company.market_cap)}` : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {alert.analyzed && <AiDirBadge direction={alert.direction} />}
          <span className="text-xs text-zinc-500">
            {alert.receivedAt ? new Date(alert.receivedAt).toLocaleString() : ""}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {triggers.map(t => <TriggerChip key={t.name} name={t.name} />)}
        {triggers.length === 0 && alert.message && (
          <span className="text-xs text-zinc-400">{alert.message}</span>
        )}
        {data.trend && <TrendBadge direction={data.trend.direction} />}
        {hasDetail && (
          <button
            onClick={() => setOpen(v => !v)}
            className="ml-auto flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {open ? <>Hide breakdown <ChevronUp className="w-3.5 h-3.5" /></> : <>Why this level <ChevronDown className="w-3.5 h-3.5" /></>}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-4 border-t border-zinc-800 pt-4">
          {triggers.length > 0 && (
            <div className="space-y-2">
              {triggers.map(t => (
                <div key={t.name} className="rounded-md bg-zinc-900 p-3">
                  <p className="text-xs font-semibold text-white">{t.name}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">{t.detail}</p>
                </div>
              ))}
            </div>
          )}
          {data.trend?.detail && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Trend check</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{data.trend.detail}</p>
            </div>
          )}
          {data.earningsSummary && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Fundamental check</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">{data.earningsSummary}</p>
            </div>
          )}
          {(data.headlines?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Recent news</p>
              <ul className="mt-1 space-y-1">
                {data.headlines!.map(h => (
                  <li key={h.url} className="text-xs">
                    <a href={h.url} target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-sky-400 transition-colors">
                      {h.title} <ExternalLink className="w-3 h-3 inline opacity-50" />
                    </a>
                    {h.sentiment && <span className="ml-2 text-zinc-600">{h.sentiment}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Alerts pushed in by the Smart Investor app (the user's personal FastAPI
// alerting system): buy-side "levels of interest" on large-cap stocks,
// forwarded via the signals webhook with full context in customData and
// auto-analyzed by the AI engine.
export default function SmartInvestorPage() {
  const signalsQuery = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 60_000,
  });

  const alerts = (signalsQuery.data ?? []).filter(s => s.signalType === "Smart Investor");
  const analyzedCount = alerts.filter(a => a.analyzed).length;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-y-auto">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <LineChart className="w-5 h-5 text-sky-400" />
            Smart Investor
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">
            Buy-side levels of interest from the Smart Investor alert engine — RSI, moving-average pullbacks, 52-week drawdowns, and support zones on large caps.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" />
            {alerts.length} alert{alerts.length !== 1 ? "s" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            {analyzedCount} AI-analyzed
          </span>
        </div>
      </div>

      <div className="px-6 py-4">
        {signalsQuery.isLoading && (
          <div className="flex items-center gap-2 text-zinc-500 py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading alerts…
          </div>
        )}

        {!signalsQuery.isLoading && alerts.length === 0 && (
          <div className="text-center py-16 text-zinc-600">
            <LineChart className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No Smart Investor alerts yet.</p>
            <p className="text-xs mt-1">Alerts arrive automatically when the daily scan finds a level of interest.</p>
          </div>
        )}

        <div className="space-y-3">
          {alerts.map(alert => <AlertCard key={alert.id} alert={alert} />)}
        </div>

        {alerts.length > 0 && (
          <p className="mt-4 text-xs text-zinc-600">
            "AI" is MarketEdgePro's own confluence read (news + market data) of each alert — it can disagree
            with Smart Investor's buy-side trigger. Full write-ups live in History.
          </p>
        )}
      </div>
    </div>
  );
}
