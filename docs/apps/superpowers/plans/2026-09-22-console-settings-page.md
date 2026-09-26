# Console Settings Page Implementation Plan (Plan B of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Board consumes the shared shapes from `@mattstack/settings-kit` 0.2.0, and console gets one organized, filterable `/settings` page for all 102 registered keys, with settings removed from Cmd+K.

**Architecture:** settings-kit (published by Plan A) owns shapes, the write gate and the data hooks. Board swaps its private copies for imports. Console mounts `settingsHandler` behind its three typed routes, reads everything through `useSettingsScope('')`, and renders it with pure view helpers (`groups.ts`, `units.ts`, `view.ts`) feeding small Mantine components.

**Tech Stack:** React 19, Mantine 9.5 through `@mattstack/app-kit`, wouter 3.10, TanStack Query, Hono, Vitest (console), `bun test` (board).

**Spec:** `docs/superpowers/specs/2026-09-22-console-settings-page-design.md`. Mockups: `~/Documents/console settings.pen` (six artboards).

## Global Constraints

- Starts only after Plan A: `npm view @mattstack/settings-kit version` prints `0.2.0`.
- Work in this worktree (`console-settings-page` branch). Every commit ends with exactly: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Task gate (run from the repo root, all must pass before the commit). The plan's code blocks are not prettier-formatted, so run `bun run format` first, then:
  `bun run tui-kit:build && bun run board:typecheck && bun run board:test && bun run boxscore:typecheck && bun run boxscore:lint && bun run boxscore:test && bun run console:typecheck && bun run console:lint && bun run console:test && bun run format:check && sh scripts/repo-purity.sh`
- Colour and type follow `docs/ui-authoring.md`: role tokens only (`--tk-*`, `useSchemeColors`, Mantine `color="<hue>"`), no raw hex, weights 400/500/700 only, muted text via `useSchemeColors().text.muted`, 12px hue text on `--tk-text-<hue>-small`. No scheme branching.
- Scope colours: team `purple`, user `cyan`, machine `accent`. `default`/`unset` are muted text, never a badge.
- Public repo: invented data only in fixtures (no employer, customer or teammate names). `scripts/repo-purity.sh` enforces part of this.
- No em dashes or en dashes in new text. Comments state constraints the code cannot show.
- Mantine: check a prop in `node_modules/@mantine/core/lib/components/<Name>/<Name>.d.ts` before using one you have not used in this session.
- Any UI task is done only after Task 8's Fast Browser pass in both schemes.

## Review Focus

1. A key set in two layers (user and machine) shows the machine value and a machine badge; editing it writes machine, not user. Task 5 (`targetScope` path) and Task 7.
2. A deep-merged leaves key: editing one field writes that field onto the target layer's own authored object, never the merged value with defaults baked in. Task 6 (`leafWrite`).
3. A filter that matches nothing: empty state with Clear, index shows zeros, no crash. Task 7.
4. A stored composite value of the wrong shape: the row locks behind Clear and never renders an editor that would write garbage. Task 6.
5. A write through a public Host (tunnel): 403 from console's server. Task 3.

---

### Task 1: Catalog settings-kit 0.2.0; board onto the shared shapes

**Files:**
- Modify: `package.json` (root catalog)
- Modify: `apps/board/package.json`, `apps/boxscore/package.json`
- Modify: `apps/board/src/client/board/config-shapes.ts`
- Modify: `apps/board/src/server.ts:999-1002`
- Test: `apps/board/src/client/__tests__/config-shapes.test.ts` (append one test)

**Interfaces:**
- Consumes: `@mattstack/settings-kit/shapes` (`SHAPES`, `matchesShape`, `addToList`, `filterDefs`, `formatValue`, `getLeaf`, `isSet`, `parseScalar`, `setLeaf`, `LeafType`, `CompositeShape`, `DEFAULT_SLACK_EMOJI`).
- Produces: `config-shapes.ts` keeps every export it has today with the same names and types, so `ConfigModal.tsx` and the existing test file compile unchanged.

- [ ] **Step 1: Catalog and install**

Root `package.json`, inside `workspaces.catalog`: add `"@mattstack/settings-kit": "0.2.0",`. In `apps/board/package.json` and `apps/boxscore/package.json` change `"@mattstack/settings-kit": "^0.1.3"` to `"@mattstack/settings-kit": "catalog:"`. Run `bun install` at the repo root (the root `bun.lock` is the only lockfile).

- [ ] **Step 2: Write the failing parity test**

Append to `apps/board/src/client/__tests__/config-shapes.test.ts`:

```ts
import { DEFAULT_SLACK_EMOJI as KIT_SLACK_EMOJI } from '@mattstack/settings-kit/shapes';
import { DEFAULT_SLACK_EMOJI } from '../../slack-emoji.ts';

describe('shared shapes', () => {
  test("settings-kit's slack emoji fallbacks match the board's", () => {
    expect(DEFAULT_SLACK_EMOJI).toEqual(KIT_SLACK_EMOJI);
  });
});
```

(Move the two imports to the top of the file with the others.)

Run: `bun run board:test`
Expected: PASS already if Step 1 installed 0.2.0 (this pins parity going forward). Continue.

- [ ] **Step 3: Rewrite `config-shapes.ts` onto the kit**

Replace the file's top half (imports through `matchesShape`, plus `getLeaf`, `setLeaf`, `parseScalar`, `addToList`, `filterDefs`, `isSet`, `formatValue`) so the file reads:

```ts
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  matchesShape as matchesKitShape,
  SHAPES,
  type CompositeShape as KitShape,
} from '@mattstack/settings-kit/shapes';

export {
  addToList,
  filterDefs,
  formatValue,
  getLeaf,
  isSet,
  parseScalar,
  setLeaf,
  type LeafType,
} from '@mattstack/settings-kit/shapes';

export type ConfigDef = SettingDefWire;

export type CompositeShape =
  | Exclude<KitShape, { kind: 'external' }>
  | { kind: 'roster' }
  | { kind: 'tabs' };

/** settings-kit marks these `external`; the board owns their editors. */
const BOARD_EDITORS: Record<string, CompositeShape> = {
  'board.tabs': { kind: 'tabs' },
  'board.members': { kind: 'roster' },
  'board.hiddenMembers': { kind: 'roster' },
};

/** The board's composite keys: settings-kit's declarations, with the three
    keys whose editors live here mapped back to their board kinds. rt
    validates only the top-level type, so these shapes are what keep a
    written value readable by `parseConfig`. */
export const COMPOSITE_SHAPES: Record<string, CompositeShape> =
  Object.fromEntries(
    Object.entries(SHAPES)
      .filter(([key]) => key.startsWith('board.'))
      .map(([key, shape]) => [
        key,
        BOARD_EDITORS[key] ?? (shape as CompositeShape),
      ])
  );
```

Keep, unchanged below it: `RowKind`, `rowKind`, `scopeLabel`, `isRecord`, `isTabLike`, `slugTabId`, `groupByScope`, `rosterSummary`. Replace the old `matchesShape` with:

```ts
export function matchesShape(shape: CompositeShape, value: unknown): boolean {
  if (shape.kind === 'roster') return Array.isArray(value);
  if (shape.kind === 'tabs')
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(isTabLike) &&
      new Set(value.map(t => (t as { id: string }).id)).size === value.length
    );
  return matchesKitShape(shape, value);
}
```

Delete the now-unused `DEFAULT_SLACK_EMOJI` import and the local `matchesLeaf`.

- [ ] **Step 4: Board's write gate**

In `apps/board/src/server.ts`, the `settingsHandler(req, { ... })` call: change `allowComposite: true,` to `allowComposite: 'shaped',`. Board's roster and tabs editors save through `/roster` and `/tabs`, not `/api/settings/set`, so `'shaped'` refusing `external` keys does not affect them.

- [ ] **Step 5: Gate**

Run the Global Constraints task gate. Expected: all green, and the existing `config-shapes.test.ts` passes unchanged.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock apps/board apps/boxscore/package.json
git commit -m "board: shapes from settings-kit 0.2.0, shaped composite writes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Console client data off Hono RPC; settings out of Cmd+K

This lands before the server swap (Task 3) so nothing ever calls a route that no longer exists. The old routes answer the same paths with the same JSON shapes.

**Files:**
- Modify: `apps/console/package.json` (add dependency)
- Modify: `apps/console/src/app/config/useSettings.ts`
- Modify: `apps/console/src/app/settings/AgentDefaultsPage.tsx` (`useCurrentValue` only)
- Modify: `apps/console/src/app/config/chain.ts:1`, `apps/console/src/app/config/LayerRow.tsx:20`, `apps/console/src/app/config/chain.test.ts`, `apps/console/src/app/config/LayerRow.test.tsx` (type imports)
- Delete: `apps/console/src/app/settings/AgentDefaultsPage.test.tsx` (it mocks the RPC client; the page itself is retired in Task 7 and its replacement is tested there)
- Modify: `apps/console/src/app/palette/ConsolePalette.tsx`
- Test: `apps/console/src/app/config/ExplainKeyPage.test.tsx`, `apps/console/src/app/palette/ConsolePalette.test.tsx`

**Interfaces:**
- Produces: `useExplainKey(key)` and `useSetSetting(key)` with unchanged return shapes; `type ExplainPayload = { def: SettingDefWire; rows: ExplainRowWire[] }` exported from `useSettings.ts`. `SettingDefWire`/`ExplainRowWire` now come from `@mattstack/settings-kit/react`.

- [ ] **Step 1: Dependency**

In `apps/console/package.json` dependencies add `"@mattstack/settings-kit": "catalog:",` (alphabetical, after `@mattstack/rt-client`). Run `bun install` at the repo root.

- [ ] **Step 2: Point the explain test at `fetch`**

In `ExplainKeyPage.test.tsx` replace the whole `vi.mock('../api', ...)` block with:

```ts
vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  if (url.startsWith('/api/settings/explain/')) return explainGet(url);
  if (url === '/api/settings/set') return setPost(url, init);
  // LayerRow's useEditorHref reads /api/settings/default-editor; it must not
  // reach setPost, whose call counts the tests assert.
  return Promise.resolve({
    ok: false,
    status: 404,
    json: async () => ({ error: 'not found' }),
  });
});
```

Run: `bun run console:test -- src/app/config/ExplainKeyPage.test.tsx`
Expected: FAIL (the page still calls the RPC client, so no data arrives).

- [ ] **Step 3: Rewrite the data hooks**

`useSettings.ts` becomes:

