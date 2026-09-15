# Repo Root Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rt asks the user where their repos go instead of silently creating `~/Documents/GitHub` or adopting whatever candidate directory it happens to find.

**Architecture:** A new required checklist row (`repos.root`) renders when the user is joining a team, or when a team on this machine declares tracked repos. Its action is a new `choose-folder` contract type the Swift tray answers with `NSOpenPanel`, re-dispatching the chosen path through the existing `fieldValues` channel into a new validating rt verb. The verb writes `rt.repoRoots` directly once `~/.mattstack/user/.git` exists and stages the path outside the home repo before that, because the machine store lives inside the home repo and creating it early kills the clone at Install step 1. `settings.seed` and `repos.clone` drain the staged value.

**Tech Stack:** Bun + TypeScript (rt CLI), Swift + SwiftUI (rt-tray), `bun test`, `swift run mattstack-checks`.

**Spec:** `docs/superpowers/specs/2026-09-14-repo-root-choice-design.md`

## Global Constraints

- No em dashes or en dashes anywhere, in code, comments, tests, commit messages, or docs. Use an ellipsis ("...") or rephrase. See `~/.claude/rules/no-em-dashes.md`.
- Clean-code comments only: a comment earns its place by stating a constraint the code cannot show. Never narrate the next line, never cite a ticket id or review finding in source.
- `bun run test` does NOT run e2e. Run `bun run test:all`, or at minimum the e2e file covering a surface you changed, before calling anything verified.
- TDD throughout: write the failing test, run it, watch it fail for the stated reason, then implement. A test that passes before the change is not RED, it is a characterization test, and this plan says explicitly where one is intended.
- `repos.root` must NOT be added to `INSTALL_SATISFIED_IDS` in `lib/setup/plan.ts`.
- **Nothing writes `rt.repoRoots` before `~/.mattstack/user/.git` exists.** That is the invariant; everything else follows from it. The writers are the verb's true branch and the promotion helper (called from `settings.seed` and `repos.clone`), all at **machine** scope (`scopes: ["machine"]` in `packages/rt-client/src/settings/registry-defs.ts`). The promotion helper carries the same guard, so the invariant holds for every writer rather than for one of them.
- `rt.repoRoots` has `default: []` in that registry. It is NEVER `undefined`, so `toBeUndefined()` can never pass; assert `toEqual([])`.
- The one "is a root configured" predicate, in the row and in every step, is `!getSetting<string[]>("rt.repoRoots").value?.[0]`. Do NOT use `unwritten()` for this key: it reports false for a value explicitly written as `[]`, a state every consumer reads as no root, and the two disagreeing is how the row goes green over an install that clones nothing.
- rt must never create a repo-root directory on the user's behalf. `NSOpenPanel`'s own New Folder button is how a user makes one.
- Never run a verb that writes real settings against your own HOME. Use `env -i HOME=$(mktemp -d) ...` for any smoke check, per this repo's operating rules.
- Work on branch `repo-root-choice`, which carries the spec. Never push to `main`. Never leave the shared main checkout on a branch.

### Two facts that shape every task below

**The render gate is two conditions.**

```ts
team.mode === "join" || snapshot.trackingIdentities.length > 0
```

An earlier draft gated on `trackingIdentities` alone and was wrong in the one case that matters. It comes from `mattstack.tracking`, a team-scoped key in `~/.mattstack/teams/<slug>/mattstack/settings.team.jsonc`. On a joiner's fresh Mac that clone does not exist until `team.join`, **inside** Install; `enrichSnapshotForge` back-fills only `integrations.forge`. So a joiner's first pass sees `[]`, the row would not render, `canInstall` would be true, Install would run with no root, and the joiner would clone zero repos.

`join` rather than `mode !== "none"`: join is the only pre-Install mode where someone else has already declared repos. A create install declares none, so asking would be the noise this design set out to remove. The snapshot half covers both once Install has run, including a created team that later tracks repos.

**The answer is STAGED, never written before Install.**

The machine store is `~/.mattstack/user/local/<machineKey()>/settings.local.jsonc`, and `~/.mattstack/user` **is** the home repo. `setSetting` does `mkdirSync(dirname(storePath), { recursive: true })` when the file is missing. Nothing creates `user/` before Install in the `join` and `create` modes (the Team screen only dry-runs). `restore` clones for real at Continue, which is exactly why the branch tests the directory and not the mode: under restore the true branch is correct, and `homeInitStep.applies` excludes restore so nothing re-clones over it. So a pre-Install machine-scope write makes `user/` exist, non-empty, and non-git; `gatherHomeState` sets `userRepoPresent` false; `buildInitPlan` emits `cloneUserRepo`; and `git clone <url> user` into a non-empty directory is fatal. That dead-ends **Install step 1**.

