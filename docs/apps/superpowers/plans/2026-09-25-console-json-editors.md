# Console JSON Editors, Per-Repo View and Fix Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every writable JSON settings key is readable and editable in console (forms where the shape allows, JSON everywhere), per-repo values are visible and editable for a picked repo, stored values that fail their schema are easy to find and fix, and board and boxscore render their composite rows from the schema instead of hand-kept tables.

**Architecture:** The apps move to rt-client 0.32.0 and settings-kit 0.4.0 (plan 1), which put each key's JSON Schema, per-layer issues, repo resolution and a repo list on the settings-kit wire. Console replaces settings-kit's React hooks with two small repo-aware hooks of its own (the kit's hooks take no repo), keeps the picked repo in `?repo=` and a React context, and draws every composite row from `recognize(def.schema)` plus a console-side `formShape(schema)` that also admits maps and lists of objects whose optional properties are nested (drawn read-only). Item cards, named sections and a JSON editor share one draft model (`DraftEditor`): a local draft checked by settings-kit's `checkValue` against the layer schema, saved only when it passes. The JSON editor is the kit's lazy `CodeMirror`, which gains `jsonSchema` (completion) and `jsonCheck` (lint through the caller's checker, so underline text matches the issue line) behind its lazy boundary.

**Tech Stack:** Bun 1.4.2, TypeScript, React 19, Mantine 9.5 through `@mattstack/app-kit`, wouter, Vitest + Testing Library (console, boxscore, packages/ui), bun:test (board, deck), CodeMirror 6 (`@codemirror/lint`, `@codemirror/autocomplete`, `@codemirror/language`), `@mattstack/rt-client` 0.32.0, `@mattstack/settings-kit` 0.4.0.

**Spec:** `docs/superpowers/specs/2026-09-25-console-json-editors-design.md` (spec 2). Its dependency, read-only: spec 1 at `~/.mattstack/rt/worktrees/gh-m4ttstack-rt/bilbo/docs/superpowers/specs/2026-09-25-settings-schemas-design.md` and plan 1 at `.../bilbo/docs/superpowers/plans/2026-09-25-settings-schemas.md`. Spec 3 (`.../bilbo/docs/superpowers/specs/2026-09-25-settings-migrations-design.md`) is read only for the diverged wire fields pinned below.

## Baseline (A0)

On 2026-09-25 at `6296e43f`: `bun install` exit 0; `bun run console:test` 66 files, 843 tests passed. The first run printed one unhandled error from `src/app/App.test.tsx` (a `deckBase` effect settling after teardown) and exited 1; the immediate rerun exited 0 with no error. Treat that App.test.tsx unhandled error as a known flake: if it appears in a task gate, rerun the gate once; if it appears twice in a row, stop and report it as BLOCKED instead of changing App.test.tsx.

## Decisions made while planning

- **deck.apps as named sections (Matt, gate ee475cb4, q1).** Plan 1's `recognize` calls `deck.apps` `json` because its `override` property is a nested object. Console's `formShape` admits a list or map of objects whenever every required property is a scalar and at least one property is; nested properties are drawn read-only with an "Edit as JSON" note, exactly like unknown extras, and kept on save. Under the current lock this admits, beyond recognize's own objectList/objectMap keys: `deck.apps`, `rt.roles`, `rt.sdmEnrichment` (named sections). `rt.intercepts`, `rt.presets` and `board.tabs` stay JSON (a required property is nested).
- **Diverged wire fields (Matt, gate ee475cb4, q2).** Pinned here; the spec 3 planner (`plan-settings-migrations`) was told by rt chat DM #3691 to match:
  - `/defs` `issues[]` entry: `{ scope, file, repo?, kind: "diverged", path: [], message, storeName, olderValue, currentValue }`. `storeName` is the OLDER store name (`rt.roles` when the current one is `rt.roles@2`); `olderValue` is that name's value migrated to the current shape; `currentValue` is the current name's authored value in the same section. Neither value is sent for a secret def.
  - Explain rows carry `storeName`, `storedVersion`, `value` (migrated) and `authored` (as stored). Console reads only `value`, which is what every editor already starts from.
  - `POST {base}/prune` with `{ key, scope, repo?, storeName, force? }`, same local-only gate as `/set`; success `{ rows, effective }` 200, refusal `{ error }` 400.
- **Repo-aware hooks live in console.** settings-kit 0.4.0's `useSettingsScope` and `useSettingKey` send no `repo` and drop `unregistered`, so console owns `useConsoleSettings(repo, prefix)` and `useKeyExplain(key, repo)`. Move stays settings-kit's (`move.ts` is not exported), borrowed from a `useSettingsScope` instance whose prefix matches no key; in a picked repo, Move is offered only when the value comes from a global layer. Remove works everywhere.
- **CodeMirror lints through the caller's checker.** The kit takes `jsonCheck?: (value) => { path, message }[]` beside `jsonSchema?: object`, so the underline text and console's issue line are the same `checkValue` output and the kit gains no validator. The completion and path mapping are hand-rolled (about 200 lines); `codemirror-json-schema` pulls in shiki and markdown-it.
- **Where a row states its reach.** A repo-scoped row's reach (`all repos · set in 2 repos`, or `for acme/app`) sits on the row's name line after its badge, not inside the 260px control column, so no control shrinks. A repo rung's badge reads `team · repo`, `user · repo`, `machine · repo`, keeping the badges' existing `user` word (the spec's example writes `you · repo`; the page's badges have always said `user`).
- **Board keeps its widgets.** Board's composite keys recognize as `stringList` and `leaves` only (plus its three `external` keys), so "the same schema-based widgets" means board's existing ChipControl and LeavesControl, now chosen by `recognize`. Any other kind on a board key renders read-only.

## Global Constraints

- rt-client and settings-kit pins: `"@mattstack/rt-client": "0.32.0"`, `"@mattstack/settings-kit": "0.4.0"` in the root `package.json` `workspaces.catalog`. If `npm view @mattstack/settings-kit@0.4.0 version` or `npm view @mattstack/rt-client@0.32.0 version` prints nothing, stop and report BLOCKED: plan 1 has not published.
- Every console task gate, run bare from the worktree root, each command on its own (never piped through `tail`, `head` or `grep`; a pipe hides the exit code): `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`. Tasks that touch board, boxscore, deck or packages/ui add those suites' own commands as listed in the task.
- Commit trailer on every commit, verbatim: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit on branch `console-json-editors`; never push.
- Fixture data is invented: repo identity `gitlab.example.com/acme/app` (label `acme/app`), a second `gitlab.example.com/acme/web` (label `acme/web`), files under `/home/user/...` and `/home/team/...`. No real repo identities, team names, people or employer names anywhere.
- No em or en dashes in any new text: code, comments, test names, UI copy, commit messages.
- Comments state constraints the code cannot show; no narration, no task numbers, no review history in source.
- UI colour and type follow `docs/ui-authoring.md`: `--tk-*` role tokens or `useSchemeColors()` roles only, weights 400/500/700, every `Text` states `fz`. Error text is `var(--tk-text-bad-small)`, warning text `var(--tk-text-warn-small)`, muted `text.muted`. No raw colour values.
- Mantine: look it up, never recall it. Before using any Mantine component or prop not already used in `apps/console/src/app/settings/`, check it with the Mantine MCP (`get_item_props`) or the installed `@mantine/core` type declarations (`node_modules/.bun/@mantine+core@*/node_modules/@mantine/core/lib/components/<Name>/<Name>.d.ts`).
- Import walls: app code imports Mantine only through `@mattstack/app-kit/*`; CodeMirror packages only inside `packages/ui/src/lazy/codemirror/`.
- UI validation is mandatory for every task that changes UI: a Fast Browser pass against a local console build on live data in BOTH colour schemes, following "UI validation recipe" below. Say plainly what looks wrong; tests passing is not validation.
- Never save through the test server. After every browser session: `rt settings get rt.notify.eventBridges --json` and confirm both `run:` and `gate/escalated/*` rule urls read `https://console.mattstack/gates/{id}`; if not, restore them with `rt settings set` to that value and say so in the report.

## Review Focus

1. **A deep-merge key edited through a form or JSON writes only the target layer's own fields.** Editing `gitq.forges` at `user` when the registry default also sets an entry must write exactly the user layer's authored map plus the edit, never a merged copy. Pinned in Task 9 (`a deep map edits only the target layer's own entries`).
2. **A repo-scoped write while a repo is picked carries `repo`, and a global value in a picked repo is still editable.** A row whose effective value comes from the global `team` layer, edited in `acme/app`, writes `team` with `repo: "gitlab.example.com/acme/app"` (a new repo override), never the global layer. Pinned in Task 5 (`useRowSave` target test).
3. **Escape inside the JSON editor abandons the draft and leaves the explain modal open.** CodeMirror's content element is `contenteditable="true"`, which `ESCAPE_OWNERS` already covers; a regression here closes the modal and loses the edit. Pinned in Task 10.
4. **An item card with an unknown extra property keeps it on save.** A stored `rt.notify.eventBridges` item with `{"legacy": 1}` is shown read-only and written back unchanged after editing another field. Pinned in Task 8.
5. **A nonconforming stored value never opens a form that would drop data.** A `rt.notify.eventBridges` user layer holding a non-array opens Fix in JSON, not in cards, and Save stays disabled until it passes. Pinned in Task 11.

## UI validation recipe

Every UI task ends with this, run by the implementer (or a `fast-browser:browser-driver` subagent given this whole section verbatim):

1. `bun run console:build` (rebuilds `apps/console/dist`; `serve` answers the UI from it).
2. Print the current bridge rules with `rt settings get rt.notify.eventBridges --json` and keep the `url` values in your report notes (do not save them to a file).
3. Start the branch server in the background from `apps/console`: `bun run serve` (it listens on `http://localhost:11011`; the live console stays on deck's 11001). Wait until `curl -s http://localhost:11011/api/health` answers `{"ok":true,...}`.
4. Drive `http://localhost:11011/settings` with Fast Browser by raw port. Never open a `*.mattstack` URL: it hands the tab to the mattstack app and kills the session. Use one `browser_run_code_unsafe` script per scheme that first installs `await page.route(/\/api\/settings\/(set|unset|prune)$/, r => r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'validation run: writes disabled' }) }))`, so no click can write, then sets `await page.emulateMedia({ colorScheme: 'light' })` (then `'dark'`), navigates, performs the task's checks, and takes screenshots. Compare with the live page at `http://localhost:11001/settings` in the same scheme where the task says "compared with the current page".
5. Stop the server (kill the background job), then run the bridge check from Global Constraints.
6. In the task report, list each screenshot, what it shows, and anything that reads wrong (clipping, contrast, alignment, a control that shifts the row height, text that wraps badly). Fix what reads wrong before committing, or report it as an open concern.

---

## File structure

**Root**
- `package.json` (modify): catalog pins for rt-client and settings-kit.

**packages/ui (kit)**
- `packages/ui/package.json` (modify): dependencies gain `@codemirror/autocomplete`, `@codemirror/language`, `@codemirror/lint`.
- `packages/ui/src/lazy/codemirror/jsonSchema.ts` (create): `JsonPathIssue`, `JsonSchemaCheck`, `nodeAtPath`, `jsonDiagnostics`, `jsonSchemaCompletion`. Imported only by `CodeMirror.Base.tsx`.
- `packages/ui/src/lazy/codemirror/jsonSchema.test.ts` (create).
- `packages/ui/src/lazy/codemirror/CodeMirror.Base.tsx` (modify): `jsonSchema?`, `jsonCheck?` props in a compartment.
- `packages/ui/src/lazy/codemirror/CodeMirror.tsx`, `packages/ui/src/lazy/index.ts` (modify): export the two types.
- `packages/ui/src/lazy/codemirror/CodeMirror.stories.tsx` (modify): a `JsonWithSchema` story.

**apps/console (`apps/console/src/app/settings/`)**
- `testSchemas.ts` (create): literal JSON Schemas for the keys console tests use; `testSchemas.test.ts` (create, node env) pins them to rt-client's registry.
- `issues.ts` (create): `issuePath`, `issueText`, `issuesUnder`, `issueWhere`, `issueLine`, `DivergedIssue`, `isDiverged`.
- `useConsoleSettings.ts` (create): `ConsoleStore`, `useConsoleSettings`, `useKeyExplain`, `useRepos`, `SettingsRepoContext`, `useSettingsRepo`, `prune`.
- `formShape.ts` (create): `FieldSpec`, `FormShape`, `formShape`, `newEntry`, `visibleFields`, `addableFields`, `extraKeys`.
- `FieldGrid.tsx` (create): one object's fields (controlled inputs, Add property menu, read-only extras).
- `ItemCards.tsx`, `NamedSections.tsx` (create): the two form editors over a draft value.
- `JsonDraft.tsx` (create): the JSON editor over the kit's `CodeMirror`.
- `DraftEditor.tsx` (create): the shared draft (form or JSON), Save and Cancel, first issue line.
- `JsonBlock.tsx` (create): pretty-printed capped value block.
- `IssueLines.tsx` (create): per-issue warning lines with Fix.
- Tests (create): `useConsoleSettings.test.tsx`, `formShape.test.ts`, `ItemCards.test.tsx`, `NamedSections.test.tsx`, `JsonEditor.test.tsx`, `FixFlow.test.tsx`, `SpecialRows.test.tsx`, `Diverged.test.tsx`.
- `RepoPicker.tsx` (create): the toolbar select.
- `RepoReach.tsx` (create): the row's "all repos · set in N repos" or repo label.
- `UnregisteredNote.tsx` (create): the footer note.
- `DivergedPanel.tsx` (create): both values, Use the older value, Remove the older name.
- Modified: `view.ts` (layer rungs, write targets, `repoLabel`, `targetLabel`, `EDITOR_KINDS`, `needsFixing`, `APPROVAL_KEY`), `useRowSave.ts`, `SettingRow.tsx`, `CompositeControls.tsx`, `ExplainModal.tsx`, `SettingsPage.tsx`, `SettingsSection.tsx`, `RowMenu.tsx`, `ScopeBadge.tsx`, `explainParam.ts`, `../config/chain.ts` (unchanged API; `shortValue` stays for the sentence), and their tests.
- `apps/console/src/server/event-bridge-validate.test.ts` (create): the reconciled rule passes `validateWrite`.

**apps/board**
- `src/client/board/config-shapes.ts` (modify): `COMPOSITE_SHAPES` becomes `shapeOf(def)` over `recognize(def.schema)`.
- `src/client/board/ConfigModal.tsx` (modify): three call sites.
- `src/client/__tests__/config-shapes.test.ts` (modify).
- `src/__tests__/config-store-latch.test.ts` (modify): its `fakeWrite` holds every saver's write to `validateWrite`.
- `src/__tests__/writers-validate.test.ts` (create): the gate bridge rule passes `validateWrite`.

**apps/boxscore**
- `src/app/settings/shapes.ts` (modify): `COMPOSITE_SHAPES` becomes `shapeOf(def)` over `recognize`.
- `src/app/settings/SettingsPage.tsx`, `SettingsPage.test.tsx` (modify).
- `src/app/settings/writers-validate.test.ts` (create, node env).

**apps/deck**
- `core/settings.test.ts` (modify): every `deck.apps` write passes `validateWrite`.

---
### Task 1: Move to rt-client 0.32.0 and settings-kit 0.4.0; console and board read composite shapes from the schema

settings-kit 0.4.0 shrinks `SHAPES` to the three `external` board keys and adds `recognize(schema)`. Without this task's code changes every console composite editor and board's `COMPOSITE_SHAPES` go read-only on the bump, so the bump and the switch to `recognize` land together. Previously shaped keys must render exactly as before.

**Needs from spec 1's wire contract:** `SettingDefWire.storeVersion: number` (required), `schema?`, `layerSchema?` (deep object keys); `recognize(schema): Recognized` with kinds `stringList | stringMap | leaves | objectList | objectMap | json` (`leaves` carries `fields` and `placeholders`, `stringMap` carries `labels`); `matchesSchema(def, value)`; `SHAPES` holding only `board.tabs`, `board.members`, `board.hiddenMembers` as `external`; `RowKind` adding `objectList | objectMap | json`; `allowComposite: "shaped"` admitting every non-external composite key that has a schema (so those defs arrive `writable: true`); rt-client `getDef(key).schema` / `.layerSchema` attached from the lock.

**Files:**
- Modify: `package.json` (root catalog)
- Create: `apps/console/src/app/settings/testSchemas.ts`, `apps/console/src/server/testSchemas.test.ts`
- Modify: `apps/console/src/app/settings/CompositeControls.tsx`, `apps/console/src/app/settings/view.ts`
- Modify (test fixture only): `apps/console/src/server/settings-kit-mount.test.ts`
- Modify (test fixtures only): `apps/console/src/app/settings/{CompositeControls,SettingRow,SettingsPage,ExplainModal}.test.tsx`, `apps/console/src/app/settings/view.test.ts`, `apps/console/src/app/config/chain.test.ts`
- Modify: `apps/board/src/client/board/config-shapes.ts`, `apps/board/src/client/board/ConfigModal.tsx`, `apps/board/src/client/__tests__/config-shapes.test.ts`, `apps/board/src/client/board/__tests__/config-leaves-dom.test.tsx`
- Modify (test fixture only): `apps/boxscore/src/app/settings/SettingsPage.test.tsx`
- Modify (test seeding only): `apps/deck/core/settings.test.ts`, `apps/deck/src/edge/oauth.test.ts`

**Interfaces:**
- Consumes: settings-kit 0.4.0 `recognize`, `matchesSchema`, `Recognized`; rt-client 0.32.0 `getDef`, `allDefs`.
- Produces:
  - `testSchemas.ts` (a plain module under `src/app/settings/`, imported only by tests): `TEST_SCHEMAS: Record<string, JsonSchema>`, `layerOf(schema: JsonSchema): JsonSchema`, `schemaFields(key: string): { schema?: JsonSchema; layerSchema?: JsonSchema }` (layerSchema only for the keys listed in `DEEP_KEYS`).
  - `view.ts`: `EDITOR_KINDS: ReadonlySet<RowKind>` (this task: `scalar`, `enum`, `stringList`, `stringMap`, `leaves`); `isEditable(def)` reads it.
  - board `config-shapes.ts`: `shapeOf(def: Pick<ConfigDef, 'key' | 'schema'>): CompositeShape | undefined` replacing `COMPOSITE_SHAPES`.

- [ ] **Step 1: Confirm plan 1 has published**

Run: `npm view @mattstack/rt-client@0.32.0 version` and `npm view @mattstack/settings-kit@0.4.0 version`
Expected: `0.32.0` and `0.4.0`. If either prints nothing, stop: report BLOCKED (plan 1 not published).

- [ ] **Step 2: Bump the catalog and install**

In the root `package.json` `workspaces.catalog`, change `"@mattstack/rt-client": "0.31.1"` to `"@mattstack/rt-client": "0.32.0"` and `"@mattstack/settings-kit": "0.3.0"` to `"@mattstack/settings-kit": "0.4.0"`.

Run: `bun install`
Expected: exit 0, `bun.lock` changes only in the rt-client and settings-kit entries plus `@cfworker/json-schema` (settings-kit's new dependency).

- [ ] **Step 3: See what breaks**

Run: `bun run console:typecheck` then `bun run board:typecheck` then `bun run boxscore:typecheck`
Expected: FAIL. Every `SettingDefWire` literal in the test files listed under Files lacks `storeVersion`; board's `config-shapes.ts` still compiles but `COMPOSITE_SHAPES` is now nearly empty at runtime.

- [ ] **Step 4: Write the fixture schemas and their parity test**

Create `apps/console/src/app/settings/testSchemas.ts`:

```ts
import type { SettingDefWire } from '@mattstack/settings-kit/react';

type JsonSchema = NonNullable<SettingDefWire['schema']>;

const D = 'https://json-schema.org/draft/2020-12/schema';
const STRING_LIST = { $schema: D, type: 'array', items: { type: 'string' } };

/** Literal copies of the registry's JSON Schemas for the keys console tests
    render. testSchemas.test.ts fails when one drifts from rt-client's. */
export const TEST_SCHEMAS: Record<string, JsonSchema> = {
  'board.ticketPrefixes': STRING_LIST,
  'boxscore.excludeFilePatterns': STRING_LIST,
  'rt.repoRoots': STRING_LIST,
  'rt.homeSnapshot': {
    $schema: D,
    type: 'object',
    properties: {
      enabled: { type: 'boolean' },
      debounceSec: { type: 'number' },
      pushDelaySec: { type: 'number' },
      janitorThresholdHours: { type: 'number' },
      janitorIntervalMin: { type: 'number' },
    },
    required: [
      'enabled',
      'debounceSec',
      'pushDelaySec',
      'janitorThresholdHours',
      'janitorIntervalMin',
    ],
    additionalProperties: {},
  },
  'rt.runaway': {
    $schema: D,
    type: 'object',
    properties: {
      cpuThreshold: { type: 'number' },
      sustainMs: { type: 'number' },
      graceMs: { type: 'number' },
    },
    additionalProperties: {},
  },
  'rt.repoIdentityOverrides': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: { type: 'string' },
    labels: { key: 'remote URL', value: 'identity' },
  },
  'rt.cron': {
    $schema: D,
    type: 'object',
    properties: {
      triggers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1 },
            event: { type: 'string', minLength: 1 },
            run: { minItems: 1, type: 'array', items: { type: 'string' } },
            repoName: { type: 'string' },
            debounceMs: { type: 'number', exclusiveMinimum: 0 },
          },
          required: ['name', 'event', 'run'],
          additionalProperties: {},
        },
      },
    },
    additionalProperties: {},
  },
  'rt.roles': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: {
      type: 'object',
      properties: {
        pool: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'number' },
              {
                type: 'object',
                properties: { from: { type: 'number' }, to: { type: 'number' } },
                required: ['from', 'to'],
                additionalProperties: {},
              },
            ],
          },
        },
        fixedPort: { type: 'number' },
        needs: { type: 'array', items: { type: 'string' } },
        preserveEnv: { type: 'array', items: { type: 'string' } },
        env: {
          type: 'object',
          propertyNames: { type: 'string' },
          additionalProperties: { type: 'string' },
        },
        hook: { type: 'string' },
      },
      additionalProperties: {},
    },
  },
  'rt.intercepts': {
    $schema: D,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        command: { type: 'string', minLength: 1 },
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cwdGlob: { type: 'string' },
              role: { type: 'string' },
              argPattern: { type: 'string' },
              argInject: {
                type: 'object',
                properties: {
                  afterArg: { type: 'string' },
                  template: { type: 'string' },
                  skipIfArgPresent: { type: 'string' },
                },
                required: ['afterArg', 'template', 'skipIfArgPresent'],
                additionalProperties: {},
              },
            },
            required: ['cwdGlob', 'role'],
            additionalProperties: {},
          },
        },
      },
      required: ['command', 'matches'],
      additionalProperties: {},
    },
  },
  'rt.notify.eventBridges': {
    $schema: D,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        category: { type: 'string' },
        title: { type: 'string' },
        message: { type: 'string' },
        subjectPrefix: { type: 'string' },
        url: { type: 'string' },
        owner: { type: 'string', const: 'human' },
        surface: { type: 'string' },
      },
      required: ['pattern', 'category', 'title', 'message'],
      additionalProperties: {},
    },
  },
  'gitq.forges': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['gitlab', 'github'] },
        baseUrl: { type: 'string' },
        tokenEnv: { type: 'string' },
      },
      required: ['provider'],
      additionalProperties: {},
    },
    labels: { key: 'host', value: 'forge' },
  },
  'deck.apps': {
    $schema: D,
    type: 'object',
    propertyNames: { type: 'string' },
    additionalProperties: {
      type: 'object',
      properties: {
        published: { type: 'boolean' },
        publicFollowsOverride: { type: 'boolean' },
        passwordHash: { type: 'string' },
        passwordVersion: { type: 'number' },
        override: {
          type: 'object',
          properties: {
            devPort: { type: 'number' },
            basePort: { type: 'number' },
          },
          required: ['devPort', 'basePort'],
          additionalProperties: {},
        },
      },
      additionalProperties: {},
    },
  },
  'board.members': {
    $schema: D,
    type: 'array',
    items: {
      type: 'object',
      properties: {
        username: { type: 'string' },
        name: { type: 'string' },
        hidden: { type: 'boolean' },
        agePublicKey: { type: 'string' },
      },
      required: ['username'],
      additionalProperties: {},
    },
  },
};

/** Keys whose registry def merges deep, so their wire def carries a layer
    schema. */
export const DEEP_KEYS = new Set([
  'rt.homeSnapshot',
  'rt.runaway',
  'rt.cron',
  'rt.roles',
  'gitq.forges',
  'deck.apps',
]);

/** rt-client's layerJsonSchema: every `required` dropped except inside
    array items, because deep merge replaces arrays whole. */
export function layerOf(schema: JsonSchema): JsonSchema {
  return relax(schema, false) as JsonSchema;
}

function relax(node: unknown, insideArray: boolean): unknown {
  if (Array.isArray(node)) return node.map(n => relax(n, insideArray));
  if (typeof node !== 'object' || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'required' && !insideArray) continue;
    if (k === 'items' || k === 'prefixItems') out[k] = relax(v, true);
    else if (k === 'properties')
      out[k] = Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [
          pk,
          relax(pv, insideArray),
        ])
      );
    else out[k] = relax(v, insideArray);
  }
  return out;
}

export function schemaFields(
  key: string
): Pick<SettingDefWire, 'schema' | 'layerSchema'> {
  const schema = TEST_SCHEMAS[key];
  if (!schema) return {};
  return DEEP_KEYS.has(key)
    ? { schema, layerSchema: layerOf(schema) }
    : { schema };
}
```

Create the parity test under `src/server/` (console's eslint wall bans value imports of `@mattstack/rt-client` anywhere under `src/app/`), as `apps/console/src/server/testSchemas.test.ts`:

```ts
// @vitest-environment node
import { getDef } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  DEEP_KEYS,
  schemaFields,
  TEST_SCHEMAS,
} from '../app/settings/testSchemas';

describe('test schemas', () => {
  it.each(Object.keys(TEST_SCHEMAS))(
    '%s matches the registry schema and layer schema',
    key => {
      const def = getDef(key);
      expect(def).toBeDefined();
      expect(TEST_SCHEMAS[key]).toEqual(def!.schema);
      expect(schemaFields(key).layerSchema).toEqual(def!.layerSchema);
      expect(DEEP_KEYS.has(key)).toBe(def!.merge === 'deep');
    }
  );
});
```

- [ ] **Step 5: Run the parity test**

Run: `cd apps/console && bunx vitest run src/server/testSchemas.test.ts && cd ../..`
Expected: PASS for every key. A failure means the registry changed after this plan was written: copy the registry's schema (print it with `bun -e "import { getDef } from '@mattstack/rt-client'; console.log(JSON.stringify(getDef('<key>').schema, null, 2))"` from `apps/console`) into `TEST_SCHEMAS` and note the key in your report.

- [ ] **Step 6: Update every test def factory**

In each console test file listed under Files, the local `def(...)` factory (and any inline `SettingDefWire` literal the typecheck flags) gains `storeVersion: 1` and, before `...over`, `...schemaFields(key)`, importing `schemaFields` from `./testSchemas` (from `../settings/testSchemas` in `config/chain.test.ts`). For example `CompositeControls.test.tsx`'s factory becomes:

```ts
function def(key: string, over: Partial<SettingDefWire>): SettingDefWire {
  return {
    key,
    type: 'array',
    scopes: ['machine'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A composite.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}
```

`config/chain.test.ts`'s factory takes no key, so it gets `storeVersion: 1` only. `CompositeControls.test.tsx` builds `rt.homeSnapshot` defs with `merge: 'replace'` in some cases; leave the `merge` overrides as they are (the test controls merge explicitly). In `apps/boxscore/src/app/settings/SettingsPage.test.tsx`, add `storeVersion: 1` only (boxscore moves to schemas in Task 3).

`apps/console/src/server/settings-kit-mount.test.ts` fakes the registry: under 0.4.0, `allowComposite: 'shaped'` admits a composite only when it has a schema, so give the fake `rt.repoRoots` def `schema: { type: 'array', items: { type: 'string' } }` and leave `rt.cron` without one. Its two expectations then hold as written (`rt.repoRoots` writable, `rt.cron` not, and `refuses a composite with no shape` still answers 400).

- [ ] **Step 7: Run the console suite to see the behavioural failures**

Run: `bun run console:test`
Expected: FAIL in `CompositeControls.test.tsx` and `SettingRow.test.tsx`: every composite editor renders read-only because `CompositeControls.tsx` still reads `SHAPES[def.key]`.

- [ ] **Step 8: Read shapes from the schema in `CompositeControls.tsx`**

Replace the settings-kit import block:

```ts
import {
  addToList,
  getLeaf,
  matchesSchema,
  recognize,
  summarize,
  targetScope,
  type LeafType,
  type RowKind,
} from '@mattstack/settings-kit/shapes';
```

`DeepShapeLock` loses its `shape` prop and checks each layer against the def's layer schema:

```tsx
/** A deep key's merged value can fail its schema because of any layer, so
    Clear targets the strongest layer whose own value fails, not the winner. */
function DeepShapeLock({ def, row }: { def: SettingDefWire; row: Row }) {
  const { rows, loading } = useSettingKey(def.key);
  const bad = [...rows]
    .reverse()
    .find(
      r =>
        r.present &&
        isStoreScope(r.scope) &&
        r.value !== undefined &&
        !matchesSchema(def, r.value)
    );
  return (
    <ShapeLock
      at={bad?.scope ?? def.effective.scope}
      row={row}
      loading={loading}
    />
  );
}
```

In `compositeParts`, replace everything from `const shape = SHAPES[def.key];` through the `if (kind === 'leaves' && shape.kind === 'leaves')` branch with:

```tsx
  const shape = recognize(def.schema);
  const value = def.effective.value;
  const toggle = (
    <ExpandToggle label={summarize(def)} open={open} onToggle={onToggle} />
  );
  const readonly =
    (value === undefined && !def.secret) || def.effective.scope === null
      ? { control: <UnsetSummary />, body: null }
      : { control: toggle, body: open ? <ReadonlyBody def={def} /> : null };

  if (
    kind !== 'stringList' &&
    kind !== 'stringMap' &&
    kind !== 'leaves'
  )
    return readonly;

  // An invalid winning layer arrives with no value; an editor seeded from
  // nothing would discard whatever that layer stores on its first edit.
  if (
    def.effective.invalid !== undefined ||
    (value !== undefined && !matchesSchema(def, value))
  ) {
    return {
      control:
        def.merge === 'deep' && def.effective.invalid === undefined ? (
          <DeepShapeLock def={def} row={row} />
        ) : (
          <ShapeLock at={def.effective.scope} row={row} />
        ),
      body: null,
    };
  }

  if (kind === 'stringList') {
    const list = strings(value);
    if (
      list.length <= INLINE_MAX_ITEMS &&
      list.every(x => x.length <= INLINE_MAX_CHARS)
    )
      return {
        control: <InlineTags def={def} row={row} list={list} />,
        body: null,
      };
    return {
      control: toggle,
      body: open ? <StringListBody def={def} row={row} /> : null,
    };
  }
  if (shape.kind === 'stringMap')
    return {
      control: toggle,
      body: open ? (
        <StringMapBody def={def} row={row} labels={shape.labels} />
      ) : null,
    };
  if (shape.kind === 'leaves')
    return {
      control: toggle,
      body: open ? (
        <LeavesBody
          def={def}
          row={row}
          shape={{ fields: shape.fields, fallbacks: shape.placeholders }}
        />
      ) : null,
    };
  return readonly;
```

(`kind` is `rowKind(def)`, which already returns `readonly` for secret and unwritable defs, so the old `kind === 'readonly' || !shape` guard is covered by the first `if`.) Remove the now-unused `CompositeShape` import and `SHAPES`/`matchesShape` references. `SettingRow.tsx` keeps `SHAPES[def.key]` for the external owner label: `SHAPES` still holds the external keys.

- [ ] **Step 9: Keep the Editable count on today's editor kinds**

In `view.ts`, import `type RowKind` from `@mattstack/settings-kit/shapes` and replace `isEditable`:

```ts
/** Row kinds console draws an editor for. JSON kinds join as their editors
    land; until then they render read-only and do not count as editable. */
export const EDITOR_KINDS: ReadonlySet<RowKind> = new Set<RowKind>([
  'scalar',
  'enum',
  'stringList',
  'stringMap',
  'leaves',
]);

export function isEditable(def: SettingDefWire): boolean {
  return EDITOR_KINDS.has(rowKind(def));
}
```

- [ ] **Step 10: Run the console suite**

Run: `bun run console:test`
Expected: PASS. If `an unshaped composite is read-only with a preview and its file` fails, check that `rt.cron`'s def carries its schema (from `schemaFields`) and recognizes as `json`.

- [ ] **Step 11: Board: write the failing test for `shapeOf`**

In `apps/board/src/client/__tests__/config-shapes.test.ts`, replace `COMPOSITE_SHAPES` in the import list with `shapeOf`, make the local `def` factory carry the registry schema:

```ts
const REGISTRY = new Map(allDefs().map(d => [d.key, d]));

function def(over: Partial<ConfigDef> & { key: string }): ConfigDef {
  return {
    type: 'string',
    scopes: ['team'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: '',
    hasDefault: false,
    defaultValue: undefined,
    effective: { scope: null, file: null },
    storeVersion: 1,
    schema: REGISTRY.get(over.key)?.schema,
    ...over,
  };
}
```

and replace the whole `describe('COMPOSITE_SHAPES', ...)` block with:

```ts
describe('shapeOf', () => {
  test('gives every composite board.* registry key a board editor or a widget', () => {
    const missing = allDefs()
      .filter(
        d =>
          d.key.startsWith('board.') &&
          (d.type === 'object' || d.type === 'array') &&
          !DELIBERATELY_READONLY_COMPOSITES.includes(d.key)
      )
      .filter(d => shapeOf(d) === undefined)
      .map(d => d.key);
    expect(missing).toEqual([]);
  });

  test('previously shaped keys keep their widget, fields and fallbacks', () => {
    expect(shapeOf(REGISTRY.get('board.projects')!)).toEqual({
      kind: 'stringList',
    });
    expect(shapeOf(REGISTRY.get('board.cwds')!)).toEqual({
      kind: 'leaves',
      fields: { review: 'string', respond: 'string', doctor: 'string' },
      fallbacks: {},
    });
    expect(shapeOf(REGISTRY.get('board.slack')!)).toMatchObject({
      kind: 'leaves',
      fallbacks: {
        'emoji.looking': 'eyes',
        'emoji.commented': 'speech_balloon',
        'emoji.approved': 'white_check_mark',
      },
    });
    expect(shapeOf(REGISTRY.get('board.tabs')!)).toEqual({ kind: 'tabs' });
    expect(shapeOf(REGISTRY.get('board.members')!)).toEqual({
      kind: 'roster',
    });
  });

  test('a schema board has no widget for is undefined', () => {
    expect(
      shapeOf({ key: 'board.mystery', schema: { type: 'object' } })
    ).toBeUndefined();
    expect(shapeOf({ key: 'board.mystery', schema: undefined })).toBeUndefined();
  });
});
```

The rest of the file still reads `COMPOSITE_SHAPES` in its `matchesShape` and `tabs shape` blocks. Replace each: `COMPOSITE_SHAPES['board.projects']!` becomes `shapeOf(REGISTRY.get('board.projects')!)!`, `COMPOSITE_SHAPES['board.triage']!` becomes `shapeOf(REGISTRY.get('board.triage')!)!`, `COMPOSITE_SHAPES['board.tabs']!` becomes `shapeOf(REGISTRY.get('board.tabs')!)!`, and `expect(COMPOSITE_SHAPES['board.rtRepos']).toBeUndefined();` becomes:

```ts
    const retired = REGISTRY.get('board.rtRepos');
    expect(retired === undefined || shapeOf(retired) === undefined).toBe(true);
```

Also reword the doc comment above `DELIBERATELY_READONLY_COMPOSITES` ("no COMPOSITE_SHAPES entry") to "no shapeOf editor". `grep -n COMPOSITE_SHAPES apps/board/src` must print nothing once Step 12 is done.

`apps/board/src/client/board/__tests__/config-leaves-dom.test.tsx` builds its `board.triage` def without a schema, so the row would go read-only. Add `import { getDef } from '@mattstack/rt-client';` and, in its `def()` factory, `storeVersion: 1, schema: getDef(KEY)!.schema, layerSchema: getDef(KEY)!.layerSchema,`.

If a `board.cwds` field list differs from `review`/`respond`/`doctor`, the test is right and the registry changed: stop and report it, since board's LeavesControl renders exactly those.

Run: `bun run board:test`
Expected: FAIL, `shapeOf` is not exported.

- [ ] **Step 12: Implement `shapeOf` in board**

In `apps/board/src/client/board/config-shapes.ts`, add `recognize` to the `@mattstack/settings-kit/shapes` import, delete `COMPOSITE_SHAPES` and its doc comment, and add:

```ts
/** A board composite row's editor: board's own for the keys settings-kit
    marks `external`, else the widget matching the kind settings-kit
    recognizes from the def's schema. Board has widgets for string lists and
    leaves only; any other kind has no editor here. */
export function shapeOf(
  def: Pick<ConfigDef, 'key' | 'schema'>
): CompositeShape | undefined {
  const own = BOARD_EDITORS[def.key];
  if (own) return own;
  const r = recognize(def.schema);
  if (r.kind === 'stringList') return { kind: 'stringList' };
  // A bare `{ type: 'object' }` recognizes as leaves with no fields: there is
  // nothing to draw.
  if (r.kind === 'leaves' && Object.keys(r.fields).length > 0)
    return { kind: 'leaves', fields: r.fields, fallbacks: r.placeholders };
  return undefined;
}
```

and in `rowKind`, replace `const shape = COMPOSITE_SHAPES[def.key];` with `const shape = shapeOf(def);`. Remove `SHAPES` from the import if nothing else uses it.

In `apps/board/src/client/board/ConfigModal.tsx`, import `shapeOf` instead of `COMPOSITE_SHAPES` and replace `const shape = COMPOSITE_SHAPES[def.key];` (the one in the row component near line 1058) with `const shape = shapeOf(def);`. `grep -n COMPOSITE_SHAPES apps/board/src` must print nothing afterwards.

- [ ] **Step 13: Seed deck's deliberately malformed store values without the write gate**

Five deck tests seed a malformed value on purpose (to prove deck's reader tolerates it) through the real `setSetting`, which 0.32.0 now refuses: `apps/deck/core/settings.test.ts` (`a resolver throw on the ownership probe degrades to unowned...`, seeding `deck.apps` with `{ poison: '${repoRoot}' }`) and `apps/deck/src/edge/oauth.test.ts` (the tests seeding `deck.access` with `{ a: { tier: 'public' } }`, `{ a: { tier: 'public' }, b: { mode: 'off' } }`, `{ poison: '${repoRoot}' }`, and the `renameOAuth` test's object holding `malformed: { tier: 'public' }`). Keep every value; change only how it is seeded. In each of the two files, next to its existing `userStorePath()`, add:

```ts
/** Writes a value straight into the user store, past rt-client's write
    gate, for tests that need a malformed value on disk. */
function seedUserStore(key: string, value: unknown): void {
  const path = userStorePath();
  mkdirSync(dirname(path), { recursive: true });
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    current = {};
  }
  writeFileSync(path, JSON.stringify({ ...current, [key]: value }, null, 2));
}
```

(add `dirname` from `path` to `settings.test.ts`'s imports if missing) and replace exactly those five `setSetting('<key>', <malformed value>, 'user')` calls with `seedUserStore('<key>', <malformed value>)`. Leave every `setSetting` call that seeds a well-formed value alone. (This was run while writing the plan: the `renameOAuth`-style test passes seeded this way, and deck's own write still succeeds beside the malformed entry.)

- [ ] **Step 14: Run every affected suite**

Run each, bare: `bun run tui-kit:build`, `bun run board:typecheck`, `bun run board:test`, `bun run boxscore:typecheck`, `bun run boxscore:test`, `bun run deck:test`, `bun run chat:test`
Expected: PASS. rt-client 0.32.0's `setSetting` now refuses a schema-invalid value; if any other deck, board or chat test fails because a write it makes is refused, do not change the test's value: stop and report the key, the value and the refusal (Task 2 is where writers are pinned against the schema).

- [ ] **Step 15: Console gates**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`
Expected: all exit 0 (run `bun run format` first if format:check flags only the files you touched).

- [ ] **Step 16: UI validation**

Follow the UI validation recipe. Checks, in both schemes, compared with the live page at `http://localhost:11001/settings`: `board.ticketPrefixes` (inline tags), `rt.repoIdentityOverrides` expanded (key/value rows, labels "remote URL" / "identity"), `board.slack` expanded (leaves with emoji placeholders), `rt.homeSnapshot` expanded (leaves with source badges). They must look identical to the live page. JSON keys such as `rt.notify.eventBridges` now show a row menu (they are writable under 0.4.0); that is expected. Board: run the live-data board on a spare port only if you changed its UI code beyond the three call sites; otherwise the board suite is the check.

- [ ] **Step 17: Commit**

```bash
git add package.json bun.lock apps/console/src/app/settings apps/console/src/app/config/chain.test.ts apps/console/src/server/testSchemas.test.ts apps/console/src/server/settings-kit-mount.test.ts apps/board/src/client apps/boxscore/src/app/settings/SettingsPage.test.tsx apps/deck/core/settings.test.ts apps/deck/src/edge/oauth.test.ts
git commit -m "apps: rt-client 0.32.0, settings-kit 0.4.0; console and board read composite shapes from the schema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pin every app writer against `validateWrite`

**Needs from spec 1's wire contract:** rt-client `validateWrite(def, value, { scope, repoIdentity?, team? }): { ok: true } | { ok: false; reason; issues }` and `getDef(key)`. `validateWrite` reads the stores under `$HOME` for its merged-result check, so each test points `HOME` at an empty temp dir first.

**Files:**
- Create: `apps/console/src/server/event-bridge-validate.test.ts`
- Modify: `apps/board/src/__tests__/config-store-latch.test.ts`
- Create: `apps/board/src/__tests__/writers-validate.test.ts`
- Modify: `apps/deck/core/settings.test.ts`
- Create: `apps/boxscore/src/app/settings/writers-validate.test.ts`

**Interfaces:**
- Consumes: `installConsoleBridgeRule` (`apps/console/src/server/event-bridge.ts`), `boardBridgeRule` (`apps/board/src/gates/ingest.ts`), board's savers through `config-store-latch.test.ts`'s `fakeWrite`, deck's `setPublished`, `setPassword`, `clearPassword`, `setOverride`, `clearOverride`, `setPublicFollowsOverride`, `renameAppSettings` (`apps/deck/core/settings.ts`), boxscore's `asRosterEntries`.
- Produces: tests only.

- [ ] **Step 1: Read the writers**

Read `apps/board/src/gates/ingest.ts` lines 270-320, `apps/board/src/__tests__/config-store-latch.test.ts` lines 1-60 and `apps/deck/core/settings.test.ts` lines 1-70 and 253-275, so the edits below land in the right places.

- [ ] **Step 2: Console bridge rule**

`event-bridge.test.ts` mocks `@mattstack/rt-client` wholesale, so the real gate needs its own file. Create `apps/console/src/server/event-bridge-validate.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EventBridgeRule } from '@mattstack/app-server/event-bridge';
import { getDef, validateWrite } from '@mattstack/rt-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installConsoleBridgeRule } from './event-bridge';

let home: string;
const origHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'console-bridge-'));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const BOARD_RULE: EventBridgeRule = {
  pattern: 'gate/opened/*',
  subjectPrefix: 'mr:',
  category: 'gate',
  title: '{label}',
  message: '{question}',
  url: 'http://localhost:7930/gates/{id}',
};

