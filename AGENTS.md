# rt (repo tools)

Personal developer CLI built with Bun. Compiled to a standalone binary via `bun build --compile` and shipped inside the mattstack.app bundle, which installs it (there is no separate CLI tarball asset).

## Architecture docs live in Linear, not this repo

rt is one piece of a plan spanning five repos, so the governing design docs are
not in any single repo. Before proposing anything about rt's scope, board,
glance, gitq, or the acme skills, read `docs/architecture.md` for the links.

## Settings architecture

Every key any mattstack app reads lives in the suite settings stores behind
the resolver in `packages/rt-client`. Before adding a key, porting config, or
touching `~/.mattstack`, read `docs/settings-architecture.md` (scope model,
registry checklist, ownership latch, the call-time HOME and sops footguns).
The working rules for `getSetting`/`setSetting`, scope choice and latches are
the `rt-settings` skill (`skills/rt-settings/SKILL.md`); this file does not
repeat them.

## Repo identity

Every per-repo store, daemon payload and REST path keys on a serialized repo
identity from rt-client, never a derived name, EXCEPT settings-store sections
(`repos.<identity>`), which key on the raw `host/path` form the resolver
expects. Before keying anything by repo, read `docs/repo-identity.md` and the
`rt-repo-identity` skill (`skills/rt-repo-identity/SKILL.md`), which carry
the two string forms, where each applies, and the identity-only verb guards.

## Worktree pool: the golden tree

Every repo with `onDeck > 0` has one `kind: "golden"` worktree under
`~/.mattstack/rt/golden/<segment>/`. New on-deck members are built by
`clonefile(2)`-ing its git-ignored artifacts and inheriting its
`readyStamp`; they never run `pnpm install` at birth. Before touching
`lib/worktree/hydrate.ts`, `lib/worktree/clonefile.ts`, or replenish, read
`docs/superpowers/specs/2026-09-21-golden-worktree-hydration-design.md`.

Three traps, each of which cost a real debugging round:

- **The golden and the pool root must share an APFS volume.** `clonefile(2)`
  fails `EXDEV` across volumes, and replenish answers that by silently
  cold-creating, so the symptom is slowness, not an error.
- **Nothing on the replenish path may create the pool root.** The volume
  probe stats the nearest EXISTING ancestor for exactly this reason: an
  existing pool root is what tells `isHeldByUnreadableMount`
  (`reconcile.ts`) that a vanished mount is live again, and that hold is
  all that stops a mount outage from pruning live claim state.
- **`pnpm install` on an already-current tree still reruns every lifecycle
  script** (~3 min on a large pnpm monorepo), so a hydrated member must inherit the
  golden's stamp rather than "verify" itself with an install.

## rt chat

Group chat and presence for the agents in the estate, over the daemon. Before
touching `commands/chat.ts`, `lib/state/chat-store.ts`, the `chat:*` daemon
handlers, or `skills/rt-chat/`, read in this order:

- `skills/rt-chat/SKILL.md`: the agent-facing rules (sign-in, arming the tail
  under `Monitor`, re-arm, posting from a heredoc, what to say in a pane).
- `docs/superpowers/specs/2026-08-23-rt-chat-design.md` and
  `2026-08-24-rt-chat-presence-design.md`: the schema (v3 rooms/messages,
  v4 presence/DMs), the wake protocol, the two heartbeats.
- `packages/rt-client/README.md` "Chat": the wrappers, relay and health probe
  the web viewer is built on.

The viewer is its own repo, `~/Documents/GitHub/chat` (`ARCHITECTURE.md`
there). `lib/chat-viewer-url.ts` builds the `/r/<room>#m-<id>` links the CLI
prints; that route shape is a contract with the viewer's route table.

## rt-ui

rt's prompts and step spinners render through a bundled Go helper
(`ui/`, binary `rt-ui`, `Contents/Helpers/rt-ui`) driven over NDJSON on
stdin/stdout with `/dev/tty` for the screen. Before touching `lib/ui/*`,
`ui/`, or the prompt facade, read
`docs/superpowers/specs/2026-08-29-rt-ui-bridge-design.md`: the protocol,
the exit-code contract, the never-spawn-without-a-TTY gate, and why the
source checkout outranks the installed bundle when resolving the binary.
`bun run ui:build` after any change under `ui/`; the shared fixtures in
`ui/fixtures/` are golden-tested from both languages.