There is a second failure behind it: `machineKey()` falls back to the slugified hostname when `~/.mattstack/machine-key` is absent, and `home init` writes that file *after* the clone, possibly adopting a name from the cloned `user/local/`. A pre-Install write would land in a profile the resolver never reads.

So `rt setup repo-root set` branches on `p.exists(homeGitDir(p.home))`, that is `join(p.home, ".mattstack", "user", ".git")`:

- **false** (home repo not initialised): stage to `~/.mattstack/rt/repo-root.json`, outside the home repo. `lib/setup/staging.ts` is the precedent; it is shaped for per-domain secrets, so this is a sibling file, not a reuse of `stageSecret`.
- **true**: write `rt.repoRoots` directly at machine scope. The dangerous precondition is gone.

`settings.seed` at step 8 promotes any staged value into the store and deletes the file. **Promotion always wins over whatever the key already holds**, and the emptiness test everywhere is `!getSetting<string[]>("rt.repoRoots").value?.[0]`, never `unwritten()`.

**Why the branch, rather than always staging.** An earlier draft had the verb always stage and the row read store-then-staged. That re-introduced an unclearable required row: post-Install the store holds `/A`, `/A` is deleted, the user picks `/B`, the verb stages it, the row keeps reading the dead `/A`, and `settings.seed` refuses to promote because the key is written. `canInstall` false forever. `home.restore` makes that reachable, since `rt home init` offers to adopt a profile from the restored `user/local/`, inheriting an `rt.repoRoots` that names a path this machine does not have. The branch means the two sources are never both live, so the row's `store ?? staged` read cannot go stale.

Promotion also runs at the top of `repos.clone`: `rt setup apply --only repos.clone` is a documented remedy channel that skips step 8, and without it a remedy run after a pre-Install answer would clone nothing.

Read `lib/setup/staging.ts` before writing Task 1.

---

### Task 1: The shared repo-root module

Built first because both the row (Task 4) and the verb (Task 5) validate through it, and because the candidate list must live in exactly one place before Task 2 deletes the other copy.

**Files:**
- Create: `lib/setup/repo-root.ts`
- Test: `lib/setup/__tests__/repo-root.test.ts`

**Also modify:** `lib/setup/probes.ts` and `lib/setup/__tests__/fakes.ts`, to add one member.

**Interfaces:**
- Consumes: `Probes`.
- Produces:

```ts
// on Probes, beside exists():
statPath(path: string): { isDirectory: boolean; writable: boolean } | null;

// lib/setup/repo-root.ts:
export const CANDIDATE_ROOT_NAMES: string[];
export type RootStat = { isDirectory: boolean; writable: boolean } | null;
export function expandHome(p: Pick<Probes, "home">, path: string): string;
export type RootCheck =
  | { ok: true; path: string; tccWarning: string | null }
  | { ok: false; detail: string };
export function checkRepoRoot(p: Pick<Probes, "home" | "statPath">, raw: string): RootCheck;
export function detectCandidate(p: Pick<Probes, "home" | "exists">): string | null;
export function readStagedRepoRoot(p: Pick<Probes, "home" | "readFile">): string | null;
export function stageRepoRoot(p: Probes, path: string): void;
export function clearStagedRepoRoot(p: Probes): void;
/** Drains staging into the store. Idempotent, called by settings.seed and repos.clone. */
export function promoteStagedRepoRoot(p: Probes): boolean;
```

`statPath` goes on `Probes` rather than being an injected default argument. `probes.ts`'s own docblock is the reason: the seam exists "so validators and steps stay pure functions over injected state and tests never touch the real machine". A row taking its candidate from a faked `p.exists` while stat-ing the real disk would be half fake and half real, and no `composePlan` test could control it. The real implementation is `statSync` plus `accessSync(path, W_OK)`, both caught; the fake is seeded from a map.

The staging file is a single JSON object at `~/.mattstack/rt/repo-root.json`, mode 0600 to match the neighbouring staging files even though a path is not a secret. Read `lib/setup/staging.ts` for the read/write/remove conventions and follow them; do not reuse `stageSecret`, whose shape is per-domain secrets.

- [ ] **Step 1: Write the failing tests**