describe('the reconciled console rule passes validateWrite', () => {
  it('beside a board rule with deck answering, and alone with deck down', async () => {
    const writes: EventBridgeRule[][] = [];
    await installConsoleBridgeRule({
      read: () => [BOARD_RULE],
      write: next => writes.push(next),
      resolveUrl: async () => 'http://localhost:11001',
    });
    await installConsoleBridgeRule({
      read: () => [],
      write: next => writes.push(next),
      resolveUrl: async () => null,
    });
    // The reconcile may write more than once per install; every write counts.
    expect(writes.length).toBeGreaterThan(0);
    const def = getDef('rt.notify.eventBridges')!;
    for (const value of writes)
      expect(validateWrite(def, value, { scope: 'user' })).toEqual({
        ok: true,
      });
  });
});
```

- [ ] **Step 3: Board writers**

Board's savers already take an injectable `write`, and `apps/board/src/__tests__/config-store-latch.test.ts` drives every one of them (roster, tabs, hidden members, switchboard url) through its `fakeWrite` recorder, 30-odd calls. Make that recorder check each write against the gate rt-client's `setSetting` applies, so every existing latch test also pins its write. In that file:

```ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  getDef,
  validateWrite,
  type getSetting,
  type setSetting,
  type SettingScope,
} from '@mattstack/rt-client';
```

(merge with the existing imports), add after the type aliases:

```ts
// validateWrite's merged-result check reads the stores under HOME; an empty
// temp HOME keeps it from reading the real ones.
const origHome = process.env.HOME;
let home: string;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'board-latch-home-'));
  process.env.HOME = home;
});
afterAll(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});
```

and replace `fakeWrite` with:

```ts
/** Records every setSetting call instead of writing anywhere real, and
    holds each one to the write gate setSetting applies. */
function fakeWrite(
  calls: Array<{ key: string; value: unknown; scope: string }>
): SetSettingFn {
  return ((key: string, value: unknown, scope: string) => {
    const def = getDef(key);
    expect(def).toBeDefined();
    expect(
      validateWrite(def!, value, { scope: scope as SettingScope })
    ).toEqual({ ok: true });
    calls.push({ key, value, scope });
  }) as SetSettingFn;
}
```

Then pin the gate rule board writes at boot by adding to `apps/board/src/__tests__/writers-validate.test.ts` (create):

```ts
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDef, validateWrite } from '@mattstack/rt-client';

import { boardBridgeRule } from '../gates/ingest.ts';

let home: string;
const origHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'board-writers-'));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

test('the gate bridge rule passes validateWrite alone and beside another rule', () => {
  const def = getDef('rt.notify.eventBridges')!;
  const rule = boardBridgeRule('http://localhost:7930');
  expect(validateWrite(def, [rule], { scope: 'user' })).toEqual({ ok: true });
  expect(
    validateWrite(
      def,
      [
        rule,
        {
          pattern: 'gate/opened/*',
          subjectPrefix: 'run:',
          category: 'gate',
          title: '{label}',
          message: '{question}',
          url: 'http://localhost:11001/gates/{id}',
          owner: 'human',
        },
      ],
      { scope: 'user' }
    )
  ).toEqual({ ok: true });
});
```

- [ ] **Step 4: Deck writers**

deck's `save` writes `deck.apps` through rt-client's real `setSetting`, which in 0.32.0 runs `validateWrite` and throws on a refusal; `apps/deck/core/settings.test.ts` already points `HOME` and deck's settings file at temp paths per test. Add `validateWrite` and `getDef` to its `@mattstack/rt-client` import and append:

```ts
test('store key present: every deck.apps write passes validateWrite', async () => {
  setSetting(
    'deck.apps',
    { 'acme-app': { published: true, publicFollowsOverride: false } },
    'user'
  );
  reloadSettings();

  await setPublished('acme-app', false);
  await setPassword('acme-app', 'correct horse');
  setOverride('acme-app', { devPort: 5173, basePort: 4100 });
  setPublicFollowsOverride('acme-app', true);
  clearOverride('acme-app');
  renameAppSettings('acme-app', 'acme-web');
  await clearPassword('acme-web');

  const stored = getSetting('deck.apps').value;
  expect(
    validateWrite(getDef('deck.apps')!, stored, { scope: 'user' })
  ).toEqual({ ok: true });
});
```

Each call above would throw from `setSetting` if its value were refused, so the test fails on the first bad write; the final assertion pins the resulting store value. If `renameAppSettings` or `setPublicFollowsOverride` is async in `settings.ts`, `await` it.

- [ ] **Step 5: Boxscore writes**

boxscore writes `mattstack.roster` (full array through `stage`/`apply`) and `boxscore.hiddenMembers` (a string list through `store.set`) from the client. Create `apps/boxscore/src/app/settings/writers-validate.test.ts`:

```ts
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDef, validateWrite } from '@mattstack/rt-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { asRosterEntries } from './shapes';

let home: string;
const origHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'boxscore-writers-'));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

describe('boxscore writes pass validateWrite', () => {
  it('a roster built the way RosterRow builds it', () => {
    const roster = asRosterEntries([{ username: 'rmarlow' }]);
    const next = [...roster, { username: 'jdoe', name: 'J Doe' }];
    const def = getDef('mattstack.roster')!;
    expect(validateWrite(def, next, { scope: 'team' })).toEqual({ ok: true });
    expect(
      validateWrite(def, next.filter(e => e.username !== 'rmarlow'), {
        scope: 'team',
      })
    ).toEqual({ ok: true });
  });

  it('hidden members', () => {
    const def = getDef('boxscore.hiddenMembers')!;
    expect(validateWrite(def, ['rmarlow'], { scope: 'user' })).toEqual({
      ok: true,
    });
    expect(validateWrite(def, [], { scope: 'user' })).toEqual({ ok: true });
  });
});
```

If `boxscore.hiddenMembers`'s allowed scope is not `user`, use `getDef('boxscore.hiddenMembers')!.scopes[0]`.

- [ ] **Step 6: Run them**

Run each, bare: `bun run console:test`, `bun run board:test`, `bun run deck:test`, `bun run boxscore:test`
Expected: PASS. A refusal is a real finding (the app writes a value its own schema rejects): stop and report the key, value and `reason`; do not loosen the test.

- [ ] **Step 7: Gates and commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `bun run board:typecheck`, `bun run boxscore:typecheck`, `bun run boxscore:lint`, `sh scripts/repo-purity.sh`, `bun run format:check`

```bash
git add apps/console/src/server/event-bridge-validate.test.ts apps/board/src/__tests__/config-store-latch.test.ts apps/board/src/__tests__/writers-validate.test.ts apps/deck/core/settings.test.ts apps/boxscore/src/app/settings/writers-validate.test.ts
git commit -m "apps: pin console, board, deck and boxscore settings writers against validateWrite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Boxscore reads composite shapes from the schema

boxscore never used settings-kit's `SHAPES`; it keeps its own `COMPOSITE_SHAPES` table. It moves to `recognize(def.schema)` with its existing widgets (`StringListControl`, `LeavesControl` for string and number leaves, its own roster editor for `mattstack.roster`), and every row renders as before.

**Needs from spec 1's wire contract:** `SettingDefWire.schema` on every composite def from `/defs` (boxscore mounts `allowComposite: true`, and `defToWire` sends `schema` whenever the def has one); `recognize(schema)`, `matchesSchema(def, value)`.

**Files:**
- Modify: `apps/boxscore/src/app/settings/shapes.ts`
- Create: `apps/boxscore/src/app/settings/shapes.test.ts`
- Modify: `apps/boxscore/src/app/settings/SettingsPage.tsx`, `apps/boxscore/src/app/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: settings-kit `recognize`, `matchesSchema`.
- Produces: `shapeOf(def: Pick<ConfigDef, 'key' | 'schema'>): CompositeShape | undefined` replacing `COMPOSITE_SHAPES`; `rowKind` and `matchesShape` keep their names; `matchesShape(def, value)` now takes the def.

- [ ] **Step 1: Write the failing test**

Create `apps/boxscore/src/app/settings/shapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { ConfigDef } from './shapes';
import { rowKind, shapeOf } from './shapes';

const STRING_LIST = { type: 'array', items: { type: 'string' } };
const SIZE_BAND = {
  type: 'object',
  properties: { tooSmall: { type: 'number' }, tooLarge: { type: 'number' } },
  additionalProperties: {},
};
const ROSTER = {
  type: 'array',
  items: {
    type: 'object',
    properties: { username: { type: 'string' }, name: { type: 'string' } },
    required: ['username'],
    additionalProperties: {},
  },
};

function def(key: string, over: Partial<ConfigDef> = {}): ConfigDef {
  return {
    key,
    type: 'array',
    scopes: ['team'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: '',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: null, file: null },
    storeVersion: 1,
    ...over,
  };
}

describe('shapeOf', () => {
  it('a string array is a string list', () => {
    expect(shapeOf(def('boxscore.projects', { schema: STRING_LIST }))).toEqual({
      kind: 'stringList',
    });
  });

  it('number leaves keep their fields', () => {
    expect(
      shapeOf(def('boxscore.sizeBand', { type: 'object', schema: SIZE_BAND }))
    ).toEqual({
      kind: 'leaves',
      fields: { tooSmall: 'number', tooLarge: 'number' },
    });
  });

  it('the roster keeps its own editor whatever the schema says', () => {
    expect(shapeOf(def('mattstack.roster', { schema: ROSTER }))).toEqual({
      kind: 'roster',
    });
  });

  it('leaves boxscore cannot draw, and unknown shapes, have no editor', () => {
    expect(
      shapeOf(
        def('boxscore.flags', {
          type: 'object',
          schema: {
            type: 'object',
            properties: { on: { type: 'boolean' } },
          },
        })
      )
    ).toBeUndefined();
    expect(shapeOf(def('boxscore.mystery', { schema: undefined }))).toBeUndefined();
    expect(rowKind(def('boxscore.mystery', { schema: undefined }))).toBe(
      'readonly'
    );
  });
});
```

Run: `bun run boxscore:test`
Expected: FAIL, `shapeOf` is not exported.

- [ ] **Step 2: Implement**

In `apps/boxscore/src/app/settings/shapes.ts`: add `import { matchesSchema, recognize } from '@mattstack/settings-kit/shapes';`, update the module comment's second sentence to "Composite rows take their editor from the kind settings-kit recognizes in the def's schema; boxscore draws string lists and string or number leaves, plus its own roster editor.", delete `COMPOSITE_SHAPES`, `matchesLeaf` and the old `matchesShape`, and add:

```ts
/** Keys whose editor boxscore owns regardless of their schema. */
const APP_EDITORS: Record<string, CompositeShape> = {
  'mattstack.roster': { kind: 'roster' },
};

