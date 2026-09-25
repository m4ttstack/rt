# Settings Schemas and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every composite settings key (type `object` or `array`, 55 of 103) gets a zod schema in the registry; every write is checked against it, reads only label; the schema, per-layer issues and repo resolution reach settings-kit's wire; a committed lock file plus a CI classifier blocks breaking schema changes.

**Architecture:** Schemas live beside the registry defs in `packages/rt-client` (zod v4 for authoring, `z.toJSONSchema` with `io: "input"` for the wire and the lock file). `validateValue` stays the resolver's skip rule; a new `checkSchema` labels and a new `validateWrite` gates every write (layer schema, then merged result). settings-kit gains `issues[]`, `repos[]`, `?repo=`, `GET /repos`, `checkValue`, and `recognize(schema)` replaces the hand-kept `SHAPES` table. A lock file generated from the registry is diffed in CI and at release preflight.

**Tech Stack:** Bun 1.4.2, TypeScript, zod ^4.6.5, @cfworker/json-schema ^4.1.1, jsonc-parser, bun:test.

**Spec:** `docs/superpowers/specs/2026-09-25-settings-schemas-design.md` (commit f7b8a6452). Read it first; every task below argues from it.

## Global Constraints

- Every def with `type: "object"` or `"array"` must carry `schema`; a registry test fails otherwise (spec: "Schemas in the registry").
- Schemas allow unknown extra properties (`z.looseObject`) unless a key genuinely rejects them (`z.strictObject`); they describe what readers accept.
- `validateValue` keeps its current behavior exactly (type check plus path guard). Reads never skip a value that fails only the schema.
- JSON Schema is always produced with `z.toJSONSchema(schema, { io: "input" })`.
- Layer checks (deep-merge keys) use the derived layer JSON Schema with `@cfworker/json-schema` on both server and browser; full-schema checks on the server use zod `safeParse`.
- Issue shape everywhere: `{ path: (string | number)[]; message: string }`; the first failing path is formatted `[0].pattern` / `emoji.looking` by `formatIssuePath`.
- Public export names that consumers already import from `@mattstack/settings-kit/shapes` keep their names: `SHAPES`, `ENUMS`, `NOTIFICATION_EVENTS`, `DEFAULT_SLACK_EMOJI`, `matchesShape`, `getLeaf`, `setLeaf`, `parseScalar`, `addToList`, `filterDefs`, `isSet`, `formatValue`, `rowKind`, `summarize`, `targetScope`.
- Commit trailer on every commit, verbatim: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Gate for every task, run bare (never piped through `tail`, `head` or `grep`; a pipe hides the exit code): `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test <the task's test files>`, plus `cd packages/rt-client && bun run build` after any rt-client source change (the dist-freshness test fails otherwise; see AGENTS.md).
- CI runs the full suite; locally run only the test files each task names (memory: CI runs the full suite).
- No real repo identities, team names or employer names in code, tests, fixtures or docs. Use `gitlab.example.com/acme/app`, team `acme`, the way `resolve.test.ts` does. `scripts/repo-purity.sh` is the gate.
- No em or en dashes in new text.
- Comments state constraints the code cannot show; no narration, no task numbers, no review history in source.
- Repo is a worktree: run every command from `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/bilbo`; never `cd` to the main checkout.

## Review Focus

1. A team store written by an older rt whose object carries an extra property of the wrong type (`{ "enabled": "yes" }` for `rt.homeSnapshot`) must resolve as before and be labeled `nonconforming`, never skipped. Pinned in Task 6.
2. `rt settings set rt.homeSnapshot '{"enabled":false}' --scope machine` (a partial deep layer) must succeed. Pinned in Task 2.
3. Every registry `default` must pass its own schema, and `[]` / `{}` must pass wherever a reader accepts an empty value. Pinned in Task 5.
4. A secret key's issues must never carry a value onto the wire. Pinned in Task 7.
5. A global write of a repo-scoped key must not be refused by a broken value that only exists in one repo section (the merged check refuses only when the merge fails where it passed before). Pinned in Task 2.

---

## File structure

**rt-client (`packages/rt-client`)**

- `package.json`: add `zod` and `@cfworker/json-schema` to `dependencies`; bump version in Task 11.
- `src/settings/registry-machinery.ts` (modify): `SettingDef` gains `schema?`, `storeVersion?`; re-exports nothing new.
- `src/settings/schema.ts` (create): JSON Schema conversion, layer derivation, `checkSchema`, `formatIssuePath`, `SchemaIssue`.
- `src/settings/registry-schemas.ts` (create): `SCHEMAS`, one zod schema per composite key, with `.meta()` display metadata.
- `src/settings/registry-defs.ts` (modify): each composite def gets `schema: SCHEMAS["<key>"]`.
- `src/settings/validate-write.ts` (create): `validateWrite`.
- `src/settings/resolve.ts` (modify): `nonconforming` on explain rows, `mergedIssues` on resolutions and listed settings, `mergedValueWith`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities`.
- `src/settings/write.ts` (modify): `setSetting` calls `validateWrite`.
- `src/settings/check.ts` (create): `checkStores` for `rt settings check`.
- `src/settings/schema-lock.ts` (create): `buildLock`, `classifyLockDiff`, `readBreakingChanges`.
- `settings-schema.lock.json` (create, committed, generated).
- `src/settings/breaking-schema-changes.json` (create): `{}` initially.
- `src/index.ts` (modify): export the new functions and types.
- Tests: `src/settings/__tests__/schema.test.ts`, `validate-write.test.ts`, `schema-examples.test.ts`, `check.test.ts`, `schema-lock.test.ts`; existing `registry.test.ts`, `resolve.test.ts`, `write.test.ts` gain cases; `test/index-surface.test.ts` gains the new exports.

**settings-kit (`packages/settings-kit`)**

- `package.json`: add `@cfworker/json-schema` to `dependencies`; peer `@mattstack/rt-client` floor moves to the version Task 11 sets; bump version in Task 11.
- `src/server.ts` (modify): wire fields, `?repo=`, `repo` in bodies, `GET /repos`, `unregistered`, `validateWrite`.
- `src/shapes.ts` (modify): `recognize`, `checkValue`, `SHAPES` shrinks to `external`.
- Tests: `src/__tests__/server.test.ts`, `shapes.test.ts` gain cases.

**rt CLI**

- `commands/settings-keys.ts` (modify): render `nonconforming`, add `settingsCheck`.
- `commands/settings-schema.ts` (create): `settingsSchemaLock`, `settingsSchemaDiff`.
- `lib/module-registry.ts` (modify): register `./commands/settings-schema.ts`.
- `lib/command-tree-def.ts` (modify): `settings check`, `settings schema lock`, `settings schema diff`.
- `lib/release/preflight.ts` (modify): a `schema lock` row.
- `.github/workflows/checks.yml` (modify): lock-in-sync and classifier steps.
- Docs: `bun run docs:gen` output, `docs/settings-architecture.md`, `packages/settings-kit/README.md`, `packages/rt-client/README.md`.

---

### Task 1: Schema fields, conversion, layer derivation and `checkSchema`

**Files:**
- Modify: `packages/rt-client/package.json`
- Modify: `packages/rt-client/src/settings/registry-machinery.ts:30-43`
- Create: `packages/rt-client/src/settings/schema.ts`
- Test: `packages/rt-client/src/settings/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: `SettingDef` from `registry-machinery.ts`.
- Produces:
  - `SettingDef.schema?: z.ZodType`, `SettingDef.storeVersion?: number`
  - `type SchemaIssue = { path: (string | number)[]; message: string }`
  - `toJsonSchema(schema: z.ZodType): Record<string, unknown>`
  - `layerJsonSchema(json: Record<string, unknown>): Record<string, unknown>`
  - `checkSchema(def: SettingDef, value: unknown, opts: { layer: boolean }): SchemaIssue[]` (empty array means ok; a def with no schema always returns `[]`)
  - `formatIssuePath(path: (string | number)[]): string`
  - `firstIssueText(issues: SchemaIssue[]): string` (`"<path>: <message>"`)

- [ ] **Step 1: Add the dependencies**

Run:
```bash
cd packages/rt-client && bun add zod@^4.6.5 @cfworker/json-schema@^4.1.1 && cd ../..
```
Expected: `packages/rt-client/package.json` `dependencies` now lists both; root `bun.lock` updated. Commit nothing yet.

- [ ] **Step 2: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/schema.test.ts`:

```ts
/**
 * settings/schema.ts: JSON Schema conversion, the derived layer schema for
 * deep-merge keys, and checkSchema's issue list. Pure, no file IO.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { SettingDef } from "../registry-machinery.ts";
import { checkSchema, firstIssueText, formatIssuePath, layerJsonSchema, toJsonSchema } from "../schema.ts";

const rule = z.looseObject({
  pattern: z.string(),
  category: z.string(),
  url: z.string().optional(),
  owner: z.literal("human").optional(),
});

function def(over: Partial<SettingDef> & Pick<SettingDef, "key" | "type" | "merge">): SettingDef {
  return { scopes: ["user"], description: "test", ...over };
}

const listDef = def({ key: "t.list", type: "array", merge: "replace", schema: z.array(rule) });
const deepDef = def({
  key: "t.deep",
  type: "object",
  merge: "deep",
  schema: z.looseObject({ enabled: z.boolean(), debounceSec: z.number(), nested: z.looseObject({ a: z.string() }).optional() }),
});

describe("toJsonSchema", () => {
  test("uses input mode: a defaulted property is optional and loose objects allow extras", () => {
    const json = toJsonSchema(z.looseObject({ a: z.string().default("x"), b: z.number() }));
    expect(json.required).toEqual(["b"]);
    expect(json.additionalProperties).not.toBe(false);
  });

  test("strict objects forbid extras", () => {
    const json = toJsonSchema(z.strictObject({ a: z.string() }));
    expect(json.additionalProperties).toBe(false);
  });

  test("carries .meta() through as annotations", () => {
    const json = toJsonSchema(z.record(z.string(), z.string()).meta({ labels: { key: "remote URL", value: "identity" } }));
    expect(json.labels).toEqual({ key: "remote URL", value: "identity" });
  });
});

describe("layerJsonSchema", () => {
  test("drops required at every object level but keeps it inside array items", () => {
    const json = toJsonSchema(
      z.looseObject({
        a: z.string(),
        b: z.looseObject({ c: z.number() }),
        items: z.array(z.looseObject({ d: z.string() })),
      }),
    );
    const layer = layerJsonSchema(json);
    expect(layer.required).toBeUndefined();
    expect((layer.properties as any).b.required).toBeUndefined();
    expect((layer.properties as any).items.items.required).toEqual(["d"]);
  });
});

describe("checkSchema", () => {
  test("a def without a schema never reports issues", () => {
    expect(checkSchema(def({ key: "t.plain", type: "object", merge: "replace" }), { anything: 1 }, { layer: false })).toEqual([]);
  });

  test("full check reports the first failing path in declaration order", () => {
    const issues = checkSchema(listDef, [{ pattern: 1, category: "gate" }], { layer: false });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]!.path).toEqual([0, "pattern"]);
    expect(issues[0]!.message.toLowerCase()).toContain("expected string");
  });

  test("full check passes a conforming value with extras", () => {
    expect(checkSchema(listDef, [{ pattern: "gate/*", category: "gate", extra: true }], { layer: false })).toEqual([]);
  });

  test("layer check accepts a partial deep layer and still types what is present", () => {
    expect(checkSchema(deepDef, { enabled: false }, { layer: true })).toEqual([]);
    const issues = checkSchema(deepDef, { enabled: "yes" }, { layer: true });
    expect(issues[0]!.path).toEqual(["enabled"]);
  });

  test("layer check keeps array items whole", () => {
    const d = def({ key: "t.deepList", type: "object", merge: "deep", schema: z.looseObject({ rules: z.array(rule) }) });
    const issues = checkSchema(d, { rules: [{ category: "gate" }] }, { layer: true });
    expect(issues[0]!.path).toEqual(["rules", 0, "pattern"]);
  });

  test("full check rejects a partial layer of a deep key", () => {
    expect(checkSchema(deepDef, { enabled: false }, { layer: false }).length).toBeGreaterThan(0);
  });
});

describe("formatIssuePath and firstIssueText", () => {
  test("formats indexes in brackets and properties with dots", () => {
    expect(formatIssuePath([0, "pattern"])).toBe("[0].pattern");
    expect(formatIssuePath(["emoji", "looking"])).toBe("emoji.looking");
    expect(formatIssuePath([])).toBe("(root)");
  });

  test("firstIssueText joins path and message", () => {
    expect(firstIssueText([{ path: [0, "pattern"], message: "expected string" }])).toBe("[0].pattern: expected string");
    expect(firstIssueText([])).toBe("");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema.test.ts`
Expected: FAIL, `Cannot find module "../schema.ts"`.

- [ ] **Step 4: Add the def fields**

In `packages/rt-client/src/settings/registry-machinery.ts`, add at the top:

```ts
import type { z } from "zod";
```

and extend `SettingDef` (after `pathGuardFields?: string[];`):

```ts
  /** The value a reader receives (merged, for deep keys). Required for object/array keys. */
  schema?: z.ZodType;
  /** Bumped only on a breaking schema change; the lock file and spec 3 read it. Default 1. */
  storeVersion?: number;
