# H: the VM check asserts the expected served apps

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The clean-room walkthrough's assert phase (`rt-tray/vm/run/guest/assert-installed.sh`) and its Sparkle update leg (`rt-tray/vm/run/guest/trigger-update.sh`) fail unless deck serves exactly the bundle's catalog in prod: every `deps.lock` helper row carrying `serve` is an rt-managed, healthy deck row with no dev-link issue that advertises its icon (the bundled identity unit C ships), launched from `/Applications/mattstack.app/Contents/Helpers/<name>` with its `serve.args` and `~/.mattstack/<name>` as cwd; no tool row (the gitq CLI today) is loaded as a deck job; and every `.mattstack` route answers, not just the first.

**Architecture:** The guest has no bun and no Homebrew, only the bundle's own jq (`Contents/Helpers/jq`, jq 1.8.2). So every parse is a small jq program under `rt-tray/vm/run/guest/jq/` (deps.lock to catalog, `launchctl print` to a job record, and a pure verdict over catalog + deck status + jobs + routes that prints `ok<TAB>msg` / `bad<TAB>msg` lines). A sourced bash helper, `rt-tray/vm/run/guest/served-apps.sh`, gathers the inputs, polls the verdict until nothing is bad or a deadline passes, and replays the lines through the caller's own `ok`/`bad`. Both guest scripts call it. The jq programs and the helper are tested on the host with bun (fixtures pasted from real `launchctl print` and deck `/api/v1/status` captures, and a stubbed launchctl/curl for the helper), and a CI test pins `catalog.jq` to `parseDepsLock`.

**Tech Stack:** bash 3.2 (macOS `/bin/bash`, `set -uo pipefail`), jq (1.8.2 in the guest, 1.7.1 on the host), bun test, TypeScript (strict, `noUncheckedIndexedAccess`).

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section H; the ratified rule and sections A and B define what "expected" means)

---

## Global Constraints

