# Settings Migrations and Schema Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A composite settings key can change shape between releases: its breaking change gets a new store name (`key@N`), a registered migration carries older names forward in memory on every read, writes land on the current name and record a baseline for older names, divergence by an old writer is detected and reported, `rt settings migrate` materializes and prunes, and CI plus release preflight refuse a breaking change without a proven migration.

**Architecture:** A pure, zod-free module (`migrate.ts`) owns store names, the migration chain and the per-section read (current name first, else the highest older name migrated; older names beside a current one labeled `leftover`, `stale` or `diverged` against `$migrated` baselines). The resolver, the write path, `rt settings check`, `rt settings migrate` and settings-kit all go through it. Migration steps (`up` functions) are runtime data in `migrations/index.ts`; each step's source-version zod schema is authoring-only data in `migrations/schemas.ts`, written into the committed lock as JSON Schema so the zod-free CI and preflight gates can compare it with the previous lock. A deterministic sample generator proves every step, and a drafting tool reconstructs zod from the lock and writes mechanical `up` stubs.

**Tech Stack:** Bun 1.4.2, TypeScript, jsonc-parser, @cfworker/json-schema (runtime), zod v4 (dev only), bun:test.

**Spec:** `docs/superpowers/specs/2026-09-25-settings-migrations-design.md` (spec 3 of 3). It builds on spec 1 (`docs/superpowers/specs/2026-09-25-settings-schemas-design.md`) and plan 1 (`docs/superpowers/plans/2026-09-25-settings-schemas.md`), both on branch `settings-schemas`. Read spec 3 first; every task argues from it.

**Starting point:** implementation starts from `main` **after plan 1 (branch `settings-schemas`) has merged**. This plan names plan 1's interfaces as plan 1 defines them: `SettingDef.storeVersion`, `SettingDef.schema`, `SettingDef.layerSchema`, `schema.lock.json` (`{ [key]: { storeVersion, schema } }`), `schema.ts` (`JsonSchema`, `SchemaIssue`, `checkSchema`, `validateJson`, `layerJsonSchema`, `formatIssuePath`, `firstIssueText`, `hasSchema`), `schema-lock.ts` (`toJsonSchema`, `buildLock`, `LOCK_PATH`), `schema-diff.ts` (`Lock`, `Change`, `classifyLockDiff`, `checkLockAgainst`, `readBreakingChanges`), `validate-write.ts` (`validateWrite`, `WriteVerdict`), `check.ts` (`checkStores`, `CheckFinding`, `CheckReport`), `resolve.ts` (`mergedValueWith`, `currentMergedValue`, `listStoreRepoIdentities`, `listUnregisteredSettings`, `repoSectionsFor`, `ExplainRow.nonconforming`), `rt settings check`, `rt settings schema lock|diff`, and the preflight `schema-lock` row. If plan 1 renamed any of these while it landed, use the merged name; the behavior this plan asks for does not change.

## Global Constraints

- Store name of a key: `key` at `storeVersion` 1, `${key}@${storeVersion}` above it (`rt.notify.eventBridges@2`). Code keeps using the plain key everywhere (`getSetting`, `setSetting`, `rt settings set`, `/set`); only property names inside store files change.
- `storeVersion` goes up exactly when a key's schema changes in a breaking way (spec 1's classifier). A safe change keeps the name.
- Store metadata: each section (global, and each `repos.<identity>`) may hold one `$migrated: { [older store name]: "<hash>" }`. Any `$`-prefixed property name is metadata: never resolved as a key, never reported as unregistered.
- Hash of a value: `"sha256:" + first 16 hex chars of sha256(canonical JSON)`, canonical JSON being `JSON.stringify` with object keys sorted at every depth.
- Every write of a key lands on its current store name and leaves older names in that section untouched. Only the first write of the current name into a section records baselines, only for older names that have none, in the same temp-then-rename write.
- Reads: current name wins; else the highest readable older name, migrated in memory before labeling and merge. A step that throws, or a migrated result that fails the (layer) schema, keeps the stored value in effect and labels the row `nonconforming`, naming the step.
- An older name beside a current one is labeled per name: `leftover` (migrated value equals current), else `stale` (its `$migrated` baseline matches its authored value), else `diverged`. A layer takes the worst (`diverged` > `stale` > `leftover`).
- `migrateFrom` steps are pure and synchronous; for `merge: "deep"` keys a step receives one partial layer and must keep it partial.
- zod never loads at runtime, exactly as in plan 1: runtime defs carry `migrateFrom: { version, up }[]` and `renamedFrom`; each step's zod schema lives in `migrations/schemas.ts` (dev only) and reaches runtime tools only as JSON Schema in the lock. `packages/rt-client/test/no-zod-in-dist.test.ts` keeps guarding this. This is the one deliberate departure from spec 3's `migrateFrom: { version, schema: z.ZodType, up }` shape; the information is the same, split by load path.
- Wire names pinned with spec 2 (console): a diverged issue is `{ scope, file, repo?, kind: "diverged", path: [], message, storeName, olderValue, currentValue }` with `storeName` the OLDER name and no values for a secret def; explain rows carry `storeName`, `storedVersion`, `value` (migrated) and `authored` (as stored) on every present store row (never on the `default` row); `POST {base}/prune` takes `{ key, scope, repo?, storeName, force?, team? }` and answers like `/unset`.
- No floors, no reader discovery: nothing in this plan records or enforces which rt-client versions read a store.
- Commit trailer on every commit, verbatim: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Gate for every task, each command run bare (never piped through `tail`, `head` or `grep`; a pipe hides the exit code): `sh scripts/repo-purity.sh`, then `bunx tsc --noEmit`, then `bun test <the task's own test files>`, then (after any change under `packages/rt-client/src`) `bun run --cwd packages/rt-client build`, because `packages/rt-client/test/dist-freshness.test.ts` fails on a stale `dist/` (AGENTS.md).
- CI runs the full suite; locally run only the test files each task names, from the repo root (bun reads `bunfig.toml` only from the cwd; AGENTS.md).
- Never run a built `rt` binary (or `dist/rt`) outside an isolated HOME (`env -i HOME=<temp> ...`). `bun run cli.ts settings check` from source against real stores is read-only and happens only in Task 12.
- A new command-tree node needs `bun run docs:gen` then `bun run docs:check` and `bun run picker:check` green; a new command module needs a `lib/module-registry.ts` entry (this plan adds none: every verb lands in an existing module).
- Fixture data is invented: repo identity `gitlab.example.com/acme/app`, team `acme`, keys under test are real registry keys or `t.*` names in pure fixtures. `scripts/repo-purity.sh` is the gate.
- No em or en dashes in new text, including strings, comments, docs and commit messages.
- Comments state constraints the code cannot show; no narration, no task numbers, no review history in source.
- Publishing `@mattstack/rt-client` or `@mattstack/settings-kit` is release-class, from `main` only, after merge (AGENTS.md). This plan bumps versions; it never publishes.
- Editing any file under `skills/` requires loading `superpowers:writing-skills` first.

## Decisions this plan makes where the spec is silent

1. **`unsetSetting` removes every name of the key in that section**, with the `$migrated` entries of the names it removes, and refuses when an older name is `diverged`. Removing only the current name would let the older name resurface (migrated) and the unset would look like it did nothing. A diverged older name is an old writer's edit nobody has seen, so it is never deleted as a side effect.
2. **Renames continue the old key's version numbers.** A `renamedFrom` key keeps the old key's `storeVersion`; the old key's names at the same version are older names needing no step, and steps filed under the old key continue the new key's chain.
3. **The never-shipped escape hatch** (`breaking-schema-changes.json`) needs no `storeVersion` bump: a key absent from the lock at the latest `v*` tag may take a breaking change with a one-line reason. A tag with no lock file reads as `{}`, so until plan 1's lock ships in a release every key counts as never shipped; this is the same window plan 1 already has.
4. **Proof samples of a deep-merge key are overlaid onto the registry default** before the full-schema check, because a stored layer never holds the whole value; layer samples are checked against the layer schema alone.
5. **`rt settings migrate --prune` asks once per store** on a terminal (rt-ui `confirm`, destructive) and needs `--yes` everywhere else; `--write` and `--prune` are separate runs.

## Review Focus

1. A console or daemon write of a bumped key into a section that holds only the old name must leave the old name byte-for-byte as it was, record exactly one baseline for it, and put both edits in one write. Pinned in Task 4.
2. `rt settings unset` of a bumped key where both `key` and `key@2` are present must make the key read as unset afterwards, not resurface the old value. Pinned in Task 4.
3. A store written by a newer rt (`key@3` where this rt knows `key@2`) must resolve from `key@2` and report `key@3` as newer, never as a stray key and never read. Pinned in Task 3.
4. A diverged older name inside a repo section (`repos.<identity>`) must be found by `rt settings check`, labeled on the repo rung in explain, and refused by prune, exactly as in the global section. Pinned in Tasks 3, 5 and 6.
5. A migration step that mutates its input must not corrupt the authored value used for labeling or hashing. Pinned in Task 2.

---

## File structure

**rt-client runtime (`packages/rt-client/src/settings/`, zod-free)**

- `migrate.ts` (create): store names (`storeNameFor`, `parseStoreName`, `currentStoreName`, `olderStoreNames`, `storeNameStatus`, `renamedHeir`), the chain (`chainProblem`, `runChain`), hashing (`canonicalJson`, `valueHash`), the section read (`readSection`, `worstLabel`, `baselinesOf`, `baselinesToRecord`), `MIGRATED_PROP`.
- `migrations/index.ts` (create): `MIGRATION_STEPS` (flat, `{ key, version, up }`) and `RENAMES`, with `@draft-*` insertion markers.
- `migrations/helpers.ts` (create): `renameProperty`, `deleteProperty`, `setDefault`, `MigrationPath`.
- `migrate-stores.ts` (create): `storeSections`, `planStoreMigrations`.
- `registry-machinery.ts` (modify): `MigrationStep`, `SettingDef.migrateFrom`, `SettingDef.renamedFrom`, attached from `migrations/index.ts`.
- `resolve.ts`, `write.ts`, `check.ts` (modify).
- `sample-values.ts` (create): `sampleValues(schema)`, the deterministic generator (zod-free; used by proof tests and drafting only).
- `schema-diff.ts` (modify): `Lock` entries gain `migrateFrom?` and `renamedFrom?`; `equivalentSchemas`; `checkLockAgainst` takes an options object.

**rt-client authoring (dev only, may import zod)**

- `migrations/schemas.ts` (create): `MIGRATION_SCHEMAS`, one `{ key, version, schema, examples }` per step.
- `schema-lock.ts` (modify): `buildLock` writes `migrateFrom` and `renamedFrom` into lock entries.
- `migration-proof.ts` (create): `proveMigration`.
- `zod-source.ts` (create): `zodSource`, zod source rebuilt from a lock's JSON Schema.
- `schema-draft.ts` (create): `draftMigrations`, `applyDrafts`, `MIGRATIONS_INDEX_PATH`, `MIGRATION_SCHEMAS_PATH`.

**Tests (`packages/rt-client/src/settings/__tests__/`)**: `migrate.test.ts`, `migrate-section.test.ts`, `with-migration.ts`, `resolve-migrations.test.ts`, `write-migrations.test.ts`, `check-migrations.test.ts`, `migrate-stores.test.ts`, `sample-values.test.ts`, `migration-proof.test.ts`, `zod-source.test.ts`, `schema-draft.test.ts`, `migrations-acceptance.test.ts`; existing `registry.test.ts` and `schema-lock.test.ts` gain cases.

**settings-kit**: `packages/settings-kit/src/server.ts`, `react.ts` (modify); `src/__tests__/server.test.ts` (modify).

**rt CLI and release**: `commands/settings-keys.ts` (render, `settingsMigrate`), `commands/settings-schema.ts` (`--shipped-ref`, `--draft`), `lib/settings/migrate.ts`, `lib/settings/migrate-stores.ts` and `lib/settings/schema-draft.ts` (create, one-line barrels), `lib/command-tree-def.ts` (`settings.migrate`, new flags), `lib/release/preflight.ts` (release mode, bumped keys, `settings-stores` row), `.github/workflows/checks.yml` (fetch `v*` tags); tests `commands/__tests__/settings-check.test.ts`, `settings-migrate.test.ts` (create), `settings-schema.test.ts`, `release-preflight.test.ts`.

**Docs**: generated reference (`bun run docs:gen`), `docs/settings-architecture.md`, `packages/rt-client/README.md`, `packages/settings-kit/README.md`, `skills/rt-release/SKILL.md`.

---

### Task A0: Bootstrap the worktree

**Files:** none.

- [ ] **Step 1: Confirm plan 1 is on this branch's base**

Run: `test -f packages/rt-client/src/settings/validate-write.ts`
Expected: exit 0. If it exits 1, plan 1 has not merged into this branch's base: stop and report `BLOCKED: plan 1 not merged`; do not start Task 1.

- [ ] **Step 2: Install**

Run: `bun install`
Expected: exit 0. The postinstall builds `packages/rt-client/dist/`.

- [ ] **Step 3: Baseline the suites this plan touches**

Run: `bun test packages/rt-client packages/settings-kit commands/__tests__/settings-check.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts`
Expected: PASS. Record any failure in your report as pre-existing before changing anything (verify it also fails on a clean `main` checkout of the same commit).

---

### Task 1: Store names, migration steps on the def, the chain

**Files:**
- Create: `packages/rt-client/src/settings/migrate.ts`
- Create: `packages/rt-client/src/settings/migrations/index.ts`, `packages/rt-client/src/settings/migrations/helpers.ts`
- Modify: `packages/rt-client/src/settings/registry-machinery.ts` (`MigrationStep`, two `SettingDef` fields, attach at module init)
- Create: `packages/rt-client/src/settings/__tests__/with-migration.ts`, `packages/rt-client/src/settings/__tests__/migrate.test.ts`
- Modify: `packages/rt-client/src/settings/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `SettingDef`, `getDef`, `allDefs`, `isRetiredKey` (registry-machinery); `SettingDef.storeVersion` (plan 1, attached from the lock, default 1).
- Produces:
  - registry-machinery: `interface MigrationStep { version: number; up: (value: unknown) => unknown }`; `SettingDef.migrateFrom?: MigrationStep[]` (ascending); `SettingDef.renamedFrom?: string[]`.
  - `migrations/index.ts`: `interface KeyedMigrationStep extends MigrationStep { key: string }`; `MIGRATION_STEPS: KeyedMigrationStep[]` (empty); `RENAMES: Record<string, string[]>` (empty); markers `// @draft-steps`, `// @draft-renames`.
  - `migrations/helpers.ts`: `type MigrationPath = string[]` (`"[]"` = every array item, `"{}"` = every record value); `renameProperty(value, path, from, to)`, `deleteProperty(value, path, name)`, `setDefault(value, path, name, fallback)`, all `unknown`-typed and non-mutating.
  - `migrate.ts`: `MIGRATED_PROP = "$migrated"`; `storeNameFor(key, version): string`; `parseStoreName(name): { key: string; version: number }`; `currentStoreName(def): string`; `renamedHeir(key): SettingDef | undefined`; `interface OlderStoreName { name: string; version: number }`; `olderStoreNames(def): OlderStoreName[]`; `type StoreNameStatus = "metadata" | "current" | "older" | "newer" | "retired" | "unknown"`; `storeNameStatus(name): StoreNameStatus`; `chainProblem(def): string | null`; `type ChainResult = { ok: true; value: unknown } | { ok: false; message: string }`; `runChain(def, value, fromVersion): ChainResult`.
  - Test helper `with-migration.ts`: `interface MigrationFixture { storeVersion?: number; migrateFrom?: MigrationStep[]; renamedFrom?: string[]; schema?: Record<string, unknown> }`; `withMigration(key, fixture, fn: () => void): void`; `withMigrationAsync(key, fixture, fn: () => Promise<void>): Promise<void>`.

- [ ] **Step 1: Write the test helper**

Create `packages/rt-client/src/settings/__tests__/with-migration.ts`:

```ts
/**
 * Gives a live registry def a storeVersion, migration steps, renames and
 * (optionally) a schema for the duration of one assertion. Defs are shared
 * objects (`getDef` returns the live entry), so every field is restored
 * afterward or one test's bump would leak into the next.
 */

import { getDef, type MigrationStep, type SettingDef } from "../registry-machinery.ts";
import { layerJsonSchema } from "../schema.ts";

export interface MigrationFixture {
  storeVersion?: number;
  migrateFrom?: MigrationStep[];
  renamedFrom?: string[];
  schema?: Record<string, unknown>;
}

type Saved = Pick<SettingDef, "storeVersion" | "migrateFrom" | "renamedFrom" | "schema" | "layerSchema">;

function apply(key: string, fixture: MigrationFixture): { def: SettingDef; saved: Saved } {
  const def = getDef(key) as SettingDef;
  const saved: Saved = { storeVersion: def.storeVersion, migrateFrom: def.migrateFrom, renamedFrom: def.renamedFrom, schema: def.schema, layerSchema: def.layerSchema };
  if (fixture.storeVersion !== undefined) def.storeVersion = fixture.storeVersion;
  if (fixture.migrateFrom !== undefined) def.migrateFrom = fixture.migrateFrom;
  if (fixture.renamedFrom !== undefined) def.renamedFrom = fixture.renamedFrom;
  if (fixture.schema !== undefined) {
    def.schema = fixture.schema;
    def.layerSchema = def.merge === "deep" && def.type === "object" ? layerJsonSchema(fixture.schema) : undefined;
  }
  return { def, saved };
}

export function withMigration(key: string, fixture: MigrationFixture, fn: () => void): void {
  const { def, saved } = apply(key, fixture);
  try {
    fn();
  } finally {
    Object.assign(def, saved);
  }
}

export async function withMigrationAsync(key: string, fixture: MigrationFixture, fn: () => Promise<void>): Promise<void> {
  const { def, saved } = apply(key, fixture);
  try {
    await fn();
  } finally {
    Object.assign(def, saved);
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/migrate.test.ts`:

```ts
/**
 * migrate.ts, names and chain: versioned store names, how a stored name is
 * classified, which older names a def can read, and the migration chain.
 * Pure: synthetic defs, except where a name must resolve through the live
 * registry (withMigration restores the def afterward).
 */

import { describe, expect, test } from "bun:test";
import type { MigrationStep, SettingDef } from "../registry-machinery.ts";
import { chainProblem, currentStoreName, olderStoreNames, parseStoreName, runChain, storeNameFor, storeNameStatus } from "../migrate.ts";
import { deleteProperty, renameProperty, setDefault } from "../migrations/helpers.ts";
import { withMigration } from "./with-migration.ts";

const def = (over: Partial<SettingDef>): SettingDef => ({ key: "t.k", type: "object", scopes: ["user"], merge: "replace", description: "test", ...over });
const step = (version: number, up: (v: unknown) => unknown = (v) => v): MigrationStep => ({ version, up });

describe("store names", () => {
  test("version 1 is the bare key, above it the key carries @N", () => {
    expect(storeNameFor("t.k", 1)).toBe("t.k");
    expect(storeNameFor("t.k", 3)).toBe("t.k@3");
    expect(currentStoreName(def({ storeVersion: 2 }))).toBe("t.k@2");
    expect(currentStoreName(def({}))).toBe("t.k");
  });

  test("parseStoreName splits a trailing @N and reads anything else as a version 1 name", () => {
    expect(parseStoreName("rt.roles@2")).toEqual({ key: "rt.roles", version: 2 });
    expect(parseStoreName("rt.roles")).toEqual({ key: "rt.roles", version: 1 });
    expect(parseStoreName("rt.roles@0")).toEqual({ key: "rt.roles@0", version: 1 });
  });

  test("olderStoreNames lists readable versions highest first, the key's own name before renamed keys", () => {
    const d = def({ storeVersion: 3, migrateFrom: [step(1), step(2)], renamedFrom: ["t.old"] });
    expect(olderStoreNames(d)).toEqual([
      { name: "t.old@3", version: 3 },
      { name: "t.k@2", version: 2 },
      { name: "t.old@2", version: 2 },
      { name: "t.k", version: 1 },
      { name: "t.old", version: 1 },
    ]);
  });

  test("a version with no step is not readable", () => {
    expect(olderStoreNames(def({ storeVersion: 3, migrateFrom: [step(2)] })).map((o) => o.name)).toEqual(["t.k@2"]);
    expect(olderStoreNames(def({}))).toEqual([]);
  });
});

describe("storeNameStatus", () => {
  test("classifies metadata, current, older, newer, retired and unknown names", () => {
    withMigration("rt.notify.eventBridges", { storeVersion: 2, migrateFrom: [step(1)] }, () => {
      expect(storeNameStatus("$migrated")).toBe("metadata");
      expect(storeNameStatus("rt.notify.eventBridges@2")).toBe("current");
      expect(storeNameStatus("rt.notify.eventBridges")).toBe("older");
      expect(storeNameStatus("rt.notify.eventBridges@3")).toBe("newer");
      expect(storeNameStatus("rt.notify.eventBridges@1")).toBe("unknown");
      expect(storeNameStatus("mattstack.mode")).toBe("retired");
      expect(storeNameStatus("t.nothing")).toBe("unknown");
    });
  });

  test("a renamed key's names are older names of its heir, above the heir's version newer", () => {
    withMigration("rt.notify.eventBridges", { renamedFrom: ["rt.eventRules"] }, () => {
      expect(storeNameStatus("rt.eventRules")).toBe("older");
      expect(storeNameStatus("rt.eventRules@2")).toBe("newer");
    });
  });
});

describe("chainProblem", () => {
  test("an unbroken chain to storeVersion, or no chain at version 1, passes", () => {
    expect(chainProblem(def({ storeVersion: 3, migrateFrom: [step(1), step(2)] }))).toBeNull();
    expect(chainProblem(def({ storeVersion: 3, migrateFrom: [step(2)] }))).toBeNull();
    expect(chainProblem(def({}))).toBeNull();
  });

  test("a gap, an overlap, a backwards step and a bump with no step are rejected", () => {
    expect(chainProblem(def({ storeVersion: 4, migrateFrom: [step(1), step(3)] }))).toContain("no migration from version 2");
    expect(chainProblem(def({ storeVersion: 2, migrateFrom: [step(1), step(1)] }))).toContain("two migrations from version 1");
    expect(chainProblem(def({ storeVersion: 2, migrateFrom: [step(1), step(2)] }))).toContain("not below storeVersion 2");
    expect(chainProblem(def({ storeVersion: 3, migrateFrom: [step(1)] }))).toContain("no migration from version 2 to 3");
    expect(chainProblem(def({ storeVersion: 2 }))).toContain("with no migration");
  });
});

describe("runChain", () => {
  const d = def({ storeVersion: 3, migrateFrom: [step(1, (v) => ({ ...(v as object), a: 1 })), step(2, (v) => ({ ...(v as object), b: 2 }))] });

  test("runs every step from the stored version up to storeVersion", () => {
    expect(runChain(d, {}, 1)).toEqual({ ok: true, value: { a: 1, b: 2 } });
    expect(runChain(d, {}, 2)).toEqual({ ok: true, value: { b: 2 } });
    expect(runChain(d, { z: 0 }, 3)).toEqual({ ok: true, value: { z: 0 } });
  });

  test("a throwing step is named", () => {
    const bad = def({ storeVersion: 2, migrateFrom: [step(1, () => { throw new Error("boom"); })] });
    expect(runChain(bad, {}, 1)).toEqual({ ok: false, message: "migration 1 -> 2 threw: boom" });
  });

  test("a step that mutates its input leaves the caller's value alone", () => {
    const mutating = def({ storeVersion: 2, migrateFrom: [step(1, (v) => { (v as Record<string, unknown>).x = 9; return v; })] });
    const authored = { x: 1 };
    expect(runChain(mutating, authored, 1)).toEqual({ ok: true, value: { x: 9 } });
    expect(authored).toEqual({ x: 1 });
  });
});

describe("migration helpers", () => {
  test("renameProperty walks array items and leaves items without the property alone", () => {
    expect(renameProperty([{ pattern: "a", x: 1 }, { x: 2 }], ["[]"], "pattern", "match")).toEqual([{ x: 1, match: "a" }, { x: 2 }]);
  });

  test("deleteProperty walks record values", () => {
    expect(deleteProperty({ a: { keep: 1, drop: 2 }, b: { keep: 3 } }, ["{}"], "drop")).toEqual({ a: { keep: 1 }, b: { keep: 3 } });
  });

  test("setDefault fills only a missing property and ignores a missing parent", () => {
    expect(setDefault({ inner: { a: 1 } }, ["inner"], "b", 2)).toEqual({ inner: { a: 1, b: 2 } });
    expect(setDefault({ inner: { b: 5 } }, ["inner"], "b", 2)).toEqual({ inner: { b: 5 } });
    expect(setDefault({}, ["inner"], "b", 2)).toEqual({});
  });

  test("helpers never mutate their input", () => {
    const input = [{ pattern: "a" }];
    renameProperty(input, ["[]"], "pattern", "match");
    expect(input).toEqual([{ pattern: "a" }]);
  });
});
```

Add to `packages/rt-client/src/settings/__tests__/registry.test.ts` (extend its existing `registry-machinery.ts` import with `isRetiredKey`, and add the two new imports):

```ts
import { chainProblem } from "../migrate.ts";
import { MIGRATION_STEPS, RENAMES } from "../migrations/index.ts";

describe("migrations in the registry", () => {
  test("every def's migration chain is unbroken up to its storeVersion", () => {
    expect(allDefs().map(chainProblem).filter((p) => p !== null)).toEqual([]);
  });

  test("no registered key can be mistaken for a versioned store name or store metadata", () => {
    expect(allDefs().map((d) => d.key).filter((k) => k.includes("@") || k.startsWith("$"))).toEqual([]);
  });

  test("every migration step belongs to a registered key or a key one was renamed from", () => {
    const owners = new Set([...allDefs().map((d) => d.key), ...Object.values(RENAMES).flat()]);
    expect(MIGRATION_STEPS.map((s) => s.key).filter((k) => !owners.has(k))).toEqual([]);
  });

  test("a renamed key is neither registered nor retired", () => {
    for (const old of Object.values(RENAMES).flat()) {
      expect(getDef(old)).toBeUndefined();
      expect(isRetiredKey(old)).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/migrate.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: FAIL, `Cannot find module '../migrate.ts'` (and `../migrations/index.ts`).

- [ ] **Step 4: Add the helpers and the (empty) step registry**

Create `packages/rt-client/src/settings/migrations/helpers.ts`:

```ts
/**
 * Building blocks for migration steps, drafted or hand-written. A path
 * segment "[]" walks every array item and "{}" every record value. A node
 * that is missing or not an object is returned unchanged, so a partial
 * deep-merge layer stays partial. Inputs are never mutated.
 */

