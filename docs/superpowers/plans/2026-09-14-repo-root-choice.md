# Repo Root Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rt asks the user where their repos go instead of silently creating `~/Documents/GitHub` or adopting whatever candidate directory it happens to find.

**Architecture:** A new required checklist row (`repos.root`) renders whenever the user is setting up a team or already has one with tracked repos. Its action is a new `choose-folder` contract type the Swift tray answers with `NSOpenPanel`, re-dispatching the chosen path through the existing `fieldValues` channel into a new validating rt verb. `settings.seed` stops writing `rt.repoRoots` and stops creating directories; the candidate list moves to a module the row and the verb share.

**Tech Stack:** Bun + TypeScript (rt CLI), Swift + SwiftUI (rt-tray), `bun test`, `swift run mattstack-checks`.

**Spec:** `docs/superpowers/specs/2026-09-14-repo-root-choice-design.md`

## Global Constraints

- No em dashes or en dashes anywhere, in code, comments, tests, commit messages, or docs. Use an ellipsis ("...") or rephrase. See `~/.claude/rules/no-em-dashes.md`.
- Clean-code comments only: a comment earns its place by stating a constraint the code cannot show. Never narrate the next line, never cite a ticket id or review finding in source.
- `bun run test` does NOT run e2e. Run `bun run test:all`, or at minimum the e2e file covering a surface you changed, before calling anything verified.
- TDD throughout: write the failing test, run it, watch it fail for the stated reason, then implement. A test that passes before the change is not RED, it is a characterization test, and this plan says explicitly where one is intended.
- `repos.root` must NOT be added to `INSTALL_SATISFIED_IDS` in `lib/setup/plan.ts`.
- The verb writes `rt.repoRoots` at the **machine** scope (`scopes: ["machine"]` in `packages/rt-client/src/settings/registry-defs.ts`).
- `rt.repoRoots` has `default: []` in that registry. It is NEVER `undefined`. Assert `toEqual([])` or use `unwritten()` from `lib/setup/steps/step-utils.ts`; `toBeUndefined()` can never pass.
- rt must never create a repo-root directory on the user's behalf. `NSOpenPanel`'s own New Folder button is how a user makes one.
- Never run a verb that writes real settings against your own HOME. Use `env -i HOME=$(mktemp -d) ...` for any smoke check, per this repo's operating rules.
- Work on branch `repo-root-choice`, which carries the spec. Never push to `main`. Never leave the shared main checkout on a branch.

### The render gate, and why it is two conditions

The row renders when:

```ts
team.mode !== "none" || snapshot.trackingIdentities.length > 0
```

An earlier draft gated on `trackingIdentities` alone and was wrong in the one case that matters. `trackingIdentities` comes from `mattstack.tracking`, a team-scoped key read out of `~/.mattstack/teams/<slug>/mattstack/settings.team.jsonc`. On a joiner's fresh Mac that clone does not exist until `team.join`, which runs **inside** Install. `enrichSnapshotForge` back-fills only `integrations.forge`, never tracking. So a joiner's first checklist pass sees `[]`, the row would not render, `canInstall` would be true, and Install would run with no repo root: `repos.clone` skips, `board.keys` leaves `board.cwds` and `gitq.workSlots` unset, and the joiner clones zero repos.

`team.mode` alone fails the other way: `teamRefFromIntent` returns `"none"` once the teams are cloned and no intent remains, so a root that later went missing would have no row.

Both conditions together cover pre-Install (intent) and post-Install (snapshot).

---

### Task 1: The shared repo-root module

Built first because both the row (Task 4) and the verb (Task 5) validate through it, and because the candidate list must live in exactly one place before Task 2 deletes the other copy.

**Files:**
- Create: `lib/setup/repo-root.ts`
- Test: `lib/setup/__tests__/repo-root.test.ts`

**Interfaces:**
- Consumes: `Probes` (`home` only, plus an injected `stat`).
- Produces:

```ts
export const CANDIDATE_ROOT_NAMES: string[];
export type RootStat = { isDirectory: boolean; writable: boolean } | null;
export function expandHome(p: Pick<Probes, "home">, path: string): string;
export type RootCheck =
  | { ok: true; path: string; tccWarning: string | null }
  | { ok: false; detail: string };
export function checkRepoRoot(p: Pick<Probes, "home">, raw: string, stat: (path: string) => RootStat): RootCheck;
export function detectCandidate(p: Pick<Probes, "home" | "exists">): string | null;
export function realRootStat(path: string): RootStat;
```

- [ ] **Step 1: Write the failing tests**