- **Workspace.** Work in a fresh rt worktree of repo-tools on branch `rt-2-13-h-vm-served-assert` cut from `origin/main` (EnterWorktree name-mode, which provisions through `rt worktree provision`; if the provisioned branch has another name, `git switch -c rt-2-13-h-vm-served-assert origin/main` inside it). Never write to, or switch the branch of, the shared checkout `~/Documents/GitHub/repo-tools`. No Swift build in this unit, so there is no need to copy `rt-tray/deps` or `rt-tray/vm/.cache`.
- **Worktree Bash guard.** Worktree sessions refuse compound shell commands (heredocs, `&&` chains, `-C`, loops). Run every command below as written, one per call, from the worktree root. Commit with `-m` flags, never a heredoc.
- **Guest shell rules.** Guest scripts run under `/bin/bash` 3.2 with `set -uo pipefail` and no `-e`. No `mapfile`, no associative arrays, no `${var,,}`. Never pipe into a `while` loop that calls `ok`/`bad` (the loop runs in a subshell and the caller's `fails` never moves); feed it with a here-string. Never guard with `producer | grep -q` (under pipefail an early `grep -q` exit can SIGPIPE the producer and invert the guard); use `grep -q ... <<< "$var"`.
- **jq compatibility.** The guest runs jq 1.8.2 and the host tests run macOS's jq 1.7.1, so use only builtins both have (everything in this plan is). `label` is a jq keyword; never name a function that. Task 3 reruns every suite under the bundled jq through `VM_TEST_JQ`.
- **Derive, never list.** `served-apps.sh` and `jq/*.jq` never name an app (board, chat, console, boxscore, gitq). The expected set is the installed bundle's `Contents/Resources/deps.lock`. A check in `check-vm-scripts.sh` (Task 5) enforces this.
- **Isolation.** Nothing here runs an rt, deck or app binary. The helper test runs bash with an `env` that replaces `HOME` with a temp dir and points `SERVED_LAUNCHCTL` and `SERVED_CURL` at stubs, so it never reads `~/.mattstack` or calls the real launchctl. Never touch `/Applications/*.app` or `rt-tray/mattstack-dev.app`; Task 3 only executes `/Applications/mattstack.app/Contents/Helpers/jq` (a plain jq binary) as a compatibility check.
- **No VM run in this unit.** A walkthrough takes about 25 minutes and needs a bundle that carries the serve rows and deck 1.1.0, which exist only after units A, B, C and D and the bot deps.lock PR land. The release walkthrough (`I-release-runbook.md`) is the first real run. This unit's verification is the host tests plus the offline gate.
- **Verification = targeted tests only.** Run exactly the commands named in each step. Never run `bun run test` or `bun run test:all` locally; CI runs them. `bunx tsc --noEmit` covers the new `.ts` files (they are inside the root tsconfig's scope).
- **Comments.** Clean-code only: a comment states a constraint the code cannot show. No narration, no ticket ids in code or comments, no em or en dashes anywhere (code, fixtures, commit messages, PR body).
- **TDD.** Every task writes the failing test first, runs it and sees the named failure, then implements.
- **Commits.** One commit per task, message ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (pass it as a second `-m`).
- **Baseline.** Before Task 1, run `bash rt-tray/vm/check-vm-scripts.sh` once on the untouched branch. It ended `all vm checks ok` on main at `a85d65e2e`; if anything fails before you change a line, note it and treat only new failures as yours.

## Review Focus

Five failure modes the spec implies that no existing test covers. Each is pinned by a named test in the owning task.

1. **A pid mistaken for health.** The old assert passes any deck label that holds a pid (`assert-installed.sh:140-144`), but a KeepAlive crash loop (the gitq CLI printing usage and exiting 1) holds a pid at most sample times. Health comes from deck's HTTP probe (`health.ok`), never from a pid. Pinned by Task 3 "a live pid is not health".
2. **A vacuous green.** A bundle built before the serve rows land, a missing `deps.lock`, deck not answering, or a missing host jq must each fail loudly, never pass with zero checks. Pinned by Task 3 "an empty catalog is one bad line" and "deck not answering is one bad line", Task 4 "the expected set comes from the bundle's deps.lock", Task 2's and Task 7's non-empty assertions, and `jqBin()` throwing instead of skipping (Task 1).
3. **deck's fuzzy status join.** `joinApps` (mattstack-apps `apps/deck/core/discover.ts:271-293`) pairs a route with any service whose label contains the name, so a status row's `service` can belong to another app (a real capture shows the `deck` row carrying `com.mattstack.deck.gitq-docs`). Job facts come only from `launchctl print` of the exact label `com.mattstack.deck.<name>`. Pinned by Task 3 "an app with no launchd job fails by its exact label, whatever service the status row claims".
4. **Shell plumbing that loses or inverts a failure.** A `bad` inside a piped `while` never reaches `fails`; a `| grep -q` guard can invert under pipefail; a poll loop can exit on the first pass or never. Pinned by Task 4 "a healthy bundle passes, and the bad count reaches the caller", "it polls until deck answers inside the deadline" and "a deck that never answers fails once the deadline passes".
5. **2.12.0's own regressions in a shape the old assert passes.** A tool served as an app (the gitq CLI loop), argv from the dev bundle or missing its serve args, a missing working directory (launchd exit 78), and a dead route behind the first one (`head -1` at `assert-installed.sh:317`). Pinned by Task 3 "argv0 under the dev bundle, missing serve args, a wrong cwd and a refused spawn each fail" and "a tool loaded as a deck app fails by name", Task 4 "a loaded gitq label fails even though no script names gitq" and "every .mattstack route is fetched, not just the first", and Task 5's "checks every .mattstack route, not the first".

## Files

| Path | Action | Responsibility |
|---|---|---|
| `rt-tray/vm/run/guest/jq/launchctl-print.jq` | create | `launchctl print` text to `{loaded, program, argv, cwd, pid, lastExit}` |
| `rt-tray/vm/run/guest/jq/catalog.jq` | create | `deps.lock` to `{apps: [{name,status,port,args}], tools: [name]}` |
| `rt-tray/vm/run/guest/jq/served-verdict.jq` | create | pure verdict over catalog, deck status, jobs, routes; prints `ok`/`bad` lines |
| `rt-tray/vm/run/guest/served-apps.sh` | create | sourced helper: `assert_served_apps`, `assert_mattstack_routes` |
| `rt-tray/vm/run/guest/assert-installed.sh` | modify | source the helper; every route; served-app assert; headless stated pass |
| `rt-tray/vm/run/guest/trigger-update.sh` | modify | optional `--headless`; served-app assert and every route after the relaunch |
| `rt-tray/vm/run/walkthrough.sh` | modify | pass `--headless` to the update leg for the headless scenario |
| `rt-tray/vm/check-vm-scripts.sh` | modify | run the four new host suites; grep gates for the wiring |
| `rt-tray/vm/run/helpers/__tests__/jq.ts` | create | shared jq runner for the host suites (`VM_TEST_JQ` override) |
| `rt-tray/vm/run/helpers/__tests__/launchctl-print.test.ts` | create | parser tests on real captures |
| `rt-tray/vm/run/helpers/__tests__/catalog.test.ts` | create | catalog edge cases |
| `rt-tray/vm/run/helpers/__tests__/served-verdict.test.ts` | create | verdict matrix |
| `rt-tray/vm/run/helpers/__tests__/served-apps-sh.test.ts` | create | helper end to end with stub launchctl/curl and a temp HOME |
| `rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-chat.txt` | create | real capture, running deck-written job, no args |
| `rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-args.txt` | create | real capture, job with two argv entries |
| `rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-missing.txt` | create | real capture, unknown label |
| `rt-tray/vm/run/helpers/__tests__/fixtures/deck-status-dev-lived.json` | create | real deck `/api/v1/status` from a dev-lived prod 2.12.0 machine, trimmed to the fields the verdict reads |
| `scripts/lib/__tests__/vm-served-catalog.test.ts` | create | CI parity: `catalog.jq` vs `parseDepsLock` on unit A's fixture and the shipped lock |
| `rt-tray/vm/README.md` | modify | layout rows, a "Served apps" section, how the release walkthrough runs it |

Facts the tasks rely on (verified on `origin/main` `a85d65e2e` and mattstack-apps `main` `35a59cd6`):

- `deps.lock` rows live in `.tools[]`; a bundled helper is `kind: "helper"` (`lib/bundle-layout.ts:15-52`, `rt-tray/deps.lock`). `build.sh` bundles only `status: "bundled"` rows (`rt-tray/build.sh:218`) and already ships the lock at `Contents/Resources/deps.lock` (`rt-tray/build.sh:273`).
- deck's `GET /api/v1/status` returns `{ devMode, apps: StatusRow[] }` with `name`, `url`, `health: { ok, status, ms }`, `managedBy`, `issues: { source, message, at }[]` per row (`apps/deck/src/api/status.ts:57-136`, route at `apps/deck/src/api/server.ts:403-405`). Rows come from portless routes (`apps/deck/core/discover.ts:271-293`). A prod row serving source carries a `source: "dev-link"` issue (`apps/deck/src/registry/serve-shape.ts:114`).
- deck's API port is `~/.mattstack/deck/api.json` `.port` (`apps/deck/src/api/state.ts:83-94`), falling back to the registry's own `deck` record (`apps/deck/src/cli/api-info.ts`, `registry.json` `.apps.deck.port`).
- `launchctl print gui/<uid>/<label>` prints top-level keys one tab deep (`program = `, `arguments = {` ... `}`, `working directory = `, `pid = `, `last exit code = `) and nested blocks two deep; an unknown label prints `Could not find service` and exits 113 (captures in Task 1).
- The walkthrough copies `run/guest` recursively into the guest (`rt-tray/vm/run/walkthrough.sh:141,176`), so `run/guest/jq/` ships with no staging change. `check-vm-scripts.sh:7` already runs `bash -n` over `run/guest/*.sh`.

---

### Task 1: `launchctl-print.jq` and the host jq harness

**Files:**
- Create: `rt-tray/vm/run/helpers/__tests__/jq.ts`
- Create: `rt-tray/vm/run/helpers/__tests__/launchctl-print.test.ts`
- Create: `rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-chat.txt`
- Create: `rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-args.txt`
- Create: `rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-missing.txt`
- Create: `rt-tray/vm/run/guest/jq/launchctl-print.jq`
- Modify: `rt-tray/vm/check-vm-scripts.sh:11`

**Interfaces:**
- Produces: `jq -R -s -c -f rt-tray/vm/run/guest/jq/launchctl-print.jq < <launchctl print output>` prints `{"loaded": boolean, "program": string|null, "argv": string[], "cwd": string|null, "pid": number|null, "lastExit": string|null}`.
- Produces (`jq.ts`): `GUEST_DIR: string`, `JQ_DIR: string`, `FIXTURES: string`, `jqBin(): string` (honours `VM_TEST_JQ`, throws when no jq), `runJq(args: string[], stdin?: string): string` (throws on a non-zero exit).

- [ ] **Step 1: Write the fixtures.** They are real `launchctl print` captures from a Mac running prod 2.12.0, with the home directory rewritten to `/Users/tester` (the guest user). They are tab-indented: one tab for top-level keys, two for nested lines. Write them byte for byte, each ending in a single newline.

`rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-chat.txt`:

```text
gui/501/com.mattstack.deck.chat = {
	active count = 1
	path = /Users/tester/Library/LaunchAgents/com.mattstack.deck.chat.plist
	type = LaunchAgent
	state = running

	program = /Applications/mattstack.app/Contents/Helpers/chat
	arguments = {
		/Applications/mattstack.app/Contents/Helpers/chat
	}

	working directory = /Users/tester/.mattstack/chat

	stdout path = /Users/tester/.mattstack/deck/logs/chat.out.log
	stderr path = /Users/tester/.mattstack/deck/logs/chat.err.log
	inherited environment = {
		SSH_AUTH_SOCK => /var/run/com.apple.launchd.TzpwIuqAEF/Listeners
	}

	default environment = {
		PATH => /usr/bin:/bin:/usr/sbin:/sbin
	}

	environment = {
		OSLogRateLimit => 64
		PORT => 11002
		PATH => /Applications/mattstack.app/Contents/Helpers:/Users/tester/.local/bin:/Users/tester/.bun/bin:/Users/tester/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
		MATTSTACK_CANONICAL_HOST => chat.mattstack
		XPC_SERVICE_NAME => com.mattstack.deck.chat
	}

	domain = gui/501 [100057]
	asid = 100057
	minimum runtime = 10
	exit timeout = 5
	runs = 103
	pid = 17594
	immediate reason = inefficient
	forks = 0
	execs = 1
	initialized = 1
	trampolined = 1
	started suspended = 0
	proxy started suspended = 0
	checked allocations = 0 (queried = 1)
	checked allocations reason = no host
	checked allocations flags = 0x0
	last terminating signal = Terminated: 15

	resource coalition = {
		ID = 9196
		type = resource
		state = active
		active count = 1
		name = com.mattstack.deck.chat
	}

	jetsam coalition = {
		ID = 9197
		type = jetsam
		state = active
		active count = 1
		name = com.mattstack.deck.chat
	}

	spawn type = daemon (3)
	jetsam priority = 40
	jetsam memory limit (active) = (unlimited)
	jetsam memory limit (inactive) = (unlimited)
	jetsamproperties category = daemon
	submitted job. ignore execute allowed
	jetsam thread limit = 32
	cpumon = default

	properties = keepalive | runatload | inferred program
}
```

`rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-args.txt`:

```text
gui/501/com.mattstack.deck.mattari = {
	active count = 1
	path = /Users/tester/Library/LaunchAgents/com.mattstack.deck.mattari.plist
	type = LaunchAgent
	state = running

	program = /Users/tester/.bun/bin/bun
	arguments = {
		/Users/tester/.bun/bin/bun
		server/index.ts
	}

	working directory = /Users/tester/Documents/GitHub/mattari/apps/api

	stdout path = /Users/tester/.mattstack/deck/logs/mattari.out.log
	stderr path = /Users/tester/.mattstack/deck/logs/mattari.err.log
	inherited environment = {
		SSH_AUTH_SOCK => /var/run/com.apple.launchd.TzpwIuqAEF/Listeners
	}

	default environment = {
		PATH => /usr/bin:/bin:/usr/sbin:/sbin
	}

	environment = {
		OSLogRateLimit => 64
		PORT => 11010
		API_PORT => 11010
		SERVE_STATIC => 1
		PATH => /Users/tester/.local/bin:/Users/tester/.bun/bin:/Users/tester/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
		XPC_SERVICE_NAME => com.mattstack.deck.mattari
	}

	domain = gui/501 [100057]
	asid = 100057
	minimum runtime = 10
	exit timeout = 5
	runs = 1
	pid = 3246
	immediate reason = speculative
	forks = 0
	execs = 1
	initialized = 1
	trampolined = 1
	started suspended = 0
	proxy started suspended = 0
	checked allocations = 0 (queried = 1)
	checked allocations reason = no host
	checked allocations flags = 0x0
	last exit code = (never exited)

	resource coalition = {
		ID = 1622
		type = resource
		state = active
		active count = 1
		name = com.mattstack.deck.mattari
	}

	jetsam coalition = {
		ID = 1623
		type = jetsam
		state = active
		active count = 1
		name = com.mattstack.deck.mattari
	}

	spawn type = daemon (3)
	jetsam priority = 40
	jetsam memory limit (active) = (unlimited)
	jetsam memory limit (inactive) = (unlimited)
	jetsamproperties category = daemon
	jetsam thread limit = 32
	cpumon = default

	properties = keepalive | runatload | inferred program | managed LWCR | has LWCR
}
```

`rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-missing.txt`:

```text
Bad request.
Could not find service "com.mattstack.deck.nosuchapp" in domain for user gui: 501
```

Check the tabs survived:

Run: `grep -c "$(printf '^\tprogram = ')" rt-tray/vm/run/helpers/__tests__/fixtures/launchctl-print-chat.txt`
Expected: `1`.

- [ ] **Step 2: Write the shared jq runner** `rt-tray/vm/run/helpers/__tests__/jq.ts`:

```ts
import { join } from "path";

export const GUEST_DIR = join(import.meta.dir, "..", "..", "guest");
export const JQ_DIR = join(GUEST_DIR, "jq");
export const FIXTURES = join(import.meta.dir, "fixtures");

// The guest runs the bundle's jq (deps.lock pins 1.8.x) while the host has
// macOS's 1.7.x; VM_TEST_JQ runs these suites under the bundled one. A missing
// jq fails the suite rather than skipping it.
export function jqBin(): string {
  const bin = process.env.VM_TEST_JQ || Bun.which("jq");
  if (!bin) throw new Error("jq is not on PATH: the guest parsers are jq programs, so these tests need one (macOS ships /usr/bin/jq)");
  return bin;
}

export function runJq(args: string[], stdin = ""): string {
  const r = Bun.spawnSync([jqBin(), ...args], { stdin: Buffer.from(stdin) });
  if (r.exitCode !== 0) throw new Error(`jq ${args.join(" ")} exited ${r.exitCode}: ${r.stderr.toString()}`);
  return r.stdout.toString();
}
```

- [ ] **Step 3: Write the failing test** `rt-tray/vm/run/helpers/__tests__/launchctl-print.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { FIXTURES, JQ_DIR, runJq } from "./jq.ts";

const PARSER = join(JQ_DIR, "launchctl-print.jq");
const parse = (text: string) => JSON.parse(runJq(["-R", "-s", "-c", "-f", PARSER], text));
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

describe("launchctl-print.jq", () => {
  test("a running deck-written LaunchAgent: program, argv, working directory, pid", () => {
    expect(parse(fixture("launchctl-print-chat.txt"))).toEqual({
      loaded: true,
      program: "/Applications/mattstack.app/Contents/Helpers/chat",
      argv: ["/Applications/mattstack.app/Contents/Helpers/chat"],
      cwd: "/Users/tester/.mattstack/chat",
      pid: 17594,
      lastExit: null,
    });
  });

  test("every argument line is kept in order, and nested environment blocks never leak in", () => {
    const job = parse(fixture("launchctl-print-args.txt"));
    expect(job.argv).toEqual(["/Users/tester/.bun/bin/bun", "server/index.ts"]);
    expect(job.cwd).toBe("/Users/tester/Documents/GitHub/mattari/apps/api");
    expect(job.pid).toBe(3246);
    expect(job.lastExit).toBe("(never exited)");
  });

  test("an unknown label reads as not loaded", () => {
    expect(parse(fixture("launchctl-print-missing.txt"))).toEqual({
      loaded: false, program: null, argv: [], cwd: null, pid: null, lastExit: null,
    });
  });

  test("empty output reads as not loaded rather than erroring", () => {
    expect(parse("").loaded).toBe(false);
  });

  // Derived from the chat capture: the shape launchd prints for a job that
  // refused to spawn (exit 78) and is waiting to retry, with no pid line.
  test("a loaded job with no pid keeps its last exit code", () => {
    const refused = fixture("launchctl-print-chat.txt")
      .replace(/\n\tpid = \d+\n/, "\n")
      .replace("\tstate = running", "\tstate = spawn scheduled")
      .replace("\tlast terminating signal = Terminated: 15", "\tlast exit code = 78: EX_CONFIG");
    const job = parse(refused);
    expect(job.loaded).toBe(true);
    expect(job.pid).toBeNull();
    expect(job.lastExit).toBe("78: EX_CONFIG");
  });
});
```

- [ ] **Step 4: Run it and see it fail.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/launchctl-print.test.ts`
Expected: 5 fail, each with `jq -R -s -c -f .../launchctl-print.jq exited 2: jq: error: Could not open .../launchctl-print.jq`.

- [ ] **Step 5: Implement** `rt-tray/vm/run/guest/jq/launchctl-print.jq`:

```jq
# Input: `launchctl print gui/<uid>/<label>` read raw (jq -R -s).
# Top-level keys sit one tab deep and nested blocks (environment, coalitions)
# two deep, so a one-tab prefix match never reads a nested key.
split("\n") as $lines
| def top($k):
    ($lines | map(select(startswith("\t" + $k + " = "))) | first)
    | if . == null then null else ltrimstr("\t" + $k + " = ") end;
  def argv:
    ($lines | index("\targuments = {")) as $i
    | if $i == null then []
      else $lines[$i + 1:] as $rest
        | ($rest | index("\t}")) as $j
        | $rest[: ($j // ($rest | length))] | map(ltrimstr("\t\t"))
      end;
  { loaded: (($lines[0] // "") | endswith(" = {")),
    program: top("program"),
    argv: argv,
    cwd: top("working directory"),
    pid: (top("pid") | if . == null then null else tonumber end),
    lastExit: top("last exit code") }
```

- [ ] **Step 6: Run it and see it pass.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/launchctl-print.test.ts`
Expected: `5 pass, 0 fail`.

- [ ] **Step 7: Put the suite in the offline gate.** In `rt-tray/vm/check-vm-scripts.sh`, directly after line 11 (`t "appcast-server.test.ts" ...`), add:

```bash
t "launchctl-print.test.ts"      bun test run/helpers/__tests__/launchctl-print.test.ts
```

Run: `bunx tsc --noEmit`
Expected: exits 0 with no output.

- [ ] **Step 8: Commit.**

```
git add rt-tray/vm/run/guest/jq/launchctl-print.jq rt-tray/vm/run/helpers/__tests__/jq.ts rt-tray/vm/run/helpers/__tests__/launchctl-print.test.ts rt-tray/vm/run/helpers/__tests__/fixtures rt-tray/vm/check-vm-scripts.sh
git commit -m "vm: parse launchctl print in jq for the guest assert" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `catalog.jq`, the expected set from `deps.lock`

**Files:**
- Create: `rt-tray/vm/run/helpers/__tests__/catalog.test.ts`
- Create: `rt-tray/vm/run/guest/jq/catalog.jq`
- Modify: `rt-tray/vm/check-vm-scripts.sh` (after the Task 1 line)

**Interfaces:**
- Consumes: `runJq`, `JQ_DIR` from Task 1; the `serve` row field `{ "port": <integer>, "args": [<string>...] }` (shared contract 1, unit A).
- Produces: `jq -c -f rt-tray/vm/run/guest/jq/catalog.jq <deps.lock>` prints `{"apps": [{"name","status","port","args"}...] sorted by name in codepoint order, "tools": [name...] sorted}`. `apps` are `kind: "helper"` rows whose `serve` is an object; `tools` are every other helper row; buildtool rows are in neither. A pending serve row stays in `apps` with its status.

- [ ] **Step 1: Write the failing test** `rt-tray/vm/run/helpers/__tests__/catalog.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { JQ_DIR, runJq } from "./jq.ts";

const CATALOG = join(JQ_DIR, "catalog.jq");
const catalog = (tools: unknown[]) => JSON.parse(runJq(["-c", "-f", CATALOG], JSON.stringify({ schema: 1, arch: "arm64", tools })));
const row = (name: string, extra: Record<string, unknown> = {}) => ({ name, kind: "helper", status: "bundled", ...extra });

describe("catalog.jq", () => {
  test("helper rows with serve are apps, sorted by name; other helper rows are tools; buildtools are neither", () => {
    expect(catalog([
      row("jq"),
      row("chat", { serve: { port: 11002, args: [] } }),
      row("gitq"),
      row("board", { serve: { port: 11006, args: ["--quiet"] } }),
      { name: "sparkle", kind: "buildtool", status: "bundled" },
    ])).toEqual({
      apps: [
        { name: "board", status: "bundled", port: 11006, args: ["--quiet"] },
        { name: "chat", status: "bundled", port: 11002, args: [] },
      ],
      tools: ["gitq", "jq"],
    });
  });

  test("a pending serve row stays an app and keeps its status for the verdict to judge", () => {
    expect(catalog([row("boxscore", { status: "pending", serve: { port: 11005, args: [] } })]).apps)
      .toEqual([{ name: "boxscore", status: "pending", port: 11005, args: [] }]);
  });

  test("serve with no args means no args, and serve: null is a tool", () => {
    const c = catalog([row("console", { serve: { port: 11001 } }), row("deck", { serve: null })]);
    expect(c.apps).toEqual([{ name: "console", status: "bundled", port: 11001, args: [] }]);
    expect(c.tools).toEqual(["deck"]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/catalog.test.ts`
Expected: 3 fail with `Could not open .../catalog.jq`.

- [ ] **Step 3: Implement** `rt-tray/vm/run/guest/jq/catalog.jq`:

```jq
# Input: deps.lock. A helper row carrying "serve" is a bundled app, any other
# helper row a tool. Parity twin: parseDepsLock in lib/bundle-layout.ts,
# pinned by scripts/lib/__tests__/vm-served-catalog.test.ts.
[.tools[] | select(.kind == "helper")] as $helpers
| { apps: ([$helpers[] | select((.serve | type) == "object")
            | { name, status, port: .serve.port, args: (.serve.args // []) }]
           | sort_by(.name)),
    tools: ([$helpers[] | select((.serve | type) != "object") | .name] | sort) }
```

- [ ] **Step 4: Run it and see it pass.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/catalog.test.ts`
Expected: `3 pass, 0 fail`.

Run: `jq -c -f rt-tray/vm/run/guest/jq/catalog.jq rt-tray/deps.lock`
Expected: `tools` lists every helper row of the shipped lock and `apps` lists exactly the rows that carry `serve` (empty until the deps.lock serve rows land; that is fine here, and the assert itself fails on an empty catalog by design).

- [ ] **Step 5: Gate and commit.** In `rt-tray/vm/check-vm-scripts.sh`, after the Task 1 line, add:

```bash
t "catalog.test.ts"              bun test run/helpers/__tests__/catalog.test.ts
```

```
git add rt-tray/vm/run/guest/jq/catalog.jq rt-tray/vm/run/helpers/__tests__/catalog.test.ts rt-tray/vm/check-vm-scripts.sh
git commit -m "vm: derive the served-app catalog from deps.lock in jq" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `served-verdict.jq`, the pure verdict

**Files:**
- Create: `rt-tray/vm/run/helpers/__tests__/fixtures/deck-status-dev-lived.json`
- Create: `rt-tray/vm/run/helpers/__tests__/served-verdict.test.ts`
- Create: `rt-tray/vm/run/guest/jq/served-verdict.jq`
- Modify: `rt-tray/vm/check-vm-scripts.sh` (after the Task 2 line)

**Interfaces:**
- Consumes: Task 1's job record shape, Task 2's catalog shape, deck's `Status`/`StatusRow` (`apps/deck/src/api/status.ts:57-136`), portless `routes.json` (`[{ hostname, port, pid }]`).
- Produces: `jq -r -n --slurpfile catalog <f> --slurpfile status <f> --slurpfile launchd <f> --slurpfile routes <f> --arg helpers <app>/Contents/Helpers --arg home <HOME> -f served-verdict.jq`, where `status` and `routes` files may hold `null` and `launchd` is `{ "<name>": <job record> }` covering every catalog app and tool. Prints one `ok<TAB>msg` or `bad<TAB>msg` line per assertion. Exact messages are the ones the test pins.

- [ ] **Step 1: Write the fixture** `rt-tray/vm/run/helpers/__tests__/fixtures/deck-status-dev-lived.json`. It is a real `GET /api/v1/status` from a Mac that lived in dev mode and then opened prod 2.12.0, trimmed to `devMode`, `up`, `total` and, per row, `name`, `displayTld`, `port`, `url`, `health`, `service` (`label`, `pid`, `lastExitStatus`), `managedBy`, `issues`. Its rows carry no `icon` field, so the verdict reports every catalog app in it as missing its icon; the test pins that alongside boxscore's dev-link issue:

```json
{
  "devMode": false,
  "up": 9,
  "total": 10,
  "apps": [
    {"name":"gitq","displayTld":"localhost","port":11008,"url":"https://gitq.localhost","health":{"ok":false,"status":null,"ms":null},"service":{"label":"com.mattstack.deck.gitq-docs","pid":3238,"lastExitStatus":null},"managedBy":null,"issues":[]},
    {"name":"mantine-kit","displayTld":"localhost","port":11003,"url":"https://mantine-kit.localhost","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.mantine-kit","pid":4096,"lastExitStatus":null},"managedBy":"user","issues":[]},
    {"name":"gitq-docs","displayTld":"localhost","port":11009,"url":"https://gitq-docs.localhost","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.gitq-docs","pid":3238,"lastExitStatus":null},"managedBy":"user","issues":[]},
    {"name":"training","displayTld":"localhost","port":11000,"url":"https://training.localhost","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.training","pid":3228,"lastExitStatus":null},"managedBy":"user","issues":[]},
    {"name":"mattari","displayTld":"localhost","port":11010,"url":"https://mattari.localhost","health":{"ok":true,"status":200,"ms":2},"service":{"label":"com.mattstack.deck.mattari","pid":3246,"lastExitStatus":null},"managedBy":"user","issues":[]},
    {"name":"chat","displayTld":"mattstack","port":11002,"url":"https://chat.mattstack","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.chat","pid":17594,"lastExitStatus":null},"managedBy":"rt","issues":[]},
    {"name":"boxscore","displayTld":"mattstack","port":11005,"url":"https://boxscore.mattstack","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.boxscore","pid":77958,"lastExitStatus":null},"managedBy":"rt","issues":[{"source":"dev-link","message":"bundle for boxscore not installed; serving source","at":"2026-09-25T04:02:14.285Z"}]},
    {"name":"deck","displayTld":"mattstack","port":7940,"url":"https://deck.mattstack","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.gitq-docs","pid":3238,"lastExitStatus":null},"managedBy":"deck","issues":[]},
    {"name":"board","displayTld":"mattstack","port":11006,"url":"https://board.mattstack","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.board","pid":77964,"lastExitStatus":null},"managedBy":"rt","issues":[]},
    {"name":"console","displayTld":"mattstack","port":11001,"url":"https://console.mattstack","health":{"ok":true,"status":200,"ms":1},"service":{"label":"com.mattstack.deck.console","pid":77968,"lastExitStatus":null},"managedBy":"rt","issues":[]}
  ]
}
```

- [ ] **Step 2: Write the failing test** `rt-tray/vm/run/helpers/__tests__/served-verdict.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FIXTURES, JQ_DIR, runJq } from "./jq.ts";

const VERDICT = join(JQ_DIR, "served-verdict.jq");
const HOME = "/Users/tester";
const HELPERS = "/Applications/mattstack.app/Contents/Helpers";

interface CatalogApp { name: string; status: string; port: number; args: string[] }
interface Job { loaded: boolean; program: string | null; argv: string[]; cwd: string | null; pid: number | null; lastExit: string | null }

const PROD_APPS: CatalogApp[] = [
  { name: "board", status: "bundled", port: 11006, args: [] },
  { name: "boxscore", status: "bundled", port: 11005, args: [] },
  { name: "chat", status: "bundled", port: 11002, args: [] },
  { name: "console", status: "bundled", port: 11001, args: [] },
];
const TOOLS = ["deck", "gitq", "jq"];

// Field names and nesting follow deck's StatusRow (apps/deck/src/api/status.ts);
// `icon` is the URL deck 1.1.0 advertises once a bundled identity resolves.
function row(name: string, over: Record<string, unknown> = {}) {
  return {
    name, displayTld: "mattstack", url: `https://${name}.mattstack`, icon: `/api/apps/${name}/icon`,
    health: { ok: true, status: 200, ms: 1 }, managedBy: "rt", issues: [], ...over,
  };
}
function job(app: CatalogApp, over: Partial<Job> = {}): Job {
  const bin = `${HELPERS}/${app.name}`;
  return { loaded: true, program: bin, argv: [bin, ...app.args], cwd: `${HOME}/.mattstack/${app.name}`, pid: 4242, lastExit: null, ...over };
}
const notLoaded: Job = { loaded: false, program: null, argv: [], cwd: null, pid: null, lastExit: null };

interface Case {
  apps?: CatalogApp[];
  tools?: string[];
  status?: unknown;
  launchd?: Record<string, Job>;
  routes?: unknown;
}

function verdict(c: Case = {}): { kind: string; msg: string }[] {
  const apps = c.apps ?? PROD_APPS;
  const tools = c.tools ?? TOOLS;
  const status = c.status !== undefined ? c.status : { devMode: false, apps: apps.map((a) => row(a.name)) };
  const launchd = c.launchd ?? {
    ...Object.fromEntries(apps.map((a) => [a.name, job(a)])),
    ...Object.fromEntries(tools.map((t) => [t, notLoaded])),
  };
  const routes = c.routes !== undefined ? c.routes : apps.map((a) => ({ hostname: `${a.name}.mattstack`, port: a.port, pid: 0 }));
  const dir = mkdtempSync(join(tmpdir(), "served-verdict-"));
  const file = (n: string, v: unknown) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(v)); return p; };
  const out = runJq([
    "-r", "-n",
    "--slurpfile", "catalog", file("catalog.json", { apps, tools }),
    "--slurpfile", "status", file("status.json", status),
    "--slurpfile", "launchd", file("launchd.json", launchd),
    "--slurpfile", "routes", file("routes.json", routes),
    "--arg", "helpers", HELPERS, "--arg", "home", HOME,
    "-f", VERDICT,
  ]);
  return out.trimEnd().split("\n").map((l) => {
    const [kind, ...rest] = l.split("\t");
    return { kind: kind!, msg: rest.join("\t") };
  });
}
const bads = (lines: { kind: string; msg: string }[]) => lines.filter((l) => l.kind === "bad").map((l) => l.msg);

describe("served-verdict.jq", () => {
  test("the healthy prod set passes with no bad line, and every catalog app is named", () => {
    const lines = verdict();
    expect(lines.every((l) => l.kind === "ok" || l.kind === "bad")).toBe(true);
    expect(bads(lines)).toEqual([]);
    for (const a of PROD_APPS) expect(lines.some((l) => l.msg.startsWith(`${a.name}: running`))).toBe(true);
    expect(lines.some((l) => l.msg.startsWith("no deps.lock tool is loaded as a deck app"))).toBe(true);
  });

  test("an empty catalog is one bad line, never a vacuous pass", () => {
    expect(verdict({ apps: [] })).toEqual([{ kind: "bad", msg: "deps.lock names no served apps: no helper row carries serve" }]);
  });

  test("deck not answering is one bad line", () => {
    expect(bads(verdict({ status: null }))).toEqual(["deck /api/v1/status did not answer with an apps list"]);
  });

  test("a pending serve row fails: the catalog names an app this bundle does not ship", () => {
    const apps = PROD_APPS.map((a) => (a.name === "boxscore" ? { ...a, status: "pending" } : a));
    expect(bads(verdict({ apps }))).toEqual(["boxscore: deps.lock serves it but its row is pending, so this bundle does not ship it"]);
  });

  test("a missing row, a user-owned row, and devMode each fail", () => {
    const status = { devMode: true, apps: [row("board"), row("chat", { managedBy: "user" }), row("console")] };
    expect(bads(verdict({ status }))).toEqual([
      "deck reports devMode true inside the prod bundle",
      "boxscore: no row in deck /api/v1/status (not registered, or no route)",
      'chat: managedBy is "user", wanted "rt"',
    ]);
  });

  test("a live pid is not health: an app whose probe fails is bad even while launchd holds a pid", () => {
    const status = { devMode: false, apps: PROD_APPS.map((a) => (a.name === "board" ? row("board", { health: { ok: false, status: null, ms: null } }) : row(a.name))) };
    expect(bads(verdict({ status }))).toEqual(['board: unhealthy: {"ok":false,"status":null,"ms":null}']);
  });

  test("an app whose status row advertises no icon fails: its bundled identity is missing", () => {
    const status = { devMode: false, apps: PROD_APPS.map((a) => (a.name === "chat" ? row("chat", { icon: null }) : row(a.name))) };
    expect(bads(verdict({ status }))).toEqual(["chat: no icon on its deck status row (bundled identity missing)"]);
  });

  test("the real dev-lived capture reports boxscore serving source and every app without its icon", () => {
    const status = JSON.parse(readFileSync(join(FIXTURES, "deck-status-dev-lived.json"), "utf8"));
    expect(bads(verdict({ status }))).toEqual([
      "board: no icon on its deck status row (bundled identity missing)",
      "boxscore: dev-link issue: bundle for boxscore not installed; serving source",
      "boxscore: no icon on its deck status row (bundled identity missing)",
      "chat: no icon on its deck status row (bundled identity missing)",
      "console: no icon on its deck status row (bundled identity missing)",
    ]);
  });

  test("argv0 under the dev bundle, missing serve args, a wrong cwd and a refused spawn each fail", () => {
    const [board, boxscore, chat, consoleApp] = PROD_APPS as [CatalogApp, CatalogApp, CatalogApp, CatalogApp];
    const devBin = "/Applications/mattstack-dev.app/Contents/Helpers/board";
    const apps = PROD_APPS.map((a) => (a.name === "chat" ? { ...a, args: ["serve"] } : a));
    const launchd = {
      board: job(board, { program: devBin, argv: [devBin] }),
      boxscore: job(boxscore, { cwd: `${HOME}/Documents/GitHub/mattstack-apps/apps/boxscore` }),
      chat: job(chat),
      console: job(consoleApp, { pid: null, lastExit: "78: EX_CONFIG" }),
      deck: notLoaded, gitq: notLoaded, jq: notLoaded,
    };
    expect(bads(verdict({ apps, launchd }))).toEqual([
      `board: argv0 is "${devBin}", wanted ${HELPERS}/board`,
      `board: argv is ["${devBin}"], wanted ["${HELPERS}/board"]`,
      `boxscore: working directory is "${HOME}/Documents/GitHub/mattstack-apps/apps/boxscore", wanted ${HOME}/.mattstack/boxscore`,
      `chat: argv is ["${HELPERS}/chat"], wanted ["${HELPERS}/chat","serve"]`,
      "console: loaded but not running (last exit 78: EX_CONFIG)",
    ]);
  });

  // deck joins a route to a service by label substring (core/discover.ts
  // joinApps), so a row's own `service` can belong to another app entirely.
  test("an app with no launchd job fails by its exact label, whatever service the status row claims", () => {
    const status = {
      devMode: false,
      apps: PROD_APPS.map((a) => (a.name === "console" ? row("console", { service: { label: "com.mattstack.deck.console-docs", pid: 3238 } }) : row(a.name))),
    };
    const launchd = { ...Object.fromEntries(PROD_APPS.map((a) => [a.name, job(a)])), console: notLoaded };
    expect(bads(verdict({ status, launchd }))).toEqual(["console: com.mattstack.deck.console is not loaded in launchd"]);
  });

  test("a tool loaded as a deck app fails by name: the gitq CLI is never a served app", () => {
    const launchd = {
      ...Object.fromEntries(PROD_APPS.map((a) => [a.name, job(a)])),
      deck: notLoaded, jq: notLoaded,
      gitq: { loaded: true, program: `${HELPERS}/gitq`, argv: [`${HELPERS}/gitq`], cwd: `${HOME}/.mattstack/gitq`, pid: 99, lastExit: "1" },
    };
    expect(bads(verdict({ launchd }))).toEqual(["com.mattstack.deck.gitq is loaded, but deps.lock ships gitq as a tool, never an app"]);
  });

  test("an app without its .mattstack route fails", () => {
    const routes = [{ hostname: "board.localhost", port: 11006, pid: 0 }, ...PROD_APPS.filter((a) => a.name !== "board").map((a) => ({ hostname: `${a.name}.mattstack`, port: a.port, pid: 0 }))];
    expect(bads(verdict({ routes }))).toEqual(["board: no board.mattstack route in ~/.portless/routes.json"]);
  });
});
```

- [ ] **Step 3: Run it and see it fail.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/served-verdict.test.ts`
Expected: 12 fail with `Could not open .../served-verdict.jq`.

- [ ] **Step 4: Implement** `rt-tray/vm/run/guest/jq/served-verdict.jq`:

```jq
# jq -r -n --slurpfile catalog <catalog.jq output> --slurpfile status <deck
#   /api/v1/status or null> --slurpfile launchd <{name: launchctl-print.jq}>
#   --slurpfile routes <~/.portless/routes.json or null>
#   --arg helpers <app>/Contents/Helpers --arg home <$HOME>
# Prints one "ok<TAB>msg" or "bad<TAB>msg" line per assertion.
def ok($m): "ok\t" + $m;
def bad($m): "bad\t" + $m;
def deck_label($n): "com.mattstack.deck." + $n;

($catalog[0] // {apps: [], tools: []}) as $cat
| ($status[0]) as $st
| ($launchd[0] // {}) as $ld
| ([($routes[0] // [])[]?.hostname]) as $hosts
| if ($cat.apps | length) == 0 then
    bad("deps.lock names no served apps: no helper row carries serve")
  elif ($st | type) != "object" or ($st.apps | type) != "array" then
    bad("deck /api/v1/status did not answer with an apps list")
  else
    (if $st.devMode == false then ok("deck reports the prod flavor (devMode false)")
     else bad("deck reports devMode \($st.devMode | tojson) inside the prod bundle") end),
    ( $cat.apps[] as $a
      | "\($helpers)/\($a.name)" as $bin
      | ([$st.apps[] | select(.name == $a.name)] | first) as $row
      | ($ld[$a.name] // {loaded: false}) as $job
      | if $a.status != "bundled" then
          bad("\($a.name): deps.lock serves it but its row is \($a.status), so this bundle does not ship it")
        elif $row == null then
          bad("\($a.name): no row in deck /api/v1/status (not registered, or no route)")
        else
          (if $row.managedBy == "rt" then ok("\($a.name): rt-managed")
           else bad("\($a.name): managedBy is \($row.managedBy | tojson), wanted \"rt\"") end),
          (if $row.health.ok == true then ok("\($a.name): healthy (HTTP \($row.health.status))")
           else bad("\($a.name): unhealthy: \($row.health | tojson)") end),
          ([$row.issues[]? | select(.source == "dev-link") | .message] as $dl
           | if ($dl | length) == 0 then ok("\($a.name): no dev-link issues")
             else bad("\($a.name): dev-link issue: \($dl | join("; "))") end),
          (if ($row.icon // null) != null then ok("\($a.name): advertises an icon")
           else bad("\($a.name): no icon on its deck status row (bundled identity missing)") end),
          (if ($hosts | index("\($a.name).mattstack")) != null then ok("\($a.name): routed as \($a.name).mattstack")
           else bad("\($a.name): no \($a.name).mattstack route in ~/.portless/routes.json") end),
          (if $job.loaded != true then
             bad("\($a.name): \(deck_label($a.name)) is not loaded in launchd")
           else
             (if $job.program == $bin then ok("\($a.name): argv0 is \($bin)")
              else bad("\($a.name): argv0 is \($job.program | tojson), wanted \($bin)") end),
             (if $job.argv == [$bin] + $a.args then ok("\($a.name): argv matches deps.lock serve.args")
              else bad("\($a.name): argv is \($job.argv | tojson), wanted \([$bin] + $a.args | tojson)") end),
             (if $job.cwd == "\($home)/.mattstack/\($a.name)" then ok("\($a.name): working directory \($job.cwd)")
              else bad("\($a.name): working directory is \($job.cwd | tojson), wanted \($home)/.mattstack/\($a.name)") end),
             (if $job.pid != null then ok("\($a.name): running (pid \($job.pid))")
              else bad("\($a.name): loaded but not running (last exit \($job.lastExit // "unknown"))") end)
           end)
        end ),
    ( [$cat.tools[] | select(($ld[.] // {loaded: false}).loaded == true)] as $served_tools
      | if ($served_tools | length) == 0 then
          ok("no deps.lock tool is loaded as a deck app (checked \($cat.tools | length))")
        else
          $served_tools[] | bad("\(deck_label(.)) is loaded, but deps.lock ships \(.) as a tool, never an app")
        end )
  end
```

- [ ] **Step 5: Run it and see it pass.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/served-verdict.test.ts`
Expected: `12 pass, 0 fail`.

- [ ] **Step 6: Prove the guest's jq agrees.** The installed prod bundle on this Mac ships the same jq the guest runs.

Run: `/Applications/mattstack.app/Contents/Helpers/jq --version`
Expected: `jq-1.8.2` (if the file is missing, say so in your report and skip the next command; never build or copy a bundle to get one).

Run: `env VM_TEST_JQ=/Applications/mattstack.app/Contents/Helpers/jq bun test rt-tray/vm/run/helpers/__tests__/`
Expected: every suite so far passes (20 tests plus appcast-server's 2).

- [ ] **Step 7: Gate and commit.** In `rt-tray/vm/check-vm-scripts.sh`, after the Task 2 line, add:

```bash
t "served-verdict.test.ts"       bun test run/helpers/__tests__/served-verdict.test.ts
```

Run: `bunx tsc --noEmit`
Expected: exits 0.

```
git add rt-tray/vm/run/guest/jq/served-verdict.jq rt-tray/vm/run/helpers/__tests__/served-verdict.test.ts rt-tray/vm/run/helpers/__tests__/fixtures/deck-status-dev-lived.json rt-tray/vm/check-vm-scripts.sh
git commit -m "vm: judge deck's served apps against the bundle catalog in jq" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `served-apps.sh`, the sourced guest helper

**Files:**
- Create: `rt-tray/vm/run/helpers/__tests__/served-apps-sh.test.ts`
- Create: `rt-tray/vm/run/guest/served-apps.sh`
- Modify: `rt-tray/vm/check-vm-scripts.sh` (after the Task 3 line)

**Interfaces:**
- Consumes: the three jq programs (Tasks 1 to 3); from the caller, the functions `ok <msg>` and `bad <msg>` (the latter increments the caller's `fails`), and the variables `LOGS` and `HOME`.
- Produces:
  - `assert_served_apps <log-name> <timeout-s>`: reads `$SERVED_APP/Contents/Resources/deps.lock`, polls every `$SERVED_POLL_S` seconds until the verdict has no `bad` line or `<timeout-s>` passes (0 means one pass), then replays the last verdict through `ok`/`bad`. Evidence in `$LOGS/<log-name>/` (`catalog.json`, `status.raw`, `status.json`, `routes.json`, `launchd.json`, `launchctl-<name>.txt`).
  - `assert_mattstack_routes <trusted|untrusted> <log-name>`: one `ok`/`bad` per `.mattstack` hostname in `~/.portless/routes.json` (two per host when `untrusted`), or one `bad` when there is none; copies the table to `$LOGS/<log-name>-routes.json`.
  - Seams, read at source time: `SERVED_APP` (default `/Applications/mattstack.app`), `SERVED_CURL` (default `curl`), `SERVED_LAUNCHCTL` (default `launchctl`), `SERVED_POLL_S` (default `5`).

- [ ] **Step 1: Write the failing test** `rt-tray/vm/run/helpers/__tests__/served-apps-sh.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { GUEST_DIR, jqBin } from "./jq.ts";

const SERVED = join(GUEST_DIR, "served-apps.sh");
const APPS = [
  { name: "board", port: 11006 },
  { name: "chat", port: 11002 },
];

interface World {
  root: string;
  home: string;
  app: string;
  calls: string;
  env: Record<string, string>;
}

function lockRow(name: string, serve?: { port: number; args: string[] }) {
  return {
    name, version: "1.0.0", license: "MIT", url: "https://example.com/x.tgz", sha256: "a".repeat(64),
    archive: "tar.gz", extract: name, bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`],
    exposeByDefault: false, entitlements: "jit", status: "bundled", kind: "helper", ...(serve ? { serve } : {}),
  };
}

// A fake bundle, HOME, launchctl and curl: the stubs answer from files under
// root and append every call to root/calls so a test can see what ran.
function world(opts: { statusFailures?: number; deadHosts?: string[]; withLock?: boolean } = {}): World {
  const root = mkdtempSync(join(tmpdir(), "served-apps-sh-"));
  const home = join(root, "home");
  const app = join(root, "mattstack.app");
  const calls = join(root, "calls");
  mkdirSync(join(app, "Contents", "Helpers"), { recursive: true });
  mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
  mkdirSync(join(home, ".mattstack", "deck"), { recursive: true });
  mkdirSync(join(home, ".portless"), { recursive: true });
  mkdirSync(join(root, "launchd"), { recursive: true });
  symlinkSync(jqBin(), join(app, "Contents", "Helpers", "jq"));
  if (opts.withLock !== false) {
    writeFileSync(join(app, "Contents", "Resources", "deps.lock"), JSON.stringify({
      schema: 1, arch: "arm64",
      tools: [...APPS.map((a) => lockRow(a.name, { port: a.port, args: [] })), lockRow("gitq")],
    }));
  }
  writeFileSync(join(home, ".mattstack", "deck", "api.json"), JSON.stringify({ port: 7940, pid: 1, runMode: "standalone" }));
  writeFileSync(join(home, ".portless", "routes.json"), JSON.stringify([
    ...APPS.map((a) => ({ hostname: `${a.name}.mattstack`, port: a.port, pid: 0 })),
    { hostname: "deck.mattstack", port: 7940, pid: 0 },
    { hostname: "board.localhost", port: 11006, pid: 0 },
  ]));
  writeFileSync(join(root, "status.json"), JSON.stringify({
    devMode: false,
    apps: APPS.map((a) => ({ name: a.name, url: `https://${a.name}.mattstack`, icon: `/api/apps/${a.name}/icon`, health: { ok: true, status: 200, ms: 1 }, managedBy: "rt", issues: [] })),
  }));
  for (const a of APPS) {
    const bin = join(app, "Contents", "Helpers", a.name);
    writeFileSync(join(root, "launchd", `com.mattstack.deck.${a.name}`),
      `gui/501/com.mattstack.deck.${a.name} = {\n\tstate = running\n\n\tprogram = ${bin}\n\targuments = {\n\t\t${bin}\n\t}\n\n\tworking directory = ${home}/.mattstack/${a.name}\n\n\tpid = 4242\n}\n`);
  }
  writeFileSync(join(root, "status-failures"), String(opts.statusFailures ?? 0));
  writeFileSync(join(root, "dead-hosts"), (opts.deadHosts ?? []).join("\n") + "\n");
  const launchctl = join(root, "launchctl");
  writeFileSync(launchctl, `#!/bin/bash
echo "launchctl $*" >> "${calls}"
label="\${2##*/}"
if [ -f "${root}/launchd/$label" ]; then cat "${root}/launchd/$label"; exit 0; fi
echo "Bad request."; echo "Could not find service \\"$label\\" in domain for user gui: 501"; exit 113
`);
  const curl = join(root, "curl");
  writeFileSync(curl, `#!/bin/bash
url="\${@: -1}"
echo "curl $url" >> "${calls}"
case "$url" in
  */api/v1/status)
    n=$(cat "${root}/status-failures")
    if [ "$n" -gt 0 ]; then echo $((n - 1)) > "${root}/status-failures"; exit 7; fi
    cat "${root}/status.json";;
  https://*)
    host="\${url#https://}"
    grep -qx "$host" "${root}/dead-hosts" && exit 22
    echo ok;;
  *) exit 2;;
esac
`);
  chmodSync(launchctl, 0o755);
  chmodSync(curl, 0o755);
  return {
    root, home, app, calls,
    env: { HOME: home, PATH: "/usr/bin:/bin", SERVED_APP: app, SERVED_CURL: curl, SERVED_LAUNCHCTL: launchctl, SERVED_POLL_S: "1" },
  };
}

// Sources the helper the way the guest scripts do: the caller owns ok/bad and
// the fails counter, and the counter has to survive the helper's loops.
function run(w: World, body: string): { out: string; fails: number } {
  const script = `
set -uo pipefail
LOGS="${w.root}/logs"; mkdir -p "$LOGS"
fails=0
ok()  { echo "ASSERT ok   $1"; }
bad() { echo "ASSERT FAIL $1"; fails=$((fails+1)); }
source "${SERVED}"
${body}
echo "FAILS=$fails"
`;
  const r = Bun.spawnSync(["/bin/bash", "-c", script], { env: w.env });
  const out = r.stdout.toString() + r.stderr.toString();
  const m = out.match(/FAILS=(\d+)/);
  if (!m) throw new Error(`no FAILS line:\n${out}`);
  return { out, fails: Number(m[1]) };
}
const calls = (w: World) => (existsSync(w.calls) ? readFileSync(w.calls, "utf8") : "");

describe("assert_served_apps", () => {
  test("a healthy bundle passes, and the bad count reaches the caller", () => {
    const w = world();
    const { out, fails } = run(w, "assert_served_apps served 0");
    expect(fails).toBe(0);
    expect(out).toContain("ASSERT ok   board: running (pid 4242)");
    expect(out).toContain("ASSERT ok   chat: argv matches deps.lock serve.args");
    expect(out).toContain("ASSERT ok   no deps.lock tool is loaded as a deck app (checked 1)");
    expect(calls(w)).toContain("launchctl print gui/");
    expect(calls(w)).toContain("/com.mattstack.deck.gitq");
  });

  test("the expected set comes from the bundle's deps.lock, not a list in the script", () => {
    const w = world({ withLock: false });
    const { out, fails } = run(w, "assert_served_apps served 0");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL cannot read the served-app catalog from");
  });

  test("it polls until deck answers inside the deadline", () => {
    const w = world({ statusFailures: 2 });
    const { fails } = run(w, "assert_served_apps served 30");
    expect(fails).toBe(0);
    expect(calls(w).match(/api\/v1\/status/g)?.length).toBe(3);
  });

  test("a deck that never answers fails once the deadline passes, with one bad line", () => {
    const w = world({ statusFailures: 99 });
    const { out, fails } = run(w, "assert_served_apps served 2");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL deck /api/v1/status did not answer with an apps list");
    expect(calls(w).match(/api\/v1\/status/g)!.length).toBeGreaterThanOrEqual(2);
  });

  test("a loaded gitq label fails even though no script names gitq", () => {
    const w = world();
    writeFileSync(join(w.root, "launchd", "com.mattstack.deck.gitq"), readFileSync(join(w.root, "launchd", "com.mattstack.deck.board"), "utf8"));
    const { out, fails } = run(w, "assert_served_apps served 0");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL com.mattstack.deck.gitq is loaded, but deps.lock ships gitq as a tool, never an app");
  });
});

describe("assert_mattstack_routes", () => {
  test("every .mattstack route is fetched, not just the first, and .localhost routes are not", () => {
    const w = world({ deadHosts: ["chat.mattstack"] });
    const { out, fails } = run(w, "assert_mattstack_routes trusted proxy");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT ok   board.mattstack answers over https through the proxy");
    expect(out).toContain("ASSERT FAIL chat.mattstack is routed but does not answer through the proxy");
    expect(out).toContain("ASSERT ok   deck.mattstack answers over https through the proxy");
    expect(calls(w)).not.toContain("board.localhost");
  });

  test("the untrusted mode wants every route to answer insecurely and fail trust", () => {
    const w = world();
    const { out, fails } = run(w, "assert_mattstack_routes untrusted proxy");
    expect(out).toContain("ASSERT ok   board.mattstack answers over https through the untrusted proxy");
    expect(out).toContain("ASSERT FAIL board.mattstack verified against the system trust store, so the certificate was not declined");
    expect(fails).toBe(3);
  });

  test("no .mattstack route at all is one bad line", () => {
    const w = world();
    writeFileSync(join(w.home, ".portless", "routes.json"), JSON.stringify([{ hostname: "board.localhost", port: 11006, pid: 0 }]));
    const { out, fails } = run(w, "assert_mattstack_routes trusted proxy");
    expect(fails).toBe(1);
    expect(out).toContain("ASSERT FAIL no .mattstack route in ~/.portless/routes.json for the proxy to serve");
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/served-apps-sh.test.ts`
Expected: 8 fail; the received output shows `served-apps.sh: No such file or directory` and `assert_served_apps: command not found`.

- [ ] **Step 3: Implement** `rt-tray/vm/run/guest/served-apps.sh`:

```bash
#!/bin/bash
# Sourced by assert-installed.sh and trigger-update.sh, which define ok/bad and LOGS.
# The expected set is deps.lock's serve rows, never a list kept here.
SERVED_JQ_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/jq"
: "${SERVED_APP:=/Applications/mattstack.app}"
: "${SERVED_CURL:=curl}"
: "${SERVED_LAUNCHCTL:=launchctl}"
: "${SERVED_POLL_S:=5}"
SERVED_JQ="$SERVED_APP/Contents/Helpers/jq"

served_deck_port() {
  local p
  p=$("$SERVED_JQ" -r '.port // empty' "$HOME/.mattstack/deck/api.json" 2>/dev/null)
  [ -n "$p" ] || p=$("$SERVED_JQ" -r '.apps.deck.port // empty' "$HOME/.mattstack/deck/registry.json" 2>/dev/null)
  printf '%s' "$p"
}

served_snapshot() {  # <dir>: status.json, routes.json and launchd.json for one verdict pass
  local dir="$1" port n
  port=$(served_deck_port)
  if [ -n "$port" ] && "$SERVED_CURL" -sf --max-time 10 "http://127.0.0.1:$port/api/v1/status" > "$dir/status.raw" 2>/dev/null \
     && "$SERVED_JQ" -e 'type == "object"' "$dir/status.raw" >/dev/null 2>&1; then
    cp "$dir/status.raw" "$dir/status.json"
  else
    echo null > "$dir/status.json"
  fi
  if ! "$SERVED_JQ" -e 'type == "array"' "$HOME/.portless/routes.json" > /dev/null 2>&1; then
    echo null > "$dir/routes.json"
  else
    cp "$HOME/.portless/routes.json" "$dir/routes.json"
  fi
  for n in $("$SERVED_JQ" -r '.apps[].name, .tools[]' "$dir/catalog.json"); do
    "$SERVED_LAUNCHCTL" print "gui/$(id -u)/com.mattstack.deck.$n" > "$dir/launchctl-$n.txt" 2>&1
    "$SERVED_JQ" -R -s -c -f "$SERVED_JQ_DIR/launchctl-print.jq" < "$dir/launchctl-$n.txt" \
      | "$SERVED_JQ" -c --arg n "$n" '{($n): .}'
  done | "$SERVED_JQ" -s 'add // {}' > "$dir/launchd.json"
}

assert_served_apps() {  # <log-name> <timeout-s>
  local dir="$LOGS/$1" deadline=$((SECONDS + $2)) lock="$SERVED_APP/Contents/Resources/deps.lock" verdict kind msg
  mkdir -p "$dir"
  if ! "$SERVED_JQ" -c -f "$SERVED_JQ_DIR/catalog.jq" "$lock" > "$dir/catalog.json" 2> "$dir/catalog.stderr"; then
    bad "cannot read the served-app catalog from $lock: $(head -c 200 "$dir/catalog.stderr")"
    return
  fi
  while :; do
    served_snapshot "$dir"
    verdict=$("$SERVED_JQ" -r -n \
      --slurpfile catalog "$dir/catalog.json" --slurpfile status "$dir/status.json" \
      --slurpfile launchd "$dir/launchd.json" --slurpfile routes "$dir/routes.json" \
      --arg helpers "$SERVED_APP/Contents/Helpers" --arg home "$HOME" \
      -f "$SERVED_JQ_DIR/served-verdict.jq" 2> "$dir/verdict.stderr") \
      || verdict="bad	served-verdict.jq failed: $(tr "\n" " " < "$dir/verdict.stderr" | head -c 200)"
    grep -q '^bad' <<< "$verdict" || break
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep "$SERVED_POLL_S"
  done
  while IFS=$'\t' read -r kind msg; do
    case "$kind" in
      ok)  ok "$msg";;
      bad) bad "$msg";;
      *)   bad "served-verdict.jq printed an unexpected line: $kind $msg";;
    esac
  done <<< "$verdict"
}

assert_mattstack_routes() {  # <trusted|untrusted> <log-name>
  local mode="$1" hosts h
  cp "$HOME/.portless/routes.json" "$LOGS/$2-routes.json" 2>/dev/null
  hosts=$("$SERVED_JQ" -r '.[].hostname | select(endswith(".mattstack"))' "$HOME/.portless/routes.json" 2>/dev/null)
  if [ -z "$hosts" ]; then
    bad "no .mattstack route in ~/.portless/routes.json for the proxy to serve"
    return
  fi
  for h in $hosts; do
    if [ "$mode" = untrusted ]; then
      # Serving and being trusted are separate claims: curl without --insecure
      # uses the same trust store a browser does.
      "$SERVED_CURL" -fsS --insecure --max-time 10 "https://$h" >/dev/null 2>&1 \
        && ok "$h answers over https through the untrusted proxy" \
        || bad "$h is routed but does not answer through the proxy"
      "$SERVED_CURL" -fsS --max-time 10 "https://$h" >/dev/null 2>&1 \
        && bad "$h verified against the system trust store, so the certificate was not declined" \
        || ok "$h is not trusted yet, as the declined scenario expects"
    else
      "$SERVED_CURL" -fsS --max-time 10 "https://$h" >/dev/null 2>&1 \
        && ok "$h answers over https through the proxy" \
        || bad "$h is routed but does not answer through the proxy"
    fi
  done
}
```

- [ ] **Step 4: Run it and see it pass.**

Run: `bun test rt-tray/vm/run/helpers/__tests__/served-apps-sh.test.ts`
Expected: `8 pass, 0 fail` (about 6s: two cases wait on the poll loop).

Run: `bash -n rt-tray/vm/run/guest/served-apps.sh`
Expected: no output, exit 0.

- [ ] **Step 5: Gate and commit.** In `rt-tray/vm/check-vm-scripts.sh`, after the Task 3 line, add:

```bash
t "served-apps-sh.test.ts"       bun test run/helpers/__tests__/served-apps-sh.test.ts
```

Run: `bunx tsc --noEmit`
Expected: exits 0.

```
git add rt-tray/vm/run/guest/served-apps.sh rt-tray/vm/run/helpers/__tests__/served-apps-sh.test.ts rt-tray/vm/check-vm-scripts.sh
git commit -m "vm: add served-apps.sh, polling deck's served set and every .mattstack route" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: wire the assert phase

**Files:**
- Modify: `rt-tray/vm/check-vm-scripts.sh:198` (new checks after `assert-installed.sh handles repos.root absent`)
- Modify: `rt-tray/vm/run/guest/assert-installed.sh:21`, `:306-334`, `:358-360`, `:373`, `:376`

**Interfaces:**
- Consumes: `assert_served_apps`, `assert_mattstack_routes` (Task 4). `assert-installed.sh` already defines `ok`, `bad`, `LOGS`, `JQ`, `HEADLESS`, `UNTRUSTED`.
- Produces: the assert phase fails on any served-app or route problem; headless prints a stated pass. The pid loop at `:140-144` stays as it is (it still catches a crash-looping label the catalog does not name).

Line numbers below are as on `origin/main` before this task. Step 3 inserts a line, so from Step 4 on match on the quoted content, not the number.

- [ ] **Step 1: Write the failing gate checks.** In `rt-tray/vm/check-vm-scripts.sh`, directly after the line `t "assert-installed.sh handles repos.root absent" ...` (line 198 on `origin/main`; Tasks 1 to 4 added four lines above it), add:

```bash
t "assert-installed.sh checks every .mattstack route, not the first" bash -c \
  '! grep -qE "endswith\(\"\.mattstack\"\)\).*head -1" run/guest/assert-installed.sh \
   && grep -q "assert_mattstack_routes untrusted proxy" run/guest/assert-installed.sh \
   && grep -q "assert_mattstack_routes trusted proxy-after-trust" run/guest/assert-installed.sh'
t "assert-installed.sh asserts the served apps the bundle's deps.lock names" bash -c \
  'grep -q "assert_served_apps assert-served" run/guest/assert-installed.sh \
   && grep -q "Contents/Resources/deps.lock" run/guest/served-apps.sh'
t "no served-app name is written into the guest assert" bash -c \
  '! grep -qwE "board|chat|console|boxscore|gitq" run/guest/served-apps.sh run/guest/jq/catalog.jq run/guest/jq/served-verdict.jq run/guest/jq/launchctl-print.jq'
```

- [ ] **Step 2: Run them and see the first two fail.**

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: `assert-installed.sh checks every .mattstack route, not the first  FAIL` and `assert-installed.sh asserts the served apps the bundle's deps.lock names  FAIL`; `no served-app name is written into the guest assert  ok`; every other line as in the baseline; final line `2 check(s) failed`.

- [ ] **Step 3: Source the helper.** In `rt-tray/vm/run/guest/assert-installed.sh`, after line 21 (`JQ=/Applications/mattstack.app/Contents/Helpers/jq`), add:

```bash
source "$(cd "$(dirname "$0")" && pwd)/served-apps.sh" || { echo "assert-installed.sh: cannot load served-apps.sh" >&2; exit 2; }
```

- [ ] **Step 4: Replace the one-route block.** Replace lines 306-334 (from `  # The end-to-end fact: an app domain resolving to loopback` through the `fi` that closes the `if [ -z "$served" ]` chain) with:

```bash
  # The end-to-end fact: every app domain resolving to loopback (the root
  # daemon rewrites /etc/hosts from routes.json) and answering TLS with a host
  # cert it mints on demand under the CA the installer trusted. Hostnames come
  # from the route table; which apps must hold one is assert_served_apps' call,
  # from the bundle's deps.lock.
  if [ "$UNTRUSTED" = 1 ]; then
    assert_mattstack_routes untrusted proxy
  else
    assert_mattstack_routes trusted proxy
  fi
  assert_served_apps assert-served 90
```

`assert_mattstack_routes` writes `$LOGS/proxy-routes.json` itself, which is why the old `cat ... > "$LOGS/proxy-routes.json"` line goes too.

- [ ] **Step 5: Replace the post-trust single-route check.** Replace lines 358-360:

```bash
    curl -fsS --max-time 10 "https://$served" >/dev/null 2>&1 \
      && ok "$served now answers with a trusted certificate" \
      || bad "$served still fails against the system trust store after trusting"
```

with:

```bash
    assert_mattstack_routes trusted proxy-after-trust
```

- [ ] **Step 6: Capture evidence for every route.** Replace line 373:

```bash
  curl -sS -o /dev/null -D - --max-time 10 "https://${served:-deck.mattstack}" > "$LOGS/proxy-curl.txt" 2>&1
```

with:

```bash
  : > "$LOGS/proxy-curl.txt"
  for h in $("$JQ" -r '.[].hostname | select(endswith(".mattstack"))' "$HOME/.portless/routes.json" 2>/dev/null); do
    { echo "== $h"; curl -sS -o /dev/null -D - --max-time 10 "https://$h"; } >> "$LOGS/proxy-curl.txt" 2>&1
  done
```

- [ ] **Step 7: State the headless skip.** The `if [ "$HEADLESS" = 0 ]; then` block that starts at line 200 ends at line 376 with a bare `fi`, right before `echo "$fails" > "$LOGS/assert-fails.txt"`. Turn that `fi` into:

```bash
else
  ok "served apps and .mattstack routes not asserted (headless: no proxy, so deck has no routes)"
fi
```

Then confirm nothing still reads the removed variable:

Run: `grep -c '\$served\|{served' rt-tray/vm/run/guest/assert-installed.sh`
Expected: `0`.

Run: `bash -n rt-tray/vm/run/guest/assert-installed.sh`
Expected: no output, exit 0.

- [ ] **Step 8: Run the gate and see it pass.**

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: final line `all vm checks ok`.

- [ ] **Step 9: Commit.**

```
git add rt-tray/vm/run/guest/assert-installed.sh rt-tray/vm/check-vm-scripts.sh
git commit -m "vm: assert-installed checks deck's served set and every .mattstack route" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: wire the Sparkle update leg

**Files:**
- Modify: `rt-tray/vm/check-vm-scripts.sh:209` (new checks after `trigger-update.sh ax.sh mount guard actually aborts`)
- Modify: `rt-tray/vm/run/guest/trigger-update.sh:2-9`, `:158`
- Modify: `rt-tray/vm/run/walkthrough.sh:255`

**Interfaces:**
- Consumes: `assert_served_apps`, `assert_mattstack_routes` (Task 4). `trigger-update.sh` already defines `ok`, `bad`, `LOGS`.
- Produces: `trigger-update.sh <update-dir> <X.Y.Z> [--headless]`. Any other third argument is a usage error (exit 1, `usage: trigger-update.sh ...`). After the version and daemon checks, it asserts the served set (180s budget, evidence in `$LOGS/update-served/`) and every route, or prints a stated pass with `--headless`. `walkthrough.sh` passes `--headless` for `--scenario headless`.

Line numbers below are as on `origin/main` before this task. Step 3 adds two lines, so for Step 4 match on the quoted content.

- [ ] **Step 1: Write the failing gate checks.** In `rt-tray/vm/check-vm-scripts.sh`, directly after the line `t "trigger-update.sh ax.sh mount guard actually aborts" ...` (line 209 on `origin/main`; earlier tasks added lines above it) and before the `e2e-cleanroom usage` check, add:

```bash
t "trigger-update.sh rejects an unknown third argument" bash -c 'out=$(GUEST_RUN=/tmp/vmcheck-ax bash run/guest/trigger-update.sh /tmp/vmcheck-tu/upd 1.2.3 --bogus 2>&1); rc=$?; [ "$rc" -eq 1 ] && printf "%s" "$out" | grep -q "^usage: trigger-update.sh"'
t "trigger-update.sh asserts served apps and every route after the relaunch" bash -c \
  'grep -q "assert_served_apps update-served" run/guest/trigger-update.sh && grep -q "assert_mattstack_routes trusted update" run/guest/trigger-update.sh'
t "walkthrough hands --headless to the update leg" bash -c \
  'grep -q "UPD_HFLAG=--headless" run/walkthrough.sh && [ "$(grep -c UPD_HFLAG run/walkthrough.sh)" -ge 2 ]'
```

- [ ] **Step 2: Run them and see them fail.**

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: the three new lines `FAIL` (the first because today a stray third argument is ignored and the script goes on to `ASSERT FAIL appcast server not reachable`, so it never prints usage), every other line `ok`, final line `3 check(s) failed`.

- [ ] **Step 3: Accept `--headless` and source the helper.** In `rt-tray/vm/run/guest/trigger-update.sh`, replace lines 3-9:

```bash
# Usage: trigger-update.sh <update-dir> <expect-new-version>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; source "$HERE/ax.sh" || exit 1
UPD="${1:-}"; NEWV="${2:-}"
[ -d "$UPD" ] && [ -f "$UPD/appcast.xml" ] && [ -x "$UPD/appcast-server" ] && [ -n "$NEWV" ] \
  && echo "$NEWV" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || { echo "usage: trigger-update.sh <update-dir with appcast.xml + zip + appcast-server> <new-version X.Y.Z>"; exit 1; }
```

(line 3 is the `# Usage:` comment; line 2's description comment stays) with:

```bash
# Usage: trigger-update.sh <update-dir> <expect-new-version> [--headless]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; source "$HERE/ax.sh" || exit 1
source "$HERE/served-apps.sh" || exit 1
UPD="${1:-}"; NEWV="${2:-}"; MODE="${3:-}"
[ -d "$UPD" ] && [ -f "$UPD/appcast.xml" ] && [ -x "$UPD/appcast-server" ] && [ -n "$NEWV" ] \
  && echo "$NEWV" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
  && case "$MODE" in ""|--headless) true;; *) false;; esac \
  || { echo "usage: trigger-update.sh <update-dir with appcast.xml + zip + appcast-server> <new-version X.Y.Z> [--headless]"; exit 1; }
```

- [ ] **Step 4: Assert after the relaunch.** After line 158 (`[ "$rvn" = "$NEWV" ] && ok "rt --version == $NEWV ($rv)" || bad "rt --version is '$rv'"`), add:

```bash
# The relaunch is a first launch with setup already complete: deck's boot
# sweep has to bring the bundle's served apps back on its own.
if [ "$MODE" = --headless ]; then
  ok "served apps and .mattstack routes not asserted (headless: no proxy, so deck has no routes)"
else
  assert_served_apps update-served 180
  assert_mattstack_routes trusted update
fi
```

- [ ] **Step 5: Pass the flag from the walkthrough.** In `rt-tray/vm/run/walkthrough.sh`, replace line 255:

```bash
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "GUEST_RUN='$GUEST_RUN' VM_APPCAST_PORT='$VM_APPCAST_PORT' bash $GUEST_BIN/trigger-update.sh '$GUEST_RUN/in/update' '$UPDV'" >"$VM_RUN_DIR/logs/update.log" 2>&1
```

with:

```bash
  UPD_HFLAG=""; [ "$SCENARIO" = headless ] && UPD_HFLAG=--headless
  vm_ssh_try "$VM_TESTER_USER" "$RUN_VM" "GUEST_RUN='$GUEST_RUN' VM_APPCAST_PORT='$VM_APPCAST_PORT' bash $GUEST_BIN/trigger-update.sh '$GUEST_RUN/in/update' '$UPDV' $UPD_HFLAG" >"$VM_RUN_DIR/logs/update.log" 2>&1
```

- [ ] **Step 6: Run the gate and see it pass.**

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: final line `all vm checks ok` (the existing four `trigger-update.sh usage` checks and the mount-guard check still pass: the usage string still starts `usage: trigger-update.sh`, and `ax.sh` still aborts first on an unmounted share).

- [ ] **Step 7: Commit.**

```
git add rt-tray/vm/run/guest/trigger-update.sh rt-tray/vm/run/walkthrough.sh rt-tray/vm/check-vm-scripts.sh
git commit -m "vm: Sparkle update leg asserts deck's served set and every route after relaunch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: CI parity between `catalog.jq` and `parseDepsLock`

Needs unit A merged (its `serve` field on `DepsLockTool` and its fixture). If A is not on `origin/main` yet when you reach this task, do Task 8 Steps 1 to 5 (docs, verification, docs commit) first, then `git fetch origin` and `git rebase origin/main` once A lands, come back here, and finish with Task 8 Step 6.

**Files:**
- Create: `scripts/lib/__tests__/vm-served-catalog.test.ts`

**Interfaces:**
- Consumes: `parseDepsLock(text: string): DepsLock` (`lib/bundle-layout.ts:66`) with unit A's `DepsLockTool.serve?: { port: number; args: string[] }`; unit A's `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`; `rt-tray/vm/run/guest/jq/catalog.jq` (Task 2).
- Produces: a CI-run test (`bun test ... scripts` in `.github/workflows/checks.yml:40`, macOS runner with jq) that fails when the guest's reading of `deps.lock` drifts from rt's.

- [ ] **Step 1: Confirm A's surface.**

Run: `git log -1 --oneline origin/main`
Run: `grep -n "serve" lib/bundle-layout.ts`
Expected: a `serve?:` field on `DepsLockTool` typed `{ port: number; args: string[] }` (or equivalent readonly form).

Run: `ls scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`
Expected: the file exists.

Run: `jq -c keys scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`
Expected: `["expectedCatalog","lock"]`. The fixture is a wrapper, not a bare deps.lock: `parseDepsLock` on its raw text throws `unsupported schema undefined` and `catalog.jq` fails iterating `.tools[]`, so the fixture test below hands both readers `JSON.stringify(fixture.lock)`.

If any of these differs from the contract, adapt only `viaParser` (or the unwrap) below and record the difference in your report.

- [ ] **Step 2: Write the test** `scripts/lib/__tests__/vm-served-catalog.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseDepsLock } from "../../../lib/bundle-layout.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const CATALOG_JQ = join(ROOT, "rt-tray", "vm", "run", "guest", "jq", "catalog.jq");
const FIXTURE = join(import.meta.dir, "fixtures", "deps-lock-serve.fixture.json");
const SHIPPED_LOCK = join(ROOT, "rt-tray", "deps.lock");

interface CatalogApp { name: string; status: string; port: number; args: string[] }
interface Catalog { apps: CatalogApp[]; tools: string[] }

// jq sorts strings by codepoint; localeCompare would not agree on "git-lfs" vs "gitq".
const byCodepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function viaJq(text: string): Catalog {
  const jq = Bun.which("jq");
  if (!jq) throw new Error("jq is not on PATH: the guest reads deps.lock with jq, so this parity check needs one (macOS ships /usr/bin/jq)");
  const r = Bun.spawnSync([jq, "-c", "-f", CATALOG_JQ], { stdin: Buffer.from(text) });
  if (r.exitCode !== 0) throw new Error(`catalog.jq exited ${r.exitCode}: ${r.stderr.toString()}`);
  return JSON.parse(r.stdout.toString());
}

function viaParser(text: string): Catalog {
  const helpers = parseDepsLock(text).tools.filter((t) => t.kind === "helper");
  const apps: CatalogApp[] = [];
  const tools: string[] = [];
  for (const t of helpers) {
    if (t.serve) apps.push({ name: t.name, status: t.status, port: t.serve.port, args: [...t.serve.args] });
    else tools.push(t.name);
  }
  return { apps: apps.sort((a, b) => byCodepoint(a.name, b.name)), tools: tools.sort(byCodepoint) };
}

describe("catalog.jq agrees with parseDepsLock", () => {
  test("the shared serve fixture reads the same both ways, and names at least one app", () => {
    const text = JSON.stringify((JSON.parse(readFileSync(FIXTURE, "utf8")) as { lock: unknown }).lock);
    const catalog = viaJq(text);
    expect(catalog).toEqual(viaParser(text));
    expect(catalog.apps.length).toBeGreaterThan(0);
  });

  test("the shipped rt-tray/deps.lock reads the same both ways", () => {
    const text = readFileSync(SHIPPED_LOCK, "utf8");
    expect(viaJq(text)).toEqual(viaParser(text));
  });
});
```

- [ ] **Step 3: Run it.**

Run: `bun test scripts/lib/__tests__/vm-served-catalog.test.ts`
Expected: `2 pass, 0 fail`. This is a parity pin over code that already exists, so there is no red phase from a missing implementation; prove it can fail instead:

- [ ] **Step 4: Prove it bites.** Temporarily change `catalog.jq`'s `(.serve.args // [])` to `[]`.

Run: `bun test scripts/lib/__tests__/vm-served-catalog.test.ts`
Expected: the fixture test fails on `argsdemo` (A's fixture serves it with `["serve", "--no-open"]`), and the shipped-lock test still passes (every live `serve` row has `args: []`). Revert the edit and rerun: `2 pass`.

- [ ] **Step 5: Typecheck and commit.**

Run: `bunx tsc --noEmit`
Expected: exits 0.

```
git add scripts/lib/__tests__/vm-served-catalog.test.ts
git commit -m "vm: pin catalog.jq to parseDepsLock in CI" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: document it, run the gate, open the PR

**Files:**
- Modify: `rt-tray/vm/README.md` (Layout block around lines 125-150, a new section after `## Runs`, `## Offline check`)

- [ ] **Step 1: Layout rows.** In the `rt-tray/vm/` layout block, replace:

```
  run/guest/assert-installed.sh  guest: rt verify --json, tray.sock /version, daemon pid/label, symlink target
  run/guest/trigger-update.sh    guest: loopback appcast server, POST /update/check, drive Sparkle, assert vN+1 + daemon restart
```

with:

```
  run/guest/assert-installed.sh  guest: rt verify --json, tray.sock /version, daemon pid/label, symlink target, served apps, every .mattstack route
  run/guest/trigger-update.sh    guest: loopback appcast server, POST /update/check, drive Sparkle, assert vN+1 + daemon restart + served apps
  run/guest/served-apps.sh       guest: sourced by both; deck's served set from the bundle's deps.lock, every .mattstack route
  run/guest/jq/                  guest: jq programs (deps.lock catalog, launchctl print, served verdict); host tests in run/helpers/__tests__/
```

- [ ] **Step 2: A "Served apps" section.** Insert directly before `## What is not automated (and how the scripts treat it)`:

```markdown
## Served apps

`assert-installed.sh` (assert phase) and `trigger-update.sh` (update phase, after Sparkle's relaunch) both source `run/guest/served-apps.sh`:

- The expected set is every `deps.lock` helper row with a `serve` object, read from the installed bundle's `Contents/Resources/deps.lock` with the bundle's own jq. The harness names no app, so a new catalog row is asserted the moment it ships.
- For each one, deck's `GET /api/v1/status` (port from `~/.mattstack/deck/api.json`) must show an rt-managed, healthy row with no `dev-link` issue, an `icon` (deck advertises one only when the bundle's identity at `Contents/Resources/apps/<name>/` resolves) and a `<name>.mattstack` route, and `launchctl print gui/<uid>/com.mattstack.deck.<name>` must show argv `[<bundle>/Contents/Helpers/<name>, ...serve.args]`, working directory `~/.mattstack/<name>` and a pid. deck must report `devMode: false`.
- A serve row whose status is `pending` fails: the catalog names an app this bundle does not ship.
- Every helper row without `serve` (a tool, such as the gitq CLI) must have no `com.mattstack.deck.<name>` job loaded.
- Every `.mattstack` hostname in `~/.portless/routes.json` must answer over https, not only the first.
- It polls (90s in the assert phase, 180s after the update relaunch) until nothing is bad, then reports the last pass. Evidence lands in `logs/assert-served/` and `logs/update-served/`: the catalog, deck's status, the route table and one `launchctl-<name>.txt` per job.
- Headless runs skip it with a stated pass: no proxy is installed there, so deck has no routes.

The release walkthrough (`rt:release`, `walkthrough.sh --scenario create`) runs it in its assert phase, so the `assert` phase going `pass` now includes it; add `--update-dir`/`--update-version` to run the update leg too. To rerun it in a guest kept with `--keep`, ssh in as `tester` and repeat the assert phase's own command from `run/walkthrough.sh`. The jq programs are tested on the host by `run/helpers/__tests__/{launchctl-print,catalog,served-verdict,served-apps-sh}.test.ts` (all in `check-vm-scripts.sh`; set `VM_TEST_JQ` to run them under the bundle's jq), and `scripts/lib/__tests__/vm-served-catalog.test.ts` pins `catalog.jq` to `parseDepsLock` in CI.
```

- [ ] **Step 3: Offline check wording.** In `## Offline check`, the first sentence (line 227) says "the two unit-test suites" and carries two em dashes. Replace that sentence, up to and including "with no Tart and no network.", with:

```markdown
`bash check-vm-scripts.sh` runs every offline gate in this directory (`bash -n` on every script, the host unit-test suites, and every `--dry-run`/usage-only path) with no Tart and no network.
```

Leave the rest of the paragraph as it is.

- [ ] **Step 4: Final verification.**

Run: `bash rt-tray/vm/check-vm-scripts.sh`
Expected: `all vm checks ok`.

Run: `bun test rt-tray/vm/run/helpers/__tests__/`
Expected: 30 pass (28 new plus appcast-server's 2), 0 fail.

Run: `bun test scripts/lib/__tests__/vm-served-catalog.test.ts`
Expected: `2 pass` (skip only if Task 7 is still waiting on unit A, and say so in the PR body).

Run: `bunx tsc --noEmit`
Expected: exits 0.

Run: `grep -rn "$(printf '\342\200\224')" rt-tray/vm/run/guest/served-apps.sh rt-tray/vm/run/guest/jq rt-tray/vm/run/helpers/__tests__ scripts/lib/__tests__/vm-served-catalog.test.ts rt-tray/vm/README.md`
Run: `grep -rn "$(printf '\342\200\223')" rt-tray/vm/run/guest/served-apps.sh rt-tray/vm/run/guest/jq rt-tray/vm/run/helpers/__tests__ scripts/lib/__tests__/vm-served-catalog.test.ts`
Expected: the first prints only README lines that were already there before this branch (compare with `git diff origin/main -- rt-tray/vm/README.md`: no added line may carry one); the second prints nothing.

Run: `bash scripts/repo-purity.sh`
Expected: exit 0.

- [ ] **Step 5: Commit the docs.**

```
git add rt-tray/vm/README.md
git commit -m "vm: document the served-app assert and how the walkthrough runs it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and open the PR.**

Run: `git push -u origin rt-2-13-h-vm-served-assert`

Write the PR body to a scratch file (Write tool), for example `<scratchpad>/pr-h.md`, with this content:

```markdown
## VM assert checks the served apps the bundle ships (RT-284, spec section H)

The clean-room assert now fails unless deck serves exactly the bundle's catalog in prod, and it fetches every `.mattstack` route instead of the first.

### What changed

**Guest helper** (`rt-tray/vm/run/guest/`)

- Adds `served-apps.sh`, sourced by `assert-installed.sh` and `trigger-update.sh`
- Adds `jq/catalog.jq`, `jq/launchctl-print.jq`, `jq/served-verdict.jq` (the guest has only the bundle's jq)
- Derives the expected set from `Contents/Resources/deps.lock` serve rows; nothing names an app
- Checks per app: rt-managed, `health.ok`, no dev-link issue, an advertised `icon` (the bundled identity resolved), `<name>.mattstack` route, argv `[Helpers/<name>, ...serve.args]`, cwd `~/.mattstack/<name>`, a pid; deck `devMode: false`
- Fails any tool row (the gitq CLI) loaded as a `com.mattstack.deck.<name>` job, and any pending serve row

**Wiring**

- `assert-installed.sh`: every route, served-app assert (90s poll), headless stated pass
- `trigger-update.sh`: optional `--headless`; served-app assert (180s) and every route after the relaunch
- `walkthrough.sh` passes `--headless` to the update leg

**Tests**

- Host suites for all three jq programs and the helper (stub launchctl/curl, temp HOME), fixtures pasted from real captures, wired into `check-vm-scripts.sh`
- `scripts/lib/__tests__/vm-served-catalog.test.ts` pins `catalog.jq` to `parseDepsLock` in CI

### Not run here

No VM run: the assert goes green only on a bundle carrying the serve rows and deck 1.1.0 (units A, B, D and the deps.lock row PRs). The release walkthrough is its first real run.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Run: `gh pr create --base main --head rt-2-13-h-vm-served-assert --title "vm: assert deck's served apps from deps.lock and every .mattstack route" --body-file <scratchpad>/pr-h.md`
Expected: prints the PR URL. Report it.

---

## Contract notes

1. **Contract 1 (where `serve` lives).** `deps.lock` has no `helpers` array: rows live in `.tools[]`, and "helper row" means `kind: "helper"` (`lib/bundle-layout.ts:15-52`). `catalog.jq` reads `serve` only on those rows and treats a `serve` on a `buildtool` row as absent (unit A may reject it outright; either way no buildtool is ever an app).
2. **Contract 2 verified.** `rt-tray/build.sh:273` already copies `deps.lock` to `Contents/Resources/deps.lock`, pending rows included. Nothing to add.
3. **Pending serve rows fail.** A `serve` row whose `status` is `pending` is not in the bundle (`rt-tray/build.sh:218` skips it), so the assert fails it by name. Unit B's `readBundleCatalog` should either drop pending rows or surface them as an issue; either way the walkthrough stays red until the row is `bundled`, which is what section D and the release gate need.
4. **H pins B's served shape exactly.** argv equals `[<bundle>/Contents/Helpers/<name>, ...serve.args]` (no extra arguments), `WorkingDirectory` equals `~/.mattstack/<name>`, `managedBy` is `"rt"`, the status row's app has a `<name>.mattstack` route, and there is no `dev-link` issue. It also pins C's identity end to end: the status row's `icon` must be non-null, which deck only advertises (`/api/apps/<name>/icon`) once `Contents/Resources/apps/<name>/` resolves; check-bundle only proves those files are in the bundle, not that deck serves them. If B or C changes any of these, change `served-verdict.jq` and its test in the same release.
5. **Tool rule generalized.** Rather than a hard-coded "no `com.mattstack.deck.gitq`", every helper row without `serve` must have no `com.mattstack.deck.<name>` job. That is the ratified rule stated from the lock, and it covers gitq today. deck's own labels (`com.mattstack.deck`, `.dev`, `.tunnel`) are not `deps.lock` rows under that prefix, so they are never checked.
6. **Not-served rows and routes.** deck's status rows are built from portless routes. If B's `not-served` outcome keeps a row's `<name>.mattstack` route, the every-route check fails on a dev-lived machine (a real capture shows `gitq.mattstack` still routed there). That cannot happen on the clean VM, but the out-of-scope dev-first leg would hit it; B should decide whether `not-served` drops the route.
7. **Release fast path.** The `rt:release` pin-only fast path (`skills/rt-release/SKILL.md:249-261`) skips the walkthrough when only app `deps.lock` rows change, which is exactly when this assert matters. This unit does not edit the skill (skill edits go through superpowers:writing-skills). For 2.13.0 the release runbook runs the full gate regardless, and unit A's preflight sends any `serve` diff to the full gate; the runbook files a follow-up ticket for the skill's fast path.
8. **Parity anchor.** Task 7 compares `catalog.jq` against `parseDepsLock` directly, so it does not depend on the fixture's exact rows, only on unit A's fixture path, its wrapper shape (`{ lock, expectedCatalog }`, unwrapped to `.lock` before either reader sees it) and `DepsLockTool.serve?: { port: number; args: string[] }`. A different field name changes only `viaParser`.
9. **deck API port.** The guest reads `~/.mattstack/deck/api.json` `.port` and falls back to `registry.json` `.apps.deck.port`, mirroring `resolveApiInfo` (`apps/deck/src/cli/api-info.ts`) minus its pid-liveness check; a stale port just fails the curl and the poll retries.

**Depends on:** unit A (the `serve` field in `parseDepsLock` and `scripts/lib/__tests__/fixtures/deps-lock-serve.fixture.json`) must merge before Task 7; Tasks 1 to 6 and 8 do not need it. For the assert to go green in a real walkthrough, units B (deck 1.1.0 sweep), C (bundled identity, which the icon check reads) and D (boxscore bundled) and the bot deps.lock PR must land first; that is the release runbook's gate (`I-release-runbook.md`), not this PR's.
