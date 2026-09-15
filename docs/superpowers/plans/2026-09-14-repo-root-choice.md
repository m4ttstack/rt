# Repo Root Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rt asks the user where their repos go instead of silently creating `~/Documents/GitHub` or adopting whatever candidate directory it happens to find.

**Architecture:** A new required checklist row (`repos.root`) renders whenever the team declares tracked repos. Its action is a new `choose-folder` contract type that the Swift tray answers with `NSOpenPanel`, re-dispatching the chosen path through the existing `fieldValues` channel into a new validating rt verb. `settings.seed` stops writing `rt.repoRoots` and stops creating directories entirely; detection survives only as the panel's starting directory.

**Tech Stack:** Bun + TypeScript (rt CLI), Swift + SwiftUI (rt-tray), `bun test`.

**Spec:** `docs/superpowers/specs/2026-09-14-repo-root-choice-design.md`

## Global Constraints

- No em dashes or en dashes anywhere, in code, comments, tests, commit messages, or docs. Use an ellipsis ("...") or rephrase. See `~/.claude/rules/no-em-dashes.md`.
- Clean-code comments only: a comment earns its place by stating a constraint the code cannot show. Never narrate the next line, never cite a ticket id or review finding in source.
- `bun run test` does NOT run e2e. Run `bun run test:all`, or at minimum the e2e file covering a surface you changed, before calling anything verified.
- TDD throughout: write the failing test, run it and watch it fail for the right reason, then implement.
- `repos.root` must NOT be added to `INSTALL_SATISFIED_IDS` in `lib/setup/plan.ts`. That set is for rows only Install can satisfy; this row is satisfied by the user before Install.
- The new verb writes `rt.repoRoots` at the **machine** scope, matching its registry entry's `scopes: ["machine"]` in `packages/rt-client/src/settings/registry-defs.ts`.
- rt must never create a repo-root directory on the user's behalf. `NSOpenPanel`'s own "New Folder" button is how a user makes one.
- Work on branch `repo-root-choice`, which already carries the spec commit. Never push to `main`. Never leave the shared main checkout on a branch.

---

### Task 1: `settings.seed` stops deciding

Removes the behavior the whole feature exists to replace, first, so every later task builds on a machine where rt no longer guesses. `detectRepoRoots` survives because Task 3 needs it for the panel's starting directory.

**Files:**
- Modify: `lib/setup/steps/settings.ts` (delete `detectOrCreateDefaultRoot`, lines ~34-51, and its call site in `settingsSeedRun`)
- Test: `lib/setup/__tests__/steps-*.test.ts` (the file whose describe block already covers `settings.seed`; find it with `grep -rln "settings.seed" lib/setup/__tests__/`)

**Interfaces:**
- Consumes: nothing.
- Produces: `detectRepoRoots(ctx: ApplyContext): string[]` stays exported-or-not exactly as it is today; Task 3 reads the same candidate list through a new pure helper rather than importing this one.

- [ ] **Step 1: Write the two failing tests**

Add to the `settings.seed` describe block. Use the fake `ApplyContext` the neighbouring tests already build; copy their construction rather than inventing one.

```ts
test("settings.seed never writes rt.repoRoots, even when a candidate directory exists", async () => {
  const ctx = makeCtx({ home: tmpHome, exists: (p: string) => p === join(tmpHome, "Documents/GitHub") });
  ctx.snapshot = { ...ctx.snapshot, trackingIdentities: ["gitlab.com/acme/one"] };
  const outcome = await settingsSeedStep.run(ctx);
  expect(outcome.state).toBe("done");
  expect(getSetting<string[]>("rt.repoRoots").value).toBeUndefined();
});

test("settings.seed creates no directory when nothing is detected", async () => {
  const made: string[] = [];
  const ctx = makeCtx({ home: tmpHome, exists: () => false, mkdirp: (p: string) => { made.push(p); } });
  ctx.snapshot = { ...ctx.snapshot, trackingIdentities: ["gitlab.com/acme/one"] };
  await settingsSeedStep.run(ctx);
  expect(made).toEqual([]);
});
```

- [ ] **Step 2: Run them and watch both fail**

