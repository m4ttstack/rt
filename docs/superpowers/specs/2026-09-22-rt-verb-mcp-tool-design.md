# rt_verb: a curated MCP tool for rt verbs

Linear: RT-244. Ships in the same rt release as
`2026-09-22-writing-style-presets-design.md`, whose skill lookup is its first
caller.

## Problem

On a new Mac, board-launched panes run without yolo, and a fresh
`settings.json` holds only `BASE_PERMISSIONS` with no `defaultMode`. So every
Bash `rt` call a skill makes raises a permission prompt and strands an
unattended pane. The one remedy today is a `BASE_PERMISSIONS` line per verb,
and those lines never reach existing installs (RT-245).

The mattstack MCP server, by contrast, is allowed at server level on every
install set up since RT-174, and its tools ship inside rt. A verb reachable
through it works unprompted on those installs as soon as rt updates. A machine
set up before RT-174 that never reran setup still prompts once for the server
itself; RT-245 covers that class.

## Decisions

Ratified with the operator on 2026-09-22.

| Decision | Choice |
| --- | --- |
| Shape | One tool, `rt_verb`, that runs only command-tree leaves marked agent-safe |
| Launch set | Reads that need no caller environment: `skills writing-style show`, `worktree list`, `endpoint lookup`, `herd status` |
| Pipeline bookkeeping | Out of scope. `runs field`, `decision` and `stage-*` read `RT_RUN_DB` from the caller's shell, which the server cannot see; a follow-up designs an env allowlist |
| Migration | None here. Existing Bash `rt` calls in skills stay; the writing-style lookup is the first caller |

## Design

### 1. The flag

`CommandNode` in `lib/command-tree.ts` gains:

```ts
/**
 * An agent may run this leaf through the mattstack MCP server's `rt_verb`
 * tool with no permission prompt, including from a pane reading untrusted
 * text (an MR under review). The bar: no state change the caller directs,
 * under any flag the leaf declares. It never deletes, and never writes
 * settings, secrets, worktrees, runs, or another agent's state. Housekeeping
 * the implementation does on any read (a legacy import, a self-healing index
 * row) is not a caller-directed change and does not disqualify a leaf.
 * Set it only on a leaf that takes --json.
 */
agentSafe?: true;
```

The bar covers every flag the leaf declares, because the tool passes the
caller's args through and refuses undeclared ones. A leaf with a write-mode
flag cannot be agent-safe.

`lib/__tests__/agent-safe.test.ts` guards the flag:

- The full list of agent-safe leaf paths is an inline snapshot, so every
  addition is a visible line in review.
- Every agent-safe node is a leaf (no `subcommands`), declares a `--json`
  arg, and is not `devOnly`, not `hidden`, and not `requiresTTY`.

### 2. The tool

`lib/mcp/tools.ts` gains `rt_verb`:

```ts
{
  name: "rt_verb",
  description: "Run one read-only rt verb and return its --json result. Only verbs marked agent-safe run; anything else is refused with the list of verbs that do. Pass args without the leading \"rt\" (e.g. [\"worktree\", \"list\"]) and cwd when the verb depends on the current repo, since this server's working directory is fixed at session start and does not follow cd or EnterWorktree.",
  inputSchema: {
    type: "object",
    properties: {
      args: { type: "array", items: { type: "string" }, minItems: 1 },
      cwd: { type: "string", description: "Absolute directory to run in; defaults to the server's own." },
    },
    required: ["args"],
  },
}
```

The handler:

1. Refuses when `args[0]` starts with `-`. The walk is anchored at `args[0]`
   and never skips a leading flag: `cli.ts` matches `--daemon`,
   `--post-install`, `--grant-fda` and `--version` only at `args[0]`, and
   anchoring is exactly what keeps them out of reach.
2. Walks `args` down `TREE` (`lib/command-tree-def.ts`), resolving aliases as
   the CLI does, to the deepest node the leading args name. The rest are the
   leaf's own args. The walk lives in a new TUI-free module,
   `lib/command-tree-resolve.ts`, exporting
   `resolveLeaf(tree, args): { node, path, rest } | null`, because
   `resolveNode` in `lib/command-tree.ts` is private and that module imports
   the TUI, which `lib/mcp` must stay clear of. `lib/command-tree.ts` switches
   its own alias lookup to the new module so there is one copy.
3. Refuses unless that node is a leaf with `agentSafe`. The refusal names the
   agent-safe paths.