export function shapeOf(
  def: Pick<ConfigDef, 'key' | 'schema'>
): CompositeShape | undefined {
  const own = APP_EDITORS[def.key];
  if (own) return own;
  const r = recognize(def.schema);
  if (r.kind === 'stringList') return { kind: 'stringList' };
  if (r.kind !== 'leaves' || Object.keys(r.fields).length === 0)
    return undefined;
  const fields: Record<string, LeafType> = {};
  for (const [path, type] of Object.entries(r.fields)) {
    if (type !== 'string' && type !== 'number') return undefined;
    fields[path] = type;
  }
  return { kind: 'leaves', fields };
}

/** Whether a stored value still fits the schema the control writes. A
    mismatch (a hand-edited store file) renders read-only rather than a
    control that would mangle the value on save. The roster is checked by
    its own editor. */
export function matchesShape(def: ConfigDef, value: unknown): boolean {
  if (APP_EDITORS[def.key]?.kind === 'roster') return Array.isArray(value);
  return def.schema === undefined || matchesSchema(def, value);
}
```

In `rowKind`, replace `const shape = COMPOSITE_SHAPES[def.key];` with `const shape = shapeOf(def);`.

In `SettingsPage.tsx`, import `shapeOf` instead of `COMPOSITE_SHAPES`, and in `SettingRow` replace:

```ts
  const shape = COMPOSITE_SHAPES[def.key];
  const malformed =
    shape !== undefined && value !== undefined && !matchesShape(shape, value);
```

with:

```ts
  const shape = shapeOf(def);
  const malformed =
    shape !== undefined && value !== undefined && !matchesShape(def, value);
```

- [ ] **Step 3: Give the page test's composite defs their schemas**

In `SettingsPage.test.tsx`, add `const STRING_LIST = { type: 'array', items: { type: 'string' } };` under the imports and `schema: STRING_LIST` to the `boxscore.projects` and `boxscore.ignoredMrs` fixtures (lines near 85 and 95). The roster fixture needs none.

- [ ] **Step 4: Run and gate**

Run each, bare: `bun run boxscore:typecheck`, `bun run boxscore:lint`, `bun run boxscore:test`, `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`
Expected: PASS.

- [ ] **Step 5: UI validation**

boxscore's page must look as it does today. Run `bun run build` in `apps/boxscore` and its server the way `apps/boxscore/package.json`'s `serve` (or `start`) script says, on a spare port if it lets you set one (check its `src/server/index.ts` for a `PORT` read; if the port is fixed and the live boxscore holds it, compare against the live app on its deck port instead and say so). Screenshot the settings page in both schemes with writes stubbed per the recipe (the route pattern is the same `/api/settings/(set|unset)`). `boxscore.projects` shows its tags input, `boxscore.sizeBand` its two number inputs, the roster its rows.

- [ ] **Step 6: Commit**

```bash
git add apps/boxscore/src/app/settings
git commit -m "boxscore: composite rows take their editor from the schema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Kit CodeMirror gains JSON schema completion and lint

**Needs from spec 1's wire contract:** nothing directly. The kit takes any JSON Schema object for completion and a caller-supplied checker returning `{ path, message }[]` (the shape settings-kit's `checkValue` returns) for lint; it never imports settings-kit.

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/src/lazy/codemirror/jsonSchema.ts`, `packages/ui/src/lazy/codemirror/jsonSchema.test.ts`
- Modify: `packages/ui/src/lazy/codemirror/CodeMirror.Base.tsx`, `packages/ui/src/lazy/codemirror/CodeMirror.tsx`, `packages/ui/src/lazy/index.ts`, `packages/ui/src/lazy/codemirror/CodeMirror.test.tsx`, `packages/ui/src/lazy/codemirror/CodeMirror.stories.tsx`

**Interfaces:**
- Produces (exported from `@mattstack/app-kit/lazy`):
  - `type JsonPathIssue = { path: (string | number)[]; message: string }`
  - `type JsonSchemaCheck = (value: unknown) => JsonPathIssue[]`
  - `CodeMirrorProps.jsonSchema?: Record<string, unknown>` (completion of property names and enum/const/boolean values)
  - `CodeMirrorProps.jsonCheck?: JsonSchemaCheck` (lint: a parse error, or each issue underlined at its path; `language="json"` only)
- Internal to the lazy chunk: `nodeAtPath(state, path)`, `jsonDiagnostics(state, check)`, `jsonSchemaCompletion(schema)`.

- [ ] **Step 1: Add the CodeMirror packages the kit now uses directly**

In `packages/ui/package.json` `dependencies`, add (alphabetically among the existing `@codemirror/*` entries):

```json
"@codemirror/autocomplete": "^6.20.3",
"@codemirror/language": "^6.12.4",
"@codemirror/lint": "^6.9.7",
```

Run: `bun install`
Expected: exit 0; the three resolve to the versions already in `bun.lock` (they were transitive).

- [ ] **Step 2: Write the failing unit tests**

Create `packages/ui/src/lazy/codemirror/jsonSchema.test.ts`:

```ts
import { CompletionContext } from '@codemirror/autocomplete';
import { json } from '@codemirror/lang-json';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import {
  jsonDiagnostics,
  jsonSchemaCompletion,
  nodeAtPath,
} from './jsonSchema';

const SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      category: { type: 'string' },
      owner: { type: 'string', const: 'human' },
      provider: { enum: ['gitlab', 'github'] },
    },
    required: ['pattern'],
  },
};

function state(doc: string) {
  const s = EditorState.create({ doc, extensions: [json()] });
  ensureSyntaxTree(s, doc.length);
  return s;
}

function complete(docWithCursor: string) {
  const pos = docWithCursor.indexOf('|');
  const s = state(docWithCursor.replace('|', ''));
  const r = jsonSchemaCompletion(SCHEMA)(new CompletionContext(s, pos, true));
  return r ? r.options.map(o => o.label) : null;
}

describe('nodeAtPath', () => {
  it('finds a property value inside an array item', () => {
    const s = state('[{"pattern": 1}, {"category": "c"}]');
    const node = nodeAtPath(s, [0, 'pattern'])!;
    expect(s.sliceDoc(node.from, node.to)).toBe('1');
  });

  it('stops at the object when the property is missing', () => {
    const s = state('[{"pattern": 1}, {"category": "c"}]');
    const node = nodeAtPath(s, [1, 'pattern'])!;
    expect(node.name).toBe('Object');
    expect(node.from).toBe(17);
  });
});

describe('jsonDiagnostics', () => {
  it('underlines each issue at its path; a container only at its bracket', () => {
    const s = state('[{"pattern": 1}, {"category": "c"}]');
    const d = jsonDiagnostics(s, () => [
      { path: [0, 'pattern'], message: 'expected string, got number' },
      { path: [1, 'pattern'], message: 'required property "pattern" is missing' },
    ]);
    expect(d.map(x => [x.from, x.to, x.message])).toEqual([
      [13, 14, 'expected string, got number'],
      [17, 18, 'required property "pattern" is missing'],
    ]);
  });

  it('reports a parse error once and never calls the checker', () => {
    const check = vi.fn(() => []);
    const d = jsonDiagnostics(state('[{'), check);
    expect(d).toHaveLength(1);
    expect(d[0]!.severity).toBe('error');
    expect(check).not.toHaveBeenCalled();
  });

  it('an empty document has no diagnostics', () => {
    expect(
      jsonDiagnostics(state('  '), () => [{ path: [], message: 'x' }])
    ).toEqual([]);
  });
});

describe('jsonSchemaCompletion', () => {
  it('offers the property names the object does not set yet', () => {
    expect(complete('[{"pattern": "x", |}]')).toEqual([
      '"category"',
      '"owner"',
      '"provider"',
    ]);
    expect(complete('[{|}]')).toEqual([
      '"pattern"',
      '"category"',
      '"owner"',
      '"provider"',
    ]);
  });

  it('inside a half-typed name, offers every name but that property itself', () => {
    expect(complete('[{"pattern": "x", "ca|"}]')).toEqual([
      '"category"',
      '"owner"',
      '"provider"',
    ]);
  });

  it('offers enum and const values at a property value', () => {
    expect(complete('[{"provider": |}]')).toEqual(['"gitlab"', '"github"']);
    expect(complete('[{"owner": "|"}]')).toEqual(['"human"']);
  });

  it('replaces the whole quoted token, closing quote included', () => {
    const doc = '[{"provider": "|"}]';
    const pos = doc.indexOf('|');
    const s = state(doc.replace('|', ''));
    const r = jsonSchemaCompletion(SCHEMA)(new CompletionContext(s, pos, true))!;
    expect([r.from, r.to]).toEqual([14, 16]);
  });

  it('has nothing to offer where the schema says nothing', () => {
    expect(complete('[{"pattern": |}]')).toBeNull();
  });
});
```

(`describe`, `it`, `expect`, `vi` are vitest globals in `packages/ui`; if its vitest config does not enable globals, import them from `vitest`, matching `CodeMirror.test.tsx`.)

Run: `bunx vitest run packages/ui/src/lazy/codemirror/jsonSchema.test.ts`
Expected: FAIL, `./jsonSchema` does not exist.

- [ ] **Step 3: Implement `jsonSchema.ts`**

Create `packages/ui/src/lazy/codemirror/jsonSchema.ts`:

```ts
import type {
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';

export type JsonPath = (string | number)[];
export interface JsonPathIssue {
  path: JsonPath;
  message: string;
}
export type JsonSchemaCheck = (value: unknown) => JsonPathIssue[];

type Node = ReturnType<typeof syntaxTree>['topNode'];
type Schema = Record<string, unknown>;

const VALUE_NODES = new Set([
  'Object',
  'Array',
  'String',
  'Number',
  'True',
  'False',
  'Null',
]);

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

function propertyName(state: EditorState, prop: Node): string | null {
  const name = prop.getChild('PropertyName');
  if (!name) return null;
  try {
    return JSON.parse(state.sliceDoc(name.from, name.to)) as string;
  } catch {
    return null;
  }
}

function valueOf(node: Node): Node | null {
  return children(node).find(c => VALUE_NODES.has(c.name)) ?? null;
}

/** The deepest syntax node the path reaches; a path naming a missing
    property stops at the object that should hold it. */
export function nodeAtPath(state: EditorState, path: JsonPath): Node | null {
  const tree = ensureSyntaxTree(state, state.doc.length) ?? syntaxTree(state);
  let node = valueOf(tree.topNode);
  for (const seg of path) {
    if (!node) return null;
    let next: Node | null = null;
    if (node.name === 'Object' && typeof seg === 'string') {
      const prop = children(node).find(
        c => c.name === 'Property' && propertyName(state, c) === seg
      );
      next = prop ? valueOf(prop) : null;
    } else if (node.name === 'Array' && typeof seg === 'number') {
      next = children(node).filter(c => VALUE_NODES.has(c.name))[seg] ?? null;
    }
    if (!next) return node;
    node = next;
  }
  return node;
}

/** Containers underline only their opening bracket, so one bad property
    does not paint the whole block. */
function rangeOf(node: Node): { from: number; to: number } {
  return node.name === 'Object' || node.name === 'Array'
    ? { from: node.from, to: node.from + 1 }
    : { from: node.from, to: node.to };
}

export function jsonDiagnostics(
  state: EditorState,
  check: JsonSchemaCheck
): Diagnostic[] {
  const text = state.doc.toString();
  if (text.trim() === '') return [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return [
      {
        from: 0,
        to: Math.min(1, text.length),
        severity: 'error',
        message: (err as Error).message,
      },
    ];
  }
  return check(value).map(issue => {
    const node = nodeAtPath(state, issue.path);
    const { from, to } = node ? rangeOf(node) : { from: 0, to: 1 };
    return { from, to, severity: 'error', message: issue.message };
  });
}

function schemaFor(root: Schema, path: JsonPath): Schema | undefined {
  let s: Schema | undefined = root;
  for (const seg of path) {
    if (!s) return undefined;
    if (typeof seg === 'number') {
      s = s.items as Schema | undefined;
    } else {
      const props = s.properties as Record<string, Schema> | undefined;
      const add = s.additionalProperties;
      s =
        props?.[seg] ??
        (add && typeof add === 'object' ? (add as Schema) : undefined);
    }
  }
  return s;
}

/** The JSON path of the object or array `node` is. */
function pathOf(state: EditorState, node: Node): JsonPath {
  const path: JsonPath = [];
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (p.name === 'Property') {
      const name = propertyName(state, p);
      if (name !== null && child.name !== 'PropertyName') path.unshift(name);
    } else if (p.name === 'Array') {
      const items = children(p).filter(c => VALUE_NODES.has(c.name));
      const at = items.findIndex(c => c.from === child.from);
      if (at >= 0) path.unshift(at);
    }
  }
  return path;
}

function nameTarget(node: Node): { obj: Node; own: Node | null } | null {
  if (node.name === '{' && node.parent?.name === 'Object')
    return { obj: node.parent, own: null };
  if (node.name === 'Object') return { obj: node, own: null };
  if (node.name === '⚠' && node.parent?.name === 'Object')
    return { obj: node.parent, own: null };
  if (node.name === 'PropertyName' && node.parent?.parent?.name === 'Object')
    return { obj: node.parent.parent, own: node.parent };
  return null;
}

function valueTarget(node: Node): Node | null {
  if (node.name === 'Property') return node;
  return node.parent?.name === 'Property' && node.name !== 'PropertyName'
    ? node.parent
    : null;
}

function enumValues(s: Schema | undefined): unknown[] {
  if (!s) return [];
  if (Array.isArray(s.enum)) return s.enum;
  if ('const' in s) return [s.const];
  if (s.type === 'boolean') return [true, false];
  return [];
}

/** Property names the schema allows at the cursor's object, and enum,
    const or boolean values at a property's value. */
export function jsonSchemaCompletion(schema: Schema) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    const word = ctx.matchBefore(/"?[\w$-]*/);
    // Inside a quoted name or string the whole token is replaced, closing
    // quote included, or picking an option leaves a stray quote behind.
    const quotedToken = node.name === 'PropertyName' || node.name === 'String';
    const from = quotedToken
      ? node.from
      : word && word.text !== ''
        ? word.from
        : ctx.pos;
    const to = quotedToken ? node.to : undefined;

    const name = nameTarget(node);
    if (name) {
      const s = schemaFor(schema, pathOf(ctx.state, name.obj));
      const props = s?.properties as Record<string, Schema> | undefined;
      if (!props) return null;
      const taken = new Set(
        children(name.obj)
          .filter(c => c.name === 'Property' && c !== name.own)
          .map(c => propertyName(ctx.state, c))
      );
      const options = Object.keys(props)
        .filter(k => !taken.has(k))
        .map(k => ({ label: JSON.stringify(k), type: 'property' }));
      return options.length > 0 ? { from, to, options } : null;
    }

    const prop = valueTarget(node);
    const key = prop ? propertyName(ctx.state, prop) : null;
    if (!prop?.parent || key === null) return null;
    const values = enumValues(
      schemaFor(schema, [...pathOf(ctx.state, prop.parent), key])
    );
    if (values.length === 0) return null;
    return {
      from,
      to,
      options: values.map(v => ({ label: JSON.stringify(v), type: 'enum' })),
    };
  };
}
```

Run: `bunx vitest run packages/ui/src/lazy/codemirror/jsonSchema.test.ts`
Expected: PASS (every case above was run against this exact module while writing the plan).

- [ ] **Step 4: Write the failing component test**

Append to `packages/ui/src/lazy/codemirror/CodeMirror.test.tsx`:

```tsx
test('jsonCheck underlines schema issues, and a changed checker re-lints', async () => {
  const { forEachDiagnostic, forceLinting } = await import('@codemirror/lint');
  const ref = createRef<CodeMirrorRef>();
  const check = (value: unknown) =>
    Array.isArray(value) && typeof value[0] === 'number'
      ? [{ path: [0], message: 'expected string, got number' }]
      : [];
  renderWithProviders(
    <CodeMirror
      ref={ref}
      value="[1]"
      language="json"
      jsonSchema={{ type: 'array', items: { type: 'string' } }}
      jsonCheck={check}
    />
  );
  await waitFor(() => expect(ref.current?.view).toBeTruthy());
  const view = ref.current!.view!;
  forceLinting(view);
  await waitFor(() => {
    const found: string[] = [];
    forEachDiagnostic(view.state, d => found.push(d.message));
    expect(found).toEqual(['expected string, got number']);
  });
});

test('without jsonCheck there is no linting at all', async () => {
  const { diagnosticCount } = await import('@codemirror/lint');
  const ref = createRef<CodeMirrorRef>();
  renderWithProviders(<CodeMirror ref={ref} value="[1" language="json" />);
  await waitFor(() => expect(ref.current?.view).toBeTruthy());
  expect(diagnosticCount(ref.current!.view!.state)).toBe(0);
});
```

Run: `bunx vitest run packages/ui/src/lazy/codemirror/CodeMirror.test.tsx`
Expected: FAIL (TypeScript/props: `jsonCheck` unknown; the first test finds no diagnostics).

- [ ] **Step 5: Wire the props into `CodeMirror.Base.tsx`**

Add imports:

```ts
import { autocompletion } from '@codemirror/autocomplete';
import { linter, lintGutter } from '@codemirror/lint';

import {
  jsonDiagnostics,
  jsonSchemaCompletion,
  type JsonSchemaCheck,
} from './jsonSchema';

export type { JsonPathIssue, JsonSchemaCheck } from './jsonSchema';
```

Add to `CodeMirrorBaseProps`:

```ts
  /** A JSON Schema for `language="json"`: completes property names and
      enum, const and boolean values. Reconfigures live. */
  jsonSchema?: Record<string, unknown>;
  /** Lints `language="json"`: a parse error, else each returned issue
      underlined at its path. The caller supplies the checker so the kit
      needs no validator and the messages match the caller's own. */
  jsonCheck?: JsonSchemaCheck;
```

Add a compartment beside the others (same pattern as `languageCompartment`) and a builder:

```ts
function schemaExtensions(
  language: CodeMirrorLanguage | undefined,
  schema: Record<string, unknown> | undefined,
  check: JsonSchemaCheck | undefined
): Extension[] {
  if (language !== 'json') return [];
  const out: Extension[] = [];
  if (schema)
    out.push(autocompletion({ override: [jsonSchemaCompletion(schema)] }));
  if (check)
    out.push(
      linter(view => jsonDiagnostics(view.state, check), { delay: 250 }),
      lintGutter()
    );
  return out;
}
```

In the mount effect's `allExtensions`, insert `schemaCompartment.of(schemaExtensions(language, jsonSchema, jsonCheck)),` right after the `languageCompartment.of(...)` line. Add an effect:

```ts
  // Reconfigure schema completion and lint when the schema, checker or
  // language changes.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: schemaCompartment.reconfigure(
        schemaExtensions(language, jsonSchema, jsonCheck)
      ),
    });
  }, [language, jsonSchema, jsonCheck, schemaCompartment]);
```

Destructure `jsonSchema` and `jsonCheck` from props alongside the others. In `CodeMirror.tsx`, re-export the types: `export type { JsonPathIssue, JsonSchemaCheck } from './CodeMirror.Base';` (type-only, so nothing CodeMirror-shaped leaves the lazy chunk). In `packages/ui/src/lazy/index.ts`, add `JsonPathIssue` and `JsonSchemaCheck` to the type exports from `./codemirror/CodeMirror`.

- [ ] **Step 6: Story**

Add to `CodeMirror.stories.tsx` a `JsonWithSchema` story rendering `<CodeMirror language="json" height="200px" value={'[\n  {\n    "pattern": 1\n  }\n]'} jsonSchema={EVENT_BRIDGE_SCHEMA} jsonCheck={check} />` where `EVENT_BRIDGE_SCHEMA` is the `rt.notify.eventBridges` items schema from Task 1's fixture (inline it; the kit must not import console code) and `check` is a tiny local checker returning `[{ path: [0, 'pattern'], message: 'expected string, got number' }]` when `value[0].pattern` is not a string. Follow the file's existing `Meta`/`StoryObj` pattern.

- [ ] **Step 7: Run and gate**

Run each, bare: `bunx vitest run packages/ui/src/lazy`, `cd packages/ui && bun run typecheck && cd ../..`, `bun run lint`, `bun run treeshake`, `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`
Expected: PASS. `treeshake` proves the new imports stayed behind the lazy boundary (only `CodeMirror.Base.tsx` and `jsonSchema.ts` import them).

- [ ] **Step 8: UI validation**

Run Storybook (`bun run storybook`), open `http://localhost:6006/?path=/story/` for `JsonWithSchema` with Fast Browser in both schemes: the `1` carries a red underline with the message on hover, typing `"` inside the object pops completions, and the lint gutter marker is visible and legible in dark. Stop Storybook afterwards. No settings writes are possible from Storybook, so the write stub is not needed; skip the bridge check.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/package.json bun.lock packages/ui/src/lazy
git commit -m "kit: CodeMirror completes and lints JSON against a schema

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: Console settings data layer: repo-aware store and explain hooks, layer rungs, writes that carry `repo`

No visible change yet: the page still resolves with no repo (the picker lands in Task 6), but every read and write now goes through console's own hooks, a picked repo reaches every row through context, and a write's target (layer and repo) is computed in one place.

**Needs from spec 1's wire contract:** `GET {base}/defs[?prefix=][&repo=]` answering `{ defs, unregistered: { key, scope, file }[] }`; `GET {base}/explain/:key[?repo=]` answering `{ def, rows }` with repo rungs `team.repo` / `user.repo` / `machine.repo` among the rows when `repo` is given; `GET {base}/repos` answering `{ repos: { identity, label }[] }`; `POST {base}/set` `{ key, scope, value, repo? }` and `POST {base}/unset` `{ key, scope, repo? }` answering `{ rows, effective }` or `{ error, issues? }` 400; `SettingDefWire.repoScoped`. From spec 3 (pinned above): `POST {base}/prune` `{ key, scope, repo?, storeName, force? }`.

**Files:**
- Create: `apps/console/src/app/settings/useConsoleSettings.ts`, `apps/console/src/app/settings/useConsoleSettings.test.tsx`
- Modify: `apps/console/src/app/settings/view.ts`, `view.test.ts`
- Modify: `apps/console/src/app/settings/useRowSave.ts`, `ScopeBadge.tsx`, `RowMenu.tsx`, `CompositeControls.tsx`, `ExplainModal.tsx`, `SettingsPage.tsx`, `SettingRow.test.tsx`

**Interfaces:**
- Consumes: settings-kit `useSettingsScope` (for `move` only), `targetScope`.
- Produces:
  - `view.ts`: `type RungScope = 'team.repo' | 'user.repo' | 'machine.repo'`; `type LayerScope = StoreScope | RungScope`; `isRung(scope): scope is RungScope`; `rungBase(scope): StoreScope | null`; `rungOf(scope: StoreScope, repo: string | null): LayerScope`; `interface WriteTarget { scope: StoreScope; repo?: string }`; `writeTarget(def, repo: string | null): WriteTarget`; `targetAt(at: string, repo: string | null): WriteTarget | null`; `badgeScope` returns `LayerScope | null`; `fieldSource` returns `LayerScope | 'default' | null`.
  - `useConsoleSettings.ts`: `interface Unregistered { key: string; scope: string; file: string }`; `interface RepoOption { identity: string; label: string }`; `interface ConsoleStore { defs; unregistered; loading; error; refresh(); set(key, scope, value, repo?); unset(key, scope, repo?); move(key, from, to); prune(key, scope, storeName, repo?) }` (every write resolves `string | null`); `useConsoleSettings(repo: string | null, prefix?: string): ConsoleStore`; `interface KeyExplain { def; rows; loading; error; refresh() }`; `useKeyExplain(key: string, repo: string | null): KeyExplain`; `useRepos(): { repos: RepoOption[]; error: string | null }`; `SettingsRepoContext` (`string | null`, default `null`); `useSettingsRepo(): string | null`.
  - `useRowSave.ts`: `interface RowStore { set(key, scope, value, repo?); unset(key, scope, repo?); move(key, from, to) }`; the returned object gains `target: WriteTarget`; `setAt(at, value)` and `clear(at)` accept a rung (`team.repo`) and write the picked repo's section.
  - `ScopeBadge({ scope }: { scope: LayerScope })`: a rung renders `team · repo` in its base scope's colour.

- [ ] **Step 1: Write the failing view tests**

Append to `view.test.ts` (import the new names from `./view`):

```ts
describe('layer rungs and write targets', () => {
  const REPO = 'gitlab.example.com/acme/app';
  const roles = (scope: string | null) =>
    def('rt.roles', {
      type: 'object',
      scopes: ['user', 'team', 'machine'],
      repoScoped: true,
      effective: { scope, file: '/t' },
    });

  it('rungBase maps a repo rung to its store and passes store scopes through', () => {
    expect(rungBase('team.repo')).toBe('team');
    expect(rungBase('machine')).toBe('machine');
    expect(rungBase('default')).toBeNull();
    expect(isRung('user.repo')).toBe(true);
    expect(isRung('user')).toBe(false);
    expect(rungOf('team', REPO)).toBe('team.repo');
    expect(rungOf('team', null)).toBe('team');
  });

  it('with a repo picked, a repo-scoped key writes the repo section of its winning layer', () => {
    expect(writeTarget(roles('team.repo'), REPO)).toEqual({
      scope: 'team',
      repo: REPO,
    });
    // A value inherited from the global team layer gets a repo override
    // there, never a write to the global layer.
    expect(writeTarget(roles('team'), REPO)).toEqual({
      scope: 'team',
      repo: REPO,
    });
    expect(writeTarget(roles(null), REPO)).toEqual({
      scope: 'user',
      repo: REPO,
    });
  });

  it('without a repo, or for a key that is not repo-scoped, the target has no repo', () => {
    expect(writeTarget(roles('team'), null)).toEqual({ scope: 'team' });
    expect(
      writeTarget(
        def('rt.logLevel', {
          scopes: ['machine'],
          effective: { scope: 'machine', file: '/m', value: 'info' },
        }),
        REPO
      )
    ).toEqual({ scope: 'machine' });
  });

  it('targetAt writes a rung only when a repo is picked', () => {
    expect(targetAt('team.repo', REPO)).toEqual({ scope: 'team', repo: REPO });
    expect(targetAt('team.repo', null)).toBeNull();
    expect(targetAt('user', REPO)).toEqual({ scope: 'user' });
    expect(targetAt('default', REPO)).toBeNull();
  });

  it('badgeScope always shows a repo rung, even under a matching subhead', () => {
    expect(badgeScope(roles('team.repo'), 'team')).toBe('team.repo');
  });

  it('the scope filter matches a repo rung by its store', () => {
    const f = { ...NO_FILTER, scope: 'team' as const };
    expect(applyFilter([roles('team.repo')], f)).toHaveLength(1);
  });
});
```