```

- [ ] **Step 5: Write `schema.ts`**

Create `packages/rt-client/src/settings/schema.ts`:

```ts
/**
 * Schema checks for composite settings. The full schema describes the value
 * a reader receives; a deep-merge layer is checked against the derived layer
 * schema (every object property optional, array items whole) so a store that
 * sets one field is not refused. Layer checks run through the same JSON
 * Schema validator the browser uses, so the two never disagree.
 */

import { Validator, type OutputUnit } from "@cfworker/json-schema";
import { z } from "zod";
import type { SettingDef } from "./registry-machinery.ts";

export interface SchemaIssue {
  path: (string | number)[];
  message: string;
}

export type JsonSchema = Record<string, unknown>;

export function hasSchema(def: SettingDef): def is SettingDef & { schema: z.ZodType } {
  return def.schema !== undefined;
}

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
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
      out[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, relax(pv, false)]));
    } else out[k] = relax(v, insideArray);
  }
  return out;
}

const jsonCache = new WeakMap<z.ZodType, { full: JsonSchema; layer: JsonSchema }>();

export function jsonSchemasFor(schema: z.ZodType): { full: JsonSchema; layer: JsonSchema } {
  let hit = jsonCache.get(schema);
  if (!hit) {
    const full = toJsonSchema(schema);
    hit = { full, layer: layerJsonSchema(full) };
    jsonCache.set(schema, hit);
  }
  return hit;
}

export function checkSchema(def: SettingDef, value: unknown, opts: { layer: boolean }): SchemaIssue[] {
  if (!hasSchema(def)) return [];
  if (opts.layer && def.merge === "deep" && def.type === "object") {
    return validateJson(jsonSchemasFor(def.schema).layer, value);
  }
  const result = def.schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ path: i.path.map(normalizeSegment), message: i.message }));
}

/** Browser and server share this: a JSON Schema check with rt's issue shape. */
export function validateJson(json: JsonSchema, value: unknown): SchemaIssue[] {
  const v = new Validator(json as never, "2020-12", false);
  const out = v.validate(value);
  if (out.valid) return [];
  return out.errors.map(toIssue);
}

function toIssue(unit: OutputUnit): SchemaIssue {
  const path = unit.instanceLocation
    .replace(/^#\/?/, "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
  return { path, message: unit.error };
}

function normalizeSegment(s: PropertyKey): string | number {
  return typeof s === "number" ? s : String(s);
}

export function formatIssuePath(path: (string | number)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("");
}

export function firstIssueText(issues: SchemaIssue[]): string {
  const first = issues[0];
  return first ? `${formatIssuePath(first.path)}: ${first.message}` : "";
}
```

If `@cfworker/json-schema`'s `Validator` constructor signature differs from `(schema, draft, shortCircuit)` in 4.1.1, read `node_modules/@cfworker/json-schema/dist/validator.d.ts` and match it; do not guess.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema.test.ts`
Expected: PASS. If the "expected string" assertion fails because zod's message differs, print the message and adjust the assertion to the substring zod 4.6 actually emits (`expected string`), never the code.

- [ ] **Step 7: Export and gate**

In `packages/rt-client/src/index.ts`, after line 172 add:

```ts
export { checkSchema, toJsonSchema, layerJsonSchema, jsonSchemasFor, validateJson, formatIssuePath, firstIssueText, hasSchema } from "./settings/schema.ts";
export type { SchemaIssue, JsonSchema } from "./settings/schema.ts";
```

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test packages/rt-client/src/settings/__tests__/schema.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts && cd packages/rt-client && bun run build && cd ../..`
Expected: all pass, build clean.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/package.json bun.lock packages/rt-client/src/settings/registry-machinery.ts packages/rt-client/src/settings/schema.ts packages/rt-client/src/settings/__tests__/schema.test.ts packages/rt-client/src/index.ts
git commit -m "feat(settings): schema fields, JSON Schema conversion and checkSchema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `validateWrite` and the merged-result check

**Files:**
- Create: `packages/rt-client/src/settings/validate-write.ts`
- Modify: `packages/rt-client/src/settings/resolve.ts` (add `mergedValueWith`)
- Modify: `packages/rt-client/src/settings/write.ts:143-148`
- Test: `packages/rt-client/src/settings/__tests__/validate-write.test.ts`, `write.test.ts`

**Interfaces:**
- Consumes: `checkSchema`, `firstIssueText` (Task 1); `validateValue`; store fixtures as in `write.test.ts`.
- Produces:
  - `mergedValueWith(def, override: { scope: SettingScope; repoIdentity?: string; value: unknown }, opts: { repoIdentity?: string | null }): unknown` in `resolve.ts`: the merged value the resolver would produce if that store held `value`.
  - `validateWrite(def, value, opts: { scope: SettingScope; repoIdentity?: string; team?: string }): { ok: true } | { ok: false; reason: string; issues: SchemaIssue[] }`.
  - `setSetting` refuses with `validateWrite`'s reason.

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/validate-write.test.ts`:

```ts
/**
 * settings/validate-write.ts: the one write gate. Type check and path guard
 * as before, then the layer schema, then the merged result. HOME is
 * re-pointed per test (the write.test.ts pattern).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { z } from "zod";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "../paths.ts";
import { getDef, type SettingDef } from "../registry-machinery.ts";
import { validateWrite } from "../validate-write.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";

describe("settings/validateWrite", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-vw-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }

  /** A temporary schema on a live def, restored afterwards (registry defs are shared objects). */
  function withSchema(key: string, schema: z.ZodType, fn: () => void): void {
    const def = getDef(key) as SettingDef;
    const prev = def.schema;
    def.schema = schema;
    try { fn(); } finally { def.schema = prev; }
  }

  test("type check still comes first", () => {
    const def = getDef("rt.homeSnapshot")!;
    const r = validateWrite(def, "nope", { scope: "machine" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("expected object");
  });

  test("a partial deep layer at machine scope is allowed", () => {
    withSchema("rt.homeSnapshot", z.looseObject({ enabled: z.boolean(), debounceSec: z.number() }), () => {
      expect(validateWrite(getDef("rt.homeSnapshot")!, { enabled: false }, { scope: "machine" })).toEqual({ ok: true });
    });
  });

  test("a wrongly typed field in a layer is refused with its path", () => {
    withSchema("rt.homeSnapshot", z.looseObject({ enabled: z.boolean(), debounceSec: z.number() }), () => {
      const r = validateWrite(getDef("rt.homeSnapshot")!, { enabled: "yes" }, { scope: "machine" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("enabled:");
    });
  });

  test("a replace key is checked against the full schema", () => {
    withSchema("rt.repoRoots", z.array(z.string()), () => {
      const r = validateWrite(getDef("rt.repoRoots")!, [1], { scope: "machine" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toContain("[0]:");
    });
  });

  test("the merged result is refused only when it fails where it passed before", () => {
    // rt.gitStatus: default {sweep, sweepIntervalSec, fetchIntervalSec}, scopes user+machine, deep.
    withSchema("rt.gitStatus", z.looseObject({ sweep: z.boolean(), sweepIntervalSec: z.number().min(1), fetchIntervalSec: z.number() }), () => {
      const def = getDef("rt.gitStatus")!;
      // Merge passes today; a machine layer that breaks it is refused.
      const bad = validateWrite(def, { sweepIntervalSec: 0 }, { scope: "machine" });
      expect(bad.ok).toBe(false);
      // Merge already broken by the user layer: an unrelated machine edit still lands.
      write(userSettingsPath(), { "rt.gitStatus": { sweepIntervalSec: 0 } });
      expect(validateWrite(def, { sweep: false }, { scope: "machine" })).toEqual({ ok: true });
    });
  });

  test("a global write of a repo-scoped key checks every repo section's merge", () => {
    withSchema("rt.worktrees", z.looseObject({ onDeck: z.number().min(0), name: z.string().optional() }), () => {
      const def = getDef("rt.worktrees")!;
      write(teamSettingsPath(TEAM), { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 2 } } } });
      // Global user layer that is fine alone and fine merged with the repo section.
      expect(validateWrite(def, { name: "x" }, { scope: "user" })).toEqual({ ok: true });
      // The repo section merge would still pass, so a global change that only that repo overrides is fine.
      expect(validateWrite(def, { onDeck: 1 }, { scope: "user" })).toEqual({ ok: true });
    });
  });

  test("a repo section write checks that repo's merge", () => {
    withSchema("rt.worktrees", z.looseObject({ onDeck: z.number().min(0) }), () => {
      const def = getDef("rt.worktrees")!;
      write(machineSettingsPath(), {});
      const r = validateWrite(def, { onDeck: -1 }, { scope: "user", repoIdentity: IDENTITY });
      expect(r.ok).toBe(false);
    });
  });
});
```

Add to `packages/rt-client/src/settings/__tests__/write.test.ts`, inside the outer `describe`, a new block:

```ts
  describe("schema gate", () => {
    test("setSetting refuses a value the schema rejects and names the path", () => {
      const def = getDef("rt.repoRoots")!;
      const prev = def.schema;
      def.schema = z.array(z.string());
      try {
        expect(() => setSetting("rt.repoRoots", [1], "machine")).toThrow(/\[0\]:/);
      } finally {
        def.schema = prev;
      }
    });
  });
```

with `import { z } from "zod";` and `import { getDef } from "../registry-machinery.ts";` added to that file's imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/src/settings/__tests__/write.test.ts`
Expected: FAIL, `Cannot find module "../validate-write.ts"` and the write test's `toThrow` unmet.

- [ ] **Step 3: Add `mergedValueWith` to `resolve.ts`**

Append to `packages/rt-client/src/settings/resolve.ts` (it can see `readStores`, `resolveDef`, `collectSlots` in-module):

```ts
/**
 * The merged value the resolver would produce if `override.scope` (and its
 * repo section, when given) held `override.value`. Used by the write gate to
 * refuse a write that breaks the merge; reads never call it.
 */
export function mergedValueWith(
  def: SettingDef,
  override: { scope: SettingScope; repoIdentity?: string; value: unknown },
  opts: ResolveOpts = {},
): unknown {
  const stores = readStores();
  const patched: StoreBundle = {
    user: cloneStore(stores.user),
    machine: cloneStore(stores.machine),
    teams: stores.teams.map(cloneStore),
  };
  const targets = override.scope === "team" ? patched.teams : [override.scope === "user" ? patched.user : patched.machine];
  for (const store of targets) {
    if (override.repoIdentity !== undefined) {
      store.repos[override.repoIdentity] = { ...(store.repos[override.repoIdentity] ?? {}), [def.key]: override.value };
    } else {
      store.global = { ...store.global, [def.key]: override.value };
    }
  }
  return resolveDef(def, patched, opts).value;
}

function cloneStore(store: StoreFile): StoreFile {
  return { ...store, global: { ...store.global }, repos: Object.fromEntries(Object.entries(store.repos).map(([k, v]) => [k, { ...v }])) };
}
```

If `StoreBundle` is not already a named type in `resolve.ts`, name the existing `{ user, machine, teams }` shape `StoreBundle` where `readStores` is declared and use it here. A team write with no `opts.team` patches every team store; that matches `setSetting`'s single-team assumption today (one team is cloned) and the check only tightens if several exist.

- [ ] **Step 4: Write `validate-write.ts`**

Create `packages/rt-client/src/settings/validate-write.ts`:

```ts
/**
 * The one write gate: validateValue (type + path guard, the resolver's own
 * skip rule), then the layer schema, then the merged result. The merged
 * check refuses only a write that makes a passing merge fail, so a layer
 * already broken elsewhere never blocks an unrelated edit.
 */

import { checkSchema, firstIssueText, hasSchema, type SchemaIssue } from "./schema.ts";
import { validateValue, type SettingDef, type SettingScope } from "./registry-machinery.ts";
import { getSetting, listStoreRepoIdentities, mergedValueWith } from "./resolve.ts";

export type WriteVerdict = { ok: true } | { ok: false; reason: string; issues: SchemaIssue[] };

export function validateWrite(
  def: SettingDef,
  value: unknown,
  opts: { scope: SettingScope; repoIdentity?: string; team?: string },
): WriteVerdict {
  const guarded: SettingDef = opts.scope === "machine" ? { ...def, pathGuardFields: undefined } : def;
  const typed = validateValue(guarded, value);
  if (!typed.ok) return { ok: false, reason: typed.reason, issues: [] };
  if (!hasSchema(def)) return { ok: true };

  const layerIssues = checkSchema(def, value, { layer: true });
  if (layerIssues.length > 0) return { ok: false, reason: firstIssueText(layerIssues), issues: layerIssues };

  const contexts: (string | null)[] =
    opts.repoIdentity !== undefined ? [opts.repoIdentity] : def.repoScoped ? [null, ...listStoreRepoIdentities()] : [null];
  for (const repoIdentity of contexts) {
    const before = mergedNow(def, repoIdentity);
    const after = mergedValueWith(def, { scope: opts.scope, repoIdentity: opts.repoIdentity, value }, { repoIdentity, expand: false });
    const afterIssues = checkSchema(def, after, { layer: false });
    if (afterIssues.length === 0) continue;
    const beforeIssues = before === undefined ? [] : checkSchema(def, before, { layer: false });
    if (beforeIssues.length === 0) {
      const where = repoIdentity ? ` for ${repoIdentity}` : "";
      return { ok: false, reason: `merged value${where} would fail: ${firstIssueText(afterIssues)}`, issues: afterIssues };
    }
  }
  return { ok: true };
}

function mergedNow(def: SettingDef, repoIdentity: string | null): unknown {
  try {
    return getSetting(def.key, { repoIdentity, expand: false }).value;
  } catch {
    return undefined;
  }
}
```

`listStoreRepoIdentities` is added in Task 6; for this task add the minimal version to `resolve.ts` now:

```ts
/** Every repo identity that has a `repos.<id>` section in any store. */
export function listStoreRepoIdentities(): string[] {
  const stores = readStores();
  const ids = new Set<string>();
  for (const store of [stores.user, stores.machine, ...stores.teams]) for (const id of Object.keys(store.repos)) ids.add(id);
  return [...ids].sort();
}
```

- [ ] **Step 5: Wire `setSetting`**

In `packages/rt-client/src/settings/write.ts`, replace lines 143-148 (the `guardedDef`/`validateValue` block) with:

```ts
  const verdict = validateWrite(def, value, { scope, repoIdentity: opts.repoIdentity, team: opts.team });
  if (!verdict.ok) {
    const hint = verdict.issues.length === 0 ? " — use ${team:<name>} or ${repoRoot} instead" : "";
    refuse(`refusing to set "${key}": ${verdict.reason}${hint}`);
  }
```

and import `validateWrite` from `./validate-write.ts`; drop the now-unused `validateValue` import if nothing else in the file uses it. Keep the existing refusal order (unknown key, unmigrated, scope, repoIdentity) above it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/src/settings/__tests__/write.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts`
Expected: PASS.

- [ ] **Step 7: Export and gate**

In `packages/rt-client/src/index.ts` add:

```ts
export { validateWrite } from "./settings/validate-write.ts";
export type { WriteVerdict } from "./settings/validate-write.ts";
export { mergedValueWith, listStoreRepoIdentities } from "./settings/resolve.ts";
```

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test packages/rt-client/src/settings packages/rt-client/test/index-surface.test.ts && cd packages/rt-client && bun run build && cd ../..`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/settings/validate-write.ts packages/rt-client/src/settings/resolve.ts packages/rt-client/src/settings/write.ts packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/src/settings/__tests__/write.test.ts packages/rt-client/src/index.ts
git commit -m "feat(settings): validateWrite gates every write on the layer schema and the merged result

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Schemas for the `rt.*` composite keys

**Files:**
- Create: `packages/rt-client/src/settings/registry-schemas.ts`
- Modify: `packages/rt-client/src/settings/registry-defs.ts` (add `schema:` to each `rt.*` composite def)
- Test: `packages/rt-client/src/settings/__tests__/schema-examples.test.ts`

**Interfaces:**
- Consumes: `z` from zod; `checkSchema` (Task 1).
- Produces: `SCHEMAS: Record<string, z.ZodType>` with an entry for each key below; `EXAMPLES` table the test loops over (Task 4 and 5 extend both).

The 25 keys this task covers: `rt.roles`, `rt.intercepts`, `rt.worktrees`, `rt.ignoredMrs`, `rt.repoIdentityOverrides`, `rt.repoRoots`, `rt.notifications`, `rt.notify.eventBridges`, `rt.cron`, `rt.repoTracking`, `rt.runaway`, `rt.workspacePrefs`, `rt.homeSnapshot`, `rt.teamSnapshot`, `rt.sync`, `rt.branchNaming`, `rt.variations`, `rt.presets`, `rt.dopplerTemplate`, `rt.worktreeApp`, `rt.sdmEnrichment`, `rt.gitStatus`, `rt.hooks`, `rt.trustedBrowserOrigins`, `rt.integrations`.

**How to write one schema (the same procedure for every key in Tasks 3 to 5):**

1. Find the readers: `git grep -n '"<key>"' -- lib commands packages extensions` (the def's `description` often names the fields too). Read every reader's property access and type guards.
2. Write the zod schema for the value a reader receives: `z.looseObject({...})` for objects (extras allowed), `z.array(...)` for lists, `z.record(z.string(), ...)` for maps. Use `z.strictObject` only when a reader rejects unknown properties. Enums become `z.enum([...])`. A property a reader treats as optional is `.optional()`; one with a fallback in the reader stays `.optional()` (the reader's fallback is not a schema default).
3. Where two readers disagree, follow the more permissive and note the disagreement in the PR body, not in code.
4. Declare properties in importance order (`pattern` before `title`): the first failing path in a refusal is the first declared.
5. Add the key to `EXAMPLES` with at least one `good` value (the registry default or a realistic invented value), one `bad` value with the expected first path, and for a deep key one partial `layer` value.

- [ ] **Step 1: Write the failing test**

Create `packages/rt-client/src/settings/__tests__/schema-examples.test.ts`:

```ts
/**
 * One good, one bad and (deep keys) one partial-layer example per composite
 * key, run through checkSchema. The completeness assertions land once every
 * namespace has its schemas.
 */

import { describe, expect, test } from "bun:test";
import { allDefs, getDef } from "../registry-machinery.ts";
import { checkSchema } from "../schema.ts";
import { EXAMPLES } from "./schema-examples.ts";

describe("schema examples", () => {
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    describe(key, () => {
      test("has a schema", () => {
        expect(getDef(key)?.schema, `${key} needs schema:`).toBeDefined();
      });
      for (const [i, good] of ex.good.entries()) {
        test(`good #${i} passes`, () => {
          expect(checkSchema(getDef(key)!, good, { layer: false })).toEqual([]);
        });
      }
      for (const [i, bad] of ex.bad.entries()) {
        test(`bad #${i} fails at ${JSON.stringify(bad.path)}`, () => {
          const issues = checkSchema(getDef(key)!, bad.value, { layer: false });
          expect(issues.length).toBeGreaterThan(0);
          expect(issues[0]!.path).toEqual(bad.path);
        });
      }
      for (const [i, layer] of (ex.layer ?? []).entries()) {
        test(`layer #${i} passes the layer schema`, () => {
          expect(checkSchema(getDef(key)!, layer, { layer: true })).toEqual([]);
        });
      }
      test("the registry default, when present, passes", () => {
        const def = getDef(key)!;
        if (!("default" in def)) return;
        expect(checkSchema(def, def.default, { layer: false })).toEqual([]);
      });
    });
  }

  test("every rt.* composite key has an example", () => {
    const missing = allDefs()
      .filter((d) => d.key.startsWith("rt.") && (d.type === "object" || d.type === "array"))
      .map((d) => d.key)
      .filter((k) => !(k in EXAMPLES));
    expect(missing).toEqual([]);
  });
});
```

Create `packages/rt-client/src/settings/__tests__/schema-examples.ts` with the table. Entries this task must fill in full; the five below are complete and the rest follow the same shape after reading each key's readers:

```ts
export interface Example {
  good: unknown[];
  bad: { value: unknown; path: (string | number)[] }[];
  layer?: unknown[];
}

