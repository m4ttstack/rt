import { describe, test, expect } from "bun:test";
import { maybeSendTriageSummary, type SummaryDeps } from "../triage-summary.ts";

function deps(at: string, counts = { needsDecision: 4, safe: 2 }, last: string | null = null) {
  const sent: Array<[string, string]> = [];
  let lastSent = last;
  const d: SummaryDeps = {
    now: () => new Date(at),
    counts: async () => counts,
    notify: (t, m) => sent.push([t, m]),
    loadLastSent: () => lastSent,
    saveLastSent: (day) => { lastSent = day; },
  };
  return { d, sent, last: () => lastSent };
}

describe("maybeSendTriageSummary", () => {
  test("nothing before 09:00", async () => {
    const { d, sent } = deps("2026-09-25T08:59:00");
    expect(await maybeSendTriageSummary(d)).toBe(false);
    expect(sent).toEqual([]);
  });
  test("one summary at or after 09:00 with the count and the safe count", async () => {
    const { d, sent } = deps("2026-09-25T09:00:00");
    expect(await maybeSendTriageSummary(d)).toBe(true);
    expect(sent).toEqual([["4 worktrees need a decision", "2 can be cleaned up in one click. Click to review."]]);
  });
  test("never at zero", async () => {
    const { d, sent } = deps("2026-09-25T10:00:00", { needsDecision: 0, safe: 0 });
    expect(await maybeSendTriageSummary(d)).toBe(false);
    expect(sent).toEqual([]);
  });
  test("not twice the same day, including after a restart", async () => {
    const { d, sent } = deps("2026-09-25T11:00:00", undefined, "2026-09-25");
    expect(await maybeSendTriageSummary(d)).toBe(false);
    expect(sent).toEqual([]);
  });
  test("singular and no-safe wording", async () => {
    const { d, sent } = deps("2026-09-25T09:30:00", { needsDecision: 1, safe: 0 });
    await maybeSendTriageSummary(d);
    expect(sent).toEqual([["1 worktree needs a decision", "Click to review."]]);
  });
});
