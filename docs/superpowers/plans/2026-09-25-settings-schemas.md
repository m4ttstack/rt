# Settings Schemas and Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every composite settings key (type `object` or `array`, 55 of 103) gets a schema; every write is checked against it, reads only label; the schema, per-layer issues and repo resolution reach settings-kit's wire; a committed lock file plus a CI classifier blocks breaking schema changes.

**Architecture:** Schemas are authored in zod v4 in `packages/rt-client/src/settings/registry-schemas.ts` and converted (`z.toJSONSchema`, `io: "input"`) into the committed `schema.lock.json`. At runtime the registry attaches each def's JSON Schema (and a derived layer schema for deep-merge keys) from that lock through a static JSON import; every check, server or browser, runs `@cfworker/json-schema` over it. zod never loads at runtime (rt's startup budget). `validateValue` stays the resolver's skip rule; `checkSchema` labels; `validateWrite` gates every write (layer schema, then merged result). settings-kit gains `issues[]`, `repos[]`, `?repo=`, `GET /repos`, `checkValue`, and `recognize(schema)` replaces the hand-kept `SHAPES` table. The lock is diffed in CI and at release preflight.

**Tech Stack:** Bun 1.4.2, TypeScript, @cfworker/json-schema ^4.1.1 (runtime), zod ^4.6.5 (dev only), jsonc-parser, bun:test.

**Spec:** `docs/superpowers/specs/2026-09-25-settings-schemas-design.md` (as amended on this branch). Read it first; every task below argues from it.

## Global Constraints

- Every def with `type: "object"` or `"array"` has a zod schema in `registry-schemas.ts` and a JSON Schema in the lock; a registry test fails otherwise.
- Schemas allow unknown extra properties (`z.looseObject`) unless a key genuinely rejects them (`z.strictObject`); they describe what readers accept.
- `validateValue` keeps its current behavior exactly (type check plus path guard). Reads never skip a value that fails only the schema.
- JSON Schema is always produced with `z.toJSONSchema(schema, { io: "input" })`.
- zod is a devDependency only. `packages/rt-client/src/index.ts` and anything it imports at runtime never import `registry-schemas.ts` or `schema-lock.ts` except with `import type`; a test greps `dist/index.js` for `zod`.
- All runtime checks (layer, full, browser) use `@cfworker/json-schema`. Messages are normalized: `expected <type>, got <type>`, `required property "<name>" is missing`, `unexpected property "<name>"`, `must be >= N` / `must be <= N` (and `> N` / `< N` for the exclusive forms), `expected one of <a>, <b>`, `expected "<const>"`; any other keyword falls back to cfworker's text. Tests assert only the normalized forms.
- Only the deepest failing units become issues, so a missing required property beside a mistyped sibling shows once the type error is fixed; that is accepted.
- Issue shape everywhere: `{ path: (string | number)[]; message: string }`; the first failing path is formatted `[0].pattern` / `emoji.looking` by `formatIssuePath`. Only the deepest cfworker units become issues; a `required` unit's path ends with the missing property name.
- Public export names consumers already import from `@mattstack/settings-kit/shapes` keep their names: `SHAPES`, `ENUMS`, `NOTIFICATION_EVENTS`, `DEFAULT_SLACK_EMOJI`, `matchesShape`, `getLeaf`, `setLeaf`, `parseScalar`, `addToList`, `filterDefs`, `isSet`, `formatValue`, `rowKind`, `summarize`, `targetScope`.
- Commit trailer on every commit, verbatim: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Gate for every task, run bare (never piped through `tail`, `head` or `grep`; a pipe hides the exit code): `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test <the task's test files>`, plus `cd packages/rt-client && bun run build && cd ../..` after any rt-client source change (the dist-freshness test fails otherwise; see AGENTS.md).
- CI runs the full suite; locally run only the test files each task names.
- No real repo identities, team names or employer names in code, tests, fixtures or docs. Use `gitlab.example.com/acme/app` and team `acme`. `scripts/repo-purity.sh` is the gate.
- No em or en dashes in new text (including replacement text pasted from existing code: rewrite the sentence).
- Comments state constraints the code cannot show; no narration, no task numbers, no review history in source.
- Repo is a worktree: run every command from `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/bilbo`; never `cd` to the main checkout.
- Editing any file under `skills/` requires loading `superpowers:writing-skills` first.

## Review Focus

1. A team store written by an older rt whose object carries a property of the wrong type (`{ "enabled": "yes" }` for `rt.homeSnapshot`) must resolve as before and be labeled `nonconforming`, never skipped. Pinned in Task 7.
2. `rt settings set rt.homeSnapshot '{"enabled":false}' --scope machine` (a partial deep layer) must succeed. Pinned in Task 3.
3. Every registry `default` must pass its own schema, and `[]` / `{}` must pass wherever a reader accepts an empty value. Pinned in Task 6.
4. A secret key's issues must never carry a value onto the wire, including the path-guard reason that quotes the literal it rejected. Pinned in Task 8.
5. A global write of a repo-scoped key must not be refused by a broken value that only exists in one repo section. Pinned in Task 3.

---

## File structure

**rt-client (`packages/rt-client`)**

- `package.json`: `dependencies` gains `@cfworker/json-schema`; `devDependencies` gains `zod`. Root `package.json` `devDependencies` gains `zod` too (the compiled `rt` bundles `commands/settings-schema.ts` lazily and needs it resolvable). `tsconfig.json` gains `"resolveJsonModule": true`.
- `src/settings/registry-machinery.ts` (modify): `SettingDef` gains `schema?`, `layerSchema?`, `storeVersion?`; the registry attaches schemas from the lock at module init.
- `src/settings/schema.ts` (create, runtime, no zod): `JsonSchema`, `SchemaIssue`, `layerJsonSchema`, `validateJson` (cached validators, normalized issues), `checkSchema`, `formatIssuePath`, `firstIssueText`, `hasSchema`.
- `src/settings/registry-schemas.ts` (create, dev): `SCHEMAS`, one zod schema per composite key, with `.meta()` display metadata; `export type Value<K>`.
- `src/settings/schema-lock.ts` (create, dev): `toJsonSchema`, `buildLock`, `classifyLockDiff`, `checkLockAgainst`, `LOCK_PATH`.
- `src/settings/schema.lock.json` (create, committed, generated).
- `src/settings/breaking-schema-changes.json` (create): `{}`.
- `src/settings/validate-write.ts` (create): `validateWrite`.
- `src/settings/resolve.ts` (modify): `nonconforming` on explain rows, `mergedIssues`, `mergedValueWith`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities`.
- `src/settings/write.ts` (modify): `setSetting` calls `validateWrite`.
- `src/settings/check.ts` (create): `checkStores`.
- `src/index.ts` (modify): runtime exports only.
- Tests: `src/settings/__tests__/schema.test.ts`, `schema-lock.test.ts`, `validate-write.test.ts`, `schema-examples.ts` + `schema-examples.test.ts`, `check.test.ts`; existing `registry.test.ts`, `resolve.test.ts`, `write.test.ts` gain cases; `test/index-surface.test.ts` and a new `test/no-zod-in-dist.test.ts`.

**settings-kit (`packages/settings-kit`)**

- `package.json`: `dependencies` gains `@cfworker/json-schema`; peer `@mattstack/rt-client` floor moves to the version Task 13 sets.
- `src/server.ts`, `src/shapes.ts` (modify); tests `src/__tests__/server.test.ts`, `shapes.test.ts`, new `shapes-legacy-fixture.ts`.

**rt CLI and release**

- `commands/settings-keys.ts` (modify): render `nonconforming`, add `settingsCheck`.
- `commands/settings-schema.ts` (create): `settingsSchemaLock`, `settingsSchemaDiff`.
- `lib/settings/schema.ts`, `lib/settings/schema-lock.ts` (create): one-line re-export barrels like the existing `lib/settings/*.ts`.
- `lib/module-registry.ts`, `lib/command-tree-def.ts`, `lib/release/preflight.ts`, `.github/workflows/checks.yml` (modify).
- Docs: generated command reference (`bun run docs:gen`), `docs/settings-architecture.md`, `packages/settings-kit/README.md`, `packages/rt-client/README.md`, `skills/rt-release/SKILL.md`.

**Composite keys (55), by task**

- Task 4 (`rt.*`, 25): `rt.roles`, `rt.intercepts`, `rt.worktrees`, `rt.ignoredMrs`, `rt.repoIdentityOverrides`, `rt.repoRoots`, `rt.notifications`, `rt.notify.eventBridges`, `rt.cron`, `rt.repoTracking`, `rt.runaway`, `rt.workspacePrefs`, `rt.homeSnapshot`, `rt.teamSnapshot`, `rt.sync`, `rt.branchNaming`, `rt.variations`, `rt.presets`, `rt.dopplerTemplate`, `rt.worktreeApp`, `rt.sdmEnrichment`, `rt.gitStatus`, `rt.hooks`, `rt.trustedBrowserOrigins`, `rt.integrations`.
- Task 5 (9): `mattstack.integrations`, `mattstack.tracking`, `mattstack.roster`, `setup.waived`, `claude.marketplaces`, `claude.plugins`, `deck.apps`, `deck.access`, `deck.platform`.
- Task 6 (21): `board.projects`, `board.members`, `board.botUsernames`, `board.ticketPrefixes`, `board.slack`, `board.tabs`, `board.workspaces`, `board.hiddenMembers`, `board.triage`, `board.reReview`, `board.cwds`, `boxscore.projects`, `boxscore.linearDoneStates`, `boxscore.sizeBand`, `boxscore.excludeFilePatterns`, `boxscore.ignoredMrs`, `boxscore.botPatterns`, `boxscore.hiddenMembers`, `gitq.workSlots`, `gitq.forges`, `gitq.board`.

---

### Task 1: Runtime schema module and def fields

**Files:**
- Modify: `packages/rt-client/package.json`, root `package.json`, `packages/rt-client/tsconfig.json`
- Modify: `packages/rt-client/src/settings/registry-machinery.ts:30-43`
- Create: `packages/rt-client/src/settings/schema.ts`
- Test: `packages/rt-client/src/settings/__tests__/schema.test.ts`

**Interfaces:**
- Produces:
  - `SettingDef.schema?: JsonSchema`, `SettingDef.layerSchema?: JsonSchema`, `SettingDef.storeVersion?: number`
  - `type JsonSchema = Record<string, unknown>`; `type SchemaIssue = { path: (string | number)[]; message: string }`
  - `layerJsonSchema(json: JsonSchema): JsonSchema`
  - `validateJson(json: JsonSchema, value: unknown): SchemaIssue[]` (validators cached per schema object)
  - `checkSchema(def: SettingDef, value: unknown, opts: { layer: boolean }): SchemaIssue[]` (`[]` when the def has no schema)
  - `formatIssuePath(path): string`, `firstIssueText(issues): string`, `hasSchema(def)`

- [ ] **Step 1: Add the dependencies**

```bash
cd packages/rt-client && bun add @cfworker/json-schema@^4.1.1 && bun add -d zod@^4.6.5 && cd ../.. && bun add -d zod@^4.6.5
```

Then add `"resolveJsonModule": true` to `packages/rt-client/tsconfig.json` `compilerOptions`. Expected: both package.json files updated, `bun.lock` updated.

- [ ] **Step 2: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/schema.test.ts`:

```ts
/**
 * settings/schema.ts: the runtime check over a def's JSON Schema, the
 * derived layer schema for deep-merge keys, and issue formatting. No zod
 * here: this module is what rt loads at startup.
 */

import { describe, expect, test } from "bun:test";
import type { SettingDef } from "../registry-machinery.ts";
import { checkSchema, firstIssueText, formatIssuePath, layerJsonSchema, validateJson } from "../schema.ts";

const ruleSchema = {
  type: "object",
  properties: { pattern: { type: "string" }, category: { type: "string" }, url: { type: "string" }, owner: { const: "human" } },
  required: ["pattern", "category"],
};
const listSchema = { type: "array", items: ruleSchema };
const deepSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    debounceSec: { type: "number" },
    nested: { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
  },
  required: ["enabled", "debounceSec"],
};

