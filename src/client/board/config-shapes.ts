import type { SettingDefWire } from "@mattstack/settings-kit/react";

export type ConfigDef = SettingDefWire;

export type LeafType = "string" | "number" | "boolean" | { enum: readonly string[] };

export type CompositeShape =
  | { kind: "stringList" }
  | { kind: "pairList"; fields: readonly [string, string] }
  | { kind: "leaves"; fields: Record<string, LeafType> }
  | { kind: "roster" };

/** What the board knows about its own composite keys that the registry does
    not: rt validates only the top-level type, and `parseConfig` rejects a
    wrong leaf on the next reload, so every control here is typed to make a
    rejected write unproducible. `board.triage` deliberately omits
    doctorSkill and maxConcurrent — those live in sibling flat keys the
    reader overlays on top, so a nested copy would be silently ignored. */
export const COMPOSITE_SHAPES: Record<string, CompositeShape> = {
  "board.projects": { kind: "stringList" },
  "board.botUsernames": { kind: "stringList" },
  "board.ticketPrefixes": { kind: "stringList" },
  "board.rtRepos": { kind: "pairList", fields: ["project", "repo"] },
  "board.workspaces": { kind: "leaves", fields: { reviews: "string", responds: "string", doctors: "string" } },
  "board.cwds": { kind: "leaves", fields: { review: "string", respond: "string", doctor: "string" } },
  "board.slack": {
    kind: "leaves",
    fields: {
      channel: "string",
      singleTemplate: "string",
      multiHeader: "string",
      multiItem: "string",
      autoResolveIntervalMinutes: "number",
      "emoji.looking": "string",
      "emoji.commented": "string",
      "emoji.approved": "string",
    },
  },
  "board.triage": {
    kind: "leaves",
    fields: {
      enabled: "boolean",
      cooldownMinutes: "number",
      dailyAttemptBudget: "number",
      notify: { enum: ["rt", "badge-only"] },
      tier: { enum: ["api", "checkout"] },
      "fixClasses.retryFlake": "boolean",
      "fixClasses.inheritedNoteDraft": "boolean",
      "fixClasses.cleanApiRebase": "boolean",
      "fixClasses.mechanicalLint": "boolean",
      "fixClasses.codeFix": "boolean",
    },
  },
  "board.members": { kind: "roster" },
  "board.hiddenMembers": { kind: "roster" },
};

export type RowKind = "scalar" | CompositeShape["kind"] | "readonly";

export function rowKind(def: ConfigDef): RowKind {
  const shape = COMPOSITE_SHAPES[def.key];
  if (shape?.kind === "roster") return "roster";
  if (def.secret || !def.writable) return "readonly";
  if (def.type === "object" || def.type === "array") return shape?.kind ?? "readonly";
  return "scalar";
}

export function isSet(def: ConfigDef): boolean {
  const scope = def.effective.scope;
  return scope != null && scope !== "default";
}

export function scopeLabel(scope: string): string {
  return scope === "machine" ? "machine" : `${scope} · local until pushed`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function matchesLeaf(type: LeafType, v: unknown): boolean {
  if (typeof type === "string") return typeof v === type;
  return typeof v === "string" && type.enum.includes(v);
}

export function matchesShape(shape: CompositeShape, value: unknown): boolean {
  switch (shape.kind) {
    case "stringList":
      return Array.isArray(value) && value.every((x) => typeof x === "string");
    case "pairList":
      return Array.isArray(value) && value.every((x) => isRecord(x) && shape.fields.every((f) => typeof x[f] === "string"));
    case "leaves":
      return (
        isRecord(value) &&
        Object.entries(shape.fields).every(([path, type]) => {
          const v = getLeaf(value, path);
          return v === undefined || matchesLeaf(type, v);
        })
      );
    case "roster":
      return Array.isArray(value);
  }
}

export function getLeaf(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (!isRecord(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function setLeaf(obj: unknown, path: string, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split(".");
  const base = isRecord(obj) ? { ...obj } : {};
  if (rest.length === 0) {
    if (value === undefined) delete base[head!];
    else base[head!] = value;
    return base;
  }
  base[head!] = setLeaf(base[head!], rest.join("."), value);
  return base;
}

export function parseScalar(
  type: "string" | "number",
  text: string,
): { ok: true; value: string | number } | { ok: false; error: string } {
  if (type === "string") return { ok: true, value: text };
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "enter a number" };
  const n = Number(trimmed);
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "not a number" };
}

/** The next list after adding `entry`, or null when there is nothing to add. */
export function addToList(list: string[], entry: string): string[] | null {
  const trimmed = entry.trim();
  if (trimmed === "" || list.includes(trimmed)) return null;
  return [...list, trimmed];
}

export function filterDefs(defs: ConfigDef[], query: string): ConfigDef[] {
  const q = query.trim().toLowerCase();
  if (q === "") return defs;
  return defs.filter((d) => d.key.toLowerCase().includes(q) || d.description.toLowerCase().includes(q));
}

const SCOPE_ORDER = ["team", "user", "machine"] as const;

export function groupByScope(defs: ConfigDef[]): Array<{ scope: string; defs: ConfigDef[] }> {
  return SCOPE_ORDER.map((scope) => ({ scope, defs: defs.filter((d) => d.scopes[0] === scope) })).filter(
    (g) => g.defs.length > 0,
  );
}

export function rosterSummary(members: unknown, hidden: unknown): string {
  const roster = Array.isArray(members) ? members.filter(isRecord) : [];
  if (roster.length === 0) return "no members";
  const hiddenNames = new Set<string>(Array.isArray(hidden) ? hidden.filter((h) => typeof h === "string") : []);
  for (const m of roster) if (m.hidden === true && typeof m.username === "string") hiddenNames.add(m.username);
  const head = `${roster.length} member${roster.length === 1 ? "" : "s"}`;
  return hiddenNames.size > 0 ? `${head}, ${hiddenNames.size} hidden` : head;
}

export function formatValue(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}
