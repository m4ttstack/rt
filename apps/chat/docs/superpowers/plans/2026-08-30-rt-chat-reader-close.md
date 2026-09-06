# rt chat viewer: Reader transcript, Close, liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the viewer's archive feature with a one-gesture Close, make the room list and transcript survive sleeps and proxy restarts, and render agent posts as a readable document column at the app's one body size.

**Architecture:** Close is the daemon's existing `chat:archive` behind a renamed route; the client filters closed rooms out of the rail and never reads `archivedAt` anywhere else. One page-level relay socket with backoff replaces three throwaway sockets. The transcript body moves from a hand-rolled markdown subset to `react-markdown` + `remark-gfm` rendering into an app CSS module sized from the artboards, with fenced code through the kit's lazy `CodeHighlight`.

**Tech Stack:** React 19 + Mantine 9.5.2 through `@mattstack/app-kit` facades, Bun + Hono server via `@mattstack/app-server`, `@mattstack/rt-client` 0.10, wouter, vitest + Testing Library + jsdom, `react-markdown` 10.1, `remark-gfm` 4.0, `unist-util-visit` 5.1, `design/build.py` artboards audited by `design/audit.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-30-rt-chat-reader-close-design.md`

## Global Constraints

- Work in the worktree `/Users/matt/Documents/GitHub/chat/.claude/worktrees/reader-close` on branch `worktree-reader-close`. Run every command from there. Never touch the main checkout.
- Every Mantine-shaped import goes through `@mattstack/app-kit/<subpath>` (`core`, `hooks`, `icons`, `modals`, `notifications`, `lazy`, `app`, `router`, `test-utils`). Never `@mantine/core` directly; the eslint import wall fails the build.
- Mantine props are looked up, not recalled: `mantine` MCP (`get_item_props`) or the docs. This app pins Mantine 9.5.2.
- The words **archive**, **archived** and **reopen** must not appear in any user-visible string, `aria-label`, test name that describes UI copy, or artboard copy after Task 4. The daemon verb `chatArchive` and the `RoomSummary.archivedAt` field keep their names; they are wire contracts, not copy.
- No em dashes or en dashes anywhere (code, comments, commit messages, docs, artboards). Use commas, colons, parentheses or an ellipsis.
- Comments state constraints the code cannot show; never narrate a line, cite a task, or record a decision. Reports go in the task report, not the source.
- Every `data-testid` named below is a contract with the audit (`design/audit.mjs` `TARGETS`) and the tests; use them verbatim.
- Gates for every task: `bun run typecheck`, `bun run lint`, `bunx vitest run` (whole suite), `bun run format` (prettier writes; CI runs `format:check`). Run all four before each commit.
- Commit after every task with the trailer line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Plain `git add <files>` then `git commit`; the worktree guard refuses compound shell lines with git in them.
- `bun install` after any `package.json` change; the lockfile is `bun.lock` and is committed.
- The spec's numbers are the artboards' numbers. Tokyo tokens at a 16px root: spacing xs 4.8 / sm 7.2 / md 9.6 / lg 11.2 / xl 14.4; type xs 10.56 / sm 11.2 / md 12.16 / lg 13.6 / xl 14.72; radius sm 4 / md 6 / lg 8. Prefer the theme token (`var(--mantine-spacing-sm)`, `size="xs"`) to the literal.

## File Structure

| File                                                                                                  | Responsibility                                                                                    | Status |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------ |
| `src/server/chat.ts`                                                                                  | `/api/chat/*` routes; `archive` becomes `close`                                                   | modify |
| `src/server/chat.test.ts`                                                                             | route tests; archive cases become close cases                                                     | modify |
| `src/app/visible-rooms.ts`                                                                            | the one rail filter: open rooms plus the active closed one                                        | create |
| `src/app/mark-read.ts`                                                                                | `postMarkRead(room)`: the `POST /api/chat/mark` call both the page bar and the rail menu make     | create |
| `src/app/RoomRail.tsx`                                                                                | rail rows with hover × and right-click menu; no ARCHIVED section                                  | modify |
| `src/app/PageBar.tsx`                                                                                 | `RoomMenu` offers Close only; no archived chip, no confirm                                        | modify |
| `src/app/ArchivedBar.tsx` + test                                                                      | deleted                                                                                           | delete |
| `src/app/App.tsx`                                                                                     | `closeRoom`, landing on `/`, phone header/drawer without archive, relay hooks, visibility refetch | modify |
| `src/app/relay-socket.ts`                                                                             | one `/ws` connection for the page, backoff, fan-out, open callbacks                               | create |
| `src/app/relay-socket.test.ts`                                                                        | reconnect, fan-out, single instance                                                               | create |
| `src/app/remark-mentions.ts`                                                                          | remark plugin: `@handle` for listed handles only                                                  | create |
| `src/app/MessageMarkdown.tsx`                                                                         | one message body via react-markdown                                                               | create |
| `src/app/MessageMarkdown.test.tsx`                                                                    | every rendered element, raw HTML dropped, mentions                                                | create |
| `src/app/transcript-prose.module.css`                                                                 | the reading column and prose styles, `@font-face` for IBM Plex Sans                               | create |
| `src/app/components/CodeBlock.tsx`                                                                    | unchanged shape; gains `data-testid="code-block"`; used by MessageMarkdown                        | modify |
| `src/app/human.ts`                                                                                    | `HUMAN_HANDLE`, the handle the viewer posts as                                                    | create |
| `scripts/vendor-plex-sans.mjs`                                                                        | one-off download of the three IBM Plex Sans weights                                               | create |
| `src/app/Transcript.tsx`                                                                              | uses MessageMarkdown; parser deleted; `.col`, `.mine`, sender line                                | modify |
| `src/app/test-utils.tsx`                                                                              | `installFakeWebSocket` resets the relay singleton                                                 | modify |
| `public/fonts/ibm-plex-sans-{400,500,600}.woff2`                                                      | vendored prose face                                                                               | create |
| `src/server/fixtures.ts`                                                                              | a heading/table/ordered-list post and a human post in `build`                                     | modify |
| `design/build.py`, `design/spec.json`, `design/audit.mjs`, `design/canvas.json`, `design/artboards/*` | Reader block, Close sheet, no Archived artboard                                                   | modify |
| `design/ANATOMY.md`, `design/CONFORMANCE.md`, `ARCHITECTURE.md`, `AGENTS.md`, `design/README.md`      | docs follow the code                                                                              | modify |

Order: Part 2 (Tasks 1 to 5, close), Part 3 (Tasks 6 to 7, liveness), Part 1 (Tasks 8 to 10, Reader), then Task 11 (fixtures, the full gate, the browser audit, the PR).

---

### Task 1: `POST /api/chat/close` replaces `POST /api/chat/archive`

**Files:**

- Modify: `src/server/chat.ts` (the `.post('/api/chat/archive', ...)` handler, lines 292-336)
- Modify: `src/server/chat.test.ts` (the four `archive` tests, lines 391-590)
- Modify: `ARCHITECTURE.md` (the API table row for `archive`)

**Interfaces:**

- Consumes: `chatRooms`, `chatJoin`, `chatArchive`, `unjoinedFleetRooms`, `humanHandle`, `rtOpts` as already imported in `chat.ts`.
- Produces: `POST /api/chat/close` with body `{ room: string }`, response `200 { room, closedAt: number | null }`, `400 { error }` on a missing room or a room nobody lists, `502 { error }` when the daemon refuses. Task 4's client posts to it.

- [ ] **Step 1: Rewrite the archive tests as close tests**

In `src/server/chat.test.ts`, delete the four tests whose names start with `archiving a channel`, `archiving a room already`, `archive 400s`, `archiving a DM known only` (lines 391-590) and put these in their place:

```ts
test('closing a channel the human never joined joins him first, then closes', async () => {
  vi.mocked(rt.chatRooms)
    .mockResolvedValueOnce({ ok: true, data: { rooms: [] } })
    .mockResolvedValueOnce({
      ok: true,
      data: {
        rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
      },
    });
  vi.mocked(rt.chatBuddies).mockResolvedValueOnce({
    ok: true,
    data: {
      buddies: [
        {
          handle: 'fred',
          baseHandle: 'fred',
          sessionId: 's1',
          status: 'live',
          signedInAt: 1,
          lastSeenAt: 1,
          cwd: '/x',
        },
      ],
    },
  });
  vi.mocked(rt.chatWho).mockResolvedValueOnce({
    ok: true,
    data: {
      members: [
        {
          room: 'build',
          handle: 'fred',
          joinedAt: 1,
          lastReadId: 0,
          wakeOn: 'mention',
        },
      ],
    },
  });
  vi.mocked(rt.chatJoin).mockResolvedValueOnce({
    ok: true,
    data: { handle: 'matt', memberCount: 2, unread: 0 },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({
    ok: true,
    data: { room: 'build', archivedAt: 5 },
  });
  const res = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ room: 'build', closedAt: 5 });
  expect(rt.chatJoin).toHaveBeenCalledWith(
    { room: 'build', handle: 'matt' },
    expect.anything()
  );
  expect(rt.chatArchive).toHaveBeenCalledWith(
    { room: 'build', handle: 'matt', archived: true },
    expect.anything()
  );
});

test('closing a room already in the human’s listing never joins; a DM never joins either', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValue({
    ok: true,
    data: { room: 'build', archivedAt: 5 },
  });
  await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [
        {
          room: 'dm-1',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'fred', b: 'matt' },
        },
      ],
    },
  });
  await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'dm-1' }),
  });
  expect(rt.chatJoin).not.toHaveBeenCalled();
  expect(rt.chatArchive).toHaveBeenCalledTimes(2);
});

test('close 400s on a bad body and on a room nobody lists, and never join-creates', async () => {
  const bad = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: '{not json',
  });
  expect(bad.status).toBe(400);
  const noRoom = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  expect(noRoom.status).toBe(400);
  expect((await noRoom.json()).error).toBe('room is required');
  vi.mocked(rt.chatRooms).mockResolvedValue({ ok: true, data: { rooms: [] } });
  vi.mocked(rt.chatBuddies).mockResolvedValue({
    ok: true,
    data: { buddies: [] },
  });
  const ghost = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'ghost' }),
  });
  expect(ghost.status).toBe(400);
  expect(rt.chatJoin).not.toHaveBeenCalled();
  expect(rt.chatArchive).not.toHaveBeenCalled();
});

test('close 502s when the daemon refuses, and the old archive route is gone', async () => {
  vi.mocked(rt.chatRooms).mockResolvedValueOnce({
    ok: true,
    data: {
      rooms: [{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }],
    },
  });
  vi.mocked(rt.chatArchive).mockResolvedValueOnce({ ok: false, error: 'nope' });
  const refused = await routes.request('/api/chat/close?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build' }),
  });
  expect(refused.status).toBe(502);
  const gone = await routes.request('/api/chat/archive?handle=matt', {
    method: 'POST',
    body: JSON.stringify({ room: 'build', archived: true }),
  });
  expect(gone.status).toBe(404);
});
```

Keep the earlier test `rooms asks for the human’s archived rooms too and passes archivedAt through` (line 361): the rooms route is unchanged.

- [ ] **Step 2: Run the file to see the new tests fail**

Run: `bunx vitest run src/server/chat.test.ts`
Expected: the four new tests FAIL (404 from `/api/chat/close`); everything else passes.

- [ ] **Step 3: Replace the route**

In `src/server/chat.ts`, replace the whole `.post('/api/chat/archive', ...)` handler and the comment block above it with:

```ts
  // Close is the one write that needs the human IN the room first: a closed
  // room only stays listed for members, and most channels are join-created
  // by agents. Joining first (never for a DM, which already holds him) is
  // the same move the post route makes. A name that neither his listing nor
  // the fleet union knows is refused before that join, so a typo can never
  // create-and-close a room. The daemon verb is archive; the viewer never
  // reopens, since any post revives the room.
  .post('/api/chat/close', async c => {
    let raw: { room?: unknown };
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'Malformed JSON in request body' }, 400);
    }
    const room = typeof raw?.room === 'string' ? raw.room : undefined;
    if (!room) return c.json({ error: 'room is required' }, 400);
    const handle = humanHandle(c);

    const roomsRes = await chatRooms(
      { handle, includeArchived: true },
      rtOpts()
    );
    if (!roomsRes.ok || !roomsRes.data) {
      return c.json({ error: roomsRes.error ?? 'rooms: no data' }, 502);
    }
    const mine = roomsRes.data.rooms.find(r => r.room === room);
    if (!mine) {
      const fleet = (await unjoinedFleetRooms(roomsRes.data.rooms)).find(
        r => r.room === room
      );
      if (!fleet) return c.json({ error: `unknown room "${room}"` }, 400);
      if (fleet.kind !== 'dm') {
        const joinRes = await chatJoin({ room, handle }, rtOpts());
        if (!joinRes.ok) return c.json({ error: joinRes.error }, 502);
      }
    }

    const res = await chatArchive({ room, handle, archived: true }, rtOpts());
    if (!res.ok) return c.json({ error: res.error }, 502);
    return c.json(
      { room: res.data?.room ?? room, closedAt: res.data?.archivedAt ?? null },
      200
    );
  })
```

- [ ] **Step 4: Run the file again**