export type MigrationPath = string[];

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapAt(value: unknown, path: MigrationPath, fn: (obj: Record<string, unknown>) => Record<string, unknown>): unknown {
  if (path.length === 0) return isObject(value) ? fn(value) : value;
  const [head, ...rest] = path as [string, ...string[]];
  if (head === "[]") return Array.isArray(value) ? value.map((item) => mapAt(item, rest, fn)) : value;
  if (!isObject(value)) return value;
  if (head === "{}") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapAt(v, rest, fn)]));
  return head in value ? { ...value, [head]: mapAt(value[head], rest, fn) } : value;
}

export function renameProperty(value: unknown, path: MigrationPath, from: string, to: string): unknown {
  return mapAt(value, path, (obj) => {
    if (!(from in obj)) return obj;
    const { [from]: moved, ...rest } = obj;
    return { ...rest, [to]: moved };
  });
}

export function deleteProperty(value: unknown, path: MigrationPath, name: string): unknown {
  return mapAt(value, path, (obj) => {
    if (!(name in obj)) return obj;
    const { [name]: _dropped, ...rest } = obj;
    return rest;
  });
}

export function setDefault(value: unknown, path: MigrationPath, name: string, fallback: unknown): unknown {
  return mapAt(value, path, (obj) => (name in obj ? obj : { ...obj, [name]: structuredClone(fallback) }));
}
```

Create `packages/rt-client/src/settings/migrations/index.ts`:

```ts
/**
 * Registered settings migrations. A step reads a key's stored value at
 * `version` and returns it at `version + 1`; a key's steps must form one
 * unbroken chain ending at its storeVersion (registry.test.ts). A key in
 * RENAMES reads the old keys' store names as older versions of itself, and
 * steps filed under an old key continue its chain. Each step's source
 * schema lives in schemas.ts (authoring only). `rt settings schema diff
 * --draft` inserts entries directly above the two @draft markers; keep
 * them.
 */

import type { MigrationStep } from "../registry-machinery.ts";
import { deleteProperty, renameProperty, setDefault } from "./helpers.ts";

export interface KeyedMigrationStep extends MigrationStep {
  key: string;
}

export const MIGRATION_STEPS: KeyedMigrationStep[] = [
  // @draft-steps
];

export const RENAMES: Record<string, string[]> = {
  // @draft-renames
};

```

(The helper imports are unused until a step is drafted; `noUnusedLocals` is off in this repo.)

- [ ] **Step 5: Attach steps and renames to the defs**

In `packages/rt-client/src/settings/registry-machinery.ts`, add the import beside the others:

```ts
import { MIGRATION_STEPS, RENAMES } from "./migrations/index.ts";
```

Add above `export interface SettingDef`:

```ts
/** One link of a key's migration chain: reads the value at `version`, returns it at `version + 1`. */
export interface MigrationStep {
  version: number;
  up: (value: unknown) => unknown;
}
```

Add to `SettingDef`, after `storeVersion`:

```ts
  /** Steps from each older readable version, ascending; the last reaches storeVersion. */
  migrateFrom?: MigrationStep[];
  /** Keys whose store names hold older versions of this key. */
  renamedFrom?: string[];
```

Add after `attachSchemas`, and change the `DEFS` line:

```ts
function attachMigrations(def: SettingDef): SettingDef {
  const renamedFrom = RENAMES[def.key];
  const owners = new Set([def.key, ...(renamedFrom ?? [])]);
  const steps = MIGRATION_STEPS.filter((s) => owners.has(s.key))
    .map(({ version, up }) => ({ version, up }))
    .sort((a, b) => a.version - b.version);
  if (steps.length === 0 && renamedFrom === undefined) return def;
  return { ...def, ...(steps.length > 0 ? { migrateFrom: steps } : {}), ...(renamedFrom ? { renamedFrom: [...renamedFrom] } : {}) };
}

const DEFS: readonly SettingDef[] = attachSchemas(REGISTRY).map(attachMigrations);
```

- [ ] **Step 6: Write `migrate.ts` (names and chain)**

Create `packages/rt-client/src/settings/migrate.ts`:

```ts
/**
 * Versioned store names and the migration chain. A key's value lives under
 * `key` at storeVersion 1 and `key@N` above it, so an older rt-client keeps
 * reading the name it knows and never meets a shape it cannot parse. Pure:
 * no file IO; callers hand in store sections.
 */

import { allDefs, getDef, isRetiredKey, type SettingDef } from "./registry-machinery.ts";

export const MIGRATED_PROP = "$migrated";

export function storeNameFor(key: string, version: number): string {
  return version <= 1 ? key : `${key}@${version}`;
}

export function currentStoreName(def: SettingDef): string {
  return storeNameFor(def.key, def.storeVersion ?? 1);
}

const VERSIONED = /^(.+)@([1-9]\d*)$/;

export function parseStoreName(name: string): { key: string; version: number } {
  const m = VERSIONED.exec(name);
  return m ? { key: m[1]!, version: Number(m[2]) } : { key: name, version: 1 };
}

/** The def whose renamedFrom lists `key`. Not cached: tests mutate live defs. */
export function renamedHeir(key: string): SettingDef | undefined {
  return allDefs().find((d) => d.renamedFrom?.includes(key));
}

export interface OlderStoreName {
  name: string;
  version: number;
}

/**
 * Every older name a reader of `def` can migrate from, highest version
 * first; at one version the key's own name precedes renamed keys' names. A
 * version with no step is unreadable and absent, except the current version
 * under a renamed key's name, which needs no step.
 */
export function olderStoreNames(def: SettingDef): OlderStoreName[] {
  const sv = def.storeVersion ?? 1;
  const renamed = def.renamedFrom ?? [];
  const stepVersions = (def.migrateFrom ?? []).map((s) => s.version).filter((v) => v < sv);
  const versions = [...new Set([sv, ...stepVersions])].sort((a, b) => b - a);
  const out: OlderStoreName[] = [];
  for (const v of versions) {
    for (const key of v === sv ? renamed : [def.key, ...renamed]) out.push({ name: storeNameFor(key, v), version: v });
  }
  return out;
}

export type StoreNameStatus = "metadata" | "current" | "older" | "newer" | "retired" | "unknown";

export function storeNameStatus(name: string): StoreNameStatus {
  if (name.startsWith("$")) return "metadata";
  const { key, version } = parseStoreName(name);
  if (storeNameFor(key, version) !== name) return "unknown";
  const def = getDef(key);
  if (def) {
    const sv = def.storeVersion ?? 1;
    return version === sv ? "current" : version > sv ? "newer" : "older";
  }
  const heir = renamedHeir(key);
  if (heir) return version > (heir.storeVersion ?? 1) ? "newer" : "older";
  return isRetiredKey(key) ? "retired" : "unknown";
}

/** Null when `def`'s steps form one unbroken chain ending at its storeVersion. */
export function chainProblem(def: SettingDef): string | null {
  const sv = def.storeVersion ?? 1;
  const versions = (def.migrateFrom ?? []).map((s) => s.version).sort((a, b) => a - b);
  if (versions.length === 0) return sv > 1 ? `${def.key}: storeVersion ${sv} with no migration to it` : null;
  for (let i = 1; i < versions.length; i++) {
    if (versions[i] === versions[i - 1]) return `${def.key}: two migrations from version ${versions[i]}`;
  }
  const top = versions.at(-1)!;
  if (top >= sv) return `${def.key}: a migration from version ${top} is not below storeVersion ${sv}`;
  if (top !== sv - 1) return `${def.key}: no migration from version ${sv - 1} to ${sv}`;
  for (let i = 1; i < versions.length; i++) {
    if (versions[i] !== versions[i - 1]! + 1) return `${def.key}: no migration from version ${versions[i - 1]! + 1}`;
  }
  if (versions[0]! < 1) return `${def.key}: a migration from version ${versions[0]}; versions start at 1`;
  return null;
}

export type ChainResult = { ok: true; value: unknown } | { ok: false; message: string };

/** Runs every step from `fromVersion` up to storeVersion on a copy of `value`. */
export function runChain(def: SettingDef, value: unknown, fromVersion: number): ChainResult {
  const sv = def.storeVersion ?? 1;
  let current = structuredClone(value);
  for (let v = fromVersion; v < sv; v++) {
    const step = def.migrateFrom?.find((s) => s.version === v);
    if (!step) return { ok: false, message: `no migration from version ${v}` };
    try {
      current = step.up(current);
    } catch (err) {
      return { ok: false, message: `migration ${v} -> ${v + 1} threw: ${(err as Error).message}` };
    }
  }
  return { ok: true, value: current };
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/migrate.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts`
Expected: PASS.

- [ ] **Step 8: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/migrate.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts packages/rt-client/test`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0 (`packages/rt-client/test` holds `no-zod-in-dist.test.ts` and `dist-freshness.test.ts`; run the build before them if dist-freshness fails, then rerun).

- [ ] **Step 9: Commit**

```bash
git add packages/rt-client/src/settings/migrate.ts packages/rt-client/src/settings/migrations packages/rt-client/src/settings/registry-machinery.ts packages/rt-client/src/settings/__tests__/with-migration.ts packages/rt-client/src/settings/__tests__/migrate.test.ts packages/rt-client/src/settings/__tests__/registry.test.ts
git commit -m "feat(settings): versioned store names and migration chains on the def

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Reading one section: in-memory migration, labels, baselines

**Files:**
- Modify: `packages/rt-client/src/settings/migrate.ts`
- Create: `packages/rt-client/src/settings/__tests__/migrate-section.test.ts`

**Interfaces:**
- Consumes: Task 1's `currentStoreName`, `olderStoreNames`, `runChain`, `ChainResult`, `MIGRATED_PROP`; plan 1's `checkSchema(def, value, { layer })`, `firstIssueText`.
- Produces (all in `migrate.ts`):
  - `canonicalJson(value): string`; `valueHash(value): string` (`"sha256:" + 16 hex`)
  - `type OlderLabel = "leftover" | "stale" | "diverged"`
  - `interface OlderNameRead { storeName: string; storedVersion: number; label: OlderLabel; value: unknown; authored: unknown; migrationError?: string }` (`value` migrated to the current shape, or the authored value when migration failed)
  - `interface SectionRead { present: boolean; storeName?: string; storedVersion?: number; value?: unknown; authored?: unknown; migrationError?: string; older: OlderNameRead[] }`
  - `readSection(def, section: Record<string, unknown> | undefined, opts: { layer: boolean }): SectionRead`
  - `worstLabel(older: OlderNameRead[]): OlderLabel | undefined`
  - `baselinesOf(section): Record<string, unknown>` (the section's `$migrated` map, `{}` when absent or not an object)
  - `baselinesToRecord(def, section): Record<string, string>` (older name to hash, only when the current name is absent, only for present older names with no baseline)

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/migrate-section.test.ts`:

```ts
/**
 * migrate.ts, one section: the current name wins, else the highest older
 * name is migrated in memory; older names beside a current one are labeled
 * leftover, stale or diverged against the $migrated baselines. Pure:
 * synthetic defs and plain section objects.
 */

import { describe, expect, test } from "bun:test";
import type { SettingDef } from "../registry-machinery.ts";
import { baselinesToRecord, canonicalJson, readSection, valueHash, worstLabel, type OlderNameRead } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";

const def = (over: Partial<SettingDef>): SettingDef => ({ key: "t.k", type: "array", scopes: ["user"], merge: "replace", description: "test", ...over });

const SCHEMA_V2 = { type: "array", items: { type: "object", properties: { match: { type: "string" } }, required: ["match"] } };
const renameStep = { version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") };
const d = def({ storeVersion: 2, migrateFrom: [renameStep], schema: SCHEMA_V2 });

const V1 = [{ pattern: "gate/*" }];
const V2 = [{ match: "gate/*" }];
const V2_EDITED = [{ match: "herd/*" }];
const LAYER = { layer: true };

describe("readSection", () => {
  test("an absent section, or one without any name of the key, is not present", () => {
    expect(readSection(d, undefined, LAYER)).toEqual({ present: false, older: [] });
    expect(readSection(d, { "t.other": 1 }, LAYER)).toEqual({ present: false, older: [] });
  });

  test("the current name wins and carries no labels when alone", () => {
    expect(readSection(d, { "t.k@2": V2 }, LAYER)).toEqual({ present: true, storeName: "t.k@2", storedVersion: 2, value: V2, authored: V2, older: [] });
  });

  test("with the current name absent, the highest older name is migrated in memory", () => {
    expect(readSection(d, { "t.k": V1 }, LAYER)).toEqual({ present: true, storeName: "t.k", storedVersion: 1, value: V2, authored: V1, older: [] });
  });

  test("leftover: an older name whose migrated value equals the current value", () => {
    const older = readSection(d, { "t.k": V1, "t.k@2": V2 }, LAYER).older;
    expect(older).toEqual([{ storeName: "t.k", storedVersion: 1, label: "leftover", value: V2, authored: V1 }]);
  });

  test("stale: it differs, and its baseline matches its authored value", () => {
    const older = readSection(d, { "t.k": V1, "t.k@2": V2_EDITED, $migrated: { "t.k": valueHash(V1) } }, LAYER).older;
    expect(older[0]).toMatchObject({ label: "stale", value: V2, authored: V1 });
  });

  test("diverged: it differs and has no baseline, or a baseline that no longer matches", () => {
    expect(readSection(d, { "t.k": V1, "t.k@2": V2_EDITED }, LAYER).older[0]?.label).toBe("diverged");
    const edited = readSection(d, { "t.k": V1, "t.k@2": V2_EDITED, $migrated: { "t.k": valueHash([{ pattern: "old/*" }]) } }, LAYER);
    expect(edited.older[0]?.label).toBe("diverged");
  });

  test("two older names are labeled independently and the worst label wins", () => {
    const d3 = def({ storeVersion: 3, migrateFrom: [renameStep, { version: 2, up: (v) => v }], schema: SCHEMA_V2 });
    const read = readSection(d3, { "t.k": V1, "t.k@2": V2_EDITED, "t.k@3": V2 }, LAYER);
    expect(read.older.map((o) => [o.storeName, o.label])).toEqual([["t.k@2", "diverged"], ["t.k", "leftover"]]);
    expect(worstLabel(read.older)).toBe("diverged");
    const labels = (ls: OlderNameRead["label"][]) => ls.map((label) => ({ label }) as OlderNameRead);
    expect(worstLabel(labels(["leftover", "stale"]))).toBe("stale");
    expect(worstLabel([])).toBeUndefined();
  });

  test("a throwing step keeps the stored value in effect and names the step", () => {
    const bad = def({ storeVersion: 2, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }], schema: SCHEMA_V2 });
    expect(readSection(bad, { "t.k": V1 }, LAYER)).toMatchObject({ value: V1, authored: V1, migrationError: "migration 1 -> 2 threw: boom" });
  });

  test("a migrated value that fails the schema keeps the stored value in effect", () => {
    const wrong = def({ storeVersion: 2, migrateFrom: [{ version: 1, up: (v) => v }], schema: SCHEMA_V2 });
    const read = readSection(wrong, { "t.k": V1 }, LAYER);
    expect(read.value).toEqual(V1);
    expect(read.migrationError).toBe('migration 1 -> 2 gives a value that fails the schema: [0].match: required property "match" is missing');
  });

  test("a deep layer stays partial: the layer schema judges a migrated layer", () => {
    const deep = def({
      type: "object",
      merge: "deep",
      storeVersion: 2,
      migrateFrom: [{ version: 1, up: (v) => renameProperty(v, [], "on", "enabled") }],
      schema: { type: "object", properties: { enabled: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["enabled", "debounceSec"] },
    });
    expect(readSection(deep, { "t.k": { on: true } }, { layer: true })).toMatchObject({ value: { enabled: true } });
    expect(readSection(deep, { "t.k": { on: true } }, { layer: true }).migrationError).toBeUndefined();
    expect(readSection(deep, { "t.k": { on: true } }, { layer: false }).migrationError).toContain("debounceSec");
  });

  test("a renamed key's name at the heir's version needs no step; older ones continue the chain", () => {
    expect(readSection(def({ renamedFrom: ["t.old"] }), { "t.old": [{ a: 1 }] }, LAYER)).toMatchObject({ storeName: "t.old", storedVersion: 1, value: [{ a: 1 }] });
    const heir = def({ storeVersion: 2, migrateFrom: [renameStep], renamedFrom: ["t.old"], schema: SCHEMA_V2 });
    expect(readSection(heir, { "t.old": V1 }, LAYER)).toMatchObject({ storeName: "t.old", value: V2 });
  });

  test("a step that mutates its input disturbs neither the authored value nor the label", () => {
    const mutating = def({
      storeVersion: 2,
      schema: SCHEMA_V2,
      migrateFrom: [{ version: 1, up: (v) => { for (const item of v as Record<string, unknown>[]) { item.match = item.pattern; delete item.pattern; } return v; } }],
    });
    const read = readSection(mutating, { "t.k": [{ pattern: "gate/*" }], "t.k@2": V2_EDITED, $migrated: { "t.k": valueHash(V1) } }, LAYER);
    expect(read.older[0]).toMatchObject({ label: "stale", authored: V1 });
  });
});

describe("hashing and baselines", () => {
  test("canonical JSON ignores key order; a hash is sha256: plus 16 hex", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(valueHash({ a: 1, b: 2 })).toBe(valueHash({ b: 2, a: 1 }));
    expect(valueHash([1])).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  test("the first write of the current name records a baseline for each present older name without one", () => {
    expect(baselinesToRecord(d, { "t.k": V1 })).toEqual({ "t.k": valueHash(V1) });
    expect(baselinesToRecord(d, { "t.k": V1, $migrated: { "t.k": "sha256:0000000000000000" } })).toEqual({});
    expect(baselinesToRecord(d, { "t.k": V1, "t.k@2": V2 })).toEqual({});
    expect(baselinesToRecord(d, {})).toEqual({});
    expect(baselinesToRecord(d, undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/migrate-section.test.ts`
Expected: FAIL, `readSection` (and the other new names) not exported from `../migrate.ts`.

- [ ] **Step 3: Implement**

In `packages/rt-client/src/settings/migrate.ts`, add to the imports:

```ts
import { createHash } from "crypto";
import { checkSchema, firstIssueText } from "./schema.ts";
```

Append:

```ts
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map((k) => [k, sortKeys(obj[k])]));
  }
  return value;
}

export function valueHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16)}`;
}

export type OlderLabel = "leftover" | "stale" | "diverged";

export interface OlderNameRead {
  storeName: string;
  storedVersion: number;
  label: OlderLabel;
  /** Migrated to the current shape; the authored value when migration failed. */
  value: unknown;
  authored: unknown;
  migrationError?: string;
}

export interface SectionRead {
  present: boolean;
  storeName?: string;
  storedVersion?: number;
  /** In the current shape, unless migration failed: then the value as stored. */
  value?: unknown;
  authored?: unknown;
  migrationError?: string;
  /** Older names beside a present current name, each labeled; empty otherwise. */
  older: OlderNameRead[];
}

export function baselinesOf(section: Record<string, unknown> | undefined): Record<string, unknown> {
  const m = section?.[MIGRATED_PROP];
  return m !== null && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

function migrate(def: SettingDef, authored: unknown, fromVersion: number, layer: boolean): ChainResult {
  const sv = def.storeVersion ?? 1;
  if (fromVersion >= sv) return { ok: true, value: authored };
  const out = runChain(def, authored, fromVersion);
  if (!out.ok) return out;
  const issues = checkSchema(def, out.value, { layer });
  return issues.length === 0
    ? out
    : { ok: false, message: `migration ${fromVersion} -> ${sv} gives a value that fails the schema: ${firstIssueText(issues)}` };
}

function labelOlder(def: SettingDef, older: OlderStoreName, authored: unknown, current: unknown, baseline: unknown, layer: boolean): OlderNameRead {
  const migrated = migrate(def, authored, older.version, layer);
  const value = migrated.ok ? migrated.value : authored;
  const label: OlderLabel =
    migrated.ok && canonicalJson(value) === canonicalJson(current) ? "leftover" : baseline === valueHash(authored) ? "stale" : "diverged";
  const read: OlderNameRead = { storeName: older.name, storedVersion: older.version, label, value, authored };
  if (!migrated.ok) read.migrationError = migrated.message;
  return read;
}

/**
 * The key's value in one store section. `layer` picks the schema a
 * migrated value must pass: a deep-merge store value is one partial layer.
 */
export function readSection(def: SettingDef, section: Record<string, unknown> | undefined, opts: { layer: boolean }): SectionRead {
  if (!section) return { present: false, older: [] };
  const found = olderStoreNames(def).filter((o) => section[o.name] !== undefined);
  const current = currentStoreName(def);
  if (section[current] !== undefined) {
    const value = section[current];
    const baselines = baselinesOf(section);
    const older = found.map((o) => labelOlder(def, o, section[o.name], value, baselines[o.name], opts.layer));
    return { present: true, storeName: current, storedVersion: def.storeVersion ?? 1, value, authored: value, older };
  }
  const top = found[0];
  if (!top) return { present: false, older: [] };
  const authored = section[top.name];
  const migrated = migrate(def, authored, top.version, opts.layer);
  const read: SectionRead = { present: true, storeName: top.name, storedVersion: top.version, value: migrated.ok ? migrated.value : authored, authored, older: [] };
  if (!migrated.ok) read.migrationError = migrated.message;
  return read;
}

const RANK: Record<OlderLabel, number> = { leftover: 0, stale: 1, diverged: 2 };

export function worstLabel(older: OlderNameRead[]): OlderLabel | undefined {
  let worst: OlderLabel | undefined;
  for (const o of older) if (worst === undefined || RANK[o.label] > RANK[worst]) worst = o.label;
  return worst;
}

/**
 * The baselines a write of the current name records: only when the current
 * name is absent from the section, and only for present older names that
 * have none, so a name already diverged from an earlier bump stays so.
 */
export function baselinesToRecord(def: SettingDef, section: Record<string, unknown> | undefined): Record<string, string> {
  if (!section || section[currentStoreName(def)] !== undefined) return {};
  const existing = baselinesOf(section);
  const out: Record<string, string> = {};
  for (const o of olderStoreNames(def)) {
    if (section[o.name] === undefined || existing[o.name] !== undefined) continue;
    out[o.name] = valueHash(section[o.name]);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/migrate-section.test.ts packages/rt-client/src/settings/__tests__/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/migrate-section.test.ts packages/rt-client/src/settings/__tests__/migrate.test.ts`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src/settings/migrate.ts packages/rt-client/src/settings/__tests__/migrate-section.test.ts
git commit -m "feat(settings): read a section through its migration chain and label older names

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The resolver reads versioned names

**Files:**
- Modify: `packages/rt-client/src/settings/resolve.ts`
- Modify: `packages/rt-client/src/index.ts` (settings exports)
- Create: `packages/rt-client/src/settings/__tests__/resolve-migrations.test.ts`

**Interfaces:**
- Consumes: Task 2's `readSection`, `worstLabel`, `SectionRead`, `OlderNameRead`, `OlderLabel`; Task 1's `currentStoreName`, `storeNameStatus`.
- Produces:
  - `ExplainRow` gains `storeName?: string`, `storedVersion?: number`, `authored?: unknown` (all three on every present store row, never on the `default` row), `olderNames?: OlderNameRead[]`, `olderLabel?: OlderLabel`. `value` is now the migrated value. A migration failure is the first `nonconforming` issue: `{ path: [], message: <migrationError> }`.
  - `ListedSetting` gains `diverged?: { scope: Scope; file: string | null; storeNames: string[] }[]` and `newer?: true` (an unregistered row written by a newer rt).
  - `listUnregisteredSettings()` entries gain `newer?: true`; names with status `metadata`, `current`, `older` or `retired` are never listed.
  - `mergedValueWith` patches the current store name; `repoSectionsFor` counts any readable name of the key.
  - `packages/rt-client/src/index.ts` exports `readSection`, `currentStoreName`, `olderStoreNames`, `storeNameStatus`, `worstLabel`, `valueHash`, `MIGRATED_PROP` and the types `SectionRead`, `OlderNameRead`, `OlderLabel`, `StoreNameStatus`, `MigrationStep`.

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/resolve-migrations.test.ts`:

```ts
/**
 * The resolver over versioned store names: an older name is migrated in
 * memory, a current name wins and labels the older names beside it, a name
 * from a newer rt is skipped and reported, $migrated is never a key. Same
 * HOME-per-test isolation as resolve.test.ts.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { teamSettingsPath, userSettingsPath } from "../paths.ts";
import { getDef, type MigrationStep, type SettingDef } from "../registry-machinery.ts";
import { valueHash } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { explainSetting, getSetting, listSettings, listUnregisteredSettings, mergedValueWith, repoSectionsFor } from "../resolve.ts";
import { withMigration } from "./with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";
const EB = "rt.notify.eventBridges";

const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2_EDITED = [{ match: "herd/*", category: "herd", title: "Herd", message: "{summary}" }];
const EB_SCHEMA_V2 = {
  type: "array",
  items: {
    type: "object",
    properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
    required: ["match", "category", "title", "message"],
  },
};
const ebRename: MigrationStep = { version: 1, up: (v) => renameProperty(v, ["[]"], "pattern", "match") };
const EB_BUMP = { storeVersion: 2, migrateFrom: [ebRename], schema: EB_SCHEMA_V2 };

const ROLES_SCHEMA_V2 = { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } };
const ROLES_BUMP = { storeVersion: 2, migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }], schema: ROLES_SCHEMA_V2 };

describe("settings/resolve over versioned store names", () => {
  const origHome = process.env.HOME;
  let home: string;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-resolve-mig-")));
    process.env.HOME = home;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }
  const writeUser = (obj: unknown) => write(userSettingsPath(), obj);
  const writeTeam = (name: string, obj: unknown) => write(teamSettingsPath(name), obj);
  const userRow = (key: string) => explainSetting(key).find((r) => r.scope === "user")!;

  test("a store holding only the old name reads in the new shape, and explain shows both", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1 });
      expect(getSetting(EB).value).toEqual(EB_V2);
      const row = userRow(EB);
      expect(row).toMatchObject({ present: true, storeName: EB, storedVersion: 1, value: EB_V2, authored: EB_V1 });
      expect(row.olderNames).toBeUndefined();
      expect(row.nonconforming).toBeUndefined();
    });
  });

  test("every present store row names its store name; the default row does not", () => {
    writeUser({ [EB]: EB_V1 });
    const rows = explainSetting(EB);
    expect(rows.find((r) => r.scope === "user")).toMatchObject({ storeName: EB, storedVersion: 1, authored: EB_V1 });
    expect("storeName" in rows.find((r) => r.scope === "default")!).toBe(false);
  });

  test("the current name wins; an older name beside it is labeled leftover", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      expect(getSetting(EB).value).toEqual(EB_V2);
      const row = userRow(EB);
      expect(row).toMatchObject({ storeName: `${EB}@2`, storedVersion: 2, olderLabel: "leftover" });
      expect(row.olderNames).toEqual([{ storeName: EB, storedVersion: 1, label: "leftover", value: EB_V2, authored: EB_V1 }]);
    });
  });

  test("stale and diverged older names carry both values on the row", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(userRow(EB).olderLabel).toBe("stale");
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const row = userRow(EB);
      expect(row.olderLabel).toBe("diverged");
      expect(row.value).toEqual(EB_V2_EDITED);
      expect(row.olderNames?.[0]).toMatchObject({ storeName: EB, label: "diverged", value: EB_V2 });
    });
  });

  test("a failing step keeps the stored value in effect, labeled nonconforming with the step named", () => {
    withMigration(EB, { ...EB_BUMP, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }, () => {
      writeUser({ [EB]: EB_V1 });
      expect(getSetting(EB).value).toEqual(EB_V1);
      expect(userRow(EB).nonconforming?.[0]).toEqual({ path: [], message: "migration 1 -> 2 threw: boom" });
    });
  });

  test("a name above this rt's storeVersion is skipped and reported as newer, never read", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@3`]: [{ anything: 1 }] });
      expect(getSetting(EB).value).toEqual(EB_V2);
      const listed = listUnregisteredSettings();
      expect(listed).toContainEqual({ key: `${EB}@3`, scope: "user", file: userSettingsPath(), newer: true });
      expect(listed.map((u) => u.key)).not.toContain(EB);
      expect(listSettings().find((s) => s.key === `${EB}@3`)).toMatchObject({ unregistered: true, newer: true });
    });
  });

  test("older names at or below storeVersion are never unregistered", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      expect(listUnregisteredSettings()).toEqual([]);
    });
  });

  test("$migrated is never resolved or reported, globally or in a repo section", () => {
    writeUser({ $migrated: { [EB]: "sha256:0000000000000000" }, repos: { [IDENTITY]: { $migrated: {} } } });
    expect(listUnregisteredSettings()).toEqual([]);
    expect(listSettings().filter((s) => s.unregistered).map((s) => s.key)).toEqual([]);
  });

  test("a repo section reads, labels and reports a diverged older name on its repo rung", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./other.sh" } } } } });
      const row = explainSetting("rt.roles", { repoIdentity: IDENTITY }).find((r) => r.scope === "team.repo")!;
      expect(row.olderLabel).toBe("diverged");
      expect(row.olderNames?.[0]).toMatchObject({ storeName: "rt.roles", value: { web: { devHook: "./dev.sh" } } });
      expect(repoSectionsFor("rt.roles")).toContainEqual({ identity: IDENTITY, scopes: ["team"] });
    });
  });

  test("repoSectionsFor counts a section holding only the versioned current name", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.roles@2": { web: { devHook: "./dev.sh" } } } } });
      expect(repoSectionsFor("rt.roles")).toContainEqual({ identity: IDENTITY, scopes: ["team"] });
    });
  });

  test("listSettings flags a diverged layer", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      expect(listSettings().find((s) => s.key === EB)?.diverged).toEqual([{ scope: "user", file: userSettingsPath(), storeNames: [EB] }]);
    });
  });

  test("mergedValueWith patches the current store name, which then wins", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [`${EB}@2`]: EB_V2 });
      expect(mergedValueWith(getDef(EB) as SettingDef, { scope: "user", value: EB_V2_EDITED })).toEqual(EB_V2_EDITED);
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve-migrations.test.ts`
Expected: FAIL (the migrated read returns `EB_V1`-shaped values; `storeName` is undefined).

- [ ] **Step 3: Read slots through `readSection`**

In `packages/rt-client/src/settings/resolve.ts`, add the import:

```ts
import { currentStoreName, readSection, storeNameStatus, worstLabel, type OlderLabel, type OlderNameRead, type SectionRead } from "./migrate.ts";
```

Add to `ExplainRow`, after `nonconforming`:

```ts
  /** The property the value was read from (`key` or `key@N`); present store rows only. */
  storeName?: string;
  storedVersion?: number;
  /** The value as stored; `value` is it migrated to the current shape. */
  authored?: unknown;
  /** Older names beside the current one in the same section, each labeled. */
  olderNames?: OlderNameRead[];
  /** The worst of `olderNames`' labels. */
  olderLabel?: OlderLabel;
