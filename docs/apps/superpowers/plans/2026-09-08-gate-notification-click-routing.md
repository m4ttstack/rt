# Gate notification click routing (apps half)

Spec: the design agreed on 2026-09-08. A gate desktop notification's
default click focuses the herdr pane behind the gate; a notification
button opens the surface that owns the gate; `run:` gates notify as well
as `mr:` gates. This plan is the mattstack-apps half: the board and the
console install their own notify-bridge rules carrying a `url`, and each
surface can land on a gate from that url. The rt half (bridge `url`
support, tray button) is a separate plan in repo-tools; it ships first.

## Global Constraints

- Bridge rule shape (the daemon's `rt.notify.eventBridges` entries):
  `{ pattern, category, title, message, subjectPrefix?, url? }`, all
  strings. `{field}` placeholders interpolate from the `gate/opened`
  payload; `{id}` is the gate id, `{label}` the opener's label,
  `{question}` the first question's label.
- Board rule, exactly:
  `{ pattern: 'gate/opened/*', subjectPrefix: 'mr:', category: 'gate', title: '{label}', message: '{question}', url: '<boardUrl>/?gate={id}' }`.
- Console rule, exactly:
  `{ pattern: 'gate/opened/*', subjectPrefix: 'run:', category: 'gate', title: '{label}', message: '{question}', url: '<consoleUrl>/gates/{id}' }`.
- Rule identity for the upsert is `(pattern, subjectPrefix)`; a stored
  rule with the same identity but a different body is replaced in place;
  an identical one is left alone; other entries ride along untouched. A
  legacy `board/gate/opened/*` entry is removed when the board's rule is
  installed (today's behavior).
- `<boardUrl>` / `<consoleUrl>` come from deck: read `api.json` under
  deck's state dir (`apps/deck/src/api/state.ts` `stateDir()`, the
  `~/.mattstack/deck` tree), `GET http://127.0.0.1:<port>/api/v1/status`,
  find the row whose `name` is the app's deck name (`board` / `console`),
  take its `url` (the local `https://<name>.<tld>` form, NOT `publicUrl`,
  which is the tunnel address). Fall back to `http://localhost:<own port>`
  when deck is not running, the row is missing, or `url` is null. Never
  throw at boot over this.
- Read settings only through `getSetting` / `setSetting` from
  `@mattstack/rt-client` (the board's `readEventBridges` /
  `writeEventBridges` in `apps/board/src/server.ts` are the pattern).
- Do not edit `apps/board/src/client/board/gate-format.ts` or
  `apps/console/src/app/runs/gate-format.ts` (another branch, gate-kit,
  is moving them).
- `packages/server` edits follow `AGENTS.md` at the repo root (import
  walls, the subpath export table) and `packages/server/README.md`.
- Gates per app: `bun run board:test`, `bun run board:typecheck`,
  `bun run console:test`, `bun run console:typecheck`,
  `bun run console:lint`. `bun run tui-kit:build` once before any board
  typecheck. Root `bun test packages/server` for the shared package.
- Every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
  No em dashes anywhere in code, comments, or commit messages.

## Task 1: shared bridge-rule upsert and deck url lookup in `@mattstack/app-server`

Files: `packages/server/src/event-bridge.ts` (new),
`packages/server/src/event-bridge.test.ts` (new), `packages/server/package.json`
(exports), `packages/server/README.md` (subpath table row).

TDD.

1. `export interface EventBridgeRule { pattern: string; category: string; title: string; message: string; subjectPrefix?: string; url?: string }`.
2. `export function ensureEventBridgeRule(read: () => EventBridgeRule[], write: (next: EventBridgeRule[]) => void, rule: EventBridgeRule, opts?: { replacePatterns?: string[] }): void`
   with the identity and replace semantics from the Global Constraints;
   `replacePatterns` names legacy patterns to drop when installing (the
   board passes `['board/gate/opened/*']`). `write` is called only when the
   stored list changes.
3. `export async function deckAppUrl(name: string, fallback: string, opts?: { stateDir?: string; fetch?: typeof fetch }): Promise<string>`
   per the deck resolution in the Global Constraints. `opts.stateDir` and
   `opts.fetch` exist so tests can point at a temp dir and a fake fetch.
   Any failure (no `api.json`, fetch throws, non-200, row missing, `url`
   null) returns `fallback`.
4. Export both from a new subpath `./event-bridge`; add the row to the
   README subpath table.

Tests:

- `ensureEventBridgeRule`: appends when absent; no-op (write not called)
  when an identical rule exists; replaces in place when same identity,
  different body; leaves a rule with the same pattern but a different
  `subjectPrefix` alone and appends; drops `replacePatterns` entries.
- `deckAppUrl`: returns the row's `url` on the happy path (temp
  `api.json`, fake fetch returning `{ apps: [{ name, url }] }` in
  whatever shape `/api/status` really returns; read
  `apps/deck/src/api/status.ts` to match it); returns `fallback` when
  `api.json` is missing, when fetch throws, and when the row's `url` is
  null.