Run: `bun test lib/setup/__tests__/steps-*.test.ts -t "settings.seed"`
Expected: both FAIL. The first because `rt.repoRoots` is written; the second because `mkdirp` was called with the `Documents/GitHub` path. If either passes, you have the wrong fake wiring: fix the fake before touching production code.

- [ ] **Step 3: Delete the decision**

In `lib/setup/steps/settings.ts`, delete `detectOrCreateDefaultRoot` entirely and remove the `if (unwritten("rt.repoRoots")) { ... }` block from `settingsSeedRun`. Keep `detectRepoRoots`, `CANDIDATE_ROOT_NAMES` and `DEFAULT_ROOT_NAME` in the file; Task 3 moves the candidate logic out.

Update the file's header docblock: it currently says the step seeds "`rt.repoRoots` (detected candidate directories, only when nothing is set yet)". That clause is now false. Replace it with a line saying the repo root is the user's choice, made through the `repos.root` row, and that this step no longer touches the key.

- [ ] **Step 4: Run them and watch both pass**

Run: `bun test lib/setup/__tests__/steps-*.test.ts -t "settings.seed"`
Expected: PASS. Then run the whole file: other `settings.seed` tests may assert the old behavior and must be deleted, not weakened. A test that asserted rt creates the directory is asserting the defect.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/steps/settings.ts lib/setup/__tests__/
git commit -m "setup: settings.seed stops choosing a repo root"
```

---

### Task 2: The `choose-folder` action type, both languages

Pure type plumbing with no behavior, kept separate so a reviewer can check the contract change against the Swift decoder without a row or a verb in the diff.

**Files:**
- Modify: `lib/setup/contract.ts:16-26` (the `Action` union)
- Modify: `rt-tray/Sources-core/Contract/PlanModels.swift:50-62` (`ActionType`) and `:94-115` (`RowAction`)
- Modify: `rt-tray/Sources-core/Readiness/RowActionDispatcher.swift` (`DispatchedAction`, and the `switch`)
- Test: `lib/setup/__tests__/contract.test.ts`, plus the Swift dispatcher's own test target (find it with `grep -rl "RowActionDispatcher" rt-tray/Tests/`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - TS: `{ type: "choose-folder"; label: string; startAt: string | null }` as an `Action` variant.
  - Swift: `ActionType.chooseFolder` (raw value `"choose-folder"`), `RowAction.startAt: String?`, `DispatchedAction.chooseFolder(startAt: String?)`.
  - The verb the second dispatch targets: `["setup", "repo-root", "set", "--json"]` with stdin `{"root": "<path>"}`.

- [ ] **Step 1: Add the TS variant**

In `lib/setup/contract.ts`, append to the `Action` union:

```ts
  | { type: "choose-folder"; label: string; startAt: string | null };
```

`startAt` is a suggested starting directory for the panel, never a value rt writes. Say that in a one-line comment on the variant, because the distinction is the whole point of the feature and is not visible from the type.

- [ ] **Step 2: Write the failing Swift dispatcher test**

In the dispatcher's test file, following the shape of the existing `connect` tests:

```swift
func testChooseFolderCollectsThenRuns() {
    let action = RowAction(type: .chooseFolder, label: "Choose...", startAt: "/Users/t/code")

    let first = RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil)
    XCTAssertEqual(first, .chooseFolder(startAt: "/Users/t/code"))

    let second = RowActionDispatcher.dispatch(action, fieldValues: ["root": "/Users/t/dev"], alternative: nil)
    guard case .rtVerb(let args, let stdin) = second else { return XCTFail("expected rtVerb") }
    XCTAssertEqual(args, ["setup", "repo-root", "set", "--json"])
    XCTAssertEqual(String(data: stdin!, encoding: .utf8), "{\"root\":\"\\/Users\\/t\\/dev\"}")
}

