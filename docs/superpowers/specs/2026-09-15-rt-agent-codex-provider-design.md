# rt agent: codex provider, --yolo, and console-editable defaults

Status: approved for planning
Repos touched: repo-tools (this repo), packages/settings-kit (this repo), mattstack-apps/apps/console

## Motivation

`rt agent` hands a prompt to a Claude Code agent (herdr pane or headless) and
records the handoff. Two gaps:

1. It is hard-coded to the `claude` CLI (and `cswap` for account switching).
   `AgentRecord.provider` already exists as a column but is always written as
   the literal string `"claude"` — no dispatch on it anywhere.
2. There is no way to bypass permission prompts (`--dangerously-skip-permissions`
   for claude) short of the escape-hatch `--extra-args`.

Settings-backed defaults already exist for `agent.model` / `agent.effort` /
`agent.account` / `agent.extraArgs` (scopes `user`/`machine`, no defaults —
unset omits the flag), read in `lib/daemon/handlers/agent.ts` via
`fromSetting()`. Nothing currently exposes these in a UI; they are `rt
settings set` only. All four are unset today (verified via `rt settings get`),
so renaming them costs nothing.

This spec adds:
- A `codex` provider alongside `claude`.
- A `--yolo` flag (start-time only) that maps to each provider's real bypass
  flag.
- Provider-scoped settings (`agent.provider`, `agent.claude.*`,
  `agent.codex.*`) so an operator can change the default agent/model/yolo in
  one place and every future `rt agent start` picks it up with no code
  change.
- A real "Agent defaults" settings page in console, including model-picker
  suggestions per provider.

## Provider abstraction (repo-tools)

Split `lib/agent-argv.ts` into `lib/agent-argv/`:

- `types.ts` — `export type AgentProvider = "claude" | "codex"` and one shared
  `AgentInvocation` interface: `model?`, `effort?`, `extraArgs?`, `session`
  (`{kind:"start",sessionId}|{kind:"resume",sessionId}`), `headless`,
  `prompt?`, `env?`, `yolo?` are common; `account?`, `name?`, `settingsPath?`
  stay optional-only-for-claude fields on the same type (simpler than two
  disjoint types — the daemon handler builds one object without branching on
  provider).
- `claude.ts` — today's `lib/agent-argv.ts` content verbatim (functions,
  comments, invariants unchanged), plus: `if (inv.yolo) args.push
  ("--dangerously-skip-permissions")` in `claudeArgs`.
- `codex.ts` — new (see below).
- `index.ts` — re-exports everything from both (so existing imports of
  `buildClaudeArgv`, `buildPaneCommand`, `ClaudeInvocation`,
  `CROSS_SESSION_INBOUND_SETTINGS` keep working unchanged), plus two
  dispatchers:
  - `buildAgentArgv(provider: AgentProvider, inv: AgentInvocation, bins?): string[]`
  - `buildAgentPaneCommand(provider: AgentProvider, cwd: string, inv: AgentInvocation): string`

  `lib/daemon/handlers/agent.ts` calls the dispatchers instead of the
  claude-specific builders directly.

### Codex argv mapping

Confirmed against the installed `codex` CLI (`codex-cli 0.153.4`) directly —
not from memory:

| Concept | claude | codex |
|---|---|---|
| headless start | `claude -p --output-format json [flags] <prompt>` | `codex exec --json [flags] <prompt>` |
| headless resume | `claude -p --output-format json [flags] --resume <id> <prompt>` | `codex exec resume <id> [flags] <prompt>` |
| herdr start | `claude [flags] <prompt>` | `codex [flags] <prompt>` |
| herdr resume | `claude [flags] --resume <id> <prompt>` | `codex resume <id> [flags] <prompt>` |
| model | `--model <alias\|full-name>` | `-m <slug>` |
| effort | `--effort <level>` | `-c model_reasoning_effort=<level>` (config override; no dedicated flag) |
| yolo | `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` |
| account switch | `cswap run <account> -- claude ...` | not supported (see Non-goals) |

`resolveCodexBin()` mirrors `resolveClaudeBin()` (`Bun.which("codex")` falling
back to `~/.local/bin/codex`).

### Session identity (the one real wrinkle)

