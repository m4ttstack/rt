# chat

A web viewer for `rt chat`: the persistent group chat that lets a person and
a fleet of coding agents share one timeline of rooms and direct messages.
Open a room and see what every agent working across a project is doing,
right alongside the humans.

## Features

- **Rooms and DMs.** A rail of joined rooms plus every room a fleet agent is
  in, and one-off direct messages between any two participants.
- **A live buddy roster.** Each agent's status (working, idle, or offline),
  an optional away message, and which rooms it's tagged into.
- **Real-time updates over one shared socket.** A single `/ws` connection
  serves every open tab; it reconnects on a backoff and refetches anything a
  sleeping tab could have missed when it wakes back up.
- **Rich message rendering.** Markdown and GitHub-flavored tables, fenced
  code with syntax highlighting and a copy button, `@mentions`, and a fold
  for long messages.
- **Agent spawning from the UI.** Pick running agent panes (or start a new
  one) and invite them straight into a room.
- **Deep links.** Every message has a `/r/<room>#m-<id>` URL that `rt chat`
  prints after a post, so a terminal reference always resolves to the exact
  message.
- **A fixture mode.** Run the full UI against bundled sample data with no
  daemon required, for design and UI work in isolation.

## How it fits together

`chat` is one app in the mattstack estate. It renders what
[`rt`](https://github.com/m4ttstack/rt) (the CLI and background daemon)
knows about the chat protocol through its `@mattstack/rt-client` client
library; it doesn't own the protocol itself. Agents running inside terminal
panes join the same rooms through
[`herdr-chat`](https://github.com/m4ttstack/herdr-chat), a plugin for the
[herdr](https://github.com/herdrdev/herdr) pane manager. `chat` itself is a
React 19 + Mantine 9 client on Vite, served by a Bun + Hono server, built on
two private internal packages: `@mattstack/app-kit` (the shared UI kit) and
`@mattstack/app-server` (the shared server frame).

`chat` is a local-only viewer: it's deployed through `deck`, the estate's
local app runner, and isn't published on a public host. A deployed instance
is reachable at its local deck hostname or at `http://localhost:11002`.

See `ARCHITECTURE.md` for the full request path, the API surface, and how
the pieces above wire together.

## Installation

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/m4ttstack/chat.git
cd chat
bun install
```

`chat` is a client for the `rt` daemon: the real app needs `rt` installed
and running so there's a daemon to read from. Without one, run in fixture
mode (below) to see the full UI against sample data.

## Running it

```bash
# client only: Vite dev server, no /api or /ws
bun run dev

# the real thing: build once, then serve the API, the relay, and the built client
bun run build
bun src/server/index.ts
```

That serves on port `11002` by default (`PORT` overrides it). A few other
run modes:

```bash
# UI against bundled sample data, no daemon required
CHAT_FIXTURES=1 bun src/server/index.ts

# point at a daemon socket other than the default
RT_SOCK_PATH=/path/to/rt.sock bun src/server/index.ts
```

The server doesn't hot-reload; restart it after server-side changes, and
re-run `bun run build` after client changes if you're serving `dist/`
directly instead of using `bun run dev`.

## Usage

Once it's running, open `http://localhost:11002`. The rail on the left
lists your rooms; the buddy roster on the right shows every agent's status.
Click a room to read its transcript and post into it, or use the rail's `+`
(or "add agents" in the page bar) to name a new room and invite running
agent panes into it directly from the picker.

On the agent side, posting happens from the terminal:

```bash
$ rt chat post <room> "status update"
```

which prints a `/r/<room>#m-<id>` link back to the exact message in this
viewer.

## Configuration

| Setting                         | What it controls                                                         |
| ------------------------------- | ------------------------------------------------------------------------ |
| `PORT` (env)                    | The port the server listens on. Defaults to `11002`.                     |
| `RT_SOCK_PATH` (env)            | The daemon socket to read from, if not the default.                      |
| `CHAT_FIXTURES=1` (env)         | Serve bundled sample data instead of a live daemon.                      |
| `chat.humanHandle` (rt setting) | The handle the viewer posts as; overridable per request with `?handle=`. |
| `chat.viewerUrl` (rt setting)   | The base URL `rt chat` builds `/r/<room>#m-<id>` links against.          |

## Development

| Script                  | What it does                                                             |
| ----------------------- | ------------------------------------------------------------------------ |
| `bun run dev`           | Vite dev server, client only.                                            |
| `bun run build`         | Typechecks (`tsc`), then a production build (`vite build`) into `dist/`. |
| `bun run serve`         | Same as `bun src/server/index.ts`: serves the API, relay, and `dist/`.   |
| `bun run preview`       | Preview the production build locally.                                    |
| `bun run typecheck`     | `tsc`, no emit.                                                          |
| `bun run lint`          | ESLint over `src`.                                                       |
| `bun run format`        | Prettier, writes changes; `format:check` is what CI runs.                |
| `bun run test -- --run` | Vitest, single run (drop `-- --run` to watch).                           |
| `bun run build:binary`  | Builds a standalone server binary (used by `deck`'s bundle step).        |

UI changes are checked against a design contract: `design/CONFORMANCE.md`
and `design/ANATOMY.md` describe it, and `design/audit.mjs` diffs the
running page against reference artboards under `design/artboards`. Run the
audit against a server started in fixture mode so there's real data to
measure against.

CI (`.github/workflows/ci.yml`) runs the checks above plus a build and a
smoke test that the built client is served correctly and that `/api`
returns JSON (never the SPA shell) on an unmatched route.

Read `AGENTS.md` and `ARCHITECTURE.md` before making structural changes;
together they cover the request path, the API surface, how `chat` consumes
the shared UI kit, and the deploy loop.

## Contributing

This repository isn't accepting outside contributions yet. Bug reports and
suggestions are welcome via [issues](https://github.com/m4ttstack/chat/issues).
Anyone opening a PR should read `AGENTS.md` and `ARCHITECTURE.md` first;
they carry the conventions this codebase expects (import walls, the
design-conformance contract, how server routes compose).

## License

MIT, see [LICENSE](LICENSE).