func testUnknownActionTypeStillDegradesToNone() {
    let json = #"{"type":"some-future-action","label":"x"}"#.data(using: .utf8)!
    let action = try! JSONDecoder().decode(RowAction.self, from: json)
    XCTAssertEqual(action.type, .unknown)
    XCTAssertEqual(RowActionDispatcher.dispatch(action, fieldValues: nil, alternative: nil), .none)
}
```

The second test pins forward compatibility: an older tray meeting a newer action must render a dead button, not fail the whole checklist decode. It should already pass; it is there so a later change cannot quietly remove that property.

- [ ] **Step 3: Run and watch the first fail**

Run: `cd rt-tray && swift test --filter RowActionDispatcher`
Expected: `testChooseFolderCollectsThenRuns` FAILS to compile, because `.chooseFolder` does not exist. A compile failure is the correct RED here.

- [ ] **Step 4: Add the Swift types**

`PlanModels.swift`, in `ActionType`:

```swift
    case chooseFolder = "choose-folder"
```

`PlanModels.swift`, in `RowAction`: add `public var startAt: String?` beside the other optionals, and add `startAt: String? = nil` to the memberwise `init` in the same position, assigning it in the body. Match the existing formatting exactly; the initializer is hand-written, so a missed assignment compiles and silently nils.

`RowActionDispatcher.swift`, add to `DispatchedAction`:

```swift
    case chooseFolder(startAt: String?)
```

and to the `switch`, beside `case .connect`:

```swift
        case .chooseFolder:
            if let path = fieldValues?["root"] {
                return .rtVerb(args: ["setup", "repo-root", "set", "--json"], stdin: json(["root": path]))
            }
            return .chooseFolder(startAt: action.startAt)
```

- [ ] **Step 5: Run both and watch them pass**

Run: `cd rt-tray && swift test --filter RowActionDispatcher`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/setup/contract.ts rt-tray/Sources-core/ rt-tray/Tests/
git commit -m "setup: add the choose-folder action type"
```

---

### Task 3: The `rt setup repo-root set` verb

**Files:**
- Create: `lib/setup/repo-root.ts` (pure validation + the candidate list)
- Modify: `commands/setup.ts` (the `repo-root set` handler)
- Modify: `lib/command-tree-def.ts` (register the leaf)
- Test: `lib/setup/__tests__/repo-root.test.ts` (new)

**Interfaces:**
- Consumes: `Probes` (`exists`, `home`), `setSetting` from `lib/settings/write.ts`.
- Produces:

```ts
export const CANDIDATE_ROOT_NAMES: string[];
export function expandHome(p: Pick<Probes, "home">, path: string): string;
export type RootCheck =
  | { ok: true; path: string; tccWarning: string | null }
  | { ok: false; detail: string };
export function checkRepoRoot(p: Pick<Probes, "home" | "exists">, raw: string, stat: (path: string) => { isDirectory: boolean; writable: boolean } | null): RootCheck;
export function detectCandidate(p: Pick<Probes, "home" | "exists">): string | null;
```

`detectCandidate` returns the first `CANDIDATE_ROOT_NAMES` entry that exists under home, or null. Task 4's row uses it for `startAt`.

- [ ] **Step 1: Write the failing tests**