Run: `bunx vitest run src/server/chat.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Update the API table**

In `ARCHITECTURE.md`, replace the row

```
| `POST /api/chat/archive` `{ room, archived }`      | joins the human first when he is not in the channel, then archives or reopens; 400 on a room nobody lists                                                             |
```

with

```
| `POST /api/chat/close` `{ room }`                  | closes a room (the daemon's archive): joins the human first when he is not in the channel; 400 on a room nobody lists. Never reopens; any post revives the room        |
```

Also in the "Every daemon call" bullet of the Request path section, leave `chatArchive` in the list (it is still called).

- [ ] **Step 6: Gates and commit**

Run: `bun run typecheck && bun run lint && bunx vitest run && bun run format`
Expected: all green (the client still posts to `/api/chat/archive` until Task 4; no client test hits the server).

```bash
git add src/server/chat.ts src/server/chat.test.ts ARCHITECTURE.md
git commit -m "server: POST /api/chat/close replaces archive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rail rows close on hover × and from a right-click menu; no ARCHIVED section

**Files:**

- Create: `src/app/visible-rooms.ts`
- Create: `src/app/visible-rooms.test.ts`
- Modify: `src/app/RoomRail.tsx`
- Modify: `src/app/RoomRail.test.tsx`

**Interfaces:**

- Consumes: `RoomSummary` from `@mattstack/rt-client`; `Menu`, `Tooltip`, `ActionIcon`, `Box`, `Text`, `UnstyledButton` from `@mattstack/app-kit/core`; `Icon` names `close`, `check`, `hash`, `plus` (all registered by the kit's `Icons.ts`; `hash` by `src/app/icons.ts`).
- Produces:
  - `visibleRooms(rooms: RoomSummary[], activeRoom: string | undefined): RoomSummary[]` in `src/app/visible-rooms.ts`.
  - `RoomRailProps` gains `onCloseRoom?: (room: string) => void` and `onMarkRead?: (room: string) => void`. `RoomRail` no longer filters by `archivedAt`; the caller passes `visibleRooms(...)`.
  - Test ids: row `room-row-<room>` (a `div[role="button"]`), hover control `room-close-<room>`, dropdown `room-context-<room>`, items `room-context-mark-read`, `room-context-close`.

- [ ] **Step 1: Write the filter and its test**

`src/app/visible-rooms.ts`:

```ts
import type { RoomSummary } from '@mattstack/rt-client';

/**
 * The rail lists open rooms only, plus the active room when it is closed:
 * a closed room reached by an `rt chat post` link is listed while it is
 * open and gone once the viewer navigates away. This is the one place the
 * client reads `archivedAt` for listing.
 */
export function visibleRooms(
  rooms: RoomSummary[],
  activeRoom: string | undefined
): RoomSummary[] {
  return rooms.filter(r => r.archivedAt === undefined || r.room === activeRoom);
}
```

`src/app/visible-rooms.test.ts`:

```ts
import { expect, test } from 'vitest';

import { visibleRooms } from './visible-rooms';

const open = { room: 'build', memberCount: 1, unread: 0, mentions: 0 };
const closed = {
  room: 'retro',
  memberCount: 1,
  unread: 0,
  mentions: 0,
  archivedAt: 5,
};

test('a closed room is hidden unless it is the active one', () => {
  expect(visibleRooms([open, closed], undefined)).toEqual([open]);
  expect(visibleRooms([open, closed], 'build')).toEqual([open]);
  expect(visibleRooms([open, closed], 'retro')).toEqual([open, closed]);
});
```

Run: `bunx vitest run src/app/visible-rooms.test.ts`
Expected: PASS.

- [ ] **Step 2: Rewrite the RoomRail tests**

In `src/app/RoomRail.test.tsx`, delete the two tests `archived rooms sit in a collapsed section...` and `no archived rooms means no archived section`, and the line `afterEach(() => window.localStorage.removeItem('chat.rail.archived'));`. Add `fireEvent` to the `@testing-library/react` import and drop `afterEach` from the vitest import. Add these tests:

```tsx
test('no ARCHIVED section renders, and a closed room passed in is listed like any other', () => {
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 1, mentions: 0 },
        {
          room: 'retro',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          archivedAt: 5,
        },
      ]}
      activeRoom="retro"
    />
  );
  expect(screen.queryByText('ARCHIVED')).toBeNull();
  expect(screen.queryByTestId('archived-toggle')).toBeNull();
  expect(screen.getByTestId('room-row-retro').dataset.active).toBe('true');
  expect(screen.getByTestId('room-row-retro').style.opacity).toBe('');
});

test('the hover × closes that row without selecting it', async () => {
  const onCloseRoom = vi.fn();
  const onSelectRoom = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 0, mentions: 0 },
        {
          room: 'dm-1',
          memberCount: 2,
          unread: 2,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'fred', b: 'gitq-main' },
        },
      ]}
      onCloseRoom={onCloseRoom}
      onSelectRoom={onSelectRoom}
    />
  );
  const close = screen.getByTestId('room-close-dm-1');
  expect(close).toHaveAttribute('aria-label', 'Close fred ↔ gitq-main');
  expect(close.style.display).toBe('none');
  await userEvent.hover(screen.getByTestId('room-row-dm-1'));
  expect(close.style.display).toBe('');
  await userEvent.click(close);
  expect(onCloseRoom).toHaveBeenCalledWith('dm-1');
  expect(onSelectRoom).not.toHaveBeenCalled();
  expect(screen.getByTestId('room-close-build')).toHaveAttribute(
    'aria-label',
    'Close #build'
  );
});

test('right-click opens a menu for that row: Mark read with its count, then Close', async () => {
  const onCloseRoom = vi.fn();
  const onMarkRead = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 3, mentions: 0 },
        { room: 'quiet', memberCount: 2, unread: 0, mentions: 0 },
      ]}
      onCloseRoom={onCloseRoom}
      onMarkRead={onMarkRead}
    />
  );
  fireEvent.contextMenu(screen.getByTestId('room-row-build'));
  const menu = await screen.findByTestId('room-context-build');
  expect(menu).toHaveTextContent('#build');
  expect(within(menu).getByTestId('room-context-mark-read')).toHaveTextContent(
    '3'
  );
  await userEvent.click(within(menu).getByTestId('room-context-mark-read'));
  expect(onMarkRead).toHaveBeenCalledWith('build');

  fireEvent.contextMenu(screen.getByTestId('room-row-quiet'));
  const quiet = await screen.findByTestId('room-context-quiet');
  expect(within(quiet).queryByTestId('room-context-mark-read')).toBeNull();
  await userEvent.click(within(quiet).getByTestId('room-context-close'));
  expect(onCloseRoom).toHaveBeenCalledWith('quiet');
});

test('without onCloseRoom there is no × and right-click does nothing', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }]}
    />
  );
  expect(screen.queryByTestId('room-close-build')).toBeNull();
  fireEvent.contextMenu(screen.getByTestId('room-row-build'));
  expect(screen.queryByTestId('room-context-build')).toBeNull();
});
```

- [ ] **Step 3: Run the file to see the new tests fail**

Run: `bunx vitest run src/app/RoomRail.test.tsx`
Expected: the four new tests FAIL; the earlier ones still pass.

- [ ] **Step 4: Rewrite `RoomRow` and the rail body**

In `src/app/RoomRail.tsx`, change the imports to:

```tsx
import { useState } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useHover } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';
import type { RoomSummary } from '@mattstack/rt-client';

import { AgentName } from './AgentName';
```

(`useLocalStorage` and `AnimatedChevron` go.) In `RoomRailProps`, add after `onNewRoom`:

```tsx
  /** Closes a room (the daemon's archive): the row's hover × and its
      right-click menu. Neither renders when this is absent. */
  onCloseRoom?: (room: string) => void;
  /** The right-click menu's Mark read, offered only on a row with unread. */
  onMarkRead?: (room: string) => void;
```

Replace the whole `RoomRow` function with:

```tsx
function roomLabel(room: RoomSummary): string {
  return room.kind === 'dm' && room.participants
    ? `${room.participants.a} ↔ ${room.participants.b}`
    : `#${room.room}`;
}

/**
 * A rail row is a `div[role=button]`, not a `<button>`: the close control
 * inside it is a real button, and a button may not nest a button. Enter and
 * Space select, like the button they replace. The × shows on hover, on
 * focus within, and while the row's menu is open; the menu is a controlled
 * Mantine `Menu` (there is no right-click trigger) opened from
 * `onContextMenu`, positioned off the row, one instance per row.
 */
function RoomRow({
  room,
  active,
  onSelect,
  onClose,
  onMarkRead,
}: {
  room: RoomSummary;
  active: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
  onMarkRead?: (room: string) => void;
}) {
  const isDm = room.kind === 'dm';
  const label = roomLabel(room);
  const { ref, hovered } = useHover<HTMLDivElement>();
  const [menuOpened, setMenuOpened] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const closable = onClose !== undefined;
  const showClose = closable && (hovered || focusWithin || menuOpened);

  const row = (
    <Box
      ref={ref}
      role="button"
      tabIndex={0}
      data-testid={`room-row-${room.room}`}
      data-active={active ? 'true' : undefined}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      onFocus={() => setFocusWithin(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setFocusWithin(false);
      }}
      onContextMenu={e => {
        if (!closable) return;
        e.preventDefault();
        setMenuOpened(true);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        width: '100%',
        height: 34,
        gap: 'var(--mantine-spacing-sm)',
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'pointer',
        background: active
          ? ACCENT_WASH
          : hovered || menuOpened
            ? 'var(--ui-bg-4)'
            : undefined,
        color: active ? ACCENT_TEXT : undefined,
      }}
    >
      {!isDm && (
        <Icon
          name="hash"
          size={14}
          color={active ? ACCENT_TEXT : 'var(--tk-muted-text)'}
          style={{ flex: 'none' }}
        />
      )}
      {isDm && room.participants ? (
        <DmPairName room={room} active={active} />
      ) : (
        <Text
          fw={active ? 600 : undefined}
          truncate
          style={{ flex: 1, minWidth: 0 }}
        >
          {room.room}
        </Text>
      )}
      {room.mentions > 0 && <MentionBadge count={room.mentions} />}
      {room.unread > 0 && <UnreadBadge count={room.unread} />}
      {closable && (
        <Tooltip label="Close" position="top" withinPortal>
          <ActionIcon
            variant="subtle"
            size="sm"
            radius="md"
            color="gray"
            aria-label={`Close ${label}`}
            data-testid={`room-close-${room.room}`}
            onClick={e => {
              e.stopPropagation();
              onClose(room.room);
            }}
            style={{
              display: showClose ? undefined : 'none',
              flex: 'none',
              marginRight: -4,
              color: 'var(--tk-muted-text)',
            }}
          >
            <Icon name="close" size={14} />
          </ActionIcon>
        </Tooltip>
      )}
    </Box>
  );

  if (!closable) return row;

  return (
    <Menu
      opened={menuOpened}
      onChange={setMenuOpened}
      position="bottom-start"
      radius="md"
      shadow="md"
      withinPortal
    >
      <Menu.Target>{row}</Menu.Target>
      <Menu.Dropdown data-testid={`room-context-${room.room}`}>
        <Menu.Label>{label}</Menu.Label>
        {room.unread > 0 && onMarkRead && (
          <Menu.Item
            data-testid="room-context-mark-read"
            leftSection={<Icon name="check" size={14} />}
            rightSection={<UnreadBadge count={room.unread} />}
            onClick={() => onMarkRead(room.room)}
          >
            Mark read
          </Menu.Item>
        )}
        <Menu.Item
          data-testid="room-context-close"
          leftSection={<Icon name="close" size={14} />}
          onClick={() => onClose(room.room)}
        >
          Close
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
```

`RoomRow` no longer takes `archived`; delete the `RailRoom` type if it exists only for that. `Menu.Target` merges its own ref into the row's `ref`; if `useHover` stops reporting after the wrap (hover never shows the ×), move the `ref` to an inner `Box` that carries the row's content and keep `Menu.Target` on the outer one. In `RoomRail` itself: delete the `openRooms`, `archivedRooms` lines and the `useLocalStorage` call, use `rooms` directly:

```tsx
const channelRooms = rooms.filter(r => r.kind !== 'dm');
const directRooms = rooms.filter(r => r.kind === 'dm');
```

Delete the whole `{archivedRooms.length > 0 && (...)}` JSX block. Pass the new props to both `RoomRow` call sites:

```tsx
<RoomRow
  key={room.room}
  room={room}
  active={room.room === activeRoom}
  onSelect={() => onSelectRoom?.(room.room)}
  onClose={onCloseRoom}
  onMarkRead={onMarkRead}
/>
```

Destructure `onCloseRoom, onMarkRead` in `RoomRail`'s signature and end its docblock at "...and a footnote."

- [ ] **Step 5: Run the rail tests**

Run: `bunx vitest run src/app/RoomRail.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 6: Keep App compiling, gates, commit**

`App.tsx` passes `archived` rows only inside its own phone drawer (not to `RoomRail`), so typecheck should stay green; if it errors on a `RoomRail` prop, remove only that prop there.

Run: `bun run typecheck && bun run lint && bunx vitest run && bun run format`
Expected: green.

Stage `src/app/visible-rooms.ts src/app/visible-rooms.test.ts src/app/RoomRail.tsx src/app/RoomRail.test.tsx` and commit with the message `rail: hover × and right-click Close on every row, ARCHIVED section gone` plus the trailer.

---

### Task 3: The page-bar ⋯ menu offers Close, nothing else

**Files:**

- Modify: `src/app/PageBar.tsx`
- Modify: `src/app/PageBar.test.tsx`
- Modify: `src/app/App.tsx` (two prop names only, to keep the build green)

**Interfaces:**

- Produces: `RoomMenu({ room, onClose?, size? })` with `onClose?: (room: string) => void`; `PageBarProps.onClose?: (room: string) => void` replaces `onArchive` and `memberHandles`. Test ids: trigger `room-menu`, dropdown `room-menu-dropdown`, item `room-menu-close`. Copy: `Close #<room>` for a channel, `Close this conversation` for a DM.

- [ ] **Step 1: Rewrite the PageBar tests**

In `src/app/PageBar.test.tsx`, delete the six archive/fleet tests and `memberList reads like a sentence...` (lines 108-225) and the `fleetDm` constant. Change the import to `import { PageBar, RoomMenu } from './PageBar';`. Add:

```tsx
test('the ⋯ menu offers Close for a channel, with no confirm', async () => {
  const onClose = vi.fn();
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[{ handle: 'fred', status: 'live' }]}
      onClose={onClose}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  const item = await screen.findByTestId('room-menu-close');
  expect(item).toHaveTextContent('Close #build');
  await userEvent.click(item);
  expect(onClose).toHaveBeenCalledWith('build');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the ⋯ menu offers Close this conversation for a DM, fleet or not', async () => {
  const onClose = vi.fn();
  const dm = {
    room: 'dm-aaaa1111bbbb',
    memberCount: 2,
    unread: 0,
    mentions: 0,
    kind: 'dm' as const,
    participants: { a: 'fred', b: 'gitq-main' },
  };
  renderWithProviders(
    <RoomMenu room={{ ...dm, joined: false }} onClose={onClose} />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  const item = await screen.findByTestId('room-menu-close');
  expect(item).toHaveTextContent('Close this conversation');
  await userEvent.click(item);
  expect(onClose).toHaveBeenCalledWith('dm-aaaa1111bbbb');
});

test('a closed room still shows mark read and the wakes chip; nothing says archived', () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'retro',
        memberCount: 2,
        unread: 4,
        mentions: 1,
        archivedAt: Date.now() - 3 * 86_400_000,
      }}
      buddies={[{ handle: 'fred', status: 'live' }]}
    />
  );
  expect(screen.queryByTestId('chip-archived')).toBeNull();
  expect(screen.getByTestId('chip-wakes')).toBeInTheDocument();
  expect(screen.getByTestId('mark-read-button')).toBeInTheDocument();
  expect(screen.queryByText(/archiv/i)).toBeNull();
});
```

- [ ] **Step 2: Run the file to see them fail**

Run: `bunx vitest run src/app/PageBar.test.tsx`
Expected: the three new tests FAIL.

- [ ] **Step 3: Rewrite `RoomMenu` and trim `PageBar`**

In `src/app/PageBar.tsx`:

1. Delete the `import { modals } from '@mattstack/app-kit/modals';` line and the `memberList`, `archiveLabel`, `archiveTitle` functions.
2. In `PageBarProps`, delete `memberHandles` and `onArchive` (with docblocks); add:

```tsx
  /** Closes the room from the ⋯ menu. */
  onClose?: (room: string) => void;
```

3. Replace the whole `RoomMenu` function with:

```tsx
function closeLabel(room: RoomSummary): string {
  return room.kind === 'dm' ? 'Close this conversation' : `Close #${room.room}`;
}

/** The ⋯ control and its one item. One component for the desk's page bar
    and the phone header; at the phone's 44px the item grows to match. */
export function RoomMenu({
  room,
  onClose,
  size = 30,
}: {
  /** `joined` is the viewer-side flag the rooms route stamps onto a fleet
      (agent-to-agent) DM the human is not a member of; closing one joins
      him first server-side, so it is offered like any other room. */
  room: RoomSummary & { joined?: boolean };
  onClose?: (room: string) => void;
  size?: number;
}) {
  return (
    <Menu
      position="bottom-end"
      withinPortal
      radius="md"
      shadow="md"
      styles={size >= 44 ? { item: { minHeight: 44 } } : undefined}
    >
      <Menu.Target>
        <ActionIcon
          variant="default"
          size={size}
          radius="md"
          aria-label="Room actions"
          data-testid="room-menu"
          styles={{ root: CONTROL_SURFACE }}
        >
          <Icon name="moreHorizontal" size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="room-menu-dropdown">
        <Menu.Item
          data-testid="room-menu-close"
          leftSection={<Icon name="close" size={14} />}
          onClick={() => onClose?.(room.room)}
        >
          {closeLabel(room)}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
```

4. In `PageBar`'s signature drop `memberHandles` and `onArchive`, add `onClose`. In `controls`, the mark-read condition becomes `{room.unread > 0 && (`; the `<RoomMenu ... />` call becomes `<RoomMenu room={room} onClose={onClose} />`.
5. Replace the `room.archivedAt !== undefined ? (...) : (...)` chip ternary with the wakes chip alone:

```tsx
<Box component="span" style={CHIP_BASE} data-testid="chip-wakes">
  wakes: {wakeMode}
</Box>
```

- [ ] **Step 4: Run the file**

Run: `bunx vitest run src/app/PageBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Keep App compiling until Task 4**

In `src/app/App.tsx` only: on `<PageBar>` and on the `<RoomMenu>` inside `PhoneHeader`, replace `onArchive={onArchive}` with `onClose={room => onArchive(room, true)}` and delete the `memberHandles={...}` prop on both. (`PhoneHeader` keeps its `onArchive` prop for now; Task 4 renames it.)

Run: `bun run typecheck && bun run lint && bunx vitest run && bun run format`
Expected: green.

- [ ] **Step 6: Commit**

Stage `src/app/PageBar.tsx src/app/PageBar.test.tsx src/app/App.tsx`; message `page bar: the ⋯ menu offers Close only, no confirm, no archived chip` plus the trailer.

---

### Task 4: App wires Close: optimistic row removal, landing on `/`, composer always live, archive code deleted

**Files:**

- Create: `src/app/mark-read.ts`
- Delete: `src/app/ArchivedBar.tsx`, `src/app/ArchivedBar.test.tsx`
- Modify: `src/app/App.tsx` (`useRooms`, `ChatPage`, `PhoneHeader`, `PhoneRoomRow`, `PhoneDrawer`, `PhoneChat`, `App`)
- Modify: `src/app/PageBar.tsx` (`handleMarkRead` uses the helper)
- Modify: `src/app/App.test.tsx`

**Interfaces:**

- Consumes: `visibleRooms` (Task 2), `RoomRail`'s `onCloseRoom`/`onMarkRead` (Task 2), `PageBar`/`RoomMenu`'s `onClose` (Task 3), `POST /api/chat/close` (Task 1).
- Produces: `postMarkRead(room: string): Promise<Response>` in `src/app/mark-read.ts`; `useRooms` returns `{ rooms, setRooms, refetchRooms }`; `closeRoom(room: string): Promise<void>` and `markRead(room: string): Promise<void>` in `App`; `ChatPageProps.onCloseRoom`, `ChatPageProps.onMarkRead`; `PhoneChat`/`PhoneHeader` prop `onCloseRoom: (room: string) => void`.

- [ ] **Step 1: Rewrite the App archive tests**

In `src/app/App.test.tsx`, delete the tests `an archived room renders the archived bar...`, `the home route lands on the first OPEN room when an archived room sorts first`, and `archiving the active room navigates away...` (lines 534-640). Add these in their place:

```tsx
function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: 'nope' }),
  } as Response;
}

test('the home route lands on the first OPEN room, and a closed room never shows a read-only bar', () => {
  window.history.replaceState(null, '', '/');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          {
            room: 'closed-first',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now() - 3 * 86_400_000,
          },
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
  expect(screen.queryByTestId('archived-bar')).toBeNull();
  expect(screen.queryByTestId('room-row-closed-first')).toBeNull();
  expect(screen.getByTestId('composer')).toBeInTheDocument();
});

test('a closed room reached by link opens with a live composer and is listed only while open', async () => {
  installFetchMock();
  window.history.replaceState(null, '', '/r/retro');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          {
            room: 'retro',
            memberCount: 1,
            unread: 0,
            mentions: 0,
            archivedAt: Date.now() - 3 * 86_400_000,
          },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  expect(screen.getByTestId('composer')).toBeInTheDocument();
  expect(screen.queryByTestId('archived-bar')).toBeNull();
  expect(screen.getByTestId('room-row-retro').dataset.active).toBe('true');
  expect(screen.queryByText(/archiv/i)).toBeNull();
  await userEvent.click(screen.getByTestId('room-row-build'));
  await waitFor(() => expect(window.location.pathname).toBe('/r/build'));
  expect(screen.queryByTestId('room-row-retro')).toBeNull();
});

test('closing the open room from the ⋯ menu lands on / and the first open room', async () => {
  installFetchMock();
  const build = { room: 'build', memberCount: 1, unread: 0, mentions: 0 };
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return Promise.resolve(jsonResponse({ room: 'ghost', closedAt: 5 }));
    if (url === '/api/chat/rooms')
      return Promise.resolve(jsonResponse({ rooms: [build] }));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/ghost');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
          build,
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  await userEvent.click(await screen.findByTestId('room-menu-close'));
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/close',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ room: 'ghost' }),
    })
  );
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
  expect(screen.getByTestId('composer')).toBeInTheDocument();
});

test('closing another room from its rail × drops the row at once and keeps the page', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close')
      return Promise.resolve(jsonResponse({ room: 'ghost', closedAt: 5 }));
    if (url === '/api/chat/rooms')
      return Promise.resolve(
        jsonResponse({
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
        })
      );
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 2, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await userEvent.hover(screen.getByTestId('room-row-ghost'));
  await userEvent.click(screen.getByTestId('room-close-ghost'));
  expect(screen.queryByTestId('room-row-ghost')).toBeNull();
  expect(window.location.pathname).toBe('/r/build');
  expect(
    within(screen.getByTestId('page-bar')).getByText('build')
  ).toBeInTheDocument();
});

test('a failed close restores the row and says so', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/close') return Promise.resolve(errorResponse(502));
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [
          { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
          { room: 'ghost', memberCount: 1, unread: 0, mentions: 0 },
        ],
        members: [],
        messages: [],
      }}
    />
  );
  await userEvent.hover(screen.getByTestId('room-row-ghost'));
  await userEvent.click(screen.getByTestId('room-close-ghost'));
  expect(
    await screen.findByText("Couldn't close the room")
  ).toBeInTheDocument();
  expect(screen.getByTestId('room-row-ghost')).toBeInTheDocument();
});

test('the rail menu’s Mark read posts the mark and refetches rooms', async () => {
  installFetchMock();
  let marked = false;
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/chat/mark') {
      marked = true;
      return Promise.resolve(jsonResponse({}));
    }
    if (url === '/api/chat/rooms')
      return Promise.resolve(
        jsonResponse({
          rooms: [
            {
              room: 'build',
              memberCount: 1,
              unread: marked ? 0 : 3,
              mentions: 0,
            },
          ],
        })
      );
    return Promise.resolve(jsonResponse({}));
  });
  window.history.replaceState(null, '', '/r/build');
  renderWithProviders(
    <App
      initialState={{
        daemonReachable: true,
        buddies: [],
        rooms: [{ room: 'build', memberCount: 1, unread: 3, mentions: 0 }],
        members: [],
        messages: [],
      }}
    />
  );
  fireEvent.contextMenu(screen.getByTestId('room-row-build'));
  await userEvent.click(await screen.findByTestId('room-context-mark-read'));
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/mark',
    expect.objectContaining({ body: JSON.stringify({ room: 'build' }) })
  );
  await waitFor(() =>
    expect(
      within(screen.getByTestId('room-row-build')).queryByTestId('unread-badge')
    ).toBeNull()
  );
});
```

`jsonResponse` already exists in this file (line 339); `fireEvent`, `waitFor`, `within` are already imported.

- [ ] **Step 2: Run the file to see the new tests fail**

Run: `bunx vitest run src/app/App.test.tsx`
Expected: the new tests FAIL (no `room-close-*`, `/api/chat/archive` still posted); older tests pass.

- [ ] **Step 3: The mark-read helper**

`src/app/mark-read.ts`:

```ts
/** Advances the human's read cursor for a room. Callers refetch rooms only
    after this resolves: the count clears server-side first, and a refetch
    fired earlier would read the stale unread. */
export function postMarkRead(room: string): Promise<Response> {
  return fetch('/api/chat/mark', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room }),
  });
}
```

In `src/app/PageBar.tsx`, import it (`import { postMarkRead } from './mark-read';`) and make `handleMarkRead`:

```tsx
const handleMarkRead = () => {
  void postMarkRead(room.room)
    .then(() => onMarkRead?.(room.room))
    .catch(() => {});
};
```

(Delete the inline `fetch('/api/chat/mark', ...)` and its comment; the helper's docblock carries the ordering constraint.)

- [ ] **Step 4: Delete the archive surface in `App.tsx`**

1. Imports: delete `import { ArchivedBar } from './ArchivedBar';`; delete `useLocalStorage` from the hooks import and `AnimatedChevron` from the icons import; add `import { postMarkRead } from './mark-read';` and `import { visibleRooms } from './visible-rooms';`.
2. `useRooms`: return `{ rooms, setRooms, refetchRooms }`.
3. `PhoneHeader`: rename the prop `onArchive: (room: string, archived: boolean) => void` to `onCloseRoom: (room: string) => void` and render `<RoomMenu room={room} onClose={onCloseRoom} size={PHONE_TAP} />`.
4. `PhoneRoomRow`: delete the `archived` prop, `data-archived`, the `opacity` style line, and the `!archived &&` guards on both badges.
5. `PhoneDrawer`: replace the four room-list lines and the `useLocalStorage` call with

```tsx
const shown = visibleRooms(rooms, activeRoom);
const channelRooms = shown.filter(r => r.kind !== 'dm');
const directRooms = shown.filter(r => r.kind === 'dm');
```

and delete the whole `{archivedRooms.length > 0 && (...)}` block. 6. `PhoneChat`: rename the prop `onArchive` to `onCloseRoom: (room: string) => void`, pass `onCloseRoom={onCloseRoom}` to `PhoneHeader`, and replace the footer ternary with the `Composer` alone:

```tsx
{
  activeRoom && (
    <Composer
      ref={composerRef}
      phone
      room={activeRoom}
      roomMembers={roomMembers}
      buddies={buddies}
      isDm={activeRoomSummary?.kind === 'dm'}
      daemonReachable={daemon.reachable}
      onOpenDm={onOpenDm}
    />
  );
}
```

7. `ChatPageProps`: replace `onArchive: (room: string, archived: boolean) => void;` with

```tsx
  onCloseRoom: (room: string) => void;
  onMarkRead: (room: string) => void;
```

and add `openRooms: RoomSummary[];` and `railRooms: RoomSummary[];` after `orderedRooms`. In `ChatPage`: destructure them; the sidebar condition becomes `{railRooms.length > 0 && (`; `<RoomRail rooms={railRooms} ... onCloseRoom={onCloseRoom} onMarkRead={onMarkRead} />`; the page-bar condition becomes `{activeRoomSummary && (`; `<PageBar ... onClose={onCloseRoom} />` (no `memberHandles`, no `onArchive`); the placeholder condition becomes `openRooms.length === 0 && !activeRoomSummary ? (`; the transcript `footer` becomes the `Composer` alone (delete the `ArchivedBar` branch); the Roster condition becomes `(railRooms.length > 0 || buddies.length > 0) && (`. 8. In `App`: change the `useRooms` destructure to `const { rooms, setRooms, refetchRooms } = useRooms(initialState?.rooms);`. Replace the home-landing branch of the URL effect with:

```tsx
    } else if (route.name === 'home') {
      // `/` means the first OPEN room; a closed room is only ever active by
      // its own link. No open room leaves nothing active, which is the
      // No rooms placeholder.
      const first = rooms.find(r => r.archivedAt === undefined)?.room;
      if (activeRoom !== first) setActiveRoom(first);
    }
```

Replace the whole `setArchived` callback with:

```tsx
// Optimistic: the row leaves the rail before the request resolves, and a
// failure puts the snapshot back. Closing the open room lands on `/`, the
// same first-open-room landing a fresh open uses.
const closeRoom = useCallback(
  async (room: string) => {
    const snapshot = rooms;
    setRooms(prev => prev.filter(r => r.room !== room));
    if (room === activeRoom) {
      setActiveRoom(undefined);
      if (window.location.pathname !== '/') navigate('/');
    }
    try {
      const res = await fetch('/api/chat/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room }),
      });
      if (!res.ok) throw new Error('close failed');
    } catch {
      notifications.error("Couldn't close the room");
      setRooms(snapshot);
      return;
    }
    void refetchRooms();
  },
  [rooms, activeRoom, setRooms, refetchRooms]
);

const markRead = useCallback(
  async (room: string) => {
    try {
      await postMarkRead(room);
    } catch {
      return;
    }
    void refetchRooms();
  },
  [refetchRooms]
);
```

After `orderedRooms`, add:

```tsx
const openRooms = rooms.filter(r => r.archivedAt === undefined);
const railRooms = visibleRooms(orderedRooms, activeRoom);
```

Pass `onCloseRoom={closeRoom}` to `PhoneChat` (replacing `onArchive`), and `openRooms={openRooms} railRooms={railRooms} onCloseRoom={closeRoom} onMarkRead={markRead}` to `ChatPage` (replacing `onArchive`). The `chatRoute && isMobile && rooms.length > 0` guard for the phone shell becomes `chatRoute && isMobile && (openRooms.length > 0 || activeRoomSummary !== undefined)`; move the `activeRoomSummary` line above it if needed.

9. Delete `src/app/ArchivedBar.tsx` and `src/app/ArchivedBar.test.tsx` (`git rm`).

- [ ] **Step 5: Run the App tests, then everything**

Run: `bunx vitest run src/app/App.test.tsx`
Expected: PASS. Then `bun run typecheck && bun run lint && bunx vitest run && bun run format`.
Expected: green; `grep -rn -i "archiv\|reopen" src/app --include='*.tsx' --include='*.ts'` shows only `archivedAt` reads in `visible-rooms.ts` and `App.tsx`'s landing.

- [ ] **Step 6: Commit**

Stage `src/app/mark-read.ts src/app/App.tsx src/app/App.test.tsx src/app/PageBar.tsx` plus the two deletions; message `app: close replaces archive, composer always live, closing the open room lands on /` plus the trailer.

---

### Task 5: Artboards, audit and docs follow Close

**Files:**

- Modify: `design/build.py` (shared CSS, `rooms_rail`, delete `desktop_archived` + `RETRO_MSGS`, add `close_sheet`)
- Delete: `design/artboards/Archived.dc.html`
- Create: `design/artboards/Close.dc.html` (generated)
- Modify: `design/canvas.json`, `design/spec.json` (regenerated), `design/audit.mjs`, `design/ANATOMY.md`, `design/CONFORMANCE.md`, `design/README.md`, `AGENTS.md`, `ARCHITECTURE.md`

**Interfaces:**

- Consumes: test ids from Tasks 2 and 3 (`room-close-<room>`, `room-context-<room>`, `room-menu-close`).
- Produces: spec selectors `.room .close`, `.tip`, `.menu-dd`, `.menu-lbl`, `.menu-item`, `.menu-item.tap`, `.menu-div` in `spec.json`; `TARGETS` entries for the × and the menu item.

- [ ] **Step 1: The shared CSS**

In `design/build.py`'s `CSS` block, delete these three lines:

```
    .room.archived { opacity: 0.6; }
    .sect.toggle { cursor: pointer; }
    .archived-bar { display: flex; align-items: center; justify-content: space-between; height: 44px; padding: 0 9.6px; margin-top: 4.8px; border-top: 1px solid var(--border-soft); }
```

and add, right after the `.unread { ... }` line:

```
    .room .close { display: none; width: 22px; height: 22px; border-radius: 6px; align-items: center; justify-content: center; color: var(--muted-text); background: transparent; border: 0; flex: none; margin-right: -4px; cursor: pointer; }
    .room.hover { background: var(--bg4); }
    .room.hover .close { display: inline-flex; }
    .tip { display: inline-flex; align-items: center; padding: 2.4px 4.8px; border-radius: 6px; font-size: 11.2px; line-height: 1.55; background: var(--fg); color: var(--bg1); white-space: nowrap; }
    .menu-dd { display: flex; flex-direction: column; background: var(--bg2); border: 1px solid var(--border); border-radius: 6px; padding: 4px; box-shadow: 0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18); }
    .menu-lbl { color: var(--muted-text); font-weight: 500; font-size: 10.56px; padding: 2.4px 7.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .menu-item { display: flex; align-items: center; min-height: 24px; font-size: 11.2px; padding: 3.2px 7.2px; border-radius: 6px; color: var(--fg); white-space: nowrap; }
    .menu-item.hover { background: var(--bg4); }
    .menu-item .ls { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; margin-inline-end: 4.8px; color: var(--muted-text); }
    .menu-item .rs { display: inline-flex; margin-inline-start: 4.8px; margin-left: auto; }
    .menu-item.tap { min-height: 44px; font-size: 12.16px; padding: 3.2px 9.6px; }
    .menu-div { margin: 4px 0; border-top: 1px solid var(--border-soft); }
```

These are Mantine 9.5.2's own numbers at the tokyo scale: ActionIcon `sm` is 22px; `Menu.Dropdown` pads 4px; `Menu.Label` is xs at 500 with `calc(xs/2) sm` padding (2.4px 7.2px); `Menu.Item` is sm with `calc(xs/1.5) sm` padding (3.2px 7.2px), so 24px tall; the item section is 14px with a 4.8px gap; `Tooltip` is sm at `calc(xs/2) xs` padding.

- [ ] **Step 2: The rail generator and the Close sheet**

Replace `rooms_rail` with:

```python
DMS = [
 ('deck-main', 'rt-chat-wt', '<span class="mention" aria-label="1 mention">@1</span>'),
 ('rt-chat-wt', 'matt', '<span class="unread" aria-label="1 unread">1</span>'),
 ('board-fix-auth', 'gitq-main', ''),
 ('deck-main', 'mr-board-onboard', '<span class="unread" aria-label="2 unread">2</span>'),
]

def pair(a, b):
    sa = ' style="font-weight: 600;"' if a == 'matt' else ''
    sb = ' style="font-weight: 600;"' if b == 'matt' else ''
    return f'<span class="pair" style="flex: 1;"><span class="truncate sm"{sa}>{a}</span><span class="arrows">↔</span><span class="truncate sm"{sb}>{b}</span></span>'

def rooms_rail(stale=False, hover=None, menu=None):
    """The rooms rail. `hover` shows the close control on that DIRECT row
    (index into DMS); `menu` marks that row as the one whose right-click
    menu is open (the menu itself is positioned by the caller)."""
    st = ' <span class="badge-outline">last known</span>' if stale else ''
    rows = []
    for i, (a, b, badge) in enumerate(DMS):
        cls = 'room' + (' hover' if i in (hover, menu) else '')
        x = f'<button class="close" aria-label="Close {a} ↔ {b}">{ic("x", 14)}</button>' if i == hover else ''
        rows.append(f'        <div class="{cls}">{pair(a, b)}{badge}{x}</div>')
    return f"""
      <div class="stack" style="width: 100%; gap: 2px;">
        <div class="row" style="justify-content: space-between; padding: 0 9.6px 6px;">
          <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em;">ROOMS</span>
          <span class="xs muted">3{st}</span>
        </div>
        <div class="room on"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="font-weight: 600; flex: 1;">build</span><span class="mention" aria-label="1 mention">@1</span><span class="unread" aria-label="4 unread">4</span></div>
        <div class="room"><span class="hash">{ic('hash', 14)}</span><span class="truncate" style="flex: 1;">demo-42</span><span class="unread" aria-label="2 unread">2</span></div>
        <div class="room"><span class="hash">{ic('hash', 14)}</span><span class="truncate muted" style="flex: 1;">release</span></div>
        <div class="sect" style="padding: 10px 9.6px 4px;"><span class="lbl">DIRECT</span></div>
{chr(10).join(rows)}
        <span class="xs muted" style="padding: 4px 9.6px 0;">Every agent↔agent DM is yours to read and post into.</span>
      </div>
"""
```

Every existing `rooms_rail(...)` call keeps working (`rooms_rail(down)` passes `stale`). Delete `RETRO_MSGS`, the whole `desktop_archived()` function and its `pathlib.Path('Archived.dc.html').write_text(...)` line. Then add, after the `Main`/`DaemonDown` writes:

```python
# ---- Close: the three affordances plus the phone header, at kit sizes ----
def context_menu(label, unread, tap=False):
    t = ' tap' if tap else ''
    read = (f'<div class="menu-item{t}"><span class="ls">{ic("check", 14)}</span><span>Mark read</span><span class="rs"><span class="unread">{unread}</span></span></div>' if unread else '')
    return (f'<div class="menu-dd" style="width: 200px;"><div class="menu-lbl">{label}</div>{read}'
            f'<div class="menu-item{t} hover"><span class="ls">{ic("x", 14)}</span><span>Close</span></div></div>')

def close_panel(title, note, inner, width):
    return f"""
    <div class="stack" style="width: {width}px; flex: none; gap: 8px;">
      <span class="xs muted" style="font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;">{title}</span>
      <div class="card" style="overflow: hidden; height: 400px; position: relative;">{inner}</div>
      <span class="xs muted" style="line-height: 1.5;">{note}</span>
    </div>"""

def rail_excerpt(hover=None, menu=None, extra=''):
    return f'<div class="stack" style="width: 244px; padding: 11.2px 6px; background: var(--bg2); height: 100%; position: relative;">{rooms_rail(hover=hover, menu=menu)}{extra}</div>'

def close_sheet():
    hover_inner = rail_excerpt(hover=3, extra='<div class="tip" style="position: absolute; left: 198px; top: 225px;">Close</div>')
    ctx_inner = rail_excerpt(menu=3, extra='<div style="position: absolute; left: 6px; top: 296px;">' + context_menu('deck-main ↔ mr-board-onboard', 2) + '</div>')
    bar_inner = f"""<div class="stack" style="height: 100%; background: var(--bg3);">
  <div class="row" style="height: 64px; flex: none; padding: 0 11.2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 9.6px;">
    <span class="pair"><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">deck-main</span><span class="arrows" style="font-size: 16px;">↔</span><span style="font-size: 20px; font-weight: 700; line-height: 1.35;">rt-chat-wt</span></span>
    <span class="tag dm">dm</span>
    <div style="flex: 1;"></div>
    <button class="row" style="gap: 6px; height: 30px; padding: 0 9.6px; background: var(--bg1); border: 1px solid var(--border); border-radius: 6px; font-family: inherit; font-size: 12.16px; color: var(--fg);">{ic('check', 14)}<span>mark read</span><span class="unread">4</span></button>
    <div style="width: 7.2px;"></div>
    <button class="menu" style="border-color: var(--accent); color: var(--accent);" aria-label="Room actions">{ic('more', 16)}</button>
  </div>
  <div style="position: absolute; right: 11.2px; top: 70px;"><div class="menu-dd" style="width: 220px;"><div class="menu-item hover"><span class="ls">{ic('x', 14)}</span><span>Close this conversation</span></div></div></div>
</div>"""
    phone_inner = f"""<div class="stack" style="height: 100%; background: var(--bg1);">
  <div class="row" style="height: 56px; flex: none; padding: 0 6px 0 2px; background: var(--bg2); border-bottom: 1px solid var(--border); gap: 4px;">
    <button class="aicon tap" aria-label="Rooms and members">{ic('panel', 20)}</button>
    <span class="pair" style="min-width: 0;"><span class="truncate" style="font-weight: 700; font-size: 15px;">deck-main</span><span class="arrows">↔</span><span class="truncate" style="font-weight: 700; font-size: 15px;">rt-chat-wt</span></span>
    <div style="flex: 1;"></div>
    <button class="aicon tap" style="background: var(--bg4);" aria-label="Room actions">{ic('more', 20)}</button>
  </div>
  <div style="position: absolute; right: 6px; top: 60px;">{context_menu('deck-main ↔ rt-chat-wt', 4, tap=True)}</div>
</div>"""
    return head() + f"""
<div class="app {{{{schemeClass}}}}" style="width: 1440px; min-height: 620px; padding: 14.4px;">
  <div class="stack" style="gap: 14.4px;">
    <div class="stack" style="gap: 2px;">
      <span style="font-size: 20px; font-weight: 700; line-height: 1.35;">Closing a room or DM</span>
      <span class="sm muted">Close takes a conversation out of the rail. Nobody loses their place, and the next post from anyone brings it back. Closing the open one lands on the first room.</span>
    </div>
    <div style="display: flex; gap: 24px; align-items: flex-start;">
{close_panel('1 · Hover, desktop', 'ActionIcon size sm (22px), variant subtle, at the row’s right edge after the badges; a Tooltip reads Close. Also shown on keyboard focus. One click, no confirm.', hover_inner, 244)}
{close_panel('2 · Right-click, desktop', 'Menu.ContextMenu (radius md, shadow md), the dropdown at the cursor: Menu.Label with the pair, Mark read with its count, Close. Items are the theme’s 24px.', ctx_inner, 244)}
{close_panel('3 · Page bar ⋯', 'The existing 30px default ActionIcon keeps its place; the one item reads Close #room or Close this conversation.', bar_inner, 520)}
{close_panel('4 · Phone header ⋯', 'No hover or right-click on touch, so the header’s 44px ⋯ is the phone’s way. Items get minHeight 44 through styles.', phone_inner, 300)}
    </div>
  </div>
</div>
""" + tail(1440, 620)
pathlib.Path('Close.dc.html').write_text(close_sheet())
```

- [ ] **Step 3: Regenerate**

From `design/artboards`: `python3 ../build.py`. Then from the repo root: `python3 design/extract-spec.py`. Delete `design/artboards/Archived.dc.html` (`git rm`). In `design/canvas.json`, replace the `Archived.dc.html` entry with:

```json
    {
      "file": "Close.dc.html",
      "x": 0,
      "y": 3060,
      "w": 1440,
      "h": 620,
      "title": "Closing a room or DM"
    },
```

Expected: `spec.json` now lists `.room .close`, `.tip`, `.menu-dd`, `.menu-lbl`, `.menu-item`, `.menu-item.tap`, `.menu-div` and no `.room.archived`, `.sect.toggle`, `.archived-bar`. Open `design/artboards/Close.dc.html` and `Main.dc.html` in a browser (serve `design/artboards` with `python3 -m http.server 11090` and screenshot with Fast Browser) and check: the × sits after the badges on the hovered row, the tooltip sits above it, the menu hangs below its row, nothing is clipped.

- [ ] **Step 4: The audit targets**

In `design/audit.mjs`, delete the four entries whose `find` is `[data-testid="room-row-retro-0819"]`, `[data-testid="chip-archived"]`, `[data-testid="archived-bar"]`, `[data-testid="archived-toggle"]`, and the two comment blocks about `.sect.toggle` and `archived-reopen`. Keep the `.menu` entry. Add after it:

```js
  // Close: the rail row's hover × and the menus' items. The × is `display:
  // none` until hover, so its size and shape are read at rest; the menu
  // items exist only while their menu is open, so capture with the page
  // bar's ⋯ open (same convention as the composer popover).
  {
    spec: '.room .close',
    find: '[data-testid^="room-close-"]',
    props: ['width', 'height', 'border-radius', 'align-items', 'justify-content', 'color'],
    why: {
      display: 'none until hover or focus; the audit reads the resting state',
      background: 'transparent until hover; verified by eye',
      border: '0, not separately enumerated',
      flex: 'set by the row, not the control',
      'margin-right': 'verified by eye',
      cursor: 'verified by eye',
    },
  },
  {
    spec: '.menu-item',
    find: '[data-testid="room-menu-close"]',
    props: ['display', 'align-items', 'min-height', 'font-size', 'border-radius', 'color', 'padding'],
    why: {
      padding: 'shorthand not enumerated; longhands verified by eye',
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
    },
  },
  {
    spec: '.menu-dd',
    find: '[data-testid="room-menu-dropdown"]',
    props: ['display', 'flex-direction', 'background', 'border-radius', 'padding'],
    why: {
      padding: 'shorthand not enumerated; longhands verified by eye',
      border: 'token',
      'box-shadow': BOX_SHADOW_SERIALIZATION_DIFFERS,
    },
  },
```

Run: `node design/audit.mjs --probe | head -5`
Expected: prints the probe function without a syntax error.

- [ ] **Step 5: Docs**

`design/ANATOMY.md`:

- Rooms rail: replace the paragraph starting `Then, only when an archived room exists, a \`.sect.toggle\` row...` with:

  ```
  Every `.room` closes: a 22px `.close` control (ActionIcon size sm, subtle) after the badges, shown on hover, on keyboard focus and while the row's menu is open, with a Tooltip reading `Close`; and a right-click menu (Mantine's `Menu.ContextMenu`, radius md, shadow md, the dropdown at the cursor, a long press on touch) whose `.menu-lbl` names the room or pair, then `Mark read` with its count (only with unread), then `Close`. Items are `.menu-item`: 11.2px at 3.2px 7.2px, 24px tall, a 14px icon with a 4.8px gap. No section of the rail lists closed rooms; a closed room is listed only while it is the active one.
  ```

- Page bar: replace `A 30px \`.menu\` (⋯) sits last: \`Archive #room…\` (confirm names the members who lose it) or \`Reopen\`.`with`A 30px \`.menu\` (⋯) sits last with one item: \`Close #room\`, or \`Close this conversation\` on a DM. No confirm.`Delete the`archived` chip bullet.
- Delete the whole `## Archived room` section. Add after the Transcript section:

  ```
  ## Close sheet

  `Close.dc.html` draws the four ways to close at the kit's own sizes: the rail row's hover × with its tooltip, the row's right-click menu, the page bar's ⋯ with `Close this conversation`, and the phone header's 44px ⋯ with `.menu-item.tap` items (minHeight 44 via `styles`). Closing is the daemon's archive; the composer stays live and any post revives the room.
  ```

- Phone drawer sentence about ARCHIVED (if any): delete.

`design/CONFORMANCE.md`: in "The values that get sloppy" table add two rows:

```
| close control | **22px** (ActionIcon `sm`), radius 6px | 24px, the rail's `+` |
| menu item | `min-height: 24px`, 11.2px, `padding: 3.2px 7.2px` | 30px, or 12.16px type |
```

`AGENTS.md`: append:

```
## Right-click menus

Use `Menu.ContextMenu` (Mantine 9.5.2), never a `Menu.Target` with a
hand-rolled `onContextMenu`: `Menu.Target` composes a click handler, so a
left click would open the menu too. `Menu.ContextMenu` wraps the one
element that should answer a right-click (and a long press on touch),
positions the dropdown at the cursor, and suppresses the native menu
itself; the child must not call `preventDefault()` in its own
`onContextMenu`. Keep the `Menu` uncontrolled and read its state through
`onChange` when the UI needs to know it is open. One `Menu` per row, never
a shared portal. `src/app/RoomRail.tsx` is the reference.
```

`ARCHITECTURE.md`: the deploy loop becomes `cd ~/Documents/GitHub/chat && git pull && bun install && bun run build && deck restart chat`; the `GET /api/chat/rooms` row says `including closed ones (\`archivedAt\` set; the rail hides them)`; in the Screens paragraph, any sentence about the archive menu or the archived section goes.

`design/README.md`: add a revision line: `Revised 2026-08-30: archive is gone from the viewer (close replaces it: the rail row's hover ×, its right-click menu, the ⋯ menu; \`Close.dc.html\`), and the transcript is a Reader column (see the next round's spec).`

- [ ] **Step 6: Gates and commit**

Run: `grep -rn -i "archiv\|reopen" design/ANATOMY.md design/CONFORMANCE.md AGENTS.md ARCHITECTURE.md design/build.py design/audit.mjs`
Expected: only `archivedAt` in ARCHITECTURE.md's rooms row and the build.py MSGS content, if any (`archive / extract` in a deps.lock table is data, not UI). Then `bun run format` (prettier touches the md files).

Stage `design/build.py design/spec.json design/canvas.json design/audit.mjs design/artboards/Close.dc.html design/artboards/Main.dc.html design/artboards/DaemonDown.dc.html design/artboards/DirectMessage.dc.html design/artboards/PhoneRooms.dc.html design/ANATOMY.md design/CONFORMANCE.md design/README.md AGENTS.md ARCHITECTURE.md` plus the `Archived.dc.html` deletion (add every artboard `build.py` rewrote: check `git status`); message `design: Close sheet replaces the Archived artboard, audit and docs follow` plus the trailer.

---

### Task 6: One relay socket for the page, with backoff

**Files:**

- Create: `src/app/relay-socket.ts`
- Create: `src/app/relay-socket.test.ts`
- Modify: `src/app/test-utils.tsx` (`installFakeWebSocket` resets the singleton)

**Interfaces:**

- Produces:
  - `subscribeRelay(listener: (frame: RelayFrame) => void): () => void`
  - `onRelayOpen(cb: (reconnect: boolean) => void): () => void` (`reconnect` is false on the first open of the page, true on every later open)
  - `resetRelayForTests(): void`
  - `useRelayFrames(handler: (frame: RelayFrame) => void): void` and `useRelayOpen(cb: (reconnect: boolean) => void): void` React hooks that keep the latest callback in a ref.
  - `type RelayFrame = { topic?: unknown; payload?: unknown }`.
  - Backoff: 1s, 2s, 4s, ... capped at 30s; reset to 1s on a successful open. The socket closes when the last subscriber leaves.

- [ ] **Step 1: Write the failing tests**

`src/app/relay-socket.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import {
  onRelayOpen,
  resetRelayForTests,
  subscribeRelay,
  useRelayFrames,
} from './relay-socket';
import {
  FakeWebSocket,
  installFakeWebSocket,
  restoreWebSocket,
} from './test-utils';

beforeEach(() => {
  vi.useFakeTimers();
  installFakeWebSocket();
});

afterEach(() => {
  resetRelayForTests();
  restoreWebSocket();
  vi.useRealTimers();
});

test('every subscriber shares one socket and hears every frame', () => {
  const a = vi.fn();
  const b = vi.fn();
  const offA = subscribeRelay(a);
  const offB = subscribeRelay(b);
  expect(FakeWebSocket.instances).toHaveLength(1);
  FakeWebSocket.instances[0]!.onmessage?.({
    data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 1 } }),
  });
  expect(a).toHaveBeenCalledWith({
    topic: 'chat/build/msg',
    payload: { id: 1 },
  });
  expect(b).toHaveBeenCalledTimes(1);
  FakeWebSocket.instances[0]!.onmessage?.({ data: 'not json' });
  expect(a).toHaveBeenCalledTimes(1);
  offA();
  offB();
});

test('a closed socket reconnects with doubling delays, capped at 30s, and the open callback says so', () => {
  const opened = vi.fn();
  const off = subscribeRelay(() => {});
  const offOpen = onRelayOpen(opened);
  FakeWebSocket.instances[0]!.onopen?.();
  expect(opened).toHaveBeenLastCalledWith(false);

  FakeWebSocket.instances[0]!.onclose?.();
  expect(FakeWebSocket.instances).toHaveLength(1);
  vi.advanceTimersByTime(999);
  expect(FakeWebSocket.instances).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(FakeWebSocket.instances).toHaveLength(2);

  FakeWebSocket.instances[1]!.onclose?.();
  vi.advanceTimersByTime(2000);
  expect(FakeWebSocket.instances).toHaveLength(3);
  FakeWebSocket.instances[2]!.onclose?.();
  vi.advanceTimersByTime(4000);
  expect(FakeWebSocket.instances).toHaveLength(4);

  FakeWebSocket.instances[3]!.onopen?.();
  expect(opened).toHaveBeenLastCalledWith(true);
  FakeWebSocket.instances[3]!.onclose?.();
  vi.advanceTimersByTime(1000);
  expect(FakeWebSocket.instances).toHaveLength(5);

  for (let i = 4; i < 12; i++) {
    FakeWebSocket.instances[i]!.onclose?.();
    vi.advanceTimersByTime(30_000);
  }
  expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(12);
  off();
  offOpen();
});

test('the last subscriber leaving closes the socket and stops reconnecting', () => {
  const socketClose = vi.spyOn(FakeWebSocket.prototype, 'close');
  const off = subscribeRelay(() => {});
  off();
  expect(socketClose).toHaveBeenCalled();
  FakeWebSocket.instances[0]!.onclose?.();
  vi.advanceTimersByTime(60_000);
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test('useRelayFrames always calls the latest handler', () => {
  const first = vi.fn();
  const second = vi.fn();
  const { rerender, unmount } = renderHook(
    ({ handler }) => useRelayFrames(handler),
    { initialProps: { handler: first } }
  );
  rerender({ handler: second });
  FakeWebSocket.instances[0]!.onmessage?.({
    data: JSON.stringify({ topic: 'chat/build/msg' }),
  });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  unmount();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `bunx vitest run src/app/relay-socket.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: The module**

`src/app/relay-socket.ts`:

```ts
import { useEffect, useRef } from 'react';

export type RelayFrame = { topic?: unknown; payload?: unknown };
type Listener = (frame: RelayFrame) => void;
type OpenListener = (reconnect: boolean) => void;

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

const listeners = new Set<Listener>();
const openListeners = new Set<OpenListener>();
let socket: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
let everOpened = false;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function wanted(): boolean {
  return listeners.size > 0 || openListeners.size > 0;
}

/**
 * One `/ws` connection per page. A frame is a pointer (`{ topic, payload }`),
 * never prose; every subscriber sees every frame and filters by topic
 * itself. After a close the socket comes back on a doubling delay from 1s
 * to 30s; a successful open resets the delay, and the open callbacks learn
 * whether this is a reconnect so the page can refetch what it missed.
 */
function connect() {
  if (socket || !wanted() || typeof window === 'undefined') return;
  const ws = new WebSocket(wsUrl());
  socket = ws;
  ws.onopen = () => {
    const reconnect = everOpened;
    everOpened = true;
    failures = 0;
    for (const cb of openListeners) cb(reconnect);
  };
  ws.onmessage = event => {
    let frame: RelayFrame;
    try {
      frame = JSON.parse(String((event as { data: unknown }).data));
    } catch {
      return;
    }
    for (const listener of listeners) listener(frame);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (!wanted()) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** failures);
    failures += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  };
  ws.onerror = () => {
    ws.close();
  };
}

function disconnectIfIdle() {
  if (wanted()) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const ws = socket;
  socket = null;
  ws?.close();
}

export function subscribeRelay(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    disconnectIfIdle();
  };
}

export function onRelayOpen(cb: OpenListener): () => void {
  openListeners.add(cb);
  connect();
  return () => {
    openListeners.delete(cb);
    disconnectIfIdle();
  };
}

/** Tests share this module's singletons across files; each test starts clean. */
export function resetRelayForTests() {
  listeners.clear();
  openListeners.clear();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  socket = null;
  failures = 0;
  everOpened = false;
}

export function useRelayFrames(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeRelay(frame => ref.current(frame)), []);
}

export function useRelayOpen(cb: OpenListener): void {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => onRelayOpen(reconnect => ref.current(reconnect)), []);
}
```

In `src/app/test-utils.tsx`, import `resetRelayForTests` from `./relay-socket` and call it as the first line of `installFakeWebSocket()`, so every suite that stubs the socket also drops the previous test's subscribers. (`test-utils.tsx` importing `relay-socket.ts` is fine: no cycle, since `relay-socket.ts` imports only React.)

- [ ] **Step 4: Run the file, then the suite**

Run: `bunx vitest run src/app/relay-socket.test.ts`
Expected: PASS. Then `bun run typecheck && bun run lint && bunx vitest run && bun run format`: green (nothing uses the module yet).

- [ ] **Step 5: Commit**

Stage `src/app/relay-socket.ts src/app/relay-socket.test.ts src/app/test-utils.tsx`; message `relay-socket: one /ws connection per page, backoff, fan-out` plus the trailer.

---

### Task 7: Buddies, members, the transcript and the room list ride the shared socket; refetch on reconnect, on visibility, and for unknown rooms

**Files:**

- Modify: `src/app/App.tsx` (`useBuddies`, `useRooms`, `useRoomMembers`, `App`)
- Modify: `src/app/Transcript.tsx` (the WS effect)
- Modify: `src/app/App.test.tsx`, `src/app/Transcript.test.tsx`

**Interfaces:**

- Consumes: `useRelayFrames`, `useRelayOpen` (Task 6).
- Produces: `useBuddies` returns `{ buddies, refetchBuddies }`; `useRoomMembers` returns `{ members, refetchMembers }` (`members` is still `string[]`); `useRooms` refetches on a `chat/<room>/msg` frame whose room is not listed; `App` refetches rooms, then buddies, then members on reconnect and when the tab becomes visible; `Transcript` refetches its tail on the same two triggers.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/App.test.tsx` (after the members-refetch test):

```tsx
test('a msg frame for a room the rail does not know refetches rooms at once', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      jsonResponse(
        url === '/api/chat/rooms'
          ? {
              rooms: [
                { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
                { room: 'fresh', memberCount: 1, unread: 1, mentions: 0 },
              ],
            }
          : {}
      )
    )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(
      <App
        initialState={{
          daemonReachable: true,
          buddies: [],
          rooms: [{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }],
          members: [],
          messages: [],
        }}
      />
    );
  });
  const before = fetchMock.mock.calls.filter(
    ([u]) => u === '/api/chat/rooms'
  ).length;
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/fresh/msg', payload: { id: 9 } }),
      });
  });
  expect(
    fetchMock.mock.calls.filter(([u]) => u === '/api/chat/rooms').length
  ).toBe(before + 1);
  expect(await screen.findByTestId('room-row-fresh')).toBeInTheDocument();
  await act(async () => {
    for (const socket of FakeWebSocket.instances)
      socket.onmessage?.({
        data: JSON.stringify({ topic: 'chat/build/msg', payload: { id: 10 } }),
      });
  });
  expect(
    fetchMock.mock.calls.filter(([u]) => u === '/api/chat/rooms').length
  ).toBe(before + 1);
});

