import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "../config.js";
import type { AppSettings } from "../shared/types.js";

const SETTINGS_PATH = "settings.json";

let cached: AppSettings | null = null;

function configDefaults(): AppSettings {
  return {
    linearTeam: "",
    doneStates: [],
    users: [...config.users],
    currentUser: config.currentUser,
    sizeBand: { ...config.sizeBand },
    bots: {
      extraPatterns: [],
    },
    excludeFilePatterns: [],
    ignoredMrs: [],
  };
}

/** Merge source into target, shallow per section. */
function merge(target: AppSettings, source: Partial<AppSettings>): AppSettings {
  if (source.linearTeam !== undefined) target.linearTeam = source.linearTeam;
  if (source.doneStates !== undefined) target.doneStates = source.doneStates;
  if (source.users !== undefined) target.users = source.users;
  if (source.currentUser !== undefined) target.currentUser = source.currentUser;
  if (source.sizeBand) {
    target.sizeBand = { ...target.sizeBand, ...source.sizeBand };
  }
  if (source.bots) {
    target.bots = { ...target.bots, ...source.bots };
  }
  if (source.excludeFilePatterns !== undefined) target.excludeFilePatterns = source.excludeFilePatterns;
  if (source.ignoredMrs !== undefined) target.ignoredMrs = source.ignoredMrs;
  return target;
}

/** Validate partial settings, throwing a descriptive error on failure. */
function validate(partial: Partial<AppSettings>): void {
  if (partial.linearTeam !== undefined) {
    if (typeof partial.linearTeam !== "string") {
      throw new Error("linearTeam must be a string");
    }
  }
  if (partial.doneStates !== undefined) {
    if (!Array.isArray(partial.doneStates)) {
      throw new Error("doneStates must be an array");
    }
  }
  if (partial.users !== undefined) {
    if (!Array.isArray(partial.users) || partial.users.length === 0) {
      throw new Error("users must be a non-empty array");
    }
  }
  if (partial.currentUser !== undefined) {
    const users = partial.users ?? [];
    if (typeof partial.currentUser !== "string" || !users.includes(partial.currentUser)) {
      throw new Error("currentUser must be a string in the users list");
    }
  }
  if (partial.sizeBand) {
    const tooSmall = partial.sizeBand.tooSmall;
    const tooLarge = partial.sizeBand.tooLarge;
    if (tooSmall !== undefined) {
      if (typeof tooSmall !== "number" || tooSmall <= 0) throw new Error("tooSmall must be > 0");
    }
    if (tooLarge !== undefined) {
      if (typeof tooLarge !== "number" || tooLarge <= 0) throw new Error("tooLarge must be > 0");
    }
    if (tooSmall !== undefined && tooLarge !== undefined && tooSmall >= tooLarge) {
      throw new Error("tooSmall must be less than tooLarge");
    }
  }
  if (partial.bots?.extraPatterns !== undefined) {
    if (!Array.isArray(partial.bots.extraPatterns)) {
      throw new Error("extraPatterns must be an array");
    }
  }
  if (partial.excludeFilePatterns !== undefined) {
    if (!Array.isArray(partial.excludeFilePatterns)) {
      throw new Error("excludeFilePatterns must be an array");
    }
  }
  if (partial.ignoredMrs !== undefined) {
    if (!Array.isArray(partial.ignoredMrs)) {
      throw new Error("ignoredMrs must be an array");
    }
  }
}

function readFromFile(): AppSettings | null {
  try {
    if (!existsSync(SETTINGS_PATH)) return null;
    const raw = readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    if (typeof parsed !== "object" || parsed === null) return null;
    return merge(configDefaults(), parsed);
  } catch {
    return null;
  }
}

function writeToFile(s: AppSettings): void {
  try {
    writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n", "utf8");
  } catch {
    console.error("[settings] failed to write settings.json");
  }
}

/** Defensive copy so callers can't mutate the in-memory cache through the result. */
function clone(s: AppSettings): AppSettings {
  return {
    ...s,
    users: [...s.users],
    sizeBand: { ...s.sizeBand },
    bots: { ...s.bots },
    excludeFilePatterns: [...s.excludeFilePatterns],
    ignoredMrs: [...s.ignoredMrs],
  };
}

/** Returns the original defaults from config.ts. */
export function getDefaults(): AppSettings {
  return configDefaults();
}

/** Read settings from the file on first call, then cache in memory. */
export function getSettings(): AppSettings {
  if (!cached) {
    cached = readFromFile() ?? configDefaults();
  }
  return clone(cached);
}

/**
 * Deep-merge the partial into current settings, validate, persist, and update cache.
 * Returns the full merged settings.
 */
export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  validate(partial);
  const current = cached ?? readFromFile() ?? configDefaults();
  const merged = merge(current, partial);
  writeToFile(merged);
  cached = merged;
  return clone(merged);
}