(`def` is the file's existing factory; if its signature differs, adapt the calls, not the assertions.)

Run: `cd apps/console && bunx vitest run src/app/settings/view.test.ts && cd ../..`
Expected: FAIL, the new names are not exported.

- [ ] **Step 2: Implement the rung helpers in `view.ts`**

Add `targetScope` to the `@mattstack/settings-kit/shapes` import and, after `isStoreScope`:

```ts
export type RungScope = 'team.repo' | 'user.repo' | 'machine.repo';
/** A store layer, or a store's section for the picked repo. */
export type LayerScope = StoreScope | RungScope;

export function isRung(s: string | null | undefined): s is RungScope {
  return s === 'team.repo' || s === 'user.repo' || s === 'machine.repo';
}

/** The store a layer lives in: `team.repo` is the team store's repo
    section. */
export function rungBase(s: string | null | undefined): StoreScope | null {
  if (isStoreScope(s)) return s;
  return isRung(s) ? (s.slice(0, -'.repo'.length) as StoreScope) : null;
}

export function rungOf(scope: StoreScope, repo: string | null): LayerScope {
  return repo ? (`${scope}.repo` as RungScope) : scope;
}

export interface WriteTarget {
  scope: StoreScope;
  repo?: string;
}

/** Where an edit of `def` lands. With a repo picked, a repo-scoped key
    writes that repo's section of the layer its value comes from, so a value
    inherited from a global layer gets a repo override rather than a global
    write; with no allowed winning layer, the key's first scope. */
export function writeTarget(
  def: SettingDefWire,
  repo: string | null
): WriteTarget {
  if (def.repoScoped && repo) {
    const base = rungBase(def.effective.scope);
    const scope =
      base && (def.scopes as readonly string[]).includes(base)
        ? base
        : (def.scopes[0] as StoreScope);
    return { scope, repo };
  }
  return { scope: targetScope(def) as StoreScope };
}

/** A layer line's scope as a write target; a repo rung needs the picked
    repo. */
export function targetAt(at: string, repo: string | null): WriteTarget | null {
  const scope = rungBase(at);
  if (!scope) return null;
  if (!isRung(at)) return { scope };
  return repo ? { scope, repo } : null;
}
```

Change `applyFilter`'s scope clause to `(f.scope === 'any' || rungBase(d.effective.scope) === f.scope)`. Change `badgeScope`:

```ts
export function badgeScope(
  def: SettingDefWire,
  subhead: StoreScope | null
): LayerScope | null {
  const scope = def.effective.scope;
  if (isRung(scope)) return scope;
  return isStoreScope(scope) && scope !== subhead ? scope : null;
}
```

and `fieldSource`'s return type to `LayerScope | 'default' | null`, with its condition `if (r.scope === 'default' || isStoreScope(r.scope) || isRung(r.scope)) return r.scope;`.

Run: `cd apps/console && bunx vitest run src/app/settings/view.test.ts && cd ../..`
Expected: PASS.

- [ ] **Step 3: Write the failing hook tests**

Create `apps/console/src/app/settings/useConsoleSettings.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConsoleSettings, useKeyExplain } from './useConsoleSettings';

const REPO = 'gitlab.example.com/acme/app';
type Call = { url: string; body?: Record<string, unknown> };
let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes('/defs'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          defs: [],
          unregistered: [
            {
              key: 'board.rtRepos',
              scope: 'machine',
              file: '/home/user/local/settings.local.jsonc',
            },
          ],
        }),
      };
    if (url.includes('/explain/'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ def: null, rows: [] }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ rows: [], effective: { scope: 'team.repo', file: '/t' } }),
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useConsoleSettings', () => {
  it('reads defs for the picked repo and keeps the unregistered list', async () => {
    const { result } = renderHook(() => useConsoleSettings(REPO));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const defsCall = calls.find(
      c => c.url.includes('/defs') && !c.url.includes('console.move-only')
    )!;
    expect(new URL(defsCall.url, 'http://x').searchParams.get('repo')).toBe(
      REPO
    );
    expect(result.current.unregistered).toEqual([
      {
        key: 'board.rtRepos',
        scope: 'machine',
        file: '/home/user/local/settings.local.jsonc',
      },
    ]);
  });

  it('sends repo in a write body only when one is given', async () => {
    const { result } = renderHook(() => useConsoleSettings(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.set('rt.roles', 'team', { dev: {} }, REPO);
      await result.current.set('rt.logLevel', 'machine', 'info');
      await result.current.unset('rt.roles', 'team', REPO);
      await result.current.prune('rt.roles', 'team', 'rt.roles', REPO);
    });
    const writes = calls.filter(c => c.body);
    expect(writes.map(c => [c.url, c.body])).toEqual([
      [
        '/api/settings/set',
        { key: 'rt.roles', scope: 'team', value: { dev: {} }, repo: REPO },
      ],
      [
        '/api/settings/set',
        { key: 'rt.logLevel', scope: 'machine', value: 'info' },
      ],
      ['/api/settings/unset', { key: 'rt.roles', scope: 'team', repo: REPO }],
      [
        '/api/settings/prune',
        {
          key: 'rt.roles',
          scope: 'team',
          storeName: 'rt.roles',
          force: true,
          repo: REPO,
        },
      ],
    ]);
  });

  it('re-reads defs after a write without raising loading', async () => {
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const store = useConsoleSettings(null);
      seen.push(store.loading);
      return store;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ours = () =>
      calls.filter(
        c =>
          c.url.startsWith('/api/settings/defs') &&
          !c.url.includes('console.move-only')
      ).length;
    const before = ours();
    const settled = seen.length;
    await act(async () => {
      await result.current.set('rt.logLevel', 'machine', 'info');
    });
    await waitFor(() => expect(ours()).toBe(before + 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen.slice(settled)).not.toContain(true);
  });
});

describe('useKeyExplain', () => {
  it('asks for the picked repo', async () => {
    const { result } = renderHook(() => useKeyExplain('rt.roles', REPO));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls.at(-1)!.url).toBe(
      `/api/settings/explain/rt.roles?repo=${encodeURIComponent(REPO)}`
    );
  });
});
```

Run: `cd apps/console && bunx vitest run src/app/settings/useConsoleSettings.test.tsx && cd ../..`
Expected: FAIL, the module does not exist.

- [ ] **Step 4: Implement `useConsoleSettings.ts`**

```ts
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useSettingsScope,
  type EffectiveWire,
  type ExplainRowWire,
  type SettingDefWire,
} from '@mattstack/settings-kit/react';

const BASE = '/api/settings';
// Matches no registered key: that scope instance exists only to lend
// settings-kit's move, which is not exported on its own.
const MOVE_ONLY_PREFIX = 'console.move-only.';

export interface Unregistered {
  key: string;
  scope: string;
  file: string;
}

export interface RepoOption {
  identity: string;
  label: string;
}

type Write = Promise<string | null>;

export interface ConsoleStore {
  defs: SettingDefWire[];
  unregistered: Unregistered[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  set: (key: string, scope: string, value: unknown, repo?: string) => Write;
  unset: (key: string, scope: string, repo?: string) => Write;
  move: (key: string, from: string, to: string) => Write;
  prune: (key: string, scope: string, storeName: string, repo?: string) => Write;
}

export interface KeyExplain {
  def: SettingDefWire | null;
  rows: ExplainRowWire[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/** The repo picked on /settings, or null for all repos. */
export const SettingsRepoContext = createContext<string | null>(null);

export function useSettingsRepo(): string | null {
  return useContext(SettingsRepoContext);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok)
    throw new Error(body?.error ?? `settings request failed: ${res.status}`);
  if (body === null) throw new Error('settings response was not JSON');
  return body;
}

function query(params: Record<string, string | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Every registered def under `prefix`, resolved for `repo` when one is
    picked. A write patches its def at once and then re-reads the list
    without raising `loading`, since it can change the def's issues and the
    repos that set it. */
export function useConsoleSettings(
  repo: string | null,
  prefix = ''
): ConsoleStore {
  const [defs, setDefs] = useState<SettingDefWire[]>([]);
  const [unregistered, setUnregistered] = useState<Unregistered[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const quiet = useRef(false);
  const kit = useSettingsScope(MOVE_ONLY_PREFIX);

  useEffect(() => {
    let alive = true;
    if (!quiet.current) setLoading(true);
    quiet.current = false;
    getJson<{ defs: SettingDefWire[]; unregistered?: Unregistered[] }>(
      `${BASE}/defs${query({ prefix, repo })}`
    )
      .then(body => {
        if (!alive) return;
        setDefs(body.defs);
        setUnregistered(body.unregistered ?? []);
        setError(null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [prefix, repo, generation]);

  const refresh = useCallback(() => setGeneration(g => g + 1), []);
  const reread = useCallback(() => {
    quiet.current = true;
    setGeneration(g => g + 1);
  }, []);

  const post = useCallback(
    async (
      path: 'set' | 'unset' | 'prune',
      key: string,
      body: Record<string, unknown>
    ): Write => {
      try {
        const res = await fetch(`${BASE}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, ...body }),
        });
        const out = (await res.json().catch(() => null)) as {
          effective?: EffectiveWire;
          error?: string;
        } | null;
        if (!res.ok || !out?.effective)
          return out?.error ?? `${path} failed: ${res.status}`;
        const effective = out.effective;
        setDefs(prev =>
          prev.map(d => (d.key === key ? { ...d, effective } : d))
        );
        reread();
        return null;
      } catch (err) {
        return (err as Error).message;
      }
    },
    [reread]
  );

  const withRepo = (r?: string) => (r ? { repo: r } : {});
  const set = useCallback(
    (key: string, scope: string, value: unknown, r?: string) =>
      post('set', key, { scope, value, ...withRepo(r) }),
    [post]
  );
  const unset = useCallback(
    (key: string, scope: string, r?: string) =>
      post('unset', key, { scope, ...withRepo(r) }),
    [post]
  );
  const prune = useCallback(
    (key: string, scope: string, storeName: string, r?: string) =>
      post('prune', key, { scope, storeName, force: true, ...withRepo(r) }),
    [post]
  );
  const { move: kitMove } = kit;
  const move = useCallback(
    async (key: string, from: string, to: string) => {
      const err = await kitMove(key, from, to);
      reread();
      return err;
    },
    [kitMove, reread]
  );

  return useMemo(
    () => ({
      defs,
      unregistered,
      loading,
      error,
      refresh,
      set,
      unset,
      move,
      prune,
    }),
    [defs, unregistered, loading, error, refresh, set, unset, move, prune]
  );
}

/** One key's layer stack, with the picked repo's rungs when one is given. */
export function useKeyExplain(key: string, repo: string | null): KeyExplain {
  const [def, setDef] = useState<SettingDefWire | null>(null);
  const [rows, setRows] = useState<ExplainRowWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getJson<{ def: SettingDefWire; rows: ExplainRowWire[] }>(
      `${BASE}/explain/${encodeURIComponent(key)}${query({ repo })}`
    )
      .then(body => {
        if (!alive) return;
        setDef(body.def);
        setRows(body.rows);
        setError(null);
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key, repo, generation]);

  const refresh = useCallback(() => setGeneration(g => g + 1), []);
  return useMemo(
    () => ({ def, rows, loading, error, refresh }),
    [def, rows, loading, error, refresh]
  );
}