test('a reconnect and a tab becoming visible refetch rooms, buddies and members, in that order', async () => {
  installFetchMock();
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      jsonResponse(
        url === '/api/chat/rooms'
          ? {
              rooms: [
                { room: 'build', memberCount: 1, unread: 0, mentions: 0 },
              ],
            }
          : { buddies: [], members: [] }
      )
    )
  );
  window.history.replaceState(null, '', '/r/build');
  await act(async () => {
    renderWithProviders(<App initialState={{ ...twoRooms, members: [] }} />);
  });
  const socket = FakeWebSocket.instances[0]!;
  await act(async () => {
    socket.onopen?.();
  });
  fetchMock.mockClear();
  await act(async () => {
    socket.onclose?.();
  });
  const again = FakeWebSocket.instances.at(-1)!;
  await act(async () => {
    again.onopen?.();
  });
  await waitFor(() => {
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.indexOf('/api/chat/rooms')).toBeGreaterThanOrEqual(0);
    expect(urls.indexOf('/api/chat/buddies')).toBeGreaterThan(
      urls.indexOf('/api/chat/rooms')
    );
    expect(
      urls.findIndex(u => u.startsWith('/api/chat/who/build'))
    ).toBeGreaterThan(urls.indexOf('/api/chat/buddies'));
  });

  fetchMock.mockClear();
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/chat/rooms')).toBe(
      true
    )
  );
});
```

`twoRooms` is the existing initial-state constant in this file; if the reconnect test's socket creation depends on fake timers, wrap the `onclose` + advance in `vi.useFakeTimers()`/`vi.advanceTimersByTime(1000)`/`vi.useRealTimers()`; the relay reconnects after 1s.

Add to `src/app/Transcript.test.tsx`:

```tsx
test('a reconnect refetches the tail without a frame', async () => {
  const { pushFrame } = renderTranscriptWithFakeSocket({
    room: 'build',
    messages: [],
  });
  pushFrame({ topic: 'chat/build/msg', payload: { id: 1 } });
  expect(await screen.findByText('message 1')).toBeInTheDocument();
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.onopen?.();
  const before = fetchMock.mock.calls.length;
  socket.onopen?.();
  await waitFor(() =>
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
  );
});
```

(Import `FakeWebSocket` and `waitFor` where missing.)

- [ ] **Step 2: Run both files to see the new tests fail**

Run: `bunx vitest run src/app/App.test.tsx src/app/Transcript.test.tsx`
Expected: the three new tests FAIL.

- [ ] **Step 3: Rewire the hooks**

In `src/app/App.tsx`:

1. Import `useRelayFrames, useRelayOpen` from `./relay-socket`. Delete the local `wsUrl()` function.
2. `useBuddies`: replace the `useEffect` that opens a `WebSocket` with `useRelayFrames(frame => { if (isMsgTopic(frame.topic)) fetchBuddies(); });` and return `{ buddies, refetchBuddies: fetchBuddies }`. Update the docblock's first sentence to say the frames come from the page's relay socket.
3. `useRooms`: add a ref to the current list and the unknown-room refetch:

```tsx
const roomsRef = useRef(rooms);
roomsRef.current = rooms;
// A post into a room this list has never seen is the daemon's only signal
// that a room exists now; refetch at once instead of waiting for the poll.
useRelayFrames(frame => {
  if (!isMsgTopic(frame.topic)) return;
  const room = frame.topic.slice('chat/'.length, -'/msg'.length);
  if (!roomsRef.current.some(r => r.room === room)) void refetchRooms();
});
```

4. `useRoomMembers`: replace its `WebSocket` effect with `useRelayFrames(frame => { if (room && frame.topic === \`chat/${room}/msg\`) fetchMembers(); });`and return`{ members: members.map(m => m.handle), refetchMembers: fetchMembers }`.
5. In `App`: `const { buddies, refetchBuddies } = useBuddies(...)`, `const { members: roomMembers, refetchMembers } = useRoomMembers(...)`, then:

```tsx
// What a sleeping tab missed: rooms first (a room may have appeared),
// then the roster, then the open room's members. The transcript refetches
// its own tail on the same triggers.
const refetchAll = useCallback(async () => {
  await refetchRooms();
  refetchBuddies();
  refetchMembers();
}, [refetchRooms, refetchBuddies, refetchMembers]);
useRelayOpen(reconnect => {
  if (reconnect) void refetchAll();
});
useEffect(() => {
  const onVisible = () => {
    if (document.visibilityState === 'visible') void refetchAll();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}, [refetchAll]);
```

`fetchBuddies` must not be gated on `seed` for refetches: the mount-only guard stays on the mount effect; `refetchBuddies` calls `fetchBuddies` directly.

In `src/app/Transcript.tsx`: delete the local `wsUrl()`; import `useRelayFrames, useRelayOpen` from `./relay-socket`; replace the `useEffect` that opens the socket with:

```tsx
const refetchTail = useCallback(() => {
  void fetch(`/api/chat/messages/${room}`)
    .then(res => res.json())
    .then((data: { messages?: ChatMessage[] }) => {
      if (roomRef.current !== room) return;
      const next = mergeMessages(messagesRef.current, data.messages ?? []);
      const added = next.length - messagesRef.current.length;
      if (added > 0 && awayRef.current) setNewSinceAway(n => n + added);
      setMessages(next);
    })
    .catch(() => {});
}, [room]);
useRelayFrames(frame => {
  if (frame.topic === `chat/${room}/msg`) refetchTail();
});
useRelayOpen(reconnect => {
  if (reconnect) refetchTail();
});
useEffect(() => {
  const onVisible = () => {
    if (document.visibilityState === 'visible') refetchTail();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}, [refetchTail]);
```

(`useCallback` joins the react import.) Update the `Transcript` docblock: the frame comes from the page's relay socket, not a socket of its own.

- [ ] **Step 4: Run the two files, then the suite**

Run: `bunx vitest run src/app/App.test.tsx src/app/Transcript.test.tsx`
Expected: PASS, including the older WS tests (`FakeWebSocket.instances` now holds one shared socket; the existing loops over all instances still deliver). Then `bun run typecheck && bun run lint && bunx vitest run && bun run format`.

- [ ] **Step 5: Commit**

Stage `src/app/App.tsx src/app/Transcript.tsx src/app/App.test.tsx src/app/Transcript.test.tsx`; message `liveness: shared relay socket, refetch on reconnect and visibility, unknown-room refetch` plus the trailer.

---

### Task 8: `MessageMarkdown`: react-markdown + remark-gfm + mentions, the prose module, the vendored face

**Files:**

- Modify: `package.json`, `bun.lock` (deps)
- Create: `scripts/vendor-plex-sans.mjs`, `public/fonts/ibm-plex-sans-400.woff2`, `-500.woff2`, `-600.woff2`
- Create: `src/app/transcript-prose.module.css`
- Create: `src/app/remark-mentions.ts`
- Create: `src/app/MessageMarkdown.tsx`
- Create: `src/app/MessageMarkdown.test.tsx`
- Modify: `src/app/components/CodeBlock.tsx` (a `data-testid`)

**Interfaces:**

- Consumes: `CodeBlock({ code, language, minHeight })` from `src/app/components/CodeBlock.tsx`.
- Produces:
  - `MessageMarkdown({ body, mentions, humanHandle? })` rendering into `div.prose` is NOT part of this component: it renders the markdown children only; the caller (Task 9) wraps it in the `prose` class and the `message-body` test id.
  - `remarkMentions(options: { handles: string[]; me?: string; className: string; meClassName: string })`: a remark plugin. A mention renders as `<span class="<className>[ <meClassName>]" data-mention="<handle>" [data-me="true"]>@handle</span>`.
  - CSS module classes: `col`, `msg`, `mine`, `hdr`, `prose`, `tbl`, `at`, `atMe`, `fold`.
  - `CodeBlock`'s root `Paper` carries `data-testid="code-block"`.

- [ ] **Step 1: Dependencies and the face**

Run:

```bash
bun add react-markdown@^10.1.0 remark-gfm@^4.0.1 unist-util-visit@^5.1.0
bun add -d @types/mdast@^4.0.4 @types/hast@^3.0.4
```

Write `scripts/vendor-plex-sans.mjs`:

```js
// Downloads IBM Plex Sans (OFL) latin woff2 at the three weights the
// transcript uses, from Google Fonts, into public/fonts. One-off; re-run
// only to change weights.
import { mkdirSync, writeFileSync } from 'node:fs';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const css = await (
  await fetch(
    'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap',
    { headers: { 'User-Agent': UA } }
  )
).text();
mkdirSync('public/fonts', { recursive: true });
for (const weight of [400, 500, 600]) {
  const block = css
    .split('/* latin */')
    .find(part => part.includes(`font-weight: ${weight};`));
  const url = block?.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  if (!url) throw new Error(`no latin woff2 for weight ${weight}`);
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  writeFileSync(`public/fonts/ibm-plex-sans-${weight}.woff2`, bytes);
  console.log(`ibm-plex-sans-${weight}.woff2 ${bytes.length} bytes`);
}
```

Run: `node scripts/vendor-plex-sans.mjs`
Expected: three files under `public/fonts/`, each between 20 and 60 KB. (The `/* latin */` comment precedes each latin `@font-face` block in Google's CSS; if the split finds nothing, print the CSS and adjust the marker.)

- [ ] **Step 2: The prose module**

`src/app/transcript-prose.module.css` (every value is the artboard's; comments only where a value is not obvious):

```css
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans-400.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans-500.woff2') format('woff2');
}
@font-face {
  font-family: 'IBM Plex Sans';
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url('/fonts/ibm-plex-sans-600.woff2') format('woff2');
}

/* About 100 characters at md; the column, not the type, is what keeps a
   long post readable on a wide screen. */
.col {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}

.msg {
  display: block;
  padding: 16px 0;
  min-width: 0;
}

.msg + .msg {
  border-top: 1px solid var(--tk-border-soft);
}

.hdr {
  display: flex;
  align-items: baseline;
  gap: var(--mantine-spacing-sm);
  min-width: 0;
  margin-bottom: 8px;
}

.prose {
  font-family:
    'IBM Plex Sans',
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
  font-size: var(--mantine-font-size-md);
  line-height: 1.7;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.prose > * {
  margin: 0;
}

.prose h1 {
  font-size: var(--mantine-font-size-xl);
  font-weight: 600;
  line-height: 1.35;
  margin-top: 4px;
}

.prose h2 {
  font-size: var(--mantine-font-size-lg);
  font-weight: 600;
  line-height: 1.35;
  margin-top: 4px;
}

.prose h3 {
  font-size: var(--mantine-font-size-md);
  font-weight: 600;
  line-height: 1.4;
  margin-top: 2px;
}

.prose ul,
.prose ol {
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prose li > ul,
.prose li > ol {
  margin-top: 3px;
  gap: 3px;
}

/* remark-gfm task items: the box is decoration, never a control. */
.prose li:has(> input[type='checkbox']) {
  list-style: none;
  margin-left: -20px;
}

.prose li > input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin: 0 7.2px 0 0;
  vertical-align: -2px;
  pointer-events: none;
}

.prose code {
  font-family: var(--mantine-font-family-monospace);
  font-size: var(--mantine-font-size-sm);
  padding: 0 4px;
  background: var(--ui-bg-3);
  border: 1px solid var(--tk-border-soft);
  border-radius: 3px;
}

.prose strong {
  font-weight: 600;
}

.prose del {
  color: var(--tk-muted-text);
}

.tbl {
  overflow-x: auto;
}

.prose table {
  border-collapse: collapse;
  font-size: var(--mantine-font-size-sm);
  line-height: 1.45;
}

.prose th,
.prose td {
  border: 1px solid var(--tk-border-soft);
  padding: 4.8px 8px;
  text-align: left;
  vertical-align: top;
}

.prose th {
  background: var(--tk-panel);
  font-weight: 600;
}

.prose blockquote {
  padding-left: var(--mantine-spacing-lg);
  border-left: 2px solid var(--tk-border);
  color: var(--tk-muted-text);
}

.prose hr {
  border: 0;
  border-top: 1px solid var(--tk-border-soft);
}

.prose a {
  color: var(--mantine-color-accent-text);
}

.prose a:hover {
  text-decoration: underline;
}

.at {
  color: var(--mantine-color-accent-text);
  font-weight: 600;
}

.atMe {
  background: color-mix(
    in srgb,
    var(--mantine-color-accent-text) var(--tk-wash),
    transparent
  );
  border-radius: 3px;
  padding: 0 3px;
}

.mine .prose {
  background: color-mix(
    in srgb,
    var(--mantine-color-accent-text) var(--tk-wash),
    transparent
  );
  border-radius: var(--mantine-radius-md);
  padding: var(--mantine-spacing-md) var(--mantine-spacing-lg);
}

.fold {
  position: relative;
  max-height: 320px;
  overflow: hidden;
}

.fold::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 48px;
  background: linear-gradient(to bottom, transparent, var(--tk-card));
  pointer-events: none;
}
```

- [ ] **Step 3: Write the failing tests**

`src/app/MessageMarkdown.test.tsx`:

````tsx
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { MessageMarkdown } from './MessageMarkdown';

function render(body: string, mentions: string[] = [], humanHandle?: string) {
  return renderWithProviders(
    <div data-testid="body">
      <MessageMarkdown
        body={body}
        mentions={mentions}
        humanHandle={humanHandle}
      />
    </div>
  );
}

test('paragraphs, headings, lists, a table, a quote and a rule render as their tags', () => {
  render(
    '# One\n\n## Two\n\n#### Deep\n\npara one\n\npara two\n\n- a\n- b\n  - nested\n\n1. first\n2. second\n\n| k | v |\n| --- | --- |\n| url | where |\n\n> quoted\n\n---\n\n- [x] done\n- [ ] todo'
  );
  const body = screen.getByTestId('body');
  expect(body.querySelector('h1')).toHaveTextContent('One');
  expect(body.querySelector('h2')).toHaveTextContent('Two');
  expect(body.querySelector('h3')).toHaveTextContent('Deep');
  expect(body.querySelectorAll('h4')).toHaveLength(0);
  expect(body.querySelectorAll(':scope > p')).toHaveLength(2);
  expect(body.querySelectorAll('ul > li')).toHaveLength(5);
  expect(body.querySelector('ul ul > li')).toHaveTextContent('nested');
  expect(body.querySelectorAll('ol > li')).toHaveLength(2);
  expect(body.querySelector('table th')).toHaveTextContent('k');
  expect(body.querySelector('table td')).toHaveTextContent('url');
  expect(body.querySelector('table')!.parentElement!.className).toContain(
    'tbl'
  );
  expect(body.querySelector('blockquote')).toHaveTextContent('quoted');
  expect(body.querySelector('hr')).toBeInTheDocument();
  const boxes = body.querySelectorAll('input[type="checkbox"]');
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeChecked();
  expect(boxes[0]).toBeDisabled();
});

test('inline forms: bold, italic, strikethrough, inline code, bare and written links', () => {
  render(
    'see **bold** and *soft* and ~~gone~~ and `make_icon_swift` at http://x.test/a_b_c or [the spec](https://x.test/spec)'
  );
  const body = screen.getByTestId('body');
  expect(body.querySelector('strong')).toHaveTextContent('bold');
  expect(body.querySelector('em')).toHaveTextContent('soft');
  expect(body.querySelector('del')).toHaveTextContent('gone');
  expect(body.querySelector('code')).toHaveTextContent('make_icon_swift');
  const bare = screen.getByRole('link', { name: 'http://x.test/a_b_c' });
  expect(bare).toHaveAttribute('href', 'http://x.test/a_b_c');
  expect(bare).toHaveAttribute('target', '_blank');
  expect(bare).toHaveAttribute('rel', 'noreferrer');
  expect(screen.getByRole('link', { name: 'the spec' })).toHaveAttribute(
    'href',
    'https://x.test/spec'
  );
});

test('raw HTML never renders, an unsafe link loses its href, an image is its alt text', () => {
  render(
    'before <b>bold</b> <script>alert(1)</script> after\n\n[bad](javascript:alert(1))\n\n![the failing step](https://x.test/shot.png)'
  );
  const body = screen.getByTestId('body');
  expect(body.querySelector('b')).toBeNull();
  expect(body.querySelector('script')).toBeNull();
  expect(body).toHaveTextContent('before bold after');
  expect(
    screen.getByRole('link', { name: 'bad' }).getAttribute('href') ?? ''
  ).toBe('');
  expect(body.querySelector('img')).toBeNull();
  expect(
    screen.getByRole('link', { name: 'the failing step' })
  ).toHaveAttribute('href', 'https://x.test/shot.png');
});

test('a fenced block renders through CodeBlock with its language and text', async () => {
  render('run:\n\n```sh\necho one\necho two\n```\n\ndone');
  const block = await screen.findByTestId('code-block');
  expect(block).toHaveTextContent('echo one');
  expect(block).toHaveTextContent('echo two');
  expect(screen.getByTestId('body').querySelectorAll('pre')).toHaveLength(1);
});

test('mentions: only listed handles, never inside code, the human washed', () => {
  render('`@matt` and @matt and @fred and @matthew', ['matt'], 'matt');
  const mentions = screen
    .getByTestId('body')
    .querySelectorAll('[data-mention]');
  expect(mentions).toHaveLength(1);
  expect(mentions[0]).toHaveTextContent('@matt');
  expect(mentions[0]).toHaveAttribute('data-me', 'true');
  expect(screen.getByText('@fred', { exact: false })).toBeInTheDocument();
  render('@fred ping', ['fred'], 'matt');
  const fred = screen
    .getAllByTestId('body')[1]!
    .querySelector('[data-mention]')!;
  expect(fred).toHaveAttribute('data-mention', 'fred');
  expect(fred).not.toHaveAttribute('data-me');
});
````

- [ ] **Step 4: Run it to see it fail**

Run: `bunx vitest run src/app/MessageMarkdown.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 5: The mentions plugin**

`src/app/remark-mentions.ts`:

```ts
import type { Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

export interface MentionOptions {
  /** The message's own `mentions` list: the only handles that count. */
  handles: string[];
  /** The human's handle: its mention gets `meClassName` and `data-me`. */
  me?: string;
  className: string;
  meClassName: string;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `@handle` -> a span, only for handles the message lists. Runs on text
 * nodes after remark has parsed the body, so an `@` inside a code span,
 * a fence or a link label is never reached. The `hName`/`hProperties`
 * data is what mdast-util-to-hast turns into the element.
 */
export function remarkMentions(options: MentionOptions) {
  const { handles, me, className, meClassName } = options;
  if (handles.length === 0) return () => {};
  const pattern = new RegExp(
    `@(${handles.map(escapeForRegExp).join('|')})(?![a-z0-9._-])`,
    'g'
  );
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === 'link') return;
      const parts: Text[] = [];
      let last = 0;
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(node.value))) {
        if (match.index > last) {
          parts.push({
            type: 'text',
            value: node.value.slice(last, match.index),
          });
        }
        const handle = match[1]!;
        const isMe = handle === me;
        parts.push({
          type: 'text',
          value: `@${handle}`,
          data: {
            hName: 'span',
            hProperties: {
              className: isMe ? [className, meClassName] : [className],
              'data-mention': handle,
              ...(isMe ? { 'data-me': 'true' } : {}),
            },
          },
        });
        last = pattern.lastIndex;
      }
      if (parts.length === 0) return;
      if (last < node.value.length) {
        parts.push({ type: 'text', value: node.value.slice(last) });
      }
      parent.children.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}
```

- [ ] **Step 6: The component and the CodeBlock test id**

`src/app/MessageMarkdown.tsx`:

```tsx
import { useMemo } from 'react';
import type { Element } from 'hast';
import Markdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { CodeBlock } from './components/CodeBlock';
import { remarkMentions } from './remark-mentions';
import classes from './transcript-prose.module.css';

/** 12.16px at CodeHighlight's 1.7 line height, plus its 4.8px paddings. */
const CODE_LINE_PX = 20.7;
const CODE_PAD_PX = 9.6;

function fenceOf(node: Element | undefined): {
  code: string;
  language: string;
} {
  const codeEl = node?.children.find(
    (child): child is Element =>
      child.type === 'element' && child.tagName === 'code'
  );
  const raw = codeEl?.properties?.className;
  const names = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map(
    String
  );
  const language =
    names.find(n => n.startsWith('language-'))?.slice('language-'.length) ??
    'text';
  const code = (codeEl?.children ?? [])
    .map(child => (child.type === 'text' ? child.value : ''))
    .join('')
    .replace(/\n$/, '');
  return { code, language };
}

const components: Components = {
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer" />
  ),
  // The viewer never fetches a third-party URL: an image is its alt text,
  // linking to the file for whoever wants it.
  img: ({ src, alt }) => (
    <a
      href={typeof src === 'string' ? src : undefined}
      target="_blank"
      rel="noreferrer"
    >
      {alt || 'image'}
    </a>
  ),
  pre: ({ node }) => {
    const { code, language } = fenceOf(node);
    const lines = code.split('\n').length;
    return (
      <CodeBlock
        code={code}
        language={language}
        minHeight={Math.min(
          400,
          Math.round(lines * CODE_LINE_PX + CODE_PAD_PX)
        )}
      />
    );
  },
  table: ({ node: _node, ...props }) => (
    <div className={classes.tbl}>
      <table {...props} />
    </div>
  ),
};

export interface MessageMarkdownProps {
  body: string;
  mentions: string[];
  humanHandle?: string;
}

/** One message body. Raw HTML is skipped, links keep react-markdown's
    default protocol allowlist, and the caller supplies the `prose` wrapper. */
export function MessageMarkdown({
  body,
  mentions,
  humanHandle,
}: MessageMarkdownProps) {
  const remarkPlugins = useMemo<NonNullable<Options['remarkPlugins']>>(
    () => [
      remarkGfm,
      [
        remarkMentions,
        {
          handles: mentions,
          me: humanHandle,
          className: classes.at,
          meClassName: classes.atMe,
        },
      ],
    ],
    [mentions, humanHandle]
  );
  return (
    <Markdown remarkPlugins={remarkPlugins} skipHtml components={components}>
      {body}
    </Markdown>
  );
}
```

In `src/app/components/CodeBlock.tsx`, add `data-testid="code-block"` to the `<Paper withBorder ...>`.

If `Options['remarkPlugins']` rejects the tuple form, type it as `import type { PluggableList } from 'unified'` after `bun add -d unified@^11` (unified is already a transitive dependency of react-markdown); do not loosen to `never`.

- [ ] **Step 7: Run the file**

Run: `bunx vitest run src/app/MessageMarkdown.test.tsx`
Expected: PASS. The `code-block` test uses `findByTestId` because `CodeHighlight` loads lazily. If `@mantine/code-highlight/styles.css` fails to import under vitest, add `css: false` handling is already the default; if the lazy chunk never resolves in jsdom, wrap the render in `act` and `await screen.findByTestId('code-block', {}, { timeout: 3000 })`.

- [ ] **Step 8: Gates and commit**

Run: `bun run typecheck && bun run lint && bunx vitest run && bun run format`
Expected: green.

Stage `package.json bun.lock scripts/vendor-plex-sans.mjs public/fonts src/app/transcript-prose.module.css src/app/remark-mentions.ts src/app/MessageMarkdown.tsx src/app/MessageMarkdown.test.tsx src/app/components/CodeBlock.tsx`; message `transcript: MessageMarkdown on react-markdown + remark-gfm, mentions plugin, prose module, vendored IBM Plex Sans` plus the trailer.

---

### Task 9: The transcript renders through `MessageMarkdown` in a reading column; the parser goes

**Files:**

- Create: `src/app/human.ts`
- Modify: `src/app/Transcript.tsx`
- Modify: `src/app/transcript-body.module.css` (delete; its `.fold` moved to the prose module)
- Modify: `src/app/Transcript.test.tsx`, `src/app/test-utils.tsx`
- Modify: `src/app/App.tsx` (pass `humanHandle`)

**Interfaces:**

- Consumes: `MessageMarkdown`, the prose module classes (Task 8).
- Produces: `HUMAN_HANDLE` in `src/app/human.ts`; `Transcript` unchanged in props; each message row carries `data-mine="true"` when its handle is the human's; the list and the footer sit inside `div[data-testid="transcript-column"]` (`.col`); the body wrapper keeps `data-testid="message-body"` and now carries the `prose` class.

- [ ] **Step 1: Rewrite the parser tests**

In `src/app/Transcript.test.tsx`, delete `a body renders its paragraphs, lists, bold and links, and leaves code alone`, `numbered lists, italic and underscore identifiers render as agents write them`, `two bare URLs in one body both render as links`, and `a code block carries a copy control that writes the block text only`. Replace `wide content scrolls inside its own container, not the page` with:

```tsx
test('a fenced block renders as a CodeBlock inside the message, never widening the column', async () => {
  renderWithProviders(
    <Transcript room="build" messages={[longCodeBlockMessage]} />
  );
  const block = await screen.findByTestId('code-block');
  expect(block).toHaveTextContent('Cannot find module');
  expect(screen.getByTestId('transcript-column')).toBeInTheDocument();
});
```

Replace `a mention of the human gets the wash; a mention of anyone else does not` with:

```tsx
test('a mention of the human is marked as me; the human’s own post is marked mine', () => {
  renderWithProviders(
    <Transcript
      room="build"
      humanHandle="matt"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'rt-chat-wt',
          body: '@matt PR #67 is green, ok to merge?',
          mentions: ['matt'],
          postedAt: Date.now(),
        },
        {
          id: 2,
          room: 'build',
          handle: 'matt',
          body: 'merge it',
          mentions: [],
          postedAt: Date.now(),
        },
      ]}
    />
  );
  const mention = screen.getByText('@matt');
  expect(mention).toHaveAttribute('data-mention', 'matt');
  expect(mention).toHaveAttribute('data-me', 'true');
  expect(screen.getByTestId('message-1')).not.toHaveAttribute('data-mine');
  expect(screen.getByTestId('message-2')).toHaveAttribute('data-mine', 'true');
  expect(screen.getByTestId('message-2')).toHaveTextContent('you');
});