Create `lib/setup/__tests__/repo-root.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { checkRepoRoot, detectCandidate, expandHome } from "../repo-root.ts";

const HOME = "/Users/t";
const p = (existing: string[] = []) => ({ home: HOME, exists: (x: string) => existing.includes(x) });
const dir = () => ({ isDirectory: true, writable: true });
const file = () => ({ isDirectory: false, writable: true });
const readonlyDir = () => ({ isDirectory: true, writable: false });
const gone = () => null;

describe("checkRepoRoot", () => {
  test("a writable directory is accepted and carries no warning", () => {
    expect(checkRepoRoot(p(), "/Users/t/dev", dir)).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test.each([["~/dev"], ["${home}/dev"]])("expands %s before validating", (raw) => {
    expect(checkRepoRoot(p(), raw, dir)).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test("a path that does not exist is refused and says so", () => {
    const r = checkRepoRoot(p(), "/Users/t/nope", gone);
    expect(r).toEqual({ ok: false, detail: "/Users/t/nope does not exist" });
  });

  test("a file is refused as not a directory", () => {
    const r = checkRepoRoot(p(), "/Users/t/notes.txt", file);
    expect(r).toEqual({ ok: false, detail: "/Users/t/notes.txt is not a directory" });
  });

  test("an unwritable directory is refused", () => {
    const r = checkRepoRoot(p(), "/Users/t/locked", readonlyDir);
    expect(r).toEqual({ ok: false, detail: "/Users/t/locked is not writable" });
  });

  test("an empty path is refused rather than resolving to home", () => {
    expect(checkRepoRoot(p(), "   ", dir)).toEqual({ ok: false, detail: "no path given" });
  });

  // Advisory on purpose. It is the user's machine, and ~/Documents/GitHub is a
  // common convention; refusing would put rt's judgement back in place of
  // theirs, which is the defect this whole change removes.
  test.each([
    ["/Users/t/Documents/GitHub", "Documents"],
    ["/Users/t/Desktop/code", "Desktop"],
    ["/Users/t/Downloads/code", "Downloads"],
  ])("%s is ACCEPTED with a warning naming %s", (path, dirName) => {
    const r = checkRepoRoot(p(), path, dir);
    expect(r.ok).toBe(true);
    expect((r as { tccWarning: string | null }).tccWarning).toContain(dirName);
  });

  test("a directory merely NAMED Documents outside home is not warned about", () => {
    const r = checkRepoRoot(p(), "/srv/Documents/code", dir);
    expect((r as { tccWarning: string | null }).tccWarning).toBeNull();
  });
});

describe("detectCandidate", () => {
  test("returns the first candidate that exists", () => {
    expect(detectCandidate(p(["/Users/t/code"]))).toBe("/Users/t/code");
  });

  test("follows list order when several exist", () => {
    expect(detectCandidate(p(["/Users/t/code", "/Users/t/Documents/GitHub"]))).toBe("/Users/t/Documents/GitHub");
  });

  test("returns null when none exist, so nothing is suggested", () => {
    expect(detectCandidate(p())).toBeNull();
  });
});

describe("expandHome", () => {
  test.each([["~/dev", "/Users/t/dev"], ["${home}/dev", "/Users/t/dev"], ["/abs", "/abs"], ["~notahome", "~notahome"]])(
    "%s -> %s",
    (raw, want) => expect(expandHome({ home: HOME }, raw)).toBe(want),
  );
});
```

- [ ] **Step 2: Run and watch every test fail**

Run: `bun test lib/setup/__tests__/repo-root.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `lib/setup/repo-root.ts`**

```ts
/**
 * Where the user's repos go. rt validates a path the user picked; it never
 * picks one. `stat` is injected so the checks are testable without a
 * filesystem and so the one syscall lives at the caller.
 */
import { statSync, accessSync, constants } from "fs";
import { join } from "path";
import type { Probes } from "./probes.ts";

export const CANDIDATE_ROOT_NAMES = ["Documents/GitHub", "GitHub", "code", "src"];

/** Directories macOS gates behind TCC. rt holds Full Disk Access, so rt never meets the prompts these cause for the user's other tools. */
const TCC_PROTECTED = ["Documents", "Desktop", "Downloads"];

export type RootStat = { isDirectory: boolean; writable: boolean } | null;

export function expandHome(p: Pick<Probes, "home">, path: string): string {
  if (path.startsWith("~/")) return join(p.home, path.slice(2));
  if (path.startsWith("${home}/")) return join(p.home, path.slice(8));
  return path;
}

export type RootCheck =
  | { ok: true; path: string; tccWarning: string | null }
  | { ok: false; detail: string };