export function useRepos(): { repos: RepoOption[]; error: string | null } {
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getJson<{ repos: RepoOption[] }>(`${BASE}/repos`)
      .then(body => alive && setRepos(body.repos))
      .catch((err: Error) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);
  return { repos, error };
}
```

Run: `cd apps/console && bunx vitest run src/app/settings/useConsoleSettings.test.tsx && cd ../..`
Expected: PASS.

- [ ] **Step 5: Write the failing row-save and row-menu tests**

Append to `SettingRow.test.tsx` (import `SettingsRepoContext` from `./useConsoleSettings`):

```tsx
describe('with a repo picked', () => {
  const REPO = 'gitlab.example.com/acme/app';
  const inRepo = (ui: React.ReactElement) =>
    renderWithProviders(
      <SettingsRepoContext.Provider value={REPO}>{ui}</SettingsRepoContext.Provider>
    );

  it('an edit of a repo-scoped key inherited from a global layer writes a repo override', async () => {
    const s = store();
    inRepo(
      <SettingRow
        def={def('rt.worktreeCwd', {
          scopes: ['user', 'team', 'machine'],
          repoScoped: true,
          effective: { scope: 'team', file: '/t', value: 'a' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('rt.worktreeCwd');
    await userEvent.clear(input);
    await userEvent.type(input, 'b');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.worktreeCwd', 'team', 'b', REPO)
    );
  });

  it('a key that is not repo-scoped writes as before, with no repo argument', async () => {
    const s = store();
    inRepo(
      <SettingRow
        def={def('agent.claude.effort', {
          effective: { scope: 'user', file: '/u', value: 'high' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    await userEvent.type(input, 'low');
    await userEvent.tab();
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('agent.claude.effort', 'user', 'low')
    );
  });

  it('a value from a repo rung can be removed but not moved', async () => {
    const s = store();
    inRepo(
      <SettingRow
        def={def('rt.worktreeCwd', {
          scopes: ['user', 'team', 'machine'],
          repoScoped: true,
          effective: { scope: 'team.repo', file: '/t', value: 'a' },
        })}
        store={s}
        subhead={null}
        query=""
      />
    );
    expect(screen.getByText('team · repo')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'rt.worktreeCwd actions' })
    );
    expect(screen.queryByRole('menuitem', { name: /^Move to/ })).toBeNull();
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Remove from team · repo' })
    );
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.worktreeCwd', 'team', REPO)
    );
  });
});
```

`rt.worktreeCwd` is a stand-in string key for the fixture; any registered or unregistered string key works because the def is built in the test.

Run: `bun run console:test`
Expected: FAIL on the three new tests.

- [ ] **Step 6: Route every write through the target**

Replace `useRowSave.ts` with:

```ts
import { useEffect, useRef, useState } from 'react';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { useSettingsRepo, type ConsoleStore } from './useConsoleSettings';
import { targetAt, writeTarget, type WriteTarget } from './view';

export type RowStore = Pick<ConsoleStore, 'set' | 'unset' | 'move'>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

const SAVED_FLASH_MS = 1400;

/** Save-on-commit, no staging: `undefined` means "clear this layer". A
    write with no repo passes no repo argument at all. */
export function useRowSave(store: RowStore, def: SettingDefWire) {
  const repo = useSettingsRepo();
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = async (op: () => Promise<string | null>) => {
    setStatus('saving');
    setError(null);
    const err = await op();
    if (err) {
      setStatus('idle');
      setError(err);
      return false;
    }
    setStatus('saved');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), SAVED_FLASH_MS);
    return true;
  };

  const setTo = (t: WriteTarget, value: unknown) =>
    t.repo === undefined
      ? store.set(def.key, t.scope, value)
      : store.set(def.key, t.scope, value, t.repo);
  const unsetAt = (t: WriteTarget) =>
    t.repo === undefined
      ? store.unset(def.key, t.scope)
      : store.unset(def.key, t.scope, t.repo);
  const at = (layer: string) => {
    const t = targetAt(layer, repo);
    return t ?? `${layer} is not a writable layer here`;
  };

  const target = writeTarget(def, repo);
  return {
    status,
    error,
    target,
    save: (value: unknown) =>
      run(() => (value === undefined ? unsetAt(target) : setTo(target, value))),
    setAt: (layer: string, value: unknown) =>
      run(async () => {
        const t = at(layer);
        return typeof t === 'string' ? t : setTo(t, value);
      }),
    clear: (layer: string) =>
      run(async () => {
        const t = at(layer);
        return typeof t === 'string' ? t : unsetAt(t);
      }),
    move: (from: string, to: string) =>
      run(() => store.move(def.key, from, to)),
  };
}
```

`ScopeBadge.tsx`: change both components' prop to `LayerScope` (import `rungBase`, `isRung`, `type LayerScope` from `./view`); colour from `SCOPE_COLOR[rungBase(scope)!]`; the badge text is `isRung(scope) ? `${rungBase(scope)} · repo` : scope`. `ScopeDot` keeps `StoreScope`.

`RowMenu.tsx`: import `isRung`, `rungBase`, `type LayerScope`; replace the guard and `moveTo` with:

```ts
  const from = def.effective.scope;
  const base = rungBase(from);
  if (!def.writable || !base || !def.scopes.includes(base))
    return <Box w={SLOT} />;
  // A move re-sets the value at its target, which rejects what rt already
  // refused here; removing it still works. settings-kit's move reads and
  // writes global layers only, so a repo rung offers removal alone.
  const moveTo =
    def.effective.invalid === undefined && !isRung(from)
      ? (def.scopes as StoreScope[]).filter(s => s !== from && isStoreScope(s))
      : [];
  const label = isRung(from) ? `${base} · repo` : from;
```

the Remove item's text becomes `{`Remove from ${label}`}` and its `onClick` stays `row.clear(from!)`. `from` is no longer narrowed by the guard, so the Move items call `row.move(from!, to)`.

`CompositeControls.tsx`: replace `useSettingKey(def.key)` (in `LeavesBody` and `DeepShapeLock`) with `useKeyExplain(def.key, repo)` where `const repo = useSettingsRepo();`, drop `useSettingKey` and `targetScope` from the imports, and in `LeavesBody` replace `const target = targetScope(def);` with:

```ts
  const target = rungOf(row.target.scope, row.target.repo ?? null);
```

(`rungOf` from `./view`); `leafWrite(explained.rows, target, path, v)`, `row.clear(target)` and the `source !== target` check keep their shape. The field's source badge checks `rungBase(source) !== null` instead of `isStoreScope(source)` (passing `source as LayerScope` to `ScopeBadge`), so a field set by a repo rung shows `team · repo`, not the raw `team.repo`. `DeepShapeLock` also accepts a rung as `at` when checking rows: replace `isStoreScope(r.scope)` there with `rungBase(r.scope) !== null`, and `ShapeLock`'s `isStoreScope(at)` checks with `rungBase(at) !== null`.

`ExplainModal.tsx`: `ExplainStore` becomes `Pick<ConsoleStore, 'defs' | 'loading' | 'error' | 'set' | 'unset' | 'move'>`; `ExplainBody` uses `useKeyExplain(storeDef.key, useSettingsRepo())`; the `tracked` store forwards every argument (`set: async (...a) => after(await store.set(...a))` already does, as long as its type is `RowStore`); `OwnStore` uses `useConsoleSettings(null, props.settingKey)`. `LayerLine`'s `store` becomes `rungBase(scope)` for the allowed/writable checks, its `onSet`/`onRemove` receive the row's own `scope` string (a rung included) and the modal passes them to `layers.setAt(scope, v)` / `layers.clear(scope)`; the `ScopeBadge` there receives `scope as LayerScope` when `rungBase(scope)` is non-null. Remove the `useSettingKey` and `useSettingsScope` imports.

`SettingsPage.tsx`: `const repo = params.get('repo');` next to `query`, `const store = useConsoleSettings(repo);` instead of `useSettingsScope('')`, and wrap the returned `<PageShell>` in `<SettingsRepoContext.Provider value={repo}>`.

Run: `bun run console:test`
Expected: PASS, including every pre-existing test (writes with no repo still pass exactly three arguments).

- [ ] **Step 7: Gates and commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

No UI validation for this task beyond a smoke check: follow the recipe once in light only and confirm `/settings` renders its sections and the explain modal opens for `rt.homeSnapshot` (nothing should look different from the live page). Record that in the report.

```bash
git add apps/console/src/app/settings
git commit -m "console: repo-aware settings hooks, layer rungs, writes carry repo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: Repo picker, repo reach on rows, repos in the explain modal

**Needs from spec 1's wire contract:** `GET {base}/repos` (`{ repos: { identity, label }[] }`); `/defs?repo=` resolving repo-scoped keys for that repo with `effective.scope` a rung (`team.repo`) when a repo section wins; `SettingDefWire.repos?: { identity: string; scopes: string[] }[]` on repo-scoped defs (present with or without `?repo=`); `/explain/:key?repo=` rows including the rungs.

**Files:**
- Create: `apps/console/src/app/settings/RepoPicker.tsx`, `apps/console/src/app/settings/RepoReach.tsx`
- Modify: `apps/console/src/app/settings/view.ts` (`repoLabel`), `SettingsPage.tsx`, `SettingRow.tsx`, `ExplainModal.tsx`, `useConsoleSettings.ts` (`useRepos` tolerates a body without `repos`)
- Test: `SettingsPage.test.tsx`, `SettingRow.test.tsx`, `ExplainModal.test.tsx`

**Interfaces:**
- Consumes: `useRepos`, `useSettingsRepo`, `useKeyExplain`, `SettingsRepoContext` (Task 5).
- Produces:
  - `view.ts`: `repoLabel(identity: string): string` (the identity after its first `/`, the server's label rule).
  - `RepoPicker({ value, onChange }: { value: string | null; onChange: (repo: string | null) => void })`.
  - `RepoReach({ def }: { def: SettingDefWire })`: renders nothing for a key that is not repo-scoped.
  - `ExplainModal` gains `onPickRepo?: (repo: string) => void`; with it and no repo picked, a repo-scoped key lists every repo that sets it.

- [ ] **Step 1: Write the failing tests**

`SettingsPage.test.tsx`: replace the `beforeEach` fetch stub with a router so `/repos` and repo-resolved defs can differ:

```ts
const REPO = 'gitlab.example.com/acme/app';
let repoDefs: SettingDefWire[] | null = null;

beforeEach(() => {
  defsResponse = serve(DEFS);
  repoDefs = null;
  window.history.replaceState(null, '', '/settings');
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.startsWith('/api/settings/repos'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          repos: [
            { identity: REPO, label: 'acme/app' },
            { identity: 'gitlab.example.com/acme/web', label: 'acme/web' },
          ],
        }),
      };
    if (repoDefs && url.includes(`repo=${encodeURIComponent(REPO)}`))
      return serve(repoDefs)();
    return defsResponse();
  });
});
```

and add:

```ts
describe('repo picker', () => {
  const ROLES = (effective: SettingDefWire['effective']) =>
    def('rt.roles', {
      type: 'object',
      scopes: ['user', 'team', 'machine'],
      merge: 'deep',
      repoScoped: true,
      repos: [{ identity: REPO, scopes: ['team'] }],
      effective,
    });

  it('lists All repos plus each repo, and picking one keeps it in ?repo=', async () => {
    defsResponse = serve([...DEFS, ROLES({ scope: null, file: null })]);
    repoDefs = [
      ...DEFS,
      ROLES({ scope: 'team.repo', file: '/home/team/settings.team.jsonc', value: { dev: { fixedPort: 3000 } } }),
    ];
    renderPage();
    await screen.findByRole('heading', { name: 'Board' });
    expect(screen.getByText('all repos · set in 1 repo')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'repo' }));
    await userEvent.click(await screen.findByRole('option', { name: 'acme/app' }));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).get('repo')).toBe(REPO)
    );
    expect(await screen.findByText('team · repo')).toBeInTheDocument();
    expect(screen.getByText('for acme/app')).toBeInTheDocument();
  });

  it('the Changed count follows the picked repo', async () => {
    defsResponse = serve([...DEFS, ROLES({ scope: null, file: null })]);
    repoDefs = [
      ...DEFS,
      ROLES({ scope: 'team.repo', file: '/home/team/settings.team.jsonc', value: {} }),
    ];
    window.history.replaceState(null, '', `/settings?repo=${encodeURIComponent(REPO)}`);
    renderPage();
    const changed = await screen.findByRole('checkbox', { name: /^Changed/ });
    const count = (n: number) =>
      expect(changed.closest('label') ?? changed.parentElement!).toHaveTextContent(`Changed ${n}`);
    await waitFor(() => count(DEFS.filter(d => d.effective.scope !== null && d.effective.scope !== 'default').length + 1));
  });
});
```

(Mantine 9.5's `Select` input is a `combobox`; `getByLabelText('repo')` matches more than one element. Mantine's `Chip` renders a checkbox input; adjust the `Changed` lookup to how the existing tests in this file find the chip if they already do.)

`SettingRow.test.tsx`, append:

```tsx
it('a repo-scoped row says it edits all repos and how many repos set it', () => {
  renderWithProviders(
    <SettingRow
      def={def('rt.worktreeCwd', {
        scopes: ['user', 'team'],
        repoScoped: true,
        repos: [
          { identity: 'gitlab.example.com/acme/app', scopes: ['team'] },
          { identity: 'gitlab.example.com/acme/web', scopes: ['user'] },
        ],
        effective: { scope: 'user', file: '/u', value: 'a' },
      })}
      store={store()}
      subhead={null}
      query=""
    />
  );
  expect(screen.getByText('all repos · set in 2 repos')).toBeInTheDocument();
});

it('a key that is not repo-scoped says nothing about repos', () => {
  renderWithProviders(
    <SettingRow
      def={def('agent.claude.effort', {
        effective: { scope: 'user', file: '/u', value: 'high' },
      })}
      store={store()}
      subhead={null}
      query=""
    />
  );
  expect(screen.queryByText(/all repos/)).toBeNull();
});
```

`ExplainModal.test.tsx`, append (extend the fetch stub's router to answer `?repo=` explains from `explainGet` as it already does, since the URL still starts with `/api/settings/explain/`):

```tsx
it('with all repos, lists each repo that sets the key and switches to it', async () => {
  const REPO = 'gitlab.example.com/acme/app';
  const ROLES: SettingDefWire = {
    ...DEF,
    key: 'rt.roles',
    type: 'object',
    scopes: ['user', 'team', 'machine'],
    merge: 'deep',
    repoScoped: true,
    repos: [{ identity: REPO, scopes: ['team'] }],
    effective: { scope: null, file: null },
  };
  explainGet.mockImplementation(async (url: string) =>
    ok({
      def: ROLES,
      rows: url.includes('repo=')
        ? [
            { scope: 'default', file: null, present: false },
            {
              scope: 'team.repo',
              file: '/home/team/settings.team.jsonc',
              present: true,
              value: { dev: { fixedPort: 3000 } },
            },
          ]
        : [{ scope: 'default', file: null, present: false }],
    })
  );
  const onPickRepo = vi.fn();
  const queryClient = new QueryClient();
  renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <ExplainModal
        settingKey="rt.roles"
        store={store({ defs: [ROLES] })}
        onClose={vi.fn()}
        onPickRepo={onPickRepo}
      />
    </QueryClientProvider>
  );
  const section = await screen.findByTestId(`repo-${REPO}`);
  expect(within(section).getByText('acme/app')).toBeInTheDocument();
  expect(within(section).getByText('team · repo')).toBeInTheDocument();
  expect(section).toHaveTextContent('"fixedPort": 3000');
  await userEvent.click(within(section).getByRole('button', { name: 'Show acme/app' }));
  expect(onPickRepo).toHaveBeenCalledWith(REPO);
});
```

Run: `bun run console:test`
Expected: FAIL on the new tests.

- [ ] **Step 2: `repoLabel` and a tolerant `useRepos`**

`view.ts`:

```ts
/** A repo identity's display label: everything after the host, the same
    rule settings-kit's /repos uses. */
export function repoLabel(identity: string): string {
  const at = identity.indexOf('/');
  return at < 0 ? identity : identity.slice(at + 1);
}
```

In `useRepos`, `.then(body => alive && setRepos(body.repos ?? []))`.

- [ ] **Step 3: `RepoPicker.tsx`**

```tsx
import { Select } from '@mattstack/app-kit/core';

import { INPUT_TYPE } from './controlStyles';
import { useRepos } from './useConsoleSettings';
import { repoLabel } from './view';

const ALL = '';

/** All repos, or one repo whose sections resolve the repo-scoped rows. A
    picked repo the list does not name yet (still loading, or only in the
    url) stays selectable under its own label. */
export function RepoPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (repo: string | null) => void;
}) {
  const { repos } = useRepos();
  const known = repos.some(r => r.identity === value);
  return (
    <Select
      aria-label="repo"
      size="xs"
      w={180}
      styles={INPUT_TYPE.label}
      allowDeselect={false}
      value={value ?? ALL}
      data={[
        { value: ALL, label: 'All repos' },
        ...repos.map(r => ({ value: r.identity, label: r.label })),
        ...(value && !known ? [{ value, label: repoLabel(value) }] : []),
      ]}
      onChange={v => onChange(v ? v : null)}
    />
  );
}
```

Check `Select`'s `allowDeselect`, `data` item shape and the empty-string value against the Mantine 9.5 `Select` props (Global Constraints); if an empty-string option value is not allowed, use `'all'` as the sentinel and map it.

- [ ] **Step 4: `RepoReach.tsx`**

```tsx
import { Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { useSettingsRepo } from './useConsoleSettings';
import { repoLabel } from './view';

/** What an edit of a repo-scoped row reaches: every repo, or the picked
    one; with all repos, also how many repos set the key in a section. */
export function RepoReach({ def }: { def: SettingDefWire }) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  if (!def.repoScoped) return null;
  let label: string;
  if (repo) label = `for ${repoLabel(repo)}`;
  else {
    const n = def.repos?.length ?? 0;
    label =
      n === 0
        ? 'all repos'
        : `all repos · set in ${n} ${n === 1 ? 'repo' : 'repos'}`;
  }
  return (
    <Text fz={12} c={text.muted} style={{ whiteSpace: 'nowrap' }}>
      {label}
    </Text>
  );
}
```

In `SettingRow.tsx`, render `<RepoReach def={def} />` as the last child of the name line's `<Group gap={8} wrap="nowrap">` (after the badge or source text).

- [ ] **Step 5: Toolbar and page wiring**

In `SettingsPage.tsx`:

```ts
  const setRepo = (next: string | null) =>
    setParams(
      prev => {
        const p = new URLSearchParams(prev);
        if (next) p.set('repo', next);
        else p.delete('repo');
        return p;
      },
      { replace: true }
    );
```

Render `<RepoPicker value={repo} onChange={setRepo} />` right after the scope `SegmentedControl` in the toolbar `Group`. Pass `onPickRepo={setRepo}` to `<ExplainModal>`. `clearAll` leaves the repo alone (it is a view, not a filter).

- [ ] **Step 6: Explain modal: repos that set the key**

In `ExplainModal.tsx` add:

```tsx
function RepoSection({
  settingKey,
  identity,
  onPick,
}: {
  settingKey: string;
  identity: string;
  onPick?: (repo: string) => void;
}) {
  const { text } = useSchemeColors();
  const { rows, loading } = useKeyExplain(settingKey, identity);
  const set = rows.filter(r => r.present && isRung(r.scope));
  return (
    <Box
      py={10}
      data-testid={`repo-${identity}`}
      style={{ borderBottom: '1px solid var(--tk-border-soft)' }}
    >
      <Group gap={12} wrap="nowrap" justify="space-between">
        <Text fz={13} ff="monospace">
          {repoLabel(identity)}
        </Text>
        {onPick && (
          <Button
            size="compact-xs"
            variant="default"
            aria-label={`Show ${repoLabel(identity)}`}
            onClick={() => onPick(identity)}
          >
            Show
          </Button>
        )}
      </Group>
      {loading ? (
        <Skeleton h={28} mt={8} />
      ) : (
        set.map(r => (
          <Stack key={r.scope} gap={4} pt={8}>
            <ScopeBadge scope={r.scope as LayerScope} />
            <JsonBlock value={r.value} />
          </Stack>
        ))
      )}
      {!loading && set.length === 0 && (
        <Text fz={12} c={text.muted} pt={6}>
          no repo section sets it now
        </Text>
      )}
    </Box>
  );
}
```

(`JsonBlock` lands in Task 7; until then use `<Code block>{JSON.stringify(r.value, null, 2)}</Code>` here and let Task 7 swap it. Import `Button` and `Code` from `@mattstack/app-kit/core`, `repoLabel`, `isRung`, `type LayerScope` from `./view`.)

In `ExplainBody`, after the layer lines and the `layers.error` line, when `def.repoScoped && repo === null && (def.repos?.length ?? 0) > 0`, render a header matching the "Layers" header (`Repos` · `sections that override every repo's value for one repo`) and one `RepoSection` per `def.repos` entry. `ExplainBody` and `Resolved` take and pass `onPickRepo`.

- [ ] **Step 7: Run and gate**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`
Expected: PASS.

- [ ] **Step 8: UI validation**

Recipe, both schemes, compared with the current page: the toolbar with the picker (no wrapping, no row-height change, the filter input keeps a usable width at 1280px and at 1024px); the Repos block in `rt.roles`'s explain modal with All repos; then pick the team repo that carries the per-repo values (`rt settings list` or the picker's list shows which), and check `rt.roles`, `rt.intercepts`, `rt.ignoredMrs`, `rt.sync`, `rt.branchNaming`, `rt.variations`, `rt.presets`, `rt.dopplerTemplate`, `rt.worktrees` now show a `team · repo` badge where the audit said the team store sets them for that repo. The Changed count changes with the pick. If the toolbar crowds, move an item out rather than shrinking shared padding (say which, and why).

- [ ] **Step 9: Commit**

```bash
git add apps/console/src/app/settings
git commit -m "console: repo picker, repo reach on rows, repos that set a key in the explain modal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Read JSON values in full

**Needs from spec 1's wire contract:** nothing new; explain rows' `value` per layer (non-secret).

**Files:**
- Create: `apps/console/src/app/settings/JsonBlock.tsx`
- Modify: `apps/console/src/app/settings/CompositeControls.tsx` (`ReadonlyBody`), `ExplainModal.tsx` (`LayerLine`, `RepoSection`)
- Test: `ExplainModal.test.tsx`, `CompositeControls.test.tsx`

**Interfaces:**
- Produces: `JsonBlock({ value, maxHeight? }: { value: unknown; maxHeight?: number })`: two-space pretty JSON, monospace, wrapping, scrolling inside a block capped at `maxHeight` (default 320px).

- [ ] **Step 1: Write the failing tests**

`ExplainModal.test.tsx`, append:

```tsx
it('a composite layer shows its whole value, never cut at 40 characters', async () => {
  const LONG = {
    triggers: [
      { name: 'nightly-sync', event: 'cron/tick', run: ['rt', 'sync', '--all'] },
    ],
  };
  const CRON: SettingDefWire = {
    ...DEF,
    key: 'rt.cron',
    type: 'object',
    scopes: ['machine'],
    merge: 'deep',
    effective: { scope: 'machine', file: '/stores/local.jsonc', value: LONG },
  };
  explainGet.mockResolvedValue(
    ok({
      def: CRON,
      rows: [
        { scope: 'default', file: null, present: false },
        { scope: 'machine', file: '/stores/local.jsonc', present: true, value: LONG },
      ],
    })
  );
  renderModal(store({ defs: [CRON] }), 'rt.cron');
  const layer = await screen.findByTestId('layer-machine');
  expect(layer).toHaveTextContent('"name": "nightly-sync"');
  expect(layer).toHaveTextContent('"--all"');
  expect(layer.textContent).not.toContain('…');
});
```

`CompositeControls.test.tsx`: in the existing `'an unshaped composite is read-only with a preview and its file'` test, add `expect(screen.getByTestId('json-block')).toBeInTheDocument();` after the preview assertion.

Run: `bun run console:test`
Expected: FAIL on both.

- [ ] **Step 2: `JsonBlock.tsx`**

```tsx
import { Code, ScrollArea } from '@mattstack/app-kit/core';

const BLOCK_STYLE = {
  background: 'var(--tk-inset)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

/** A stored JSON value in full: two-space indent, wrapping, scrolling
    inside a capped block so one long value never pushes the page. */
export function JsonBlock({
  value,
  maxHeight = 320,
}: {
  value: unknown;
  maxHeight?: number;
}) {
  return (
    <ScrollArea.Autosize mah={maxHeight} type="auto" data-testid="json-block">
      <Code block style={BLOCK_STYLE}>
        {JSON.stringify(value, null, 2)}
      </Code>
    </ScrollArea.Autosize>
  );
}
```

Confirm `ScrollArea.Autosize`'s `mah` and `type` props in Mantine 9.5 (Global Constraints).

- [ ] **Step 3: Use it**

- `CompositeControls.tsx` `ReadonlyBody`: replace the `<Code block style={PREVIEW_STYLE}>…</Code>` with `<JsonBlock value={value} />`, and delete `PREVIEW_STYLE` and the `Code` import (both now unused; typecheck fails on them otherwise).
- `ExplainModal.tsx` `LayerLine`: in the non-secret present branch, when `def.type === 'object' || def.type === 'array'`, render `<JsonBlock value={row.value} maxHeight={240} />` (keeping `data-testid={`layer-value-${scope}`}` on a wrapping `Box`, and the overridden styling: `c={text.muted}` on the wrapper and `textDecoration: 'line-through'` only for scalar values, since a struck-through block is unreadable; an overridden composite instead gets the muted colour only). Scalars keep `shortValue`. The value column's `Box` needs `style={{ flex: 1, minWidth: 0 }}` (already there) so the block wraps.
- `RepoSection`: swap its temporary `Code` for `JsonBlock`.

Run: `bun run console:test`
Expected: PASS. The existing `layer-value-user` line-through test is a scalar key, so it still passes.

- [ ] **Step 4: Gates, UI validation, commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

UI validation (recipe, both schemes, compared with the current page): `rt.notify.eventBridges`'s explain modal (the user layer shows every rule in full, scrolling inside the block, no truncation mark), a long composite row expanded on the page (`rt.cron` or `rt.hooks`), and a scalar key's modal (unchanged). Check the inset block's contrast in dark.

```bash
git add apps/console/src/app/settings
git commit -m "console: JSON values read in full on rows and explain layers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: Form model and item cards (`objectList`)

Lists of objects (for example `rt.notify.eventBridges`) get item cards over a local draft with Save and Cancel. The draft model (`DraftEditor`) is shared by named sections (Task 9) and the JSON editor (Task 10).

**Needs from spec 1's wire contract:** `SettingDefWire.schema` and, for deep keys, `layerSchema` (every object property optional, array items whole); schema metadata `title`, `description`, `placeholder` carried as JSON Schema keywords (`.meta()` output); `checkValue(schema, value): SchemaIssue[]` with `{ path, message }`; `/set` refusal `{ error, issues }` shown as the row's error.

**Files:**
- Create: `apps/console/src/app/settings/formShape.ts`, `formShape.test.ts`
- Create: `apps/console/src/app/settings/issues.ts`
- Create: `apps/console/src/app/settings/FieldGrid.tsx`, `ItemCards.tsx`, `DraftEditor.tsx`, `ItemCards.test.tsx`
- Modify: `apps/console/src/app/settings/CompositeControls.tsx`, `view.ts`

**Interfaces:**
- Produces:
  - `formShape.ts`: `interface FieldSpec { type: LeafType; title?: string; description?: string; placeholder?: string; default?: unknown; suggestions?: string[] }`; `interface FormShape { kind: 'objectList' | 'objectMap'; fields: Record<string, FieldSpec>; nested: string[]; required: string[]; labels: [string, string] }`; `formShape(schema: JsonSchema | undefined): FormShape | null`; `formOf(def: SettingDefWire): FormShape | null` (reads `def.layerSchema ?? def.schema`); `editorKind(def): RowKind` (`objectList`/`objectMap` when `formOf` draws it, `json` for any other composite the kit calls `objectList`/`objectMap`/`json`, else `rowKind(def)`); `canDraw(shape, value): boolean`; `newEntry(shape): Record<string, unknown>`; `visibleFields(shape, entry, shown: readonly string[]): string[]`; `addableFields(shape, entry, shown): string[]`; `extraKeys(shape, entry): string[]`.
  - `issues.ts`: `issuePath(path): string` (`[0].pattern`, `emoji.looking`, `(root)`), `issueText(issue): string` (`[0].pattern: expected string, got number`), `issuesUnder(issues, head: string | number): SchemaIssue[]` (issues whose path starts with `head`, with `head` stripped).
  - `FieldGrid({ shape, entry, onChange, disabled, issues })` (`issues` relative to the entry).
  - `ItemCards({ shape, value, onChange, disabled, issues })`; exports `CARD_STYLE`.
  - `DraftEditor({ def, form, initial, targetLabel, saving, onSave, onCancel })` (this task: form mode only).
  - `view.ts`: `targetLabel(t: WriteTarget): string` (`team`, or `team · acme/app`); `EDITOR_KINDS` gains `objectList`; `isEditable` reads `editorKind`.

- [ ] **Step 1: Write the failing `formShape` tests**

Create `apps/console/src/app/settings/formShape.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  addableFields,
  canDraw,
  extraKeys,
  formShape,
  newEntry,
  visibleFields,
} from './formShape';
import { layerOf, TEST_SCHEMAS } from './testSchemas';

describe('formShape', () => {
  it('a list of flat objects is an objectList with its required names', () => {
    const s = formShape(TEST_SCHEMAS['rt.notify.eventBridges'])!;
    expect(s.kind).toBe('objectList');
    expect(Object.keys(s.fields)).toEqual([
      'pattern',
      'category',
      'title',
      'message',
      'subjectPrefix',
      'url',
      'owner',
      'surface',
    ]);
    expect(s.required).toEqual(['pattern', 'category', 'title', 'message']);
    expect(s.fields.owner!.type).toEqual({ enum: ['human'] });
    expect(s.nested).toEqual([]);
  });

  it('a map of objects with a nested optional property draws it read-only', () => {
    const s = formShape(layerOf(TEST_SCHEMAS['deck.apps']!))!;
    expect(s.kind).toBe('objectMap');
    expect(s.nested).toEqual(['override']);
    expect(s.required).toEqual([]);
    expect(s.labels).toEqual(['name', 'value']);
  });

  it('a map keeps its schema labels', () => {
    expect(formShape(TEST_SCHEMAS['gitq.forges'])!.labels).toEqual([
      'host',
      'forge',
    ]);
  });

  it('a required nested property, or no scalar property at all, is JSON only', () => {
    expect(formShape(TEST_SCHEMAS['rt.intercepts'])).toBeNull();
    expect(
      formShape({
        type: 'array',
        items: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string' } } },
        },
      })
    ).toBeNull();
    expect(formShape(TEST_SCHEMAS['board.ticketPrefixes'])).toBeNull();
    expect(formShape(undefined)).toBeNull();
  });
});

describe('entries', () => {
  const s = formShape(TEST_SCHEMAS['rt.notify.eventBridges'])!;

  it('shows required fields, set optional fields and fields the user added', () => {
    expect(visibleFields(s, { pattern: 'x', url: 'u' }, [])).toEqual([
      'pattern',
      'category',
      'title',
      'message',
      'url',
    ]);
    expect(visibleFields(s, {}, ['surface'])).toContain('surface');
  });

  it('offers only optional fields not already shown', () => {
    expect(addableFields(s, { url: 'u' }, ['owner'])).toEqual([
      'subjectPrefix',
      'surface',
    ]);
  });

  it('extra keys are anything the form does not draw', () => {
    expect(extraKeys(s, { pattern: 'x', legacy: 1 })).toEqual(['legacy']);
  });

  it('a new entry takes schema defaults and seeds a required switch off', () => {
    expect(newEntry(s)).toEqual({});
    expect(
      newEntry({
        kind: 'objectList',
        fields: {
          on: { type: 'boolean' },
          mode: { type: { enum: ['a', 'b'] }, default: 'b' },
        },
        nested: [],
        required: ['on', 'mode'],
        labels: ['name', 'value'],
      })
    ).toEqual({ on: false, mode: 'b' });
  });

  it('canDraw needs objects where the form expects them', () => {
    expect(canDraw(s, [{ pattern: 'x' }])).toBe(true);
    expect(canDraw(s, [1])).toBe(false);
    expect(canDraw(s, { a: {} })).toBe(false);
    const map = formShape(TEST_SCHEMAS['gitq.forges'])!;
    expect(canDraw(map, { 'gitlab.example.com': { provider: 'gitlab' } })).toBe(true);
    expect(canDraw(map, { 'gitlab.example.com': 'gitlab' })).toBe(false);
  });
});
```

Run: `cd apps/console && bunx vitest run src/app/settings/formShape.test.ts && cd ../..`
Expected: FAIL, `./formShape` does not exist.

- [ ] **Step 2: Implement `formShape.ts` and `issues.ts`**

```ts
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  rowKind,
  type JsonSchema,
  type LeafType,
  type RowKind,
} from '@mattstack/settings-kit/shapes';

export interface FieldSpec {
  type: LeafType;
  title?: string;
  description?: string;
  placeholder?: string;
  default?: unknown;
  suggestions?: string[];
}

/** A list or map of objects drawn as cards or sections. `nested` names
    declared properties that are not scalars: drawn read-only, kept on
    save. */
export interface FormShape {
  kind: 'objectList' | 'objectMap';
  fields: Record<string, FieldSpec>;
  nested: string[];
  required: string[];
  labels: [string, string];
}

type Entry = Record<string, unknown>;

function isRecord(v: unknown): v is Entry {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function leafOf(s: JsonSchema): LeafType | null {
  if (typeof s.const === 'string') return { enum: [s.const] };
  if (Array.isArray(s.enum) && s.enum.every(e => typeof e === 'string'))
    return { enum: s.enum as string[] };
  if (s.type === 'string' || s.type === 'number' || s.type === 'boolean')
    return s.type;
  if (Array.isArray(s.type)) {
    const t = (s.type as string[]).filter(x => x !== 'null');
    if (t.length === 1) return leafOf({ ...s, type: t[0] });
  }
  return null;
}

function fieldOf(s: JsonSchema): FieldSpec | null {
  const type = leafOf(s);
  if (!type) return null;
  const f: FieldSpec = { type };
  if (typeof s.title === 'string') f.title = s.title;
  if (typeof s.description === 'string') f.description = s.description;
  if (typeof s.placeholder === 'string') f.placeholder = s.placeholder;
  if (s.default !== undefined) f.default = s.default;
  if (Array.isArray(s.examples) && s.examples.every(e => typeof e === 'string'))
    f.suggestions = s.examples as string[];
  return f;
}

/** Cards for a list of objects, sections for a map of objects, when every
    required property is a scalar and at least one property is. Anything
    else is JSON only. */
export function formShape(schema: JsonSchema | undefined): FormShape | null {
  if (!schema) return null;
  let item: JsonSchema | undefined;
  let kind: FormShape['kind'];
  if (schema.type === 'array') {
    item = schema.items as JsonSchema | undefined;
    kind = 'objectList';
  } else if (schema.type === 'object') {
    const props = schema.properties as Record<string, unknown> | undefined;
    const add = schema.additionalProperties;
    if (props && Object.keys(props).length > 0) return null;
    if (!isRecord(add) || Object.keys(add).length === 0) return null;
    item = add as JsonSchema;
    kind = 'objectMap';
  } else return null;
  if (!item || item.type !== 'object' || !isRecord(item.properties)) return null;
  const fields: Record<string, FieldSpec> = {};
  const nested: string[] = [];
  for (const [name, prop] of Object.entries(
    item.properties as Record<string, JsonSchema>
  )) {
    const f = fieldOf(prop);
    if (f) fields[name] = f;
    else nested.push(name);
  }
  const required = Array.isArray(item.required)
    ? (item.required as string[])
    : [];
  if (Object.keys(fields).length === 0) return null;
  if (required.some(r => !(r in fields))) return null;
  const labels = schema.labels as { key?: string; value?: string } | undefined;
  return {
    kind,
    fields,
    nested,
    required,
    labels: [labels?.key ?? 'name', labels?.value ?? 'value'],
  };
}

export function formOf(def: SettingDefWire): FormShape | null {
  return formShape(def.layerSchema ?? def.schema);
}

/** The editor a composite row gets: a form when `formOf` can draw it,
    JSON for any other list or object. */
export function editorKind(def: SettingDefWire): RowKind {
  const kind = rowKind(def);
  if (kind !== 'objectList' && kind !== 'objectMap' && kind !== 'json')
    return kind;
  return formOf(def)?.kind ?? 'json';
}

export function canDraw(shape: FormShape, value: unknown): boolean {
  if (shape.kind === 'objectList')
    return Array.isArray(value) && value.every(isRecord);
  return isRecord(value) && Object.values(value).every(isRecord);
}

/** Required scalars from their schema defaults; a required switch with no
    default starts off, since a switch has no empty state. */
export function newEntry(shape: FormShape): Entry {
  const out: Entry = {};
  for (const name of shape.required) {
    const f = shape.fields[name]!;
    if (f.default !== undefined) out[name] = f.default;
    else if (f.type === 'boolean') out[name] = false;
  }
  return out;
}

export function visibleFields(
  shape: FormShape,
  entry: Entry,
  shown: readonly string[]
): string[] {
  return Object.keys(shape.fields).filter(
    k =>
      shape.required.includes(k) || entry[k] !== undefined || shown.includes(k)
  );
}

export function addableFields(
  shape: FormShape,
  entry: Entry,
  shown: readonly string[]
): string[] {
  return Object.keys(shape.fields).filter(
    k =>
      !shape.required.includes(k) && entry[k] === undefined && !shown.includes(k)
  );
}

export function extraKeys(shape: FormShape, entry: Entry): string[] {
  return Object.keys(entry).filter(k => !(k in shape.fields));
}
```

Create `issues.ts`:

```ts
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

export function issuePath(path: (string | number)[]): string {
  if (path.length === 0) return '(root)';
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`))
    .join('');
}

export function issueText(issue: SchemaIssue): string {
  return `${issuePath(issue.path)}: ${issue.message}`;
}

/** The issues inside one entry, with their paths made relative to it. */
export function issuesUnder(
  issues: SchemaIssue[],
  head: string | number
): SchemaIssue[] {
  return issues
    .filter(i => i.path[0] === head)
    .map(i => ({ ...i, path: i.path.slice(1) }));
}
```

Run: `cd apps/console && bunx vitest run src/app/settings/formShape.test.ts && cd ../..`
Expected: PASS.

- [ ] **Step 3: Write the failing item-card tests**

Create `apps/console/src/app/settings/ItemCards.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';
import { schemaFields } from './testSchemas';

const RULE = {
  pattern: 'gate/opened/*',
  subjectPrefix: 'run:',
  category: 'gate',
  title: '{label}',
  message: '{question}',
  url: 'http://localhost:11001/gates/{id}',
};

function bridges(value: unknown[]): SettingDefWire {
  return {
    key: 'rt.notify.eventBridges',
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Event bridge rules.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: '/home/user/settings.user.jsonc', value },
    storeVersion: 1,
    ...schemaFields('rt.notify.eventBridges'),
  };
}

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
});

beforeEach(() =>
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: null, rows: [] }),
  }))
);
afterEach(() => vi.unstubAllGlobals());

async function open(value: unknown[], s = store()) {
  renderWithProviders(
    <SettingRow def={bridges(value)} store={s} subhead={null} query="" />
  );
  // The row's summary toggle ("1 bridge", "2 bridges"); the row menu's
  // button also carries aria-expanded, so match by name.
  await userEvent.click(screen.getByRole('button', { name: /^\d+ bridges?$/ }));
  return s;
}

describe('item cards', () => {
  it('draws one card per item with required fields and set optional ones', async () => {
    await open([RULE]);
    const card = screen.getByTestId('item-0');
    expect(within(card).getByLabelText('pattern')).toHaveValue('gate/opened/*');
    expect(within(card).getByLabelText('url')).toHaveValue(RULE.url);
    expect(within(card).queryByLabelText('surface')).toBeNull();
    expect(within(card).queryByRole('button', { name: 'remove pattern' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'remove url' })).toBeInTheDocument();
  });

  it('Add item appends a card whose empty required fields keep Save disabled', async () => {
    const s = await open([RULE]);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const card = screen.getByTestId('item-1');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByTestId('draft-issue')).toHaveTextContent(
      '[1].pattern: required property "pattern" is missing'
    );
    await userEvent.type(within(card).getByLabelText('pattern'), 'run/*');
    await userEvent.type(within(card).getByLabelText('category'), 'run');
    await userEvent.type(within(card).getByLabelText('title'), 't');
    await userEvent.type(within(card).getByLabelText('message'), 'm');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.notify.eventBridges', 'user', [
        RULE,
        { pattern: 'run/*', category: 'run', title: 't', message: 'm' },
      ])
    );
  });

  it('reorders and removes items', async () => {
    const other = { ...RULE, pattern: 'run/*', subjectPrefix: 'mr:' };
    const s = await open([RULE, other]);
    await userEvent.click(screen.getByRole('button', { name: 'move item 2 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'remove item 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.notify.eventBridges', 'user', [other])
    );
  });

  it('Add property reveals an optional field; its remove drops it again', async () => {
    await open([RULE]);
    const card = screen.getByTestId('item-0');
    await userEvent.click(within(card).getByRole('button', { name: 'Add property' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'surface' }));
    expect(within(card).getByLabelText('surface')).toHaveValue('');
    await userEvent.click(within(card).getByRole('button', { name: 'remove surface' }));
    expect(within(card).queryByLabelText('surface')).toBeNull();
  });

  it('an unknown extra property is shown read-only and kept on save', async () => {
    const s = await open([{ ...RULE, legacy: 1 }]);
    const card = screen.getByTestId('item-0');
    expect(within(card).getByText('legacy')).toBeInTheDocument();
    expect(within(card).getByText('1')).toBeInTheDocument();
    const title = within(card).getByLabelText('title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Gate');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('rt.notify.eventBridges', 'user', [
        { ...RULE, title: 'Gate', legacy: 1 },
      ])
    );
  });

  it('Save is disabled until something changes; Cancel and Escape discard the draft', async () => {
    const s = await open([RULE]);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const title = within(screen.getByTestId('item-0')).getByLabelText('title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Changed{Escape}');
    expect(within(screen.getByTestId('item-0')).getByLabelText('title')).toHaveValue('{label}');
    await userEvent.type(
      within(screen.getByTestId('item-0')).getByLabelText('title'),
      'x'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(screen.getByTestId('item-0')).getByLabelText('title')).toHaveValue('{label}');
    expect(s.set).not.toHaveBeenCalled();
  });

  it("shows rt's refusal under the row and keeps the draft", async () => {
    const s = store();
    s.set.mockResolvedValueOnce('merged value would fail: [0].url: expected string');
    await open([RULE], s);
    const title = within(screen.getByTestId('item-0')).getByLabelText('title');
    await userEvent.type(title, '!');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('merged value would fail: [0].url: expected string')
    ).toBeInTheDocument();
    expect(title).toHaveValue('{label}!');
  });
});
```

Run: `cd apps/console && bunx vitest run src/app/settings/ItemCards.test.tsx && cd ../..`
Expected: FAIL (the row still renders read-only).

- [ ] **Step 4: `FieldGrid.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Button,
  Code,
  Group,
  Menu,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import {
  enumWidth,
  INPUT_TYPE,
  numberWidth,
  SWITCH_SIZE,
} from './controlStyles';
import {
  addableFields,
  extraKeys,
  visibleFields,
  type FieldSpec,
  type FormShape,
} from './formShape';

type Entry = Record<string, unknown>;

/** Controlled; the number input keeps its raw text so a half-typed "-"
    survives until it parses. */
function FieldInput({
  label,
  spec,
  value,
  disabled,
  onChange,
}: {
  label: string;
  spec: FieldSpec;
  value: unknown;
  disabled: boolean;
  onChange: (v: unknown) => void;
}) {
  const [raw, setRaw] = useState<string | number>(
    typeof value === 'number' ? value : ''
  );
  if (spec.type === 'boolean')
    return (
      <Switch
        aria-label={label}
        size="sm"
        style={SWITCH_SIZE}
        disabled={disabled}
        checked={value === true}
        onChange={e => onChange(e.currentTarget.checked)}
      />
    );
  if (typeof spec.type === 'object')
    return (
      <Select
        aria-label={label}
        size="xs"
        w={enumWidth(spec.type.enum)}
        styles={INPUT_TYPE.label}
        disabled={disabled}
        data={[...spec.type.enum]}
        value={typeof value === 'string' ? value : null}
        allowDeselect={false}
        onChange={v => {
          if (v !== null) onChange(v);
        }}
      />
    );
  if (spec.type === 'number')
    return (
      <NumberInput
        aria-label={label}
        size="xs"
        w={numberWidth(value)}
        styles={INPUT_TYPE.number}
        placeholder={spec.placeholder}
        hideControls
        disabled={disabled}
        value={raw}
        onChange={v => {
          setRaw(v);
          if (typeof v === 'number') onChange(v);
          else if (v === '') onChange(undefined);
        }}
      />
    );
  const text = typeof value === 'string' ? value : '';
  const change = (v: string) => onChange(v === '' ? undefined : v);
  return spec.suggestions ? (
    <Autocomplete
      aria-label={label}
      size="xs"
      w={200}
      styles={INPUT_TYPE.code}
      placeholder={spec.placeholder}
      disabled={disabled}
      data={spec.suggestions}
      value={text}
      onChange={change}
    />
  ) : (
    <TextInput
      aria-label={label}
      size="xs"
      w={200}
      styles={INPUT_TYPE.code}
      placeholder={spec.placeholder}
      disabled={disabled}
      value={text}
      onTextChange={change}
    />
  );
}

function Line({
  name,
  hint,
  children,
  error,
}: {
  name: ReactNode;
  hint?: string;
  children: ReactNode;
  error?: string;
}) {
  const { text } = useSchemeColors();
  return (
    <Stack gap={2} py={4}>
      <Group gap={24} wrap="nowrap" mih={34}>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          {name}
          {hint && (
            <Text fz={12} c={text.muted} lineClamp={2}>
              {hint}
            </Text>
          )}
        </Stack>
        <Group w={260} gap={8} wrap="nowrap" style={{ flex: 'none' }}>
          {children}
        </Group>
      </Group>
      {error && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
          {error}
        </Text>
      )}
    </Stack>
  );
}

/** One object's fields: required first, then set or added optional ones,
    an Add property menu, and read-only rows for properties the form does
    not draw (kept as they are on save). */
export function FieldGrid({
  shape,
  entry,
  onChange,
  disabled,
  issues,
}: {
  shape: FormShape;
  entry: Entry;
  onChange: (next: Entry) => void;
  disabled: boolean;
  issues: SchemaIssue[];
}) {
  const { text } = useSchemeColors();
  const [shown, setShown] = useState<string[]>([]);
  const set = (name: string, v: unknown) => {
    const next = { ...entry };
    if (v === undefined) delete next[name];
    else next[name] = v;
    onChange(next);
  };
  const drop = (name: string) => {
    setShown(s => s.filter(n => n !== name));
    set(name, undefined);
  };
  const errorFor = (name: string) =>
    issues.find(i => i.path[0] === name)?.message;
  const addable = addableFields(shape, entry, shown);
  const extras = extraKeys(shape, entry);

  return (
    <Stack gap={0}>
      {visibleFields(shape, entry, shown).map(name => {
        const spec = shape.fields[name]!;
        const required = shape.required.includes(name);
        return (
          <Line
            key={name}
            name={
              <Text fz={12} ff="monospace">
                {spec.title ?? name}
              </Text>
            }
            hint={spec.description}
            error={errorFor(name)}
          >
            <FieldInput
              label={name}
              spec={spec}
              value={entry[name]}
              disabled={disabled}
              onChange={v => set(name, v)}
            />
            {!required && (
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                size="sm"
                aria-label={`remove ${name}`}
                disabled={disabled}
                onClick={() => drop(name)}
              >
                <Icons.close size={14} />
              </ActionIcon>
            )}
          </Line>
        );
      })}
      {extras.map(name => (
        <Line
          key={name}
          name={
            <Text fz={12} ff="monospace" c={text.muted}>
              {name}
            </Text>
          }
        >
          <Code
            style={{
              background: 'var(--tk-inset)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxWidth: 260,
            }}
          >
            {JSON.stringify(entry[name])}
          </Code>
        </Line>
      ))}
      {extras.length > 0 && (
        <Text fz={12} c={text.muted} py={4}>
          Read-only here and kept as they are; use Edit as JSON to change them.
        </Text>
      )}
      {addable.length > 0 && (
        <Group py={4}>
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={disabled}
                leftSection={<Icons.plus size={12} />}
              >
                Add property
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {addable.map(name => (
                <Menu.Item
                  key={name}
                  onClick={() => setShown(s => [...s, name])}
                >
                  {shape.fields[name]!.title ?? name}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      )}
    </Stack>
  );
}
```

(Every field input's accessible name is the property name, so tests and screen readers find `pattern`, `url`, ... inside a card. The visible label may be the schema `title`.)

- [ ] **Step 5: `ItemCards.tsx`**

```tsx
import { useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import { FieldGrid } from './FieldGrid';
import { newEntry, type FormShape } from './formShape';
import { issuesUnder } from './issues';

type Entry = Record<string, unknown>;

export const CARD_STYLE = {
  border: '1px solid var(--tk-border-soft)',
  borderRadius: 4,
  background: 'var(--tk-card)',
} as const;

/** One card per item, in order. Cards carry stable ids so a card's local
    state (the optional fields it revealed) follows it through a reorder. */
export function ItemCards({
  shape,
  value,
  onChange,
  disabled,
  issues,
}: {
  shape: FormShape;
  value: Entry[];
  onChange: (next: Entry[]) => void;
  disabled: boolean;
  issues: SchemaIssue[];
}) {
  const { text } = useSchemeColors();
  const next = useRef(value.length);
  const [ids, setIds] = useState(() => value.map((_, i) => i));
  const swap = <T,>(list: T[], a: number, b: number) => {
    const out = [...list];
    [out[a], out[b]] = [out[b]!, out[a]!];
    return out;
  };
  const move = (from: number, to: number) => {
    setIds(swap(ids, from, to));
    onChange(swap(value, from, to));
  };
  const remove = (at: number) => {
    setIds(ids.filter((_, i) => i !== at));
    onChange(value.filter((_, i) => i !== at));
  };
  const add = () => {
    setIds([...ids, next.current++]);
    onChange([...value, newEntry(shape)]);
  };
  const first = shape.required[0];

  return (
    <Stack gap={8}>
      {value.map((item, i) => (
        <Box
          key={ids[i]}
          p={12}
          style={CARD_STYLE}
          data-testid={`item-${i}`}
        >
          <Group justify="space-between" wrap="nowrap" pb={4}>
            <Text fz={12} fw={500} ff="monospace" truncate>
              {`#${i + 1}`}
              {first && typeof item[first] === 'string' && (
                <Text span inherit c={text.muted} fw={400}>
                  {`  ${item[first] as string}`}
                </Text>
              )}
            </Text>
            <Group gap={2} wrap="nowrap">
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                size="sm"
                aria-label={`move item ${i + 1} up`}
                disabled={disabled || i === 0}
                onClick={() => move(i, i - 1)}
              >
                <Icons.chevronUp size={14} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                size="sm"
                aria-label={`move item ${i + 1} down`}
                disabled={disabled || i === value.length - 1}
                onClick={() => move(i, i + 1)}
              >
                <Icons.chevronDown size={14} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="gray"
                c={text.muted}
                size="sm"
                aria-label={`remove item ${i + 1}`}
                disabled={disabled}
                onClick={() => remove(i)}
              >
                <Icons.trash size={14} />
              </ActionIcon>
            </Group>
          </Group>
          <FieldGrid
            shape={shape}
            entry={item}
            disabled={disabled}
            issues={issuesUnder(issues, i)}
            onChange={e => onChange(value.map((x, j) => (j === i ? e : x)))}
          />
        </Box>
      ))}
      <Group>
        <Button
          size="compact-sm"
          variant="default"
          disabled={disabled}
          leftSection={<Icons.plus size={14} />}
          onClick={add}
        >
          Add item
        </Button>
      </Group>
    </Stack>
  );
}
```

Check the icon names used (`chevronUp`, `chevronDown`, `trash`, `plus`, `close`) exist in the kit registry (`packages/ui/src/icons/Icons.ts`); all five are already used in `apps/console/src/app/settings/`.

- [ ] **Step 6: `DraftEditor.tsx` (form mode)**

```tsx
import { useState, type KeyboardEvent } from 'react';
import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { checkValue } from '@mattstack/settings-kit/shapes';

