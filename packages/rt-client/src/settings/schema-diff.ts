/**
 * Classifies a schema lock change as safe (every value the old schema
 * accepted is still accepted) or breaking. Zod-free so the compiled rt's
 * release preflight can import it; anything unrecognised that changed is
 * breaking.
 */

import BREAKING from "./breaking-schema-changes.json" with { type: "json" };
import type { JsonSchema } from "./schema.ts";

export type Lock = Record<string, { storeVersion: number; schema: JsonSchema }>;
export interface Change { key: string; kind: "safe" | "breaking"; detail: string }
type NodeChange = Omit<Change, "key">;

const ANNOTATIONS = new Set(["title", "description", "default", "$schema", "$id", "examples", "labels", "placeholder", "deprecated", "readOnly", "writeOnly"]);
const KNOWN = new Set(["type", "properties", "required", "additionalProperties", "propertyNames", "items", "prefixItems", "enum", "const", "anyOf", "oneOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"]);

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

export function checkLockAgainst(prev: Lock, next: Lock, acknowledged: Record<string, string>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const c of classifyLockDiff(prev, next)) {
    if (c.kind !== "breaking" || !(c.key in prev)) continue;
    // A removed key has no storeVersion left to bump; the acknowledgement is its only record.
    const bumped = !(c.key in next) || next[c.key]!.storeVersion > prev[c.key]!.storeVersion;
    if (!bumped) problems.push(`${c.key}: breaking (${c.detail}) without a storeVersion bump`);
    else if (!acknowledged[c.key]) problems.push(`${c.key}: breaking (${c.detail}) not acknowledged in breaking-schema-changes.json`);
  }
  return { ok: problems.length === 0, problems };
}

const isObject = (v: unknown): v is JsonSchema => typeof v === "object" && v !== null && !Array.isArray(v);
const openExtras = (v: unknown): boolean => v === undefined || v === true || (isObject(v) && Object.keys(v).length === 0);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const safeOnly = (a: JsonSchema, b: JsonSchema): boolean => diffNode(a, b, "").every((c) => c.kind === "safe");

/** const x and enum [x] accept the same values; comparing them as enums lets a const widen into an enum. */
function norm(s: JsonSchema): JsonSchema {
  const out = { ...s };
  if ("const" in out && !("enum" in out)) { out.enum = [out.const]; delete out.const; }
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
        else if (bv === false || !isObject(av)) verdict(false, "additionalProperties tightened");
        else out.push(...diffNode(av, bv as JsonSchema, `${at}[*]`));
        break;
      case "properties": {
        const ap = (av ?? {}) as Record<string, JsonSchema>, bp = (bv ?? {}) as Record<string, JsonSchema>;
        // A removed property's values fall through to the new additionalProperties, and an added
        // property's values used to be checked by the old one, so either side's extras schema can reject.
        const closed = !openExtras(b.additionalProperties);
        const prevExtrasSchema = isObject(a.additionalProperties) && !openExtras(a.additionalProperties);
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
        else if (isObject(av) && isObject(bv)) out.push(...diffNode(av, bv, `${at}[]`));
        else verdict(false, `${k} changed`);
        break;
      // Without prefixItems, items applies to the formerly prefixed elements too.
      case "prefixItems": verdict(bv === undefined && openExtras(b.items), `prefixItems ${bv === undefined ? "removed" : "changed"}`); break;
      case "anyOf":
        verdict(bv === undefined || (Array.isArray(av) && Array.isArray(bv) && av.every((x) => bv.some((y) => isObject(x) && isObject(y) && safeOnly(x, y)))), "anyOf changed");
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