Create `lib/setup/__tests__/repo-root.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { checkRepoRoot, detectCandidate, expandHome, type RootStat } from "../repo-root.ts";

const HOME = "/Users/t";
const DIR = { isDirectory: true, writable: true };
const FILE = { isDirectory: false, writable: true };
const RO = { isDirectory: true, writable: false };
/** One fake per test: statPath answers for every path, exists answers the candidate scan. */
const p = (stat: RootStat = DIR, existing: string[] = []) => ({ home: HOME, statPath: () => stat, exists: (x: string) => existing.includes(x) });

describe("checkRepoRoot", () => {
  test("a writable directory is accepted and carries no warning", () => {
    expect(checkRepoRoot(p(DIR), "/Users/t/dev")).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test.each([["~/dev"], ["${home}/dev"]])("expands %s before validating", (raw) => {
    expect(checkRepoRoot(p(DIR), raw)).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test("a path that does not exist is refused and says so", () => {
    const r = checkRepoRoot(p(null), "/Users/t/nope");
    expect(r).toEqual({ ok: false, detail: "/Users/t/nope does not exist" });
  });

  test("a file is refused as not a directory", () => {
    const r = checkRepoRoot(p(FILE), "/Users/t/notes.txt");
    expect(r).toEqual({ ok: false, detail: "/Users/t/notes.txt is not a directory" });
  });

  test("an unwritable directory is refused", () => {
    const r = checkRepoRoot(p(RO), "/Users/t/locked");
    expect(r).toEqual({ ok: false, detail: "/Users/t/locked is not writable" });
  });

  test("an empty path is refused rather than resolving to home", () => {
    expect(checkRepoRoot(p(DIR), "   ")).toEqual({ ok: false, detail: "no path given" });
  });

  // Advisory on purpose. It is the user's machine, and ~/Documents/GitHub is a
  // common convention; refusing would put rt's judgement back in place of
  // theirs, which is the defect this whole change removes.
  test.each([
    ["/Users/t/Documents/GitHub", "Documents"],
    ["/Users/t/Desktop/code", "Desktop"],
    ["/Users/t/Downloads/code", "Downloads"],
  ])("%s is ACCEPTED with a warning naming %s", (path, dirName) => {
    const r = checkRepoRoot(p(DIR), path);
    expect(r.ok).toBe(true);
    expect((r as { tccWarning: string | null }).tccWarning).toContain(dirName);
  });

  test("a directory merely NAMED Documents outside home is not warned about", () => {
    const r = checkRepoRoot(p(DIR), "/srv/Documents/code");
    expect((r as { tccWarning: string | null }).tccWarning).toBeNull();
  });
});

describe("detectCandidate", () => {
  test("returns the first candidate that exists", () => {
    expect(detectCandidate(p(DIR, ["/Users/t/code"]))).toBe("/Users/t/code");
  });

  test("follows list order when several exist", () => {
    expect(detectCandidate(p(DIR, ["/Users/t/code", "/Users/t/Documents/GitHub"]))).toBe("/Users/t/Documents/GitHub");
  });

  test("returns null when none exist, so nothing is suggested", () => {
    expect(detectCandidate(p(DIR, []))).toBeNull();
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

- [ ] **Step 3: Add the probe, then write the module**

First, `lib/setup/probes.ts`: add `statPath(path: string): RootStat` beside `exists`, implemented with `statSync` plus `accessSync(path, constants.W_OK)`, each in its own try/catch, returning null when the path cannot be stat'd at all. A path that cannot be stat'd is indistinguishable from one that is not there, and both mean "choose another". Seed the fake in `lib/setup/__tests__/fakes.ts` from a map the way the other fake members are seeded.

Then `lib/setup/repo-root.ts`:

```ts
/**
 * Where the user's repos go. rt validates a path the user picked; it never
 * picks one.
 *
 * The chosen path is staged under the runtime dir rather than written to the
 * machine store, because that store lives inside the home repo and creating it
 * before `home.init` clones would make the clone fail on a non-empty target.
 */
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

