import { TrendingUp, Shield, Zap, Check, ChevronRight, Activity } from "lucide-react";

const DISCORD_INVITE = "https://discord.gg/h7qvbPjAV";

const tiers = [
  {
    name: "Free Preview",
    price: "$0",
    period: "",
    description: "See that signals are firing. No entry details.",
    color: "border-zinc-700",
    badge: "",
    features: [
      "Symbol + direction alerts",
      "Access to #free-preview channel",
      "No SL/TP details",
    ],
    cta: "Join Free",
    ctaStyle: "bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-600",
  },
  {
    name: "Currency Signals",
    price: "$10",
    period: "/month",
    description: "Full Forex pair signals with entry, SL, and up to 3 take profits.",
    color: "border-blue-500/50",
    badge: "",
    features: [
      "All Forex pair signals (EUR/USD, GBP/JPY…)",
      "Entry price, Stop Loss, TP1 / TP2 / TP3",
      "EMA, RSI, Renko & MTF confluence data",
      "Morning market brief",
    ],
    cta: "Subscribe",
    ctaStyle: "bg-blue-600 hover:bg-blue-500 text-white",
  },
  {
    name: "Metals Signals",
    price: "$10",
    period: "/month",
    description: "Gold, Silver and Platinum signals — full detail.",
    color: "border-yellow-500/50",
    badge: "",
    features: [
      "XAUUSD, XAGUSD, XPTUSD signals",
      "Entry price, Stop Loss, TP1 / TP2 / TP3",
      "EMA, RSI, Renko & MTF confluence data",
      "Morning market brief",
    ],
    cta: "Subscribe",
    ctaStyle: "bg-yellow-600 hover:bg-yellow-500 text-white",
  },
  {
    name: "Indices Signals",
    price: "$20",
    period: "/month",
    description: "US30, NAS100, SPX500 and major global indices.",
    color: "border-purple-500/50",
    badge: "",
    features: [
      "US30, NAS100, SPX500, UK100, DE40 & more",
      "Entry price, Stop Loss, TP1 / TP2 / TP3",
      "EMA, RSI, Renko & MTF confluence data",
      "Morning market brief",
    ],
    cta: "Subscribe",
    ctaStyle: "bg-purple-600 hover:bg-purple-500 text-white",
  },
  {
    name: "All Signals",
    price: "$30",
    period: "/month",
    description: "Every signal we post. Currencies + Metals + Indices in one tier.",
    color: "border-emerald-500",
    badge: "Best Value",
    features: [
      "Everything in Currency + Metals + Indices",
      "Currencies, Metals & Indices — all covered",
      "Entry price, Stop Loss, TP1 / TP2 / TP3",
      "Priority morning market brief",
    ],
    cta: "Best Deal →",
    ctaStyle: "bg-emerald-600 hover:bg-emerald-500 text-white font-bold",
  },
  {
    name: "Signal Copier",
    price: "$50",
    period: "/month",
    description: "Signals auto-copied directly to your MT4/MT5 account. Hands-free trading.",
    color: "border-amber-500/50",
    badge: "Coming Soon",
    features: [
      "All Signals tier included",
      "Auto-copy to MetaTrader 4 or 5",
      "Lot size & risk management settings",
      "Priority support",
    ],
    cta: "Notify Me",
    ctaStyle: "bg-amber-600 hover:bg-amber-500 text-white",
    comingSoon: true,
  },
];

function TierCard({ tier }: { tier: typeof tiers[0] }) {
  return (
    <div className={`relative flex flex-col bg-zinc-900 border-2 ${tier.color} rounded-2xl p-6 transition-transform hover:-translate-y-1`}>
      {tier.badge && (
        <span className={`absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full ${
          tier.badge === "Best Value" ? "bg-emerald-500 text-white" : "bg-amber-500 text-black"
        }`}>
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
            <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      {tier.comingSoon ? (
        <button disabled className="w-full py-2.5 rounded-lg text-sm font-semibold bg-zinc-700 text-zinc-500 cursor-not-allowed">
          Coming Soon
        </button>
      ) : (
        <a
          href={DISCORD_INVITE}
          target="_blank"
          rel="noreferrer"
          className={`w-full py-2.5 rounded-lg text-sm text-center block transition-colors ${tier.ctaStyle}`}
        >
          {tier.cta}
        </a>
      )}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Nav */}
      <nav className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="font-bold text-white">MarketEdgePro</span>
        </div>
        <a
          href={DISCORD_INVITE}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 transition-colors text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          Join Discord <ChevronRight className="w-4 h-4" />
        </a>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center px-6 py-24">
        <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live signals — Predictive Ranges v5
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          Precision trading signals<br />
          <span className="text-emerald-400">delivered to Discord</span>
        </h1>
        <p className="text-zinc-400 text-xl max-w-2xl mx-auto mb-10">
          TradingView-powered signals with full entry, Stop Loss, and Take Profit levels.
          Currencies, Metals, and Indices — pick your market.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={DISCORD_INVITE}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 transition-colors text-white font-bold px-8 py-4 rounded-xl text-lg"
          >
            Join the Discord
            <ChevronRight className="w-5 h-5" />
          </a>
          <a href="#pricing" className="text-zinc-400 hover:text-white transition-colors font-medium">
            See pricing ↓
          </a>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-8">
        {[
          { icon: TrendingUp, title: "TradingView fires", desc: "Our Predictive Ranges v5 strategy fires a webhook the moment a confluence setup forms." },
          { icon: Activity, title: "AI validates", desc: "Claude AI cross-checks the signal against news sentiment and market data before posting." },
          { icon: Shield, title: "Discord delivers", desc: "You get the signal in your tier's channel — entry, SL, TP1/2/3 — ready to trade." },
        ].map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Icon className="w-6 h-6 text-emerald-400" />
            </div>
            <h3 className="font-bold text-white">{title}</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">{desc}</p>
          </div>
        ))}
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-extrabold mb-3">Simple, transparent pricing</h2>
          <p className="text-zinc-400">Subscribe to your market. Cancel any time through Discord.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {tiers.map(tier => <TierCard key={tier.name} tier={tier} />)}
        </div>
        <p className="text-center text-zinc-600 text-sm mt-8">
          Payments handled securely by Discord Monetize. No external sign-up required.
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-800 mt-16 px-6 py-8 text-center text-zinc-600 text-sm">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span className="font-semibold text-zinc-400">MarketEdgePro</span>
        </div>
        <p>Signals are for educational purposes. Trading involves risk. Past performance does not guarantee future results.</p>
      </footer>
    </div>
  );
}