Every picker is the one-shot `rt-ui pick` verb
(`ui/internal/views/picker/`), driven from TS through the wrappers in
`lib/pick-wrappers.ts` and `lib/ui/pick.ts`; it replaced fzf outright, so no
fzf spawn path remains. Before touching picker rendering read the design
boards in `docs/design/picker/` and the spec
`docs/superpowers/specs/2026-08-31-rt-picker-redesign-design.md`: the row and
segment wire protocol, the action registry that drives the keybar and menus, the
modal overlay stack, and the headless fzf matcher (`match.go`) that is the one
piece of fzf kept, as a ranking library, never a spawn.

`rt runner` is the first `session` view: `commands/runner.ts` gates, selects
the backend, and wires; `lib/runner/runner.ts` owns the entries and the
intent loop; and `ui/internal/views/board/` paints. Services run in a
detached tmux session by default (`lib/runner/tmux-engine.ts`); `--herdr`
opts into headless herdr panes instead (`lib/runner/engine.ts`'s
`HerdrEngine`, still the only herdr socket door), and focus (`f`) is the
only tmux-mode path that touches herdr, splitting a pane that attaches the
session. Read
`docs/superpowers/specs/2026-08-29-rt-runner-design.md` before touching any
of them: the board is ephemeral and pane-owned (quit closes the workspace),
the exit code of a pane command comes only from the `__rt_exit` sentinel,
and the add flow closes and reopens the session around the rt-ui picker.

### Shared rt-ui primitives -- lift, don't duplicate

`ui/internal/views/picker/scroll.go`'s `Viewport`/`ThumbSpan`/`ThumbCell` are
the one scroll-offset/thumb implementation for every scrolling region in
rt-ui (the picker's own list, the diff pane, the Changes list, and all
three mission foldouts) -- vim-style scrolloff, a caller cap, a shared
`h*h/n` thumb formula, with the thumb's own styles passed in per caller.
`clip`/`clipOn` (`ui/internal/views/mission/topbar.go`) are the only text
clippers mission uses. A new scrolling region, thumb, or text-truncation
site imports and calls these; it does not hand-roll a second copy. When a
new cross-view need comes up (a bordered box, a keybar strip, a row's
rest/hover/cursor background), check picker/board/mission for an existing
implementation FIRST and lift the best one to a shared spot rather than
writing a third version -- this was a standing correction after mission's
own diff pane and Changes list had each grown a byte-for-byte duplicate of
the picker's viewport math independently.

### Mission adopts GitHub Desktop's staging model