```ts
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';

import type { AgentModelOption } from '../../server/agent-models';
import { client } from '../api';

export type ExplainPayload = { def: SettingDefWire; rows: ExplainRowWire[] };

async function readJson<T>(res: Response, what: string): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok || body === null)
    throw new Error(body?.error ?? `${what} failed: ${res.status}`);
  return body;
}

export function useSettingsDefs() {
  return useQuery({
    queryKey: ['settings', 'defs'],
    queryFn: async () =>
      readJson<{ defs: SettingDefWire[] }>(
        await fetch('/api/settings/defs'),
        'settings defs'
      ),
    staleTime: Infinity,
  });
}

export function useSettingsPrefix(prefix: string) {
  return useQuery({
    queryKey: ['settings', 'defs', prefix],
    queryFn: async () =>
      readJson<{ defs: SettingDefWire[] }>(
        await fetch(`/api/settings/defs?prefix=${encodeURIComponent(prefix)}`),
        'settings defs'
      ),
    staleTime: Infinity,
  });
}

export function useAgentModels(provider: 'claude' | 'codex') {
  return useQuery({
    queryKey: ['agent', 'models', provider],
    queryFn: async () => {
      const res = await client.api.agent.models.$get({ query: { provider } });
      if (!res.ok) throw new Error(`agent models failed: ${res.status}`);
      return (await res.json()) as { models: AgentModelOption[] };
    },
    // The catalog changes rarely; avoid a live codex spawn on every focus.
    staleTime: 5 * 60 * 1000,
  });
}

export function useExplainKey(key: string) {
  return useSuspenseQuery({
    queryKey: ['settings', 'explain', key],
    queryFn: async () =>
      readJson<ExplainPayload>(
        await fetch(`/api/settings/explain/${encodeURIComponent(key)}`),
        'explain'
      ),
  });
}

export function useSetSetting(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      value: unknown;
      scope: 'user' | 'team' | 'machine';
    }) =>
      readJson<{ rows: ExplainRowWire[] }>(
        await fetch('/api/settings/set', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key, ...input }),
        }),
        'set'
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'explain', key],
      });
    },
  });
}
```

In `AgentDefaultsPage.tsx`, replace `useCurrentValue`'s `queryFn` body with:

```ts
    queryFn: async (): Promise<ExplainPayload> => {
      const res = await fetch(
        `/api/settings/explain/${encodeURIComponent(key)}`
      );
      // The only non-200 is 404 (unknown key): treated as unset so a key the
      // registry doesn't know yet degrades this field, not the whole page.
      if (!res.ok) return null;
      return res.json();
    },
```

drop its `client` import, and change its type import line to `import type { ExplainRowWire, SettingDefWire } from '@mattstack/settings-kit/react';`. Make the same type-import change in `chain.ts`, `LayerRow.tsx`, `chain.test.ts` and `LayerRow.test.tsx` (all four import these types from `'../../server/settings'` today, and Task 3 deletes them there). Delete `apps/console/src/app/settings/AgentDefaultsPage.test.tsx`: it mocks `client.api.settings.*`, so all seven of its tests fail once the page reads through `fetch`, and the page itself is retired in Task 7.

- [ ] **Step 4: Fixture types**

Run: `bun run console:typecheck`. The kit's `SettingDefWire` has a required `effective` field. For every test fixture typed as `SettingDefWire` that now fails (expect `chain.test.ts` and `LayerRow.test.tsx` among them), add `effective: { scope: null, file: null },`. Change nothing else in those fixtures. Then `rg -n "server/settings'" apps/console/src/app` must print nothing.

- [ ] **Step 5: Remove settings from the palette**

In `ConsolePalette.tsx` delete the `useSettingsDefs` import and call, and the `configActions` block; the memo becomes:

```ts
  const actions: SpotlightActionData[] = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    return [...runs.map(runAction), ...STATIC_ACTIONS];
  }, [runsQuery.data]);
```

Remove `Icons.settings` from the imports if unused. Update the `mod+K` doc comment in `apps/console/AGENTS.md` ("indexing runs, config keys, and the two static nav actions") to "indexing runs and the two static nav actions".

In `ConsolePalette.test.tsx`: delete the `useSettingsDefs` mock and the test "adds a config action per setting def ...". Add the test below. Its `act(() => Spotlight.open())` line stands for "open the palette": replace it with exactly what the file's first test does to open it, if that differs.

```ts
  it('offers no settings keys: typing "config" finds nothing', async () => {
    runsGet.mockResolvedValue(ok({ runs: [] }));
    renderPalette();
    act(() => Spotlight.open());
    await userEvent.type(
      await screen.findByPlaceholderText('Search runs, or jump to a page…'),
      'config'
    );
    expect(
      await screen.findByText('No matching runs or actions.')
    ).toBeInTheDocument();
  });
```

(import `act` from `@testing-library/react` if the file does not already.)

- [ ] **Step 6: Gate and commit**

Run the task gate. Expected: green.

```bash
git add apps/console bun.lock
git commit -m "console: settings data over plain fetch, settings out of Cmd+K

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Console server onto settings-kit

**Files:**
- Modify: `apps/console/src/server/settings.ts` (rewrite)
- Modify: `apps/console/src/server/settings.test.ts` (trim)
- Create: `apps/console/src/server/settings-kit-mount.test.ts`

**Interfaces:**
- Produces: `createSettingsRoutes(kit?: SettingsHandlerOptions): Hono` and `settings = createSettingsRoutes()` (still what `routes.ts` mounts).

- [ ] **Step 1: Write the failing mount test**

`settings-kit-mount.test.ts`:

```ts
// @vitest-environment node
import type { RtSettingsApi } from '@mattstack/settings-kit/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { createSettingsRoutes } from './settings';

const DEFS: Record<string, Record<string, unknown>> = {
  'rt.logLevel': { key: 'rt.logLevel', type: 'string', scopes: ['machine', 'user'], merge: 'replace', description: 'Daemon log level.', default: 'info' },
  'rt.repoRoots': { key: 'rt.repoRoots', type: 'array', scopes: ['machine'], merge: 'replace', description: 'Scan roots.' },
  'rt.cron': { key: 'rt.cron', type: 'object', scopes: ['machine'], merge: 'deep', description: 'Scheduled jobs.' },
};

const writes: unknown[][] = [];

const RT = {
  allDefs: () => Object.values(DEFS),
  getDef: (key: string) => DEFS[key],
  isMigrated: () => true,
  explainSetting: () => [{ scope: 'default', file: null, present: true, value: 'info' }],
  validateValue: () => ({ ok: true }),
  setSetting: (...args: unknown[]) => {
    writes.push(args);
  },
  unsetSetting: () => true,
} as unknown as RtSettingsApi;

const app = createSettingsRoutes({ rt: RT });

