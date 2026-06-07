import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Activity, TrendingUp, Bell, Zap, Shield, Brain, Sparkles,
  Mail, Phone, ArrowRight, Check, Clock, ChevronDown, Star, BarChart3, Bot, Target,
} from "lucide-react";

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
            <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-semibold mb-6">
              <Sparkles className="w-3 h-3" />
              EARLY ACCESS — LIMITED LAUNCH SPOTS
            </div>
            <h1 className="text-4xl sm:text-6xl font-extrabold leading-tight mb-6">
              AI-validated trading signals.<br />
              <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Straight to Discord and your broker.
              </span>
            </h1>
            <p className="text-zinc-400 text-lg sm:text-xl leading-relaxed max-w-2xl mx-auto mb-8">
              Forex, metals, indices, and crypto signals from the <strong className="text-white">Predictive Ranges v5</strong> strategy —
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
              { icon: Target,     title: "Predictive Ranges v5", body: "Proprietary Renko-based strategy with EMA, RSI, and 4-timeframe confluence filtering for sharper entries.", color: "text-cyan-400" },
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
              { n: "1", t: "Pattern fires on TradingView", b: "Our Predictive Ranges v5 indicator detects an mtrend flip with confluence across 4 timeframes." },
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
            eyebrow="Launch Pricing"
            title="Pick the tier that fits how you trade."
            sub="Early-access pricing locked in for life — pricing goes up at public launch."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: "All Signals", price: "$30", emphasis: false, features: ["Forex + Metals + Indices + Crypto", "Full entry, SL & TPs", "Daily AI brief", "Discord access"] },
              { name: "Signal Copier", price: "$50", emphasis: true, features: ["Everything in All Signals", "Auto-copy MT4/MT5", "Risk management settings", "Priority support"] },
              { name: "Single Category", price: "$10", emphasis: false, features: ["One of: Forex / Metals / Crypto", "Full SL & TPs", "Discord channel access", "Upgrade anytime"] },
            ].map(t => (
              <div
                key={t.name}
                className={`rounded-xl p-5 ${t.emphasis ? "bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-2 border-blue-500" : "bg-zinc-900 border border-zinc-800"}`}
              >
                {t.emphasis && (
                  <div className="inline-block bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded mb-2">
                    Most Popular
                  </div>
                )}
                <h3 className="text-lg font-bold">{t.name}</h3>
                <div className="flex items-baseline gap-1 mb-4 mt-1">
                  <span className="text-3xl font-extrabold">{t.price}</span>
                  <span className="text-zinc-500 text-sm">/mo</span>
                </div>
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
            <span className="text-sm text-zinc-400">© MarketEdgePro · Predictive Ranges v5 · Live</span>
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