4. Refuses any flag in `rest` that the leaf does not declare in its `args`
   (by `flag`, with `--name=value` checked by name), `--json` excepted. The
   bar covers every flag a leaf accepts, and only declared flags are
   reviewable, so a flag the handler parses without declaring would otherwise
   pass through unreviewed.
5. Refuses a `cwd` that is not an absolute path to an existing directory.
6. Spawns `[...rtSelfArgv(), ...path, ...rest]` plus `--json` (appended once
   when absent), where `path` is the resolved command path from
   `resolveLeaf` with aliases replaced by canonical names.
   Whether rt is compiled is decided the way `rtSelfBin` in
   `commands/home.ts` decides it (`import.meta.url` under `/$bunfs`), never by
   `process.execPath`'s basename. That check moves to a shared
   `lib/rt-self.ts` exporting `isCompiledRt()` and `rtSelfArgv()`, and
   `rtSelfBin` calls `isCompiledRt()` so there is one copy. `rtSelfArgv()` is
   `[process.execPath]` compiled, and `[process.execPath, Bun.main]` from
   source (the dev wrapper runs `bun ... cli.ts`, so `Bun.main` is `cli.ts`).
   `probes.runRt`'s argv (`[process.execPath, ...args]`) is not reused, since
   from source it runs `bun` with rt's args. Only its timeout path is:
   `execWithTimeout`, 30s, SIGTERM then SIGKILL.
   The environment is the server's own plus `RT_BATCH=1` and
   `RT_SKIP_SETUP=1`, so no picker or setup hook can wait on a TTY.
7. Exit 0 with JSON on stdout returns the parsed JSON as the body. Exit 2 with
   a user-error envelope returns the envelope's message as the error. Any
   other exit or a timeout returns a short error naming the verb and exit
   code, plus the first of these that is present: an `{error}` object in
   stdout's JSON (some verbs report failures on stdout with exit 1), the last
   400 bytes of stderr, or the last 400 bytes of stdout (a daemon-down
   message can be plain text even under `--json`).

### 3. The roster rule

The header comment of `lib/mcp/tools.ts` says every tool is a thin wrapper
over a daemon command. It becomes: every tool is a thin wrapper over a daemon
command, except `rt_verb`, which runs agent-safe CLI leaves, because some
reads (a setting, a file) need no daemon, and putting one in their path would
make a daemon outage cost the caller the read.

### 4. The launch set

`agentSafe: true` on `skills writing-style show` (added by the writing-style
lane once its node exists), `worktree list`, `endpoint lookup` and
`herd status`. Each is checked against the bar in section 1 before it is
marked. A leaf that fails the bar (no `--json`, or a flag that writes) is left
off the launch set rather than changed here.

## Testing

- **Flag gate:** the snapshot, and the leaf, json, devOnly, hidden and TTY
  checks.
- **Handler:** unit tests with an injected spawn:
  - an agent-safe leaf runs with the given `cwd`, `RT_BATCH=1`, and the full
    argv asserted exactly: `["worktree", "list", "--repo", "x"]` spawns
    `[...rtSelfArgv(), "worktree", "list", "--repo", "x", "--json"]`
  - `--json` is not doubled when the caller passes it
  - an alias resolves
  - a non-agent-safe leaf, a branch node, and an unknown verb are refused,
    and the refusal names the allowed paths
  - a relative or missing `cwd` is refused
  - `["--post-install", "worktree", "list"]` and any other leading flag are
    refused before the walk
  - an undeclared flag (`["worktree", "list", "--prune"]`) is refused, a
    declared one (`--repo x`, `--repo=x`) passes
  - exit 2 surfaces the envelope message
  - exit 1 with `{error}` on stdout surfaces that error; a daemon-down exit 1
    with plain text surfaces the text
  - a timeout, a crash and non-JSON stdout surface as short errors
- **Self-spawn:** `rtSelfArgv()` is `[execPath]` when compiled and
  `[execPath, Bun.main]` from source; `rtSelfBin` still returns what it did.
- **Alias resolver:** `resolveLeaf` matches `lib/command-tree.ts`'s dispatch
  on every alias in `TREE`.
- **e2e:** `rt mcp serve` over stdio, `tools/list` includes `rt_verb`, and a
  `tools/call` of `worktree list` in a temp HOME returns the same JSON as the
  CLI.

## Out of scope

- Pipeline bookkeeping verbs and an env allowlist (follow-up ticket).
- Moving existing Bash `rt` calls in skills to the tool.
- Write verbs of any kind.