Create `lib/setup/__tests__/repo-root.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { checkRepoRoot, detectCandidate, expandHome } from "../repo-root.ts";

const HOME = "/Users/t";
const p = (existing: string[]) => ({ home: HOME, exists: (x: string) => existing.includes(x) });
const dir = () => ({ isDirectory: true, writable: true });
const file = () => ({ isDirectory: false, writable: true });
const readonlyDir = () => ({ isDirectory: true, writable: false });

describe("checkRepoRoot", () => {
  test("a writable directory is accepted and carries no warning", () => {
    expect(checkRepoRoot(p([]), "/Users/t/dev", dir)).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test("expands ~ before validating", () => {
    expect(checkRepoRoot(p([]), "~/dev", dir)).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test("a path that does not exist is refused and says so", () => {
    const r = checkRepoRoot(p([]), "/Users/t/nope", () => null);
    expect(r.ok).toBe(false);
    expect((r as { detail: string }).detail).toContain("does not exist");
  });

  test("a file is refused as not a directory", () => {
    const r = checkRepoRoot(p([]), "/Users/t/notes.txt", file);
    expect(r.ok).toBe(false);
    expect((r as { detail: string }).detail).toContain("not a directory");
  });

  test("an unwritable directory is refused", () => {
    const r = checkRepoRoot(p([]), "/Users/t/locked", readonlyDir);
    expect(r.ok).toBe(false);
    expect((r as { detail: string }).detail).toContain("not writable");
  });

  // The warning is advisory on purpose: it is the user's machine, and
  // ~/Documents/GitHub is a common convention. Refusing would put rt's
  // judgement back in place of theirs, which is the defect this removes.
  test("a TCC-protected location is ACCEPTED, with a warning", () => {
    const r = checkRepoRoot(p([]), "/Users/t/Documents/GitHub", dir);
    expect(r.ok).toBe(true);
    expect((r as { tccWarning: string | null }).tccWarning).toContain("Documents");
  });

  test.each(["/Users/t/Desktop/code", "/Users/t/Downloads/code"])("warns for %s too", (path) => {
    expect((checkRepoRoot(p([]), path, dir) as { tccWarning: string | null }).tccWarning).not.toBeNull();
  });
});

describe("detectCandidate", () => {
  test("returns the first candidate that exists", () => {
    expect(detectCandidate(p(["/Users/t/code"]))).toBe("/Users/t/code");
  });

  test("prefers Documents/GitHub when several exist, matching the list order", () => {
    expect(detectCandidate(p(["/Users/t/code", "/Users/t/Documents/GitHub"]))).toBe("/Users/t/Documents/GitHub");
  });

  test("returns null when none exist, so nothing is suggested", () => {
    expect(detectCandidate(p([]))).toBeNull();
  });
});

describe("expandHome", () => {
  test.each([["~/dev", "/Users/t/dev"], ["${home}/dev", "/Users/t/dev"], ["/abs", "/abs"]])("%s -> %s", (raw, want) => {
    expect(expandHome({ home: HOME }, raw)).toBe(want);
  });
});
```

- [ ] **Step 2: Run and watch every test fail**

Run: `bun test lib/setup/__tests__/repo-root.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `lib/setup/repo-root.ts`**

```ts
/**
 * Where the user's repos go. rt validates a path the user picked; it never
 * picks one. `stat` is injected so the checks are testable without a real
 * filesystem, and so the caller owns the one syscall this module needs.
 */
import { join } from "path";
import type { Probes } from "./probes.ts";

export const CANDIDATE_ROOT_NAMES = ["Documents/GitHub", "GitHub", "code", "src"];

/** Directories macOS gates behind TCC. rt holds Full Disk Access, so rt never sees the prompt these cause for the user's other tools. */
const TCC_PROTECTED = ["Documents", "Desktop", "Downloads"];

export function expandHome(p: Pick<Probes, "home">, path: string): string {
  if (path.startsWith("~/")) return join(p.home, path.slice(2));
  if (path.startsWith("${home}/")) return join(p.home, path.slice(8));
  return path;
}

export type RootCheck =
  | { ok: true; path: string; tccWarning: string | null }
  | { ok: false; detail: string };

export function checkRepoRoot(
  p: Pick<Probes, "home" | "exists">,
  raw: string,
  stat: (path: string) => { isDirectory: boolean; writable: boolean } | null,
): RootCheck {
  const path = expandHome(p, raw.trim());
  if (path === "") return { ok: false, detail: "no path given" };
  const s = stat(path);
  if (s === null) return { ok: false, detail: `${path} does not exist` };
  if (!s.isDirectory) return { ok: false, detail: `${path} is not a directory` };
  if (!s.writable) return { ok: false, detail: `${path} is not writable` };

  const rel = path.startsWith(`${p.home}/`) ? path.slice(p.home.length + 1) : "";
  const gated = TCC_PROTECTED.find((d) => rel === d || rel.startsWith(`${d}/`));
  const tccWarning = gated
    ? `${gated} is protected by macOS privacy controls, so your editor, terminal git and other tools may need permission to reach repos stored here`
    : null;
  return { ok: true, path, tccWarning };
}

