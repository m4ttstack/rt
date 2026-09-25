/**
 * `rt settings schema diff --draft`: for each key whose schema changed in a
 * breaking way since the previous lock, drafts its migrateFrom entry (the
 * previous version's schema rebuilt as zod, plus an up step), or, for a key
 * renamed with an equal schema, a RENAMES entry. An up step is drafted as
 * mechanical only when replaying its operations on the previous schema
 * reproduces the new schema exactly; anything else throws until written.
 * Authoring only.
 */

import { fileURLToPath } from "url";
import { classifyLockDiff, equivalentSchemas, type Lock, type LockEntry } from "./schema-diff.ts";
import { isSchema, type JsonSchema } from "./schema.ts";
import { zodSource } from "./zod-source.ts";

export const MIGRATIONS_INDEX_PATH = fileURLToPath(new URL("./migrations/index.ts", import.meta.url));
export const MIGRATION_SCHEMAS_PATH = fileURLToPath(new URL("./migrations/schemas.ts", import.meta.url));

export type Op =
  | { op: "rename"; path: string[]; from: string; to: string; schema: JsonSchema; required: boolean }
  | { op: "delete"; path: string[]; name: string }
  | { op: "default"; path: string[]; name: string; value: unknown; schema: JsonSchema }
  | { op: "optional"; path: string[]; name: string; schema: JsonSchema };

export type Draft =
  | { kind: "step"; key: string; version: number; schemaSource: string; upSource: string; notes: string[] }
  | { kind: "rename"; key: string; from: string; notes: string[] };

const propsOf = (s: JsonSchema) => (isSchema(s.properties) ? s.properties : {}) as Record<string, JsonSchema>;
const requiredOf = (s: JsonSchema) => new Set(Array.isArray(s.required) ? (s.required as string[]) : []);

export function draftMigrations(prev: Lock, next: Lock, isDeep: (key: string) => boolean = () => false): Draft[] {
  const drafts: Draft[] = [];
  const added = Object.keys(next).filter((k) => !(k in prev));
  for (const [old, was] of Object.entries(prev)) {
    if (old in next) continue;
    const heir = added.find((k) => equivalentSchemas(was.schema, next[k]!.schema));
    if (heir === undefined || next[heir]!.renamedFrom?.includes(old)) continue;
    const notes = next[heir]!.storeVersion === was.storeVersion ? [] : [`set storeVersion: ${was.storeVersion} on ${heir}; a renamed key keeps the old key's version`];
    drafts.push({ kind: "rename", key: heir, from: old, notes });
  }
  const breaking = new Set(classifyLockDiff(prev, next).filter((c) => c.kind === "breaking").map((c) => c.key));
  for (const key of [...breaking].sort()) {
    const was = prev[key];
    const now = next[key];
    if (!was || !now || now.migrateFrom?.[String(was.storeVersion)]) continue;
    drafts.push(draftStep(key, was, now, isDeep(key)));
  }
  return drafts;
}

function draftStep(key: string, was: LockEntry, now: LockEntry, deep: boolean): Draft {
  const version = was.storeVersion;
  const notes: string[] = [];
  if (now.storeVersion !== version + 1) notes.push(`set storeVersion: ${version + 1} on ${key} in registry-defs.ts`);
  const ops: Op[] = [];
  collectOps(was.schema, now.schema, [], ops);
  const schemaSource = zodSource(was.schema);
  if (ops.length === 0 || !equivalentSchemas(replay(was.schema, ops), now.schema)) {
    notes.push("not mechanical: write the up step by hand; the drafted one throws until you do");
    return { kind: "step", key, version, schemaSource, upSource: `() => {\n  throw new Error("TODO: migrate ${key} from version ${version}");\n}`, notes };
  }
  const kept = deep ? ops.filter((o) => o.op !== "default") : ops;
  if (kept.length < ops.length) notes.push("deep-merge key: a layer stays partial, so the new default belongs in the registry default, not in each layer");
  for (const o of ops) {
    if (o.op === "rename") notes.push(`drafted a rename of ${[...o.path, o.from].join(".")} to ${o.to}: confirm it is a rename, not a removal plus an addition`);
  }
  return { kind: "step", key, version, schemaSource, upSource: upSourceFor(kept), notes };
}