Claude lets rt mint the session UUID up front (`--session-id <uuid>`) before
spawning. Codex always mints its own and never accepts an externally chosen
one — verified against `codex exec --help`, `codex resume --help`, and the
open (unimplemented) GitHub feature request
[openai/codex#14482](https://github.com/openai/codex/issues/14482) for
`--name`-at-start, which confirms this isn't a flag we're just missing.

Codex reveals its session id in two ways rt can use:

- **Headless**: `codex exec --json` emits a JSONL event stream containing a
  `session_id` field (confirmed via `codex exec --help`'s `resume` argument
  description — "Session id (UUID) or thread name" — and third-party docs of
  the `--json` output shape; the exact event type carrying it must be
  confirmed empirically during implementation against a real run before this
  ships).
- **herdr (interactive pane)**: herdr already has a first-class codex
  integration. `~/.codex/hooks.json` (installed by `herdr integration install
  codex`, confirmed present on this machine, `HERDR_INTEGRATION_VERSION=8`)
  registers a `SessionStart` hook
  (`~/.codex/herdr-agent-state.sh session`) that reports the real session id
  to herdr over its control socket via `pane.report_agent_session`. `herdr
  agent get <paneId>` is expected to surface it back out (exact JSON field
  name to confirm empirically during implementation — `herdr pane
  report-agent-session --agent-session-id <ID>` is the write side, confirmed
  via `herdr pane report-agent-session --help`).

Design:

- `rec.sessionId` is still minted by rt at insert time for both providers (DB
  row needs an id before the process spawns, per the existing invariant that
  insert precedes launch). For codex this placeholder is **never passed to
  codex** on start.
- **Headless codex start**: `spawnHeadless`'s stdout capture (currently:
  buffer everything, write to `resultPath` on exit) gets teed — one branch
  keeps that behavior, the other parses lines as they arrive looking for the
  session id event. Once found, a new store function
  `updateAgentSessionId(id, sessionId, db)` (`lib/state/agents-store.ts`)
  overwrites the placeholder so a later `rt agent resume` uses
  `codex exec resume <real-id>`.
- **herdr codex start**: after `launchInWorkspace` returns a pane, poll
  `herdr agent get <paneId>` (same retry/timeout shape as the existing
  `herdrAgentWait` in `lib/agent-herdr.ts`) until the session id field
  appears, then `updateAgentSessionId`. On timeout, log a warning and leave
  the placeholder — a subsequent `rt agent resume` against it will fail with
  codex's own "no such session" error (not a silent wrong-session resume);
  the error path should suggest running `herdr integration install codex` if
  the integration looks absent.
- **Resume** (both surfaces) uses the by-then-real `rec.sessionId` exactly
  like claude does today — no special-casing needed once the id is captured.

### Non-goals for v1

- **cswap-style multi-account for codex.** codex has no equivalent concept
  exposed by its CLI; `agent.codex.account` does not exist as a setting.
  Passing `--account` with `--provider codex` is a validation error, not a
  silent no-op.
- **Claude's `--settings` hook injection (AskUserQuestion gate fork) for
  codex.** Codex has its own hooks mechanism (see above) but wiring rt's
  gate-fork hook through it is out of scope here; codex launches simply don't
  get that hook.
- **Claude's `--name` chat-handle reservation for codex.** No codex
  equivalent; codex records never get a `handle`.

## Settings (registry-defs.ts)

