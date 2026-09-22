/**
 * Report signals that reached Discord but could not be saved.
 *
 * Since the webhook now posts even when Postgres is down, a database outage
 * no longer costs members their live signals — it costs the history. That is
 * worth knowing about, but during an outage EVERY incoming signal fails to
 * save, and reportIssue has no throttle of its own: thirty alerts firing would
 * mean thirty admin messages. So the first failure reports immediately, and
 * further failures within the window are counted and summarised in the next
 * report rather than each posting separately.
 */
import { reportIssue } from "./discord-bot";

export const UNSAVED_REPORT_WINDOW_MS = 30 * 60 * 1000;

// -Infinity, not 0: "never reported" must be earlier than any real time. A 0
// sentinel only worked because Date.now() is never near zero, and the tests,
// which do start their clock at 0, caught it suppressing the first report.
let lastReportAt = -Infinity;
let suppressed: string[] = [];

/**
 * Record one unsaved signal. Returns true if this call posted a report, which
 * the tests use; production callers ignore it.
 */
export function noteUnsavedSignal(label: string, err: unknown, now: number = Date.now()): boolean {
  console.error(`[webhook] ${label} posted to Discord but NOT saved:`, (err as Error)?.message ?? err);

  if (now - lastReportAt < UNSAVED_REPORT_WINDOW_MS) {
    suppressed.push(label);
    return false;
  }

  const earlier = suppressed;
  suppressed = [];
  lastReportAt = now;

  const lines = [
    `**${label}** reached Discord, but saving it failed — members got the signal, ` +
      `the history and dashboard did not.`,
  ];
  if (earlier.length) {
    lines.push("", `Also unsaved since the last report (${earlier.length}): ${earlier.join(", ")}`);
  }
  lines.push("", String((err as Error)?.message ?? err));

  void reportIssue("Signals posted but not saved", lines.join("\n"), {
    unsaved_this_report: String(earlier.length + 1),
  });
  return true;
}

/** Test hook. */
export function _resetUnsavedSignals(): void {
  lastReportAt = -Infinity;
  suppressed = [];
}
