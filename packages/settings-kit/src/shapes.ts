/**
 * Composite value shapes and the pure helpers every settings UI shares.
 * Headless and import-free at runtime, so a browser bundle and the server's
 * write gate load the same declarations. `recognize` derives the editor kind
 * from a def's JSON Schema; `SHAPES` now only carries the keys an owning
 * app's own editor handles (`external`), never a schema-derivable kind.
 */
import type { SettingDefWire } from "./server.ts";
import { Validator, type OutputUnit } from "@cfworker/json-schema";

export type LeafType = "string" | "number" | "boolean" | { enum: readonly string[] };

export type CompositeShape =
  | { kind: "stringList" }
  | { kind: "pairList"; fields: readonly [string, string] }
  | { kind: "stringMap"; labels: readonly [string, string] }
  | { kind: "leaves"; fields: Record<string, LeafType>; fallbacks?: Record<string, string> }
  | { kind: "external"; app: string };

export type RowKind = "scalar" | "enum" | "readonly" | CompositeShape["kind"] | "objectList" | "objectMap" | "json";

export type JsonSchema = Record<string, unknown>;

export interface SchemaIssue {
  path: (string | number)[];
  message: string;
}

export type Recognized =
  | { kind: "stringList" }
  | { kind: "stringMap"; labels: [string, string] }
  | { kind: "leaves"; fields: Record<string, LeafType>; placeholders: Record<string, string> }
  | { kind: "objectList"; itemFields: Record<string, LeafType>; required: string[] }
  | { kind: "objectMap"; entryFields: Record<string, LeafType>; required: string[]; labels: [string, string] }
  | { kind: "json" };

function leafOf(s: JsonSchema): LeafType | null {
  if (Array.isArray(s.enum) && s.enum.every((e) => typeof e === "string")) return { enum: s.enum as string[] };
  if (s.type === "string" || s.type === "number" || s.type === "boolean") return s.type;
  if (Array.isArray(s.type)) {
    const t = (s.type as string[]).filter((x) => x !== "null");
    if (t.length === 1) return leafOf({ ...s, type: t[0] });
  }
  return null;
}

function flatFields(props: Record<string, JsonSchema> | undefined): Record<string, LeafType> | null {
  if (!props) return null;
  const out: Record<string, LeafType> = {};
  for (const [k, v] of Object.entries(props)) {
    const leaf = leafOf(v);
    if (!leaf) return null;
    out[k] = leaf;
  }
  return out;
}

/** Dotted leaf paths one level deep (emoji.looking), the way leaves rows render. */
function leafPaths(props: Record<string, JsonSchema>, prefix = ""): { fields: Record<string, LeafType>; placeholders: Record<string, string> } | null {
  const fields: Record<string, LeafType> = {};
  const placeholders: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const leaf = leafOf(v);
    if (leaf) {
      fields[prefix + k] = leaf;
      if (typeof v.placeholder === "string") placeholders[prefix + k] = v.placeholder;
      continue;
    }
    if (v.type === "object" && v.properties && prefix === "") {
      const nested = leafPaths(v.properties as Record<string, JsonSchema>, `${k}.`);
      if (!nested) return null;
      Object.assign(fields, nested.fields);
      Object.assign(placeholders, nested.placeholders);
      continue;
    }
    return null;
  }
  return { fields, placeholders };
}

/** The one place a def's editor kind is derived: every RowKind/summarize
    caller reads a schema through this rather than re-inspecting it. */
