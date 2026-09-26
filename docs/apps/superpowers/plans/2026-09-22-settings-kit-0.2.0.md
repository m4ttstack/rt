# settings-kit 0.2.0 Implementation Plan (Plan A of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@mattstack/settings-kit` 0.2.0: correct effective layers, a headless `shapes` entry, a `'shaped'` composite write gate with a JSON-only write rule, and a `move` between scopes.

**Architecture:** All work is in the rt repo (`m4ttstack/rt`, local checkout `~/Documents/GitHub/repo-tools`), package `packages/settings-kit`. `shapes.ts` is pure data plus functions with no runtime imports, so browsers and servers both load it. `server.ts` imports `SHAPES`/`matchesShape` for its write gate. `react.ts` gains `move`, built on a pure `moveValue` in `move.ts` so it is testable without React.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun build`), `@mattstack/rt-client` (workspace sibling).

**Spec:** `docs/superpowers/specs/2026-09-22-console-settings-page-design.md` in `m4ttstack/apps` (section "settings-kit 0.2.0").

## Global Constraints

- Work in a worktree of the rt repo, never on its `main` checkout. The session starts in `m4ttstack/apps`, so first `/cd ~/Documents/GitHub/repo-tools` (ask Matt to type it), then `EnterWorktree` with name `settings-kit-shapes`.
- Every commit message ends with exactly: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Task gate, run from the rt repo root after every task: `bun test packages/settings-kit` green, `cd packages/settings-kit && bun run check-types` clean, `sh scripts/repo-purity.sh` clean.
- No em dashes or en dashes in any new text (code comments, README, commit messages). Existing lines that contain them may stay.
- Comments state constraints the code cannot show; no narration, no review history.
- Publish only from `main` after the PR merges, never from a branch, never with `--ignore-scripts` (rt CLAUDE.md, "Publishing ... is release-class").
- Version: `0.2.0`. rt-client peer range stays `>=0.4.1 <1`.

## Review Focus

1. A key with a registry default and a machine override: `effective.scope` must be `machine`, never `default` (the live board bug). Task 1.
2. A deep-merged object where the strongest layer sets one field: `effective.value` must still carry the default's other fields. Task 1.
3. A `text/plain` POST to `/set` or `/unset` from a page on another origin: must be 415, never a write. Task 3.
4. `move` from a scope that holds no authored value: must refuse with a message, never write `undefined` to the target. Task 4.
5. A host still passing `allowComposite: true` (board today, until Plan B lands): behaviour unchanged, every composite writable. Task 3.

---

### Task 1: Report the strongest layer as effective

**Files:**
- Modify: `packages/settings-kit/src/server.ts:143-160` (`effectiveFromRows`)
- Test: `packages/settings-kit/src/__tests__/effective.test.ts` (create)

**Interfaces:**
- Produces: `effectiveFromRows(def: SettingDef, rows: ExplainRow[]): EffectiveWire` with the same signature, now strongest-wins. Rows are weakest-first (`default`, `team`, `user`, `machine`, per rt-client's `explainSetting` doc).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import type { ExplainRow, SettingDef } from "@mattstack/rt-client";
import { effectiveFromRows } from "../server.ts";

const def = (over: Partial<SettingDef>): SettingDef =>
  ({ key: "k", type: "string", scopes: ["user", "machine"], merge: "replace", description: "", ...over }) as SettingDef;
const row = (scope: string, value?: unknown, extra: Partial<ExplainRow> = {}): ExplainRow =>
  ({ scope, file: scope === "default" ? null : `/stores/${scope}.jsonc`, present: value !== undefined, ...(value !== undefined ? { value } : {}), ...extra }) as ExplainRow;

describe("effectiveFromRows", () => {
  test("the strongest present layer wins over a registry default", () => {
    const d = def({ default: "info" });
    const eff = effectiveFromRows(d, [row("default", "info"), row("team"), row("user"), row("machine", "debug")]);
    expect(eff).toEqual({ scope: "machine", file: "/stores/machine.jsonc", value: "debug" });
  });

  test("machine beats user when both are set", () => {
    const eff = effectiveFromRows(def({}), [row("default"), row("team"), row("user", "a"), row("machine", "b")]);
    expect(eff.scope).toBe("machine");
    expect(eff.value).toBe("b");
  });

  test("a shadowed strongest layer is skipped", () => {
    const eff = effectiveFromRows(def({}), [row("user", "a"), row("machine", "b", { shadowed: "teamLocked" } as Partial<ExplainRow>)]);
    expect(eff.scope).toBe("user");
  });

  test("an invalid strongest layer reports invalid and no value", () => {
    const eff = effectiveFromRows(def({}), [row("user", "a"), row("machine", 3, { invalid: "expected string" } as Partial<ExplainRow>)]);
    expect(eff).toEqual({ scope: "machine", file: "/stores/machine.jsonc", invalid: "expected string" });
  });

  test("a deep-merged object reports the merged value, arrays replacing", () => {
    const d = def({ type: "object", merge: "deep", default: { a: 1, b: { c: 1 }, list: [1, 2] } });
    const eff = effectiveFromRows(d, [
      row("default", { a: 1, b: { c: 1 }, list: [1, 2] }),
      row("team"),
      row("user", { list: [9] }),
      row("machine", { b: { d: 2 } }),
    ]);
    expect(eff.scope).toBe("machine");
    expect(eff.value).toEqual({ a: 1, b: { c: 1, d: 2 }, list: [9] });
  });

  test("a deep-merged object skips an invalid middle layer", () => {
    const d = def({ type: "object", merge: "deep" });
    const eff = effectiveFromRows(d, [row("user", { a: "bad" }, { invalid: "nope" } as Partial<ExplainRow>), row("machine", { b: 2 })]);
    expect(eff.value).toEqual({ b: 2 });
  });

  test("secrets never carry a value", () => {
    const eff = effectiveFromRows(def({ secret: true }), [row("user", "s3cret")]);
    expect(eff).toEqual({ scope: "user", file: "/stores/user.jsonc" });
  });

  test("no present row falls back to the def's default, then to null", () => {
    expect(effectiveFromRows(def({ default: 5 }), [row("user")])).toEqual({ scope: "default", file: null, value: 5 });
    expect(effectiveFromRows(def({}), [row("user")])).toEqual({ scope: null, file: null });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/settings-kit/src/__tests__/effective.test.ts`