`rt glitter`'s checkboxes (line, hunk, or whole file) are commit
INTENT, not index state -- toggling one never touches git. The real
index is rebuilt from scratch at commit time (reset to HEAD, then
restaged file by file from each one's own selection), so **anything
staged outside glitter -- a plain `git add`, another agent editing the
same repo concurrently -- is discarded at the next commit and replaced
with exactly what the checkboxes say.** This is GitHub Desktop's own
behavior, not a bug. Full design and the one selection-persistence
exception (a Partial selection downgrades to None, not All, once a
commit or discard shifts its file's diff shape) are in
`docs/design/mission/README.md`'s "Staging model" section.

## The TypeScript CLI is UI-free

The rt TS CLI (`commands/`, `lib/`, `cli.ts`, `scripts/`) is pure Bun/TypeScript
orchestration and MUST NOT contain UI-rendering code: no UI frameworks (ink,
`@inkjs/*`, react, react-dom, preact, vue, solid, svelte), no JSX, no `.tsx`
files. All UI is rendered by the Go `rt-ui` helper (prompts, steps, board,
pickers); the TS layer only drives it over stdio and process spawn. `packages/` (for example `packages/settings-kit`, a react UI
kit for the web console) is a separate concern and is exempt from this rule.

Enforced by `lib/__tests__/no-ui-in-cli.test.ts`.

## Release & distribution

Before touching the release workflow, the app bundle, signing, Sparkle, the
marketplace, or the VM clean room, read `docs/release-and-distribution.md`.
It carries the release flow, the bundle/signing rules, and the traps only
real runs surfaced (translocation, VM Gatekeeper policy, headless CLT).

## Logging architecture

Logging is structural, not per-feature. Outcomes are logged at central seams; feature code only logs domain events. When adding a feature, you almost never need to add logging. Check this list before writing any.

**The seams (do not log outcomes yourself):**

- **CLI commands**. `dispatch()` in `lib/command-tree.ts` logs every command's outcome, and `installCliLogging()` (wired in `cli.ts`) covers every `process.exit()` path and persists crash stacks. A new command gets usage + error + crash logging with zero code.
- **Daemon commands**. Every IPC/REST command funnels through `handleCommand` in `lib/daemon.ts`, which logs ok/rejected/threw with duration. A new handler in `lib/daemon/handlers/` inherits this; do not log request/response or wrap handlers in logging try/catches.
- **Daemon crashes**. `installCrashHandlers` + `redirectNativeStderr` (`lib/daemon-logger.ts`) capture uncaught exceptions, rejections, JS stderr, and native bun panics.
- **Tray**. `TrayLog` (`rt-tray/Sources/TrayLog.swift`) is the only logging API (never bare `NSLog`); spawn subprocesses via `TrayLog.runLogged`/`spawnLoggedDetached`; `TrayServer.sendResponse` logs all non-2xx replies.

**The file convention:** every surface appends JSON lines to `~/.mattstack/rt/logs/<surface>.YYYY-MM-DD[.N].log` (daemon, cli, tray today). `rt daemon logs` auto-discovers surfaces by that pattern. A new surface that follows it appears in the viewer with no registration.

**What feature code SHOULD log:** domain events only, things invisible at the seams (a sync fast-forwarded, a watcher rewired). Daemon modules use `(await getDaemonLogger()).childLogger("<module>")`; handlers use `ctx.log`. Noisy periodic events go at `debug` (default level is `info`; `RT_LOG_LEVEL=debug` to see them).

**The catch policy:** never swallow errors in a seam. Below a logged seam, an empty catch is acceptable only for genuinely expected conditions (socket already closed, file already gone). Anything else logs at `warn` with `{ err }`.

## Gates and the `rt_verb` MCP tool

Agents reach rt from Claude Code two ways: Bash, and the mattstack plugin's
MCP server, whose `rt_verb` tool runs a curated subset of the command tree.
A verb is exposed there only when its node in `lib/command-tree-def.ts` sets
`agentSafe: true`; `listAgentSafe` in `lib/command-tree-resolve.ts` is the
one place that computes the set, and `lib/mcp/rt-verb.ts` refuses everything
else, refuses control characters in args, and caps a run at
`RT_VERB_TIMEOUT_MS`. Mark a verb agent-safe only when it writes nothing the
calling agent does not already own (its own run, its own gates, a read); the
tool is the long-term replacement for Bash allow rules, so a careless flag
here is a permission grant on every estate machine.

Decision gates (`rt gate ask`, `rt gate wait`, the board's stage sheet) are
the only way an unattended pane asks a human anything. The
`AskUserQuestion` hook in `.claude/` panes defers to `rt gate fork-check`
(rt#391): it allows the launch subject's gate, a worktree run gate, or a live
form gate this pane asked under its own session, and never counts
pane-attention gates. Before changing gate ownership, the hook, or the
fork-check rules, read the gate-seam spec named in `docs/architecture.md` and
the `rt-chat` and gate skills under `skills/`.

## Switchboard and `rt team join`

The switchboard is the only service a board token is ever sent to, and only
the team-declared URL (`board.switchboardUrl`, https only) is trusted: a URL
that arrives inside an invite alone is never peered with. `rt team join`
stores the invite-sealed board token under the rt secrets scope and writes
the user latch `rt.integrations.switchboardUrl` only when it is unset or
invalid; a different confirmed URL is never overwritten, the join warns and
points at `rt setup switchboard connect --host <url>` instead. The setup
row `account.switchboard` reads that latch, probes `<url>/healthz` with no
auth header (`/health` is not a route), and offers Confirm with the declared
URL prefilled when the latch is empty or differs. Change any of these three
(join, latch, row) together or not at all; `lib/team/join.ts`,
`lib/setup/validators/accounts.ts` and `lib/setup/validators/access.ts` are
the seams, and RT-260 is the incident that made this a rule.

## Writing-style presets

Every review or reply an agent drafts composes in one writing style, resolved
by `resolveWritingStyle` in `lib/skills/writing-style.ts`: the
`skills.writingStyle` setting (user scope beats team), else the
`writing-style:` line in `~/.mattstack/user/skills/preferences.md`, else
`mattstack:writing-style-conversational`. `rt skills writing-style show`
prints the resolved skill and its source with the one wording the setup row
also uses (`WRITING_STYLE_SOURCE_LABEL`), so never restate it elsewhere.
`use` refuses a skill id that is not installed and `new` copies a preset into
the user's own skill, normalising CRLF and renaming the frontmatter so the
copy is a skill of its own. The presets themselves ship in the mattstack
plugin (`mattstack-skills`), not here; a preset id must exist there before
`use` will accept it, and the `skills.writing-style` setup row is
finish-gated and not waivable, so a machine with no resolvable style cannot
Finish.

## Setup checklist rows: required vs finish-gated

A row's `required` blocks Install; `finishGated` blocks the wizard's Finish
and never Install (`finalizePlan` and `finishBlockers` in
`lib/setup/contract.ts`). A finish-gated row must carry `waivable` on every
emit (an app reading a row without it treats the row as waivable) and only
ids in `WAIVABLE_ROW_IDS` may be waived by `rt setup waive`; `waived` is what
the app's Un-skip keys on, never the note's wording. A required row with a
fault must offer an action that can clear it: an actionless required row is
an Install nobody can reach (RT-260). A connect action may prefill a field
through `ConnectField.value`; the tray renders it as the field's initial
text. Add a row by following an existing validator in `lib/setup/validators/`
and its `steps-*.test.ts` twin; the tray's `PlanModels.swift` decodes the
same contract, so a new field needs the Swift side too.

## Baseline Claude permissions are provisional, and never git

`lib/setup/base-permissions.ts` is the allow list Install unions into every
Claude config dir, and `lib/setup/claude-permissions.ts` seeds
`permissions.defaultMode: "auto"` when a config dir has none (Enterprise and
Console-key sessions start in manual mode otherwise). Two rules: an allow
rule resolves BEFORE the auto-mode classifier, so a `Bash(git push *)`-shaped
entry would wave through a forced push and `Bash(git rebase *)` a `--exec` of
any command; the read-only git forms need no rule in any mode and the
classifier approves routine commits and pushes, so no `Bash(git ...)` entry
belongs in the list (a test pins this). And the `rt runs` / `rt gate`
entries are the RT-246 stopgap until every skill reaches those verbs through
`rt_verb`; do not widen the list to make a skill work, expose the verb.

## The relocation prompt parser reads a real capture, not a hand-drawn one

`lib/daemon/trust-dialog.ts` auto-accepts Claude Code's EnterWorktree
"permission-root relocation" prompt for unattended panes (RT-200, RT-257).
Claude Code 2.1.281 draws it under a full-width rule with a " Tool use"
heading, an "   Entering worktree(<path>)" echo and a
" │ permission-root relocation to ..." gutter line; the parser matches those
markers by column, never rejoins a path the terminal split across rows, and
refuses a dialog whose rule is narrower than any other line (a fake painted by
a command). Every fixture in `lib/daemon/__tests__/trust-dialog.test.ts` that
claims to be the real dialog is pasted from a gate's captured screen; when a
Claude Code update changes the drawing, capture the new screen from a stalled
pane, add it as a fixture, and only then touch the regexes. A parser that
"fails closed" here reads as a pane that never starts, so RT-263 tracks the
residue and every change needs the Bash-spoof, MCP-spoof and painted-dialog
fixtures still passing.

## State backup

Encrypted, compressed, off-machine backup of mattstack app state. Before
touching `lib/state/backup-*.ts`, `commands/state-backup-*.ts`, the daemon's
`state-backup` sweep, or anything under `~/.mattstack/user/state-backups/`,
read `docs/superpowers/specs/2026-09-13-state-backup-design.md`; it is the
reference for the pipeline, manifest, restore and prune. Three traps the spec
explains and the code enforces:

- Intermediates never touch the home repo working tree; only the final
  `.age` blob lands under `state-backups/<app>/`.
- The age private key is never written to disk; `readAgeKey` and
  `ensureAgeKey` require an `AgeKeySeam` from `createRealAgeKeySeam()`.
- `age`, `zstd` and `git-lfs` resolve via an explicit `{ PATH: process.env.PATH }`
  because the daemon's launchd PATH is minimal (RT-131 tracks bundling them).

## Operating on this machine

This repo's tooling runs as live services on the developer's own machine. Six
rules, each written after it cost real damage:

- **A built binary is only ever run under an isolated HOME** (`env -i HOME=<temp> …`),
  every invocation, not just tests. The daemon shim and the compiled `rt` both
  read `~/.mattstack` and will act on it: a single unisolated run started a real
  daemon that spent minutes creating worktrees and running installs.
- **Never rebuild, re-sign, or reinstall an app bundle macOS has blessed**
  (`/Applications/mattstack.app`, `rt-tray/mattstack-dev.app`). Build into a
  scratch directory instead. Re-signing invalidates Login Items and TCC grants,
  and the failure is silent.
- **Check `git branch --show-current` before syncing the main checkout.** It is
  shared with other sessions and is what the dev-mode `rt` wrapper executes;
  it is not always on `main`. That second half makes it operational, not
  hygiene: **the branch that checkout sits on is the dev daemon's deployed
  code.** A daemon that has been up for hours is running whatever was checked
  out when it started (another lane's branch, quite possibly), so a merge
  changes nothing in service until the checkout syncs AND the daemon restarts.
- **Diagnose live services without starting competing instances.** An extra
  daemon squats `rt.sock` and produces exactly the symptom (starts, binds
  nothing, logs nothing) that then gets misdiagnosed as a permissions problem.
- **Re-read a ticket immediately before acting on it.** Tickets here are
  written by other live sessions while you work, so the copy you read at the
  start of a task is a snapshot, not the current state. A prune ran against a
  ticket that had, in the meantime, grown a section explaining that the very
  row being removed was being kept deliberately. The eviction orphaned a
  daemon registry and silently stopped worktree reconciliation. The same
  applies to any shared artifact a peer session can edit underneath you.

A claimed recovery path (self-heal, fallback, retry) is load-bearing: trace the
code that performs it before documenting it, or the docs will tell users to run
something that does nothing.

## Footguns

### `bun run test` is one of three suites, and CI runs all three

`test` is `bun test lib commands packages scripts`. CI also runs `test:e2e`
(`e2e/tests/`, needs `--preload ./e2e/setup.ts`) and `test:pty` (`e2e/pty/`,
the termwright gate that drives the compiled binary in a real pty, 120s
timeout). `test:all` runs all three. A green local `bun run test` says nothing
about either of the others, and the difference is invisible in the output.

It matters most for anything asserted verbatim end to end (the chat delivery
frame, a CLI's `--json` envelope, a usage string) and for anything glitter or
rt-ui paints: those have exact-string or screen assertions no unit suite
covers. Run `bun run test:all`, or at least the one e2e or pty file covering
the surface, before calling a change verified. The pty gate skips in CI unless
the diff touches a path in `.github/workflows/e2e.yml`'s filter; a change to
socket setup, `test-setup.ts` or `e2e/socket-path.ts` must be in that filter or
the gate never runs (macOS caps a unix socket path at 104 bytes, and the gate
is what catches a path that grew past it).

### Module registry

When adding a new command module referenced by `cli.ts` (any file with a `module:` entry in the command tree), you **must** also register it in `lib/module-registry.ts`. `bun build --compile` cannot resolve dynamic `import()` with runtime-constructed paths, so the compiled binary relies entirely on this registry to discover and bundle every command module. Running from source (`bun run cli.ts`) works fine without the registry entry because the dynamic import fallback succeeds, so you won't catch this locally -- it only breaks in the distributed binary.

Every registry value is a thunk (`() => import("../commands/x.ts")` with the path spelled out literally), not an eagerly-evaluated namespace import. That's what keeps `rt --version` and every other dispatch from paying for the whole command surface: the bundler still statically discovers all 30 modules, but none of them evaluate until a command actually dispatches to it. Adding a static (non-thunked) `import` of a command module to `lib/module-registry.ts`, or a static value import of `lib/rt-render.ts`/`ink` to `lib/command-tree.ts`, is a startup regression. `scripts/bench-startup.ts` gates this in the release workflow (`.github/workflows/release.yml`), and `lib/__tests__/no-eager-tui.test.ts` gates the command-tree and command-module cases directly.

### `SCHEMA_VERSION` is claimed across sessions, not chosen per branch

Several agents work this repo at once, and `runMigrations` only replays when
`user_version < SCHEMA_VERSION`. So the first branch whose daemon opens
`~/.mattstack/rt/state.db` stamps the new number, and every *other* branch's
schema for that same number then silently never applies. Its tables are
simply absent on that machine, with no error anywhere. This has already
happened once: two lanes both wrote a v4, one lane's daemon migrated the
real db minutes before the other merged, and the second lane's tables
never appeared.

Announce the version you are taking to the other sessions before you merge,
and renumber if you are second. To repair a db stamped by a schema that is
not the one on disk: stop the daemon, `PRAGMA user_version = <the previous
version>`, start it, and diff `sqlite_master` before and after to confirm
the other lane's tables survived (the replay is IF NOT EXISTS, so it is
data-preserving).

**Nothing but `IF NOT EXISTS` statements may appear in a `V*_SCHEMA` block.**
The runner execs `V1 + … + Vn` as one statement on *every* bump, so an
`ALTER TABLE … ADD COLUMN` that succeeded once throws `duplicate column
name` on the next bump, rolls the migration back, and makes every later
`openStateDb` call throw. Add a column by creating the table with it
(`IF NOT EXISTS`), or guard the add behind a `PRAGMA table_info` check.

### Publishing `@mattstack/rt-client` is release-class, from `main` only

`0.5.0` reached npm with fresh `.d.ts` files over a stale `index.js`: its
types promised verbs its runtime bundle did not contain, so consumers
type-checked and then got `undefined` at call time. Publish only from a
checkout on `main`, never from a branch, never with `--ignore-scripts`
(`prepack` is what rebuilds `dist/`), and grep the built bundle for your own
verbs before you publish. The package version is a shared resource like
`SCHEMA_VERSION`: announce the bump, and let whoever merges second renumber.

### `packages/rt-client/dist/` goes stale without warning

`dist/` is gitignored, but `file:` consumers (board, gitq, the console) copy it **verbatim** at install time rather than building from source. So any change or merge that touches rt-client's source leaves every consumer installing the previous build. The source is right, the shipped artifact is not, and nothing about the working tree looks wrong. Run `bun run build` in `packages/rt-client` after touching it, and after any merge that does.

`packages/rt-client/test/dist-freshness.test.ts` is the guard and names the fix in its failure message. Treat that failure as a real instruction, not as a flaky artifact test. It caught this three separate times in one day across three sessions.

### Bytecode compile (`--bytecode`) silently falls back on failure

`bun build --compile --bytecode` does not reliably fail loudly when bytecode generation fails. Ink's dependency graph (via `yoga-layout`) and top-level await in `cli.ts` both currently break bytecode generation, but when the *post-bundle* bytecode step itself fails (as opposed to a bundling/parse error), bun still writes out a working binary, just without bytecode, and only a few hundred KB smaller than the non-bytecode build, so the artifact looks like a success. Never conclude `--bytecode` worked because a binary appeared and ran; check the build's stderr for `Failed to generate bytecode` (or read the exit code) before trusting the artifact. A hard parse-time failure (e.g. the top-level `await` in `cli.ts`) does exit non-zero with no binary produced, so that failure mode is safe -- it's specifically the later stage that goes silent.

### A required-positional leaf must declare `omitBehavior`

rt's convention is that omitting the next subcommand OR a required arg shows a
picker, never a bare error. Branch-node subcommand pickers are structural (the
dispatcher). The leaf *argument* picker lives in each handler, so it is enforced
by a declaration: every visible leaf with a required positional (flagless,
non-`optional`, text/select arg) must set `omitBehavior` on its node in
`lib/command-tree-def.ts` (`"picker" | "list" | "prompt" | { exempt: "why" }`).
`bun run picker:check` (`scripts/lib/picker-conformance.ts`) and
`lib/__tests__/picker-conformance.test.ts` fail otherwise; the check gates
`.github/workflows/checks.yml` and step 1 of the `rt:release` skill. Adding a
command that just errors on a missing positional breaks CI, not review.

The picker itself is the other half: rt is driven non-interactively by agents and
scripts as much as by humans, so **every leaf picker must gate `process.stdin.isTTY
&& !json && !process.env.RT_BATCH`** and leave the non-TTY / `--json` path exactly
as it was (same usage message, same exit code, same JSON). An empty candidate set
falls through to that existing error, never an empty picker. Tag `{ exempt }` only
when the value genuinely cannot be enumerated (free-text topic/glob/name/new path)
or the verb is agent-facing by contract.
