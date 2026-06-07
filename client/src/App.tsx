import { Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import NotFound from "@/pages/not-found";
import { AppSidebar } from "@/components/app-sidebar";
import SignalsPage from "@/pages/signals";
import HistoryPage from "@/pages/history";
import SettingsPage from "@/pages/settings";
import LoginPage from "@/pages/login";
import LandingPage from "@/pages/landing";
import IntroPage from "@/pages/intro";
import WaitlistPage from "@/pages/waitlist";

// Admin shell — sidebar layout, password protected routes
function AdminShell() {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "4rem",
  };
  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-background">
          <Switch>
            <Route path="/admin" component={SignalsPage} />
            <Route path="/admin/history" component={HistoryPage} />
            <Route path="/admin/settings" component={SettingsPage} />
            <Route path="/admin/waitlist" component={WaitlistPage} />
            <Route path="/login" component={LoginPage} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </SidebarProvider>
  );
}

function Router() {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin") || location === "/login";
  return isAdmin ? <AdminShell /> : (
    <Switch>
      <Route path="/" component={LandingPage} />
      <Route path="/intro" component={IntroPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