## Task 2: board installs its rule with a url, and upgrades a stale one

Files: `apps/board/src/gates/ingest.ts`, `apps/board/src/server.ts`,
`apps/board/src/__tests__/*` (the existing ingest/bridge tests).

1. Replace the board's local `EventBridgeRule` type and `ensureBridgeRule`
   with `ensureEventBridgeRule` from `@mattstack/app-server/event-bridge`.
2. `GATE_OPENED_BRIDGE_RULE` becomes a function of the board url:
   `boardBridgeRule(boardUrl: string): EventBridgeRule` returning the exact
   board rule from the Global Constraints.
3. At the boot site that calls `ensureBridgeRule` today, resolve the url
   with `deckAppUrl('board', \`http://localhost:${port}\`)` (the server's
   own `port`) and install `boardBridgeRule(url)` with
   `replacePatterns: ['board/gate/opened/*']`.
4. Update the existing tests to the new shape; add one asserting that a
   stored rule at the same identity with the old body (`message:
   '{subject}'`, no url) is replaced.

## Task 3: board deep link `?gate=<id>`

Files: `apps/board/src/client/board/deep-link.ts` (new, pure helpers),
`apps/board/src/__tests__/deep-link.test.ts` (new),
`apps/board/src/client/board/Board.tsx`, `apps/board/src/client/board/RowView.tsx`,
`apps/board/src/style.css`.

1. `deep-link.ts`: `gateParam(search: string): string | null` (reads
   `gate` from a query string) and
   `mrForGate(mrs: Array<{ iid: number; gates?: Array<{ gateId: string }> }>, gateId: string): number | null`
   (the iid whose gates carry the id, else null); and
   `stripGateParam(search: string): string` (the query string without
   `gate`, empty string when nothing is left).
2. `RowView.tsx`: each MR row root gets `data-mr-iid={mr.iid}`.
3. `Board.tsx`: on the first `onData` (the `validatedOnce` branch), if
   `gateParam(location.search)` names a gate and `mrForGate` finds a row,
   after that render `document.querySelector('[data-mr-iid="<iid>"]')`,
   `scrollIntoView({ block: 'center' })`, add class `tui-row-flash` for 2
   seconds, then `history.replaceState` with the stripped query so a
   refresh does not re-scroll. A gate no row carries does nothing.
4. `style.css`: `.tui-row-flash` is a brief outline highlight using the
   existing accent variable the file already uses for focus rings.
5. Tests for the three pure helpers.

## Task 4: console lands on a gate from `/gates/<id>`

Files: `apps/console/src/server/gates.ts`, `apps/console/src/server/gates.test.ts`,
`apps/console/src/app/routes.ts`, `apps/console/src/app/App.tsx` (or
wherever routes render), `apps/console/src/app/runs/RunDetail.tsx`,
`apps/console/src/app/runs/GateCard.tsx`, a new `apps/console/src/app/gates/GateRedirect.tsx`.

1. Server: `GET /api/gates/:id/locate` -> `200 { repo, runId }` or `404
   { error }`. Find the gate row by id (the same lookup the answer/focus
   routes use), require a `run:` subject, take `runId` from it, and find
   the run's repo by listing runs (`listRuns` from `@mattstack/rt-client`,
   as `/api/runs` does) and matching the id. Tests: found; gate missing;
   non-run subject; run not in any repo.
2. Client: route `/gates/:id` -> `{ name: 'gate', id }` in `routes.ts`;
   `GateRedirect` fetches locate, then navigates (replace) to
   `/runs/<repo>/<runId>?gate=<id>`, rendering a one-line error when
   locate fails.
3. `GateCard` root gets `data-gate-id={gate.id}`. `RunDetail`: when the
   location has `gate=<id>`, after the gates query resolves, scroll
   `[data-gate-id="<id>"]` into view (`block: 'center'`) once and strip
   the param with `history.replaceState`.
4. Existing route tests (`routes` / `App`) gain the new route case.

## Task 5: console installs its rule at boot

Files: `apps/console/src/server/index.ts` (boot), plus a small
`apps/console/src/server/event-bridge.ts` with its test.

1. `consoleBridgeRule(consoleUrl: string): EventBridgeRule` returning the
   exact console rule from the Global Constraints.
2. At boot, read `rt.notify.eventBridges` via `getSetting`, resolve
   `deckAppUrl('console', \`http://localhost:${port}\`)`, and
   `ensureEventBridgeRule` with `setSetting(..., 'user')` as the writer,
   mirroring the board's read/write pair. Wrap the whole step so a failure
   logs one line and never blocks boot.
3. Tests for `consoleBridgeRule` and for the boot step's upsert through
   fake read/write.
