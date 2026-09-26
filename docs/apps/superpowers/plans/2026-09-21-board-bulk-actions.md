# Board Bulk Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click a checked row (or press the selection bar's new actions button) to run one action on every checked MR, with each action defined once and shared by the one-row and bulk menus.

**Architecture:** `row-actions.ts` turns one MR into a list of action data (`rowActions`), and groups several MRs' lists into the bulk menu (`bulkActions`). `action-runner.ts` performs an action for one MR (today's toasts, word for word) or many (one summary toast, one reload). `ActionMenu.tsx` draws any list of entries, including the second-click, picker and note stages. `RowMenu` and the bulk menu are both thin callers of `ActionMenu`.

**Tech Stack:** React 19, TypeScript (strict, `noUncheckedIndexedAccess`), bun test with happy-dom, the kit's `ContextMenu` recipe from `@mattstack/tui-kit`.

**Spec:** `docs/superpowers/specs/2026-09-21-board-bulk-actions-design.md`. Design board: `docs/design/board/board.pen`, B11 (dark and light).

## Global Constraints

- Worktree: `/Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-app-kit/noble-lantern`, branch `board-bulk-actions`. Board paths below are relative to `apps/board/` unless they start with `docs/` or `packages/`.
- Gates, run from the worktree root: `bun run tui-kit:build` (once, before any board typecheck or test), `bun run board:typecheck`, `bun run board:test`, `bun run format:check`, `bash scripts/repo-purity.sh`.
- Format every file you touch with `bunx prettier --write <files>` before committing.
- No em dashes or en dashes in anything you write: code, comments, strings, test names, commit messages. Use "..." or rephrase.
- Matt bans the two-word phrase that today's `RowMenu` comment `THE KEY IS ...` uses. Never write it; `ActionMenu`'s replacement comment in Task 4 is already reworded.
- Comments state only constraints the code cannot show. No narration, no reviewer-facing justification, no task numbers or process history in source.
- Test data uses invented names only (`pat`, `kim`, `jo`, `matt`, `gitlab.example.com`); the purity gate scans the whole tree.
- The one-row menu must not change. After Task 1, never edit an assertion or inline snapshot in `src/client/board/__tests__/row-menu-pins-dom.test.tsx` or `row-menu-ask-dom.test.tsx`, and never run `bun test -u` or `--update-snapshots`. In `row-menu-harness.tsx`, only `renderRowMenu`, its imports and the `window.open` stub may change, and only in Task 4. A pin that fails is a regression to fix in the code.
- Single-row toasts stay word for word with today's `Board.tsx` handlers.
- UI validation is mandatory for any task that changes what renders: serve it, screenshot both themes in Fast Browser, and say plainly what looks wrong.
- Commit after each task. Message style: `board: <imperative summary>`, ending with the line `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/client/board/__tests__/menu-fixtures.ts` | create (T1, T2) | Test MR factory, shared menu scenarios, `actionEnvOf` |
| `src/client/board/__tests__/row-menu-harness.tsx` | create (T1), modify (T4) | Renders `RowMenu`, records every click as an effect string |
| `src/client/board/__tests__/row-menu-pins-dom.test.tsx` | create (T1) | Inline-snapshot pins of today's one-row menu |
| `src/client/board/__tests__/row-menu-ask-dom.test.tsx` | modify (T1) | Existing ask and stand-down tests, moved onto the harness |
| `src/client/board/row-actions.ts` | create (T2), modify (T5) | Action data: `rowActions`, `bulkActions`, shared types |
| `src/client/board/__tests__/row-actions.test.ts` | create (T2), modify (T5) | Unit tests for both |
| `src/client/board/launch-flow.ts` | modify (T3) | `runLaunchFlow` returns the server result |
| `src/client/board/hooks.ts` | modify (T3) | `useLaunchAction` returns that promise and takes `quiet` |
| `src/client/board/action-runner.ts` | create (T3) | `runOne`, `runMany`, `runBulk`, `dispatchRowAction` |
| `src/client/board/__tests__/action-runner.test.ts` | create (T3) | Unit tests for the runner |
| `src/__tests__/client-api.test.ts` | modify (T3) | Launch flow return value |
| `src/client/board/ActionMenu.tsx` | create (T4) | Generic menu renderer and its stages |
| `src/client/board/RowMenu.tsx` | rewrite (T4) | `rowActions` into `ActionMenu`, plus live Slack marks |
| `src/client/board/Board.tsx` | modify (T4, T6) | Runner wiring, handler collapse, bulk menu |
| `src/view.ts` | modify (T5) | Export `stackParents` |
| `src/selection.ts` | modify (T6) | `menuActsOnSelection` |
| `src/__tests__/selection.test.ts` | modify (T6) | Its test |
| `src/client/board/SelectionBar.tsx` | modify (T6) | The actions button |
| `src/client/board/icons.tsx` | modify (T6) | `checks` and `chevron` menu glyphs |
| `src/style.css` | modify (T6) | Blocked item layout |
| `src/client/board/__tests__/bulk-menu-dom.test.tsx` | create (T6) | Board-level bulk menu tests |

---

### Task 1: Pin today's one-row menu

**Files:**
- Create: `src/client/board/__tests__/menu-fixtures.ts`
- Create: `src/client/board/__tests__/row-menu-harness.tsx`
- Create: `src/client/board/__tests__/row-menu-pins-dom.test.tsx`
- Modify: `src/client/board/__tests__/row-menu-ask-dom.test.tsx` (full rewrite onto the harness)

**Interfaces:**
- Produces (used by T2, T4, T5, T6): from `menu-fixtures.ts`: `MR_URL(iid: number): string`, `mrx(iid: number, over?: Record<string, unknown>): BoardMRWithReview`, `interface MenuEnv { self: string | null; local?: boolean; slackEnabled?: boolean; roster?: string[]; peers?: string[]; allMrs?: BoardMR[] }`, scenario constants `ownIdle`, `ownEnv`, `teammateReviewed`, `ownBusy`, `busyEnv`, `failedLanes`, `failedEnv`, `ROSTER`.
- Produces from `row-menu-harness.tsx`: `useMenuHarness()`, `harness: { effects: Effect[]; closed: boolean }`, `openMenu(mr, env, opts?)`, `closeMenu()`, `menuLines()`, `itemTexts()`, `clickItem(text, init?)`, `typeNote(text)`, `flush()`, `clickEach(mr, env)`.

This task writes tests only. It pins what the menu shows and what each click does, recorded as effect strings (`mr:merge`, `launch:review:focus`, `ask:review:kim`, ...) that do not name `RowMenu`'s props. Task 4 changes those props and only swaps the harness's `renderRowMenu`.

- [ ] **Step 1: Create the fixtures module**

`src/client/board/__tests__/menu-fixtures.ts`:

```ts
import type { BoardMR } from '../../../data.ts';
import type { BoardMRWithReview } from '../../types.ts';

export const MR_URL = (iid: number) =>
  `https://gitlab.example.com/acme/webapp/-/merge_requests/${iid}`;