function collectOps(a: JsonSchema, b: JsonSchema, path: string[], ops: Op[]): void {
  if (a.type === "object" && b.type === "object") {
    const ap = propsOf(a);
    const bp = propsOf(b);
    const removed = Object.keys(ap).filter((p) => !(p in bp));
    const added = Object.keys(bp).filter((p) => !(p in ap));
    if (removed.length === 1 && added.length === 1 && equivalentSchemas(ap[removed[0]!]!, bp[added[0]!]!)) {
      ops.push({ op: "rename", path, from: removed[0]!, to: added[0]!, schema: bp[added[0]!]!, required: requiredOf(b).has(added[0]!) });
    } else {
      for (const name of removed) ops.push({ op: "delete", path, name });
      for (const name of added) {
        const schema = bp[name]!;
        if (!requiredOf(b).has(name)) ops.push({ op: "optional", path, name, schema });
        else if ("default" in schema) ops.push({ op: "default", path, name, value: schema.default, schema });
      }
    }
    for (const name of Object.keys(ap)) if (name in bp) collectOps(ap[name]!, bp[name]!, [...path, name], ops);
    if (Object.keys(ap).length === 0 && isSchema(a.additionalProperties) && isSchema(b.additionalProperties)) {
      collectOps(a.additionalProperties, b.additionalProperties, [...path, "{}"], ops);
    }
  }
  if (a.type === "array" && b.type === "array" && isSchema(a.items) && isSchema(b.items)) collectOps(a.items, b.items, [...path, "[]"], ops);
}

function nodeAt(root: JsonSchema, path: string[]): JsonSchema | undefined {
  let at: unknown = root;
  for (const seg of path) {
    if (!isSchema(at)) return undefined;
    at = seg === "[]" ? at.items : seg === "{}" ? at.additionalProperties : propsOf(at)[seg];
  }
  return isSchema(at) ? at : undefined;
}

function replay(schema: JsonSchema, ops: Op[]): JsonSchema {
  const root = structuredClone(schema);
  for (const o of ops) {
    const node = nodeAt(root, o.path);
    if (!node) continue;
    const hadRequired = Array.isArray(node.required);
    const props = (node.properties ??= {}) as Record<string, JsonSchema>;
    const req = requiredOf(node);
    if (o.op === "rename") {
      delete props[o.from];
      req.delete(o.from);
      props[o.to] = o.schema;
      if (o.required) req.add(o.to);
    } else if (o.op === "delete") {
      delete props[o.name];
      req.delete(o.name);
    } else if (o.op === "default") {
      props[o.name] = o.schema;
      req.add(o.name);
    } else {
      props[o.name] = o.schema;
    }
    if (req.size > 0 || hadRequired) node.required = [...req];
    else delete node.required;
  }
  return root;
}

function upSourceFor(ops: Op[]): string {
  const lines: string[] = [];
  for (const o of ops) {
    const path = JSON.stringify(o.path);
    if (o.op === "rename") lines.push(`  v = renameProperty(v, ${path}, ${JSON.stringify(o.from)}, ${JSON.stringify(o.to)});`);
    else if (o.op === "delete") lines.push(`  v = deleteProperty(v, ${path}, ${JSON.stringify(o.name)});`);
    else if (o.op === "default") lines.push(`  v = setDefault(v, ${path}, ${JSON.stringify(o.name)}, ${JSON.stringify(o.value)});`);
  }
  return ["(value) => {", "  let v = value;", ...lines, "  return v;", "}"].join("\n");
}

function insertAbove(text: string, marker: string, block: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.trim() === marker);
  if (at < 0) throw new Error(`draft marker "${marker}" not found`);
  const indent = /^\s*/.exec(lines[at]!)![0];
  return [...lines.slice(0, at), ...block.split("\n").map((l) => `${indent}${l}`), ...lines.slice(at)].join("\n");
}

export function applyDrafts(drafts: Draft[], files: { index: string; schemas: string }): { index: string; schemas: string } {
  let { index, schemas } = files;
  for (const d of drafts) {
    if (d.kind === "rename") {
      index = insertAbove(index, "// @draft-renames", `${JSON.stringify(d.key)}: [${JSON.stringify(d.from)}],`);
      continue;
    }
    index = insertAbove(index, "// @draft-steps", ["{", `  key: ${JSON.stringify(d.key)},`, `  version: ${d.version},`, `  up: ${d.upSource.split("\n").join("\n  ")},`, "},"].join("\n"));
    schemas = insertAbove(schemas, "// @draft-schemas", ["{", `  key: ${JSON.stringify(d.key)},`, `  version: ${d.version},`, `  schema: ${d.schemaSource},`, "  examples: [],", "},"].join("\n"));
  }
  return { index, schemas };
}
