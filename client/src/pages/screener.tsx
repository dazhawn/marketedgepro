import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TrendingUp, TrendingDown, RefreshCw, Play, Send, Loader2, BarChart2, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

type LiveRow = {
  symbol: string; signal: string; when: string; barsAgo: number;
  price: number; chanStop: number; distPct: number; histPf: number;
  wr: number; trades: number; wins: number;
};
type OptionsRow = {
  symbol: string; price: number; trend: string; pf: number;
  wr: number; trades: number; wins: number; sector: string;
};
type Meta = { file: string; runAt: string; count: number };

function WhenBadge({ when, barsAgo }: { when: string; barsAgo: number }) {
  if (barsAgo === 0) return <span className="text-xs font-bold text-orange-400">🔥 TODAY</span>;
  if (barsAgo === 1) return <span className="text-xs font-semibold text-emerald-400">✅ YESTERDAY</span>;
  return <span className="text-xs text-zinc-400">⬜ {when}</span>;
}

function PfBadge({ pf }: { pf: number }) {
  const color = pf >= 2 ? "text-emerald-400" : pf >= 1.5 ? "text-yellow-400" : "text-zinc-400";
  return <span className={`text-xs font-mono font-semibold ${color}`}>{pf.toFixed(2)}</span>;
}

function DirIcon({ dir }: { dir: string }) {
  const isLong = dir.includes("LONG");
  return isLong
    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400 inline mr-1" />
    : <TrendingDown className="w-3.5 h-3.5 text-red-400 inline mr-1" />;
}

