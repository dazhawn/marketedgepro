import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Brain, TrendingUp, TrendingDown, RefreshCw, ArrowUpDown,
  ArrowUp, ArrowDown, Newspaper, ExternalLink, Calendar, Activity,
  Minus, BarChart3, Clock,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import type { WatchlistItem, Analysis } from "@shared/schema";

interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
  sentiment?: string;
  sentimentScore?: number;
}

interface SupportResistance {
  symbol: string;
  pivot: string;
  support1: string; support2: string; support3: string;
  resistance1: string; resistance2: string; resistance3: string;
  dailyHigh: string; dailyLow: string; dailyClose: string;
}

function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const gradient =
    score >= 7
      ? "from-emerald-500 to-emerald-400"
      : score >= 4
      ? "from-amber-500 to-amber-400"
      : "from-red-500 to-red-400";
  return (
    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full bg-gradient-to-r ${gradient} rounded-full transition-all duration-700`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === "BULLISH")
    return (
      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/25 gap-1" data-testid="badge-bullish">
        <TrendingUp className="w-3 h-3" />Bullish
      </Badge>
    );
  if (direction === "BEARISH")
    return (
      <Badge className="bg-red-500/10 text-red-400 border-red-500/25 gap-1" data-testid="badge-bearish">
        <TrendingDown className="w-3 h-3" />Bearish
      </Badge>
    );
  return (
    <Badge variant="secondary" data-testid="badge-neutral">
      <Minus className="w-3 h-3 mr-1" />Neutral
    </Badge>
  );
}

function LevelRow({ label, value, type }: { label: string; value: string; type: "resistance" | "support" | "pivot" }) {
  const dotColor =
    type === "resistance" ? "bg-red-400" : type === "support" ? "bg-emerald-400" : "bg-blue-400";
  const textColor =
    type === "resistance" ? "text-red-400" : type === "support" ? "text-emerald-400" : "text-blue-400";
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <div className="flex items-center gap-2">
        <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className={`text-xs font-mono font-medium ${textColor}`}>{label}</span>
      </div>
      <span className="text-xs font-mono text-foreground">{value}</span>
    </div>
  );
}

function PriceDisplay({ symbol }: { symbol: string }) {
  const { data: levels } = useQuery<SupportResistance>({
    queryKey: ["/api/market-data/levels", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market-data/levels/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 15 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
  if (!levels) return null;
  return (
    <div className="flex items-center gap-3 mt-1.5" data-testid={`price-display-${symbol}`}>
      <span className="flex items-center gap-0.5 text-emerald-400 text-xs">
        <ArrowUp className="w-3 h-3" />
        <span className="font-mono font-medium">{levels.dailyHigh}</span>
      </span>
      <span className="flex items-center gap-0.5 text-red-400 text-xs">
        <ArrowDown className="w-3 h-3" />
        <span className="font-mono font-medium">{levels.dailyLow}</span>
      </span>
    </div>
  );
}

function SupportResistanceCard({ symbol }: { symbol: string }) {
  const { data: levels, isLoading, error } = useQuery<SupportResistance>({
    queryKey: ["/api/market-data/levels", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market-data/levels/${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed");
      }
      return res.json();
    },
    staleTime: 15 * 60 * 1000,
    retry: 0,
    refetchOnWindowFocus: false,
  });

  if (isLoading) return <Skeleton className="h-52 rounded-lg" />;
  if (error || !levels)
    return (
      <Card className="border-border/50">
        <CardContent className="p-4 text-center text-muted-foreground">
          <p className="text-xs">Levels unavailable for {symbol}</p>
        </CardContent>
      </Card>
    );

  return (
    <Card className="border-border/50" data-testid={`card-levels-${symbol}`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-primary" />
            {symbol}
          </CardTitle>
          <span className="text-[10px] font-mono text-muted-foreground">
            CLOSE <span className="text-foreground">{levels.dailyClose}</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <LevelRow label="R3" value={levels.resistance3} type="resistance" />
        <LevelRow label="R2" value={levels.resistance2} type="resistance" />
        <LevelRow label="R1" value={levels.resistance1} type="resistance" />
        <LevelRow label="PP" value={levels.pivot} type="pivot" />
        <LevelRow label="S1" value={levels.support1} type="support" />
        <LevelRow label="S2" value={levels.support2} type="support" />
        <LevelRow label="S3" value={levels.support3} type="support" />
        <div className="flex justify-between mt-3 pt-2 border-t border-border/40 text-[10px] font-mono text-muted-foreground">
          <span>H: <span className="text-emerald-400">{levels.dailyHigh}</span></span>
          <span>L: <span className="text-red-400">{levels.dailyLow}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  const s = sentiment.toLowerCase();
  if (s.includes("bullish"))
    return <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] px-1.5 py-0">{sentiment}</Badge>;
  if (s.includes("bearish"))
    return <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] px-1.5 py-0">{sentiment}</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{sentiment}</Badge>;
}

interface CalendarEvent {
  title: string; country: string; date: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  forecast: string; previous: string;
}
interface CalendarData { today: CalendarEvent[]; tomorrow: CalendarEvent[]; thisWeek: CalendarEvent[]; }

function ImpactDot({ impact }: { impact: string }) {
  if (impact === "High") return <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-0.5" />;
  if (impact === "Medium") return <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-0.5" />;
  return <span className="w-2 h-2 rounded-full bg-border flex-shrink-0 mt-0.5" />;
}

function CalendarEventRow({ event }: { event: CalendarEvent }) {
  const time = new Date(event.date).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
  });
  return (
    <div
      className="flex items-start gap-3 py-2.5 border-b border-border/40 last:border-0 group"
      data-testid={`row-calendar-${event.country}-${event.title.slice(0,10).replace(/\s/g,"-")}`}
    >
      <ImpactDot impact={event.impact} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className="text-[10px] font-mono font-semibold text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
            {event.country}
          </span>
          <span className="text-xs font-medium truncate">{event.title}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{time} EST</span>
          {event.forecast && <span>F: <span className="text-foreground">{event.forecast}</span></span>}
          {event.previous && <span>P: {event.previous}</span>}
        </div>
      </div>
    </div>
  );
}

function DashboardCalendar() {
  const { data, isLoading } = useQuery<CalendarData>({
    queryKey: ["/api/economic-calendar"],
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const todayHigh = data?.today.filter(e => e.impact === "High" || e.impact === "Medium") ?? [];
  const tomorrowHigh = data?.tomorrow.filter(e => e.impact === "High" || e.impact === "Medium") ?? [];
  const weekHigh = data?.thisWeek ?? [];

  return (
    <section>
      <SectionLabel icon={<Calendar className="w-3.5 h-3.5" />} label="Economic Calendar" />
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
      ) : (
        <Card className="border-border/50" data-testid="card-economic-calendar">
          <CardContent className="p-0">
            <Tabs defaultValue="today">
              <div className="px-4 pt-3 pb-0 border-b border-border/50">
                <TabsList className="h-8 bg-transparent gap-1 p-0">
                  <TabsTrigger
                    value="today"
                    className="text-xs px-3 h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground"
                    data-testid="tab-calendar-today"
                  >
                    Today
                    {todayHigh.length > 0 && (
                      <span className="ml-1.5 bg-red-500/90 text-white rounded-full text-[9px] w-4 h-4 flex items-center justify-center font-mono">
                        {todayHigh.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="tomorrow"
                    className="text-xs px-3 h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground"
                    data-testid="tab-calendar-tomorrow"
                  >
                    Tomorrow
                  </TabsTrigger>
                  <TabsTrigger
                    value="week"
                    className="text-xs px-3 h-8 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground text-muted-foreground"
                    data-testid="tab-calendar-week"
                  >
                    This Week
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="today" className="mt-0">
                <div className="px-4 pb-2 pt-1">
                  {todayHigh.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No high/medium impact events today</p>
                  ) : todayHigh.map((e, i) => <CalendarEventRow key={i} event={e} />)}
                </div>
              </TabsContent>
              <TabsContent value="tomorrow" className="mt-0">
                <div className="px-4 pb-2 pt-1">
                  {tomorrowHigh.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No high/medium impact events tomorrow</p>
                  ) : tomorrowHigh.map((e, i) => <CalendarEventRow key={i} event={e} />)}
                </div>
              </TabsContent>
              <TabsContent value="week" className="mt-0">
                <div className="px-4 pb-2 pt-1 max-h-72 overflow-y-auto">
                  {weekHigh.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">No events this week</p>
                  ) : weekHigh.map((e, i) => <CalendarEventRow key={i} event={e} />)}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function DashboardNews() {
  const { data: articles, isLoading } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", "gold forex stock market trading"],
    queryFn: async () => {
      const res = await fetch(`/api/news?q=${encodeURIComponent("gold forex stock market trading")}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const topArticles = articles?.slice(0, 5) || [];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <SectionLabel icon={<Newspaper className="w-3.5 h-3.5" />} label="Market News" inline />
        <Link href="/news">
          <Button variant="ghost" size="sm" className="text-xs h-7 text-muted-foreground hover:text-foreground gap-1" data-testid="link-view-all-news">
            View All <ExternalLink className="w-3 h-3" />
          </Button>
        </Link>
      </div>
      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : topArticles.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="p-6 text-center text-muted-foreground">
            <Newspaper className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-xs">No market news available</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {topArticles.map((article, i) => (
            <a key={i} href={article.url} target="_blank" rel="noopener noreferrer" data-testid={`link-news-${i}`} className="block group">
              <div className="border border-border/50 rounded-lg p-3 hover:bg-muted/30 hover:border-border transition-all duration-150">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors" data-testid={`text-news-title-${i}`}>
                      {article.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">{article.source}</span>
                      <span className="text-[10px] text-muted-foreground/50">
                        {new Date(article.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <SentimentBadge sentiment={article.sentiment} />
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 shrink-0 mt-0.5 transition-colors" />
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionLabel({ icon, label, inline = false }: { icon: React.ReactNode; label: string; inline?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${inline ? "" : "mb-3"}`}>
      <span className="text-muted-foreground/70">{icon}</span>
      <span className="text-[10px] font-mono font-semibold text-muted-foreground/70 uppercase tracking-wider">{label}</span>
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [selectedLevelsSymbol, setSelectedLevelsSymbol] = useState<string | null>(null);

  const { data: watchlistItems, isLoading: loadingWatchlist } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const { data: recentAnalyses, isLoading: loadingAnalyses } = useQuery<Analysis[]>({
    queryKey: ["/api/analyses"],
  });

  const analyzeMutation = useMutation({
    mutationFn: async (params: { symbol: string; timeframe: string }) => {
      const res = await apiRequest("POST", "/api/ai/analyze", params);
      return res.json();
    },
    onSuccess: async (data, variables) => {
      await apiRequest("POST", "/api/analyses", {
        symbol: variables.symbol,
        timeframe: variables.timeframe,
        direction: data.direction,
        confluenceScore: data.confluenceScore,
        aiSummary: data.summary,
        newsFactors: data.newsFactors,
        technicalFactors: data.technicalFactors,
        priceAtAnalysis: null,
        sentAlerted: false,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/analyses"] });
      toast({ title: "Analysis Complete", description: `${variables.symbol}: ${data.direction} (${data.confluenceScore}/10)` });
    },
    onError: (error: Error) => {
      toast({ title: "Analysis Failed", description: error.message, variant: "destructive" });
    },
  });

  const latest = recentAnalyses?.slice(0, 5) || [];

  return (
    <div className="flex flex-col h-full" data-testid="page-dashboard">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground hover:text-foreground" />
          <div>
            <h1 className="text-base font-semibold leading-tight">Dashboard</h1>
            <p className="text-[10px] font-mono text-muted-foreground/60 hidden sm:block">Trading Confluence · Predictive Ranges v5</p>
          </div>
        </div>
        {isAdmin && (
          <Link href="/analysis">
            <Button size="sm" className="gap-2 h-8" data-testid="button-new-analysis">
              <Brain className="w-3.5 h-3.5" />
              New Analysis
            </Button>
          </Link>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-5 space-y-8 max-w-5xl mx-auto">

          <section>
            <SectionLabel icon={<Activity className="w-3.5 h-3.5" />} label="Watchlist" />
            {loadingWatchlist ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {watchlistItems?.map((item) => (
                  <Card
                    key={item.id}
                    className="border-border/50 hover:border-border transition-colors group"
                    data-testid={`card-watchlist-${item.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <p className="font-mono font-semibold text-sm tracking-wide" data-testid={`text-symbol-${item.id}`}>
                            {item.symbol}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{item.name}</p>
                          <PriceDisplay symbol={item.symbol} />
                        </div>
                        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0.5 text-muted-foreground border-border/60">
                          {item.type}
                        </Badge>
                      </div>
                      <div className="flex gap-1.5">
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 text-xs border-border/50 hover:border-primary/40 hover:bg-primary/5 hover:text-primary gap-1.5"
                            disabled={analyzeMutation.isPending}
                            onClick={() => analyzeMutation.mutate({ symbol: item.symbol, timeframe: "1H" })}
                            data-testid={`button-analyze-${item.id}`}
                          >
                            {analyzeMutation.isPending
                              ? <RefreshCw className="w-3 h-3 animate-spin" />
                              : <Brain className="w-3 h-3" />}
                            Analyze
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={selectedLevelsSymbol === item.symbol ? "default" : "ghost"}
                          className={`h-7 w-7 p-0 border border-border/40 ${isAdmin ? "" : "flex-1"}`}
                          onClick={() => setSelectedLevelsSymbol(selectedLevelsSymbol === item.symbol ? null : item.symbol)}
                          data-testid={`button-levels-${item.id}`}
                        >
                          <ArrowUpDown className="w-3 h-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionLabel icon={<BarChart3 className="w-3.5 h-3.5" />} label="Support & Resistance" />
            {selectedLevelsSymbol ? (
              <div className="max-w-xs">
                <SupportResistanceCard symbol={selectedLevelsSymbol} />
              </div>
            ) : (
              <div className="border border-dashed border-border/50 rounded-lg p-6 text-center text-muted-foreground">
                <ArrowUpDown className="w-6 h-6 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Click the <ArrowUpDown className="w-3 h-3 inline mx-0.5" /> icon on any watchlist card to view pivot levels.</p>
              </div>
            )}
          </section>

          <DashboardCalendar />
          <DashboardNews />

          <section>
            <SectionLabel icon={<Brain className="w-3.5 h-3.5" />} label="Recent Analyses" />
            {loadingAnalyses ? (
              <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
            ) : latest.length === 0 ? (
              <div className="border border-dashed border-border/50 rounded-lg p-8 text-center text-muted-foreground">
                <Brain className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No analyses yet.</p>
                <p className="text-xs mt-1 opacity-60">Click "Analyze" on a watchlist item to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {latest.map((analysis) => (
                  <Card key={analysis.id} className="border-border/50" data-testid={`card-analysis-${analysis.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-sm">{analysis.symbol}</span>
                          <DirectionBadge direction={analysis.direction} />
                          <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">{analysis.timeframe}</Badge>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="text-lg font-mono font-bold leading-none">{analysis.confluenceScore}</span>
                          <span className="text-xs text-muted-foreground font-mono">/10</span>
                        </div>
                      </div>
                      <ScoreBar score={analysis.confluenceScore} />
                      <p className="text-xs text-muted-foreground mt-2.5 leading-relaxed line-clamp-2" data-testid={`text-summary-${analysis.id}`}>
                        {analysis.aiSummary}
                      </p>
                      {analysis.createdAt && (
                        <p className="text-[10px] font-mono text-muted-foreground/40 mt-2">
                          {new Date(analysis.createdAt).toLocaleString()}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
