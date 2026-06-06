import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Trash2, TrendingUp, TrendingDown, Minus, Send, History, Loader2 } from "lucide-react";
import type { Analysis } from "@shared/schema";

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === "BULLISH")
    return (
      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 gap-1 text-xs">
        <TrendingUp className="w-3 h-3" />Bullish
      </Badge>
    );
  if (direction === "BEARISH")
    return (
      <Badge className="bg-red-500/10 text-red-400 border-red-500/25 gap-1 text-xs">
        <TrendingDown className="w-3 h-3" />Bearish
      </Badge>
    );
  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <Minus className="w-3 h-3" />Neutral
    </Badge>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const gradient =
    score >= 7 ? "from-emerald-500 to-emerald-400" :
    score >= 4 ? "from-amber-500 to-amber-400" :
    "from-red-500 to-red-400";
  return (
    <div className="w-full h-1 bg-muted/80 rounded-full overflow-hidden">
      <div className={`h-full bg-gradient-to-r ${gradient} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function HistoryPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const { data: analyses, isLoading } = useQuery<Analysis[]>({
    queryKey: ["/api/analyses"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/analyses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
      toast({ title: "Analysis deleted" });
    },
  });

  const discordMutation = useMutation({
    mutationFn: async (analysis: Analysis) => {
      const res = await apiRequest("POST", "/api/discord/alert", {
        symbol: analysis.symbol,
        direction: analysis.direction,
        confluenceScore: analysis.confluenceScore,
        summary: analysis.aiSummary,
        price: analysis.priceAtAnalysis || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alert Sent", description: "Discord notification sent" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex flex-col h-full" data-testid="page-history">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground hover:text-foreground" />
        <div>
          <h1 className="text-base font-semibold leading-tight">Analysis History</h1>
          <p className="text-[10px] font-mono text-muted-foreground/60 hidden sm:block">All saved confluence analyses</p>
        </div>
        {analyses && analyses.length > 0 && (
          <Badge variant="outline" className="ml-auto font-mono text-xs border-border/50 text-muted-foreground">
            {analyses.length} records
          </Badge>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-5 max-w-3xl space-y-2">
          {isLoading ? (
            [1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)
          ) : !analyses || analyses.length === 0 ? (
            <div className="border border-dashed border-border/40 rounded-lg p-12 text-center text-muted-foreground">
              <History className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No analysis history yet.</p>
              <p className="text-xs mt-1 opacity-60">Run your first analysis from the Dashboard or AI Analysis page.</p>
            </div>
          ) : (
            analyses.map((analysis) => (
              <div
                key={analysis.id}
                className="border border-border/50 rounded-lg p-4 hover:border-border transition-colors"
                data-testid={`card-history-${analysis.id}`}
              >
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-mono font-semibold text-sm">{analysis.symbol}</span>
                    <DirectionBadge direction={analysis.direction} />
                    <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 border-border/50">
                      {analysis.timeframe}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <span className="text-lg font-mono font-bold leading-none mr-2">
                      {analysis.confluenceScore}
                      <span className="text-xs text-muted-foreground font-normal">/10</span>
                    </span>
                    {isAdmin && (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-7 h-7 text-muted-foreground hover:text-foreground"
                          onClick={() => discordMutation.mutate(analysis)}
                          disabled={discordMutation.isPending}
                          data-testid={`button-send-${analysis.id}`}
                        >
                          {discordMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-7 h-7 text-muted-foreground/50 hover:text-red-400"
                          onClick={() => deleteMutation.mutate(analysis.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${analysis.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <ScoreBar score={analysis.confluenceScore} />
                <p className="text-xs text-muted-foreground mt-2.5 leading-relaxed line-clamp-2">
                  {analysis.aiSummary}
                </p>
                {analysis.createdAt && (
                  <p className="text-[10px] font-mono text-muted-foreground/35 mt-2">
                    {new Date(analysis.createdAt).toLocaleString()}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
