import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, TrendingUp, Bell, Zap, Shield, Brain, Sparkles,
  Mail, Phone, ArrowRight, Check, Clock, ChevronDown, Star, BarChart3, Bot, Target,
  LineChart, Wrench, ExternalLink, Copy,
} from "lucide-react";

// ─── Countdown Timer to public launch ───
const LAUNCH_DATE = new Date("2026-08-01T00:00:00-04:00"); // Aug 1 2026, midnight EST

function useCountdown(target: Date) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours   = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);
  return { days, hours, minutes, seconds, done: diff === 0 };
}

function CountdownTimer() {
  const { days, hours, minutes, seconds, done } = useCountdown(LAUNCH_DATE);
  if (done) {
    return (
      <div className="inline-block bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 px-4 py-2 rounded-lg text-sm font-bold">
        🚀 We're live! Join now →
      </div>
    );
  }
  const cells = [
    { label: "DAYS",    value: days },
    { label: "HOURS",   value: hours },
    { label: "MINUTES", value: minutes },
    { label: "SECONDS", value: seconds },
  ];
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-zinc-500 mb-3 text-center">
        🚀 Public Launch · August 1, 2026
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

// ─── Waitlist signup form (reused at top + bottom of page) ───
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
    <form
      onSubmit={(e) => { e.preventDefault(); if (email.trim()) join.mutate(); }}
      className="space-y-3"
    >
      <div className="relative">
        <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-3 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="relative">
        <Phone className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 123 4567  (optional — for launch SMS)"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-3 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      <button
        type="submit"
        disabled={join.isPending || !email.trim()}
        className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg text-sm flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
      >
        {join.isPending ? "Adding you…" : <>Reserve Early Access <ArrowRight className="w-4 h-4" /></>}
      </button>
      <p className="text-[10px] text-zinc-600 text-center">No spam. Unsubscribe anytime. Phone used only for launch SMS.</p>
    </form>
  );
}

// ─── Live "spots remaining" counter ───
function useSpotsRemaining() {
  return useQuery<{ total: number; max: number; remaining: number }>({
    queryKey: ["/api/waitlist/count"],
    refetchInterval: 30000, // refresh every 30s so the page feels alive
    staleTime: 15000,
  });
}

function SpotsRemainingBar({ compact = false }: { compact?: boolean }) {
  const { data } = useSpotsRemaining();
  const total     = data?.total ?? 0;
  const max       = data?.max ?? 100;
  const remaining = data?.remaining ?? max;
  const pct       = Math.min(100, Math.round((total / max) * 100));
  const isHot     = remaining <= 25;
  const isLast    = remaining <= 10;

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${isLast ? "text-rose-300" : isHot ? "text-amber-300" : "text-emerald-300"}`}>
        <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${isLast ? "bg-rose-400" : isHot ? "bg-amber-400" : "bg-emerald-400"}`} />
        {remaining} / {max} spots left
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-bold ${isLast ? "text-rose-300" : isHot ? "text-amber-300" : "text-emerald-300"}`}>
          {remaining === 0 ? "Waitlist is FULL" : `${remaining} founding spots remaining`}
        </span>
        <span className="text-zinc-500 font-mono tabular-nums">{total} / {max}</span>
      </div>
      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${isLast ? "bg-gradient-to-r from-rose-500 to-red-500" : isHot ? "bg-gradient-to-r from-amber-500 to-orange-500" : "bg-gradient-to-r from-emerald-500 to-blue-500"}`}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Reusable section heading ───
function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="text-center max-w-2xl mx-auto mb-12">
      <div className="inline-block text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">{eyebrow}</div>
      <h2 className="text-3xl sm:text-4xl font-bold leading-tight mb-3">{title}</h2>
      {sub && <p className="text-zinc-400 text-base leading-relaxed">{sub}</p>}
    </div>
  );
}

// ─── FAQ accordion item ───
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-800">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 text-left hover:text-blue-400 transition-colors"
      >
        <span className="font-medium text-sm">{q}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <p className="text-zinc-400 text-sm pb-4 leading-relaxed">{a}</p>}
    </div>
  );
}

