import { describe, expect, it } from "vitest";
import { baseWindow, covers, customWindow, priorWindow, resolvePreset } from "../server/util/window.js";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const days = (w: { start: string; end: string }) =>
  Math.round((Date.parse(w.end) - Date.parse(w.start)) / 86_400_000);

describe("baseWindow", () => {
  it("is 90 days with trend off and 180 with trend on", () => {
    expect(days(baseWindow(false, NOW))).toBe(90);
    expect(days(baseWindow(true, NOW))).toBe(180);
  });

  it("uses a distinct key per width so the two envelopes coexist", () => {
    expect(baseWindow(false, NOW).key).toBe("base90");
    expect(baseWindow(true, NOW).key).toBe("base180");
  });

  it("ends at now", () => {
    expect(baseWindow(false, NOW).end).toBe(NOW.toISOString());
  });
});

describe("covers", () => {
  const base90 = baseWindow(false, NOW);
  const base180 = baseWindow(true, NOW);

  it("covers every preset and, for 7d/30d, their priors too", () => {
    for (const p of ["7d", "30d", "90d"] as const) {
      expect(covers(base90, resolvePreset(p, NOW))).toBe(true);
    }
    expect(covers(base90, priorWindow(resolvePreset("7d", NOW)))).toBe(true);
    expect(covers(base90, priorWindow(resolvePreset("30d", NOW)))).toBe(true);
  });

  it("does not cover the 90d prior at 90d width, but does at 180d", () => {
    const prior90 = priorWindow(resolvePreset("90d", NOW));
    expect(covers(base90, prior90)).toBe(false);
    expect(covers(base180, prior90)).toBe(true);
  });

  it("rejects a custom window wider than the base", () => {
    const wide = customWindow("2026-03-01T00:00:00.000Z", "2026-07-07T00:00:00.000Z");
    expect(covers(base90, wide)).toBe(false);
  });

  it("is inclusive at both edges", () => {
    expect(covers(base90, { ...base90, key: "custom" })).toBe(true);
  });
});