export function checkRepoRoot(p: Pick<Probes, "home" | "statPath">, raw: string): RootCheck {
  const path = expandHome(p, raw.trim());
  if (path === "") return { ok: false, detail: "no path given" };
  const s = p.statPath(path);
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

function stagedPath(home: string): string {
  return join(home, ".mattstack", "rt", "repo-root.json");
}

export function readStagedRepoRoot(p: Pick<Probes, "home" | "readFile">): string | null {
  const raw = p.readFile(stagedPath(p.home));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { root?: unknown };
    return typeof parsed.root === "string" && parsed.root !== "" ? parsed.root : null;
  } catch {
    return null;
  }
}
```

`stageRepoRoot` and `clearStagedRepoRoot` write and remove that file. Copy the mkdir, mode and removal conventions from `lib/setup/staging.ts` rather than inventing them, and use the `Probes` filesystem members, not `fs` directly.

`promoteStagedRepoRoot` is the one drainer, called from both `settings.seed` and `repos.clone`:

```ts
/**
 * Moves a staged answer into the store, once. Carries the same home-repo guard
 * the verb does: the machine store's file lives inside the home repo, so
 * writing it before the clone exists makes that clone fail on a non-empty
 * target. Every writer of rt.repoRoots goes through this guard or the verb's.
 */
export function promoteStagedRepoRoot(p: Probes, write: typeof setSetting = setSetting): boolean {
  const staged = readStagedRepoRoot(p);
  if (staged === null) return false;
  if (!p.exists(homeGitDir(p.home))) return false;
  write("rt.repoRoots", [staged], "machine");
  clearStagedRepoRoot(p);
  return true;
}
```

The guard matters beyond tidiness: `rt setup apply --only repos.clone` is reachable on a machine that has never installed (`gateHardPreconditions` checks only `tool.macos` and `tool.clt`), and an unguarded write there would create `~/.mattstack/user` as a non-git directory and kill the *next* full install at step 1. Same regression, entered through the promotion path instead of the verb path.

Test it directly: staged with `.git` present promotes and clears; staged without `.git` returns false, writes nothing and leaves the file; nothing staged returns false.

Add tests for the three staging functions alongside the ones above: a staged value round-trips, a missing file reads null, a corrupt file reads null rather than throwing, and clearing removes it.

- [ ] **Step 4: Run and watch them pass**

Run: `bun test lib/setup/__tests__/repo-root.test.ts`
Expected: PASS, all of them.

- [ ] **Step 5: Commit**

```bash
git add lib/setup/repo-root.ts lib/setup/__tests__/repo-root.test.ts
git commit -m "setup: add the shared repo-root validator"
```

---

### Task 2: `settings.seed` stops deciding, and starts promoting

**Files:**
- Modify: `lib/setup/steps/settings.ts` (delete `detectOrCreateDefaultRoot`, `detectRepoRoots`, `CANDIDATE_ROOT_NAMES`, `DEFAULT_ROOT_NAME` and the old `rt.repoRoots` block; call the promotion)
- Modify: `lib/setup/steps/repos.ts` (call the promotion above the early return at line 79)
- Test: `lib/setup/__tests__/steps-a.test.ts`

**Interfaces:**
- Consumes: `promoteStagedRepoRoot` from `lib/setup/repo-root.ts` (Task 1). The candidate list also lives there now; `settings.ts` no longer needs it.
- Produces: `rt.repoRoots` at machine scope, the only write of that key in the codebase.

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
  const p = fakeProbes({ home, dirs: { [join(home, "Documents", "GitHub")]: [] } });
  const { ctx } = makeCtx(p, { snapshot: snapshotWith(["gitlab.com/acme/one"]) });
  const outcome = await settingsSeedStep.run(ctx);
  expect(outcome.state).toBe("done");
  expect(getSetting<string[]>("rt.repoRoots").value).toEqual([]);
});

test("settings.seed creates no directory when nothing is detected", async () => {
  const p = fakeProbes({ home, dirs: {} });
  const { ctx } = makeCtx(p, { snapshot: snapshotWith(["gitlab.com/acme/one"]) });
  await settingsSeedStep.run(ctx);
  expect(p.exists(join(home, "Documents", "GitHub"))).toBe(false);
});
```

Two fixture facts to get right, both of which will silently mislead you otherwise. `fakeProbes`'s `dirs` is a `Record<string, string[]>` (`fakes.ts:44`), not an array; the existing test writes `dirs: { [githubRoot]: [] }`. And `EMPTY_SNAPSHOT` is module-private in both `lib/setup/plan.ts` and `commands/setup.ts` and is NOT available in the test files: the existing tests spell the snapshot out inline, so do that.

- [ ] **Step 2: Run them and watch both fail**

Run: `bun test lib/setup/__tests__/steps-a.test.ts -t "settings.seed"`
Expected: both FAIL. The first because `rt.repoRoots` is written (it reads `["<home>/Documents/GitHub"]`, not `[]`); the second because the directory was created. If either passes, the fake wiring is wrong: fix it before touching production code.

