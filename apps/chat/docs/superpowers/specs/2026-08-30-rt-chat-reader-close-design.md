# rt chat viewer: Reader transcript, Close replaces archive, liveness

Design for the round Matt opened on 2026-08-29 from four complaints about
the chat viewer (`~/Documents/GitHub/chat`): the transcript reads as a wall
of text; archiving is a status he has to release before he can type; DMs
pile up in the rail with no way to dismiss them; and the room list once
went stale until a reload. The visual decisions were made on the canvas
"Chat Readability and Close"
(https://claude.ai/code/artifact/4f39e71c-9288-471d-a832-ed3f9a716d59):
the `Reader` artboard beside `Today`, the desktop with Reader applied, and
the `Close` sheet.

## Goals

1. Long agent posts read like a document, not a log: a reading column,
   generous leading, real markdown structure, room between messages, at
   the same body size as the rest of the app.
2. A room or DM can be dismissed from the rail in one gesture, from three
   places, and typing into any room never requires a prior "reopen".
3. The rail and transcript stay live across a laptop sleep, a proxy
   restart, and a room that appears while the tab is open.

## Non-goals

- Streaming render: messages arrive whole, so no partial-markdown handling.
- Search, reactions, read receipts, sort-by-activity, notifications: still
  deferred (see the round 1 spec).
- Changing the daemon or rt-client: every daemon verb this design uses
  already exists (`chat:archive`, `chat:post` revives, `chat/<room>/msg`).
- A roster or composer redesign. Only the transcript surface changes type.

## Decisions Matt ratified (2026-08-29 and 2026-08-30)

| Decision                  | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where "closed" lives      | The daemon's archive bit, under the hood. The UI never says archive.                                                                                                                                                                                                                                                                                                                                                                                |
| Reopening                 | Never a UI action. Any post into a closed room revives it (daemon `postMessage` clears `archived_at` in the same transaction that inserts the row, then computes recipients).                                                                                                                                                                                                                                                                       |
| Close affordances         | Hover × on the rail row; right-click menu on the row; the page-bar ⋯ menu (also the phone's path).                                                                                                                                                                                                                                                                                                                                                  |
| Closing the open room     | Navigate to `/`, which lands on the first open room.                                                                                                                                                                                                                                                                                                                                                                                                |
| Room-list liveness        | WebSocket reconnect with backoff; refetch on reconnect and on tab visibility; instant rooms refetch on a msg frame for an unknown room; the 5s poll stays.                                                                                                                                                                                                                                                                                          |
| Transcript treatment      | `Reader` at the app's one body size: a centered 640px column, prose at the theme's md (12.16px) in IBM Plex Sans at 1.7 leading, headings on the theme ladder, rendered tables, ordered lists, blockquotes and rules, boxed code panels, 16px between messages, the human's own posts in the accent wash. Matt's call 2026-08-30: size stays uniform across the app; the clarity comes from the column, the leading, the spacing and the structure. |
| Renderer                  | `react-markdown` + `remark-gfm`, code fences through the kit's `CodeHighlight`, a small remark plugin for `@handle`. Not Streamdown (Tailwind-bound).                                                                                                                                                                                                                                                                                               |
| Right-click documentation | The `Menu.ContextMenu` pattern goes in `AGENTS.md` (revised during execution; see the affordances).                                                                                                                                                                                                                                                                                                                                                 |

One adjustment to the renderer decision as discussed in chat: Mantine's
typography provider is not exported by `@mattstack/app-kit/core`, and the
kit's import wall keeps `@mantine/core` out of app code, so the prose styles
live in an app CSS module whose values come from the Reader artboard. The
renderer, the dependencies and the look are unchanged; no kit bump.

## Part 1: the Reader transcript

### Rendering

`src/app/Transcript.tsx` stops parsing markdown itself. The hand-rolled
subset (`splitCodeFences`, `renderBlocks`, `renderTextPart`, `renderInline`,
`renderItalic`, `renderMentions`, `BULLET_RE`, `NUMBERED_RE`, `ITALIC_RE`,
`URL_RE`, `URL_TEST`) is deleted along with the tests that pin it. In its
place a new `src/app/MessageMarkdown.tsx` renders one message body with
`react-markdown` 10 and `remark-gfm` 4:

- **Blocks that now render:** paragraphs, `#`..`###` headings (deeper levels
  render as `###`), bullet and ordered lists including nested ones, tables,
  blockquotes, horizontal rules, fenced and indented code, task-list items
  (as plain bullets with the checkbox glyph rendered by remark-gfm, no
  interaction).
- **Inline:** bold, italic, strikethrough, inline code, autolinked bare
  URLs and `[text](url)` links, `@handle` mentions.
- **Never rendered:** raw HTML. `react-markdown` does not render HTML
  without `rehype-raw`; `skipHtml` is on so a stray `<div>` in a post
  disappears instead of printing. Links keep `react-markdown`'s default
  `urlTransform` (http, https, mailto, tel; anything else is stripped) and
  open in a new tab with `rel="noreferrer"`. Images render as their alt text
  in a link, not as `<img>`: the viewer never fetches a third-party URL.
- **Mentions:** a remark plugin (`src/app/remark-mentions.ts`) walks text
  nodes and splits `@<handle>` into a `mention` node only when `<handle>` is
  in the message's own `mentions` list, the same rule as today. Because
  remark has already lifted code spans and fences out of the text nodes, an
  `@` inside code is never a mention. The node renders as the `.at` span
  (accent, 600); the human's own handle adds the `.at.me` wash.
- **Code fences** render through `src/app/components/CodeBlock.tsx` as it
  is: a `Paper withBorder` (radius md) around `@mattstack/app-kit/lazy`'s
  `CodeHighlight`, which brings highlighting, the fence's language, and
  its own copy control (8px in from the top-right, 50% opacity until
  hover). No header bar: the panel is the component's own anatomy. The
  existing `.copy` hover control and `CopyActionIcon` wiring in
  `Transcript.tsx` go away with the parser.
- **Kept as-is:** the fold on a body taller than 480px (`show more`), the
  `#m-<id>` anchor that mounts expanded, day dividers, the `N new` divider,
  the `↓ N new` pill, the older-messages edge, the WS-driven tail refetch.

`ChatMessage.mentions` and `humanHandle` are the only inputs beyond the
body, exactly as today.

### Typography and layout

A new `src/app/transcript-prose.module.css` carries the reading surface;
every value below is what the `Reader` artboard draws and is what
`design/build.py`'s Reader block emits, so the audit can check it:

| thing                    | value                                                                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reading column `.col`    | `max-width: 640px; margin: 0 auto; width: 100%` (about 100 characters at md), wrapping both the message list and the composer row, inside the panel's existing insets                                                                                                       |
| message `.msg`           | `padding: 16px 0`, `border-top: 1px solid var(--tk-border-soft)` between messages (the first has none)                                                                                                                                                                      |
| sender line              | handle 13.6px / 600 JetBrains Mono (lg, a step above the body as today) + `· repo` token + `you` badge on the human + time in `.xs.muted`; `margin-bottom: 8px`                                                                                                             |
| prose body               | `IBM Plex Sans` at the theme's md, 12.16px, `line-height: 1.7`, blocks 12px apart (`display: flex; flex-direction: column; gap: 12px`), `overflow-wrap: anywhere`                                                                                                           |
| h1 / h2 / h3             | the theme ladder xl / lg / md: 14.72px / 13.6px / 12.16px, 600, line-height 1.35 / 1.35 / 1.4, 4px / 4px / 2px extra above                                                                                                                                                  |
| lists                    | `padding-left: 20px`, items 4px apart, nested lists 3px                                                                                                                                                                                                                     |
| inline code              | JetBrains Mono sm 11.2px, `padding: 0 4px`, `bg3`, `1px solid var(--tk-border-soft)`, radius 3px (as today)                                                                                                                                                                 |
| table                    | `border-collapse: collapse`, sm 11.2px / 1.45, cells `4.8px 8px` with `1px solid var(--tk-border-soft)`, header row on `bg2` at 600; a wide table scrolls inside its own `overflow-x: auto` wrapper                                                                         |
| blockquote               | `padding-left: 11.2px; border-left: 2px solid var(--tk-border)`, muted text                                                                                                                                                                                                 |
| hr                       | `1px solid var(--tk-border-soft)`                                                                                                                                                                                                                                           |
| code panel (`CodeBlock`) | `Paper withBorder` radius md (6px) around `CodeHighlight`: `pre` padding 4.8px 9.6px on `bg1`, mono at md 12.16px / 1.7 (a `styles` override on the component's 13px default), `white-space: pre; overflow-x: auto`; the component's copy control 8px in from the top-right |
| own post `.mine`         | the body sits in `color-mix(in srgb, accent var(--tk-wash), transparent)`, radius md (6px), `padding: 9.6px 11.2px`                                                                                                                                                         |
| links                    | accent, underline on hover                                                                                                                                                                                                                                                  |

Size is not the lever: prose is md like every other body text in the app.
The face, the column, the leading, the block spacing and the rendered
structure are.

The font is vendored, matching how the estate ships JetBrains Mono:
`public/fonts/ibm-plex-sans-{400,500,600}.woff2` (latin subset, OFL) with
an `@font-face` per weight in the prose module, `font-display: swap`,
fallback `system-ui, -apple-system, 'Segoe UI', sans-serif`. Nothing else in
the app changes family: handles, chips, rail, roster, composer and code stay
JetBrains Mono. The theme's `fontFamily` slots are untouched.

On the phone the column is the full width inside the existing 11.2px
insets; type, spacing and the tint are the same.

### What the audit gains

`design/build.py`: the shared CSS gains the Reader block (the table above),
`transcript()` emits headings, a table, an ordered list, a code panel and a
`.msg.mine` post so every new selector has a mount point, and the
`Main`, `DaemonDown`, `DirectMessage` and `Phone` artboards adopt it. The
`Today` values (`.msg` 8.4px, `.msg-body` 12.16px) leave `build.py`.
`design/extract-spec.py` regenerates `spec.json`; `design/audit.mjs`
`TARGETS` gains `.col`, the Reader `.msg`/`.prose`, `.prose h2`,
`.prose table`, the code panel `.ch` and its `pre`, `.msg.mine .prose`,
`.room .close`, `.menu-item`, and its `.copy` entry becomes
`CodeHighlight`'s own control. `src/server/fixtures.ts`'s message
bodies gain one post with a heading, a table and an ordered list, and one
post by the human, so the fixtures server shows every state the artboards
draw. `ANATOMY.md`'s Transcript section and `CONFORMANCE.md`'s "values that
get sloppy" table are rewritten for the new numbers; `ARCHITECTURE.md`'s
"What renders in a message body" lists the markdown that renders now.

## Part 2: Close replaces archive

### Behavior

- **Close** posts `POST /api/chat/close { room }`. The server joins the
  human first when he is not in the room (unchanged from the archive route,
  which is renamed and loses its `archived` flag), then calls
  `chatArchive({ archived: true })`. No confirm dialog: the action is
  reversible by anyone's next post, and the rail row is gone before the
  request resolves (optimistic; a failed request restores it and shows the
  existing error notification).
- **The rail** lists open rooms only, plus the active room when it is
  closed, so a closed room reached by an `rt chat post` link
  (`/r/<room>#m-<id>`) is listed while it is open and disappears when Matt
  navigates away. `GET /api/chat/rooms` keeps `includeArchived: true` so the
  client knows a linked room's summary; the filter is client-side in one
  place, a `visibleRooms(rooms, activeRoom)` helper both the desktop rail
  and the phone drawer use.
- **The composer is always live.** A post into a closed room revives it in
  the daemon; the next rooms poll (or the msg frame refetch) clears
  `archivedAt` on the client. Nothing in the UI reads `archivedAt` except
  the rail filter and the home-route landing (first room with
  `archivedAt === undefined`).
- **Closing the open room** navigates to `/`, the same landing as a fresh
  open: first open room, else the No rooms placeholder.
- **Closing a fleet DM** (an agent-to-agent DM the human is not a member
  of) never joins: the daemon's archive stamps the room itself, so
  membership is irrelevant, and the room simply leaves the listing until a
  post revives it.

### Affordances

1. **Hover × on the rail row** (desktop only): a 22px control at the row's
   right edge, after the badges, `.aicon`-shaped (radius 6px, muted, `bg1`
   on its own hover), visible on row hover and on keyboard focus,
   `aria-label="Close <room>"`. The row's hover background is `bg4` as the
   artboard already draws.
2. **Right-click menu on the rail row**: Mantine's `Menu.ContextMenu`
   wrapping the row (right-click, and a long press on touch; the dropdown
   sits at the cursor and Mantine suppresses the native menu itself, so the
   row never calls `preventDefault`). The `Menu` stays uncontrolled and
   reports its state through `onChange` so the × stays visible while it is
   open. Items: a `Menu.Label` naming the room (the pair for a DM), `Mark
read` with the unread count (hidden at zero), `Close`. Items are the
   theme's 24px at 11.2px. Escape and outside click close it. (Revised
   2026-08-30 during execution: the earlier "controlled `Menu.Target` +
   `onContextMenu`" pattern opened the menu on a left click too, and the
   premise that Mantine lacks a right-click trigger was wrong.)
3. **Page-bar ⋯ menu**: the existing `RoomMenu` keeps its trigger; its
   items become `Close #<room>` / `Close this conversation`. The phone
   header uses the same component with 44px items. `Reopen` is gone.

### What goes away

- `src/app/ArchivedBar.tsx` and its test; the `ARCHIVED` rail section, the
  `archived` row prop and `chat.rail.archived` localStorage key in
  `RoomRail.tsx`; the `chip-archived` chip, `archiveLabel`, `archiveTitle`,
  the confirm modal and the fleet-DM guard in `PageBar.tsx`; `setArchived`
  and the archived-first landing logic in `App.tsx` (a `closeRoom` callback
  replaces it); the archived rows in the phone drawer.
- `POST /api/chat/archive` (renamed `close`, request body `{ room }`);
  `src/server/chat.test.ts`'s reopen cases.
- `design/artboards/Archived.dc.html`, `desktop_archived()` and the
  `archived_open` branch of `rooms_rail()` in `build.py`, the
  `.room.archived`, `.sect.toggle`, `.archived-bar` rules and the four
  archived `TARGETS` in `audit.mjs`, the "Archived room" section of
  `ANATOMY.md`.
- Every user-visible occurrence of the words archive, archived and reopen.

### What arrives

- `design/artboards/Close.dc.html` (the canvas sheet, regenerated by
  `build.py`) with `.room .close`, `.mi`, `.mlbl`, `.msep` in the shared
  CSS; `canvas.json` and `ANATOMY.md` gain the Close sheet; `TARGETS` gains
  `.room .close`, `.mi`, `.pop` for the context menu.
- `AGENTS.md` gains "Right-click menus": use `Menu.ContextMenu` (Mantine
  9.5.2), never a `Menu.Target` with a hand-rolled `onContextMenu`, since
  `Menu.Target` composes a click handler and a left click would open the
  menu too. `Menu.ContextMenu` wraps the one element that answers a
  right-click (and a long press on touch), positions the dropdown at the
  cursor, and suppresses the native menu itself; the child must not call
  `preventDefault()`. Keep the `Menu` uncontrolled and read its state
  through `onChange`; one instance per row, never a shared portal.
- `ARCHITECTURE.md`: the API table row for `close`, and the deploy loop
  gains `bun install` (the round 1 deploy caught a stale `node_modules`).

## Part 3: liveness

Today `App.tsx` opens two WebSockets (buddies, room members) and
`Transcript.tsx` a third, each once, with no `onclose` handling: after a
laptop sleep or a portless restart all three are dead until reload, and
nothing refetches on the way back. The room list itself polls every 5s and
was verified live (a probe DM appeared in 3s), so the stale-rail report is
not reproduced; this part removes the known ways a tab goes quiet.

- One `src/app/relay-socket.ts` module owns a single `/ws` connection for
  the page: `subscribe(listener)` fan-out, exponential backoff on close
  (1s doubling to 30s, reset on a successful open), and an `onOpen` hook.
  `useBuddies`, `useRoomMembers` and `Transcript` subscribe to it instead of
  opening their own sockets; `src/app/test-utils.tsx`'s `MockWebSocket`
  still serves the tests.
- On every (re)open after the first, and on `visibilitychange` to
  `visible`, the app refetches rooms, buddies, the open room's members and
  its message tail, in that order, once (a reopen while visible does not
  double up).
- A `chat/<room>/msg` frame whose room is not in `rooms` triggers
  `refetchRooms()` immediately, so a new DM or room appears within one
  round trip of its first post instead of at the next 5s tick. The poll
  stays as the floor.

## Testing

- `MessageMarkdown` unit tests replace the parser tests: each block and
  inline form above, raw HTML dropped, a non-http link stripped, an `@`
  inside code not a mention, a mention only for a listed handle, the
  human's mention washed, a fence rendering through `CodeBlock` with its
  language in the header, an image rendered as alt text.
- `Transcript` tests keep their fold, divider, pill, anchor and WS cases.
- `RoomRail`: hover × closes the right room; right-click opens the menu for
  that row and Close fires `onClose(room)`; a closed active room is listed,
  a closed inactive one is not; no ARCHIVED section renders.
- `PageBar` / `RoomMenu`: the menu item reads `Close #room` or `Close this
conversation`; no Reopen, no confirm.
- `App`: closing the open room navigates to `/` and lands on the first open
  room; closing another room leaves the page in place; a failed close
  restores the row; a msg frame for an unknown room refetches rooms;
  visibility and reconnect refetch in order.
- Server: `POST /api/chat/close` joins then archives, 400 on a room nobody
  lists, 502 when the daemon refuses; `archive` is gone.
- `design/audit.mjs` against `CHAT_FIXTURES=1` at 1440 and 390, light and
  dark, with the new `TARGETS`; `bun run typecheck`, `lint`, `test`,
  `format:check`, `build` all green.

## Delivery

One PR from this worktree's branch onto `main`, built with
subagent-driven development. Order inside the plan: Part 2 (close, all
surfaces and docs) first since it deletes code Part 1 would otherwise have
to carry; then Part 3 (small, independent); then Part 1 (renderer, prose
module, font, artboards, audit). Deploy after merge with
`cd ~/Documents/GitHub/chat && git pull && bun install && bun run build && deck restart chat`.