```

Add to `ListedSetting`, after `mergedIssues`:

```ts
  /** Layers where an older store name was changed after the current one was written. */
  diverged?: { scope: Scope; file: string | null; storeNames: string[] }[];
  /** An unregistered row whose name a newer rt writes (`key@N` above this rt's version). */
  newer?: true;
```

Add `read?: SectionRead;` to `interface Slot`, and replace `collectSlots`'s inner `push` with:

```ts
  const push = (scope: Scope, file: string | null, section: Record<string, unknown> | undefined) => {
    const read = readSection(def, section, { layer: true });
    if (!read.present) slots.push({ scope, file, present: false });
    else slots.push({ scope, file, present: true, value: read.value, read });
  };
```

In `resolveDef`, directly after `row.value = slot.value;` add:

```ts
    if (slot.read) {
      row.storeName = slot.read.storeName;
      row.storedVersion = slot.read.storedVersion;
      row.authored = slot.read.authored;
      if (slot.read.older.length > 0) {
        row.olderNames = slot.read.older;
        row.olderLabel = worstLabel(slot.read.older);
      }
    }
```

and replace the schema-labeling block:

```ts
    if (slot.scope !== "default") {
      const issues = checkSchema(def, slot.value, { layer: true });
      if (issues.length > 0) row.nonconforming = issues;
    }
```

with:

```ts
    if (slot.scope !== "default") {
      const failed = slot.read?.migrationError;
      const issues = [...(failed ? [{ path: [], message: failed }] : []), ...checkSchema(def, slot.value, { layer: true })];
      if (issues.length > 0) row.nonconforming = issues;
    }
```

- [ ] **Step 4: Listing, repo sections and the merge override**

In `listSettings`, after the `mergedIssues` line add:

```ts
    const diverged = resolution.rows
      .filter((r) => r.olderLabel === "diverged")
      .map((r) => ({ scope: r.scope, file: r.file, storeNames: r.olderNames!.filter((o) => o.label === "diverged").map((o) => o.storeName) }));
    if (diverged.length > 0) listed.diverged = diverged;
```

In `listUnregistered` (the private one `listSettings` calls), change the map value type to `Provenance & { value: unknown; newer: boolean }` and the scan loop body to:

```ts
    for (const [key, value] of Object.entries(section ?? {})) {
      const status = storeNameStatus(key);
      if (status !== "unknown" && status !== "newer") continue;
      found.set(key, { scope, file, value, newer: status === "newer" }); // later (stronger) scans win
    }
```

and in its final `.map`, put the existing `emitSettingsWarning(...)` call (the unregistered-setting warning, text unchanged) in the `else` branch of a check on `hit.newer`, and add the flag to the returned row:

```ts
    .map(([key, hit]) => {
      if (hit.newer) {
        emitSettingsWarning(`rt: "${key}" in ${hit.file} was written by a newer rt; ignoring it (this rt may be older than the store)`);
      } else {
        // the existing emitSettingsWarning(...) call for an unregistered setting stays here unchanged
      }
      return {
        key,
        value: hit.value,
        provenance: [{ scope: hit.scope, file: hit.file }],
        migrated: false,
        unregistered: true as const,
        ...(hit.newer ? { newer: true as const } : {}),
      };
    });