export function mrx(
  iid: number,
  over: Record<string, unknown> = {}
): BoardMRWithReview {
  return {
    iid,
    title: 'Port the flows',
    webUrl: MR_URL(iid),
    sourceBranch: `f-${iid}`,
    targetBranch: 'main',
    author: { username: 'pat', name: 'Pat' },
    reviews: { isApproved: false, required: 0, given: 0, reviewers: [] },
    reviewerComments: 0,
    blockers: { any: false },
    mergeButton: { visible: false, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 0,
    isDraft: false,
    isStacked: false,
    gates: [],
    ...over,
  } as never;
}

export interface MenuEnv {
  self: string | null;
  local?: boolean;
  slackEnabled?: boolean;
  roster?: string[];
  peers?: string[];
  allMrs?: BoardMR[];
}

export const ROSTER = ['pat', 'kim', 'jo'];

export const ownIdle = mrx(1418, {
  mergeButton: { visible: true, disabled: false, loading: false },
  behindTarget: 3,
  autoMergeButton: { visible: true, isActive: false },
  slack: { status: 'notfound', reactions: [], posted: false },
});
export const ownEnv: MenuEnv = {
  self: 'pat',
  slackEnabled: true,
  roster: ROSTER,
};

export const teammateReviewed = mrx(1419, {
  author: { username: 'kim', name: 'Kim' },
  reviews: { isApproved: false, required: 0, given: 1, reviewers: [] },
  review: {
    status: 'done',
    outcome: 'comment',
    reportReady: true,
    sessionId: 'rev-1',
  },
  slack: {
    status: 'found',
    reactions: ['white_check_mark'],
    permalink: 'https://slack.example.com/archives/C1/p1',
    posted: true,
  },
});

export const ownBusy = mrx(1420, {
  isDraft: true,
  blockers: { any: true, pipelineFailing: true },
  review: { status: 'reviewing', sessionId: 'rev-2' },
  respond: { status: 'implementing', sessionId: 'resp-2' },
  orphan: { state: 'gone', sessionId: 'resp-2' },
  note: 'check the flags first',
});
const stackedOnBusy = mrx(1421, { isStacked: true, targetBranch: 'f-1420' });
export const busyEnv: MenuEnv = {
  self: 'pat',
  roster: ROSTER,
  allMrs: [ownBusy, stackedOnBusy],
};

export const failedLanes = mrx(1422, {
  blockers: { any: true, hasConflicts: true },
  review: { status: 'error', message: 'nothing to review' },
  respond: { status: 'done', sessionId: 'resp-3' },
  doctor: { status: 'error' },
  standDown: true,
  peerReviews: [
    {
      mrUrl: MR_URL(1422),
      iid: 1422,
      reviewer: 'kim',
      status: 'done',
      outcome: 'comment',
      updatedAt: 1,
    },
  ],
});
export const failedEnv: MenuEnv = {
  self: 'pat',
  slackEnabled: true,
  roster: ROSTER,
};
```

- [ ] **Step 2: Create the harness**

`src/client/board/__tests__/row-menu-harness.tsx`:

```tsx
/** Render harness for the row menu's DOM tests. Every call the menu makes is
    recorded as an effect string ("mr:merge", "launch:review:focus"), so the
    pins describe what a click does without naming the props that carry it.
    When RowMenu's props change, only renderRowMenu changes; the pins must
    not. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll } from 'bun:test';

import type { BoardMR } from '../../../data.ts';
import { hasStackDescendants } from '../../../view.ts';
import type { BoardMRWithReview, RowContext } from '../../types.ts';
import type { MenuEnv } from './menu-fixtures.ts';

export interface Effect {
  effect: string;
  iid: number;
  note?: string;
}

export const harness: { effects: Effect[]; closed: boolean } = {
  effects: [],
  closed: false,
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let RowMenu: typeof import('../RowMenu.tsx').RowMenu;
let root: ReturnType<typeof import('react-dom/client').createRoot> | null =
  null;
let container: HTMLDivElement | null = null;

export function useMenuHarness(): void {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  (
    globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  beforeAll(async () => {
    React = await import('react');
    ({ createRoot } = await import('react-dom/client'));
    ({ RowMenu } = await import('../RowMenu.tsx'));
  });
  afterEach(async () => {
    await closeMenu();
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });
}

function record(effect: string, mr: { iid: number }, note?: string): void {
  harness.effects.push(
    note === undefined ? { effect, iid: mr.iid } : { effect, iid: mr.iid, note }
  );
}

function renderRowMenu(
  mr: BoardMRWithReview,
  env: MenuEnv,
  reactionsReply: string[] | null
) {
  const self = env.self;
  const own = self !== null && mr.author.username === self;
  const ctx = {
    local: env.local ?? true,
    self,
    slackTemplates: {},
    slackEnabled: env.slackEnabled ?? false,
    onOpenReview: (m: BoardMR) => record('view-report:review', m),
    onOpenRespond: (m: BoardMR) => record('view-report:respond', m),
    onResumeRespond: (m: BoardMR, note?: string) =>
      record('launch:resume-respond', m, note),
    onDismissLane: (m: BoardMR, lane: string) => record(`dismiss:${lane}`, m),
    onStandDown: (m: BoardMR, on: boolean) => record(`stand-down:${on}`, m),
    onEditNote: () => record('note', mr),
  } as unknown as RowContext;
  const launch =
    (flow: string) =>
    (m: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      record(
        intent === 'focus' ? `launch:${flow}:focus` : `launch:${flow}`,
        m,
        note
      );
  return (
    <RowMenu
      menu={{ x: 10, y: 10, mr }}
      ctx={ctx}
      onClose={() => {
        harness.closed = true;
      }}
      onLaunch={launch('review')}
      onReReview={launch('re-review')}
      onResumeReview={launch('resume-review')}
      onRespond={launch('respond')}
      canRespond={own}
      onDoctor={launch('doctor')}
      canDoctor={!!(mr.blockers?.pipelineFailing || mr.blockers?.hasConflicts)}
      onRebaseLocal={launch('rebase-local')}
      onCopy={m => record('copy', m)}
      onResolveSlack={m => record('find-thread', m)}
      onReactSlack={async (m, emoji, remove) => {
        record(`react:${emoji}:${remove}`, m);
        return reactionsReply;
      }}
      onPostSlack={m => record('post-slack', m)}
      canStandDown={own}
      mrHasStackDescendants={hasStackDescendants(mr, env.allMrs ?? [mr])}
      onDraftState={(m, draft) => record(`draft:${draft}`, m)}
      canDraftState={own}
      onMrAction={(m, action) => record(`mr:${action}`, m)}
      onNudge={(m, reviewer) => record(`ask:re-review:${reviewer}`, m)}
      canNudge={own}
      roster={env.roster ?? []}
      onRequestReview={(m, reviewer) => record(`ask:review:${reviewer}`, m)}
      canAskRespond={self !== null && !own}
      onAskRespond={(m, reviewer) => record(`ask:respond:${reviewer}`, m)}
      peers={env.peers}
    />
  );
}

export async function openMenu(
  mr: BoardMRWithReview,
  env: MenuEnv,
  opts: { reactionsReply?: string[] | null } = {}
): Promise<void> {
  await closeMenu();
  harness.effects = [];
  harness.closed = false;
  window.open = ((url?: string | URL) => {
    record(`open:${String(url)}`, mr);
    return null;
  }) as typeof window.open;
  const el = document.createElement('div');
  document.body.appendChild(el);
  const r = createRoot(el);
  container = el;
  root = r;
  await React.act(async () => {
    r.render(renderRowMenu(mr, env, opts.reactionsReply ?? null));
  });
}

export async function closeMenu(): Promise<void> {
  const r = root;
  if (r) await React.act(async () => r.unmount());
  container?.remove();
  root = null;
  container = null;
}

/** The open menu, top to bottom: `# label`, item text, `---` separator. */
export function menuLines(): string[] {
  const menu = document.querySelector('[data-part="contextmenu"]');
  if (!menu) return [];
  return [...menu.children].map(el => {
    const part = el.getAttribute('data-part');
    if (part === 'contextmenu-label') return `# ${el.textContent}`;
    if (part === 'contextmenu-separator') return '---';
    if (el.tagName === 'TEXTAREA') return '[note box]';
    return el.textContent ?? '';
  });
}

export function itemTexts(): string[] {
  return [...document.querySelectorAll('[role="menuitem"]')].map(
    el => el.textContent ?? ''
  );
}

export async function clickItem(
  text: string,
  init: MouseEventInit = {}
): Promise<void> {
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const hit =
    items.find(el => el.textContent === text) ??
    items.find(el => el.textContent?.includes(text));
  if (!hit) {
    throw new Error(
      `no menu item "${text}" in: ${items.map(el => el.textContent).join(' | ')}`
    );
  }
  await React.act(async () => {
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  });
}

export async function typeNote(text: string): Promise<void> {
  const ta = document.querySelector<HTMLTextAreaElement>('textarea.tui-menu-note');
  if (!ta) throw new Error('no note box');
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )!.set!;
  await React.act(async () => {
    setValue.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await React.act(async () => {
    ta.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
  });
}

export async function flush(): Promise<void> {
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

/** Opens the menu fresh for every item, clicks it (and its confirm or first
    pick, when it has one), and reports `label → effects`. */
export async function clickEach(
  mr: BoardMRWithReview,
  env: MenuEnv
): Promise<string[]> {
  await openMenu(mr, env);
  const labels = itemTexts();
  const out: string[] = [];
  for (const label of labels) {
    await openMenu(mr, env);
    await clickItem(label);
    const armed = harness.closed
      ? undefined
      : itemTexts().find(t => t.startsWith('really'));
    if (armed) await clickItem(armed);
    if (!harness.closed && menuLines()[0] === '# request review from')
      await clickItem(itemTexts()[0]!);
    const fx = harness.effects.map(e => e.effect).join(', ') || '(nothing)';
    out.push(`${label} → ${fx}${harness.closed ? '' : ' (stays open)'}`);
  }
  await closeMenu();
  return out;
}
```

- [ ] **Step 3: Write the pins with empty inline snapshots**

`src/client/board/__tests__/row-menu-pins-dom.test.tsx`:

```tsx
/** Pins of the one-row menu as it stands before the shared action model:
    what each MR state shows and what each click does. These must pass
    unchanged while RowMenu moves onto ActionMenu. */
import { expect, test } from 'bun:test';

import {
  busyEnv,
  failedEnv,
  failedLanes,
  ownBusy,
  ownEnv,
  ownIdle,
  teammateReviewed,
} from './menu-fixtures.ts';
import {
  clickEach,
  clickItem,
  flush,
  harness,
  itemTexts,
  menuLines,
  openMenu,
  typeNote,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

test('own idle MR, local, slack thread not found, gitlab buttons up', async () => {
  await openMenu(ownIdle, ownEnv);
  expect(menuLines()).toMatchInlineSnapshot();
  expect(await clickEach(ownIdle, ownEnv)).toMatchInlineSnapshot();
});

test("teammate's MR after my commented review, slack thread found", async () => {
  await openMenu(teammateReviewed, ownEnv);
  expect(menuLines()).toMatchInlineSnapshot();
  expect(await clickEach(teammateReviewed, ownEnv)).toMatchInlineSnapshot();
});

test('own MR with lanes running, a broken pipeline, a draft and a stack above it', async () => {
  await openMenu(ownBusy, busyEnv);
  expect(menuLines()).toMatchInlineSnapshot();
  expect(await clickEach(ownBusy, busyEnv)).toMatchInlineSnapshot();
});

test('failed lanes, finished respond, conflicts and a peer review with comments', async () => {
  await openMenu(failedLanes, failedEnv);
  expect(menuLines()).toMatchInlineSnapshot();
  expect(await clickEach(failedLanes, failedEnv)).toMatchInlineSnapshot();
});

test('a remote board keeps only what needs no local server', async () => {
  const env = { ...ownEnv, local: false };
  await openMenu(ownIdle, env);
  expect(menuLines()).toMatchInlineSnapshot();
  expect(await clickEach(ownIdle, env)).toMatchInlineSnapshot();
});

test('merge takes two clicks: the first arms it, the second merges', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('merge');
  expect(harness.effects).toEqual([]);
  expect(harness.closed).toBe(false);
  expect(itemTexts()).toContain('really merge?');
  await clickItem('really merge?');
  expect(harness.effects).toEqual([{ effect: 'mr:merge', iid: 1418 }]);
  expect(harness.closed).toBe(true);
});

test('alt-click on a launch opens the note box and Enter launches with the note', async () => {
  await openMenu(ownIdle, ownEnv);
  await clickItem('review', { altKey: true });
  expect(harness.effects).toEqual([]);
  expect(menuLines()).toMatchInlineSnapshot();
  await typeNote('focus on the migration');
  expect(harness.effects).toEqual([
    { effect: 'launch:review', iid: 1418, note: 'focus on the migration' },
  ]);
  expect(harness.closed).toBe(true);
});

test('a slack mark keeps the menu open and shows its check once the reply lands', async () => {
  await openMenu(teammateReviewed, ownEnv, {
    reactionsReply: ['eyes', 'white_check_mark'],
  });
  await clickItem('mark as looking');
  await flush();
  expect(harness.effects).toEqual([{ effect: 'react:eyes:false', iid: 1419 }]);
  expect(harness.closed).toBe(false);
  expect(
    itemTexts().some(t => t.includes('unmark looking') && t.endsWith('✓'))
  ).toBe(true);
});
```

- [ ] **Step 4: Run the pins so bun fills the inline snapshots**

Run: `cd apps/board && bun test src/client/board/__tests__/row-menu-pins-dom.test.tsx`
Expected: PASS, with output like `snapshots: +11 added`. The test file now has every `toMatchInlineSnapshot(...)` filled in.

- [ ] **Step 5: Read every filled snapshot against today's `RowMenu.tsx`**

Open the test file and check each snapshot line by line against `src/client/board/RowMenu.tsx`. These spot checks must hold (if one does not, the harness or fixture is wrong; fix that, delete the filled snapshot text back to `toMatchInlineSnapshot()`, and re-run Step 4):
- own idle `menuLines` starts `# !1418`, `# agent actions`, then `review`, `respond`, `rebase locally`, `auto-doctor: ignore this MR`, `request review from…`, then `---`, `# gitlab`, `merge`, `rebase on target`, `set auto-merge`, `mark as draft`, `open in gitlab`, `---`, `# slack`, `no thread, find it again`, `post to slack`, `copy for slack`, `add a note`.
- own idle `clickEach` has `merge → mr:merge` and `request review from… → ask:review:kim` (the author is never offered, so the first pick is `kim`).
- teammate `clickEach` has `re-review → launch:re-review`, `resume review → launch:resume-review`, `ask kim's agent to respond → ask:respond:kim`, and the three Slack marks each ending ` (stays open)`, with the approved one as `react:white_check_mark:true`.
- busy `clickEach` has `focus review → launch:review:focus`, `relaunch response → launch:respond:focus`, `call doctor → launch:doctor`, `mark ready → draft:false`, `auto-doctor: ignore this stack → stand-down:true`, `edit note → note`.
- failed `clickEach` has `dismiss review line → dismiss:review`, `dismiss doctor line → dismiss:doctor`, `re-enable auto-doctor → stand-down:false`, `ask kim's agent to re-review → ask:re-review:kim`, `request review from… → ask:review:jo`.
- remote `menuLines` has no `# agent actions` items other than `auto-doctor: ignore this MR`, and no Slack items but `copy for slack` and `add a note`.

- [ ] **Step 6: Move the existing ask tests onto the harness**

Replace the whole of `src/client/board/__tests__/row-menu-ask-dom.test.tsx` with:

```tsx
import { expect, test } from 'bun:test';

import { MR_URL, mrx } from './menu-fixtures.ts';
import {
  clickItem,
  harness,
  itemTexts,
  openMenu,
  useMenuHarness,
} from './row-menu-harness.tsx';

useMenuHarness();

const URL = MR_URL(1418);

test('own MR with free roster members offers the picker and fires the ask', async () => {
  await openMenu(mrx(1418), { self: 'pat', roster: ['pat', 'kim', 'jo'] });
  await clickItem('request review from…');
  // Second stage lists only the free members -- never the author.
  expect(itemTexts().some(t => t.includes('pat'))).toBe(false);
  await clickItem('kim');
  expect(harness.effects).toEqual([{ effect: 'ask:review:kim', iid: 1418 }]);
});

test('engaged peers and an outstanding ask hide the item', async () => {
  await openMenu(
    mrx(1418, {
      peerReviews: [
        { mrUrl: URL, iid: 1418, reviewer: 'kim', status: 'reviewing', updatedAt: 1 },
        {
          mrUrl: URL,
          iid: 1418,
          reviewer: 'jo',
          status: 'done',
          outcome: 'comment',
          updatedAt: 1,
        },
      ],
    }),
    { self: 'pat', roster: ['pat', 'kim', 'jo'] }
  );
  expect(itemTexts().some(t => t.includes('request review from'))).toBe(false);
});

test("a commented review on a teammate's MR offers the respond ask", async () => {
  await openMenu(
    mrx(1418, {
      author: { username: 'kim', name: 'Kim' },
      review: { status: 'done', outcome: 'comment' },
    }),
    { self: 'pat', roster: ['pat', 'kim'] }
  );
  await clickItem("ask kim's agent to respond");
  expect(harness.effects).toEqual([{ effect: 'ask:respond:kim', iid: 1418 }]);
});

test('no respond ask without a commented review of mine', async () => {
  await openMenu(mrx(1418, { author: { username: 'kim', name: 'Kim' } }), {
    self: 'pat',
    roster: ['pat', 'kim'],
  });
  expect(itemTexts().some(t => t.includes('agent to respond'))).toBe(false);
});

test('a known enrollment list narrows the picker to enrolled members', async () => {
  await openMenu(mrx(1418), {
    self: 'pat',
    roster: ['pat', 'kim', 'jo'],
    peers: ['kim'],
  });
  await clickItem('request review from…');
  expect(itemTexts().some(t => t.includes('kim'))).toBe(true);
  expect(itemTexts().some(t => t.includes('jo'))).toBe(false);
});

test("the stand-down item is hidden on someone else's MR", async () => {
  await openMenu(mrx(1418), { self: 'kim', roster: ['pat'] });
  expect(itemTexts().some(t => t.includes('auto-doctor'))).toBe(false);
});

test('a standalone MR offers "ignore this MR" and fires on: true', async () => {
  await openMenu(mrx(1418), { self: 'pat', roster: ['pat'] });
  await clickItem('auto-doctor: ignore this MR');
  expect(harness.effects).toEqual([{ effect: 'stand-down:true', iid: 1418 }]);
});

test('an MR with its own descendants offers "ignore this stack" instead', async () => {
  const mr = mrx(1418);
  const child = mrx(1500, { isStacked: true, targetBranch: 'f-1418' });
  await openMenu(mr, { self: 'pat', roster: ['pat'], allMrs: [mr, child] });
  await clickItem('auto-doctor: ignore this stack');
  expect(harness.effects).toEqual([{ effect: 'stand-down:true', iid: 1418 }]);
});

test('once stood down, the item flips to re-enable and fires on: false', async () => {
  await openMenu(mrx(1418, { standDown: true }), { self: 'pat', roster: ['pat'] });
  await clickItem('re-enable auto-doctor');
  expect(harness.effects).toEqual([{ effect: 'stand-down:false', iid: 1418 }]);
});
```

- [ ] **Step 7: Run the whole board suite and typecheck**

Run from the worktree root: `bun run tui-kit:build && bun run board:typecheck && bun run board:test`
Expected: typecheck clean; all tests PASS, including the 9 ask tests and 8 pin tests.

- [ ] **Step 8: Format and commit**

```bash
bunx prettier --write apps/board/src/client/board/__tests__/menu-fixtures.ts apps/board/src/client/board/__tests__/row-menu-harness.tsx apps/board/src/client/board/__tests__/row-menu-pins-dom.test.tsx apps/board/src/client/board/__tests__/row-menu-ask-dom.test.tsx
bun test apps/board/src/client/board/__tests__/row-menu-pins-dom.test.tsx
git add apps/board/src/client/board/__tests__
git commit -m "board: pin the one-row menu before the shared action model

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(Re-running the pins after prettier confirms the reformatted snapshots still match.)

---

### Task 2: `rowActions`, one MR's actions as data

**Files:**
- Create: `src/client/board/row-actions.ts`
- Create: `src/client/board/__tests__/row-actions.test.ts`
- Modify: `src/client/board/__tests__/menu-fixtures.ts` (add `actionEnvOf`)

**Interfaces:**
- Consumes: `menu-fixtures.ts` from Task 1; `format.ts` helpers (`reviewMenuItems`, `respondItemLabel`, `doctorItemLabel`, `laneInterrupted`, `reviewLogged`, `nudgeTargets`, `firstReviewTargets`, `respondAskTarget`, `gitlabMenuItems`, `getSlackMarks`); `laneDismissed` from `row-status.ts`; `hasStackDescendants` from `view.ts`.
- Produces (used by T3 to T6), all exported from `row-actions.ts`:
  - `type Lane = 'review' | 'respond' | 'doctor'`, `type Section = 'agent' | 'gitlab' | 'slack'`
  - `type ActionGlyph`, `type LaunchFlow`, `type ActionRequest` (exact unions below)
  - `interface MenuEntry`, `interface RowAction extends MenuEntry { request: ActionRequest; bulk?: string }`
  - `interface ActionEnv { local; slackEnabled; self: string | null; roster: string[]; peers?: string[]; allMrs: BoardMR[] }`
  - `interface RunOpts { note?: string; pick?: string }`
  - `rowActions(mrx: BoardMRWithReview, env: ActionEnv): RowAction[]`
  - From `menu-fixtures.ts`: `actionEnvOf(env: MenuEnv, mr: BoardMR): ActionEnv`

Nothing renders from this yet; `RowMenu` switches to it in Task 4.

- [ ] **Step 1: Add `actionEnvOf` to the fixtures**

Append to `src/client/board/__tests__/menu-fixtures.ts` (and add the import at the top):

```ts
import type { ActionEnv } from '../row-actions.ts';
```

```ts
export function actionEnvOf(env: MenuEnv, mr: BoardMR): ActionEnv {
  return {
    local: env.local ?? true,
    slackEnabled: env.slackEnabled ?? false,
    self: env.self,
    roster: env.roster ?? [],
    peers: env.peers,
    allMrs: env.allMrs ?? [mr],
  };
}
```

- [ ] **Step 2: Write the failing tests**

`src/client/board/__tests__/row-actions.test.ts`:

```ts
import { expect, test } from 'bun:test';

import { rowActions } from '../row-actions.ts';
import {
  actionEnvOf,
  busyEnv,
  failedEnv,
  failedLanes,
  ownBusy,
  ownEnv,
  ownIdle,
  teammateReviewed,
} from './menu-fixtures.ts';

const keys = (mr: typeof ownIdle, env: typeof ownEnv) =>
  rowActions(mr, actionEnvOf(env, mr)).map(a => a.key);

test('an idle own MR offers these actions, in menu order', () => {
  expect(keys(ownIdle, ownEnv)).toEqual([
    'review',
    'respond',
    'rebase-local',
    'stand-down',
    'request-review',
    'merge',
    'rebase',
    'setAutoMerge',
    'mark-draft',
    'open-gitlab',
    'find-thread',
    'post-slack',
    'copy',
    'note',
  ]);
});

test("a teammate's reviewed MR with a found thread", () => {
  expect(keys(teammateReviewed, ownEnv)).toEqual([
    're-review',
    'resume-review',
    'view-review',
    'ask-respond',
    'open-gitlab',
    'react-eyes',
    'react-speech_balloon',
    'unreact-white_check_mark',
    'open-slack-post',
    'copy',
    'note',
  ]);
});

test('a remote board keeps the stand-down toggle and the local-free items', () => {
  expect(keys(ownIdle, { ...ownEnv, local: false })).toEqual([
    'stand-down',
    'open-gitlab',
    'copy',
    'note',
  ]);
});

test('only the bulk-capable actions carry a bulk label', () => {
  const bulk = Object.fromEntries(
    rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle))
      .filter(a => a.bulk)
      .map(a => [a.key, a.bulk])
  );
  expect(bulk).toEqual({
    review: 'review',
    'request-review': 'request review from…',
    merge: 'merge',
    rebase: 'rebase on target',
    setAutoMerge: 'set auto-merge',
    'mark-draft': 'mark as draft',
    'find-thread': 'find slack threads',
  });
});

test('running lanes focus their pane and carry no note or bulk', () => {
  const actions = rowActions(ownBusy, actionEnvOf(busyEnv, ownBusy));
  const focusReview = actions.find(a => a.key === 'focus-review');
  expect(focusReview?.request).toEqual({
    kind: 'launch',
    flow: 'review',
    intent: 'focus',
  });
  expect(focusReview?.notable).toBeUndefined();
  expect(focusReview?.bulk).toBeUndefined();
  expect(actions.find(a => a.key === 'focus-respond')?.label).toBe(
    'relaunch response'
  );
  expect(actions.find(a => a.key === 'doctor')).toMatchObject({
    label: 'call doctor',
    lane: 'doctor',
    notable: true,
    bulk: 'call doctor',
    request: { kind: 'launch', flow: 'doctor' },
  });
  expect(actions.find(a => a.key === 'stand-down')?.label).toBe(
    'auto-doctor: ignore this stack'
  );
});

test('merge arms before it fires; a slack mark stays open and knows its state', () => {
  const idle = rowActions(ownIdle, actionEnvOf(ownEnv, ownIdle));
  expect(idle.find(a => a.key === 'merge')?.confirm).toBe('really merge?');
  const mates = rowActions(teammateReviewed, actionEnvOf(ownEnv, teammateReviewed));
  expect(mates.find(a => a.key === 'unreact-white_check_mark')).toMatchObject({
    label: 'unmark approved',
    marked: true,
    keepOpen: true,
    glyph: { kind: 'emoji', glyph: '✅' },
    request: { kind: 'react', emoji: 'white_check_mark', glyph: '✅', remove: true },
  });
});

test('request review from… carries its picker; asks name their reviewer', () => {
  const actions = rowActions(failedLanes, actionEnvOf(failedEnv, failedLanes));
  expect(actions.find(a => a.key === 'request-review')).toMatchObject({
    request: { kind: 'ask', ask: 'review' },
    pick: {
      title: 'request review from',
      aria: 'request review',
      options: [{ value: 'jo' }],
    },
  });
  expect(actions.find(a => a.key === 'nudge-kim')?.request).toEqual({
    kind: 'ask',
    ask: 're-review',
    reviewer: 'kim',
  });
  expect(
    actions.filter(a => a.key.startsWith('dismiss-')).map(a => a.key)
  ).toEqual(['dismiss-review', 'dismiss-doctor']);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `cd apps/board && bun test src/client/board/__tests__/row-actions.test.ts`
Expected: FAIL, `Cannot find module '../row-actions.ts'`.

- [ ] **Step 4: Write `row-actions.ts`**

`src/client/board/row-actions.ts`:

```ts
/** What the row menu offers, as data: one MR's actions come from
    rowActions. DOM-free, so the menu and its tests share it. */
import type { BoardMR } from '../../data.ts';
import type { MrAction } from '../../mr-action.ts';
import { hasStackDescendants } from '../../view.ts';
import type { BoardMRWithReview } from '../types.ts';
import {
  doctorItemLabel,
  firstReviewTargets,
  getSlackMarks,
  gitlabMenuItems,
  laneInterrupted,
  nudgeTargets,
  respondAskTarget,
  respondItemLabel,
  reviewLogged,
  reviewMenuItems,
} from './format.ts';
import { laneDismissed } from './row-status.ts';

export type Lane = 'review' | 'respond' | 'doctor';
export type Section = 'agent' | 'gitlab' | 'slack';

export type ActionGlyph =
  | {
      kind: 'menu';
      name: 'file' | 'people' | 'copy' | 'branch' | 'dismiss' | 'note';
    }
  | { kind: 'flag'; name: 'conflicts' | 'auto-merge' | 'draft' }
  | { kind: 'out' }
  | { kind: 'slack' }
  | { kind: 'emoji'; glyph: string };

export type LaunchFlow =
  | 'review'
  | 're-review'
  | 'resume-review'
  | 'respond'
  | 'resume-respond'
  | 'doctor'
  | 'rebase-local';

export type ActionRequest =
  | { kind: 'launch'; flow: LaunchFlow; intent?: 'focus' }
  | { kind: 'mr'; action: MrAction }
  | { kind: 'draft'; draft: boolean }
  | { kind: 'react'; emoji: string; glyph: string; remove: boolean }
  | { kind: 'find-thread' }
  | { kind: 'ask'; ask: 'review' | 're-review' | 'respond'; reviewer?: string }
  | { kind: 'post-slack' }
  | { kind: 'copy' }
  | { kind: 'note' }
  | { kind: 'open'; url: string }
  | { kind: 'view-report'; lane: 'review' | 'respond' }
  | { kind: 'dismiss'; lane: Lane }
  | { kind: 'stand-down'; on: boolean };

export interface MenuEntry {
  key: string;
  section: Section;
  label: string;
  /** Null for an agent action, which leads with the bot mark in its lane's
      color instead. */
  glyph: ActionGlyph | null;
  lane?: Lane;
  hint?: string;
  /** The first click arms the item and swaps its label for this; the
      second click fires it. */
  confirm?: string;
  /** Shown with this reason under the label, and never clickable. */
  blocked?: string;
  /** Alt-click opens the note box before firing. */
  notable?: boolean;
  marked?: boolean;
  /** The menu stays open while it runs, so several can be set in a row. */
  keepOpen?: boolean;
  pick?: {
    title: string;
    aria: string;
    options: Array<{ value: string; hint?: string }>;
  };
}

export interface RowAction extends MenuEntry {
  request: ActionRequest;
  /** Present only when the action can join the bulk menu: its grouped
      wording ("call doctor" covers "call doctor again" too). */
  bulk?: string;
}

export interface ActionEnv {
  local: boolean;
  slackEnabled: boolean;
  /** The board's seat; null on an "all" board. */
  self: string | null;
  roster: string[];
  /** Enrolled peer usernames when the relay has said; undefined = unknown. */
  peers?: string[];
  /** Every MR on the board, for the stack checks. */
  allMrs: BoardMR[];
}

export interface RunOpts {
  note?: string;
  pick?: string;
}

const FILE: ActionGlyph = { kind: 'menu', name: 'file' };
const PEOPLE: ActionGlyph = { kind: 'menu', name: 'people' };
const DISMISS: ActionGlyph = { kind: 'menu', name: 'dismiss' };
const COPY: ActionGlyph = { kind: 'menu', name: 'copy' };
const NOTE: ActionGlyph = { kind: 'menu', name: 'note' };
const DRAFT: ActionGlyph = { kind: 'flag', name: 'draft' };
const SLACK: ActionGlyph = { kind: 'slack' };
const GITLAB_GLYPH: Record<MrAction, ActionGlyph> = {
  merge: { kind: 'flag', name: 'conflicts' },
  rebase: { kind: 'menu', name: 'branch' },
  setAutoMerge: { kind: 'flag', name: 'auto-merge' },
  cancelAutoMerge: { kind: 'flag', name: 'auto-merge' },
};

function agentItem(
  lane: Lane,
  key: string,
  label: string,
  request: ActionRequest,
  extra: Partial<RowAction> = {}
): RowAction {
  return { key, section: 'agent', label, glyph: null, lane, request, ...extra };
}

function item(
  section: Section,
  key: string,
  label: string,
  glyph: ActionGlyph,
  request: ActionRequest,
  extra: Partial<RowAction> = {}
): RowAction {
  return { key, section, label, glyph, request, ...extra };
}

/** Every action this MR offers right now, in menu order. Only what is
    possible renders: a blocked GitLab action is absent, not greyed. */
export function rowActions(
  mrx: BoardMRWithReview,
  env: ActionEnv
): RowAction[] {
  const own = env.self !== null && mrx.author.username === env.self;
  const agent: RowAction[] = [];

  if (env.local) {
    const reviewRunning =
      mrx.review?.status === 'queued' || mrx.review?.status === 'reviewing';
    for (const it of reviewMenuItems(
      mrx.review?.status,
      laneInterrupted(mrx.orphan, mrx.review),
      reviewLogged(mrx)
    )) {
      if (reviewRunning)
        agent.push(
          agentItem('review', 'focus-review', it.label, {
            kind: 'launch',
            flow: 'review',
            intent: 'focus',
          })
        );
      else if (it.kind === 're-review')
        agent.push(
          agentItem(
            'review',
            're-review',
            it.label,
            { kind: 'launch', flow: 're-review' },
            { notable: true, bulk: 're-review' }
          )
        );
      else
        agent.push(
          agentItem(
            'review',
            'review',
            it.label,
            { kind: 'launch', flow: 'review' },
            { notable: true, bulk: 'review' }
          )
        );
    }
    if (mrx.review?.sessionId)
      agent.push(
        agentItem(
          'review',
          'resume-review',
          'resume review',
          { kind: 'launch', flow: 'resume-review' },
          { notable: true }
        )
      );
    if (own) {
      const label = respondItemLabel(
        mrx.respond?.status,
        laneInterrupted(mrx.orphan, mrx.respond)
      );
      // Both words ride the focus intent: the launch route already re-opens
      // a dead pane, the label only says which of the two it will do.
      const focuses =
        label === 'focus response' || label === 'relaunch response';
      agent.push(
        focuses
          ? agentItem('respond', 'focus-respond', label, {
              kind: 'launch',
              flow: 'respond',
              intent: 'focus',
            })
          : agentItem(
              'respond',
              'respond',
              label,
              { kind: 'launch', flow: 'respond' },
              { notable: true }
            )
      );
      if (mrx.respond?.sessionId)
        agent.push(
          agentItem(
            'respond',
            'resume-respond',
            'resume response',
            { kind: 'launch', flow: 'resume-respond' },
            { notable: true }
          )
        );
    }
    // Doctor is mechanical repair, offered on anyone's MR that is broken.
    if (mrx.blockers?.pipelineFailing || mrx.blockers?.hasConflicts) {
      const label = doctorItemLabel(mrx.doctor?.status);
      agent.push(
        label === 'focus doctor'
          ? agentItem('doctor', 'focus-doctor', label, {
              kind: 'launch',
              flow: 'doctor',
              intent: 'focus',
            })
          : agentItem(
              'doctor',
              'doctor',
              label,
              { kind: 'launch', flow: 'doctor' },
              { notable: true, bulk: 'call doctor' }
            )
      );
    }
    if (
      mrx.blockers?.hasConflicts ||
      mrx.rebaseButton.visible ||
      (mrx.behindTarget ?? 0) > 0
    )
      agent.push(
        agentItem(
          'doctor',
          'rebase-local',
          'rebase locally',
          { kind: 'launch', flow: 'rebase-local' },
          { notable: true }
        )
      );
  }
  if (mrx.review?.reportReady)
    agent.push(
      item('agent', 'view-review', 'view agent review', FILE, {
        kind: 'view-report',
        lane: 'review',
      })
    );
  if (mrx.respond?.reportReady)
    agent.push(
      item('agent', 'view-respond', 'view agent response', FILE, {
        kind: 'view-report',
        lane: 'respond',
      })
    );
  for (const lane of ['review', 'respond', 'doctor'] as const) {
    const state = mrx[lane];
    if (state?.status !== 'error' || laneDismissed(state)) continue;
    agent.push(
      item('agent', `dismiss-${lane}`, `dismiss ${lane} line`, DISMISS, {
        kind: 'dismiss',
        lane,
      })
    );
  }
  // Auto-doctor only ever acts on the seat's own MRs, so the toggle is theirs.
  // Matched by url: the MR handed in can be a copy (optimistic overlay, live
  // slack marks), and the stack walk compares objects.
  const onBoard = env.allMrs.find(m => m.webUrl === mrx.webUrl) ?? mrx;
  if (own)
    agent.push(
      item(
        'agent',
        'stand-down',
        mrx.standDown
          ? 're-enable auto-doctor'
          : `auto-doctor: ignore this ${hasStackDescendants(onBoard, env.allMrs) ? 'stack' : 'MR'}`,
        DISMISS,
        { kind: 'stand-down', on: !mrx.standDown }
      )
    );
  if (env.local && own)
    for (const peer of nudgeTargets(mrx))
      agent.push(
        item(
          'agent',
          `nudge-${peer.reviewer}`,
          `ask ${peer.reviewer}'s agent to re-review`,
          PEOPLE,
          { kind: 'ask', ask: 're-review', reviewer: peer.reviewer }
        )
      );
  const respondTarget =
    env.local && env.self !== null && !own
      ? respondAskTarget(mrx, env.peers)
      : null;
  if (respondTarget)
    agent.push(
      item(
        'agent',
        'ask-respond',
        `ask ${respondTarget}'s agent to respond`,
        PEOPLE,
        { kind: 'ask', ask: 'respond', reviewer: respondTarget }
      )
    );
  const askTargets =
    env.local && own ? firstReviewTargets(mrx, env.roster, env.peers) : [];
  if (askTargets.length)
    agent.push(
      item(
        'agent',
        'request-review',
        'request review from…',
        PEOPLE,
        { kind: 'ask', ask: 'review' },
        {
          pick: {
            title: 'request review from',
            aria: 'request review',
            options: askTargets.map(value => ({ value })),
          },
          bulk: 'request review from…',
        }
      )
    );

  const gitlab: RowAction[] = [];
  if (env.local) {
    for (const g of gitlabMenuItems(mrx)) {
      if (g.disabled) continue;
      gitlab.push(
        item(
          'gitlab',
          g.kind,
          g.label,
          GITLAB_GLYPH[g.kind],
          { kind: 'mr', action: g.kind },
          g.kind === 'merge'
            ? { bulk: g.label, confirm: 'really merge?' }
            : { bulk: g.label }
        )
      );
    }
    if (own)
      gitlab.push(
        mrx.isDraft
          ? item(
              'gitlab',
              'mark-ready',
              'mark ready',
              DRAFT,
              { kind: 'draft', draft: false },
              { bulk: 'mark ready' }
            )
          : item(
              'gitlab',
              'mark-draft',
              'mark as draft',
              DRAFT,
              { kind: 'draft', draft: true },
              { bulk: 'mark as draft' }
            )
      );
  }
  gitlab.push(
    item(
      'gitlab',
      'open-gitlab',
      'open in gitlab',
      { kind: 'out' },
      { kind: 'open', url: mrx.webUrl ?? '' }
    )
  );

  const slack: RowAction[] = [];
  const s = mrx.slack;
  if (env.local && env.slackEnabled) {
    if (s?.status === 'found') {
      const reactions = s.reactions ?? [];
      for (const m of getSlackMarks()) {
        const marked = reactions.includes(m.emoji);
        const label = marked ? `unmark ${m.word}` : `mark as ${m.word}`;
        slack.push(
          item(
            'slack',
            `${marked ? 'unreact' : 'react'}-${m.emoji}`,
            label,
            { kind: 'emoji', glyph: m.glyph },
            { kind: 'react', emoji: m.emoji, glyph: m.glyph, remove: marked },
            { marked, keepOpen: true, bulk: label }
          )
        );
      }
      if (s.permalink)
        slack.push(
          item('slack', 'open-slack-post', 'open MR post in slack', SLACK, {
            kind: 'open',
            url: s.permalink,
          })
        );
    } else {
      slack.push(
        item(
          'slack',
          'find-thread',
          s?.status === 'notfound'
            ? 'no thread, find it again'
            : 'find slack thread',
          SLACK,
          { kind: 'find-thread' },
          { bulk: 'find slack threads' }
        )
      );
      slack.push(
        item('slack', 'post-slack', 'post to slack', SLACK, {
          kind: 'post-slack',
        })
      );
    }
  }
  slack.push(
    item('slack', 'copy', 'copy for slack', COPY, { kind: 'copy' })
  );
  slack.push(
    item('slack', 'note', mrx.note ? 'edit note' : 'add a note', NOTE, {
      kind: 'note',
    })
  );

  return [...agent, ...gitlab, ...slack];
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd apps/board && bun test src/client/board/__tests__/row-actions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck, full suite, format, commit**

```bash
bun run board:typecheck && bun run board:test
bunx prettier --write apps/board/src/client/board/row-actions.ts apps/board/src/client/board/__tests__/row-actions.test.ts apps/board/src/client/board/__tests__/menu-fixtures.ts
git add apps/board/src/client/board/row-actions.ts apps/board/src/client/board/__tests__
git commit -m "board: add rowActions, one MR's menu as data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The action runner

**Files:**
- Modify: `src/client/board/launch-flow.ts` (return the result)
- Modify: `src/client/board/hooks.ts` (`useLaunchAction` returns that promise, takes `quiet`)
- Modify: `src/__tests__/client-api.test.ts` (one new test)
- Create: `src/client/board/action-runner.ts`
- Create: `src/client/board/__tests__/action-runner.test.ts`

**Interfaces:**
- Consumes: `ActionRequest`, `LaunchFlow`, `Lane`, `RunOpts` from `row-actions.ts` (Task 2); `ActionResult` from `src/client/api.ts`.
- Produces (used by T4, T6), all exported from `action-runner.ts`:
  - `interface LaunchOpts { note?: string; intent?: 'launch' | 'focus'; quiet?: boolean }`
  - `interface RunnerDeps { post(path, payload): Promise<ActionResult>; launch(flow: LaunchFlow, mr: BoardMR, opts: LaunchOpts): Promise<ActionResult | undefined>; addToast(text: string): void; reload(fresh: boolean): void }`
  - `type RunnableRequest`, `isRunnable(req): req is RunnableRequest`
  - `runOne(req: RunnableRequest, mr: BoardMR, deps: RunnerDeps, note?: string): Promise<ActionResult | undefined>`
  - `runMany(req: RunnableRequest, targets: readonly BoardMR[], deps: RunnerDeps): Promise<void>`
  - `runBulk(entry: { request: ActionRequest; targets: readonly BoardMR[]; pickTargets?: ReadonlyMap<string, readonly BoardMR[]> }, opts: RunOpts, deps: RunnerDeps): Promise<void> | undefined`
  - `interface RowHandlers { copy; note; open(url); viewReport(mr, lane); dismiss(mr, lane); standDown(mr, on); postSlack }`
  - `dispatchRowAction(req: ActionRequest, mr: BoardMR, opts: RunOpts, deps: RunnerDeps, h: RowHandlers): Promise<ActionResult | undefined> | undefined`
  - `BULK_CONCURRENCY = 4`, `mapLimit(items, limit, fn)`
- Produces from `hooks.ts`: `useLaunchAction(...)` now returns `(mr, extra?, note?, intent?, quiet?) => Promise<ActionResult | undefined>`.

- [ ] **Step 1: Write the failing launch-flow test**

Append to `src/__tests__/client-api.test.ts`:

```ts
test('launch flow returns the server result', async () => {
  const reply = { ok: true, status: 200, body: null, text: '' };
  const result = await runLaunchFlow(
    {
      post: async () => reply,
      setQueued: () => {},
      rollback: () => {},
      addToast: () => {},
      reload: () => {},
      verbing: 'launching review',
      noun: 'review',
    },
    { webUrl: 'u', iid: 7 } as never,
    {}
  );
  expect(result).toBe(reply);
});
```

Run: `cd apps/board && bun test src/__tests__/client-api.test.ts`
Expected: FAIL, `expected undefined to be ...`.

- [ ] **Step 2: Return the result from `runLaunchFlow`**

In `src/client/board/launch-flow.ts`:
- Add `import type { ActionResult } from '../api.ts';` if it is not already imported (it is, for `LaunchFlowDeps`).
- Change the signature's return type from `Promise<void>` to `Promise<ActionResult | undefined>`.
- Change `if (!mr.webUrl) return;` to `if (!mr.webUrl) return undefined;`.
- In the `if (!result.ok)` block, change both bare `return;` statements to `return result;`.
- After the final `deps.reload();`, add `return result;`.

Run: `cd apps/board && bun test src/__tests__/client-api.test.ts`
Expected: PASS.

- [ ] **Step 3: Let `useLaunchAction` return that promise and run quietly**

In `src/client/board/hooks.ts`, change `useLaunchAction`'s return type and body to:

```ts
}): (
  mr: BoardMR,
  extra?: Record<string, unknown>,
  note?: string,
  intent?: 'launch' | 'focus',
  quiet?: boolean
) => Promise<ActionResult | undefined> {
```

```ts
  return useCallback(
    (
      mr: BoardMR,
      extra: Record<string, unknown> = {},
      note?: string,
      intent?: 'launch' | 'focus',
      quiet = false
    ) => {
      const url = mr.webUrl;
      // Quiet drops this flow's toasts and reload so a bulk run can speak
      // and reload once for all of its launches; the optimistic badge stays.
      const deps: LaunchFlowDeps = {
        post: payload => postAction(path, payload),
        setQueued:
          axis && url ? () => optimistic.setQueued(axis, url) : () => {},
        rollback: axis && url ? () => optimistic.rollback(axis, url) : () => {},
        addToast: quiet ? () => {} : addToast,
        reload: quiet ? () => {} : reload,
        verbing,
        noun,
        failureMessage,
      };
      return runLaunchFlow(deps, mr, { ...extra, note }, intent);
    },
    [axis, path, verbing, noun, optimistic, addToast, reload, failureMessage]
  );
```

Add `type ActionResult` to the existing `../api.ts` import in `hooks.ts`: `import { getData, getMember, postAction, type ActionResult } from '../api.ts';`.

- [ ] **Step 4: Write the failing runner tests**

`src/client/board/__tests__/action-runner.test.ts`:

```ts
import { expect, test } from 'bun:test';

import type { BoardMR } from '../../../data.ts';
import type { ActionResult } from '../../api.ts';
import {
  dispatchRowAction,
  mapLimit,
  runBulk,
  runMany,
  runOne,
  type RowHandlers,
  type RunnerDeps,
} from '../action-runner.ts';

const ok = (body: ActionResult['body'] = null): ActionResult => ({
  ok: true,
  status: 200,
  body,
  text: '',
});
const fail = (status: number, text = ''): ActionResult => ({
  ok: false,
  status,
  body: null,
  text,
});
const mr = (iid: number) =>
  ({
    iid,
    webUrl: `https://gitlab.example.com/acme/webapp/-/merge_requests/${iid}`,
  }) as BoardMR;

function fakeDeps(reply: (payload: Record<string, unknown>) => ActionResult = () => ok()) {
  const events: string[] = [];
  const deps: RunnerDeps = {
    post: async (path, payload) => {
      events.push(`post ${path} ${JSON.stringify(payload)}`);
      return reply(payload);
    },
    launch: async (flow, m, opts) => {
      events.push(`launch ${flow} !${m.iid} ${JSON.stringify(opts)}`);
      return ok();
    },
    addToast: t => events.push(`toast ${t}`),
    reload: fresh => events.push(`reload ${fresh}`),
  };
  return { deps, events };
}

test('runOne merge: pending, post, done, fresh reload', async () => {
  const { deps, events } = fakeDeps();
  await runOne({ kind: 'mr', action: 'merge' }, mr(7), deps);
  expect(events).toEqual([
    'toast merging !7…',
    `post /mr/action {"mrUrl":"${mr(7).webUrl}","iid":7,"action":"merge"}`,
    'toast merge accepted !7',
    'reload true',
  ]);
});

test('runOne failure toasts the status and does not reload', async () => {
  const { deps, events } = fakeDeps(() => fail(409));
  await runOne({ kind: 'mr', action: 'setAutoMerge' }, mr(7), deps);
  expect(events.at(-1)).toBe("toast couldn't setAutoMerge !7 (409)");
  expect(events.some(e => e.startsWith('reload'))).toBe(false);
});

test('runOne draft words both directions', async () => {
  const a = fakeDeps();
  await runOne({ kind: 'draft', draft: false }, mr(7), a.deps);
  expect(a.events).toContain('toast marking !7 ready…');
  expect(a.events).toContain('toast !7 is ready for review');
  const b = fakeDeps();
  await runOne({ kind: 'draft', draft: true }, mr(7), b.deps);
  expect(b.events).toContain('toast !7 is back to draft');
});

test('runOne react has no pending toast and returns the reactions', async () => {
  const { deps, events } = fakeDeps(() => ok({ reactions: ['eyes'] }));
  const result = await runOne(
    { kind: 'react', emoji: 'eyes', glyph: '👀', remove: false },
    mr(7),
    deps
  );
  expect(events).toEqual([
    `post /slack/react {"mrUrl":"${mr(7).webUrl}","emoji":"eyes","remove":false}`,
    'toast marked 👀 on !7',
    'reload false',
  ]);
  expect(result?.body?.reactions).toEqual(['eyes']);
});

test('runOne find-thread says whether it found one', async () => {
  const a = fakeDeps(() => ok({ status: 'found' }));
  await runOne({ kind: 'find-thread' }, mr(7), a.deps);
  expect(a.events).toContain('toast found slack thread for !7');
  const b = fakeDeps(() => ok({ status: 'notfound' }));
  await runOne({ kind: 'find-thread' }, mr(7), b.deps);
  expect(b.events).toContain('toast no slack thread found for !7');
});

test("runOne ask prefers the server's refusal text, and says when it queued", async () => {
  const a = fakeDeps(() => fail(409, 'kim has no board on the switchboard'));
  await runOne({ kind: 'ask', ask: 'review', reviewer: 'kim' }, mr(7), a.deps);
  expect(a.events).toEqual([
    'toast requesting review of !7 from kim…',
    `post /nudge {"mrUrl":"${mr(7).webUrl}","iid":7,"reviewer":"kim","kind":"review"}`,
    'toast kim has no board on the switchboard',
  ]);
  const b = fakeDeps(() => ok({ queued: true }));
  await runOne({ kind: 'ask', ask: 'review', reviewer: 'kim' }, mr(7), b.deps);
  expect(b.events).toContain(
    'toast switchboard unreachable... queued the ask to kim'
  );
});

test('runOne launch hands off to the launch flow with the note and intent', async () => {
  const { deps, events } = fakeDeps();
  await runOne(
    { kind: 'launch', flow: 'review', intent: 'focus' },
    mr(7),
    deps,
    'look at the api'
  );
  expect(events).toEqual([
    'launch review !7 {"note":"look at the api","intent":"focus"}',
  ]);
});

test('runOne without a url does nothing', async () => {
  const { deps, events } = fakeDeps();
  const result = await runOne(
    { kind: 'find-thread' },
    { iid: 7, webUrl: null } as unknown as BoardMR,
    deps
  );
  expect(result).toBeUndefined();
  expect(events).toEqual([]);
});

test('runMany speaks once: done count, then the failures', async () => {
  const { deps, events } = fakeDeps(p => (p.iid === 3 ? fail(409) : ok()));
  await runMany({ kind: 'mr', action: 'rebase' }, [mr(1), mr(2), mr(3)], deps);
  expect(events.filter(e => e.startsWith('toast'))).toEqual([
    "toast rebase started on 2 · couldn't rebase !3 (409)",
  ]);
  expect(events.at(-1)).toBe('reload true');
});

test('runMany with every one failing lists them without a status', async () => {
  const { deps, events } = fakeDeps(() => fail(500));
  await runMany({ kind: 'mr', action: 'merge' }, [mr(1), mr(2)], deps);
  expect(events).toContain("toast couldn't merge !1, !2");
});

test('runMany launches quietly and reloads once', async () => {
  const { deps, events } = fakeDeps();
  await runMany({ kind: 'launch', flow: 'review' }, [mr(1), mr(2)], deps);
  expect(events).toEqual([
    'launch review !1 {"quiet":true}',
    'launch review !2 {"quiet":true}',
    'toast review started on 2',
    'reload false',
  ]);
});

test('runMany keeps at most four requests in flight', async () => {
  let live = 0;
  let peak = 0;
  const deps: RunnerDeps = {
    post: async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise(resolve => setTimeout(resolve, 1));
      live--;
      return ok();
    },
    launch: async () => ok(),
    addToast: () => {},
    reload: () => {},
  };
  await runMany(
    { kind: 'mr', action: 'rebase' },
    [1, 2, 3, 4, 5, 6].map(mr),
    deps
  );
  expect(peak).toBe(4);
});

