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
machine (RT-174), and its tools ship inside rt. A verb reachable through it
works unprompted on every install as soon as rt updates.

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
 * text (an MR under review). The bar: the leaf only reads. It never deletes,
 * and never writes settings, secrets, worktrees, runs, or another agent's
 * state, under any flag it accepts. Set it only on a leaf that takes --json.
 */
agentSafe?: true;
```

The bar covers every flag the leaf accepts, because the tool passes the
caller's args through. A leaf with a write-mode flag cannot be agent-safe.

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

1. Walks `args` down `COMMAND_TREE` (aliases resolve as they do for the CLI)
   to the deepest node the leading args name. The rest are the leaf's own args.
2. Refuses unless that node is a leaf with `agentSafe`. The refusal names the
   agent-safe paths.
3. Refuses a `cwd` that is not an absolute path to an existing directory.
4. Spawns this same rt with the args plus `--json` (appended once when
   absent). The compiled binary is `process.execPath`; running from source it
   is `process.execPath` plus the `cli.ts` path the server was started with.
   The environment is the server's own plus `RT_BATCH=1` and
   `RT_SKIP_SETUP=1`, so no picker or setup hook can wait on a TTY. The
   timeout is 30s: SIGTERM, then SIGKILL, the same bounded path
   `probes.runRt` uses.
5. Exit 0 with JSON on stdout returns the parsed JSON as the body. Exit 2 with
   a user-error envelope returns the envelope's message as the error. Any
   other exit, a timeout, or unparseable stdout returns a short error naming
   the verb and exit code, with at most the last 400 bytes of stderr.

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
  - an agent-safe leaf runs with `--json`, `RT_BATCH` and the given `cwd`
  - `--json` is not doubled when the caller passes it
  - an alias resolves
  - a non-agent-safe leaf, a branch node, and an unknown verb are refused,
    and the refusal names the allowed paths
  - a relative or missing `cwd` is refused
  - exit 2 surfaces the envelope message
  - a timeout, a crash and non-JSON stdout surface as short errors
- **e2e:** `rt mcp serve` over stdio, `tools/list` includes `rt_verb`, and a
  `tools/call` of `worktree list` in a temp HOME returns the same JSON as the
  CLI.

## Out of scope

- Pipeline bookkeeping verbs and an env allowlist (follow-up ticket).
- Moving existing Bash `rt` calls in skills to the tool.
- Write verbs of any kind.
