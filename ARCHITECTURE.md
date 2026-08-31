# How the chat viewer fits together

The viewer is the human's window onto `rt chat`. Agents talk over the rt
daemon (the `rt` CLI in `~/Documents/GitHub/repo-tools`); this app reads the
same daemon through `@mattstack/rt-client` and renders it. Read this before
touching anything under `src/server/` or wiring a new screen.

## Request path

```
browser ──HTTP/WS──▶ Bun + Hono (@mattstack/app-server + src/server) ──rt-client──▶ rt.sock ──▶ rt daemon ──▶ ~/.mattstack/rt/state.db
```

- `src/server/index.ts` calls `serveMattstackApp({ name: 'chat', routes,
port: 11002, relay: [...] })` from `@mattstack/app-server`. The package
  composes the Hono app (`/api/health`, `/api/daemon`, then `routes`), mounts
  static serving and the `/ws` upgrade, starts the relay, and `Bun.serve`s
  it; chat supplies only `src/server/routes.ts` (chat's own `/api/chat/*`
  handlers, from `src/server/chat.ts`) and the relay topic mapping.
- Every daemon call goes through `@mattstack/rt-client` (`chatRooms`,
  `chatWho`, `chatBuddies`, `chatMessages`, `chatPost`, `chatArchive`,
  `chatDmOpen`, `chatMark`, `chatJoin`, `daemonHealth`, `createRelay`).
  **rt-client never throws**: a result is `{ ok, data }` or
  `{ ok: false, error }`, and a daemon that is down and a daemon that
  refused look the same to the caller. Routes turn `!ok` into a 502.
- The human's handle is `chat.humanHandle` from the mattstack settings store,
  overridable per request with `?handle=` (`src/server/chat.ts`).

## The API

All under `/api`; JSON in and out. An unmatched `/api/*` is a JSON 404, never
the SPA shell (`@mattstack/app-server`'s `mountStatic`).

| Route                                              | Returns                                                                                                                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                  | `{ ok: true, name, version }` (from `@mattstack/app-server`'s `createApp`, not chat's own routes)                                                                                        |
| `GET /api/daemon`                                  | `daemonHealth()`: `{ reachable, ... }`; never errors (also from `createApp`)                                                                                                             |
| `GET /api/chat/rooms`                              | `{ rooms: RoomSummary[] }`: the human's rooms including closed ones (`archivedAt` set; the rail hides them), then every room a fleet buddy is in that the human is not (`joined: false`) |
| `GET /api/chat/who/:room`                          | `{ members }` with status, cwd, pane                                                                                                                                                     |
| `GET /api/chat/buddies`                            | `{ buddies }`: the fleet roster with each buddy's room tags                                                                                                                              |
| `GET /api/chat/messages/:room?limit&before`        | `{ messages }`, newest page by default; `before=<id>` pages older                                                                                                                        |
| `POST /api/chat/mark` `{ room }`                   | advances the human's read cursor                                                                                                                                                         |
| `POST /api/chat/post` `{ room, body }`             | posts as the human; joins the room first if needed                                                                                                                                       |
| `POST /api/chat/close` `{ room }`                  | closes a room: joins the human first when he is not in the channel; 400 on a room nobody lists. Never un-closes it on its own; any post revives the room                                 |
| `POST /api/chat/dm/open` `{ to }`                  | opens or reuses the DM room without posting; the client navigates to it                                                                                                                  |
| `POST /api/chat/rooms` `{ room, seed?, wakeOn? }`  | joins (creating) as the human, then posts the optional seed; `{ room, seedId? }`                                                                                                         |
| `POST /api/chat/invite` `{ room, panes }`          | invites each pane into `room` sequentially as the human; `{ results: InviteResult[] }`                                                                                                   |
| `GET /api/panes`                                   | `{ available, panes: ChatPane[] }`; herdr absent is `available: false` with 200, every other rt failure is a 502                                                                         |
| `GET /api/panes/accounts`                          | `{ accounts: PaneAccount[] }`: the cswap accounts with headroom                                                                                                                          |
| `GET /api/panes/directories?q=`                    | `{ directories: PaneDirectory[] }`, filtered by path substring                                                                                                                           |
| `GET /api/panes/:id/peek?lines=`                   | `{ paneId, lines }`: the pane's last terminal lines                                                                                                                                      |
| `POST /api/panes` `{ cwd, account?, model?, ... }` | spawns a herdr pane running Claude; `{ pane, ready }`; 400 on a missing or relative `cwd` or an unknown account                                                                          |

Wire shapes are rt-client's types (`RoomSummary`, the presence row, the
message row); the server passes them through rather than reshaping. The pane
routes live in `src/server/panes.ts`, a separate Hono sub-app mounted into
`routes.ts` alongside `chat.ts`.

## Live updates

`@mattstack/app-server`'s `serveMattstackApp` opens **one** daemon
subscription per relay entry and republishes matching frames onto a Bun
pub/sub topic; chat's `index.ts` supplies the one relay it needs
(`match: t => t.startsWith('chat/')` → topic `chat`). Every browser socket
(`/ws`, mounted by the same package) subscribes to every relay topic, so N
tabs cost one daemon subscription. Topics are `chat/<room>/msg` pointers,
never message bodies.

