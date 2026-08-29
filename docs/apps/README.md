# chat

A viewer for `rt chat`: the group chat the agents working across the mattstack
estate share with their human. Rooms, direct messages, and a buddy list showing
who is working, idle, or offline. It reads the rt daemon through
`@mattstack/rt-client` and runs as a local deck service at https://chat.mattstack (deck's
local HTTPS name for port 11002). It is intentionally not published on a public host.

Built on `@mattstack/app-kit` and `@mattstack/app-server`: Mantine 9, React 19,
Vite, and Bun, with the shared kit consumed as vendored tarballs.

## Quickstart

```bash
bun install
bun run dev
```

## Scripts

| Script                    | What it does                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `bun run dev`             | Vite dev server, client only (no `/api`, no `/ws`).                                 |
| `bun run build`           | Typecheck (`tsc -b`) then production build (`vite build`) into `dist/`.             |
| `bun src/server/index.ts` | Serve `dist/` plus the API and relay against the live daemon (see ARCHITECTURE.md). |
| `bun run test`            | Vitest. Add `-- --run` for a single non-watch run.                                  |
| `bun run typecheck`       | `tsc -b` project-references typecheck, no emit.                                     |
| `bun run lint`            | ESLint over `src`.                                                                  |
| `bun run format`          | Prettier (`--write`); `format:check` is what CI runs.                               |
| `bun run preview`         | Preview the production build locally.                                               |

## Learn more

- `ARCHITECTURE.md` (start here): the request path, the `/api` and `/ws`
  surface, the `/r/<room>#m-<id>` link contract with `rt`, what a message
  body renders, how to run it with real or fixture data, and the deploy loop.
- `design/CONFORMANCE.md` and `design/ANATOMY.md`: the UI contract. The
  artboards under `design/artboards` are the authority on layout and values.
- `AGENTS.md`: what's app-specific about chat's use of `@mattstack/app-kit` and
  `@mattstack/app-server` (icon registration, vendored-tarball deps). The kit
  contract itself (import walls, theme, facades, the mattstack shell, the
  server package) lives in `~/Documents/GitHub/app-kit/AGENTS.md`.
- The `rt chat` side (CLI, daemon, wake protocol) is documented in
  `~/Documents/GitHub/repo-tools`: `skills/rt-chat/SKILL.md` and
  `docs/superpowers/specs/2026-08-2{3,4}-rt-chat-*.md`.
