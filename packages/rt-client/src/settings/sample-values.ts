/**
 * Deterministic sample values for a JSON Schema over spec 1's keyword set,
 * for proving migrations. `gen` filters every candidate it returns against
 * the schema it was generated for, so a raw seed invalid for its own node
 * (0 under exclusiveMinimum 0, "" under minLength 1) never reaches a
 * caller's `full` object and silently invalidates every sibling variant
 * built on it. Branch lists are round-robin interleaved before any cap, so
 * a downstream slice always keeps at least one sample per branch and per
 * enum value rather than exhausting a wide first branch. A keyword this
 * generator cannot satisfy (a `pattern`, a `format`) yields fewer samples,
 * never a wrong one. Zod-free.
 */

import { canonicalJson } from "./migrate.ts";
import { isSchema, validateJson, type JsonSchema } from "./schema.ts";

const MAX_DEPTH = 6;

export function sampleValues(schema: JsonSchema, limit = 60): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const candidate of gen(schema, 0)) {
    const key = canonicalJson(candidate);
    if (seen.has(key) || validateJson(schema, candidate).length > 0) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= limit) break;
  }
  return out;
}

function gen(s: JsonSchema, depth: number): unknown[] {
  if (depth > MAX_DEPTH) return [];
  return genRaw(s, depth).filter((v) => validateJson(s, v).length === 0);
}

function genRaw(s: JsonSchema, depth: number): unknown[] {
  if ("const" in s) return [s.const];
  if (Array.isArray(s.enum)) return [...s.enum];
  const branches = Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : null;
  if (branches) return interleave((branches as JsonSchema[]).map((b) => gen(b, depth + 1)));
  const types = s.type === undefined ? inferTypes(s) : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
  return types.flatMap((t) => genType(t, s, depth));
}

/** Round-robin so a downstream cap never keeps every value of one branch over the next branch's own. */
function interleave(lists: unknown[][]): unknown[] {
  const max = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: unknown[] = [];
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

function inferTypes(s: JsonSchema): string[] {
  if (s.properties !== undefined || s.additionalProperties !== undefined || s.propertyNames !== undefined) return ["object"];
  if (s.items !== undefined || s.prefixItems !== undefined) return ["array"];
  return ["string", "number", "boolean", "null", "object", "array"];
}

function genType(t: string, s: JsonSchema, depth: number): unknown[] {
  switch (t) {
    case "string": {
      const min = typeof s.minLength === "number" ? s.minLength : 0;
      return ["", "value", "a".repeat(Math.max(min, 1))];
    }
    case "number":
    case "integer": {
      const bounds = [s.minimum, s.maximum];
      if (typeof s.exclusiveMinimum === "number") bounds.push(s.exclusiveMinimum + 1);
      if (typeof s.exclusiveMaximum === "number") bounds.push(s.exclusiveMaximum - 1);
      return [0, 1, -1, 2.5, ...bounds].filter((n): n is number => typeof n === "number" && (t === "number" || Number.isInteger(n)));
    }
    case "boolean":
      return [true, false];
    case "null":
      return [null];
    case "array":
      return genArray(s, depth);
    case "object":
      return genObject(s, depth);
    default:
      return [];
  }
}

function genArray(s: JsonSchema, depth: number): unknown[] {
  const prefix = Array.isArray(s.prefixItems) ? (s.prefixItems as JsonSchema[]).map((p) => gen(p, depth + 1)[0]) : [];
  const items = isSchema(s.items) ? gen(s.items, depth + 1) : s.items === false ? [] : ["value"];
  if (items.length === 0) return [prefix];
  const min = typeof s.minItems === "number" ? s.minItems : 0;
  const fill = (n: number, item: unknown) => [...prefix, ...Array.from({ length: n }, () => structuredClone(item))];
  return [fill(min, items[0]), ...items.map((item) => fill(Math.max(min, 1), item)), fill(Math.max(min, 2), items[0])];
}

function recordKey(s: JsonSchema): string {
  const names = isSchema(s.propertyNames) ? s.propertyNames : {};
  if (Array.isArray(names.enum) && typeof names.enum[0] === "string") return names.enum[0];
  if (typeof names.const === "string") return names.const;
  return "key";
}

function genObject(s: JsonSchema, depth: number): unknown[] {
  const props = (isSchema(s.properties) ? s.properties : {}) as Record<string, JsonSchema>;
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  const samples = Object.fromEntries(Object.entries(props).map(([k, p]) => [k, gen(p, depth + 1)]));
  const firstOf = (names: string[]) => Object.fromEntries(names.filter((n) => samples[n]!.length > 0).map((n) => [n, structuredClone(samples[n]![0])]));
  const minimal = firstOf(Object.keys(props).filter((n) => required.has(n)));
  const full = firstOf(Object.keys(props));
  const out: unknown[] = [minimal, full];
  for (const [name, values] of Object.entries(samples)) for (const v of values.slice(1)) out.push({ ...full, [name]: structuredClone(v) });
  const extras = s.additionalProperties;
  if (isSchema(extras) && Object.keys(extras).length > 0) {
    for (const v of gen(extras, depth + 1)) out.push({ ...full, [recordKey(s)]: v });
  } else if (extras === undefined || extras === true || (isSchema(extras) && Object.keys(extras).length === 0)) {
    out.push({ ...full, extraProperty: "extra" });
  }
  return out;
}