- [ ] **Step 3: Add the promotion, test first**

`settings.seed` gains one job: if a staged path exists, write it at machine scope and clear the staging file. **A staged value always wins**, whether or not the key already holds something: staging is only ever populated by the verb before the home repo existed, so it is by construction the freshest answer the user gave on this machine.

Use `!getSetting<string[]>("rt.repoRoots").value?.[0]` anywhere you need "is a root configured", never `unwritten()`. They disagree for a key explicitly written as `[]` at machine scope, which is reachable by hand, and in that state `unwritten()` is false while every consumer sees no root: the row would read `ready` off staging while `repos.clone` and `board.keys` silently did nothing.

Step 8 is the earliest safe moment. `home.init` is step 1, so by step 8 the home repo exists and the machine key is settled, and `setSetting` writes into a profile directory the resolver will actually read.

```ts
test("settings.seed promotes a staged repo root into the machine store and clears the staging file", async () => {
  const p = fakeProbes({ home });
  stageRepoRoot(p, join(home, "dev"));
  const { ctx } = makeCtx(p, { snapshot: snapshotWith(["gitlab.com/acme/one"]) });
  const outcome = await settingsSeedStep.run(ctx);
  expect(outcome.state).toBe("done");
  expect(getSetting<string[]>("rt.repoRoots").value).toEqual([join(home, "dev")]);
  expect(readStagedRepoRoot(p)).toBeNull();
});

test("a staged root overwrites an existing rt.repoRoots and clears staging", async () => {
  const p = fakeProbes({ home });
  setSetting("rt.repoRoots", [join(home, "stale")], "machine");
  stageRepoRoot(p, join(home, "fresh"));
  const { ctx } = makeCtx(p, { snapshot: snapshotWith(["gitlab.com/acme/one"]) });
  await settingsSeedStep.run(ctx);
  expect(getSetting<string[]>("rt.repoRoots").value).toEqual([join(home, "fresh")]);
  expect(readStagedRepoRoot(p)).toBeNull();
});

```

Both test names claim exactly what their bodies assert. Promotion consults no emptiness predicate at all, which is what makes "always wins" true; the predicate matters in the row and in `repos.clone`'s own `if (!root)` guard, and it is tested there (Task 5) rather than here.

Run them, watch both fail (nothing promotes yet), then implement.

- [ ] **Step 4: Delete the decision**

In `lib/setup/steps/settings.ts` delete `detectOrCreateDefaultRoot`, `detectRepoRoots`, `CANDIDATE_ROOT_NAMES` and `DEFAULT_ROOT_NAME`, and remove the `if (unwritten("rt.repoRoots")) { ... }` block from `settingsSeedRun`. All four become dead once the block goes, and `noUnusedLocals` is off so nothing will tell you. The candidate list lives in `lib/setup/repo-root.ts` now; a second copy here is how the two drift.

Update the file's header docblock: it says the step seeds "`rt.repoRoots` (detected candidate directories, only when nothing is set yet)". Replace that clause with one saying the repo root is the user's own choice, made through the `repos.root` row, and that this step no longer touches the key.

- [ ] **Step 5: Run the whole file**

Run: `bun test lib/setup/__tests__/steps-a.test.ts`
Expected: PASS. Four existing tests reference the old behavior (around lines 771, 782, 812 and 835). Handle them individually rather than deleting on sight:

- the one asserting rt creates `Documents/GitHub` is asserting the defect: delete it
- the "idempotent re-run" test at ~782 asserts the string `"wrote: mattstack.appPath, rt.repoRoots"` but is really about `appPath` idempotency: update its expected string, do not delete it

- [ ] **Step 6: Pin the board.keys dependency**

`board.keys` now depends on the user having answered `repos.root` before Install rather than on `settings.seed` writing the root at step 8. Nothing in either file records that.

`trackingRepoNames` is NOT a basename derivation: `lib/setup/steps/skills.ts:93-98` intersects tracking basenames with `getKnownRepos().filter(r => r.registered !== false)`. With no repo in the index, `repoNames[0]` is undefined and `board.cwds` is never written. `steps-b.test.ts:872` has a `seedTrackedRepo()` helper that mkdtemps a directory and calls `updateRepoIndex`; use it, or this test fails for a reason that has nothing to do with repo roots.

Add to the `board.keys` describe block in `steps-b.test.ts`. `snapshotWith(ids)` below stands for whatever inline snapshot literal the neighbouring tests already build; copy theirs rather than importing anything.