test('runMany find-thread counts what it found', async () => {
  const { deps, events } = fakeDeps(p =>
    p.iid === 1 ? ok({ status: 'found' }) : ok({ status: 'notfound' })
  );
  await runMany({ kind: 'find-thread' }, [mr(1), mr(2)], deps);
  expect(events).toContain('toast slack thread found on 1 of 2');
});

test('mapLimit never runs more than the limit at once', async () => {
  let live = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async n => {
    live++;
    peak = Math.max(peak, live);
    await new Promise(resolve => setTimeout(resolve, 1));
    live--;
    return n * 2;
  });
  expect(peak).toBe(4);
  expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
});

test('runBulk asks the picked person only on the MRs they can take', async () => {
  const { deps, events } = fakeDeps();
  await runBulk(
    {
      request: { kind: 'ask', ask: 'review' },
      targets: [mr(1), mr(2), mr(3)],
      pickTargets: new Map([['kim', [mr(1), mr(3)]]]),
    },
    { pick: 'kim' },
    deps
  );
  expect(events.filter(e => e.startsWith('post'))).toEqual([
    `post /nudge {"mrUrl":"${mr(1).webUrl}","iid":1,"reviewer":"kim","kind":"review"}`,
    `post /nudge {"mrUrl":"${mr(3).webUrl}","iid":3,"reviewer":"kim","kind":"review"}`,
  ]);
  expect(events).toContain('toast asked kim on 2');
});