function def(over: Partial<SettingDef> & Pick<SettingDef, "key" | "type" | "merge">): SettingDef {
  return { scopes: ["user"], description: "test", ...over };
}
const listDef = def({ key: "t.list", type: "array", merge: "replace", schema: listSchema });
const deepDef = def({ key: "t.deep", type: "object", merge: "deep", schema: deepSchema, layerSchema: layerJsonSchema(deepSchema) });

describe("layerJsonSchema", () => {
  test("drops required at every object level but keeps it inside array items, even nested", () => {
    const json = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "object", properties: { c: { type: "number" } }, required: ["c"] },
        items: { type: "array", items: { type: "object", properties: { d: { type: "string" }, e: { type: "object", properties: { f: { type: "string" } }, required: ["f"] } }, required: ["d"] } },
      },
      required: ["a"],
    };
    const layer = layerJsonSchema(json) as any;
    expect(layer.required).toBeUndefined();
    expect(layer.properties.b.required).toBeUndefined();
    expect(layer.properties.items.items.required).toEqual(["d"]);
    expect(layer.properties.items.items.properties.e.required).toEqual(["f"]);
  });
});

describe("validateJson", () => {
  test("reports the deepest failing path with a normalized message", () => {
    const issues = validateJson(listSchema, [{ pattern: 1, category: "gate" }]);
    expect(issues[0]!.path).toEqual([0, "pattern"]);
    expect(issues[0]!.message).toBe("expected string, got number");
  });

  test("a missing required property is reported at the property, not the parent", () => {
    const issues = validateJson(listSchema, [{ category: "gate" }]);
    expect(issues[0]!.path).toEqual([0, "pattern"]);
    expect(issues[0]!.message).toBe('required property "pattern" is missing');
  });

  test("a const mismatch names the expected value", () => {
    const issues = validateJson(listSchema, [{ pattern: "x", category: "gate", owner: "herd" }]);
    expect(issues[0]!.path).toEqual([0, "owner"]);
    expect(issues[0]!.message).toBe('expected "human"');
  });

  test("limits, enums and unexpected properties read as plain rules", () => {
    expect(validateJson({ type: "number", minimum: 1 }, 0)[0]!.message).toBe("must be >= 1");
    expect(validateJson({ enum: ["a", "b"] }, "c")[0]!.message).toBe("expected one of a, b");
    const extra = validateJson({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false }, { a: "x", b: 1 });
    expect(extra[0]).toEqual({ path: ["b"], message: 'unexpected property "b"' });
  });

  test("a conforming value with extras passes", () => {
    expect(validateJson(listSchema, [{ pattern: "gate/*", category: "gate", extra: true }])).toEqual([]);
  });
});

describe("checkSchema", () => {
  test("a def without a schema never reports issues", () => {
    expect(checkSchema(def({ key: "t.plain", type: "object", merge: "replace" }), { anything: 1 }, { layer: false })).toEqual([]);
  });

  test("layer check accepts a partial deep layer and still types what is present", () => {
    expect(checkSchema(deepDef, { enabled: false }, { layer: true })).toEqual([]);
    expect(checkSchema(deepDef, { enabled: "yes" }, { layer: true })[0]!.path).toEqual(["enabled"]);
  });

  test("layer check keeps array items whole", () => {
    const d = def({ key: "t.deepList", type: "object", merge: "deep", schema: { type: "object", properties: { rules: listSchema }, required: ["rules"] } });
    d.layerSchema = layerJsonSchema(d.schema!);
    expect(checkSchema(d, { rules: [{ category: "gate" }] }, { layer: true })[0]!.path).toEqual(["rules", 0, "pattern"]);
  });

  test("full check rejects a partial layer of a deep key; a replace key ignores the layer flag", () => {
    expect(checkSchema(deepDef, { enabled: false }, { layer: false }).length).toBeGreaterThan(0);
    expect(checkSchema(listDef, [{ category: "gate" }], { layer: true }).length).toBeGreaterThan(0);
  });
});

