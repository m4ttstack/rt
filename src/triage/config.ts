import { readFileSync } from "fs";
import { join } from "path";
import { getSetting } from "@mattstack/rt-client";

export interface FixClasses {
  retryFlake: boolean;
  inheritedNoteDraft: boolean;
  cleanApiRebase: boolean;
  /** Behavior-neutral mechanical code fixes (append required lint-disable
      reasons, formatting-only changes, import ordering) committed and pushed
      to the MR branch. MAT-351: dispatch only ever includes this class for
      edges whose author is the board's own identity -- see composeFixClasses
      in run.ts, the actual gate. DEFAULT OFF, same conservative posture as
      cleanApiRebase, since it's the other branch-writing class here. */
  mechanicalLint: boolean;
  /** Full repair authority for the board identity's OWN MRs (Matt's
      2026-08-10 widening of MAT-351). Same author gate as mechanicalLint in
      composeFixClasses; DEFAULT OFF. */
  codeFix: boolean;
}

export interface TriageConfig {
  enabled: boolean;
  cooldownMinutes: number;
  maxConcurrent: number;
  dailyAttemptBudget: number;
  fixClasses: FixClasses;
  /** Domain skill the auto-dispatched wrapper delegates to. Deliberate:
      triage-level config override, not manifest-resolved (BOARD-14 ruling --
      auto-dispatch has no per-MR nudge/click origin to hang a manifest
      lookup off, so it stays a plain config field). */
  doctorSkill: string;
  /** Repair tier for auto dispatches: "api" = no-checkout held-drafts doctor;
      "checkout" = the full fix-and-push doctor (token identity's own MRs
      only, which fetchOwnMrs already guarantees). */
  tier: "api" | "checkout";
  notify: "rt" | "badge-only";
}

const DEFAULT_FIX_CLASSES: FixClasses = {
  retryFlake: true,
  inheritedNoteDraft: true,
  // API-only but branch-rewriting; ships DEFAULT OFF per the 2026-08-08 ruling.
  cleanApiRebase: false,
  // Commits + pushes to the MR branch; ships DEFAULT OFF per the 2026-08-10
  // MAT-351 ruling. Gated to the board's own identity at dispatch regardless
  // of this toggle -- see composeFixClasses in run.ts.
  mechanicalLint: false,
  // Full fix-and-push on the board identity's own MRs; same gate, same
  // conservative shipped default.
  codeFix: false,
};

const DEFAULTS: TriageConfig = {
  enabled: false,
  cooldownMinutes: 30,
  maxConcurrent: 2,
  dailyAttemptBudget: 3,
  fixClasses: DEFAULT_FIX_CLASSES,
  doctorSkill: "",
  tier: "api",
  notify: "rt",
};

function positiveNumber(value: unknown, key: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`config.json "triage.${key}" must be a positive number`);
  }
  return value;
}

export function parseTriageBlock(raw: unknown): TriageConfig {
  if (raw === undefined || raw === null) return structuredClone(DEFAULTS);
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`config.json "triage" must be an object`);
  }
  const t = raw as Record<string, unknown>;
  if (t.enabled !== undefined && typeof t.enabled !== "boolean") {
    throw new Error(`config.json "triage.enabled" must be a boolean`);
  }
  if (t.doctorSkill !== undefined && typeof t.doctorSkill !== "string") {
    throw new Error(`config.json "triage.doctorSkill" must be a string (a skill name)`);
  }
  if (t.notify !== undefined && t.notify !== "rt" && t.notify !== "badge-only") {
    throw new Error(`config.json "triage.notify" must be "rt" or "badge-only"`);
  }
  if (t.tier !== undefined && t.tier !== "api" && t.tier !== "checkout") {
    throw new Error(`config.json "triage.tier" must be "api" or "checkout"`);
  }
  const fixClasses = { ...DEFAULT_FIX_CLASSES };
  if (t.fixClasses !== undefined) {
    if (typeof t.fixClasses !== "object" || t.fixClasses === null || Array.isArray(t.fixClasses)) {
      throw new Error(`config.json "triage.fixClasses" must be an object`);
    }
    for (const key of ["retryFlake", "inheritedNoteDraft", "cleanApiRebase", "mechanicalLint", "codeFix"] as const) {
      const v = (t.fixClasses as Record<string, unknown>)[key];
      if (v === undefined) continue;
      if (typeof v !== "boolean") throw new Error(`config.json "triage.fixClasses.${key}" must be a boolean`);
      fixClasses[key] = v;
    }
  }
  return {
    enabled: (t.enabled as boolean | undefined) ?? DEFAULTS.enabled,
    cooldownMinutes: positiveNumber(t.cooldownMinutes, "cooldownMinutes", DEFAULTS.cooldownMinutes),
    maxConcurrent: positiveNumber(t.maxConcurrent, "maxConcurrent", DEFAULTS.maxConcurrent),
    dailyAttemptBudget: positiveNumber(t.dailyAttemptBudget, "dailyAttemptBudget", DEFAULTS.dailyAttemptBudget),
    fixClasses,
    doctorSkill: (t.doctorSkill as string | undefined) ?? DEFAULTS.doctorSkill,
    tier: (t.tier as "api" | "checkout" | undefined) ?? DEFAULTS.tier,
    notify: (t.notify as "rt" | "badge-only" | undefined) ?? DEFAULTS.notify,
  };
}

type GetSettingFn = typeof getSetting;

/** Read one board.triage* key, degrading to "not owned" on a resolver throw
    rather than letting a daemon hiccup brick triage config load (same
    fail-open contract as config.ts's storeValue). Warns once per call. */
function storeValue<T>(key: string, resolve: GetSettingFn): T | undefined {
  try {
    return resolve<T>(key).value;
  } catch (err) {
    console.warn(`board: ${key} unavailable, falling back to config.json`, err);
    return undefined;
  }
}

/** The block lives in the board's config.json, but parsing stays here so the
    board server never needs to know the block exists (hard boundary).
    BOARD-14 split across three independently latched store keys once
    migrated: `board.triage` (user) carries every field here except
    doctorSkill/maxConcurrent — those two are sibling flat keys
    (`board.triage.doctorSkill` team, never manifest-resolved;
    `board.triageMaxConcurrent` machine), not nested inside `board.triage`,
    so each is layered back on individually after the block wins or falls
    back to config.json's triage block as a whole. */
export function loadTriageConfig(
  configPath: string = join(import.meta.dir, "..", "..", "config.json"),
  resolve: GetSettingFn = getSetting,
): TriageConfig {
  const cfg = JSON.parse(readFileSync(configPath, "utf8")) as { triage?: unknown };
  const fileConfig = parseTriageBlock(cfg.triage);

  const storeRaw = storeValue<unknown>("board.triage", resolve);
  const merged = storeRaw !== undefined
    ? { ...fileConfig, ...parseTriageBlock(storeRaw), doctorSkill: fileConfig.doctorSkill, maxConcurrent: fileConfig.maxConcurrent }
    : fileConfig;

  const doctorSkill = storeValue<string>("board.triage.doctorSkill", resolve);
  const maxConcurrent = storeValue<number>("board.triageMaxConcurrent", resolve);
  merged.doctorSkill = typeof doctorSkill === "string" ? doctorSkill : merged.doctorSkill;
  merged.maxConcurrent = typeof maxConcurrent === "number" && maxConcurrent > 0 ? maxConcurrent : merged.maxConcurrent;

  return merged;
}
