/**
 * Classifies a schema lock change as safe (every value the old schema
 * accepted is still accepted) or breaking. Zod-free so the compiled rt's
 * release preflight can import it; anything unrecognised that changed is
 * breaking.
 */

import BREAKING from "./breaking-schema-changes.json" with { type: "json" };
import { isSchema, type JsonSchema } from "./schema.ts";

export type LockEntry = {
  storeVersion: number;
  schema: JsonSchema;
  /** Source schema of each migration step, keyed by the version it reads. */
  migrateFrom?: Record<string, JsonSchema>;
  renamedFrom?: string[];
};
export type Lock = Record<string, LockEntry>;
export interface Change { key: string; kind: "safe" | "breaking"; detail: string }
type NodeChange = Omit<Change, "key">;

const ANNOTATIONS = new Set(["title", "description", "default", "$schema", "$id", "examples", "labels", "placeholder", "deprecated", "readOnly", "writeOnly"]);
const KNOWN = new Set(["type", "properties", "required", "additionalProperties", "propertyNames", "items", "prefixItems", "enum", "const", "anyOf", "oneOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"]);

/** True only for git show's own "that path is not in this tree" failure; any other failure is a real error. */
export function isMissingPathAtRef(stderr: string): boolean {
  return /does not exist in '|exists on disk, but not in '/.test(stderr);
}

export function readBreakingChanges(): Record<string, string> {
  return BREAKING as Record<string, string>;
}

export function classifyLockDiff(prev: Lock, next: Lock): Change[] {
  const changes: Change[] = [];
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (!(key in prev)) { changes.push({ key, kind: "safe", detail: "key added" }); continue; }
    if (!(key in next)) { changes.push({ key, kind: "breaking", detail: "key removed" }); continue; }
    for (const c of diffNode(prev[key]!.schema, next[key]!.schema, "")) changes.push({ key, ...c });
  }
  return changes;
}

/** No classifier-visible difference either way: annotations ignored, const x the same as enum [x]. */
export function equivalentSchemas(a: JsonSchema, b: JsonSchema): boolean {
  return diffNode(a, b, "").length === 0 && diffNode(b, a, "").length === 0;
}

function firstDifference(a: JsonSchema, b: JsonSchema): string {
  return [...diffNode(a, b, ""), ...diffNode(b, a, "")][0]?.detail ?? "no difference";
}

export interface AcceptanceOpts {
  /** The lock at the latest release tag: a key absent from it has never shipped. Null or absent: every key has. */
  shipped?: Lock | null;
  /** "ci" diffs against main and allows one storeVersion step per key; "release" diffs against the tag, so the chain must span every version since. */
  mode?: "ci" | "release";
}

/**
 * A breaking change passes only with storeVersion bumped and a migrateFrom
 * entry for the previous version whose schema matches the previous lock's.
 * The breaking-schema-changes.json acknowledgement stands in for that only
 * for a key the shipped lock does not have, and only in CI; it also retires
 * a removed key that no key was renamed from.
 */
export function checkLockAgainst(prev: Lock, next: Lock, acknowledged: Record<string, string>, opts: AcceptanceOpts = {}): { ok: boolean; problems: string[] } {
  const mode = opts.mode ?? "ci";
  const against = mode === "ci" ? "the lock on main" : "the lock at the tag";
  const shipped = opts.shipped ?? null;
  const breaking = new Map<string, string>();
  for (const c of classifyLockDiff(prev, next)) if (c.kind === "breaking" && !breaking.has(c.key)) breaking.set(c.key, c.detail);
  const problems: string[] = [];
  for (const [key, was] of Object.entries(prev)) {
    const now = next[key];
    if (now === undefined) {
      const heir = Object.entries(next).find(([, e]) => e.renamedFrom?.includes(key));
      if (heir) problems.push(...chainProblems(`${heir[0]} (renamed from ${key})`, was, heir[1], mode, against));
      else if (!acknowledged[key]) problems.push(`${key}: removed with no key renamed from it and no entry in breaking-schema-changes.json`);
      continue;
    }
    if (now.storeVersion === was.storeVersion) {
      const detail = breaking.get(key);
      if (detail === undefined) continue;
      if (mode === "ci" && shipped !== null && !everShipped(key, was, now, shipped) && acknowledged[key]) continue;
      problems.push(`${key}: breaking (${detail}) needs storeVersion ${was.storeVersion + 1} and a migrateFrom entry for version ${was.storeVersion}`);
      continue;
    }
    problems.push(...chainProblems(key, was, now, mode, against));
  }
  return { ok: problems.length === 0, problems };
}

/** A key has shipped under its current name, or under any name it was renamed from on either side of this diff. */
function everShipped(key: string, was: LockEntry, now: LockEntry, shipped: Lock): boolean {
  if (key in shipped) return true;
  return [...(was.renamedFrom ?? []), ...(now.renamedFrom ?? [])].some((name) => name in shipped);
}

function chainProblems(label: string, was: LockEntry, now: LockEntry, mode: "ci" | "release", against: string): string[] {
  if (now.storeVersion === was.storeVersion) {
    return equivalentSchemas(was.schema, now.schema) ? [] : [`${label}: schema differs from ${against} (${firstDifference(was.schema, now.schema)}) with no storeVersion bump`];
  }
  if (now.storeVersion < was.storeVersion) return [`${label}: storeVersion went down (${was.storeVersion} -> ${now.storeVersion})`];
  if (mode === "ci" && now.storeVersion !== was.storeVersion + 1) return [`${label}: storeVersion ${was.storeVersion} -> ${now.storeVersion}; bump by one per change`];
  const out: string[] = [];
  for (let v = was.storeVersion; v < now.storeVersion; v++) {
    if (!now.migrateFrom?.[String(v)]) out.push(`${label}: no migrateFrom entry for version ${v}`);
  }
  const entry = now.migrateFrom?.[String(was.storeVersion)];
  if (entry && !equivalentSchemas(entry, was.schema)) {
    out.push(`${label}: the migrateFrom entry for version ${was.storeVersion} differs from ${against} (${firstDifference(was.schema, entry)})`);
  }
  return out;
}

