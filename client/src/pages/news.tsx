import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Newspaper, ExternalLink, Search, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";

interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
  sentiment?: string;
  sentimentScore?: number;
}

function SentimentBadge({ sentiment }: { sentiment?: string }) {
  if (!sentiment) return null;
  const s = sentiment.toLowerCase();
  if (s.includes("bullish"))
    return (
      <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] px-1.5 py-0 gap-1" data-testid="badge-sentiment-bullish">
        <TrendingUp className="w-2.5 h-2.5" />{sentiment}
      </Badge>
    );
  if (s.includes("bearish"))
    return (
      <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] px-1.5 py-0 gap-1" data-testid="badge-sentiment-bearish">
        <TrendingDown className="w-2.5 h-2.5" />{sentiment}
      </Badge>
    );
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0" data-testid="badge-sentiment-neutral">{sentiment}</Badge>;
}

const categories = [
  { id: "all", label: "All Markets", query: "gold forex stock market trading" },
  { id: "gold", label: "Gold / Commodities", query: "gold price XAUUSD precious metals commodities" },
  { id: "stocks", label: "Equities", query: "stock market S&P 500 NASDAQ equities Wall Street" },
  { id: "forex", label: "Forex", query: "forex currency exchange rates EUR USD trading" },
];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NewsPage() {
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [customQuery, setCustomQuery] = useState<string | null>(null);

  const currentQuery = customQuery || categories.find(c => c.id === activeCategory)!.query;

  const { data: articles, isLoading, isFetching } = useQuery<NewsArticle[]>({
    queryKey: ["/api/news", currentQuery],
    queryFn: async () => {
      const res = await fetch(`/api/news?q=${encodeURIComponent(currentQuery)}`);
      if (!res.ok) throw new Error("Failed to fetch news");
      return res.json();
    },
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) { setCustomQuery(searchInput.trim()); setActiveCategory(""); }
  };

  const handleCategoryClick = (id: string) => {
    setActiveCategory(id); setCustomQuery(null); setSearchInput("");
  };

  return (
    <div className="flex flex-col h-full" data-testid="page-news">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground hover:text-foreground" />
        <div>
          <h1 className="text-base font-semibold leading-tight">Market News</h1>
          <p className="text-[10px] font-mono text-muted-foreground/60 hidden sm:block">Real-time · Sentiment scored</p>
        </div>
      </header>

      <div className="px-5 py-3.5 border-b border-border/50 space-y-3 bg-background/60">
        <div className="flex gap-1.5 flex-wrap">
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant={activeCategory === cat.id ? "default" : "ghost"}
              size="sm"
              onClick={() => handleCategoryClick(cat.id)}
              className={`h-7 text-xs rounded-full px-3 ${activeCategory === cat.id ? "" : "text-muted-foreground border border-border/50 hover:text-foreground hover:border-border"}`}
              data-testid={`button-category-${cat.id}`}
            >
              {cat.label}
            </Button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="flex gap-2 max-w-lg">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Custom search..."
              className="pl-9 h-8 text-sm border-border/50 bg-muted/30"
              data-testid="input-news-search"
            />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={isFetching} className="h-8 text-xs border-border/50" data-testid="button-search-news">
            {isFetching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Search"}
          </Button>
        </form>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="p-5 max-w-3xl space-y-2">
          {isLoading ? (
            [1,2,3,4,5].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)
          ) : !articles || articles.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Newspaper className="w-8 h-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No news found. Try a different search term.</p>
            </div>
          ) : (
            articles.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block group"
                data-testid={`card-news-${i}`}
              >
                <div className="border border-border/50 rounded-lg p-4 hover:bg-muted/20 hover:border-border transition-all duration-150">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p
                        className="font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors mb-1.5"
                        data-testid={`link-news-${i}`}
                      >
                        {article.title}
                      </p>
                      {article.description && (
                        <p className="text-xs text-muted-foreground/70 line-clamp-1 mb-2">{article.description}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded">
                          {article.source}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">{timeAgo(article.publishedAt)}</span>
                        <SentimentBadge sentiment={article.sentiment} />
                      </div>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/25 group-hover:text-muted-foreground/60 shrink-0 mt-0.5 transition-colors" />
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