export const EXAMPLES: Record<string, Example> = {
  "rt.notify.eventBridges": {
    good: [
      [],
      [{ pattern: "gate/opened/*", category: "gate", title: "{label}", message: "{question}", url: "https://console.example/gates/{id}", owner: "human", subjectPrefix: "run:" }],
      [{ pattern: "herd/gates-waiting/*", category: "herd-watchdog", title: "{headline}", message: "{summary}", surface: "board" }],
    ],
    bad: [
      { value: [{ pattern: 1, category: "gate", title: "t", message: "m" }], path: [0, "pattern"] },
      { value: [{ pattern: "x", category: "gate", title: "t", message: "m", owner: "herd" }], path: [0, "owner"] },
    ],
  },
  "rt.repoIdentityOverrides": {
    good: [{}, { "git@gitlab.example.com:acme/app.git": "gitlab.example.com/acme/app" }],
    bad: [{ value: { "git@gitlab.example.com:acme/app.git": 1 }, path: ["git@gitlab.example.com:acme/app.git"] }],
  },
  "rt.repoRoots": {
    good: [[], ["~/Documents/GitHub"]],
    bad: [{ value: [1], path: [0] }],
  },
  "rt.homeSnapshot": {
    good: [{ enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 }],
    bad: [{ value: { enabled: "yes", debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 }, path: ["enabled"] }],
    layer: [{ enabled: false }, { debounceSec: 5 }],
  },
  "rt.gitStatus": {
    good: [{ sweep: true, sweepIntervalSec: 300, fetchIntervalSec: 900 }],
    bad: [{ value: { sweep: true, sweepIntervalSec: "300", fetchIntervalSec: 900 }, path: ["sweepIntervalSec"] }],
    layer: [{ sweep: false }],
  },
  // ... one entry per remaining rt.* composite key, same shape.
};
```

Fixture values must be invented (`example.com`, `acme`), never copied from a real store.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts`
Expected: FAIL, `has a schema` fails for every key.

- [ ] **Step 3: Write the schemas**

Create `packages/rt-client/src/settings/registry-schemas.ts`. The five keys above are complete; write the other 20 by the procedure:

```ts
/**
 * One zod schema per composite settings key: the value a reader receives.
 * Objects are loose unless a reader rejects unknown properties. Display
 * metadata (labels, placeholders) rides on .meta() into the JSON Schema.
 */

import { z } from "zod";
import { NOTIFICATION_EVENT_KEYS } from "./notification-events.ts";

const snapshot = {
  enabled: z.boolean(),
  debounceSec: z.number(),
  pushDelaySec: z.number(),
  janitorThresholdHours: z.number(),
  janitorIntervalMin: z.number(),
};

export const SCHEMAS = {
  "rt.notify.eventBridges": z.array(
    z.looseObject({
      pattern: z.string(),
      category: z.string(),
      title: z.string(),
      message: z.string(),
      subjectPrefix: z.string().optional(),
      url: z.string().optional(),
      owner: z.literal("human").optional(),
      surface: z.string().optional(),
    }),
  ),
  "rt.repoIdentityOverrides": z
    .record(z.string(), z.string())
    .meta({ labels: { key: "remote URL", value: "identity" } }),
  "rt.repoRoots": z.array(z.string()),
  "rt.homeSnapshot": z.looseObject(snapshot),
  "rt.teamSnapshot": z.looseObject({ ...snapshot, pullIntervalSec: z.number() }),
  "rt.gitStatus": z.looseObject({ sweep: z.boolean(), sweepIntervalSec: z.number(), fetchIntervalSec: z.number() }),
  "rt.notifications": z.looseObject(Object.fromEntries(NOTIFICATION_EVENT_KEYS.map((k) => [k, z.boolean().optional()]))),
  "rt.trustedBrowserOrigins": z.array(z.string()),
  "rt.worktreeApp": z.looseObject({
    enabled: z.boolean().optional(),
    killProcesses: z.boolean().optional(),
    claudeHook: z.enum(["installed", "declined"]).optional(),
  }),
  // rt.roles, rt.intercepts, rt.worktrees, rt.ignoredMrs, rt.cron, rt.repoTracking,
  // rt.runaway, rt.workspacePrefs, rt.sync, rt.branchNaming, rt.variations, rt.presets,
  // rt.dopplerTemplate, rt.sdmEnrichment, rt.hooks, rt.integrations: read each key's
  // readers (procedure in the plan) and declare them here in the same style.
} satisfies Record<string, z.ZodType>;
```