describe("formatIssuePath and firstIssueText", () => {
  test("formats indexes in brackets and properties with dots", () => {
    expect(formatIssuePath([0, "pattern"])).toBe("[0].pattern");
    expect(formatIssuePath(["emoji", "looking"])).toBe("emoji.looking");
    expect(formatIssuePath([])).toBe("(root)");
  });

  test("firstIssueText joins path and message", () => {
    expect(firstIssueText([{ path: [0, "pattern"], message: "expected string, got number" }])).toBe("[0].pattern: expected string, got number");
    expect(firstIssueText([])).toBe("");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema.test.ts`
Expected: FAIL, `Cannot find module "../schema.ts"`.

- [ ] **Step 4: Add the def fields**

In `registry-machinery.ts`, extend `SettingDef` after `pathGuardFields?: string[];`:

```ts
  /** JSON Schema of the value a reader receives (merged, for deep keys); attached from the lock. */
  schema?: JsonSchema;
  /** For deep-merge keys: `schema` with every object property optional, so one layer can be partial. */
  layerSchema?: JsonSchema;
  /** Bumped only on a breaking schema change; the lock file records it. Default 1. */
  storeVersion?: number;
```

with `import type { JsonSchema } from "./schema.ts";` at the top (a type import; `schema.ts` imports only the `SettingDef` type back, so there is no runtime cycle).

- [ ] **Step 5: Write `schema.ts`**

```ts
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

function pointerToPath(pointer: string): (string | number)[] {
  return pointer
    .replace(/^#\/?/, "")
    .split("/")
    .filter((s) => s !== "")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
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
```

The strings these branches match are cfworker 4.1.1's: `Instance does not have required property "x".`, `Instance type "string" is invalid. Expected "boolean".`, `0 is less than 1.` (and the `greater than` / `or equal` forms), `Instance does not match any of ["a","b"].`, `Instance does not match "human".`, and `False boolean schema.` under keyword `false` for an `additionalProperties: false` extra. Confirm each against `node_modules/@cfworker/json-schema/dist/validate.js` before trusting a regex, and run the test file; the normalized messages in the tests are the contract. If a value cannot be parsed from the text, resolve the failing keyword in the schema through the unit's `keywordLocation` and print the value from there.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Export, barrel, gate**

In `packages/rt-client/src/index.ts`, after line 172:

```ts
export { checkSchema, validateJson, layerJsonSchema, formatIssuePath, firstIssueText, hasSchema } from "./settings/schema.ts";
export type { SchemaIssue, JsonSchema } from "./settings/schema.ts";
```

Create `lib/settings/schema.ts` with the one-line re-export the other `lib/settings/*.ts` files use, pointing at `../../packages/rt-client/src/settings/schema.ts`.

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test packages/rt-client/src/settings/__tests__/schema.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts && cd packages/rt-client && bun run build && cd ../..`

- [ ] **Step 8: Commit**

```bash
git add package.json bun.lock packages/rt-client/package.json packages/rt-client/tsconfig.json packages/rt-client/src/settings/registry-machinery.ts packages/rt-client/src/settings/schema.ts packages/rt-client/src/settings/__tests__/schema.test.ts packages/rt-client/src/index.ts lib/settings/schema.ts
git commit -m "feat(settings): runtime JSON Schema checks and schema fields on SettingDef

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Authoring pipeline: zod schemas, the lock file, attach at startup, `rt settings schema lock`

**Files:**
- Create: `packages/rt-client/src/settings/registry-schemas.ts`, `schema-lock.ts`, `schema.lock.json`, `breaking-schema-changes.json`
- Modify: `packages/rt-client/src/settings/registry-machinery.ts` (attach from the lock)
- Create: `commands/settings-schema.ts`, `lib/settings/schema-lock.ts`
- Modify: `lib/module-registry.ts`, `lib/command-tree-def.ts`
- Test: `packages/rt-client/src/settings/__tests__/schema-lock.test.ts`, `registry.test.ts`, `packages/rt-client/test/no-zod-in-dist.test.ts`, `commands/__tests__/settings-schema.test.ts`

**Interfaces:**
- Produces:
  - `SCHEMAS: Record<string, z.ZodType>` (empty object typed `satisfies Record<string, z.ZodType>` until Task 4) and `export type Value<K extends keyof typeof SCHEMAS> = z.infer<(typeof SCHEMAS)[K]>`
  - `toJsonSchema(schema: z.ZodType): JsonSchema`
  - `buildLock(): Lock` with `type Lock = Record<string, { storeVersion: number; schema: JsonSchema }>`, keys sorted; `storeVersion` read from the def
  - `LOCK_PATH` (absolute path of `schema.lock.json`)
  - registry-machinery: `REGISTRY` entries get `schema` and (deep object keys) `layerSchema` from the lock at module init; `allDefs()`/`getDef()` return those
  - CLI `rt settings schema lock` regenerates the file

- [ ] **Step 0: Record the startup baseline**

The bench times the compiled binary, and `dist/rt` is gitignored and absent in a fresh worktree, so build it first, on the current commit (before this task's changes):

```bash
bun build --compile ./cli.ts --outfile dist/rt --no-compile-autoload-bunfig --no-compile-autoload-dotenv && bun scripts/bench-startup.ts
```

Note the median it prints in the PR body as the baseline. Every later bench in this plan rebuilds `dist/rt` the same way first; a bench against a stale binary measures the wrong code.

- [ ] **Step 1: Write the failing tests**

`schema-lock.test.ts` (the `buildLock` part; the classifier tests come in Task 11):

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { z } from "zod";
import { buildLock, LOCK_PATH, toJsonSchema } from "../schema-lock.ts";

describe("toJsonSchema", () => {
  test("uses input mode: a defaulted property is optional and loose objects allow extras", () => {
    const json = toJsonSchema(z.looseObject({ a: z.string().default("x"), b: z.number() }));
    expect(json.required).toEqual(["b"]);
    expect(json.additionalProperties).not.toBe(false);
  });
  test("strict objects forbid extras", () => {
    expect(toJsonSchema(z.strictObject({ a: z.string() })).additionalProperties).toBe(false);
  });
  test("carries .meta() through as annotations", () => {
    const json = toJsonSchema(z.record(z.string(), z.string()).meta({ labels: { key: "remote URL", value: "identity" } }));
    expect(json.labels).toEqual({ key: "remote URL", value: "identity" });
  });
});

describe("buildLock", () => {
  test("is sorted and matches the committed lock byte for byte", () => {
    const built = buildLock();
    expect(Object.keys(built)).toEqual([...Object.keys(built)].sort());
    expect(JSON.parse(readFileSync(LOCK_PATH, "utf8"))).toEqual(built);
  });
});
```

Add to `registry.test.ts`'s `allDefs` block:

```ts
    test("every def with a lock entry carries its schema and storeVersion from the lock", () => {
      const lock = JSON.parse(readFileSync(new URL("../schema.lock.json", import.meta.url), "utf8")) as Record<string, { storeVersion: number; schema: unknown }>;
      for (const def of allDefs()) {
        const entry = lock[def.key];
        if (!entry) { expect(def.schema).toBeUndefined(); continue; }
        expect(def.schema).toEqual(entry.schema);
        expect(def.storeVersion ?? 1).toBe(entry.storeVersion);
        if (def.merge === "deep" && def.type === "object") expect(def.layerSchema).toBeDefined();
      }
    });
```

Create `packages/rt-client/test/no-zod-in-dist.test.ts`:

```ts
/**
 * zod authors the schemas at dev time only. The registry sits on rt's startup
 * path, so the runtime bundle must never pull it in.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("dist/index.js", () => {
  test("does not import zod", () => {
    const js = readFileSync(join(import.meta.dir, "..", "dist", "index.js"), "utf8");
    expect(js).not.toMatch(/from\s+["']zod["']|require\(["']zod["']\)/);
  });
});
```

`commands/__tests__/settings-schema.test.ts`: `settingsSchemaLock(["--out", tmpFile])` writes `JSON.stringify(buildLock(), null, 2) + "\n"` to the temp file and prints its path (spy `console.log`); the test never touches the committed file. A second test covers the compiled-binary guard: give `settingsSchemaLock` an injectable second argument `{ lockPath }` (defaulting to `LOCK_PATH`), call it with a path under `/$bunfs/nope/schema.lock.json`, and assert the run-from-source message on stderr and `process.exitCode` 1 (make the guard set `process.exitCode = 1` and return, not `process.exit`, so it is testable).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/test/no-zod-in-dist.test.ts commands/__tests__/settings-schema.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Create the dev modules**

`registry-schemas.ts`:

```ts
/**
 * One zod schema per composite settings key: the value a reader receives.
 * Authoring only: the lock file generated from this is what runs. Objects
 * are loose unless a reader rejects unknown properties. Display metadata
 * (labels, placeholders) rides on .meta() into the JSON Schema.
 */

import { z } from "zod";

export const SCHEMAS = {} satisfies Record<string, z.ZodType>;

export type Value<K extends keyof typeof SCHEMAS> = z.infer<(typeof SCHEMAS)[K]>;
```

`schema-lock.ts` (dev):

```ts
/**
 * The schema lock: every composite key's storeVersion and JSON Schema,
 * generated from the zod schemas and committed. It is both the CI record a
 * breaking change is diffed against and the runtime source of every def's
 * schema, so the two cannot disagree.
 */

import { fileURLToPath } from "url";
import { z } from "zod";
import { REGISTRY } from "./registry-defs.ts";
import { SCHEMAS } from "./registry-schemas.ts";
import type { JsonSchema } from "./schema.ts";

export type Lock = Record<string, { storeVersion: number; schema: JsonSchema }>;

export const LOCK_PATH = fileURLToPath(new URL("./schema.lock.json", import.meta.url));

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
}

export function buildLock(): Lock {
  const versions = new Map(REGISTRY.map((d) => [d.key, d.storeVersion ?? 1]));
  const out: Lock = {};
  for (const [key, schema] of Object.entries(SCHEMAS) as [string, z.ZodType][]) {
    out[key] = { storeVersion: versions.get(key) ?? 1, schema: toJsonSchema(schema) };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
```

`registry-machinery.ts`: import the lock statically and attach:

```ts
import LOCK from "./schema.lock.json" with { type: "json" };
import { layerJsonSchema, type JsonSchema } from "./schema.ts";

type LockFile = Record<string, { storeVersion: number; schema: JsonSchema }>;

function attachSchemas(defs: readonly SettingDef[]): SettingDef[] {
  const lock = LOCK as LockFile;
  return defs.map((def) => {
    const entry = lock[def.key];
    if (!entry) return def;
    const withSchema: SettingDef = { ...def, schema: entry.schema, storeVersion: entry.storeVersion };
    if (def.merge === "deep" && def.type === "object") withSchema.layerSchema = layerJsonSchema(entry.schema);
    return withSchema;
  });
}

const DEFS: readonly SettingDef[] = attachSchemas(REGISTRY);
const BY_KEY: Map<string, SettingDef> = new Map(DEFS.map((def) => [def.key, def]));
```

and make `allDefs()` return `[...DEFS]`. `schema.ts` must import only the `SettingDef` type from `registry-machinery.ts` (it does), so the module graph stays acyclic at runtime. Change the `import type { JsonSchema }` from Task 1 into this value import of `layerJsonSchema` plus the type.

Create `schema.lock.json` as `{}` for now, `breaking-schema-changes.json` as `{}`.

`commands/settings-schema.ts`:

```ts
/**
 * rt settings schema lock|diff: the lock file that pins every composite
 * key's JSON Schema. Dev-time verbs; they load zod, which the rest of rt
 * never does.
 */

import { existsSync, writeFileSync } from "fs";
import { buildLock, LOCK_PATH as DEFAULT_LOCK_PATH } from "../lib/settings/schema-lock.ts";

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function settingsSchemaLock(args: string[], deps: { lockPath?: string } = {}): Promise<void> {
  const LOCK_PATH = deps.lockPath ?? DEFAULT_LOCK_PATH;
  const out = flagValue(args, "--out") ?? LOCK_PATH;
  // A compiled rt resolves LOCK_PATH inside its own bundle (/$bunfs/...), where the lock
  // file is absent and nothing can be written; from source the committed file exists.
  if (out === LOCK_PATH && (LOCK_PATH.startsWith("/$bunfs/") || !existsSync(LOCK_PATH))) {
    console.error("rt settings schema lock: run from source (bun run cli.ts settings schema lock); the compiled binary has no checkout to write into");
    process.exitCode = 1;
    return;
  }
  writeFileSync(out, `${JSON.stringify(buildLock(), null, 2)}\n`);
  console.log(out);
}
```

(`settingsSchemaDiff` comes in Task 11.) Create `lib/settings/schema-lock.ts` as the one-line barrel. Register `"./commands/settings-schema.ts": () => import("../commands/settings-schema.ts")` in `lib/module-registry.ts`. Add under `settings` in `lib/command-tree-def.ts`:

```ts
      schema: {
        description: "The settings schema lock: regenerate it from the registry, or diff the registry against a committed lock",
        subcommands: {
          lock: {
            description: "Regenerate packages/rt-client/src/settings/schema.lock.json from the zod schemas",
            module: "./commands/settings-schema.ts",
            fn: "settingsSchemaLock",
            args: [{ name: "Out", flag: "--out", type: "text", placeholder: "path/to/lock.json", hint: "Write somewhere else than the committed lock (tests)" }],
          },
        },
      },
```

Run `bun run cli.ts settings schema lock` (it writes `{}` for now, formatted).

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/rt-client && bun run build && cd ../.. && bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/test/no-zod-in-dist.test.ts packages/rt-client/test/dist-freshness.test.ts commands/__tests__/settings-schema.test.ts lib/__tests__/no-eager-tui.test.ts && bun run docs:gen && bun run docs:check && bun run picker:check && bun build --compile ./cli.ts --outfile dist/rt --no-compile-autoload-bunfig --no-compile-autoload-dotenv && bun scripts/bench-startup.ts`
Expected: PASS; the startup bench stays under its threshold and close to the Step 0 baseline (nothing on the startup path imports zod; `@cfworker/json-schema` and the lock's JSON are the only additions).

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/schema-lock.ts packages/rt-client/src/settings/schema.lock.json packages/rt-client/src/settings/breaking-schema-changes.json packages/rt-client/src/settings/registry-machinery.ts packages/rt-client/src/settings/__tests__/schema-lock.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/test/no-zod-in-dist.test.ts commands/settings-schema.ts commands/__tests__/settings-schema.test.ts lib/settings/schema-lock.ts lib/module-registry.ts lib/command-tree-def.ts docs
git commit -m "feat(settings): zod authoring pipeline, schema lock file attached at startup, rt settings schema lock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `validateWrite` and the merged-result check

**Files:**
- Create: `packages/rt-client/src/settings/validate-write.ts`
- Modify: `packages/rt-client/src/settings/resolve.ts` (add `mergedValueWith`, `listStoreRepoIdentities`)
- Modify: `packages/rt-client/src/settings/write.ts:144-149`
- Test: `packages/rt-client/src/settings/__tests__/validate-write.test.ts`, `write.test.ts`

**Interfaces:**
- Consumes: `checkSchema`, `firstIssueText`, `layerJsonSchema` (Task 1); `validateValue`; the private `readStores`, `resolveDef`, `StoreBundle` in `resolve.ts`.
- Produces:
  - `mergedValueWith(def, override: { scope: SettingScope; repoIdentity?: string; value: unknown }, opts?: ResolveOpts): unknown`
  - `listStoreRepoIdentities(): string[]`
  - `validateWrite(def, value, opts: { scope: SettingScope; repoIdentity?: string; team?: string }): WriteVerdict` with `type WriteVerdict = { ok: true } | { ok: false; reason: string; issues: SchemaIssue[] }`
  - `setSetting` refuses with `validateWrite`'s reason.

Tests attach schemas to live defs for one assertion with this helper (defs are shared objects, the `withTeamLocked` pattern in `resolve.test.ts`):

```ts
import { layerJsonSchema } from "../schema.ts";
function withSchema(key: string, schema: Record<string, unknown>, fn: () => void): void {
  const def = getDef(key) as SettingDef;
  const prev = { schema: def.schema, layer: def.layerSchema };
  def.schema = schema;
  def.layerSchema = def.merge === "deep" && def.type === "object" ? layerJsonSchema(schema) : undefined;
  try { fn(); } finally { def.schema = prev.schema; def.layerSchema = prev.layer; }
}
```

Put it in `packages/rt-client/src/settings/__tests__/with-schema.ts` and import it from every test that needs it (Tasks 3, 7, 10).

- [ ] **Step 1: Write the failing tests**

`validate-write.test.ts` (HOME re-pointed per test as in `write.test.ts`; fixtures `write(file, obj)` plus `writeUser`, `writeMachine`, `writeTeam(name, obj)` wrappers defined locally):

```ts
const SNAPSHOT = { type: "object", properties: { enabled: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["enabled", "debounceSec"] };
const ROLES = { type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"] };
const GIT_STATUS = { type: "object", properties: { sweep: { type: "boolean" }, sweepIntervalSec: { type: "number", minimum: 1 }, fetchIntervalSec: { type: "number" } }, required: ["sweep", "sweepIntervalSec", "fetchIntervalSec"] };
const WORKTREES = { type: "object", properties: { onDeck: { type: "number", minimum: 0 }, name: { type: "string" } }, required: ["onDeck"] };

test("type check still comes first", () => {
  const r = validateWrite(getDef("rt.homeSnapshot")!, "nope", { scope: "machine" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toContain("expected object");
});

test("a partial deep layer at machine scope is allowed", () => {
  withSchema("rt.homeSnapshot", SNAPSHOT, () => {
    expect(validateWrite(getDef("rt.homeSnapshot")!, { enabled: false }, { scope: "machine" })).toEqual({ ok: true });
  });
});

test("a wrongly typed field in a layer is refused with its path", () => {
  withSchema("rt.homeSnapshot", SNAPSHOT, () => {
    const r = validateWrite(getDef("rt.homeSnapshot")!, { enabled: "yes" }, { scope: "machine" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("enabled: expected boolean, got string");
  });
});

test("a replace key is checked against the full schema", () => {
  withSchema("rt.repoRoots", { type: "array", items: { type: "string" } }, () => {
    const r = validateWrite(getDef("rt.repoRoots")!, [1], { scope: "machine" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("[0]: expected string, got number");
  });
});

test("a limit inside a layer is refused by the layer check itself", () => {
  withSchema("rt.gitStatus", GIT_STATUS, () => {
    const r = validateWrite(getDef("rt.gitStatus")!, { sweepIntervalSec: 0 }, { scope: "machine" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("sweepIntervalSec: must be >= 1");
  });
});

test("the merged result is refused only when it fails where it passed before", () => {
  // rt.roles: deep, no registry default, allowed in every store; the layer schema
  // makes `a` optional, so a layer of `{ b }` passes on its own.
  withSchema("rt.roles", ROLES, () => {
    const def = getDef("rt.roles")!;
    const first = validateWrite(def, { b: 1 }, { scope: "machine" });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.reason).toBe('merged value would fail: a: required property "a" is missing');
    writeUser({ "rt.roles": { a: "x" } });
    expect(validateWrite(def, { b: 1 }, { scope: "machine" })).toEqual({ ok: true });
    writeUser({ "rt.roles": { b: 2 } });
    // The merge already fails on the user layer; an unrelated machine edit still lands.
    expect(validateWrite(def, { b: 3 }, { scope: "machine" })).toEqual({ ok: true });
  });
});

test("a global write of a repo-scoped key checks every repo section's merge", () => {
  withSchema("rt.worktrees", WORKTREES, () => {
    const def = getDef("rt.worktrees")!;
    writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 2 } } } });
    expect(validateWrite(def, { name: "x" }, { scope: "user" })).toEqual({ ok: true });
    writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: -1 } } } });
    // The repo section already fails; an unrelated global edit still lands.
    expect(validateWrite(def, { name: "y" }, { scope: "user" })).toEqual({ ok: true });
  });
});

test("a repo section write checks that repo's merge", () => {
  withSchema("rt.worktrees", WORKTREES, () => {
    const r = validateWrite(getDef("rt.worktrees")!, { onDeck: -1 }, { scope: "user", repoIdentity: IDENTITY });
    expect(r.ok).toBe(false);
  });
});
```

Add to `write.test.ts` a `schema gate` block: with `withSchema("rt.repoRoots", { type: "array", items: { type: "string" } }, ...)`, `setSetting("rt.repoRoots", [1], "machine")` throws matching `/\[0\]: expected string/`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/src/settings/__tests__/write.test.ts`
Expected: FAIL, module missing / no throw.

- [ ] **Step 3: Add `mergedValueWith` and `listStoreRepoIdentities` to `resolve.ts`**

```ts
/**
 * The merged value the resolver would produce if `override.scope` (and its
 * repo section, when given) held `override.value`. The write gate uses it
 * to refuse a write that breaks the merge; reads never call it.
 */
export function mergedValueWith(
  def: SettingDef,
  override: { scope: SettingScope; repoIdentity?: string; value: unknown },
  opts: ResolveOpts = {},
): unknown {
  const stores = readStores();
  const patched: StoreBundle = { user: cloneStore(stores.user), machine: cloneStore(stores.machine), teams: stores.teams.map(cloneStore) };
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

/** Every repo identity that has a `repos.<id>` section in any store. */
export function listStoreRepoIdentities(): string[] {
  const stores = readStores();
  const ids = new Set<string>();
  for (const store of [stores.user, stores.machine, ...stores.teams]) for (const id of Object.keys(store.repos)) ids.add(id);
  return [...ids].sort();
}
```

A team write with no `opts.team` patches every team store, matching `setSetting`'s single-team assumption.

- [ ] **Step 4: Write `validate-write.ts`**

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

export function validateWrite(def: SettingDef, value: unknown, opts: { scope: SettingScope; repoIdentity?: string; team?: string }): WriteVerdict {
  const guarded: SettingDef = opts.scope === "machine" ? { ...def, pathGuardFields: undefined } : def;
  const typed = validateValue(guarded, value);
  if (!typed.ok) return { ok: false, reason: typed.reason, issues: [] };
  if (!hasSchema(def)) return { ok: true };

  const layerIssues = checkSchema(def, value, { layer: true });
  if (layerIssues.length > 0) return { ok: false, reason: firstIssueText(layerIssues), issues: layerIssues };

  const contexts: (string | null)[] =
    opts.repoIdentity !== undefined ? [opts.repoIdentity] : def.repoScoped ? [null, ...listStoreRepoIdentities()] : [null];
  for (const repoIdentity of contexts) {
    const after = mergedValueWith(def, { scope: opts.scope, repoIdentity: opts.repoIdentity, value }, { repoIdentity, expand: false });
    const afterIssues = checkSchema(def, after, { layer: false });
    if (afterIssues.length === 0) continue;
    const before = mergedNow(def, repoIdentity);
    if (before === undefined || checkSchema(def, before, { layer: false }).length === 0) {
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

- [ ] **Step 5: Wire `setSetting`**

In `write.ts`, replace the block at lines 144-149 (the `guardedDef` constant, the `validateValue` call and its `refuse`) with:

```ts
  const verdict = validateWrite(def, value, { scope, repoIdentity: opts.repoIdentity, team: opts.team });
  if (!verdict.ok) {
    const hint = verdict.issues.length === 0 ? "; use ${team:<name>} or ${repoRoot} instead" : "";
    refuse(`refusing to set "${key}": ${verdict.reason}${hint}`);
  }
```

Import `validateWrite` from `./validate-write.ts`; remove the `validateValue` import if unused.

- [ ] **Step 6: Run to verify they pass, gate, commit**

Run: `bun test packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/src/settings/__tests__/write.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts && sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

Add to `index.ts`: `export { validateWrite } from "./settings/validate-write.ts"; export type { WriteVerdict } from "./settings/validate-write.ts";` and `mergedValueWith, listStoreRepoIdentities` to the `resolve.ts` export list.

```bash
git add packages/rt-client/src/settings/validate-write.ts packages/rt-client/src/settings/resolve.ts packages/rt-client/src/settings/write.ts packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/src/settings/__tests__/with-schema.ts packages/rt-client/src/settings/__tests__/write.test.ts packages/rt-client/src/index.ts
git commit -m "feat(settings): validateWrite gates every write on the layer schema and the merged result

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Schemas for the `rt.*` composite keys

**Files:**
- Modify: `packages/rt-client/src/settings/registry-schemas.ts`, `schema.lock.json` (regenerated)
- Create: `packages/rt-client/src/settings/__tests__/schema-examples.ts`, `schema-examples.test.ts`

**Interfaces:**
- Consumes: `SCHEMAS`, `buildLock`, `rt settings schema lock` (Task 2); `checkSchema` (Task 1).
- Produces: a `SCHEMAS` entry per key in the Task 4 list; `EXAMPLES` (good, bad with path, layer) per key.

**Procedure for every schema (Tasks 4 to 6):**

1. Find the readers: `git grep -n "<key>" -- lib commands packages extensions` (quote both `'rt.roles'` and `"rt.roles"` spellings: use `git grep -n "rt\.roles" -- lib commands packages extensions`). Suite keys' readers are in the apps repo: `git -C /Users/matt/Documents/GitHub/mattstack-apps grep -n "deck\.apps" -- apps/deck` (read-only, scoped to that app's directory; never edit anything there).
2. Write the zod schema for the value a reader receives: `z.looseObject({...})` for objects, `z.array(...)` for lists, `z.record(z.string(), ...)` for maps, `z.strictObject` only when a reader rejects unknown properties, `z.enum([...])` for closed sets. A property a reader treats as optional or falls back on is `.optional()`.
3. Where readers disagree, follow the more permissive and note it in the PR body.
4. Declare properties in importance order (`pattern` before `title`).
5. Add the `EXAMPLES` entry: at least one `good` (the registry default or an invented realistic value), one `bad` with its expected first path, and for a deep key one partial `layer`.
6. Regenerate the lock: `bun run cli.ts settings schema lock`, then `cd packages/rt-client && bun run build && cd ../..`.

- [ ] **Step 1: Write the failing test**

`schema-examples.test.ts`:

```ts
/**
 * One good, one bad and (deep keys) one partial-layer example per composite
 * key, run through the runtime check. Completeness widens as namespaces land.
 */

import { describe, expect, test } from "bun:test";
import { allDefs, getDef } from "../registry-machinery.ts";
import { checkSchema } from "../schema.ts";
import { EXAMPLES } from "./schema-examples.ts";

export const COVERED_PREFIXES = ["rt."];

describe("schema examples", () => {
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    describe(key, () => {
      test("has a schema", () => {
        expect(getDef(key)?.schema, `${key} needs a schema (add it to registry-schemas.ts and regenerate the lock)`).toBeDefined();
      });
      for (const [i, good] of ex.good.entries()) {
        test(`good #${i} passes`, () => { expect(checkSchema(getDef(key)!, good, { layer: false })).toEqual([]); });
      }
      for (const [i, bad] of ex.bad.entries()) {
        test(`bad #${i} fails at ${JSON.stringify(bad.path)}`, () => {
          const issues = checkSchema(getDef(key)!, bad.value, { layer: false });
          expect(issues.length).toBeGreaterThan(0);
          expect(issues[0]!.path).toEqual(bad.path);
        });
      }
      for (const [i, layer] of (ex.layer ?? []).entries()) {
        test(`layer #${i} passes the layer schema`, () => { expect(checkSchema(getDef(key)!, layer, { layer: true })).toEqual([]); });
      }
      test("the registry default, when present, passes", () => {
        const def = getDef(key)!;
        if (!("default" in def)) return;
        expect(checkSchema(def, def.default, { layer: false })).toEqual([]);
      });
    });
  }

  test("every composite key in a covered namespace has a schema and an example", () => {
    const covered = allDefs().filter((d) => (d.type === "object" || d.type === "array") && COVERED_PREFIXES.some((p) => d.key.startsWith(p)));
    expect(covered.filter((d) => !d.schema).map((d) => d.key)).toEqual([]);
    expect(covered.map((d) => d.key).filter((k) => !(k in EXAMPLES))).toEqual([]);
  });
});
```

`schema-examples.ts` (five complete entries; the other 20 `rt.*` keys follow the same shape after reading their readers):

```ts
export interface Example { good: unknown[]; bad: { value: unknown; path: (string | number)[] }[]; layer?: unknown[] }

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
  "rt.repoRoots": { good: [[], ["~/Documents/GitHub"]], bad: [{ value: [1], path: [0] }] },
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
};
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts`
Expected: FAIL, `has a schema` and completeness.

- [ ] **Step 3: Write the schemas**

In `registry-schemas.ts` (the five below are complete; write the other 20 by the procedure):

```ts
import { NOTIFICATION_EVENT_KEYS } from "./notification-events.ts";

const snapshot = { enabled: z.boolean(), debounceSec: z.number(), pushDelaySec: z.number(), janitorThresholdHours: z.number(), janitorIntervalMin: z.number() };

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
  "rt.repoIdentityOverrides": z.record(z.string(), z.string()).meta({ labels: { key: "remote URL", value: "identity" } }),
  "rt.repoRoots": z.array(z.string()),
  "rt.homeSnapshot": z.looseObject(snapshot),
  "rt.teamSnapshot": z.looseObject({ ...snapshot, pullIntervalSec: z.number() }),
  "rt.gitStatus": z.looseObject({ sweep: z.boolean(), sweepIntervalSec: z.number(), fetchIntervalSec: z.number() }),
  "rt.notifications": z.looseObject(Object.fromEntries(NOTIFICATION_EVENT_KEYS.map((k) => [k, z.boolean().optional()]))),
  "rt.trustedBrowserOrigins": z.array(z.string()),
  "rt.worktreeApp": z.looseObject({ enabled: z.boolean().optional(), killProcesses: z.boolean().optional(), claudeHook: z.enum(["installed", "declined"]).optional() }),
  // the remaining rt.* keys, each from its readers
} satisfies Record<string, z.ZodType>;
```

Then regenerate the lock and rebuild (procedure step 6).

- [ ] **Step 4: Run to verify they pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/schema-lock.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/write.test.ts lib/__tests__/notification-shape-parity.test.ts lib/worktree/__tests__ lib/setup/__tests__ commands/__tests__/hooks.test.ts lib/__tests__/notifier.test.ts lib/__tests__/repo-tracking.test.ts lib/__tests__/run-presets.test.ts lib/__tests__/variations.test.ts lib/team/__tests__`
Expected: PASS. Any test file in that list that does not exist is dropped from the command; any that fails because a fixture writes a value the new schema rejects is a real finding: make the fixture conform and say so in the PR body (rt's own writers now pass through `validateWrite`).

- [ ] **Step 5: Gate and commit**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test packages/rt-client/test/dist-freshness.test.ts`

```bash
git add packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/schema.lock.json packages/rt-client/src/settings/__tests__/schema-examples.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts
git commit -m "feat(settings): schemas for the rt.* composite keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Schemas for `mattstack.*`, `setup.*`, `claude.*` and `deck.*` keys

**Files:** as Task 4 (`registry-schemas.ts`, `schema.lock.json`, `schema-examples.ts`, `schema-examples.test.ts`).

- [ ] **Step 1: Extend coverage**

In `schema-examples.test.ts`, set `COVERED_PREFIXES = ["rt.", "mattstack.", "setup.", "claude.", "deck."]`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts`
Expected: FAIL, completeness lists the nine keys.

- [ ] **Step 3: Write the nine schemas and examples**

Follow the procedure. Known facts:
- `setup.waived` is `z.array(z.string())`.
- `deck.apps`'s reader is `apps/deck/core/settings.ts` in the apps repo (`AppEntry`: `published?`, `passwordHash?`, `passwordVersion?`, `override?: PortOverride`, `publicFollowsOverride?`), a map of app name to entry: `z.record(z.string(), z.looseObject({ published: z.boolean().optional(), passwordHash: z.string().optional(), passwordVersion: z.number().optional(), override: z.looseObject({ ...the PortOverride fields }).optional(), publicFollowsOverride: z.boolean().optional() }))`. Read `PortOverride` there for its fields. Because `override` is nested, settings-kit recognizes this key as `json`, not `objectMap`; that is expected.
- `deck.access`, `deck.platform`: readers under `apps/deck/core` and `apps/deck/src/api/platform-settings.ts`.
- `mattstack.roster`, `mattstack.integrations`, `mattstack.tracking`: readers under `lib/team`, `lib/setup`, `lib/repo-tracking.ts`.
- `claude.marketplaces`, `claude.plugins`: readers under `lib/setup`.

Regenerate the lock and rebuild.

- [ ] **Step 4: Run to verify they pass, gate, commit**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/schema-lock.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts lib/team/__tests__ lib/setup/__tests__ lib/__tests__/repo-tracking.test.ts packages/rt-client/test/dist-freshness.test.ts && sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/schema.lock.json packages/rt-client/src/settings/__tests__/schema-examples.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts
git commit -m "feat(settings): schemas for the mattstack, setup, claude and deck keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Schemas for `board.*`, `boxscore.*`, `gitq.*` keys, display metadata, registry completeness

**Files:** as Task 4, plus `registry.test.ts`, and a frozen copy of today's `SHAPES`: create `packages/settings-kit/src/__tests__/shapes-legacy-fixture.ts`.

- [ ] **Step 1: Freeze today's SHAPES**

Before touching settings-kit, copy the current `SHAPES` object from `packages/settings-kit/src/shapes.ts` (every entry: `kind`, `fields`, `labels`, `fallbacks`, `app`) verbatim into `shapes-legacy-fixture.ts` as `export const LEGACY_SHAPES = { ... } as const;` (import the `LeafType` type and `NOTIFICATION_EVENTS` / `DEFAULT_SLACK_EMOJI` from `../shapes.ts` so the object evaluates identically). Task 9 asserts `recognize` against it.

- [ ] **Step 2: Make completeness total**

In `schema-examples.test.ts`, replace the covered-namespace test with:

```ts
  test("every composite key has a schema and an example", () => {
    const composite = allDefs().filter((d) => d.type === "object" || d.type === "array");
    expect(composite.filter((d) => !d.schema).map((d) => d.key)).toEqual([]);
    expect(composite.map((d) => d.key).filter((k) => !(k in EXAMPLES))).toEqual([]);
  });
```

Add to `registry.test.ts`:

```ts
    test("every object or array def carries a schema", () => {
      for (const def of allDefs()) {
        if (def.type !== "object" && def.type !== "array") continue;
        expect(def.schema, `${def.key} has no schema`).toBeDefined();
      }
    });
```

- [ ] **Step 3: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL naming the 21 keys.

- [ ] **Step 4: Write the schemas with metadata**

Field lists and metadata for the keys `LEGACY_SHAPES` covers must reproduce it: the same leaf paths, the same `labels`, the same `fallbacks` as `placeholder`. Exact entries:

```ts
  "board.slack": z.looseObject({
    channel: z.string().optional(),
    singleTemplate: z.string().optional(),
    multiHeader: z.string().optional(),
    multiItem: z.string().optional(),
    autoResolveIntervalMinutes: z.number().optional(),
    emoji: z.looseObject({
      looking: z.string().optional().meta({ placeholder: "eyes" }),
      commented: z.string().optional().meta({ placeholder: "speech_balloon" }),
      approved: z.string().optional().meta({ placeholder: "white_check_mark" }),
    }).optional(),
  }),
  "board.triage": z.looseObject({
    enabled: z.boolean().optional(),
    cooldownMinutes: z.number().optional(),
    dailyAttemptBudget: z.number().optional(),
    notify: z.enum(["rt", "badge-only"]).optional(),
    tier: z.enum(["api", "checkout"]).optional(),
    fixClasses: z.looseObject({
      retryFlake: z.boolean().optional(), inheritedNoteDraft: z.boolean().optional(), cleanApiRebase: z.boolean().optional(),
      mechanicalLint: z.boolean().optional(), codeFix: z.boolean().optional(),
    }).optional(),
  }),
  "board.workspaces": z.looseObject({ reviews: z.string().optional(), responds: z.string().optional(), doctors: z.string().optional() }),
  "board.cwds": z.looseObject({ review: z.string().optional(), respond: z.string().optional(), doctor: z.string().optional() }),
  "board.reReview": z.looseObject({ enabled: z.boolean().optional() }),
  "board.projects": z.array(z.string()),
  "board.botUsernames": z.array(z.string()),
  "board.ticketPrefixes": z.array(z.string()),
  "boxscore.projects": z.array(z.string()),
  "boxscore.linearDoneStates": z.array(z.string()),
  "boxscore.excludeFilePatterns": z.array(z.string()),
  "boxscore.ignoredMrs": z.array(z.string()),
  "boxscore.botPatterns": z.array(z.string()),
  "boxscore.sizeBand": z.looseObject({ tooSmall: z.number().optional(), tooLarge: z.number().optional() }),
  "gitq.workSlots": z.looseObject({ workSlotLocation: z.string().optional(), maxWorkSlots: z.number().optional() }),
```

`board.members`, `board.tabs`, `board.hiddenMembers`, `boxscore.hiddenMembers`, `gitq.forges`, `gitq.board`: read `apps/board/src`, `apps/boxscore`, and the gitq repo's `src/core` (read-only, scoped) for their shapes.

Regenerate the lock and rebuild.

- [ ] **Step 5: Run to verify they pass, gate, commit**

Run: `bun test packages/rt-client/src/settings/__tests__ packages/rt-client/test/dist-freshness.test.ts lib/__tests__/notification-shape-parity.test.ts && sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add packages/rt-client/src/settings/registry-schemas.ts packages/rt-client/src/settings/schema.lock.json packages/rt-client/src/settings/__tests__/schema-examples.ts packages/rt-client/src/settings/__tests__/schema-examples.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/settings-kit/src/__tests__/shapes-legacy-fixture.ts
git commit -m "feat(settings): schemas for board, boxscore and gitq keys; every composite key now has one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Lenient read labeling, list/explain rendering, store helpers

**Files:**
- Modify: `packages/rt-client/src/settings/resolve.ts`
- Modify: `commands/settings-keys.ts:428-447`, `:485-495`
- Test: `packages/rt-client/src/settings/__tests__/resolve.test.ts`, `commands/__tests__/settings-keys-render.test.ts` (create)

**Interfaces:**
- Produces:
  - `ExplainRow.nonconforming?: SchemaIssue[]`
  - `Resolution.mergedIssues: SchemaIssue[]`; `ListedSetting.nonconforming?: { scope: Scope; file: string | null; issues: SchemaIssue[] }[]`; `ListedSetting.mergedIssues?: SchemaIssue[]`
  - `listUnregisteredSettings(opts?: ResolveOpts): { key: string; scope: Scope; file: string }[]` (walks every repo section as well as the global sections, so no `repoIdentity` is needed to see repo leftovers; `scope` is the rung the key sat in)
  - `repoSectionsFor(key: string): { identity: string; scopes: SettingScope[] }[]`

`resolve.test.ts` has only `write(file, obj)`; add `writeUser`, `writeMachine`, `writeTeam(name, obj)` wrappers beside it, and change its `IDENTITY` constant to `gitlab.example.com/acme/app` (update the assertions that embed it).

- [ ] **Step 1: Write the failing tests**

Add to `resolve.test.ts` (using `withSchema` from `./with-schema.ts` and `SNAPSHOT` as in Task 3):

```ts
  describe("schema labeling (lenient reads)", () => {
    test("a nonconforming layer stays in effect and is labeled, never skipped", () => {
      withSchema("rt.homeSnapshot", SNAPSHOT, () => {
        writeMachine({ "rt.homeSnapshot": { enabled: "yes" } });
        expect(getSetting<{ enabled: unknown }>("rt.homeSnapshot").value.enabled).toBe("yes");
        const machine = explainSetting("rt.homeSnapshot").find((r) => r.scope === "machine")!;
        expect(machine.invalid).toBeUndefined();
        expect(machine.nonconforming?.[0]?.path).toEqual(["enabled"]);
      });
    });

    test("a type-invalid layer is still skipped and labeled invalid", () => {
      writeMachine({ "rt.homeSnapshot": "nope" });
      expect(explainSetting("rt.homeSnapshot").find((r) => r.scope === "machine")!.invalid).toContain("expected object");
    });

    test("a partial deep layer is not labeled", () => {
      withSchema("rt.homeSnapshot", SNAPSHOT, () => {
        writeMachine({ "rt.homeSnapshot": { enabled: false } });
        expect(explainSetting("rt.homeSnapshot").find((r) => r.scope === "machine")!.nonconforming).toBeUndefined();
      });
    });

    test("listSettings carries nonconforming layers and merged issues", () => {
      withSchema("rt.homeSnapshot", SNAPSHOT, () => {
        writeMachine({ "rt.homeSnapshot": { enabled: "yes" } });
        const row = listSettings().find((s) => s.key === "rt.homeSnapshot")!;
        expect(row.nonconforming?.[0]?.scope).toBe("machine");
        expect(row.mergedIssues?.[0]?.path).toEqual(["enabled"]);
      });
    });
  });

  describe("store helpers", () => {
    test("listUnregisteredSettings names unknown keys in global and repo sections", () => {
      writeMachine({ "board.rtRepos": [], repos: { [IDENTITY]: { "board.oldKey": 1 } } });
      const found = listUnregisteredSettings();
      expect(found.find((f) => f.key === "board.rtRepos")?.scope).toBe("machine");
      expect(found.find((f) => f.key === "board.oldKey")?.scope).toBe("machine.repo");
    });

    test("repoSectionsFor reports which stores set a key per repo", () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 1 } } } });
      writeUser({ repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 2 } } } });
      expect(repoSectionsFor("rt.worktrees")).toEqual([{ identity: IDENTITY, scopes: ["team", "user"] }]);
    });
  });
```

`commands/__tests__/settings-keys-render.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderExplainRow, renderListRow } from "../settings-keys.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("settings-keys rendering", () => {
  test("explain shows a nonconforming layer with its first issue", () => {
    const line = strip(renderExplainRow({ scope: "machine", file: "/tmp/settings.local.jsonc", present: true, value: { enabled: "yes" }, nonconforming: [{ path: ["enabled"], message: "expected boolean, got string" }] }));
    expect(line).toContain("[nonconforming: enabled: expected boolean, got string]");
  });

  test("list labels nonconforming layers and merged issues", () => {
    const line = strip(renderListRow({
      key: "rt.homeSnapshot", value: { enabled: "yes" }, provenance: [{ scope: "machine", file: "/tmp/x" }], migrated: true,
      nonconforming: [{ scope: "machine", file: "/tmp/x", issues: [{ path: ["enabled"], message: "expected boolean, got string" }] }],
      mergedIssues: [{ path: ["enabled"], message: "expected boolean, got string" }],
    }));
    expect(line).toContain("nonconforming[machine]: enabled: expected boolean, got string");
    expect(line).toContain("merged: enabled: expected boolean, got string");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts commands/__tests__/settings-keys-render.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement in `resolve.ts`**

Types: add `nonconforming?: SchemaIssue[]` to `ExplainRow`; `nonconforming?` and `mergedIssues?` to `ListedSetting` (shapes above); `mergedIssues: SchemaIssue[]` to `Resolution`. In `resolveDef`, after the `validateForScope` check passes and before `rows.push(row); applied.push(...)`:

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

In `listSettings`, after the `invalid` assignment:

```ts
    const nonconforming = resolution.rows.filter((r) => r.nonconforming).map((r) => ({ scope: r.scope, file: r.file, issues: r.nonconforming! }));
    if (nonconforming.length > 0) listed.nonconforming = nonconforming;
    if (resolution.mergedIssues.length > 0) listed.mergedIssues = resolution.mergedIssues;
```

Helpers:

```ts
export function listUnregisteredSettings(): { key: string; scope: Scope; file: string }[] {
  const stores = readStores();
  const out: { key: string; scope: Scope; file: string }[] = [];
  const scan = (scope: Scope, file: string, section: Record<string, unknown> | undefined) => {
    for (const key of Object.keys(section ?? {})) if (!getDef(key) && !isRetiredKey(key)) out.push({ key, scope, file });
  };
  for (const store of stores.teams) { scan("team", store.file, store.global); for (const s of Object.values(store.repos)) scan("team.repo", store.file, s); }
  scan("user", stores.user.file, stores.user.global); for (const s of Object.values(stores.user.repos)) scan("user.repo", stores.user.file, s);
  scan("machine", stores.machine.file, stores.machine.global); for (const s of Object.values(stores.machine.repos)) scan("machine.repo", stores.machine.file, s);
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope));
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

`listUnregisteredSettings` does not warn (the existing `listUnregistered` keeps its warning path for `listSettings`).

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

Import `firstIssueText` from `../lib/settings/schema.ts`.

- [ ] **Step 5: Run to verify they pass, plus the e2e settings file**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve.test.ts commands/__tests__/settings-keys-render.test.ts packages/rt-client/src/settings packages/rt-client/test/settings-warn-sink.test.ts && bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts`
Expected: PASS (the e2e file asserts prefixes and substrings; the new labels are appended after the value). If it fails on an exact string, fix the rendering, never the e2e assertion.

- [ ] **Step 6: Export, gate, commit**

Add `listUnregisteredSettings, repoSectionsFor` to `index.ts`'s `resolve.ts` export list.

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/resolve.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/index.ts commands/settings-keys.ts commands/__tests__/settings-keys-render.test.ts
git commit -m "feat(settings): label nonconforming layers on read, never skip them

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: settings-kit server: wire fields, repo resolution, `/repos`, `validateWrite`, secret-safe issues

**Files:**
- Modify: `packages/settings-kit/src/server.ts`
- Test: `packages/settings-kit/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: `checkSchema`, `validateWrite`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities`, `hasSchema` and the `nonconforming` row field from rt-client.
- Produces:
  - `SettingDefWire` gains `schema?: JsonSchema`, `layerSchema?: JsonSchema`, `storeVersion: number`, `issues?: WireIssue[]`, `mergedIssues?: SchemaIssue[]`, `repos?: { identity: string; scopes: string[] }[]`
  - `type WireIssue = { scope: string; file: string | null; repo?: string; kind: string; path: (string | number)[]; message: string; [extra: string]: unknown }`
  - `ExplainRowWire` gains `nonconforming?: SchemaIssue[]`
  - `/defs` response gains `unregistered`; `/defs` and `/explain/:key` accept `?repo=`; `/set` and `/unset` accept `repo` and pass `repoIdentity` to the follow-up `explainSetting`; `GET {base}/repos`
  - `RtSettingsApi` gains `validateWrite`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities`, optional `listRepos?`
  - Secret defs: every issue's `message` is replaced by `"refused"` (invalid) or `"does not match the schema"` (nonconforming); paths are kept. The same replacement applies to `effective.invalid` (set in `effectiveFromRows` before its secret early-return) and to `rows[].invalid`, on `/defs`, `/explain`, `/set` and `/unset`.

- [ ] **Step 1: Write the failing tests**

Extend the fake `DEFS`: give `board.slack` `schema` and `layerSchema` (JSON literals), `merge: "deep"`; make `rt.roles` `{ type: "object", scopes: ["team", "user", "machine"], merge: "deep", repoScoped: true, schema: {...} }`. Extend `RT`:

```ts
  validateWrite: (_def: FakeDef, value: unknown) => (value === "invalid" ? { ok: false, reason: "value is invalid", issues: [{ path: [], message: "value is invalid" }] } : { ok: true }),
  listUnregisteredSettings: () => [{ key: "board.rtRepos", scope: "machine", file: "/home/user/local/settings.local.jsonc" }],
  repoSectionsFor: (key: string) => (key === "rt.roles" ? [{ identity: "gitlab.example.com/acme/app", scopes: ["team"] }] : []),
  listStoreRepoIdentities: () => ["gitlab.example.com/acme/app"],
```

Make the fake `explainSetting(key, opts)`: for `board.title` the user row carries `nonconforming: [{ path: [], message: "bad" }]`; for `rt.secretThing` the user row carries `invalid: 'field "x" looks like a path literal ("/Users/someone/secret")'`; for `rt.roles` with `opts?.repoIdentity` set, append `{ scope: "team.repo", file: "/home/team/settings.team.jsonc", present: true, value: { dev: { port: 3000 } } }`. Add:

```ts
describe("schema on the wire", () => {
  test("/defs carries schema, layerSchema, storeVersion, issues and unregistered", async () => {
    const body = await (await handle(get("/api/settings/defs")))!.json();
    const slack = body.defs.find((d: any) => d.key === "board.slack");
    expect(slack.schema.type).toBe("object");
    expect(slack.layerSchema.required).toBeUndefined();
    expect(slack.storeVersion).toBe(1);
    expect(body.unregistered).toEqual([{ key: "board.rtRepos", scope: "machine", file: "/home/user/local/settings.local.jsonc" }]);
  });

  test("a nonconforming explain row is an issue on /defs and on the explain row", async () => {
    const explain = await (await handle(get("/api/settings/explain/board.title")))!.json();
    expect(explain.rows[0].nonconforming).toEqual([{ path: [], message: "bad" }]);
    const defs = await (await handle(get("/api/settings/defs")))!.json();
    expect(defs.defs.find((d: any) => d.key === "board.title").issues[0]).toMatchObject({ scope: "user", kind: "nonconforming", path: [], message: "bad" });
  });

  test("a secret key's issues never carry a value, even a path-guard reason that quotes one", async () => {
    const defs = await (await handle(get("/api/settings/defs")))!.json();
    const secret = defs.defs.find((d: any) => d.key === "rt.secretThing");
    expect(secret.issues).toEqual([{ scope: "user", file: "/home/user/settings.user.jsonc", kind: "invalid", path: [], message: "refused" }]);
    expect(secret.effective.invalid).toBe("refused");
    const explain = await (await handle(get("/api/settings/explain/rt.secretThing")))!.json();
    expect(explain.rows[0].invalid).toBe("refused");
    expect(explain.def.effective.invalid).toBe("refused");
    expect(JSON.stringify(explain)).not.toContain("/Users/someone/secret");
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

  test("/set forwards repo, uses validateWrite, and explains for the repo afterwards", async () => {
    const res = await handle(post("/api/settings/set", { key: "rt.roles", scope: "team", repo: "gitlab.example.com/acme/app", value: { dev: { port: 1 } } }), { allowComposite: true });
    expect(setCalls.at(-1)).toEqual(["rt.roles", { dev: { port: 1 } }, "team", { repoIdentity: "gitlab.example.com/acme/app" }]);
    expect((await res!.json()).rows.some((r: any) => r.scope === "team.repo")).toBe(true);
    const bad = await handle(post("/api/settings/set", { key: "board.title", scope: "user", value: "invalid" }));
    expect(bad!.status).toBe(400);
    expect(await bad!.json()).toEqual({ error: "value is invalid", issues: [{ path: [], message: "value is invalid" }] });
  });
});
```

The existing `allowComposite: 'shaped'` block (lines 278-340) asserts `rt.repoRoots` is writable and the exact `"value does not match rt.repoRoots's shape"` error. Rewrite it now to the new gate: a composite fake def is writable under `"shaped"` when it has a `schema` and is not `external` (give `rt.repoRoots` `schema: { type: "array", items: { type: "string" } }`); a bad value is refused by the fake `validateWrite` with `"value is invalid"`; `board.members` (external) stays refused with the exact error `"board.members" has no editable shape`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/settings-kit/src/__tests__/server.test.ts`
Expected: FAIL on the new block and the rewritten `shaped` block.

- [ ] **Step 3: Implement in `server.ts`**

- Import the new rt-client functions and types; extend `RtSettingsApi` and the `rt` default object.
- `defToWire`: `storeVersion: def.storeVersion ?? 1`; when `hasSchema(def)`: `schema: def.schema`, and for deep object keys `layerSchema: def.layerSchema`.
- `sanitizeRows`: copy `nonconforming` through; for a secret def replace `invalid` with `"refused"` and every nonconforming message with `"does not match the schema"`.
- `effectiveFromRows`: for a secret def, set `wire.invalid = "refused"` instead of `top.invalid` (the path-guard reason quotes the literal it rejected).
- `issuesFromRows(def, rows, repo?)`: `invalid` → `{ scope, file, repo?, kind: "invalid", path: [], message }`; `nonconforming` → one entry per issue, `kind: "nonconforming"`; secret defs get the fixed messages above. Never copy `row.value`.
- `compositeAllowed(def, mode)`: `mode === true`, or `mode === "shaped"` and `hasSchema(def)` and `SHAPES[def.key]?.kind !== "external"`.
- `/defs`: `repo` from `url.searchParams`; rows from `rt.explainSetting(d.key, { repoIdentity: repo ?? null })`; set `issues`, `mergedIssues` (from `checkSchema(def, effective.value, { layer: false })` when the def has a schema, is not secret, and the effective value is present), `repos: rt.repoSectionsFor(d.key)` for `repoScoped` defs; body gains `unregistered: rt.listUnregisteredSettings()`.
- `/explain/:key`: same `?repo=`.
- `GET {base}/repos`: identities from `rt.listStoreRepoIdentities()` merged with `await rt.listRepos?.()` (a rejection is ignored), label = identity after the first `/`, sorted by identity; add the route to the top guard.
- `/set` and `/unset`: read `body.repo`; build `opts` with only the defined keys among `team` and `repoIdentity`; `/set` replaces the `validateValue` call with `rt.validateWrite(def, value, { scope, repoIdentity: repo, team })`, answering `{ error, issues }` 400 on failure; drop the `matchesShape` gate; the follow-up `explainSetting` gets `{ repoIdentity: repo ?? null }`.

- [ ] **Step 4: Run to verify it passes, gate, commit**

Run: `bun test packages/settings-kit && sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add packages/settings-kit/src/server.ts packages/settings-kit/src/__tests__/server.test.ts
git commit -m "feat(settings-kit): schema, issues, repos and repo resolution on the wire; /set uses validateWrite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: settings-kit shapes: `recognize`, `checkValue`, `SHAPES` shrinks to `external`

**Files:**
- Modify: `packages/settings-kit/package.json` (add `@cfworker/json-schema@^4.1.1` to `dependencies`)
- Modify: `packages/settings-kit/src/shapes.ts`
- Modify: `lib/__tests__/notification-shape-parity.test.ts`
- Test: `packages/settings-kit/src/__tests__/shapes.test.ts` (uses `shapes-legacy-fixture.ts` from Task 6)

**Interfaces:**
- Produces:
  - `type Recognized = { kind: "stringList" } | { kind: "stringMap"; labels: [string, string] } | { kind: "leaves"; fields: Record<string, LeafType>; placeholders: Record<string, string> } | { kind: "objectList"; itemFields: Record<string, LeafType>; required: string[] } | { kind: "objectMap"; entryFields: Record<string, LeafType>; required: string[]; labels: [string, string] } | { kind: "json" }`
  - `recognize(schema: JsonSchema | undefined): Recognized`
  - `checkValue(schema: JsonSchema, value: unknown): SchemaIssue[]` (same normalization as rt-client's `validateJson`; duplicated here rather than imported, because `shapes.ts` builds for the browser without rt-client)
  - `matchesSchema(def: SettingDefWire, value: unknown): boolean`
  - `SHAPES` keeps only the three `external` entries; `RowKind` adds `"objectList" | "objectMap" | "json"`; `rowKind`, `summarize`, `targetScope` read the def's `schema` through `recognize`.

- [ ] **Step 1: Write the failing tests**

In `shapes.test.ts`, replace the `SHAPES` describe and the `matchesShape` describe with:

```ts
import { allDefs } from "@mattstack/rt-client";
import { LEGACY_SHAPES } from "./shapes-legacy-fixture.ts";

const byKey = new Map(allDefs().map((d) => [d.key, d]));
const schemaOf = (key: string) => byKey.get(key)!.schema!;

describe("recognize", () => {
  test("reproduces every legacy shape: kind, fields, labels and fallbacks", () => {
    for (const [key, legacy] of Object.entries(LEGACY_SHAPES)) {
      if (legacy.kind === "external") continue;
      const r = recognize(schemaOf(key));
      expect(`${key}: ${r.kind}`).toBe(`${key}: ${legacy.kind}`);
      if (legacy.kind === "leaves" && r.kind === "leaves") {
        expect(r.fields).toEqual(legacy.fields);
        expect(r.placeholders).toEqual(legacy.fallbacks ?? {});
      }
      if (legacy.kind === "stringMap" && r.kind === "stringMap") expect(r.labels).toEqual(legacy.labels);
    }
  });

  test("an array of flat objects is an objectList with its required names", () => {
    const r = recognize(schemaOf("rt.notify.eventBridges"));
    expect(r.kind).toBe("objectList");
    if (r.kind === "objectList") expect(r.required).toEqual(["pattern", "category", "title", "message"]);
  });

  test("a map of flat objects is an objectMap", () => {
    const r = recognize({ type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "object", properties: { port: { type: "number" }, dir: { type: "string" } }, required: ["port"] } });
    expect(r).toMatchObject({ kind: "objectMap", required: ["port"] });
  });

  test("anything deeper is json", () => {
    expect(recognize({ type: "object", properties: { a: { type: "object", properties: { b: { type: "array", items: { type: "object" } } } } } }).kind).toBe("json");
    expect(recognize(schemaOf("deck.apps")).kind).toBe("json");
    expect(recognize(undefined).kind).toBe("json");
  });
});

describe("checkValue", () => {
  test("matches the server's issue shape and messages", () => {
    const issues = checkValue({ type: "array", items: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } }, [{ pattern: 1 }]);
    expect(issues).toEqual([{ path: [0, "pattern"], message: "expected string, got number" }]);
    expect(checkValue({ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, {})).toEqual([{ path: ["a"], message: 'required property "a" is missing' }]);
  });
});

describe("SHAPES", () => {
  test("holds only external keys", () => {
    for (const shape of Object.values(SHAPES)) expect(shape.kind).toBe("external");
  });
});
```

Update the `rowKind`/`summarize`/`targetScope` tests in that file to build defs with `schema:` JSON literals instead of relying on `SHAPES`. Rewrite `lib/__tests__/notification-shape-parity.test.ts` to compare `Object.keys(recognize(getDef("rt.notifications")!.schema!).fields)` (kind `leaves`) against rt's `NOTIFICATION_TYPES`, keeping its purpose.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/settings-kit/src/__tests__/shapes.test.ts lib/__tests__/notification-shape-parity.test.ts`
Expected: FAIL, `recognize`/`checkValue` missing.

- [ ] **Step 3: Implement**

Add `@cfworker/json-schema` (`cd packages/settings-kit && bun add @cfworker/json-schema@^4.1.1 && cd ../..`). In `shapes.ts`:

```ts
import { Validator, type OutputUnit } from "@cfworker/json-schema";

export type JsonSchema = Record<string, unknown>;
export interface SchemaIssue { path: (string | number)[]; message: string }

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
```

zod emits a loose object's `additionalProperties` as `{}` and a record's as the value schema; the `Object.keys(add).length > 0` test is what tells the two apart. Confirm against one converted loose object and one record from the lock (`schema.lock.json`) before relying on it; if 4.6 emits differently, match what the lock holds.

`checkValue`: copy `validateJson`, `toIssues` (every normalization branch, including the `false` keyword for extras) and `pointerToPath` from rt-client's `schema.ts` as they stand after Task 1 (a comment on why it is duplicated is warranted: the browser bundle cannot import rt-client). Keep a per-schema `WeakMap` validator cache. Add a settings-kit test that feeds the same fixtures as Task 1's `validateJson` tests and expects identical issues, so the two copies cannot drift.

Then: `SHAPES` keeps the three external entries; `rowKind` returns `"external"` for a SHAPES key, `"readonly"` for secret/unwritable, `recognize(def.schema).kind` for composite defs, then `"enum"`/`"scalar"`; `summarize` switches on `recognize(def.schema)` (`objectList` counts items with `nouns(def.key)`, `objectMap` counts entries, `json` uses the array/object count or `"unset"`); add `matchesSchema(def, value)` as `checkValue(def.layerSchema ?? def.schema!, value).length === 0` (false when the def has no schema); `matchesShape` stays exported unchanged for `external` callers.

- [ ] **Step 4: Run to verify it passes, gate, commit**

Run: `bun test packages/settings-kit lib/__tests__/notification-shape-parity.test.ts && sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add packages/settings-kit/package.json bun.lock packages/settings-kit/src/shapes.ts packages/settings-kit/src/__tests__/shapes.test.ts lib/__tests__/notification-shape-parity.test.ts
git commit -m "feat(settings-kit): recognize editors from the schema, checkValue in the browser, SHAPES keeps only external keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `rt settings check`

**Files:**
- Create: `packages/rt-client/src/settings/check.ts`
- Modify: `commands/settings-keys.ts` (add `settingsCheck`), `lib/command-tree-def.ts` (`settings.check`), `packages/rt-client/src/index.ts`
- Test: `packages/rt-client/src/settings/__tests__/check.test.ts`, `commands/__tests__/settings-check.test.ts` (create)

**Interfaces:**
- Produces: `checkStores(): CheckReport` with

```ts
export interface CheckFinding { key: string; scope: SettingScope; file: string; repo?: string; kind: "invalid" | "nonconforming" | "merged" | "unregistered"; issues: SchemaIssue[] }
export interface CheckReport { findings: CheckFinding[]; failing: number }
```

`failing` counts `invalid`, `nonconforming` and `merged` findings; unregistered keys are listed, not failures. A `merged` finding has `file: "(merged)"` and `scope: "user"` as placeholders and prints without a scope.

- [ ] **Step 1: Write the failing tests**

`check.test.ts` (HOME per test; `withSchema` and the `write*` wrappers):

```ts
  test("reports a nonconforming layer, a type-invalid layer, a merged failure and an unregistered key", () => {
    withSchema("rt.homeSnapshot", SNAPSHOT, () => {
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
    withSchema("rt.worktrees", WORKTREES, () => {
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

`commands/__tests__/settings-check.test.ts`: `settingsCheck(["--json"])` with `console.log` spied prints `{ ok: false, findings: [...] }` and sets `process.exitCode = 1` on a seeded nonconforming store, `{ ok: true, findings: [] }` and leaves the exit code alone on clean stores. Restore `process.exitCode` in `afterEach`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/check.test.ts commands/__tests__/settings-check.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

`check.ts`:

```ts
/**
 * rt settings check: every stored value against its type check and layer
 * schema, every merged value against the full schema, plus unregistered
 * keys. Read-only; it uses this rt's registry.
 */

import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import { allDefs, getDef, validateValue, type SettingScope } from "./registry-machinery.ts";
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
  for (const def of allDefs()) {
    if (!hasSchema(def)) continue;
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
```

`settingsCheck(args)` in `commands/settings-keys.ts`: `--json` prints `{ ok: report.failing === 0, findings }`; human output prints one line per finding (`key  scope[/repo]  kind: <first issue>` via `firstIssueText`, `merged` lines without a scope), then `<failing> failing, <unregistered> unregistered`; `process.exitCode = 1` when `failing > 0`. Tree node under `settings`:

```ts
      check: {
        description: "Check every stored settings value against its schema and list unregistered keys",
        module: "./commands/settings-keys.ts",
        fn: "settingsCheck",
        args: [{ name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable output" }],
      },
```

Export `checkStores`, `CheckFinding`, `CheckReport` from `index.ts`.

- [ ] **Step 4: Run to verify it passes, docs, conformance, gate, commit**

Run: `bun test packages/rt-client/src/settings/__tests__/check.test.ts commands/__tests__/settings-check.test.ts && bun run docs:gen && bun run docs:check && bun run picker:check && sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`

```bash
git add packages/rt-client/src/settings/check.ts packages/rt-client/src/settings/__tests__/check.test.ts packages/rt-client/src/index.ts commands/settings-keys.ts commands/__tests__/settings-check.test.ts lib/command-tree-def.ts docs
git commit -m "feat(settings): rt settings check audits every store against the schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Classifier, `rt settings schema diff`, CI and preflight gates

**Files:**
- Create: `packages/rt-client/src/settings/schema-diff.ts` (`Lock`, `Change`, `classifyLockDiff`, `checkLockAgainst`; zod-free) and `lib/settings/schema-diff.ts` (barrel)
- Modify: `packages/rt-client/src/settings/schema-lock.ts` (re-export the two functions and the `Lock` type from `schema-diff.ts`, add `readBreakingChanges`)
- Modify: `commands/settings-schema.ts` (add `settingsSchemaDiff`), `lib/command-tree-def.ts`, `lib/release/preflight.ts`, `.github/workflows/checks.yml`
- Test: `packages/rt-client/src/settings/__tests__/schema-lock.test.ts`, `commands/__tests__/settings-schema.test.ts`, `commands/__tests__/release-preflight.test.ts`

**Interfaces:**
- Produces:
  - `classifyLockDiff(prev: Lock, next: Lock): Change[]` with `type Change = { key: string; kind: "safe" | "breaking"; detail: string }`
  - `checkLockAgainst(prev: Lock, next: Lock, acknowledged: Record<string, string>): { ok: boolean; problems: string[] }`
  - `readBreakingChanges(): Record<string, string>` (a static JSON import of `breaking-schema-changes.json`, so it works from `dist/` and from the compiled binary)
  - An absent lock at a ref reads as `{}` (every key is then "added", safe); this is what makes the first PR and the first release pass.
  - CLI `rt settings schema diff [--against <file> | --against-ref <git ref>] [--json]`: default `--against-ref origin/main`; a ref with no lock file counts as `{}`.
  - Preflight row `{ id: "schema-lock", label: "schema lock", ... }`.

- [ ] **Step 1: Write the failing tests**

Add to `schema-lock.test.ts`:

```ts
const obj = (props: Record<string, unknown>, required: string[] = [], extra: Record<string, unknown> = {}) => ({ type: "object", properties: props, required, ...extra });
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
  test("a breaking change needs a storeVersion bump and an acknowledgement; an absent previous lock is all safe", () => {
    const prev = lock({ type: "string" });
    expect(checkLockAgainst(prev, lock({ type: "number" }), {}).ok).toBe(false);
    expect(checkLockAgainst(prev, lock({ type: "number" }, 2), {}).ok).toBe(false);
    expect(checkLockAgainst(prev, lock({ type: "number" }, 2), { "t.k": "renamed the value" }).ok).toBe(true);
    expect(checkLockAgainst({}, lock({ type: "number" }), {}).ok).toBe(true);
  });
});
```

`commands/__tests__/settings-schema.test.ts`: `settingsSchemaDiff(["--against", <temp lock with t.k type changed>, "--json"])` prints `{ ok: false, changes, problems }` and sets exit code 1; `["--against", <temp empty {}>, "--json"]` prints `{ ok: true, ... }`; `["--against", <missing path>, "--json"]` treats it as `{}` and is ok.

`commands/__tests__/release-preflight.test.ts`: the existing `fakeSeams` must serve the committed lock through `readFile(join(repoRoot, "packages/rt-client/src/settings/schema.lock.json"))` and answer `git show <prevTag>:packages/rt-client/src/settings/schema.lock.json` with the same content (row `ok`), with a content whose entry for one key has a narrowed type and no `storeVersion` bump (row `stale`, detail naming the key), and with a non-zero exit (row `ok`, detail `no lock at <tag>`). Keep the existing "exits clean" test green by adding the lock answers to its seams.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the classifier**

In the new `schema-diff.ts` (no zod import), with `schema-lock.ts` now importing its `Lock` type from here and adding `export { classifyLockDiff, checkLockAgainst, type Change } from "./schema-diff.ts";` plus `import BREAKING from "./breaking-schema-changes.json" with { type: "json" };` for `readBreakingChanges`:

```ts
import type { JsonSchema } from "./schema.ts";
export type Lock = Record<string, { storeVersion: number; schema: JsonSchema }>;
export interface Change { key: string; kind: "safe" | "breaking"; detail: string }

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
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)].filter((x) => !ANNOTATIONS.has(x)))) {
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
      case "anyOf": case "oneOf": out.push({ kind: superset(bv, av) ? "safe" : "breaking", detail: `${where}: ${k} changed` }); break;
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

`settingsSchemaDiff(args)` in `commands/settings-schema.ts`: read the previous lock from `--against <path>` (missing file → `{}`) or `--against-ref <ref>` (default `origin/main`; `git show <ref>:packages/rt-client/src/settings/schema.lock.json` from the repo root via `spawnSync`; non-zero exit → `{}`); `next = buildLock()`; print each change and each problem; `--json` prints `{ ok, changes, problems }`; `process.exitCode = 1` when not ok. Tree: add `diff` under `settings.schema` with `--against`, `--against-ref`, `--json` args (descriptions as in Task 2's style).

Preflight: in `lib/release/preflight.ts` add the `schema-lock` row next to the `picker:check` row, following the file's `git(seams, [...])` seam. Preflight runs from the installed compiled `rt` (step 1 of `skills/rt-release/SKILL.md`), where `import.meta.url` resolves inside the bundle and the binary's own registry is not the checkout's, so the row never calls `buildLock()` or reads `LOCK_PATH`: it reads the committed lock at `join(seams.repoRoot, "packages/rt-client/src/settings/schema.lock.json")` through `seams.readFile` (CI's lock-in-sync step is what guarantees that file equals the registry), parses `git show <lastTag>:packages/rt-client/src/settings/schema.lock.json` as `prevLock` (or `{}` with detail `no lock at <tag>` when git exits non-zero), and runs `checkLockAgainst(prevLock, committedLock, breaking)` with `breaking` read from `join(seams.repoRoot, "packages/rt-client/src/settings/breaking-schema-changes.json")` the same way. Row: `ok`, or `stale` with the problems joined, or `error` when the committed lock is unreadable. The classifier lives in the zod-free `schema-diff.ts` (below) and preflight imports it through a `lib/settings/schema-diff.ts` barrel, so `lib/release/preflight.ts` stays free of zod.

CI, in `.github/workflows/checks.yml` after "Unit tests":

```yaml
      # A schema change that would invalidate stored settings must bump
      # storeVersion and be acknowledged; the committed lock is the record.
      - name: Settings schema lock is in sync
        run: bun run cli.ts settings schema lock && git diff --exit-code -- packages/rt-client/src/settings/schema.lock.json
      - name: Settings schema changes are classified
        run: git fetch --no-tags --depth=1 origin main && bun run cli.ts settings schema diff --against-ref origin/main
```

- [ ] **Step 4: Run to verify it passes, docs, conformance, gate, commit**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts lib/__tests__/no-eager-tui.test.ts && bun run docs:gen && bun run docs:check && bun run picker:check && bun run cli.ts settings schema diff --against packages/rt-client/src/settings/schema.lock.json && sh scripts/repo-purity.sh && bunx tsc --noEmit && cd packages/rt-client && bun run build && cd ../..`
Expected: PASS; the diff against itself prints no changes and exits 0.

```bash
git add packages/rt-client/src/settings/schema-diff.ts packages/rt-client/src/settings/schema-lock.ts packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/settings-schema.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts lib/settings/schema-diff.ts lib/command-tree-def.ts lib/release/preflight.ts .github/workflows/checks.yml docs
git commit -m "feat(settings): breaking-change classifier, rt settings schema diff, CI and preflight gates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Readers use the inferred types

**Files:**
- Modify: every rt-side reader of a `rt.*` composite key that declares its own interface for the value (find them with `git grep -n "getSetting<" -- lib commands extensions` and `git grep -n "rt\.notify\.eventBridges\|rt\.roles\|..." -- lib commands`); known ones: `lib/notify-bridge.ts` (`EventBridgeRule`).
- Test: the existing tests of each touched file.

**Interfaces:**
- Consumes: `Value<K>` from `registry-schemas.ts`, imported as a type only: `import type { Value } from "../packages/rt-client/src/settings/registry-schemas.ts";` (through a `lib/settings/registry-schemas.ts` barrel that is itself `export type { Value } from ...`). A type-only import is erased under `verbatimModuleSyntax`, so zod stays off the runtime path; `no-zod-in-dist.test.ts` and `bun scripts/bench-startup.ts` prove it.
- Produces: each touched reader's hand-written value type replaced by `Value<"<key>">` (or a named alias of it), with no behavior change. Readers in the apps repo are out of scope here (spec 2).

- [ ] **Step 1: Enumerate**

Run the greps above; list every file that declares an interface or type for one of the 25 `rt.*` composite values. Record the list in the PR body.

- [ ] **Step 2: Replace, one file at a time**

For each: replace the hand-written type with the inferred one, run that file's test file (`bun test <its __tests__ file>`), and `bunx tsc --noEmit`. Where the inferred type is wider than the hand-written one (an `.optional()` the reader assumed present), keep the reader's narrowing at the use site rather than tightening the schema.

- [ ] **Step 3: Gate and commit**

Run: `bun test packages/rt-client/test/no-zod-in-dist.test.ts lib && bun build --compile ./cli.ts --outfile dist/rt --no-compile-autoload-bunfig --no-compile-autoload-dotenv && bun scripts/bench-startup.ts && sh scripts/repo-purity.sh && bunx tsc --noEmit`

```bash
git add lib commands extensions lib/settings/registry-schemas.ts
git commit -m "refactor(settings): rt readers take their value types from the schemas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Docs, versions, the real-store audit and the PR

**Files:**
- Modify: `docs/settings-architecture.md` ("Adding a key" gains: write the zod schema, add an example, `rt settings schema lock`, rebuild), `packages/rt-client/README.md` (a "Settings schemas" section: the lock, `checkSchema`, `validateWrite`, `rt settings check`), `packages/settings-kit/README.md` ("Shapes" becomes "Schemas and editors": `recognize`, `checkValue`, the wire fields, `?repo=`, `/repos`, `unregistered`), `skills/rt-release/SKILL.md` (the preflight list gains the `schema lock` row; load `superpowers:writing-skills` first)
- Modify: `packages/rt-client/package.json` version `0.31.1` → `0.32.0`; `packages/settings-kit/package.json` version `0.3.0` → `0.4.0` and `peerDependencies["@mattstack/rt-client"]` → `">=0.32.0 <1"`
- Modify: `packages/rt-client/test/index-surface.test.ts`

- [ ] **Step 1: Extend the surface test**

Assert `checkSchema`, `validateJson`, `validateWrite`, `checkStores`, `listUnregisteredSettings`, `repoSectionsFor`, `listStoreRepoIdentities`, `mergedValueWith` are functions on the index, and that `buildLock` and `classifyLockDiff` are **not** (they live in the dev module).

Run: `bun test packages/rt-client/test/index-surface.test.ts`
Expected: PASS once the exports match; fix `index.ts` otherwise.

- [ ] **Step 2: Docs and versions**

Write the docs in the file list. Announce the rt-client version bump to the other sessions per AGENTS.md before merging.

- [ ] **Step 3: The real-store audit (read-only, on Matt's machine)**

Run: `bun run cli.ts settings check`
Expected: exit 0. A finding is a schema stricter than a real value: fix the schema by the procedure, never the store, regenerate the lock, rebuild, re-run, and note each such fix in the PR body.

- [ ] **Step 4: Full local gate for the branch**

Run: `sh scripts/repo-purity.sh && bunx tsc --noEmit && bun test packages commands/__tests__/settings-keys-render.test.ts commands/__tests__/settings-check.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts lib/__tests__/notification-shape-parity.test.ts lib/__tests__/no-eager-tui.test.ts && bun run docs:check && bun run picker:check && bun build --compile ./cli.ts --outfile dist/rt --no-compile-autoload-bunfig --no-compile-autoload-dotenv && bun scripts/bench-startup.ts && bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts && cd packages/rt-client && bun run build && cd ../settings-kit && bun run build && cd ../..`
Expected: all green, and the bench median within a few ms of Task 2's baseline (record both numbers in the PR body). CI runs the rest.

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/settings-architecture.md packages/rt-client/README.md packages/settings-kit/README.md skills/rt-release/SKILL.md packages/rt-client/package.json packages/settings-kit/package.json packages/rt-client/test/index-surface.test.ts packages/rt-client/src/settings/schema.lock.json
git commit -m "docs(settings): schemas, check, lock; rt-client 0.32.0, settings-kit 0.4.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin settings-schemas
gh pr create -R m4ttstack/rt --base main --head settings-schemas --title "settings: schemas, validateWrite, rt settings check, schema lock" --body-file <(printf '%s\n' "Implements docs/superpowers/specs/2026-09-25-settings-schemas-design.md." "" "Every composite key has a zod-authored schema; the committed lock is the runtime source of each def's JSON Schema, so zod never loads at startup. Writes are gated by validateWrite (layer schema plus merged result); reads only label. settings-kit carries schema, issues, repos and repo resolution; recognize() replaces SHAPES. The lock plus classifier gates CI and release preflight." "" "Schemas follow the most permissive reader; reader disagreements, fixture changes and real-store audit fixes are listed below." "" "🤖 Generated with [Claude Code](https://claude.com/claude-code)")
```

Then wait for CodeRabbit and CI per the repo rule (an Opus reviewer if CodeRabbit is rate-limited). Do not merge without Matt's confirmation. Publishing `@mattstack/rt-client` and `@mattstack/settings-kit` is release-class, from `main` only, after the merge (AGENTS.md); the apps repo bumps its catalog pins in spec 2's plan.

---

## Self-review notes

- Spec coverage: schemas, fields and the lock as runtime source (Tasks 1, 2, 4, 5, 6); deep-merge layer rule and merged check (Tasks 1, 3); strict write / lenient read (Tasks 3, 7); `io: "input"` (Task 2); settings-kit wire, `?repo=`, `/repos`, `unregistered`, `checkValue`, `recognize`, `SHAPES` shrink (Tasks 8, 9); `rt settings check` (Task 10); lock, classifier, CI, pre-release (Tasks 2, 11); reader typing (Task 12); rt's own writers all pass through `setSetting` and so through `validateWrite`, and the real-store audit runs in Task 13; app writers are tested in the apps repo (spec 2).
- Type consistency: `SchemaIssue`, `JsonSchema`, `checkSchema(def, value, { layer })`, `validateWrite(def, value, { scope, repoIdentity?, team? })`, `WriteVerdict`, `CheckFinding`, `Lock`, `Change`, `Recognized` keep the same shapes across tasks.
- Review Focus 1 to 5 pin tests in Tasks 7, 3, 6, 8, 3.