export function recognize(schema: JsonSchema | undefined): Recognized {
  if (!schema) return { kind: "json" };
  const labels = schema.labels as { key?: string; value?: string } | undefined;
  const labelPair: [string, string] = [labels?.key ?? "key", labels?.value ?? "value"];
  if (schema.type === "array") {
    const items = schema.items as JsonSchema | undefined;
    if (items?.type === "string") return { kind: "stringList" };
    if (items?.type === "object") {
      const fields = flatFields(items.properties as Record<string, JsonSchema> | undefined);
      if (fields) return { kind: "objectList", itemFields: fields, required: (items.required as string[]) ?? [] };
    }
    return { kind: "json" };
  }
  if (schema.type === "object") {
    const add = schema.additionalProperties as JsonSchema | boolean | undefined;
    const props = schema.properties as Record<string, JsonSchema> | undefined;
    if ((!props || Object.keys(props).length === 0) && add && typeof add === "object" && Object.keys(add).length > 0) {
      if (add.type === "string") return { kind: "stringMap", labels: labelPair };
      if (add.type === "object") {
        const fields = flatFields(add.properties as Record<string, JsonSchema> | undefined);
        if (fields) return { kind: "objectMap", entryFields: fields, required: (add.required as string[]) ?? [], labels: labelPair };
      }
      return { kind: "json" };
    }
    const leaves = leafPaths(props ?? {});
    if (leaves) return { kind: "leaves", ...leaves };
  }
  return { kind: "json" };
}

// Duplicated from rt-client's settings/schema.ts rather than imported: this
// module builds into the browser bundle, which never pulls in rt-client. The
// two copies are pinned together by a parity test over shared fixtures.
const validators = new WeakMap<JsonSchema, Validator>();

function validatorFor(json: JsonSchema): Validator {
  let v = validators.get(json);
  if (!v) {
    v = new Validator(json as never, "2020-12", false);
    validators.set(json, v);
  }
  return v;
}

export function checkValue(json: JsonSchema, value: unknown): SchemaIssue[] {
  const out = validatorFor(json).validate(value);
  return out.valid ? [] : toIssues(out.errors);
}

const SUMMARY_KEYWORDS = new Set(["properties", "items", "additionalProperties", "prefixItems", "allOf", "anyOf", "oneOf", "propertyNames"]);

/** cfworker reports outer-first with a summary unit per container; only the deepest units are issues. */
function toIssues(units: OutputUnit[]): SchemaIssue[] {
  const leaves = units.filter(
    (u) => !SUMMARY_KEYWORDS.has(u.keyword) && !units.some((o) => o !== u && o.instanceLocation.startsWith(`${u.instanceLocation}/`)),
  );
  return leaves.map((u) => {
    const path = pointerToPath(u.instanceLocation);
    if (u.keyword === "required") {
      const name = /required property "([^"]+)"/.exec(u.error)?.[1];
      return { path: name ? [...path, name] : path, message: `required property "${name ?? "?"}" is missing` };
    }
    if (u.keyword === "type") {
      const m = /type "([^"]+)" is invalid\. Expected "([^"]+)"/.exec(u.error);
      return { path, message: m ? `expected ${m[2]}, got ${m[1]}` : u.error };
    }
    // An `additionalProperties: false` extra surfaces as a unit whose keyword is the
    // literal "false" (the boolean subschema), located at the extra property itself.
    if (u.keyword === "false") {
      return { path, message: `unexpected property "${String(path.at(-1) ?? "")}"` };
    }
    if (u.keyword === "minimum" || u.keyword === "maximum" || u.keyword === "exclusiveMinimum" || u.keyword === "exclusiveMaximum") {
      const bound = /(-?\d+(?:\.\d+)?)\.?$/.exec(u.error)?.[1] ?? "?";
      const op = u.keyword === "minimum" ? ">=" : u.keyword === "maximum" ? "<=" : u.keyword === "exclusiveMinimum" ? ">" : "<";
      return { path, message: `must be ${op} ${bound}` };
    }
    if (u.keyword === "enum") {
      // cfworker: `Instance does not match any of ["a","b"].`
      const raw = /(\[.*\])/.exec(u.error)?.[1];
      let list = "";
      try { list = raw ? (JSON.parse(raw) as unknown[]).map(String).join(", ") : ""; } catch { list = raw ?? ""; }
      return { path, message: `expected one of ${list}` };
    }
    if (u.keyword === "const") {
      // cfworker: `Instance does not match "human".`
      const want = /does not match (.+?)\.?$/.exec(u.error)?.[1]?.replace(/^"|"$/g, "") ?? "";
      return { path, message: `expected "${want}"` };
    }
    return { path, message: u.error };
  });
}