test('markdown structure reaches the row: paragraphs, a list, code untouched', () => {
  renderWithProviders(
    <Transcript
      room="build"
      messages={[
        {
          id: 1,
          room: 'build',
          handle: 'deck-main',
          body: 'first **point**\n\n- one\n- two\n\nsee `**not bold**`',
          mentions: [],
          postedAt: 1,
        },
      ]}
    />
  );
  const body = screen.getByTestId('message-body');
  expect(body.querySelectorAll('p')).toHaveLength(2);
  expect(body.querySelector('strong')).toHaveTextContent('point');
  expect(body.querySelectorAll('li')).toHaveLength(2);
  expect(screen.getByText('**not bold**').tagName).toBe('CODE');
});
```

The `withTallBodies` helper keys on `dataset.testid === 'message-body'`; it keeps working because the wrapper keeps that id.

- [ ] **Step 2: Run the file to see the changed tests fail**

Run: `bunx vitest run src/app/Transcript.test.tsx`
Expected: the three rewritten tests FAIL.

- [ ] **Step 3: Rewrite the rows**

`src/app/human.ts`:

```ts
/** The viewer posts as this handle; the server's `chat.humanHandle` setting
    defaults to the same value and `?handle=` overrides it per request. */
export const HUMAN_HANDLE = 'matt';
```

In `src/app/Transcript.tsx`:

1. Imports: drop `CopyActionIcon`; drop `bodyClasses` (delete `src/app/transcript-body.module.css`); add `import { MessageMarkdown } from './MessageMarkdown';` and `import prose from './transcript-prose.module.css';`.
2. Delete `BodyPart`, `splitCodeFences`, `escapeForRegExp`, `renderMentions`, `URL_RE`, `BULLET_RE`, `NUMBERED_RE`, `ITALIC_RE`, `URL_TEST`, `renderInline`, `renderItalic`, `renderBlocks`, `renderTextPart`, and the `ACCENT_WASH` constant if nothing else reads it.
3. Replace `MessageBody`'s `body` element with:

```tsx
const body = (
  <div ref={bodyRef} data-testid="message-body" className={prose.prose}>
    <MessageMarkdown
      body={message.body}
      mentions={message.mentions}
      humanHandle={humanHandle}
    />
  </div>
);
```

and the fold wrapper's class from `bodyClasses.fold` to `prose.fold`.

4. Replace `MessageRow` with:

```tsx
function YouBadge() {
  return (
    <Box
      component="span"
      data-testid="you-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 16,
        padding: '0 6px',
        borderRadius: 10,
        fontSize: 9,
        fontWeight: 500,
        lineHeight: 1,
        border: '1px solid var(--tk-border)',
        color: 'var(--tk-muted-text)',
      }}
    >
      you
    </Box>
  );
}