function post(host: string, body: unknown, type = 'application/json') {
  return new Request(`http://${host}/api/settings/set`, {
    method: 'POST',
    headers: { 'content-type': type },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  writes.length = 0;
});

describe('settings-kit behind console', () => {
  it('serves the registry with shaped composites writable', async () => {
    const res = await app.fetch(new Request('http://localhost/api/settings/defs'));
    expect(res.status).toBe(200);
    const { defs } = (await res.json()) as { defs: { key: string; writable: boolean }[] };
    expect(defs.map(d => d.key)).toEqual(['rt.logLevel', 'rt.repoRoots', 'rt.cron']);
    expect(defs.find(d => d.key === 'rt.repoRoots')?.writable).toBe(true);
    expect(defs.find(d => d.key === 'rt.cron')?.writable).toBe(false);
  });

  it('writes from a local host', async () => {
    const res = await app.fetch(post('localhost', { key: 'rt.logLevel', scope: 'machine', value: 'debug' }));
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
  });

  it('refuses a write that arrives through a public host', async () => {
    const res = await app.fetch(post('console.example.dev', { key: 'rt.logLevel', scope: 'machine', value: 'debug' }));
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(0);
  });

  it('refuses a non-JSON write', async () => {
    const res = await app.fetch(post('localhost', { key: 'rt.logLevel', scope: 'machine', value: 'debug' }, 'text/plain'));
    expect(res.status).toBe(415);
  });

  it('refuses a composite with no shape', async () => {
    const res = await app.fetch(post('localhost', { key: 'rt.cron', scope: 'machine', value: {} }));
    expect(res.status).toBe(400);
  });

  it('404s an unknown settings path instead of falling through silently', async () => {
    const res = await app.fetch(new Request('http://localhost/api/settings/nope'));
    expect(res.status).toBe(404);
  });
});
```

Run: `bun run console:test -- src/server/settings-kit-mount.test.ts`
Expected: FAIL, `createSettingsRoutes` is not exported.

- [ ] **Step 2: Rewrite `settings.ts`**

Keep the three existing handlers' bodies and doc comments exactly as they are today (`runs-prune-days`, `default-editor`, `linear-workspace`), and replace everything else:

```ts
import { getSetting } from '@mattstack/rt-client';
import {
  settingsHandler,
  type SettingsHandlerOptions,
} from '@mattstack/settings-kit/server';
import { Hono } from 'hono';

/**
 * Console's three typed reads, then settings-kit for defs/explain/set/unset.
 * The typed routes must be registered first: Hono matches in order, and the
 * catch-all would otherwise answer them with a 404.
 */
export function createSettingsRoutes(kit: SettingsHandlerOptions = {}) {
  return (
    new Hono()
      .get('/api/settings/runs-prune-days', c => {
        /* unchanged body */
      })
      .get('/api/settings/default-editor', c => {
        /* unchanged body */
      })
      .get('/api/settings/linear-workspace', c => {
        /* unchanged body */
      })
      .all('/api/settings/*', async c => {
        const res = await settingsHandler(c.req.raw, {
          allowComposite: 'shaped',
          ...kit,
        });
        return res ?? c.json({ error: 'not found' }, 404);
      })
  );
}

export const settings = createSettingsRoutes();
```

(`/* unchanged body */` means paste the current handler body verbatim; do not leave the comment.) Delete `SettingDefWire`, `ExplainRowWire`, `defToWire`, `sanitizeRows`, `isComposite`, `isWritable`, `COMPOSITE_COPY` and the `validator` import. Nothing in `src/app` imports them any more after Task 2 (Task 2 Step 4's `rg` proves it).

- [ ] **Step 3: Trim the old server test**

In `settings.test.ts` delete every `it` from "lists defs with writability computed, not copied" to the end of the file, and the `DEFS`/`EXPLAIN` fixtures, their now-unused `import type { ExplainRow, SettingDef }` line, and the `post()` helper, which nothing left uses (an unused `post` fails typecheck with TS6133). Keep the five read-route tests. In the `vi.mock('@mattstack/rt-client', ...)` factory keep `getSetting` and add `unsetSetting: vi.fn(),` so a mocked module never lacks a name settings-kit imports.

- [ ] **Step 4: Gate and commit**

Run the task gate, then `bun run console:build`. Expected: both succeed.

```bash
git add apps/console/src/server
git commit -m "console: settings-kit serves the settings API, local-only writes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Pure view helpers: groups, units, sections

**Files:**
- Create: `apps/console/src/app/settings/groups.ts`, `units.ts`, `view.ts`
- Test: `apps/console/src/app/settings/groups.test.ts`, `units.test.ts`, `view.test.ts`

**Interfaces:**
- Produces:
  - `groups.ts`: `type Tier = 'rt' | 'apps' | 'suite'`; `interface Group { id: string; label: string; tier: Tier; blurb: string; match: (key: string) => boolean }`; `GROUPS: Group[]`; `TIER_LABEL: Record<Tier, string>`; `groupOf(key: string): Group`.
  - `units.ts`: `unitOf(keyOrField: string): string | null`.
  - `view.ts`: `type StoreScope = 'team' | 'user' | 'machine'`; `type ScopeFilter = 'any' | StoreScope`; `interface ViewFilter { query: string; changedOnly: boolean; editableOnly: boolean; scope: ScopeFilter }`; `NO_FILTER`; `SUBHEAD_THRESHOLD = 12`; `interface Subsection { scope: StoreScope | null; defs: SettingDefWire[] }`; `interface Section { group: Group; total: number; shown: number; subsections: Subsection[] }`; `isStoreScope`, `isEditable(def)`, `applyFilter(defs, f)`, `buildSections(all, f): Section[]`, `badgeScope(def, subhead): StoreScope | null`, `sourceText(def): 'default' | 'unset' | null`, `firstSentence(text)`, `fieldSource(rows, path): StoreScope | 'default' | null`, `leafWrite(rows, target, path, value): Record<string, unknown>`, `splitKey(key): [ns: string, name: string]`.

- [ ] **Step 1: Write the failing tests**

`groups.test.ts` (console's `no-restricted-imports` rule allows only type imports from rt-client under `src/app`; this test needs the live registry and never ships in the bundle, hence the disable):

```ts
// eslint-disable-next-line no-restricted-imports -- test-only: reads the live registry under vitest; never bundled
import { allDefs } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { GROUPS, groupOf } from './groups';

describe('GROUPS', () => {
  it('puts every registered key in exactly one group', () => {
    for (const def of allDefs()) {
      const hits = GROUPS.filter(g => g.match(def.key)).map(g => g.id);
      expect(hits, def.key).toHaveLength(1);
    }
  });

  it('leaves no group empty', () => {
    const keys = allDefs().map(d => d.key);
    for (const g of GROUPS) expect(keys.some(g.match), g.id).toBe(true);
  });

  it('files an unknown key under its first segment instead of dropping it', () => {
    expect(groupOf('zeta.newKey')).toMatchObject({ id: 'zeta', label: 'zeta', tier: 'apps' });
  });
});
```

`units.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { unitOf } from './units';

describe('unitOf', () => {
  it('reads the unit off the key or field name', () => {
    expect(unitOf('rt.runsPruneDays')).toBe('days');
    expect(unitOf('rt.gates.escalationTtlMinutes')).toBe('min');
    expect(unitOf('herd.watchdog.fastMins')).toBe('min');
    expect(unitOf('janitorIntervalMin')).toBe('min');
    expect(unitOf('debounceSec')).toBe('sec');
    expect(unitOf('janitorThresholdHours')).toBe('hours');
    expect(unitOf('rt.apiPort')).toBeNull();
  });
});
```

`view.test.ts`:

```ts
import type { ExplainRowWire, SettingDefWire } from '@mattstack/settings-kit/react';
import { describe, expect, it } from 'vitest';

import {
  applyFilter, badgeScope, buildSections, fieldSource, firstSentence,
  leafWrite, NO_FILTER, sourceText, splitKey,
} from './view';

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key, type: 'string', scopes: ['user'], merge: 'replace', secret: false,
    teamLocked: false, repoScoped: false, writable: true, description: `${key} does a thing. More detail.`,
    hasDefault: false, defaultValue: null, effective: { scope: null, file: null }, ...over,
  };
}

const row = (scope: string, value?: unknown, extra: Partial<ExplainRowWire> = {}): ExplainRowWire =>
  ({ scope, file: null, present: value !== undefined, ...(value !== undefined ? { value } : {}), ...extra }) as ExplainRowWire;

describe('applyFilter', () => {
  const defs = [
    def('rt.logLevel', { effective: { scope: 'default', file: null, value: 'info' } }),
    def('rt.runsPruneDays', { type: 'number', effective: { scope: 'machine', file: '/m', value: 7 } }),
    def('rt.cron', { type: 'object', writable: false }),
  ];
  it('filters on key and description', () => {
    expect(applyFilter(defs, { ...NO_FILTER, query: 'prune' }).map(d => d.key)).toEqual(['rt.runsPruneDays']);
  });
  it('changed keeps only store-set keys', () => {
    expect(applyFilter(defs, { ...NO_FILTER, changedOnly: true }).map(d => d.key)).toEqual(['rt.runsPruneDays']);
  });
  it('editable drops read-only rows', () => {
    expect(applyFilter(defs, { ...NO_FILTER, editableOnly: true }).map(d => d.key)).toEqual(['rt.logLevel', 'rt.runsPruneDays']);
  });
  it('scope keeps keys whose winning layer is that scope', () => {
    expect(applyFilter(defs, { ...NO_FILTER, scope: 'machine' }).map(d => d.key)).toEqual(['rt.runsPruneDays']);
  });
});

describe('buildSections', () => {
  it('orders sections by GROUPS and counts total and shown', () => {
    const s = buildSections([def('board.title'), def('agent.provider'), def('rt.logLevel')], { ...NO_FILTER, query: 'title' });
    expect(s.map(x => x.group.id)).toEqual(['agents', 'daemon', 'board']);
    expect(s.map(x => [x.total, x.shown])).toEqual([[1, 0], [1, 0], [1, 1]]);
  });

  it('splits a section over the threshold into team, user, machine subsections', () => {
    const boards = [
      ...Array.from({ length: 6 }, (_, i) => def(`board.t${i}`, { scopes: ['team'] })),
      ...Array.from({ length: 5 }, (_, i) => def(`board.u${i}`, { scopes: ['user', 'machine'] })),
      ...Array.from({ length: 2 }, (_, i) => def(`board.m${i}`, { scopes: ['machine'] })),
    ];
    const [board] = buildSections(boards, NO_FILTER);
    expect(board!.subsections.map(x => [x.scope, x.defs.length])).toEqual([['team', 6], ['user', 5], ['machine', 2]]);
  });

  it('keeps a small section as one unlabelled subsection', () => {
    const [agents] = buildSections([def('agent.provider')], NO_FILTER);
    expect(agents!.subsections).toEqual([{ scope: null, defs: [expect.objectContaining({ key: 'agent.provider' })] }]);
  });
});

describe('row labels', () => {
  it('badgeScope shows a store layer unless it repeats the subhead', () => {
    const m = def('k', { effective: { scope: 'machine', file: '/m' } });
    expect(badgeScope(m, null)).toBe('machine');
    expect(badgeScope(m, 'user')).toBe('machine');
    expect(badgeScope(m, 'machine')).toBeNull();
    expect(badgeScope(def('k', { effective: { scope: 'default', file: null } }), null)).toBeNull();
  });

  it('sourceText names default and unset only', () => {
    expect(sourceText(def('k', { effective: { scope: 'default', file: null } }))).toBe('default');
    expect(sourceText(def('k'))).toBe('unset');
    expect(sourceText(def('k', { effective: { scope: 'user', file: '/u' } }))).toBeNull();
  });

  it('firstSentence stops at the first sentence end, not at e.g.', () => {
    expect(firstSentence('Ticket prefixes (e.g. RT, MAT) that scope the tab. Also links.')).toBe('Ticket prefixes (e.g. RT, MAT) that scope the tab.');
    expect(firstSentence('No full stop here')).toBe('No full stop here');
  });

  it('splitKey separates the namespace from the last segment', () => {
    expect(splitKey('agent.claude.model')).toEqual(['agent.claude.', 'model']);
    expect(splitKey('solo')).toEqual(['', 'solo']);
  });
});

describe('leaf provenance and writes', () => {
  const rows = [
    row('default', { enabled: true, debounceSec: 20 }),
    row('team'),
    row('user', { debounceSec: 30 }),
    row('machine', { enabled: false }),
  ];

  it('fieldSource is the strongest layer that sets the field', () => {
    expect(fieldSource(rows, 'enabled')).toBe('machine');
    expect(fieldSource(rows, 'debounceSec')).toBe('user');
    expect(fieldSource([row('default', { a: 1 })], 'a')).toBe('default');
    expect(fieldSource(rows, 'missing')).toBeNull();
  });

  it('leafWrite edits the target layer’s own object, never the merge', () => {
    expect(leafWrite(rows, 'machine', 'debounceSec', 45)).toEqual({ enabled: false, debounceSec: 45 });
    expect(leafWrite(rows, 'team', 'enabled', true)).toEqual({ enabled: true });
  });
});
```

Run: `bun run console:test -- src/app/settings`
Expected: FAIL, modules not found.

- [ ] **Step 2: Implement `groups.ts`**

```ts
export type Tier = 'rt' | 'apps' | 'suite';

export interface Group {
  id: string;
  label: string;
  tier: Tier;
  blurb: string;
  match: (key: string) => boolean;
}

export const TIER_LABEL: Record<Tier, string> = {
  rt: 'rt',
  apps: 'Apps',
  suite: 'Suite',
};

const prefix = (p: string) => (key: string) => key.startsWith(p);
const pattern = (re: RegExp) => (key: string) => re.test(key);

/** Order is display order. `match` sets must stay disjoint;
    groups.test.ts checks every registered key lands in exactly one. */
export const GROUPS: Group[] = [
  { id: 'agents', label: 'Agents', tier: 'rt', blurb: 'Defaults for every rt agent start that does not pass its own flag.', match: prefix('agent.') },
  { id: 'worktrees', label: 'Worktrees & repos', tier: 'rt', blurb: 'Where rt finds repos, how worktrees are pooled, and branch sync.', match: key => /^rt\.(worktree|repo|branchNaming$|sync$|hooks$|roles$|intercepts$|dopplerTemplate$|gitStatus$)/.test(key) || key === 'mattstack.tracking' },
  { id: 'daemon', label: 'Daemon', tier: 'rt', blurb: "The rt daemon's own ports, logs, janitors and snapshot loops. Most need a daemon restart.", match: pattern(/^rt\.(log|runsPruneDays$|apiPort$|daemonPath$|runaway$|homeSnapshot$|teamSnapshot$|trustedBrowserOrigins$|workspacePrefs$|sdmEnrichment$)/) },
  { id: 'herd', label: 'Herd & panes', tier: 'rt', blurb: 'When the herd watchdog pokes workers and escalates to you.', match: pattern(/^(herd|panes)\./) },
  { id: 'notifications', label: 'Notifications & gates', tier: 'rt', blurb: 'Which events raise a desktop notification, and when open gates escalate.', match: pattern(/^rt\.(notifications$|notify\.|gates\.)/) },
  { id: 'commands', label: 'Commands', tier: 'rt', blurb: 'Saved presets, variations and scheduled jobs for rt commands.', match: pattern(/^rt\.(variations|presets|cron)$/) },
  { id: 'board', label: 'Board', tier: 'apps', blurb: 'The MR board.', match: prefix('board.') },
  { id: 'boxscore', label: 'Boxscore', tier: 'apps', blurb: 'MR scoring and the leaderboard.', match: prefix('boxscore.') },
  { id: 'chat', label: 'Chat', tier: 'apps', blurb: 'rt chat handles, the viewer, and push alerts.', match: prefix('chat.') },
  { id: 'deck', label: 'Deck', tier: 'apps', blurb: 'Published apps, access, and the public domain.', match: prefix('deck.') },
  { id: 'gitq', label: 'gitq', tier: 'apps', blurb: 'Work slots, forges, and the checkout board.', match: prefix('gitq.') },
  { id: 'suite', label: 'Suite-wide', tier: 'suite', blurb: 'Team integrations, the roster, install mode, and Claude Code plugins.', match: key => (/^(mattstack|setup|claude)\./.test(key) && key !== 'mattstack.tracking') || key === 'rt.integrations' },
];

export function groupOf(key: string): Group {
  const hit = GROUPS.find(g => g.match(key));
  if (hit) return hit;
  const segment = key.split('.')[0] ?? key;
  return { id: segment, label: segment, tier: 'apps', blurb: '', match: prefix(`${segment}.`) };
}
```

`mattstack.tracking` belongs to `worktrees`, which is why `suite.match` excludes it. The exactly-one test catches any other overlap.

- [ ] **Step 3: Implement `units.ts`**

```ts
const SUFFIXES: [RegExp, string][] = [
  [/Days$/, 'days'],
  [/(Minutes|Mins|Min)$/, 'min'],
  [/Sec$/, 'sec'],
  [/Hours$/, 'hours'],
];

export function unitOf(keyOrField: string): string | null {
  const last = keyOrField.split('.').at(-1) ?? keyOrField;
  for (const [re, unit] of SUFFIXES) if (re.test(last)) return unit;
  return null;
}
```

- [ ] **Step 4: Implement `view.ts`**

```ts
import type {
  ExplainRowWire,
  SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  filterDefs,
  getLeaf,
  isSet,
  rowKind,
  setLeaf,
} from '@mattstack/settings-kit/shapes';

import { GROUPS, groupOf, type Group } from './groups';

export type StoreScope = 'team' | 'user' | 'machine';
export type ScopeFilter = 'any' | StoreScope;

export interface ViewFilter {
  query: string;
  changedOnly: boolean;
  editableOnly: boolean;
  scope: ScopeFilter;
}

export const NO_FILTER: ViewFilter = {
  query: '',
  changedOnly: false,
  editableOnly: false,
  scope: 'any',
};

export const SUBHEAD_THRESHOLD = 12;
const SUB_ORDER: StoreScope[] = ['team', 'user', 'machine'];

export interface Subsection {
  scope: StoreScope | null;
  defs: SettingDefWire[];
}

export interface Section {
  group: Group;
  total: number;
  shown: number;
  subsections: Subsection[];
}

export function isStoreScope(s: string | null | undefined): s is StoreScope {
  return s === 'team' || s === 'user' || s === 'machine';
}

export function isEditable(def: SettingDefWire): boolean {
  const kind = rowKind(def);
  return kind !== 'readonly' && kind !== 'external';
}

export function applyFilter(
  defs: SettingDefWire[],
  f: ViewFilter
): SettingDefWire[] {
  return filterDefs(defs, f.query).filter(
    d =>
      (!f.changedOnly || isSet(d)) &&
      (!f.editableOnly || isEditable(d)) &&
      (f.scope === 'any' || d.effective.scope === f.scope)
  );
}

/** Every group with at least one registered key, in GROUPS order, with
    unknown first segments after them. Empty-after-filter sections are kept
    so the index can show zeros. */
export function buildSections(
  all: SettingDefWire[],
  f: ViewFilter
): Section[] {
  const shownKeys = new Set(applyFilter(all, f).map(d => d.key));
  const byGroup = new Map<string, { group: Group; defs: SettingDefWire[] }>();
  for (const d of all) {
    const group = groupOf(d.key);
    const entry = byGroup.get(group.id) ?? { group, defs: [] };
    entry.defs.push(d);
    byGroup.set(group.id, entry);
  }
  const known = GROUPS.map(g => g.id);
  const extra = [...byGroup.keys()].filter(id => !known.includes(id)).sort();
  return [...known, ...extra]
    .filter(id => byGroup.has(id))
    .map(id => {
      const { group, defs } = byGroup.get(id)!;
      const shown = defs.filter(d => shownKeys.has(d.key));
      const subsections =
        defs.length > SUBHEAD_THRESHOLD
          ? SUB_ORDER.map(scope => ({
              scope,
              defs: shown.filter(d => d.scopes[0] === scope),
            })).filter(s => s.defs.length > 0)
          : [{ scope: null, defs: shown }];
      return { group, total: defs.length, shown: shown.length, subsections };
    });
}

export function badgeScope(
  def: SettingDefWire,
  subhead: StoreScope | null
): StoreScope | null {
  const scope = def.effective.scope;
  return isStoreScope(scope) && scope !== subhead ? scope : null;
}

export function sourceText(def: SettingDefWire): 'default' | 'unset' | null {
  if (def.effective.scope === 'default') return 'default';
  if (def.effective.scope === null) return 'unset';
  return null;
}

export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const m = /^(.*?(?<!\be\.g|\bi\.e)[.!?])(?=\s|$)/s.exec(trimmed);
  return m ? m[1]! : trimmed;
}

export function splitKey(key: string): [ns: string, name: string] {
  const i = key.lastIndexOf('.');
  return i < 0 ? ['', key] : [key.slice(0, i + 1), key.slice(i + 1)];
}

/** Rows arrive weakest-first, so the last one that sets the field wins. */
export function fieldSource(
  rows: ExplainRowWire[],
  path: string
): StoreScope | 'default' | null {
  for (const r of [...rows].reverse()) {
    if (!r.present || r.shadowed || r.invalid) continue;
    if (getLeaf(r.value, path) === undefined) continue;
    if (r.scope === 'default' || isStoreScope(r.scope)) return r.scope;
  }
  return null;
}

/** The object to write to `target` after changing one field: the target
    layer's own authored value with that field set, so defaults and other
    layers are never copied into it. */
export function leafWrite(
  rows: ExplainRowWire[],
  target: string,
  path: string,
  value: unknown
): Record<string, unknown> {
  const own = rows.find(r => r.scope === target && r.present)?.value;
  return setLeaf(own, path, value);
}
```

- [ ] **Step 5: Run the tests, gate, commit**

Run: `bun run console:test -- src/app/settings` then the task gate. Expected: green.

```bash
git add apps/console/src/app/settings/groups.ts apps/console/src/app/settings/units.ts apps/console/src/app/settings/view.ts apps/console/src/app/settings/*.test.ts
git commit -m "console: settings groups, units and section view helpers

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Row atoms: save hook, scope badge, scalar control, SettingRow

**Files:**
- Create: `apps/console/src/app/settings/useRowSave.ts`, `ScopeBadge.tsx`, `ScalarControl.tsx`, `SettingRow.tsx`
- Test: `apps/console/src/app/settings/SettingRow.test.tsx`

**Interfaces:**
- Consumes: Task 4's `view.ts`, `units.ts`; kit `rowKind`, `summarize`, `targetScope`, `SHAPES`, `ENUMS`, `SettingsScopeState`.
- Produces:
  - `type RowStore = Pick<SettingsScopeState, 'set' | 'unset' | 'move'>`
  - `useRowSave(store: RowStore, def): { status: 'idle' | 'saving' | 'saved'; error: string | null; save(value: unknown): Promise<boolean>; clear(scope: string): Promise<boolean>; move(from: string, to: string): Promise<boolean> }`
  - `SCOPE_COLOR`, `ScopeDot({scope})`, `ScopeBadge({scope, moveTo, onMove})`
  - `ScalarControl({def, onSave, suggestions?})`
  - `SettingRow({def, store, subhead, query, suggestions?})` and `ExpandToggle({label, open, onToggle})`. Task 6 fills the composite branches through `CompositeBody`/`CompositeSummary` hooks declared here as a switch.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key, type: 'string', scopes: ['user', 'machine'], merge: 'replace', secret: false,
    teamLocked: false, repoScoped: false, writable: true,
    description: 'What it does. A second sentence nobody needs here.',
    hasDefault: false, defaultValue: null, effective: { scope: null, file: null }, ...over,
  };
}

function store() {
  return {
    set: vi.fn(async () => null as string | null),
    unset: vi.fn(async () => null as string | null),
    move: vi.fn(async () => null as string | null),
  };
}

describe('SettingRow', () => {
  it('shows the key, the first sentence, the source, and an explain link', () => {
    renderWithProviders(<SettingRow def={def('agent.claude.effort', { effective: { scope: 'default', file: null, value: 'high' } })} store={store()} subhead={null} query="" />);
    expect(screen.getByText('agent.claude.')).toBeInTheDocument();
    expect(screen.getByText('effort')).toBeInTheDocument();
    expect(screen.getByText('What it does.')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'explain agent.claude.effort' })).toHaveAttribute('href', '/config/agent.claude.effort');
  });

  it('saves a string on blur to the winning layer', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={def('agent.claude.effort', { effective: { scope: 'machine', file: '/m', value: 'high' } })} store={s} subhead={null} query="" />);
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    await userEvent.type(input, 'low');
    input.blur();
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('agent.claude.effort', 'machine', 'low'));
    expect(await screen.findByText('saved')).toBeInTheDocument();
  });

  it('clearing a string unsets it instead of writing an empty string', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={def('agent.claude.effort', { effective: { scope: 'user', file: '/u', value: 'high' } })} store={s} subhead={null} query="" />);
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.clear(input);
    input.blur();
    await waitFor(() => expect(s.unset).toHaveBeenCalledWith('agent.claude.effort', 'user'));
  });

  it("shows rt's refusal verbatim under the row", async () => {
    const s = store();
    s.set.mockResolvedValue('rt: nope');
    renderWithProviders(<SettingRow def={def('agent.claude.effort')} store={s} subhead={null} query="" />);
    const input = screen.getByLabelText('agent.claude.effort');
    await userEvent.type(input, 'x');
    input.blur();
    expect(await screen.findByText('rt: nope')).toBeInTheDocument();
  });

  it('toggles a boolean immediately', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={def('agent.claude.yolo', { type: 'boolean' })} store={s} subhead={null} query="" />);
    await userEvent.click(screen.getByLabelText('agent.claude.yolo'));
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('agent.claude.yolo', 'user', true));
  });

  it('offers the ENUMS options as a select', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={def('rt.logLevel', { scopes: ['machine', 'user'], effective: { scope: 'default', file: null, value: 'info' } })} store={s} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('combobox', { name: 'rt.logLevel' }));
    await userEvent.click(await screen.findByRole('option', { name: 'debug' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('rt.logLevel', 'machine', 'debug'));
  });

  it('hides the badge under a matching subhead and moves a value from the badge menu', async () => {
    const s = store();
    const d = def('board.agent.model', { effective: { scope: 'machine', file: '/m', value: 'x' } });
    const { unmount } = renderWithProviders(<SettingRow def={d} store={s} subhead="machine" query="" />);
    expect(screen.queryByText('machine')).toBeNull();
    unmount();
    renderWithProviders(<SettingRow def={d} store={s} subhead="user" query="" />);
    await userEvent.click(screen.getByRole('button', { name: 'machine: move to another scope' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'user' }));
    await waitFor(() => expect(s.move).toHaveBeenCalledWith('board.agent.model', 'machine', 'user'));
  });

  it('an external row summarises and names its owner', () => {
    renderWithProviders(<SettingRow def={def('board.members', { type: 'array', scopes: ['team'], writable: false, effective: { scope: 'team', file: '/t', value: [{}, {}, {}] } })} store={store()} subhead={null} query="" />);
    expect(screen.getByText('3 members · edited in board')).toBeInTheDocument();
  });
});
```

Run: `bun run console:test -- src/app/settings/SettingRow.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 2: `useRowSave.ts`**

```ts
import { useEffect, useRef, useState } from 'react';
import type {
  SettingDefWire,
  SettingsScopeState,
} from '@mattstack/settings-kit/react';
import { targetScope } from '@mattstack/settings-kit/shapes';

export type RowStore = Pick<SettingsScopeState, 'set' | 'unset' | 'move'>;
export type SaveStatus = 'idle' | 'saving' | 'saved';

const SAVED_FLASH_MS = 1400;

/** Save-on-commit, no staging: `undefined` means "clear this layer". */
export function useRowSave(store: RowStore, def: SettingDefWire) {
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

  const scope = targetScope(def);
  return {
    status,
    error,
    save: (value: unknown) =>
      run(() =>
        value === undefined
          ? store.unset(def.key, scope)
          : store.set(def.key, scope, value)
      ),
    clear: (at: string) => run(() => store.unset(def.key, at)),
    move: (from: string, to: string) =>
      run(() => store.move(def.key, from, to)),
  };
}
```

- [ ] **Step 3: `ScopeBadge.tsx`**

```tsx
import { Badge, Box, Menu, UnstyledButton } from '@mattstack/app-kit/core';

import type { StoreScope } from './view';

export const SCOPE_COLOR: Record<StoreScope, string> = {
  team: 'purple',
  user: 'cyan',
  machine: 'accent',
};

export function ScopeDot({ scope }: { scope: StoreScope }) {
  return (
    <Box
      component="span"
      w={6}
      h={6}
      style={{
        display: 'inline-block',
        borderRadius: '50%',
        flex: 'none',
        background: `var(--mantine-color-${SCOPE_COLOR[scope]}-filled)`,
      }}
    />
  );
}

export function ScopeBadge({
  scope,
  moveTo,
  onMove,
}: {
  scope: StoreScope;
  moveTo: StoreScope[];
  onMove: (to: StoreScope) => void;
}) {
  const badge = (
    <Badge
      size="sm"
      variant="light"
      color={SCOPE_COLOR[scope]}
      tt="none"
      leftSection={<ScopeDot scope={scope} />}
    >
      {scope}
    </Badge>
  );
  if (moveTo.length === 0) return badge;
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <UnstyledButton aria-label={`${scope}: move to another scope`}>
          {badge}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Move value to</Menu.Label>
        {moveTo.map(to => (
          <Menu.Item
            key={to}
            leftSection={<ScopeDot scope={to} />}
            onClick={() => onMove(to)}
          >
            {to}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
```

- [ ] **Step 4: `ScalarControl.tsx`**

```tsx
import type { KeyboardEvent } from 'react';
import {
  Autocomplete,
  Group,
  NumberInput,
  Select,
  Switch,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { ENUMS } from '@mattstack/settings-kit/shapes';

import { unitOf } from './units';

function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.currentTarget.blur();
}

/** Uncontrolled on purpose: a refused save leaves the typed text in place
    so the user can fix it. Callers key the row on `def.key`. */
export function ScalarControl({
  def,
  onSave,
  suggestions,
}: {
  def: SettingDefWire;
  onSave: (value: unknown) => void;
  suggestions?: string[];
}) {
  const { text } = useSchemeColors();
  const value = def.effective.value;
  const label = def.key;

  if (def.type === 'boolean')
    return (
      <Switch
        aria-label={label}
        checked={value === true}
        onChange={e => onSave(e.currentTarget.checked)}
      />
    );

  const options = ENUMS[def.key];
  if (options)
    return (
      <Select
        aria-label={label}
        w={200}
        data={[...options]}
        value={typeof value === 'string' ? value : null}
        allowDeselect={false}
        onChange={v => {
          if (v !== null && v !== value) onSave(v);
        }}
      />
    );

  if (def.type === 'number') {
    const unit = unitOf(def.key);
    return (
      <Group gap={8} wrap="nowrap">
        <NumberInput
          aria-label={label}
          w={90}
          hideControls
          defaultValue={typeof value === 'number' ? value : undefined}
          onKeyDown={blurOnEnter}
          onBlur={e => {
            const raw = e.currentTarget.value.trim();
            if (raw === '') {
              if (value !== undefined) onSave(undefined);
              return;
            }
            const n = Number(raw);
            if (Number.isFinite(n) && n !== value) onSave(n);
          }}
        />
        {unit && (
          <Text size="xs" c={text.muted}>
            {unit}
          </Text>
        )}
      </Group>
    );
  }

  const current = typeof value === 'string' ? value : '';
  const commit = (next: string) => {
    if (next !== current) onSave(next === '' ? undefined : next);
  };
  if (suggestions)
    return (
      <Autocomplete
        aria-label={label}
        w={200}
        data={suggestions}
        defaultValue={current}
        onKeyDown={blurOnEnter}
        onBlur={e => commit(e.currentTarget.value)}
      />
    );
  return (
    <TextInput
      aria-label={label}
      w={200}
      defaultValue={current}
      onKeyDown={e => {
        if (e.key === 'Escape') e.currentTarget.value = current;
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
      onBlur={e => commit(e.currentTarget.value)}
    />
  );
}
```

- [ ] **Step 5: `SettingRow.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Collapse,
  Group,
  Highlight,
  Stack,
  Text,
  UnstyledButton,
  type TextProps,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  formatValue,
  rowKind,
  SHAPES,
  summarize,
} from '@mattstack/settings-kit/shapes';
import { Link } from 'wouter';

import { ScalarControl } from './ScalarControl';
import { ScopeBadge } from './ScopeBadge';
import { useRowSave, type RowStore } from './useRowSave';
import {
  badgeScope,
  firstSentence,
  sourceText,
  splitKey,
  type StoreScope,
} from './view';

function Marked({ text, query, ...props }: { text: string; query: string } & Omit<TextProps, 'color'>) {
  return query.trim() === '' ? (
    <Text {...props}>{text}</Text>
  ) : (
    <Highlight {...props} highlight={query.trim()} color="warn">
      {text}
    </Highlight>
  );
}

export function ExpandToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { text } = useSchemeColors();
  return (
    <UnstyledButton onClick={onToggle} aria-expanded={open}>
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c={text.muted}>
          {label}
        </Text>
        {open ? <Icons.chevronUp size={14} /> : <Icons.chevronDown size={14} />}
      </Group>
    </UnstyledButton>
  );
}

export function SettingRow({
  def,
  store,
  subhead,
  query,
  suggestions,
}: {
  def: SettingDefWire;
  store: RowStore;
  subhead: StoreScope | null;
  query: string;
  suggestions?: string[];
}) {
  const { text } = useSchemeColors();
  const row = useRowSave(store, def);
  const [open, setOpen] = useState(false);
  const kind = rowKind(def);
  const [ns, name] = splitKey(def.key);
  const badge = badgeScope(def, subhead);
  const plain = sourceText(def);
  const moveTo =
    def.writable && badge
      ? (def.scopes as StoreScope[]).filter(s => s !== badge)
      : [];

  let control: ReactNode;
  let body: ReactNode = null;
  if (kind === 'scalar' || kind === 'enum') {
    control = (
      <ScalarControl def={def} onSave={v => void row.save(v)} suggestions={suggestions} />
    );
  } else if (kind === 'external') {
    const shape = SHAPES[def.key];
    control = (
      <Text size="xs" c={text.muted}>
        {summarize(def)} · edited in {shape?.kind === 'external' ? shape.app : 'another app'}
      </Text>
    );
  } else if (kind === 'readonly' && def.type !== 'object' && def.type !== 'array') {
    control = (
      <Text size="xs" c={text.muted} ff="monospace">
        {def.secret ? '•••' : def.effective.value === undefined ? 'unset' : formatValue(def.effective.value)}
      </Text>
    );
  } else {
    const composite = compositeParts(def, kind, row, open, () => setOpen(o => !o));
    control = composite.control;
    body = composite.body;
  }

  return (
    <Box data-key={def.key} style={{ borderBottom: '1px solid var(--tk-border-soft)' }}>
      <Group gap={24} wrap="nowrap" py={12}>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={8} wrap="nowrap">
            <Text size="sm" ff="monospace" span>
              <Text span inherit c={text.muted}>{ns}</Text>
              <Marked text={name} query={query} span inherit fw={500} />
            </Text>
            {badge ? (
              <ScopeBadge scope={badge} moveTo={moveTo} onMove={to => void row.move(badge, to)} />
            ) : plain ? (
              <Text size="xs" c={text.muted}>{plain}</Text>
            ) : null}
          </Group>
          <Marked text={firstSentence(def.description)} query={query} size="xs" c={text.muted} />
        </Stack>
        <Group w={260} gap={8} wrap="nowrap" style={{ flex: 'none' }}>
          {control}
          {row.status === 'saving' && <Text size="xs" c={text.muted}>saving…</Text>}
          {row.status === 'saved' && (
            <Group gap={4} wrap="nowrap">
              <Text size="xs" c="var(--tk-text-ok-small)">saved</Text>
              <Icons.check size={12} color="var(--tk-text-ok-small)" />
            </Group>
          )}
        </Group>
        <ActionIcon
          component={Link}
          href={`/config/${encodeURIComponent(def.key)}`}
          variant="subtle"
          color="gray"
          aria-label={`explain ${def.key}`}
        >
          <Icons.chevronRight size={16} />
        </ActionIcon>
      </Group>
      {row.error && (
        <Text size="xs" ff="monospace" c="var(--tk-text-bad-small)" pb={12}>
          {row.error}
        </Text>
      )}
      {body && <Collapse expanded={open}>{body}</Collapse>}
    </Box>
  );
}

/** Composite rows: the control column holds a summary toggle, the body
    expands under the row. Task 6 replaces this with the real editors. */
function compositeParts(
  def: SettingDefWire,
  _kind: string,
  _row: ReturnType<typeof useRowSave>,
  open: boolean,
  onToggle: () => void
): { control: ReactNode; body: ReactNode } {
  return {
    control: <ExpandToggle label={summarize(def)} open={open} onToggle={onToggle} />,
    body: null,
  };
}
```

Mantine 9.5's `Collapse` takes `expanded`, not `in`. `Marked` types its props as `Omit<TextProps, 'color'>` because `Parameters<typeof Text>[0]` resolves to `never` on Mantine's polymorphic `Text`. If `Highlight` rejects the `span`/`inherit` props, render the key name as `<Text span inherit fw={500}>` inside a `Highlight` wrapper component instead; the test only checks the rendered text.

- [ ] **Step 6: Run the test, gate, commit**

Run: `bun run console:test -- src/app/settings/SettingRow.test.tsx`, then the task gate. Expected: green.

```bash
git add apps/console/src/app/settings
git commit -m "console: settings row, scope badge and scalar controls

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Composite editors

**Files:**
- Create: `apps/console/src/app/settings/CompositeControls.tsx`
- Modify: `apps/console/src/app/settings/SettingRow.tsx` (replace `compositeParts`)
- Test: `apps/console/src/app/settings/CompositeControls.test.tsx`

**Interfaces:**
- Consumes: `useSettingKey` from `@mattstack/settings-kit/react` (per-field provenance), `fieldSource`, `leafWrite`, `addToList`, `matchesShape`, `targetScope`.
- Produces: `compositeParts(def, kind, row, open, onToggle)` exported from `CompositeControls.tsx` with the signature Task 5 declared; SettingRow imports it and deletes its placeholder.

- [ ] **Step 1: Write the failing tests**

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingRow } from './SettingRow';

function def(key: string, over: Partial<SettingDefWire>): SettingDefWire {
  return {
    key, type: 'array', scopes: ['machine'], merge: 'replace', secret: false, teamLocked: false,
    repoScoped: false, writable: true, description: 'A composite.', hasDefault: false, defaultValue: null,
    effective: { scope: null, file: null }, ...over,
  };
}
const store = () => ({ set: vi.fn(async () => null), unset: vi.fn(async () => null), move: vi.fn(async () => null) });

afterEach(() => vi.unstubAllGlobals());

describe('composite rows', () => {
  it('a short string list edits inline as tags', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={def('board.ticketPrefixes', { scopes: ['team'], effective: { scope: 'team', file: '/t', value: ['RT'] } })} store={s} subhead={null} query="" />);
    await userEvent.type(screen.getByRole('combobox', { name: 'board.ticketPrefixes' }), 'MAT{enter}');
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('board.ticketPrefixes', 'team', ['RT', 'MAT']));
  });

  it('a long string list expands to rows with remove and add', async () => {
    const s = store();
    const value = ['~/a', '~/b', '~/c', '~/d'];
    renderWithProviders(<SettingRow def={def('rt.repoRoots', { effective: { scope: 'machine', file: '/m', value } })} store={s} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('button', { name: /4 roots/ }));
    await userEvent.click(screen.getByRole('button', { name: 'remove ~/b' }));
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('rt.repoRoots', 'machine', ['~/a', '~/c', '~/d']));
    await userEvent.type(screen.getByLabelText('add to rt.repoRoots'), '~/e{enter}');
    await waitFor(() => expect(s.set).toHaveBeenLastCalledWith('rt.repoRoots', 'machine', ['~/a', '~/b', '~/c', '~/d', '~/e']));
  });

  it('a string map edits a value in place', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={def('rt.repoIdentityOverrides', { type: 'object', effective: { scope: 'machine', file: '/m', value: { 'https://example.dev/a.git': 'a' } } })} store={s} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('button', { name: /1 entry/ }));
    const identity = screen.getByLabelText('identity for https://example.dev/a.git');
    await userEvent.clear(identity);
    await userEvent.type(identity, 'apps');
    identity.blur();
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('rt.repoIdentityOverrides', 'machine', { 'https://example.dev/a.git': 'apps' }));
  });

  it('a leaves field writes onto the target layer’s own object and shows its source', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        def: {},
        rows: [
          { scope: 'default', file: null, present: true, value: { enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 } },
          { scope: 'machine', file: '/m', present: true, value: { enabled: false } },
        ],
      }),
    }));
    const s = store();
    renderWithProviders(<SettingRow def={def('rt.homeSnapshot', { type: 'object', merge: 'deep', effective: { scope: 'machine', file: '/m', value: { enabled: false, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 } } })} store={s} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('button', { name: /5 of 5 set/ }));
    expect(await screen.findByText('debounceSec')).toBeInTheDocument();
    const debounce = screen.getByLabelText('rt.homeSnapshot.debounceSec');
    await waitFor(() => expect(debounce).toBeEnabled());
    await userEvent.clear(debounce);
    await userEvent.type(debounce, '45');
    debounce.blur();
    await waitFor(() => expect(s.set).toHaveBeenCalledWith('rt.homeSnapshot', 'machine', { enabled: false, debounceSec: 45 }));
  });

  it('leaf fields stay disabled until the layer rows arrive', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    renderWithProviders(<SettingRow def={def('rt.homeSnapshot', { type: 'object', merge: 'deep', effective: { scope: 'machine', file: '/m', value: { enabled: false } } })} store={store()} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('button', { name: /1 of 5 set/ }));
    expect(await screen.findByLabelText('rt.homeSnapshot.debounceSec')).toBeDisabled();
    expect(screen.getByLabelText('rt.homeSnapshot.enabled')).toBeDisabled();
  });

  it('a stored value of the wrong shape locks behind Clear', async () => {
    const s = store();
    renderWithProviders(<SettingRow def={def('rt.repoRoots', { effective: { scope: 'machine', file: '/m', value: [1, 2] } })} store={s} subhead={null} query="" />);
    expect(screen.getByText('unexpected shape')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(s.unset).toHaveBeenCalledWith('rt.repoRoots', 'machine'));
  });

  it('an unshaped composite is read-only with a preview and its file', async () => {
    renderWithProviders(<SettingRow def={def('rt.cron', { type: 'object', writable: false, effective: { scope: 'machine', file: '/stores/local.jsonc', value: { triggers: [] } } })} store={store()} subhead={null} query="" />);
    await userEvent.click(screen.getByRole('button', { name: /1 field/ }));
    expect(screen.getByText('/stores/local.jsonc')).toBeInTheDocument();
    expect(screen.getByText(/"triggers"/)).toBeInTheDocument();
  });
});
```

Run: `bun run console:test -- src/app/settings/CompositeControls.test.tsx`
Expected: FAIL (bodies are placeholders).

- [ ] **Step 2: Implement `CompositeControls.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Code,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import {
  useSettingKey,
  type SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  addToList,
  getLeaf,
  matchesShape,
  SHAPES,
  summarize,
  targetScope,
  type LeafType,
} from '@mattstack/settings-kit/shapes';