Replace the existing flat rows with provider-scoped ones (scopes
`user`/`machine`, `merge: "replace"`, no defaults except `agent.provider` —
consistent with the existing "no defaults, unset omits the flag" convention
for everything except the provider switch itself, which needs a concrete
fallback to preserve today's claude-only behavior with zero code changes):

```
agent.provider          string   default: "claude"
agent.claude.model      string
agent.claude.effort     string
agent.claude.account    string
agent.claude.extraArgs  string
agent.claude.yolo       boolean
agent.codex.model       string
agent.codex.effort      string
agent.codex.extraArgs   string
agent.codex.yolo        boolean
```

(No `agent.codex.account` — see Non-goals.)

## CLI + daemon wiring (repo-tools)

- `commands/agent.ts`: add `--provider <claude|codex>` to
  `FLAGS_WITH_VALUES`/`parseStartArgs`; add `--yolo` as a boolean flag (same
  pattern as `--bg`). Both are start-only — `rt agent resume` reuses the
  stored record's `provider`/`yolo`, exactly like it already reuses
  `model`/`effort`/`account` today (resume never re-reads settings).
- `lib/daemon/handlers/agent.ts` (`agent:start`):
  - `const provider = payload.provider ?? fromSetting("agent.provider") ?? "claude"`,
    validated against `AgentProvider`.
  - `model`/`effort`/`extraArgs`/`yolo` resolved from
    `agent.<provider>.<field>` (was flat `agent.<field>`).
  - `account` resolved from `agent.claude.account` only when
    `provider === "claude"`; an explicit `payload.account` with
    `provider === "codex"` is rejected.
  - `rec.provider = provider` (replaces the hard-coded `"claude"` literal).
  - `rec.yolo = yolo` (new `AgentRecord`/DB column, mirrors how
    `model`/`effort` are already stored).
  - `buildClaudeArgv`/`buildPaneCommand` calls replaced with
    `buildAgentArgv(provider, inv)` / `buildAgentPaneCommand(provider, cwd, inv)`.
  - Session-id capture wiring per the "Session identity" section above.
- `lib/state/agents-store.ts`: add `yolo` column + field; add
  `updateAgentSessionId(id, sessionId, db)`.

## Shared settings-shape extraction (packages/settings-kit)

`mattstack-apps/apps/board/src/client/board/ConfigModal.tsx` is already a
generic, registry-driven, prefix-scoped settings editor
(`useSettingsScope('board.')` from `@mattstack/settings-kit/react`, which is
pure `fetch`-based and has zero UI-framework dependency). Its logic layer,
`config-shapes.ts`, is also UI-agnostic (only imports
`SettingDefWire` and one board-specific constant) — `filterDefs`,
`groupByScope`, `rowKind`, `matchesShape`, `parseScalar`, `formatValue`,
`isSet`, `getLeaf`/`setLeaf`, `scopeLabel` have no tui-kit dependency at all.

Extract those generic pieces into `packages/settings-kit/src/shapes.ts`
(new subpath export, e.g. `@mattstack/settings-kit/shapes`, mirroring the
existing `/react` and `/server` exports). Board's `config-shapes.ts` keeps
its board-only extras (`COMPOSITE_SHAPES`, `ROW_HINTS`, `rosterSummary`,
`slugTabId`, `addToList`) and imports the generic ones from settings-kit
instead of defining them locally. This is the only way console avoids
reimplementing logic that already exists and works.

## Console: Agent Defaults settings page

Console currently has no general settings-editor surface. The only
per-key view (`src/app/config/ExplainKeyPage.tsx`) is explicitly commented
as "a lens, not a surface — no rail entry points here" (palette-only,
read-heavy). This is a new, real page:

- New rail entry ("Settings", gear icon) in `src/app/App.tsx` /
  `src/app/routes.ts`.
- New page, e.g. `src/app/settings/AgentDefaultsPage.tsx`, built on
  `useSettingsScope('agent.')` (from `@mattstack/settings-kit/react`) and the
  extracted shape helpers, rendered with Mantine components (per
  `building-with-mantine-kit`) instead of tui-kit's raw `<input>`/`<select>` —
  same data layer as board's `ConfigModal`, different render layer.
- Console's existing generic `/api/settings/*` routes (already exercised by
  `useSettings.ts`'s `defs`/`explain`/`set`) cover read/write for all the new
  `agent.*` keys with no server change.

### Model suggestions

Reuses the exact pattern `ConfigModal` already uses for CODEOWNERS section
suggestions: a text field with a `<datalist>`, not a locked `<select>` — free
text still works for a model the list doesn't know about yet.

- **codex**: live. `codex debug models` (confirmed real, installed locally)
  returns a JSON catalog (`slug`, `display_name`, `description`, reasoning
  levels, `visibility`). New console-server route
  `GET /api/agent/models?provider=codex` shells out to it and filters to
  `visibility: "list"` entries (verified list on this machine: `gpt-6-astra`,
  `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`). This assumes
  console runs as a local per-machine app alongside the rest of the mattstack
  suite (same assumption the rt daemon already makes to shell out to
  `claude`/`codex`) — confirm during implementation if console turns out to
  run centrally instead.
- **claude**: no equivalent live command exists (verified: no model-list
  subcommand in `claude --help`). A small curated constant — aliases
  `fable`, `opus`, `sonnet`, `haiku` (each resolving to "latest" of that
  family) — lives in `packages/rt-client/src/agent-models.ts` and is served
  by the same `GET /api/agent/models?provider=claude` route. Maintained by
  hand; stale entries are a documentation debt, not a correctness bug (they
  are suggestions, not validated).

## Testing

- `lib/agent-argv/*.test.ts`: argv-building unit tests per provider,
  mirroring today's `lib/__tests__/agent-argv.test.ts` coverage (start/resume,
  every flag, yolo, quoting for the pane-command builder).
- `lib/daemon/handlers/agent.test.ts`: provider resolution from
  payload vs. settings vs. default; account-with-codex rejection; yolo
  threaded through to the built argv; session-id capture (headless, with a
  faked `--json` stdout stream) and its DB update.
- `commands/__tests__/agent.test.ts`: new flag parsing (`--provider`,
  `--yolo`).
- Registry: existing settings tests should cover the renamed/added rows
  automatically (type/scope validation is generic).
- Console: a component test for the new settings page against a mocked
  `/api/settings` + `/api/agent/models`, plus the existing
  `dist-freshness`-style discipline if rt-client's `agent-models.ts` ships
  from there.

## Open items to resolve during implementation (not blocking this design)

1. Exact JSON field name(s) for the codex session id in both the `--json`
   event stream and `herdr agent get`'s output — confirm against a real
   headless run and a real herdr pane before wiring the parser, not from this
   spec's inference.
2. Whether console runs per-machine (assumed) or centrally — affects whether
   the codex model-catalog endpoint can shell out directly.