test('runBulk does nothing for an ask without a pick or a one-row request', () => {
  const { deps } = fakeDeps();
  expect(
    runBulk({ request: { kind: 'ask', ask: 'review' }, targets: [mr(1)] }, {}, deps)
  ).toBeUndefined();
  expect(
    runBulk({ request: { kind: 'copy' }, targets: [mr(1)] }, {}, deps)
  ).toBeUndefined();
});

test('dispatchRowAction routes one-row requests to their handlers', async () => {
  const calls: string[] = [];
  const h: RowHandlers = {
    copy: m => calls.push(`copy !${m.iid}`),
    note: m => calls.push(`note !${m.iid}`),
    open: url => calls.push(`open ${url}`),
    viewReport: (m, lane) => calls.push(`view ${lane} !${m.iid}`),
    dismiss: (m, lane) => calls.push(`dismiss ${lane} !${m.iid}`),
    standDown: (m, on) => calls.push(`stand-down ${on} !${m.iid}`),
    postSlack: m => calls.push(`post !${m.iid}`),
  };
  const { deps, events } = fakeDeps();
  dispatchRowAction({ kind: 'copy' }, mr(7), {}, deps, h);
  dispatchRowAction({ kind: 'open', url: '' }, mr(7), {}, deps, h);
  dispatchRowAction({ kind: 'open', url: 'https://x.example' }, mr(7), {}, deps, h);
  dispatchRowAction({ kind: 'view-report', lane: 'respond' }, mr(7), {}, deps, h);
  dispatchRowAction({ kind: 'stand-down', on: true }, mr(7), {}, deps, h);
  await dispatchRowAction(
    { kind: 'ask', ask: 'review' },
    mr(7),
    { pick: 'jo' },
    deps,
    h
  );
  expect(calls).toEqual([
    'copy !7',
    'open https://x.example',
    'view respond !7',
    'stand-down true !7',
  ]);
  expect(events).toContain(
    `post /nudge {"mrUrl":"${mr(7).webUrl}","iid":7,"reviewer":"jo","kind":"review"}`
  );
});
```

Run: `cd apps/board && bun test src/client/board/__tests__/action-runner.test.ts`
Expected: FAIL, `Cannot find module '../action-runner.ts'`.

- [ ] **Step 5: Write `action-runner.ts`**

`src/client/board/action-runner.ts`:

```ts
/** Performs the row menu's actions: one MR with today's toasts, or many with
    one summary toast and one reload. Each request's endpoint and wording is
    described once here; launches keep their own flow (launch-flow.ts) and
    are reached through deps.launch. DOM-free, like launch-flow.ts. */