export function detectCandidate(p: Pick<Probes, "home" | "exists">): string | null {
  return CANDIDATE_ROOT_NAMES.map((rel) => join(p.home, rel)).find((path) => p.exists(path)) ?? null;
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `bun test lib/setup/__tests__/repo-root.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Wire the verb**

In `commands/setup.ts`, add a `repo-root set` handler. Read the existing `connectCredential` for how a setup subcommand reads JSON from stdin and prints a `--json` envelope; match that envelope exactly rather than inventing a shape. The handler:

1. reads `{"root": "<path>"}` from stdin
2. calls `checkRepoRoot` with a real `stat` built from `statSync` plus an `access(path, W_OK)` check
3. on `ok: false`, prints the error envelope and exits non-zero
4. on `ok: true`, calls `setSetting("rt.repoRoots", [path], "machine")` and prints success, carrying `tccWarning` in the payload when non-null

Register the leaf in `lib/command-tree-def.ts` under the existing `setup` node. It takes no required positional (the path arrives on stdin), so it needs no `omitBehavior`. Confirm with `bun run picker:check`, do not assume.

- [ ] **Step 6: Verify the wiring**

Run: `bun run picker:check`
Expected: `0 violation(s)`.

Run: `echo '{"root":"/tmp"}' | bun run cli.ts setup repo-root set --json`
Expected: a success envelope. Then `bun run cli.ts settings get rt.repoRoots --json` shows `/tmp`. Reset it afterwards with `bun run cli.ts settings set rt.repoRoots '[]' --scope machine` so you do not leave the dev machine pointing at `/tmp`.

- [ ] **Step 7: Commit**

```bash
git add lib/setup/repo-root.ts lib/setup/__tests__/repo-root.test.ts commands/setup.ts lib/command-tree-def.ts
git commit -m "setup: add rt setup repo-root set"
```

---

### Task 4: The `repos.root` row

**Files:**
- Create: `lib/setup/validators/repo-root.ts`
- Modify: `lib/setup/plan.ts` (the `tools` group builder in `composePlan`, ~line 160)
- Test: `lib/setup/__tests__/validators-repo-root.test.ts` (new)

**Interfaces:**
- Consumes: `detectCandidate` and `CANDIDATE_ROOT_NAMES` from `lib/setup/repo-root.ts` (Task 3); the `choose-folder` action from `lib/setup/contract.ts` (Task 2); `row()` from `lib/setup/contract.ts`; `TeamSnapshot.trackingIdentities: string[]`.
- Produces: `export function repoRootRow(p: Pick<Probes, "home" | "exists">, snapshot: TeamSnapshot): Row | null` returning null when the row must not render.

- [ ] **Step 1: Write the failing tests**

Create `lib/setup/__tests__/validators-repo-root.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { repoRootRow } from "../validators/repo-root.ts";
import { setSetting } from "../../settings/write.ts";

const HOME = "/Users/t";
const probes = (existing: string[]) => ({ home: HOME, exists: (x: string) => existing.includes(x) });
const withRepos = { trackingIdentities: ["gitlab.com/acme/one"] } as any;
const noRepos = { trackingIdentities: [] } as any;

describe("repoRootRow", () => {
  test("absent when the team declares no tracked repos", () => {
    expect(repoRootRow(probes([]), noRepos)).toBeNull();
  });

  test("unset: needs-you, with the choose-folder action", () => {
    setSetting("rt.repoRoots", [], "machine");
    const r = repoRootRow(probes([]), withRepos)!;
    expect(r.status).toBe("needs-you");
    expect(r.required).toBe(true);
    expect(r.action?.type).toBe("choose-folder");
  });

  test("unset with a detected candidate: startAt suggests it but the row is still needs-you", () => {
    setSetting("rt.repoRoots", [], "machine");
    const r = repoRootRow(probes(["/Users/t/code"]), withRepos)!;
    expect(r.status).toBe("needs-you");
    expect((r.action as { startAt: string | null }).startAt).toBe("/Users/t/code");
  });

  test("set and the directory exists: ready, no action", () => {
    setSetting("rt.repoRoots", ["/Users/t/dev"], "machine");
    const r = repoRootRow(probes(["/Users/t/dev"]), withRepos)!;
    expect(r.status).toBe("ready");
    expect(r.detail).toContain("/Users/t/dev");
    expect(r.action).toBeNull();
  });

  test("set but the directory is gone: needs-you, names the missing path, offers the picker", () => {
    setSetting("rt.repoRoots", ["/Users/t/gone"], "machine");
    const r = repoRootRow(probes([]), withRepos)!;
    expect(r.status).toBe("needs-you");
    expect(r.detail).toContain("/Users/t/gone");
    expect(r.action?.type).toBe("choose-folder");
  });
});
```

Note: `setSetting` writes into the test HOME that `bunfig`'s preload repoints. Do not remove that preload; see `reference_rt_test_home_isolation`.

- [ ] **Step 2: Run and watch them fail**

Run: `bun test lib/setup/__tests__/validators-repo-root.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the validator**

```ts
/**
 * Where rt clones the team's repos. The row exists only when a team declares
 * repos to clone: a team-less install has nothing to put anywhere, and asking
 * would be a question with no consequence.
 */
import { getSetting } from "../../settings/resolve.ts";
import { row, type Action, type Row } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { detectCandidate } from "../repo-root.ts";
import type { TeamSnapshot } from "../team-settings.ts";

function chooseAction(startAt: string | null): Action {
  return { type: "choose-folder", label: "Choose folder…", startAt };
}

export function repoRootRow(p: Pick<Probes, "home" | "exists">, snapshot: TeamSnapshot): Row | null {
  if (snapshot.trackingIdentities.length === 0) return null;

  const base = {
    id: "repos.root",
    kind: "tool" as const,
    title: "Repo folder",
    why: "Where rt clones your team's repos. rt does not pick this for you.",
    required: true,
    recheck: "on-activate" as const,
  };

  const configured = getSetting<string[]>("rt.repoRoots").value?.[0];
  if (!configured) {
    return row({ ...base, status: "needs-you", detail: "choose where rt should clone your team's repos", action: chooseAction(detectCandidate(p)) });
  }
  if (!p.exists(configured)) {
    return row({ ...base, status: "needs-you", detail: `${configured} no longer exists`, action: chooseAction(detectCandidate(p)) });
  }
  return row({ ...base, status: "ready", detail: configured });
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `bun test lib/setup/__tests__/validators-repo-root.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the row to the plan**

In `lib/setup/plan.ts`, inside the `tools` group builder in `composePlan`, add the row after `tools` and before `healthRows`:

```ts
      const repoRoot = repoRootRow(i.p, snapshot);
      return [...tools, ...(repoRoot ? [repoRoot] : []), ...healthRows];
```

`snapshot` is already in scope in `composePlan`. Do NOT add `repos.root` to `INSTALL_SATISFIED_IDS`.

- [ ] **Step 6: Verify it appears and blocks**

Run: `bun test lib/setup/__tests__/` (the whole directory)
Expected: PASS. A `contract.test.ts` assertion listing rows verbatim may need the new id added; that is a real update, not a weakening.

- [ ] **Step 7: Commit**

```bash
git add lib/setup/validators/repo-root.ts lib/setup/__tests__/validators-repo-root.test.ts lib/setup/plan.ts
git commit -m "setup: add the repos.root row"
```

---

### Task 5: The panel in the tray

**Files:**
- Modify: `rt-tray/Sources/Setup/Screens/ChecklistScreen.swift` (the `switch` on `DispatchedAction`, ~line 103-110)

**Interfaces:**
- Consumes: `DispatchedAction.chooseFolder(startAt:)` from Task 2.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add the case**

In the same `switch` that handles `.openURL` and `.showSteps`:

```swift
        case .chooseFolder(let startAt):
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.canCreateDirectories = true
            panel.allowsMultipleSelection = false
            panel.prompt = "Use this folder"
            if let s = startAt { panel.directoryURL = URL(fileURLWithPath: s) }
            guard panel.runModal() == .OK, let url = panel.url else { return }
            await run(row: row, action: action, fieldValues: ["root": url.path])
```

`canCreateDirectories` is what lets a user make a new folder from inside the panel, which is how rt avoids ever calling `mkdir` itself.

A cancelled panel returns without touching anything: no error banner, no state change. Cancelling is a legitimate answer to "where do your repos go", not a failure.

Match the surrounding code for how the second dispatch is performed. The existing `.collectFields` case sets sheet state and the sheet re-enters through the same path; find that re-entry function and call it rather than writing a new one. If the surrounding code names it something other than `run(row:action:fieldValues:)`, use the real name.

- [ ] **Step 2: Build**

Run: `cd rt-tray && swift build`
Expected: builds clean. `NSOpenPanel` needs `import AppKit`; add it if the file does not already have it.

- [ ] **Step 3: Commit**

```bash
git add rt-tray/Sources/Setup/Screens/ChecklistScreen.swift
git commit -m "rt-tray: answer choose-folder with an open panel"
```

---

### Task 6: The VM harness sets a root before Install

A required row whose only affordance is a GUI panel will hang an unattended run. The harness must answer the question before driving Install.

**Files:**
- Modify: `rt-tray/vm/run/guest/drive-setup.sh` (before the Install screen is driven)
- Modify: `rt-tray/vm/run/guest/assert-installed.sh` (assert the row reads ready)
- Modify: `rt-tray/vm/check-vm-scripts.sh` (offline proof both exist)

**Interfaces:**
- Consumes: `rt setup repo-root set --json` from Task 3.
- Produces: nothing.

- [ ] **Step 1: Set the root in the guest**

In `drive-setup.sh`, before the step that clicks Install, create a directory and point rt at it. Read the surrounding code for how it invokes `rt` in the guest (there is an `RT` variable convention) and match it:

```bash
# repos.root is required and its only GUI affordance is a native folder
# panel, which an unattended run cannot answer. Answering it here is the
# harness playing the user, not a workaround for a defect.
mkdir -p "$HOME/code"
printf '{"root":"%s/code"}\n' "$HOME" | "$RT" setup repo-root set --json
```

- [ ] **Step 2: Assert it in the post-install pass**

In `assert-installed.sh`, beside the other row assertions, assert `repos.root` reads `ready`. Reuse the captured `setup status --json`; do not re-invoke it.

- [ ] **Step 3: Add the offline gate lines**

In `check-vm-scripts.sh`, matching the style of the existing `grep -q` proofs:

```bash
t "drive-setup.sh answers repos.root before Install" bash -c 'grep -q "setup repo-root set" run/guest/drive-setup.sh'
t "assert-installed.sh asserts repos.root ready"     bash -c 'grep -q "repos.root" run/guest/assert-installed.sh'
```

- [ ] **Step 4: Run the offline gate**

Run: `cd rt-tray/vm && bash check-vm-scripts.sh`
Expected: 0 failures. Run it alone; concurrent invocations race on the shared `/tmp/vmcheck-*` fixture directories and produce spurious failures.

- [ ] **Step 5: Commit**

```bash
git add rt-tray/vm/
git commit -m "vm: answer repos.root before driving Install"
```

---

### Task 7: Full verification

**Files:** none.

- [ ] **Step 1: Both suites**

Run: `bun run test`
Expected: 0 fail.

Run: `bun run test:e2e`
Expected: 0 fail. An e2e test asserting the checklist's rows or `requiredMissing` verbatim may need `repos.root` added. That is a real contract change, so update the assertion rather than loosening it.

- [ ] **Step 2: Conformance**

Run: `bun run picker:check`
Expected: `0 violation(s)`.

Run: `cd rt-tray && swift build && swift test`
Expected: clean.

- [ ] **Step 3: No dashes**

Run: `git diff main...HEAD | grep -nP '[\x{2013}\x{2014}]'`
Expected: no output.

- [ ] **Step 4: Prove the removed behavior stays removed**

Revert Task 1's production change only (leave its tests), run `bun test lib/setup/__tests__/steps-*.test.ts -t "settings.seed"`, and confirm the two tests go red. Restore. A test that passes with the defect back is not a test.

- [ ] **Step 5: Commit anything outstanding, do not push**

The branch is `repo-root-choice`. Report the commit range and leave it unpushed.