Check `NOTIFICATION_EVENT_KEYS` is the exported name in `notification-events.ts` (index.ts exports it as such); if the module exports a differently named list, use that name.

Then in `registry-defs.ts` import `SCHEMAS` and add `schema: SCHEMAS["<key>"],` to each of the 25 `rt.*` composite defs.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/write.test.ts`
Expected: PASS. A failure in `resolve.test.ts` or `write.test.ts` means a fixture there writes a value the new schema rejects: since reads only label, resolve tests must still pass; a write test fixture that now fails the schema is a real finding, so make the fixture conform and say so in the PR body.

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/schema-examples.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts
git commit -m "feat(settings): schemas for the rt.* composite keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Schemas for `mattstack.*`, `setup.*`, `claude.*` and `deck.*` keys

**Files:**
- Modify: `packages/rt-client/src/settings/registry-schemas.ts`, `registry-defs.ts`
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts`, `schema-examples.test.ts`

**Interfaces:**
- Consumes: Task 3's `SCHEMAS`, `EXAMPLES` and procedure.
- Produces: entries for `mattstack.integrations`, `mattstack.tracking`, `mattstack.roster`, `setup.waived`, `claude.marketplaces`, `claude.plugins`, `deck.apps`, `deck.access`, `deck.platform`.

Readers for the suite keys live in the apps repo. Read them in place, read-only and scoped: `git -C /Users/matt/Documents/GitHub/mattstack-apps grep -n '"deck.apps"' -- apps/deck/src` and the same for each key (`apps/deck`, `apps/board`, `apps/boxscore`); `mattstack.*` and `claude.*` readers are in this repo (`lib/team`, `lib/setup`, `lib/skills`). Do not edit anything in the apps repo.

- [ ] **Step 1: Extend the completeness test**

In `schema-examples.test.ts`, change the `every rt.* composite key has an example` test's filter to `["rt.", "mattstack.", "setup.", "claude.", "deck."].some((p) => d.key.startsWith(p))` and rename it `every rt, mattstack, setup, claude and deck composite key has an example`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts`
Expected: FAIL, the completeness test lists the nine keys.

- [ ] **Step 3: Write the nine schemas and examples**

Follow Task 3's procedure. `setup.waived` is `z.array(z.string())`. `mattstack.roster` is an array of member objects (read `lib/team` for the fields); `deck.apps` is a map of app name to app record (read `apps/deck/src` for `port`, `dir`, `kind` and the rest), written as `z.record(z.string(), z.looseObject({...}))`. Add `schema:` to each def and an `EXAMPLES` entry with good, bad and (deep keys) layer values.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/schema-examples.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts
git commit -m "feat(settings): schemas for the mattstack, setup, claude and deck keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Schemas for `board.*`, `boxscore.*`, `gitq.*` keys, display metadata, and registry completeness

**Files:**
- Modify: `packages/rt-client/src/settings/registry-schemas.ts`, `registry-defs.ts`
- Modify: `packages/rt-client/src/settings/__tests__/schema-examples.ts`, `schema-examples.test.ts`, `registry.test.ts`

**Interfaces:**
- Consumes: Task 3's procedure; settings-kit's current `SHAPES` (`packages/settings-kit/src/shapes.ts`) as the source of `labels`, `fallbacks` and leaf field lists to preserve.
- Produces: entries for the 21 keys: `board.projects`, `board.members`, `board.botUsernames`, `board.ticketPrefixes`, `board.slack`, `board.tabs`, `board.workspaces`, `board.hiddenMembers`, `board.triage`, `board.reReview`, `board.cwds`, `boxscore.projects`, `boxscore.linearDoneStates`, `boxscore.sizeBand`, `boxscore.excludeFilePatterns`, `boxscore.ignoredMrs`, `boxscore.botPatterns`, `boxscore.hiddenMembers`, `gitq.workSlots`, `gitq.forges`, `gitq.board`. Metadata convention: `.meta({ placeholder: "eyes" })` on a property; `.meta({ labels: { key, value } })` on a record; `.meta({ title, description })` where the property name is not enough.

- [ ] **Step 1: Make completeness cover every composite key**

In `schema-examples.test.ts`, replace the namespace-filtered completeness test with:

```ts
  test("every composite key has a schema and an example", () => {
    const composite = allDefs().filter((d) => d.type === "object" || d.type === "array");
    expect(composite.filter((d) => !d.schema).map((d) => d.key)).toEqual([]);
    expect(composite.map((d) => d.key).filter((k) => !(k in EXAMPLES))).toEqual([]);
  });

  test("every schema converts to JSON Schema", () => {
    for (const d of allDefs()) if (d.schema) expect(() => toJsonSchema(d.schema!)).not.toThrow();
  });
```

with `toJsonSchema` imported from `../schema.ts`. Add to `registry.test.ts`'s `allDefs` block:

```ts
    test("every object or array def carries a schema", () => {
      for (const def of allDefs()) {
        if (def.type !== "object" && def.type !== "array") continue;
        expect(def.schema, `${def.key} has no schema`).toBeDefined();
      }
    });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL naming the 21 keys.

- [ ] **Step 3: Write the schemas with metadata**

Examples that must appear exactly (the rest follow the same style):

```ts
  "board.slack": z.looseObject({
    channel: z.string().optional(),
    singleTemplate: z.string().optional(),
    multiHeader: z.string().optional(),
    multiItem: z.string().optional(),
    autoResolveIntervalMinutes: z.number().optional(),
    emoji: z
      .looseObject({
        looking: z.string().optional().meta({ placeholder: "eyes" }),
        commented: z.string().optional().meta({ placeholder: "speech_balloon" }),
        approved: z.string().optional().meta({ placeholder: "white_check_mark" }),
      })
      .optional(),
  }),
  "board.triage": z.looseObject({
    enabled: z.boolean().optional(),
    cooldownMinutes: z.number().optional(),
    dailyAttemptBudget: z.number().optional(),
    notify: z.enum(["rt", "badge-only"]).optional(),
    tier: z.enum(["api", "checkout"]).optional(),
    fixClasses: z
      .looseObject({
        retryFlake: z.boolean().optional(),
        inheritedNoteDraft: z.boolean().optional(),
        cleanApiRebase: z.boolean().optional(),
        mechanicalLint: z.boolean().optional(),
        codeFix: z.boolean().optional(),
      })
      .optional(),
  }),
  "board.projects": z.array(z.string()),
  "boxscore.sizeBand": z.looseObject({ tooSmall: z.number().optional(), tooLarge: z.number().optional() }),
  "gitq.workSlots": z.looseObject({ workSlotLocation: z.string().optional(), maxWorkSlots: z.number().optional() }),
```

`board.members`, `board.tabs`, `board.hiddenMembers` (the `external` keys) still need schemas describing the value board writes; read `apps/board/src` for their shapes.

The placeholders come from `DEFAULT_SLACK_EMOJI` in settings-kit; keep the literal strings here (rt-client cannot import settings-kit) and Task 8 adds a parity test in settings-kit.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/write.test.ts lib/__tests__/notification-shape-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/registry-defs.ts packages/rt-client/src/settings/__tests__/schema-examples.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts
git commit -m "feat(settings): schemas for board, boxscore and gitq keys; every composite key now has one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Lenient read labeling, list/explain rendering, and store helpers

**Files:**
- Modify: `packages/rt-client/src/settings/resolve.ts` (`ExplainRow`, `ListedSetting`, `Resolution`, `resolveDef`, `listSettings`; add `listUnregisteredSettings`, `repoSectionsFor`)
- Modify: `commands/settings-keys.ts:428-447` and `:485-495`
- Test: `packages/rt-client/src/settings/__tests__/resolve.test.ts`, `commands/__tests__/settings-keys-render.test.ts` (create)

**Interfaces:**
- Consumes: `checkSchema`, `SchemaIssue` (Task 1); schemas (Tasks 3 to 5).
- Produces:
  - `ExplainRow.nonconforming?: SchemaIssue[]` (a present, applied row whose layer fails its schema)
  - `Resolution.mergedIssues: SchemaIssue[]`; `ListedSetting.nonconforming?: { scope: Scope; file: string | null; issues: SchemaIssue[] }[]`; `ListedSetting.mergedIssues?: SchemaIssue[]`
  - `listUnregisteredSettings(opts?: ResolveOpts): { key: string; scope: Scope; file: string }[]`
  - `repoSectionsFor(key: string): { identity: string; scopes: SettingScope[] }[]`

- [ ] **Step 1: Write the failing tests**

Add to `resolve.test.ts` (inside the top-level `describe`, using its `writeUser`/`writeMachine`/`writeTeam` helpers and the `withSchema` helper copied from Task 2's test):

```ts
  describe("schema labeling (lenient reads)", () => {
    test("a nonconforming layer stays in effect and is labeled, never skipped", () => {
      withSchema("rt.homeSnapshot", z.looseObject({ enabled: z.boolean(), debounceSec: z.number() }), () => {
        writeMachine({ "rt.homeSnapshot": { enabled: "yes" } });
        const resolved = getSetting<{ enabled: unknown }>("rt.homeSnapshot");
        expect(resolved.value.enabled).toBe("yes");
        const rows = explainSetting("rt.homeSnapshot");
        const machine = rows.find((r) => r.scope === "machine")!;
        expect(machine.invalid).toBeUndefined();
        expect(machine.nonconforming?.[0]?.path).toEqual(["enabled"]);
      });
    });

    test("a type-invalid layer is still skipped and labeled invalid", () => {
      writeMachine({ "rt.homeSnapshot": "nope" });
      const rows = explainSetting("rt.homeSnapshot");
      expect(rows.find((r) => r.scope === "machine")!.invalid).toContain("expected object");
    });

    test("a partial deep layer is not labeled", () => {
      withSchema("rt.homeSnapshot", z.looseObject({ enabled: z.boolean(), debounceSec: z.number() }), () => {
        writeMachine({ "rt.homeSnapshot": { enabled: false } });
        expect(explainSetting("rt.homeSnapshot").find((r) => r.scope === "machine")!.nonconforming).toBeUndefined();
      });
    });

    test("listSettings carries nonconforming layers and merged issues", () => {
      withSchema("rt.homeSnapshot", z.looseObject({ enabled: z.boolean(), debounceSec: z.number() }), () => {
        writeMachine({ "rt.homeSnapshot": { enabled: "yes" } });
        const row = listSettings().find((s) => s.key === "rt.homeSnapshot")!;
        expect(row.nonconforming?.[0]?.scope).toBe("machine");
        expect(row.mergedIssues?.[0]?.path).toEqual(["enabled"]);
      });
    });
  });

  describe("store helpers", () => {
    test("listUnregisteredSettings names unknown keys with scope and file", () => {
      writeMachine({ "board.rtRepos": [] });
      const found = listUnregisteredSettings();
      expect(found.find((f) => f.key === "board.rtRepos")?.scope).toBe("machine");
    });

    test("repoSectionsFor reports which stores set a key per repo", () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 1 } } } });
      writeUser({ repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 2 } } } });
      expect(repoSectionsFor("rt.worktrees")).toEqual([{ identity: IDENTITY, scopes: ["team", "user"] }]);
    });
  });