export default function IntroPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">

      {/* ═══════════ NAV ═══════════ */}
      <nav className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-none">MarketEdgePro</h2>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Signal Hub</p>
            </div>
          </div>
          <a
            href="#signup"
            className="text-xs font-semibold bg-blue-500 hover:bg-blue-400 text-white px-3 py-1.5 rounded-lg"
          >
            Join Waitlist
          </a>
        </div>
      </nav>

      {/* ═══════════ HERO ═══════════ */}
      <section className="px-6 py-20 sm:py-28 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-purple-500/10 pointer-events-none" />
        <div className="max-w-4xl mx-auto relative">
          <div className="text-center">
            <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
              <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-semibold">
                <Sparkles className="w-3 h-3" />
                EARLY ACCESS — FOUNDING MEMBER
              </div>
              <div className="inline-flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 px-3 py-1 rounded-full">
                <SpotsRemainingBar compact />
              </div>
            </div>
            <div className="mb-8">
              <CountdownTimer />
            </div>
            <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight mb-6">
              AI-validated trading signals.<br />
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Straight to Discord and your broker.
              </span>
            </h1>
            <p className="text-zinc-400 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-8">
              Forex, metals, indices, and crypto signals from our <strong className="text-white">proprietary multi-timeframe</strong> strategy —
              pre-validated by AI confluence scoring, delivered with full SL + 3 TPs, and auto-copyable to your MT4/MT5 account.
            </p>
            <div className="max-w-md mx-auto" id="signup-hero">
              <SignupForm source="intro-hero" />
            </div>
            <div className="flex items-center justify-center gap-6 mt-8 text-xs text-zinc-500">
              <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-emerald-400" /> No credit card</div>
              <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-emerald-400" /> Cancel anytime</div>
              <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-emerald-400" /> Early-bird pricing</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════ STATS / SOCIAL PROOF STRIP ═══════════ */}
      <section className="border-y border-zinc-800 bg-zinc-900/50">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { v: "24/5", l: "Coverage" },
            { v: "4", l: "Asset Classes" },
            { v: "10+", l: "Watchlist Symbols" },
            { v: "8 AM EST", l: "Daily AI Brief" },
          ].map(({ v, l }) => (
            <div key={l}>
              <div className="text-2xl sm:text-3xl font-extrabold text-white">{v}</div>
              <div className="text-xs text-zinc-500 mt-1 uppercase tracking-wider">{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════════ PROBLEM / SOLUTION ═══════════ */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="text-red-400 text-xs font-semibold uppercase tracking-widest mb-3">The Problem</div>
            <h2 className="text-3xl font-bold leading-tight mb-4">Most signal services blast alerts and hope you catch one.</h2>
            <ul className="space-y-3 text-zinc-400 text-sm leading-relaxed">
              <li className="flex gap-3"><span className="text-red-400 mt-0.5">✕</span> No risk management — no SL, no TP levels</li>
              <li className="flex gap-3"><span className="text-red-400 mt-0.5">✕</span> No context on news, fundamentals, or higher-timeframe trend</li>
              <li className="flex gap-3"><span className="text-red-400 mt-0.5">✕</span> You're glued to your phone, manually copying into MT4</li>
              <li className="flex gap-3"><span className="text-red-400 mt-0.5">✕</span> Random win rates, zero accountability</li>
            </ul>
          </div>
          <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-2xl p-6">
            <div className="text-emerald-400 text-xs font-semibold uppercase tracking-widest mb-3">The MarketEdgePro Way</div>
            <h3 className="text-xl font-bold mb-4">Every signal is AI-validated before it's sent.</h3>
            <ul className="space-y-3 text-zinc-300 text-sm leading-relaxed">
              <li className="flex gap-3"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Full entry + SL + 3 take-profit levels</li>
              <li className="flex gap-3"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> AI cross-checks news + technicals before posting</li>
              <li className="flex gap-3"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Auto-copy to MT4/MT5 via SignalStart / MyFXBook</li>
              <li className="flex gap-3"><Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> Pre-market brief at 8 AM EST every weekday</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ═══════════ FEATURES ═══════════ */}
      <section className="px-6 py-20 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="What You Get"
            title="Built for traders who don't want to babysit charts."
            sub="Every signal carries the full risk/reward picture — entry, stop, and three scaled-out targets — plus AI-generated context."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { icon: TrendingUp, title: "Live Trade Signals", body: "Real-time alerts with entry, SL, TP1/TP2/TP3, posted to Discord 24/5. Symbol routes automatically to the right channel.", color: "text-blue-400" },
              { icon: Brain,      title: "AI Confluence Score", body: "Each signal is graded 1–10 by AI on news sentiment, technical alignment, and multi-timeframe trend before it reaches you.", color: "text-purple-400" },
              { icon: Bell,       title: "AI Pre-Market Brief", body: "Daily 8 AM EST report: market pulse, watchlist bias, AI narrative, and high-impact economic calendar.", color: "text-amber-400" },
              { icon: Bot,        title: "Auto-Copy to Broker", body: "Hands-free MT4/MT5 execution through SignalStart or MyFXBook. Set your lot size and walk away.", color: "text-emerald-400" },
              { icon: BarChart3,  title: "Multi-Asset Coverage", body: "Forex pairs, gold & silver, S&P / NAS / DOW indices, and major crypto — all from one strategy framework.", color: "text-pink-400" },
              { icon: Target,     title: "Proprietary Edge", body: "Renko-based strategy with EMA, RSI, and 4-timeframe confluence filtering for sharper, higher-conviction entries.", color: "text-cyan-400" },
            ].map(({ icon: Icon, title, body, color }) => (
              <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors">
                <Icon className={`w-6 h-6 ${color} mb-3`} />
                <h3 className="font-bold text-base mb-2">{title}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ HOW IT WORKS ═══════════ */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <SectionHeading
            eyebrow="How It Works"
            title="From chart pattern to your broker — in seconds."
          />
          <div className="space-y-6">
            {[
              { n: "1", t: "Pattern fires on TradingView", b: "Our proprietary indicator detects a confluence setup across 4 timeframes." },
              { n: "2", t: "AI validates the signal",     b: "DeepSeek V4 Pro cross-checks news sentiment, market data, and technical context. Signals scoring below threshold are filtered out." },
              { n: "3", t: "Posted to your Discord",      b: "Symbol auto-routes to the right channel — forex, metals, indices, or crypto. Free tier sees teasers; paid tiers see full SL/TP." },
              { n: "4", t: "Auto-executed on your broker", b: "Signal Copier subscribers get the trade copied into their MT4/MT5 account via SignalStart or MyFXBook. Zero clicks." },
            ].map(({ n, t, b }) => (
              <div key={n} className="flex gap-4">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold shrink-0">{n}</div>
                <div>
                  <h3 className="font-bold text-base mb-1">{t}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ TIER PREVIEW ═══════════ */}
      <section className="px-6 py-20 bg-zinc-900/30">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="Founding-Member Pricing"
            title="Pick the tier that fits how you trade."
            sub="Founding members lock in 50% off for life. Only 100 launch spots available — once they're gone, pricing returns to full and the waitlist reopens later."
          />

          {/* Scarcity strip with live counter */}
          <div className="mb-8 bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-amber-500/10 border border-amber-500/30 rounded-xl p-5">
            <div className="text-center mb-4">
              <div className="inline-flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Sparkles className="w-4 h-4" />
                FOUNDING-MEMBER OFFER — 100 SPOTS ONLY · 50% OFF FOR LIFE
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Once 100 founding spots fill up, the waitlist closes until we open the next batch.
                Sign up below to claim your spot before <strong className="text-white">August 1, 2026</strong>.
              </p>
            </div>
            <div className="max-w-xl mx-auto">
              <SpotsRemainingBar />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                name: "Single Category",
                price: "$5", strike: "$10",
                emphasis: false,
                features: ["One of: Forex / Metals / Indices / Crypto", "Full entry, SL & TPs", "Discord channel access", "Upgrade anytime"],
              },
              {
                name: "All Signals",
                price: "$15", strike: "$30",
                emphasis: false,
                features: ["Forex + Metals + Indices + Crypto", "Full entry, SL & TPs", "Daily AI pre-market brief", "All Discord channels"],
              },
              {
                name: "Signal Copier",
                price: "$25", strike: "$50",
                emphasis: true,
                features: ["Everything in All Signals", "Auto-copy MT4/MT5 via SignalStart/MyFXBook", "Risk management settings", "Priority support"],
              },
            ].map(t => (
              <div
                key={t.name}
                className={`rounded-xl p-5 relative ${t.emphasis ? "bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-2 border-blue-500" : "bg-zinc-900 border border-zinc-800"}`}
              >
                {t.emphasis && (
                  <div className="inline-block bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded mb-2">
                    Most Popular
                  </div>
                )}
                <h3 className="text-lg font-bold">{t.name}</h3>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-extrabold">{t.price}</span>
                  <span className="text-zinc-500 text-sm">/mo</span>
                  <span className="text-zinc-500 text-sm line-through">{t.strike}</span>
                </div>
                <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mb-4 mt-0.5">
                  50% OFF · Founding member
                </p>
                <ul className="space-y-2">
                  {t.features.map(f => (
                    <li key={f} className="flex gap-2 text-xs text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-zinc-500 mt-6 max-w-2xl mx-auto">
            We may run occasional promotions later, but <strong className="text-zinc-300">this founding-member offer is our biggest discount —
            50% off, locked in for life, only for the first 100 members.</strong>
          </p>
        </div>
      </section>

      {/* ═══════════ DIY — USE THE INDICATOR / STRATEGY YOURSELF ═══════════ */}
      <section className="px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="DIY Option"
            title="Prefer to run it yourself? Get the Indicator or the Strategy."
            sub="Same proprietary edge that powers our signals — now usable on your own TradingView charts. Choose the Indicator for manual trading or the Strategy for automation + backtesting."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* ── Indicator card ── */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-blue-500/30 transition-colors">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <LineChart className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Indicator</h3>
                  <p className="text-xs text-zinc-500">For manual & discretionary traders</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-4 leading-relaxed">
                Plot signals, SL, TP1/TP2/TP3, trend bands, and multi-timeframe dashboard directly
                on your TradingView chart. Set custom alerts and trade by hand.
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-400 mb-5">
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> Live signal markers + TP/SL levels</li>
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> 4-timeframe confluence dashboard</li>
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> Custom TradingView alerts with full JSON</li>
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> Works on free TradingView account</li>
              </ul>
              <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg p-3 text-xs space-y-1.5 mb-4">
                <p className="font-semibold text-blue-400 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" /> Setup (5 minutes)
                </p>
                <ol className="space-y-1 text-zinc-400 list-decimal pl-4">
                  <li>Open the invite link we send and add the indicator to your TradingView account</li>
                  <li>Apply it to any symbol → adjust the MTF inputs to taste</li>
                  <li>Right-click chart → Add Alert → select the firing condition</li>
                  <li>Paste our webhook URL + message template (provided)</li>
                </ol>
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-white">$25</span>
                    <span className="text-zinc-500 text-xs">/mo</span>
                    <span className="text-zinc-500 text-xs line-through">$50</span>
                  </div>
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mt-0.5">
                    50% OFF · pre-launch
                  </p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 text-blue-400 font-semibold text-xs cursor-pointer hover:text-blue-300">
                  Request access <ExternalLink className="w-3 h-3" />
                </span>
              </div>
            </div>

            {/* ── Strategy card ── */}
            <div className="relative bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-2 border-purple-500/40 rounded-2xl p-6 hover:border-purple-500/60 transition-colors">
              <div className="absolute -top-3 left-6 bg-purple-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded">
                Backtest + Auto
              </div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold">Strategy</h3>
                  <p className="text-xs text-zinc-500">For automated traders & backtesters</p>
                </div>
              </div>
              <p className="text-sm text-zinc-300 mb-4 leading-relaxed">
                The same engine packaged as a Pine Strategy. Run full equity-curve backtests,
                see win-rate / drawdown / PF, and connect to your broker for hands-free execution.
              </p>
              <ul className="space-y-1.5 text-xs text-zinc-400 mb-5">
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> Full TradingView Strategy Tester report</li>
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> Configurable position sizing & partial TPs</li>
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> Auto-trade via PineConnector / 3Commas / Broker API</li>
                <li className="flex gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> Session & confluence filters built-in</li>
              </ul>
              <div className="bg-zinc-900/60 border border-zinc-700/50 rounded-lg p-3 text-xs space-y-1.5 mb-4">
                <p className="font-semibold text-purple-400 flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" /> Setup (10 minutes)
                </p>
                <ol className="space-y-1 text-zinc-400 list-decimal pl-4">
                  <li>Open the invite link → add the strategy to your TradingView account</li>
                  <li>Apply to a chart → review the backtest results in the Strategy Tester</li>
                  <li>Tune entry mode, TP sizes, sessions, and risk settings to your taste</li>
                  <li>Set a "strategy" alert with our webhook URL → live execution starts</li>
                </ol>
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-extrabold text-white">$50</span>
                    <span className="text-zinc-500 text-xs">/mo</span>
                    <span className="text-zinc-500 text-xs line-through">$100</span>
                  </div>
                  <p className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider mt-0.5">
                    50% OFF · pre-launch
                  </p>
                </div>
                <span className="ml-auto inline-flex items-center gap-1 text-purple-400 font-semibold text-xs cursor-pointer hover:text-purple-300">
                  Request access <ExternalLink className="w-3 h-3" />
                </span>
              </div>
            </div>
          </div>

          {/* ── Early-bird banner ── */}
          <div className="mt-6 bg-gradient-to-r from-amber-500/10 via-emerald-500/10 to-blue-500/10 border border-amber-500/30 rounded-xl p-4 text-center">
            <div className="inline-flex items-center gap-2 text-amber-400 font-bold text-sm mb-1">
              <Sparkles className="w-4 h-4" />
              LIMITED-TIME PRE-LAUNCH OFFER
            </div>
            <p className="text-sm text-zinc-200">
              Sign up before <strong className="text-white">August 1, 2026</strong> and lock in
              <strong className="text-emerald-400"> 50% off for life</strong> on the Indicator and Strategy.
              After launch, prices return to <span className="line-through text-zinc-500">$50</span> $100/mo.
            </p>
          </div>

          {/* ── Quick comparison note ── */}
          <div className="mt-8 bg-zinc-900/50 border border-zinc-800 rounded-xl p-4 text-center">
            <p className="text-xs text-zinc-400">
              <strong className="text-zinc-200">Not sure which?</strong> Pick the <span className="text-blue-400 font-semibold">Indicator</span> if you trade manually
              and want chart visuals + alerts. Pick the <span className="text-purple-400 font-semibold">Strategy</span> if you want backtests + automation.
              Or just grab the <span className="text-amber-400 font-semibold">Signal Copier</span> above and skip the setup entirely.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════ FAQ ═══════════ */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <SectionHeading eyebrow="FAQ" title="Common questions" />
          <div>
            {[
              { q: "When does it launch?",
                a: "Soft launch is rolling — waitlist members get first access. Public launch shortly after. We'll text/email you the exact date." },
              { q: "What brokers does the copier support?",
                a: "Any MT4 or MT5 broker connected through SignalStart or MyFXBook. You control lot size, max risk, and which signals to copy from your dashboard there." },
              { q: "Do I need a TradingView subscription?",
                a: "No. You receive the signals in Discord. TradingView is only required if you also want to run the indicator on your own charts." },
              { q: "How are signals different from other services?",
                a: "Every signal carries entry + SL + 3 scaled TPs and is AI-validated against news sentiment and multi-timeframe trend before posting. You see the AI confidence score on every alert." },
              { q: "Can I cancel anytime?",
                a: "Yes — all tiers are month-to-month via Discord Monetize. Cancel from your Discord subscriptions page." },
              { q: "What if signals don't perform?",
                a: "We post the full record in the History channel — wins and losses both visible. Strategy is back-tested across multiple timeframes and live-tracked in the dashboard." },
            ].map(f => <FaqItem key={f.q} {...f} />)}
          </div>
        </div>
      </section>

      {/* ═══════════ FINAL CTA ═══════════ */}
      <section id="signup" className="px-6 py-20 bg-gradient-to-br from-blue-500/10 via-zinc-950 to-purple-500/10">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-semibold mb-4">
            <Clock className="w-3 h-3" />
            EARLY-BIRD PRICING ENDS AT LAUNCH
          </div>
          <h2 className="text-3xl sm:text-5xl font-extrabold leading-tight mb-4">
            Reserve your spot.<br />Trade smarter when we go live.
          </h2>
          <p className="text-zinc-400 text-base mb-8">
            Drop your email below. We'll send launch details, early-bird pricing, and a free pre-launch sample brief.
          </p>
          <div className="max-w-md mx-auto">
            <div className="mb-4 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
              <SpotsRemainingBar />
            </div>
            <SignupForm source="intro-bottom" />
          </div>
          <div className="flex items-center justify-center gap-1 mt-6">
            {[1,2,3,4,5].map(i => <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />)}
            <span className="text-xs text-zinc-500 ml-2">Loved by early-access traders</span>
          </div>
        </div>
      </section>

      {/* ═══════════ FOOTER ═══════════ */}
      <footer className="border-t border-zinc-800 px-6 py-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-zinc-400">© MarketEdgePro · Live Signal Hub</span>
          </div>
          <p className="text-[10px] text-zinc-600 max-w-md text-right">
            Trading involves substantial risk. Past performance does not guarantee future results.
            Signals are educational, not financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