import type { FormShape } from './formShape';
import { issueText } from './issues';
import { ItemCards } from './ItemCards';

type Entry = Record<string, unknown>;

function emptyOf(form: FormShape): unknown {
  return form.kind === 'objectList' ? [] : {};
}

/** A local draft of one layer's value, checked against the def's layer
    schema as it changes and saved only when it passes. Escape and Cancel
    discard it; Escape is marked handled so an enclosing modal stays open. */
export function DraftEditor({
  def,
  form,
  initial,
  targetLabel,
  saving,
  onSave,
  onCancel,
}: {
  def: SettingDefWire;
  form: FormShape;
  initial: unknown;
  targetLabel: string;
  saving: boolean;
  onSave: (value: unknown) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { text } = useSchemeColors();
  const start = initial ?? emptyOf(form);
  const [draft, setDraft] = useState<unknown>(() => structuredClone(start));
  const schema = def.layerSchema ?? def.schema;
  const issues = schema ? checkValue(schema, draft) : [];
  const changed = JSON.stringify(draft) !== JSON.stringify(start);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('[role="menu"], [role="listbox"]'))
      return;
    e.preventDefault();
    onCancel();
  };

  return (
    <Stack gap={10} onKeyDown={onKeyDown}>
      {form.kind === 'objectList' && (
        <ItemCards
          shape={form}
          value={draft as Entry[]}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
        />
      )}
      {issues[0] && (
        <Text
          fz={12}
          ff="monospace"
          c="var(--tk-text-bad-small)"
          data-testid="draft-issue"
        >
          {issueText(issues[0])}
        </Text>
      )}
      <Group gap={8} justify="flex-end" wrap="nowrap">
        <Text fz={12} c={text.muted}>
          {`saves to ${targetLabel}`}
        </Text>
        <Button size="compact-sm" variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="compact-sm"
          disabled={!changed || issues.length > 0 || saving}
          onClick={() => void onSave(draft)}
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}
```

Callers remount `DraftEditor` (a changing `key`) to discard the draft: `onCancel` bumps that key.

- [ ] **Step 7: Wire forms into composite rows**

`view.ts`: add

```ts
export function targetLabel(t: WriteTarget): string {
  return t.repo ? `${t.scope} · ${repoLabel(t.repo)}` : t.scope;
}
```

(`repoLabel` exists from Task 6), add `'objectList'` to `EDITOR_KINDS`, and make `isEditable` read `EDITOR_KINDS.has(editorKind(def))` (import `editorKind` from `./formShape`; `formShape.ts` imports nothing from `view.ts`, so there is no cycle). Drop `rowKind` from `view.ts`'s settings-kit import if nothing else there uses it.

`CompositeControls.tsx`: add a `FormBody`:

```tsx
/** A form over the target layer's own value. A deep key's draft starts from
    that layer's authored value, never the merged view, so defaults and
    other layers are never copied into it; a replace key starts from the
    value in effect, as the list editors do. */
function FormBody({
  def,
  row,
  form,
}: {
  def: SettingDefWire;
  row: Row;
  form: FormShape;
}) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  const explained = useKeyExplain(def.key, repo);
  const [resets, setResets] = useState(0);
  const at = rungOf(row.target.scope, row.target.repo ?? null);
  const deep = def.merge === 'deep';
  if (deep && explained.rows.length === 0)
    return (
      <Body>
        <Skeleton h={48} />
      </Body>
    );
  const initial = deep
    ? explained.rows.find(r => r.scope === at && r.present)?.value
    : def.effective.value;
  if (initial !== undefined && !canDraw(form, initial))
    return (
      <Body>
        <JsonBlock value={initial} />
        <Text fz={12} c={text.muted} pt={6}>
          This value does not fit the form.
        </Text>
      </Body>
    );
  return (
    <Body>
      <DraftEditor
        key={`${resets}:${JSON.stringify(initial) ?? ''}`}
        def={def}
        form={form}
        initial={initial}
        targetLabel={targetLabel(row.target)}
        saving={row.status === 'saving'}
        onCancel={() => setResets(n => n + 1)}
        onSave={async value => {
          const empty =
            deep &&
            typeof value === 'object' &&
            value !== null &&
            Object.keys(value).length === 0;
          const ok = await (empty ? row.clear(at) : row.save(value));
          if (ok) explained.refresh();
          return ok;
        }}
      />
    </Body>
  );
}
```

In `compositeParts`, compute `const form = formOf(def);` and `const edit = editorKind(def);`, and before the `stringList`/`stringMap`/`leaves` guard add:

```tsx
  if ((edit === 'objectList' || edit === 'objectMap') && form) {
    if (def.effective.invalid !== undefined)
      return { control: <ShapeLock at={def.effective.scope} row={row} />, body: null };
    return {
      control: (
        <ExpandToggle
          label={value === undefined ? 'unset' : summarize(def)}
          open={open}
          onToggle={onToggle}
        />
      ),
      body: open ? <FormBody def={def} row={row} form={form} /> : null,
    };
  }
```

(An unset form row still expands, so the first item can be added.) Task 9 renders `objectMap` in `DraftEditor`; until then an `objectMap` form row expands to an editor with only Save and Cancel, which Task 9 fills in the same branch. Imports: `Skeleton` from `@mattstack/app-kit/core`, `canDraw`, `editorKind`, `formOf`, `type FormShape` from `./formShape`, `DraftEditor`, `JsonBlock`, `useKeyExplain`, `useSettingsRepo`, `rungOf`, `targetLabel`.

Run: `cd apps/console && bunx vitest run src/app/settings/ItemCards.test.tsx && cd ../..`
Expected: PASS. If the Escape test fails because focus leaves the input when the draft remounts, assert on a fresh query of the input (as written) rather than a held reference.

- [ ] **Step 8: Gates, UI validation, commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

UI validation (recipe, both schemes): expand `rt.notify.eventBridges` on the page. Cards read as distinct surfaces from the row body in both schemes (if a card on `--tk-card` blends into the modal or page surface in dark, try `--tk-raised`; say which you chose and why); field labels align with today's leaves rows; Add item appends a card with Save disabled and the issue line naming `[n].pattern`; Add property's menu opens and reveals a field; Cancel restores. Writes are stubbed by the recipe, so a Save shows the stub's refusal under the row: confirm it renders as today's refused-save line.

```bash
git add apps/console/src/app/settings
git commit -m "console: item cards for lists of objects, over a checked local draft

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 9: Named sections (`objectMap`), including `deck.apps`

Maps of objects get one section per entry. This covers settings-kit's `objectMap` keys (`gitq.forges`) and the keys `formShape` widens (`deck.apps`, `rt.roles`, `rt.sdmEnrichment`), whose nested properties (`deck.apps`'s `override`) are drawn read-only and kept on save.

**Needs from spec 1's wire contract:** as Task 8, plus `layerSchema` for deep map keys (`gitq.forges`, `deck.apps` merge deep, so a layer's entries may omit properties the full schema requires) and the `labels: { key, value }` metadata on a record schema.

**Files:**
- Create: `apps/console/src/app/settings/NamedSections.tsx`, `NamedSections.test.tsx`
- Modify: `apps/console/src/app/settings/DraftEditor.tsx`, `CompositeControls.tsx`, `view.ts`

**Interfaces:**
- Consumes: `FieldGrid`, `CARD_STYLE`, `newEntry`, `issuesUnder` (Task 8).
- Produces: `NamedSections({ shape, value, onChange, disabled, issues })`; `rowSummary(def: SettingDefWire): string` in `CompositeControls.tsx` (entries count for a form map, else settings-kit's `summarize`); `EDITOR_KINDS` gains `objectMap`.

- [ ] **Step 1: Write the failing tests**

Create `apps/console/src/app/settings/NamedSections.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';
import { schemaFields } from './testSchemas';

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
});

function deepDef(
  key: string,
  value: Record<string, unknown>,
  scopes: string[] = ['user']
): SettingDefWire {
  return {
    key,
    type: 'object',
    scopes: scopes as SettingDefWire['scopes'],
    merge: 'deep',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A map.',
    hasDefault: true,
    defaultValue: {},
    effective: { scope: 'user', file: '/home/user/settings.user.jsonc', value },
    storeVersion: 1,
    ...schemaFields(key),
  };
}

function stubRows(rows: ExplainRowWire[]) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: null, rows }),
  }));
}
afterEach(() => vi.unstubAllGlobals());

async function openRow(def: SettingDefWire, s = store()) {
  renderWithProviders(<SettingRow def={def} store={s} subhead={null} query="" />);
  await userEvent.click(screen.getByRole('button', { name: /^\d+ entr(y|ies)$/ }));
  return s;
}

describe('named sections', () => {
  const DEFAULT_FORGE = { 'gitlab.example.com': { provider: 'gitlab' } };
  const USER_FORGE = { 'github.example.com': { provider: 'github', tokenEnv: 'GH_TOKEN' } };

  it("a deep map edits only the target layer's own entries", async () => {
    stubRows([
      { scope: 'default', file: null, present: true, value: DEFAULT_FORGE },
      { scope: 'user', file: '/home/user/settings.user.jsonc', present: true, value: USER_FORGE },
    ]);
    const s = await openRow(deepDef('gitq.forges', { ...DEFAULT_FORGE, ...USER_FORGE }));
    expect(await screen.findByTestId('entry-github.example.com')).toBeInTheDocument();
    expect(screen.queryByTestId('entry-gitlab.example.com')).toBeNull();
    await userEvent.type(screen.getByLabelText('new host'), 'git.example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    const added = screen.getByTestId('entry-git.example.org');
    await userEvent.click(within(added).getByRole('button', { name: 'Add property' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'baseUrl' }));
    await userEvent.type(within(added).getByLabelText('baseUrl'), 'https://git.example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('gitq.forges', 'user', {
        ...USER_FORGE,
        'git.example.org': { baseUrl: 'https://git.example.org' },
      })
    );
  });

  it('rejects an empty or duplicate entry name', async () => {
    stubRows([
      { scope: 'user', file: '/home/user/settings.user.jsonc', present: true, value: USER_FORGE },
    ]);
    await openRow(deepDef('gitq.forges', USER_FORGE));
    await screen.findByTestId('entry-github.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(screen.getByText('host is required')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('new host'), 'github.example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));
    expect(screen.getByText('github.example.com already exists')).toBeInTheDocument();
  });

  it('removes an entry', async () => {
    stubRows([
      { scope: 'user', file: '/home/user/settings.user.jsonc', present: true, value: USER_FORGE },
    ]);
    const s = await openRow(deepDef('gitq.forges', USER_FORGE));
    await userEvent.click(
      await screen.findByRole('button', { name: 'remove entry github.example.com' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    // An emptied deep layer is removed rather than written as {}.
    await waitFor(() => expect(s.unset).toHaveBeenCalledWith('gitq.forges', 'user'));
  });

  it('deck.apps draws its nested override read-only and keeps it on save', async () => {
    const APPS = {
      'acme-app': { published: true, override: { devPort: 5173, basePort: 4100 } },
    };
    stubRows([
      { scope: 'user', file: '/home/user/settings.user.jsonc', present: true, value: APPS },
    ]);
    const s = await openRow(deepDef('deck.apps', APPS));
    const section = await screen.findByTestId('entry-acme-app');
    expect(within(section).getByText('override')).toBeInTheDocument();
    expect(within(section).getByText('{"devPort":5173,"basePort":4100}')).toBeInTheDocument();
    expect(
      within(section).getByText(/use Edit as JSON to change them/)
    ).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('switch', { name: 'published' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('deck.apps', 'user', {
        'acme-app': { published: false, override: { devPort: 5173, basePort: 4100 } },
      })
    );
  });
});
```

(Mantine's `Switch` input carries `role="switch"`; if it renders as a checkbox in 9.5, use `getByRole('checkbox', { name: 'published' })`.)

Run: `cd apps/console && bunx vitest run src/app/settings/NamedSections.test.tsx && cd ../..`
Expected: FAIL.

- [ ] **Step 2: `NamedSections.tsx`**

```tsx
import { useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import { INPUT_TYPE } from './controlStyles';
import { FieldGrid } from './FieldGrid';
import { newEntry, type FormShape } from './formShape';
import { CARD_STYLE } from './ItemCards';
import { issuesUnder } from './issues';

type Entry = Record<string, unknown>;

/** One section per entry, titled by its name. A new entry needs a name
    that is neither empty nor already taken. */
export function NamedSections({
  shape,
  value,
  onChange,
  disabled,
  issues,
}: {
  shape: FormShape;
  value: Record<string, Entry>;
  onChange: (next: Record<string, Entry>) => void;
  disabled: boolean;
  issues: SchemaIssue[];
}) {
  const { text } = useSchemeColors();
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [noun] = shape.labels;
  const add = () => {
    const n = name.trim();
    if (!n) return setNameError(`${noun} is required`);
    if (Object.hasOwn(value, n)) return setNameError(`${n} already exists`);
    onChange({ ...value, [n]: newEntry(shape) });
    setName('');
    setNameError(null);
  };
  const remove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  return (
    <Stack gap={8}>
      {Object.entries(value).map(([key, entry]) => (
        <Box key={key} p={12} style={CARD_STYLE} data-testid={`entry-${key}`}>
          <Group justify="space-between" wrap="nowrap" pb={4}>
            <Text fz={12} fw={500} ff="monospace" truncate>
              {key}
            </Text>
            <ActionIcon
              variant="subtle"
              color="gray"
              c={text.muted}
              size="sm"
              aria-label={`remove entry ${key}`}
              disabled={disabled}
              onClick={() => remove(key)}
            >
              <Icons.trash size={14} />
            </ActionIcon>
          </Group>
          <FieldGrid
            shape={shape}
            entry={entry}
            disabled={disabled}
            issues={issuesUnder(issues, key)}
            onChange={e => onChange({ ...value, [key]: e })}
          />
        </Box>
      ))}
      <Stack gap={2}>
        <Group gap={8} wrap="nowrap">
          <TextInput
            aria-label={`new ${noun}`}
            size="xs"
            w={240}
            styles={INPUT_TYPE.code}
            placeholder={noun}
            disabled={disabled}
            value={name}
            onTextChange={v => {
              setName(v);
              setNameError(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') add();
            }}
          />
          <Button
            size="compact-sm"
            variant="default"
            disabled={disabled}
            leftSection={<Icons.plus size={14} />}
            onClick={add}
          >
            Add entry
          </Button>
        </Group>
        {nameError && (
          <Text fz={12} c="var(--tk-text-bad-small)">
            {nameError}
          </Text>
        )}
      </Stack>
    </Stack>
  );
}
```

- [ ] **Step 3: Render it, count entries, mark `objectMap` editable**

`DraftEditor.tsx`: beside the `objectList` branch,

```tsx
      {form.kind === 'objectMap' && (
        <NamedSections
          shape={form}
          value={draft as Record<string, Entry>}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
        />
      )}
```

`CompositeControls.tsx`:

```ts
/** A form map counts its entries whatever settings-kit calls the key (a
    widened `json` key would otherwise read "N fields"). */
export function rowSummary(def: SettingDefWire): string {
  const v = def.effective.value;
  if (editorKind(def) !== 'objectMap') return summarize(def);
  const n =
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.keys(v).length
      : 0;
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}
```

and use `rowSummary(def)` instead of `summarize(def)` in the form branch's `ExpandToggle` label. `view.ts`: add `'objectMap'` to `EDITOR_KINDS`.

Run: `cd apps/console && bunx vitest run src/app/settings/NamedSections.test.tsx && cd ../..`
Expected: PASS.

- [ ] **Step 4: Gates, UI validation, commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

UI validation (recipe, both schemes): expand `deck.apps` (one section per app, `override` read-only with the note, `published` switch), `gitq.forges` if set, and `rt.roles` with the team repo picked (sections for each role with `fixedPort`/`hook` editable and `pool`/`needs`/`env` read-only). Check the section title row, the read-only JSON cells (no overflow past the 260px column, wrapping legibly) and the Add entry row. Try an empty and a duplicate name.

```bash
git add apps/console/src/app/settings
git commit -m "console: named sections for maps of objects, nested properties kept read-only

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 10: JSON editor, Edit as JSON on every JSON row, layer editors in the explain modal

**Needs from spec 1's wire contract:** `schema` / `layerSchema` (the JSON editor completes and lints against `layerSchema ?? schema`); `checkValue`; explain rows' per-layer `value` (the modal's layer editor starts from it).

**Files:**
- Create: `apps/console/src/app/settings/JsonDraft.tsx`, `JsonEditor.test.tsx`
- Modify: `apps/console/src/app/settings/DraftEditor.tsx`, `CompositeControls.tsx`, `SettingRow.tsx`, `RowMenu.tsx`, `ExplainModal.tsx`, `view.ts`

**Interfaces:**
- Consumes: kit `CodeMirror` with `jsonSchema` and `jsonCheck` (Task 4); `formOf`, `canDraw`, `editorKind` (Task 8).
- Produces:
  - `JsonDraft({ text, onText, schema }: { text: string; onText: (t: string) => void; schema: JsonSchema | undefined })`.
  - `DraftEditor` props become `{ def; form: FormShape | null; initial: unknown; startIn?: 'form' | 'json'; targetLabel; saving; onSave; onCancel }`. It opens in the form when `form` can draw the start value and `startIn !== 'json'`, else in JSON. The toggle button reads `Edit as JSON` / `Edit as form`.
  - `DraftBody({ def, row, form, startIn })` in `CompositeControls.tsx` (Task 8's `FormBody`, generalised: `form` may be null).
  - `compositeParts(def, kind, row, open, onToggle, asJson, onDoneJson, onEditJson)`: `asJson` renders the JSON editor for any JSON row kind; `onEditJson` feeds the list, map and leaves bodies' Edit as JSON button.
  - `RowMenu` gains `onEditJson?: () => void` (an `Edit as JSON` item); the menu renders whenever it has any item.
  - `LayerLine` edits composite layers with a `DraftEditor` under the line.
  - `EDITOR_KINDS` gains `json`.

- [ ] **Step 1: Write the failing tests**

Create `apps/console/src/app/settings/JsonEditor.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/app-kit/lazy', () => ({
  CodeMirror: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange?: (v: string) => void;
  }) => (
    <textarea
      aria-label="JSON"
      value={value}
      onChange={e => onChange?.(e.currentTarget.value)}
    />
  ),
}));