```

Import `z`, `listUnregisteredSettings`, `repoSectionsFor` at the top of the file; `IDENTITY` in that file must be `gitlab.example.com/acme/app` (change the constant if it is not).

Create `commands/__tests__/settings-keys-render.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderExplainRow, renderListRow } from "../settings-keys.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("settings-keys rendering", () => {
  test("explain shows a nonconforming layer with its first issue", () => {
    const line = strip(renderExplainRow({
      scope: "machine", file: "/tmp/settings.local.jsonc", present: true, value: { enabled: "yes" },
      nonconforming: [{ path: ["enabled"], message: "expected boolean" }],
    }));
    expect(line).toContain("[nonconforming: enabled: expected boolean]");
  });

  test("list labels nonconforming layers and merged issues", () => {
    const line = strip(renderListRow({
      key: "rt.homeSnapshot", value: { enabled: "yes" }, provenance: [{ scope: "machine", file: "/tmp/x" }], migrated: true,
      nonconforming: [{ scope: "machine", file: "/tmp/x", issues: [{ path: ["enabled"], message: "expected boolean" }] }],
      mergedIssues: [{ path: ["enabled"], message: "expected boolean" }],
    }));
    expect(line).toContain("nonconforming[machine]: enabled: expected boolean");
    expect(line).toContain("merged: enabled: expected boolean");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts commands/__tests__/settings-keys-render.test.ts`
Expected: FAIL on the new cases (missing exports and labels).

- [ ] **Step 3: Implement labeling in `resolve.ts`**

Types:

```ts
export interface ExplainRow {
  // existing fields ...
  /** The layer fails its schema; it still applies (reads never skip on the schema). */
  nonconforming?: SchemaIssue[];
}

export interface ListedSetting {
  // existing fields ...
  nonconforming?: { scope: Scope; file: string | null; issues: SchemaIssue[] }[];
  /** The merged value fails the full schema. */
  mergedIssues?: SchemaIssue[];
}
```

In `resolveDef`, after the `validateForScope` check passes (before `rows.push(row); applied.push(...)`):

```ts
    if (slot.scope !== "default") {
      const issues = checkSchema(def, slot.value, { layer: true });
      if (issues.length > 0) row.nonconforming = issues;
    }
```

After `mergeApplied`:

```ts
  const mergedIssues = merged.value === undefined ? [] : checkSchema(def, merged.value, { layer: false });
  return { value: merged.value, provenance: merged.provenance, invalid, rows, mergedIssues };
```

(add `mergedIssues: SchemaIssue[]` to `Resolution`). In `listSettings`, after the `invalid` assignment:

```ts
    const nonconforming = resolution.rows
      .filter((r) => r.nonconforming)
      .map((r) => ({ scope: r.scope, file: r.file, issues: r.nonconforming! }));
    if (nonconforming.length > 0) listed.nonconforming = nonconforming;
    if (resolution.mergedIssues.length > 0) listed.mergedIssues = resolution.mergedIssues;
```

Add the helpers:

```ts
export function listUnregisteredSettings(opts: ResolveOpts = {}): { key: string; scope: Scope; file: string }[] {
  return listUnregistered(readStores(), opts).map((s) => ({ key: s.key, scope: s.provenance[0]!.scope, file: s.provenance[0]!.file! }));
}

export function repoSectionsFor(key: string): { identity: string; scopes: SettingScope[] }[] {
  const stores = readStores();
  const byId = new Map<string, SettingScope[]>();
  const note = (scope: SettingScope, store: StoreFile) => {
    for (const [id, section] of Object.entries(store.repos)) {
      if (section[key] === undefined) continue;
      const list = byId.get(id) ?? [];
      if (!list.includes(scope)) list.push(scope);
      byId.set(id, list);
    }
  };
  for (const store of stores.teams) note("team", store);
  note("user", stores.user);
  note("machine", stores.machine);
  return [...byId.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([identity, scopes]) => ({ identity, scopes }));
}
```

`listUnregistered` runs `emitSettingsWarning` per key; that is the existing behavior for `listSettings` and stays.

- [ ] **Step 4: Render in the CLI**

In `commands/settings-keys.ts`, `renderListRow`, after the `invalid` loop:

```ts
  for (const nc of s.nonconforming ?? []) labels.push(`nonconforming[${nc.scope}]: ${firstIssueText(nc.issues)}`);
  if (s.mergedIssues && s.mergedIssues.length > 0) labels.push(`merged: ${firstIssueText(s.mergedIssues)}`);
```

In `renderExplainRow`, before the final `return`:

```ts
  if (row.nonconforming) {
    return `  ${green}${scopeLabel}${reset} ${fileLabel}  ${formatValueInline(row.value)}  ${yellow}[nonconforming: ${firstIssueText(row.nonconforming)}]${reset}`;
  }
```

Import `firstIssueText` from `../lib/settings/registry.ts` if that barrel re-exports it, else from `../../packages/rt-client/src/settings/schema.ts` the way `lib/settings/*.ts` barrels do (check `lib/settings/registry.ts`'s one-line re-export and add `schema.ts` to it as `lib/settings/schema.ts` in the same style).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts commands/__tests__/settings-keys-render.test.ts packages/rt-client/src/settings packages/rt-client/test/settings-warn-sink.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the e2e settings file once**

Run: `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts`
Expected: PASS (it asserts substrings, and the new labels only appear on nonconforming values). If it fails on an exact string, the label placement above is wrong; fix the rendering, never the e2e assertion.

- [ ] **Step 7: Export, gate, commit**

In `packages/rt-client/src/index.ts` add `listUnregisteredSettings, repoSectionsFor` to the `./settings/resolve.ts` export list.

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/resolve.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/index.ts commands/settings-keys.ts commands/__tests__/settings-keys-render.test.ts lib/settings
git commit -m "feat(settings): label nonconforming layers on read, never skip them

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: settings-kit server: wire fields, repo resolution, `/repos`, `validateWrite`

**Files:**
- Modify: `packages/settings-kit/src/server.ts`
- Test: `packages/settings-kit/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `checkSchema`, `jsonSchemasFor`, `validateWrite`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities`, `ExplainRow.nonconforming` (Tasks 1, 2, 6).
- Produces:
  - `SettingDefWire` gains `schema?: JsonSchema`, `layerSchema?: JsonSchema`, `storeVersion: number`, `issues?: WireIssue[]`, `mergedIssues?: SchemaIssue[]`, `repos?: { identity: string; scopes: string[] }[]`
  - `type WireIssue = { scope: string; file: string | null; repo?: string; kind: string; path: (string | number)[]; message: string; [extra: string]: unknown }`
  - `ExplainRowWire` gains `nonconforming?: SchemaIssue[]`
  - `/defs` response gains `unregistered: { key: string; scope: string; file: string }[]`; `/defs` and `/explain/:key` accept `?repo=`; `/set` and `/unset` accept `repo`; `GET {base}/repos` → `{ repos: { identity: string; label: string }[] }`
  - `RtSettingsApi` gains `validateWrite`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities`, and optional `listRepos?: () => Promise<{ identity: string; label: string }[]>`

- [ ] **Step 1: Write the failing tests**

Extend the fake `DEFS` in `server.test.ts` so `board.slack` carries a zod schema and `rt.roles` is `repoScoped: true` with a deep schema; extend `RT` with:

```ts
  validateWrite: (_def: FakeDef, value: unknown) =>
    value === "invalid" ? { ok: false, reason: "value is invalid", issues: [] } : { ok: true },
  listUnregisteredSettings: () => [{ key: "board.rtRepos", scope: "machine", file: "/home/user/local/settings.local.jsonc" }],
  repoSectionsFor: (key: string) => (key === "rt.roles" ? [{ identity: "gitlab.example.com/acme/app", scopes: ["team"] }] : []),
  listStoreRepoIdentities: () => ["gitlab.example.com/acme/app"],
```

and make `explainSetting` accept `(key, opts)` and, when `opts?.repoIdentity` is set for `rt.roles`, return a row `{ scope: "team.repo", file: "/home/team/settings.team.jsonc", present: true, value: { dev: { port: 3000 } } }` after the user row. Then add:

```ts
describe("schema on the wire", () => {
  test("/defs carries schema, layerSchema, storeVersion, issues and unregistered", async () => {
    const res = await handle(get("/api/settings/defs"));
    const body = await res!.json();
    const slack = body.defs.find((d: any) => d.key === "board.slack");
    expect(slack.schema.type).toBe("object");
    expect(slack.layerSchema.required).toBeUndefined();
    expect(slack.storeVersion).toBe(1);
    expect(body.unregistered).toEqual([{ key: "board.rtRepos", scope: "machine", file: "/home/user/local/settings.local.jsonc" }]);
  });

  test("a nonconforming explain row becomes an issue on /defs and on the explain row", async () => {
    // make the fake explain return nonconforming for board.title's user row
    const res = await handle(get("/api/settings/explain/board.title"));
    const body = await res!.json();
    expect(body.rows[0].nonconforming).toEqual([{ path: [], message: "bad" }]);
    const defs = await (await handle(get("/api/settings/defs")))!.json();
    expect(defs.defs.find((d: any) => d.key === "board.title").issues[0]).toMatchObject({ scope: "user", kind: "nonconforming", path: [], message: "bad" });
  });

  test("a secret key's issues never carry a value", async () => {
    const defs = await (await handle(get("/api/settings/defs")))!.json();
    const secret = defs.defs.find((d: any) => d.key === "rt.secretThing");
    for (const issue of secret.issues ?? []) expect(JSON.stringify(issue)).not.toContain("rt.secretThing-user-value");
  });

  test("?repo= resolves repo rungs and repos[] lists sections", async () => {
    const body = await (await handle(get("/api/settings/defs?repo=gitlab.example.com%2Facme%2Fapp")))!.json();
    const roles = body.defs.find((d: any) => d.key === "rt.roles");
    expect(roles.effective.scope).toBe("team.repo");
    expect(roles.repos).toEqual([{ identity: "gitlab.example.com/acme/app", scopes: ["team"] }]);
  });

  test("GET /repos lists store identities with labels", async () => {
    const body = await (await handle(get("/api/settings/repos")))!.json();
    expect(body.repos).toEqual([{ identity: "gitlab.example.com/acme/app", label: "acme/app" }]);
  });

  test("/set forwards repo and uses validateWrite", async () => {
    await handle(post("/api/settings/set", { key: "rt.roles", scope: "team", repo: "gitlab.example.com/acme/app", value: { dev: { port: 1 } } }), { allowComposite: true });
    expect(setCalls.at(-1)).toEqual(["rt.roles", { dev: { port: 1 } }, "team", { repoIdentity: "gitlab.example.com/acme/app" }]);
    const bad = await handle(post("/api/settings/set", { key: "board.title", scope: "user", value: "invalid" }));
    expect(bad!.status).toBe(400);
    expect((await bad!.json()).error).toBe("value is invalid");
  });
});
```

For the nonconforming case, have the fake `explainSetting` return `nonconforming: [{ path: [], message: "bad" }]` on `board.title`'s user row.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/settings-kit/src/__tests__/server.test.ts`
Expected: FAIL on the new block.

- [ ] **Step 3: Implement in `server.ts`**

- Import `checkSchema, jsonSchemasFor, validateWrite, listUnregisteredSettings, repoSectionsFor, listStoreRepoIdentities, hasSchema` and types `SchemaIssue, JsonSchema` from `@mattstack/rt-client`; add them to `RtSettingsApi` (and optional `listRepos`).
- `SettingDefWire`: add the fields from Interfaces. In `defToWire`, add `storeVersion: def.storeVersion ?? 1` and, when `hasSchema(def)`, `schema: jsonSchemasFor(def.schema).full` and for deep object keys `layerSchema: jsonSchemasFor(def.schema).layer`.
- `sanitizeRows`: copy `row.nonconforming` through (issues carry no values).
- New `issuesFromRows(def, rows, repo?)`: for each row, `invalid` → `{ scope, file, repo?, kind: "invalid", path: [], message: row.invalid }`; `nonconforming` → one entry per issue with `kind: "nonconforming"`. Never include `row.value`.
- `/defs`: read `url.searchParams.get("repo")`; call `rt.explainSetting(d.key, { repoIdentity: repo ?? null })`; set `issues` (when any), `mergedIssues` (from `checkSchema(def, effective.value, { layer: false })` when the effective value is present and the def has a schema and is not secret), and `repos: rt.repoSectionsFor(d.key)` for `repoScoped` defs. Add `unregistered: rt.listUnregisteredSettings({ repoIdentity: repo ?? null })` to the body.
- `/explain/:key`: same `?repo=`.
- `GET {base}/repos`: identities from `rt.listStoreRepoIdentities()` merged with `await rt.listRepos?.()` (ignore a rejection), label = the part after the first `/` (`acme/app`), sorted by identity.
- `/set` and `/unset`: read `body.repo` (string) and pass `{ team, repoIdentity: repo }` (omit undefined keys so the existing `toEqual([..., {}])` assertions hold). Replace the `rt.validateValue` call in `/set` with `rt.validateWrite(def, value, { scope, repoIdentity: repo, team })`; on failure answer `{ error: verdict.reason, issues: verdict.issues }` with 400. Keep the `matchesShape` gate for now (Task 8 replaces it).
- Add `${base}/repos` to the route guard at the top of the handler.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/settings-kit`
Expected: PASS (the effective/move tests untouched).

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add packages/settings-kit/src/server.ts packages/settings-kit/src/__tests__/server.test.ts
git commit -m "feat(settings-kit): schema, issues, repos and repo resolution on the wire; /set uses validateWrite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: settings-kit shapes: `recognize`, `checkValue`, `SHAPES` shrinks to `external`

**Files:**
- Modify: `packages/settings-kit/package.json` (add `@cfworker/json-schema@^4.1.1` to `dependencies`)
- Modify: `packages/settings-kit/src/shapes.ts`
- Modify: `packages/settings-kit/src/server.ts` (the `compositeAllowed` and `matchesShape` gates)
- Test: `packages/settings-kit/src/__tests__/shapes.test.ts`

**Interfaces:**
- Consumes: `SettingDefWire.schema` / `layerSchema` (Task 7); `validateJson` semantics (Task 1) reimplemented here without importing rt-client into the browser bundle.
- Produces:
  - `type Recognized = { kind: "stringList" } | { kind: "stringMap"; labels: [string, string] } | { kind: "leaves"; fields: Record<string, LeafType>; placeholders: Record<string, string> } | { kind: "objectList"; itemFields: Record<string, LeafType>; required: string[] } | { kind: "objectMap"; entryFields: Record<string, LeafType>; required: string[]; labels: [string, string] } | { kind: "json" }`
  - `recognize(schema: JsonSchema | undefined): Recognized`
  - `checkValue(schema: JsonSchema, value: unknown): SchemaIssue[]`
  - `SHAPES` keeps only the three `external` entries; `rowKind`, `summarize`, `matchesShape`, `targetScope` read the def's schema through `recognize`. `RowKind` adds `"objectList" | "objectMap" | "json"`.

- [ ] **Step 1: Write the failing tests**

Replace the `SHAPES` describe in `shapes.test.ts` with:

```ts
describe("recognize", () => {
  const byKey = new Map(allDefs().map((d) => [d.key, d]));
  const json = (key: string) => toJsonSchema(byKey.get(key)!.schema!);

  test("maps every previously shaped key to its old kind", () => {
    const expected: Record<string, string> = {
      "board.projects": "stringList", "rt.repoRoots": "stringList", "setup.waived": "stringList",
      "rt.repoIdentityOverrides": "stringMap",
      "board.slack": "leaves", "board.triage": "leaves", "rt.homeSnapshot": "leaves", "rt.notifications": "leaves",
      "gitq.workSlots": "leaves", "boxscore.sizeBand": "leaves",
    };
    for (const [key, kind] of Object.entries(expected)) expect(`${key}: ${recognize(json(key)).kind}`).toBe(`${key}: ${kind}`);
  });

  test("keeps labels and placeholders from the schema", () => {
    const map = recognize(json("rt.repoIdentityOverrides"));
    expect(map).toMatchObject({ kind: "stringMap", labels: ["remote URL", "identity"] });
    const slack = recognize(json("board.slack"));
    expect(slack).toMatchObject({ kind: "leaves", placeholders: { "emoji.looking": "eyes" } });
  });

  test("an array of flat objects is an objectList with its required names", () => {
    const r = recognize(json("rt.notify.eventBridges"));
    expect(r.kind).toBe("objectList");
    if (r.kind === "objectList") expect(r.required).toEqual(["pattern", "category", "title", "message"]);
  });

  test("a map of flat objects is an objectMap", () => {
    expect(recognize(json("deck.apps")).kind).toBe("objectMap");
  });

  test("anything deeper is json", () => {
    expect(recognize({ type: "object", properties: { a: { type: "object", properties: { b: { type: "array", items: { type: "object" } } } } } }).kind).toBe("json");
    expect(recognize(undefined).kind).toBe("json");
  });
});

describe("checkValue", () => {
  test("agrees with the server's issue shape", () => {
    const issues = checkValue({ type: "array", items: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } }, [{ pattern: 1 }]);
    expect(issues[0]!.path).toEqual([0, "pattern"]);
  });
});

describe("SHAPES", () => {
  test("holds only external keys", () => {
    for (const shape of Object.values(SHAPES)) expect(shape.kind).toBe("external");
  });
});

describe("placeholder parity", () => {
  test("board.slack placeholders equal DEFAULT_SLACK_EMOJI", () => {
    const r = recognize(toJsonSchema(allDefs().find((d) => d.key === "board.slack")!.schema!));
    if (r.kind !== "leaves") throw new Error("board.slack is leaves");
    expect(r.placeholders).toEqual({ "emoji.looking": DEFAULT_SLACK_EMOJI.looking, "emoji.commented": DEFAULT_SLACK_EMOJI.commented, "emoji.approved": DEFAULT_SLACK_EMOJI.approved });
  });
});
```

Update the `rowKind`/`summarize` tests in that file to build defs with `schema:` (a JSON Schema literal) instead of relying on `SHAPES`; `toJsonSchema` is imported from `@mattstack/rt-client` (test-only).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/settings-kit/src/__tests__/shapes.test.ts`
Expected: FAIL, `recognize`/`checkValue` missing.

- [ ] **Step 3: Implement**

In `shapes.ts`:

```ts
import { Validator, type OutputUnit } from "@cfworker/json-schema";

export type JsonSchema = Record<string, unknown>;
export interface SchemaIssue { path: (string | number)[]; message: string }

const leafOf = (s: JsonSchema): LeafType | null => {
  if (Array.isArray(s.enum) && s.enum.every((e) => typeof e === "string")) return { enum: s.enum as string[] };
  if (s.type === "string" || s.type === "number" || s.type === "boolean") return s.type;
  if (Array.isArray(s.type)) { const t = s.type.filter((x) => x !== "null"); if (t.length === 1) return leafOf({ ...s, type: t[0] }); }
  return null;
};

const flatFields = (props: Record<string, JsonSchema> | undefined): Record<string, LeafType> | null => {
  if (!props) return null;
  const out: Record<string, LeafType> = {};
  for (const [k, v] of Object.entries(props)) { const leaf = leafOf(v); if (!leaf) return null; out[k] = leaf; }
  return out;
};

/** Dotted leaf paths one level deep (emoji.looking), the way leaves rows render. */
const leafPaths = (props: Record<string, JsonSchema>, prefix = ""): { fields: Record<string, LeafType>; placeholders: Record<string, string> } | null => {
  const fields: Record<string, LeafType> = {}; const placeholders: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    const leaf = leafOf(v);
    if (leaf) { fields[prefix + k] = leaf; if (typeof v.placeholder === "string") placeholders[prefix + k] = v.placeholder; continue; }
    if (v.type === "object" && v.properties && prefix === "") {
      const nested = leafPaths(v.properties as Record<string, JsonSchema>, `${k}.`);
      if (!nested) return null;
      Object.assign(fields, nested.fields); Object.assign(placeholders, nested.placeholders);
      continue;
    }
    return null;
  }
  return { fields, placeholders };
};

export function recognize(schema: JsonSchema | undefined): Recognized {
  if (!schema) return { kind: "json" };
  const labels = (schema.labels as { key?: string; value?: string } | undefined);
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
    if (!schema.properties && add && typeof add === "object") {
      if (add.type === "string") return { kind: "stringMap", labels: labelPair };
      if (add.type === "object") {
        const fields = flatFields(add.properties as Record<string, JsonSchema> | undefined);
        if (fields) return { kind: "objectMap", entryFields: fields, required: (add.required as string[]) ?? [], labels: labelPair };
      }
      return { kind: "json" };
    }
    const leaves = leafPaths((schema.properties as Record<string, JsonSchema>) ?? {});
    if (leaves) return { kind: "leaves", ...leaves };
  }
  return { kind: "json" };
}

