/**
 * Runtime schema checks for composite settings, over the JSON Schema the
 * registry attaches from the lock. The full schema describes the value a
 * reader receives; a deep-merge layer is checked against the derived layer
 * schema (object properties optional, array items whole) so a store that
 * sets one field is not refused. The same validator runs in the browser.
 */

import { Validator, type OutputUnit } from "@cfworker/json-schema";
import type { SettingDef } from "./registry-machinery.ts";

export type JsonSchema = Record<string, unknown>;

/** A JSON Schema node is a plain object; excludes arrays and the `true`/`false` boolean subschemas. */
export const isSchema = (v: unknown): v is JsonSchema => v !== null && typeof v === "object" && !Array.isArray(v);

export interface SchemaIssue {
  path: (string | number)[];
  message: string;
}

export function hasSchema(def: SettingDef): def is SettingDef & { schema: JsonSchema } {
  return def.schema !== undefined;
}

/** Drops `required` at every object level except inside `items`/`prefixItems`. */
export function layerJsonSchema(json: JsonSchema): JsonSchema {
  return relax(json, false) as JsonSchema;
}

function relax(node: unknown, insideArray: boolean): unknown {
  if (Array.isArray(node)) return node.map((n) => relax(n, insideArray));
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "required" && !insideArray) continue;
    if (k === "items" || k === "prefixItems") out[k] = relax(v, true);
    else if (k === "properties" || k === "$defs" || k === "definitions") {
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, relax(pv, insideArray)]));
    } else out[k] = relax(v, insideArray);
  }
  return out;
}

const validators = new WeakMap<JsonSchema, Validator>();

function validatorFor(json: JsonSchema): Validator {
  let v = validators.get(json);
  if (!v) {
    v = new Validator(json as never, "2020-12", false);
    validators.set(json, v);
  }
  return v;
}

/** Browser and server share this: a JSON Schema check with rt's issue shape. */
export function validateJson(json: JsonSchema, value: unknown): SchemaIssue[] {
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

export function checkSchema(def: SettingDef, value: unknown, opts: { layer: boolean }): SchemaIssue[] {
  if (!hasSchema(def)) return [];
  const json = opts.layer && def.merge === "deep" && def.type === "object" ? (def.layerSchema ?? layerJsonSchema(def.schema)) : def.schema;
  return validateJson(json, value);
}

export function formatIssuePath(path: (string | number)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("");
}

export function firstIssueText(issues: SchemaIssue[]): string {
  const first = issues[0];
  return first ? `${formatIssuePath(first.path)}: ${first.message}` : "";
}