```

(Move the existing call into the `else` block in place of that comment line; do not retype its text.)

Replace `listUnregisteredSettings`'s return type and scan:

```ts
export function listUnregisteredSettings(): { key: string; scope: Scope; file: string; newer?: true }[] {
  const stores = readStores();
  const out: { key: string; scope: Scope; file: string; newer?: true }[] = [];
  const scan = (scope: Scope, file: string, section: Record<string, unknown> | undefined) => {
    for (const key of Object.keys(section ?? {})) {
      const status = storeNameStatus(key);
      if (status === "unknown") out.push({ key, scope, file });
      else if (status === "newer") out.push({ key, scope, file, newer: true });
    }
  };
```

(the rest of the function is unchanged).

In `repoSectionsFor`, replace `if (section[key] === undefined) continue;` with:

```ts
      const present = def ? readSection(def, section, { layer: true }).present : section[key] !== undefined;
      if (!present) continue;
```

and add `const def = getDef(key);` as the function's first line.

In `mergedValueWith`, replace both `[def.key]: override.value` occurrences with `[currentStoreName(def)]: override.value`.

- [ ] **Step 5: Export from the package**

In `packages/rt-client/src/index.ts`, after the `validate-write.ts` export lines, add:

```ts
export { readSection, currentStoreName, olderStoreNames, storeNameStatus, worstLabel, valueHash, MIGRATED_PROP } from "./settings/migrate.ts";
export type { SectionRead, OlderNameRead, OlderLabel, StoreNameStatus } from "./settings/migrate.ts";
```

and add `type MigrationStep` to the existing `registry-machinery.ts` type export line.

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/resolve-migrations.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/validate-write.test.ts`
Expected: PASS. If an existing `resolve.test.ts` assertion compares a whole present store row with `toEqual`, add the three new fields to its expected object (`storeName: <key>`, `storedVersion: 1`, `authored: <the same value>`); do not loosen it to `toMatchObject`.

- [ ] **Step 7: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/resolve-migrations.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/src/settings/__tests__/check.test.ts packages/rt-client/test`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/settings/resolve.ts packages/rt-client/src/index.ts packages/rt-client/src/settings/__tests__/resolve-migrations.test.ts packages/rt-client/src/settings/__tests__/resolve.test.ts
git commit -m "feat(settings): resolve versioned store names, label older names, report newer ones

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Writes land on the current name; unset and prune

**Files:**
- Modify: `packages/rt-client/src/settings/write.ts`
- Modify: `packages/rt-client/src/index.ts`
- Create: `packages/rt-client/src/settings/__tests__/write-migrations.test.ts`

**Interfaces:**
- Consumes: Task 2's `readSection`, `baselinesOf`, `baselinesToRecord`, `MIGRATED_PROP`; Task 1's `currentStoreName`, `olderStoreNames`.
- Produces:
  - `setSetting` writes `[...section, currentStoreName(def)]` and, in the same temp-then-rename write, one `$migrated.<older>` entry per name `baselinesToRecord` returns.
  - `unsetSetting` removes every present name of the key in the section (current and older) and the `$migrated` entries of the names it removes, dropping an emptied `$migrated`; it refuses (`rt: ... older store name edited after its current one ...`) when any older name there is `diverged`.
  - `interface PruneOpts extends SetSettingOpts { force?: boolean }`
  - `pruneStoreName(key: string, storeName: string, scope: SettingScope, opts?: PruneOpts): { removed: boolean; authored?: unknown }`: refuses an unknown key, a scope the def does not list, a repo on a non-repo-scoped key, a name that is not an older name of `key`, a section whose current name is absent, and a `diverged` name without `force`; removes the name and its baseline, dropping an emptied `$migrated`.
  - `packages/rt-client/src/index.ts` exports `pruneStoreName` and `type PruneOpts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/write-migrations.test.ts`:

```ts
/**
 * The write path over versioned store names: a write lands on the current
 * name, never touches an older one, and records baselines only on the first
 * write of the current name; unset removes every name; prune removes one
 * older name through its own path. HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { parse } from "jsonc-parser";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { userSettingsPath } from "../paths.ts";
import type { MigrationStep } from "../registry-machinery.ts";
import { valueHash } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { explainSetting, getSetting } from "../resolve.ts";
import { pruneStoreName, setSetting, unsetSetting } from "../write.ts";
import { withMigration } from "./with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const EB = "rt.notify.eventBridges";
const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2_EDITED = [{ match: "herd/*", category: "herd", title: "Herd", message: "{summary}" }];
const EB_SCHEMA_V2 = {
  type: "array",
  items: {
    type: "object",
    properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
    required: ["match", "category", "title", "message"],
  },
};
const ebRename: MigrationStep = { version: 1, up: (v) => renameProperty(v, ["[]"], "pattern", "match") };
const EB_BUMP = { storeVersion: 2, migrateFrom: [ebRename], schema: EB_SCHEMA_V2 };
const ROLES_BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }],
  schema: { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } },
};

const OLD_LINE = `  "${EB}": [{ "pattern": "gate/opened/*", "category": "gate", "title": "Gate", "message": "{question}" }],`;
// A property follows the old name: jsonc-parser's modify reformats the line of whatever property it appends after.
const OLD_TEXT = `// my notes\n{\n${OLD_LINE}\n  "rt.notifications": {}\n}\n`;

describe("settings/write over versioned store names", () => {
  const origHome = process.env.HOME;
  let home: string;
  let errSpy: ReturnType<typeof spyOn<Console, "error">>;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-write-mig-")));
    process.env.HOME = home;
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeText(text: string): void {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), text);
  }
  const writeUser = (obj: unknown) => writeText(JSON.stringify(obj, null, 2));
  const userText = () => readFileSync(userSettingsPath(), "utf8");
  const userRoot = () => parse(userText()) as Record<string, unknown>;
  const userRow = () => explainSetting(EB).find((r) => r.scope === "user")!;

  test("the first write of the current name leaves the old name byte for byte and records its baseline", () => {
    withMigration(EB, EB_BUMP, () => {
      writeText(OLD_TEXT);
      setSetting(EB, EB_V2_EDITED, "user");
      const text = userText();
      expect(text).toContain("// my notes");
      expect(text).toContain(OLD_LINE);
      const root = userRoot();
      expect(root[`${EB}@2`]).toEqual(EB_V2_EDITED);
      expect(root.$migrated).toEqual({ [EB]: valueHash(EB_V1) });
      expect(userRow().olderLabel).toBe("stale");
    });
  });

  test("later writes leave $migrated alone, so an old writer's edit reads diverged", () => {
    withMigration(EB, EB_BUMP, () => {
      writeText(OLD_TEXT);
      setSetting(EB, EB_V2, "user");
      const baseline = userRoot().$migrated;
      const root = userRoot();
      writeUser({ ...root, [EB]: [{ pattern: "edited/*", category: "c", title: "t", message: "m" }] });
      setSetting(EB, EB_V2_EDITED, "user");
      expect(userRoot().$migrated).toEqual(baseline);
      expect(userRow().olderLabel).toBe("diverged");
    });
  });

  test("a first write with no older name present records nothing", () => {
    withMigration(EB, EB_BUMP, () => {
      setSetting(EB, EB_V2, "user");
      expect(userRoot()).toEqual({ [`${EB}@2`]: EB_V2 });
    });
  });

  test("a name already carrying a baseline keeps it; only names without one get one", () => {
    withMigration(EB, { storeVersion: 3, migrateFrom: [ebRename, { version: 2, up: (v) => v }], schema: EB_SCHEMA_V2 }, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: "sha256:0000000000000000" } });
      setSetting(EB, EB_V2_EDITED, "user");
      expect(userRoot().$migrated).toEqual({ [EB]: "sha256:0000000000000000", [`${EB}@2`]: valueHash(EB_V2) });
    });
  });

  test("a repo-section write lands in that section with its own baseline and leaves the global section alone", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeUser({ repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } } } } });
      setSetting("rt.roles", { web: { devHook: "./dev.sh" } }, "user", { repoIdentity: IDENTITY });
      const root = userRoot();
      const section = (root.repos as Record<string, Record<string, unknown>>)[IDENTITY]!;
      expect(section["rt.roles"]).toEqual({ web: { hook: "./dev.sh" } });
      expect(section["rt.roles@2"]).toEqual({ web: { devHook: "./dev.sh" } });
      expect(section.$migrated).toEqual({ "rt.roles": valueHash({ web: { hook: "./dev.sh" } }) });
      expect(root.$migrated).toBeUndefined();
    });
  });

  test("unset removes every name of the key and their baselines, so the key reads as unset", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(unsetSetting(EB, "user")).toBe(true);
      expect(userRoot()).toEqual({});
      expect(getSetting(EB).provenance).toEqual([{ scope: "default", file: null }]);
    });
  });

  test("unset of a store holding only the old name removes it", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, "rt.notifications": {} });
      expect(unsetSetting(EB, "user")).toBe(true);
      expect(userRoot()).toEqual({ "rt.notifications": {} });
    });
  });

  test("unset refuses while an older name is diverged, and changes nothing", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const before = userText();
      expect(() => unsetSetting(EB, "user")).toThrow("older store name edited after its current one");
      expect(userText()).toBe(before);
    });
  });

  test("prune removes a stale name and its baseline, dropping the emptied $migrated", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(pruneStoreName(EB, EB, "user")).toEqual({ removed: true, authored: EB_V1 });
      expect(userRoot()).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
    });
  });

  test("prune refuses a diverged name without force and deletes it with force", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      expect(() => pruneStoreName(EB, EB, "user")).toThrow("needs force");
      expect(pruneStoreName(EB, EB, "user", { force: true })).toEqual({ removed: true, authored: EB_V1 });
      expect(userRoot()).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
    });
  });

  test("prune refuses a name that is not an older name of the key, and a section with no current name", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1 });
      expect(() => pruneStoreName(EB, `${EB}@2`, "user")).toThrow("is not an older store name");
      expect(() => pruneStoreName(EB, "rt.roles", "user")).toThrow("is not an older store name");
      expect(() => pruneStoreName(EB, EB, "user")).toThrow("rt settings migrate --write");
    });
  });

  test("a name an old writer recreates after a prune reads diverged", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: valueHash(EB_V1) } });
      pruneStoreName(EB, EB, "user");
      writeUser({ ...userRoot(), [EB]: [{ pattern: "again/*", category: "c", title: "t", message: "m" }] });
      expect(userRow().olderLabel).toBe("diverged");
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/write-migrations.test.ts`
Expected: FAIL (`pruneStoreName` is not exported; `setSetting` writes the bare key).

- [ ] **Step 3: Planned edits in the store writers**

In `packages/rt-client/src/settings/write.ts`, extend the jsonc-parser import with `parse`, and add:

```ts
import { baselinesOf, baselinesToRecord, currentStoreName, MIGRATED_PROP, olderStoreNames, readSection } from "./migrate.ts";
```

Add below `const FORMAT = ...`:

```ts
interface StoreEdit {
  path: JSONPath;
  value: unknown;
}

function sectionOf(root: Record<string, unknown>, repoIdentity: string | undefined): Record<string, unknown> | undefined {
  if (repoIdentity === undefined) return root;
  const repos = root.repos;
  if (repos === null || typeof repos !== "object" || Array.isArray(repos)) return undefined;
  const section = (repos as Record<string, unknown>)[repoIdentity];
  return section !== null && typeof section === "object" && !Array.isArray(section) ? (section as Record<string, unknown>) : undefined;
}

function sectionPathOf(repoIdentity: string | undefined): JSONPath {
  return repoIdentity !== undefined ? ["repos", repoIdentity] : [];
}
```

Change `writeIntoStore` to take its edits from the file it read, so the baselines and the value land in one temp-then-rename write. Its signature becomes `writeIntoStore(storePath: string, planEdits: (root: Record<string, unknown>) => StoreEdit[], createIfMissing: boolean): void`, and the two lines

```ts
  const edits = modify(content, jsonPath, value, { formattingOptions: FORMAT });
  const next = applyEdits(content, edits);
```

become

```ts
  const root = (parse(content, [], { allowTrailingComma: true }) ?? {}) as Record<string, unknown>;
  let next = content;
  for (const edit of planEdits(root)) {
    next = applyEdits(next, modify(next, edit.path, edit.value, { formattingOptions: FORMAT }));
  }
```

Change `removeFromStore` the same way: signature `removeFromStore(storePath: string, planPaths: (root: Record<string, unknown>) => JSONPath[]): boolean`, body after `assertEditableJsonc(storePath, content);`:

```ts
  const root = (parse(content, [], { allowTrailingComma: true }) ?? {}) as Record<string, unknown>;
  const paths = planPaths(root);
  let next = content;
  for (const path of paths) next = applyEdits(next, modify(next, path, undefined, { formattingOptions: FORMAT }));
  next = dropEmptyMigrated(next, paths);
  if (next === content) return false;

  writeTempThenRename(storePath, next.endsWith("\n") ? next : `${next}\n`);
  return true;
```

and add:

```ts
/** A `$migrated` map emptied by this removal goes too; one left non-empty stays. */
function dropEmptyMigrated(content: string, removed: JSONPath[]): string {
  let next = content;
  const owners = new Set(removed.filter((p) => p.at(-2) === MIGRATED_PROP).map((p) => JSON.stringify(p.slice(0, -1))));
  for (const owner of owners) {
    const path = JSON.parse(owner) as string[];
    const root = parse(next, [], { allowTrailingComma: true }) as unknown;
    const node = path.reduce<unknown>((at, seg) => (at !== null && typeof at === "object" ? (at as Record<string, unknown>)[seg] : undefined), root);
    if (node !== null && typeof node === "object" && Object.keys(node).length === 0) {
      next = applyEdits(next, modify(next, path, undefined, { formattingOptions: FORMAT }));
    }
  }
  return next;
}
```

Change `removeKeyFromScope(key, scope, opts, jsonPath)` to take `planPaths: (root: Record<string, unknown>) => JSONPath[]` in place of `jsonPath` and pass it to `removeFromStore`. The retired-key branch of `unsetSetting` passes `() => [[key]]`.

- [ ] **Step 4: `setSetting` and `unsetSetting` over store names**

In `setSetting`, replace from `const storePath = resolveStorePath(scope, opts);` through the `writeIntoStore(...)` call with:

```ts
  const storePath = resolveStorePath(scope, opts);
  const sectionPath = sectionPathOf(opts.repoIdentity);
  const name = currentStoreName(def);

  writeIntoStore(
    storePath,
    (root) => [
      { path: [...sectionPath, name], value },
      ...Object.entries(baselinesToRecord(def, sectionOf(root, opts.repoIdentity))).map(([older, hash]) => ({
        path: [...sectionPath, MIGRATED_PROP, older],
        value: hash,
      })),
    ],
    /* createIfMissing */ scope !== "team",
  );
```

In `unsetSetting`, replace the final two lines (the `jsonPath` constant and `return removeKeyFromScope(...)`) with:

```ts
  const sectionPath = sectionPathOf(opts.repoIdentity);
  return removeKeyFromScope(key, scope, opts, (root) => {
    const section = sectionOf(root, opts.repoIdentity);
    if (!section) return [];
    const diverged = readSection(def, section, { layer: true }).older.filter((o) => o.label === "diverged");
    if (diverged.length > 0) {
      refuse(
        `"${key}" has an older store name edited after its current one (${diverged.map((o) => o.storeName).join(", ")}) in the ${scope} store; compare both values with \`rt settings migrate\` and remove the older one with \`rt settings migrate --prune --force ${key}\` first`,
      );
    }
    const names = [currentStoreName(def), ...olderStoreNames(def).map((o) => o.name)].filter((n) => section[n] !== undefined);
    const baselines = baselinesOf(section);
    return [
      ...names.map((n) => [...sectionPath, n]),
      ...names.filter((n) => baselines[n] !== undefined).map((n) => [...sectionPath, MIGRATED_PROP, n]),
    ];
  });
```

- [ ] **Step 5: `pruneStoreName`**

Append to `write.ts`:

```ts
export interface PruneOpts extends SetSettingOpts {
  /** Delete the name even when it diverged from the current one. */
  force?: boolean;
}

/**
 * Deletes one older store name of `key`, and its `$migrated` baseline, from
 * a section whose current name is present. Its own path rather than
 * unsetSetting: the name is not a registry key, and a diverged name needs
 * `force`. `authored` is the value it removed.
 */
export function pruneStoreName(key: string, storeName: string, scope: SettingScope, opts: PruneOpts = {}): { removed: boolean; authored?: unknown } {
  const def = getDef(key);
  if (!def) refuse(`unknown setting "${key}"; not in the settings registry (see \`rt settings list\`)`);
  if (!def.scopes.includes(scope)) refuse(`"${key}" is not stored in the ${scope} store (allowed: ${def.scopes.join(", ")})`);
  if (opts.repoIdentity !== undefined && def.repoScoped !== true) refuse(`"${key}" is not repo-scoped; omit the repo identity`);
  if (!olderStoreNames(def).some((o) => o.name === storeName)) refuse(`"${storeName}" is not an older store name of "${key}"`);

  const storePath = resolveStorePathForUnset(scope, opts);
  if (storePath === null || !existsSync(storePath)) return { removed: false };
  const sectionPath = sectionPathOf(opts.repoIdentity);
  let authored: unknown;
  const removed = removeFromStore(storePath, (root) => {
    const section = sectionOf(root, opts.repoIdentity);
    if (section?.[storeName] === undefined) return [];
    const current = currentStoreName(def);
    if (section[current] === undefined) {
      refuse(`"${key}" has no "${current}" in the ${scope} store yet; run \`rt settings migrate --write\` before pruning "${storeName}"`);
    }
    const older = readSection(def, section, { layer: true }).older.find((o) => o.storeName === storeName)!;
    if (older.label === "diverged" && opts.force !== true) {
      refuse(`"${storeName}" diverged from "${current}" in the ${scope} store; deleting it needs force`);
    }
    authored = older.authored;
    return [[...sectionPath, storeName], ...(baselinesOf(section)[storeName] !== undefined ? [[...sectionPath, MIGRATED_PROP, storeName]] : [])];
  });
  if (!removed) return { removed };
  console.error(`rt: removed "${storeName}" from the local ${scope} store (${storePath}); this is local only until you commit and push it.`);
  return { removed, authored };
}
```

In `packages/rt-client/src/index.ts`, change the write exports to:

```ts
export { setSetting, unsetSetting, pruneStoreName } from "./settings/write.ts";
export type { SetSettingOpts, PruneOpts } from "./settings/write.ts";
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/write-migrations.test.ts packages/rt-client/src/settings/__tests__/write.test.ts packages/rt-client/src/settings/__tests__/validate-write.test.ts`
Expected: PASS. The existing `write.test.ts` must pass unchanged: a key at storeVersion 1 writes `[key]` exactly as before, and a store with no older names gains no `$migrated`.

- [ ] **Step 7: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/write-migrations.test.ts packages/rt-client/src/settings/__tests__/write.test.ts packages/rt-client/src/settings/__tests__/validate-write.test.ts packages/rt-client/test`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/settings/write.ts packages/rt-client/src/index.ts packages/rt-client/src/settings/__tests__/write-migrations.test.ts
git commit -m "feat(settings): write the current store name with baselines; unset every name; pruneStoreName

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `rt settings check` reports migration failures and older names

**Files:**
- Create: `packages/rt-client/src/settings/migrate-stores.ts` (`storeSections` only; Task 6 adds the plan)
- Modify: `packages/rt-client/src/settings/check.ts`
- Create: `lib/settings/migrate.ts`, `lib/settings/migrate-stores.ts` (barrels)
- Modify: `commands/settings-keys.ts` (`renderCheckFinding`, `renderExplainRow`, `renderListRow`, `settingsCheck` summary, `settingsExplain`)
- Create: `packages/rt-client/src/settings/__tests__/check-migrations.test.ts`
- Modify: `commands/__tests__/settings-check.test.ts`, `commands/__tests__/settings-keys-render.test.ts`

**Interfaces:**
- Consumes: Task 2's `readSection`; Task 3's `listUnregisteredSettings` (`newer`), `ExplainRow.olderNames`, `ListedSetting.diverged`, `ListedSetting.newer`; plan 1's `checkStores`, `CheckFinding`, `CheckReport`, `currentMergedValue`.
- Produces:
  - `migrate-stores.ts`: `interface StoreSection { scope: SettingScope; team?: string; file: string; repo?: string; section: Record<string, unknown> }`; `storeSections(): StoreSection[]` (teams alphabetical, then user, then machine; each store's global section then each repo section; absent stores skipped).
  - `CheckFinding.kind` adds `"diverged" | "stale" | "leftover"`; `CheckFinding` gains `storeName?: string`, `olderValue?: unknown`, `currentValue?: unknown` (never for a secret def), `newer?: true`. `failing` counts `invalid`, `nonconforming`, `merged` and `diverged`. A value that fails after in-memory migration is a `nonconforming` finding whose first issue is the migration error.
  - `renderExplainRow(row, currentName?: string)`: a row read from a name other than `currentName` ends with `[read from <storeName>, version <N>]`; each older name prints on its own line (`older <name>: <label>`, plus its value when diverged).

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/check-migrations.test.ts`:

```ts
/**
 * checkStores over versioned store names: diverged older names fail with
 * both values, stale and leftover ones are listed without failing, a value
 * the chain cannot carry fails, and a name from a newer rt is listed.
 * HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { teamSettingsPath, userSettingsPath } from "../paths.ts";
import type { MigrationStep } from "../registry-machinery.ts";
import { valueHash } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { checkStores } from "../check.ts";
import { storeSections } from "../migrate-stores.ts";
import { withMigration } from "./with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";
const EB = "rt.notify.eventBridges";
const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2_EDITED = [{ match: "herd/*", category: "herd", title: "Herd", message: "{summary}" }];
const EB_SCHEMA_V2 = {
  type: "array",
  items: {
    type: "object",
    properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
    required: ["match", "category", "title", "message"],
  },
};
const ebRename: MigrationStep = { version: 1, up: (v) => renameProperty(v, ["[]"], "pattern", "match") };
const EB_BUMP = { storeVersion: 2, migrateFrom: [ebRename], schema: EB_SCHEMA_V2 };
const ROLES_BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }],
  schema: { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } },
};

describe("settings/check over versioned store names", () => {
  const origHome = process.env.HOME;
  let home: string;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-check-mig-")));
    process.env.HOME = home;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }
  const writeUser = (obj: unknown) => write(userSettingsPath(), obj);
  const writeTeam = (name: string, obj: unknown) => write(teamSettingsPath(name), obj);

  test("storeSections walks team, user and machine stores, global then repo sections", () => {
    writeTeam(TEAM, { a: 1, repos: { [IDENTITY]: { b: 2 } } });
    writeUser({ c: 3 });
    expect(storeSections().map((s) => [s.scope, s.team ?? null, s.repo ?? null])).toEqual([
      ["team", TEAM, null],
      ["team", TEAM, IDENTITY],
      ["user", null, null],
    ]);
  });

  test("a diverged older name fails with both values", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      const report = checkStores();
      const f = report.findings.find((x) => x.kind === "diverged")!;
      expect(f).toMatchObject({ key: EB, scope: "user", file: userSettingsPath(), storeName: EB, olderValue: EB_V2, currentValue: EB_V2_EDITED });
      expect(report.failing).toBe(1);
    });
  });

  test("stale and leftover older names are listed and do not fail", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      let report = checkStores();
      expect(report.findings.map((f) => f.kind)).toContain("stale");
      expect(report.failing).toBe(0);
      writeUser({ [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      report = checkStores();
      expect(report.findings.map((f) => f.kind)).toContain("leftover");
      expect(report.failing).toBe(0);
    });
  });

  test("a value the chain cannot carry fails, naming the step", () => {
    withMigration(EB, { ...EB_BUMP, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }, () => {
      writeUser({ [EB]: EB_V1 });
      const f = checkStores().findings.find((x) => x.key === EB && x.kind === "nonconforming")!;
      expect(f.issues[0]).toEqual({ path: [], message: "migration 1 -> 2 threw: boom" });
    });
  });

  test("a diverged older name in a team repo section is found and names the repo", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      writeTeam(TEAM, { repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./other.sh" } } } } });
      const f = checkStores().findings.find((x) => x.kind === "diverged")!;
      expect(f).toMatchObject({ key: "rt.roles", scope: "team", repo: IDENTITY, storeName: "rt.roles" });
    });
  });

  test("a name from a newer rt is listed as unregistered and newer, and $migrated not at all", () => {
    withMigration(EB, EB_BUMP, () => {
      writeUser({ [`${EB}@3`]: [], $migrated: {} });
      const report = checkStores();
      expect(report.findings).toContainEqual({ key: `${EB}@3`, scope: "user", file: userSettingsPath(), kind: "unregistered", issues: [], newer: true });
      expect(report.findings.map((f) => f.key)).not.toContain("$migrated");
      expect(report.failing).toBe(0);
    });
  });
});
```

Add to `commands/__tests__/settings-check.test.ts` (inside its `describe`, reusing its `write`, `logSpy` and `stripAnsi`; add the imports shown):

```ts
import { userSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
import { renameProperty } from "../../packages/rt-client/src/settings/migrations/helpers.ts";
import { withMigrationAsync } from "../../packages/rt-client/src/settings/__tests__/with-migration.ts";

  const EB = "rt.notify.eventBridges";
  const EB_BUMP = {
    storeVersion: 2,
    migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") }],
    schema: { type: "array", items: { type: "object", properties: { match: { type: "string" } }, required: ["match"] } },
  };

  test("a diverged older name exits 1 and prints both values", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: [{ pattern: "gate/*" }], [`${EB}@2`]: [{ match: "herd/*" }] });
      await settingsCheck([]);
      const out = stripAnsi(logSpy.mock.calls.map((c) => String(c[0])).join("\n"));
      expect(out).toContain("diverged");
      expect(out).toContain('[{"match":"gate/*"}]');
      expect(out).toContain('[{"match":"herd/*"}]');
      expect(process.exitCode).toBe(1);
    });
  });

  test("--json carries storeName, olderValue and currentValue", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: [{ pattern: "gate/*" }], [`${EB}@2`]: [{ match: "herd/*" }] });
      await settingsCheck(["--json"]);
      const printed = logSpy.mock.calls.map((c) => c[0] as string).find((line) => line.startsWith("{"));
      const f = (JSON.parse(printed as string) as { findings: Record<string, unknown>[] }).findings.find((x) => x.kind === "diverged");
      expect(f).toMatchObject({ storeName: EB, olderValue: [{ match: "gate/*" }], currentValue: [{ match: "herd/*" }] });
    });
  });
```

Add to `commands/__tests__/settings-keys-render.test.ts` (import `ExplainRow` from `../../lib/settings/resolve.ts` beside `ListedSetting`):

```ts
describe("renderExplainRow over store names", () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const base = { scope: "user", file: "/home/user/settings.user.jsonc", present: true } as const;

  test("a row read from an older name says so; one read from the current name does not", () => {
    const migrated = strip(renderExplainRow({ ...base, value: [1], storeName: "rt.x", storedVersion: 1, authored: [0] } as ExplainRow, "rt.x@2"));
    expect(migrated).toContain("[read from rt.x, version 1]");
    const current = strip(renderExplainRow({ ...base, value: [1], storeName: "rt.x@2", storedVersion: 2, authored: [1] } as ExplainRow, "rt.x@2"));
    expect(current).not.toContain("read from");
  });

  test("older names print one per line, a diverged one with its value", () => {
    const out = strip(renderExplainRow({
      ...base,
      value: [1],
      storeName: "rt.x@2",
      storedVersion: 2,
      authored: [1],
      olderLabel: "diverged",
      olderNames: [{ storeName: "rt.x", storedVersion: 1, label: "diverged", value: [9], authored: [8] }],
    } as ExplainRow, "rt.x@2"));
    expect(out).toContain("older rt.x: diverged  [9]");
  });
});

describe("renderListRow over store names", () => {
  test("a diverged layer and a newer-rt name are labeled", () => {
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
    expect(strip(renderListRow(row({ diverged: [{ scope: "user", file: null, storeNames: ["rt.roles"] }] })))).toContain("diverged[user]: rt.roles");
    expect(strip(renderListRow(row({ key: "rt.roles@3", migrated: false, unregistered: true, newer: true })))).toContain("from a newer rt");
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/check-migrations.test.ts commands/__tests__/settings-check.test.ts commands/__tests__/settings-keys-render.test.ts`
Expected: FAIL (`../migrate-stores.ts` missing; no `diverged` findings; render lines absent).

- [ ] **Step 3: `storeSections`**

Create `packages/rt-client/src/settings/migrate-stores.ts`:

```ts
/**
 * Every section of every settings store, the unit `rt settings check` and
 * `rt settings migrate` walk. Read-only: writes go through setSetting and
 * pruneStoreName.
 */

import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "./paths.ts";
import type { SettingScope } from "./registry-machinery.ts";
import { listTeams, readStore } from "./stores.ts";

export interface StoreSection {
  scope: SettingScope;
  /** The team's name, for a team store. */
  team?: string;
  file: string;
  repo?: string;
  section: Record<string, unknown>;
}

export function storeSections(): StoreSection[] {
  const stores: { scope: SettingScope; team?: string; file: string }[] = [
    ...[...listTeams()].sort().map((team) => ({ scope: "team" as const, team, file: teamSettingsPath(team) })),
    { scope: "user", file: userSettingsPath() },
    { scope: "machine", file: machineSettingsPath() },
  ];
  const out: StoreSection[] = [];
  for (const s of stores) {
    const store = readStore(s.file);
    if (!store.exists) continue;
    out.push({ ...s, section: store.global });
    for (const [repo, section] of Object.entries(store.repos)) out.push({ ...s, repo, section });
  }
  return out;
}
```

Create the barrels `lib/settings/migrate.ts`:

```ts
// Versioned store names and the migration chain live in @mattstack/rt-client;
// rt importers reach them through this re-export barrel.
export * from "../../packages/rt-client/src/settings/migrate.ts";
```

and `lib/settings/migrate-stores.ts`:

```ts
// The store walk behind rt settings check and rt settings migrate lives in
// @mattstack/rt-client; rt importers reach it through this re-export barrel.
export * from "../../packages/rt-client/src/settings/migrate-stores.ts";
```

- [ ] **Step 4: `checkStores` reads sections through `readSection`**

In `packages/rt-client/src/settings/check.ts`: replace the `CheckFinding` interface with

```ts
/** A `merged` finding belongs to no one store, so it carries no `scope` or `file`. */
export interface CheckFinding {
  key: string;
  scope?: SettingScope;
  file?: string;
  repo?: string;
  kind: "invalid" | "nonconforming" | "merged" | "unregistered" | "diverged" | "stale" | "leftover";
  issues: SchemaIssue[];
  /** For an older-name finding: the older name, its value migrated, and the current name's value. */
  storeName?: string;
  olderValue?: unknown;
  currentValue?: unknown;
  /** An unregistered name a newer rt writes. */
  newer?: true;
}

const FAILING: ReadonlySet<CheckFinding["kind"]> = new Set(["invalid", "nonconforming", "merged", "diverged"]);
```

In `checkStores`, replace the `stores` array and its loop with `for (const s of storeSections()) checkSection(s, findings);`, replace the unregistered loop with

```ts
  for (const u of listUnregisteredSettings()) {
    findings.push({ key: u.key, scope: u.scope.replace(".repo", "") as SettingScope, file: u.file, kind: "unregistered", issues: [], ...(u.newer ? { newer: true as const } : {}) });
  }
  return { findings, failing: findings.filter((f) => FAILING.has(f.kind)).length };
```

and replace `checkSection` with

```ts
function checkSection(s: StoreSection, out: CheckFinding[]): void {
  for (const def of allDefs()) {
    const read = readSection(def, s.section, { layer: true });
    if (!read.present) continue;
    const at = { key: def.key, scope: s.scope, file: s.file, ...(s.repo ? { repo: s.repo } : {}) };
    for (const o of read.older) {
      out.push({
        ...at,
        kind: o.label,
        issues: o.migrationError ? [{ path: [], message: o.migrationError }] : [],
        storeName: o.storeName,
        ...(def.secret === true ? {} : { olderValue: o.value, currentValue: read.value }),
      });
    }
    const guarded = s.scope === "machine" ? { ...def, pathGuardFields: undefined } : def;
    const typed = validateValue(guarded, read.value);
    if (!typed.ok) {
      out.push({ ...at, kind: "invalid", issues: [{ path: [], message: typed.reason }] });
      continue;
    }
    const issues = [
      ...(read.migrationError ? [{ path: [], message: read.migrationError }] : []),
      ...(hasSchema(def) ? checkSchema(def, read.value, { layer: true }) : []),
    ];
    if (issues.length > 0) out.push({ ...at, kind: "nonconforming", issues });
  }
}
```

Fix the imports: drop `machineSettingsPath`, `teamSettingsPath`, `userSettingsPath`, `getDef`, `listTeams`, `readStore`, `StoreFile` if now unused, and add `import { readSection } from "./migrate.ts";` and `import { storeSections, type StoreSection } from "./migrate-stores.ts";`.

- [ ] **Step 5: Render older names in the CLI**

In `commands/settings-keys.ts`, add `import { currentStoreName } from "../lib/settings/migrate.ts";`, then:

Replace `renderCheckFinding` with

```ts
/** A header line per finding, then values or issues. A `merged` finding
    carries no scope or file, so its header names only the repo, if any. */
export function renderCheckFinding(f: CheckFinding): string {
  const where = [f.scope, f.repo].filter(Boolean).join("/");
  const label = where ? `${where}  ` : "";
  const file = f.file ? `  ${dim}${f.file}${reset}` : "";
  const kindText = f.newer ? "unregistered (from a newer rt)" : f.kind;
  const kind = f.kind === "stale" || f.kind === "leftover" ? `${dim}${kindText}${reset}` : `${red}${kindText}${reset}`;
  const name = f.storeName ? `  ${f.storeName}` : "";
  const values =
    f.kind === "diverged" && "olderValue" in f
      ? `\n      ${f.storeName}: ${formatValueInline(f.olderValue)}\n      current: ${formatValueInline(f.currentValue)}`
      : "";
  const issues = f.issues.map((i) => `\n      ${formatIssuePath(i.path)}: ${i.message}`).join("");
  return `  ${bold}${f.key}${reset}  ${label}${kind}${name}${file}${values}${issues}`;
}
```

In `settingsCheck`'s text branch, replace the summary line with

```ts
    const older = report.findings.filter((f) => f.kind === "stale" || f.kind === "leftover").length;
    console.log(`\n  ${report.failing} failing, ${unregistered} unregistered, ${older} stale or leftover`);
```

Change `renderExplainRow`'s signature to `renderExplainRow(row: ExplainRow, currentName?: string): string`, and add after the `fileLabel` line:

```ts
  const from =
    currentName !== undefined && row.storeName !== undefined && row.storeName !== currentName
      ? `  ${dim}[read from ${row.storeName}, version ${row.storedVersion}]${reset}`
      : "";
  const older = (row.olderNames ?? [])
    .map((o) => `\n      ${o.label === "diverged" ? red : dim}older ${o.storeName}: ${o.label}${reset}${o.label === "diverged" ? `  ${formatValueInline(o.value)}` : ""}`)
    .join("");
```

then append `${from}${older}` to the end of the two returns that follow the `row.invalid` branch (the `nonconforming` return and the final return). In `settingsExplain`, call `renderExplainRow(row, currentStoreName(getDef(key)!))`.

In `renderListRow`, after the `mergedIssues` label line add:

```ts
  for (const d of s.diverged ?? []) labels.push(`diverged[${d.scope}]: ${d.storeNames.join(", ")}`);
  if (s.newer) labels.push("from a newer rt");
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/check-migrations.test.ts packages/rt-client/src/settings/__tests__/check.test.ts commands/__tests__/settings-check.test.ts commands/__tests__/settings-keys-render.test.ts`
Expected: PASS (plan 1's `check.test.ts` unchanged and green).

- [ ] **Step 7: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/check-migrations.test.ts packages/rt-client/src/settings/__tests__/check.test.ts commands/__tests__/settings-check.test.ts commands/__tests__/settings-keys-render.test.ts packages/rt-client/test`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/settings/migrate-stores.ts packages/rt-client/src/settings/check.ts lib/settings/migrate.ts lib/settings/migrate-stores.ts commands/settings-keys.ts packages/rt-client/src/settings/__tests__/check-migrations.test.ts commands/__tests__/settings-check.test.ts commands/__tests__/settings-keys-render.test.ts
git commit -m "feat(settings): check reports diverged, stale and leftover names and unmigratable values

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `rt settings migrate`

**Files:**
- Modify: `packages/rt-client/src/settings/migrate-stores.ts` (the plan)
- Modify: `packages/rt-client/src/index.ts`
- Modify: `commands/settings-keys.ts` (`settingsMigrate`)
- Modify: `lib/command-tree-def.ts` (`settings.migrate`)
- Generated: `website/docs/reference/settings/migrate.mdx` and the settings index page (`bun run docs:gen`)
- Create: `packages/rt-client/src/settings/__tests__/migrate-stores.test.ts`, `packages/rt-client/src/settings/__tests__/migrations-acceptance.test.ts`, `commands/__tests__/settings-migrate.test.ts`

**Interfaces:**
- Consumes: Task 5's `storeSections`; Task 2's `readSection`; Task 1's `currentStoreName`; Task 4's `setSetting`, `pruneStoreName`; `confirm` from `lib/ui/prompts.ts`.
- Produces:
  - `interface MigrationWrite { key: string; scope: SettingScope; team?: string; file: string; repo?: string; fromName: string; fromVersion: number; storeName: string; value: unknown }`
  - `interface MigrationFailure { key: string; scope: SettingScope; team?: string; file: string; repo?: string; fromName: string; message: string }`
  - `interface OlderName { key: string; scope: SettingScope; team?: string; file: string; repo?: string; storeName: string; storedVersion: number; storeVersion: number; label: OlderLabel; olderValue: unknown; currentValue: unknown }`
  - `interface MigrationPlan { writes: MigrationWrite[]; failures: MigrationFailure[]; older: OlderName[] }`; `planStoreMigrations(): MigrationPlan` (skips a key in a store its def does not allow, and a non-repo-scoped key inside a repo section).
  - `interface MigrateDeps { confirm?: (message: string) => Promise<boolean>; interactive?: boolean }`; `settingsMigrate(args: string[], deps?: MigrateDeps): Promise<void>`: dry run by default; `--write`; `--prune` with `--team`, repeatable `--force <key>`, `--yes`; `--json`. Exit code 1 on any migration failure, write error or refused prune.
  - `packages/rt-client/src/index.ts` exports `storeSections`, `planStoreMigrations` and their types.

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/migrate-stores.test.ts`:

```ts
/**
 * planStoreMigrations: what `rt settings migrate` would write (a current
 * name absent, an older one present), what it cannot carry, and every older
 * name beside a current one with its label. Read-only. HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, teamSettingsPath, userSettingsPath } from "../paths.ts";
import type { MigrationStep } from "../registry-machinery.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { planStoreMigrations } from "../migrate-stores.ts";
import { withMigration } from "./with-migration.ts";

const IDENTITY = "gitlab.example.com/acme/app";
const TEAM = "acme";
const EB = "rt.notify.eventBridges";
const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_SCHEMA_V2 = {
  type: "array",
  items: {
    type: "object",
    properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
    required: ["match", "category", "title", "message"],
  },
};
const ebRename: MigrationStep = { version: 1, up: (v) => renameProperty(v, ["[]"], "pattern", "match") };
const EB_BUMP = { storeVersion: 2, migrateFrom: [ebRename], schema: EB_SCHEMA_V2 };
const ROLES_BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }],
  schema: { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } },
};

describe("planStoreMigrations", () => {
  const origHome = process.env.HOME;
  let home: string;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-plan-mig-")));
    process.env.HOME = home;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }

  test("lists a write where the current name is absent, with the migrated value, and changes nothing", () => {
    withMigration(EB, EB_BUMP, () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      const before = readFileSync(userSettingsPath(), "utf8");
      const plan = planStoreMigrations();
      expect(plan.writes).toEqual([{ key: EB, scope: "user", file: userSettingsPath(), fromName: EB, fromVersion: 1, storeName: `${EB}@2`, value: EB_V2 }]);
      expect(plan.failures).toEqual([]);
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
    });
  });

  test("lists a value the chain cannot carry as a failure", () => {
    withMigration(EB, { ...EB_BUMP, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }, () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      expect(planStoreMigrations().failures).toEqual([{ key: EB, scope: "user", file: userSettingsPath(), fromName: EB, message: "migration 1 -> 2 threw: boom" }]);
    });
  });

  test("lists older names beside current ones, with the team name and repo", () => {
    withMigration("rt.roles", ROLES_BUMP, () => {
      write(teamSettingsPath(TEAM), { repos: { [IDENTITY]: { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./dev.sh" } } } } });
      expect(planStoreMigrations().older).toEqual([{
        key: "rt.roles",
        scope: "team",
        team: TEAM,
        file: teamSettingsPath(TEAM),
        repo: IDENTITY,
        storeName: "rt.roles",
        storedVersion: 1,
        storeVersion: 2,
        label: "leftover",
        olderValue: { web: { devHook: "./dev.sh" } },
        currentValue: { web: { devHook: "./dev.sh" } },
      }]);
    });
  });

  test("skips a key found in a store its def does not allow", () => {
    withMigration(EB, EB_BUMP, () => {
      write(machineSettingsPath(), { [EB]: EB_V1 });
      expect(planStoreMigrations().writes).toEqual([]);
    });
  });
});
```

Create `commands/__tests__/settings-migrate.test.ts`:

```ts
/**
 * `rt settings migrate`: dry run by default, --write is additive, --prune
 * deletes leftover and stale names only after confirmation, the team store
 * only with --team, a diverged name only with --force <key>.
 *
 * process.exitCode is primed with 0 and restored to 0: Bun keeps a nonzero
 * exit code when a later assignment is undefined.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { parse } from "jsonc-parser";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { settingsMigrate } from "../settings-keys.ts";
import { teamSettingsPath, userSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
import { valueHash } from "../../packages/rt-client/src/settings/migrate.ts";
import { renameProperty } from "../../packages/rt-client/src/settings/migrations/helpers.ts";
import { withMigrationAsync } from "../../packages/rt-client/src/settings/__tests__/with-migration.ts";

const TEAM = "acme";
const EB = "rt.notify.eventBridges";
const EB_V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const EB_V2_EDITED = [{ match: "herd/*", category: "herd", title: "Herd", message: "{summary}" }];
const EB_BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") }],
  schema: {
    type: "array",
    items: {
      type: "object",
      properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
      required: ["match", "category", "title", "message"],
    },
  },
};
const ROLES_BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["{}"], "hook", "devHook") }],
  schema: { type: "object", additionalProperties: { type: "object", properties: { devHook: { type: "string" } } } },
};

describe("rt settings migrate", () => {
  const origHome = process.env.HOME;
  let home: string;
  let logSpy: ReturnType<typeof spyOn<Console, "log">>;
  let errSpy: ReturnType<typeof spyOn<Console, "error">>;
  let warnSpy: ReturnType<typeof spyOn<Console, "warn">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-migrate-cli-")));
    process.env.HOME = home;
    process.exitCode = 0;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errSpy = spyOn(console, "error").mockImplementation(() => {});
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    process.env.HOME = origHome;
    process.exitCode = 0;
    rmSync(home, { recursive: true, force: true });
  });

  function write(file: string, obj: unknown): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(obj, null, 2));
  }
  const read = (file: string) => parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const printed = () => logSpy.mock.calls.map((c) => String(c[0])).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
  const noPrompt = { interactive: false, confirm: async () => { throw new Error("must not prompt"); } };

  test("a dry run changes nothing and lists what --write would do", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      const before = readFileSync(userSettingsPath(), "utf8");
      await settingsMigrate([], noPrompt);
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
      expect(printed()).toContain(`would write ${EB}@2 from ${EB}`);
      expect(process.exitCode).toBe(0);
    });
  });

  test("--write adds the current name and a baseline, and leaves the old name", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      await settingsMigrate(["--write"], noPrompt);
      expect(read(userSettingsPath())).toEqual({ [EB]: EB_V1, [`${EB}@2`]: EB_V2, $migrated: { [EB]: valueHash(EB_V1) } });
      expect(process.exitCode).toBe(0);
    });
  });

  test("--write reaches the team store", async () => {
    await withMigrationAsync("rt.roles", ROLES_BUMP, async () => {
      write(teamSettingsPath(TEAM), { "rt.roles": { web: { hook: "./dev.sh" } } });
      await settingsMigrate(["--write"], noPrompt);
      expect(read(teamSettingsPath(TEAM))["rt.roles@2"]).toEqual({ web: { devHook: "./dev.sh" } });
    });
  });

  test("--write and --prune together is refused", async () => {
    await settingsMigrate(["--write", "--prune"], noPrompt);
    expect(process.exitCode).toBe(1);
  });

  test("--prune off a terminal without --yes refuses and changes nothing", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2 });
      const before = readFileSync(userSettingsPath(), "utf8");
      await settingsMigrate(["--prune"], noPrompt);
      expect(readFileSync(userSettingsPath(), "utf8")).toBe(before);
      expect(process.exitCode).toBe(1);
    });
  });

  test("--prune asks per store, names the storeVersion readers need, and removes leftover and stale names", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED, $migrated: { [EB]: valueHash(EB_V1) } });
      const asked: string[] = [];
      await settingsMigrate(["--prune"], { interactive: true, confirm: async (m) => { asked.push(m); return true; } });
      expect(asked).toEqual([`Delete 1 older store name from the user store (${userSettingsPath()})?`]);
      expect(printed()).toContain(`${EB} (storeVersion 2)`);
      expect(read(userSettingsPath())).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
      expect(process.exitCode).toBe(0);
    });
  });

  test("--prune leaves the team store alone without --team, and prunes it with --team", async () => {
    await withMigrationAsync("rt.roles", ROLES_BUMP, async () => {
      write(teamSettingsPath(TEAM), { "rt.roles": { web: { hook: "./dev.sh" } }, "rt.roles@2": { web: { devHook: "./dev.sh" } } });
      await settingsMigrate(["--prune", "--yes"], noPrompt);
      expect(read(teamSettingsPath(TEAM))["rt.roles"]).toBeDefined();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await settingsMigrate(["--prune", "--team", "--yes"], noPrompt);
      expect(read(teamSettingsPath(TEAM))).toEqual({ "rt.roles@2": { web: { devHook: "./dev.sh" } } });
      expect(process.exitCode).toBe(0);
    });
  });

  test("--prune refuses a diverged name without --force <key>, and prints its value before deleting it with one", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1, [`${EB}@2`]: EB_V2_EDITED });
      await settingsMigrate(["--prune", "--yes"], noPrompt);
      expect(read(userSettingsPath())[EB]).toEqual(EB_V1);
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
      await settingsMigrate(["--prune", "--yes", "--force", EB], noPrompt);
      expect(printed()).toContain(`deleting diverged ${EB}; its value was: ${JSON.stringify(renameProperty(EB_V1, ["[]"], "pattern", "match"))}`);
      expect(read(userSettingsPath())).toEqual({ [`${EB}@2`]: EB_V2_EDITED });
    });
  });

  test("--json reports the plan", async () => {
    await withMigrationAsync(EB, EB_BUMP, async () => {
      write(userSettingsPath(), { [EB]: EB_V1 });
      await settingsMigrate(["--json"], noPrompt);
      const body = JSON.parse(logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith("{"))!) as { ok: boolean; writes: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.writes).toHaveLength(1);
    });
  });
});
```

Create `packages/rt-client/src/settings/__tests__/migrations-acceptance.test.ts` (spec 3 Acceptance, store half, end to end on the real registry def):

```ts
/**
 * Spec 3 acceptance, stores: after a bump, a store still holding the old
 * name reads in the new shape; a write lands on key@2 with a baseline and
 * leaves the old name; the old name reads stale and check passes; an old
 * writer's edit (or re-creation after a prune) reads diverged, fails check
 * and blocks the prune. HOME per test.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { parse } from "jsonc-parser";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { userSettingsPath } from "../paths.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { checkStores } from "../check.ts";
import { explainSetting, getSetting } from "../resolve.ts";
import { pruneStoreName, setSetting } from "../write.ts";
import { withMigration } from "./with-migration.ts";

const EB = "rt.notify.eventBridges";
const V1 = [{ pattern: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const V2 = [{ match: "gate/opened/*", category: "gate", title: "Gate", message: "{question}" }];
const V2_EDITED = [{ match: "gate/opened/*", category: "gate", title: "Gate opened", message: "{question}" }];
const BUMP = {
  storeVersion: 2,
  migrateFrom: [{ version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") }],
  schema: {
    type: "array",
    items: {
      type: "object",
      properties: { match: { type: "string" }, category: { type: "string" }, title: { type: "string" }, message: { type: "string" } },
      required: ["match", "category", "title", "message"],
    },
  },
};

describe("spec 3 acceptance: a bumped key across a release", () => {
  const origHome = process.env.HOME;
  let home: string;
  const spies: { mockRestore(): void }[] = [];

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-accept-")));
    process.env.HOME = home;
    spies.push(spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {}));
  });

  afterEach(() => {
    for (const s of spies.splice(0)) s.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const writeUser = (obj: unknown) => {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), JSON.stringify(obj, null, 2));
  };
  const userRoot = () => parse(readFileSync(userSettingsPath(), "utf8")) as Record<string, unknown>;
  const label = () => explainSetting(EB).find((r) => r.scope === "user")!.olderLabel;

  test("old store reads new; a write adds key@2 and a baseline; old name reads stale; an old writer's edit reads diverged", () => {
    withMigration(EB, BUMP, () => {
      writeUser({ [EB]: V1 });
      expect(getSetting(EB).value).toEqual(V2);

      setSetting(EB, V2_EDITED, "user");
      expect(userRoot()[EB]).toEqual(V1);
      expect(userRoot()[`${EB}@2`]).toEqual(V2_EDITED);
      expect(label()).toBe("stale");
      expect(checkStores().failing).toBe(0);

      writeUser({ ...userRoot(), [EB]: [{ pattern: "gate/*", category: "gate", title: "Gate", message: "m" }] });
      expect(label()).toBe("diverged");
      const f = checkStores().findings.find((x) => x.kind === "diverged")!;
      expect(f).toMatchObject({ storeName: EB, currentValue: V2_EDITED });
      expect(checkStores().failing).toBe(1);
      expect(() => pruneStoreName(EB, EB, "user")).toThrow("needs force");
    });
  });

  test("an old writer creating the old name where it was absent reads leftover only when it matches, else diverged", () => {
    withMigration(EB, BUMP, () => {
      setSetting(EB, V2, "user");
      writeUser({ ...userRoot(), [EB]: V1 });
      expect(label()).toBe("leftover");
      writeUser({ ...userRoot(), [EB]: [{ pattern: "other/*", category: "c", title: "t", message: "m" }] });
      expect(label()).toBe("diverged");
    });
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/migrate-stores.test.ts packages/rt-client/src/settings/__tests__/migrations-acceptance.test.ts commands/__tests__/settings-migrate.test.ts`
Expected: `migrate-stores.test.ts` and `settings-migrate.test.ts` FAIL (`planStoreMigrations` and `settingsMigrate` do not exist). `migrations-acceptance.test.ts` already passes: it pins Tasks 3 and 4 end to end and needs no new code.

- [ ] **Step 3: The plan**

Append to `packages/rt-client/src/settings/migrate-stores.ts` (and add `import { allDefs } from "./registry-machinery.ts";` plus `import { currentStoreName, readSection, type OlderLabel } from "./migrate.ts";`):

```ts
export interface MigrationWrite {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  fromName: string;
  fromVersion: number;
  storeName: string;
  value: unknown;
}

export interface MigrationFailure {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  fromName: string;
  message: string;
}

export interface OlderName {
  key: string;
  scope: SettingScope;
  team?: string;
  file: string;
  repo?: string;
  storeName: string;
  storedVersion: number;
  /** The key's current storeVersion: every reader of this store must know it before the older name goes. */
  storeVersion: number;
  label: OlderLabel;
  olderValue: unknown;
  currentValue: unknown;
}

export interface MigrationPlan {
  writes: MigrationWrite[];
  failures: MigrationFailure[];
  older: OlderName[];
}

export function planStoreMigrations(): MigrationPlan {
  const plan: MigrationPlan = { writes: [], failures: [], older: [] };
  for (const s of storeSections()) {
    const where = { scope: s.scope, ...(s.team ? { team: s.team } : {}), file: s.file, ...(s.repo ? { repo: s.repo } : {}) };
    for (const def of allDefs()) {
      if (!def.scopes.includes(s.scope)) continue;
      if (s.repo !== undefined && def.repoScoped !== true) continue;
      const read = readSection(def, s.section, { layer: true });
      if (!read.present) continue;
      const current = currentStoreName(def);
      if (read.storeName !== current) {
        if (read.migrationError) plan.failures.push({ key: def.key, ...where, fromName: read.storeName!, message: read.migrationError });
        else plan.writes.push({ key: def.key, ...where, fromName: read.storeName!, fromVersion: read.storedVersion!, storeName: current, value: read.value });
        continue;
      }
      for (const o of read.older) {
        plan.older.push({ key: def.key, ...where, storeName: o.storeName, storedVersion: o.storedVersion, storeVersion: def.storeVersion ?? 1, label: o.label, olderValue: o.value, currentValue: read.value });
      }
    }
  }
  return plan;
}
```

In `packages/rt-client/src/index.ts`, add:

```ts
export { storeSections, planStoreMigrations } from "./settings/migrate-stores.ts";
export type { StoreSection, MigrationPlan, MigrationWrite, MigrationFailure, OlderName } from "./settings/migrate-stores.ts";
```

- [ ] **Step 4: The verb**

In `commands/settings-keys.ts`, add to the imports:

```ts
import { planStoreMigrations, type MigrationPlan, type OlderName } from "../lib/settings/migrate-stores.ts";
```

and change the write import to `import { pruneStoreName, setSetting, unsetSetting } from "../lib/settings/write.ts";`. Append:

```ts
// ─── migrate ────────────────────────────────────────────────────────────────

export interface MigrateDeps {
  confirm?: (message: string) => Promise<boolean>;
  interactive?: boolean;
}

const whereOf = (x: { scope: string; repo?: string; file: string }) => `${[x.scope, x.repo].filter(Boolean).join("/")}  ${dim}${x.file}${reset}`;
const shown = (key: string, value: unknown) => (getDef(key)?.secret === true ? "(secret)" : formatValueInline(value));

function renderOlder(o: OlderName): string {
  const color = o.label === "diverged" ? red : dim;
  const values = o.label === "diverged" ? `\n      ${o.storeName}: ${shown(o.key, o.olderValue)}\n      current: ${shown(o.key, o.currentValue)}` : "";
  return `  ${bold}${o.key}${reset}  ${whereOf(o)}  ${color}${o.storeName}: ${o.label}${reset}${values}`;
}

/**
 * rt settings migrate [--write | --prune [--team] [--force <key>]... [--yes]] [--json]
 * Dry run by default. --write is additive (current names from migrated
 * values, baselines recorded by the ordinary write path); --prune deletes
 * leftover and stale older names through pruneStoreName after confirmation.
 */
export async function settingsMigrate(args: string[], deps: MigrateDeps = {}): Promise<void> {
  const json = args.includes("--json");
  const write = args.includes("--write");
  const prune = args.includes("--prune");
  if (write && prune) {
    console.error("rt settings: run --write and --prune separately (write first; prune once every reader of the store knows the new names)");
    process.exitCode = 1;
    return;
  }
  const plan = planStoreMigrations();
  if (write) return migrateWrite(plan, json);
  if (prune) {
    const forced = new Set(args.flatMap((a, i) => (a === "--force" && args[i + 1] !== undefined ? [args[i + 1]!] : [])));
    const interactive = deps.interactive ?? (process.stdin.isTTY === true && !json && !process.env.RT_BATCH);
    const ask = deps.confirm ?? (async (message: string) => (await import("../lib/ui/prompts.ts")).confirm({ message, destructive: true }));
    return migratePrune(plan, { json, team: args.includes("--team"), yes: args.includes("--yes"), forced, interactive, ask });
  }
  if (json) {
    console.log(JSON.stringify({ ok: plan.failures.length === 0, ...plan }));
  } else {
    console.log("");
    for (const w of plan.writes) console.log(`  ${bold}${w.key}${reset}  ${whereOf(w)}  would write ${w.storeName} from ${w.fromName}: ${shown(w.key, w.value)}`);
    for (const f of plan.failures) console.log(`  ${bold}${f.key}${reset}  ${whereOf(f)}  ${red}cannot migrate ${f.fromName}${reset}: ${f.message}`);
    for (const o of plan.older) console.log(renderOlder(o));
    if (plan.writes.length + plan.failures.length + plan.older.length === 0) console.log("  every stored key is under its current store name");
    console.log("");
  }
  if (plan.failures.length > 0) process.exitCode = 1;
}

function migrateWrite(plan: MigrationPlan, json: boolean): void {
  const written: MigrationPlan["writes"] = [];
  const errors: { key: string; file: string; repo?: string; error: string }[] = [];
  for (const w of plan.writes) {
    try {
      setSetting(w.key, w.value, w.scope, { ...(w.repo ? { repoIdentity: w.repo } : {}), ...(w.team ? { team: w.team } : {}) });
      written.push(w);
    } catch (err) {
      errors.push({ key: w.key, file: w.file, ...(w.repo ? { repo: w.repo } : {}), error: (err as Error).message });
    }
  }
  const ok = errors.length === 0 && plan.failures.length === 0;
  if (json) {
    console.log(JSON.stringify({ ok, written, errors, failures: plan.failures }));
  } else {
    console.log("");
    for (const w of written) console.log(`  ${bold}${w.key}${reset}  ${whereOf(w)}  wrote ${w.storeName} from ${w.fromName}`);
    for (const e of errors) console.log(`  ${bold}${e.key}${reset}  ${red}${e.error}${reset}`);
    for (const f of plan.failures) console.log(`  ${bold}${f.key}${reset}  ${whereOf(f)}  ${red}cannot migrate ${f.fromName}${reset}: ${f.message}`);
    if (written.length + errors.length + plan.failures.length === 0) console.log("  nothing to write");
    console.log("");
  }
  if (!ok) process.exitCode = 1;
}

async function migratePrune(
  plan: MigrationPlan,
  o: { json: boolean; team: boolean; yes: boolean; forced: Set<string>; interactive: boolean; ask: (message: string) => Promise<boolean> },
): Promise<void> {
  const refused: (OlderName & { reason: string })[] = [];
  const pruned: OlderName[] = [];
  const byFile = new Map<string, OlderName[]>();
  for (const n of plan.older) {
    if (n.scope === "team" && !o.team) refused.push({ ...n, reason: "team store: pass --team to prune it" });
    else if (n.label === "diverged" && !o.forced.has(n.key)) refused.push({ ...n, reason: `diverged: pass --force ${n.key} to delete it` });
    else byFile.set(n.file, [...(byFile.get(n.file) ?? []), n]);
  }
  for (const [file, names] of byFile) {
    const scope = names[0]!.scope;
    if (!o.json) {
      console.log(`\n  ${bold}${scope} store${reset}  ${dim}${file}${reset}`);
      for (const n of names) console.log(`    ${n.storeName}${n.repo ? `  (${n.repo})` : ""}  ${n.label}`);
      const versions = [...new Map(names.map((n) => [n.key, n.storeVersion])).entries()].map(([k, v]) => `${k} (storeVersion ${v})`);
      console.log(`    every reader of this store must know: ${versions.join(", ")}`);
    }
    const noun = names.length === 1 ? "name" : "names";
    const approved = o.yes || (o.interactive && (await o.ask(`Delete ${names.length} older store ${noun} from the ${scope} store (${file})?`)));
    if (!approved) {
      const reason = o.interactive ? "not confirmed" : "confirmation needed: run on a terminal, or pass --yes";
      for (const n of names) refused.push({ ...n, reason });
      continue;
    }
    for (const n of names) {
      if (n.label === "diverged" && !o.json) console.log(`  deleting diverged ${n.storeName}; its value was: ${shown(n.key, n.olderValue)}`);
      try {
        pruneStoreName(n.key, n.storeName, n.scope, { ...(n.repo ? { repoIdentity: n.repo } : {}), ...(n.team ? { team: n.team } : {}), force: n.label === "diverged" });
        pruned.push(n);
      } catch (err) {
        refused.push({ ...n, reason: (err as Error).message });
      }
    }
  }
  if (o.json) {
    console.log(JSON.stringify({ ok: refused.length === 0, pruned, refused }));
  } else {
    console.log("");
    for (const r of refused) console.log(`  ${bold}${r.key}${reset}  ${whereOf(r)}  ${r.storeName}: ${red}${r.reason}${reset}`);
    console.log(`  pruned ${pruned.length}, refused ${refused.length}`);
    console.log("");
  }
  if (refused.length > 0) process.exitCode = 1;
}
```

- [ ] **Step 5: Register the node and regenerate the reference**

In `lib/command-tree-def.ts`, add inside `settings.subcommands`, after `check`:

```ts
      migrate: {
        description: "Carry stored settings to each key's current store name; a dry run unless --write or --prune",
        module: "./commands/settings-keys.ts",
        fn: "settingsMigrate",
        args: [
          { name: "Write", flag: "--write", type: "boolean", default: false, hint: "Write each key's current store name from its migrated value where it is absent (additive)" },
          { name: "Prune", flag: "--prune", type: "boolean", default: false, hint: "Delete older store names labeled leftover or stale, after confirmation" },
          { name: "Team", flag: "--team", type: "boolean", default: false, hint: "Let --prune touch the team store" },
          { name: "Force", flag: "--force", type: "text", placeholder: "rt.roles", hint: "Let --prune delete this key's diverged older names (repeatable)" },
          { name: "Yes", flag: "--yes", type: "boolean", default: false, hint: "Confirm --prune without a prompt (non-interactive runs)" },
          { name: "JSON", flag: "--json", type: "boolean", default: false, hint: "Machine-readable output" },
        ],
      },
```

Run: `bun run docs:gen`
Expected: exit 0; `website/docs/reference/settings/migrate.mdx` created and the settings index page lists it.

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/migrate-stores.test.ts packages/rt-client/src/settings/__tests__/migrations-acceptance.test.ts commands/__tests__/settings-migrate.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/migrate-stores.test.ts packages/rt-client/src/settings/__tests__/migrations-acceptance.test.ts commands/__tests__/settings-migrate.test.ts lib/__tests__/picker-conformance.test.ts lib/__tests__/no-eager-tui.test.ts packages/rt-client/test`, `bun run docs:check`, `bun run picker:check`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/settings/migrate-stores.ts packages/rt-client/src/index.ts commands/settings-keys.ts lib/command-tree-def.ts website/docs/reference/settings packages/rt-client/src/settings/__tests__/migrate-stores.test.ts packages/rt-client/src/settings/__tests__/migrations-acceptance.test.ts commands/__tests__/settings-migrate.test.ts
git commit -m "feat(settings): rt settings migrate: dry run, --write, --prune with confirmation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: settings-kit: store names on the wire, diverged issues, `/prune`

**Files:**
- Modify: `packages/settings-kit/src/server.ts`, `packages/settings-kit/src/react.ts`
- Modify: `packages/settings-kit/src/__tests__/server.test.ts`

**Interfaces:**
- Consumes: Task 3's `ExplainRow` fields (`storeName`, `storedVersion`, `authored`, `olderNames`, `olderLabel`); Task 4's `pruneStoreName`, `PruneOpts`.
- Produces (the wire contract pinned with spec 2):
  - `ExplainRowWire` gains `storeName?`, `storedVersion?`, `olderLabel?`, `authored?` and `olderNames?: OlderNameWire[]` with `type OlderNameWire = { storeName: string; storedVersion: number; label: string; value?: unknown; authored?: unknown }`. For a secret def, `authored` is omitted and `olderNames` carry no `value` or `authored`.
  - `issues[]` gains, per diverged older name, `{ scope, file, repo?, kind: "diverged", path: [], message, storeName, olderValue, currentValue }` (`storeName` is the older name; `olderValue` its value migrated; `currentValue` the row's value); a secret def's diverged issue carries neither value. `stale` and `leftover` are never issues.
  - `POST {base}/prune` with `{ key, scope, repo?, storeName, force?, team? }`: same local-only and JSON gates as `/set`; 404 unknown key; 400 secret key, missing `storeName`, a name not in the store, or any `pruneStoreName` refusal (its message verbatim); 200 `{ rows, effective }` from a fresh explain, like `/unset`.
  - `RtSettingsApi` gains `pruneStoreName`.
  - `useSettingsScope(...)` gains `prune: (key: string, scope: string, storeName: string, opts?: { force?: boolean; repo?: string; team?: string }) => Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/settings-kit/src/__tests__/server.test.ts` (it reuses the file's `RT`, `get` and `post`; everything else is local to this block):

```ts
describe("versioned store names on the wire", () => {
  const FILE = "/home/user/settings.user.jsonc";
  const MIG_DEFS: Record<string, FakeDef> = {
    "t.rules": { key: "t.rules", type: "array", scopes: ["user"], merge: "replace", description: "Rules", repoScoped: true, schema: { type: "array" } },
    "t.staleRules": { key: "t.staleRules", type: "array", scopes: ["user"], merge: "replace", description: "Rules", schema: { type: "array" } },
    "t.secretRules": { key: "t.secretRules", type: "array", scopes: ["user"], merge: "replace", description: "Rules", secret: true },
  };
  const rowsFor = (key: string, label: "diverged" | "stale") => [
    { scope: "default", file: null, present: false },
    {
      scope: "user",
      file: FILE,
      present: true,
      value: [{ match: "herd/*" }],
      storeName: `${key}@2`,
      storedVersion: 2,
      authored: [{ match: "herd/*" }],
      olderLabel: label,
      olderNames: [{ storeName: key, storedVersion: 1, label, value: [{ match: "gate/*" }], authored: [{ pattern: "gate/*" }] }],
    },
  ];
  const pruneCalls: unknown[][] = [];
  const MIG_RT = {
    ...(RT as unknown as Record<string, unknown>),
    allDefs: () => Object.values(MIG_DEFS),
    getDef: (key: string) => MIG_DEFS[key],
    isMigrated: () => true,
    explainSetting: (key: string) => rowsFor(key, key === "t.staleRules" ? "stale" : "diverged"),
    repoSectionsFor: () => [],
    pruneStoreName: (...args: unknown[]) => {
      pruneCalls.push(args);
      if (args[1] === "t.rules@2") throw new Error('rt: "t.rules@2" is not an older store name of "t.rules"');
      return args[1] === "t.gone" ? { removed: false } : { removed: true, authored: [{ pattern: "gate/*" }] };
    },
  } as unknown as RtSettingsApi;
  const call = (req: Request) => settingsHandler(req, { rt: MIG_RT });

  beforeEach(() => {
    pruneCalls.length = 0;
  });

  test("/defs carries a diverged issue with storeName, olderValue and currentValue; stale is not an issue", async () => {
    const body = (await (await call(get("/api/settings/defs")))!.json()) as { defs: { key: string; issues: Record<string, unknown>[] }[] };
    const rules = body.defs.find((d) => d.key === "t.rules")!;
    expect(rules.issues).toEqual([
      expect.objectContaining({ scope: "user", file: FILE, kind: "diverged", path: [], storeName: "t.rules", olderValue: [{ match: "gate/*" }], currentValue: [{ match: "herd/*" }] }),
    ]);
    expect(typeof rules.issues[0]!.message).toBe("string");
    expect(body.defs.find((d) => d.key === "t.staleRules")!.issues).toEqual([]);
  });

  test("/explain rows carry storeName, storedVersion, authored and labeled older names", async () => {
    const body = (await (await call(get("/api/settings/explain/t.rules")))!.json()) as { rows: Record<string, unknown>[] };
    expect(body.rows[1]).toMatchObject({
      storeName: "t.rules@2",
      storedVersion: 2,
      authored: [{ match: "herd/*" }],
      olderLabel: "diverged",
      olderNames: [{ storeName: "t.rules", storedVersion: 1, label: "diverged", value: [{ match: "gate/*" }], authored: [{ pattern: "gate/*" }] }],
    });
    expect("storeName" in body.rows[0]!).toBe(false);
  });

  test("a secret def sends neither value on a diverged issue nor on its rows", async () => {
    const defs = (await (await call(get("/api/settings/defs")))!.json()) as { defs: { key: string; issues: Record<string, unknown>[] }[] };
    const issue = defs.defs.find((d) => d.key === "t.secretRules")!.issues[0]!;
    expect(issue).toMatchObject({ kind: "diverged", storeName: "t.secretRules" });
    expect("olderValue" in issue || "currentValue" in issue).toBe(false);
    const explain = (await (await call(get("/api/settings/explain/t.secretRules")))!.json()) as { rows: Record<string, unknown>[] };
    expect("authored" in explain.rows[1]!).toBe(false);
    expect(explain.rows[1]!.olderNames).toEqual([{ storeName: "t.secretRules", storedVersion: 1, label: "diverged" }]);
  });

  test("/prune calls pruneStoreName with the body and answers rows and effective", async () => {
    const res = (await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.rules", force: true, repo: "gitlab.example.com/acme/app" })))!;
    expect(res.status).toBe(200);
    expect(pruneCalls).toEqual([["t.rules", "t.rules", "user", { repoIdentity: "gitlab.example.com/acme/app", force: true }]]);
    const body = (await res.json()) as { rows: unknown[]; effective: unknown };
    expect(body.rows).toHaveLength(2);
    expect(body.effective).toBeDefined();
  });

  test("/prune answers 400 with rt's refusal, a missing storeName, or a name not in the store", async () => {
    const refused = (await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.rules@2" })))!;
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("is not an older store name");
    expect((await call(post("/api/settings/prune", { key: "t.rules", scope: "user" })))!.status).toBe(400);
    expect((await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.gone" })))!.status).toBe(400);
  });

  test("/prune is local-only, needs JSON, and refuses unknown and secret keys", async () => {
    expect((await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.rules" }, "settings.example.com")))!.status).toBe(403);
    const notJson = new Request("http://console.mattstack/api/settings/prune", { method: "POST", body: "x" });
    expect((await call(notJson))!.status).toBe(415);
    expect((await call(post("/api/settings/prune", { key: "t.nope", scope: "user", storeName: "t.nope" })))!.status).toBe(404);
    expect((await call(post("/api/settings/prune", { key: "t.secretRules", scope: "user", storeName: "t.secretRules" })))!.status).toBe(400);
    expect(pruneCalls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/settings-kit/src/__tests__/server.test.ts`
Expected: FAIL (no `diverged` issues; `/prune` falls through to `null`).

- [ ] **Step 3: Wire types, sanitizing and issues**

In `packages/settings-kit/src/server.ts`, add `pruneStoreName` to the rt-client import. Replace the `ExplainRowWire` type with:

```ts
/** One older store name beside the current one; values omitted for a secret def. */
export type OlderNameWire = { storeName: string; storedVersion: number; label: string; value?: unknown; authored?: unknown };

export type ExplainRowWire = Pick<
  ExplainRow,
  "scope" | "file" | "present" | "shadowed" | "invalid" | "nonconforming" | "storeName" | "storedVersion" | "olderLabel"
> & { value?: unknown; authored?: unknown; olderNames?: OlderNameWire[] };
```

Add `pruneStoreName: typeof pruneStoreName;` to `RtSettingsApi`, and `pruneStoreName,` to the default `rt` object inside `settingsHandler`.

In `sanitizeRows`, before `if (def.secret !== true && "value" in row) wire.value = row.value;` add:

```ts
    if (row.storeName !== undefined) wire.storeName = row.storeName;
    if (row.storedVersion !== undefined) wire.storedVersion = row.storedVersion;
    if (row.olderLabel) wire.olderLabel = row.olderLabel;
    if (row.olderNames) {
      wire.olderNames = row.olderNames.map((o) =>
        def.secret === true
          ? { storeName: o.storeName, storedVersion: o.storedVersion, label: o.label }
          : { storeName: o.storeName, storedVersion: o.storedVersion, label: o.label, value: o.value, authored: o.authored },
      );
    }
    if (def.secret !== true && "authored" in row) wire.authored = row.authored;
```

In `issuesFromRows`, after the `nonconforming` loop (still inside the row loop), add:

```ts
    for (const o of row.olderNames ?? []) {
      if (o.label !== "diverged") continue;
      const issue: WireIssue = {
        scope: row.scope,
        file: row.file,
        kind: "diverged",
        path: [],
        message: `older store name "${o.storeName}" changed after "${row.storeName ?? def.key}" was written`,
        storeName: o.storeName,
      };
      if (def.secret !== true) {
        issue.olderValue = o.value;
        issue.currentValue = row.value;
      }
      if (rowRepo) issue.repo = rowRepo;
      out.push(issue);
    }
```

- [ ] **Step 4: The `/prune` route**

In `settingsHandler`, add `path !== \`${base}/prune\` &&` to the route guard, update the route list in the handler's doc comment with `POST {base}/prune → { rows, effective } | { error }`, and add before the final `method not allowed` answer:

```ts
  if (path === `${base}/prune` && req.method === "POST") {
    const allow = opts.allowWrite ?? defaultAllowWrite;
    if (!allow(req)) return json({ error: "settings writes are local-only" }, 403);
    if (!isJsonBody(req)) return json({ error: "expected application/json" }, 415);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const key = typeof body?.key === "string" ? body.key : "";
    const scope = (typeof body?.scope === "string" ? body.scope : "") as SettingScope;
    const team = typeof body?.team === "string" ? body.team : undefined;
    const repo = normalizeRepo(typeof body?.repo === "string" ? body.repo : undefined);
    const storeName = typeof body?.storeName === "string" ? body.storeName : "";

    const def = rt.getDef(key);
    if (!def) return json({ error: `unknown setting "${key}"` }, 404);
    if (def.secret === true) return json({ error: "secret keys are not writable here" }, 400);
    if (!storeName) return json({ error: "storeName is required" }, 400);

    const pruneOpts: { team?: string; repoIdentity?: string; force: boolean } = { force: body?.force === true };
    if (team) pruneOpts.team = team;
    if (repo) pruneOpts.repoIdentity = repo;
    try {
      const { removed } = rt.pruneStoreName(key, storeName, scope, pruneOpts);
      if (!removed) return json({ error: `"${storeName}" is not in the ${scope} store` }, 400);
    } catch (err) {
      return json({ error: (err as Error).message }, 400);
    }
    const after = rt.explainSetting(key, { repoIdentity: repo ?? null });
    return json({ rows: sanitizeRows(def, after), effective: effectiveFromRows(def, after) });
  }
```


- [ ] **Step 5: `prune` in the React hook**

In `packages/settings-kit/src/react.ts`, add to `SettingsScopeState`:

```ts
  /** Remove one older store name of a key (spec 3's Remove the older name),
      then refetch so its issue clears. Resolves null on success, else the
      server's refusal message verbatim. */
  prune: (key: string, scope: string, storeName: string, opts?: { force?: boolean; repo?: string; team?: string }) => Promise<string | null>;
```

and after `unset` in `useSettingsScope`:

```ts
  const prune = useCallback(
    async (key: string, scope: string, storeName: string, opts: { force?: boolean; repo?: string; team?: string } = {}): Promise<string | null> => {
      setSaving(key);
      try {
        const res = await fetch(`${base}/prune`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, scope, storeName, force: opts.force === true, ...(opts.repo ? { repo: opts.repo } : {}), ...(opts.team ? { team: opts.team } : {}) }),
        });
        const body = (await res.json().catch(() => null)) as { effective?: EffectiveWire; error?: string } | null;
        if (!res.ok || !body?.effective) return body?.error ?? `remove failed: ${res.status}`;
        refresh();
        return null;
      } catch (err) {
        return (err as Error).message;
      } finally {
        setSaving(null);
      }
    },
    [base, refresh],
  );
```

and add `prune` to the object the hook returns.

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/settings-kit`
Expected: PASS.

- [ ] **Step 7: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/settings-kit`, `bun run --cwd packages/settings-kit build`.
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/settings-kit/src/server.ts packages/settings-kit/src/react.ts packages/settings-kit/src/__tests__/server.test.ts
git commit -m "feat(settings-kit): store names and diverged issues on the wire; POST /prune

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The lock carries migrations; CI and release acceptance

**Files:**
- Create: `packages/rt-client/src/settings/migrations/schemas.ts`
- Modify: `packages/rt-client/src/settings/schema-diff.ts`, `packages/rt-client/src/settings/schema-lock.ts`
- Modify: `commands/settings-schema.ts`, `lib/command-tree-def.ts` (`--shipped-ref`), `lib/release/preflight.ts`, `.github/workflows/checks.yml`
- Generated: `website/docs/reference/settings/schema/diff.mdx` (`bun run docs:gen`)
- Modify: `packages/rt-client/src/settings/__tests__/schema-lock.test.ts`, `commands/__tests__/settings-schema.test.ts`, `commands/__tests__/release-preflight.test.ts`

**Interfaces:**
- Consumes: plan 1's `classifyLockDiff`, `checkLockAgainst`, `readBreakingChanges`, `buildLock`, `toJsonSchema`, `checkSchemaLock(seams, tag)`; Task 1's `MIGRATION_STEPS`, `RENAMES`.
- Produces:
  - `migrations/schemas.ts` (dev): `interface MigrationSchema { key: string; version: number; schema: z.ZodType; examples: unknown[] }`; `MIGRATION_SCHEMAS: MigrationSchema[]` (empty) with the marker `// @draft-schemas`.
  - `schema-diff.ts`: `type LockEntry = { storeVersion: number; schema: JsonSchema; migrateFrom?: Record<string, JsonSchema>; renamedFrom?: string[] }`; `type Lock = Record<string, LockEntry>`; `equivalentSchemas(a, b): boolean` (no classifier-visible difference either way; annotations ignored, `const x` equals `enum [x]`, `required` order ignored); `interface AcceptanceOpts { shipped?: Lock | null; mode?: "ci" | "release" }`; `checkLockAgainst(prev, next, acknowledged, opts?: AcceptanceOpts): { ok: boolean; problems: string[] }`.
  - `buildLock()` writes `migrateFrom` (version string to JSON Schema) for every key with migration schemas (its own and its renamed keys'), and `renamedFrom` from `RENAMES`. With both registries empty the committed lock is unchanged.
  - `rt settings schema diff` gains `--shipped-ref <ref>` (default: the highest `v*` tag by version sort; none found means every key counts as shipped) and `deps.shippedLock` for tests; `--json` gains `shipped`.
  - Preflight `schema-lock` row runs the release rule and its ok detail lists `storeVersion bumps for the release notes: <key> <old> -> <new>, ...` when there are any.

- [ ] **Step 1: Write the failing tests**

In `packages/rt-client/src/settings/__tests__/schema-lock.test.ts`, replace the whole existing `describe("checkLockAgainst", ...)` block (plan 1's version: its bumped-and-acknowledged case now fails, because an acknowledgement no longer stands in for a migration) with:

```ts
describe("checkLockAgainst", () => {
  const entry = (schema: Record<string, unknown>, storeVersion = 1, migrateFrom?: Record<string, Record<string, unknown>>) => ({ storeVersion, schema, ...(migrateFrom ? { migrateFrom } : {}) });
  const V1 = { type: "string" };
  const V2 = { type: "number" };

  test("a breaking change with no migrateFrom entry fails, bumped or not, acknowledged or not", () => {
    expect(checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2) }, {}).ok).toBe(false);
    expect(checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2, 2) }, { "t.k": "why" }).problems).toEqual(["t.k: no migrateFrom entry for version 1"]);
  });

  test("a bump by one with an entry matching the previous lock passes", () => {
    expect(checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2, 2, { "1": V1 }) }, {})).toEqual({ ok: true, problems: [] });
  });

  test("an entry that differs classifier-visibly from the previous lock fails", () => {
    const r = checkLockAgainst({ "t.k": entry(V1) }, { "t.k": entry(V2, 2, { "1": { type: "boolean" } }) }, {});
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain("differs from the lock on main");
  });

  test("an enum/const round trip, annotations and required order are not differences", () => {
    const prev = { "t.k": entry({ type: "object", properties: { who: { type: "string", const: "human", description: "who" }, n: { type: "number" } }, required: ["who", "n"] }) };
    const was = { type: "object", properties: { who: { type: "string", enum: ["human"] }, n: { type: "number" } }, required: ["n", "who"] };
    expect(checkLockAgainst(prev, { "t.k": entry(V2, 2, { "1": was }) }, {}).ok).toBe(true);
  });

  test("CI allows one step per change; release accepts a chain spanning two bumps since the tag", () => {
    const tag = { "t.k": entry(V1) };
    const next = { "t.k": entry({ type: "boolean" }, 3, { "1": V1, "2": V2 }) };
    expect(checkLockAgainst(tag, next, {}, { mode: "ci" }).ok).toBe(false);
    expect(checkLockAgainst(tag, next, {}, { mode: "release" })).toEqual({ ok: true, problems: [] });
    expect(checkLockAgainst(tag, { "t.k": entry({ type: "boolean" }, 3, { "2": V2 }) }, {}, { mode: "release" }).problems).toEqual(["t.k: no migrateFrom entry for version 1"]);
  });

  test("the acknowledgement hatch covers only a key absent from the shipped lock, and never at release", () => {
    const prev = { "t.k": entry(V1) };
    const next = { "t.k": entry(V2) };
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: {} }).ok).toBe(true);
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: prev }).ok).toBe(false);
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: null }).ok).toBe(false);
    expect(checkLockAgainst(prev, next, { "t.k": "never released" }, { shipped: {}, mode: "release" }).ok).toBe(false);
  });

  test("a removed key passes when a key renamed from it keeps an equal schema, or when acknowledged", () => {
    const prev = { "t.old": entry(V1) };
    expect(checkLockAgainst(prev, {}, {}).ok).toBe(false);
    expect(checkLockAgainst(prev, {}, { "t.old": "retired" }).ok).toBe(true);
    expect(checkLockAgainst(prev, { "t.new": { ...entry(V1), renamedFrom: ["t.old"] } }, {}).ok).toBe(true);
    expect(checkLockAgainst(prev, { "t.new": { ...entry(V2), renamedFrom: ["t.old"] } }, {}).ok).toBe(false);
  });

  test("a storeVersion that goes down fails; an absent previous lock is all additions", () => {
    expect(checkLockAgainst({ "t.k": entry(V1, 2) }, { "t.k": entry(V1, 1) }, {}).ok).toBe(false);
    expect(checkLockAgainst({}, { "t.k": entry(V2) }, {}).ok).toBe(true);
  });
});

describe("migration schemas in the lock", () => {
  test("every runtime step has exactly one schema entry, and every schema entry a step", () => {
    const steps = MIGRATION_STEPS.map((s) => `${s.key}#${s.version}`).sort();
    const schemas = MIGRATION_SCHEMAS.map((m) => `${m.key}#${m.version}`).sort();
    expect(schemas).toEqual(steps);
    expect(new Set(schemas).size).toBe(schemas.length);
  });

  test("buildLock writes each step's source schema into its key's migrateFrom, and renames into renamedFrom", () => {
    MIGRATION_SCHEMAS.push({ key: "rt.eventRules", version: 1, schema: z.array(z.string()), examples: [] });
    RENAMES["rt.notify.eventBridges"] = ["rt.eventRules"];
    try {
      const built = buildLock()["rt.notify.eventBridges"]!;
      expect(built.migrateFrom?.["1"]).toMatchObject({ type: "array", items: { type: "string" } });
      expect(built.renamedFrom).toEqual(["rt.eventRules"]);
    } finally {
      MIGRATION_SCHEMAS.pop();
      delete RENAMES["rt.notify.eventBridges"];
    }
  });
});
```

and add to that file's imports:

```ts
import { MIGRATION_STEPS, RENAMES } from "../migrations/index.ts";
import { MIGRATION_SCHEMAS } from "../migrations/schemas.ts";
```

Add inside `describe("settingsSchemaDiff", ...)` in `commands/__tests__/settings-schema.test.ts`:

```ts
  test("--json reports the shipped ref whose lock the acknowledgement hatch reads", async () => {
    await settingsSchemaDiff(["--against", writeLock(buildLock()), "--shipped-ref", "HEAD", "--json"]);
    expect(JSON.parse(logs.join("\n")).shipped).toBe("HEAD");
  });

  test("an unknown --shipped-ref is an error, not an empty lock", async () => {
    const errors = await captureErrors(() => settingsSchemaDiff(["--against", writeLock(buildLock()), "--shipped-ref", "refs/tags/no-such-tag-for-schema-diff", "--json"]));
    expect(process.exitCode).toBe(1);
    expect(errors.some((e) => e.includes("no-such-tag-for-schema-diff"))).toBe(true);
  });
```

In `commands/__tests__/release-preflight.test.ts`, give `fakeSeams` a third parameter `committedLock: string = COMMITTED_LOCK` and make its `readFile` return `committedLock` (instead of `COMMITTED_LOCK`) for `join("/repo", LOCK_REL)`. Then add inside `describe("rt release preflight schema-lock row", ...)`:

```ts
  test("a bump since the tag with a matching migrateFrom entry is ok and lists the bump for the release notes", async () => {
    const tagLock = JSON.parse(COMMITTED_LOCK) as Record<string, { storeVersion: number; schema: Record<string, unknown> }>;
    const key = Object.keys(tagLock)[0]!;
    const bumped = { ...tagLock, [key]: { storeVersion: 2, schema: { type: "boolean" }, migrateFrom: { "1": tagLock[key]!.schema } } };
    const row = await schemaRow(fakeSeams("0.20.0", COMMITTED_LOCK, JSON.stringify(bumped)));
    expect(row?.status).toBe("ok");
    expect(row?.detail).toContain(`storeVersion bumps for the release notes: ${key} 1 -> 2`);
  });

  test("a bump since the tag with no migrateFrom entry is stale", async () => {
    const tagLock = JSON.parse(COMMITTED_LOCK) as Record<string, { storeVersion: number; schema: Record<string, unknown> }>;
    const key = Object.keys(tagLock)[0]!;
    const bumped = { ...tagLock, [key]: { storeVersion: 2, schema: { type: "boolean" } } };
    const row = await schemaRow(fakeSeams("0.20.0", COMMITTED_LOCK, JSON.stringify(bumped)));
    expect(row?.status).toBe("stale");
    expect(row?.detail).toContain(`${key}: no migrateFrom entry for version 1`);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts`
Expected: FAIL (`../migrations/schemas.ts` missing; `migrateFrom` not read; no `shipped`).

- [ ] **Step 3: The authoring-side schema registry**

Create `packages/rt-client/src/settings/migrations/schemas.ts`:

```ts
/**
 * The zod schema of each registered migration step's source version, with
 * values saved from real stores (invented data only, per repo purity).
 * Authoring only, like registry-schemas.ts: buildLock writes each schema
 * into the lock's migrateFrom as JSON Schema, which is what CI and release
 * preflight compare with the previous lock, and the proof test samples it.
 * One entry per MIGRATION_STEPS entry. `rt settings schema diff --draft`
 * inserts entries directly above the @draft marker; keep it.
 */

import { z } from "zod";

export interface MigrationSchema {
  key: string;
  version: number;
  schema: z.ZodType;
  examples: unknown[];
}

export const MIGRATION_SCHEMAS: MigrationSchema[] = [
  // @draft-schemas
];
```

- [ ] **Step 4: Lock entries, equivalence and the acceptance rule**

In `packages/rt-client/src/settings/schema-diff.ts`, replace the `Lock` type with:

```ts
export type LockEntry = {
  storeVersion: number;
  schema: JsonSchema;
  /** Source schema of each migration step, keyed by the version it reads. */
  migrateFrom?: Record<string, JsonSchema>;
  renamedFrom?: string[];
};
export type Lock = Record<string, LockEntry>;
```

Extend `norm` so `required` order never counts as a change:

```ts
function norm(s: JsonSchema): JsonSchema {
  const out = { ...s };
  if ("const" in out && !("enum" in out)) { out.enum = [out.const]; delete out.const; }
  if (Array.isArray(out.required)) out.required = [...(out.required as string[])].sort();
  return out;
}
```

Add:

```ts
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
```

and replace `checkLockAgainst` with:

```ts
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
      if (mode === "ci" && shipped !== null && !(key in shipped) && acknowledged[key]) continue;
      problems.push(`${key}: breaking (${detail}) needs storeVersion ${was.storeVersion + 1} and a migrateFrom entry for version ${was.storeVersion}`);
      continue;
    }
    problems.push(...chainProblems(key, was, now, mode, against));
  }
  return { ok: problems.length === 0, problems };
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
```

In `packages/rt-client/src/settings/schema-lock.ts`, re-export the new names (`equivalentSchemas`, `type LockEntry`, `type AcceptanceOpts`) beside the existing re-export, add

```ts
import { RENAMES } from "./migrations/index.ts";
import { MIGRATION_SCHEMAS } from "./migrations/schemas.ts";
```

and replace the loop body of `buildLock` with:

```ts
  for (const [key, schema] of Object.entries(SCHEMAS) as [string, z.ZodType][]) {
    const entry: LockEntry = { storeVersion: versions.get(key) ?? 1, schema: toJsonSchema(schema) };
    const owners = new Set([key, ...(RENAMES[key] ?? [])]);
    const steps = MIGRATION_SCHEMAS.filter((m) => owners.has(m.key)).sort((a, b) => a.version - b.version);
    if (steps.length > 0) entry.migrateFrom = Object.fromEntries(steps.map((m) => [String(m.version), toJsonSchema(m.schema)]));
    if (RENAMES[key]) entry.renamedFrom = [...RENAMES[key]!];
    out[key] = entry;
  }
```

(import `type LockEntry` from `./schema-diff.ts` alongside `Lock`).

- [ ] **Step 5: The CLI and the release preflight**

In `commands/settings-schema.ts`: add `shippedLock?: Lock | null` to `settingsSchemaDiff`'s existing `deps` type, keeping every field plan 1 gave it (its git seam `git?: Git` included; plan 1's own code and tests pass `deps.git`); add

```ts
function latestReleaseTag(repoRoot: string): string | null {
  const tags = spawnSync("git", ["tag", "--list", "v*", "--sort=-v:refname"], { cwd: repoRoot, encoding: "utf8" });
  if (tags.status !== 0) return null;
  return tags.stdout.split("\n").map((t) => t.trim()).find((t) => t !== "") ?? null;
}
```

and, after `prev` is resolved and checked, replace the `checkLockAgainst(...)` line with:

```ts
  const shippedRef = flagValue(args, "--shipped-ref") ?? latestReleaseTag(repoRoot);
  let shipped: Lock | null = null;
  if (deps.shippedLock !== undefined) shipped = deps.shippedLock;
  else if (shippedRef !== null) {
    const atRef = lockAtRef(shippedRef, repoRoot, deps.git ?? realGit);
    if (atRef instanceof Error) return fail(atRef.message);
    shipped = atRef;
  }
  const { ok, problems } = checkLockAgainst(prev, next, readBreakingChanges(), { shipped, mode: "ci" });
```

(`lockAtRef` takes plan 1's git seam as its third argument; use whatever name plan 1's module gives its real implementation, shown here as `realGit`, exactly as its existing `--against-ref` call does). Add `shipped: shippedRef` to the `--json` body: `console.log(JSON.stringify({ ok, shipped: shippedRef, changes, problems }, null, 2));`.

In `lib/command-tree-def.ts`, add to `settings.schema.diff.args`, before `JSON`:

```ts
              { name: "Shipped ref", flag: "--shipped-ref", type: "text", placeholder: "v2.14.0", hint: "The release whose lock says which keys have shipped (default: the highest v* tag); only a key absent there may take a breaking change on an acknowledgement" },
```

In `lib/release/preflight.ts` `checkSchemaLock`, replace the two lines from `const { ok, problems } = ...` through the `return ok ? ...` expression with:

```ts
    const tagLock = JSON.parse(shown.stdout) as Lock;
    const { ok, problems } = checkLockAgainst(tagLock, committed, acknowledged, { shipped: tagLock, mode: "release" });
    const bumps = Object.entries(committed)
      .filter(([k, e]) => tagLock[k] !== undefined && e.storeVersion > tagLock[k]!.storeVersion)
      .map(([k, e]) => `${k} ${tagLock[k]!.storeVersion} -> ${e.storeVersion}`);
    const notes = bumps.length > 0 ? `; storeVersion bumps for the release notes: ${bumps.join(", ")}` : "";
    return ok
      ? { id, label, status: "ok", detail: `no unmigrated breaking change since ${tag}${notes}` }
      : { id, label, status: "stale", detail: problems.join("; ") };
```

In `.github/workflows/checks.yml`, replace the classify step with:

```yaml
      # The checkout is shallow and on a PR holds only the merge commit, so
      # origin/main has to be fetched explicitly into its tracking ref. The
      # v* tags are fetched too: the latest release's lock says which keys
      # have shipped, and only a key that has not may skip a migration.
      - name: Settings schema changes are classified
        run: git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main '+refs/tags/v*:refs/tags/v*' && bun run cli.ts settings schema diff --against-ref origin/main
```

Run: `bun run docs:gen`
Expected: exit 0; the `schema diff` reference page gains `--shipped-ref`.

- [ ] **Step 6: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts`
Expected: PASS, including plan 1's `buildLock ... matches the committed lock byte for byte` (both migration registries are empty, so the lock is unchanged).

- [ ] **Step 7: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts packages/rt-client/test`, `bun run cli.ts settings schema lock`, `git diff --exit-code -- packages/rt-client/src/settings/schema.lock.json`, `bun run docs:check`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0 (the lock regenerates byte for byte).

- [ ] **Step 8: Commit**

```bash
git add packages/rt-client/src/settings/migrations/schemas.ts packages/rt-client/src/settings/schema-diff.ts packages/rt-client/src/settings/schema-lock.ts commands/settings-schema.ts lib/command-tree-def.ts lib/release/preflight.ts .github/workflows/checks.yml website/docs/reference/settings packages/rt-client/src/settings/__tests__/schema-lock.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/release-preflight.test.ts
git commit -m "feat(settings): a breaking schema change needs a bump and a matching migrateFrom, in CI and at release

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Sample values and the migration proof

**Files:**
- Create: `packages/rt-client/src/settings/sample-values.ts`, `packages/rt-client/src/settings/migration-proof.ts`
- Create: `packages/rt-client/src/settings/__tests__/sample-values.test.ts`, `packages/rt-client/src/settings/__tests__/migration-proof.test.ts`

**Interfaces:**
- Consumes: plan 1's `validateJson`, `layerJsonSchema`, `firstIssueText`, `hasSchema`, `toJsonSchema`; Task 1's `runChain`, `renamedHeir`; Task 2's `canonicalJson`; Task 8's `MIGRATION_SCHEMAS`.
- Produces:
  - `sampleValues(schema: JsonSchema, limit?: number): unknown[]`: deterministic; every value returned passes `schema`; covers the minimal object (required properties only), the full object, one variant per further sample of each property (every enum value and union branch), array lengths 0 to 2 (respecting `minItems`), record entries, and an extra property where extras are allowed. A keyword it cannot satisfy (`pattern`, `format`) yields fewer samples, never a wrong one.
  - `interface ProofFailure { sample: unknown; layer: boolean; message: string }`; `proveMigration(def: SettingDef & { schema: JsonSchema }, version: number, fromSchema: JsonSchema, examples: unknown[]): ProofFailure[]` (`[]` means proven). Full samples of a deep-merge key are overlaid on the registry default before the full-schema check; layer samples (and, for a deep key, examples) are checked against the layer schema. With no sample and no example it returns one failure asking for examples.

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/sample-values.test.ts`:

```ts
/**
 * sampleValues: deterministic samples that pass the schema they came from,
 * wide enough to exercise a migration: minimal and full objects, every enum
 * value and union branch, short arrays, records, extras.
 */

import { describe, expect, test } from "bun:test";
import { allDefs } from "../registry-machinery.ts";
import { hasSchema, validateJson } from "../schema.ts";
import { sampleValues } from "../sample-values.ts";

const SHAPE = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["a", "b"] },
    n: { anyOf: [{ type: "string" }, { type: "number" }] },
    tags: { type: "array", items: { type: "string" }, minItems: 1 },
    env: { type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "string" } },
  },
  required: ["kind"],
  additionalProperties: {},
};

