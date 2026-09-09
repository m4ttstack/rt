# Board Roster Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the board read and write the suite-wide `mattstack.roster` key, let a stored display name override the GitLab profile lookup, and give the board's roster editor the name-on-add and rename affordances it lacks today.

**Architecture:** The board's roster already resolves through the settings-store ownership latch in `withBoardStoreFallback` / `saveRosterMembers`. This plan generalizes that latch from one key to an ordered list (`mattstack.roster` first, `board.members` second, `config.json` last) via a single `rosterFromStore` helper that both the reader and the writer share, so the read side and the write side can never disagree about which key owns the roster. Roster mutation moves out of the `/roster` route body into a pure `applyRosterEdit` function in `config.ts` (the same "pure, string in / string out, for testing" precedent `setHiddenInRaw` set), which is what makes the new `rename` action testable without booting a server.

**Tech Stack:** Bun + TypeScript, React 19 client bundled by `client-bundle.ts`, `bun:test`, `@mattstack/rt-client` for `getSetting`/`setSetting`.

**Spec:** No separate design doc. The decisions this plan implements were taken directly by Matt on 2026-09-08 and are reproduced verbatim in Global Constraints below. The cross-app roster's own design lives at `apps/boxscore/docs/superpowers/specs/2026-09-02-mattstack-integration-design.md` (decision D2, "Roster home"), which explicitly anticipated this work: *"Boxscore reads it now; the board migrates in its own PR."*

## Global Constraints

- **Roster key precedence is `mattstack.roster` → `board.members` → `config.json`.** Never the reverse. `board.members` is a fallback for installs that have not migrated, not a co-equal source.
- **A stored `name` overrides the GitLab profile lookup.** `member.name ?? user?.name`, never `user?.name ?? member.name`.
- **`mattstack.roster` never carries `hidden`.** Its registry shape is `[{username, name?}]`. Hidden state lives in `board.hiddenMembers` (user scope) for the board and `boxscore.hiddenMembers` for boxscore. Any write to `mattstack.roster` strips `hidden`.
- **`mattstack.roster` is team scope only.** Its registry row is `scopes: ["team"]`. Every write passes `'team'`.
- **No registry changes.** `mattstack.roster` is already declared in `packages/rt-client/src/settings/registry-defs.ts:310` in the repo-tools checkout. This plan adds no new settings key, so none of the per-consumer rt-client delivery steps apply.
- **No `default` on any settings row.** Not that this plan adds rows, but the fallback stays in the app-side read (`getSetting(k).value ?? fallback`).
- **Comment discipline.** Comments state constraints the code cannot show. Do not narrate the next line, cite this plan, or record decision history in source. Decision records go in the task's report, not the code.
- **No em dashes or en dashes** in code comments, commit messages, or PR text. Use ellipses, parens, or rephrase.
- **Gates.** `bun run tui-kit:build` must run before any board gate. Then `bun run board:typecheck`, `bun run board:test`, `bun run board:build`. Board has no `:lint` script.
- **Worktree.** All work happens in `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle` on branch `board-roster-adopt`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/board/src/config.ts` | Roster key resolution (`rosterFromStore`), the read fallback, the latch-gated writer, and the new pure `applyRosterEdit` | Modify |
| `apps/board/src/server.ts` | Name precedence in `refreshMemberNames`; `/roster` route delegates to `applyRosterEdit` and gains `rename` | Modify |
| `apps/board/src/client/board/ConfigModal.tsx` | Roster editor: name input on add, inline rename per row | Modify |
| `apps/board/src/client/board/config-shapes.ts` | `mattstack.roster` composite shape + label; `rosterSummary` hidden-count consistency | Modify |
| `apps/board/src/__tests__/config-store-latch.test.ts` | Read/write latch coverage for the new key order; `applyRosterEdit` unit coverage | Modify |
| `apps/board/src/__tests__/server-roster-route.test.ts` | Route-level coverage for add-with-name, rename, and the `mattstack.roster` write target, booted against a fake `$HOME` | Create |
| `apps/board/src/client/__tests__/config-shapes.test.ts` | `rosterSummary` + shape-row coverage | Modify |

---

### Task 1: Roster key resolution and the read fallback

Generalize the roster read from one store key to an ordered list, behind one helper that Task 2's writer will reuse.

**Files:**
- Modify: `apps/board/src/config.ts:665` (the `roster` line in `withBoardStoreFallback`) and `apps/board/src/config.ts:740` (`storeOwnsRequiredFields`)
- Test: `apps/board/src/__tests__/config-store-latch.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `rosterFromStore(resolve: GetSettingFn): { key: RosterStoreKey; members: Member[] } | null` and `type RosterStoreKey = 'mattstack.roster' | 'board.members'`, both module-private to `config.ts`. Task 2 calls `rosterFromStore` from `saveRosterMembers`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/board/src/__tests__/config-store-latch.test.ts`, inside the existing `describe('loadConfigFrom: per-key store-wins fallback', ...)` block:

```ts
  test('mattstack.roster wins over board.members', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'mattstack.roster': [{ username: 'suite', name: 'Suite Wide' }],
        'board.members': [{ username: 'legacy' }],
      })
    );
    expect(cfg.members).toEqual([{ username: 'suite', name: 'Suite Wide' }]);
  });

  test('board.members still wins over config.json when mattstack.roster is unset', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({ 'board.members': [{ username: 'legacy' }] })
    );
    expect(cfg.members).toEqual([{ username: 'legacy' }]);
  });

  test('an empty mattstack.roster is still ownership, not absence', () => {
    // [] is a value: it must not fall through to board.members. parseConfig
    // refuses an empty roster, so this proves ownership by the throw.
    const p = tmpConfig();
    expect(() =>
      loadConfigFrom(
        p,
        fakeResolve({
          'mattstack.roster': [],
          'board.members': [{ username: 'legacy' }],
        })
      )
    ).toThrow();
  });

  test('board.hiddenMembers overlays a mattstack.roster roster the same way', () => {
    const p = tmpConfig();
    const cfg = loadConfigFrom(
      p,
      fakeResolve({
        'mattstack.roster': [{ username: 'ann' }, { username: 'bo' }],
        'board.hiddenMembers': ['bo'],
      })
    );
    expect(cfg.members).toEqual([
      { username: 'ann' },
      { username: 'bo', hidden: true },
    ]);
  });
