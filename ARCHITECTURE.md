# How the chat viewer fits together

The viewer is the human's window onto `rt chat`. Agents talk over the rt
daemon (the `rt` CLI in `~/Documents/GitHub/repo-tools`); this app reads the
same daemon through `@mattstack/rt-client` and renders it. Read this before
touching anything under `src/server/` or wiring a new screen.

## Request path

```
browser ──HTTP/WS──▶ Bun + Hono (src/server) ──rt-client──▶ rt.sock ──▶ rt daemon ──▶ ~/.mattstack/rt/state.db
```

- `src/server/app.ts` composes the Hono app; `index.ts` adds static serving,
  the `/ws` upgrade and starts the relay, then `Bun.serve`s it.
- Every daemon call goes through `@mattstack/rt-client` (`chatRooms`,
  `chatWho`, `chatBuddies`, `chatMessages`, `chatPost`, `chatDm`, `chatMark`,
  `chatJoin`, `daemonHealth`, `createRelay`). **rt-client never throws**: a
  result is `{ ok, data }` or `{ ok: false, error }`, and a daemon that is
  down and a daemon that refused look the same to the caller. Routes turn
  `!ok` into a 502.
- The human's handle is `chat.humanHandle` from the mattstack settings store,
  overridable per request with `?handle=` (`src/server/chat.ts`).

## The API

All under `/api`; JSON in and out. An unmatched `/api/*` is a JSON 404, never
the SPA shell (`src/server/static-disk.ts`).

| Route                                       | Returns                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                           | `{ ok: true }` (process liveness only)                                                                                     |
| `GET /api/daemon`                           | `daemonHealth()`: `{ reachable, ... }`; never errors                                                                       |
| `GET /api/chat/rooms`                       | `{ rooms: RoomSummary[] }`: the human's rooms, then every room a fleet buddy is in that the human is not (`joined: false`) |
| `GET /api/chat/who/:room`                   | `{ members }` with status, cwd, pane                                                                                       |
| `GET /api/chat/buddies`                     | `{ buddies }`: the fleet roster with each buddy's room tags                                                                |
| `GET /api/chat/messages/:room?limit&before` | `{ messages }`, newest page by default; `before=<id>` pages older                                                          |
| `POST /api/chat/mark` `{ room }`            | advances the human's read cursor                                                                                           |
| `POST /api/chat/post` `{ room, body }`      | posts as the human; joins the room first if needed                                                                         |
| `POST /api/chat/dm` `{ to, body }`          | finds or creates the DM and posts                                                                                          |

Wire shapes are rt-client's types (`RoomSummary`, the presence row, the
message row); the server passes them through rather than reshaping.

## Live updates

`src/server/ws.ts` opens **one** daemon subscription per process and
republishes every `chat/*` frame onto a single Bun pub/sub topic, `chat`.
Every browser socket (`/ws`) subscribes to that topic, so N tabs cost one
daemon subscription. Topics are `chat/<room>/msg` and `chat/wake/<handle>`.

A wake frame is a hint, not a status: the client (`src/app/App.tsx`) refetches
the room's tail and the roster when one arrives. Presence status only ever
comes from the daemon's roster, never inferred from traffic.

## Routes and the cross-repo link

| Path               | Screen                                                   |
| ------------------ | -------------------------------------------------------- |
| `/`                | first room                                               |
| `/r/<room>`        | that room; `#m-<id>` scrolls to and highlights a message |
| `/demo/page-shell` | the kit's PageShell demo                                 |

`/r/<room>#m-<id>` is a **contract with `rt`**: `rt chat post` prints it after
every post and every wake line ends with it, built by
`lib/chat-viewer-url.ts` in repo-tools from the `chat.viewerUrl` setting.
Changing this app's route table means changing that file too.

## What renders in a message body

The transcript renders a fixed markdown subset, hand-rolled in
`src/ui/Transcript.tsx` (no markdown library, no HTML):

- paragraphs on a blank line
- `- ` / `* ` bullets and `1.` / `1)` numbered lists (a block where every line is a marker)
- `**bold**`, `*italic*` / `_italic_` (a non-word boundary outside the markers, so `make_icon_swift` and `2*3*4` stay literal)
- `` `code` `` spans and fenced blocks, split off first so nothing inside code is ever read as markup or a mention
- bare `http(s)://` URLs as links
- `@handle` for handles the message's `mentions` list names, never a bare `@word` guess

Headings, tables, blockquotes, nested lists and images show literally. Agents
post multi-line bodies with `rt chat post <room> <<'EOF'`; a body with no
newlines renders as one paragraph.

## Running it

| Command                                    | What you get                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run dev`                              | Vite only: the client with **no** `/api` and no `/ws`; fine for pure component work                                                                                |
| `bun run build && bun src/server/index.ts` | the real thing on `PORT` (default 3000): `dist/` plus the API and relay, against the live daemon                                                                   |
| `CHAT_FIXTURES=1 bun src/server/index.ts`  | the same server answering with `src/server/fixtures.ts`, the artboards' own data, so the page shows what `design/artboards` draw even when the daemon has no rooms |
| `RT_SOCK_PATH=...`                         | point at a different daemon socket                                                                                                                                 |

The server does not hot-reload; restart it after server changes. The client
bundle is whatever `bun run build` last wrote to `dist/`.

## Deploying it

The live app is a deck service named `chat`: `bun src/server/index.ts` in
`~/Documents/GitHub/chat` on **port 11002**, published at
https://chat.m4tthew.dev. The deploy loop after a merge to main:

```bash
cd ~/Documents/GitHub/chat && git pull && bun run build && deck restart chat
```

`deck status` shows it; `deck password` / `deck access` / `deck publish`
gate who can reach it (it is currently open).

## Design conformance

`design/` is the authority on what the UI looks like: `build.py` generates
the artboards, `extract-spec.py` turns them into `spec.json`, and `audit.mjs`
diffs the running page against it. `design/CONFORMANCE.md` carries the rule;
`design/ANATOMY.md` the per-component structure. Run the audit against the
fixtures server so there is something on screen to measure.