describe("sampleValues", () => {
  test("every sample passes the schema it came from", () => {
    const samples = sampleValues(SHAPE);
    expect(samples.length).toBeGreaterThan(3);
    for (const s of samples) expect(validateJson(SHAPE, s)).toEqual([]);
  });

  test("covers the minimal object, every enum value, every union branch, records and extras", () => {
    const samples = sampleValues(SHAPE) as Record<string, unknown>[];
    expect(samples).toContainEqual({ kind: "a" });
    expect(samples.some((s) => s.kind === "b")).toBe(true);
    expect(samples.some((s) => typeof s.n === "string")).toBe(true);
    expect(samples.some((s) => typeof s.n === "number")).toBe(true);
    expect(samples.some((s) => s.env !== undefined && Object.keys(s.env as object).length > 0)).toBe(true);
    expect(samples.some((s) => "extraProperty" in s)).toBe(true);
  });

  test("is deterministic", () => {
    expect(sampleValues(SHAPE)).toEqual(sampleValues(SHAPE));
  });

  test("a pattern it cannot satisfy yields no sample rather than a wrong one", () => {
    expect(sampleValues({ type: "string", pattern: "^[0-9]{6}$" })).toEqual([]);
  });

  test("every registry schema, and every deep key's layer schema, yields at least one sample", () => {
    const empty = allDefs()
      .filter(hasSchema)
      .filter((d) => sampleValues(d.schema).length === 0 || (d.layerSchema !== undefined && sampleValues(d.layerSchema).length === 0))
      .map((d) => d.key);
    expect(empty).toEqual([]);
  });
});
```

Create `packages/rt-client/src/settings/__tests__/migration-proof.test.ts`:

```ts
/**
 * proveMigration: samples of a step's source schema, run up the chain, must
 * land in the current schema (layer schema for layer samples). A wrong or
 * throwing migration fails; so does every registered step that does not
 * carry its samples.
 */

