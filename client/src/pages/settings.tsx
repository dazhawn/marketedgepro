import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Copy, Bell, MessageCircle, Smartphone, Radio, Zap, Brain, Sun, Loader2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";

function StatusRow({ label, active, description }: { label: string; active: boolean; description: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-zinc-800 last:border-0">
      {active
        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        : <XCircle className="w-4 h-4 text-zinc-600 shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${active ? "text-white" : "text-zinc-500"}`}>{label}</p>
        <p className="text-xs text-zinc-600">{description}</p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded border ${
        active ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-800 text-zinc-600 border-zinc-700"
      }`}>
        {active ? "Active" : "Not configured"}
      </span>
    </div>
  );
}

function EnvRow({ varName, description }: { varName: string; description: string }) {
  return (
    <div className="py-2 border-b border-zinc-800/50 last:border-0">
      <code className="text-xs text-amber-400 font-mono">{varName}</code>
      <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
    </div>
  );
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: notifs } = useQuery<{
    pushover: boolean;
    telegram: boolean;
    ntfy: boolean;
    signalCopier: boolean;
    aiProvider: string;
    aiModel: string;
    aiConfigured: boolean;
    discordBot: boolean;
    discordChannels: Record<string, boolean>;
  }>({ queryKey: ["/api/settings/notifications"] });

  const { data: webhookInfo } = useQuery<{ secret: string }>({
    queryKey: ["/api/signals/webhook-info"],
  });

  const morningBriefMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/morning-brief/trigger", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.sent) {
        toast({ title: "Morning brief sent", description: `${data.symbolCount} symbols · ${data.calendarEventCount} calendar events dispatched to Discord.` });
      } else {
        toast({ title: "Not sent", description: data.message ?? "Nothing to send.", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Failed", description: "Could not send morning brief.", variant: "destructive" }),
  });

  const testAlertMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/signals/test-alert", { symbol: "XAUUSD", action: "BUY" });
      return res.json();
    },
    onSuccess: () => toast({ title: "Test alert sent", description: "XAUUSD BUY signal dispatched to Discord — check #metals-signals and #free-preview." }),
    onError: () => toast({ title: "Failed", description: "Could not send test alert.", variant: "destructive" }),
  });

  const webhookUrl = `${window.location.origin}/api/signals/webhook`;
  const [copiedTemplate, setCopiedTemplate] = useState(false);

  const messageTemplate = `{
  "symbol": "{{ticker}}",
  "action": "BUY",
  "price": {{close}},
  "entry": {{plot("ENTRY")}},
  "sl": {{plot("SL")}},
  "tp1": {{plot("TP1")}},
  "tp2": {{plot("TP2")}},
  "tp3": {{plot("TP3")}},
  "timeframe": "{{interval}}"
}`;

  function copyWebhook() {
    navigator.clipboard.writeText(`${webhookUrl}?secret=${webhookInfo?.secret ?? ""}`);
    setCopied(true);
    toast({ title: "Copied", description: "Webhook URL copied to clipboard." });
    setTimeout(() => setCopied(false), 2000);
  }

  function copyTemplate() {
    navigator.clipboard.writeText(messageTemplate);
    setCopiedTemplate(true);
    toast({ title: "Copied", description: "Message template copied to clipboard." });
    setTimeout(() => setCopiedTemplate(false), 2000);
  }

  const providerLabel = notifs?.aiProvider === "atlascloud" ? "Atlas Cloud" : "Anthropic";
  const providerColor = notifs?.aiProvider === "atlascloud" ? "text-blue-400" : "text-purple-400";

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-y-auto">
      <div className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Configure your notification channels and TradingView webhook.</p>
      </div>

      <div className="px-6 py-6 space-y-8 max-w-2xl">

        {/* Webhook URL */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Radio className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">TradingView Webhook</h2>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-2">Paste this URL into your TradingView alert → Webhook URL field.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-zinc-300 bg-zinc-800 px-3 py-2 rounded truncate">
                {webhookUrl}{webhookInfo?.secret ? `?secret=${webhookInfo.secret}` : ""}
              </code>
              <button
                onClick={copyWebhook}
                className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors border border-zinc-700"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-2">Set <code className="text-amber-400">SESSION_SECRET</code> in your env to keep this URL private.</p>
          </div>
        </section>

        {/* Message Template */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Alert Message Template</h2>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <p className="text-xs text-zinc-500 mb-2">Paste this into the <strong className="text-zinc-300">Message</strong> field of your TradingView alert. Change <code className="text-amber-400">"BUY"</code> to <code className="text-amber-400">"SELL"</code> as needed.</p>
            <div className="relative">
              <pre className="text-xs font-mono text-zinc-300 bg-zinc-800 px-3 py-3 rounded whitespace-pre overflow-x-auto">
{`{
  "symbol": "{{ticker}}",
  "action": "BUY",
  "price": {{close}},
  "entry": {{plot("ENTRY")}},
  "sl": {{plot("SL")}},
  "tp1": {{plot("TP1")}},
  "tp2": {{plot("TP2")}},
  "tp3": {{plot("TP3")}},
  "timeframe": "{{interval}}"
}`}
              </pre>
              <button
                onClick={copyTemplate}
                className="absolute top-2 right-2 flex items-center gap-1.5 text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors border border-zinc-600"
              >
                <Copy className="w-3 h-3" />
                {copiedTemplate ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-2">TradingView fills <code className="text-zinc-400">{"{{ticker}}"}</code>, <code className="text-zinc-400">{"{{close}}"}</code>, and <code className="text-zinc-400">{"{{interval}}"}</code> automatically when the alert fires.</p>
            <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">Send a fake XAUUSD BUY signal to verify Discord routing without setting up a TradingView alert.</p>
              <Button
                size="sm"
                onClick={() => testAlertMutation.mutate()}
                disabled={testAlertMutation.isPending}
                className="shrink-0 bg-blue-500 hover:bg-blue-400 text-white font-semibold"
              >
                {testAlertMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Sending…</>
                  : <><Zap className="w-3.5 h-3.5 mr-1.5" />Test Alert</>}
              </Button>
            </div>
          </div>
        </section>

        {/* Morning Brief */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Sun className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Morning Brief</h2>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-zinc-300">Daily pre-market AI analysis for your watchlist</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Auto-fires at <span className="text-zinc-300">8:00 AM EST</span> every day via the scheduler.
                  Use the button to trigger it manually at any time.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => morningBriefMutation.mutate()}
                disabled={morningBriefMutation.isPending}
                className="shrink-0 bg-amber-500 hover:bg-amber-400 text-black font-semibold"
              >
                {morningBriefMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Sending…</>
                  : <><Sun className="w-3.5 h-3.5 mr-1.5" />Send Now</>}
              </Button>
            </div>
          </div>
        </section>

        {/* AI Provider */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">AI Provider</h2>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            {notifs ? (
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${providerColor}`}>{providerLabel}</span>
                    {notifs.aiConfigured
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      : <XCircle className="w-4 h-4 text-red-400" />}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 font-mono">{notifs.aiModel}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border ${
                  notifs.aiConfigured
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-red-500/10 text-red-400 border-red-500/20"
                }`}>
                  {notifs.aiConfigured ? "Configured" : "Missing API key"}
                </span>
              </div>
            ) : (
              <div className="text-zinc-600 text-sm">Loading…</div>
            )}
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-1.5 text-xs text-zinc-500">
              <p>Set <code className="text-amber-400">AI_PROVIDER=atlascloud</code> + <code className="text-amber-400">ATLASCLOUD_API_KEY</code> to route analysis through Atlas Cloud.</p>
              <p>Set <code className="text-amber-400">ATLAS_MODEL</code> to pick any Atlas Cloud LLM (default: <code className="text-zinc-300">deepseek-ai/deepseek-v4-pro</code>).</p>
              <p>Leave <code className="text-amber-400">AI_PROVIDER</code> unset to use the Anthropic SDK directly.</p>
            </div>
          </div>
        </section>

        {/* Phone Notifications */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Smartphone className="w-4 h-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Phone Notifications</h2>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
            {notifs ? (
              <div className="px-4">
                <StatusRow label="Pushover" active={notifs.pushover} description="Instant push alerts. Set PUSHOVER_TOKEN + PUSHOVER_USER_KEY" />
                <StatusRow label="Telegram Bot" active={notifs.telegram} description="Send signals to a Telegram chat. Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID" />
                <StatusRow label="ntfy.sh" active={notifs.ntfy} description="Free push notifications. Set NTFY_TOPIC (and optionally NTFY_URL)" />
              </div>
            ) : (
              <div className="p-4 text-zinc-600 text-sm">Loading…</div>
            )}
          </div>
        </section>

        {/* Discord Bot */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <MessageCircle className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Discord Bot</h2>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
            {notifs ? (
              <div className="px-4">
                <StatusRow label="Bot connected" active={notifs.discordBot} description="Set DISCORD_BOT_TOKEN — bot routes signals to the correct tier channels" />
                <StatusRow label="#free-preview" active={notifs.discordChannels?.free} description="DISCORD_FREE_CHANNEL_ID — teaser alerts, anyone can see" />
                <StatusRow label="#currency-signals" active={notifs.discordChannels?.currency} description="DISCORD_CURRENCY_CHANNEL_ID — $10/month tier" />
                <StatusRow label="#metals-signals" active={notifs.discordChannels?.metals} description="DISCORD_METALS_CHANNEL_ID — $10/month tier" />
                <StatusRow label="#indices-signals" active={notifs.discordChannels?.indices} description="DISCORD_INDICES_CHANNEL_ID — $20/month tier" />
                <StatusRow label="#morning-brief" active={notifs.discordChannels?.brief} description="DISCORD_BRIEF_CHANNEL_ID — daily AI analysis" />
                <StatusRow label="#copier-alerts" active={notifs.discordChannels?.copier} description="DISCORD_COPIER_CHANNEL_ID — $50/month tier" />
              </div>
            ) : (
              <div className="p-4 text-zinc-600 text-sm">Loading…</div>
            )}
          </div>
        </section>

        {/* Signal Copier */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">Signal Copier — $50/month</h2>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${notifs?.signalCopier ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
              <p className={`text-sm font-medium ${notifs?.signalCopier ? "text-emerald-400" : "text-amber-400"}`}>
                {notifs?.signalCopier ? "Active — forwarding signals to TradersConnect" : "Inactive"}
              </p>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Forwards every signal to <a href="https://tradersconnect.com" target="_blank" rel="noopener" className="text-amber-400 underline">TradersConnect</a>,
              which copies trades into subscriber MT4/MT5 accounts. Configure with:
            </p>
            <ul className="text-xs text-zinc-500 mt-1 list-disc pl-5 space-y-0.5">
              <li><code className="text-amber-400">SIGNAL_COPIER_ENABLED=true</code> — turn the forwarder on</li>
              <li><code className="text-amber-400">TRADERSCONNECT_WEBHOOK_URL</code> — your TradersConnect signal-receiver URL</li>
              <li><code className="text-amber-400">TRADERSCONNECT_API_KEY</code> — optional auth header</li>
            </ul>
          </div>
        </section>

      </div>
    </div>
  );
}