import { ExpandToggle } from './SettingRow';
import { ScopeBadge } from './ScopeBadge';
import type { useRowSave } from './useRowSave';
import { unitOf } from './units';
import { fieldSource, isStoreScope, leafWrite } from './view';

type Row = ReturnType<typeof useRowSave>;
const INLINE_MAX_ITEMS = 3;
const INLINE_MAX_CHARS = 16;
const LEAVES_FIRST = 5;

function Body({ children }: { children: ReactNode }) {
  return (
    <Box pl={16} pr={52} pb={14}>
      <Stack gap={0} pl={16} style={{ borderLeft: '1px solid var(--tk-line-2)' }}>
        {children}
      </Stack>
    </Box>
  );
}

function FieldRow({ label, source, children }: { label: ReactNode; source?: ReactNode; children: ReactNode }) {
  return (
    <Group gap={24} wrap="nowrap" mih={38}>
      <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        {label}
        {source}
      </Group>
      <Group w={260} gap={8} wrap="nowrap" style={{ flex: 'none' }}>
        {children}
      </Group>
    </Group>
  );
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function StringListBody({ def, row }: { def: SettingDefWire; row: Row }) {
  const list = strings(def.effective.value);
  const [draft, setDraft] = useState('');
  return (
    <Body>
      {list.map(item => (
        <FieldRow key={item} label={<Text size="xs" ff="monospace">{item}</Text>}>
          <UnstyledButton aria-label={`remove ${item}`} onClick={() => void row.save(list.filter(x => x !== item))}>
            <Icons.close size={14} />
          </UnstyledButton>
        </FieldRow>
      ))}
      <Box py={6}>
        <TextInput
          aria-label={`add to ${def.key}`}
          size="xs"
          maw={360}
          ff="monospace"
          placeholder="add an item"
          value={draft}
          onTextChange={setDraft}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            const next = addToList(list, draft);
            if (next) void row.save(next).then(ok => ok && setDraft(''));
          }}
        />
      </Box>
    </Body>
  );
}