const openExtras = (v: unknown): boolean => v === undefined || v === true || (isSchema(v) && Object.keys(v).length === 0);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const safeOnly = (a: JsonSchema, b: JsonSchema): boolean => diffNode(a, b, "").every((c) => c.kind === "safe");

/** const x and enum [x] accept the same values; required order never counts as a change. */
function norm(s: JsonSchema): JsonSchema {
  const out = { ...s };
  if ("const" in out && !("enum" in out)) { out.enum = [out.const]; delete out.const; }
  if (Array.isArray(out.required)) out.required = [...(out.required as string[])].sort();
  return out;
}

function diffNode(a0: JsonSchema, b0: JsonSchema, at: string): NodeChange[] {
  const a = norm(a0), b = norm(b0);
  const out: NodeChange[] = [];
  const where = at || "(root)";
  const verdict = (safe: boolean, detail: string) => out.push({ kind: safe ? "safe" : "breaking", detail: `${where}: ${detail}` });
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)].filter((x) => !ANNOTATIONS.has(x)))) {
    const av = a[k], bv = b[k];
    if (same(av, bv)) continue;
    if (!KNOWN.has(k)) { verdict(false, `${k} changed`); continue; }
    switch (k) {
      case "type": verdict(widens(av, bv), `type ${JSON.stringify(av)} -> ${JSON.stringify(bv)}`); break;
      case "enum": verdict(bv === undefined || superset(bv, av), "enum changed"); break;
      case "const": verdict(bv === undefined, "const changed"); break;
      case "required": {
        const added = ((bv as string[]) ?? []).filter((r) => !((av as string[]) ?? []).includes(r));
        verdict(added.length === 0, `required ${added.length ? `added ${added.join(",")}` : "relaxed"}`);
        break;
      }
      case "additionalProperties":
        if (openExtras(bv)) verdict(true, "additionalProperties loosened");
        else if (av === false) verdict(true, "additionalProperties loosened");
        else if (bv === false || !isSchema(av)) verdict(false, "additionalProperties tightened");
        else out.push(...diffNode(av, bv as JsonSchema, `${at}[*]`));
        break;
      case "properties": {
        const ap = (av ?? {}) as Record<string, JsonSchema>, bp = (bv ?? {}) as Record<string, JsonSchema>;
        // A removed property's values fall through to the new additionalProperties, and an added
        // property's values used to be checked by the old one, so either side's extras schema can reject.
        const closed = !openExtras(b.additionalProperties);
        const prevExtrasSchema = isSchema(a.additionalProperties) && !openExtras(a.additionalProperties);
        for (const p of new Set([...Object.keys(ap), ...Object.keys(bp)])) {
          const path = at ? `${at}.${p}` : p;
          if (!(p in ap)) out.push({ kind: prevExtrasSchema ? "breaking" : "safe", detail: `${path}: property added` });
          else if (!(p in bp)) out.push({ kind: closed ? "breaking" : "safe", detail: `${path}: property removed` });
          else out.push(...diffNode(ap[p]!, bp[p]!, path));
        }
        break;
      }
      case "items": case "propertyNames":
        if (bv === undefined) verdict(true, `${k} removed`);
        else if (isSchema(av) && isSchema(bv)) out.push(...diffNode(av, bv, `${at}[]`));
        else verdict(false, `${k} changed`);
        break;
      // Without prefixItems, items applies to the formerly prefixed elements too.
      case "prefixItems": verdict(bv === undefined && openExtras(b.items), `prefixItems ${bv === undefined ? "removed" : "changed"}`); break;
      case "anyOf":
        verdict(bv === undefined || (Array.isArray(av) && Array.isArray(bv) && av.every((x) => bv.some((y) => isSchema(x) && isSchema(y) && safeOnly(x, y)))), "anyOf changed");
        break;
      // An added branch can make a value match twice, which oneOf rejects.
      case "oneOf": verdict(bv === undefined, "oneOf changed"); break;
      case "minimum": case "exclusiveMinimum": case "minLength": case "minItems":
        verdict(bv === undefined || (av !== undefined && (bv as number) <= (av as number)), `${k} ${av} -> ${bv}`); break;
      case "maximum": case "exclusiveMaximum": case "maxLength": case "maxItems":
        verdict(bv === undefined || (av !== undefined && (bv as number) >= (av as number)), `${k} ${av} -> ${bv}`); break;
      case "pattern": case "format": verdict(bv === undefined, `${k} ${bv === undefined ? "removed" : "changed"}`); break;
    }
  }
  return out;
}

const asList = (t: unknown): string[] => (t === undefined ? [] : Array.isArray(t) ? (t as string[]) : [t as string]);

function widens(a: unknown, b: unknown): boolean {
  const A = asList(a), B = asList(b);
  if (B.length === 0) return true;
  return A.length > 0 && A.every((t) => B.includes(t) || (t === "integer" && B.includes("number")));
}

function superset(b: unknown, a: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) && a.every((x) => b.some((y) => same(x, y)));
}