function MessageRow({
  message,
  humanHandle,
  anchored,
}: {
  message: ChatMessage;
  humanHandle: string | undefined;
  anchored: boolean;
}) {
  const mine = humanHandle !== undefined && message.handle === humanHandle;
  return (
    <div
      id={`m-${message.id}`}
      data-testid={`message-${message.id}`}
      data-mine={mine ? 'true' : undefined}
      className={mine ? `${prose.msg} ${prose.mine}` : prose.msg}
    >
      <div className={prose.hdr}>
        <AgentName handle={message.handle} variant="inline" />
        {mine && <YouBadge />}
        <Text
          size="xs"
          title={new Date(message.postedAt).toLocaleString()}
          style={{ color: 'var(--tk-muted-text)' }}
        >
          {formatLocalTime(message.postedAt)}
        </Text>
      </div>
      <MessageBody
        message={message}
        humanHandle={humanHandle}
        startExpanded={anchored}
      />
    </div>
  );
}
```

(`isFirst` goes: the separator is the module's `.msg + .msg` rule.) Remove `isFirst={i === 0}` from the call site.

5. Wrap the list and the footer in the column. Inside the `ScrollToBottom` content `Box`, wrap `{notice ...}`, the `OlderEdge`, and the `<Stack gap={0}>` in `<div className={prose.col} data-testid="transcript-column">...</div>`; wrap the footer's `{footer}` the same way (a second `div.col`, no test id).

6. Delete `BORDER_SOFT` if unused.

In `src/app/App.tsx`: import `HUMAN_HANDLE` from `./human` and pass `humanHandle={HUMAN_HANDLE}` to both `<Transcript>` call sites (desktop and phone). In `src/app/PageBar.tsx`, if a `humanHandle = 'matt'` default survived Task 3, replace it with the constant.

- [ ] **Step 4: Run the transcript tests, then everything**

Run: `bunx vitest run src/app/Transcript.test.tsx`
Expected: PASS (fold, dividers, pill, anchor, WS tests untouched). Then `bun run typecheck && bun run lint && bunx vitest run && bun run format`.

- [ ] **Step 5: Look at it**

Run `bun run build && CHAT_FIXTURES=1 PORT=11077 bun src/server/index.ts` in the background, open `http://localhost:11077/r/build` with Fast Browser at 1440 and at 390, screenshot, and check against the canvas's Main and Phone artboards: the column is centered and capped, the sender line sits above the body, the fenced block is a boxed panel with the kit's copy control, `@matt` is washed, the fold still folds the long jest log. Fix what differs before committing.