function StringMapBody({ def, row, labels }: { def: SettingDefWire; row: Row; labels: readonly [string, string] }) {
  const map = (def.effective.value ?? {}) as Record<string, string>;
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <Body>
      {Object.entries(map).map(([key, value]) => (
        <FieldRow key={key} label={<Text size="xs" ff="monospace" truncate>{key}</Text>}>
          <TextInput
            aria-label={`${labels[1]} for ${key}`}
            size="xs"
            w={200}
            defaultValue={value}
            onBlur={e => {
              const next = e.currentTarget.value.trim();
              if (next && next !== value) void row.save({ ...map, [key]: next });
            }}
          />
          <UnstyledButton aria-label={`remove ${key}`} onClick={() => void row.save(Object.fromEntries(Object.entries(map).filter(([k]) => k !== key)))}>
            <Icons.close size={14} />
          </UnstyledButton>
        </FieldRow>
      ))}
      <Group gap={8} py={6} wrap="nowrap">
        <TextInput aria-label={`new ${labels[0]}`} size="xs" style={{ flex: 1 }} placeholder={labels[0]} value={k} onTextChange={setK} />
        <TextInput aria-label={`new ${labels[1]}`} size="xs" w={200} placeholder={labels[1]} value={v} onTextChange={setV} />
        <UnstyledButton
          aria-label={`add ${labels[0]}`}
          onClick={() => {
            if (!k.trim() || !v.trim()) return;
            void row.save({ ...map, [k.trim()]: v.trim() }).then(ok => ok && (setK(''), setV('')));
          }}
        >
          <Icons.plus size={14} />
        </UnstyledButton>
      </Group>
    </Body>
  );
}

