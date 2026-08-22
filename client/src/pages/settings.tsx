import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, Check, Copy, Loader2, Lock, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Settings — tuned configurations for the Renko + MTF Confluence strategy.
 * (Distinct from pages/configuration.tsx, which is the app's own config page.)
 *
 * Read-only. The catalogue is published offline and served by
 * GET /api/settings/configs.json; this page never computes anything.
 *
 * Two things here are load-bearing and must survive any redesign:
 *  1. Every entry shows whether it has been reproduced on TradingView, and
 *     renders validation.warning when it has not. People make money decisions
 *     on this page.
 *  2. Win rate and profit factor are per ROUND TRIP, not per fill. TradingView
 *     books each partial take-profit as its own closed trade, which flatters
 *     win rate; `fills` is shown alongside purely for reconciling against a
 *     Strategy Tester screenshot.
 */

type Tier = "free" | "indicator" | "strategy";

interface Validation {
  match_rate: number | null;
  checked_utc: string | null;
  warning: string | null;
}

interface FullConfig {
  id: string;
  symbol: string;
  timeframe: string;
  mtf: string[];
  title: string;
  note: string;
  tier: Tier;
  validated_against_tradingview: boolean;
  validation: Validation;
  data: { bars: number; start: string; end: string; source: string };
  costs: {
    initial_capital: number;
    commission_pct_per_side: number;
    slippage_ticks: number;
    slippage_bps: number;
    mintick: number;
  };
  backtest: {
    round_trips: number;
    fills: number;
    win_rate: number;
    profit_factor: number;
    return_pct: number;
    max_drawdown_pct: number;
    avg_win_loss: number;
    longest_losing_run: number;
    sharpe: number;
    avg_bars_held: number;
  };
  settings: { engine: Record<string, unknown>; strategy: Record<string, unknown> };
  checklist: string;
  locked?: false;
}

interface LockedConfig {
  id: string;
  symbol: string;
  timeframe: string;
  title: string;
  tier: Tier;
  validated_against_tradingview: boolean;
  locked: true;
}

type Config = FullConfig | LockedConfig;

interface Catalogue {
  schema_version: number;
  generated_utc: string;
  strategy: string;
  disclaimer: string;
  counts: { total: number; validated: number };
  configs: Config[];
  failed: unknown[];
  viewer_tier: Tier;
}

const isLocked = (c: Config): c is LockedConfig => c.locked === true;

const TIER_LABEL: Record<Tier, string> = {
  free: "Free",
  indicator: "Indicator",
  strategy: "Strategy",
};

/** Verification state. Amber until the config is reproduced on TradingView. */
function VerifiedChip({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
      <BadgeCheck className="w-3 h-3" /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-400">
      <AlertTriangle className="w-3 h-3" /> Unverified
    </span>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-card px-3.5 py-3">
      <div className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      {note && <div className="font-mono text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function Provenance({ cfg }: { cfg: FullConfig }) {
  const { data, costs } = cfg;
  const slippage = costs.slippage_bps > 0 ? `${costs.slippage_bps} bp` : `${costs.slippage_ticks} ticks`;
  const rows: Array<[string, string]> = [
    ["Data", `${data.bars.toLocaleString()} bars · ${data.start} → ${data.end} · ${data.source}`],
    [
      "Costs",
      `${costs.commission_pct_per_side}% per side · ${slippage} slippage · $${costs.initial_capital.toLocaleString()} capital`,
    ],
    ["Engine", `Renko ${String(cfg.settings.engine.mode)} ${String(cfg.settings.engine.modevalue)} · source ${String(cfg.settings.engine.src_input)}`],
    ["MTF legs", cfg.mtf.join("  ·  ")],
  ];
  return (
    <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-border pt-4">
      {rows.map(([dt, dd]) => (
        <div key={dt} className="contents">
          <dt className="pt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{dt}</dt>
          <dd className="m-0 font-mono text-[12.5px] tabular-nums text-muted-foreground">{dd}</dd>
        </div>
      ))}
    </dl>
  );
}

function ChecklistBlock({ checklist }: { checklist: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      // Copied verbatim — the whitespace lines the values up with the Pine
      // settings dialog, so it must not be trimmed or reflowed.
      await navigator.clipboard.writeText(checklist);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <div className="mt-7 mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Settings checklist
        </h2>
        <Button size="sm" variant="outline" onClick={copy} className="h-7 gap-1.5 text-xs">
          {copied ? <><Check className="w-3.5 h-3.5" />Copied</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
        </Button>
      </div>
      <pre className="m-0 overflow-x-auto rounded-lg border border-border bg-muted/40 px-4 py-4 font-mono text-[12.5px] leading-[1.62] text-foreground">
        {checklist}
      </pre>
    </>
  );
}

function DetailPane({ cfg }: { cfg: Config }) {
  if (isLocked(cfg)) {
    return (
      <section className="rounded-xl border border-border bg-card p-7 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="m-0 text-2xl font-bold tracking-tight">{cfg.title}</h3>
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-muted text-muted-foreground">
            <Lock className="w-3 h-3" /> {TIER_LABEL[cfg.tier]} tier
          </span>
          <VerifiedChip verified={cfg.validated_against_tradingview} />
        </div>
        <p className="mt-3 max-w-[58ch] text-sm text-muted-foreground">
          This configuration is part of the {TIER_LABEL[cfg.tier]} tier. Its metrics and settings are not
          included in your current access.
        </p>
      </section>
    );
  }

  const m = cfg.backtest;
  const verified = cfg.validated_against_tradingview;

  return (
    <section className="rounded-xl border border-border bg-card p-7 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <h3 className="m-0 text-2xl font-bold tracking-tight">{cfg.title}</h3>
        <VerifiedChip verified={verified} />
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {TIER_LABEL[cfg.tier]}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {cfg.symbol} · {cfg.timeframe} · MTF {cfg.mtf.join(" / ")}
        </span>
      </div>

      <p className="mt-3 max-w-[68ch] text-[14.5px] leading-relaxed text-muted-foreground">{cfg.note}</p>

      {/* Hard requirement: the warning renders whenever the flag is false. */}
      {verified ? (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13.5px] leading-relaxed">
          <BadgeCheck className="mt-0.5 h-4 w-4 flex-none text-emerald-600 dark:text-emerald-400" />
          <span>
            Reproduced against TradingView's Strategy Tester
            {cfg.validation.match_rate !== null && <> at {cfg.validation.match_rate}% entry match</>}
            {cfg.validation.checked_utc && <> on {cfg.validation.checked_utc.slice(0, 10)}</>}.
          </span>
        </div>
      ) : (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13.5px] leading-relaxed">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600 dark:text-amber-400" />
          <span>{cfg.validation.warning}</span>
        </div>
      )}

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(112px,1fr))] gap-px overflow-hidden rounded-lg border border-border bg-border">
        <Stat label="Round trips" value={String(m.round_trips)} note={`${m.fills} fills`} />
        <Stat label="Win rate" value={`${m.win_rate}%`} note="per round trip" />
        <Stat label="Profit factor" value={m.profit_factor.toFixed(2)} note="per round trip" />
        <Stat label="Return" value={`${m.return_pct}%`} />
        <Stat label="Max DD" value={`${m.max_drawdown_pct}%`} note="closed-trade" />
        <Stat label="Avg win/loss" value={m.avg_win_loss.toFixed(2)} />
        <Stat label="Sharpe" value={m.sharpe.toFixed(2)} />
        <Stat label="Worst run" value={`${m.longest_losing_run} losses`} note={`${m.avg_bars_held} bars held`} />
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
        Win rate and profit factor are measured per round trip. TradingView counts each partial take-profit as
        its own closed trade, so its figures will differ — compare against <span className="font-mono">{m.fills}</span>{" "}
        fills instead. Max drawdown is closed-trade equity and reads lower than TradingView's intrabar figure.
      </p>

      <ChecklistBlock checklist={cfg.checklist} />
      <Provenance cfg={cfg} />
    </section>
  );
}

