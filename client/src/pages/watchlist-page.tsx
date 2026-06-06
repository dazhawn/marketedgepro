import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Trash2, Eye, Loader2 } from "lucide-react";
import type { WatchlistItem } from "@shared/schema";

const typeColors: Record<string, string> = {
  forex: "text-blue-400 border-blue-400/25 bg-blue-500/8",
  stock: "text-violet-400 border-violet-400/25 bg-violet-500/8",
  crypto: "text-amber-400 border-amber-400/25 bg-amber-500/8",
  commodity: "text-yellow-400 border-yellow-400/25 bg-yellow-500/8",
  index: "text-emerald-400 border-emerald-400/25 bg-emerald-500/8",
};

export default function WatchlistPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("forex");

  const { data: items, isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["/api/watchlist"],
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/watchlist", {
        symbol: newSymbol, name: newName, type: newType,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      setIsAddOpen(false); setNewSymbol(""); setNewName("");
      toast({ title: "Added to watchlist" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/watchlist/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      toast({ title: "Removed from watchlist" });
    },
  });

  return (
    <div className="flex flex-col h-full" data-testid="page-watchlist">
      <header className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <SidebarTrigger data-testid="button-sidebar-toggle" className="text-muted-foreground hover:text-foreground" />
          <div>
            <h1 className="text-base font-semibold leading-tight">Watchlist</h1>
            <p className="text-[10px] font-mono text-muted-foreground/60 hidden sm:block">
              {items ? `${items.length} symbol${items.length !== 1 ? "s" : ""} tracked` : "Manage tracked symbols"}
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button size="sm" className="gap-2 h-8" onClick={() => setIsAddOpen(true)} data-testid="button-add-watchlist">
            <Plus className="w-3.5 h-3.5" />
            Add Symbol
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-5">
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
          ) : !items || items.length === 0 ? (
            <div className="border border-dashed border-border/40 rounded-lg p-12 text-center text-muted-foreground">
              <Eye className="w-8 h-8 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Your watchlist is empty.</p>
              <p className="text-xs mt-1 opacity-60">Add symbols to start tracking markets for analysis.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="border border-border/50 rounded-lg p-4 flex items-center justify-between gap-3 hover:border-border transition-colors group"
                  data-testid={`card-watchlist-item-${item.id}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono font-semibold text-sm">{item.symbol}</span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] font-mono px-1.5 py-0 uppercase tracking-wider ${typeColors[item.type] ?? ""}`}
                      >
                        {item.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{item.name}</p>
                  </div>
                  {isAdmin && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="w-7 h-7 text-muted-foreground/40 hover:text-red-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-watchlist-${item.id}`}
                    >
                      {deleteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-sm border-border/60">
          <DialogHeader>
            <DialogTitle className="text-base">Add to Watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Symbol</label>
              <Input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                placeholder="EUR/USD, SPY, BTC..."
                className="h-9 border-border/50 text-sm font-mono"
                data-testid="input-new-symbol"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Euro / US Dollar"
                className="h-9 border-border/50 text-sm"
                data-testid="input-new-name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">Type</label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger className="h-9 border-border/50 text-sm" data-testid="select-new-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="forex">Forex</SelectItem>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="commodity">Commodity</SelectItem>
                  <SelectItem value="index">Index</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={addMutation.isPending || !newSymbol || !newName}
              className="w-full h-9 gap-2"
              data-testid="button-confirm-add"
            >
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Symbol
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