function LeafInput({ label, type, value, placeholder, disabled, onSave }: { label: string; type: LeafType; value: unknown; placeholder?: string; disabled: boolean; onSave: (v: unknown) => void }) {
  const { text } = useSchemeColors();
  if (type === 'boolean')
    return <Switch aria-label={label} disabled={disabled} checked={value === true} onChange={e => onSave(e.currentTarget.checked)} />;
  if (typeof type === 'object')
    return <Select aria-label={label} disabled={disabled} size="xs" w={160} data={[...type.enum]} value={typeof value === 'string' ? value : null} onChange={v => v !== null && onSave(v)} />;
  if (type === 'number') {
    const unit = unitOf(label);
    return (
      <Group gap={8} wrap="nowrap">
        <NumberInput
          aria-label={label}
          disabled={disabled}
          size="xs"
          w={80}
          hideControls
          defaultValue={typeof value === 'number' ? value : undefined}
          onBlur={e => {
            const n = Number(e.currentTarget.value.trim());
            if (e.currentTarget.value.trim() !== '' && Number.isFinite(n) && n !== value) onSave(n);
          }}
        />
        {unit && <Text size="xs" c={text.muted}>{unit}</Text>}
      </Group>
    );
  }
  return (
    <TextInput
      aria-label={label}
      disabled={disabled}
      size="xs"
      w={200}
      placeholder={placeholder}
      defaultValue={typeof value === 'string' ? value : ''}
      onBlur={e => {
        const next = e.currentTarget.value;
        if (next !== (value ?? '')) onSave(next === '' ? undefined : next);
      }}
    />
  );
}

function LeavesBody({ def, row, shape }: { def: SettingDefWire; row: Row; shape: { fields: Record<string, LeafType>; fallbacks?: Record<string, string> } }) {
  const { text } = useSchemeColors();
  const explained = useSettingKey(def.key);
  const [all, setAll] = useState(false);
  const paths = Object.keys(shape.fields);
  const shown = all ? paths : paths.slice(0, LEAVES_FIRST);
  const target = targetScope(def);
  return (
    <Body>
      {shown.map(path => {
        const source = fieldSource(explained.rows, path);
        return (
          <FieldRow
            key={path}
            label={<Text size="xs" ff="monospace">{path}</Text>}
            source={isStoreScope(source) ? <ScopeBadge scope={source} moveTo={[]} onMove={() => {}} /> : source ? <Text size="xs" c={text.muted}>{source}</Text> : null}
          >
            <LeafInput
              label={`${def.key}.${path}`}
              type={shape.fields[path]!}
              value={getLeaf(def.effective.value, path)}
              placeholder={shape.fallbacks?.[path]}
              // leafWrite needs the target layer's own object; with no rows
              // yet (or stale rows mid-refresh) it would drop that layer's
              // other fields.
              disabled={explained.loading}
              onSave={v => void row.save(leafWrite(explained.rows, target, path, v)).then(ok => ok && explained.refresh())}
            />
          </FieldRow>
        );
      })}
      {paths.length > LEAVES_FIRST && !all && (
        <UnstyledButton onClick={() => setAll(true)} py={8}>
          <Text size="xs" fw={500} c="var(--tk-text-accent-small)">
            {paths.length - LEAVES_FIRST} more fields
          </Text>
        </UnstyledButton>
      )}
    </Body>
  );
}

