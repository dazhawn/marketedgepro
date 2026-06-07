import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TrendingUp, Activity, Bell, Mail, Phone, ArrowRight, Sparkles } from "lucide-react";

export default function IntroPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const join = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/waitlist", {
        email: email.trim(),
        phone: phone.trim() || undefined,
        source: "intro",
      });
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "You're on the list!", description: "We'll text or email you the moment we launch." });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't sign you up", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-16">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-12">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold">MarketEdgePro</h2>
            <p className="text-xs text-zinc-500 uppercase tracking-wider">Signal Hub</p>
          </div>
        </div>

        {/* Hero */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-medium mb-4">
            <Sparkles className="w-3 h-3" />
            Coming Soon — Early Access
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-4">
            AI-validated forex, metals, indices & crypto signals — delivered straight to Discord and your broker.
          </h1>
          <p className="text-zinc-400 text-lg leading-relaxed">
            We pair the <span className="text-white font-medium">Predictive Ranges v5</span> strategy with AI confluence
            scoring and a pre-market AI brief. Join the waitlist for launch access and early-bird pricing.
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
          {[
            { icon: TrendingUp, title: "Live Signals", body: "Real-time entries with SL + 3 TPs, posted to Discord 24/5." },
            { icon: Bell,       title: "AI Pre-Market", body: "Daily 8am EST brief with confluence scores per symbol." },
            { icon: Activity,   title: "Auto-Copy",     body: "Hands-free MT4/MT5 copy via SignalStart / MyFXBook." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
              <Icon className="w-5 h-5 text-blue-400 mb-2" />
              <h3 className="font-semibold text-sm mb-1">{title}</h3>
              <p className="text-xs text-zinc-500">{body}</p>
            </div>
          ))}
        </div>

        {/* Signup */}
        {submitted ? (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold mb-1">You're on the list! 🎉</h2>
            <p className="text-zinc-400 text-sm">We'll reach out the moment early access opens.</p>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-bold mb-1">Join the waitlist</h2>
            <p className="text-xs text-zinc-500 mb-4">Phone is optional — we'll text only for launch updates.</p>
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
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="relative">
                <Phone className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 555 123 4567  (optional)"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={join.isPending || !email.trim()}
                className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"
              >
                {join.isPending ? "Adding you…" : <>Get Early Access <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-[10px] text-zinc-600 text-center">No spam. Unsubscribe anytime.</p>
            </form>
          </div>
        )}

        <p className="text-center text-zinc-600 text-xs mt-8">
          Predictive Ranges v5 · Live · © MarketEdgePro
        </p>
      </div>
    </div>
  );
}