export default function ScreenerPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"live" | "options">("live");

  const liveQuery = useQuery<{ rows: LiveRow[]; meta: Meta | null }>({
    queryKey: ["/api/screener/live"],
    refetchInterval: 60_000,
  });

  const optionsQuery = useQuery<{ rows: OptionsRow[]; meta: Meta | null }>({
    queryKey: ["/api/screener/options"],
    refetchInterval: 60_000,
  });

  const runMutation = useMutation({
    mutationFn: async (mode: "live" | "options") => {
      const res = await apiRequest("POST", "/api/screener/run", { mode });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.queued) {
        // Cloud instance can't run Python — the request is queued for the PC poller.
        toast({
          title: "Screener requested",
          description: data.message ?? "The trading PC will run it shortly. Results refresh here automatically.",
        });
      } else {
        toast({
          title: "Screener launched",
          description: `${data.mode === "live" ? "Live (S&P 500)" : "Options"} screener started in background (PID ${data.pid}). Results will appear here when complete — usually ${data.mode === "live" ? "~4 min" : "~40 sec"}.`,
        });
      }
    },
    onError: (err: any) => {
      let description = String(err?.message ?? "Failed to launch screener");
      const jsonStart = description.indexOf("{");
      if (jsonStart >= 0) {
        try { description = JSON.parse(description.slice(jsonStart)).message ?? description; } catch { /* keep raw */ }
      }
      toast({ title: "Screener not launched", description, variant: "destructive" });
    },
  });

  const discordMutation = useMutation({
    mutationFn: async (mode: "live" | "options") => {
      const res = await apiRequest("POST", "/api/screener/post-discord", { mode });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.sent) {
        toast({ title: "Posted to Discord", description: `Top signals sent to #pullback-signals.` });
      } else {
        toast({ title: "Not sent", description: data.message ?? "No results to post.", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Discord post failed", variant: "destructive" }),
  });

  const activeQuery = tab === "live" ? liveQuery : optionsQuery;
  const meta = activeQuery.data?.meta;
  const liveRows = liveQuery.data?.rows ?? [];
  const optionsRows = optionsQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-y-auto">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-emerald-400" />
            Smart Pullback Screener
          </h1>
          <p className="text-zinc-500 text-sm mt-0.5">S&P 500 pullback signals via EMA(34) + ATR Chandelier Exit.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["/api/screener/live"] });
              qc.invalidateQueries({ queryKey: ["/api/screener/options"] });
            }}
            className="border-zinc-700 text-zinc-300 hover:text-white"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => runMutation.mutate(tab)}
            disabled={runMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          >
            {runMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Launching…</>
              : <><Play className="w-3.5 h-3.5 mr-1.5" />Run {tab === "live" ? "Live" : "Options"} Screener</>}
          </Button>
          <Button
            size="sm"
            onClick={() => discordMutation.mutate(tab)}
            disabled={discordMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
          >
            {discordMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Posting…</>
              : <><Send className="w-3.5 h-3.5 mr-1.5" />Post to Discord</>}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-zinc-800 px-6 flex gap-1 pt-2">
        {(["live", "options"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-4 py-2 text-sm font-medium rounded-t transition-colors border-b-2",
              tab === t
                ? "border-emerald-400 text-emerald-400"
                : "border-transparent text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
          >
            {t === "live" ? "🔥 Live Signals" : "📈 Options Screener"}
            {t === "live" && liveRows.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 text-xs rounded">{liveRows.length}</span>
            )}
            {t === "options" && optionsRows.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 text-xs rounded">{optionsRows.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="px-6 py-4">
        {/* Meta bar */}
        {meta && (
          <div className="flex items-center gap-4 mb-4 text-xs text-zinc-500">
            <Activity className="w-3.5 h-3.5" />
            <span>Last run: <span className="text-zinc-300">{meta.runAt}</span></span>
            <span>File: <span className="text-zinc-400 font-mono">{meta.file}</span></span>
            <span>{meta.count} result{meta.count !== 1 ? "s" : ""}</span>
          </div>
        )}

        {activeQuery.isLoading && (
          <div className="flex items-center gap-2 text-zinc-500 py-8">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading results…
          </div>
        )}

        {!activeQuery.isLoading && !meta && (
          <div className="text-center py-16 text-zinc-600">
            <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No screener results yet.</p>
            <p className="text-xs mt-1">The screener runs on the trading PC on a schedule and uploads results here automatically.</p>
          </div>
        )}

        {/* Live Signals Table */}
        {tab === "live" && liveRows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Symbol</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Signal</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">When</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Price</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Chan Stop</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Dist %</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Hist PF</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">WR %</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Trades</th>
                </tr>
              </thead>
              <tbody>
                {liveRows.map((row, i) => (
                  <tr key={i} className={`border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors ${row.barsAgo === 0 ? "bg-orange-500/5" : ""}`}>
                    <td className="px-4 py-3">
                      <a
                        href={`https://www.tradingview.com/chart/?symbol=NASDAQ:${row.symbol}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono font-bold text-white hover:text-emerald-400 transition-colors"
                      >
                        {row.symbol}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${row.signal === "LONG PB" ? "text-emerald-400" : "text-red-400"}`}>
                        <DirIcon dir={row.signal} />{row.signal}
                      </span>
                    </td>
                    <td className="px-4 py-3"><WhenBadge when={row.when} barsAgo={row.barsAgo} /></td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-200">${row.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">${row.chanStop.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">{row.distPct.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right"><PfBadge pf={row.histPf} /></td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">{row.wr.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">{row.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Options Screener Table */}
        {tab === "options" && optionsRows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/60">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Symbol</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Trend</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Price</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">PF</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">WR %</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Trades</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Sector</th>
                </tr>
              </thead>
              <tbody>
                {optionsRows.map((row, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors">
                    <td className="px-4 py-3">
                      <a
                        href={`https://www.tradingview.com/chart/?symbol=NASDAQ:${row.symbol}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono font-bold text-white hover:text-emerald-400 transition-colors"
                      >
                        {row.symbol}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold ${row.trend === "LONG" ? "text-emerald-400" : "text-red-400"}`}>
                        <DirIcon dir={row.trend} />{row.trend}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-200">${row.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right"><PfBadge pf={row.pf} /></td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">{row.wr.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">{row.trades}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{row.sector}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