function ReadonlyBody({ def }: { def: SettingDefWire }) {
  const { text } = useSchemeColors();
  return (
    <Body>
      <Code block>{JSON.stringify(def.effective.value, null, 2)}</Code>
      {def.effective.file && (
        <Text size="xs" ff="monospace" c={text.muted} pt={8}>
          {def.effective.file}
        </Text>
      )}
    </Body>
  );
}

export function compositeParts(
  def: SettingDefWire,
  kind: string,
  row: Row,
  open: boolean,
  onToggle: () => void
): { control: ReactNode; body: ReactNode } {
  const shape = SHAPES[def.key];
  const value = def.effective.value;
  const toggle = <ExpandToggle label={summarize(def)} open={open} onToggle={onToggle} />;

  if (shape && shape.kind !== 'external' && value !== undefined && !matchesShape(shape, value)) {
    const at = def.effective.scope;
    return {
      control: (
        <Group gap={8} wrap="nowrap">
          <Text size="xs" fw={500} c="var(--tk-text-bad-small)">unexpected shape</Text>
          {isStoreScope(at) && (
            <Button size="compact-xs" variant="default" onClick={() => void row.clear(at)}>
              Clear
            </Button>
          )}
        </Group>
      ),
      body: null,
    };
  }

  if (kind === 'stringList') {
    const list = strings(value);
    if (list.length <= INLINE_MAX_ITEMS && list.every(x => x.length <= INLINE_MAX_CHARS))
      return {
        control: <TagsInput aria-label={def.key} size="xs" w={260} value={list} onChange={next => void row.save(next)} />,
        body: null,
      };
    return { control: toggle, body: open ? <StringListBody def={def} row={row} /> : null };
  }
  if (kind === 'stringMap' && shape?.kind === 'stringMap')
    return { control: toggle, body: open ? <StringMapBody def={def} row={row} labels={shape.labels} /> : null };
  if (kind === 'leaves' && shape?.kind === 'leaves')
    return { control: toggle, body: open ? <LeavesBody def={def} row={row} shape={shape} /> : null };
  return { control: toggle, body: open ? <ReadonlyBody def={def} /> : null };
}
```

In `SettingRow.tsx` delete the placeholder `compositeParts` and add `import { compositeParts } from './CompositeControls';`. Keep the body render as `{body && <Collapse expanded={open}>{body}</Collapse>}` (unchanged) so only an open composite mounts its body (the `useSettingKey` explain fetch runs only when expanded).

`pairList` rows fall through to the read-only body on purpose: settings-kit keeps the kind for board parity, but no shipped key uses it, so the spec's `PairListControl` is deferred until one does.

`CompositeControls.tsx` imports `ExpandToggle` from `SettingRow.tsx` and `SettingRow.tsx` imports `compositeParts` from it; if the cycle trips lint (`import/no-cycle`) or a runtime `undefined`, move `ExpandToggle` into its own `ExpandToggle.tsx` and import it from both.

- [ ] **Step 3: Run tests, gate, commit**

Run: `bun run console:test -- src/app/settings`, then the task gate. Expected: green.

```bash
git add apps/console/src/app/settings
git commit -m "console: composite settings editors on the shared shapes

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The page: index, toolbar, sections, Agents tabs; retire Agent defaults

**Files:**
- Create: `apps/console/src/app/settings/SettingsSection.tsx`, `SettingsPage.tsx`
- Modify: `apps/console/src/app/App.tsx` (route `settings`)
- Modify: `apps/console/src/app/config/useSettings.ts` (delete `useSettingsDefs`, `useSettingsPrefix`)
- Delete: `apps/console/src/app/settings/AgentDefaultsPage.tsx` (its test went in Task 2)
- Modify: `apps/console/AGENTS.md` (routes paragraph: `settings` now renders the full settings page)
- Test: `apps/console/src/app/settings/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `useSettingsScope` (kit), `buildSections`, `NO_FILTER` types, `TIER_LABEL`, `SettingRow`, `ScopeDot`, `useAgentModels`.
- Produces: `SettingsPage()` rendered at `/settings`.

- [ ] **Step 1: Write the failing test**

```tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/useSettings', () => ({
  useAgentModels: () => ({ data: { models: [{ value: 'opus', label: 'Opus' }] } }),
}));

const { SettingsPage } = await import('./SettingsPage');

function def(key: string, over: Partial<SettingDefWire> = {}): SettingDefWire {
  return {
    key, type: 'string', scopes: ['user'], merge: 'replace', secret: false, teamLocked: false,
    repoScoped: false, writable: true, description: `${key} setting.`, hasDefault: false,
    defaultValue: null, effective: { scope: null, file: null }, ...over,
  };
}

const BOARD = [
  ...Array.from({ length: 7 }, (_, i) => def(`board.t${i}`, { scopes: ['team'], effective: { scope: 'team', file: '/t', value: 'x' } })),
  ...Array.from({ length: 5 }, (_, i) => def(`board.u${i}`, { scopes: ['user', 'machine'] })),
  def('board.agent.model', { scopes: ['user', 'machine'], effective: { scope: 'machine', file: '/m', value: 'opus' } }),
];
const DEFS = [
  def('agent.provider', { effective: { scope: 'default', file: null, value: 'claude' } }),
  def('agent.claude.account'),
  def('agent.codex.effort'),
  def('rt.runsPruneDays', { type: 'number', scopes: ['machine'], effective: { scope: 'default', file: null, value: 30 } }),
  def('rt.logRetentionDays', { type: 'number', scopes: ['machine', 'user'], effective: { scope: 'machine', file: '/m', value: 7 } }),
  ...BOARD,
];

let defsResponse: () => unknown = () => ({ ok: true, status: 200, json: async () => ({ defs: DEFS }) });

beforeEach(() => {
  window.history.replaceState(null, '', '/settings');
  vi.stubGlobal('fetch', async () => defsResponse());
});
afterEach(() => vi.unstubAllGlobals());

