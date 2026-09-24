/**
 * Composite value shapes and the pure helpers every settings UI shares.
 * Headless and import-free at runtime, so a browser bundle and the server's
 * write gate load the same declarations.
 */
import type { SettingDefWire } from "./server.ts";

export type LeafType = "string" | "number" | "boolean" | { enum: readonly string[] };

export type CompositeShape =
  | { kind: "stringList" }
  | { kind: "pairList"; fields: readonly [string, string] }
  | { kind: "stringMap"; labels: readonly [string, string] }
  | { kind: "leaves"; fields: Record<string, LeafType>; fallbacks?: Record<string, string> }
  | { kind: "external"; app: string };

export type RowKind = "scalar" | "enum" | CompositeShape["kind"] | "readonly";

/** Mirrors NOTIFICATION_TYPES in rt's lib/notifier.ts; a parity test in
    lib/__tests__ fails when the two drift. */
export const NOTIFICATION_EVENTS = [
  "pipeline_failed", "pipeline_passed", "mr_approved", "mr_merged", "mr_closed", "mr_ready",
  "merge_conflicts", "needs_rebase", "merge_error", "new_comment", "stale_port", "runaway_process",
  "evidence_batch_ready", "evidence_failed", "chat_mention", "credential_health", "member_joined",
] as const;

/** board's slack-emoji.ts DEFAULT_SLACK_EMOJI; board asserts parity. */
export const DEFAULT_SLACK_EMOJI = { looking: "eyes", commented: "speech_balloon", approved: "white_check_mark" } as const;

const SNAPSHOT_FIELDS = {
  enabled: "boolean", debounceSec: "number", pushDelaySec: "number",
  janitorThresholdHours: "number", janitorIntervalMin: "number",
} as const satisfies Record<string, LeafType>;

const STRING_LIST = { kind: "stringList" } as const;
const BOARD_EDITOR = { kind: "external", app: "board" } as const;

export const SHAPES: Record<string, CompositeShape> = {
  "board.projects": STRING_LIST,
  "board.botUsernames": STRING_LIST,
  "board.ticketPrefixes": STRING_LIST,
  "board.workspaces": { kind: "leaves", fields: { reviews: "string", responds: "string", doctors: "string" } },
  "board.cwds": { kind: "leaves", fields: { review: "string", respond: "string", doctor: "string" } },
  "board.slack": {
    kind: "leaves",
    fields: {
      channel: "string", singleTemplate: "string", multiHeader: "string", multiItem: "string",
      autoResolveIntervalMinutes: "number",
      "emoji.looking": "string", "emoji.commented": "string", "emoji.approved": "string",
    },
    fallbacks: {
      "emoji.looking": DEFAULT_SLACK_EMOJI.looking,
      "emoji.commented": DEFAULT_SLACK_EMOJI.commented,
      "emoji.approved": DEFAULT_SLACK_EMOJI.approved,
    },
  },
  "board.triage": {
    kind: "leaves",
    fields: {
      enabled: "boolean", cooldownMinutes: "number", dailyAttemptBudget: "number",
      notify: { enum: ["rt", "badge-only"] }, tier: { enum: ["api", "checkout"] },
      "fixClasses.retryFlake": "boolean", "fixClasses.inheritedNoteDraft": "boolean",
      "fixClasses.cleanApiRebase": "boolean", "fixClasses.mechanicalLint": "boolean",
      "fixClasses.codeFix": "boolean",
    },
  },
  "board.reReview": { kind: "leaves", fields: { enabled: "boolean" } },
  "board.tabs": BOARD_EDITOR,
  "board.members": BOARD_EDITOR,
  "board.hiddenMembers": BOARD_EDITOR,
  "rt.homeSnapshot": { kind: "leaves", fields: { ...SNAPSHOT_FIELDS } },
  "rt.teamSnapshot": { kind: "leaves", fields: { ...SNAPSHOT_FIELDS, pullIntervalSec: "number" } },
  "rt.gitStatus": { kind: "leaves", fields: { sweep: "boolean", sweepIntervalSec: "number", fetchIntervalSec: "number" } },
  "rt.worktreeApp": {
    kind: "leaves",
    fields: { enabled: "boolean", killProcesses: "boolean", claudeHook: { enum: ["installed", "declined"] } },
  },
  "rt.notifications": {
    kind: "leaves",
    fields: Object.fromEntries(NOTIFICATION_EVENTS.map((k) => [k, "boolean" as const])),
  },
  "rt.repoRoots": STRING_LIST,
  "rt.trustedBrowserOrigins": STRING_LIST,
  "setup.waived": STRING_LIST,
  "rt.repoIdentityOverrides": { kind: "stringMap", labels: ["remote URL", "identity"] },
  "boxscore.projects": STRING_LIST,
  "boxscore.linearDoneStates": STRING_LIST,
  "boxscore.excludeFilePatterns": STRING_LIST,
  "boxscore.ignoredMrs": STRING_LIST,
  "boxscore.botPatterns": STRING_LIST,
  "boxscore.sizeBand": { kind: "leaves", fields: { tooSmall: "number", tooLarge: "number" } },
  "gitq.workSlots": { kind: "leaves", fields: { workSlotLocation: "string", maxWorkSlots: "number" } },
};