- [ ] **Step 6: Commit**

Stage `src/app/human.ts src/app/Transcript.tsx src/app/Transcript.test.tsx src/app/App.tsx src/app/PageBar.tsx` plus the `transcript-body.module.css` deletion; message `transcript: Reader column via MessageMarkdown, parser deleted` plus the trailer.

---

### Task 10: The artboards, spec, audit and docs adopt Reader

**Files:**

- Modify: `design/build.py` (shared CSS, `MSGS`, `transcript`, `dm_transcript`, `head`), `design/spec.json` (regenerated), `design/audit.mjs`, `design/artboards/*.dc.html` (regenerated)
- Modify: `design/ANATOMY.md`, `design/CONFORMANCE.md`, `ARCHITECTURE.md`

**Interfaces:**

- Consumes: test ids from Task 9 (`transcript-column`, `message-<id>`, `message-body`, `code-block`, `data-mine`).
- Produces: spec selectors `.col`, `.msg`, `.hdr`, `.prose`, `.prose h1`, `.prose h2`, `.prose h3`, `.prose ul, .prose ol`, `.prose code`, `.prose table`, `.prose th, .prose td`, `.prose blockquote`, `.ch`, `.ch pre`, `.msg.mine .prose`, `.at`, `.at.me`, `.fold`, `.more`.