Expected: FAIL on the first test with `scope: "default"` where `"machine"` was expected.

- [ ] **Step 3: Implement**

Replace `effectiveFromRows` in `packages/settings-kit/src/server.ts` (keep its doc comment's first sentence accurate):

```ts
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Field-by-field overlay; arrays and scalars replace, matching rt's deep merge. */
function overlay(base: unknown, top: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(top)) return top;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(top)) out[k] = overlay(base[k], v);
  return out;
}

/** Winning layer from explain rows, which arrive weakest-first: the last
    present, un-shadowed row wins. A deep-merged object reports the merged
    value, not the winning layer's slice. Secrets omit the value. */
export function effectiveFromRows(def: SettingDef, rows: ExplainRow[]): EffectiveWire {
  const live = rows.filter((r) => r.present && !r.shadowed);
  const top = live.at(-1);
  if (!top) {
    if ("default" in def) {
      const wire: EffectiveWire = { scope: "default", file: null };
      if (def.secret !== true) wire.value = def.default;
      return wire;
    }
    return { scope: null, file: null };
  }
  if (top.invalid) return { scope: top.scope, file: top.file, invalid: top.invalid };
  const wire: EffectiveWire = { scope: top.scope, file: top.file };
  if (def.secret === true) return wire;
  if (def.merge === "deep" && def.type === "object") {
    let merged: unknown = undefined;
    for (const r of live) {
      if (r.invalid || !("value" in r)) continue;
      merged = merged === undefined ? r.value : overlay(merged, r.value);
    }
    wire.value = merged;
  } else if ("value" in top) {
    wire.value = top.value;
  }
  return wire;
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test packages/settings-kit`
Expected: PASS, including the existing `server.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/settings-kit/src/server.ts packages/settings-kit/src/__tests__/effective.test.ts
git commit -m "settings-kit: effective layer is the strongest, deep keys report the merge

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Headless `shapes` entry

**Files:**
- Create: `packages/settings-kit/src/shapes.ts`
- Modify: `packages/settings-kit/package.json` (exports, build script)
- Test: `packages/settings-kit/src/__tests__/shapes.test.ts` (create)
- Test: `lib/__tests__/notification-shape-parity.test.ts` (create)

**Interfaces:**
- Consumes: `SettingDefWire` (type only) from `./server.ts`.
- Produces, all exported from `@mattstack/settings-kit/shapes`:
  - `type LeafType = 'string' | 'number' | 'boolean' | { enum: readonly string[] }`
  - `type CompositeShape` (`stringList`, `pairList {fields}`, `stringMap {labels}`, `leaves {fields, fallbacks?}`, `external {app}`)
  - `type RowKind = 'scalar' | 'enum' | CompositeShape['kind'] | 'readonly'`
  - `SHAPES: Record<string, CompositeShape>`, `ENUMS: Record<string, readonly string[]>`, `NOTIFICATION_EVENTS: readonly string[]`, `DEFAULT_SLACK_EMOJI: {looking, commented, approved}`
  - `matchesShape(shape, value): boolean`, `getLeaf(obj, path): unknown`, `setLeaf(obj, path, value): Record<string, unknown>`, `parseScalar(type, text)`, `addToList(list, entry): string[] | null`, `filterDefs<T extends {key: string; description: string}>(defs: T[], query: string): T[]`, `isSet(def): boolean`, `formatValue(value): string`, `rowKind(def): RowKind`, `summarize(def): string`, `targetScope(def): string`

- [ ] **Step 1: Write the failing tests**

`packages/settings-kit/src/__tests__/shapes.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { allDefs } from "@mattstack/rt-client";
import type { SettingDefWire } from "../server.ts";
import {
  addToList, ENUMS, filterDefs, getLeaf, isSet, matchesShape, parseScalar,
  rowKind, setLeaf, SHAPES, summarize, targetScope,
} from "../shapes.ts";

function def(over: Partial<SettingDefWire> & { key: string }): SettingDefWire {
  return {
    type: "string", scopes: ["user"], merge: "replace", secret: false, teamLocked: false,
    repoScoped: false, writable: true, description: "", hasDefault: false, defaultValue: null,
    effective: { scope: null, file: null }, ...over,
  };
}

describe("SHAPES", () => {
  test("every shaped key is registered and is an object or array", () => {
    const byKey = new Map(allDefs().map((d) => [d.key, d]));
    for (const key of Object.keys(SHAPES)) {
      const d = byKey.get(key);
      expect(d, key).toBeDefined();
      expect(["object", "array"]).toContain(d!.type);
    }
  });

  test("every ENUMS key is a registered string", () => {
    const byKey = new Map(allDefs().map((d) => [d.key, d]));
    for (const key of Object.keys(ENUMS)) expect(byKey.get(key)?.type, key).toBe("string");
  });

  test("each leaves shape accepts a fully typed sample and rejects a wrong-typed leaf", () => {
    for (const [key, shape] of Object.entries(SHAPES)) {
      if (shape.kind !== "leaves") continue;
      let sample: Record<string, unknown> = {};
      for (const [path, type] of Object.entries(shape.fields)) {
        const v = type === "string" ? "x" : type === "number" ? 1 : type === "boolean" ? true : type.enum[0];
        sample = setLeaf(sample, path, v);
      }
      expect(matchesShape(shape, sample), key).toBe(true);
      const [firstPath, firstType] = Object.entries(shape.fields)[0]!;
      const wrong = setLeaf(sample, firstPath, firstType === "number" ? "one" : 42);
      expect(matchesShape(shape, wrong), key).toBe(false);
    }
  });
});

describe("matchesShape", () => {
  test("stringList accepts only arrays of strings", () => {
    const s = SHAPES["board.projects"]!;
    expect(matchesShape(s, [])).toBe(true);
    expect(matchesShape(s, ["a/b"])).toBe(true);
    expect(matchesShape(s, ["a", 1])).toBe(false);
    expect(matchesShape(s, "a")).toBe(false);
  });

  test("pairList accepts arrays of objects carrying both string fields", () => {
    const s = { kind: "pairList", fields: ["project", "repo"] } as const;
    expect(matchesShape(s, [{ project: "g/p", repo: "host/x" }])).toBe(true);
    expect(matchesShape(s, [{ project: "g/p" }])).toBe(false);
    expect(matchesShape(s, [["g/p", "x"]])).toBe(false);
  });

  test("stringMap accepts a plain object of string values", () => {
    const s = SHAPES["rt.repoIdentityOverrides"]!;
    expect(matchesShape(s, {})).toBe(true);
    expect(matchesShape(s, { "https://example.dev/a.git": "a" })).toBe(true);
    expect(matchesShape(s, { "https://example.dev/a.git": 1 })).toBe(false);
    expect(matchesShape(s, [["a", "b"]])).toBe(false);
  });

  test("leaves passes unknown keys through and checks enums", () => {
    const s = SHAPES["board.triage"]!;
    expect(matchesShape(s, {})).toBe(true);
    expect(matchesShape(s, { enabled: true, fixClasses: { retryFlake: false }, notify: "rt" })).toBe(true);
    expect(matchesShape(s, { enabled: "yes" })).toBe(false);
    expect(matchesShape(s, { notify: "loud" })).toBe(false);
    expect(matchesShape(s, { doctorSkill: "x" })).toBe(true);
    expect(matchesShape(s, [])).toBe(false);
  });
});

describe("leaf access", () => {
  test("getLeaf walks dotted paths and tolerates missing branches", () => {
    expect(getLeaf({ emoji: { looking: "eyes" } }, "emoji.looking")).toBe("eyes");
    expect(getLeaf({}, "emoji.looking")).toBeUndefined();
    expect(getLeaf(undefined, "channel")).toBeUndefined();
  });

  test("setLeaf copies, creates intermediates, and removes on undefined", () => {
    const before = { channel: "reviews", emoji: { looking: "eyes" } };
    expect(setLeaf(before, "emoji.approved", "ok")).toEqual({ channel: "reviews", emoji: { looking: "eyes", approved: "ok" } });
    expect(before).toEqual({ channel: "reviews", emoji: { looking: "eyes" } });
    expect(setLeaf({ a: 1, b: 2 }, "a", undefined)).toEqual({ b: 2 });
  });
});

describe("scalars and lists", () => {
  test("parseScalar", () => {
    expect(parseScalar("string", " a ")).toEqual({ ok: true, value: " a " });
    expect(parseScalar("number", "12")).toEqual({ ok: true, value: 12 });
    expect(parseScalar("number", "")).toEqual({ ok: false, error: "enter a number" });
    expect(parseScalar("number", "1x")).toEqual({ ok: false, error: "not a number" });
  });

  test("addToList trims, drops empties, and refuses duplicates", () => {
    expect(addToList(["a"], " b ")).toEqual(["a", "b"]);
    expect(addToList(["a"], "  ")).toBeNull();
    expect(addToList(["a"], "a")).toBeNull();
  });

  test("filterDefs matches key or description, case-insensitively", () => {
    const defs = [def({ key: "rt.logLevel", description: "Daemon log level" }), def({ key: "board.title", description: "Title" })];
    expect(filterDefs(defs, "")).toHaveLength(2);
    expect(filterDefs(defs, "LOG").map((d) => d.key)).toEqual(["rt.logLevel"]);
    expect(filterDefs(defs, "title").map((d) => d.key)).toEqual(["board.title"]);
  });
});

describe("rowKind", () => {
  test("external wins even when unwritable", () => {
    expect(rowKind(def({ key: "board.members", type: "array", writable: false }))).toBe("external");
  });
  test("secrets and unwritable keys are read-only", () => {
    expect(rowKind(def({ key: "x.secret", secret: true }))).toBe("readonly");
    expect(rowKind(def({ key: "x.locked", writable: false }))).toBe("readonly");
  });
  test("composites dispatch on their shape, or read-only with none", () => {
    expect(rowKind(def({ key: "rt.repoRoots", type: "array" }))).toBe("stringList");
    expect(rowKind(def({ key: "rt.homeSnapshot", type: "object" }))).toBe("leaves");
    expect(rowKind(def({ key: "rt.cron", type: "object" }))).toBe("readonly");
  });
  test("strings in ENUMS are enum, other scalars scalar", () => {
    expect(rowKind(def({ key: "rt.logLevel" }))).toBe("enum");
    expect(rowKind(def({ key: "board.title" }))).toBe("scalar");
  });
});

describe("summarize", () => {
  test("stringList counts with a noun from the key", () => {
    expect(summarize(def({ key: "rt.repoRoots", type: "array", effective: { scope: "machine", file: null, value: ["a", "b"] } }))).toBe("2 roots");
    expect(summarize(def({ key: "board.ticketPrefixes", type: "array", effective: { scope: "team", file: null, value: ["RT"] } }))).toBe("1 prefix");
    expect(summarize(def({ key: "rt.repoRoots", type: "array" }))).toBe("0 roots");
  });
  test("stringMap and pairList count entries", () => {
    expect(summarize(def({ key: "rt.repoIdentityOverrides", type: "object", effective: { scope: "machine", file: null, value: { a: "b" } } }))).toBe("1 entry");
  });
  test("leaves count set fields", () => {
    expect(summarize(def({ key: "rt.gitStatus", type: "object", effective: { scope: "default", file: null, value: { sweep: true } } }))).toBe("1 of 3 set");
  });
  test("no shape falls back to a generic count", () => {
    expect(summarize(def({ key: "rt.cron", type: "object", effective: { scope: "machine", file: null, value: { a: 1, b: 2 } } }))).toBe("2 fields");
    expect(summarize(def({ key: "rt.cron", type: "object" }))).toBe("unset");
  });
});

describe("isSet and targetScope", () => {
  test("isSet is true only for a real store layer", () => {
    expect(isSet(def({ key: "k", effective: { scope: "user", file: "/f" } }))).toBe(true);
    expect(isSet(def({ key: "k", effective: { scope: "default", file: null } }))).toBe(false);
    expect(isSet(def({ key: "k" }))).toBe(false);
  });
  test("targetScope is the winning layer when allowed, else the first scope", () => {
    const scopes = ["user", "machine"] as SettingDefWire["scopes"];
    expect(targetScope(def({ key: "k", scopes, effective: { scope: "machine", file: "/f" } }))).toBe("machine");
    expect(targetScope(def({ key: "k", scopes, effective: { scope: "default", file: null } }))).toBe("user");
    expect(targetScope(def({ key: "k", scopes, effective: { scope: "team", file: "/f" } }))).toBe("user");
    expect(targetScope(def({ key: "k", scopes }))).toBe("user");
  });
});
```

`lib/__tests__/notification-shape-parity.test.ts`:

```ts
import { expect, test } from "bun:test";
import { NOTIFICATION_TYPES } from "../notifier.ts";
import { NOTIFICATION_EVENTS, SHAPES } from "../../packages/settings-kit/src/shapes.ts";

test("settings-kit's rt.notifications fields mirror NOTIFICATION_TYPES", () => {
  const rtKeys = NOTIFICATION_TYPES.map((t) => t.key).sort();
  expect([...NOTIFICATION_EVENTS].sort()).toEqual(rtKeys);
  const shape = SHAPES["rt.notifications"];
  expect(shape?.kind).toBe("leaves");
  expect(Object.keys(shape!.kind === "leaves" ? shape!.fields : {}).sort()).toEqual(rtKeys);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test packages/settings-kit/src/__tests__/shapes.test.ts lib/__tests__/notification-shape-parity.test.ts`
Expected: FAIL, `Cannot find module '../shapes.ts'`.

- [ ] **Step 3: Implement `packages/settings-kit/src/shapes.ts`**

```ts
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
  "evidence_batch_ready", "evidence_failed", "chat_mention", "credential_health",
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
  "rt.worktreeApp": { kind: "leaves", fields: { enabled: "boolean", killProcesses: "boolean", claudeHook: "string" } },
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
  "mattstack.mode": ["dev", "prod"],
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
          const v = getLeaf(value, path);
          return v === undefined || matchesLeaf(type, v);
        })
      );
    case "external":
      return true;
  }
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
      const set = paths.filter((p) => getLeaf(v, p) !== undefined).length;
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
```

Note on `summarize` for `external`: board.members is an array of roster objects, so the no-shape branch's array count ("7 members") is the right line.

- [ ] **Step 4: Wire the package entry**

In `packages/settings-kit/package.json`, add to `exports`, directly before the `"./react"` entry:

```json
    "./shapes": {
      "types": "./dist/shapes.d.ts",
      "default": "./dist/shapes.js"
    },