const { SettingRow } = await import('./SettingRow');
const { ExplainModal } = await import('./ExplainModal');
const { schemaFields } = await import('./testSchemas');

const USER_FILE = '/home/user/settings.user.jsonc';
const RULE = {
  pattern: 'gate/opened/*',
  category: 'gate',
  title: '{label}',
  message: '{question}',
};
const INTERCEPT = {
  command: 'bun',
  matches: [{ cwdGlob: '/home/user/src/*', role: 'dev' }],
};

function def(
  key: string,
  value: unknown,
  over: Partial<SettingDefWire> = {}
): SettingDefWire {
  return {
    key,
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'A JSON key.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: USER_FILE, value },
    storeVersion: 1,
    ...schemaFields(key),
    ...over,
  };
}

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
});

function stubRows(rows: ExplainRowWire[], d: SettingDefWire | null = null) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ def: d, rows }),
  }));
}
afterEach(() => vi.unstubAllGlobals());

const editor = () => screen.getByRole('textbox', { name: 'JSON' });
const setText = (t: string) => fireEvent.change(editor(), { target: { value: t } });

describe('JSON editor', () => {
  it('a key the forms cannot draw edits as JSON with schema errors inline', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow def={def('rt.intercepts', [INTERCEPT])} store={s} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: /^1 intercept$/ }));
    expect(editor()).toHaveValue(JSON.stringify([INTERCEPT], null, 2));
    expect(screen.queryByRole('button', { name: 'Edit as form' })).toBeNull();

    setText('[{"command": "bun"');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('draft-issue')).toHaveTextContent(/^JSON: /);

    setText('[{"command": "bun"}]');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('draft-issue')).toHaveTextContent(
      '[0].matches: required property "matches" is missing'
    );

    const next = [{ ...INTERCEPT, command: 'bunx' }];
    setText(JSON.stringify(next));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('rt.intercepts', 'user', next));
  });

  it('switching between form and JSON keeps the draft', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow def={def('rt.notify.eventBridges', [RULE])} store={store()} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: /^1 bridge$/ }));
    const title = within(screen.getByTestId('item-0')).getByLabelText('title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Gate');
    await userEvent.click(screen.getByRole('button', { name: 'Edit as JSON' }));
    expect(JSON.parse((editor() as HTMLTextAreaElement).value)).toEqual([
      { ...RULE, title: 'Gate' },
    ]);
    setText(JSON.stringify([{ ...RULE, title: 'Gate 2' }]));
    await userEvent.click(screen.getByRole('button', { name: 'Edit as form' }));
    expect(within(screen.getByTestId('item-0')).getByLabelText('title')).toHaveValue('Gate 2');
  });

  it('the form stays out of reach while the JSON does not parse', async () => {
    stubRows([]);
    renderWithProviders(
      <SettingRow def={def('rt.notify.eventBridges', [RULE])} store={store()} subhead={null} query="" />
    );
    await userEvent.click(screen.getByRole('button', { name: /^1 bridge$/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit as JSON' }));
    setText('[');
    expect(screen.getByRole('button', { name: 'Edit as form' })).toBeDisabled();
    expect(screen.getByText('Fix the JSON to switch back to the form.')).toBeInTheDocument();
  });

  it('a short string list edits as JSON from its row menu', async () => {
    stubRows([]);
    const s = store();
    renderWithProviders(
      <SettingRow
        def={def('board.ticketPrefixes', ['RT'], { scopes: ['team'], effective: { scope: 'team', file: '/t', value: ['RT'] } })}
        store={s}
        subhead={null}
        query=""
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'board.ticketPrefixes actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit as JSON' }));
    setText('["RT", "MAT"]');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', ['RT', 'MAT'])
    );
  });

  it('in the explain modal, Escape abandons a layer edit and leaves the modal open', async () => {
    const d = def('rt.notify.eventBridges', [RULE]);
    stubRows(
      [
        { scope: 'default', file: null, present: false },
        { scope: 'user', file: USER_FILE, present: true, value: [RULE] },
      ],
      d
    );
    const onClose = vi.fn();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.notify.eventBridges"
          store={{ defs: [d], loading: false, error: null, ...store() }}
          onClose={onClose}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    await userEvent.click(
      within(layer).getByRole('button', { name: 'set rt.notify.eventBridges at user' })
    );
    await userEvent.click(within(layer).getByRole('button', { name: 'Edit as JSON' }));
    setText('[]');
    await userEvent.type(within(layer).getByRole('textbox', { name: 'JSON' }), '{Escape}');
    expect(within(layer).queryByRole('textbox', { name: 'JSON' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

(`nouns('rt.intercepts')` yields `intercept`/`intercepts`, so the summary is `1 intercept`. If settings-kit's `summarize` words it differently, match what it returns.)

Run: `cd apps/console && bunx vitest run src/app/settings/JsonEditor.test.tsx && cd ../..`
Expected: FAIL.

- [ ] **Step 2: `JsonDraft.tsx`**

```tsx
import { useMemo } from 'react';
import { CodeMirror } from '@mattstack/app-kit/lazy';
import { checkValue, type JsonSchema } from '@mattstack/settings-kit/shapes';

/** The JSON text of a draft, completed and linted against the same schema
    the Save button checks, so an underline and the issue line agree. */
export function JsonDraft({
  text,
  onText,
  schema,
}: {
  text: string;
  onText: (t: string) => void;
  schema: JsonSchema | undefined;
}) {
  const check = useMemo(
    () => (schema ? (v: unknown) => checkValue(schema, v) : undefined),
    [schema]
  );
  return (
    <CodeMirror
      value={text}
      onChange={onText}
      language="json"
      height="260px"
      jsonSchema={schema}
      jsonCheck={check}
    />
  );
}
```

- [ ] **Step 3: `DraftEditor` gains JSON mode**

Replace `DraftEditor.tsx` with:

```tsx
import { useState, type KeyboardEvent } from 'react';
import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { checkValue } from '@mattstack/settings-kit/shapes';

import { canDraw, type FormShape } from './formShape';
import { issueText } from './issues';
import { ItemCards } from './ItemCards';
import { JsonDraft } from './JsonDraft';
import { NamedSections } from './NamedSections';

type Entry = Record<string, unknown>;
type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? '';
}

function parse(text: string): Parsed {
  if (text.trim() === '') return { ok: false, message: 'empty document' };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function emptyOf(def: SettingDefWire): unknown {
  return def.type === 'array' ? [] : {};
}

/** A local draft of one layer's value, as a form or as JSON, checked
    against the def's layer schema as it changes and saved only when it
    parses and passes. Switching modes carries the draft across; the form is
    out of reach while the JSON does not parse or does not fit it. Escape
    and Cancel discard the draft; Escape is marked handled so an enclosing
    modal stays open. */
export function DraftEditor({
  def,
  form,
  initial,
  startIn = 'form',
  targetLabel,
  saving,
  onSave,
  onCancel,
}: {
  def: SettingDefWire;
  form: FormShape | null;
  initial: unknown;
  startIn?: 'form' | 'json';
  targetLabel: string;
  saving: boolean;
  onSave: (value: unknown) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { text: colors } = useSchemeColors();
  const start = initial ?? emptyOf(def);
  const schema = def.layerSchema ?? def.schema;
  const [mode, setMode] = useState<'form' | 'json'>(
    form && startIn === 'form' && canDraw(form, start) ? 'form' : 'json'
  );
  const [draft, setDraft] = useState<unknown>(() => structuredClone(start));
  const [text, setText] = useState(() => pretty(start));

  const parsed: Parsed =
    mode === 'json' ? parse(text) : { ok: true, value: draft };
  const issues =
    parsed.ok && schema ? checkValue(schema, parsed.value) : [];
  const changed =
    parsed.ok && JSON.stringify(parsed.value) !== JSON.stringify(start);
  const fits = parsed.ok && form !== null && canDraw(form, parsed.value);

  const toJson = () => {
    setText(pretty(draft));
    setMode('json');
  };
  const toForm = () => {
    if (!parsed.ok || !fits) return;
    setDraft(parsed.value);
    setMode('form');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest('[role="menu"], [role="listbox"]'))
      return;
    e.preventDefault();
    onCancel();
  };

  return (
    <Stack gap={10} onKeyDown={onKeyDown}>
      {form && (
        <Group gap={8} justify="flex-end" wrap="nowrap">
          {mode === 'json' && !fits && (
            <Text fz={12} c={colors.muted}>
              {parsed.ok
                ? 'This value does not fit the form.'
                : 'Fix the JSON to switch back to the form.'}
            </Text>
          )}
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={mode === 'json' && !fits}
            onClick={mode === 'form' ? toJson : toForm}
          >
            {mode === 'form' ? 'Edit as JSON' : 'Edit as form'}
          </Button>
        </Group>
      )}
      {mode === 'json' && (
        <JsonDraft text={text} onText={setText} schema={schema} />
      )}
      {mode === 'form' && form?.kind === 'objectList' && (
        <ItemCards
          shape={form}
          value={draft as Entry[]}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
        />
      )}
      {mode === 'form' && form?.kind === 'objectMap' && (
        <NamedSections
          shape={form}
          value={draft as Record<string, Entry>}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
        />
      )}
      {(!parsed.ok || issues[0]) && (
        <Text
          fz={12}
          ff="monospace"
          c="var(--tk-text-bad-small)"
          data-testid="draft-issue"
        >
          {parsed.ok ? issueText(issues[0]!) : `JSON: ${parsed.message}`}
        </Text>
      )}
      <Group gap={8} justify="flex-end" wrap="nowrap">
        <Text fz={12} c={colors.muted}>
          {`saves to ${targetLabel}`}
        </Text>
        <Button size="compact-sm" variant="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="compact-sm"
          disabled={!parsed.ok || !changed || issues.length > 0 || saving}
          onClick={() => {
            if (parsed.ok) void onSave(parsed.value);
          }}
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}
```

- [ ] **Step 4: Rows: `DraftBody`, JSON rows, Edit as JSON**

In `CompositeControls.tsx`, rename `FormBody` to `DraftBody`, make `form: FormShape | null`, add `startIn?: 'form' | 'json'` and `onDone?: () => void` props, drop its `canDraw` early return (DraftEditor now falls back to JSON by itself), pass `form`, `startIn` and `onCancel={() => { setResets(n => n + 1); onDone?.(); }}` through, and call `onDone?.()` after a successful save too.

Extend `compositeParts`'s signature with `asJson: boolean, onDoneJson: () => void` and, at the top after `readonly` is built (and after the `kind === readonly/external` checks), add:

```tsx
  const jsonBody = (
    <DraftBody def={def} row={row} form={null} startIn="json" onDone={onDoneJson} />
  );
  if (asJson && EDITOR_KINDS.has(edit))
    return { control: toggleOf(open), body: open ? jsonBody : null };
  if (edit === 'json') {
    if (def.effective.invalid !== undefined)
      return { control: <ShapeLock at={def.effective.scope} row={row} />, body: null };
    return {
      control: toggleOf(open),
      body: open ? (
        <DraftBody def={def} row={row} form={null} startIn="json" />
      ) : null,
    };
  }
```

where `toggleOf = (o: boolean) => <ExpandToggle label={value === undefined ? 'unset' : rowSummary(def)} open={o} onToggle={onToggle} />`, used by the form branch too. `EDITOR_KINDS` comes from `./view`.

For the list/map/leaves bodies (`StringListBody`, `StringMapBody`, `LeavesBody`), add a footer line inside `Body`:

```tsx
<Group py={6}>
  <Button size="compact-xs" variant="subtle" onClick={onEditJson}>
    Edit as JSON
  </Button>
</Group>
```

with an `onEditJson` prop that `compositeParts` supplies as a new `onEditJson: () => void` argument (SettingRow's `() => setAsJson(true)`).

`SettingRow.tsx`: add `const [asJson, setAsJson] = useState(false);`; pass `asJson`, `() => setAsJson(false)` and `() => { setAsJson(true); setOpen(true); }` into `compositeParts`; pass `onEditJson={isComposite && isEditable(def) ? () => { setAsJson(true); setOpen(true); } : undefined}` to `RowMenu`, where `isComposite = def.type === 'object' || def.type === 'array'`.

`RowMenu.tsx`: compute the Move/Remove items as today into a `stored` flag (`def.writable && base && def.scopes.includes(base)`); render the empty slot only when `!stored && !onEditJson`; inside the dropdown render the Move items and Remove only when `stored`, and when `onEditJson` is set, add `<Menu.Item leftSection={<Icons.edit size={14} />} onClick={onEditJson}>Edit as JSON</Menu.Item>` first, followed by a `<Menu.Divider />` when `stored`.

`view.ts`: add `'json'` to `EDITOR_KINDS`.

- [ ] **Step 5: Composite layer editors in the explain modal**

In `ExplainModal.tsx` `LayerLine`: compute `const edit = editorKind(def);` and

```ts
  const composite = def.type === 'object' || def.type === 'array';
  const editable =
    writable && (composite ? EDITOR_KINDS.has(edit) : kind === 'scalar' || kind === 'enum');
```

When `editing && store && composite`, keep the line's value column as is and render, under the line's `Stack` of notes, a full-width editor:

```tsx
      {editing && composite && store && (
        <Box pt={10} pl={SCOPE_COL + 12}>
          <DraftEditor
            def={def}
            form={formOf(def)}
            initial={row.present ? row.value : undefined}
            startIn={startIn}
            targetLabel={isRung(scope) ? `${store} · repo` : store}
            saving={busy}
            onCancel={() => setEditing(false)}
            onSave={v => onSet(scope, v).then(ok => {
              if (ok) setSaved(true);
              return ok;
            })}
          />
        </Box>
      )}
```

(`startIn` is a new optional `LayerLine` prop, default `'form'`; Task 11 sets it. `onSet`'s first parameter becomes the row's own scope string, per Task 5.) The scalar editing branch stays for non-composite keys only.

Run: `cd apps/console && bunx vitest run src/app/settings/JsonEditor.test.tsx && cd ../..`, then `bun run console:test`
Expected: PASS.

- [ ] **Step 6: Gates, UI validation, commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

UI validation (recipe, both schemes): `rt.intercepts` expanded (JSON editor, completion popup after typing `"` inside an item, an underline on a bad value with its message on hover matching the line under the editor, lint gutter marker legible); `rt.notify.eventBridges` switching Form to JSON and back with an edit carried across; Escape inside the JSON editor in the explain modal (editor closes, modal stays); the row menu's Edit as JSON on `board.ticketPrefixes`. Check the editor's height inside the row body and inside the modal (no double scrollbars) and its theme in dark.

```bash
git add apps/console/src/app/settings
git commit -m "console: JSON editor for every JSON row and explain layer, form and JSON share one draft

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 11: Needs fixing: the chip, issue lines on rows, Fix into the right layer and repo

**Needs from spec 1's wire contract:** `SettingDefWire.issues?: WireIssue[]` with `WireIssue = { scope, file, repo?, kind, path, message, ...extra }` (`kind` is `invalid` or `nonconforming` today; any other kind is shown generically), `mergedIssues?: { path, message }[]`, both computed on `/defs` with no per-key call and resolved for `?repo=`; `ExplainRowWire.nonconforming?: { path, message }[]`; `invalid` on explain rows (the path-guard or type reason). A secret def's issues carry fixed messages and no value.

**Files:**
- Create: `apps/console/src/app/settings/IssueLines.tsx`, `FixFlow.test.tsx`
- Modify: `apps/console/src/app/settings/issues.ts`, `view.ts`, `view.test.ts`, `explainParam.ts`, `SettingRow.tsx`, `SettingsSection.tsx`, `SettingsPage.tsx`, `ExplainModal.tsx`

**Interfaces:**
- Produces:
  - `issues.ts`: `type WireIssue = NonNullable<SettingDefWire['issues']>[number]`; `issueWhere(issue): string` (`user`, `team · acme/app`); `issueLine(issue): string` (`user · [2].url: expected string`).
  - `view.ts`: `needsFixing(def): boolean` (any `issues` or `mergedIssues` entry); `ViewFilter.needsFixing: boolean` (in `NO_FILTER` as `false`).
  - `explainParam.ts`: `useExplainParam()` returns `{ key, fix, open(key, opts?: { fix?: string; repo?: string }), close() }`; `open` writes `explain`, `fix` and (when given) `repo` in one history entry; `close` clears `explain` and `fix`.
  - `IssueLines({ def, onFix }: { def: SettingDefWire; onFix?: (issue: WireIssue | null) => void })`: one warning line per issue, one `merged ·` line per merged issue; `onFix(null)` for a merged issue (open the modal, no layer editor).
  - `SettingRow` and `SettingsSection` gain `onFix?: (key: string, issue: WireIssue | null) => void`.
  - `ExplainModal` gains `fix?: string | null`: the layer line whose scope equals `fix` opens its editor on mount, in the form when the form can draw that layer's value, else JSON.

- [ ] **Step 1: Write the failing tests**

`view.test.ts`, append:

```ts
describe('needs fixing', () => {
  const broken = def('rt.notify.eventBridges', {
    type: 'array',
    issues: [
      {
        scope: 'user',
        file: '/home/user/settings.user.jsonc',
        kind: 'nonconforming',
        path: [2, 'url'],
        message: 'expected string, got number',
      },
    ],
  });
  const mergedOnly = def('rt.homeSnapshot', {
    type: 'object',
    mergedIssues: [{ path: ['enabled'], message: 'expected boolean, got string' }],
  });
  const fine = def('rt.logLevel', {});

  it('counts a key with any layer issue or merged issue', () => {
    expect([broken, mergedOnly, fine].filter(needsFixing).map(d => d.key)).toEqual([
      'rt.notify.eventBridges',
      'rt.homeSnapshot',
    ]);
  });

  it('the filter keeps only keys that need fixing', () => {
    expect(
      applyFilter([broken, mergedOnly, fine], { ...NO_FILTER, needsFixing: true }).map(d => d.key)
    ).toEqual(['rt.notify.eventBridges', 'rt.homeSnapshot']);
  });
});
```

Create `apps/console/src/app/settings/FixFlow.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/app-kit/lazy', () => ({
  CodeMirror: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <textarea aria-label="JSON" value={value} onChange={e => onChange?.(e.currentTarget.value)} />
  ),
}));
vi.mock('../config/useSettings', () => ({
  useAgentModels: () => ({ data: { models: [] } }),
}));

const { SettingsPage } = await import('./SettingsPage');
const { ExplainModal } = await import('./ExplainModal');
const { schemaFields } = await import('./testSchemas');

const REPO = 'gitlab.example.com/acme/app';
const USER_FILE = '/home/user/settings.user.jsonc';
const RULE = { pattern: 'gate/opened/*', category: 'gate', title: 't', message: 'm' };

function bridges(over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key: 'rt.notify.eventBridges',
    type: 'array',
    scopes: ['user'],
    merge: 'replace',
    secret: false,
    teamLocked: false,
    repoScoped: false,
    writable: true,
    description: 'Event bridge rules.',
    hasDefault: false,
    defaultValue: null,
    effective: { scope: 'user', file: USER_FILE, value: [RULE, RULE, { ...RULE, url: 3 }] },
    storeVersion: 1,
    issues: [
      {
        scope: 'user',
        file: USER_FILE,
        kind: 'nonconforming',
        path: [2, 'url'],
        message: 'expected string, got number',
      },
    ],
    ...schemaFields('rt.notify.eventBridges'),
    ...over,
  };
}

function roles(): SettingDefWire {
  return {
    ...bridges(),
    key: 'rt.roles',
    type: 'object',
    scopes: ['user', 'team', 'machine'],
    merge: 'deep',
    repoScoped: true,
    effective: { scope: null, file: null },
    issues: [
      {
        scope: 'team.repo',
        file: '/home/team/settings.team.jsonc',
        repo: REPO,
        kind: 'nonconforming',
        path: ['dev', 'fixedPort'],
        message: 'expected number, got string',
      },
    ],
    ...schemaFields('rt.roles'),
  };
}

describe('Needs fixing on the page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/settings');
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.startsWith('/api/settings/repos')
          ? { repos: [{ identity: REPO, label: 'acme/app' }] }
          : url.startsWith('/api/settings/explain/')
            ? { def: null, rows: [] }
            : { defs: [bridges(), roles()] },
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsPage />
      </QueryClientProvider>
    );

  it('counts, lists and filters the keys that need fixing', async () => {
    renderPage();
    const chip = await screen.findByRole('checkbox', { name: /^Needs fixing/ });
    expect(chip.closest('label') ?? chip.parentElement!).toHaveTextContent('Needs fixing 2');
    expect(
      screen.getByText('user · [2].url: expected string, got number')
    ).toBeInTheDocument();
    expect(
      screen.getByText('team · acme/app · dev.fixedPort: expected number, got string')
    ).toBeInTheDocument();
  });

  it('Fix opens the explain modal on that layer, switching to the issue’s repo', async () => {
    renderPage();
    const line = await screen.findByText(
      'team · acme/app · dev.fixedPort: expected number, got string'
    );
    await userEvent.click(
      within(line.closest('[data-testid="issue-line"]')!).getByRole('button', { name: 'Fix' })
    );
    await waitFor(() => {
      const p = new URLSearchParams(window.location.search);
      expect([p.get('explain'), p.get('fix'), p.get('repo')]).toEqual([
        'rt.roles',
        'team.repo',
        REPO,
      ]);
    });
  });
});

