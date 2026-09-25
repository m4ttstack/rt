# Unit E: rt setup and CLI cleanup (2.13.0 prod readiness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `rt setup`'s `deck.managed` step stops registering individual apps (deck's boot sweep owns that now), and `rt uninstall` can no longer be pointed at "one app" and quietly remove everything: it rejects stray arguments, and its deck step makes one bulk call that reaches a live deck.

**Architecture:** Four small changes in repo-tools, all in the setup/uninstall layer. `lib/setup/steps/deck.ts` keeps only the legacy `mrs` to `board` adoption. `commands/uninstall.ts` validates its argv against a closed flag set that a test pins to the command-tree node. `lib/setup/uninstall.ts`'s `deck.managed-remove` action replaces its per-name `deck remove --managed <name>` loop (which only ever worked because deck ignored the name) with one `POST /api/v1/apps/managed/remove` over deck's HTTP API, and moves ahead of `services.unregister`, which stops deck itself.

**Tech Stack:** Bun, TypeScript, `bun:test`, the `Probes` seam (`lib/setup/probes.ts`) and its fakes (`lib/setup/__tests__/fakes.ts`), the compiled-binary e2e harness (`e2e/harness.ts`).

**Spec:** /Users/matt/.mattstack/rt/worktrees/gh-m4ttstack-rt/faramir/docs/superpowers/specs/2026-09-24-prod-readiness-2-13-design.md (section E)