import type { BoardMR } from '../../data.ts';
import type { MrAction } from '../../mr-action.ts';
import type { ActionResult } from '../api.ts';
import type {
  ActionRequest,
  Lane,
  LaunchFlow,
  RunOpts,
} from './row-actions.ts';

export interface LaunchOpts {
  note?: string;
  intent?: 'launch' | 'focus';
  quiet?: boolean;
}

export interface RunnerDeps {
  post: (
    path: string,
    payload: Record<string, unknown>
  ) => Promise<ActionResult>;
  launch: (
    flow: LaunchFlow,
    mr: BoardMR,
    opts: LaunchOpts
  ) => Promise<ActionResult | undefined>;
  addToast: (text: string) => void;
  reload: (fresh: boolean) => void;
}

export type RunnableRequest = Extract<
  ActionRequest,
  { kind: 'launch' | 'mr' | 'draft' | 'react' | 'find-thread' | 'ask' }
>;
type PostRequest = Exclude<RunnableRequest, { kind: 'launch' }>;

const RUNNABLE = new Set<ActionRequest['kind']>([
  'launch',
  'mr',
  'draft',
  'react',
  'find-thread',
  'ask',
]);

export function isRunnable(req: ActionRequest): req is RunnableRequest {
  return RUNNABLE.has(req.kind);
}

interface Wording {
  fresh: boolean;
  manyDone: (oks: ActionResult[]) => string;
  manyFail: (list: string) => string;
}

interface PostSpec extends Wording {
  path: string;
  payload: (mr: BoardMR, url: string) => Record<string, unknown>;
  pending?: (mr: BoardMR) => string;
  done?: (mr: BoardMR, r: ActionResult) => string | undefined;
  fail: (mr: BoardMR, r: ActionResult) => string;
}

const MR_WORDING: Record<
  MrAction,
  { pending: string; done: string; manyDone: string; manyVerb: string }
> = {
  merge: {
    pending: 'merging',
    done: 'merge accepted',
    manyDone: 'merge accepted on',
    manyVerb: 'merge',
  },
  rebase: {
    pending: 'rebasing',
    done: 'rebase started',
    manyDone: 'rebase started on',
    manyVerb: 'rebase',
  },
  setAutoMerge: {
    pending: 'arming auto-merge on',
    done: 'auto-merge armed for',
    manyDone: 'auto-merge armed on',
    manyVerb: 'arm auto-merge on',
  },
  cancelAutoMerge: {
    pending: 'canceling auto-merge on',
    done: 'auto-merge canceled for',
    manyDone: 'auto-merge canceled on',
    manyVerb: 'cancel auto-merge on',
  },
};

const LAUNCH_WORDING: Record<LaunchFlow, { done: string; noun: string }> = {
  review: { done: 'review started on', noun: 'review' },
  're-review': { done: 're-review started on', noun: 're-review' },
  'resume-review': { done: 'review resumed on', noun: 'review' },
  respond: { done: 'response started on', noun: 'response' },
  'resume-respond': { done: 'response resumed on', noun: 'response' },
  doctor: { done: 'doctor called on', noun: 'doctor' },
  'rebase-local': { done: 'local rebase started on', noun: 'local rebase' },
};

function postSpec(req: PostRequest): PostSpec {
  switch (req.kind) {
    case 'mr': {
      const w = MR_WORDING[req.action];
      return {
        path: '/mr/action',
        payload: (mr, url) => ({ mrUrl: url, iid: mr.iid, action: req.action }),
        pending: mr => `${w.pending} !${mr.iid}…`,
        done: mr => `${w.done} !${mr.iid}`,
        fail: (mr, r) => `couldn't ${req.action} !${mr.iid} (${r.status})`,
        fresh: true,
        manyDone: oks => `${w.manyDone} ${oks.length}`,
        manyFail: list => `couldn't ${w.manyVerb} ${list}`,
      };
    }
    case 'draft': {
      const verb = req.draft ? 'draft' : 'ready';
      return {
        path: '/draft',
        payload: (mr, url) => ({ mrUrl: url, iid: mr.iid, draft: req.draft }),
        pending: mr => `marking !${mr.iid} ${verb}…`,
        done: mr =>
          req.draft
            ? `!${mr.iid} is back to draft`
            : `!${mr.iid} is ready for review`,
        fail: (mr, r) => `couldn't mark !${mr.iid} ${verb} (${r.status})`,
        fresh: true,
        manyDone: oks => `marked ${verb} on ${oks.length}`,
        manyFail: list => `couldn't mark ${list} ${verb}`,
      };
    }
    case 'react': {
      const done = req.remove ? 'unmarked' : 'marked';
      const verb = req.remove ? 'unmark' : 'add';
      return {
        path: '/slack/react',
        payload: (_mr, url) => ({
          mrUrl: url,
          emoji: req.emoji,
          remove: req.remove,
        }),
        done: mr => `${done} ${req.glyph} on !${mr.iid}`,
        fail: (mr, r) =>
          `couldn't ${verb} ${req.glyph} for !${mr.iid} (${r.status})`,
        fresh: false,
        manyDone: oks => `${done} ${req.glyph} on ${oks.length}`,
        manyFail: list => `couldn't ${verb} ${req.glyph} for ${list}`,
      };
    }
    case 'find-thread':
      return {
        path: '/slack/resolve',
        payload: (mr, url) => ({ mrUrl: url, iid: mr.iid }),
        pending: mr => `finding slack thread for !${mr.iid}…`,
        done: (mr, r) =>
          r.body?.status === 'found'
            ? `found slack thread for !${mr.iid}`
            : `no slack thread found for !${mr.iid}`,
        fail: (mr, r) => `slack lookup failed for !${mr.iid} (${r.status})`,
        fresh: false,
        manyDone: oks =>
          `slack thread found on ${oks.filter(r => r.body?.status === 'found').length} of ${oks.length}`,
        manyFail: list => `slack lookup failed for ${list}`,
      };
    case 'ask': {
      const reviewer = req.reviewer ?? '';
      return {
        path: '/nudge',
        payload: (mr, url) => ({
          mrUrl: url,
          iid: mr.iid,
          reviewer,
          kind: req.ask,
        }),
        pending: mr => `requesting ${req.ask} of !${mr.iid} from ${reviewer}…`,
        done: (_mr, r) =>
          r.body?.queued
            ? `switchboard unreachable... queued the ask to ${reviewer}`
            : undefined,
        // A 409 carries the relay's own reason in plain text; that is the
        // whole point of the failure, so it wins over the status.
        fail: (mr, r) =>
          r.text.trim() ||
          `couldn't request ${req.ask} for !${mr.iid} (${r.status})`,
        fresh: false,
        manyDone: oks => `asked ${reviewer} on ${oks.length}`,
        manyFail: list => `couldn't ask ${reviewer} on ${list}`,
      };
    }
  }
}

export async function runOne(
  req: RunnableRequest,
  mr: BoardMR,
  deps: RunnerDeps,
  note?: string
): Promise<ActionResult | undefined> {
  if (req.kind === 'launch')
    return deps.launch(req.flow, mr, { note, intent: req.intent });
  const url = mr.webUrl;
  if (!url) return undefined;
  const spec = postSpec(req);
  const pending = spec.pending?.(mr);
  if (pending) deps.addToast(pending);
  const result = await deps.post(spec.path, spec.payload(mr, url));
  if (!result.ok) {
    deps.addToast(spec.fail(mr, result));
    return result;
  }
  const done = spec.done?.(mr, result);
  if (done) deps.addToast(done);
  deps.reload(spec.fresh);
  return result;
}

export const BULK_CONCURRENCY = 4;

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}

function bulkPlan(req: RunnableRequest): Wording & {
  run: (mr: BoardMR, deps: RunnerDeps) => Promise<ActionResult | undefined>;
} {
  if (req.kind === 'launch') {
    const w = LAUNCH_WORDING[req.flow];
    return {
      run: (mr, deps) => deps.launch(req.flow, mr, { quiet: true }),
      fresh: false,
      manyDone: oks => `${w.done} ${oks.length}`,
      manyFail: list => `couldn't launch ${w.noun} for ${list}`,
    };
  }
  const spec = postSpec(req);
  return {
    run: (mr, deps) =>
      mr.webUrl
        ? deps.post(spec.path, spec.payload(mr, mr.webUrl))
        : Promise.resolve(undefined),
    fresh: spec.fresh,
    manyDone: spec.manyDone,
    manyFail: spec.manyFail,
  };
}

export async function runMany(
  req: RunnableRequest,
  targets: readonly BoardMR[],
  deps: RunnerDeps
): Promise<void> {
  const plan = bulkPlan(req);
  const results = await mapLimit(targets, BULK_CONCURRENCY, mr =>
    plan.run(mr, deps)
  );
  const oks = results.filter((r): r is ActionResult => !!r?.ok);
  const failed = targets.flatMap((mr, i) =>
    results[i]?.ok ? [] : [{ mr, result: results[i] }]
  );
  const parts: string[] = [];
  if (oks.length) parts.push(plan.manyDone(oks));
  if (failed.length) {
    const list = failed.map(f => `!${f.mr.iid}`).join(', ');
    const only = failed.length === 1 ? failed[0]?.result : undefined;
    parts.push(plan.manyFail(list) + (only ? ` (${only.status})` : ''));
  }
  deps.addToast(parts.join(' · '));
  deps.reload(plan.fresh);
}

export function runBulk(
  entry: {
    request: ActionRequest;
    targets: readonly BoardMR[];
    pickTargets?: ReadonlyMap<string, readonly BoardMR[]>;
  },
  opts: RunOpts,
  deps: RunnerDeps
): Promise<void> | undefined {
  const req = entry.request;
  if (!isRunnable(req)) return undefined;
  if (req.kind === 'ask') {
    if (!opts.pick) return undefined;
    return runMany(
      { ...req, reviewer: opts.pick },
      entry.pickTargets?.get(opts.pick) ?? [],
      deps
    );
  }
  return runMany(req, entry.targets, deps);
}

/** The one-row menu's own effects that are not requests to run. */
export interface RowHandlers {
  copy: (mr: BoardMR) => void;
  note: (mr: BoardMR) => void;
  open: (url: string) => void;
  viewReport: (mr: BoardMR, lane: 'review' | 'respond') => void;
  dismiss: (mr: BoardMR, lane: Lane) => void;
  standDown: (mr: BoardMR, on: boolean) => void;
  postSlack: (mr: BoardMR) => void;
}

export function dispatchRowAction(
  req: ActionRequest,
  mr: BoardMR,
  opts: RunOpts,
  deps: RunnerDeps,
  h: RowHandlers
): Promise<ActionResult | undefined> | undefined {
  switch (req.kind) {
    case 'copy':
      h.copy(mr);
      return undefined;
    case 'note':
      h.note(mr);
      return undefined;
    case 'open':
      if (req.url) h.open(req.url);
      return undefined;
    case 'view-report':
      h.viewReport(mr, req.lane);
      return undefined;
    case 'dismiss':
      h.dismiss(mr, req.lane);
      return undefined;
    case 'stand-down':
      h.standDown(mr, req.on);
      return undefined;
    case 'post-slack':
      h.postSlack(mr);
      return undefined;
    case 'ask':
      return runOne({ ...req, reviewer: opts.pick ?? req.reviewer }, mr, deps);
    default:
      return runOne(req, mr, deps, opts.note);
  }
}
```

- [ ] **Step 6: Run the runner tests, typecheck, full suite**

Run: `cd apps/board && bun test src/client/board/__tests__/action-runner.test.ts`
Expected: PASS (17 tests).
Run from the root: `bun run board:typecheck && bun run board:test`
Expected: clean and PASS. `Board.tsx` still compiles: its `handle*` wrappers return the new promise into `void`-typed props, which TypeScript allows.

- [ ] **Step 7: Format and commit**

```bash
bunx prettier --write apps/board/src/client/board/action-runner.ts apps/board/src/client/board/__tests__/action-runner.test.ts apps/board/src/client/board/launch-flow.ts apps/board/src/client/board/hooks.ts apps/board/src/__tests__/client-api.test.ts
git add apps/board/src/client/board/action-runner.ts apps/board/src/client/board/__tests__/action-runner.test.ts apps/board/src/client/board/launch-flow.ts apps/board/src/client/board/hooks.ts apps/board/src/__tests__/client-api.test.ts
git commit -m "board: add the action runner for one MR or many

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ActionMenu`, and the one-row menu on the shared model

**Files:**
- Create: `src/client/board/ActionMenu.tsx`
- Rewrite: `src/client/board/RowMenu.tsx`
- Modify: `src/client/board/Board.tsx`
- Modify: `src/client/board/__tests__/row-menu-harness.tsx` (`renderRowMenu` only)

**Interfaces:**
- Consumes: everything `row-actions.ts` and `action-runner.ts` export (Tasks 2 and 3); `actionEnvOf` from the fixtures.
- Produces (used by T6):
  - `ActionMenu({ x, y, subject, entries, onRun, onClose }: { x: number; y: number; subject: string; entries: MenuEntry[]; onRun: (key: string, opts: RunOpts) => void | Promise<unknown>; onClose: () => void })`
  - `RowMenu({ menu, env, onRun, onClose }: { menu: RowMenuState; env: ActionEnv; onRun: (action: RowAction, mr: BoardMR, opts: RunOpts) => Promise<ActionResult | undefined> | undefined; onClose: () => void })`
  - In `Board.tsx`: `runner: RunnerDeps` and `actionEnv: ActionEnv` in scope for Task 6.

The pins from Task 1 are the test for this task. They must pass with no change to any assertion or snapshot.

- [ ] **Step 1: Swap the harness onto the new `RowMenu` props (the failing test)**

In `src/client/board/__tests__/row-menu-harness.tsx`, replace the whole `renderRowMenu` function, and change the imports: drop `hasStackDescendants` and `RowContext`, add these:

```tsx
import type { ActionRequest, RunOpts } from '../row-actions.ts';
import { actionEnvOf, type MenuEnv } from './menu-fixtures.ts';
```

```tsx
function effectOf(req: ActionRequest, opts: RunOpts): string {
  switch (req.kind) {
    case 'launch':
      return `launch:${req.flow}${req.intent === 'focus' ? ':focus' : ''}`;
    case 'mr':
      return `mr:${req.action}`;
    case 'draft':
      return `draft:${req.draft}`;
    case 'react':
      return `react:${req.emoji}:${req.remove}`;
    case 'ask':
      return `ask:${req.ask}:${opts.pick ?? req.reviewer}`;
    case 'open':
      return `open:${req.url}`;
    case 'view-report':
      return `view-report:${req.lane}`;
    case 'dismiss':
      return `dismiss:${req.lane}`;
    case 'stand-down':
      return `stand-down:${req.on}`;
    default:
      return req.kind;
  }
}

function renderRowMenu(
  mr: BoardMRWithReview,
  env: MenuEnv,
  reactionsReply: string[] | null
) {
  return (
    <RowMenu
      menu={{ x: 10, y: 10, mr }}
      env={actionEnvOf(env, mr)}
      onClose={() => {
        harness.closed = true;
      }}
      onRun={(action, m, opts) => {
        record(effectOf(action.request, opts), m, opts.note);
        return action.request.kind === 'react'
          ? Promise.resolve({
              ok: true,
              status: 200,
              body: reactionsReply ? { reactions: reactionsReply } : null,
              text: '',
            })
          : undefined;
      }}
    />
  );
}
```

`window.open` no longer records anything through the menu (the `open` effect now comes from `onRun`), so delete the `window.open = ...` assignment in `openMenu`. Delete the `import type { BoardMR } from '../../../data.ts';` line (nothing uses it after the swap); the type-only import of `MenuEnv` merges into the `menu-fixtures.ts` import above.

Run: `cd apps/board && bun run typecheck`
Expected: FAIL. `RowMenu` does not accept `env` / `onRun` yet.

- [ ] **Step 2: Create `ActionMenu.tsx`**

`src/client/board/ActionMenu.tsx`:

```tsx
import { Fragment, useEffect, useState } from 'react';

