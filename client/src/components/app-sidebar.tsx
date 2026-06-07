import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  Radio,
  History,
  Settings,
  Activity,
  Shield,
  LogOut,
  Zap,
  Home,
  Mail,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { title: "Landing Page", url: "/", icon: Home },
  { title: "Sales Page", url: "/intro", icon: Sparkles },
  { title: "Signal Feed", url: "/admin", icon: Radio },
  { title: "History", url: "/admin/history", icon: History },
  { title: "Settings", url: "/admin/settings", icon: Settings },
  { title: "Waitlist", url: "/admin/waitlist", icon: Mail },
];

function NavItem({ item, isActive }: { item: { title: string; url: string; icon: any }; isActive: boolean }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild data-active={isActive} className="relative">
        <Link
          href={item.url}
          className={[
            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-150 group",
            isActive
              ? "bg-primary/10 text-primary border border-primary/15"
              : "text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent border border-transparent",
          ].join(" ")}
        >
          {isActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
          )}
          <item.icon className={["w-4 h-4 flex-shrink-0 transition-colors", isActive ? "text-primary" : "text-sidebar-foreground/45 group-hover:text-sidebar-foreground/80"].join(" ")} />
          <span className="truncate">{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
      toast({ title: "Signed out", description: "Admin access ended." });
    },
  });

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <Activity className="w-4 h-4 text-primary" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border-2 border-sidebar" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-sidebar-foreground leading-tight truncate">
              MarketEdgePro
            </h2>
            <p className="text-[10px] font-mono text-primary/70 mt-0.5 tracking-wider uppercase">
              Signal Hub
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-3">
        <SidebarGroup>
          <p className="px-4 pb-2 text-[10px] font-mono font-medium text-sidebar-foreground/35 uppercase tracking-[0.12em]">
            Navigation
          </p>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {navItems.map(item => (
                <NavItem key={item.title} item={item} isActive={location === item.url} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Signal Copier upsell */}
        <div className="mx-3 mt-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-amber-400">Signal Copier</span>
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Auto-copy signals to MT4/MT5. Coming soon — $50/month.
          </p>
        </div>
      </SidebarContent>

      <SidebarFooter className="px-4 py-4 border-t border-sidebar-border space-y-3">
        {isAdmin ? (
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex w-full items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent border border-transparent transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{logoutMutation.isPending ? "Signing out…" : "Sign out (Admin)"}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setLocation("/login")}
            className="flex w-full items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium text-sidebar-foreground/65 hover:text-sidebar-foreground hover:bg-sidebar-accent border border-sidebar-border/60 transition-colors"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Admin Login</span>
          </button>
        )}
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[10px] font-mono text-sidebar-foreground/35 tracking-wide">
            MarketEdgePro · Live
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