```

and append to the `build` script, before `&& tsc -p tsconfig.json`:

```
 && bun build src/shapes.ts --outdir dist --target browser --format esm --packages external
```

- [ ] **Step 5: Run the tests and the build**

Run: `bun test packages/settings-kit lib/__tests__/notification-shape-parity.test.ts`
Expected: PASS.

Run: `cd packages/settings-kit && bun run build && ls dist && grep -c "targetScope" dist/shapes.js`
Expected: `shapes.js` and `shapes.d.ts` present; count at least 1.

- [ ] **Step 6: Commit**

```bash
git add packages/settings-kit/src/shapes.ts packages/settings-kit/src/__tests__/shapes.test.ts packages/settings-kit/package.json lib/__tests__/notification-shape-parity.test.ts
git commit -m "settings-kit: headless shapes entry shared by every settings UI

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `'shaped'` composite gate and JSON-only writes

**Files:**
- Modify: `packages/settings-kit/src/server.ts` (options type, `isWritable`, `defToWire`, the `/set` and `/unset` branches)
- Test: `packages/settings-kit/src/__tests__/server.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `SHAPES`, `matchesShape` from `./shapes.ts` (Task 2).
- Produces: `SettingsHandlerOptions.allowComposite?: boolean | "shaped"`; `defToWire(def, migrated, effective, composites: boolean | "shaped" = false)`.

- [ ] **Step 1: Write the failing tests**

Add these fixtures to `DEFS` in `server.test.ts`:

```ts
  "rt.repoRoots": { key: "rt.repoRoots", type: "array", scopes: ["machine"], merge: "replace", description: "Scan roots" },
  "board.members": { key: "board.members", type: "array", scopes: ["team"], merge: "replace", description: "Roster" },