import { ContextMenu } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import {
  AgentGlyph,
  ArrowOutGlyph,
  FlagGlyph,
  MenuGlyph,
  SlackLogo,
} from './icons.tsx';
import type {
  ActionGlyph,
  Lane,
  MenuEntry,
  RunOpts,
  Section,
} from './row-actions.ts';

const SECTIONS: Array<[Section, string]> = [
  ['agent', 'agent actions'],
  ['gitlab', 'gitlab'],
  ['slack', 'slack'],
];

function glyphNode(g: ActionGlyph): React.ReactNode {
  switch (g.kind) {
    case 'menu':
      return <MenuGlyph kind={g.name} />;
    case 'flag':
      return <FlagGlyph kind={g.name} />;
    case 'out':
      return <ArrowOutGlyph />;
    case 'slack':
      return <SlackLogo />;
    case 'emoji':
      return <span className="tui-menu-emoji">{g.glyph}</span>;
  }
}

/** An agent action's label: the bot mark in the lane's color, then the
    row's own verb, so the menu and the status line say the same thing. */
function agentLabel(lane: Lane, text: string) {
  return (
    <span className="tui-menu-agent" data-lane={lane}>
      <AgentGlyph />
      {text}
    </span>
  );
}

function iconLabel(icon: React.ReactNode, text: string) {
  return (
    <span className="tui-menu-icon-label">
      {icon}
      {text}
    </span>
  );
}

function entryLabel(e: MenuEntry, text: string) {
  const main = e.lane
    ? agentLabel(e.lane, text)
    : iconLabel(e.glyph ? glyphNode(e.glyph) : null, text);
  if (!e.blocked) return main;
  return (
    <span className="tui-menu-blocked">
      {main}
      <span className="tui-menu-reason">{e.blocked}</span>
    </span>
  );
}

/** Context menu anchored at the cursor. The kit's ContextMenu recipe owns
    the shell (box, viewport clamp, dismissals); this draws a list of entries
    in the board's three sections, plus the stages any entry can ask for: a
    second-click confirm, a picker, and the alt-click note box. */
function ActionMenu({
  x,
  y,
  subject,
  entries,
  onRun,
  onClose,
}: {
  x: number;
  y: number;
  /** What the menu acts on: "!1418" or "5 selected". */
  subject: string;
  entries: MenuEntry[];
  onRun: (key: string, opts: RunOpts) => void | Promise<unknown>;
  onClose: () => void;
}) {
  const [altHeld, setAltHeld] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [picking, setPicking] = useState<MenuEntry | null>(null);
  const [noteFor, setNoteFor] = useState<MenuEntry | null>(null);
  const [noteText, setNoteText] = useState('');
  const noteRef = useAutoGrowTextarea([noteFor, noteText]);
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => setAltHeld(e.altKey);
    const onBlur = () => setAltHeld(false);
    document.addEventListener('keydown', onAlt);
    document.addEventListener('keyup', onAlt);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onAlt);
      document.removeEventListener('keyup', onAlt);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const fire = (e: MenuEntry, opts: RunOpts = {}) => {
    void onRun(e.key, opts);
    onClose();
  };

  if (picking?.pick) {
    const pick = picking.pick;
    return (
      // Each stage is a distinct keyed ContextMenu: the recipe's viewport
      // clamp is a layout effect keyed on [x, y] only, so a new key is what
      // re-runs it against this stage's own size.
      <ContextMenu
        key="asking"
        x={x}
        y={y}
        ariaLabel={`${pick.aria} for ${subject}`}
        onClose={onClose}
      >
        <ContextMenu.Label>{pick.title}</ContextMenu.Label>
        {pick.options.map(o => (
          <ContextMenu.Item
            key={`ask-${o.value}`}
            label={iconLabel(
              picking.glyph ? glyphNode(picking.glyph) : null,
              o.value
            )}
            hint={o.hint}
            onClick={() => fire(picking, { pick: o.value })}
          />
        ))}
      </ContextMenu>
    );
  }

  if (noteFor) {
    return (
      <ContextMenu
        key="noting"
        x={x}
        y={y}
        ariaLabel={`note for ${subject}`}
        onClose={onClose}
        // The recipe focuses this once the clamp has committed and the menu
        // has stopped being `visibility: hidden`; `autoFocus`, or a focus call
        // from an effect here, would run while hidden and silently no-op.
        initialFocusRef={noteRef}
        className="tui-menu-noting"
      >
        <ContextMenu.Label>
          note for {noteFor.label} {subject}
        </ContextMenu.Label>
        <textarea
          ref={noteRef}
          className="tui-menu-note"
          rows={1}
          value={noteText}
          placeholder="extra instruction…"
          maxLength={2000}
          aria-label="launch note"
          onChange={e => {
            setNoteText(e.currentTarget.value);
          }}
          onKeyDown={e => {
            // Escape goes back to the item list, not out of the menu, and the
            // alt tracker stays honest while its document listener is muted.
            e.stopPropagation();
            setAltHeld(e.altKey);
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              fire(noteFor, { note: noteText.trim() || undefined });
            } else if (e.key === 'Escape') {
              setNoteFor(null);
            }
          }}
        />
        <div className="tui-menu-note-hint">
          ↵ launch with note · ⇧↵ newline · esc back
        </div>
      </ContextMenu>
    );
  }

  // Armed against the exact wording: when a reload changes what a confirm
  // covers ("really merge 2?" becomes "3?"), the item disarms instead of
  // firing on a set nobody confirmed.
  const armKey = (e: MenuEntry) => `${e.key}|${e.confirm}`;
  const click = (e: MenuEntry) => (ev: React.MouseEvent) => {
    if (e.blocked) return;
    if (e.pick) {
      setPicking(e);
      return;
    }
    if (e.confirm && armed !== armKey(e)) {
      setArmed(armKey(e));
      return;
    }
    if (e.notable && ev.altKey) {
      setNoteText('');
      setNoteFor(e);
      return;
    }
    if (e.keepOpen) {
      if (pending.includes(e.key)) return;
      setPending(p => [...p, e.key]);
      void Promise.resolve(onRun(e.key, {})).finally(() =>
        setPending(p => p.filter(k => k !== e.key))
      );
      return;
    }
    fire(e);
  };
  const hintOf = (e: MenuEntry) =>
    e.blocked ? 'blocked' : e.notable && altHeld ? '+ note' : e.hint;
  const trailingOf = (e: MenuEntry) =>
    pending.includes(e.key) ? (
      <span className="tui-menu-spin" aria-label="working" />
    ) : e.marked ? (
      <span className="tui-menu-check">✓</span>
    ) : undefined;

  return (
    <ContextMenu
      key="items"
      x={x}
      y={y}
      ariaLabel={`actions for ${subject}`}
      onClose={onClose}
    >
      <ContextMenu.Label>{subject}</ContextMenu.Label>
      {SECTIONS.map(([section, title]) => {
        const items = entries.filter(e => e.section === section);
        if (!items.length) return null;
        return (
          <Fragment key={section}>
            {section !== 'agent' && <ContextMenu.Separator />}
            <ContextMenu.Label>{title}</ContextMenu.Label>
            {items.map(e => (
              <ContextMenu.Item
                key={e.key}
                label={entryLabel(
                  e,
                  e.confirm && armed === armKey(e) ? e.confirm : e.label
                )}
                hint={hintOf(e)}
                trailing={trailingOf(e)}
                disabled={!!e.blocked || pending.includes(e.key)}
                onClick={click(e)}
              />
            ))}
          </Fragment>
        );
      })}
    </ContextMenu>
  );
}

export { ActionMenu };
```

- [ ] **Step 3: Rewrite `RowMenu.tsx`**

Replace the whole of `src/client/board/RowMenu.tsx` with:

```tsx
import { useState } from 'react';

import type { BoardMR } from '../../data.ts';
import type { ActionResult } from '../api.ts';
import type { BoardMRWithReview, RowMenuState } from '../types.ts';
import { ActionMenu } from './ActionMenu.tsx';
import {
  rowActions,
  type ActionEnv,
  type RowAction,
  type RunOpts,
} from './row-actions.ts';

/** One MR's right-click menu. The one thing only a single row has is the
    live slack marks: the menu stays open while several are set, so each
    reply's reactions are held here and fed back into rowActions. */
function RowMenu({
  menu,
  env,
  onRun,
  onClose,
}: {
  menu: RowMenuState;
  env: ActionEnv;
  onRun: (
    action: RowAction,
    mr: BoardMR,
    opts: RunOpts
  ) => Promise<ActionResult | undefined> | undefined;
  onClose: () => void;
}) {
  const mrx = menu.mr as BoardMRWithReview;
  const [reactions, setReactions] = useState<string[]>(
    mrx.slack?.reactions ?? []
  );
  const live: BoardMRWithReview = mrx.slack
    ? { ...mrx, slack: { ...mrx.slack, reactions } }
    : mrx;
  const actions = rowActions(live, env);
  return (
    <ActionMenu
      x={menu.x}
      y={menu.y}
      subject={`!${mrx.iid}`}
      entries={actions}
      onClose={onClose}
      onRun={async (key, opts) => {
        const action = actions.find(a => a.key === key);
        if (!action) return;
        const result = await onRun(action, menu.mr, opts);
        const next = result?.body?.reactions;
        if (action.request.kind === 'react' && next) setReactions(next);
      }}
    />
  );
}

export { RowMenu };
```

- [ ] **Step 4: Wire `Board.tsx` to the runner**

Make these edits in `src/client/board/Board.tsx`:

a. Imports. Add:

```ts
import {
  dispatchRowAction,
  runOne,
  type LaunchOpts,
  type RowHandlers,
  type RunnerDeps,
} from './action-runner.ts';
import type {
  ActionEnv,
  LaunchFlow,
  RowAction,
  RunOpts,
} from './row-actions.ts';
```

After the edits below, remove the imports they leave unused: the `MrAction` type import, `getSlackMarks` from the `./format.ts` import, and `hasStackDescendants` from the `../../view.ts` import. The board's tsconfig has `noUnusedLocals: false`, so no gate catches these; check with `grep -n "MrAction\|getSlackMarks\|hasStackDescendants" apps/board/src/client/board/Board.tsx` (only the import lines should have matched, and they should now be gone). Prettier sorts the new imports into place in Step 6.

b. Replace the block that starts at the comment `// Six near-identical "launch a pane" actions collapse onto useLaunchAction:` and ends at the closing `);` of `handleResumeRespond` with the block below. It keeps the six `useLaunchAction` instances exactly as they are, puts each flow's payload in one `launch` callback, rebuilds the handlers the status line and the decision queue use on top of it, and drops `handleRebaseLocal` and `handleResumeReview` (only the old `RowMenu` props used them).

```ts
  // Six "launch a pane" flows collapse onto useLaunchAction: claim optimistic
  // queued state (skipped for resume, whose axis is null), toast, POST, and
  // reconcile on the answer. See launch-flow.ts's runLaunchFlow for the
  // shared shape; note is folded into `extra` since JSON.stringify already
  // drops it when undefined, matching every one of today's payloads.
  const launchReview = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 'launching review',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const reReviewAction = useLaunchAction({
    axis: 'review',
    path: '/review',
    verbing: 're-reviewing',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const respondAction = useLaunchAction({
    axis: 'respond',
    path: '/respond',
    verbing: 'launching response',
    noun: 'response',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  const doctorAction = useLaunchAction({
    axis: 'doctor',
    path: '/doctor',
    verbing: 'calling doctor',
    noun: 'doctor',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
  });
  // Resume actions: axis null means useLaunchAction's setQueued/rollback are
  // no-ops, matching today's handleResume (which never claimed a badge before
  // the reload settled). Bespoke failureMessage restores handleResume's own
  // failure wording, including the server's response text when it sends one
  // (e.g. "no session id on file") -- the shared default failure toast has no
  // way to carry that detail.
  const resumeReviewAction = useLaunchAction({
    axis: null,
    path: '/review',
    verbing: 'resuming review',
    noun: 'review',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
    failureMessage: (result, mr) =>
      `resume review failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`,
  });
  const resumeRespondAction = useLaunchAction({
    axis: null,
    path: '/respond',
    verbing: 'resuming respond',
    noun: 'respond',
    optimistic: optimisticLifecycle,
    addToast,
    reload: load,
    failureMessage: (result, mr) =>
      `resume respond failed for !${mr.iid} (${result.status})${result.text ? `: ${result.text}` : ''}`,
  });

  // Each flow's payload lives here once: the row menu, the bulk menu, the
  // status line's verbs and the decision queue all launch through it.
  const launch = useCallback(
    (flow: LaunchFlow, mr: BoardMR, opts: LaunchOpts = {}) => {
      const { note, intent, quiet } = opts;
      switch (flow) {
        case 'review':
          return launchReview(mr, { tabId: state.tab }, note, intent, quiet);
        case 're-review':
          return reReviewAction(
            mr,
            { reReview: true, tabId: state.tab },
            note,
            undefined,
            quiet
          );
        case 'resume-review':
          return resumeReviewAction(
            mr,
            { resume: true },
            note,
            undefined,
            quiet
          );
        case 'respond':
          return respondAction(mr, {}, note, intent, quiet);
        case 'resume-respond':
          return resumeRespondAction(
            mr,
            { resume: true },
            note,
            undefined,
            quiet
          );
        case 'doctor':
          return doctorAction(mr, {}, note, intent, quiet);
        case 'rebase-local':
          // The doctor chassis scoped to a checkout rebase: the fallback when
          // the GitLab-side rebase can't (conflicts) or didn't work.
          return doctorAction(mr, { mode: 'rebase' }, note, undefined, quiet);
      }
    },
    [
      launchReview,
      reReviewAction,
      resumeReviewAction,
      respondAction,
      resumeRespondAction,
      doctorAction,
      state.tab,
    ]
  );
  const handleLaunch = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('review', mr, { note, intent }),
    [launch]
  );
  const handleReReview = useCallback(
    (mr: BoardMR, note?: string) => void launch('re-review', mr, { note }),
    [launch]
  );
  const handleRespond = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('respond', mr, { note, intent }),
    [launch]
  );
  const handleDoctor = useCallback(
    (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') =>
      void launch('doctor', mr, { note, intent }),
    [launch]
  );
  const handleResumeRespond = useCallback(
    (mr: BoardMR, note?: string) => void launch('resume-respond', mr, { note }),
    [launch]
  );

  // GateForm's "focus pane" escape hatch: jump into whichever domain's pane
  // opened the gate, via the exact same launch endpoint a fresh launch from
  // the row would use -- the server-side dedup (existing tabId + in-flight
  // status) re-focuses that pane, and the focus intent makes a gone pane a
  // refusal rather than a fresh launch, so this never invents a distinct
  // focus call.
  const handleFocusPane = useCallback(
    (mr: BoardMR, domain: GateDomain) =>
      void launch(
        domain === 'review' || domain === 'respond' ? domain : 'doctor',
        mr,
        { intent: 'focus' }
      ),
    [launch]
  );
```

c. Delete these callbacks entirely, each with its leading comment: `handleAsk`, `handleDraftState`, `handleMrAction`, `handleResolveSlack`, `handleReactSlack`. Keep `handleCopy`, `handlePostSlack`, `handlePostSummary`, `handleDismissLane`, `handleStandDown`, `handleClearOrphan`, `handleSaveNote`.

d. Directly after `handlePostSummary`'s closing `);` (still above `if (!data) {`, since these are hooks), add:

```ts
  const runner: RunnerDeps = useMemo(
    () => ({
      post: (path, payload) => postAction(path, payload),
      launch,
      addToast,
      reload: fresh => void load(fresh),
    }),
    [launch, addToast, load]
  );
  const rowHandlers: RowHandlers = useMemo(
    () => ({
      copy: handleCopy,
      note: mr => setNoteEditing(mr.webUrl ?? null),
      open: url => window.open(url, '_blank', 'noopener'),
      viewReport: (mr, lane) =>
        (lane === 'review' ? setReviewModal : setRespondModal)(
          mr as BoardMRWithReview
        ),
      dismiss: handleDismissLane,
      standDown: handleStandDown,
      postSlack: handlePostSlack,
    }),
    [handleCopy, handleDismissLane, handleStandDown, handlePostSlack]
  );
  const runRowAction = useCallback(
    (action: RowAction, mr: BoardMR, opts: RunOpts) =>
      dispatchRowAction(action.request, mr, opts, runner, rowHandlers),
    [runner, rowHandlers]
  );
```

If `handlePostSummary` is declared below `handleCopy`, `handleDismissLane` or `handleStandDown`, that is fine; if any of those three is declared after this point, move this block below the last of them (still above `if (!data) {`).

e. In the `rowCtx` object, change the merge line to:

```ts
    onMerge: mr => void runOne({ kind: 'mr', action: 'merge' }, mr, runner),
```

f. Directly after `const rowCtx: RowContext = { ... };` add:

```ts
  const actionEnv: ActionEnv = {
    local: data.local,
    slackEnabled: data.slackEnabled,
    self:
      data.defaultMember && data.defaultMember !== 'all'
        ? data.defaultMember
        : null,
    roster: data.members.map(m => m.username),
    peers: data.peers,
    allMrs: data.mrs,
  };
```

g. Replace the whole `{rowMenu && ( <RowMenu ... /> )}` element (from `<RowMenu` through its closing `/>`) with:

```tsx
      {rowMenu && (
        <RowMenu
          menu={rowMenu}
          env={actionEnv}
          onRun={runRowAction}
          onClose={() => setRowMenu(null)}
        />
      )}
```

- [ ] **Step 5: Typecheck, then run the pins**

Run from the root: `bun run board:typecheck`
Expected: clean.
Run: `cd apps/board && bun test src/client/board/__tests__/row-menu-pins-dom.test.tsx src/client/board/__tests__/row-menu-ask-dom.test.tsx`
Expected: PASS, with `git diff --stat -- apps/board/src/client/board/__tests__/row-menu-pins-dom.test.tsx apps/board/src/client/board/__tests__/row-menu-ask-dom.test.tsx` showing no change. If a pin fails, fix `ActionMenu`, `RowMenu` or `rowActions`, never the pin.

- [ ] **Step 6: Full suite and the one-row visual check**

Format first, since `format:check` fails on unsorted imports:
`bunx prettier --write apps/board/src/client/board/ActionMenu.tsx apps/board/src/client/board/RowMenu.tsx apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/row-menu-harness.tsx`
Then run from the root: `bun run board:test && bun run format:check && bash scripts/repo-purity.sh`
Expected: all PASS.

Then serve the fixture board and look at the one-row menu. From `apps/board`: `bun run build:client`, then `BOARD_FIXTURE=tests/fixture PORT=7941 bun run src/server.ts` (background). Through the `fast-browser:browser-driver` agent (or the Fast Browser tools directly), open `http://localhost:7941`, right-click the first row, and screenshot the menu in light and dark (the board keeps its theme in localStorage `mrs-theme`: set it to `light` or `dark`, reload, then restore the old value). Compare against `tests/baselines/rowmenu-light.png` and `tests/baselines/rowmenu-dark.png`. Also run `bun run capture && bun run capture:compare` from `apps/board`; the `rowmenu-*` shots must match. Say plainly if anything moved.

- [ ] **Step 7: Format and commit**

```bash
bunx prettier --write apps/board/src/client/board/ActionMenu.tsx apps/board/src/client/board/RowMenu.tsx apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/row-menu-harness.tsx
git add apps/board/src/client/board/ActionMenu.tsx apps/board/src/client/board/RowMenu.tsx apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/row-menu-harness.tsx
git commit -m "board: draw the row menu from rowActions through ActionMenu

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `bulkActions`, several MRs' actions grouped

**Files:**
- Modify: `src/view.ts` (export `stackParents`)
- Modify: `src/client/board/row-actions.ts` (add `bulkActions` and friends)
- Modify: `src/client/board/__tests__/row-actions.test.ts` (add tests)

**Interfaces:**
- Consumes: `rowActions`, `RowAction`, `MenuEntry`, `ActionEnv`, `ActionRequest`, `Section` (Task 2); `stackParents` from `view.ts`.
- Produces (used by T6):
  - `interface BulkEntry extends MenuEntry { request: ActionRequest; targets: BoardMRWithReview[]; pickTargets?: Map<string, BoardMRWithReview[]> }`
  - `bulkActions(mrs: BoardMRWithReview[], env: ActionEnv): BulkEntry[]`
  - `LAUNCH_CONFIRM_OVER = 3`

- [ ] **Step 1: Write the failing tests**

Append to `src/client/board/__tests__/row-actions.test.ts` (and add `bulkActions` to the `../row-actions.ts` import, `mrx` to the fixtures import):

```ts
const visible = { visible: true, disabled: false, loading: false };
const env3 = (allMrs: ReturnType<typeof mrx>[]) => ({
  local: true,
  slackEnabled: true,
  self: 'pat',
  roster: ['pat', 'kim', 'jo'],
  allMrs,
});
const a = mrx(201, { mergeButton: visible, behindTarget: 2 });
const b = mrx(202, { mergeButton: visible, isDraft: true });
const c = mrx(203, {
  author: { username: 'kim', name: 'Kim' },
  blockers: { any: true, pipelineFailing: true },
});

test('bulk groups the bulk-capable actions, counts them, and orders them like the mock', () => {
  const lines = bulkActions([a, b, c], env3([a, b, c])).map(
    e => `${e.key} | ${e.label} | ${e.hint}`
  );
  expect(lines).toEqual([
    'review | review | 3 of 3',
    'doctor | call doctor | 1 of 3',
    'request-review | request review from… | 2 of 3',
    'rebase | rebase on target | 1 of 3',
    'mark-ready | mark ready | 1 of 3',
    'mark-draft | mark as draft | 1 of 3',
    'merge | merge | 2 of 3',
    'find-thread | find slack threads | 3 of 3',
  ]);
});

test('bulk targets are the MRs each action acts on', () => {
  const byKey = Object.fromEntries(
    bulkActions([a, b, c], env3([a, b, c])).map(e => [
      e.key,
      e.targets.map(t => t.iid),
    ])
  );
  expect(byKey.merge).toEqual([201, 202]);
  expect(byKey.doctor).toEqual([203]);
});

test('merge always confirms; launches confirm only past three', () => {
  const d = mrx(204);
  const four = [a, b, c, d];
  const entries = bulkActions(four, env3(four));
  expect(entries.find(e => e.key === 'merge')?.confirm).toBe('really merge 2?');
  expect(entries.find(e => e.key === 'review')?.confirm).toBe(
    'really start 4 reviews?'
  );
  const three = bulkActions([a, b, c], env3([a, b, c]));
  expect(three.find(e => e.key === 'review')?.confirm).toBeUndefined();
});

test('a checked MR stacked on an open MR blocks merge for the selection', () => {
  const child = mrx(205, {
    isStacked: true,
    targetBranch: 'f-201',
    mergeButton: visible,
  });
  const all = [a, b, c, child];
  const blocked = bulkActions([b, child], env3(all)).find(e => e.key === 'merge');
  expect(blocked?.blocked).toBe('!205 sits on !201, which is still open');
  const parentGone = bulkActions([b, child], env3([b, c, child])).find(
    e => e.key === 'merge'
  );
  expect(parentGone?.blocked).toBeUndefined();
});

test('mark wins over unmark until every checked thread has the mark', () => {
  const found = (iid: number, reactions: string[]) =>
    mrx(iid, { slack: { status: 'found', reactions, posted: true } });
  const e = found(206, ['eyes']);
  const f = found(207, []);
  const mixed = bulkActions([e, f], env3([e, f])).map(x => x.key);
  expect(mixed).toContain('react-eyes');
  expect(mixed).not.toContain('unreact-eyes');
  const g = found(208, ['eyes']);
  const both = bulkActions([e, g], env3([e, g]));
  expect(both.find(x => x.key === 'unreact-eyes')?.label).toBe('unmark looking');
  expect(both.find(x => x.key === 'unreact-eyes')?.hint).toBe('2 of 2');
});

test('request review from… lists each person with the MRs they can be asked on', () => {
  const entry = bulkActions([a, b, c], env3([a, b, c])).find(
    e => e.key === 'request-review'
  );
  expect(entry?.pick?.options).toEqual([
    { value: 'kim', hint: '2 of 3' },
    { value: 'jo', hint: '2 of 3' },
  ]);
  expect(entry?.pickTargets?.get('kim')?.map(t => t.iid)).toEqual([201, 202]);
});