import { describe, expect, test } from "bun:test";
import { getDef, type SettingDef } from "../registry-machinery.ts";
import type { JsonSchema } from "../schema.ts";
import { renamedHeir } from "../migrate.ts";
import { renameProperty } from "../migrations/helpers.ts";
import { MIGRATION_SCHEMAS } from "../migrations/schemas.ts";
import { toJsonSchema } from "../schema-lock.ts";
import { proveMigration } from "../migration-proof.ts";

type Proven = SettingDef & { schema: JsonSchema };
const def = (over: Partial<SettingDef>): Proven => ({ key: "t.k", type: "array", scopes: ["user"], merge: "replace", description: "test", schema: {}, ...over }) as Proven;

const V1_ITEMS = { type: "array", items: { type: "object", properties: { pattern: { type: "string" }, title: { type: "string" } }, required: ["pattern", "title"], additionalProperties: {} } };
const V2_ITEMS = { type: "array", items: { type: "object", properties: { match: { type: "string" }, title: { type: "string" } }, required: ["match", "title"], additionalProperties: {} } };
const rename = { version: 1, up: (v: unknown) => renameProperty(v, ["[]"], "pattern", "match") };

const SNAP_V1 = { type: "object", properties: { on: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["on", "debounceSec"], additionalProperties: {} };
const SNAP_V2 = { type: "object", properties: { enabled: { type: "boolean" }, debounceSec: { type: "number" } }, required: ["enabled", "debounceSec"], additionalProperties: {} };

describe("proveMigration", () => {
  test("a correct migration passes over its samples", () => {
    expect(proveMigration(def({ storeVersion: 2, schema: V2_ITEMS, migrateFrom: [rename] }), 1, V1_ITEMS, [])).toEqual([]);
  });

  test("a wrong migration fails, naming the path", () => {
    const failures = proveMigration(def({ storeVersion: 2, schema: V2_ITEMS, migrateFrom: [{ version: 1, up: (v) => v }] }), 1, V1_ITEMS, []);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.message).toContain('required property "match" is missing');
  });

  test("a throwing migration fails with the step named", () => {
    const failures = proveMigration(def({ storeVersion: 2, schema: V2_ITEMS, migrateFrom: [{ version: 1, up: () => { throw new Error("boom"); } }] }), 1, V1_ITEMS, []);
    expect(failures[0]!.message).toBe("migration 1 -> 2 threw: boom");
  });

  test("a correct deep migration passes over full samples (on the default) and layer samples", () => {
    const deep = def({ type: "object", merge: "deep", default: { enabled: false, debounceSec: 5 }, storeVersion: 2, schema: SNAP_V2, migrateFrom: [{ version: 1, up: (v) => renameProperty(v, [], "on", "enabled") }] });
    expect(proveMigration(deep, 1, SNAP_V1, [])).toEqual([]);
  });

  test("a wrong deep migration fails on a layer sample", () => {
    const v1 = { ...SNAP_V2, properties: { enabled: { type: "boolean" }, debounceSec: { type: "string" } } };
    const deep = def({ type: "object", merge: "deep", default: { enabled: false, debounceSec: 5 }, storeVersion: 2, schema: SNAP_V2, migrateFrom: [{ version: 1, up: (v) => v }] });
    expect(proveMigration(deep, 1, v1, []).some((f) => f.layer)).toBe(true);
  });

  test("a source schema no sample can satisfy needs examples", () => {
    const d = def({ type: "string", storeVersion: 2, schema: { type: "number" }, migrateFrom: [{ version: 1, up: (v) => Number(v) }] });
    expect(proveMigration(d, 1, { type: "string", pattern: "^[0-9]{6}$" }, [])[0]!.message).toBe("no sample value passes the version 1 schema; add examples");
    expect(proveMigration(d, 1, { type: "string", pattern: "^[0-9]{6}$" }, ["123456"])).toEqual([]);
  });
});