- [ ] **Step 1: The shared CSS**

In `design/build.py`'s `CSS` block, delete the rules for `.msg`, `.msg + .msg`, `.msg-body`, `.msg-body code`, `.at`, `.at.me`, `.code`, `.codewrap`, `.copy`, `.fold` and add in their place:

```
    .col { width: 100%; max-width: 640px; margin: 0 auto; }
    .msg { display: block; padding: 16px 0; min-width: 0; }
    .msg + .msg { border-top: 1px solid var(--border-soft); }
    .hdr { display: flex; align-items: baseline; gap: 7.2px; min-width: 0; margin-bottom: 8px; }
    .hdr .h { font-size: 13.6px; font-weight: 600; }
    .prose { font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 12.16px; line-height: 1.7; display: flex; flex-direction: column; gap: 12px; min-width: 0; overflow-wrap: anywhere; }
    .prose > * { margin: 0; }
    .prose h1 { font-size: 14.72px; font-weight: 600; line-height: 1.35; margin-top: 4px; }
    .prose h2 { font-size: 13.6px; font-weight: 600; line-height: 1.35; margin-top: 4px; }
    .prose h3 { font-size: 12.16px; font-weight: 600; line-height: 1.4; margin-top: 2px; }
    .prose ul, .prose ol { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }
    .prose li > ul, .prose li > ol { margin-top: 3px; gap: 3px; }
    .prose code { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.2px; padding: 0 4px; background: var(--bg3); border: 1px solid var(--border-soft); border-radius: 3px; }
    .prose strong { font-weight: 600; }
    .prose del { color: var(--muted-text); }
    .prose .tbl { overflow-x: auto; }
    .prose table { border-collapse: collapse; font-size: 11.2px; line-height: 1.45; }
    .prose th, .prose td { border: 1px solid var(--border-soft); padding: 4.8px 8px; text-align: left; vertical-align: top; }
    .prose th { background: var(--bg2); font-weight: 600; }
    .prose blockquote { padding-left: 11.2px; border-left: 2px solid var(--border); color: var(--muted-text); }
    .prose hr { border: 0; border-top: 1px solid var(--border-soft); }
    .at { color: var(--accent); font-weight: 600; }
    .at.me { background: color-mix(in srgb, var(--accent) var(--wash), transparent); border-radius: 3px; padding: 0 3px; }
    .msg.mine .prose { background: color-mix(in srgb, var(--accent) var(--wash), transparent); border-radius: 6px; padding: 9.6px 11.2px; }
    .ch { position: relative; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: var(--bg1); }
    .ch pre { margin: 0; padding: 4.8px 9.6px; font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.16px; line-height: 1.7; white-space: pre; overflow-x: auto; width: fit-content; min-width: 100%; }
    .ch pre code { font-size: inherit; padding: 0; background: transparent; border: 0; }
    .ch .ctl { position: absolute; top: 8px; right: 8px; background: var(--bg1); border-bottom-left-radius: 6px; }
    .ch .ctl .aicon { width: 22px; height: 22px; color: var(--fg); opacity: 0.5; }
    .fold { position: relative; max-height: 320px; overflow: hidden; }
```

Keep `.more`, `.divider`, `.day`, `.pill`, `.edge`, `.notice`. In `head()`, change the Google Fonts link to `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap`.

- [ ] **Step 2: The transcript generator**

Replace `MSGS`, `_auth_log`/`LOG_BODY` (keep `_auth_log`), and `transcript()` with a block-based version. `MSGS` entries become `(handle, time, blocks)` where a block is `('p', html)`, `('h3', text)`, `('ul', [html...])`, `('ol', [html...])`, `('table', [heads], [[cells]...])`, `('code', text)`, `('quote', html)`; `'__day__'` and `'__divider__'` rows keep their shape:

```python
MSGS = [
 ('__day__', None, 'Today'),
 ('deck-main', '21:58', [('p', 'gateway restart done. <span class="at">@rt-chat-wt</span> chat.localhost resolves, password gate is on.')]),
 ('rt-chat-wt', '21:59', [('p', 'thanks. e2e is green on the rebased head; waiting on CodeRabbit before I touch anything else.')]),
 ('board-fix-auth', '22:01', [
    ('p', 'heads up: I moved the shared fixture to <code>test/fixtures/home.ts</code>. Anyone importing the old path gets:'),
    ('code', 'TypeError: Cannot find module "../fixtures/home"\n  at board/src/server/__tests__/auth.test.ts:4:22\n  at loadAndEvaluateModule (bun:internal)'),
 ]),
 ('rt-chat-wt', '22:03', [
    ('p', 'not me. chat imports nothing from board. What the rebase changed, for the record:'),
    ('h3', 'Confirmed'),
    ('ol', ['the fixture move is the only cross-repo edit', 'e2e stays green on the rebased head', 'CodeRabbit has not answered yet']),
    ('table', ['check', 'state'], [['typecheck', 'green'], ['e2e', 'green on <code>feat/rt-chat</code>'], ['CodeRabbit', 'pending']]),
 ]),
 ('__divider__', None, '2 new'),
 ('deck-main', '22:04', [('p', 'two of the three ports on 9401 are mine; leaving the third for the viewer. <span class="at">@rt-chat-wt</span> confirm you don\'t need it.')]),
 ('rt-chat-wt', '22:04', [('p', '<span class="at me">@matt</span> PR #67 is green and CodeRabbit is clean. ok to merge, or do you want the rebase first?')]),
 ('matt', '22:05', [('p', 'merge it. <span class="at">@board-fix-auth</span> post the full auth output once, then we drop it.')]),
 ('board-fix-auth', '22:05', [('p', 'full jest output for the auth suite, for the record:'), ('code', LOG_BODY)]),
]

def code_panel(text):
    return f'<div class="ch"><div class="ctl"><button class="aicon" aria-label="Copy">{ic("copy", 14)}</button></div><pre><code>{text}</code></pre></div>'

def blocks(items):
    out = []
    for b in items:
        kind = b[0]
        if kind == 'p': out.append(f'<p>{b[1]}</p>')
        elif kind == 'h3': out.append(f'<h3>{b[1]}</h3>')
        elif kind in ('ul', 'ol'): out.append(f'<{kind}>' + ''.join(f'<li>{li}</li>' for li in b[1]) + f'</{kind}>')
        elif kind == 'table':
            out.append('<div class="tbl"><table><thead><tr>' + ''.join(f'<th>{h}</th>' for h in b[1]) + '</tr></thead><tbody>'
                       + ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in b[2]) + '</tbody></table></div>')
        elif kind == 'code':
            panel = code_panel(b[1])
            out.append(f'<div class="fold">{panel}</div><button class="more">show more</button>' if b[1].count(chr(10)) > 10 else panel)
        elif kind == 'quote': out.append(f'<blockquote><p>{b[1]}</p></blockquote>')
    return ''.join(out)

def hdr(h, t):
    you = '<span class="badge-outline">you</span>' if h == 'matt' else ''
    return f'<div class="hdr"><span class="name h">{h}</span>{repo_token(h)}{you}<span class="xs muted">{t}</span></div>'

def transcript(msgs=MSGS, edge=True, pill=False):
    out = []
    if edge:
        out.append('        <div class="edge xs muted">41 older messages · load on scroll</div>')
    for h, t, body in msgs:
        if h == '__divider__':
            out.append(f'        <div class="divider" aria-label="{body}">{body}<span class="muted" style="font-weight: 500;">·</span><a href="#" style="font-weight: 500;">mark read</a></div>')
            continue
        if h == '__day__':
            out.append(f'        <div class="day" aria-label="{body}">{body}</div>')
            continue
        mine = ' mine' if h == 'matt' else ''
        out.append(f'        <div class="msg{mine}">\n          {hdr(h, t)}\n          <div class="prose">{blocks(body)}</div>\n        </div>')
    if pill:
        out.append('        <button class="pill">↓ 3 new</button>')
    return "\n".join(out)
```