```

The new `board.*` fixture widens the existing test "defs?prefix= filters to one app's namespace": change its expected keys from `["board.rtRepos", "board.title"]` to `["board.members", "board.rtRepos", "board.title"]`. The external fixture must stay a `board.*` key, so do not rename it instead.

Append:

```ts
describe("allowComposite: 'shaped'", () => {
  const opts = { allowComposite: "shaped" as const };

  test("defs mark a shaped composite writable and an unshaped one not", async () => {
    const res = await handle(get("/api/settings/defs"), opts);
    const { defs } = (await res!.json()) as { defs: { key: string; writable: boolean }[] };
    const w = Object.fromEntries(defs.map((d) => [d.key, d.writable]));
    expect(w["rt.repoRoots"]).toBe(true);
    expect(w["board.rtRepos"]).toBe(false);
    expect(w["board.members"]).toBe(false);
  });

  test("writes a shaped composite whose value matches", async () => {
    const res = await handle(post("/api/settings/set", { key: "rt.repoRoots", scope: "machine", value: ["~/src"] }), opts);
    expect(res!.status).toBe(200);
    expect(setCalls).toHaveLength(1);
  });

  test("refuses a value that does not match the shape", async () => {
    const res = await handle(post("/api/settings/set", { key: "rt.repoRoots", scope: "machine", value: [1] }), opts);
    expect(res!.status).toBe(400);
    expect(await res!.json()).toEqual({ error: "value does not match rt.repoRoots's shape" });
    expect(setCalls).toHaveLength(0);
  });

  test("refuses an unshaped composite and an external one", async () => {
    const a = await handle(post("/api/settings/set", { key: "board.rtRepos", scope: "machine", value: [] }), opts);
    expect(await a!.json()).toEqual({ error: '"board.rtRepos" has no editable shape' });
    const b = await handle(post("/api/settings/set", { key: "board.members", scope: "team", value: [] }), opts);
    expect(await b!.json()).toEqual({ error: '"board.members" has no editable shape' });
    expect(setCalls).toHaveLength(0);
  });

  test("allowComposite: true still admits every composite", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.rtRepos", scope: "machine", value: [] }), { allowComposite: true });
    expect(res!.status).toBe(200);
  });
});

