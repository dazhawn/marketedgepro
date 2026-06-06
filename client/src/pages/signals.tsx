import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw, Wifi, WifiOff } from "lucide-react";
import type { Signal } from "@shared/schema";

function fmt(v: number): string {
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00");
  return v.toFixed(5).replace(/0+$/, "").replace(/\.$/, ".00000");
}

function timeAgo(date: string | Date | null): string {
  if (!date) return "–";
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function DirectionBadge({ direction }: { direction: string }) {
  const d = direction.toUpperCase();
  const isBull = d === "BULLISH" || d === "BUY";
  const isBear = d === "BEARISH" || d === "SELL";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wide ${
      isBull ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" :
      isBear ? "bg-red-500/15 text-red-400 border border-red-500/30" :
               "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
    }`}>
      {isBull ? "▲" : isBear ? "▼" : "●"} {d}
    </span>
  );
}

function SignalCard({ signal }: { signal: Signal }) {
  const d = signal.direction.toUpperCase();
  const isBull = d === "BULLISH" || d === "BUY";
  const isBear = d === "BEARISH" || d === "SELL";
  const borderColor = isBull ? "border-l-emerald-500" : isBear ? "border-l-red-500" : "border-l-yellow-500";
  const cd = signal.confluenceData as any;

  return (
    <div className={`bg-zinc-900 border border-zinc-800 border-l-2 ${borderColor} rounded-lg p-4 hover:bg-zinc-800/60 transition-colors`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-white text-base">{signal.symbol}</span>
              <span className="text-zinc-500 text-sm">{signal.timeframe}</span>
              <DirectionBadge direction={signal.direction} />
              {signal.analyzed && (
                <span className="text-xs text-blue-400 border border-blue-400/30 bg-blue-400/10 px-1.5 py-0.5 rounded">AI ✓</span>
              )}
            </div>
            <p className="text-zinc-400 text-sm mt-0.5">{signal.signalType}</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-zinc-300 text-sm font-mono">
            {signal.price != null ? fmt(signal.price) : "–"}
          </div>
          <div className="text-zinc-500 text-xs mt-0.5">{timeAgo(signal.receivedAt)}</div>
        </div>
      </div>

      {cd && (cd.sl != null || cd.tp1 != null || cd.emaAlignment || cd.rsiValue != null || cd.renkoTrend || cd.mtfScore || cd.confluenceCount != null) && (
        <div className="mt-3 pt-3 border-t border-zinc-800 flex flex-wrap gap-3 text-xs">
          {cd.sl != null && <span className="text-red-400">SL <span className="font-mono text-zinc-300">{fmt(cd.sl)}</span></span>}
          {cd.tp1 != null && <span className="text-emerald-400">TP1 <span className="font-mono text-zinc-300">{fmt(cd.tp1)}</span></span>}
          {cd.tp2 != null && <span className="text-emerald-400">TP2 <span className="font-mono text-zinc-300">{fmt(cd.tp2)}</span></span>}
          {cd.tp3 != null && <span className="text-emerald-400">TP3 <span className="font-mono text-zinc-300">{fmt(cd.tp3)}</span></span>}
          {cd.emaAlignment && <span className="text-zinc-400">EMA <span className="text-zinc-300">{cd.emaAlignment}</span></span>}
          {cd.rsiValue != null && <span className="text-zinc-400">RSI <span className="text-zinc-300">{fmt(cd.rsiValue)}</span></span>}
          {cd.renkoTrend && <span className="text-zinc-400">Renko <span className="text-zinc-300">{cd.renkoTrend}</span></span>}
          {cd.mtfScore && <span className="text-zinc-400">MTF <span className="text-zinc-300">{cd.mtfScore}</span></span>}
          {cd.confluenceCount != null && <span className="text-zinc-400">Confluence <span className="text-zinc-300">{cd.confluenceCount}</span></span>}
        </div>
      )}

      {signal.message && (
        <p className="mt-2 text-zinc-500 text-xs italic truncate">{signal.message}</p>
      )}
    </div>
  );
}

export default function SignalsPage() {
  const [search, setSearch] = useState("");
  const [dirFilter, setDirFilter] = useState<"ALL" | "BULLISH" | "BEARISH">("ALL");

  const { data: signals = [], isLoading, refetch, dataUpdatedAt } = useQuery<Signal[]>({
    queryKey: ["/api/signals"],
    refetchInterval: 10000,
  });

  const filtered = signals.filter(s => {
    const matchSearch = !search ||
      s.symbol.toLowerCase().includes(search.toLowerCase()) ||
      s.signalType.toLowerCase().includes(search.toLowerCase());
    const d = s.direction.toUpperCase();
    const matchDir =
      dirFilter === "ALL" ||
      (dirFilter === "BULLISH" && (d === "BULLISH" || d === "BUY")) ||
      (dirFilter === "BEARISH" && (d === "BEARISH" || d === "SELL"));
    return matchSearch && matchDir;
  });

  const now = new Date();
  const todayCount = signals.filter(s => {
    if (!s.receivedAt) return false;
    const d = new Date(s.receivedAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }).length;

  const bullCount = signals.filter(s => { const d = s.direction.toUpperCase(); return d === "BULLISH" || d === "BUY"; }).length;
  const bearCount = signals.filter(s => { const d = s.direction.toUpperCase(); return d === "BEARISH" || d === "SELL"; }).length;
  const isLive = dataUpdatedAt > 0 && Date.now() - dataUpdatedAt < 30000;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold">Signal Feed</h1>
            <span className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${
              isLive
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-zinc-800 text-zinc-500 border-zinc-700"
            }`}>
              {isLive ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {isLive ? "Live" : "Connecting…"}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => refetch()} className="text-zinc-400 hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex gap-6 mt-3 text-sm">
          <div><span className="text-zinc-500">Today</span> <span className="text-white font-semibold ml-1">{todayCount}</span></div>
          <div><span className="text-zinc-500">Total</span> <span className="text-white font-semibold ml-1">{signals.length}</span></div>
          <div><span className="text-emerald-400">▲</span> <span className="text-white font-semibold ml-1">{bullCount}</span></div>
          <div><span className="text-red-400">▼</span> <span className="text-white font-semibold ml-1">{bearCount}</span></div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 border-b border-zinc-800 flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol or type…"
            className="pl-8 bg-zinc-900 border-zinc-700 text-sm text-white placeholder:text-zinc-600 h-8"
          />
        </div>
        <div className="flex gap-1">
          {(["ALL", "BULLISH", "BEARISH"] as const).map(f => (
            <button
              key={f}
              onClick={() => setDirFilter(f)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors border ${
                dirFilter === f
                  ? f === "BULLISH" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
                  : f === "BEARISH" ? "bg-red-500/20 text-red-400 border-red-500/40"
                  : "bg-zinc-700 text-white border-zinc-600"
                  : "text-zinc-500 hover:text-zinc-300 border-transparent"
              }`}
            >
              {f === "ALL" ? "All" : f === "BULLISH" ? "▲ Bulls" : "▼ Bears"}
            </button>
          ))}
        </div>
      </div>

      {/* Signal list */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-500 gap-2">
            <Wifi className="w-8 h-8 opacity-30" />
            <p className="text-sm">Waiting for TradingView signals…</p>
            <p className="text-xs text-zinc-600">Signals appear here the moment your webhook fires.</p>
          </div>
        ) : (
          filtered.map(s => <SignalCard key={s.id} signal={s} />)
        )}
      </div>
    </div>
  );
}