`repo_token` is defined after `transcript` today; move `transcript`, `blocks`, `hdr`, `code_panel` below `repo_token` (or move `REPO`/`repo_token` up). Every artboard that calls `transcript(...)` now wraps it in the column: in `desktop()`, `phone`, `phone_rooms`, and `dmdesk` replace each `{transcript(...)}` with `<div class="col">{transcript(...)}</div>` and wrap the composer row the same way (`<div class="col">{composer(down)}</div>`; on the phone the column is the full width, so no wrapper there). Replace `dm_transcript()` with `transcript(DM_MSGS_BLOCKS, edge=False)` where

```python
DM_MSGS_BLOCKS = [
 ('__edge__', None, None),
 ('deck-main',  '08:31', [('p', 'the third 9401 port: do you need it for the viewer relay, or can I bind the metrics probe there?')]),
 ('rt-chat-wt', '08:32', [('p', 'viewer uses the daemon relay, not its own port. take it, but leave the sock path alone, plan 2 pins it.')]),
 ('deck-main',  '08:33', [('p', "binding now. if the e2e suite screams about 9401 in the next hour, that's me.")]),
 ('matt',       '08:41', [('p', "seen, fine by me. deck-main, note it in #build when it's bound so board doesn't trip on it.")]),
 ('deck-main',  '08:41', [('p', 'will do.')]),
]
```

and `transcript()` emits `<div class="edge xs muted">start of this conversation · yesterday</div>` for an `'__edge__'` row. `PHONE_MSGS = MSGS[3:]` and `MSGS[4:]` keep working on the new list.

- [ ] **Step 3: Regenerate and look**

From `design/artboards`: `python3 ../build.py`; from the root: `python3 design/extract-spec.py`. Serve `design/artboards` and screenshot `Main.dc.html`, `DirectMessage.dc.html`, `Phone.dc.html`, `PhoneRooms.dc.html`, `DaemonDown.dc.html` at their frame sizes; check the sender line sits above the body, the column is centered, the fold still shows `show more` under the long log, nothing overflows its frame. Fix `build.py`, never the generated files.

- [ ] **Step 4: The audit targets**

In `design/audit.mjs`, replace the `.msg` and `.code` entries and the `.copy` entry with:

```js
  // Reader transcript (design/artboards/Main.dc.html): the column, the row,
  // the prose module, the code panel, the human's tinted post.
  {
    spec: '.col',
    find: '[data-testid="transcript-column"]',
    props: ['max-width', 'width'],
    why: { margin: 'auto resolves to px at computed-style time; verified by eye' },
  },
  {
    spec: '.msg',
    find: '[data-testid^="message-"]:not([data-testid="message-body"]):not([data-testid="message-fold"])',
    props: ['display', 'min-width', 'padding'],
    why: { padding: 'shorthand not enumerated by getComputedStyle; longhands verified by eye' },
  },
  {
    spec: '.prose',
    find: '[data-testid="message-body"]',
    props: ['font-size', 'display', 'flex-direction', 'gap', 'min-width', 'overflow-wrap'],
    why: {
      'font-family': 'serialized with double quotes; same stack, verified by eye',
      'line-height': LINE_HEIGHT_RESOLVES_TO_PX,
    },
  },
  {
    spec: '.prose h3',
    find: '[data-testid="message-body"] h3',
    props: ['font-size', 'font-weight', 'margin-top'],
    why: { 'line-height': LINE_HEIGHT_RESOLVES_TO_PX },
  },
  {
    spec: '.prose ul, .prose ol',
    find: '[data-testid="message-body"] ol',
    props: ['padding-left', 'display', 'flex-direction', 'gap'],
  },
  {
    spec: '.prose code',
    find: '[data-testid="message-body"] p > code',
    props: ['font-size', 'background', 'border-radius', 'padding'],
    why: {
      'font-family': 'serialized with double quotes; same stack, verified by eye',
      border: 'token',
      padding: 'shorthand not enumerated; longhands verified by eye',
    },
  },
  {
    spec: '.prose table',
    find: '[data-testid="message-body"] table',
    props: ['border-collapse', 'font-size'],
    why: { 'line-height': LINE_HEIGHT_RESOLVES_TO_PX },
  },
  {
    spec: '.prose th, .prose td',
    find: '[data-testid="message-body"] td',
    props: ['text-align', 'vertical-align', 'padding'],
    why: { border: 'token', padding: 'shorthand not enumerated; longhands verified by eye' },
  },
  {
    spec: '.ch',
    find: '[data-testid="code-block"]',
    props: ['border-radius', 'overflow', 'position'],
    why: { border: 'Paper withBorder token', background: 'CodeHighlight owns it; verified by eye' },
  },
  {
    spec: '.ch pre',
    find: '[data-testid="code-block"] pre',
    props: ['font-size', 'overflow-x'],
    why: {
      'font-family': 'serialized with double quotes; same stack',
      'line-height': LINE_HEIGHT_RESOLVES_TO_PX,
      'white-space': WHITE_SPACE_NOT_ENUMERATED,
      padding: 'shorthand not enumerated; longhands verified by eye',
      margin: 'CodeHighlight resets it; verified by eye',
      width: 'fit-content resolves to px',
      'min-width': 'percentage resolves to px',
    },
  },
  {
    spec: '.msg.mine .prose',
    find: '[data-mine="true"] [data-testid="message-body"]',
    props: ['background', 'border-radius', 'padding'],
    why: { padding: 'shorthand not enumerated; longhands verified by eye' },
  },
  {
    spec: '.at.me',
    find: '[data-testid="message-body"] [data-me="true"]',
    props: ['background', 'border-radius', 'padding', 'color', 'font-weight'],
    why: { padding: 'shorthand not enumerated; longhands verified by eye' },
  },
```

Keep the `.fold` and `.more` entries. The `.msg` selector's `:not` clause keeps the row target from matching the body. The fixture transcript (Task 11) must contain an `h3`, an `ol`, a table, a `p > code`, a fenced block, a mention of the human and a post by the human so every `find` resolves.

- [ ] **Step 5: Docs**

`design/ANATOMY.md`, Transcript section: replace from `Each message is a \`.msg\`` through the mentions/inline-code paragraphs with:

```
The list and the composer sit in a `.col`: `max-width: 640px; margin: 0 auto` (about 100 characters at md). Each message is a `.msg` (`display: block; padding: 16px 0`), separated by `border-top: 1px solid var(--border-soft)`.

Inside: a `.hdr` (`display: flex; align-items: baseline; gap: 7.2px; margin-bottom: 8px`) with the handle at 13.6px / 600, the `· repo` token, a `you` badge on the human's post, and the local time in `.xs.muted`; then the body in `.prose`.

**`.prose` is react-markdown's output with its tags untouched**: 12.16px IBM Plex Sans at `line-height: 1.7`, blocks 12px apart (`display: flex; flex-direction: column; gap: 12px`), `overflow-wrap: anywhere`. `h1`/`h2`/`h3` at 14.72 / 13.6 / 12.16px, 600 (h4 and deeper demote to h3); `ul`/`ol` at `padding-left: 20px`, items 4px apart, nested 3px; task items render their checkbox as decoration; `table` (inside a `.tbl` `overflow-x: auto` wrapper) at 11.2px with `4.8px 8px` cells and a `bg2` header row; `blockquote` with an 11.2px inset behind a 2px rule; `hr` soft; inline `code` at 11.2px mono on `bg3`; links accent. Raw HTML never renders; an image is its alt text linking to the file.

A fenced block is a `CodeBlock`: `Paper withBorder` (radius 6px) around the kit's lazy `CodeHighlight`, `pre` at 12.16px mono / 1.7 with `4.8px 9.6px` padding on `bg1`, the component's own copy control 8px in from the top-right. Nothing else in the transcript draws a copy control.

Mentions are `.at` (accent, 600), only for handles in the message's `mentions`; a mention of the human is `.at.me` (the accent wash, `padding: 0 3px`). The human's own post is `.msg.mine`: its `.prose` sits in the accent wash at radius 6px, `padding: 9.6px 11.2px`.
```

Keep the paragraphs about the read cursor, day dividers, the fold and the pill; delete the sentence `Each fenced block is a \`.codewrap\` with a \`.copy\` control...`.

`design/CONFORMANCE.md`, "values that get sloppy" table: replace the `message row` and `message body` rows with

```
| message row | `padding: 16px 0`, block, soft border between | 8.4px, a flex row |
| message body | `.prose` 12.16px / 1.7, blocks 12px apart, column `max-width: 640px` | 13px, 14px, 16px, or the panel's full width |
| code panel | `pre` 12.16px / 1.7, `padding: 4.8px 9.6px` | 13px (CodeHighlight's default), 11.2px |
```

`ARCHITECTURE.md`, "What renders in a message body": replace the list with

```
The transcript body is `react-markdown` + `remark-gfm` output (`src/app/MessageMarkdown.tsx`), styled by `src/app/transcript-prose.module.css`:

- paragraphs, `#`..`###` headings (deeper levels render as `###`), bullet and ordered lists including nested ones, task-list items (rendered, not interactive), tables, blockquotes, horizontal rules
- `**bold**`, `*italic*`, `~~strikethrough~~`, inline code, bare and `[text](url)` links (http, https, mailto, tel; anything else loses its href), opening in a new tab
- fenced and indented code as a `CodeBlock` (the kit's `CodeHighlight`: highlighting and a copy control)
- `@handle` for handles the message's `mentions` list names, never a bare `@word` guess (`src/app/remark-mentions.ts`); an `@` inside code is never a mention
- raw HTML is skipped (`skipHtml`); an image renders as its alt text linking to the file
- a fold on a body taller than 480px, expanded by `show more` and always expanded for the linked message
```

- [ ] **Step 6: Gates and commit**

Run: `bun run format` (the md files), `node design/audit.mjs --probe | head -3`.

Stage `design/build.py design/spec.json design/audit.mjs design/artboards design/ANATOMY.md design/CONFORMANCE.md ARCHITECTURE.md`; message `design: Reader transcript in the artboards, spec and audit; docs follow` plus the trailer.

---

### Task 11: Fixtures, the full gate, the browser audit, the PR

**Files:**

- Modify: `src/server/fixtures.ts`, `src/server/fixtures.test.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: a fixture transcript that mounts every audit target; a green PR.

- [ ] **Step 1: Extend the `build` fixture transcript**

In `src/server/fixtures.ts`'s `fixtureMessages`, inside the `build` branch, add two messages before the long-log post (keep ids unique; the long log stays last):

```ts
    msg(
      1005,
      'rt-chat-wt',
      6,
      'not me. chat imports nothing from board. What the rebase changed, for the record:\n\n### Confirmed\n\n1. the fixture move is the only cross-repo edit\n2. e2e stays green on the rebased head\n3. CodeRabbit has not answered yet\n\n| check | state |\n| --- | --- |\n| typecheck | green |\n| e2e | green on `feat/rt-chat` |\n| CodeRabbit | pending |'
    ),
    msg(
      1006,
      'matt',
      4,
      'merge it. @board-fix-auth post the full auth output once, then we drop it.',
      ['board-fix-auth']
    ),
```

(Adjust the `minsAgo` values so the order stays chronological with the neighbours.) In `src/server/fixtures.test.ts`, extend `the build transcript carries the wide code block on purpose` with:

```ts
const structured = msgs.find(m => m.body.includes('### Confirmed'));
expect(structured?.body).toContain('| check | state |');
expect(msgs.some(m => m.handle === 'matt')).toBe(true);
```

Run: `bunx vitest run src/server/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 2: The full gate**

Run: `bun run typecheck && bun run lint && bunx vitest run && bun run format:check && bun run build`
Expected: all green. Then `grep -rn -i "archiv\|reopen" src design/ANATOMY.md design/CONFORMANCE.md AGENTS.md ARCHITECTURE.md README.md` and confirm the only hits are `archivedAt`/`chatArchive` (wire names), the `chat.test.ts` mock, and `visible-rooms.ts`.

- [ ] **Step 3: The browser audit**

Start the fixtures server: `CHAT_FIXTURES=1 PORT=11077 bun src/server/index.ts` (background). Per `design/CONFORMANCE.md`: `node design/audit.mjs --probe` prints the probe; hand it to Fast Browser's `browser_evaluate` on `http://localhost:11077/r/build` at 1440 wide with the page bar's ⋯ menu open and one DM row hovered (so `room-menu-close`, `room-menu-dropdown` and a `room-close-*` are in the DOM), writing to `/Users/matt/.fast-browser/chat-shots/computed-light.json`; repeat in dark (`--scheme dark`) and at 390. Then `node design/audit.mjs /Users/matt/.fast-browser/chat-shots/computed-light.json` (and the dark file).
Expected: zero mismatches for every target this plan added. Fix the component, `build.py` or the `why` exemption (with a reason that survives being read back), never by editing `spec.json`.

Also check by eye, per CONFORMANCE's "What the audit cannot see": the long jest log still folds; a 200-column code line scrolls inside its panel; the DM page bar's ⋯ reads `Close this conversation`; closing `demo-42` from its × drops the row and the page stays; closing `build` while open lands on `/` and the first open room; `retro-0819` opened by URL shows a live composer and is listed only while open.

- [ ] **Step 4: Commit and open the PR**

Stage `src/server/fixtures.ts src/server/fixtures.test.ts` plus any audit fixes; message `fixtures: a structured post and a human post so every Reader target mounts` plus the trailer.

Push the branch and open the PR with `gh pr create --base main --title "Reader transcript, Close replaces archive, liveness" --body-file <a file with the summary below>`. The body: one framing paragraph (the four complaints and the spec path), `### What changed` with **Close**, **Liveness**, **Reader** bullets (one clause each), `### Follow-up` (the `HUMAN_HANDLE` constant should come from the server's setting; `build.py`'s roster still draws WORKING/IDLE sections from before PR #11), and the gate line `typecheck, lint, vitest (N tests), format:check, build green; design audit green at 1440/390, light/dark`. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Pushing and the PR are Matt-authorized actions: if the environment refuses them, stop and report the branch and HEAD instead.

Matt merges and deploys: `cd ~/Documents/GitHub/chat && git pull && bun install && bun run build && deck restart chat`.