describe("JSON-only writes", () => {
  test("a non-JSON media type is 415 on set and unset, and nothing is written", async () => {
    for (const path of ["/api/settings/set", "/api/settings/unset"]) {
      const res = await handle(
        new Request(`http://console.mattstack${path}`, {
          method: "POST",
          headers: { "content-type": "text/plain;x=application/json" },
          body: JSON.stringify({ key: "board.title", scope: "user", value: "x" }),
        }),
      );
      expect(res!.status).toBe(415);
    }
    expect(setCalls).toHaveLength(0);
    expect(unsetCalls).toHaveLength(0);
  });

  test("a charset parameter on application/json is fine", async () => {
    const res = await handle(
      new Request("http://console.mattstack/api/settings/set", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ key: "board.title", scope: "user", value: "x" }),
      }),
    );
    expect(res!.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/settings-kit/src/__tests__/server.test.ts`
Expected: FAIL on the new describes (writable false for `rt.repoRoots`, 200 instead of 415). The widened prefix test already passes with the updated assertion.

- [ ] **Step 3: Implement**

In `server.ts`:

```ts
import { matchesShape, SHAPES } from "./shapes.ts";
```

Change the option type:

```ts
  /** Admit composite (object/array) keys to the write path. `true` admits
      every composite as a whole-JSON replacement. `"shaped"` admits only a
      key SHAPES declares (never `external`), and only a value matching it. */
  allowComposite?: boolean | "shaped";
```

Replace `isWritable` and widen `defToWire`:

```ts
type CompositeMode = boolean | "shaped";

function compositeAllowed(def: SettingDef, mode: CompositeMode): boolean {
  if (!isComposite(def) || mode === true) return true;
  if (mode !== "shaped") return false;
  const shape = SHAPES[def.key];
  return shape !== undefined && shape.kind !== "external";
}

function isWritable(def: SettingDef, migrated: (def: SettingDef) => boolean = isMigrated, mode: CompositeMode = false): boolean {
  return migrated(def) && def.secret !== true && compositeAllowed(def, mode);
}

export function defToWire(def: SettingDef, migrated: ((def: SettingDef) => boolean) | undefined, effective: EffectiveWire, composites: CompositeMode = false): SettingDefWire {
```

(the body of `defToWire` keeps `writable: isWritable(def, migrated, composites)`). Update the doc comment on `SettingDefWire.writable` to: "Computed once, server-side: migrated AND not secret AND (not composite, or composite writes admitted by `allowComposite`). Every client edit affordance keys off this instead of re-deriving it."

Add the media-type gate:

```ts
function isJsonBody(req: Request): boolean {
  const type = req.headers.get("content-type");
  return type !== null && type.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}
```

In both the `/set` and `/unset` branches, directly after the `allow(req)` 403 line:

```ts
    if (!isJsonBody(req)) return json({ error: "expected application/json" }, 415);
```

In both branches replace `opts.allowComposite === true` with `opts.allowComposite ?? false`, and replace the composite refusal line with:

```ts
    const mode = opts.allowComposite ?? false;
    if (!compositeAllowed(def, mode)) {
      return json({ error: mode === "shaped" ? `"${key}" has no editable shape` : COMPOSITE_COPY }, 400);
    }
```

In the `/set` branch only, right after `validateValue`'s check:

```ts
    const shape = SHAPES[key];
    if (mode === "shaped" && isComposite(def) && shape && !matchesShape(shape, value)) {
      return json({ error: `value does not match ${key}'s shape` }, 400);
    }
```

In the `/defs` and `/explain` branches pass `opts.allowComposite ?? false` to `defToWire`.

- [ ] **Step 4: Run the tests**

Run: `bun test packages/settings-kit`
Expected: PASS, old and new.

- [ ] **Step 5: Commit**

```bash
git add packages/settings-kit/src/server.ts packages/settings-kit/src/__tests__/server.test.ts
git commit -m "settings-kit: shaped composite writes and a JSON-only write gate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `move` a value between scopes

**Files:**
- Create: `packages/settings-kit/src/move.ts`
- Modify: `packages/settings-kit/src/react.ts` (`SettingsScopeState`, `useSettingsScope`)
- Test: `packages/settings-kit/src/__tests__/move.test.ts` (create)

**Interfaces:**
- Produces: `moveValue(api: { set(scope: string, value: unknown): Promise<string | null>; unset(scope: string): Promise<string | null> }, from: string, to: string, authored: { present: boolean; value?: unknown }): Promise<string | null>`; `SettingsScopeState.move(key: string, from: string, to: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { moveValue } from "../move.ts";

function fakeApi(setErr: string | null = null, unsetErr: string | null = null) {
  const calls: string[] = [];
  return {
    calls,
    api: {
      set: async (scope: string, value: unknown) => { calls.push(`set ${scope} ${JSON.stringify(value)}`); return setErr; },
      unset: async (scope: string) => { calls.push(`unset ${scope}`); return unsetErr; },
    },
  };
}

describe("moveValue", () => {
  test("writes the authored value to the target, then clears the source", async () => {
    const f = fakeApi();
    expect(await moveValue(f.api, "user", "machine", { present: true, value: 3 })).toBeNull();
    expect(f.calls).toEqual(["set machine 3", "unset user"]);
  });

  test("a failed set stops before touching the source", async () => {
    const f = fakeApi("rt: refused");
    expect(await moveValue(f.api, "user", "machine", { present: true, value: 3 })).toBe("rt: refused");
    expect(f.calls).toEqual(["set machine 3"]);
  });

  test("a failed unset says the old layer still holds a value", async () => {
    const f = fakeApi(null, "rt: locked");
    expect(await moveValue(f.api, "user", "machine", { present: true, value: 3 })).toBe(
      "moved to machine, but user still holds a value: rt: locked",
    );
  });

  test("refuses when the source layer holds nothing, writing nothing", async () => {
    const f = fakeApi();
    expect(await moveValue(f.api, "user", "machine", { present: false })).toBe("user holds no value to move");
    expect(f.calls).toEqual([]);
  });

  test("refuses a move onto the same scope", async () => {
    const f = fakeApi();
    expect(await moveValue(f.api, "user", "user", { present: true, value: 1 })).toBe("already in user");
    expect(f.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test packages/settings-kit/src/__tests__/move.test.ts`
Expected: FAIL, `Cannot find module '../move.ts'`.

- [ ] **Step 3: Implement `move.ts`**

```ts
export interface MoveApi {
  set(scope: string, value: unknown): Promise<string | null>;
  unset(scope: string): Promise<string | null>;
}

/** Moves the source layer's AUTHORED value, not the effective one: for a
    deep-merged key the effective value includes defaults and other layers,
    which must not be baked into the target. */
export async function moveValue(
  api: MoveApi,
  from: string,
  to: string,
  authored: { present: boolean; value?: unknown },
): Promise<string | null> {
  if (from === to) return `already in ${to}`;
  if (!authored.present) return `${from} holds no value to move`;
  const setErr = await api.set(to, authored.value);
  if (setErr) return setErr;
  const unsetErr = await api.unset(from);
  return unsetErr ? `moved to ${to}, but ${from} still holds a value: ${unsetErr}` : null;
}
```

- [ ] **Step 4: Wire it into `useSettingsScope`**

In `react.ts` add `import { moveValue } from "./move.ts";`, add to `SettingsScopeState`:

```ts
  /** Move one key's authored value from one scope's store to another. */
  move: (key: string, from: string, to: string) => Promise<string | null>;
```

and inside `useSettingsScope`, after `unset`:

```ts
  const move = useCallback(
    async (key: string, from: string, to: string): Promise<string | null> => {
      let rows: ExplainRowWire[];
      try {
        rows = (await getJson<{ rows: ExplainRowWire[] }>(`${base}/explain/${encodeURIComponent(key)}`)).rows;
      } catch (err) {
        return (err as Error).message;
      }
      const source = rows.find((r) => r.scope === from);
      return moveValue(
        { set: (scope, value) => set(key, scope, value), unset: (scope) => unset(key, scope) },
        from,
        to,
        { present: source?.present === true && "value" in source, value: source?.value },
      );
    },
    [base, set, unset],
  );
```

Add `move` to the returned object and to the `useMemo` dependency list.

- [ ] **Step 5: Run tests and types**

Run: `bun test packages/settings-kit && cd packages/settings-kit && bun run check-types`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/settings-kit/src/move.ts packages/settings-kit/src/react.ts packages/settings-kit/src/__tests__/move.test.ts
git commit -m "settings-kit: move a key's authored value between scopes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Document, version, merge, publish

**Files:**
- Modify: `packages/settings-kit/package.json` (`version`)
- Modify: `packages/settings-kit/README.md`

- [ ] **Step 1: Bump and document**

Set `"version": "0.2.0"`. Append to the README:

````markdown
## Shapes

```ts
import { SHAPES, rowKind, summarize, targetScope, matchesShape } from "@mattstack/settings-kit/shapes";
```

Headless declarations for composite keys (`stringList`, `pairList`,
`stringMap`, `leaves`, and `external` for editors another app owns) plus
the helpers a settings UI needs: `rowKind` picks a control, `summarize`
gives the collapsed line, `targetScope` says where an edit lands (the
winning layer when allowed, else the key's first scope).

Pass `allowComposite: "shaped"` to `settingsHandler` to admit composite
writes only for keys `SHAPES` declares, and only with a matching value.
Writes also require an `application/json` body (415 otherwise).

`useSettingsScope(...).move(key, from, to)` moves the source layer's
authored value to another scope, then clears the source.
````

- [ ] **Step 2: Full gate**

Run from the rt repo root: `bun test packages/settings-kit lib/__tests__/notification-shape-parity.test.ts && (cd packages/settings-kit && bun run check-types && bun run build) && sh scripts/repo-purity.sh`
Expected: all green.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add packages/settings-kit/package.json packages/settings-kit/README.md
git commit -m "settings-kit 0.2.0: document shapes, shaped writes, move

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --repo m4ttstack/rt --title "settings-kit 0.2.0: shared shapes, strongest effective layer, shaped writes" --body "$(cat <<'EOF'
Fixes settings-kit reporting the weakest layer as effective (explain rows are weakest-first), adds a headless `shapes` entry, an `allowComposite: "shaped"` write gate, JSON-only writes, and `move`.

Consumers: board and console in m4ttstack/apps (plan B).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Review and CI**

Wait for CodeRabbit's review and address every actionable finding; if CodeRabbit is rate limited, dispatch an Opus subagent reviewer instead. Wait for CI green. Ask Matt to confirm the merge, then merge.

- [ ] **Step 5: Publish from `main`**

```bash
git -C ~/Documents/GitHub/repo-tools checkout main && git -C ~/Documents/GitHub/repo-tools pull --ff-only
cd ~/Documents/GitHub/repo-tools/packages/settings-kit && bun run build && grep -c "targetScope" dist/shapes.js && grep -c "moveValue" dist/react.js
```

Then publish with the `matt:npm-publish` skill (OTP from Bitwarden's npmjs.com entry): `npm publish --otp <code>` from `packages/settings-kit`.

- [ ] **Step 6: Verify the registry**

After 3 to 5 minutes: `npm view @mattstack/settings-kit version` prints `0.2.0`, and `npm view @mattstack/settings-kit exports --json` includes `./shapes`. Plan B starts only after this.
