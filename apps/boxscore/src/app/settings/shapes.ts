/**
 * The shape layer boxscore's settings page needs for its composite (array/
 * object) rt keys. Mirrors board's `config-shapes.ts` pattern: rt validates
 * only a key's top-level type, so every control here is typed to make a
 * value the next daemon reload would reject unproducible.
 */
import type { SettingDefWire } from "@mattstack/settings-kit/react";

export type ConfigDef = SettingDefWire;

export type LeafType = "string" | "number";

export type CompositeShape =
  | { kind: "stringList" }
  | { kind: "leaves"; fields: Record<string, LeafType> }
  | { kind: "roster" };

export const COMPOSITE_SHAPES: Record<string, CompositeShape> = {
  "mattstack.roster": { kind: "roster" },
  "boxscore.projects": { kind: "stringList" },
  "boxscore.linearDoneStates": { kind: "stringList" },
  "boxscore.excludeFilePatterns": { kind: "stringList" },
  "boxscore.ignoredMrs": { kind: "stringList" },
  "boxscore.botPatterns": { kind: "stringList" },
  "boxscore.hiddenMembers": { kind: "stringList" },
  "boxscore.sizeBand": { kind: "leaves", fields: { tooSmall: "number", tooLarge: "number" } },
};

/** boxscore.defaultRange is a plain string key; it renders as a select over
    the range presets rather than a free-text field. */
const SELECT_KEYS: Record<string, readonly string[]> = {
  "boxscore.defaultRange": ["7d", "30d", "90d"],
};

export type RowKind = "scalar" | "select" | CompositeShape["kind"] | "readonly";

export function rowKind(def: ConfigDef): RowKind {
  const shape = COMPOSITE_SHAPES[def.key];
  if (shape?.kind === "roster") return "roster";
  if (def.secret || !def.writable) return "readonly";
  if (SELECT_KEYS[def.key]) return "select";
  if (def.type === "object" || def.type === "array") return shape?.kind ?? "readonly";
  return "scalar";
}

export function selectOptions(def: ConfigDef): readonly string[] {
  return SELECT_KEYS[def.key] ?? [];
}

export function isSet(def: ConfigDef): boolean {
  const scope = def.effective.scope;
  return scope != null && scope !== "default";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function matchesLeaf(type: LeafType, v: unknown): boolean {
  return typeof v === type;
}

/** Whether a stored value still matches the shape the control expects. A
    mismatch (e.g. hand-edited store file) renders read-only rather than a
    control that would crash or silently mangle the value on save. */
export function matchesShape(shape: CompositeShape, value: unknown): boolean {
  switch (shape.kind) {
    case "stringList":
      return Array.isArray(value) && value.every((x) => typeof x === "string");
    case "leaves":
      return (
        isRecord(value) &&
        Object.entries(shape.fields).every(([path, type]) => {
          const v = value[path];
          return v === undefined || matchesLeaf(type, v);
        })
      );
    case "roster":
      return Array.isArray(value);
  }
}

export function getLeaf(obj: unknown, path: string): unknown {
  return isRecord(obj) ? obj[path] : undefined;
}

/** The next object after setting one leaf, as a shallow copy -- callers
    write this whole object back, never the single leaf. */
export function setLeaf(obj: unknown, path: string, value: unknown): Record<string, unknown> {
  const base = isRecord(obj) ? { ...obj } : {};
  base[path] = value;
  return base;
}

export function formatValue(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

export interface RosterEntry {
  username: string;
  name?: string;
}

export function asRosterEntries(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return [];
  const out: RosterEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.username !== "string" || entry.username === "") continue;
    out.push(typeof entry.name === "string" && entry.name !== "" ? { username: entry.username, name: entry.name } : { username: entry.username });
  }
  return out;
}