```

And add to the same file, in a new `describe` block at the end:

```ts
describe('storeOwnsRequiredFields: config.json-free boot', () => {
  test('mattstack.roster satisfies the roster requirement with no config.json', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'board-noconfig-')), 'config.json');
    const cfg = loadConfigFrom(
      missing,
      fakeResolve({
        'board.gitlabHost': 'https://gitlab.example.com',
        'board.projects': ['g/p'],
        'mattstack.roster': [{ username: 'ann' }],
      })
    );
    expect(cfg.members).toEqual([{ username: 'ann' }]);
    expect(cfg.gitlabHost).toBe('https://gitlab.example.com');
  });

  test('no roster key at all with no config.json still throws the seed message', () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'board-noconfig-')), 'config.json');
    expect(() =>
      loadConfigFrom(
        missing,
        fakeResolve({
          'board.gitlabHost': 'https://gitlab.example.com',
          'board.projects': ['g/p'],
        })
      )
    ).toThrow(/config.json not found/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts`

Expected: FAIL. `mattstack.roster wins over board.members` gets `[{username:'legacy'}]`, and the config.json-free test throws `config.json not found`.

- [ ] **Step 3: Add the resolution helper**

In `apps/board/src/config.ts`, directly above `withBoardStoreFallback`:

```ts
/** Roster store keys, strongest first. `mattstack.roster` is the suite-wide
    roster every mattstack app reads; `board.members` is the board's own
    pre-migration list, kept for installs whose team store still carries it.
    An unregistered key on a stale rt-client copy resolves undefined through
    storeValue's catch, so an old copy simply keeps using board.members. */
const ROSTER_KEYS = ['mattstack.roster', 'board.members'] as const;

type RosterStoreKey = (typeof ROSTER_KEYS)[number];

/** The owning roster key and its value, or null when the store owns neither.
    One helper for both sides of the latch: the reader and the writer must
    never disagree about which key holds the roster. */
function rosterFromStore(
  resolve: GetSettingFn
): { key: RosterStoreKey; members: Member[] } | null {
  for (const key of ROSTER_KEYS) {
    const members = storeValue<Member[]>(key, resolve);
    if (members !== undefined) return { key, members };
  }
  return null;
}
```

- [ ] **Step 4: Use it in the reader**

In `withBoardStoreFallback`, replace:

```ts
  const roster =
    storeValue<Member[]>('board.members', resolve) ?? fileConfig.members;
```

with:

```ts
  const roster = rosterFromStore(resolve)?.members ?? fileConfig.members;
```

In `storeOwnsRequiredFields`, replace `storeValue('board.members', resolve) !== undefined` with `rosterFromStore(resolve) !== null`:

```ts
function storeOwnsRequiredFields(resolve: GetSettingFn): boolean {
  return (
    storeValue('board.gitlabHost', resolve) !== undefined &&
    storeValue('board.projects', resolve) !== undefined &&
    rosterFromStore(resolve) !== null
  );
}
```

- [ ] **Step 5: Update the `withBoardStoreFallback` doc comment**

Its existing paragraph says the roster comes from `board.members`. Replace the sentence beginning "The members roster overlays `board.hiddenMembers`" with:

```
 * The roster comes from the first owning key in ROSTER_KEYS, and overlays
 * `board.hiddenMembers` (user-scope usernames) onto that roster's `hidden`
 * flags by username, replacing whatever `hidden` flags the roster source
 * carried inline: post-migration, hidden state lives only in the user key,
 * never on the team-owned member entries.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts`

Expected: PASS, all tests in the file including the pre-existing ones.

- [ ] **Step 7: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/__tests__/config-store-latch.test.ts
git commit -m "board: read the roster from mattstack.roster, board.members as fallback"
```

---

### Task 2: Write through the same latch

The writer must land in whichever key the reader just read, and must never write `hidden` into the shared suite key.

**Files:**
- Modify: `apps/board/src/config.ts` (`isMembersOwned`, `saveRosterMembers`)
- Test: `apps/board/src/__tests__/config-store-latch.test.ts`

**Interfaces:**
- Consumes: `rosterFromStore` from Task 1.
- Produces: `saveRosterMembers(next: Member[], path?: string, resolve?: GetSettingFn, write?: SetSettingFn): BoardConfig` keeps its exact signature. Only its write target changes.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('saveRosterMembers: latch-gated writer', ...)` block:

```ts
  test('owned by mattstack.roster: writes that key, not board.members', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const next = [{ username: 'alice' }, { username: 'bob', name: 'Bob Ng' }];
    saveRosterMembers(
      next,
      p,
      fakeResolve({
        'mattstack.roster': [{ username: 'alice' }],
        'board.members': [{ username: 'legacy' }],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'mattstack.roster', value: next, scope: 'team' },
    ]);
  });

  test('a write to mattstack.roster strips hidden: that key has no such field', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveRosterMembers(
      [{ username: 'alice' }, { username: 'bob', hidden: true, name: 'Bob' }],
      p,
      fakeResolve({ 'mattstack.roster': [{ username: 'alice' }] }),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual([
      { username: 'alice' },
      { username: 'bob', name: 'Bob' },
    ]);
  });

  test('a write to board.members keeps hidden: that key still carries it', () => {
    const p = tmpConfig({ ...base, members: [{ username: 'alice' }] });
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const next = [{ username: 'alice' }, { username: 'bob', hidden: true }];
    saveRosterMembers(
      next,
      p,
      fakeResolve({ 'board.members': [{ username: 'alice' }] }),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual(next);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts`

Expected: FAIL. The first two write `board.members` and keep `hidden`.

- [ ] **Step 3: Replace `isMembersOwned` and rewrite the writer's store branch**

Delete `isMembersOwned` entirely (Task 1's `rosterFromStore` subsumes it) and change `saveRosterMembers`'s store branch:

```ts
export function saveRosterMembers(
  next: Member[],
  path: string = CONFIG_PATH,
  resolve: GetSettingFn = getSetting,
  write: SetSettingFn = setSetting
): BoardConfig {
  const owner = rosterFromStore(resolve);
  if (owner) {
    // mattstack.roster is [{username, name?}] across every suite app: hidden
    // state is each app's own overlay (board.hiddenMembers), so a hidden flag
    // must not ride along into the shared key.
    const value =
      owner.key === 'mattstack.roster'
        ? next.map(({ hidden: _hidden, ...rest }) => rest)
        : next;
    write(owner.key, value, 'team');
  } else {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      throw new Error(`config.json not found at ${path}`);
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.members = next;
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n');
    renameSync(tmp, path);
  }
  return loadConfigFrom(path, resolve);
}
```

Also update the doc comment above it: replace "a store-owned roster is written to the team store" with "a store-owned roster is written back to the key that owns it (see ROSTER_KEYS)", and replace the final sentence "Hidden flags ride along on the entries, matching how the roster is stored today." with "Hidden flags ride along only on `board.members`; `mattstack.roster` is shared with every suite app and carries no hidden field."

- [ ] **Step 4: Check for other `isMembersOwned` callers**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && grep -rn "isMembersOwned" apps/board/src`

Expected: no output. If any caller remains, replace it with `rosterFromStore(resolve) !== null`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/__tests__/config-store-latch.test.ts
git commit -m "board: write the roster back to whichever key owns it, hidden stripped from mattstack.roster"
```

---

### Task 3: A stored name overrides the GitLab lookup

**Files:**
- Modify: `apps/board/src/server.ts:642` (inside `refreshMemberNames`)
- Test: `apps/board/src/__tests__/config-store-latch.test.ts` is the wrong home for this; the behavior is a one-line precedence in a module-private async function with a network call. Cover it by extracting the precedence into an exported pure helper in `config.ts` and testing that.

**Interfaces:**
- Consumes: the `Member` type from `config.ts`.
- Produces: `export function displayName(member: Member, profileName: string | null | undefined): string | null` in `apps/board/src/config.ts`.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the end of `apps/board/src/__tests__/config-store-latch.test.ts`, and add `displayName` to the file's import list from `'../config.ts'`:

```ts
describe('displayName: stored name beats the GitLab profile', () => {
  test('a stored name wins over the GitLab profile name', () => {
    expect(
      displayName({ username: 'dee', name: 'Dee Fox' }, 'D. Fox')
    ).toBe('Dee Fox');
  });

  test('the GitLab profile fills in when there is no stored name', () => {
    expect(displayName({ username: 'bo' }, 'Bo Chen')).toBe('Bo Chen');
  });

  test('null when neither side has one', () => {
    expect(displayName({ username: 'cy' }, null)).toBeNull();
    expect(displayName({ username: 'cy' }, undefined)).toBeNull();
  });

  test('a blank stored name does not shadow the profile', () => {
    expect(displayName({ username: 'x', name: '   ' }, 'Real Name')).toBe(
      'Real Name'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts`

Expected: FAIL with `displayName is not a function` / an import error.

- [ ] **Step 3: Add the helper to `config.ts`**

Place it directly below the `Member` type declaration:

```ts
/** A member's display name. The stored name is an override, not a fallback:
    it is the only way to name an account GitLab cannot resolve, and a name
    typed into the roster editor must survive the hourly profile refresh. */
export function displayName(
  member: Member,
  profileName: string | null | undefined
): string | null {
  return member.name?.trim() || profileName?.trim() || null;
}
```

- [ ] **Step 4: Use it at all three `refreshMemberNames` branches**

In `apps/board/src/server.ts`, rewrite the body of the `config.members.map` callback in `refreshMemberNames`:

```ts
    config.members.map(async member => {
      try {
        if (!token) {
          memberNames.set(member.username, displayName(member, null));
          return;
        }
        const user = await (await gitlab()).fetchUser(member.username);
        memberNames.set(member.username, displayName(member, user?.name));
      } catch (err) {
        console.error(
          `name lookup failed for ${member.username}: ${err instanceof Error ? err.message : err}`
        );
        memberNames.set(member.username, displayName(member, null));
      }
    })
```

Add `displayName` to the existing `from './config.ts'` import in `server.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts && bun run board:typecheck`

Expected: PASS, and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/server.ts apps/board/src/__tests__/config-store-latch.test.ts
git commit -m "board: a stored member name overrides the gitlab profile lookup"
```

---

### Task 4: `applyRosterEdit` and the rename action

Move the `/roster` route's mutation and validation into a pure function so `rename` can be added and tested without a server, then make the route a thin wrapper.

**Files:**
- Modify: `apps/board/src/config.ts` (add `applyRosterEdit`)
- Modify: `apps/board/src/server.ts:1033-1106` (the `/roster` case)
- Test: `apps/board/src/__tests__/config-store-latch.test.ts`
- Create: `apps/board/src/__tests__/server-roster-route.test.ts`

**Interfaces:**
- Consumes: `Member`, `saveRosterMembers` from Tasks 1-2.
- Produces:

```ts
export type RosterAction = 'add' | 'remove' | 'rename';
export type RosterEdit = {
  action: RosterAction;
  username: string;
  name?: string;
};
export type RosterEditResult =
  | { ok: true; members: Member[] }
  | { ok: false; error: string };

export function applyRosterEdit(
  members: Member[],
  edit: RosterEdit,
  self: string | null
): RosterEditResult;
```

`self` is the board's `defaultMember`: the member who cannot be dropped.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block at the end of `apps/board/src/__tests__/config-store-latch.test.ts`, and add `applyRosterEdit` to the imports from `'../config.ts'`:

```ts
describe('applyRosterEdit: pure roster mutation', () => {
  const roster = [
    { username: 'ann', name: 'Ann Lee' },
    { username: 'bo' },
    { username: 'cy', hidden: true },
  ];

  test('add appends with a name', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: 'dee', name: 'Dee Fox' },
      'ann'
    );
    expect(r).toEqual({
      ok: true,
      members: [...roster, { username: 'dee', name: 'Dee Fox' }],
    });
  });

  test('add without a name omits the field rather than storing empty', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: 'dee', name: '  ' },
      'ann'
    );
    expect(r.ok && r.members.at(-1)).toEqual({ username: 'dee' });
  });

  test('add trims the username', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: '  dee  ' },
      'ann'
    );
    expect(r.ok && r.members.at(-1)).toEqual({ username: 'dee' });
  });

  test('add rejects a duplicate', () => {
    expect(
      applyRosterEdit(roster, { action: 'add', username: 'bo' }, 'ann')
    ).toEqual({ ok: false, error: '"bo" is already on the roster' });
  });

  test('remove drops the entry', () => {
    const r = applyRosterEdit(roster, { action: 'remove', username: 'bo' }, 'ann');
    expect(r.ok && r.members.map(m => m.username)).toEqual(['ann', 'cy']);
  });

  test('remove rejects an unknown username', () => {
    expect(
      applyRosterEdit(roster, { action: 'remove', username: 'zed' }, 'ann')
    ).toEqual({ ok: false, error: 'unknown member "zed"' });
  });

  test('remove refuses to empty the roster', () => {
    expect(
      applyRosterEdit([{ username: 'ann' }], { action: 'remove', username: 'ann' }, null)
    ).toEqual({ ok: false, error: 'the roster cannot be emptied' });
  });

  test('remove refuses to drop the board owner', () => {
    expect(
      applyRosterEdit(roster, { action: 'remove', username: 'ann' }, 'ann')
    ).toEqual({
      ok: false,
      error: 'you cannot drop yourself: this board runs as you',
    });
  });

  test('rename sets a name on an existing member, in place', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'bo', name: 'Bo Chen' },
      'ann'
    );
    expect(r.ok && r.members).toEqual([
      { username: 'ann', name: 'Ann Lee' },
      { username: 'bo', name: 'Bo Chen' },
      { username: 'cy', hidden: true },
    ]);
  });

  test('rename replaces an existing name', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'ann', name: 'Ann Marie Lee' },
      'ann'
    );
    expect(r.ok && r.members[0]).toEqual({
      username: 'ann',
      name: 'Ann Marie Lee',
    });
  });

  test('rename to blank clears the name so the gitlab profile takes over', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'ann', name: '   ' },
      'ann'
    );
    expect(r.ok && r.members[0]).toEqual({ username: 'ann' });
  });

  test('rename preserves a hidden flag', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'cy', name: 'Cy Park' },
      'ann'
    );
    expect(r.ok && r.members[2]).toEqual({
      username: 'cy',
      name: 'Cy Park',
      hidden: true,
    });
  });

  test('rename rejects an unknown username', () => {
    expect(
      applyRosterEdit(roster, { action: 'rename', username: 'zed', name: 'Z' }, 'ann')
    ).toEqual({ ok: false, error: 'unknown member "zed"' });
  });

  test('the input roster is never mutated', () => {
    const snapshot = JSON.parse(JSON.stringify(roster));
    applyRosterEdit(roster, { action: 'rename', username: 'bo', name: 'Bo' }, 'ann');
    applyRosterEdit(roster, { action: 'remove', username: 'bo' }, 'ann');
    expect(roster).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts`

Expected: FAIL with `applyRosterEdit is not a function`.

- [ ] **Step 3: Implement `applyRosterEdit` in `config.ts`**

Place it directly above `saveRosterMembers`:

```ts
export type RosterAction = 'add' | 'remove' | 'rename';

export type RosterEdit = {
  action: RosterAction;
  username: string;
  name?: string;
};

export type RosterEditResult =
  | { ok: true; members: Member[] }
  | { ok: false; error: string };

/** Apply one roster edit, returning the next list or the message to hand the
    caller. Pure (list in, list out) so every rule below is testable without a
    server, same as setHiddenInRaw. `self` is the board's defaultMember: the
    board runs as them, so dropping them would strand every affordance keyed
    on that identity, and an empty roster is one parseConfig refuses to load
    on the next boot. A blank name clears the field rather than storing an
    empty string, which is what lets a rename hand a member back to the
    GitLab profile lookup. */
export function applyRosterEdit(
  members: Member[],
  edit: RosterEdit,
  self: string | null
): RosterEditResult {
  const username = edit.username.trim();
  if (!username) return { ok: false, error: 'username is required' };
  const name = edit.name?.trim() ?? '';
  const present = members.some(m => m.username === username);

  if (edit.action === 'add') {
    if (present)
      return { ok: false, error: `"${username}" is already on the roster` };
    return {
      ok: true,
      members: [...members, name ? { username, name } : { username }],
    };
  }

  if (!present) return { ok: false, error: `unknown member "${username}"` };

  if (edit.action === 'rename') {
    return {
      ok: true,
      members: members.map(m => {
        if (m.username !== username) return m;
        const { name: _name, ...rest } = m;
        return name ? { ...rest, name } : rest;
      }),
    };
  }

  if (members.length === 1)
    return { ok: false, error: 'the roster cannot be emptied' };
  if (username === self)
    return {
      ok: false,
      error: 'you cannot drop yourself: this board runs as you',
    };
  return { ok: true, members: members.filter(m => m.username !== username) };
}
```

Note the `rename` branch spreads `rest` before `name`, so a renamed member's key order stays `username, name, hidden` rather than moving `name` to the end.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/config-store-latch.test.ts`

Expected: PASS.

- [ ] **Step 5: Rewrite the `/roster` route to delegate**

Replace the whole body of `case '/roster':` in `apps/board/src/server.ts` with:

```ts
      case '/roster': {
        // Add, drop, or rename a teammate. Sibling of /settings (which only
        // flips the hidden overlay): both are single-writer config mutations
        // that swap the in-memory roster so this and every later /data.json
        // agree. Every rule lives in applyRosterEdit; this only shapes the
        // request and persists the result.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const { action, username, name } = (body ?? {}) as {
          action?: unknown;
          username?: unknown;
          name?: unknown;
        };
        if (
          (action !== 'add' && action !== 'remove' && action !== 'rename') ||
          typeof username !== 'string' ||
          !username.trim()
        ) {
          return new Response(
            'expected { action: "add" | "remove" | "rename", username: string, name?: string }',
            { status: 400 }
          );
        }
        if (name !== undefined && typeof name !== 'string') {
          return new Response('name must be a string', { status: 400 });
        }
        const edit = applyRosterEdit(
          config.members,
          { action, username, name },
          config.defaultMember === 'all' ? null : config.defaultMember
        );
        if (!edit.ok) return new Response(edit.error, { status: 400 });
        try {
          config.members = saveRosterMembers(edit.members).members;
        } catch (err) {
          return new Response(
            `roster write failed: ${err instanceof Error ? err.message : err}`,
            { status: 500 }
          );
        }
        // A new member's MRs are not in the snapshot yet, and a dropped one's
        // must leave it: the next full fetch declares the new demand to rt.
        // A rename changes no demand, but the display name is cached for an
        // hour, so the lookup has to be re-armed either way.
        cache.invalidate();
        namesFetchedAt = 0;
        void refreshMemberNames();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
```

Add `applyRosterEdit` to the `from './config.ts'` import in `server.ts`.

- [ ] **Step 6: Verify `defaultMember`'s type before relying on the `'all'` check**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && grep -n "defaultMember" apps/board/src/config.ts | head`

`parseConfig` allows `defaultMember` to be `'all'` or a member username. If it is optional (`string | undefined`), write the argument as `config.defaultMember && config.defaultMember !== 'all' ? config.defaultMember : null`. Match whatever the type actually is; do not leave a type error for `null`.

- [ ] **Step 7: Write the route-level test**

Create `apps/board/src/__tests__/server-roster-route.test.ts`. Model the boot harness on `apps/board/src/__tests__/server-healthz-fast.test.ts`: a fake `$HOME` carrying a team settings store, so this never touches the real `~/.mattstack`. Seed `mattstack.roster` rather than `board.members`, which proves Task 1 and Task 2 end to end.

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

// Boots the real server against a fake $HOME whose team store owns
// mattstack.roster, then drives POST /roster. Proves the route's three
// actions land in the suite key (not board.members) and that a rename
// survives the write, without touching the real ~/.mattstack.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-roster-route-'));

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
const storePath = join(teamDir, 'settings.team.jsonc');
writeFileSync(
  storePath,
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'mattstack.roster': [{ username: 'ann' }, { username: 'bo' }],
    'board.defaultMember': 'ann',
  })
);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');

const PORT = 47951;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: { ...process.env, HOME: fakeHome, PORT: String(PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => proc.kill());

async function waitForBoot(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await Bun.sleep(100);
  }
  throw new Error('server never became healthy');
}

async function roster(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/roster`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function stored(): Array<{ username: string; name?: string }> {
  return JSON.parse(readFileSync(storePath, 'utf8'))['mattstack.roster'];
}

test('add with a name writes mattstack.roster', async () => {
  await waitForBoot();
  const res = await roster({ action: 'add', username: 'cy', name: 'Cy Park' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'cy', name: 'Cy Park' });
  expect(JSON.parse(readFileSync(storePath, 'utf8'))['board.members']).toBeUndefined();
});

test('rename sets a name on an existing member', async () => {
  const res = await roster({ action: 'rename', username: 'bo', name: 'Bo Chen' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'bo', name: 'Bo Chen' });
});

test('rename to blank clears the name', async () => {
  const res = await roster({ action: 'rename', username: 'bo', name: '' });
  expect(res.status).toBe(200);
  expect(stored()).toContainEqual({ username: 'bo' });
});

test('rename of an unknown member is a 400', async () => {
  const res = await roster({ action: 'rename', username: 'zed', name: 'Z' });
  expect(res.status).toBe(400);
  expect(await res.text()).toBe('unknown member "zed"');
});

test('an unknown action is a 400 naming all three', async () => {
  const res = await roster({ action: 'promote', username: 'bo' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('rename');
});

test('dropping yourself is refused', async () => {
  const res = await roster({ action: 'remove', username: 'ann' });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('this board runs as you');
});
```

- [ ] **Step 8: Run the route test**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/__tests__/server-roster-route.test.ts`

Expected: PASS. If the server refuses to boot, read its stderr (`await new Response(proc.stderr).text()`) and fix the harness before touching the route: compare the env and store keys against `server-healthz-fast.test.ts`, which is known to boot. If `board.defaultMember` is not a registered key, drop it from the seed and set the default member however `config.example.json` does.

- [ ] **Step 9: Commit**

```bash
git add apps/board/src/config.ts apps/board/src/server.ts apps/board/src/__tests__/config-store-latch.test.ts apps/board/src/__tests__/server-roster-route.test.ts
git commit -m "board: extract applyRosterEdit, add a rename action to POST /roster"
```

---

### Task 5: Roster editor gains a name field and inline rename

**Files:**
- Modify: `apps/board/src/client/board/ConfigModal.tsx:409-540` (`RosterControl`)
- Modify: `apps/board/src/client/board/config-shapes.ts:68` (`COMPOSITE_SHAPES`) and `rosterSummary`
- Test: `apps/board/src/client/__tests__/config-shapes.test.ts`

**Interfaces:**
- Consumes: the `/roster` route's `rename` action from Task 4.
- Produces: nothing later tasks depend on.

Board has no React component test harness (`apps/board/src/client/__tests__/` holds only pure-logic tests), so the UI itself is covered by the Task 4 route tests plus manual verification in Task 6. Only the pure `config-shapes.ts` changes get unit tests here.

- [ ] **Step 1: Write the failing shape tests**

Add to `apps/board/src/client/__tests__/config-shapes.test.ts`:

```ts
test('mattstack.roster renders with the roster editor', () => {
  expect(rowKind({ key: 'mattstack.roster', type: 'array', scopes: ['team'], writable: true } as ConfigDef)).toBe('roster');
});

test('rosterSummary counts hidden from the overlay alone once the store owns it', () => {
  // The overlay REPLACES inline flags in withBoardStoreFallback, so counting
  // the union double-reports a member the overlay already checked back in.
  expect(rosterSummary([{ username: 'a', hidden: true }, { username: 'b' }], ['b'])).toBe(
    '2 members, 1 hidden'
  );
});

test('rosterSummary falls back to inline flags with no overlay', () => {
  expect(rosterSummary([{ username: 'a', hidden: true }, { username: 'b' }], undefined)).toBe(
    '2 members, 1 hidden'
  );
});
```

Match the file's existing import list and `ConfigDef` construction style; if `rowKind` takes a different shape there, follow the existing tests rather than this sketch.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun test apps/board/src/client/__tests__/config-shapes.test.ts`

Expected: FAIL. `mattstack.roster` has no shape row, and `rosterSummary` reports `2 hidden` for the first case.

- [ ] **Step 3: Add the shape row and fix the hidden count**

In `config-shapes.ts`, add to `COMPOSITE_SHAPES` beside the existing roster rows:

```ts
  'mattstack.roster': { kind: 'roster' },
```

And rewrite `rosterSummary` so the overlay, when present, is the whole answer:

```ts
export function rosterSummary(members: unknown, hidden: unknown): string {
  const roster = Array.isArray(members) ? members.filter(isRecord) : [];
  if (roster.length === 0) return 'no members';
  // board.hiddenMembers REPLACES the roster's inline flags in
  // withBoardStoreFallback, so counting both would report someone the
  // overlay has already checked back in.
  const overlay = Array.isArray(hidden)
    ? hidden.filter((h): h is string => typeof h === 'string')
    : null;
  const hiddenNames = new Set<string>(
    overlay ??
      roster
        .filter(m => m.hidden === true && typeof m.username === 'string')
        .map(m => m.username as string)
  );
  const head = `${roster.length} member${roster.length === 1 ? '' : 's'}`;
  return hiddenNames.size > 0 ? `${head}, ${hiddenNames.size} hidden` : head;
}
```

- [ ] **Step 4: Apply the same replace-not-union rule to `RosterControl`'s `hiddenSet`**

In `ConfigModal.tsx`, replace the `hiddenSet` construction with:

```ts
  // Same rule as rosterSummary and withBoardStoreFallback: the user overlay
  // replaces the roster's inline flags rather than adding to them.
  const overlay = Array.isArray(hidden)
    ? (hidden as unknown[]).filter((u): u is string => typeof u === 'string')
    : null;
  const hiddenSet = new Set<string>(
    overlay ??
      roster
        .filter(m => m.hidden === true && typeof m.username === 'string')
        .map(m => m.username as string)
  );
```

This is what makes the settings modal and the roster panel agree about who is checked out.

- [ ] **Step 5: Widen `edit` to carry a name and a rename action**

In `RosterControl`, replace the `edit` callback:

```ts
  const edit = async (
    action: 'add' | 'remove' | 'rename',
    username: string,
    name?: string
  ) => {
    setBusy(true);
    setError(null);
    const res = await postAction('/roster', { action, username, name });
    setBusy(false);
    if (!res.ok) {
      setError(res.text || `could not ${action} ${username}`);
      return;
    }
    setArmed(null);
    if (action === 'add') {
      setAdding('');
      setAddingName('');
    }
    setRenaming(null);
    // The write went through /roster (server-validated), so the kit's cached
    // defs are stale until told otherwise.
    onSaved();
  };
```

Add the two new pieces of state beside the existing `adding`:

```ts
  const [addingName, setAddingName] = useState('');
  // The username whose name is being edited inline, if any.
  const [renaming, setRenaming] = useState<string | null>(null);
```

- [ ] **Step 6: Add the name input to the add form**

In the `<form className="tui-roster-add">`, change `onSubmit` to send the name and add the second input between the username input and the submit button:

```tsx
        onSubmit={e => {
          e.preventDefault();
          const handle = adding.trim();
          if (handle && !busy) void edit('add', handle, addingName.trim());
        }}
```

```tsx
        <input
          className="tui-modal-input"
          value={addingName}
          onChange={e => setAddingName(e.target.value)}
          placeholder="display name (optional)"
          aria-label="display name for the teammate being added"
          disabled={busy}
        />
```

- [ ] **Step 7: Add inline rename to each roster row**

Replace the `<span className="tui-roster-who">` block in the row map so a click on the name opens an input. The row keeps its existing drop button untouched.

```tsx
              {renaming === username ? (
                <TextField
                  value={name ?? ''}
                  placeholder="display name"
                  ariaLabel={`display name for ${username}`}
                  disabled={busy}
                  onCommit={next => void edit('rename', username, next)}
                />
              ) : (
                <span className="tui-roster-who">
                  <button
                    className="tui-config-link"
                    onClick={() => setRenaming(username)}
                    title="set a display name"
                    aria-label={`rename ${username}`}
                  >
                    {name ?? username}
                  </button>
                  {name && <span className="tui-roster-handle">@{username}</span>}
                  {hiddenSet.has(username) && (
                    <span className="tui-roster-out">checked out</span>
                  )}
                </span>
              )}
```

`TextField` is already defined at the top of this file (line 71) and commits on blur or Enter, reverting on Escape, which is exactly the rename interaction wanted. Check its actual prop names before wiring; if it does not accept `disabled` or `ariaLabel`, match its real signature rather than this sketch.

- [ ] **Step 8: Confirm the rename affordance is reachable for the board owner**

The `username === self` branch renders a `you` badge instead of a drop button, but the name cell is separate, so renaming yourself must still work. Read the row's JSX after the edit and confirm the rename button is outside the `self` conditional.

- [ ] **Step 9: Run every board gate**

Run:

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle
bun run tui-kit:build && bun run board:typecheck && bun run board:test && bun run board:build
```

Expected: all green. `board:build` matters here because the client bundle is built by `client-bundle.ts` and a JSX error only surfaces at build time.

- [ ] **Step 10: Commit**

```bash
git add apps/board/src/client/board/ConfigModal.tsx apps/board/src/client/board/config-shapes.ts apps/board/src/client/__tests__/config-shapes.test.ts
git commit -m "board: name field on roster add, inline rename, overlay replaces inline hidden flags"
```

---

### Task 6: Migrate the team store and verify in the running board

The code now reads `mattstack.roster` first. This task moved the data so it actually had something to read, and added display names for two of the entries. The migration has already been performed, so this section is now a historical record of the procedure, not a script to re-run: the roster below is a placeholder shape, not this team's real membership.

**Files:** none. This task writes the team settings store through `rt settings set` and verifies the result.

**Interfaces:**
- Consumes: Tasks 1-5, all merged and green.
- Produces: nothing.

- [ ] **Step 1: Flag the consequence and get a go-ahead**

Tell Matt, in one line, that this write drops a handful of usernames (shape only: `gil` (Gil Ortiz), `hana`, and `quinn-at-acme`, the last with an employer name baked into the handle itself, matching the reason this repo has a purity gate) from `mattstack.roster`, which is the roster boxscore's leaderboard reads, and that some of the dropped usernames are already in his `board.hiddenMembers` overlay. Wait for confirmation before Step 3. Do not skip this step: it is a shared team-store write that changes another app's behavior.

- [ ] **Step 2: Capture the current values so the write is reversible**

```bash
rt settings explain mattstack.roster
rt settings explain board.members
```

Paste both team-scope values into the task report. The team store is git-backed, so `git -C ~/.mattstack/teams/testteam log -1` also gives a restore point; record that SHA.

- [ ] **Step 3: Write the merged roster**

`board.members` is authoritative. Its entries, plus the display names supplied for two of them, minus the inline `hidden` flag (which `board.hiddenMembers` owns and `mattstack.roster` does not carry). The shape is `{username, name?}` per entry; the command below shows that shape with placeholder people, not the real roster:

```bash
rt settings set mattstack.roster --scope team '[
  {"username":"ann","name":"Ann Lee"},
  {"username":"bo","name":"Bo Chen"},
  {"username":"cy","name":"Cy Park"},
  {"username":"dee","name":"Dee Fox"},
  {"username":"alice","name":"Alice Shaw"},
  {"username":"bob","name":"Bob Ng"}
]'
```

Pull the operator's actual usernames and names from that install's own `rt settings explain board.members` output at the time of the write; do not carry values out of this document into a real `rt settings set` call.

- [ ] **Step 4: Verify resolution**

```bash
rt settings explain mattstack.roster
```

Expected: the team row shows every entry with a name. `board.members` is left in place untouched: it is now dead weight behind the fallback, and leaving it is the cheap rollback (unset `mattstack.roster` and the board is exactly where it started).

- [ ] **Step 5: Rebuild and restart the board, then check the roster panel**

Per CLAUDE.md's deck serving note, deck's health check only proves `/api` is up and does not build the UI, so a stale `dist/` will 404 while `/api` stays healthy.

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle && bun run board:build
```

Then ask Matt to confirm in the running board that a member with a stored name shows it instead of a raw username, that the settings modal and the roster panel now agree on who is checked out, and that adding someone with a name and renaming someone both stick. Ask before driving a browser yourself: per the ask-before-browser-verification rule, Matt likely has the board open already.

- [ ] **Step 6: Note the team-store push**

`setSetting` prints the reminder itself: a team write stays local until committed and pushed from `~/.mattstack/teams/testteam`. Surface that to Matt rather than pushing on his behalf.

- [ ] **Step 7: Commit the plan doc and open the PR**

```bash
cd /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/proud-jungle
git add apps/board/docs/superpowers/plans/2026-09-08-roster-adoption.md
git commit -m "board: plan for mattstack.roster adoption"
git push -u origin board-roster-adopt
```

Then open the PR against `main` in `m4ttstack/apps`. Per Matt's CLAUDE.md, wait for CodeRabbit's review and address all actionable findings, and wait for CI green, before proposing a merge.

---

## Self-Review

**Spec coverage.** The four approved decisions each map to tasks: adoption to Tasks 1-2, name precedence to Task 3, rename to Task 4-5, the data migration to Task 6. The name-on-add gap that started this (server already accepted `name`, client never sent it) is Task 5 Step 6.

**Two things the plan adds beyond the four decisions, both deliberate:**
1. Stripping `hidden` on a `mattstack.roster` write (Task 2). Not requested, but writing `hidden` into a key whose declared shape is `[{username, name?}]` would put board-only state into boxscore's roster. This is a correctness requirement of decision 1, not scope creep.
2. The `rosterSummary` / `hiddenSet` replace-not-union fix (Task 5 Steps 3-4). This is the bug behind a member reading "checked out" in the settings modal while checked-in in the roster panel. It is one line in each of two places and sits in exactly the code Task 5 already rewrites. If a reviewer wants it split out, it is cleanly separable.

**Known gap.** Board has no React component test harness, so the ConfigModal changes in Task 5 have no automated test. Task 4's route tests cover the server contract those controls call, and Task 6 Step 5 covers the UI by hand. Building a component harness for this change would be larger than the change.

**Type consistency.** `rosterFromStore` returns `{key, members} | null` and is used identically in Task 1 (reader, `?.members`) and Task 2 (writer, truthiness plus `.key`). `applyRosterEdit` is defined once in Task 4 and consumed by the route in the same task. `displayName` is defined in Task 3 and used at all three `refreshMemberNames` branches in the same task. `RosterStoreKey` stays module-private; nothing outside `config.ts` names it.
