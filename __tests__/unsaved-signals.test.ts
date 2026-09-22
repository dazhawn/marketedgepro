import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * The webhook now posts to Discord even when Postgres is down, and reports the
 * lost history. During an outage EVERY signal fails to save, so the report must
 * not fire once per signal — thirty alerts would mean thirty admin messages.
 */

const reportIssue = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
jest.unstable_mockModule("../server/services/discord-bot", () => ({ reportIssue }));

const MIN = 60 * 1000;

async function fresh() {
  const m = await import("../server/services/unsaved-signals");
  m._resetUnsavedSignals();
  reportIssue.mockClear();
  return m;
}

describe("unsaved signal reporting", () => {
  beforeEach(() => { reportIssue.mockClear(); });

  it("reports the first unsaved signal immediately", async () => {
    const { noteUnsavedSignal } = await fresh();
    expect(noteUnsavedSignal("SPY 5", new Error("quota"), 0)).toBe(true);
    expect(reportIssue).toHaveBeenCalledTimes(1);
  });

  it("sends one alert, not thirty, when a burst of signals fails during an outage", async () => {
    const { noteUnsavedSignal } = await fresh();
    for (let i = 0; i < 30; i++) noteUnsavedSignal(`SIG${i} 5`, new Error("quota"), i * MIN);
    expect(reportIssue).toHaveBeenCalledTimes(1);
  });

  it("names the suppressed signals in the next report instead of dropping them", async () => {
    const { noteUnsavedSignal, UNSAVED_REPORT_WINDOW_MS } = await fresh();
    noteUnsavedSignal("SPY 5", new Error("quota"), 0);
    noteUnsavedSignal("KO 5", new Error("quota"), 1 * MIN);
    noteUnsavedSignal("XOM 15", new Error("quota"), 2 * MIN);
    noteUnsavedSignal("MRVL 60", new Error("quota"), UNSAVED_REPORT_WINDOW_MS + 1);

    expect(reportIssue).toHaveBeenCalledTimes(2);
    const second = String(reportIssue.mock.calls[1][1]);
    expect(second).toContain("MRVL 60");
    expect(second).toContain("KO 5");
    expect(second).toContain("XOM 15");
  });
});