// cfworker builds instanceLocation with encodeURI over the escaped pointer, so
// each segment is URI-decoded before the ~1/~0 unescape.
function pointerToPath(pointer: string): (string | number)[] {
  return pointer
    .replace(/^#\/?/, "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => decodeURIComponent(s).replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/** True only when the value passes the def's own schema (its layer schema
    when it has one). False, never thrown, for a def with no schema at all. */
export function matchesSchema(def: SettingDefWire, value: unknown): boolean {
  const schema = def.layerSchema ?? def.schema;
  if (!schema) return false;
  return checkValue(schema, value).length === 0;
}

/** Mirrors NOTIFICATION_TYPES in rt's lib/notifier.ts; a parity test in
    lib/__tests__ fails when the two drift. */
export const NOTIFICATION_EVENTS = [
  "pipeline_failed", "pipeline_passed", "mr_approved", "mr_merged", "mr_closed", "mr_ready",
  "merge_conflicts", "needs_rebase", "merge_error", "new_comment", "stale_port", "runaway_process",
  "evidence_batch_ready", "evidence_failed", "chat_mention", "credential_health", "member_joined",
  "worktree_triage",
] as const;

/** board's slack-emoji.ts DEFAULT_SLACK_EMOJI; board asserts parity. */
export const DEFAULT_SLACK_EMOJI = { looking: "eyes", commented: "speech_balloon", approved: "white_check_mark" } as const;

const BOARD_EDITOR = { kind: "external", app: "board" } as const;

/** Every other composite key's editor kind now comes from `recognize(def.schema)`.
    Only a key whose value board's own UI owns end to end stays here. */
export const SHAPES: Record<string, CompositeShape> = {
  "board.tabs": BOARD_EDITOR,
  "board.members": BOARD_EDITOR,
  "board.hiddenMembers": BOARD_EDITOR,
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
  if (SHAPES[def.key]?.kind === "external") return "external";
  if (def.secret || !def.writable) return "readonly";
  if (def.type === "object" || def.type === "array") return recognize(def.schema).kind;
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

/** The one-line collapsed form of a composite row. An `external` key (no
    schema-derivable kind of its own) falls through to the same generic count
    `json` uses below. */
export function summarize(def: SettingDefWire): string {
  const v = def.effective.value;
  const r = recognize(def.schema);
  switch (r.kind) {
    case "stringList":
      return count(Array.isArray(v) ? v.length : 0, ...nouns(def.key));
    case "stringMap":
      return count(isRecord(v) ? Object.keys(v).length : 0, "entry", "entries");
    case "leaves": {
      const paths = Object.keys(r.fields);
      const source = def.merge === "deep" && def.type === "object" ? def.effective.authored : v;
      const set = paths.filter((p) => getLeaf(source, p) !== undefined).length;
      return `${set} of ${paths.length} set`;
    }
    case "objectList":
      return count(Array.isArray(v) ? v.length : 0, ...nouns(def.key));
    case "objectMap":
      return count(isRecord(v) ? Object.keys(v).length : 0, "entry", "entries");
    case "json":
      if (Array.isArray(v)) return count(v.length, ...nouns(def.key));
      if (isRecord(v)) return count(Object.keys(v).length, "field", "fields");
      return "unset";
  }
}

/** Where an edit lands: the winning layer when the key allows it there,
    else the key's first allowed scope. */
export function targetScope(def: SettingDefWire): string {
  const scope = def.effective.scope;
  return scope !== null && (def.scopes as readonly string[]).includes(scope) ? scope : def.scopes[0]!;
}