export function checkValue(schema: JsonSchema, value: unknown): SchemaIssue[] {
  const out = new Validator(schema as never, "2020-12", false).validate(value);
  return out.valid ? [] : out.errors.map((u: OutputUnit) => ({
    path: u.instanceLocation.replace(/^#\/?/, "").split("/").filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s.replace(/~1/g, "/").replace(/~0/g, "~"))),
    message: u.error,
  }));
}
```

zod's record emits `propertyNames` too; `recognize` ignores it. If `z.toJSONSchema` emits a record as `additionalProperties: {...}` under a different key in 4.6 (check one converted record in a scratch script), match what it emits.

Then: `SHAPES` keeps `board.tabs`, `board.members`, `board.hiddenMembers` only; `rowKind(def)` returns `"external"` for a SHAPES key, `"readonly"` for secret/unwritable, `recognize(def.schema).kind` for composite defs, `"enum"`/`"scalar"` as before; `summarize` switches on `recognize(def.schema)` (objectList and objectMap count items and entries; `json` falls back to the array/object count or `"unset"`); `matchesShape(shape, value)` stays for `CompositeShape` callers, and a new `matchesSchema(def, value)` returns `checkValue(def.layerSchema ?? def.schema, value).length === 0`. In `server.ts`, `compositeAllowed` admits a composite def when `hasSchema(def)` and `SHAPES[def.key]?.kind !== "external"`; drop the `matchesShape` gate (validateWrite covers it).

Add `@cfworker/json-schema` to settings-kit's `dependencies` (`cd packages/settings-kit && bun add @cfworker/json-schema@^4.1.1 && cd ../..`).

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/settings-kit`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add packages/settings-kit/package.json bun.lock packages/settings-kit/src/shapes.ts packages/settings-kit/src/server.ts packages/settings-kit/src/__tests__/shapes.test.ts
git commit -m "feat(settings-kit): recognize editors from the schema, checkValue in the browser, SHAPES keeps only external keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `rt settings check`

**Files:**
- Create: `packages/rt-client/src/settings/check.ts`
- Modify: `commands/settings-keys.ts` (add `settingsCheck`), `lib/command-tree-def.ts` (`settings.check` node), `packages/rt-client/src/index.ts`
- Test: `packages/rt-client/src/settings/__tests__/check.test.ts`, `commands/__tests__/settings-check.test.ts` (create)

**Interfaces:**
- Consumes: `readStore`, `listTeams`, paths, `checkSchema`, `validateValue`, `getSetting`, `listUnregisteredSettings`, `listStoreRepoIdentities`.
- Produces: `checkStores(): CheckReport` where

```ts
export interface CheckFinding {
  key: string;
  scope: SettingScope;
  file: string;
  repo?: string;
  kind: "invalid" | "nonconforming" | "merged" | "unregistered";
  issues: SchemaIssue[];
}
export interface CheckReport { findings: CheckFinding[]; failing: number }
```

`failing` counts `invalid`, `nonconforming` and `merged` findings (unregistered keys are listed, not failures).

- [ ] **Step 1: Write the failing tests**

`check.test.ts` (HOME re-pointed per test as in `resolve.test.ts`):

```ts
  test("reports a nonconforming layer, a type-invalid layer, a merged failure and an unregistered key", () => {
    withSchema("rt.homeSnapshot", z.looseObject({ enabled: z.boolean(), debounceSec: z.number() }), () => {
      writeMachine({ "rt.homeSnapshot": { enabled: "yes" }, "rt.repoRoots": "nope", "board.rtRepos": [] });
      const report = checkStores();
      const kinds = report.findings.map((f) => `${f.key}:${f.kind}`);
      expect(kinds).toContain("rt.homeSnapshot:nonconforming");
      expect(kinds).toContain("rt.homeSnapshot:merged");
      expect(kinds).toContain("rt.repoRoots:invalid");
      expect(kinds).toContain("board.rtRepos:unregistered");
      expect(report.failing).toBe(3);
    });
  });

  test("walks repo sections and reports the repo", () => {
    withSchema("rt.worktrees", z.looseObject({ onDeck: z.number() }), () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: "two" } } } });
      const f = checkStores().findings.find((x) => x.key === "rt.worktrees" && x.kind === "nonconforming")!;
      expect(f.repo).toBe(IDENTITY);
      expect(f.scope).toBe("team");
    });
  });

  test("clean stores report nothing failing", () => {
    writeMachine({ "rt.repoRoots": ["~/Documents/GitHub"] });
    expect(checkStores().failing).toBe(0);
  });
```

`commands/__tests__/settings-check.test.ts`: call `settingsCheck(["--json"])` with `console.log` spied and `process.exitCode` observed: with a seeded nonconforming machine store it prints `{ ok: false, findings: [...] }` and sets `process.exitCode = 1`; with clean stores `{ ok: true, findings: [] }` and exit code stays 0. Use the same HOME fixture pattern; restore `process.exitCode` in `afterEach`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/check.test.ts commands/__tests__/settings-check.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `check.ts`**

```ts
/**
 * rt settings check: every stored value against its type check and layer
 * schema, every merged value against the full schema, plus unregistered
 * keys. Read-only; uses this rt's registry.
 */

import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { getDef, validateValue, type SettingScope } from "./registry-machinery.ts";
import { checkSchema, hasSchema, type SchemaIssue } from "./schema.ts";
import { getSetting, listStoreRepoIdentities, listUnregisteredSettings } from "./resolve.ts";
import { listTeams, readStore, type StoreFile } from "./stores.ts";

export interface CheckFinding { key: string; scope: SettingScope; file: string; repo?: string; kind: "invalid" | "nonconforming" | "merged" | "unregistered"; issues: SchemaIssue[] }
export interface CheckReport { findings: CheckFinding[]; failing: number }

export function checkStores(): CheckReport {
  const findings: CheckFinding[] = [];
  const stores: { scope: SettingScope; store: StoreFile }[] = [
    ...listTeams().map((t) => ({ scope: "team" as const, store: readStore(teamSettingsPath(t)) })),
    { scope: "user", store: readStore(userSettingsPath()) },
    { scope: "machine", store: readStore(machineSettingsPath()) },
  ];
  for (const { scope, store } of stores) {
    if (!store.exists) continue;
    checkSection(scope, store.file, store.global, undefined, findings);
    for (const [repo, section] of Object.entries(store.repos)) checkSection(scope, store.file, section, repo, findings);
  }
  for (const def of allComposite()) {
    for (const repo of [null, ...(def.repoScoped ? listStoreRepoIdentities() : [])]) {
      let value: unknown;
      try { value = getSetting(def.key, { repoIdentity: repo, expand: false }).value; } catch { continue; }
      if (value === undefined) continue;
      const issues = checkSchema(def, value, { layer: false });
      if (issues.length > 0) findings.push({ key: def.key, scope: "user", file: "(merged)", ...(repo ? { repo } : {}), kind: "merged", issues });
    }
  }
  for (const u of listUnregisteredSettings()) findings.push({ key: u.key, scope: u.scope.replace(".repo", "") as SettingScope, file: u.file, kind: "unregistered", issues: [] });
  return { findings, failing: findings.filter((f) => f.kind !== "unregistered").length };
}

function checkSection(scope: SettingScope, file: string, section: Record<string, unknown>, repo: string | undefined, out: CheckFinding[]): void {
  for (const [key, value] of Object.entries(section)) {
    const def = getDef(key);
    if (!def) continue;
    const guarded = scope === "machine" ? { ...def, pathGuardFields: undefined } : def;
    const typed = validateValue(guarded, value);
    const at = { key, scope, file, ...(repo ? { repo } : {}) };
    if (!typed.ok) { out.push({ ...at, kind: "invalid", issues: [{ path: [], message: typed.reason }] }); continue; }
    if (!hasSchema(def)) continue;
    const issues = checkSchema(def, value, { layer: true });
    if (issues.length > 0) out.push({ ...at, kind: "nonconforming", issues });
  }
}

function allComposite() {
  return allDefs().filter((d) => d.type === "object" || d.type === "array");
}
```

(import `allDefs` too). The merged finding's `scope`/`file` are placeholders for "the merge"; the CLI prints `merged` findings without a scope.

`settingsCheck(args)` in `commands/settings-keys.ts`: `--json` prints `{ ok: report.failing === 0, findings }`; human output prints one line per finding (`key  scope[/repo]  kind: <first issue>`, using `firstIssueText`), then `N failing, M unregistered`; sets `process.exitCode = 1` when `failing > 0`. Add the tree node under `settings`:

```ts
      check: {
        description: "Check every stored settings value against its schema and list unregistered keys",
        module: "./commands/settings-keys.ts",
        fn: "settingsCheck",
        args: [{ name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable output" }],
      },
```

Export `checkStores` and the two types from `index.ts`.

- [ ] **Step 4: Run to verify it passes, regenerate docs, conformance**

Run: `bun test packages/rt-client/src/settings/__tests__/check.test.ts commands/__tests__/settings-check.test.ts && bun run docs:gen && bun run docs:check && bun run picker:check`
Expected: PASS; `docs:gen` updates the command reference (commit those files).

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/check.ts packages/rt-client/src/settings/__tests__/check.test.ts packages/rt-client/src/index.ts commands/settings-keys.ts commands/__tests__/settings-check.test.ts lib/command-tree-def.ts docs
git commit -m "feat(settings): rt settings check audits every store against the schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Schema lock file, classifier, `rt settings schema lock|diff`, CI and preflight

**Files:**
- Create: `packages/rt-client/src/settings/schema-lock.ts`, `packages/rt-client/settings-schema.lock.json`, `packages/rt-client/src/settings/breaking-schema-changes.json`, `commands/settings-schema.ts`
- Modify: `lib/module-registry.ts`, `lib/command-tree-def.ts`, `lib/release/preflight.ts`, `.github/workflows/checks.yml`
- Test: `packages/rt-client/src/settings/__tests__/schema-lock.test.ts`, `commands/__tests__/settings-schema.test.ts`, `commands/__tests__/release-preflight.test.ts`

**Interfaces:**
- Produces:
  - `buildLock(): Lock` where `type Lock = Record<string, { storeVersion: number; schema: JsonSchema }>` (composite keys only, sorted by key)
  - `classifyLockDiff(prev: Lock, next: Lock): Change[]` where `type Change = { key: string; kind: "safe" | "breaking"; detail: string }`
  - `readBreakingChanges(): Record<string, string>` from `breaking-schema-changes.json`
  - `checkLockAgainst(prev: Lock, next: Lock, acknowledged: Record<string, string>): { ok: boolean; problems: string[] }`: every breaking key must have `next.storeVersion > prev.storeVersion` and an acknowledgement; a key never in `prev` is always ok.
  - CLI: `rt settings schema lock` writes the lock file; `rt settings schema diff [--against <lockfile>] [--json]` prints changes and exits 1 on an unacknowledged breaking change (default `--against` is `git show main:packages/rt-client/settings-schema.lock.json`, read through `git` from the repo root).

- [ ] **Step 1: Write the failing tests**

`schema-lock.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildLock, checkLockAgainst, classifyLockDiff } from "../schema-lock.ts";

const obj = (props: Record<string, unknown>, required: string[] = [], extra: Record<string, unknown> = {}) =>
  ({ type: "object", properties: props, required, ...extra });
const lock = (schema: Record<string, unknown>, storeVersion = 1) => ({ "t.k": { storeVersion, schema } });

describe("classifyLockDiff", () => {
  test("safe: key added, optional property added, enum value added, limit loosened, extras loosened", () => {
    expect(classifyLockDiff({}, lock(obj({})))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock(obj({})), lock(obj({ a: { type: "string" } })))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock({ enum: ["a"] }), lock({ enum: ["a", "b"] }))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock({ type: "number", minimum: 1 }), lock({ type: "number" }))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock(obj({}, [], { additionalProperties: false })), lock(obj({})))[0]).toMatchObject({ kind: "safe" });
  });

  test("breaking: key removed, property made required, type changed, enum value removed, limit tightened, extras tightened, pattern added", () => {
    expect(classifyLockDiff(lock(obj({})), {})[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock(obj({ a: { type: "string" } })), lock(obj({ a: { type: "string" } }, ["a"])))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "string" }), lock({ type: "number" }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ enum: ["a", "b"] }), lock({ enum: ["a"] }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "number" }), lock({ type: "number", minimum: 1 }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock(obj({})), lock(obj({}, [], { additionalProperties: false })))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "string" }), lock({ type: "string", pattern: "^x" }))[0]).toMatchObject({ kind: "breaking" });
  });

  test("property removed is safe when extras are allowed and breaking when not", () => {
    expect(classifyLockDiff(lock(obj({ a: { type: "string" } })), lock(obj({})))[0]).toMatchObject({ kind: "safe" });
    expect(classifyLockDiff(lock(obj({ a: { type: "string" } }, [], { additionalProperties: false })), lock(obj({}, [], { additionalProperties: false })))[0]).toMatchObject({ kind: "breaking" });
  });

  test("unknown keyword: unchanged is safe, changed is breaking; annotations are ignored", () => {
    expect(classifyLockDiff(lock({ type: "string", contentMediaType: "x" }), lock({ type: "string", contentMediaType: "x" }))).toEqual([]);
    expect(classifyLockDiff(lock({ type: "string", contentMediaType: "x" }), lock({ type: "string", contentMediaType: "y" }))[0]).toMatchObject({ kind: "breaking" });
    expect(classifyLockDiff(lock({ type: "string", description: "a" }), lock({ type: "string", description: "b", placeholder: "p" }))).toEqual([]);
  });

  test("enum of one and const are the same", () => {
    expect(classifyLockDiff(lock({ enum: ["human"] }), lock({ const: "human" }))).toEqual([]);
  });
});

describe("checkLockAgainst", () => {
  test("a breaking change needs a storeVersion bump and an acknowledgement", () => {
    const prev = lock({ type: "string" });
    expect(checkLockAgainst(prev, lock({ type: "number" }), {}).ok).toBe(false);
    expect(checkLockAgainst(prev, lock({ type: "number" }, 2), {}).ok).toBe(false);
    expect(checkLockAgainst(prev, lock({ type: "number" }, 2), { "t.k": "renamed the value" }).ok).toBe(true);
  });
});

describe("buildLock", () => {
  test("covers every composite key, sorted, at storeVersion 1 by default", () => {
    const l = buildLock();
    const keys = Object.keys(l);
    expect(keys).toEqual([...keys].sort());
    expect(l["rt.notify.eventBridges"]!.storeVersion).toBe(1);
    expect(l["rt.notify.eventBridges"]!.schema.type).toBe("array");
  });
});
```

`commands/__tests__/settings-schema.test.ts`: `settingsSchemaLock([])` writes the lock file equal to `buildLock()`; `settingsSchemaDiff(["--against", <temp file with a mutated lock>, "--json"])` prints `{ ok: false, changes: [...] }` and sets exit code 1 for a breaking change, `{ ok: true }` for a safe one.

`release-preflight.test.ts`: extend the existing seams so the `schema lock` row reads `ok` when the committed lock equals `buildLock()` and the diff against the previous tag has no unacknowledged breaking change, `stale` otherwise (follow the file's existing row pattern; the row id is `schema-lock`).

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `schema-lock.ts`**

```ts
/**
 * The schema lock: every composite key's storeVersion and JSON Schema,
 * generated from the registry and committed, so a breaking shape change
 * is caught in CI and at release preflight rather than in a user's store.
 */

import { allDefs } from "./registry-machinery.ts";
import { toJsonSchema, type JsonSchema } from "./schema.ts";

export type Lock = Record<string, { storeVersion: number; schema: JsonSchema }>;
export interface Change { key: string; kind: "safe" | "breaking"; detail: string }

const ANNOTATIONS = new Set(["title", "description", "default", "$schema", "$id", "examples", "labels", "placeholder", "deprecated", "readOnly", "writeOnly"]);
const KNOWN = new Set(["type", "properties", "required", "additionalProperties", "propertyNames", "items", "prefixItems", "enum", "const", "anyOf", "oneOf", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"]);

export function buildLock(): Lock {
  const out: Lock = {};
  for (const def of allDefs()) {
    if (!def.schema) continue;
    out[def.key] = { storeVersion: def.storeVersion ?? 1, schema: toJsonSchema(def.schema) };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
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

type NodeChange = { kind: "safe" | "breaking"; detail: string };

function norm(s: JsonSchema): JsonSchema {
  const out = { ...s };
  if (Array.isArray(out.enum) && out.enum.length === 1 && !("const" in out)) { out.const = out.enum[0]; delete out.enum; }
  return out;
}

function diffNode(a0: JsonSchema, b0: JsonSchema, at: string): NodeChange[] {
  const a = norm(a0), b = norm(b0);
  const out: NodeChange[] = [];
  const where = at || "(root)";
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !ANNOTATIONS.has(k)));
  for (const k of keys) {
    const av = a[k], bv = b[k];
    const same = JSON.stringify(av) === JSON.stringify(bv);
    if (!KNOWN.has(k)) { if (!same) out.push({ kind: "breaking", detail: `${where}: ${k} changed` }); continue; }
    if (same) continue;
    switch (k) {
      case "type": out.push({ kind: widens(av, bv) ? "safe" : "breaking", detail: `${where}: type ${JSON.stringify(av)} -> ${JSON.stringify(bv)}` }); break;
      case "enum": out.push({ kind: superset(bv, av) ? "safe" : "breaking", detail: `${where}: enum changed` }); break;
      case "const": out.push({ kind: bv === undefined ? "safe" : "breaking", detail: `${where}: const changed` }); break;
      case "required": {
        const added = ((bv as string[]) ?? []).filter((r) => !((av as string[]) ?? []).includes(r));
        out.push({ kind: added.length === 0 ? "safe" : "breaking", detail: `${where}: required ${added.length ? `added ${added.join(",")}` : "relaxed"}` });
        break;
      }
      case "additionalProperties": {
        const closedA = av === false, closedB = bv === false;
        if (closedB && !closedA) out.push({ kind: "breaking", detail: `${where}: additionalProperties tightened` });
        else if (closedA && !closedB) out.push({ kind: "safe", detail: `${where}: additionalProperties loosened` });
        else if (typeof av === "object" && typeof bv === "object") out.push(...diffNode(av as JsonSchema, bv as JsonSchema, `${at}[*]`));
        else out.push({ kind: "breaking", detail: `${where}: additionalProperties changed` });
        break;
      }
      case "properties": {
        const ap = (av ?? {}) as Record<string, JsonSchema>, bp = (bv ?? {}) as Record<string, JsonSchema>;
        const closed = b.additionalProperties === false;
        for (const p of new Set([...Object.keys(ap), ...Object.keys(bp)])) {
          const path = at ? `${at}.${p}` : p;
          if (!(p in ap)) out.push({ kind: "safe", detail: `${path}: property added` });
          else if (!(p in bp)) out.push({ kind: closed ? "breaking" : "safe", detail: `${path}: property removed` });
          else out.push(...diffNode(ap[p]!, bp[p]!, path));
        }
        break;
      }
      case "items": case "propertyNames":
        if (typeof av === "object" && typeof bv === "object") out.push(...diffNode(av as JsonSchema, bv as JsonSchema, `${at}[]`));
        else out.push({ kind: "breaking", detail: `${where}: ${k} changed` });
        break;
      case "prefixItems": out.push({ kind: "breaking", detail: `${where}: prefixItems changed` }); break;
      case "anyOf": case "oneOf": out.push({ kind: branchSuperset(bv, av) ? "safe" : "breaking", detail: `${where}: ${k} changed` }); break;
      case "minimum": case "exclusiveMinimum": case "minLength": case "minItems":
        out.push({ kind: bv === undefined || (av !== undefined && (bv as number) <= (av as number)) ? "safe" : "breaking", detail: `${where}: ${k} ${av} -> ${bv}` }); break;
      case "maximum": case "exclusiveMaximum": case "maxLength": case "maxItems":
        out.push({ kind: bv === undefined || (av !== undefined && (bv as number) >= (av as number)) ? "safe" : "breaking", detail: `${where}: ${k} ${av} -> ${bv}` }); break;
      case "pattern": case "format": out.push({ kind: bv === undefined ? "safe" : "breaking", detail: `${where}: ${k} ${bv === undefined ? "removed" : "changed"}` }); break;
    }
  }
  return out;
}

const asList = (t: unknown): string[] => (t === undefined ? [] : Array.isArray(t) ? (t as string[]) : [t as string]);
function widens(a: unknown, b: unknown): boolean { const A = asList(a), B = asList(b); return B.length === 0 || A.every((t) => B.includes(t)); }
function superset(b: unknown, a: unknown): boolean { return Array.isArray(a) && Array.isArray(b) && a.every((x) => b.some((y) => JSON.stringify(x) === JSON.stringify(y))); }
function branchSuperset(b: unknown, a: unknown): boolean { return superset(b, a); }

export function checkLockAgainst(prev: Lock, next: Lock, acknowledged: Record<string, string>): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const c of classifyLockDiff(prev, next)) {
    if (c.kind !== "breaking" || !(c.key in prev)) continue;
    const bumped = (next[c.key]?.storeVersion ?? 0) > prev[c.key]!.storeVersion;
    if (!bumped) problems.push(`${c.key}: breaking (${c.detail}) without a storeVersion bump`);
    else if (!acknowledged[c.key]) problems.push(`${c.key}: breaking (${c.detail}) not acknowledged in breaking-schema-changes.json`);
  }
  return { ok: problems.length === 0, problems };
}
```

Add `readBreakingChanges()` reading `breaking-schema-changes.json` next to the module (`JSON.parse(readFileSync(new URL("./breaking-schema-changes.json", import.meta.url), "utf8"))`) and `LOCK_PATH` resolved to `packages/rt-client/settings-schema.lock.json`. Create `breaking-schema-changes.json` as `{}`.

`commands/settings-schema.ts`: `settingsSchemaLock(args)` writes `JSON.stringify(buildLock(), null, 2) + "\n"` to `LOCK_PATH` and prints the path; `settingsSchemaDiff(args)` reads `--against <path>` (default: `git show main:packages/rt-client/settings-schema.lock.json` via `spawnSync` from the repo root, or `--against-ref <ref>`), runs `classifyLockDiff` and `checkLockAgainst(prev, buildLock(), readBreakingChanges())`, prints each change (`safe`/`breaking` with detail) and the problems, `--json` envelope `{ ok, changes, problems }`, `process.exitCode = 1` when not ok. Register the module in `lib/module-registry.ts` and add under `settings`:

```ts
      schema: {
        description: "The schema lock: generate it, or diff the registry against a committed lock",
        subcommands: {
          lock: { description: "Regenerate packages/rt-client/settings-schema.lock.json from the registry", module: "./commands/settings-schema.ts", fn: "settingsSchemaLock" },
          diff: {
            description: "Classify schema changes against a lock (default: main's) and fail on an unacknowledged breaking change",
            module: "./commands/settings-schema.ts",
            fn: "settingsSchemaDiff",
            args: [
              { name: "Against", flag: "--against", type: "text", placeholder: "path/to/lock.json", hint: "A lock file to compare with (default: main's committed lock)" },
              { name: "Against ref", flag: "--against-ref", type: "text", placeholder: "v2.13.0", hint: "A git ref whose committed lock to compare with" },
              { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable output" },
            ],
          },
        },
      },
```

Preflight: in `lib/release/preflight.ts` add a row `{ id: "schema-lock", label: "schema lock", ... }`: `ok` when the committed lock equals `buildLock()` and `checkLockAgainst(lockAt(previousTag), buildLock(), readBreakingChanges()).ok`; `stale` with the problems otherwise; `error` when the lock cannot be read. Read the previous tag's lock through the file's existing git seam (follow how other rows shell out).

CI: in `.github/workflows/checks.yml`, after "Unit tests":

```yaml
      # A schema change that would invalidate stored settings must bump
      # storeVersion and be acknowledged; the lock file is the record.
      - name: Settings schema lock is in sync
        run: bun run cli.ts settings schema lock && git diff --exit-code -- packages/rt-client/settings-schema.lock.json
      - name: Settings schema changes are classified
        run: git fetch --no-tags --depth=1 origin main && bun run cli.ts settings schema diff --against-ref origin/main
```

Generate the lock: `bun run cli.ts settings schema lock`, and commit it.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts lib/__tests__/no-eager-tui.test.ts && bun run docs:gen && bun run docs:check && bun run picker:check && bun run cli.ts settings schema diff --against packages/rt-client/settings-schema.lock.json`
Expected: PASS; the last command prints no changes and exits 0.

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/schema-lock.ts packages/rt-client/settings-schema.lock.json packages/rt-client/src/settings/breaking-schema-changes.json packages/rt-client/src/settings/__tests__/schema-lock.test.ts packages/rt-client/src/index.ts commands/settings-schema.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts lib/module-registry.ts lib/command-tree-def.ts lib/release/preflight.ts .github/workflows/checks.yml docs
git commit -m "feat(settings): schema lock file, breaking-change classifier, CI and preflight gates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Docs, versions, the real-store audit and the PR

**Files:**
- Modify: `docs/settings-architecture.md` (the "Adding a key" checklist gains: write the schema, add an example, regenerate the lock), `packages/rt-client/README.md` (a "Settings schemas" section), `packages/settings-kit/README.md` ("Shapes" becomes "Schemas and editors": `recognize`, `checkValue`, the new wire fields, `?repo=`, `/repos`, `unregistered`)
- Modify: `packages/rt-client/package.json` version `0.31.1` → `0.32.0`; `packages/settings-kit/package.json` version `0.3.0` → `0.4.0` and `peerDependencies["@mattstack/rt-client"]` → `">=0.32.0 <1"`
- Modify: `packages/rt-client/test/index-surface.test.ts` (assert the new exports exist)

- [ ] **Step 1: Extend the surface test**

Add to the settings registry surface test: `checkSchema`, `validateWrite`, `checkStores`, `buildLock`, `classifyLockDiff`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities` are functions.

- [ ] **Step 2: Run to verify it fails, then it passes once exports are present**

Run: `bun test packages/rt-client/test/index-surface.test.ts`
Expected: PASS (every export landed in earlier tasks); if any is missing, add it to `index.ts`.

- [ ] **Step 3: Write the docs and bump the versions**

Follow the file list above. The settings-kit README's server section lists the four routes today; make it six (`/repos`, and the `?repo=` and `unregistered` additions). Announce the rt-client version bump to the other sessions per AGENTS.md before merging (it is a shared resource).

- [ ] **Step 4: The real-store audit (read-only, on Matt's machine)**

Run: `bun run cli.ts settings check`
Expected: exit 0. Any finding is a schema that is stricter than a real value; fix the schema (Tasks 3 to 5's procedure), never the store, re-run, and note each such fix in the PR body. Then run `bun run cli.ts settings schema lock` and confirm `git diff --exit-code -- packages/rt-client/settings-schema.lock.json` is clean (commit the lock if a schema changed).

- [ ] **Step 5: Full local gate for this branch**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test packages commands/__tests__/settings-keys-render.test.ts commands/__tests__/settings-check.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts lib/__tests__/notification-shape-parity.test.ts lib/__tests__/no-eager-tui.test.ts && bun run docs:check && bun run picker:check && bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts && cd packages/rt-client && bun run build && cd ../settings-kit && bun run build && cd ../..`
Expected: all green. CI runs the rest.

- [ ] **Step 6: Commit and open the PR**

```bash
git add docs/settings-architecture.md packages/rt-client/README.md packages/settings-kit/README.md packages/rt-client/package.json packages/settings-kit/package.json packages/rt-client/test/index-surface.test.ts packages/rt-client/settings-schema.lock.json
git commit -m "docs(settings): schemas, check, lock; rt-client 0.32.0, settings-kit 0.4.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin settings-schemas
gh pr create -R m4ttstack/rt --base main --head settings-schemas --title "settings: schemas, validateWrite, rt settings check, schema lock" --body-file <(printf '%s\n' "Implements docs/superpowers/specs/2026-09-25-settings-schemas-design.md." "" "Every composite key has a zod schema; writes are gated by validateWrite (layer schema plus merged result); reads only label. settings-kit carries schema, issues, repos and repo resolution; recognize() replaces SHAPES. A committed schema lock plus classifier gates CI and release preflight." "" "Schemas follow the most permissive reader; disagreements and real-store audit fixes are listed below." "" "🤖 Generated with [Claude Code](https://claude.com/claude-code)")
```

Then wait for CodeRabbit and CI per the repo rule (an Opus reviewer if CodeRabbit is rate-limited). Do not merge without Matt's confirmation. Publishing `@mattstack/rt-client` and `@mattstack/settings-kit` is release-class, from `main` only, after the merge (AGENTS.md); the apps repo bumps its catalog pins in spec 2's plan.

---

## Self-review notes

- Spec coverage: schemas and fields (Tasks 1, 3, 4, 5); deep-merge layer rule and merged check (Tasks 1, 2); strict write / lenient read (Tasks 2, 6); JSON Schema `io: "input"` (Task 1); settings-kit wire, `?repo=`, `/repos`, `unregistered`, `checkValue`, `recognize`, `SHAPES` shrink (Tasks 7, 8); `rt settings check` (Task 9); lock file, classifier, CI, pre-release (Task 10); writer audit for rt's own writers is covered by `setSetting` now calling `validateWrite` (every rt writer goes through it) plus the real-store audit (Task 11); app writers are tested in the apps repo (spec 2).
- Type consistency: `SchemaIssue`, `checkSchema(def, value, { layer })`, `validateWrite(def, value, { scope, repoIdentity?, team? })`, `WriteVerdict`, `CheckFinding`, `Lock`, `Change` are used with the same shapes in every task.
- Review Focus 1 to 5 each pin a test (Tasks 6, 2, 5, 7, 2).