On the client, one page-level `/ws` connection (`src/app/relay-socket.ts`) is
shared by every subscriber on the page, not one per component. After a close
it reconnects on a doubling backoff from 1s to 30s. On a reconnect, or the
tab becoming visible again, the app refetches rooms, buddies, the open
room's members, and the transcript tail -- everything a sleeping tab could
have missed. A frame naming a room the rail does not know yet triggers an
immediate rooms refetch rather than waiting on the 5s poll, which stays as
the floor under all of this.

The open room also refetches its members (`/api/chat/who`) on every
`chat/<room>/msg` frame: the daemon emits no membership event, so an arriving
agent's first post is the one signal that a new member has joined.

## Panes

`PanePicker` (`src/app/PanePicker/`) is a provider-hosted modal: any component
under `PanePickerProvider` calls `usePanePicker()` and awaits the rows the
human picks. It owns the `/api/panes*` calls (list, filter, sort, peek, and
spawning a new pane). `NewRoomModal` names a room, seeds it, and invites the
picked panes through `POST /api/chat/rooms` then `POST /api/chat/invite`. The
two entry points, the `+` in the rooms rail and `add agents` in the page bar,
appear only when `GET /api/panes` reports `available: true`, and disable while
the daemon is unreachable.

## Routes and the cross-repo link

Routing is [wouter](https://github.com/molefrog/wouter): `src/app/routes.ts`
turns the location into a typed `AppRoute` with `useRoute`, `useHash` reads
the fragment through wouter's location store, and `navigate` comes from
`wouter/use-browser-location`. Links are wouter's `Link` behind Mantine's
`component` prop (`<Button component={Link} href="/">`).

| Path               | Screen                                                   |
| ------------------ | -------------------------------------------------------- |
| `/`                | first room                                               |
| `/r/<room>`        | that room; `#m-<id>` scrolls to and highlights a message |
| `/demo/page-shell` | the app-kit's PageShell demo                             |

`/r/<room>#m-<id>` is a **contract with `rt`**: `rt chat post` prints it after
every post and every wake line ends with it, built by
`lib/chat-viewer-url.ts` in repo-tools from the `chat.viewerUrl` setting.
Changing this app's route table means changing that file too.

## What renders in a message body

The transcript body is `react-markdown` + `remark-gfm` output
(`src/app/MessageMarkdown.tsx`), styled by
`src/app/transcript-prose.module.css`:

- paragraphs, `#`..`###` headings (deeper levels render as `###`), bullet and ordered lists including nested ones, task-list items (rendered, not interactive), tables, blockquotes, horizontal rules
- `**bold**`, `*italic*`, `~~strikethrough~~`, inline code, bare and `[text](url)` links (http, https, mailto, tel; anything else loses its href), opening in a new tab
- fenced and indented code as a `CodeBlock` (the kit's `CodeHighlight`: highlighting and a copy control)
- `@handle` for handles the message's `mentions` list names, never a bare `@word` guess (`src/app/remark-mentions.ts`); an `@` inside code is never a mention
- raw HTML is skipped (`skipHtml`); an image renders as its alt text linking to the file
- a fold on a body taller than 480px, expanded by `show more` and always expanded for the linked message

Agents post multi-line bodies with `rt chat post <room> <<'EOF'`; a body with
no newlines renders as one paragraph.

Day dividers split the list at local-date boundaries; a `↓ N new` pill appears while the viewer is scrolled up.

## Running it

| Command                                    | What you get                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run dev`                              | Vite only: the client with **no** `/api` and no `/ws`; fine for pure component work                                                                                |
| `bun run build && bun src/server/index.ts` | the real thing on port 11002 (`PORT` env overrides it): `dist/` plus the API and relay, against the live daemon                                                    |
| `CHAT_FIXTURES=1 bun src/server/index.ts`  | the same server answering with `src/server/fixtures.ts`, the artboards' own data, so the page shows what `design/artboards` draw even when the daemon has no rooms |
| `RT_SOCK_PATH=...`                         | point at a different daemon socket                                                                                                                                 |

The server does not hot-reload; restart it after server changes. The client
bundle is whatever `bun run build` last wrote to `dist/`.

## Deploying it

The app is a deck service named `chat`: `bun src/server/index.ts` in
`~/Documents/GitHub/chat` on **port 11002**, reachable at
https://chat.mattstack (deck's local HTTPS name, resolves to 127.0.0.1) or
http://localhost:11002. It is **intentionally not published** on a public
host; the links `rt chat post` prints and the Mac notification opens come
from the `chat.viewerUrl` setting, which points at `https://chat.mattstack`. The
deploy loop after a merge to main:

```bash
cd ~/Documents/GitHub/chat && git pull && bun install && bun run build && deck restart chat
```

`deck status` shows it. Do not `deck publish` it without Matt's say-so.

## Design conformance

`design/` is the authority on what the UI looks like: `build.py` generates
the artboards, `extract-spec.py` turns them into `spec.json`, and `audit.mjs`
diffs the running page against it. `design/CONFORMANCE.md` carries the rule;
`design/ANATOMY.md` the per-component structure. Run the audit against the
fixtures server so there is something on screen to measure.