```ts
// board.cwds is derived from rt.repoRoots, which settings.seed used to write at
// step 8. It is now the user's answer to the required repos.root row, set
// before Install starts. A regression here is silent: boardKeysRun logs and
// leaves the setting unset rather than failing.
test("board.keys still seeds board.cwds from a root the user chose before Install", async () => {
  const { repoName, repoDir } = seedTrackedRepo();
  setSetting("rt.repoRoots", [dirname(repoDir)], "machine");
  const { ctx } = makeCtx(fakeProbes({ home }), { snapshot: snapshotWith([`gitlab.com/acme/${repoName}`]) });
  await boardKeysStep.run(ctx);
  expect(getSetting<Record<string, string>>("board.cwds").value?.review).toBe(join(dirname(repoDir), repoName));
});
```

Run: `bun test lib/setup/__tests__/steps-b.test.ts -t "board.keys"`
Expected: PASS. This is a characterization test: it passes before and after this task. That is intended and stated, because what changes is the reason the ordering holds, not the result.

- [ ] **Step 7: Drain from `repos.clone` too**

`rt setup apply --only repos.clone` is a documented remedy channel (`lib/command-tree-def.ts`: "the checklist's own row remedies use it") and it skips step 8, so without this a remedy run after a pre-Install answer clones nothing.

In `lib/setup/steps/repos.ts`, call `promoteStagedRepoRoot(ctx.p)` **above the `identities.length === 0` early return at line 79**, not merely "at the top". Below it, a run with nothing to clone would leave staging undrained.

Add a test: a staged root plus `~/.mattstack/user/.git` present, invoked through `repos.clone` alone, ends with `rt.repoRoots` written and the staging file gone.

- [ ] **Step 8: Commit**