describe('Fix in the explain modal', () => {
  afterEach(() => vi.unstubAllGlobals());

  function openFix(d: SettingDefWire, rows: ExplainRowWire[]) {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ def: d, rows }),
    }));
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey={d.key}
          fix="user"
          store={{
            defs: [d],
            loading: false,
            error: null,
            set: vi.fn(async () => null),
            unset: vi.fn(async () => null),
            move: vi.fn(async () => null),
          }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
  }

  it('opens the layer in the form when the form can draw it, issues shown, Save off', async () => {
    const value = [RULE, RULE, { ...RULE, url: 3 }];
    openFix(bridges(), [
      { scope: 'default', file: null, present: false },
      {
        scope: 'user',
        file: USER_FILE,
        present: true,
        value,
        nonconforming: [{ path: [2, 'url'], message: 'expected string, got number' }],
      },
    ]);
    const layer = await screen.findByTestId('layer-user');
    expect(await within(layer).findByTestId('item-2')).toBeInTheDocument();
    expect(within(layer).getByTestId('draft-issue')).toHaveTextContent(
      '[2].url: expected string, got number'
    );
    expect(within(layer).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      within(layer).getByRole('button', { name: 'remove rt.notify.eventBridges from user' })
    ).toBeInTheDocument();
  });

  it('a value the form cannot draw opens in JSON, never in cards', async () => {
    openFix(
      bridges({ effective: { scope: 'user', file: USER_FILE, value: { pattern: 'x' } } }),
      [
        { scope: 'default', file: null, present: false },
        {
          scope: 'user',
          file: USER_FILE,
          present: true,
          value: { pattern: 'x' },
          nonconforming: [{ path: [], message: 'expected array, got object' }],
        },
      ]
    );
    const layer = await screen.findByTestId('layer-user');
    expect(await within(layer).findByRole('textbox', { name: 'JSON' })).toHaveValue(
      JSON.stringify({ pattern: 'x' }, null, 2)
    );
    expect(within(layer).queryByTestId('item-0')).toBeNull();
    expect(within(layer).getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
```

Run: `bun run console:test`
Expected: FAIL on the new tests.

- [ ] **Step 2: `issues.ts`, `view.ts`**

Append to `issues.ts`:

```ts
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { repoLabel, rungBase } from './view';

export type WireIssue = NonNullable<SettingDefWire['issues']>[number];

/** The layer an issue lives in, with its repo when it is a repo section's. */
export function issueWhere(issue: WireIssue): string {
  const base = rungBase(issue.scope) ?? issue.scope;
  return issue.repo ? `${base} · ${repoLabel(issue.repo)}` : base;
}

export function issueLine(issue: WireIssue): string {
  return `${issueWhere(issue)} · ${issueText(issue)}`;
}
```

(merge the imports into the file's import block; `view.ts` must not import from `issues.ts`, so the dependency runs one way).

`view.ts`: add `needsFixing` and the filter field:

```ts
export function needsFixing(def: SettingDefWire): boolean {
  return (def.issues?.length ?? 0) > 0 || (def.mergedIssues?.length ?? 0) > 0;
}
```

`ViewFilter` gains `needsFixing: boolean`; `NO_FILTER` gets `needsFixing: false`; `applyFilter` adds `(!f.needsFixing || needsFixing(d)) &&`.

- [ ] **Step 3: `explainParam.ts`**

```ts
import { useSearchParams } from 'wouter';

const PARAM = 'explain';
const FIX = 'fix';

/** The key whose explain modal is open on /settings, kept in `?explain=` so
    a reload or a shared link reopens it; `?fix=` names the layer whose
    editor opens with it. */
export function useExplainParam() {
  const [params, setParams] = useSearchParams();
  const write = (
    key: string | null,
    push: boolean,
    opts: { fix?: string; repo?: string } = {}
  ) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (key) next.set(PARAM, key);
        else next.delete(PARAM);
        if (key && opts.fix) next.set(FIX, opts.fix);
        else next.delete(FIX);
        if (opts.repo) next.set('repo', opts.repo);
        return next;
      },
      push ? { state: { [PARAM]: true } } : { replace: true }
    );
  return {
    key: params.get(PARAM),
    fix: params.get(FIX),
    // Opening pushes so Back closes the modal before it leaves the page;
    // closing an entry we pushed pops it, so no duplicate is left behind.
    open: (key: string, opts?: { fix?: string; repo?: string }) =>
      write(key, true, opts),
    close: () => {
      const state = window.history.state as Record<string, unknown> | null;
      if (state?.[PARAM] === true) window.history.back();
      else write(null, false);
    },
  };
}

export function explainHref(key: string): string {
  return `/settings?${PARAM}=${encodeURIComponent(key)}`;
}
```

- [ ] **Step 4: `IssueLines.tsx` and the row**

```tsx
import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { issueLine, issueText, type WireIssue } from './issues';

/** One warning line per stored value that fails its schema or type check,
    and per merged-value failure, each with Fix when the page can open it. */
export function IssueLines({
  def,
  onFix,
}: {
  def: SettingDefWire;
  onFix?: (issue: WireIssue | null) => void;
}) {
  const issues = def.issues ?? [];
  const merged = def.mergedIssues ?? [];
  if (issues.length === 0 && merged.length === 0) return null;
  const line = (key: string, label: string, fix?: () => void) => (
    <Group key={key} gap={8} wrap="nowrap" data-testid="issue-line">
      <Icons.warning size={12} color="var(--tk-text-warn-vivid)" />
      <Text
        fz={12}
        ff="monospace"
        c="var(--tk-text-warn-small)"
        style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}
      >
        {label}
      </Text>
      {fix && (
        <Button size="compact-xs" variant="default" onClick={fix}>
          Fix
        </Button>
      )}
    </Group>
  );
  return (
    <Stack gap={4} pb={12}>
      {issues.map((issue, i) =>
        line(
          `i${i}`,
          issueLine(issue),
          onFix ? () => onFix(issue) : undefined
        )
      )}
      {merged.map((issue, i) =>
        line(
          `m${i}`,
          `merged · ${issueText(issue)}`,
          onFix ? () => onFix(null) : undefined
        )
      )}
    </Stack>
  );
}
```

`SettingRow.tsx`: add the `onFix?: (key: string, issue: WireIssue | null) => void` prop; render `<IssueLines def={def} onFix={onFix && (issue => onFix(def.key, issue))} />` right after the existing error `Stack`. When `def.issues` is defined, drop the existing `stored value rejected: …` line (its `invalid` issue is now one of the issue lines); keep it when `def.issues` is undefined, which is what the existing `SettingRow.test.tsx` fixture sends. `SettingsSection.tsx`: thread `onFix` through both section kinds to every `SettingRow`.

`SettingsPage.tsx`: `const [needsFixingOnly, setNeedsFixingOnly] = useState(false);`, pass `needsFixing: needsFixingOnly` into `buildSections`' filter (and its `useMemo` deps), include it in `filtering` and reset it in `clearAll`; add a `Chip` after Editable, same styles, labelled `Needs fixing{' '}<Text span inherit ff="monospace">{store.defs.filter(needsFixing).length}</Text>`; pass `onFix={(key, issue) => explain.open(key, { fix: issue?.scope, repo: issue?.repo })}` to every `SettingsSection`, and `fix={explain.fix}` to `ExplainModal`.

- [ ] **Step 5: The modal opens the layer's editor**

`ExplainModal` gains `fix?: string | null`, threaded through `Resolved` and `ExplainBody`. In `ExplainBody`'s `rows.map`, pass `startEditing={r.scope === fix && r.present}` and `startIn={startInFor(def, r)}` to `LayerLine`, with:

```ts
function startInFor(def: SettingDefWire, row: ExplainRowWire): 'form' | 'json' {
  const form = formOf(def);
  return form && row.present && canDraw(form, row.value) ? 'form' : 'json';
}
```

In `LayerLine`, `useState(startEditing ?? false)` for `editing`, and under the existing `row.invalid` note render each `row.nonconforming` issue as a `Text fz={12} ff="monospace" c="var(--tk-text-warn-small)"` line with `issueText(issue)`. A type-invalid composite layer (`row.invalid`) opens in JSON by `startInFor` (the form cannot draw a value of the wrong type), which is the spec's "same path, in JSON".

Run: `bun run console:test`
Expected: PASS.

- [ ] **Step 6: Gates, UI validation, commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

UI validation (recipe, both schemes). Live stores may have no failing value; if Needs fixing reads 0, add a `page.route('**/api/settings/defs*', ...)` in the validation script that fetches the real response and injects one invented `nonconforming` issue into `rt.notify.eventBridges` (path `[0, 'url']`, message `expected string, got number`) and one repo issue into `rt.roles`, so the chip, the issue lines (warning glyph and text legible in both schemes), the chip filter, and Fix (modal opens on the right layer, with the repo switched for the repo issue) can be seen. Say in the report that the issues were injected. Note that with All repos picked, rt omits repo rungs, so `/defs` carries no repo-section issue until that repo is picked: a live repo-section problem shows under Needs fixing only in its repo, and the injected repo issue is what exercises Fix's repo switch.

```bash
git add apps/console/src/app/settings
git commit -m "console: Needs fixing chip, issue lines with Fix into the failing layer and repo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 12: Special rows: `rt.worktreeReadyApproval` and unregistered keys

**Needs from spec 1's wire contract:** the `/defs` body's `unregistered: { key, scope, file }[]` (what `rt settings check` reports as unregistered); `rt.worktreeReadyApproval` as a writable repo-scoped string def (a picked repo resolves its repo rung).

**Files:**
- Create: `apps/console/src/app/settings/UnregisteredNote.tsx`, `SpecialRows.test.tsx`
- Modify: `apps/console/src/app/settings/view.ts`, `SettingRow.tsx`, `RowMenu.tsx`, `SettingsPage.tsx`

**Interfaces:**
- Consumes: `ConsoleStore.unregistered` (Task 5).
- Produces:
  - `view.ts`: `APPROVAL_KEY = 'rt.worktreeReadyApproval'`; `isEditable` is false for it.
  - `UnregisteredNote({ entries }: { entries: Unregistered[] })`: renders nothing for an empty list.

- [ ] **Step 1: Write the failing tests**

Create `apps/console/src/app/settings/SpecialRows.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';
import { UnregisteredNote } from './UnregisteredNote';

const APPROVAL: SettingDefWire = {
  key: 'rt.worktreeReadyApproval',
  type: 'string',
  scopes: ['user', 'team', 'machine'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: true,
  writable: true,
  description: 'Per-repo user approval of a team-authored ready shell ladder.',
  hasDefault: false,
  defaultValue: null,
  effective: {
    scope: 'user',
    file: '/home/user/settings.user.jsonc',
    value: '3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d',
  },
  storeVersion: 1,
};

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
});

describe('rt.worktreeReadyApproval', () => {
  it('is read-only, explained, and revocable from its layer', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={APPROVAL} store={s} subhead={null} query="" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('3f2a9c1e8b7d')).toBeInTheDocument();
    expect(screen.getByTestId('approval-note')).toHaveTextContent(
      "approves the team's worktree ready commands by their hash; approve with rt worktree ready-approve"
    );
    expect(screen.queryByRole('button', { name: /actions$/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(s.unset).toHaveBeenCalledWith('rt.worktreeReadyApproval', 'user')
    );
  });

  it('has nothing to revoke when unset', () => {
    renderWithProviders(
      <SettingRow
        def={{ ...APPROVAL, effective: { scope: null, file: null } }}
        store={store()}
        subhead={null}
        query=""
      />
    );
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
});

describe('UnregisteredNote', () => {
  it('lists each unregistered key with its file and says rt ignores them', () => {
    renderWithProviders(
      <UnregisteredNote
        entries={[
          { key: 'board.claudeCommand', scope: 'machine', file: '/home/user/local/settings.local.jsonc' },
          { key: 'board.rtRepos', scope: 'machine', file: '/home/user/local/settings.local.jsonc' },
        ]}
      />
    );
    expect(
      screen.getByText('2 keys in your stores are not registered; rt ignores them.')
    ).toBeInTheDocument();
    expect(screen.getByText('board.claudeCommand')).toBeInTheDocument();
    expect(screen.getAllByText('/home/user/local/settings.local.jsonc')).toHaveLength(2);
  });

  it('renders nothing for none', () => {
    renderWithProviders(<UnregisteredNote entries={[]} />);
    expect(screen.queryByTestId('unregistered-note')).toBeNull();
  });
});
```

(The explanation drops the spec's code backticks because the row renders the two commands in monospace spans; the text is split across nested spans, so the test reads the note's whole `textContent` through its test id.)

Run: `cd apps/console && bunx vitest run src/app/settings/SpecialRows.test.tsx && cd ../..`
Expected: FAIL.

- [ ] **Step 2: Implement**

`view.ts`:

```ts
/** A hash rt writes when the user approves the team's worktree `ready`
    commands; console never edits it, only revokes it. */
export const APPROVAL_KEY = 'rt.worktreeReadyApproval';
```

and `isEditable` returns `false` when `def.key === APPROVAL_KEY`.

`SettingRow.tsx`: before the `kind === 'scalar' || kind === 'enum'` branch:

```tsx
  if (def.key === APPROVAL_KEY) {
    const hash = typeof def.effective.value === 'string' ? def.effective.value : null;
    const at = rungBase(def.effective.scope) ? def.effective.scope : null;
    control = (
      <Group gap={8} wrap="nowrap">
        {hash && (
          <Text fz={12} ff="monospace" c={text.muted}>
            {hash.slice(0, 12)}
          </Text>
        )}
        {hash && at && def.writable && (
          <Button size="compact-xs" variant="default" onClick={() => void row.clear(at)}>
            Revoke
          </Button>
        )}
      </Group>
    );
  } else if (kind === 'scalar' || kind === 'enum') {
```

and render, in place of the description line for this key only:

```tsx
<Text fz={12} lh="15px" c={text.muted} data-testid="approval-note">
  {"approves the team's worktree "}
  <Text span inherit ff="monospace">ready</Text>
  {' commands by their hash; approve with '}
  <Text span inherit ff="monospace">rt worktree ready-approve</Text>
</Text>
```

`RowMenu.tsx`: return the empty slot when `def.key === APPROVAL_KEY` (Revoke replaces Remove; nothing moves).

`UnregisteredNote.tsx`:

```tsx
import { Box, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import type { Unregistered } from './useConsoleSettings';

/** Keys found in a store that no registry def names, so no reader sees
    them. */
export function UnregisteredNote({ entries }: { entries: Unregistered[] }) {
  const { text } = useSchemeColors();
  if (entries.length === 0) return null;
  const n = entries.length;
  return (
    <Box pt={28} data-testid="unregistered-note">
      <Group gap={8} wrap="nowrap" pb={6}>
        <Icons.info size={14} color={text.muted} />
        <Text fz={12} c={text.muted}>
          {`${n} ${n === 1 ? 'key' : 'keys'} in your stores ${n === 1 ? 'is' : 'are'} not registered; rt ignores ${n === 1 ? 'it' : 'them'}.`}
        </Text>
      </Group>
      <Stack gap={2} pl={22}>
        {entries.map(e => (
          <Group key={`${e.scope}:${e.key}`} gap={12} wrap="nowrap">
            <Text fz={12} ff="monospace">
              {e.key}
            </Text>
            <Text fz={12} c={text.muted}>
              {e.scope}
            </Text>
            <Text fz={12} ff="monospace" c={text.muted} truncate>
              {e.file}
            </Text>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}
```

`SettingsPage.tsx`: render `<UnregisteredNote entries={store.unregistered} />` after the sections (inside the content `Box`, after the "groups have no match" line), only when not loading.

Run: `cd apps/console && bunx vitest run src/app/settings/SpecialRows.test.tsx && cd ../..`
Expected: PASS.

- [ ] **Step 3: Gates, UI validation, commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

UI validation (recipe, both schemes): `rt.worktreeReadyApproval` with the team repo picked (hash, explanation, Revoke; do not click Revoke on live data without the write stub in place) and the footer note at the bottom of the page (the machine store's unregistered keys the audit found, if they are still there).

```bash
git add apps/console/src/app/settings
git commit -m "console: read-only ready-approval row with Revoke, footer note for unregistered keys

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Values from older schema versions: diverged names

Spec 3 is not required: every piece below renders only when a `diverged` issue arrives, and editors already start from explain rows' `value` (spec 3's migrated value). This task pins console to the field names in "Decisions made while planning".

**Needs from spec 1's wire contract:** `issues[]` entries with an open `kind` and extra fields (`[extra: string]: unknown`). **From spec 3 (pinned above):** a `diverged` issue carries `storeName` (the older store name), `olderValue` (migrated), `currentValue`; `POST {base}/prune` `{ key, scope, repo?, storeName, force? }` answering `{ rows, effective }`.

**Files:**
- Create: `apps/console/src/app/settings/DivergedPanel.tsx`, `Diverged.test.tsx`
- Modify: `apps/console/src/app/settings/issues.ts`, `IssueLines.tsx`, `DraftEditor.tsx`, `ExplainModal.tsx`

**Interfaces:**
- Consumes: `ConsoleStore.prune` (Task 5), `JsonBlock` (Task 7), `modals.confirm` from `@mattstack/app-kit/modals`.
- Produces:
  - `issues.ts`: `interface DivergedIssue extends WireIssue { kind: 'diverged'; storeName: string; olderValue: unknown; currentValue: unknown }`; `isDiverged(issue): issue is DivergedIssue`.
  - `DraftEditor` gains `replaceWith?: { label: string; value: unknown }`: a button that replaces the draft (form and JSON text) with `value`.
  - `DivergedPanel({ def, issue, onPrune })`: both values and Remove the older name.
  - `ExplainModal`'s store type gains `prune` (`ExplainStore` picks it from `ConsoleStore`).

- [ ] **Step 1: Write the failing tests**

Create `apps/console/src/app/settings/Diverged.test.tsx`:

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/app-kit/lazy', () => ({
  CodeMirror: ({ value, onChange }: { value?: string; onChange?: (v: string) => void }) => (
    <textarea aria-label="JSON" value={value} onChange={e => onChange?.(e.currentTarget.value)} />
  ),
}));

const { SettingRow } = await import('./SettingRow');
const { ExplainModal } = await import('./ExplainModal');
const { schemaFields } = await import('./testSchemas');

const USER_FILE = '/home/user/settings.user.jsonc';
const CURRENT = { dev: { fixedPort: 3000 } };
const OLDER = { dev: { fixedPort: 3100 } };

const ROLES: SettingDefWire = {
  key: 'rt.roles',
  type: 'object',
  scopes: ['user', 'team', 'machine'],
  merge: 'deep',
  secret: false,
  teamLocked: false,
  repoScoped: true,
  writable: true,
  description: 'Roles.',
  hasDefault: false,
  defaultValue: null,
  effective: { scope: 'user', file: USER_FILE, value: CURRENT },
  storeVersion: 2,
  issues: [
    {
      scope: 'user',
      file: USER_FILE,
      kind: 'diverged',
      path: [],
      message: 'rt.roles changed after rt.roles@2 was written',
      storeName: 'rt.roles',
      olderValue: OLDER,
      currentValue: CURRENT,
    },
  ],
  ...schemaFields('rt.roles'),
};

afterEach(() => vi.unstubAllGlobals());

const store = () => ({
  set: vi.fn(async () => null as string | null),
  unset: vi.fn(async () => null as string | null),
  move: vi.fn(async () => null as string | null),
  prune: vi.fn(async () => null as string | null),
});

describe('a diverged older name', () => {
  it('the row shows both values', () => {
    renderWithProviders(<SettingRow def={ROLES} store={store()} subhead={null} query="" />);
    const line = screen.getByTestId('diverged-user');
    expect(line).toHaveTextContent('user · rt.roles differs from the current value');
    expect(within(line).getByTestId('diverged-current')).toHaveTextContent('"fixedPort": 3000');
    expect(within(line).getByTestId('diverged-older')).toHaveTextContent('"fixedPort": 3100');
  });

  it('Fix edits the current value; Use the older value swaps the draft in; Remove the older name prunes it', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: ROLES,
        rows: [
          { scope: 'default', file: null, present: false },
          { scope: 'user', file: USER_FILE, present: true, value: CURRENT },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(
      <QueryClientProvider client={new QueryClient()}>
        <ExplainModal
          settingKey="rt.roles"
          fix="user"
          store={{ defs: [ROLES], loading: false, error: null, ...s }}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );
    const layer = await screen.findByTestId('layer-user');
    await userEvent.click(within(layer).getByRole('button', { name: 'Edit as JSON' }));
    expect(within(layer).getByRole('textbox', { name: 'JSON' })).toHaveValue(
      JSON.stringify(CURRENT, null, 2)
    );
    await userEvent.click(within(layer).getByRole('button', { name: 'Use the older value' }));
    expect(within(layer).getByRole('textbox', { name: 'JSON' })).toHaveValue(
      JSON.stringify(OLDER, null, 2)
    );
    await userEvent.click(within(layer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('rt.roles', 'user', OLDER));

    await userEvent.click(screen.getByRole('button', { name: 'Remove the older name' }));
    const confirm = await screen.findByRole('dialog', { name: /Remove rt\.roles/ });
    expect(confirm).toHaveTextContent('"fixedPort": 3100');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(s.prune).toHaveBeenCalledWith('rt.roles', 'user', 'rt.roles'));
  });
});
```

(`rt.roles` recognizes as a named-sections form, so the layer editor opens in the form and the test switches to JSON to compare text. If the confirm dialog's accessible name is not its title in Mantine 9.5, find it with `screen.findByText('Remove rt.roles')` and walk up with `closest('[role="dialog"]')`.)

Run: `cd apps/console && bunx vitest run src/app/settings/Diverged.test.tsx && cd ../..`
Expected: FAIL.

- [ ] **Step 2: Implement**

`issues.ts`:

```ts
export interface DivergedIssue extends WireIssue {
  kind: 'diverged';
  storeName: string;
  olderValue: unknown;
  currentValue: unknown;
}

export function isDiverged(issue: WireIssue): issue is DivergedIssue {
  return issue.kind === 'diverged' && typeof issue.storeName === 'string';
}
```

`IssueLines.tsx`: for an issue where `isDiverged(issue)`, render instead of the plain line:

```tsx
<Stack key={`d${i}`} gap={6} data-testid={`diverged-${issue.scope}`}>
  {line(
    `d${i}`,
    `${issueWhere(issue)} · ${issue.storeName} differs from the current value`,
    onFix ? () => onFix(issue) : undefined
  )}
  <Group gap={12} align="flex-start" wrap="nowrap" pl={20}>
    <Stack gap={2} style={{ flex: 1, minWidth: 0 }} data-testid="diverged-current">
      <Text fz={12} c={text.muted}>current</Text>
      <JsonBlock value={issue.currentValue} maxHeight={160} />
    </Stack>
    <Stack gap={2} style={{ flex: 1, minWidth: 0 }} data-testid="diverged-older">
      <Text fz={12} c={text.muted}>{`older (${issue.storeName})`}</Text>
      <JsonBlock value={issue.olderValue} maxHeight={160} />
    </Stack>
  </Group>
</Stack>
```

(`text` from `useSchemeColors()`; the plain-line `data-testid="issue-line"` stays on the first `Group` from `line`.)

`DraftEditor.tsx`: add the `replaceWith` prop and, in the toggle row (render that row when `form || replaceWith`):

```tsx
{replaceWith && (
  <Button
    size="compact-xs"
    variant="subtle"
    onClick={() => {
      setDraft(structuredClone(replaceWith.value));
      setText(pretty(replaceWith.value));
    }}
  >
    {replaceWith.label}
  </Button>
)}
```

`DivergedPanel.tsx`:

```tsx
import { Button, Group, Stack, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { modals } from '@mattstack/app-kit/modals';

import { issueWhere, type DivergedIssue } from './issues';
import { JsonBlock } from './JsonBlock';

/** An older store name that changed after the current one was written.
    Removing it goes through settings-kit's prune, forced, since a diverged
    name is refused otherwise; until then the issue stays listed. */
export function DivergedPanel({
  issue,
  onPrune,
}: {
  issue: DivergedIssue;
  onPrune: () => void;
}) {
  const { text } = useSchemeColors();
  return (
    <Stack gap={6} py={10} style={{ borderBottom: '1px solid var(--tk-border-soft)' }}>
      <Group justify="space-between" wrap="nowrap">
        <Text fz={12} c="var(--tk-text-warn-small)">
          {`${issueWhere(issue)} · the older name ${issue.storeName} still holds a different value`}
        </Text>
        <Button
          size="compact-xs"
          variant="default"
          onClick={() =>
            modals.confirm({
              title: `Remove ${issue.storeName}`,
              destructive: true,
              labels: { confirm: 'Remove' },
              message: (
                <Stack gap={8}>
                  <Text fz={14}>
                    {`Deletes ${issue.storeName} and its baseline from the ${issueWhere(issue)} store. The current value stays. This older value goes:`}
                  </Text>
                  <JsonBlock value={issue.olderValue} maxHeight={200} />
                </Stack>
              ),
              onConfirm: onPrune,
            })
          }
        >
          Remove the older name
        </Button>
      </Group>
      <Text fz={12} c={text.muted}>
        Fix a layer above to keep either value; Save always writes the current name.
      </Text>
    </Stack>
  );
}
```

`ExplainModal.tsx`: `ExplainStore` becomes `Pick<ConsoleStore, 'defs' | 'loading' | 'error' | 'set' | 'unset' | 'move' | 'prune'>` (the `OwnStore` path passes the full `ConsoleStore`, which has it; pages that build a store literal add `prune`). In `ExplainBody`, `const diverged = (def.issues ?? []).filter(isDiverged);`; pass `replaceWith` to each `LayerLine` whose scope has a diverged issue (`{ label: 'Use the older value', value: issue.olderValue }`, matched on `issue.scope === r.scope` and, for a rung, `issue.repo === repo`), which forwards it to its `DraftEditor`; and after the layers render a `DivergedPanel` per diverged issue with a `pruneError` line in the error style and:

```tsx
onPrune={() => {
  const base = rungBase(issue.scope)!;
  // No repo argument at all for a global layer, as useRowSave does.
  const op = issue.repo
    ? store.prune(def.key, base, issue.storeName, issue.repo)
    : store.prune(def.key, base, issue.storeName);
  void op.then(err => (err ? setPruneError(err) : refresh()));
}}
```

`ExplainBody`'s `store` prop is typed `RowStore` today; widen it to `RowStore & Pick<ConsoleStore, 'prune'>` (and `Resolved` passes the `ExplainStore`, which now has `prune`).

Any other test file that builds an `ExplainStore` literal (for example `ExplainModal.test.tsx`'s `store()`) adds `prune: vi.fn(async () => null as string | null)`.

Run: `cd apps/console && bunx vitest run src/app/settings/Diverged.test.tsx && cd ../..`, then `bun run console:test`
Expected: PASS.

- [ ] **Step 3: Gates, UI validation, commit**

Run each, bare: `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `sh scripts/repo-purity.sh`, `bun run format:check`

UI validation (recipe, both schemes): no live store has a diverged name, so inject one in the validation script with `page.route('**/api/settings/defs*', ...)` (add the `rt.roles` diverged issue from the test, values invented) and `page.route('**/api/settings/explain/rt.roles*', ...)` if needed. Check the row's two value blocks side by side (no overflow at 1024px), Fix opening the user layer with Use the older value, and the confirm dialog showing the older value (click Cancel; the write stub covers a stray Remove). Say that the issue was injected.

```bash
git add apps/console/src/app/settings
git commit -m "console: diverged older store names show both values, can be kept or pruned

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Acceptance walk against live data

No new code unless a check fails; a failing check becomes a fix in the file that owns it, with a test, in this task.

**Needs from spec 1's wire contract:** everything above, live: the running console on this branch against Matt's real stores.

**Files:** any file a failed check points at.

- [ ] **Step 1: Full gates**

Run each, bare: `bun run tui-kit:build`, `bun run console:typecheck`, `bun run console:lint`, `bun run console:test`, `bun run board:typecheck`, `bun run board:test`, `bun run boxscore:typecheck`, `bun run boxscore:lint`, `bun run boxscore:test`, `bun run deck:test`, `bun run chat:test`, `bunx vitest run packages/ui/src/lazy`, `bun run treeshake`, `bun run lint`, `sh scripts/repo-purity.sh`, `bun run format:check`
Expected: every command exits 0.

- [ ] **Step 2: Walk the spec's acceptance list in the browser**

Follow the UI validation recipe, both schemes, and check each, recording a screenshot per line:

1. With the team repo that carries the per-repo values picked, `rt.roles`, `rt.intercepts`, `rt.ignoredMrs`, `rt.sync`, `rt.branchNaming`, `rt.variations`, `rt.presets`, `rt.dopplerTemplate` and `rt.worktrees` show the team store's repo values with a `team · repo` badge; with All repos, each says `all repos · set in 1 repo` (or the real count, if more repos set it; note it).
2. `rt.notify.eventBridges` reads in full in its explain modal, edits as item cards and as JSON; an item without `pattern` leaves Save disabled.
3. `deck.apps` edits as named sections.
4. `rt.intercepts` (a key the forms cannot draw) edits as JSON with inline schema errors.
5. A nonconforming stored value appears under Needs fixing and can be fixed from the modal (inject one with `page.route` if the live stores have none, and say so).
6. Today's shaped keys look unchanged: compare `board.ticketPrefixes`, `rt.repoIdentityOverrides`, `board.slack`, `rt.homeSnapshot` with the live page at `http://localhost:11001/settings` side by side.

Then the bridge check from Global Constraints.

- [ ] **Step 3: Commit any fixes**

If Step 2 needed a fix, commit it with its test:

```bash
git add <the fixed files>
git commit -m "console: <what the acceptance walk found>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

If nothing needed fixing, there is nothing to commit; record the walk's screenshots and verdicts in the task report.
