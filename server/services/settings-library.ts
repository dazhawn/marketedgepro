import fs from "fs";
import path from "path";

/**
 * Settings Library — tuned configurations for the Renko + MTF Confluence
 * TradingView strategy.
 *
 * This is READ-ONLY. Parameter sweeps are run offline by the site owner and
 * published as configs.json; the app never computes anything. A single sweep is
 * roughly 14 CPU-minutes, and fetching equity bars for a paid product raises
 * data-licensing problems that publishing settings does not — so there is
 * deliberately no job queue and no Python worker behind this.
 *
 * Updating the library is a one-file swap: replace server/data/settings-configs.json.
 */

export type Tier = "free" | "indicator" | "strategy";

const TIER_RANK: Record<Tier, number> = { free: 0, indicator: 1, strategy: 2 };

export interface SettingsConfig {
  id: string;
  symbol: string;
  timeframe: string;
  mtf: string[];
  title: string;
  note: string;
  tier: Tier;
  validated_against_tradingview: boolean;
  validation: {
    match_rate: number | null;
    checked_utc: string | null;
    warning: string | null;
  };
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
  settings: {
    engine: Record<string, unknown>;
    strategy: Record<string, unknown>;
  };
  checklist: string;
}

/** A config the viewer's tier does not cover: name and tier label only. */
export interface LockedConfig {
  id: string;
  symbol: string;
  timeframe: string;
  title: string;
  tier: Tier;
  validated_against_tradingview: boolean;
  locked: true;
}

export interface SettingsCatalogue {
  schema_version: number;
  generated_utc: string;
  strategy: string;
  disclaimer: string;
  counts: { total: number; validated: number };
  configs: Array<SettingsConfig | LockedConfig>;
  failed: unknown[];
  viewer_tier: Tier;
}

// Resolved against process.cwd() rather than the module directory: dev runs as
// ESM under tsx (no __dirname) and production is an esbuild CJS bundle in
// dist/, so neither has a stable module-relative path to server/data.
function candidatePaths(): string[] {
  const override = process.env.SETTINGS_CONFIGS_PATH;
  return [
    ...(override ? [override] : []),
    path.join(process.cwd(), "server", "data", "settings-configs.json"),
    path.join(process.cwd(), "data", "settings-configs.json"),
    path.join(process.cwd(), "..", "server", "data", "settings-configs.json"),
  ];
}

let cache: { mtimeMs: number; file: string; raw: any } | null = null;

/**
 * Reads the catalogue off disk, re-reading whenever the file's mtime changes so
 * that swapping configs.json takes effect without a restart.
 */
function loadRaw(): any {
  let found: { file: string; mtimeMs: number } | null = null;
  for (const file of candidatePaths()) {
    try {
      const stat = fs.statSync(file);
      found = { file, mtimeMs: stat.mtimeMs };
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!found) {
    throw new Error(
      "settings-configs.json not found. Expected it at server/data/settings-configs.json " +
        "or at the path in SETTINGS_CONFIGS_PATH.",
    );
  }

  if (cache && cache.file === found.file && cache.mtimeMs === found.mtimeMs) {
    return cache.raw;
  }

  const raw = JSON.parse(fs.readFileSync(found.file, "utf-8"));
  if (raw?.schema_version !== 1) {
    console.warn(
      `[settings-library] schema_version ${raw?.schema_version} is not 1 — the reader may not understand this file.`,
    );
  }
  cache = { file: found.file, mtimeMs: found.mtimeMs, raw };
  console.log(
    `[settings-library] Loaded ${raw?.configs?.length ?? 0} configs from ${path.basename(found.file)} ` +
      `(${raw?.counts?.validated ?? 0} of ${raw?.counts?.total ?? 0} reproduced)`,
  );
  return raw;
}

function lock(cfg: SettingsConfig): LockedConfig {
  return {
    id: cfg.id,
    symbol: cfg.symbol,
    timeframe: cfg.timeframe,
    title: cfg.title,
    tier: cfg.tier,
    // The verification state stays visible even when the config is locked —
    // it is part of the contract, not part of the paywalled detail.
    validated_against_tradingview: cfg.validated_against_tradingview,
    locked: true,
  };
}

/**
 * Returns the catalogue with every entry the viewer's tier does not cover
 * reduced to its name and tier label. Gating happens here, server-side, so the
 * paid metrics and settings never reach the browser for a locked entry.
 */
export function getCatalogue(viewerTier: Tier = "free"): SettingsCatalogue {
  const raw = loadRaw();
  const viewerRank = TIER_RANK[viewerTier] ?? 0;

  const configs = (raw.configs as SettingsConfig[]).map(cfg => {
    const cfgRank = TIER_RANK[cfg.tier] ?? TIER_RANK.strategy;
    return cfgRank <= viewerRank ? cfg : lock(cfg);
  });

  return {
    schema_version: raw.schema_version,
    generated_utc: raw.generated_utc,
    strategy: raw.strategy,
    disclaimer: raw.disclaimer,
    counts: raw.counts,
    configs,
    failed: raw.failed ?? [],
    viewer_tier: viewerTier,
  };
}
