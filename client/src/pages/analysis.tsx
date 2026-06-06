import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import {
  Brain, TrendingUp, TrendingDown, Minus, Loader2, Send,
  CheckCircle2, AlertCircle, Zap, Shield,
} from "lucide-react";
import type { WatchlistItem } from "@shared/schema";

interface AnalysisResult {
  direction: string;
  confluenceScore: number;
  summary: string;
  newsFactors: string[];
  technicalFactors: string[];
  confidence: string;
}

function ScoreGauge({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color =
    score >= 7 ? "from-emerald-500 to-emerald-400" :
    score >= 4 ? "from-amber-500 to-amber-400" :
    "from-red-500 to-red-400";
  const label =
    score >= 8 ? "Strong" : score >= 6 ? "Moderate" : score >= 4 ? "Weak" : "Low";
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">Confluence Score</span>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-mono font-bold leading-none">{score}</span>
          <span className="text-sm font-mono text-muted-foreground">/10</span>
          <span className="text-xs text-muted-foreground ml-1">· {label}</span>
        </div>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground/50">
        <span>0</span><span>5</span><span>10</span>
      </div>
    </div>
  );
}

function FactorList({ title, items, iconColor }: { title: string; items: string[]; iconColor: string }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-mono font-semibold text-muted-foreground/70 uppercase tracking-wider">{title}</h4>
      <ul className="space-y-1.5">
        {items.map((factor, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${iconColor}`} />
            <span className="text-muted-foreground leading-snug">{factor}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AnalysisPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [symbol, setSymbol] = useState("");
  const [timeframe, setTimeframe] = useState("1H");
  const [context, setContext] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const { data: watchlistItems, isLoading: loadingWatchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  useEffect(() => {
    if (!symbol && watchlistItems?.length) setSymbol(watchlistItems[0].symbol);
  }, [watchlistItems, symbol]);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai/analyze", {
        symbol, timeframe, context: context || undefined,
      });
      return res.json() as Promise<AnalysisResult>;
    },
    onSuccess: async (data) => {
      setResult(data);
      await apiRequest("POST", "/api/analyses", {
        symbol, timeframe,
        direction: data.direction,
        confluenceScore: data.confluenceScore,
        aiSummary: data.summary,
        newsFactors: data.newsFactors,
        technicalFactors: data.technicalFactors,
        priceAtAnalysis: null,
        sentAlerted: false,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
      toast({ title: "Analysis Complete", description: `${symbol}: ${data.direction} (${data.confluenceScore}/10)` });
    },
    onError: (error: Error) => {
      toast({ title: "Analysis Failed", description: error.message, variant: "destructive" });
    },
  });

  const discordMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error("No analysis to send");
      const res = await apiRequest("POST", "/api/discord/alert", {
        symbol,
        direction: result.direction,
        confluenceScore: result.confluenceScore,
        summary: result.summary,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Alert Sent", description: "Discord notification delivered" });
    },
    onError: (error: Error) => {
      toast({ title: "Alert Failed", description: error.message, variant: "destructive" });
    },
  });

  const directionBadge = result?.direction === "BULLISH" ? (
    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 gap-1 px-2.5 py-1">
      <TrendingUp className="w-3.5 h-3.5" />Bullish
    </Badge>
  ) : result?.direction === "BEARISH" ? (
    <Badge className="bg-red-500/10 text-red-400 border-red-500/25 gap-1 px-2.5 py-1">
      <TrendingDown className="w-3.5 h-3.5" />Bearish
    </Badge>
  ) : result ? (
    <Badge variant="secondary" className="gap-1 px-2.5 py-1">
      <Minus className="w-3.5 h-3.5" />Neutral
    </Badge>
  ) : null;

  return (
    <div className="flex flex-col h-full" data-testid="page-analysis">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground hover:text-foreground" />
        <div>
          <h1 className="text-base font-semibold leading-tight">AI Analysis</h1>
          <p className="text-[10px] font-mono text-muted-foreground/60 hidden sm:block">Confluence scoring · Multi-factor</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-5 max-w-2xl mx-auto space-y-5">

          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Configure Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Symbol</label>
                  <Select value={symbol} onValueChange={setSymbol} disabled={loadingWatchlist}>
                    <SelectTrigger className="h-9 text-sm border-border/50" data-testid="select-symbol">
                      <SelectValue placeholder={loadingWatchlist ? "Loading..." : "Select symbol"} />
                    </SelectTrigger>
                    <SelectContent>
                      {watchlistItems?.map((item) => (
                        <SelectItem key={item.id} value={item.symbol} data-testid={`option-symbol-${item.symbol}`}>
                          <span className="font-mono font-medium">{item.symbol}</span>
                          <span className="text-muted-foreground ml-2 text-xs">— {item.name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Timeframe</label>
                  <Select value={timeframe} onValueChange={setTimeframe}>
                    <SelectTrigger className="h-9 text-sm border-border/50" data-testid="select-timeframe">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[["5M","5 Minute"],["15M","15 Minute"],["30M","30 Minute"],["1H","1 Hour"],["2H","2 Hour"],["4H","4 Hour"],["1D","Daily"],["1W","Weekly"]].map(([v, l]) => (
                        <SelectItem key={v} value={v}><span className="font-mono">{v}</span> · {l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">
                  Context <span className="normal-case font-sans tracking-normal opacity-60">(optional)</span>
                </label>
                <Textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Add chart observations, indicator readings, or strategy notes..."
                  className="min-h-[72px] text-sm resize-none border-border/50 bg-muted/30 placeholder:text-muted-foreground/40"
                  data-testid="input-context"
                />
              </div>

              {isAdmin ? (
                <Button
                  onClick={() => analyzeMutation.mutate()}
                  disabled={analyzeMutation.isPending || !symbol}
                  className="w-full h-10 gap-2"
                  data-testid="button-run-analysis"
                >
                  {analyzeMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Brain className="w-4 h-4" />
                  )}
                  {analyzeMutation.isPending ? "Analyzing with AI..." : "Run Confluence Analysis"}
                </Button>
              ) : (
                <Link href="/login">
                  <Button variant="outline" className="w-full h-10 gap-2 border-border/50" data-testid="button-login-to-analyze">
                    <Shield className="w-4 h-4" />
                    Admin login required to run analysis
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>

          {result && (
            <Card className="border-border/50" data-testid="card-analysis-result">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono font-bold text-lg">{symbol}</span>
                      {directionBadge}
                      <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 border-border/50">
                        {result.confidence}
                      </Badge>
                    </div>
                    <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">{timeframe} · Confluence Report</p>
                  </div>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => discordMutation.mutate()}
                      disabled={discordMutation.isPending}
                      className="h-8 gap-1.5 text-xs border-border/50 shrink-0"
                      data-testid="button-send-discord"
                    >
                      {discordMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Send to Discord
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-5">
                <ScoreGauge score={result.confluenceScore} />

                <div className="border-t border-border/40 pt-4 space-y-1.5">
                  <h4 className="text-xs font-mono font-semibold text-muted-foreground/70 uppercase tracking-wider">AI Summary</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed" data-testid="text-analysis-summary">
                    {result.summary}
                  </p>
                </div>

                {(result.newsFactors.length > 0 || result.technicalFactors.length > 0) && (
                  <div className="border-t border-border/40 pt-4 grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <FactorList title="News Factors" items={result.newsFactors} iconColor="text-blue-400" />
                    <FactorList title="Technical Factors" items={result.technicalFactors} iconColor="text-emerald-400" />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!result && !analyzeMutation.isPending && (
            <div className="border border-dashed border-border/40 rounded-lg p-8 text-center space-y-2">
              <AlertCircle className="w-8 h-8 mx-auto text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground">Select a symbol and run analysis to get AI confluence scoring.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
