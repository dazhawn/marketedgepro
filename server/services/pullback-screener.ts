import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { spawn } from "child_process";

export interface LiveSignalRow {
  symbol: string;
  signal: string;   // "LONG PB" | "SHORT PB"
  when: string;     // "TODAY" | "YESTERDAY" | "2d AGO"
  barsAgo: number;
  price: number;
  chanStop: number;
  distPct: number;
  histPf: number;
  wr: number;
  trades: number;
  wins: number;
}

export interface OptionsSignalRow {
  symbol: string;
  price: number;
  trend: string;    // "LONG" | "SHORT"
  pf: number;
  wr: number;
  trades: number;
  wins: number;
  sector: string;
}

export interface ScreenerMeta {
  file: string;
  runAt: string;
  count: number;
}

function getOutputDir(): string {
  return process.env.SCREENER_OUTPUT_DIR ||
    "C:\\Users\\dazha\\OneDrive\\Desktop\\MiIlionaire Blueprint\\Smart_Pullback_System_v1.0\\SmartPullbackSystem";
}

function latestFile(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith(".csv"))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}

function parseNum(v: string | undefined): number {
  const n = parseFloat(v ?? "");
  return isNaN(n) ? 0 : n;
}

export function readLiveSignals(): { rows: LiveSignalRow[]; meta: ScreenerMeta | null } {
  const dir = getOutputDir();
  const file = latestFile(dir, "SmartPullback_LiveSignals_");
  if (!file) return { rows: [], meta: null };

  const content = fs.readFileSync(file, "utf-8");
  const records: Record<string, string>[] = parse(content, { columns: true, skip_empty_lines: true });

  const rows: LiveSignalRow[] = records.map(r => ({
    symbol:  r["Symbol"] ?? "",
    signal:  r["Signal"] ?? "",
    when:    r["When"] ?? "",
    barsAgo: parseNum(r["BarsAgo"]),
    price:   parseNum(r["Price"]),
    chanStop: parseNum(r["ChanStop"]),
    distPct: parseNum(r["Dist%"]),
    histPf:  parseNum(r["Hist_PF"]),
    wr:      parseNum(r["WR%"]),
    trades:  parseNum(r["Trades"]),
    wins:    parseNum(r["Wins"]),
  }));

  // Derive timestamp from filename: SmartPullback_LiveSignals_YYYYMMDD_HHMM.csv
  const basename = path.basename(file, ".csv");
  const ts = basename.replace("SmartPullback_LiveSignals_", "");
  const runAt = ts.length === 13
    ? `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}`
    : ts;

  return { rows, meta: { file: path.basename(file), runAt, count: rows.length } };
}

export function readOptionsSignals(): { rows: OptionsSignalRow[]; meta: ScreenerMeta | null } {
  const dir = getOutputDir();
  const file = latestFile(dir, "SmartPullback_Screener_");
  if (!file) return { rows: [], meta: null };

  const content = fs.readFileSync(file, "utf-8");
  const records: Record<string, string>[] = parse(content, { columns: true, skip_empty_lines: true });

  const rows: OptionsSignalRow[] = records.map(r => ({
    symbol: r["Symbol"] ?? "",
    price:  parseNum(r["Price"]),
    trend:  r["Trend"] ?? "",
    pf:     parseNum(r["PF"]),
    wr:     parseNum(r["WR %"]),
    trades: parseNum(r["Trades"]),
    wins:   parseNum(r["Wins"]),
    sector: r["Sector"] ?? "—",
  }));

  const basename = path.basename(file, ".csv");
  const ts = basename.replace("SmartPullback_Screener_", "");
  const runAt = ts.length === 13
    ? `${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)} ${ts.slice(9,11)}:${ts.slice(11,13)}`
    : ts;

  return { rows, meta: { file: path.basename(file), runAt, count: rows.length } };
}

export type RunMode = "live" | "options";

/** True only on the trading PC where the Python screener scripts exist —
 * always false on Railway, where results arrive via the upload endpoint. */
export function screenerAvailable(mode: RunMode): boolean {
  const scriptName = mode === "live"
    ? "smart_pullback_live_screener.py"
    : "smart_pullback_screener.py";
  return fs.existsSync(path.join(getOutputDir(), scriptName));
}

export function runScreener(mode: RunMode): { pid: number } {
  const pythonExe = process.env.SCREENER_PYTHON_EXE ||
    "C:\\Users\\dazha\\AppData\\Local\\Python\\bin\\python.exe";
  const dir = getOutputDir();

  const scriptName = mode === "live"
    ? "smart_pullback_live_screener.py"
    : "smart_pullback_screener.py";
  const scriptPath = path.join(dir, scriptName);

  const args = mode === "live"
    ? ["-X", "utf8", scriptPath, "--window", "3", "--pf", "1.0", "--out", dir]
    : ["-X", "utf8", scriptPath, "--top", "100"];

  const proc = spawn(pythonExe, args, {
    detached: true,
    stdio: "ignore",
    cwd: dir,
    windowsHide: true,
  });
  proc.unref();

  console.log(`[screener] Launched ${mode} screener (pid ${proc.pid})`);
  return { pid: proc.pid ?? 0 };
}
