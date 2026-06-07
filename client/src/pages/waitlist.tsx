import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Mail, Trash2, Download, Phone, Users } from "lucide-react";

interface WaitlistEntry {
  id: number;
  email: string;
  phone: string | null;
  source: string | null;
  createdAt: string;
}

export default function WaitlistPage() {
  const { toast } = useToast();
  const { data: entries = [] } = useQuery<WaitlistEntry[]>({ queryKey: ["/api/waitlist"] });
  const { data: count } = useQuery<{ total: number; max: number; remaining: number }>({
    queryKey: ["/api/waitlist/count"],
    refetchInterval: 30000,
  });
  const total     = count?.total ?? entries.length;
  const max       = count?.max ?? 100;
  const remaining = count?.remaining ?? Math.max(0, max - total);
  const pct       = Math.min(100, Math.round((total / max) * 100));
  const isHot     = remaining <= 25;
  const isLast    = remaining <= 10;

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/waitlist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waitlist"] });
      toast({ title: "Removed", description: "Entry deleted." });
    },
  });

  function exportCsv() {
    const csv = [
      "email,phone,source,signed_up_at",
      ...entries.map(e => `"${e.email}","${e.phone ?? ""}","${e.source ?? ""}","${e.createdAt}"`),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-y-auto">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Waitlist</h1>
          <p className="text-zinc-500 text-sm mt-0.5">{entries.length} signups from the sales page</p>
        </div>
        <button
          onClick={exportCsv}
          disabled={entries.length === 0}
          className="flex items-center gap-2 text-sm px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded border border-zinc-700"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Founding-member progress widget */}
      <div className="px-6 pt-6">
        <div className="max-w-3xl bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className={`w-4 h-4 ${isLast ? "text-rose-400" : isHot ? "text-amber-400" : "text-emerald-400"}`} />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Founding-Member Spots</h2>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded border ${
              isLast ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
              : isHot ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            }`}>
              {remaining === 0 ? "FULL" : remaining <= 10 ? "LAST CHANCE" : remaining <= 25 ? "FILLING FAST" : "OPEN"}
            </span>
          </div>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-4xl font-extrabold text-white tabular-nums">{total}</span>
            <span className="text-zinc-500 text-sm">/ {max} claimed</span>
            <span className="ml-auto text-sm text-zinc-400 tabular-nums">{remaining} remaining</span>
          </div>
          <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${isLast ? "bg-gradient-to-r from-rose-500 to-red-500" : isHot ? "bg-gradient-to-r from-amber-500 to-orange-500" : "bg-gradient-to-r from-emerald-500 to-blue-500"}`}
              style={{ width: `${Math.max(2, pct)}%` }}
            />
          </div>
          <p className="text-[10px] text-zinc-600 mt-2">
            Live count · refreshes every 30s · cap configurable via <code className="text-amber-400">FOUNDING_MAX_SPOTS</code>
          </p>
        </div>
      </div>

      <div className="px-6 py-6 max-w-3xl">
        {entries.length === 0 ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-8 text-center">
            <Mail className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
            <p className="text-zinc-400">No signups yet.</p>
            <p className="text-zinc-600 text-xs mt-1">Share <code className="text-amber-400">/intro</code> to start collecting emails.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map(e => (
              <div key={e.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center gap-4">
                <Mail className="w-4 h-4 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{e.email}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {e.phone && (
                      <span className="text-xs text-zinc-500 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {e.phone}
                      </span>
                    )}
                    <span className="text-xs text-zinc-600">{new Date(e.createdAt).toLocaleString()}</span>
                    {e.source && <span className="text-xs text-zinc-700 uppercase tracking-wider">· {e.source}</span>}
                  </div>
                </div>
                <button
                  onClick={() => del.mutate(e.id)}
                  disabled={del.isPending}
                  className="text-zinc-600 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