test('one-row-only actions never reach the bulk menu', () => {
  const keys = bulkActions([a, b, c], env3([a, b, c])).map(e => e.key);
  for (const k of [
    'respond',
    'rebase-local',
    'stand-down',
    'open-gitlab',
    'post-slack',
    'copy',
    'note',
  ])
    expect(keys).not.toContain(k);
});
```

Run: `cd apps/board && bun test src/client/board/__tests__/row-actions.test.ts`
Expected: FAIL, `bulkActions` is not exported.

- [ ] **Step 2: Export `stackParents`**

In `src/view.ts`, change `function stackParents<M extends BoardMR>(mrs: M[]): Map<M, M> {` to `export function stackParents<M extends BoardMR>(mrs: M[]): Map<M, M> {`.

- [ ] **Step 3: Add `bulkActions` to `row-actions.ts`**

Change the `view.ts` import in `row-actions.ts` to `import { hasStackDescendants, stackParents } from '../../view.ts';`, replace the file's header comment with:

```ts
/** What the row menu offers, as data. One MR's actions come from
    rowActions; the bulk menu groups several MRs' lists (bulkActions), so the
    one-row and bulk menus can never disagree about what an MR can take.
    DOM-free, so both menus and their tests share it. */
```

and append:

```ts
/** Launches past this many ask for a second click. */
export const LAUNCH_CONFIRM_OVER = 3;

export interface BulkEntry extends MenuEntry {
  request: ActionRequest;
  targets: BoardMRWithReview[];
  /** request review from…: who can be asked on which of the targets. */
  pickTargets?: Map<string, BoardMRWithReview[]>;
}

const SECTION_RANK: Record<Section, number> = { agent: 0, gitlab: 1, slack: 2 };
const BULK_RANK = [
  'review',
  're-review',
  'doctor',
  'request-review',
  'rebase',
  'setAutoMerge',
  'cancelAutoMerge',
  'mark-ready',
  'mark-draft',
  'merge',
  'react',
  'find-thread',
];

function bulkRank(key: string): number {
  const base =
    key.startsWith('react-') || key.startsWith('unreact-') ? 'react' : key;
  const i = BULK_RANK.indexOf(base);
  return i === -1 ? BULK_RANK.length : i;
}

const BULK_CONFIRM: Record<string, (n: number) => string | undefined> = {
  merge: n => `really merge ${n}?`,
  review: n =>
    n > LAUNCH_CONFIRM_OVER ? `really start ${n} reviews?` : undefined,
  're-review': n =>
    n > LAUNCH_CONFIRM_OVER ? `really start ${n} re-reviews?` : undefined,
  doctor: n =>
    n > LAUNCH_CONFIRM_OVER ? `really call doctor on ${n}?` : undefined,
};

/** Merging a child before its parent lands it in the parent's branch, not
    the target, so a checked child of an open MR stops the whole merge. */
function mergeBlock(
  checked: BoardMR[],
  allMrs: BoardMR[]
): string | undefined {
  const parentByUrl = new Map(
    [...stackParents(allMrs)].map(([child, parent]) => [child.webUrl, parent])
  );
  for (const mr of checked) {
    const parent = parentByUrl.get(mr.webUrl);
    if (parent) return `!${mr.iid} sits on !${parent.iid}, which is still open`;
  }
  return undefined;
}

/** The bulk menu: each checked MR's rowActions, keeping the bulk-capable
    ones, grouped by key. Eligibility comes only from rowActions; what is
    added here exists only for a group (counts, confirms, the stack block,
    mark over unmark, the merged picker). */
export function bulkActions(
  mrs: BoardMRWithReview[],
  env: ActionEnv
): BulkEntry[] {
  const groups = new Map<
    string,
    {
      first: RowAction;
      targets: BoardMRWithReview[];
      picks: Map<string, BoardMRWithReview[]>;
    }
  >();
  for (const mr of mrs) {
    for (const action of rowActions(mr, env)) {
      if (!action.bulk) continue;
      let g = groups.get(action.key);
      if (!g) {
        g = { first: action, targets: [], picks: new Map() };
        groups.set(action.key, g);
      }
      g.targets.push(mr);
      for (const o of action.pick?.options ?? [])
        g.picks.set(o.value, [...(g.picks.get(o.value) ?? []), mr]);
    }
  }
  for (const key of [...groups.keys()])
    if (
      key.startsWith('unreact-') &&
      groups.has(`react-${key.slice('unreact-'.length)}`)
    )
      groups.delete(key);

  const of = (n: number) => `${n} of ${mrs.length}`;
  const entries = [...groups].map(([key, g]): BulkEntry => {
    const n = g.targets.length;
    const entry: BulkEntry = {
      key,
      section: g.first.section,
      label: g.first.bulk ?? g.first.label,
      glyph: g.first.glyph,
      lane: g.first.lane,
      request: g.first.request,
      targets: g.targets,
      hint: of(n),
      confirm: BULK_CONFIRM[key]?.(n),
      blocked: key === 'merge' ? mergeBlock(mrs, env.allMrs) : undefined,
    };
    if (g.first.pick) {
      entry.pick = {
        ...g.first.pick,
        options: [...g.picks].map(([value, t]) => ({
          value,
          hint: of(t.length),
        })),
      };
      entry.pickTargets = g.picks;
    }
    return entry;
  });
  return entries.sort(
    (x, y) =>
      SECTION_RANK[x.section] - SECTION_RANK[y.section] ||
      bulkRank(x.key) - bulkRank(y.key)
  );
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd apps/board && bun test src/client/board/__tests__/row-actions.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Typecheck, full suite, format, commit**

```bash
bun run board:typecheck && bun run board:test
bunx prettier --write apps/board/src/view.ts apps/board/src/client/board/row-actions.ts apps/board/src/client/board/__tests__/row-actions.test.ts
git add apps/board/src/view.ts apps/board/src/client/board/row-actions.ts apps/board/src/client/board/__tests__/row-actions.test.ts
git commit -m "board: add bulkActions, the selection's menu as data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The bulk menu on the board

**Files:**
- Modify: `src/selection.ts`, `src/__tests__/selection.test.ts`
- Modify: `src/client/board/icons.tsx`
- Modify: `src/client/board/SelectionBar.tsx`
- Modify: `src/style.css`
- Modify: `src/client/board/Board.tsx`
- Create: `src/client/board/__tests__/bulk-menu-dom.test.tsx`

**Interfaces:**
- Consumes: `bulkActions`, `BulkEntry` (Task 5); `ActionMenu` (Task 4); `runBulk` (Task 3); `runner`, `actionEnv`, `selectedMrs`, `selected`, `rowMenu` in `Board.tsx`.
- Produces: `menuActsOnSelection(mr: { webUrl?: string | null }, selected: ReadonlySet<string>, selectedCount: number): boolean` in `src/selection.ts`; `SelectionBar`'s new required prop `onActions: (x: number, y: number) => void`.

- [ ] **Step 1: Write the failing selection test**

Append to `src/__tests__/selection.test.ts` (add `menuActsOnSelection` to its `../selection.ts` import):

```ts
test('a right-click acts on the selection only from a checked row, two or more checked', () => {
  const sel = new Set(['u1', 'u2']);
  expect(menuActsOnSelection({ webUrl: 'u1' }, sel, 2)).toBe(true);
  expect(menuActsOnSelection({ webUrl: 'u3' }, sel, 2)).toBe(false);
  expect(menuActsOnSelection({ webUrl: 'u1' }, new Set(['u1']), 1)).toBe(false);
  expect(menuActsOnSelection({ webUrl: null }, sel, 2)).toBe(false);
});
```

Run: `cd apps/board && bun test src/__tests__/selection.test.ts`
Expected: FAIL, `menuActsOnSelection` is not exported.

- [ ] **Step 2: Add `menuActsOnSelection`**

Append to `src/selection.ts`:

```ts
/** Whether a right-click on this row opens the menu for the whole
    selection. One checked row keeps the richer one-row menu. */
export function menuActsOnSelection(
  mr: { webUrl?: string | null },
  selected: ReadonlySet<string>,
  selectedCount: number
): boolean {
  return !!mr.webUrl && selected.has(mr.webUrl) && selectedCount > 1;
}
```

Run: `cd apps/board && bun test src/__tests__/selection.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing board-level tests**

`src/client/board/__tests__/bulk-menu-dom.test.tsx`:

```tsx
/** Board-level tests for the bulk menu: a real happy-dom document and a real
    Board render, with fetch faked. */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

class FakeEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function boardMr(iid: number, over: Record<string, unknown> = {}) {
  return {
    iid,
    title: `mr ${iid}`,
    webUrl: `https://gitlab.example.com/g/p/-/merge_requests/${iid}`,
    author: { username: 'matt', name: 'Matt' },
    sourceBranch: `b${iid}`,
    targetBranch: 'main',
    updatedAt: '2026-08-19T00:00:00Z',
    createdAt: '2026-08-19T00:00:00Z',
    reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
    blockers: { any: false },
    mergeButton: { visible: true, disabled: false, loading: false },
    rebaseButton: { visible: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    behindTarget: 2,
    isStacked: false,
    reviewerComments: 0,
    unresolvedThreads: 0,
    isDraft: false,
    pipelineState: 'none',
    repositoryId: `gitlab:${iid}`,
    rtRepo: null,
    codeownerSections: [],
    gates: [],
    ...over,
  };
}

const member = (username: string) => ({ username, name: username, count: 0 });
const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'matt',
  members: [member('matt'), member('kim'), member('jo')],
  allMembers: ['matt', 'kim', 'jo'].map(u => ({ ...member(u), hidden: false })),
  mrs: [
    boardMr(101),
    boardMr(102),
    boardMr(103, { isStacked: true, targetBranch: 'b101' }),
  ],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
  slackTemplates: {
    single: '{title}: {url}',
    multiHeader: '{count} ready',
    multiItem: '- {title}',
  },
  dataSyncedAt: 1755600000000,
  scopeUncovered: [],
  scopeUncoveredSections: [],
  scopeKnownSections: null,
  scopeWindowDays: null,
  staleAfterDays: 90,
  canInvite: false,
  peering: null,
  tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;
const realFetch = globalThis.fetch;
let posts: Array<{ url: string; body: Record<string, unknown> }> = [];
let root: ReturnType<typeof import('react-dom/client').createRoot>;
let container: HTMLDivElement;

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (init?.method === 'POST')
      posts.push({ url, body: JSON.parse(String(init.body)) });
    if (url.startsWith('/data.json'))
      return new Response(JSON.stringify(BOARD_DATA), { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  window.open = (() => null) as typeof window.open;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(async () => {
  posts = [];
  localStorage.clear();
  history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await settle();
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

async function settle() {
  for (let i = 0; i < 3; i++)
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
}

function row(iid: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-mr-iid="${iid}"]`);
  if (!el) throw new Error(`no row !${iid}`);
  return el;
}

async function check(iid: number) {
  const box = row(iid).querySelector<HTMLElement>('[role="checkbox"]');
  if (!box) throw new Error(`no checkbox on !${iid}`);
  await React.act(async () => box.click());
}

async function rightClick(iid: number) {
  await React.act(async () => {
    row(iid).dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      })
    );
  });
}

const menu = () => document.querySelector('[data-part="contextmenu"]');
const items = () =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
async function click(text: string) {
  const hit = items().find(el => el.textContent?.includes(text));
  if (!hit) throw new Error(`no item "${text}" in ${items().map(i => i.textContent).join(' | ')}`);
  await React.act(async () => hit.click());
  await settle();
}

test('right-click on a checked row, two checked, opens the menu for the selection', async () => {
  await check(101);
  await check(102);
  await rightClick(101);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for 2 selected');
  expect(items().some(i => i.textContent === 'rebase on target2 of 2')).toBe(true);
});

test('right-click on an unchecked row opens its own menu', async () => {
  await check(101);
  await check(102);
  await rightClick(103);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for !103');
});

test('right-click on the only checked row opens its own menu', async () => {
  await check(101);
  await rightClick(101);
  expect(menu()?.getAttribute('aria-label')).toBe('actions for !101');
});

test('the actions button opens the same menu', async () => {
  await check(101);
  await check(102);
  const button = [...container.querySelectorAll<HTMLElement>('.tui-selbar button')].find(
    b => b.textContent?.includes('actions')
  );
  if (!button) throw new Error('no actions button');
  await React.act(async () => button.click());
  expect(menu()?.getAttribute('aria-label')).toBe('actions for 2 selected');
});

test('a bulk rebase posts once per MR and speaks once', async () => {
  await check(101);
  await check(102);
  await rightClick(101);
  await click('rebase on target');
  expect(
    posts.filter(p => p.url === '/mr/action').map(p => [p.body.iid, p.body.action])
  ).toEqual([
    [101, 'rebase'],
    [102, 'rebase'],
  ]);
  expect(document.body.textContent).toContain('rebase started on 2');
});

test('bulk merge arms on the first click and merges on the second', async () => {
  await check(101);
  await check(102);
  await rightClick(101);
  await click('merge');
  expect(posts.filter(p => p.url === '/mr/action')).toEqual([]);
  await click('really merge 2?');
  expect(
    posts.filter(p => p.url === '/mr/action').map(p => p.body.action)
  ).toEqual(['merge', 'merge']);
});

test('a checked child of an open MR blocks bulk merge with the reason', async () => {
  await check(101);
  await check(103);
  await rightClick(101);
  const merge = items().find(i => i.textContent?.includes('blocked'));
  expect(merge?.textContent).toContain('!103 sits on !101, which is still open');
  expect(merge?.hasAttribute('disabled')).toBe(true);
  await React.act(async () => merge?.click());
  await settle();
  expect(posts.filter(p => p.url === '/mr/action')).toEqual([]);
});

test('the actions button with one checked row opens that row menu', async () => {
  await check(102);
  const button = [
    ...container.querySelectorAll<HTMLElement>('.tui-selbar button'),
  ].find(b => b.textContent?.includes('actions'));
  if (!button) throw new Error('no actions button');
  await React.act(async () => button.click());
  expect(menu()?.getAttribute('aria-label')).toBe('actions for !102');
});

test('an armed confirm disarms when its wording changes under it', async () => {
  const { ActionMenu } = await import('../ActionMenu.tsx');
  const fired: string[] = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  const r = createRoot(host);
  const draw = (confirm: string) =>
    React.act(async () =>
      r.render(
        React.createElement(ActionMenu, {
          x: 0,
          y: 0,
          subject: '2 selected',
          entries: [
            { key: 'merge', section: 'gitlab', label: 'merge', glyph: null, confirm },
          ],
          onRun: (key: string) => {
            fired.push(key);
          },
          onClose: () => {},
        })
      )
    );
  await draw('really merge 2?');
  await click('merge');
  expect(items().map(i => i.textContent)).toEqual(['really merge 2?']);
  await draw('really merge 3?');
  expect(items().map(i => i.textContent)).toEqual(['merge']);
  await click('merge');
  expect(fired).toEqual([]);
  await click('really merge 3?');
  expect(fired).toEqual(['merge']);
  await React.act(async () => r.unmount());
  host.remove();
});

test('request review from… asks the picked person on each MR', async () => {
  await check(101);
  await check(102);
  await rightClick(101);
  await click('request review from…');
  await click('kim');
  expect(
    posts.filter(p => p.url === '/nudge').map(p => [p.body.iid, p.body.reviewer])
  ).toEqual([
    [101, 'kim'],
    [102, 'kim'],
  ]);
});
```

Run: `cd apps/board && bun test src/client/board/__tests__/bulk-menu-dom.test.tsx`
Expected: FAIL. The first test finds `actions for !101` instead of `actions for 2 selected`.

- [ ] **Step 4: Add the two glyphs**

In `src/client/board/icons.tsx`, add two keys to `MENU_PATHS`:

```ts
  checks: 'M3 17l2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8',
  chevron: 'M6 9l6 6 6-6',
```

- [ ] **Step 5: Add the actions button to `SelectionBar`**

In `src/client/board/SelectionBar.tsx`:
- Import `MenuGlyph` alongside `SlackLogo`: `import { MenuGlyph, SlackLogo } from './icons.tsx';`
- Add `onActions` to the props (destructured and typed):

```ts
  /** Opens the row menu for the selection, anchored under the button. */
  onActions: (x: number, y: number) => void;
```

- Between the post button's `)}` and the clear `<button`, add:

```tsx
        <button
          className="tui-copy"
          onClick={e => {
            const r = e.currentTarget.getBoundingClientRect();
            onActions(r.left, r.bottom + 4);
          }}
          title="act on the selection"
          aria-haspopup="menu"
        >
          <MenuGlyph kind="checks" /> actions <MenuGlyph kind="chevron" />
        </button>
```

- [ ] **Step 6: Style the blocked item**

In `src/style.css`, directly after the `.tui-menu-emoji { ... }` rule, add:

```css
/* A bulk item that cannot run keeps its words on one line with the reason
   wrapped under them, indented past the 13px icon and 9px gap. The
   recipe's :disabled rule dims the whole item. */
.tui-menu-blocked {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tui-menu-reason {
  max-width: 15rem;
  padding-left: 22px;
  font-size: 11px;
  color: var(--text-3);
  white-space: normal;
}
```

- [ ] **Step 7: Wire the bulk menu into `Board.tsx`**

a. Imports: add `import { ActionMenu } from './ActionMenu.tsx';`, add `runBulk` to the `./action-runner.ts` import, add `bulkActions` as a value import from `./row-actions.ts` (`import { bulkActions, type ActionEnv, type LaunchFlow, type RowAction, type RunOpts } from './row-actions.ts';`), and add `menuActsOnSelection` to the existing `../../selection.ts` import.

b. Directly after the `actionEnv` object from Task 4, add:

```ts
  const bulkEntries =
    rowMenu && menuActsOnSelection(rowMenu.mr, selected, selectedMrs.length)
      ? bulkActions(selectedMrs, actionEnv)
      : null;
```

c. On `<SelectionBar`, add the prop:

```tsx
            onActions={(x, y) => {
              const first = selectedMrs[0];
              if (first) setRowMenu({ x, y, mr: first });
            }}
```

d. Replace the `{rowMenu && ( <RowMenu ... /> )}` element from Task 4 with:

```tsx
      {rowMenu &&
        (bulkEntries ? (
          <ActionMenu
            x={rowMenu.x}
            y={rowMenu.y}
            subject={`${selectedMrs.length} selected`}
            entries={bulkEntries}
            onClose={() => setRowMenu(null)}
            onRun={(key, opts) => {
              const entry = bulkEntries.find(e => e.key === key);
              return entry ? runBulk(entry, opts, runner) : undefined;
            }}
          />
        ) : (
          <RowMenu
            menu={rowMenu}
            env={actionEnv}
            onRun={runRowAction}
            onClose={() => setRowMenu(null)}
          />
        ))}
```

- [ ] **Step 8: Run the bulk tests, then everything**

Run: `cd apps/board && bun test src/client/board/__tests__/bulk-menu-dom.test.tsx`
Expected: PASS (10 tests).
Format first, since `format:check` fails on long lines and unsorted imports:
`bunx prettier --write apps/board/src/selection.ts apps/board/src/__tests__/selection.test.ts apps/board/src/client/board/icons.tsx apps/board/src/client/board/SelectionBar.tsx apps/board/src/style.css apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/bulk-menu-dom.test.tsx`
Then run from the root: `bun run board:typecheck && bun run board:test && bun run format:check && bash scripts/repo-purity.sh`
Expected: all PASS, with the Task 1 pins untouched.

- [ ] **Step 9: Format and commit**

```bash
bunx prettier --write apps/board/src/selection.ts apps/board/src/__tests__/selection.test.ts apps/board/src/client/board/icons.tsx apps/board/src/client/board/SelectionBar.tsx apps/board/src/style.css apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/bulk-menu-dom.test.tsx
git add apps/board/src/selection.ts apps/board/src/__tests__/selection.test.ts apps/board/src/client/board/icons.tsx apps/board/src/client/board/SelectionBar.tsx apps/board/src/style.css apps/board/src/client/board/Board.tsx apps/board/src/client/board/__tests__/bulk-menu-dom.test.tsx
git commit -m "board: act on the selection from the row menu and the selection bar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Render it and look

**Files:** none expected; fixes found here land in the files they belong to, each in its own commit.

UI validation is the deliverable. Nothing is done until both themes have been rendered and looked at.

- [ ] **Step 1: Build and serve the fixture board**

From `apps/board`: `bun run build:client`, then start `BOARD_FIXTURE=tests/fixture PORT=7941 bun run src/server.ts` in the background. Use raw `http://localhost:7941`, never a `.mattstack` URL (it hands the tab to the desktop app and kills it).

- [ ] **Step 2: Screenshot the bulk states in both themes**

Through the `fast-browser:browser-driver` agent (spelled exactly that way; drive the Fast Browser MCP tools directly if that agent type is missing), for each theme (set localStorage `mrs-theme` to `light`, reload, shoot; then `dark`; then restore the original value):
1. Check three rows, right-click one of them: the full bulk menu.
2. Click merge once: the armed `really merge N?` state.
3. Check a stacked child and its open parent, right-click: the blocked merge with its reason.
4. Open `request review from…`: the picker with per-person counts.
5. Close the menu; screenshot the selection bar with the actions button, then click it: the menu anchored under the button.
6. Right-click an unchecked row: the one-row menu, unchanged.

Save shots under `apps/board/tests/.captures/` (git-ignored), for example `bulk-menu-light.png`.

- [ ] **Step 3: Compare against B11 and report plainly**

Put each shot next to B11's export (export from `docs/design/board/board.pen`, or compare to the approved design as described in the spec). Check: section order and labels, the `N of M` counts right-aligned and muted, the reason line wrapping under the blocked label and aligned with the label text, the button's height and spacing matching `copy` / `post` / `clear`, no clipped menu at the viewport edge, contrast in both themes. Say what looks wrong in plain words. Fix what is wrong, re-shoot, and only then call the task done.

- [ ] **Step 4: Confirm the rest of the board did not move**

From `apps/board`: `bun run capture && bun run capture:compare`. Expected: every shot matches its baseline except `selection-light` and `selection-dark`, which change on purpose (`tests/capture.ts` shoots the selection bar, and it now has the actions button). If any other shot differs, find out why before going on.

Look at the two new selection shots in `tests/.captures/` next to their old baselines: the only change must be the actions button between `post` and `clear`, the same height and spacing as its neighbors. Then re-baseline just those two by copying them (not `capture:baseline`, which rewrites every baseline): `cp tests/.captures/selection-light.png tests/.captures/selection-dark.png tests/baselines/`. Confirm with `git status --short tests/baselines` that only those two changed, re-run `bun run capture:compare` (all match), and commit them as `board: re-baseline the selection bar captures for the actions button`.

- [ ] **Step 5: Final gates**

From the root: `bun run board:typecheck && bun run board:test && bun run board:build && bun run format:check && bash scripts/repo-purity.sh`
Expected: all PASS.
