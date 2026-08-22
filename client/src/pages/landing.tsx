import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, TrendingUp, TrendingDown, Bell, Shield, Brain, Sparkles,
  Mail, Phone, ArrowRight, Check, Clock, ChevronDown, ChevronRight, Star,
  BarChart3, Bot, Target, LineChart, Wrench, ExternalLink,
} from "lucide-react";

const DISCORD_INVITE = "https://discord.gg/h7qvbPjAV";
const LAUNCH_DATE = new Date("2026-08-01T00:00:00-04:00");

// ─────────────────────────────────────────────────────────────────────────────
//  Countdown to public launch
// ─────────────────────────────────────────────────────────────────────────────
function useCountdown(target: Date) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target.getTime() - now.getTime());
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff / 3600000) % 24),
    minutes: Math.floor((diff / 60000) % 60),
    seconds: Math.floor((diff / 1000) % 60),
    done: diff === 0,
  };
}

function CountdownTimer() {
  const { days, hours, minutes, seconds, done } = useCountdown(LAUNCH_DATE);
  if (done) {
    return (
      <div className="inline-block bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-4 py-2 rounded-lg text-sm font-bold">
        🚀 We're live — join now →
      </div>
    );
  }
  const cells = [
    { label: "DAYS", value: days },
    { label: "HOURS", value: hours },
    { label: "MINUTES", value: minutes },
    { label: "SECONDS", value: seconds },
  ];
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3 text-center">
        Public launch · August 1, 2026
      </p>
      <div className="grid grid-cols-4 gap-2 sm:gap-3 max-w-md mx-auto">
        {cells.map(({ label, value }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg py-3 text-center">
            <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">{String(value).padStart(2, "0")}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Live "spots remaining" counter
// ─────────────────────────────────────────────────────────────────────────────
function useSpotsRemaining() {
  return useQuery<{ total: number; max: number; remaining: number }>({
    queryKey: ["/api/waitlist/count"],
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

function SpotsRemainingBar({ compact = false }: { compact?: boolean }) {
  const { data } = useSpotsRemaining();
  const total = data?.total ?? 0;
  const max = data?.max ?? 100;
  const remaining = data?.remaining ?? max;
  const pct = Math.min(100, Math.round((total / max) * 100));
  const isHot = remaining <= 25;
  const isLast = remaining <= 10;
  const tone = isLast ? "text-rose-300" : isHot ? "text-amber-300" : "text-emerald-300";
  const dot = isLast ? "bg-rose-400" : isHot ? "bg-amber-400" : "bg-emerald-400";

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${tone}`}>
        <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${dot}`} />
        {remaining} / {max} founding spots left
      </span>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-bold ${tone}`}>
          {remaining === 0 ? "Waitlist is FULL" : `${remaining} founding spots remaining`}
        </span>
        <span className="text-zinc-500 font-mono tabular-nums">{total} / {max}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${isLast ? "bg-gradient-to-r from-rose-500 to-red-500" : isHot ? "bg-gradient-to-r from-amber-500 to-orange-500" : "bg-gradient-to-r from-emerald-500 to-teal-400"}`}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Waitlist signup form
// ─────────────────────────────────────────────────────────────────────────────
function SignupForm({ source }: { source: string }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const join = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/waitlist", {
        email: email.trim(),
        phone: phone.trim() || undefined,
        source,
      });
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "You're on the list!", description: "We'll text or email you the moment we launch." });
    },
    onError: (err: Error) => toast({ title: "Couldn't sign you up", description: err.message, variant: "destructive" }),
  });

  if (submitted) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
          <Sparkles className="w-6 h-6 text-emerald-400" />
        </div>
        <h3 className="text-lg font-bold mb-1">You're on the list! 🎉</h3>
        <p className="text-zinc-400 text-sm">We'll reach out the moment early access opens.</p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) join.mutate(); }} className="space-y-3">
      <div className="relative">
        <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
        />
      </div>
      <div className="relative">
        <Phone className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 123 4567  (optional — for launch SMS)"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
        />
      </div>
      <button
        type="submit" disabled={join.isPending || !email.trim()}
        className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all"
      >
        {join.isPending ? "Adding you…" : <>Reserve early access <ArrowRight className="w-4 h-4" /></>}
      </button>
      <p className="text-[10px] text-zinc-600 text-center">No spam. Unsubscribe anytime. Phone used only for launch SMS.</p>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Live signal-card preview — mirrors the real Discord embed