```bash
git add lib/setup/steps/settings.ts lib/setup/steps/repos.ts lib/setup/__tests__/
git commit -m "setup: promote the staged repo root from settings.seed and repos.clone"
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

Use `try`, not `try!`: the closure is `throws` and the harness reports a thrown error as a failure, where `try!` traps the whole run. `c.fail(_ message:)` is real (`Harness.swift`), so use it as written.

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
- Consumes: `checkRepoRoot`, `stageRepoRoot` from `lib/setup/repo-root.ts` (Task 1).
- Produces: the verb `rt setup repo-root set <folder>`, staging the path and exiting 2 with a JSON error envelope on a bad one.

- [ ] **Step 1: Write the failing tests**

Cover, following the existing connect-handler test conventions:

- with NO `~/.mattstack/user/.git`: a valid directory STAGES the expanded path and writes NO setting (assert `getSetting("rt.repoRoots").value` is still `[]`)
- with `~/.mattstack/user/.git` present: the same call WRITES the store and stages nothing
- a nonexistent path stages nothing and raises the user-actionable error
- a file and an unwritable directory likewise
- `~/dev` is staged expanded, not as `~/dev`
- a TTY with no argument prints usage and does NOT read stdin
- a piped `{"root": "..."}` with no argument is accepted
- staging twice replaces the first value rather than appending

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL, verb not registered.

- [ ] **Step 3: Write the handler**

Read `connectCredential` in `commands/setup.ts` first: it is the precedent for a setup subcommand that takes input, and for the `--json` envelope.

Two things to copy from it exactly:

1. **Check `deps.isTTY()` BEFORE any stdin read.** Its comment says why: "reading stdin first would block on EOF at a real terminal instead of prompting".

   Order: a path argument if given; otherwise, at a TTY, print usage and exit; otherwise read stdin. **Do NOT prompt.** The only prompt on the deps object is `promptField`, wired to `promptSecret(field.label)` (`commands/setup.ts:617`), which sets raw mode and echoes nothing. Masking a folder path is wrong, and following `connectCredential` blindly lands you on exactly that.
2. **Throw `UserActionableError`** on a validation failure rather than printing and exiting yourself. `exitWithUserError` (`commands/setup.ts:443`) prints the envelope and exits **2**, and `RtResult.userError` in the tray decodes the envelope only at exit 2. At any other code the app falls through to generic copy, and because `ChecklistScreen` sets `redactStderr = stdin != nil`, the user would see "details withheld because the command carried a secret" instead of "that folder is not writable".

On success, branch on whether the home repo exists yet:

```ts
if (deps.probes.exists(homeGitDir(deps.probes.home))) {
  deps.writeSetting("rt.repoRoots", [check.path], "machine");
} else {
  stageRepoRoot(deps.probes, check.path);
}
```

`Probes.home` is the user's HOME, **not** `~/.mattstack`. `join(p.home, "user", ".git")` resolves to `~/user/.git`, is false forever, and silently restores the always-stage behaviour with its unclearable row. `homeGitDir` is at `lib/setup/steps/home.ts:18` and already used as `p.exists(homeGitDir(p.home))` at `:74`; export it from there rather than re-spelling the path here.

Never write the store on the false branch: it lives inside the home repo, and creating it before `home.init` clones makes the clone fail on a non-empty target. Never stage on the true branch either, or a post-Install answer would sit in a file nothing reads while the row keeps reporting the old stored path.

Include `tccWarning` in the `--json` payload. The row computes its own warning in Task 5, so nothing depends on this payload reaching the app; it is there for CLI users and scripts.

- [ ] **Step 4: Register the command**

In `lib/command-tree-def.ts`, add `repo-root` as a **branch** node under `setup`, with `set` as a leaf beneath it. Not a leaf with a `set` positional: that would be a required-positional leaf needing `omitBehavior`, and `picker:check` would fail. The `set` leaf's path argument is `optional` (a pipe can supply it), which is what keeps it out of `picker:check`'s scope; confirm against `scripts/lib/picker-conformance.ts`'s own filter rather than assuming.

- [ ] **Step 5: Verify**

Run: `bun test <the handler test file>` and `bun run picker:check`
Expected: PASS, and `0 violation(s)`.

Smoke check under an isolated HOME. **Never against your own**, which has a real `rt.repoRoots` this would overwrite:

```bash
H=$(mktemp -d); mkdir -p "$H/dev"
env -i HOME="$H" PATH="$PATH" bun run cli.ts setup repo-root set "$H/dev" --json
cat "$H/.mattstack/rt/repo-root.json"
test -e "$H/.mattstack/user" && echo "BUG: the home repo dir was created" || echo "ok: no user/ created"
env -i HOME="$H" PATH="$PATH" bun run cli.ts setup repo-root set "$H/nope" --json; echo "exit=$?"
```

Expected: a success envelope, the staged JSON, `ok: no user/ created`, then a JSON error envelope with `exit=2`.

That third line is the check that matters. It is the regression this design exists to avoid, and it is cheap to assert here.

- [ ] **Step 6: Commit**

```bash
git add commands/setup.ts lib/command-tree-def.ts lib/setup/__tests__/ commands/__tests__/
git commit -m "setup: add rt setup repo-root set, staging the chosen path"
```

---

### Task 5: The `repos.root` row

**Files:**
- Create: `lib/setup/validators/repo-root.ts`
- Modify: `lib/setup/plan.ts` (the `tools` group builder in `composePlan`)
- Test: `lib/setup/__tests__/validators-repo-root.test.ts`

**Interfaces:**
- Consumes: `checkRepoRoot`, `detectCandidate`, `readStagedRepoRoot` from `lib/setup/repo-root.ts`; the `choose-folder` action from `contract.ts`; `row()`; `TeamSnapshot`; `TeamRef`.
- Produces: `export function repoRootRow(p: Pick<Probes, "home" | "exists" | "statPath" | "readFile">, team: TeamRef, snapshot: TeamSnapshot): Row | null`

No `stat` parameter: the filesystem reaches this through `p.statPath` (Task 1), so `composePlan` needs no new plumbing and a test controls the whole row through one fake.

- [ ] **Step 1: Write the failing tests**

Cover every branch:

- absent when `team.mode` is `"none"` AND `trackingIdentities` is empty
- absent when `team.mode` is `"create"` and `trackingIdentities` is empty (a new team declares no repos, so there is nothing to ask about yet)
- **present when `team.mode === "join"` and `trackingIdentities` is EMPTY** (the joiner's first pass; the case an earlier design missed, and the most important test in this task)
- present when mode is `"none"` but `trackingIdentities` is non-empty (post-install)
- nothing set and nothing staged: `needs-you`, `required: true`, action `choose-folder`, detail names `rt setup repo-root set` so a CLI user has something to run
- **nothing set but a valid path STAGED: `ready`** (the user answered before Install; the store cannot hold it yet)
- **`rt.repoRoots` explicitly written as `[]` at machine scope, with a valid path staged: `ready`.** This is the predicate case: `unwritten()` reports false here while every consumer sees no root, so a row built on it would fall through to the stored nothing and report `needs-you` against an answered question. Use `!value?.[0]`.
- a staged path that no longer validates: `needs-you`, same as a bad stored one
- **store and staging both hold values**: cannot happen by construction (the verb writes one or the other, never both), but assert the row still resolves deterministically to the stored one so a future change to the verb fails here rather than silently
- unset with a detected candidate: `startAt` carries it, status still `needs-you`
- set and usable: `ready`, detail names the path
- set under `~/Documents`: `ready`, detail also carries the TCC warning
- set but missing: `needs-you`, detail names the path
- set but a file, and set but unwritable: `needs-you`, not `ready`
- stored as `~/dev` with the directory present: `ready` (expansion, via `checkRepoRoot`)
- **`getSetting` throws: `needs-you` with the picker, never an exception.** There is no reader seam on this function, so do not try to inject one. Author the value that really throws: `setSetting("rt.repoRoots", ["${repoRoot}"], "machine")` makes `expandString` hit `required(ctx.repoRoot, "repoRoot", "a repo path")` in the resolver and throw. That is the same value `lib/repo-index.ts` guards against, so the test exercises the real failure rather than a mocked one.

- [ ] **Step 2: Run and watch them fail**

Expected: FAIL, module not found.

- [ ] **Step 3: Write the validator**

```ts
/**
 * Where rt clones the team's repos. Two render conditions, not one: the join
 * intent covers a joiner whose team clone (and so whose tracked-repo list)
 * does not exist until team.join runs inside Install, and the snapshot covers
 * a machine whose setup is done and has no intent left.
 */