**Depends on:** unit B (deck 1.1.0 with the boot sweep) AND the bot deps.lock PR from the release runbook's bundle-apps dispatch, which pins deck 1.1.0 beside unit A's `serve` rows (README merge order step 10). This PR is marked ready and merged only after that deps.lock PR is on `main` AND the B dev-creation decision is recorded (B contract note 12: does dev's sweep also create missing catalog rows?). Reason: until the pinned deck's sweep creates and serves the catalog apps, removing the chat and console legs from `deck.managed` means a clean install never registers chat or console, and on a dev-only machine that holds only if B's dev sweep creates them too. The PR is opened as a draft and its body says so.

---

## Global Constraints

- **Repo and branch.** repo-tools only. Work in a fresh rt worktree on branch `rt-2-13-e-setup-cli-cleanup`, cut from `origin/main`. The shared checkout `~/Documents/GitHub/repo-tools` is read only: never write there, never switch its branch. mattstack-apps is not touched by this unit.
- **TDD.** Every code task writes the failing test first, runs it and sees the stated failure, then implements, then reruns to green.
- **Targeted verification only.** Run the touched test files, `bunx tsc --noEmit`, `bun run picker:check` and `bun run docs:check` as named in each task. Never run `bun run test`, `bun run test:all`, `test:e2e` or `test:pty` whole; CI runs them. The one e2e file this plan touches is run on its own with the exact command given.
- **Built binaries.** The only built binary this plan runs is `dist/rt`, and only through `e2e/harness.ts`, which spawns it with a fresh temp `HOME` and a closed env (`e2e/harness.ts:48-54`). Never run `dist/rt` by hand. No `.app` is built, signed or touched; no Swift build is needed (no `rt-tray/Sources` change).
- **Do not touch:** `DEFAULT_EXPOSED` (`lib/deps/links.ts:19`), the `gitq` row in `rt-tray/deps.lock`, and the release preflight `standalone:gitq` row (`lib/release/preflight.ts`, pinned by `lib/release/__tests__/preflight.test.ts:286`). The gitq CLI ships exactly as today. Task 5 checks the diff for these paths.
- **Comments.** Clean-code only: a comment states a constraint the code cannot show (an ordering trap, a non-obvious invariant). No narration, no ticket ids, no review history. No em or en dashes in any code, comment, string, commit message or PR text; use "...", a semicolon, parentheses or a rephrase. Existing lines this plan does not otherwise edit keep their text.
- **Commits.** One commit per task, message ending with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The worktree's Bash guard refuses heredocs and `&&` chains: pass the trailer as a second `-m`, and run commands one at a time from the worktree root.

## Review Focus

Five inputs or failure modes the spec implies that no current test covers, each pinned by a test in the task named:

1. **A machine that used to trigger the gitq leg.** `gitq.board.repos` set, and gitq, console and chat all bundled. `deck.managed` must exec only the `mrs` adopt, PATCH only `/api/v1/apps/board`, and create none of `~/.mattstack/{gitq,console,chat}`. (Task 1, test "registers no app itself".)
2. **`rt uninstall <app>` in every mode.** A positional (`gitq`), a positional after flags, a typo'd flag (`--keep_data`), with and without `--json`, `--yes`, `--dry-run`, on and off a TTY: exit 2 before any action is computed, prompted or run. Plus a parity test so the handler's accepted flags can never drift from the command-tree node's declared flags. (Task 2.)
3. **A partial bulk teardown.** Deck answers `200 {ok:false, removed:["board"], failed:["chat"]}`, or a 5xx, or no answer (status 0), or a 200 whose body is not the expected shape: the action must fail with remedy `Retry`, never report `done`. And the call names no app, so it cannot depend on how unit B scopes `deck remove --managed <name>`. (Task 3.)
4. **The deck step running after deck is gone.** `services.unregister` unregisters `com.mattstack.deck.plist` (`lib/setup/need.ts:49-54`), and today `deck.managed-remove` runs after it (`lib/setup/uninstall.ts:70-74`), so on a real uninstall it finds deck down and skips, leaving every `com.mattstack.deck.<app>` agent installed. The action must come first. (Task 4, test "deck.managed-remove runs before services.unregister".)
5. **The e2e suite on a machine with `/Applications/mattstack.app`.** The e2e dry-run test asserts `actions[0].id === "services.unregister"` (`e2e/tests/setup.test.ts:101-110`); with deck resolvable through the installed app, Task 4's order makes that false on a dev Mac while CI stays green. The assertion becomes order-aware, and the new rejection e2e test always passes `--dry-run` so a regression can never run a real uninstall against the developer's installed app. (Tasks 2 and 4.)

## Files

| File | Change | Task |
|---|---|---|
| `lib/setup/steps/deck.ts` | Drop `gitqHasRepos`, `MATTSTACK_REGISTRAR`, `registerManagedApp` and the three app legs; new header comment and detail strings | 1 |
| `lib/setup/__tests__/steps-b.test.ts` | Rewrite the `deck.managed` tests after the three gate tests | 1 |
| `commands/uninstall.ts` | Export `UNINSTALL_FLAGS`; reject any other argv token with `unexpected-args` | 2 |
| `lib/command-tree-def.ts` | `uninstall` node description says it takes no app name | 2 |
| `website/docs/reference/uninstall.mdx` | Regenerated by `bun run docs:gen` | 2 |
| `commands/__tests__/uninstall.test.ts` | Rejection matrix, envelope, human line, flag parity with `TREE` | 2 |
| `e2e/tests/setup.test.ts` | New `uninstall gitq --dry-run --json` case (Task 2); order-aware dry-run assertion (Task 4) | 2, 4 |
| `lib/setup/uninstall.ts` | `deck.managed-remove`: one POST, new title, new outcome mapping; then moved ahead of `services.unregister` | 3, 4 |
| `lib/setup/__tests__/uninstall.test.ts` | Rewrite the `deck.managed-remove` describe; order tests | 3, 4 |
| `rt-tray/Tests/stub-rt/stub.ts` | Stub's uninstall title and order follow | 3, 4 |
| `rt-tray/Tests/stub-rt/stub.test.ts` | Stub's order assertions follow | 4 |
| `docs/superpowers/specs/2026-08-21-rt-setup-contract.md` | Uninstall action order line | 4 |

No e2e/pty test pins any string this plan changes: `e2e/pty/` holds only `glitter.test.ts`, and `e2e/tests/setup.test.ts` checks only the dry-run's first action id (handled in Task 4). No Swift source pins `deck.managed-remove` or its title; the tray renders whatever titles the dry-run returns (`rt-tray/Sources/Settings/UninstallPane.swift:59`).

---

### Task 0: Worktree

**Files:** none.

- [ ] **Step 1: Provision the tree.** Use EnterWorktree in name mode with name `rt-2-13-e-setup-cli-cleanup` (the rt hook provisions it through `rt worktree provision`). Never `git worktree add` in this repo.
- [ ] **Step 2: Put the branch on origin/main.**

```bash
git fetch origin
git switch -c rt-2-13-e-setup-cli-cleanup origin/main
```

If the provisioned tree is already on a branch with that name, run `git reset --hard origin/main` instead of the switch (the tree is fresh, nothing to lose). Confirm with `git log --oneline -1` that HEAD equals `origin/main`.

- [ ] **Step 3: Install deps** with `bun install` (the golden hydration usually makes this a no-op).

---

### Task 1: `deck.managed` registers no app itself

**Files:**
- Modify: `lib/setup/steps/deck.ts` (header `:1-23`, import `:27`, `gitqHasRepos` `:81-84`, `MATTSTACK_REGISTRAR` `:101-108`, `registerManagedApp` `:110-155`, run tail `:175-185`)
- Test: `lib/setup/__tests__/steps-b.test.ts` (deck.managed tests `:601-818`)

**Interfaces:**
- Consumes: `bundledToolPath(p, name): string | null` (`lib/deps/resolve.ts`), `readDeckApiPort(ctx): number | null` and `deckIsHealthy(ctx, port): Promise<boolean>` (same file, unchanged), `adoptBoard` and `repointBoard` (same file, unchanged).
- Produces: `deckManagedStep: StepDef` with unchanged `id: "deck.managed"`, `title: "Set up managed deck"`. New `done` details, exactly:
  - `"deck ready; no legacy mrs to adopt"`
  - `"deck ready; board adopted from legacy mrs, repointed"`
  - `"deck ready; board adopted from legacy mrs, repoint skipped (board not bundled yet)"`
  The `skipped` and `failed` outcomes before the adopt (`deck.ts:159-176`) are unchanged.

- [ ] **Step 1: Write the failing tests.** In `lib/setup/__tests__/steps-b.test.ts`, keep the `healthyFetch` helper and the first three tests of `describe("deck.managed")` (not bundled, unhealthy with no app, unhealthy with app, ending at line 599). Replace everything from the test `"gitq bundled but no gitq.board repos yet: ..."` (line 601) through the end of the `"idempotent re-run: ..."` test (line 818) with:

```ts
    test("healthy deck: registers no app itself, even with gitq.board repos set and gitq, console, chat bundled", async () => {
      setSetting("gitq.board", { repos: ["acme/acme-dev"] }, "machine");
      const p = bundledProbes({
        tools: ["gitq", "board", "console", "chat"],
        overrides: {
          files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) },
          fetch: healthyFetch(4100),
          exec: async () => ok(""),
        },
      });
      const { ctx, logs } = makeCtx(p);

      expect(await deckManagedStep.run(ctx)).toEqual({ state: "done", detail: "deck ready; board adopted from legacy mrs, repointed" });

      const deckBin = join(appRoot, HELPERS_DIR, "deck");
      expect(p.calls.exec).toEqual([[deckBin, "adopt", "mrs", "--as", "board", "--json"]]);
      expect(p.calls.fetch.filter((u) => u.includes("/api/v1/apps/"))).toEqual(["http://127.0.0.1:4100/api/v1/apps/board"]);
      expect(p.exists(join(home, ".mattstack", "board"))).toBe(true);
      for (const name of ["gitq", "console", "chat"]) expect(p.exists(join(home, ".mattstack", name))).toBe(false);
      expect(logs).toEqual([]);
    });

    test("healthy + board NOT bundled: adopts, skips the repoint honestly", async () => {
      const p = bundledProbes({
        tools: ["gitq", "console", "chat"],
        overrides: {
          files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) },
          fetch: healthyFetch(4100),
          exec: async () => ok(""),
        },
      });
      const { ctx, logs } = makeCtx(p);

      expect(await deckManagedStep.run(ctx)).toEqual({ state: "done", detail: "deck ready; board adopted from legacy mrs, repoint skipped (board not bundled yet)" });
      expect(p.calls.fetch.some((u) => u.includes("/api/v1/apps/board"))).toBe(false);
      expect(p.calls.exec).toHaveLength(1);
      expect(logs).toEqual([]);
    });

    test("adopt fails with 'deck not running' -> failed, retryable precondition (not a rejection)", async () => {
      const p = bundledProbes({
        tools: [],
        overrides: {
          files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) },
          fetch: healthyFetch(4100),
          exec: async () => ({ code: 1, stdout: "", stderr: "error: deck not running\n" }),
        },
      });
      const { ctx } = makeCtx(p);

      expect(await deckManagedStep.run(ctx)).toEqual({
        state: "failed",
        detail: "deck stopped responding before it could adopt board",
        remedy: "Start deck, then Retry",
      });
    });

    test("adopt fails with 'name taken' -> failed, generic retry remedy", async () => {
      const p = bundledProbes({
        tools: [],
        overrides: {
          files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) },
          fetch: healthyFetch(4100),
          exec: async () => ({ code: 1, stdout: "", stderr: "error: name taken\n" }),
        },
      });
      const { ctx } = makeCtx(p);

      expect(await deckManagedStep.run(ctx)).toEqual({ state: "failed", detail: "name taken", remedy: "Retry" });
    });

    test("fresh install (no legacy 'mrs'): adopt answers 'unknown app', the step is done and nothing else runs", async () => {
      setSetting("gitq.board", { repos: ["acme/acme-dev"] }, "machine");
      const p = bundledProbes({
        tools: ["gitq", "board", "console", "chat"],
        overrides: {
          files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) },
          fetch: healthyFetch(4100),
          exec: async () => ({ code: 1, stdout: '{"adopted":false,"error":"unknown app"}', stderr: "" }),
        },
      });
      const { ctx } = makeCtx(p);

      expect(await deckManagedStep.run(ctx)).toEqual({ state: "done", detail: "deck ready; no legacy mrs to adopt" });
      expect(p.calls.exec).toHaveLength(1);
      expect(p.calls.fetch.some((u) => u.includes("/api/v1/apps/"))).toBe(false);
    });

    test("idempotent re-run: the second pass adopts and repoints again with the same outcome", async () => {
      const p = bundledProbes({
        tools: ["board"],
        overrides: {
          files: { [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) },
          fetch: healthyFetch(4100),
          exec: async () => ok(""),
        },
      });
      const { ctx: first } = makeCtx(p);
      const { ctx: second } = makeCtx(p);
      const expected = { state: "done", detail: "deck ready; board adopted from legacy mrs, repointed" };

      expect(await deckManagedStep.run(first)).toEqual(expected);
      expect(await deckManagedStep.run(second)).toEqual(expected);
      expect(p.calls.exec.every((argv) => argv[1] === "adopt" && argv[2] === "mrs")).toBe(true);
    });
```

The removed tests ("gitq not bundled", "gitq's real 'deck add' is a stub", "gitq duplicate registration") covered `registerManagedApp`, which this task deletes.

- [ ] **Step 2: Run and see it fail.**

```bash
bun test lib/setup/__tests__/steps-b.test.ts -t "deck.managed"
```

Expected: the five tests that assert a detail fail with a diff like `- "deck ready; board adopted from legacy mrs, repointed"` vs `+ "board adopted (repointed); gitq registered (managed); console registered (managed); chat registered (managed)"`, and "registers no app itself" also fails on `p.calls.exec` (seven argv rows instead of one). The two adopt-failure tests pass.

- [ ] **Step 3: Implement.** In `lib/setup/steps/deck.ts`:

Replace the header comment (lines 1-23) with:

```ts
/**
 * `deck.managed`: brings the pre-deck board row under its real name. Which
 * apps deck serves is deck's own decision, made by its boot sweep from the
 * bundle's catalog, so this step registers no app itself.
 *
 * board ran under mattstack.app's own bootstrap as "mrs" before deck existed.
 * `deck adopt mrs --as board --json` is idempotent (exit 0 covers "just
 * adopted" and "already adopted"), and the record is then repointed at the
 * bundled board binary through deck's `/api/v1/apps/board` PATCH. A machine
 * that never ran that bootstrap answers "unknown app", the fresh-install
 * norm, so the leg skips and the step still completes.
 *
 * The gate is `bundledToolPath`, not `resolveTool().chosen`: a PATH copy
 * would pass `.chosen` and hand deck a command outside its own bundle.
 */
```

Delete the import `import { getSetting } from "../../settings/resolve.ts";` (line 27), the `gitqHasRepos` function (lines 81-84), the `MATTSTACK_REGISTRAR` docblock and const (lines 101-108), and the `registerManagedApp` docblock and function (lines 110-155). Keep `FROZEN_ADOPT_ERRORS`, `matchFrozenError`, `adoptBoard` and `repointBoard` as they are.

Replace the tail of `deckManagedRun` (lines 175-185, from `const adopted = await adoptBoard(ctx, deckBin);` to the closing `return`) with:

```ts
  const adopted = await adoptBoard(ctx, deckBin);
  if (adopted.kind === "failed") return adopted.outcome;
  if (adopted.kind === "skip") return { state: "done", detail: `deck ready; ${adopted.detail}` };
  return { state: "done", detail: `deck ready; board adopted from legacy mrs, ${await repointBoard(ctx, port)}` };
}
```

- [ ] **Step 4: Run to green and typecheck.**

```bash
bun test lib/setup/__tests__/steps-b.test.ts
bunx tsc --noEmit
```

Expected: the whole steps-b file passes (the `bundledProbes` default of `["gitq"]` still serves the services.register tests); tsc exits 0 with no unused-import error.

- [ ] **Step 5: Commit.**

```bash
git add lib/setup/steps/deck.ts lib/setup/__tests__/steps-b.test.ts
git commit -m "setup: deck.managed stops registering apps; deck's sweep serves the bundle's catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `rt uninstall` rejects stray arguments

**Files:**
- Modify: `commands/uninstall.ts` (`runUninstallCommand`, `:55-66`)
- Modify: `lib/command-tree-def.ts` (`uninstall` node, `:2532-2543`)
- Regenerate: `website/docs/reference/uninstall.mdx`
- Test: `commands/__tests__/uninstall.test.ts`, `e2e/tests/setup.test.ts`

**Interfaces:**
- Consumes: `UserActionableError(code, message, extra)` and `userErrorPayload` (`lib/setup/errors.ts:3-15`; `extra` is spread into the envelope's `error`), `TREE` (`lib/command-tree-def.ts:666`).
- Produces: `export const UNINSTALL_FLAGS: readonly ["--keep-data", "--delete-data", "--dry-run", "--yes", "--json"]` from `commands/uninstall.ts`. Any other argv token raises `UserActionableError("unexpected-args", <message>, { args: string[] })`, printed as the contract's error envelope under `--json` or as `rt uninstall: <message>` otherwise, exit 2. The check runs before the data-flag conflict check, the dry run, the TTY prompt and action computation.

The `uninstall` node declares no positional, so `bun run picker:check` has nothing new to gate (`scripts/lib/picker-conformance.ts:41-45` only collects flagless required args) and no `omitBehavior` is added; the step below runs the check to prove it stays green.

- [ ] **Step 1: Write the failing unit tests.** In `commands/__tests__/uninstall.test.ts`, change the import on line 2 to

```ts
import { realUninstallDeps, runUninstallCommand, UNINSTALL_FLAGS, type UninstallDeps } from "../uninstall.ts";
```

add below the other imports

```ts
import { TREE } from "../../lib/command-tree-def.ts";
```

and add this describe right after the `--delete-data` consent-gate describe block (lines 120-179), before the `stayed` describe at line 181:

```ts
describe("rt uninstall: takes no app name", () => {
  const cases: { args: string[]; tty: boolean }[] = [
    { args: ["gitq"], tty: false },
    { args: ["gitq"], tty: true },
    { args: ["--json", "gitq"], tty: false },
    { args: ["--yes", "--json", "board"], tty: false },
    { args: ["--dry-run", "--json", "chat"], tty: false },
    { args: ["--keep_data"], tty: true },
  ];

  for (const { args, tty } of cases) {
    test(`${args.join(" ")} (${tty ? "TTY" : "no TTY"}): exit 2, nothing prompted, nothing run`, async () => {
      const deps = baseDeps({ isTTY: () => tty });

      await runExpectingExit(() => runUninstallCommand(args, {}, deps));

      expect(deps.exitCodes).toEqual([2]);
      expect(deps.confirmCalls).toEqual([]);
      expect(deps.lines).toHaveLength(1);
      expect(deps.probes.calls).toEqual({ exec: [], fetch: [], tray: [], writes: {}, removed: [], symlinks: {}, modes: {}, renames: [] });
    });
  }

  test("--json: the error envelope carries the code and the stray arguments", async () => {
    const deps = baseDeps();

    await runExpectingExit(() => runUninstallCommand(["--json", "gitq", "extra"], {}, deps));

    const payload = JSON.parse(deps.lines[0]!) as { contract: number; error: { code: string; message: string; args: string[] } };
    expect(payload.contract).toBe(1);
    expect(payload.error.code).toBe("unexpected-args");
    expect(payload.error.args).toEqual(["gitq", "extra"]);
    expect(payload.error.message).toContain("deck remove <name> --force");
  });

  test("human mode: one line naming the argument, the whole-product scope and the per-app command", async () => {
    const deps = baseDeps();

    await runExpectingExit(() => runUninstallCommand(["gitq"], {}, deps));

    expect(deps.lines).toEqual([
      'rt uninstall: unexpected argument "gitq". It takes no app name and removes all of mattstack; to remove one app from deck, run: deck remove <name> --force',
    ]);
  });

  test("the handler accepts exactly the flags the command-tree node declares, and the node declares no positional", () => {
    const declared = TREE.uninstall!.args ?? [];
    expect(declared.every((a) => typeof a.flag === "string")).toBe(true);
    expect(declared.map((a) => a.flag).sort()).toEqual([...UNINSTALL_FLAGS].sort());
  });
});
```

Then, in `e2e/tests/setup.test.ts`, add after the `"uninstall --dry-run --json lists actions"` test (ends line 110):

```ts
  // --dry-run on purpose: if the rejection ever regresses, the compiled binary
  // only lists actions instead of uninstalling the app installed on this Mac.
  test("uninstall with an app name exits 2 unexpected-args before anything runs", async () => {
    const res = await run(["uninstall", "gitq", "--dry-run", "--json"]);
    expect(res.exitCode).toBe(2);

    const out = JSON.parse(res.stdout.trim());
    expect(out.contract).toBe(1);
    expect(out.error.code).toBe("unexpected-args");
    expect(out.error.args).toEqual(["gitq"]);
  }, 15_000);
```

- [ ] **Step 2: Run and see both fail.** The e2e preload rebuilds `dist/rt` when its sources are newer, and the harness runs it under a temp `HOME` with a closed env; nothing else runs the binary. Before the fix the binary only performs a read-only dry run.

```bash
bun test commands/__tests__/uninstall.test.ts
bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/setup.test.ts
```

Expected: the unit file fails to load with `SyntaxError: Export named 'UNINSTALL_FLAGS' not found in module '.../commands/uninstall.ts'` (or every new test fails on the missing export). The new e2e case fails on `expect(res.exitCode).toBe(2)` with `Received: 0` (the dry run printed its action list); the other e2e cases pass.

- [ ] **Step 3: Implement.** In `commands/uninstall.ts`, add above `runUninstallCommand`:

```ts
export const UNINSTALL_FLAGS = ["--keep-data", "--delete-data", "--dry-run", "--yes", "--json"] as const;

function rejectStrayArgs(args: string[]): void {
  const stray = args.filter((a) => !(UNINSTALL_FLAGS as readonly string[]).includes(a));
  if (stray.length === 0) return;
  const named = stray.map((a) => `"${a}"`).join(", ");
  throw new UserActionableError(
    "unexpected-args",
    `unexpected ${stray.length === 1 ? "argument" : "arguments"} ${named}. It takes no app name and removes all of mattstack; to remove one app from deck, run: deck remove <name> --force`,
    { args: stray },
  );
}
```

and make it the first statement inside the `try` in `runUninstallCommand` (before the `keepDataFlag && deleteData` check at line 64):

```ts
  try {
    rejectStrayArgs(args);

    if (keepDataFlag && deleteData) {
```

In `lib/command-tree-def.ts`, change the `uninstall` node's description (line 2533) to:

```ts
    description: "Uninstall all of mattstack (takes no app name): services, links, plugins, optionally ~/.mattstack",
```

- [ ] **Step 4: Run both to green.**

```bash
bun test commands/__tests__/uninstall.test.ts
bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/setup.test.ts
```

Expected: all pass, including the existing dry-run, consent-gate, stayed and NDJSON tests (their argv uses only the five flags) and every other e2e setup case.

- [ ] **Step 5: Regenerate the command reference and run the static gates.**

```bash
bun run docs:gen
git status --short website/
bun run docs:check
bun run picker:check
bunx tsc --noEmit
```

Expected: `git status` shows only `M website/docs/reference/uninstall.mdx` (its description line); `docs:check` prints "command reference is in sync with the tree"; `picker:check` exits 0; tsc exits 0. If `docs:gen` touches any other file, stop: `main`'s reference was stale, and only `uninstall.mdx` belongs in this commit (`git checkout -- <other files>`).

- [ ] **Step 6: Commit.**

```bash
git add commands/uninstall.ts commands/__tests__/uninstall.test.ts lib/command-tree-def.ts website/docs/reference/uninstall.mdx e2e/tests/setup.test.ts
git commit -m "uninstall: reject app names and unknown flags instead of uninstalling everything" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `deck.managed-remove` makes one bulk call

**Files:**
- Modify: `lib/setup/uninstall.ts` (title `:73`, `DECK_NOTHING_TO_REMOVE` and `deckManagedRemoveRun` `:131-161`)
- Modify: `rt-tray/Tests/stub-rt/stub.ts` (title `:228`)
- Test: `lib/setup/__tests__/uninstall.test.ts` (`describe("deck.managed-remove")`, `:323-376`)

**Interfaces:**
- Consumes: deck's `POST /api/v1/apps/managed/remove`, which removes every record whose `managedBy` is neither `user` nor the platform and answers `200 { ok: boolean, removed: string[], failed: string[] }` (mattstack-apps `apps/deck/src/api/server.ts:488-501`, `apps/deck/src/api/register.ts` `removeManagedApps`). A POST with no `Origin` header passes deck's local-origin gate (`packages/server/src/local-request.ts:80-82`). `readDeckApiPort`, `deckIsHealthy` (`lib/setup/steps/deck.ts`).
- Produces: `deck.managed-remove` outcomes, exactly:
  - deck down or no `api.json`: `{ state: "skipped", detail: "deck is not running; nothing to unmanage" }`
  - 200, `failed` empty: `{ state: "done", detail: "removed: <names joined by ', '>" }`, or `"no mattstack apps in deck"` when `removed` is empty
  - 200, `failed` non-empty: `{ state: "failed", detail: "<removed part>; teardown failed, record kept: <names>", remedy: "Retry" }`
  - any other status, or a body without string arrays `removed` and `failed`: `{ state: "failed", detail: "deck answered <status> to the managed remove" | "deck did not answer the managed remove", remedy: "Retry" }`
  - Title: `"Remove mattstack's apps from deck"`.

- [ ] **Step 1: Write the failing tests.** In `lib/setup/__tests__/uninstall.test.ts`, replace the whole `describe("deck.managed-remove", () => { ... });` block (lines 323-376) with:

```ts
  describe("deck.managed-remove", () => {
    type FetchInit = Parameters<Probes["fetch"]>[1];

    function deckUp(answer: { status: number; body: string }): { p: ReturnType<typeof fakeProbes>; seen: { url: string; init: FetchInit }[] } {
      const seen: { url: string; init: FetchInit }[] = [];
      const p = bareProbes({
        ...pathTool("deck"),
        files: { ...pathTool("deck").files, [join(home, ".mattstack", "deck", "api.json")]: JSON.stringify({ port: 4100 }) },
        fetch: async (url, init) => {
          if (url.endsWith("/healthz")) return { status: 200, body: "ok", headers: {} };
          seen.push({ url, init });
          return { status: answer.status, body: answer.body, headers: {} };
        },
        exec: async () => ok(""),
      });
      return { p, seen };
    }

    function lastStep(events: ApplyEvent[]): { state: string; detail?: string; remedy?: string } | undefined {
      return events.filter((e) => e.event === "step").at(-1) as { state: string; detail?: string; remedy?: string } | undefined;
    }

    const action: UninstallAction[] = [{ id: "deck.managed-remove", title: "x", kind: "rt" }];

    test("deck not running (no api.json) -> skipped, no exec, no fetch", async () => {
      const p = bareProbes(pathTool("deck"));
      const { ctx, events } = makeCtx(p);
      const result = await runUninstall(ctx, action);
      expect(result.ok).toBe(true);
      expect(lastStep(events)).toMatchObject({ state: "skipped", detail: "deck is not running; nothing to unmanage" });
      expect(p.calls.exec).toEqual([]);
      expect(p.calls.fetch).toEqual([]);
    });

    test("healthy deck: exactly one POST to the managed remove, naming no app, and no deck CLI exec", async () => {
      const { p, seen } = deckUp({ status: 200, body: JSON.stringify({ ok: true, removed: ["board", "chat", "console"], failed: [] }) });
      const { ctx, events } = makeCtx(p);
      const result = await runUninstall(ctx, action);
      expect(result.ok).toBe(true);
      expect(seen.map((s) => [s.url, s.init?.method])).toEqual([["http://127.0.0.1:4100/api/v1/apps/managed/remove", "POST"]]);
      expect(seen[0]!.init?.body).toBeUndefined();
      expect(p.calls.exec).toEqual([]);
      expect(lastStep(events)).toMatchObject({ state: "done", detail: "removed: board, chat, console" });
    });

    test("nothing registered -> done, says so", async () => {
      const { p } = deckUp({ status: 200, body: JSON.stringify({ ok: true, removed: [], failed: [] }) });
      const { ctx, events } = makeCtx(p);
      expect((await runUninstall(ctx, action)).ok).toBe(true);
      expect(lastStep(events)).toMatchObject({ state: "done", detail: "no mattstack apps in deck" });
    });

    test("partial teardown (ok:false) -> failed with Retry, names what was removed and what was kept", async () => {
      const { p } = deckUp({ status: 200, body: JSON.stringify({ ok: false, removed: ["board"], failed: ["chat"] }) });
      const { ctx, events } = makeCtx(p);
      expect((await runUninstall(ctx, action)).ok).toBe(false);
      expect(lastStep(events)).toMatchObject({ state: "failed", detail: "removed: board; teardown failed, record kept: chat", remedy: "Retry" });
    });

    for (const [label, answer, detail] of [
      ["a 500", { status: 500, body: "{}" }, "deck answered 500 to the managed remove"],
      ["no answer (status 0)", { status: 0, body: "" }, "deck did not answer the managed remove"],
      ["a 200 that is not JSON", { status: 200, body: "<html>" }, "deck answered 200 to the managed remove"],
      ["a 200 without the name arrays", { status: 200, body: JSON.stringify({ ok: true }) }, "deck answered 200 to the managed remove"],
    ] as const) {
      test(`${label} -> failed with Retry, never done`, async () => {
        const { p } = deckUp(answer);
        const { ctx, events } = makeCtx(p);
        expect((await runUninstall(ctx, action)).ok).toBe(false);
        expect(lastStep(events)).toMatchObject({ state: "failed", detail, remedy: "Retry" });
      });
    }

    test("the action's title names mattstack's apps, not two of them", () => {
      const actions = computeUninstallActions(bareProbes(pathTool("deck")), { keepData: true }, noEditorSeams);
      expect(actions.find((a) => a.id === "deck.managed-remove")?.title).toBe("Remove mattstack's apps from deck");
    });
  });
```

- [ ] **Step 2: Run and see it fail.**

```bash
bun test lib/setup/__tests__/uninstall.test.ts -t "deck.managed-remove"
```

Expected: "exactly one POST" fails because `seen` is `[]` and `p.calls.exec` holds two `remove --managed` argv rows; the skipped test fails on the detail (today's string joins its halves with a dash, not a semicolon); the failure-mapping tests report `ok: true` (exec answers `ok("")`); the title test gets `"Remove board and gitq from deck"`.

- [ ] **Step 3: Implement.** In `lib/setup/uninstall.ts`, change line 73 to

```ts
    actions.push({ id: "deck.managed-remove", title: "Remove mattstack's apps from deck", kind: "rt" });
```

and replace lines 131-161 (the `DECK_NOTHING_TO_REMOVE` docblock and const, and `deckManagedRemoveRun`) with:

```ts
/** Deck tears each app down in turn (launchd bootout, proxy route), so the bulk remove outlives the default probe timeout. */
const DECK_MANAGED_REMOVE_TIMEOUT_MS = 120_000;

function managedRemoveReply(body: string): { removed: string[]; failed: string[] } | null {
  let parsed: { removed?: unknown; failed?: unknown };
  try {
    parsed = JSON.parse(body) as { removed?: unknown; failed?: unknown };
  } catch {
    return null;
  }
  const names = (v: unknown): string[] | null => (Array.isArray(v) && v.every((n) => typeof n === "string") ? (v as string[]) : null);
  const removed = names(parsed.removed);
  const failed = names(parsed.failed);
  return removed !== null && failed !== null ? { removed, failed } : null;
}

async function deckManagedRemoveRun(ctx: ApplyContext): Promise<ActionResult> {
  const port = readDeckApiPort(ctx);
  const healthy = port !== null && (await deckIsHealthy(ctx, port));
  if (!healthy) return { outcome: { state: "skipped", detail: "deck is not running; nothing to unmanage" } };

  const res = await ctx.p.fetch(`http://127.0.0.1:${port}/api/v1/apps/managed/remove`, { method: "POST", timeoutMs: DECK_MANAGED_REMOVE_TIMEOUT_MS });
  const reply = res.status === 200 ? managedRemoveReply(res.body) : null;
  if (reply === null) {
    const detail = res.status === 0 ? "deck did not answer the managed remove" : `deck answered ${res.status} to the managed remove`;
    return { outcome: { state: "failed", detail, remedy: "Retry" } };
  }

  const removed = reply.removed.length > 0 ? `removed: ${reply.removed.join(", ")}` : "no mattstack apps in deck";
  if (reply.failed.length > 0) {
    return { outcome: { state: "failed", detail: `${removed}; teardown failed, record kept: ${reply.failed.join(", ")}`, remedy: "Retry" } };
  }
  return { outcome: { state: "done", detail: removed } };
}
```

`resolveTool` stays imported: `computeUninstallActions` still gates the action on it (line 72).

In `rt-tray/Tests/stub-rt/stub.ts` line 228, change the title to `"Remove mattstack's apps from deck"` so the DEBUG stub's confirmation sheet matches the real one.

- [ ] **Step 4: Run to green and typecheck.**

```bash
bun test lib/setup/__tests__/uninstall.test.ts
bun test rt-tray/Tests/stub-rt/stub.test.ts
bunx tsc --noEmit
```

Expected: all pass; tsc exits 0.

- [ ] **Step 5: Commit.**

```bash
git add lib/setup/uninstall.ts lib/setup/__tests__/uninstall.test.ts rt-tray/Tests/stub-rt/stub.ts
git commit -m "uninstall: one bulk managed remove over deck's API, named for what it removes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `deck.managed-remove` runs before `services.unregister`

**Files:**
- Modify: `lib/setup/uninstall.ts` (`computeUninstallActions`, `:67-74`)
- Modify: `rt-tray/Tests/stub-rt/stub.ts` (`uninstallActions`, `:223-238`), `rt-tray/Tests/stub-rt/stub.test.ts` (`:71`, `:119`)
- Modify: `docs/superpowers/specs/2026-08-21-rt-setup-contract.md` (`:191-193`)
- Test: `lib/setup/__tests__/uninstall.test.ts` (`:129-150`), `e2e/tests/setup.test.ts` (`:101-110`)

**Interfaces:**
- Consumes: `servicePlists` (`lib/setup/need.ts:49-54`), which puts `com.mattstack.deck.plist` in the `app-unregister-services` request whenever deck is bundled; `runUninstall` stops at the first failed action (`lib/setup/uninstall.ts:373-376`).
- Produces: uninstall action order `deck.managed-remove` (when deck resolves), `services.unregister`, `proxy.remove`, `path.unlink`, `shell.remove`, `extension.uninstall`, `plugins.uninstall`, `data`, `app.trash`. Ids and titles are otherwise unchanged; the tray renders the order it is given.

- [ ] **Step 1: Write the failing tests.** In `lib/setup/__tests__/uninstall.test.ts`, in `"a fully-installed machine, keepData true: every id except data, in contract order"`, swap the first two expected ids so the array starts:

```ts
      expect(actions.map((a) => a.id)).toEqual([
        "deck.managed-remove",
        "services.unregister",
        "proxy.remove",
```

and add inside `describe("computeUninstallActions")`:

```ts
    test("deck.managed-remove runs before services.unregister, which stops deck itself", () => {
      const ids = computeUninstallActions(bareProbes(pathTool("deck")), { keepData: true }, noEditorSeams).map((a) => a.id);
      expect(ids.indexOf("deck.managed-remove")).toBe(0);
      expect(ids.indexOf("services.unregister")).toBe(1);
    });
```

In `rt-tray/Tests/stub-rt/stub.test.ts`, change both expected arrays (line 71 and line 119) to start `["deck.managed-remove", "services.unregister", "proxy.remove", ...` with the rest unchanged.

- [ ] **Step 2: Run and see it fail.**

```bash
bun test lib/setup/__tests__/uninstall.test.ts -t "computeUninstallActions"
bun test rt-tray/Tests/stub-rt/stub.test.ts
```

Expected: the two order tests in uninstall.test.ts fail (`services.unregister` at index 0), and both stub tests fail on the swapped first two ids.

- [ ] **Step 3: Implement.** In `lib/setup/uninstall.ts`, make the start of `computeUninstallActions` read:

```ts
  const actions: UninstallAction[] = [];

  // Before services.unregister: that action unregisters deck's own agent, and
  // the managed remove needs a live deck to tear its apps down.
  if (resolveTool(p, "deck").chosen !== null) {
    actions.push({ id: "deck.managed-remove", title: "Remove mattstack's apps from deck", kind: "rt" });
  }

  actions.push({ id: "services.unregister", title: "Stop and remove the rt daemon and deck services", kind: "app" });
```

In `rt-tray/Tests/stub-rt/stub.ts`, move the `deck.managed-remove` entry above the `services.unregister` entry in `uninstallActions()`.

In `docs/superpowers/specs/2026-08-21-rt-setup-contract.md`, change lines 191-193 to:

```markdown
Action ids (v1, in order): `deck.managed-remove` · `services.unregister` ·
`proxy.remove` · `path.unlink` · `shell.remove` · `extension.uninstall` ·
`plugins.uninstall` · `data` (only with `--delete-data`) · `app.trash`.
`deck.managed-remove` comes first because `services.unregister` stops deck.
```

In `e2e/tests/setup.test.ts`, replace the body of `"uninstall --dry-run --json lists actions"` after `expect(Array.isArray(out.actions)).toBe(true);` (the comment and the `actions[0]` assertion) with:

```ts
    // services.unregister is on every machine; deck.managed-remove appears only
    // where deck resolves (an installed mattstack.app does), and then first.
    const ids = out.actions.map((a: { id: string }) => a.id);
    expect(ids).toContain("services.unregister");
    if (ids.includes("deck.managed-remove")) expect(ids.indexOf("deck.managed-remove")).toBeLessThan(ids.indexOf("services.unregister"));
```

- [ ] **Step 4: Run to green.**

```bash
bun test lib/setup/__tests__/uninstall.test.ts
bun test rt-tray/Tests/stub-rt/stub.test.ts
bun test commands/__tests__/uninstall.test.ts
bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/setup.test.ts
bunx tsc --noEmit
```

Expected: all pass; tsc exits 0.

- [ ] **Step 5: Commit.**

```bash
git add lib/setup/uninstall.ts lib/setup/__tests__/uninstall.test.ts rt-tray/Tests/stub-rt/stub.ts rt-tray/Tests/stub-rt/stub.test.ts docs/superpowers/specs/2026-08-21-rt-setup-contract.md e2e/tests/setup.test.ts
git commit -m "uninstall: remove deck's apps before unregistering deck itself" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Final checks, push, PR

**Files:** none changed (PR body written to the scratchpad).

- [ ] **Step 1: Prove the do-not-touch paths are untouched.**

```bash
git diff --stat origin/main -- lib/deps/links.ts rt-tray/deps.lock lib/release/preflight.ts lib/release/__tests__/preflight.test.ts
```

Expected: no output.

- [ ] **Step 2: Dash and comment sweep over the diff.**

```bash
git diff origin/main -U0 | grep '^+' | grep -c $'\u2014'
git diff origin/main -U0 | grep '^+' | grep -c $'\u2013'
```

Expected: both print `0` (zsh expands `$'\u2014'` and `$'\u2013'` to the em and en dash; `grep -c` exits 1 on a zero count, which is the pass). Read every added comment once: each must state a constraint, not narrate.

- [ ] **Step 3: Rerun every touched test file once more, plus the static gates.**

```bash
bun test lib/setup/__tests__/steps-b.test.ts
bun test lib/setup/__tests__/uninstall.test.ts
bun test commands/__tests__/uninstall.test.ts
bun test rt-tray/Tests/stub-rt/stub.test.ts
bun test lib/setup/__tests__/contract.test.ts
bun test --preload ./e2e/setup.ts --timeout 60000 e2e/tests/setup.test.ts
bunx tsc --noEmit
bun run picker:check
bun run docs:check
```

Expected: all green.

- [ ] **Step 4: Push.**

```bash
git push -u origin rt-2-13-e-setup-cli-cleanup
```

- [ ] **Step 5: Write the PR body** with the Write tool to `<scratchpad>/pr-body-E.md`:

```markdown
## Setup and uninstall stop guessing which apps exist (RT-281, RT-284)

Deck's boot sweep now owns which bundled apps it serves, so `rt setup` stops registering them one by one, and `rt uninstall` can no longer be aimed at one app while it removes everything.

**Merge after** the deps.lock PR that pins deck 1.1.0 with the `serve` catalog. Until then a clean install would register neither chat nor console.

**Dev flavor:** deck 1.1.0's sweep creates missing catalog rows in dev too, so a dev-only machine still gets chat and console once setup stops registering them.


### What changed

**Setup** (`lib/setup/steps/deck.ts`)

- Removes the gitq, console and chat legs, `gitqHasRepos` and their `mkdirp`
- Keeps the legacy `mrs` to `board` adoption and repoint
- New detail strings; `steps-b.test.ts` follows

**Uninstall**

- `rt uninstall` rejects any argument outside its five flags with `unexpected-args` (exit 2), before a dry run or prompt
- `deck.managed-remove` makes one `POST /api/v1/apps/managed/remove` instead of a per-name loop that depended on deck ignoring the name
- The action now runs before `services.unregister`, which stops deck itself
- Title is now "Remove mattstack's apps from deck"

**Also**

- The command reference, the DEBUG tray stub and the setup contract doc follow
- `DEFAULT_EXPOSED`, the gitq deps.lock row and the `standalone:gitq` preflight row are untouched

### Verification

Targeted: steps-b, uninstall (lib and command), stub-rt, contract, e2e `setup.test.ts`, tsc, picker:check, docs:check. Full suites run in CI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 6: Open the PR as a draft** (it stays a draft until the deck pin lands).

```bash
gh pr create --draft --base main --head rt-2-13-e-setup-cli-cleanup --title "setup and uninstall: rely on deck's sweep, reject app names" --body-file <scratchpad>/pr-body-E.md
```

- [ ] **Step 7: Review and merge gate.** Wait for CodeRabbit (or, if it is rate limited, an Opus stand-in review) and CI; address every actionable finding with a new commit. Mark ready and merge only once all of these hold:
  - the bot deps.lock PR pinning deck 1.1.0 (README merge order step 10) is on `main` (`gh pr list --repo m4ttstack/rt --state merged --search "deps.lock: app bundle build" --limit 3` shows it);
  - the B dev-creation decision is recorded: check the **Dev flavor** line in this PR's body against what deck 1.1.0 shipped (read `ensureCatalogRows` in `apps/deck/src/api/register.ts` on mattstack-apps `main`: an `adopt` parameter with a create leg that runs in both flavors means dev creates). If Matt ruled instead that dev serves only what the user registered, rewrite the line to "Dev serves only what the user registered; a dev-only machine gets chat and console from `deck register --dir <source>`." and confirm the spec's rule section says so too;
  - both gates are green.

---

## Contract notes

- **Shared contracts 1 to 8 are not consumed by this unit.** E reads no `serve` field, no `Contents/Resources/deps.lock` and no bundled manifest; it only stops doing work the sweep now does. Nothing here diverges from them.
- **Refinement: what "one targeted call" is.** The spec asks the uninstall deck step to make one targeted call. That call is `POST /api/v1/apps/managed/remove` over deck's HTTP API, not the `deck` CLI. Reasons: (a) unit B changes `deck remove --managed <name>` to remove only `<name>`, after which rt's current per-name loop over `board` and `gitq` would leave chat, console and boxscore installed; (b) the route answers structured `{ok, removed, failed}` instead of stdout text; (c) it cannot hit a different `deck` on PATH (Kong's `deck` is a known case, `docs/daemon-stability-audit-2026-08.md:722`). **Contract with unit B:** the route `POST /api/v1/apps/managed/remove` keeps removing every rt-managed row and keeps its reply shape. The bare `deck remove --managed` (no name) should stay the bulk verb too, for anyone scripting it, but E no longer depends on the CLI.
- **Refinement: action order.** `deck.managed-remove` moves ahead of `services.unregister` (Task 4). Not in the spec's text, but without it the one call never reaches a live deck: `services.unregister` unregisters `com.mattstack.deck.plist` first (`lib/setup/need.ts:49-54`), and every `com.mattstack.deck.<app>` agent stays behind. The v1 ids are unchanged; only the order moves, and the setup contract doc says so.
- **`repointBoard` kept.** It still PATCHes board's record to `[<active bundle>/Contents/Helpers/board]` with `~/.mattstack/board`. Under unit B the catalog's args win over a stored command inside a mattstack bundle's `Helpers`, so the repoint is redundant in prod but harmless, and it is part of the adoption leg the spec keeps. Board's serve args are empty, matching the catalog.
- **No sweep poke from setup.** `deck.managed` does not `POST /api/v1/apps/managed/reresolve`. The sweep runs on every deck start and after every flavor switch, and `services.register` (earlier in apply order) is what starts deck.
- **No gitq row cleanup in rt.** Existing rt-managed gitq web-app rows are unit B's job (outcome `'not-served'`: plist uninstalled, row and dev link kept). E only stops creating them.

## Risks

- **Dev flavor on a fresh machine.** The ratified rule is "dev serves whatever is registered". After this PR nothing in `rt setup` registers chat or console, so a fresh machine that only ever runs the dev app gets them only because unit B's sweep now creates missing catalog rows in both flavors (B Task 5, B contract note 12, the recommended default), or after `deck register --dir <source>` if Matt rules that dev must not create them. Step 7 records whichever holds in the PR body before merge.
- **Uninstall now stops earlier on a deck failure.** `runUninstall` halts at the first failed action; with the new order a partial deck teardown stops the run before services are unregistered. The remedy is Retry, and the tray shows the failing title and detail.
- **Version skew.** The POST route already exists on the currently pinned deck (1.0.x) with the same bulk semantics, so the uninstall change is safe before and after the pin bump; only the setup change needs the pin.
