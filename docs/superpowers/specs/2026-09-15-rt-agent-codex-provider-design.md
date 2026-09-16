# rt agent: codex provider, --yolo, and console-editable defaults

Status: approved for planning
Repos touched: repo-tools (this repo), mattstack-apps/apps/console

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
| headless resume | `claude -p --output-format json [flags] --resume <id> <prompt>` | `codex exec resume [flags] <id> <prompt>` |
| herdr start | `claude [flags] <prompt>` | `codex [flags] <prompt>` |
| herdr resume | `claude [flags] --resume <id> <prompt>` | `codex resume [flags] <id> <prompt>` |
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

## Console: Agent Defaults settings page

Console has its **own** independent settings API
(`src/server/settings.ts`, a Hono router hand-written against
`@mattstack/rt-client` directly) — it does not depend on
`@mattstack/settings-kit` at all, unlike board. Board's
`ConfigModal`/`config-shapes.ts` (registry-driven, prefix-scoped, with
composite/leaves/roster/tabs control types) is real prior art but is not a
dependency console should take on here: every `agent.*` key is a plain
scalar (string or boolean) — none need board's composite-shape machinery —
and pulling in `@mattstack/settings-kit` as a new console dependency just
for a handful of pure functions would add a cross-repo dependency (and its
own `dist/` staleness footgun) for no real reuse. So this page builds
directly on console's existing settings API, extended minimally:

- `src/server/settings.ts`: `GET /api/settings/defs` gains an optional
  `?prefix=` query param (`allDefs().filter(d => d.key.startsWith(prefix))`),
  mirroring the filtering settings-kit's own server already does for board.
- `src/app/config/useSettings.ts`: new `useSettingsPrefix(prefix: string)`
  hook, same shape as the existing `useSettingsDefs`/`useExplainKey`, calling
  `client.api.settings.defs.$get({ query: { prefix } })`.
- Console currently has no general settings-editor surface — the only
  per-key view (`ExplainKeyPage.tsx`) is explicitly commented as "a lens, not
  a surface — no rail entry points here" (palette-only, read-heavy). This is
  a new, real page:
  - New rail entry ("Settings", gear icon) in `src/app/App.tsx` /
    `src/app/routes.ts`.
  - New page, `src/app/settings/AgentDefaultsPage.tsx`, using
    `useSettingsPrefix('agent.')` and `useSetSetting`, rendered with Mantine
    components (per `building-with-mantine-kit`): a `Select` for
    `agent.provider` (claude/codex), and per-provider sections with a
    `TextInput` for model (datalist-style suggestions, see below), effort,
    account (claude only), extraArgs, and a `Switch` for yolo.

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
- Console: a server test for the new `?prefix=` filter and the
  `/api/agent/models` route; a component test for the new settings page
  against a mocked settings API.

## Open items to resolve during implementation (not blocking this design)

1. Exact JSON field name(s) for the codex session id in both the `--json`
   event stream and `herdr agent get`'s output — confirm against a real
   headless run and a real herdr pane before wiring the parser, not from this
   spec's inference.
2. Whether console runs per-machine (assumed) or centrally — affects whether
   the codex model-catalog endpoint can shell out directly.