import { getSetting } from "../../settings/resolve.ts";
import { row, type Action, type Row, type TeamRef } from "../contract.ts";
import type { Probes } from "../probes.ts";
import { checkRepoRoot, detectCandidate, readStagedRepoRoot } from "../repo-root.ts";
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
  p: Pick<Probes, "home" | "exists" | "statPath" | "readFile">,
  team: TeamRef,
  snapshot: TeamSnapshot,
): Row | null {
  if (team.mode !== "join" && snapshot.trackingIdentities.length === 0) return null;

  const base = {
    id: "repos.root",
    kind: "tool" as const,
    title: "Repo folder",
    why: "Where rt clones your team's repos. rt does not pick this for you.",
    required: true,
    recheck: "on-activate" as const,
  };

  // The store cannot hold this before Install (its file lives inside the home
  // repo), so a pre-Install answer lives in the staging file and the row must
  // read both or it would report needs-you against a question already answered.
  const chosen = configuredRoot() ?? readStagedRepoRoot(p);
  if (!chosen) {
    return row({ ...base, status: "needs-you", detail: `choose where rt should clone your team's repos (${CLI_HINT})`, action: chooseAction(detectCandidate(p)) });
  }

  const check = checkRepoRoot(p, chosen);
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

`drive-setup.sh` has NO existing rt invocation, no `RT` variable, and no `export PATH="$HOME/.local/bin:..."` line (unlike `assert-installed.sh:13`). A bare `rt` there resolves to nothing. Add the same PATH export that `assert-installed.sh` uses, or call rt by absolute path.

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

`ax_wait_status <rowId> <status> <timeout-s>` is real (`ax.sh:184`) and `drive-setup.sh` already uses it, as is the `setup.checklist.recheck` axid. Use both as written.

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

- [ ] **Step 4: Mutation-verify, five of them**

Revert Task 2's production change only, leaving its tests: the two `settings.seed` tests must go red. Restore.

Revert Task 5's `team.mode !== "join" &&` guard so the row keys on tracking alone: the joiner test from Task 5 Step 1 must go red. Restore. That test is the whole reason this design was rewritten; a version of it that passes either way is worthless.

Then revert Task 4's branch so the verb always stages, and run the Task 4 smoke check with `~/.mattstack/user/.git` present: the post-Install write test must go red. Restore. That branch is what stops the two sources being live at once.

Then revert Task 4's false branch to a `setSetting` call and run the Task 4 smoke check on a fresh HOME: `test -e "$H/.mattstack/user"` must report the bug. Restore. That is the Install-step-1 regression, and nothing else in the suite catches it.

Then swap the ROW's predicate (Task 5's `configuredRoot`) to `unwritten()`-style emptiness and run its explicit-empty-array case: it must go red. Promotion itself consults no predicate, so there is nothing to swap in `settings.seed`; do not go looking for it there.

- [ ] **Step 5: Leave it unpushed**

Report the commit range on `repo-root-choice`.