export default function SettingsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<Catalogue>({
    queryKey: ["/api/settings/configs.json"],
  });

  const configs = data?.configs ?? [];
  const selected = configs.find(c => c.id === selectedId) ?? configs.find(c => !isLocked(c)) ?? configs[0];

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground">
      <div className="mx-auto max-w-[1160px] px-6 pb-20 pt-8">
        <header className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-3 border-b border-border pb-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">MarketEdgePro</span>
          {data && (
            <span className="whitespace-nowrap rounded-md border border-border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground">
              {data.counts.validated} of {data.counts.total} reproduced
            </span>
          )}
          <h1 className="m-0 flex-[1_1_100%] text-[clamp(25px,3.4vw,34px)] font-bold tracking-tight text-balance">
            <SlidersHorizontal className="mr-2 inline h-6 w-6 text-primary" />
            Strategy Settings for TradingView
          </h1>
          <p className="m-0 max-w-[62ch] flex-[1_1_100%] text-sm text-muted-foreground">
            Tuned configurations for the {data?.strategy ?? "Renko + MTF Confluence Strategy"}, one per symbol and
            timeframe. Load a configuration on your chart to reproduce the backtest behind it.
          </p>
        </header>

        {isLoading && (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading catalogue…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            Could not load the settings catalogue. Confirm{" "}
            <span className="font-mono">server/data/settings-configs.json</span> is present.
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[288px_minmax(0,1fr)]">
              <nav aria-label="Symbols" className="flex flex-col gap-2 md:sticky md:top-5">
                <h2 className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Symbols
                </h2>
                {configs.map(cfg => {
                  const locked = isLocked(cfg);
                  const active = selected?.id === cfg.id;
                  return (
                    <button
                      key={cfg.id}
                      onClick={() => setSelectedId(cfg.id)}
                      aria-current={active}
                      className={[
                        "grid w-full grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 rounded-lg border px-3.5 py-3 text-left transition-colors",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                        active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-muted-foreground/40",
                        locked ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      <span className="text-[15px] font-semibold tracking-tight">{cfg.title}</span>
                      {locked ? (
                        <span className="inline-flex items-center gap-1 self-start rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <Lock className="h-3 w-3" /> {TIER_LABEL[cfg.tier]}
                        </span>
                      ) : (
                        <span className="self-start">
                          <VerifiedChip verified={cfg.validated_against_tradingview} />
                        </span>
                      )}
                      <span className="col-start-1 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                        {locked
                          ? `${cfg.symbol} · ${cfg.timeframe}`
                          : `${(cfg as FullConfig).backtest.round_trips} trades · PF ${(cfg as FullConfig).backtest.profit_factor.toFixed(2)} · DD ${(cfg as FullConfig).backtest.max_drawdown_pct}%`}
                      </span>
                    </button>
                  );
                })}
              </nav>

              {selected && <DetailPane cfg={selected} />}
            </div>

            <footer className="mt-6 rounded-lg border border-border bg-muted/40 px-4 py-4 text-[12.5px] leading-relaxed text-muted-foreground">
              {data.disclaimer}
              <span className="mt-1.5 block font-mono text-[11.5px]">
                Catalogue generated {data.generated_utc} · schema v{data.schema_version}
              </span>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