// ─────────────────────────────────────────────────────────────────────────────
function SignalCardPreview() {
  return (
    <div className="relative">
      <div className="absolute -inset-2 bg-gradient-to-br from-emerald-500/20 via-transparent to-teal-500/10 blur-2xl rounded-3xl pointer-events-none" />
      <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-stretch">
          <div className="w-1 bg-rose-500" />
          <div className="flex-1 p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-5 h-5 text-rose-400" />
              <span className="font-bold text-white">NVDA — BEARISH</span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-500">Trend Flip</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm mb-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Price</div>
                <div className="font-mono text-white">194.83</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">🔴 Stop Loss</div>
                <div className="font-mono text-rose-300">201.06</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Confluence</div>
                <div className="font-mono text-emerald-300">4 / 4</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm mb-3">
              {[["🎯 TP1", "188.60"], ["🎯 TP2", "182.44"], ["🎯 TP3", "176.21"]].map(([l, v]) => (
                <div key={l}>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">{l}</div>
                  <div className="font-mono text-emerald-300">{v}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-3 border-t border-zinc-800 text-xs text-zinc-500">
              <span>Renko <span className="text-rose-400">Bearish</span></span>
              <span>MTF ▼ ▼▲▼▼</span>
              <span className="ml-auto text-zinc-600">MarketEdgePro · Stocks Signals</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Subscription tiers (live Discord product)
// ─────────────────────────────────────────────────────────────────────────────
const tiers = [
  {
    name: "Free Preview", price: "$0", period: "",
    description: "See that signals are firing. No entry details.",
    color: "border-zinc-700", badge: "",
    features: ["Symbol + direction alerts", "#free-preview channel access", "No SL/TP details"],
    cta: "Join Free", ctaStyle: "bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-600",
  },
  {
    name: "Currency Signals", price: "$10", period: "/mo",
    description: "Full Forex pair signals with entry, SL, and 3 take-profits.",
    color: "border-sky-500/40", badge: "",
    features: ["All Forex pairs (EUR/USD, GBP/JPY…)", "Entry, Stop Loss, TP1 / TP2 / TP3", "EMA, RSI, Renko & MTF data", "Morning market brief"],
    cta: "Subscribe", ctaStyle: "bg-sky-600 hover:bg-sky-500 text-white",
  },
  {
    name: "Metals Signals", price: "$10", period: "/mo",
    description: "Gold, Silver and Platinum signals — full detail.",
    color: "border-amber-500/40", badge: "",
    features: ["XAUUSD, XAGUSD, XPTUSD", "Entry, Stop Loss, TP1 / TP2 / TP3", "EMA, RSI, Renko & MTF data", "Morning market brief"],
    cta: "Subscribe", ctaStyle: "bg-amber-600 hover:bg-amber-500 text-white",
  },
  {
    name: "Stocks Signals", price: "$20", period: "/mo",
    description: "SPY, QQQ, mega-caps + major global indices.",
    color: "border-violet-500/40", badge: "",
    features: ["SPY, QQQ, AAPL, NVDA, TSLA, META & more", "US30, NAS100, SPX500, UK100, DE40", "Entry, Stop Loss, TP1 / TP2 / TP3", "Morning market brief"],
    cta: "Subscribe", ctaStyle: "bg-violet-600 hover:bg-violet-500 text-white",
  },
  {
    name: "All Signals", price: "$30", period: "/mo",
    description: "Every signal we post — all four markets in one tier.",
    color: "border-emerald-500", badge: "Best Value",
    features: ["Forex + Metals + Stocks/Indices + Crypto", "Entry, Stop Loss, TP1 / TP2 / TP3", "Daily AI pre-market brief", "Live analysis + priority access"],
    cta: "Best Deal →", ctaStyle: "bg-emerald-600 hover:bg-emerald-500 text-white font-bold",
  },
];

function TierCard({ tier }: { tier: typeof tiers[0] }) {
  return (
    <div className={`relative flex flex-col bg-zinc-900 border-2 ${tier.color} rounded-2xl p-6 transition-transform hover:-translate-y-1`}>
      {tier.badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full bg-emerald-500 text-white">
          {tier.badge}
        </span>
      )}
      <div className="mb-4">
        <h3 className="text-lg font-bold text-white">{tier.name}</h3>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-3xl font-extrabold text-white">{tier.price}</span>
          <span className="text-zinc-400 text-sm">{tier.period}</span>
        </div>
        <p className="text-zinc-400 text-sm mt-2">{tier.description}</p>
      </div>
      <ul className="space-y-2 flex-1 mb-6">
        {tier.features.map(f => (
          <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
            <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />{f}
          </li>
        ))}
      </ul>
      <a href={DISCORD_INVITE} target="_blank" rel="noreferrer"
        className={`w-full py-2.5 rounded-lg text-sm text-center block transition-colors ${tier.ctaStyle}`}>
        {tier.cta}
      </a>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Shared bits
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto mb-12">
      <div className="inline-block text-emerald-400 text-xs font-semibold uppercase tracking-widest mb-3">{eyebrow}</div>
      <h2 className="text-3xl sm:text-4xl font-bold leading-tight mb-3">{title}</h2>
      {sub && <p className="text-zinc-400 text-base leading-relaxed">{sub}</p>}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-800">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-4 text-left hover:text-emerald-400 transition-colors">
        <span className="font-medium text-sm">{q}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="text-zinc-400 text-sm pb-4 leading-relaxed">{a}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* NAV */}
      <nav className="border-b border-zinc-800 px-6 py-4 sticky top-0 z-30 bg-zinc-950/80 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-none">MarketEdgePro</h2>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Signal Hub</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a href="#pricing" className="hidden sm:block text-sm text-zinc-400 hover:text-white transition-colors">Pricing</a>
            <a href={DISCORD_INVITE} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 transition-colors text-white text-sm font-semibold px-4 py-2 rounded-lg">
              Join Discord <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="px-6 py-16 sm:py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/5 pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="max-w-6xl mx-auto relative grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live signals — AI-validated edge
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-[1.1] mb-6">
              AI-validated trading signals.<br />
              <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">
                Straight to Discord.
              </span>
            </h1>
            <p className="text-zinc-400 text-lg leading-relaxed mb-8">
              Forex, metals, stocks, indices, and crypto signals from our <strong className="text-white">proprietary multi-timeframe</strong> strategy —
              pre-validated by AI confluence scoring and delivered with full entry, SL, and three take-profit levels.
            </p>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
              <a href={DISCORD_INVITE} target="_blank" rel="noreferrer"
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 transition-colors text-white font-bold px-7 py-3.5 rounded-xl text-base shadow-lg shadow-emerald-500/20">
                Join the Discord <ChevronRight className="w-5 h-5" />
              </a>
              <a href="#pricing" className="text-zinc-400 hover:text-white transition-colors font-medium">See pricing ↓</a>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">
              <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-emerald-400" /> Full SL + 3 TPs</div>
              <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-emerald-400" /> AI-validated</div>
              <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-emerald-400" /> Cancel anytime</div>
            </div>
          </div>
          <div>
            <SignalCardPreview />
            <p className="text-center text-xs text-zinc-600 mt-3">A real signal card — exactly what lands in your channel.</p>
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <section className="border-y border-zinc-800 bg-zinc-900/50">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { v: "24/5", l: "Coverage" },
            { v: "4", l: "Asset Classes" },
            { v: "3", l: "Take-Profit Targets" },
            { v: "8 AM EST", l: "Daily AI Brief" },
          ].map(({ v, l }) => (
            <div key={l}>
              <div className="text-2xl sm:text-3xl font-extrabold text-white">{v}</div>
              <div className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PROBLEM / SOLUTION */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="text-rose-400 text-xs font-semibold uppercase tracking-widest mb-3">The Problem</div>
            <h2 className="text-3xl font-bold leading-tight mb-4">Most signal services blast alerts and hope you catch one.</h2>
            <ul className="space-y-3 text-zinc-400 text-sm leading-relaxed">
              {["No risk management — no SL, no TP levels", "No context on trend or higher-timeframe confluence", "You're glued to your phone, copying by hand", "Random win rates, zero accountability"].map(t => (
                <li key={t} className="flex gap-3"><span className="text-rose-400 mt-0.5">✕</span> {t}</li>
              ))}
            </ul>
          </div>
          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 rounded-2xl p-6">
            <div className="text-emerald-400 text-xs font-semibold uppercase tracking-widest mb-3">The MarketEdgePro Way</div>
            <h3 className="text-xl font-bold mb-4">Every signal is AI-validated before it's sent.</h3>
            <ul className="space-y-3 text-zinc-300 text-sm leading-relaxed">
              {["Full entry + SL + 3 take-profit levels", "AI cross-checks news + technicals before posting", "Renko + 4-timeframe confluence filtering", "Pre-market brief at 8 AM EST every weekday"].map(t => (
                <li key={t} className="flex gap-3"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="px-6 py-20 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto">
          <SectionHeading eyebrow="How It Works" title="From chart pattern to your Discord — in seconds." />
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: TrendingUp, title: "TradingView fires", desc: "Our proprietary Renko + MTF strategy fires a webhook the moment a confluence setup forms across 4 timeframes." },
              { icon: Brain, title: "AI validates", desc: "Claude AI cross-checks the signal against news sentiment and market data, scoring confluence before it posts." },
              { icon: Shield, title: "Discord delivers", desc: "The signal routes to your tier's channel — entry, SL, TP1/2/3 — ready to trade or auto-copy to your broker." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="font-bold text-white">{title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="What You Get"
            title="Built for traders who don't want to babysit charts."
            sub="Every signal carries the full risk/reward picture — entry, stop, and three scaled-out targets — plus AI-generated context."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: TrendingUp, title: "Live Trade Signals", body: "Real-time alerts with entry, SL, TP1/TP2/TP3, posted to Discord 24/5. Symbol auto-routes to the right channel." },
              { icon: Brain, title: "AI Confluence Score", body: "Each signal is graded by AI on news sentiment, technical alignment, and multi-timeframe trend before it reaches you." },
              { icon: Bell, title: "AI Pre-Market Brief", body: "Daily 8 AM EST report: market pulse, watchlist bias, AI narrative, and the high-impact economic calendar." },
              { icon: Bot, title: "Auto-Copy to Broker", body: "Optional hands-free MT4/MT5 execution via PineConnector / SignalStart. Set your lot size and walk away." },
              { icon: BarChart3, title: "Multi-Asset Coverage", body: "Forex pairs, gold & silver, S&P / NAS / DOW indices, and major crypto — all from one strategy framework." },
              { icon: Target, title: "Proprietary Edge", body: "Renko-based strategy with EMA, RSI, and 4-timeframe confluence filtering for sharper, higher-conviction entries." },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-emerald-500/30 transition-colors">
                <Icon className="w-6 h-6 text-emerald-400 mb-3" />
                <h3 className="font-bold text-base mb-2">{title}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BONUS TOOLS — SCREENER + SMART INVESTOR */}
      <section className="px-6 py-20 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="More Than Signals"
            title="Two edge-finding tools, included."
            sub="Beyond live alerts, members get our proprietary screeners — so you can hunt setups yourself, not just wait for them."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Smart Pullback Screener */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-emerald-500/30 transition-colors">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Smart Pullback Screener</h3>
                  <p className="text-xs text-zinc-500">Daily S&amp;P 500 + options scans</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-4 leading-relaxed">
                Every day we scan the S&amp;P 500 for high-probability pullback setups — EMA(34) trend
                with an ATR Chandelier exit — ranked by historical profit factor and win rate.
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-400">
                {["Live pullback signals (LONG / SHORT), freshness-tagged", "Options screener — trend, PF, WR by sector", "Ranked by profit factor × win rate", "Top setups posted to Discord"].map(f => (
                  <li key={f} className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> {f}</li>
                ))}
              </ul>
            </div>

            {/* Smart Investor */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-sky-500/30 transition-colors">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-sky-500/10 flex items-center justify-center">
                  <LineChart className="w-5 h-5 text-sky-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Smart Investor Alerts</h3>
                  <p className="text-xs text-zinc-500">Buy-side levels on large caps</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-4 leading-relaxed">
                Longer-horizon "levels of interest" on blue-chip stocks — flagged when price reaches
                a technically meaningful zone, then cross-checked by our AI for confluence.
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-400">
                {["RSI-oversold + moving-average pullbacks", "52-week drawdowns + repeat support zones", "AI reads news + market data on each alert", "Full breakdown: triggers, trend, earnings"].map(f => (
                  <li key={f} className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> {f}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Pricing"
            title="Subscribe to your market."
            sub="Pick one category or get everything. Cancel any time through Discord — payments handled securely by Discord Monetize."
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {tiers.map(tier => <TierCard key={tier.name} tier={tier} />)}
          </div>
        </div>
      </section>

      {/* DIY — INDICATOR / STRATEGY */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="DIY Option"
            title="Prefer to run it yourself? Get the Indicator or the Strategy."
            sub="The same proprietary edge that powers our signals — usable on your own TradingView charts. Indicator for manual trading, Strategy for automation + backtesting."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-emerald-500/30 transition-colors">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                  <LineChart className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Indicator</h3>
                  <p className="text-xs text-zinc-500">For manual & discretionary traders</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-4 leading-relaxed">
                Plot signals, SL, TP1/TP2/TP3, trend bands, and the multi-timeframe dashboard directly on your chart. Set custom alerts and trade by hand.
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-400 mb-5">
                {["Live signal markers + TP/SL levels", "4-timeframe confluence dashboard", "Custom TradingView alerts with full JSON", "Works on a free TradingView account"].map(f => (
                  <li key={f} className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> {f}</li>
                ))}
              </ul>
              <div className="flex items-end gap-2">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-white">$25</span>
                    <span className="text-zinc-500 text-xs">/mo</span>
                    <span className="text-zinc-500 text-xs line-through">$50</span>
                  </div>
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mt-0.5">50% off · pre-launch</p>
                </div>
                <a href="#signup" className="ml-auto inline-flex items-center gap-1 text-emerald-400 font-semibold text-xs hover:text-emerald-300">
                  Request access <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="relative bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-2 border-emerald-500/40 rounded-2xl p-6 hover:border-emerald-500/60 transition-colors">
              <div className="absolute -top-3 left-6 bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded">
                Backtest + Auto
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-teal-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Strategy</h3>
                  <p className="text-xs text-zinc-500">For automated traders & backtesters</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-4 leading-relaxed">
                The same engine as a Pine Strategy. Run full equity-curve backtests, see win-rate / drawdown / PF, and connect to your broker for hands-free execution.
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-400 mb-5">
                {["Full TradingView Strategy Tester report", "Configurable position sizing & partial TPs", "Auto-trade via PineConnector / 3Commas", "Session & confluence filters built-in"].map(f => (
                  <li key={f} className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> {f}</li>
                ))}
              </ul>
              <div className="flex items-end gap-2">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-white">$50</span>
                    <span className="text-zinc-500 text-xs">/mo</span>
                    <span className="text-zinc-500 text-xs line-through">$100</span>
                  </div>
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mt-0.5">50% off · pre-launch</p>
                </div>
                <a href="#signup" className="ml-auto inline-flex items-center gap-1 text-teal-400 font-semibold text-xs hover:text-teal-300">
                  Request access <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
          <div className="mt-6 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-xs text-zinc-400">
              <strong className="text-zinc-200">Not sure which?</strong> Pick the <span className="text-emerald-400 font-semibold">Indicator</span> for manual trading with chart visuals + alerts,
              the <span className="text-teal-400 font-semibold">Strategy</span> for backtests + automation, or just <span className="text-emerald-400 font-semibold">subscribe to Signals</span> in Discord and let us do the heavy lifting.
            </p>
          </div>
        </div>
      </section>

      {/* FINAL CTA + WAITLIST */}
      <section id="signup" className="px-6 py-20 bg-gradient-to-br from-emerald-500/10 via-zinc-950 to-teal-500/10">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-semibold mb-6">
            <Clock className="w-3 h-3" /> Founding-member pricing ends at launch
          </div>
          <div className="mb-8"><CountdownTimer /></div>
          <h2 className="text-3xl sm:text-4xl font-extrabold leading-tight mb-4">
            Join the Discord now, or reserve founding-member pricing.
          </h2>
          <p className="text-zinc-400 text-base mb-8">
            Signals are already live in Discord. Not ready yet? Drop your email to lock in <strong className="text-emerald-400">50% off for life</strong> — only the first 100 founding members.
          </p>
          <div className="max-w-md mx-auto">
            <div className="mb-4 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
              <SpotsRemainingBar />
            </div>
            <SignupForm source="landing-bottom" />
            <div className="mt-4">
              <a href={DISCORD_INVITE} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-400 hover:text-emerald-300">
                …or skip the wait and join Discord now <ChevronRight className="w-4 h-4" />
              </a>
            </div>
          </div>
          <div className="flex items-center justify-center gap-1 mt-8">
            {[1, 2, 3, 4, 5].map(i => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
            <span className="text-xs text-zinc-500 ml-2">Loved by early-access traders</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <SectionHeading eyebrow="FAQ" title="Common questions" />
          <div>
            {[
              { q: "Do I need a TradingView subscription?", a: "No. You receive the signals in Discord. TradingView is only required if you also want to run the Indicator or Strategy on your own charts." },
              { q: "How are these signals different?", a: "Every signal carries entry + SL + 3 scaled TPs and is AI-validated against news sentiment and multi-timeframe trend before posting. You see the confluence score on every alert." },
              { q: "Can I cancel anytime?", a: "Yes — all tiers are month-to-month via Discord Monetize. Cancel from your Discord subscriptions page whenever you like." },
              { q: "Do I just get signals, or analysis too?", a: "Both. Paid tiers include live trade analysis inside Discord — chart breakdowns, daily recaps, and post-trade reviews so you learn the why behind each setup." },
              { q: "What if signals don't perform?", a: "We post the full record — wins and losses both visible. The strategy is backtested across multiple timeframes and live-tracked in the dashboard." },
              { q: "When is the public launch?", a: "Signals are already live for members. Public launch and full pricing take effect August 1, 2026 — founding members lock in 50% off for life before then." },
            ].map(f => <FaqItem key={f.q} {...f} />)}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-zinc-800 px-6 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span className="text-sm text-zinc-400">© MarketEdgePro · Live Signal Hub</span>
          </div>
          <p className="text-[10px] text-zinc-600 max-w-md text-right">
            Trading involves substantial risk. Past performance does not guarantee future results. Signals are educational, not financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