export const ENUMS: Record<string, readonly string[]> = {
  "agent.provider": ["claude", "codex"],
  "rt.logLevel": ["trace", "debug", "info", "warn", "error"],
  "boxscore.defaultRange": ["7d", "30d", "90d"],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function matchesLeaf(type: LeafType, v: unknown): boolean {
  if (typeof type === "string") return typeof v === type;
  return typeof v === "string" && type.enum.includes(v);
}

/** Owning apps validate `external` values themselves; the kit cannot. */
export function matchesShape(shape: CompositeShape, value: unknown): boolean {
  switch (shape.kind) {
    case "stringList":
      return Array.isArray(value) && value.every((x) => typeof x === "string");
    case "pairList":
      return Array.isArray(value) && value.every((x) => isRecord(x) && shape.fields.every((f) => typeof x[f] === "string"));
    case "stringMap":
      return isRecord(value) && Object.values(value).every((x) => typeof x === "string");
    case "leaves":
      return (
        isRecord(value) &&
        Object.entries(shape.fields).every(([path, type]) => {
          if (!parentsAreRecords(value, path)) return false;
          const v = getLeaf(value, path);
          return v === undefined || matchesLeaf(type, v);
        })
      );
    case "external":
      return true;
  }
}

/** getLeaf reads a non-object parent as an absent leaf; the write gate must
    not, since the owning app's loader throws on it. A missing parent is fine. */
function parentsAreRecords(obj: Record<string, unknown>, path: string): boolean {
  let cur: unknown = obj;
  for (const part of path.split(".").slice(0, -1)) {
    cur = (cur as Record<string, unknown>)[part];
    if (cur === undefined) return true;
    if (!isRecord(cur)) return false;
  }
  return true;
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

export function filterDefs<T extends { key: string; description: string }>(defs: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return defs;
  return defs.filter((d) => d.key.toLowerCase().includes(q) || d.description.toLowerCase().includes(q));
}

export function isSet(def: SettingDefWire): boolean {
  const scope = def.effective.scope;
  return scope != null && scope !== "default";
}

export function formatValue(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

export function rowKind(def: SettingDefWire): RowKind {
  const shape = SHAPES[def.key];
  if (shape?.kind === "external") return "external";
  if (def.secret || !def.writable) return "readonly";
  if (def.type === "object" || def.type === "array") return shape?.kind ?? "readonly";
  if (ENUMS[def.key]) return "enum";
  return "scalar";
}

function nouns(key: string): [singular: string, plural: string] {
  const segment = key.split(".").at(-1) ?? key;
  const plural = (segment.split(/(?=[A-Z])/).at(-1) ?? segment).toLowerCase();
  if (plural.endsWith("ixes")) return [plural.slice(0, -2), plural];
  if (plural.endsWith("s")) return [plural.slice(0, -1), plural];
  return [plural, plural];
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The one-line collapsed form of a composite row. */
export function summarize(def: SettingDefWire): string {
  const shape = SHAPES[def.key];
  const v = def.effective.value;
  if (!shape || shape.kind === "external") {
    if (Array.isArray(v)) return count(v.length, ...nouns(def.key));
    if (isRecord(v)) return count(Object.keys(v).length, "field", "fields");
    return "unset";
  }
  switch (shape.kind) {
    case "stringList":
      return count(Array.isArray(v) ? v.length : 0, ...nouns(def.key));
    case "pairList":
      return count(Array.isArray(v) ? v.length : 0, "entry", "entries");
    case "stringMap":
      return count(isRecord(v) ? Object.keys(v).length : 0, "entry", "entries");
    case "leaves": {
      const paths = Object.keys(shape.fields);
      const source = def.merge === "deep" && def.type === "object" ? def.effective.authored : v;
      const set = paths.filter((p) => getLeaf(source, p) !== undefined).length;
      return `${set} of ${paths.length} set`;
    }
  }
}

/** Where an edit lands: the winning layer when the key allows it there,
    else the key's first allowed scope. */
export function targetScope(def: SettingDefWire): string {
  const scope = def.effective.scope;
  return scope !== null && (def.scopes as readonly string[]).includes(scope) ? scope : def.scopes[0]!;
}