describe("registered migrations", () => {
  test("every registered step lands every sample and example in the current schema", () => {
    for (const m of MIGRATION_SCHEMAS) {
      const d = getDef(m.key) ?? renamedHeir(m.key);
      expect(d?.schema, `${m.key}: no current schema`).toBeDefined();
      expect(proveMigration(d as Proven, m.version, toJsonSchema(m.schema), m.examples), `${m.key} from version ${m.version}`).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/sample-values.test.ts packages/rt-client/src/settings/__tests__/migration-proof.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: The generator**

Create `packages/rt-client/src/settings/sample-values.ts`:

```ts
/**
 * Deterministic sample values for a JSON Schema over spec 1's keyword set,
 * for proving migrations. Candidates are kept only if they pass the schema,
 * so a keyword the generator cannot satisfy (a `pattern`, a `format`)
 * yields fewer samples, never a wrong one. Zod-free.
 */

import { canonicalJson } from "./migrate.ts";
import { validateJson, type JsonSchema } from "./schema.ts";

const PER_NODE = 6;
const MAX_DEPTH = 6;

const isSchema = (v: unknown): v is JsonSchema => v !== null && typeof v === "object" && !Array.isArray(v);

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
  if ("const" in s) return [s.const];
  if (Array.isArray(s.enum)) return [...s.enum];
  const branches = Array.isArray(s.anyOf) ? s.anyOf : Array.isArray(s.oneOf) ? s.oneOf : null;
  if (branches) return (branches as JsonSchema[]).flatMap((b) => gen(b, depth + 1).slice(0, PER_NODE));
  const types = s.type === undefined ? inferTypes(s) : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
  return types.flatMap((t) => genType(t, s, depth));
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
  const items = isSchema(s.items) ? gen(s.items, depth + 1).slice(0, PER_NODE) : s.items === false ? [] : ["value"];
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
  const samples = Object.fromEntries(Object.entries(props).map(([k, p]) => [k, gen(p, depth + 1).slice(0, PER_NODE)]));
  const firstOf = (names: string[]) => Object.fromEntries(names.filter((n) => samples[n]!.length > 0).map((n) => [n, structuredClone(samples[n]![0])]));
  const minimal = firstOf(Object.keys(props).filter((n) => required.has(n)));
  const full = firstOf(Object.keys(props));
  const out: unknown[] = [minimal, full];
  for (const [name, values] of Object.entries(samples)) for (const v of values.slice(1)) out.push({ ...full, [name]: structuredClone(v) });
  const extras = s.additionalProperties;
  if (isSchema(extras) && Object.keys(extras).length > 0) {
    for (const v of gen(extras, depth + 1).slice(0, PER_NODE)) out.push({ ...full, [recordKey(s)]: v });
  } else if (extras === undefined || extras === true || (isSchema(extras) && Object.keys(extras).length === 0)) {
    out.push({ ...full, extraProperty: "extra" });
  }
  return out;
}
```

- [ ] **Step 4: The proof**

Create `packages/rt-client/src/settings/migration-proof.ts`:

```ts
/**
 * Proves one migration step: samples of the step's source schema (and, for
 * a deep-merge key, of its layer form) plus saved examples, run up the rest
 * of the chain, must land in the current schema. A full sample of a deep
 * key is overlaid on the registry default first, because a store holds one
 * layer of it, never the merged whole. Authoring and CI only.
 */

import { runChain } from "./migrate.ts";
import type { SettingDef } from "./registry-machinery.ts";
import { sampleValues } from "./sample-values.ts";
import { firstIssueText, layerJsonSchema, validateJson, type JsonSchema } from "./schema.ts";

export interface ProofFailure {
  sample: unknown;
  layer: boolean;
  message: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

function overlayDeep(base: unknown, over: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? overlayDeep(out[k], v) : v;
  return out;
}

export function proveMigration(def: SettingDef & { schema: JsonSchema }, version: number, fromSchema: JsonSchema, examples: unknown[]): ProofFailure[] {
  const deep = def.merge === "deep" && def.type === "object";
  const full = sampleValues(fromSchema);
  if (full.length === 0 && examples.length === 0) {
    return [{ sample: undefined, layer: false, message: `no sample value passes the version ${version} schema; add examples` }];
  }
  const runs = [
    ...full.map((value) => ({ value, layer: false })),
    ...examples.map((value) => ({ value, layer: deep })),
    ...(deep ? sampleValues(layerJsonSchema(fromSchema)).map((value) => ({ value, layer: true })) : []),
  ];
  const layerSchema = deep ? layerJsonSchema(def.schema) : def.schema;
  const failures: ProofFailure[] = [];
  for (const run of runs) {
    const out = runChain(def, run.value, version);
    if (!out.ok) {
      failures.push({ sample: run.value, layer: run.layer, message: out.message });
      continue;
    }
    const value = deep && !run.layer ? overlayDeep(def.default, out.value) : out.value;
    const issues = validateJson(run.layer ? layerSchema : def.schema, value);
    if (issues.length > 0) failures.push({ sample: run.value, layer: run.layer, message: firstIssueText(issues) });
  }
  return failures;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/sample-values.test.ts packages/rt-client/src/settings/__tests__/migration-proof.test.ts`
Expected: PASS. If the registry-wide sample test names a key, the generator is missing a shape that key's schema uses: extend `genType`/`genObject` for it (never special-case the key) and rerun.

- [ ] **Step 6: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/sample-values.test.ts packages/rt-client/src/settings/__tests__/migration-proof.test.ts packages/rt-client/test`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0 (`no-zod-in-dist` stays green: neither module is imported by `index.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/rt-client/src/settings/sample-values.ts packages/rt-client/src/settings/migration-proof.ts packages/rt-client/src/settings/__tests__/sample-values.test.ts packages/rt-client/src/settings/__tests__/migration-proof.test.ts
git commit -m "feat(settings): sample values and a proof that every migration lands in the current schema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Rebuilding zod from the lock

**Files:**
- Create: `packages/rt-client/src/settings/zod-source.ts`
- Create: `packages/rt-client/src/settings/__tests__/zod-source.test.ts`

**Interfaces:**
- Consumes: Task 8's `equivalentSchemas`; plan 1's `toJsonSchema` and the committed `schema.lock.json`.
- Produces: `zodSource(schema: JsonSchema): string`, zod v4 source text whose `toJsonSchema` output is `equivalentSchemas` to the input for every schema in the committed lock. Covered: `const` (`z.literal`), string `enum` (`z.enum`), other `enum` (union of literals), `anyOf` (`z.union`), `oneOf` (`z.union`, flagged), type arrays, `string` (`min`, `max`, `regex`), `number` (`min`, `max`, `gt`, `lt`), `integer`, `boolean`, `null`, `array` (`items`, `minItems`, `maxItems`, `prefixItems` as `z.tuple`), `object` (`z.record` for `propertyNames` or a value schema with no properties; `z.looseObject` for `additionalProperties: {}` or `true`; `z.strictObject` for `false`; `.catchall` for a value schema beside properties; else `z.object`), `{}` (`z.unknown()`). Any other non-annotation keyword is appended as `/* not rebuilt: <keywords> */`.

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/zod-source.test.ts`:

```ts
/**
 * zodSource: zod source rebuilt from a lock's JSON Schema must convert back
 * to an equivalent schema, for every key in the committed lock, so a
 * drafted migrateFrom entry passes the CI acceptance rule unedited.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import LOCK from "../schema.lock.json" with { type: "json" };
import { equivalentSchemas } from "../schema-diff.ts";
import { toJsonSchema } from "../schema-lock.ts";
import { zodSource } from "../zod-source.ts";

const rebuild = (src: string) => new Function("z", `return ${src};`)(z) as z.ZodType;
const roundTrips = (json: Record<string, unknown>) => equivalentSchemas(toJsonSchema(rebuild(zodSource(json))), json);

const FIXTURES: [Record<string, unknown>, string][] = [
  [{ type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "string" } }, "z.record(z.string(), z.string())"],
  [{ type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: {} }, "z.looseObject({ a: z.string() })"],
  [{ type: "object", properties: { a: { type: "number" } }, additionalProperties: false }, "z.strictObject({ a: z.number().optional() })"],
  [{ type: "string", const: "human" }, 'z.literal("human")'],
  [{ type: "string", enum: ["a", "b"] }, 'z.enum(["a","b"])'],
  [{ anyOf: [{ type: "string" }, { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: {} }] }, "z.union([z.string(), z.looseObject({ a: z.string() })])"],
  [{ type: "number", exclusiveMinimum: 0 }, "z.number().gt(0)"],
  [{ type: "array", items: { type: "string" }, minItems: 1 }, "z.array(z.string()).min(1)"],
  [{ type: "string", minLength: 1 }, "z.string().min(1)"],
];

describe("zodSource", () => {
  for (const [json, src] of FIXTURES) {
    test(`${src} is rebuilt and round-trips`, () => {
      expect(zodSource(json)).toBe(src);
      expect(roundTrips(json)).toBe(true);
    });
  }

  test("a keyword outside the covered set is flagged for review", () => {
    expect(zodSource({ type: "string", format: "email" })).toBe("z.string() /* not rebuilt: format */");
  });

  test("every schema in the committed lock rebuilds to an equivalent zod schema", () => {
    const lock = LOCK as Record<string, { schema: Record<string, unknown> }>;
    expect(Object.keys(lock).filter((k) => !roundTrips(lock[k]!.schema))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/zod-source.test.ts`
Expected: FAIL, `Cannot find module '../zod-source.ts'`.

- [ ] **Step 3: Implement**

Create `packages/rt-client/src/settings/zod-source.ts`:

```ts
/**
 * Rebuilds zod v4 source from a lock's JSON Schema, so a drafted migration
 * can carry its source version's schema. Covers spec 1's keyword set;
 * anything else is appended as a marked comment for review, and the CI
 * acceptance rule stays red until the rebuilt schema matches the lock.
 * Authoring only.
 */

import type { JsonSchema } from "./schema.ts";

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description", "default", "examples", "labels", "placeholder", "deprecated", "readOnly", "writeOnly"]);
const HANDLED = new Set([
  "type", "properties", "required", "additionalProperties", "propertyNames", "items", "prefixItems", "enum", "const", "anyOf", "oneOf",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern",
]);

const isSchema = (v: unknown): v is JsonSchema => v !== null && typeof v === "object" && !Array.isArray(v);
const bound = (method: string, v: unknown) => (typeof v === "number" ? `.${method}(${v})` : "");
const propKey = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name));

export function zodSource(s: JsonSchema): string {
  const extra = Object.keys(s).filter((k) => !HANDLED.has(k) && !ANNOTATIONS.has(k));
  return `${build(s)}${extra.length > 0 ? ` /* not rebuilt: ${extra.join(", ")} */` : ""}`;
}

function build(s: JsonSchema): string {
  if ("const" in s) return `z.literal(${JSON.stringify(s.const)})`;
  if (Array.isArray(s.enum)) {
    return s.enum.every((v) => typeof v === "string")
      ? `z.enum(${JSON.stringify(s.enum)})`
      : `z.union([${s.enum.map((v) => `z.literal(${JSON.stringify(v)})`).join(", ")}])`;
  }
  if (Array.isArray(s.anyOf)) return `z.union([${(s.anyOf as JsonSchema[]).map(zodSource).join(", ")}])`;
  if (Array.isArray(s.oneOf)) return `z.union([${(s.oneOf as JsonSchema[]).map(zodSource).join(", ")}]) /* oneOf in the lock */`;
  if (Array.isArray(s.type)) return `z.union([${(s.type as string[]).map((t) => build({ ...s, type: t })).join(", ")}])`;
  switch (s.type) {
    case "string":
      return `z.string()${bound("min", s.minLength)}${bound("max", s.maxLength)}${typeof s.pattern === "string" ? `.regex(new RegExp(${JSON.stringify(s.pattern)}))` : ""}`;
    case "number":
      return `z.number()${numberBounds(s)}`;
    case "integer":
      return `z.number().int()${numberBounds(s)}`;
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array":
      return arraySource(s);
    case "object":
      return objectSource(s);
    default:
      return "z.unknown()";
  }
}

function numberBounds(s: JsonSchema): string {
  return `${bound("min", s.minimum)}${bound("max", s.maximum)}${bound("gt", s.exclusiveMinimum)}${bound("lt", s.exclusiveMaximum)}`;
}

function arraySource(s: JsonSchema): string {
  if (Array.isArray(s.prefixItems)) {
    const rest = isSchema(s.items) ? `, ${zodSource(s.items)}` : "";
    return `z.tuple([${(s.prefixItems as JsonSchema[]).map(zodSource).join(", ")}]${rest})`;
  }
  const item = isSchema(s.items) ? zodSource(s.items) : "z.unknown()";
  return `z.array(${item})${bound("min", s.minItems)}${bound("max", s.maxItems)}`;
}

function objectSource(s: JsonSchema): string {
  const props = (isSchema(s.properties) ? s.properties : {}) as Record<string, JsonSchema>;
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  const extras = s.additionalProperties;
  const valueSchema = isSchema(extras) && Object.keys(extras).length > 0;
  if (Object.keys(props).length === 0 && (s.propertyNames !== undefined || valueSchema)) {
    const keys = isSchema(s.propertyNames) ? zodSource(s.propertyNames) : "z.string()";
    return `z.record(${keys}, ${isSchema(extras) ? zodSource(extras) : "z.unknown()"})`;
  }
  const shape = Object.entries(props).map(([name, p]) => `${propKey(name)}: ${zodSource(p)}${required.has(name) ? "" : ".optional()"}`);
  const body = `{ ${shape.join(", ")} }`;
  if (extras === false) return `z.strictObject(${body})`;
  if (extras === true || (isSchema(extras) && !valueSchema)) return `z.looseObject(${body})`;
  if (valueSchema) return `z.object(${body}).catchall(${zodSource(extras as JsonSchema)})`;
  return `z.object(${body})`;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/zod-source.test.ts`
Expected: PASS. If the committed-lock test names keys, print `zodSource` and the converted schema for one of them, find the construct whose conversion differs (for example what `z.object` emits for `additionalProperties` in input mode), fix `build`/`objectSource` for that construct, and rerun until the list is empty. Never exclude a key from the test.

- [ ] **Step 5: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/zod-source.test.ts packages/rt-client/test`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/rt-client/src/settings/zod-source.ts packages/rt-client/src/settings/__tests__/zod-source.test.ts
git commit -m "feat(settings): rebuild zod source from the schema lock for drafted migrations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Drafting: `rt settings schema diff --draft`

**Files:**
- Create: `packages/rt-client/src/settings/schema-draft.ts`, `lib/settings/schema-draft.ts` (barrel)
- Modify: `commands/settings-schema.ts` (`--draft`), `lib/command-tree-def.ts`
- Generated: `website/docs/reference/settings/schema/diff.mdx` (`bun run docs:gen`)
- Create: `packages/rt-client/src/settings/__tests__/schema-draft.test.ts`
- Modify: `commands/__tests__/settings-schema.test.ts`

**Interfaces:**
- Consumes: Task 10's `zodSource`; Task 8's `classifyLockDiff`, `equivalentSchemas`, `checkLockAgainst`, `Lock`, `LockEntry`; Task 1's helpers and the `@draft-steps` / `@draft-renames` markers; Task 8's `@draft-schemas` marker.
- Produces:
  - `type Op = { op: "rename"; path: string[]; from: string; to: string; schema: JsonSchema; required: boolean } | { op: "delete"; path: string[]; name: string } | { op: "default"; path: string[]; name: string; value: unknown; schema: JsonSchema } | { op: "optional"; path: string[]; name: string; schema: JsonSchema }`
  - `type Draft = { kind: "step"; key: string; version: number; schemaSource: string; upSource: string; notes: string[] } | { kind: "rename"; key: string; from: string; notes: string[] }`
  - `draftMigrations(prev: Lock, next: Lock, isDeep?: (key: string) => boolean): Draft[]`: one `rename` draft per removed key whose schema equals an added key's (unless already listed in its `renamedFrom`); one `step` draft (version = previous storeVersion) per key with a breaking change and no `migrateFrom` entry for that version. The `up` is mechanical only when replaying its operations on the previous schema reproduces the new one exactly; otherwise it throws `TODO`. For a deep-merge key no `setDefault` is drafted (a layer stays partial).
  - `applyDrafts(drafts, files: { index: string; schemas: string }): { index: string; schemas: string }` (inserts above the markers, keeping their indentation; throws when a marker is missing)
  - `MIGRATIONS_INDEX_PATH`, `MIGRATION_SCHEMAS_PATH`
  - CLI: `rt settings schema diff --draft` writes the drafts into both files (paths injectable through `deps.migrationsIndexPath` / `deps.migrationSchemasPath`), prints each draft with its notes, and `--json` gains `drafts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/rt-client/src/settings/__tests__/schema-draft.test.ts`:

```ts
/**
 * Drafting: one case per row of spec 3's drafting table, the insertion into
 * the two migration files, and spec 3's first acceptance bullet on the real
 * rt.notify.eventBridges lock entry.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import LOCK from "../schema.lock.json" with { type: "json" };
import * as helpers from "../migrations/helpers.ts";
import { checkLockAgainst, equivalentSchemas, type Lock } from "../schema-diff.ts";
import { toJsonSchema } from "../schema-lock.ts";
import { applyDrafts, draftMigrations, type Draft } from "../schema-draft.ts";

const evalUp = (src: string) =>
  new Function("renameProperty", "deleteProperty", "setDefault", `return ${src};`)(helpers.renameProperty, helpers.deleteProperty, helpers.setDefault) as (v: unknown) => unknown;
const rebuild = (src: string) => new Function("z", `return ${src};`)(z) as z.ZodType;
const obj = (properties: Record<string, unknown>, required: string[] = [], extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
  ...extra,
});
const str = { type: "string" };
const onlyStep = (drafts: Draft[]) => {
  expect(drafts).toHaveLength(1);
  const d = drafts[0]!;
  if (d.kind !== "step") throw new Error("expected a step draft");
  return d;
};

describe("draftMigrations", () => {
  test("a new required property with a default: the step sets the default", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ a: str, b: { type: "number", default: 5 } }, ["a", "b"]) } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(d.version).toBe(1);
    expect(evalUp(d.upSource)({ a: "x" })).toEqual({ a: "x", b: 5 });
    expect(d.notes).toEqual([]);
  });

  test("a property removed from a closed object: the step deletes it", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ a: str, b: str }, [], { additionalProperties: false }) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ a: str }, [], { additionalProperties: false }) } };
    expect(evalUp(onlyStep(draftMigrations(prev, next)).upSource)({ a: "x", b: "y" })).toEqual({ a: "x" });
  });

  test("one property removed and one of the same type added: a rename, flagged for confirmation", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: { type: "array", items: obj({ pattern: str, category: str }, ["pattern", "category"]) } } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: { type: "array", items: obj({ match: str, category: str }, ["match", "category"]) } } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(evalUp(d.upSource)([{ pattern: "p", category: "c" }])).toEqual([{ category: "c", match: "p" }]);
    expect(d.notes.join("\n")).toContain("confirm it is a rename");
  });

  test("a key renamed with an equal schema: a renamedFrom entry and no step", () => {
    const prev: Lock = { "t.old": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    const next: Lock = { "t.new": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    expect(draftMigrations(prev, next)).toEqual([{ kind: "rename", key: "t.new", from: "t.old", notes: [] }]);
  });

  test("anything else (an enum value removed): a step that throws TODO until written", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: { type: "string", enum: ["a", "b"] } } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: { type: "string", enum: ["a"] } } };
    const d = onlyStep(draftMigrations(prev, next));
    expect(() => evalUp(d.upSource)("a")).toThrow("TODO");
    expect(d.notes.join("\n")).toContain("not mechanical");
  });

  test("a deep-merge key gets no default written into its layers", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: obj({ a: str }, ["a"]) } };
    const next: Lock = { "t.k": { storeVersion: 2, schema: obj({ a: str, b: { type: "number", default: 5 } }, ["a", "b"]) } };
    const d = onlyStep(draftMigrations(prev, next, () => true));
    expect(evalUp(d.upSource)({ a: "x" })).toEqual({ a: "x" });
    expect(d.notes.join("\n")).toContain("deep-merge key");
  });

  test("an unbumped key gets a note to bump it; an already drafted one is skipped", () => {
    const prev: Lock = { "t.k": { storeVersion: 1, schema: { type: "string", enum: ["a", "b"] } } };
    expect(onlyStep(draftMigrations(prev, { "t.k": { storeVersion: 1, schema: { type: "string", enum: ["a"] } } })).notes[0]).toContain("set storeVersion: 2");
    expect(draftMigrations(prev, { "t.k": { storeVersion: 2, schema: { type: "string", enum: ["a"] }, migrateFrom: { "1": prev["t.k"]!.schema } } })).toEqual([]);
  });

  test("the drafted source schema rebuilds to the previous lock's schema", () => {
    const was = obj({ pattern: str, n: { type: "number" } }, ["pattern"], { additionalProperties: {} });
    const d = onlyStep(draftMigrations({ "t.k": { storeVersion: 1, schema: was } }, { "t.k": { storeVersion: 2, schema: { type: "string" } } }));
    expect(equivalentSchemas(toJsonSchema(rebuild(d.schemaSource)), was)).toBe(true);
  });
});

describe("applyDrafts", () => {
  const INDEX = ["export const MIGRATION_STEPS = [", "  // @draft-steps", "];", "export const RENAMES = {", "  // @draft-renames", "};", ""].join("\n");
  const SCHEMAS = ["export const MIGRATION_SCHEMAS = [", "  // @draft-schemas", "];", ""].join("\n");

  test("inserts each draft above its marker at the marker's indentation", () => {
    const files = applyDrafts(
      [
        { kind: "step", key: "t.k", version: 1, schemaSource: "z.string()", upSource: "(value) => value", notes: [] },
        { kind: "rename", key: "t.new", from: "t.old", notes: [] },
      ],
      { index: INDEX, schemas: SCHEMAS },
    );
    expect(files.index).toBe(
      [
        "export const MIGRATION_STEPS = [",
        "  {",
        '    key: "t.k",',
        "    version: 1,",
        "    up: (value) => value,",
        "  },",
        "  // @draft-steps",
        "];",
        "export const RENAMES = {",
        '  "t.new": ["t.old"],',
        "  // @draft-renames",
        "};",
        "",
      ].join("\n"),
    );
    expect(files.schemas).toContain('    key: "t.k",\n    version: 1,\n    schema: z.string(),\n    examples: [],\n  },\n  // @draft-schemas');
  });

  test("a missing marker is an error", () => {
    expect(() => applyDrafts([{ kind: "rename", key: "t.new", from: "t.old", notes: [] }], { index: "export const X = 1;\n", schemas: SCHEMAS })).toThrow('draft marker "// @draft-renames" not found');
  });
});

describe("spec 3 acceptance: renaming a property on rt.notify.eventBridges", () => {
  test("CI fails until storeVersion is 2 with a migrateFrom entry; --draft proposes the rename; with it filled in, CI passes", () => {
    const key = "rt.notify.eventBridges";
    const was = (LOCK as Lock)[key]!;
    const renamed = structuredClone(was.schema) as { items: { properties: Record<string, unknown>; required: string[] } };
    renamed.items.properties = Object.fromEntries(Object.entries(renamed.items.properties).map(([k, v]) => [k === "pattern" ? "match" : k, v]));
    renamed.items.required = renamed.items.required.map((r) => (r === "pattern" ? "match" : r));
    const prev: Lock = { [key]: was };

    expect(checkLockAgainst(prev, { [key]: { storeVersion: 1, schema: renamed } }, {}).ok).toBe(false);
    const d = onlyStep(draftMigrations(prev, { [key]: { storeVersion: 2, schema: renamed } }));
    expect(d.version).toBe(1);
    expect(d.upSource).toContain('renameProperty(v, ["[]"], "pattern", "match")');
    const filled: Lock = { [key]: { storeVersion: 2, schema: renamed, migrateFrom: { "1": toJsonSchema(rebuild(d.schemaSource)) } } };
    expect(checkLockAgainst(prev, filled, {})).toEqual({ ok: true, problems: [] });
  });
});
```

Add inside `describe("settingsSchemaDiff", ...)` in `commands/__tests__/settings-schema.test.ts` (add `copyFileSync` to its `fs` import and `import { MIGRATIONS_INDEX_PATH, MIGRATION_SCHEMAS_PATH } from "../../lib/settings/schema-draft.ts";`):

```ts
  test("--draft writes a step for a breaking change into copies of the two migration files", async () => {
    const built = buildLock();
    const key = Object.keys(built)[0]!;
    const prev = { ...built, [key]: { ...built[key]!, schema: { type: "boolean" } } };
    const indexPath = join(dir, "index.ts");
    const schemasPath = join(dir, "schemas.ts");
    copyFileSync(MIGRATIONS_INDEX_PATH, indexPath);
    copyFileSync(MIGRATION_SCHEMAS_PATH, schemasPath);

    await settingsSchemaDiff(["--against", writeLock(prev), "--draft", "--json"], { migrationsIndexPath: indexPath, migrationSchemasPath: schemasPath });

    const body = JSON.parse(logs.join("\n")) as { drafts: { kind: string; key: string }[] };
    expect(body.drafts).toContainEqual(expect.objectContaining({ kind: "step", key }));
    expect(readFileSync(indexPath, "utf8")).toContain(`key: ${JSON.stringify(key)}`);
    expect(readFileSync(schemasPath, "utf8")).toContain("schema: z.boolean()");
    expect(process.exitCode).toBe(1);
  });
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-draft.test.ts commands/__tests__/settings-schema.test.ts`
Expected: FAIL, `Cannot find module '../schema-draft.ts'`.

- [ ] **Step 3: Implement the drafter**

Create `packages/rt-client/src/settings/schema-draft.ts`:

```ts
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
import type { JsonSchema } from "./schema.ts";
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

const isSchema = (v: unknown): v is JsonSchema => v !== null && typeof v === "object" && !Array.isArray(v);
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
```

Create the barrel `lib/settings/schema-draft.ts`:

```ts
// Migration drafting lives in @mattstack/rt-client (authoring only); the rt
// CLI reaches it through this re-export barrel.
export * from "../../packages/rt-client/src/settings/schema-draft.ts";
```

- [ ] **Step 4: The `--draft` flag**

In `commands/settings-schema.ts`: extend the `deps` type with `migrationsIndexPath?: string; migrationSchemasPath?: string`; add

```ts
import { applyDrafts, draftMigrations, MIGRATION_SCHEMAS_PATH, MIGRATIONS_INDEX_PATH, type Draft } from "../lib/settings/schema-draft.ts";
import { getDef } from "../lib/settings/registry.ts";
```

and, after the `checkLockAgainst(...)` line, add:

```ts
  let drafts: Draft[] = [];
  if (args.includes("--draft")) {
    const indexPath = deps.migrationsIndexPath ?? MIGRATIONS_INDEX_PATH;
    const schemasPath = deps.migrationSchemasPath ?? MIGRATION_SCHEMAS_PATH;
    drafts = draftMigrations(prev, next, (key) => {
      const def = getDef(key);
      return def?.merge === "deep" && def.type === "object";
    });
    if (drafts.length > 0) {
      const files = applyDrafts(drafts, { index: readFileSync(indexPath, "utf8"), schemas: readFileSync(schemasPath, "utf8") });
      writeFileSync(indexPath, files.index);
      writeFileSync(schemasPath, files.schemas);
    }
  }
```

Add `drafts` to the `--json` body (`{ ok, shipped: shippedRef, changes, problems, drafts }`), and in the text branch, after the problems, print:

```ts
    for (const d of drafts) {
      console.log(d.kind === "step" ? `drafted   ${d.key}  migrateFrom version ${d.version}` : `drafted   ${d.key}  renamedFrom ${d.from}`);
      for (const n of d.notes) console.log(`          note: ${n}`);
    }
    if (drafts.length > 0) console.log("next: review the drafts, add real examples, set storeVersion, then bun run cli.ts settings schema lock");
```

In `lib/command-tree-def.ts`, add to `settings.schema.diff.args`, before `JSON`:

```ts
              { name: "Draft", flag: "--draft", type: "boolean", default: false, hint: "Write a migrateFrom entry (or a rename) for each breaking change into the migration files, for review" },
```

Run: `bun run docs:gen`
Expected: exit 0.

- [ ] **Step 5: Run the tests to see them pass**

Run: `bun test packages/rt-client/src/settings/__tests__/schema-draft.test.ts commands/__tests__/settings-schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate**

Run, each bare: `sh scripts/repo-purity.sh`, `bunx tsc --noEmit`, `bun test packages/rt-client/src/settings/__tests__/schema-draft.test.ts commands/__tests__/settings-schema.test.ts lib/__tests__/no-eager-tui.test.ts packages/rt-client/test`, `bun run docs:check`, `bun run --cwd packages/rt-client build`.
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/rt-client/src/settings/schema-draft.ts lib/settings/schema-draft.ts commands/settings-schema.ts lib/command-tree-def.ts website/docs/reference/settings packages/rt-client/src/settings/__tests__/schema-draft.test.ts commands/__tests__/settings-schema.test.ts
git commit -m "feat(settings): rt settings schema diff --draft writes migrateFrom and rename drafts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Real stores before release, docs, versions, full gate

**Files:**
- Modify: `lib/release/preflight.ts` (`checkSettingsStores`, wired into `runPreflight`)
- Modify: `commands/__tests__/release-preflight.test.ts`
- Modify: `skills/rt-release/SKILL.md` (load `superpowers:writing-skills` first)
- Modify: `docs/settings-architecture.md`, `packages/rt-client/README.md`, `packages/settings-kit/README.md`
- Modify: `packages/rt-client/package.json`, `packages/settings-kit/package.json` (versions)
- Modify: `packages/rt-client/test/index-surface.test.ts`

**Interfaces:**
- Consumes: `rt settings check --json` (Task 5's findings); Task 8's `schema-lock` row detail.
- Produces: preflight row `{ id: "settings-stores", label: "settings stores" }`: runs `bun run cli.ts settings check --json` in the checkout (so the candidate's registry and migrations run) against the real stores, read-only; `ok` when the report is `ok`, `stale` naming every `invalid`, `nonconforming`, `merged` or `diverged` finding, `error` when no JSON comes back.

- [ ] **Step 1: Write the failing tests**

In `commands/__tests__/release-preflight.test.ts`, give `fakeSeams` a fourth parameter `settingsCheck: string = '{"ok":true,"findings":[]}'` and add as the first line of its `exec`, after `const cmd = argv.join(" ");`:

```ts
      if (cmd === "bun run cli.ts settings check --json") return ok(`${settingsCheck}\n`);
```

Then add:

```ts
describe("rt release preflight settings-stores row", () => {
  const storesRow = async (seams: PreflightSeams) => {
    const { logs } = await run(["--json"], seams);
    return (JSON.parse(logs[0]!).rows as { id: string; label: string; status: string; detail?: string }[]).find((r) => r.id === "settings-stores");
  };

  test("a clean check of the real stores is ok", async () => {
    expect(await storesRow(fakeSeams("0.20.0"))).toMatchObject({ label: "settings stores", status: "ok" });
  });

  test("a value the migrations cannot carry, or a diverged name, is stale and named", async () => {
    const report = JSON.stringify({
      ok: false,
      findings: [
        { key: "rt.notify.eventBridges", scope: "user", kind: "nonconforming", issues: [{ path: [], message: "migration 1 -> 2 threw: boom" }] },
        { key: "rt.roles", scope: "team", repo: "gitlab.example.com/acme/app", kind: "diverged", storeName: "rt.roles", issues: [] },
        { key: "rt.worktrees", scope: "user", kind: "stale", storeName: "rt.worktrees", issues: [] },
      ],
    });
    const row = await storesRow(fakeSeams("0.20.0", COMMITTED_LOCK, COMMITTED_LOCK, report));
    expect(row?.status).toBe("stale");
    expect(row?.detail).toBe("rt.notify.eventBridges nonconforming in user; rt.roles diverged (rt.roles) in team/gitlab.example.com/acme/app");
  });

  test("no JSON from the check is an error", async () => {
    expect((await storesRow(fakeSeams("0.20.0", COMMITTED_LOCK, COMMITTED_LOCK, "boom")))?.status).toBe("error");
  });
});
```

In `packages/rt-client/test/index-surface.test.ts`, add:

```ts
test("migration verbs are on the index; the authoring tools are not", async () => {
  const index = (await import("../src/index.ts")) as Record<string, unknown>;
  for (const name of ["readSection", "currentStoreName", "olderStoreNames", "storeNameStatus", "worstLabel", "valueHash", "pruneStoreName", "storeSections", "planStoreMigrations"]) {
    expect(typeof index[name], name).toBe("function");
  }
  for (const name of ["zodSource", "draftMigrations", "applyDrafts", "proveMigration", "sampleValues", "MIGRATION_SCHEMAS"]) {
    expect(name in index, name).toBe(false);
  }
});
```

(Import `test` and `expect` from `bun:test` if that file does not already.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `bun test commands/__tests__/release-preflight.test.ts packages/rt-client/test/index-surface.test.ts`
Expected: the settings-stores tests FAIL (no such row); the index-surface test PASSES already (it pins the exports of Tasks 3, 4 and 6).

- [ ] **Step 3: The preflight row**

In `lib/release/preflight.ts`, add after `checkSchemaLock`:

```ts
const FAILING_KINDS = new Set(["invalid", "nonconforming", "merged", "diverged"]);

/**
 * The candidate's own `rt settings check`, run from this checkout so its
 * registry and migrations are the ones being released, against the real
 * stores, read-only. A value the migrations cannot carry, or a diverged
 * older name, stops the release.
 */
export async function checkSettingsStores(seams: PreflightSeams): Promise<CheckRow> {
  const id = "settings-stores";
  const label = "settings stores";
  try {
    const r = await seams.exec(["bun", "run", "cli.ts", "settings", "check", "--json"], { cwd: seams.repoRoot, timeoutMs: 120_000 });
    const line = r.stdout.split("\n").find((l) => l.startsWith("{"));
    if (!line) throw new Error(`settings check printed no JSON (exit ${r.exitCode}): ${r.stderr.trim().slice(0, 200)}`);
    const report = JSON.parse(line) as { ok: boolean; findings: { key: string; kind: string; scope?: string; repo?: string; storeName?: string }[] };
    if (report.ok) return { id, label, status: "ok", detail: "every stored value passes after migration; no diverged names" };
    const detail = report.findings
      .filter((f) => FAILING_KINDS.has(f.kind))
      .map((f) => `${f.key} ${f.kind}${f.storeName ? ` (${f.storeName})` : ""}${f.scope ? ` in ${[f.scope, f.repo].filter(Boolean).join("/")}` : ""}`)
      .join("; ");
    return { id, label, status: "stale", detail };
  } catch (err) {
    return { id, label, status: "error", detail: String((err as Error).message ?? err) };
  }
}
```

In `runPreflight`, add `checkSettingsStores(seams)` to the `Promise.all` right after `checkSchemaLock(seams, gitState.tag)`, destructure it as `settingsStoresRow` right after `schemaLockRow`, and put `settingsStoresRow` in `rows` right after `schemaLockRow`. Extend the module's top doc comment's list of checks with "the candidate's settings check against the real stores".

- [ ] **Step 4: The release skill**

Load `superpowers:writing-skills` before this step (AGENTS.md and the repo rule), and follow it for this edit. In `skills/rt-release/SKILL.md` step 1, replace the two sentences that begin "A stale `schema lock` row names a key" and "`bun run cli.ts settings check` (source, so it checks this release's registry) must also exit 0" with:

```markdown
A stale `schema lock` row names a key whose schema changed in a breaking
way since the last tag without a `storeVersion` bump and a `migrateFrom`
chain covering every version since that tag (a key never released may
instead carry a one-line reason in
`packages/rt-client/src/settings/breaking-schema-changes.json`); land the
migration (`rt settings schema diff --draft` drafts it) or revert the change
on main before tagging. A stale `settings stores` row is the candidate's own
`rt settings check` failing against the real stores: a value its migrations
cannot carry, or an older store name edited after its current one
(`diverged`). Fix the schema or the migration, never the store; a diverged
name is resolved with Matt (console's Needs fixing, or `rt settings migrate
--prune --force <key>` once he has chosen the value to keep).
```

In step 5 ("Write the release notes"), add this paragraph at the end of the step:

```markdown
   When the `schema lock` row lists `storeVersion bumps for the release
   notes`, add a "Settings store versions" section naming each key and its
   new store name (`rt.roles@2`), and say that the apps repo's rt-client
   bump follows in this release train. Do not run `rt settings migrate
   --write` on any machine before the apps have moved: writing `key@N` is
   what starts divergence for writers still on the old name.
```

- [ ] **Step 5: Docs**

In `docs/settings-architecture.md`, add a section after "## Schemas, the write gate and the lock":

```markdown
## Changing a key's shape (store versions and migrations)

A breaking schema change gives the key a new store name instead of
rewriting values in place: `key` at `storeVersion` 1, `key@N` above it.
Code keeps using the plain key. Readers on an older rt-client keep reading
the name they know; the resolver on the new one reads `key@N`, else the
highest older name it can migrate (`migrateFrom` steps in
`packages/rt-client/src/settings/migrations/index.ts`, run in memory).

- Every write lands on the current name. The first write of `key@N` into a
  section records `$migrated: { <older name>: <hash> }` for the older names
  there; afterwards an older name is `leftover` (its migrated value equals
  the current one), `stale` (unchanged since) or `diverged` (edited or
  created after). `$`-prefixed properties are store metadata.
- To change a shape: edit the zod schema, run `rt settings schema diff
  --draft` (it writes the step and the previous version's schema into
  `migrations/index.ts` and `migrations/schemas.ts`), finish any step that
  throws `TODO`, add real (invented) examples, bump `storeVersion` in
  `registry-defs.ts`, then `rt settings schema lock`. CI fails a breaking
  change until the bump and a `migrateFrom` entry matching main's lock are
  in; the proof test runs every step over generated samples.
- A renamed key lists its old key in `RENAMES` and keeps its version; the
  old key's names read as older names of the new one.
- `rt settings migrate` shows what is stored under older names; `--write`
  adds current names (additive, safe for every reader); `--prune` deletes
  leftover and stale older names after confirmation, the team store only
  with `--team`, a diverged one only with `--force <key>`.
- `rt settings check` fails on a diverged name or a value the chain cannot
  carry; release preflight runs the candidate's check against the real
  stores.
```

and add to "## Footguns":

```markdown
- **A raw `readStore(...).global[key]` never sees `key@N`.** `identity.ts`,
  `lib/team/members.ts`, `lib/team/invite.ts` and `commands/team.ts` read
  their keys that way; move such a reader to `readSection` (or the
  resolver) before its key's `storeVersion` goes above 1.
- **Do not run `rt settings migrate --write` before the apps' rt-client
  moves.** Writing `key@N` starts divergence for every writer still on the
  old name.
```

In `packages/rt-client/README.md`, add to "## Settings schemas" a "### Store versions and migrations" subsection:

```markdown
### Store versions and migrations

A key whose schema changes in a breaking way gets a new store name,
`key@<storeVersion>`. `getSetting`, `explainSetting` and `listSettings`
read it, else migrate the highest older name in memory (`readSection`);
explain rows carry `storeName`, `storedVersion`, `authored` and, beside a
current name, `olderNames` labeled `leftover`, `stale` or `diverged`.
`setSetting` writes the current name and records `$migrated` baselines;
`pruneStoreName(key, storeName, scope, { force? })` deletes one older name;
`planStoreMigrations()` is the data behind `rt settings migrate`.
```

In `packages/settings-kit/README.md`, add under "Schemas and editors":

```markdown
### Store versions

Explain rows carry `storeName`, `storedVersion`, `value` (migrated to the
current shape) and `authored` (as stored); beside a current name,
`olderNames` lists each older store name with its label. A `diverged`
older name is an `issues[]` entry `{ kind: "diverged", storeName,
olderValue, currentValue }` (no values for a secret key). `POST
{base}/prune` with `{ key, scope, repo?, storeName, force?, team? }`
removes one older name and answers `{ rows, effective }`; it refuses a
diverged name unless `force`. `useSettingsScope(...).prune(key, scope,
storeName, { force?, repo?, team? })` calls it.
```

- [ ] **Step 6: Versions**

Bump `packages/rt-client/package.json` `version` one minor above the version on `main` (for example `0.32.0` to `0.33.0`), and `packages/settings-kit/package.json` one minor above its own, with `peerDependencies["@mattstack/rt-client"]` set to `">=<the new rt-client version> <1"`. Run `bun install` so `bun.lock` follows. Before merging, announce the rt-client version taken in the rt chat room of the settings lanes (AGENTS.md: the package version is claimed across sessions; renumber if second).

- [ ] **Step 7: Run the tests to see them pass**

Run: `bun test commands/__tests__/release-preflight.test.ts packages/rt-client/test/index-surface.test.ts`
Expected: PASS.

- [ ] **Step 8: The real-store audit (read-only, on Matt's machine)**

Run: `bun run cli.ts settings check`
Expected: exit 0 (no key is bumped by this plan, so this matches plan 1's audit). A finding is reported to Matt, never fixed in a store.

- [ ] **Step 9: Full local gate for the branch**

Run, each bare:

- `sh scripts/repo-purity.sh`
- `bunx tsc --noEmit`
- `bun test packages commands/__tests__/settings-check.test.ts commands/__tests__/settings-migrate.test.ts commands/__tests__/settings-schema.test.ts commands/__tests__/settings-keys-render.test.ts commands/__tests__/release-preflight.test.ts lib/__tests__/notification-shape-parity.test.ts lib/__tests__/no-eager-tui.test.ts lib/__tests__/picker-conformance.test.ts`
- `bun run docs:check`
- `bun run picker:check`
- `bun run cli.ts settings schema lock`
- `git diff --exit-code -- packages/rt-client/src/settings/schema.lock.json`
- `bun run --cwd packages/rt-client build`
- `bun run --cwd packages/settings-kit build`
- `bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/settings.test.ts`
- `bun build --compile ./cli.ts --outfile dist/rt --no-compile-autoload-bunfig --no-compile-autoload-dotenv`
- `mkdir -p /private/tmp/rt-bench-home`
- `env HOME=/private/tmp/rt-bench-home bun scripts/bench-startup.ts`

Expected: all exit 0; the startup median within a few ms of plan 1's recorded baseline (the runtime gained only `migrations/index.ts` and `migrate.ts`). CI runs the rest of the three suites.

- [ ] **Step 10: Commit**

```bash
git add lib/release/preflight.ts commands/__tests__/release-preflight.test.ts skills/rt-release/SKILL.md docs/settings-architecture.md packages/rt-client/README.md packages/settings-kit/README.md packages/rt-client/package.json packages/settings-kit/package.json bun.lock packages/rt-client/test/index-surface.test.ts
git commit -m "feat(release): the candidate's settings check against real stores; docs and versions for store migrations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Integration (PR, CodeRabbit, CI, merge, publishing) is the dispatcher's call, not this plan's.

---

## Self-review notes

- Spec coverage: store names (Task 1), `$migrated` metadata and its exclusion from resolution and the unregistered scan (Tasks 2, 3), `migrateFrom` chain with gap/overlap/backwards rejection and `renamedFrom` (Task 1), newest-name-wins reads, in-memory migration, per-name labels, worst label, failing step kept as stored and labeled (Tasks 2, 3), explain fields (Task 3), newer names reported and skipped (Task 3), writes to the current name with first-write baselines in one batch (Task 4), divergence surfaced in the resolver, `rt settings check` (exit 1 on diverged), settings-kit `issues[]`, and prune refusals (Tasks 3, 5, 7, 4/6), `rt settings migrate` dry run, `--write`, `--prune` with confirmation, `--team`, `--force <key>`, `pruneStoreName` (Tasks 4, 6), settings-kit wire fields and `/prune` (Task 7), CI acceptance against main with the enum/const rule and the never-shipped hatch, and the pre-release chain rule against the tag (Task 8), drafting table (Tasks 10, 11), proof over full and layer samples plus examples (Task 9), real stores before release and bumped keys in the release notes (Tasks 8, 12), process note about migrating only after the apps move (Task 12 docs and skill).
- Acceptance bullets: 1 in Task 11's acceptance test; 2 and 3 in Task 6's `migrations-acceptance.test.ts` and Task 3's newer-name test; 4 in Task 6's CLI tests; 5 in Task 12's preflight test.
- Type consistency: `SectionRead`, `OlderNameRead` (`value`, `authored`), `OlderLabel`, `ExplainRow.olderNames`, `CheckFinding.olderValue/currentValue`, `OlderName.olderValue/currentValue`, the wire issue's `olderValue/currentValue`, `Lock`/`LockEntry.migrateFrom` (version string keys), `checkLockAgainst(prev, next, acknowledged, opts)` keep one shape across tasks.
- Review Focus 1 to 5 are pinned in Task 4 (1 and 2), Task 3 (3), Tasks 3, 5 and 6 (4), Task 2 (5).
