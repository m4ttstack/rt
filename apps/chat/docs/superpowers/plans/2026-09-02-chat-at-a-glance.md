# Chat at a Glance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the chat viewer's human lens on the inbox + fleet-tree model: a task line beside every handle, an Inbox landing view, one sidebar tree, folded read messages, and no room roster panel.

**Architecture:** The viewer server enriches the buddies it already returns with the herdr pane title (one `pane:list` join) and grows an inbox endpoint computed from unread pages; the client gets one `doing()` helper used by every handle surface, a `FleetTree` that replaces the rail lists and the roster, and an `Inbox` page with a reader column. rt (repo-tools) separately pins handles to panes.

**Tech Stack:** Bun + Hono server, React + Mantine (`@mattstack/app-kit`) client, wouter routes, vitest (NOT bun:test), design audit via `design/audit.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-02-chat-at-a-glance-design.md` (read it first; `design/ANATOMY.md` carries per-component structure, `design/artboards/*.dc.html` the drawn truth).

## Global Constraints

- Tokens over literals: sizes/colors come from the theme; the design audit (`CONFORMANCE.md`) is the acceptance gate for UI tasks — new components get TARGETS entries.
- Never render presence while the daemon is unreachable (law 1); every new surface has a daemon-down state drawn in the artboards.
- No em/en dashes in copy; times local; phone inputs 16px, controls 44px.
- **Mantine comes from its docs, never from memory. This is mandatory for every task that writes or edits a component.** Before using a Mantine component or any prop on one, resolve it against the **mantine MCP server**: `mcp__mantine__list_items` (what exists), `mcp__mantine__get_item_props` (the props table, the authority for names, types and defaults), `mcp__mantine__get_item_doc` (usage and examples), `mcp__mantine__search_docs` (when the component name is unknown). `docs/mantine-llms.txt` is the vendored offline INDEX only... it names the pages and carries no prop signatures, so it settles "does this component exist" and never "what props does it take". The project is on Mantine **9.5.2**; a prop remembered from another version is a defect. State in the task report which components were resolved and through which tool.
- **The app-kit contract binds every UI task, and its own docs are the authority.** Before writing or editing any component, invoke the **`building-with-mantine-kit` skill** (it covers picking components, theming, colors, icons, forms, layout and router links for an app already on the kit), then read the kit contract at **`~/Documents/GitHub/app-kit/AGENTS.md`** (import walls, icon registry, theme override patterns, modal/notification/form facades, the `MattstackShell`/`mountMattstackApp` layer, the server package) and this repo's **`AGENTS.md`** for what is specific to how chat consumes it. The hard rule the walls enforce: app code NEVER imports `@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/modals`, `@mantine/notifications` or `lucide-react` directly... every Mantine-shaped import goes through the `@mattstack/app-kit/*` subpath barrels, and `src/app/icons.ts` is the one sanctioned place a lucide icon is registered. `mattstackEslint()` fails the build on a violation, so a wall breach is a defect, not a style note.
- Comments follow clean-code rules: only non-obvious invariants, no narration.
- Tests are **vitest**: import from `'vitest'`, never `'bun:test'`, and run them with `bun run test` (`bun test` invokes Bun's own runner and will not see these suites). After each task: `bun run test` green, `bun run lint` clean (the import wall is enforced there), commit.

---

### Task 1: `doing()` — the task-line resolver

**Files:**

- Create: `src/app/doing.ts`, `src/app/doing.test.ts`

**Interfaces:**

- Consumes: `PresenceRow & { status: BuddyStatus }` (rt-client) plus the new optional `paneTitle`.
- Produces: `doing(b: DoingInput): DoingLine | null` where
  `type DoingInput = { handle: string; status: 'live'|'idle'|'offline'; branch?: string; cwd?: string; paneTitle?: string; statusText?: string; signedOutAt?: number }` and
  `type DoingLine = { text: string; kind: 'away'|'title'|'branch'|'path'|'signed-out' }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from 'vitest';

import { doing } from './doing';

const base = {
  handle: 'max',
  status: 'live' as const,
  branch: 'main',
  cwd: '/Users/matt/Documents/GitHub/repo-tools',
};

describe('doing', () => {
  test('away message wins over everything', () => {
    expect(
      doing({ ...base, statusText: 'rebasing #67', paneTitle: 'Audit pass' })
    ).toEqual({ text: 'rebasing #67', kind: 'away' });
  });
  test('pane title when it is not the handle', () => {
    expect(doing({ ...base, paneTitle: 'Audit corrections' })).toEqual({
      text: 'Audit corrections',
      kind: 'title',
    });
  });
  test('title equal to handle falls through to branch/path', () => {
    expect(doing({ ...base, paneTitle: 'max' })).toEqual({
      text: 'repo-tools · main',
      kind: 'path',
    });
  });
  test('branch when not main, ticket prefix stripped', () => {
    expect(
      doing({ ...base, branch: 'goodwinmattheweric/rt-96-provision-blocks' })
    ).toEqual({ text: 'rt-96-provision-blocks', kind: 'branch' });
  });
  test('worktree folder fallback on main', () => {
    expect(doing(base)).toEqual({ text: 'repo-tools · main', kind: 'path' });
  });
  test('offline shows sign-out age only', () => {
    const line = doing({
      ...base,
      status: 'offline',
      signedOutAt: Date.now() - 3 * 60_000,
    });
    expect(line).toEqual({ text: 'signed out 3m ago', kind: 'signed-out' });
  });
  test('offline with no signedOutAt gives null', () => {
    expect(doing({ ...base, status: 'offline' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test src/app/doing.test.ts`, expect module-not-found.
- [ ] **Step 3: Implement** — reuse the existing relative-age formatter (`statusDetail.ts` has one; extract/share rather than duplicating). Ticket-prefix rule: strip the first segment of a `<something>/<rest>` branch only when `<rest>` matches `/^[a-z]+-\d/` (a ticket slug), so `feat/metrics-hardening` keeps its prefix.
- [ ] **Step 4: `bun run test src/app/doing.test.ts` green.**
- [ ] **Step 5: Commit** — `feat: doing() task-line resolver`.

### Task 2: fixtures on the FLEET table + `paneTitle` join

**Files:**

- Modify: `src/server/fixtures.ts` (rewrite `fixtureBuddies`, `fixtureRooms`, `fixtureMembers`, `fixtureMessages` onto `design/build.py`'s FLEET/ROOMS/DMS/RT_MSGS tables: handles `max edie jay remy gail kai ida jax sid meg stan elsa wren`, rooms `rt skills console boxscore`, the #rt conversation incl. the 44-line tsc log built by the same formula as `_tsc_log()`), keep function signatures.
- Modify: `src/server/chat.ts:192-215` (`/api/chat/buddies`)
- Test: `src/server/chat.test.ts`, `src/server/fixtures.test.ts`

**Interfaces:**

- Produces: `/api/chat/buddies` rows are `PresenceRow & { status, rooms: string[], paneTitle?: string }`. Fixture buddies carry `paneTitle` for `edie` (`Pipeline iteration loop`) and `jay` (`Boxscore mattstack integration`); `max`'s pane title equals the handle.

- [ ] **Step 1: Failing test** — in `chat.test.ts`, with fixtures enabled, `GET /api/chat/buddies` returns `jay` with `paneTitle: 'Boxscore mattstack integration'` and `max` with `paneTitle: 'max'`; with a stubbed rt where `pane:list` fails, buddies still return (no `paneTitle`).
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — in the buddies handler, alongside the per-buddy rooms wave, call the same pane-list client `src/server/panes.ts` uses: `paneList(rtOpts())` from `@mattstack/rt-client` (the export is `paneList`, NOT `listPanes`), which resolves to `{ ok, data?: { panes: ChatPane[] }, error? }`. Build `Map(sessionId -> title)` from `data.panes`; spread `paneTitle` onto each buddy when the map has its `sessionId`. Any failure degrades to no titles (empty map), including the `herdr unavailable` error prefix that `panes.ts` already treats as a normal state rather than a 502. Update fixtures.
- [ ] **Step 4: `bun run test src/server` green** (fixture tests updated to the new tables in the same commit).
- [ ] **Step 5: Commit** — `feat: buddies carry the live herdr pane title; fixtures mirror the FLEET table`.

### Task 3: task line on every existing handle surface

**Files:**

- Modify: `src/app/AgentName.tsx` (props gain `task?: DoingLine | null`; row/inline variants render it after the repo token as a `.doing`-styled span, dim for `kind: 'path'`; the hover card renders it as its second line and promotes a `focus pane` button first), `src/app/Roster.tsx` (rows pass `doing(buddy)`; drop the branch·pane sub-line from rows — card only), `src/app/buddies-context.tsx` (type grows `paneTitle`), `src/app/Composer.tsx` (@ options show the task line), `src/app/Transcript.tsx` (author `.hdr` passes `task`).
- Test: `src/app/Roster.test.tsx`, `src/app/AgentName` cases inside existing suites.

**Interfaces:**

- Consumes: `doing()` from Task 1, `paneTitle` from Task 2.
- Produces: `AgentNameProps` includes `task?: { text: string; kind: string } | null`.
- **First, amend `doing()`**: give it an optional second parameter `now: number = Date.now()` and use it for the offline age, matching `statusDetail(row, now)`'s convention. `AgentName` already takes a `now` prop so its tests can pin the clock; without this, any roster test that pins `now` gets a non-deterministic sign-out age. Every caller in this task passes the `now` it already has. Add one test to `doing.test.ts` asserting a pinned `now` yields a fixed string.

- [ ] **Step 1: Failing tests** — roster row for a buddy with `paneTitle: 'Boxscore mattstack integration'` renders that text; a `main`-branch buddy renders `repo-tools · main` with the dim class; an away buddy renders the quoted away line and no task line; message header for `jay` includes the task text.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement.** Style values from `design/build.py` `.doing`/`.doing.dim` (10.56px, muted-text / muted); use the theme tokens that resolve to them, per CONFORMANCE.
- [ ] **Step 4: Tests green; run the app once with `CHAT_FIXTURES=1` and eyeball a roster row.**
- [ ] **Step 5: Commit** — `feat: task line beside every handle (roster, headers, hover card, @ picker)`.

### Task 4: FleetTree replaces the rail lists and the roster panel

**Files:**

- Create: `src/app/FleetTree.tsx`, `src/app/FleetTree.test.tsx`, `src/app/fleet-tree.module.css`
- Modify (server, for the DM second line): `src/server/chat.ts` (the `/api/chat/rooms` handler gains `lastMessage?: { handle: string; body: string }` on DM summaries, body capped at 120 chars server-side, filled from the newest message of each DM room), `src/server/fixtures.ts` (fixture DM rooms carry it), `src/server/chat.test.ts`
- Modify: `src/app/RoomRail.tsx` (its room/DM list body becomes `<FleetTree/>`; keep the close/menu wiring by passing it through), `src/app/App.tsx` (remove the `Roster` panel from the room page; delete the `join order` select from `PageBar`), `src/app/PageBar.tsx` (chips unchanged; DM bar gains per-end task chips), `src/app/Roster.tsx` (the `Roster` panel stops being rendered by the page). **Do not delete this module.** `AgentCard` is defined in `AgentName.tsx`, not here; what actually lives here and must survive is the `RosterBuddy` type, imported by `App.tsx`, `AgentName.tsx`, `buddies-context.tsx`, `Roster.test.tsx` and `Transcript.test.tsx`. Keep exporting it from this file... do not relocate it in this task, since a 5-file type move is churn that belongs in a cleanup pass. If the `Roster` component itself ends up unrendered after Task 8, leaving it as dead code for the final review to triage is the correct outcome here.
- Test: `src/app/RoomRail.test.tsx`, `src/app/App.test.tsx` updated.

**Interfaces:**

- Consumes: rooms from `/api/chat/rooms`, buddies (with `paneTitle`) from context, `doing()`.
- Produces: `FleetTree({ rooms, buddies, dms, activeRoom, onOpenRoom, onOpenDm, onFocusPane, onClose })`; groups by `buddy.repo` in the order `[...rooms' repos, repos with agents but no room]`.

- [ ] **Step 1: Failing tests** — tree groups `max` and `remy` under the `rt` room row; `board` renders a `no room` group row (non-clickable); 6 offline rt buddies collapse to one line naming them; a single offline buddy keeps name + age; DM entry `jay ↔ max` renders second line `Boxscore mattstack integration ↔ repo-tools`; DM with two untitled ends renders the last-message line; workstream click calls `onFocusPane('wBT:p1')`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** against ANATOMY "Fleet tree" (row heights 34/30/26, indent 26.4px, `.dm2` two-liner). DM last-message line needs the server field: extend `/api/chat/rooms` DM summaries with `lastMessage?: { handle: string; body: string }` (body capped at 120 chars in `src/server/chat.ts`, filled from the newest message per DM room; fixtures too). Daemon-down: hollow dots, `presence withheld`/`last known` lines.
- [ ] **Step 4: Tests green; fixture eyeball at 1440 and 390 (drawer).**
- [ ] **Step 5: Commit** — `feat: fleet tree sidebar; retire the room roster panel and join-order select`.

### Task 5: inbox endpoint

**Files:**

- Create: `src/server/inbox.ts`, `src/server/inbox.test.ts`
- Modify: `src/server/chat.ts` (mount `GET /api/chat/inbox`), `src/server/fixtures.ts` (fixture inbox derives from fixture messages).

**Interfaces:**

- Produces:

```ts
interface InboxCard {
  room: string;
  kind: 'room' | 'dm';
  participants?: { a: string; b: string };
  messageId: number;
  handle: string;
  postedAt: number;
  excerpt: string; // plain text, first ~200 chars
  reason: 'mention' | 'dm-turn' | 'open-ask';
}
interface InboxPayload {
  needsYou: InboxCard[];
  openAsks: InboxCard[];
  elsewhere: {
    room: string;
    kind: 'room' | 'dm';
    unread: number;
    mentions: number;
  }[];
}

// Exported for Task 7's transcript chip, so "unclaimed @here" has one definition:
export function isOpenAsk(
  msg: ChatMessage,
  laterInRoom: ChatMessage[]
): boolean;
```

- [ ] **Step 1: Failing tests** (pure builder over message arrays + cursors, no HTTP): a message mentioning `matt` after the cursor → `needsYou` with `reason: 'mention'`; an agent message in a `x ↔ matt` DM after the cursor → `dm-turn`; `@here` message with no later `replyTo` pointing at it → `openAsks`; the same with a reply → excluded; everything before the cursor → excluded; remaining unread counted into `elsewhere`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** `buildInbox(rooms: RoomSummaryWithCursor[], pagesByRoom: Map<string, ChatMessage[]>): InboxPayload` plus the Hono handler that fetches each room's unread page (existing message paging, capped at 50 per room) and Matt's cursors. Excerpt: strip markdown to plain text (first paragraph, code fences dropped).
- [ ] **Step 4: `bun run test src/server` green.**
- [ ] **Step 5: Commit** — `feat: /api/chat/inbox (needs-you, open-asks, elsewhere)`.

### Task 6: Inbox page + reader (desktop)

**Files:**

- Create: `src/app/Inbox.tsx`, `src/app/InboxCard.tsx`, `src/app/Reader.tsx`, tests for each, `src/app/inbox.module.css`
- Modify: `src/app/routes.ts` (`home` renders Inbox; the rail's two entries), `src/app/App.tsx` (route wiring; closing the open conversation navigates to `/`).
- **`src/app/mark-read.ts` is NOT modified.** The daemon's `chat:mark` takes `{handle, room?}` only (`markRead(handle, room, db)`, `lib/daemon/handlers/chat.ts:1038`), so there is no per-message cursor. Read semantics below.

**Read semantics, corrected against the daemon.** Per-message cursors do not exist, so:

- A card's `mark read` calls the existing room-level mark for that card's room, and its label names the room (`mark #rt read`, not a bare `mark read`), because it also clears that room's other unread.
- Replying in the reader posts and nothing else. It does NOT advance a cursor, and the footer copy must not claim it does.
- `mark all read` keeps today's meaning: the per-room mark, for every room.
- A future `chat:mark --upto <messageId>` in rt would allow true per-card granularity. Out of scope here.

**Interfaces:**

- Consumes: `InboxPayload` (Task 5), anchor-window message fetch (exists from the paging round), `doing()`.
- Produces: `Reader({ card, onReplied })`; replying posts via the existing composer post path with the author pre-tagged, and moves no cursor.

- [ ] **Step 1: Failing tests** — sections render in order with counts; a card click sets the reader to that message and fetches one message of context above; `mark read` on a card calls the room-level mark for that card's room and its label names the room; reply posts `@jay ...` to `#boxscore` and moves no cursor; `open #boxscore` links to `/r/boxscore#m-<id>`; daemon-down disables the reader composer and swaps ages to `last known`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** per ANATOMY "Inbox": 560px card list on bg3, reader on bg1, `.card2` anatomy, `.msg.context` + `the message you opened` divider. WS liveness: refetch inbox on any msg frame and on mark-read, same rules as the rail.
- [ ] **Step 4: Tests green; fixture eyeball against `Main.dc.html`.**
- [ ] **Step 5: Commit** — `feat: inbox landing view with reader column`.

### Task 7: folding + unclaimed chips in the transcript

**Files:**

- Create: `src/app/folding.ts`, `src/app/folding.test.ts`
- Modify: `src/app/Transcript.tsx`, `src/app/MessageMarkdown.tsx` (first-block render mode), `src/app/use-expand-all.ts` (expand-all also unfolds).

**Interfaces:**

- Produces: `foldPlan(msgs: ChatMessage[], unreadCount: number | undefined, anchorId?: string): Map<number, { folded: boolean; moreLines: number }>`; `MessageMarkdown` gains `firstBlockOnly?: boolean`.
- **There is no cursor id to fold against.** `Transcript` already locates the read boundary from a COUNT, not an id: `dividerAt = messages.length - unreadCount` (`Transcript.tsx:636-640`), and its own prop comment at `:164-168` says there is no `lastReadId` in that surface. So fold messages at index `< dividerAt` and render those at `>= dividerAt` whole, reusing the exact boundary the divider already draws so the fold line and the `N new` divider can never disagree. When `unreadCount` is undefined or 0, nothing is unread and everything folds.

- [ ] **Step 1: Failing tests** — messages before `dividerAt` fold, those at or after it render whole, and the fold boundary equals the divider's; `moreLines` counts source lines after the first block; the anchored (`#m-<id>`) message never folds; expand-all unfolds; an `@here` message with no reply renders the `unclaimed <age>` chip (reuse the Task 5 builder's predicate, exported).
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** — `.foldrow` per spec.json; the 480px `.fold`/`show more` path untouched and composing.
- [ ] **Step 4: Tests green; eyeball `Room.dc.html` parity with fixtures.**
- [ ] **Step 5: Commit** — `feat: read messages fold to their first block; unclaimed @here chips`.

### Task 8: phone inbox, reader, drawer

**Files:**

- Modify: `src/app/Inbox.tsx` (list-only below the phone breakpoint; card tap routes to a reader view), `src/app/Reader.tsx` (phone header variant: back, ctx chip, `<handle> needs you`, open icon), `src/app/RoomRail.tsx` drawer (fleet tree + health line; drop the drawer BUDDIES section).
- Test: existing App/RoomRail suites at the phone width.

- [ ] **Step 1: Failing tests** — at phone width `/` renders the card list without the reader; tapping a card shows the reader with the back control; the drawer contains the tree and no BUDDIES heading.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement** per `PhoneInbox/Phone/PhoneRooms` artboards (44px targets, 16px input).
- [ ] **Step 4: Tests green; 390px fixture eyeball.**
- [ ] **Step 5: Commit** — `feat: phone inbox, reader and fleet drawer`.

### Task 9: design audit re-baseline

**Files:**

- Modify: `design/audit.mjs` (TARGETS: add `.ws`, `.ws.more`, `.dm2`, `.doing`, `.doing.dim`, `.card2`, `.card2.on`, `.ctx`, `.ctx.dm`, `.ctx.warn`, `.foldrow`, `.lead`, `.kv`, the inbox page bar chips, the reader strip; retire `.roster-panel` and the old member sub-line targets).

- [ ] **Step 1: Add TARGETS; run `python3 design/extract-spec.py` (no-op unless build.py changed).**
- [ ] **Step 2: `CHAT_FIXTURES=1 bun src/server/index.ts`, capture with `node design/audit.mjs --probe` through Fast Browser, both schemes.**
- [ ] **Step 3: `node design/audit.mjs <capture>` green (or each mismatch fixed in the component, never by relaxing spec.json).**
- [ ] **Step 4: Commit** — `design: audit targets for the inbox + fleet-tree surfaces`.

### Task 10 (repo-tools): pin handles to herdr panes, and add `chat:mark --upto`

**Files (in `~/Documents/GitHub/repo-tools`, its own worktree and PR):**

- Modify: `commands/chat.ts` (`resolveSignInBaseHandle` chain gains the pane-pin lookup between the session-prior step and the pool draw), `lib/daemon/handlers/chat.ts` + `lib/state/presence-store.ts` (a `chat_pane_handles` kv map: pane id → baseHandle, upserted on sign-in when `HERDR_PANE_ID` resolves, LRU-capped at 200), tests beside each.

**Interfaces:**

- Produces: sign-in on a pane that previously held `max` resolves base `max` again; a different pane still draws LRU-fresh; `--as` and `chat.handle` still win.

- [ ] **Step 1: Failing daemon test** — sign-in with pane `wAR:p3` drawing `max`, sign-out, sign-in again with the same pane: base is `max`; with pane `wZZ:p9`: base is a fresh draw.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement; suffix-on-collision untouched.**
- [ ] **Step 4: Tests green.**
- [ ] **Step 5: Commit** — `feat(chat): pin drawn handles to their herdr pane`.

**Part B, added 2026-09-02 on Matt's call: `chat:mark --upto <messageId>`.**

Three defects in this round traced to one root cause: the daemon exposes no
per-message read cursor, so `chat:mark` can only clear a whole room. That forced
the viewer's inbox into coarse behaviour (a card's `mark read` clears its room's
other unread, and the label has to say so). This part removes the root cause.

- Modify: `lib/state/chat-store.ts` (`markRead` gains an optional message id; when
  given, the cursor advances to THAT message rather than to the newest, so later
  messages stay unread), `lib/daemon/handlers/chat.ts` (`chat:mark`'s payload
  gains `upto?: number`), `packages/rt-client/src/commands.ts` + `client.ts`
  (`chatMark` payload type and function signature), `commands/chat.ts` (the CLI
  gains `--upto`), tests beside each.
- Backward compatibility is required: `chat:mark` with no `upto` must behave
  exactly as today (clear the whole room). Existing callers, including this
  viewer's `postMarkRead`, must not change behaviour until Task 11 opts in.

- [ ] **Step 6: Failing test** — mark with `upto` set to the middle message of a
      room leaves the later messages unread and the earlier ones read; mark with no
      `upto` still clears the room entirely.
- [ ] **Step 7: Run, expect fail.**
- [ ] **Step 8: Implement across store, handler, rt-client and CLI.**
- [ ] **Step 9: Tests green; publish the rt-client version this repo will consume.**
- [ ] **Step 10: Commit + PR** — one PR carrying both parts.

---

### Task 11: spend `--upto` in the viewer, and restore the surgical read

**Depends on Task 10 Part B landing and its rt-client version being consumable.**

**Files:**

- Modify: `src/app/mark-read.ts` (`postMarkRead(room, upto?)`), `src/server/chat.ts`
  (the `/api/chat/mark` route accepts and forwards `upto`), `src/app/InboxCard.tsx`
  (the label reverts to a plain `mark read`, since it is no longer clearing the
  room), `src/app/Reader.tsx` (replying advances the cursor to the card's message,
  the one act that both posts and marks read), plus their tests.
- Modify **in the same commit**: `docs/superpowers/specs/2026-09-02-chat-at-a-glance-design.md`
  and `design/ANATOMY.md`. Both were written one way, corrected mid-round when the
  daemon turned out to lack the cursor, and now revert. A review in this round
  already caught `ANATOMY.md` drifting out of step with the code on exactly this
  point, so the docs move with the behaviour or not at all.

**Interfaces:**

- Produces: `postMarkRead(room: string, upto?: number): Promise<void>`; a card's
  `mark read` passes the card's `messageId`, so a room's other unread survives.

- [ ] **Step 1: Failing tests** — a card's `mark read` posts `{room, upto}` with
      the card's message id and the room's other unread count is unchanged; replying
      in the reader posts AND marks up to that message; `mark all read` still clears
      whole rooms with no `upto`.
- [ ] **Step 2: Run, expect fail.**
- [ ] **Step 3: Implement; the label loses its room name.**
- [ ] **Step 4: Tests green, lint/typecheck/format clean.**
- [ ] **Step 5: Commit** — `feat: inbox marks read up to a card's message`.

---

---

## Self-review notes

- Spec coverage: Part 1 → Tasks 1-3; Part 2 → Task 4; Part 3 → Tasks 5-6; Part 4 → Task 7 (+ page-bar bits in Task 4); Part 5 → Task 8; Part 6 → Task 10; testing section → per-task steps + Task 9.
- The DM `lastMessage` server field lives in Task 4 with its consumer, not its own task.
- Type names used across tasks: `DoingLine` (1, 3, 4), `paneTitle` (2, 3, 4), `InboxCard`/`InboxPayload` (5, 6), `foldPlan` (7 only).
