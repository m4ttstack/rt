import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { getSetting } from "@mattstack/rt-client";
import { loadTriageConfig } from "../triage/config.ts";

type GetSettingFn = typeof getSetting;

function fakeResolve(values: Record<string, unknown>): GetSettingFn {
  return (<T,>(key: string) => ({ value: values[key] as T, provenance: [] })) as GetSettingFn;
}

function throwingResolve(): GetSettingFn {
  return (() => {
    throw new Error("rt daemon unreachable");
  }) as GetSettingFn;
}

function tmpConfig(triage: Record<string, unknown>): string {
  const p = join(mkdtempSync(join(tmpdir(), "triage-latch-")), "config.json");
  writeFileSync(p, JSON.stringify({ triage }, null, 2) + "\n");
  return p;
}

describe("loadTriageConfig: per-key store-wins fallback", () => {
  test("unowned: reads every field out of config.json's triage block, as before", () => {
    const p = tmpConfig({ enabled: true, cooldownMinutes: 45, doctorSkill: "team:doctor-api", maxConcurrent: 4 });
    const cfg = loadTriageConfig(p, fakeResolve({}));
    expect(cfg.enabled).toBe(true);
    expect(cfg.cooldownMinutes).toBe(45);
    expect(cfg.doctorSkill).toBe("team:doctor-api");
    expect(cfg.maxConcurrent).toBe(4);
  });

  test("owned board.triage wins wholesale for its fields, but never touches doctorSkill/maxConcurrent", () => {
    const p = tmpConfig({ enabled: false, cooldownMinutes: 30, doctorSkill: "file:doctor", maxConcurrent: 2 });
    const cfg = loadTriageConfig(p, fakeResolve({
      "board.triage": { enabled: true, cooldownMinutes: 90, dailyAttemptBudget: 9, tier: "checkout", notify: "badge-only" },
    }));
    expect(cfg.enabled).toBe(true);
    expect(cfg.cooldownMinutes).toBe(90);
    expect(cfg.dailyAttemptBudget).toBe(9);
    expect(cfg.tier).toBe("checkout");
    expect(cfg.notify).toBe("badge-only");
    // sibling keys, untouched by an owned board.triage:
    expect(cfg.doctorSkill).toBe("file:doctor");
    expect(cfg.maxConcurrent).toBe(2);
  });

  test("board.triage.doctorSkill (team) and board.triageMaxConcurrent (machine) win independently of board.triage", () => {
    const p = tmpConfig({ enabled: true, doctorSkill: "file:doctor", maxConcurrent: 2 });
    const cfg = loadTriageConfig(p, fakeResolve({
      "board.triage.doctorSkill": "team:doctor-store",
      "board.triageMaxConcurrent": 7,
    }));
    expect(cfg.doctorSkill).toBe("team:doctor-store");
    expect(cfg.maxConcurrent).toBe(7);
    // the rest still falls back to the file
    expect(cfg.enabled).toBe(true);
  });

  test("an invalid store maxConcurrent (non-positive) is ignored, falling back to the file", () => {
    const p = tmpConfig({ enabled: true, maxConcurrent: 3 });
    const cfg = loadTriageConfig(p, fakeResolve({ "board.triageMaxConcurrent": -1 }));
    expect(cfg.maxConcurrent).toBe(3);
  });

  test("a resolver throw degrades every triage key to config.json's values, never crashes the load", () => {
    const p = tmpConfig({ enabled: true, cooldownMinutes: 45, doctorSkill: "team:doctor-api" });
    const cfg = loadTriageConfig(p, throwingResolve());
    expect(cfg.enabled).toBe(true);
    expect(cfg.cooldownMinutes).toBe(45);
    expect(cfg.doctorSkill).toBe("team:doctor-api");
  });

  test("BOARD-14: triage.doctorSkill stays independent of the board's own (non-triage) doctorSkill key", () => {
    // board.doctorSkill (top-level, manifest-overridable) is config.ts's concern;
    // this file only ever reads board.triage.doctorSkill (never manifest-resolved).
    const p = tmpConfig({ enabled: true, doctorSkill: "file:triage-doctor" });
    const cfg = loadTriageConfig(p, fakeResolve({ "board.doctorSkill": "team:top-level-doctor" }));
    expect(cfg.doctorSkill).toBe("file:triage-doctor"); // unaffected by the unrelated key
  });
});