function renderPage() {
  return renderWithProviders(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

describe('SettingsPage', () => {
  it('lists groups in the index with their counts and renders sections', async () => {
    renderPage();
    const index = await screen.findByRole('navigation', { name: 'settings groups' });
    expect(within(index).getByText('Agents')).toBeInTheDocument();
    expect(within(index).getByText('Board')).toBeInTheDocument();
    expect(within(index).getByText('13')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Daemon' })).toBeInTheDocument();
  });

  it('filters by key and description, keeps the query in the URL, and Esc clears it', async () => {
    renderPage();
    const filter = await screen.findByLabelText('filter settings');
    await userEvent.type(filter, 'days');
    expect(screen.getByText('2 of 18')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Board' })).toBeNull();
    expect(window.location.search).toBe('?q=days');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    renderPage();
    await userEvent.type(await screen.findByLabelText('filter settings'), 'kubernetes');
    expect(screen.getByText('No settings match “kubernetes”')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
  });

  it('Changed keeps only keys a store sets', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('checkbox', { name: /Changed/ }));
    expect(screen.queryByText('provider')).toBeNull();
    expect(screen.getByText('logRetentionDays')).toBeInTheDocument();
  });

  it('splits a large section into subheads and hides badges that repeat them', async () => {
    renderPage();
    const board = (await screen.findByRole('heading', { name: 'Board' })).closest('section')!;
    expect(within(board).getByText('Team')).toBeInTheDocument();
    expect(within(board).getByText('You')).toBeInTheDocument();
    expect(within(board).queryAllByText('team', { selector: '.mantine-Badge-label' })).toHaveLength(0);
    expect(within(board).getByRole('button', { name: 'machine: move to another scope' })).toBeInTheDocument();
  });

  it('the Agents Codex tab swaps the provider keys and drops account', async () => {
    renderPage();
    expect(await screen.findByText('account')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }));
    expect(screen.queryByText('account')).toBeNull();
    expect(screen.getByText('agent.codex.')).toBeInTheDocument();
  });

  it('a failed load shows an alert and keeps the toolbar', async () => {
    defsResponse = () => ({ ok: false, status: 500, json: async () => ({ error: 'rt: store unreadable' }) });
    renderPage();
    expect(await screen.findByText('rt: store unreadable')).toBeInTheDocument();
    expect(screen.getByLabelText('filter settings')).toBeInTheDocument();
    defsResponse = () => ({ ok: true, status: 200, json: async () => ({ defs: DEFS }) });
  });
});
```

Run: `bun run console:test -- src/app/settings/SettingsPage.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 2: `SettingsSection.tsx`**

```tsx
import { useState } from 'react';
import {
  Box,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Title,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';

import { useAgentModels } from '../config/useSettings';
import { ScopeDot } from './ScopeBadge';
import { SettingRow } from './SettingRow';
import type { RowStore } from './useRowSave';
import type { Section, StoreScope } from './view';

const SUBHEAD: Record<StoreScope, { label: string; note: string; color: string }> = {
  team: { label: 'Team', note: 'shared with everyone through the team repo', color: 'var(--tk-text-purple-small)' },
  user: { label: 'You', note: 'your home repo, follows you to every machine', color: 'var(--tk-text-cyan-small)' },
  machine: { label: 'This machine', note: 'never leaves this Mac', color: 'var(--tk-text-accent-small)' },
};

type Provider = 'claude' | 'codex';

function Header({ section, right }: { section: Section; right?: React.ReactNode }) {
  const { text } = useSchemeColors();
  return (
    <Stack gap={4} pt={28} pb={8}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap={8}>
          <Title order={2} size={16} fw={700}>{section.group.label}</Title>
          <Text size="xs" ff="monospace" c={text.muted}>{section.total}</Text>
        </Group>
        {right}
      </Group>
      {section.group.blurb && <Text size="xs" c={text.muted}>{section.group.blurb}</Text>}
    </Stack>
  );
}

function AgentsSection({ section, store, query }: { section: Section; store: RowStore; query: string }) {
  const all = section.subsections.flatMap(s => s.defs);
  const current = all.find(d => d.key === 'agent.provider')?.effective.value;
  const [provider, setProvider] = useState<Provider>(current === 'codex' ? 'codex' : 'claude');
  const models = useAgentModels(provider);
  const suggestions = (models.data?.models ?? []).map(m => m.value);
  const defs = all.filter(d => d.key === 'agent.provider' || d.key.startsWith(`agent.${provider}.`));
  return (
    <Box component="section" id="settings-agents">
      <Header
        section={section}
        right={
          <SegmentedControl
            size="xs"
            value={provider}
            onChange={v => setProvider(v as Provider)}
            data={[{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }]}
          />
        }
      />
      {defs.map(def => (
        <SettingRow
          key={def.key}
          def={def}
          store={store}
          subhead={null}
          query={query}
          suggestions={def.key.endsWith('.model') ? suggestions : undefined}
        />
      ))}
    </Box>
  );
}

export function SettingsSection({ section, store, query }: { section: Section; store: RowStore; query: string }) {
  const { text } = useSchemeColors();
  if (section.group.id === 'agents') return <AgentsSection section={section} store={store} query={query} />;
  return (
    <Box component="section" id={`settings-${section.group.id}`}>
      <Header section={section} />
      {section.subsections.map(sub => (
        <Box key={sub.scope ?? 'all'}>
          {sub.scope && (
            <Group gap={8} pt={20} pb={6} style={{ borderBottom: '1px solid var(--tk-line-2)' }}>
              <ScopeDot scope={sub.scope} />
              <Text size="xs" fw={500} tt="uppercase" c={SUBHEAD[sub.scope].color}>{SUBHEAD[sub.scope].label}</Text>
              <Text size="xs" ff="monospace" c={text.muted}>{sub.defs.length}</Text>
              <Text size="xs" c={text.muted}>{SUBHEAD[sub.scope].note}</Text>
            </Group>
          )}
          {sub.defs.map(def => (
            <SettingRow key={def.key} def={def} store={store} subhead={sub.scope} query={query} />
          ))}
        </Box>
      ))}
    </Box>
  );
}
```

`Text tt="uppercase"` renders "TEAM" visually while the DOM text stays "Team", which the test relies on.

- [ ] **Step 3: `SettingsPage.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CloseButton,
  Group,
  Kbd,
  NavLink,
  PageShell,
  SegmentedControl,
  Skeleton,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useHotkeys, useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { TextInput } from '@mattstack/app-kit/core';
import { useSettingsScope } from '@mattstack/settings-kit/react';
import { isSet } from '@mattstack/settings-kit/shapes';
import { useSearchParams } from 'wouter';

import { PAGE_ROW_HEIGHT } from '../chrome';
import { TIER_LABEL, type Tier } from './groups';
import { ScopeDot } from './ScopeBadge';
import { SettingsSection } from './SettingsSection';
import {
  buildSections,
  isEditable,
  type ScopeFilter,
  type Section,
} from './view';

const TIERS: Tier[] = ['rt', 'apps', 'suite'];
const SCOPES = ['user', 'team', 'machine'] as const;

function Index({ sections, filtering }: { sections: Section[]; filtering: boolean }) {
  const { text } = useSchemeColors();
  const [active, setActive] = useState(() => window.location.hash.replace('#', ''));
  return (
    <Box component="nav" aria-label="settings groups" w={232} p="20px 12px 20px 16px" style={{ flex: 'none', borderRight: '1px solid var(--tk-line-2)', alignSelf: 'stretch' }}>
      {TIERS.map(tier => (
        <Box key={tier}>
          <Text size="xs" fw={500} tt="uppercase" c={text.muted} px={8} pt={14} pb={6}>
            {TIER_LABEL[tier]}
          </Text>
          {sections.filter(s => s.group.tier === tier).map(s => (
            <NavLink
              key={s.group.id}
              href={`#${s.group.id}`}
              label={s.group.label}
              active={active === s.group.id}
              rightSection={<Text size="xs" ff="monospace" c={text.muted}>{filtering ? s.shown : s.total}</Text>}
              style={{ opacity: filtering && s.shown === 0 ? 0.45 : 1, borderRadius: 4 }}
              onClick={e => {
                e.preventDefault();
                setActive(s.group.id);
                window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${s.group.id}`);
                document.getElementById(`settings-${s.group.id}`)?.scrollIntoView({ block: 'start' });
              }}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}

function SettingsPageContent() {
  const { text } = useSchemeColors();
  const store = useSettingsScope('');
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [changedOnly, setChangedOnly] = useState(false);
  const [editableOnly, setEditableOnly] = useState(false);
  const [scope, setScope] = useState<ScopeFilter>('any');
  const filterRef = useRef<HTMLInputElement>(null);
  useHotkeys([['/', () => filterRef.current?.focus()]]);

  // A deep link (/settings#board) can only scroll once the sections exist.
  useEffect(() => {
    if (store.loading) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' });
  }, [store.loading]);

  const setQuery = (q: string) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (q) next.set('q', q);
        else next.delete('q');
        return next;
      },
      { replace: true }
    );

  const sections = useMemo(
    () => buildSections(store.defs, { query, changedOnly, editableOnly, scope }),
    [store.defs, query, changedOnly, editableOnly, scope]
  );
  const total = store.defs.length;
  const shown = sections.reduce((n, s) => n + s.shown, 0);
  const filtering = query !== '' || changedOnly || editableOnly || scope !== 'any';
  const visible = sections.filter(s => s.shown > 0);
  const hiddenGroups = sections.length - visible.length;
  const clearAll = () => {
    setQuery('');
    setChangedOnly(false);
    setEditableOnly(false);
    setScope('any');
  };

  return (
    <Group align="stretch" gap={0} wrap="nowrap" mih="100%">
      <Index sections={sections} filtering={filtering} />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Group gap={12} px={32} py={16} wrap="nowrap" style={{ borderBottom: '1px solid var(--tk-line-2)' }}>
          <TextInput
            ref={filterRef}
            aria-label="filter settings"
            style={{ flex: 1 }}
            leftSection={<Icons.search size={16} />}
            placeholder={`Filter ${total} settings by key or description`}
            value={query}
            onTextChange={setQuery}
            onKeyDown={e => {
              if (e.key === 'Escape' && query !== '') {
                e.stopPropagation();
                setQuery('');
              }
            }}
            rightSectionWidth={query ? 110 : 36}
            rightSection={
              query ? (
                <Group gap={6} wrap="nowrap">
                  <Text size="xs" c={text.muted}>{`${shown} of ${total}`}</Text>
                  <CloseButton size="sm" aria-label="clear filter" onClick={() => setQuery('')} />
                </Group>
              ) : (
                <Kbd size="xs">/</Kbd>
              )
            }
          />
          <Chip checked={changedOnly} onChange={setChangedOnly} variant="outline" size="sm">
            {`Changed ${store.defs.filter(isSet).length}`}
          </Chip>
          <Chip checked={editableOnly} onChange={setEditableOnly} variant="outline" size="sm">
            {`Editable ${store.defs.filter(isEditable).length}`}
          </Chip>
          <SegmentedControl
            size="xs"
            value={scope}
            onChange={v => setScope(v as ScopeFilter)}
            data={[
              { value: 'any', label: 'any' },
              ...SCOPES.map(s => ({
                value: s,
                label: (
                  <Group gap={6} wrap="nowrap">
                    <ScopeDot scope={s} />
                    <span>{s}</span>
                  </Group>
                ),
              })),
            ]}
          />
        </Group>
        <Box px={32} pb={32}>
          {store.error && (
            <Alert color="bad" variant="light" mt="md" icon={<Icons.error size={14} />}>
              <Text size="xs">{store.error}</Text>
            </Alert>
          )}
          {store.loading ? (
            <Stack gap="md" pt={28}>
              {[220, 280, 180, 240].map(w => (
                <Group key={w} justify="space-between">
                  <Stack gap={8}>
                    <Skeleton h={12} w={w} />
                    <Skeleton h={10} w={w + 160} />
                  </Stack>
                  <Skeleton h={30} w={200} />
                </Group>
              ))}
            </Stack>
          ) : visible.length === 0 && total > 0 ? (
            <Stack align="center" gap={10} py={48}>
              <Text size="sm" fw={500}>{query ? `No settings match “${query}”` : 'No settings match these filters'}</Text>
              <Text size="xs" c={text.muted}>The filter reads key names and descriptions, not values.</Text>
              <Button size="xs" variant="default" onClick={clearAll}>Clear filter</Button>
            </Stack>
          ) : (
            visible.map(s => <SettingsSection key={s.group.id} section={s} store={store} query={query} />)
          )}
          {filtering && visible.length > 0 && hiddenGroups > 0 && (
            <Group gap={6} pt={20}>
              <Icons.eyeOff size={14} />
              <Text size="xs" c={text.muted}>{`${hiddenGroups} groups have no match. Esc clears the filter.`}</Text>
            </Group>
          )}
        </Box>
      </Stack>
    </Group>
  );
}

export function SettingsPage() {
  return (
    <PageShell title="Settings" headerHeight={PAGE_ROW_HEIGHT} compactHeader>
      <SettingsPageContent />
    </PageShell>
  );
}
```

(Merge the duplicate `@mattstack/app-kit/core` imports; prettier's import sorter will order them.) The Esc test expects Esc to clear from anywhere once the filter has focus; the `onKeyDown` above covers it. If the Chip's accessible role is not `checkbox` in Mantine 9.5, adjust the test's query to the role the rendered DOM exposes.

- [ ] **Step 4: Route swap and retirement**

In `App.tsx`: replace the `AgentDefaultsPage` import with `import { SettingsPage } from './settings/SettingsPage';` and `case 'settings': return <SettingsPage />;`. Delete `AgentDefaultsPage.tsx`. In `useSettings.ts` delete `useSettingsDefs` and `useSettingsPrefix` (nothing imports them now; `rg -n "useSettingsDefs|useSettingsPrefix" apps/console/src` prints nothing). In `apps/console/AGENTS.md`'s "Routes and chrome" paragraph, add `settings` to the route list and one sentence: "`/settings` is the grouped, filterable page over every registered key (`src/app/settings/`); `/config/:key` is its per-key explain drill-in."

- [ ] **Step 5: Run tests, gate, commit**

Run: `bun run console:test -- src/app/settings`, then the task gate. Expected: green.

```bash
git add -A apps/console
git commit -m "console: one grouped, filterable settings page replaces Agent defaults

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: See it: Fast Browser, both schemes, against the pen artboards

**Files:** none new unless a fix is needed (commit fixes separately, one per visual defect).

- [ ] **Step 1: Serve the branch without touching real notifications**

Confirm deck is up (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:11001/` prints 200). Console's boot writes a notification bridge rule using deck's registered URL when deck answers, so a test server on another port leaves the real rule unchanged; if deck is down, stop and ask Matt. Then:

```bash
bun run console:build
cd apps/console && PORT=11021 bun run src/server/index.ts
```

(run in the background). Do not save any value through this server: it writes Matt's real stores. Editing behaviour is covered by the jsdom tests.

- [ ] **Step 2: Capture**

Through the `fast-browser:browser-driver` agent, or Fast Browser directly via one `browser_run_code_unsafe` script: viewport 1440x900 at `http://127.0.0.1:11021/settings`; for `emulateMedia({ colorScheme })` in `dark` and `light` (also set `localStorage['mantine-color-scheme-value']` to match and reload), capture: the top of the page; `?q=days`; the Board section (scroll `#settings-board` into view); `rt.homeSnapshot` expanded; the Codex tab. Save PNGs under `~/.fast-browser/output/console-settings/`.

- [ ] **Step 3: Compare and say what is wrong**

Read every PNG. Compare against the pen artboards (export them with pen.dev's `Export` if needed): control column starts at one x for every row; badges show purple/cyan/indigo with dots and are hidden under a matching subhead; filter matches read as a warn wash; index counts drop to zero and dim when filtering; nothing overflows its input; light scheme badges are distinguishable by their dots. Write down each defect plainly, fix it, commit it (`console: settings <what>`), and recapture. Done only when both schemes read right.

- [ ] **Step 4: Stop the test server**

Kill the background `bun` on port 11021.