export function checkRepoRoot(p: Pick<Probes, "home">, raw: string, stat: (path: string) => RootStat): RootCheck {
  const path = expandHome(p, raw.trim());
  if (path === "") return { ok: false, detail: "no path given" };
  const s = stat(path);
  if (s === null) return { ok: false, detail: `${path} does not exist` };
  if (!s.isDirectory) return { ok: false, detail: `${path} is not a directory` };
  if (!s.writable) return { ok: false, detail: `${path} is not writable` };

  // Anchored under home: only the user's own TCC-gated directories count, so
  // an unrelated /srv/Documents is not warned about.
  const rel = path.startsWith(`${p.home}/`) ? path.slice(p.home.length + 1) : "";
  const gated = TCC_PROTECTED.find((d) => rel === d || rel.startsWith(`${d}/`));
  return {
    ok: true,
    path,
    tccWarning: gated
      ? `${gated} is protected by macOS privacy controls, so your editor, terminal git and other tools may need permission to reach repos here`
      : null,
  };
}

export function detectCandidate(p: Pick<Probes, "home" | "exists">): string | null {
  return CANDIDATE_ROOT_NAMES.map((rel) => join(p.home, rel)).find((path) => p.exists(path)) ?? null;
}

/** Never throws: a path that cannot be stat'd is indistinguishable from one that is not there, and both are "choose another". */
export function realRootStat(path: string): RootStat {
  try {
    const s = statSync(path);
    let writable = false;
    try {
      accessSync(path, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    return { isDirectory: s.isDirectory(), writable };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `bun test lib/setup/__tests__/repo-root.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/repo-root.ts lib/setup/__tests__/repo-root.test.ts
git commit -m "setup: add the shared repo-root validator"
```

---

### Task 2: `settings.seed` stops deciding

**Files:**
- Modify: `lib/setup/steps/settings.ts` (delete `detectOrCreateDefaultRoot`, `detectRepoRoots`, `CANDIDATE_ROOT_NAMES`, `DEFAULT_ROOT_NAME`, and the `rt.repoRoots` block in `settingsSeedRun`)
- Test: `lib/setup/__tests__/steps-a.test.ts`

**Interfaces:**
- Consumes: nothing. The candidate list now lives in `lib/setup/repo-root.ts` (Task 1); do not import it here, `settings.ts` no longer needs it.
- Produces: nothing.

**Other readers of `rt.repoRoots`, and why deleting this write is safe**

- `lib/setup/steps/repos.ts:88` (`repos.clone`, step 9)
- `lib/setup/steps/skills.ts:150` (`board.keys`, step 15) seeds `board.cwds`, and `:167` gates `gitq.workSlots` on the same root
- `lib/repo-index.ts:811` (the repo scanner)

Today `settings.seed` at step 8 is what makes the root available to steps 9 and 15. Deleting that write in isolation would silently cost the user `board.cwds` and `gitq.workSlots`: `boardKeysRun` logs and leaves them unset rather than failing, so nothing goes red.

It is safe only because `repos.root` is required and answered before Install starts. That makes the ordering a real dependency rather than a coincidence, which is why Step 5 pins it.

- [ ] **Step 1: Write the two failing tests**

`makeCtx` has signature `makeCtx(p: Probes, overrides: Partial<ApplyContext> = {})` and returns `{ ctx, logs }`. `home`, `exists` and directory state belong to `fakeProbes`, not to `makeCtx`. `fakeProbes.calls` has NO `mkdirp` list, so do not try to capture one: assert on `p.exists` afterwards, which is how the existing directory-creation test does it. Read `steps-a.test.ts:130` and the neighbouring `settings.seed` tests before writing either test.

```ts
test("settings.seed never writes rt.repoRoots, even when a candidate directory exists", async () => {
  const p = fakeProbes({ home, dirs: [join(home, "Documents", "GitHub")] });
  const { ctx } = makeCtx(p, { snapshot: { ...EMPTY_SNAPSHOT, trackingIdentities: ["gitlab.com/acme/one"] } });
  const outcome = await settingsSeedStep.run(ctx);
  expect(outcome.state).toBe("done");
  expect(getSetting<string[]>("rt.repoRoots").value).toEqual([]);
});

test("settings.seed creates no directory when nothing is detected", async () => {
  const p = fakeProbes({ home, dirs: [] });
  const { ctx } = makeCtx(p, { snapshot: { ...EMPTY_SNAPSHOT, trackingIdentities: ["gitlab.com/acme/one"] } });
  await settingsSeedStep.run(ctx);
  expect(p.exists(join(home, "Documents", "GitHub"))).toBe(false);
});
```

Use the real names for `fakeProbes`, `EMPTY_SNAPSHOT` and the step export as they appear in that file; the shapes above follow its conventions but confirm each one.

- [ ] **Step 2: Run them and watch both fail**

Run: `bun test lib/setup/__tests__/steps-a.test.ts -t "settings.seed"`
Expected: both FAIL. The first because `rt.repoRoots` is written (it reads `["<home>/Documents/GitHub"]`, not `[]`); the second because the directory was created. If either passes, the fake wiring is wrong: fix it before touching production code.

- [ ] **Step 3: Delete the decision**

In `lib/setup/steps/settings.ts` delete `detectOrCreateDefaultRoot`, `detectRepoRoots`, `CANDIDATE_ROOT_NAMES` and `DEFAULT_ROOT_NAME`, and remove the `if (unwritten("rt.repoRoots")) { ... }` block from `settingsSeedRun`. All four become dead once the block goes, and `noUnusedLocals` is off so nothing will tell you. The candidate list lives in `lib/setup/repo-root.ts` now; a second copy here is how the two drift.

Update the file's header docblock: it says the step seeds "`rt.repoRoots` (detected candidate directories, only when nothing is set yet)". Replace that clause with one saying the repo root is the user's own choice, made through the `repos.root` row, and that this step no longer touches the key.

- [ ] **Step 4: Run the whole file**

Run: `bun test lib/setup/__tests__/steps-a.test.ts`
Expected: PASS. Four existing tests reference the old behavior (around lines 771, 782, 812 and 835). Handle them individually rather than deleting on sight:

- the one asserting rt creates `Documents/GitHub` is asserting the defect: delete it
- the "idempotent re-run" test at ~782 asserts the string `"wrote: mattstack.appPath, rt.repoRoots"` but is really about `appPath` idempotency: update its expected string, do not delete it

- [ ] **Step 5: Pin the board.keys dependency**

`board.keys` now depends on the user having answered `repos.root` before Install rather than on `settings.seed` writing the root at step 8. Nothing in either file records that.

`trackingRepoNames` is NOT a basename derivation: `lib/setup/steps/skills.ts:93-98` intersects tracking basenames with `getKnownRepos().filter(r => r.registered !== false)`. With no repo in the index, `repoNames[0]` is undefined and `board.cwds` is never written. `steps-b.test.ts:872` has a `seedTrackedRepo()` helper that mkdtemps a directory and calls `updateRepoIndex`; use it, or this test fails for a reason that has nothing to do with repo roots.

Add to the `board.keys` describe block in `steps-b.test.ts`:

```ts
// board.cwds is derived from rt.repoRoots, which settings.seed used to write at
// step 8. It is now the user's answer to the required repos.root row, set
// before Install starts. A regression here is silent: boardKeysRun logs and
// leaves the setting unset rather than failing.
test("board.keys still seeds board.cwds from a root the user chose before Install", async () => {
  const { repoName, repoDir } = seedTrackedRepo();
  setSetting("rt.repoRoots", [dirname(repoDir)], "machine");
  const { ctx } = makeCtx(fakeProbes({ home }), { snapshot: { ...EMPTY_SNAPSHOT, trackingIdentities: [`gitlab.com/acme/${repoName}`] } });
  await boardKeysStep.run(ctx);
  expect(getSetting<Record<string, string>>("board.cwds").value?.review).toBe(join(dirname(repoDir), repoName));
});
```

Run: `bun test lib/setup/__tests__/steps-b.test.ts -t "board.keys"`
Expected: PASS. This is a characterization test: it passes before and after this task. That is intended and stated, because what changes is the reason the ordering holds, not the result.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/steps/settings.ts lib/setup/__tests__/
git commit -m "setup: settings.seed stops choosing a repo root"
```

---

### Task 3: The `choose-folder` action type, both languages

**Files:**
- Modify: `lib/setup/contract.ts` (the `Action` union, lines 16-26)
- Modify: `rt-tray/Sources-core/Contract/PlanModels.swift` (`ActionType` 50-62, `RowAction` 94-115)
- Modify: `rt-tray/Sources-core/Readiness/RowActionDispatcher.swift`
- Test: `rt-tray/Tests/MattstackCoreChecks/RowActionChecks.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - TS: `{ type: "choose-folder"; label: string; startAt: string | null }`
  - Swift: `ActionType.chooseFolder` (raw `"choose-folder"`), `RowAction.startAt: String?`, `DispatchedAction.chooseFolder(startAt: String?)`
  - The verb the second dispatch targets, spelled exactly: `["setup", "repo-root", "set", "--json"]`, stdin `{"root": "<path>"}`

- [ ] **Step 1: Add the TS variant**

```ts
  | { type: "choose-folder"; label: string; startAt: string | null };
```

`startAt` is where the panel opens, never a value rt writes. One line saying so earns its place; the distinction is the point of the feature and is invisible from the type.

- [ ] **Step 2: Write the failing checks**

**This target does not use XCTest.** `RowActionChecks.swift` is a top-level `let rowActionChecks: [Check]` array; each entry is `Check("name") { c in ... }` asserting through `c.expectEqual(...)`. The closure body is `async throws`. Read the file before writing. XCTest syntax compiles into nothing that runs.

Append two entries to the existing array:

```swift
    Check("choose-folder: collect a directory first, then rt setup repo-root set with the path on stdin") { c in
        let a = RowAction(type: .chooseFolder, label: "Choose folder…", startAt: "/Users/t/code")
        c.expectEqual(RowActionDispatcher.dispatch(a, fieldValues: nil, alternative: nil), .chooseFolder(startAt: "/Users/t/code"))

        let d = RowActionDispatcher.dispatch(a, fieldValues: ["root": "/Users/t/dev"], alternative: nil)
        guard case .rtVerb(let args, let stdin) = d else { return c.fail("expected rtVerb, got \(d)") }
        c.expectEqual(args, ["setup", "repo-root", "set", "--json"])
        let decoded = try JSONDecoder().decode([String: String].self, from: stdin ?? Data())
        c.expectEqual(decoded, ["root": "/Users/t/dev"])
    },
    Check("choose-folder with no startAt still collects") { c in
        let a = RowAction(type: .chooseFolder, label: "Choose folder…", startAt: nil)
        c.expectEqual(RowActionDispatcher.dispatch(a, fieldValues: nil, alternative: nil), .chooseFolder(startAt: nil))
    },
```

Decode the stdin rather than byte-comparing it. `JSONEncoder` escapes forward slashes, and no existing check in this file asserts a payload containing one, so there is no in-repo precedent to copy and a byte comparison would be guessing at Foundation's escaping. Decoding asserts the thing that matters.

Use `try`, not `try!`: the closure is `throws` and the harness reports a thrown error as a failure, where `try!` traps the whole run. Check `Check`'s API for the exact failure helper (`c.fail` above is a guess); use whatever the file already uses.

- [ ] **Step 3: Run and watch it fail to compile**

Run: `cd rt-tray && swift run mattstack-checks choose-folder`

`mattstack-checks` is an executable target (`Tests/mattstack-checks/main.swift`) that runs `allChecks` with an optional substring filter and prints `checks: N passed, M failed`. `swift test` is not the entry point.

Expected: a COMPILE failure, because `.chooseFolder` exists on neither enum yet. That is the correct RED.

Note the filter is a substring match, so `choose-folder` matches only the first of the two checks above. Run the suite unfiltered at Step 5.

`rowActionChecks` is already composed into `allChecks` in `AllChecks.swift`, so appending needs no registration. A NEW `[Check]` array would have to be added to that concatenation or it silently never runs.

- [ ] **Step 4: Add the Swift types**

`PlanModels.swift`, in `ActionType`: `case chooseFolder = "choose-folder"`.

`PlanModels.swift`, in `RowAction`: add `public var startAt: String?` beside the other optionals, add `startAt: String? = nil` to the memberwise `init` in the matching position, and assign it in the body. The initializer is hand-written, so a missed assignment compiles and silently nils.

`RowActionDispatcher.swift`: add `case chooseFolder(startAt: String?)` to `DispatchedAction`, and to the switch beside `.connect`:

```swift
        case .chooseFolder:
            if let path = fieldValues?["root"] {
                return .rtVerb(args: ["setup", "repo-root", "set", "--json"], stdin: json(["root": path]))
            }
            return .chooseFolder(startAt: action.startAt)
```

- [ ] **Step 5: Run the whole suite**

Run: `cd rt-tray && swift run mattstack-checks`
Expected: `checks: N passed, 0 failed`. Unfiltered, so both new checks run.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/contract.ts rt-tray/Sources-core/ rt-tray/Tests/
git commit -m "setup: add the choose-folder action type"
```

---

### Task 4: The `rt setup repo-root set` verb

**Files:**
- Modify: `commands/setup.ts`
- Modify: `lib/command-tree-def.ts`
- Test: `lib/setup/__tests__/` or `commands/__tests__/`, wherever the existing `setup ... connect` handler tests live (`grep -rln "connectCredential\|setup-connect" lib/ commands/`)

**Interfaces:**
- Consumes: `checkRepoRoot`, `realRootStat` from `lib/setup/repo-root.ts` (Task 1).
- Produces: the verb `rt setup repo-root set`, exiting 2 with a JSON error envelope on a bad path.

- [ ] **Step 1: Write the failing tests**

Cover, following the existing connect-handler test conventions:

- a valid directory writes `rt.repoRoots` at machine scope as a one-element array of the EXPANDED path
- a nonexistent path writes nothing and raises the user-actionable error
- a file and an unwritable directory likewise
- `~/dev` is stored expanded, not as `~/dev`
- a TTY with no argument does NOT read stdin (the guard below)
- a piped `{"root": "..."}` with no argument is accepted

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL, verb not registered.

- [ ] **Step 3: Write the handler**

Read `connectCredential` in `commands/setup.ts` first: it is the precedent for a setup subcommand that takes input, and for the `--json` envelope.

Two things to copy from it exactly:

1. **Check `deps.isTTY()` BEFORE any stdin read.** Its comment says why: "reading stdin first would block on EOF at a real terminal instead of prompting". A path argument, then a TTY prompt, then stdin. Reading stdin unconditionally hangs `rt setup repo-root set` at a terminal.
2. **Throw `UserActionableError`** on a validation failure rather than printing and exiting yourself. `exitWithUserError` (`commands/setup.ts:443`) prints the envelope and exits **2**, and `RtResult.userError` in the tray decodes the envelope only at exit 2. At any other code the app falls through to generic copy, and because `ChecklistScreen` sets `redactStderr = stdin != nil`, the user would see "details withheld because the command carried a secret" instead of "that folder is not writable".

On success: `setSetting("rt.repoRoots", [check.path], "machine")`, and include `tccWarning` in the `--json` payload. The row computes its own warning in Task 5, so nothing depends on this payload reaching the app; it is there for CLI users and scripts.

- [ ] **Step 4: Register the command**

In `lib/command-tree-def.ts`, add `repo-root` as a **branch** node under `setup`, with `set` as a leaf beneath it. Not a leaf with a `set` positional: that would be a required-positional leaf needing `omitBehavior`, and `picker:check` would fail. The `set` leaf's path argument is optional (TTY prompts, pipe reads stdin), so it needs no `omitBehavior` either.

- [ ] **Step 5: Verify**

Run: `bun test <the handler test file>` and `bun run picker:check`
Expected: PASS, and `0 violation(s)`.

Smoke check under an isolated HOME. **Never against your own**, which has a real `rt.repoRoots` this would overwrite:

```bash
H=$(mktemp -d); mkdir -p "$H/dev"
env -i HOME="$H" PATH="$PATH" bun run cli.ts setup repo-root set "$H/dev" --json
env -i HOME="$H" PATH="$PATH" bun run cli.ts settings get rt.repoRoots --json
env -i HOME="$H" PATH="$PATH" bun run cli.ts setup repo-root set "$H/nope" --json; echo "exit=$?"
```

Expected: success envelope, then the path, then a JSON error envelope with `exit=2`.

- [ ] **Step 6: Commit**

```bash
git add commands/setup.ts lib/command-tree-def.ts lib/setup/__tests__/ commands/__tests__/
git commit -m "setup: add rt setup repo-root set"
```

---

### Task 5: The `repos.root` row

**Files:**
- Create: `lib/setup/validators/repo-root.ts`
- Modify: `lib/setup/plan.ts` (the `tools` group builder in `composePlan`)
- Test: `lib/setup/__tests__/validators-repo-root.test.ts`

**Interfaces:**
- Consumes: `checkRepoRoot`, `realRootStat`, `detectCandidate` from `lib/setup/repo-root.ts`; the `choose-folder` action from `contract.ts`; `row()`; `TeamSnapshot`; `TeamRef`.
- Produces: `export function repoRootRow(p: Pick<Probes, "home" | "exists">, team: TeamRef, snapshot: TeamSnapshot, stat?: (path: string) => RootStat): Row | null`

- [ ] **Step 1: Write the failing tests**

Cover every branch:

- absent when `team.mode === "none"` AND `trackingIdentities` is empty
- **present when `team.mode === "join"` and `trackingIdentities` is EMPTY** (the joiner's first pass; this is the case an earlier design missed and it is the most important test in this task)
- present when mode is `"none"` but `trackingIdentities` is non-empty (post-install)
- unset root: `needs-you`, `required: true`, action `choose-folder`, and the detail names `rt setup repo-root set` so a CLI user has something to run
- unset with a detected candidate: `startAt` carries it, status still `needs-you`
- set and usable: `ready`, detail names the path
- set under `~/Documents`: `ready`, detail also carries the TCC warning
- set but missing: `needs-you`, detail names the path
- set but a file, and set but unwritable: `needs-you`, not `ready`
- stored as `~/dev` with the directory present: `ready` (expansion, via `checkRepoRoot`)
- **`getSetting` throws: `needs-you` with the picker, never an exception** (inject a throwing reader or stub `getSetting`)

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL, module not found.

- [ ] **Step 3: Write the validator**

```ts
/**
 * Where rt clones the team's repos. Two render conditions, not one: the
 * intent covers a joiner whose team clone (and so whose tracked-repo list)
 * does not exist until team.join runs inside Install, and the snapshot covers
 * a machine whose setup is already done and has no intent left.
 */
import { getSetting } from "../../settings/resolve.ts";
import { row, type Action, type Row, type TeamRef } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { checkRepoRoot, detectCandidate, realRootStat, type RootStat } from "../repo-root.ts";
import type { TeamSnapshot } from "../team-settings.ts";

const CLI_HINT = "or run rt setup repo-root set <folder>";

function chooseAction(startAt: string | null): Action {
  return { type: "choose-folder", label: "Choose folder…", startAt };
}

/** An authored `${repoRoot}` makes this key's resolution throw. Unguarded, that reaches buildGroup's catch, which replaces every tools row with one required error row whose only action re-runs this same read. */
function configuredRoot(): string | null {
  try {
    return getSetting<string[]>("rt.repoRoots").value?.[0] ?? null;
  } catch {
    return null;
  }
}

export function repoRootRow(
  p: Pick<Probes, "home" | "exists">,
  team: TeamRef,
  snapshot: TeamSnapshot,
  stat: (path: string) => RootStat = realRootStat,
): Row | null {
  if (team.mode === "none" && snapshot.trackingIdentities.length === 0) return null;

  const base = {
    id: "repos.root",
    kind: "tool" as const,
    title: "Repo folder",
    why: "Where rt clones your team's repos. rt does not pick this for you.",
    required: true,
    recheck: "on-activate" as const,
  };

  const configured = configuredRoot();
  if (!configured) {
    return row({ ...base, status: "needs-you", detail: `choose where rt should clone your team's repos (${CLI_HINT})`, action: chooseAction(detectCandidate(p)) });
  }

  const check = checkRepoRoot(p, configured, stat);
  if (!check.ok) {
    return row({ ...base, status: "needs-you", detail: `${check.detail} (${CLI_HINT})`, action: chooseAction(detectCandidate(p)) });
  }
  return row({ ...base, status: "ready", detail: check.tccWarning ? `${check.path} ... ${check.tccWarning}` : check.path });
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `bun test lib/setup/__tests__/validators-repo-root.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the row to the plan**

In `composePlan`'s `tools` group builder, after `tools` and before `healthRows`:

```ts
      const repoRoot = repoRootRow(i.p, team, snapshot);
      return [...tools, ...(repoRoot ? [repoRoot] : []), ...healthRows];
```

`team` and `snapshot` are both already in scope. Do NOT add `repos.root` to `INSTALL_SATISFIED_IDS`.

- [ ] **Step 6: Verify the plan composes**

Run: `bun test lib/setup/__tests__/`
Expected: PASS. A `contract.test.ts` row-list assertion may need the new id; that is a real contract update.

- [ ] **Step 7: Commit**

```bash
git add lib/setup/validators/repo-root.ts lib/setup/__tests__/validators-repo-root.test.ts lib/setup/plan.ts
git commit -m "setup: add the repos.root row"
```

---

### Task 6: The panel in the tray

**Files:**
- Modify: `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift`

**Interfaces:**
- Consumes: `DispatchedAction.chooseFolder(startAt:)` (Task 3).

- [ ] **Step 1: Add the case**

The re-entry function is `private func run(_ dispatched: DispatchedAction, for row: PlanRow)` at line 71. It is **not** `async`, so do not write `await`. `action` is not a parameter: inside `run`, the sheet path at line 51 shows the shape, and the action comes from `row.action`.

In `run`'s switch, beside `.openURL` and `.showSteps`:

```swift
        case .chooseFolder(let startAt):
            guard let action = row.action else { return }
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.canCreateDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = "Use this folder"
            if let s = startAt { panel.directoryURL = URL(fileURLWithPath: s) }
            guard panel.runModal() == .OK, let url = panel.url else { return }
            run(RowActionDispatcher.dispatch(action, fieldValues: ["root": url.path], alternative: nil), for: row)
```

`canCreateDirectories` is what lets the user make a folder in place, which is how rt avoids ever calling `mkdir` itself. A cancelled panel returns without touching anything: cancelling is a legitimate answer, not a failure.

`ChecklistScreen.swift` already uses `NSWorkspace` at line 104, so AppKit is available; do not add an import unless the build says otherwise.

- [ ] **Step 2: Build**

Run: `cd rt-tray && swift build`
Expected: builds clean.

- [ ] **Step 3: Commit**

```bash
git add rt-tray/Sources/Setup/Screens/ChecklistScreen.swift
git commit -m "rt-tray: answer choose-folder with an open panel"
```

---

### Task 7: The VM harness answers the row

A required row whose GUI affordance is a native panel will stall an unattended run at the checklist's Continue button, which is gated on `canInstall` (`SetupView.swift:109`).

**Files:**
- Modify: `rt-tray/vm/run/guest/drive-setup.sh`
- Modify: `rt-tray/vm/run/guest/assert-installed.sh`
- Modify: `rt-tray/vm/check-vm-scripts.sh`

- [ ] **Step 1: Answer the row, then re-check, then Continue**

`drive-setup.sh` has NO existing rt invocation and no `RT` variable; only `assert-team.sh:10` defines one. `assert-installed.sh` calls bare `rt` off PATH. Follow the latter, or define the variable locally and say why.

Setting the value out of band leaves the app's composed plan stale, so the row stays `needs-you` on screen and Continue stays disabled. The step must set the value, click `setup.checklist.recheck`, and wait for the row to read ready before clicking Continue. Put this in `screen_readiness` before the Continue click:

```bash
# repos.root is required and its only GUI affordance is a native folder panel,
# which an unattended run cannot answer. The harness is playing the user here,
# not working around a defect. The recheck is not optional: the app's plan is
# composed before this write, so Continue stays disabled without it.
mkdir -p "$HOME/code"
rt setup repo-root set "$HOME/code" --json
ax_click setup.checklist.recheck
ax_wait_status repos.root ready 30
```

Use the real helper names from `ax.sh`; `ax_wait_status` is a guess, so find the existing wait-for-a-row helper and use that.

- [ ] **Step 2: Assert it, conditionally**

`assert-installed.sh` also runs in the `headless` scenario where `drive-setup.sh` never executes, and in a scenario with no team the row is absent entirely. An unconditional "reads ready" assertion fails both. Assert: if the row is present it reads `ready`; if absent, say so and pass.

- [ ] **Step 3: Offline gate lines**

Matching the `grep -q` style already in the file:

```bash
t "drive-setup.sh answers repos.root before Continue" bash -c 'grep -q "setup repo-root set" run/guest/drive-setup.sh'
t "drive-setup.sh rechecks after setting the root"    bash -c 'grep -q "setup.checklist.recheck" run/guest/drive-setup.sh'
t "assert-installed.sh handles repos.root absent"     bash -c 'grep -q "repos.root" run/guest/assert-installed.sh'
```

- [ ] **Step 4: Run the offline gate**

Run: `cd rt-tray/vm && bash check-vm-scripts.sh`
Expected: 0 failures. Run it alone: concurrent invocations race on the shared `/tmp/vmcheck-*` fixture directories.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/vm/
git commit -m "vm: answer repos.root before driving Install"
```

---

### Task 8: Full verification

- [ ] **Step 1: Both suites**

Run: `bun run test` then `bun run test:e2e`
Expected: 0 fail each. An e2e test asserting checklist rows or `requiredMissing` verbatim may need `repos.root`; that is a real contract change, so update the assertion rather than loosening it.

- [ ] **Step 2: Conformance and the Swift side**

Run: `bun run picker:check` (expect `0 violation(s)`), then `cd rt-tray && swift build && swift run mattstack-checks` (expect `0 failed`).

- [ ] **Step 3: No dashes**

Run: `git diff main...HEAD | grep -nP '[\x{2013}\x{2014}]'`
Expected: no output.

- [ ] **Step 4: Mutation-verify the two changes that matter**

Revert Task 2's production change only, leaving its tests: the two `settings.seed` tests must go red. Restore.

Revert Task 5's `team.mode === "none" &&` guard so the row keys on tracking alone: the joiner test from Task 5 Step 1 must go red. Restore. That test is the whole reason this design was rewritten; a version of it that passes either way is worthless.

- [ ] **Step 5: Leave it unpushed**

Report the commit range on `repo-root-choice`.
