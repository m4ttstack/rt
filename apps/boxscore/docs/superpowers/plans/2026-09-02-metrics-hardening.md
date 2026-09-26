# Metrics-Layer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make boxscore's metrics layer compute every metric from one cohort definition, so the leaderboard numbers and the evidence tables can never disagree, and pin the metric table, layering, and warning codes with the compiler.

**Architecture:** A new `server/metrics/cohorts.ts` builds, per user, the record sets every metric is derived from (authored-and-merged, reviewed, waited-for-review, reviewers-of-mine, pipelines, pushes, Linear issues) with every settings filter already applied. `snapshot.ts` turns cohorts into numbers; `evidence.ts` turns the same cohorts into rows. Filter builders move to `server/metrics/filters.ts`. The metric descriptor table gains a compile-time check against `UserMetrics`, the fetch pipeline stops importing the metrics layer, and `LeaderboardWarning.code` becomes a literal union.

**Tech Stack:** TypeScript 5.7 (strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), Bun 1.1+, vitest 2. Imports inside the server use `.js` suffixes. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-mattstack-integration-design.md`, section 4 (sub-project 1). Section 10 lists the defects this plan resolves.

## Global Constraints

- The JSON shapes of the leaderboard, detail, refresh, and cache responses in `shared/types.ts` do not change. Type narrowings that keep the same JSON are allowed (spec D8).
- Review depth stays a **mean**; the code's rationale in `snapshot.ts` is authoritative and the docs move to match it (spec section 4, item 5).
- Scope is `server/metrics/`, `shared/`, `server/pipeline/model.ts`, the one import in `server/pipeline/fetch.ts`, and tests. No fetch, cache, settings, or UI behavior changes.
- Existing tests stay green at the end of every task. The characterization snapshots in `test/slicing.test.ts` must not change: if one does, the refactor changed a number and that is a bug in the task.
- Comments state constraints the code cannot show; never narrate the next line or the change history. No em dashes anywhere (use "..." or rephrase).
- Commit after every task with a short imperative message.
- Run tests with `bun run test` and types with `bun run typecheck` from the repo root. Both must pass before each commit.
- Execute in a worktree under `.worktrees/metrics-hardening` (this repo is not rt-managed), branched from `feat/mattstack-integration-spec`.

---

### Task 1: The metric table covers every `UserMetrics` key

**Files:**
- Modify: `shared/metrics.ts`
- Test: `test/metadata.test.ts`

**Interfaces:**
- Consumes: `MetricKey`, `UserMetrics` from `shared/types.ts` (unchanged).
- Produces: `METRICS: MetricDescriptor[]` now has 16 rows, including `revertedCount` (quality, lower is better) and `currentStreak` (quality, higher is better). A `UserMetrics` key without a row fails `tsc`.

- [ ] **Step 1: Write the failing test**

Append to `test/metadata.test.ts` inside the existing `describe("metric metadata coherence", ...)` block:

```ts
  it("computed metrics are also described, so they display and rank", () => {
    const reverted = METRICS.find((d) => d.key === "revertedCount");
    const current = METRICS.find((d) => d.key === "currentStreak");
    expect(reverted?.better).toBe("asc");
    expect(reverted?.group).toBe("quality");
    expect(current?.better).toBe("desc");
    expect(current?.group).toBe("quality");
  });

  it("every rankable UserMetrics key has exactly one descriptor", () => {
    const rankable = Object.entries(sample)
      .filter(([, cell]) => typeof cell === "object" && cell !== null && "rank" in cell)
      .map(([key]) => key)
      .sort();
    const described = METRICS.map((d) => d.key).sort();
    expect(described).toEqual(rankable);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- test/metadata.test.ts`
Expected: FAIL. `reverted?.better` is `undefined`, and the described list is missing `currentStreak` and `revertedCount`.

- [ ] **Step 3: Rebuild the table with a compile-time completeness check and the two rows**

In `shared/metrics.ts`, replace the `export const METRICS: MetricDescriptor[] = [ ... ];` declaration (the whole array) with:

```ts
const METRIC_TABLE = [
  // --- Delivery (Linear): tickets shipped ---
  { key: "issuesCompleted", kind: "scalar", label: "Issues done", group: "delivery", better: "desc",
    description: "Linear issues (by assignee, all teams) completed in the window, excluding stale backlog closed long after creation (default: completed within 90 days of being filed). Guards against bulk backlog-grooming inflating the count." },

  // --- Volume (spec 4.1-4.4): gameable output counts ---
  { key: "additions", kind: "scalar", label: "Added", group: "volume", better: "desc",
    description: "Lines added across merged MRs the user authored." },
  { key: "deletions", kind: "scalar", label: "Deleted", group: "volume", better: "desc",
    description: "Lines deleted across merged MRs the user authored." },
  { key: "mrsMerged", kind: "scalar", label: "MRs merged", group: "volume", better: "desc",
    description: "Count of MRs the user authored that merged in the window." },
  { key: "mrsReviewed", kind: "scalar", label: "MRs reviewed", group: "volume", better: "desc",
    description: "Distinct teammates' MRs the user reviewed (note or approval) in the window." },
  { key: "pipelines", kind: "scalar", label: "Pipelines", group: "volume", better: "desc",
    description: "Pipelines the user triggered in the window." },

  // --- Quality / consistency (spec 4.5-4.10): counterweights ---
  { key: "reviewDepth", kind: "scalar", label: "Review depth", group: "quality", better: "desc", unit: "/MR",
    description: "Average inline (DiffNote) comments per reviewed MR ... higher = more substantive review." },
  { key: "reviewLatencyHours", kind: "dist", label: "Wait for review", group: "quality", better: "asc",
    description: "Hours the user's own MRs wait for first review (p50). Lower is better." },
  { key: "responseLatencyHours", kind: "dist", label: "Response time", group: "quality", better: "asc",
    description: "Hours until the user gives a first response on MRs they review (p50). Lower is better." },
  { key: "revertRate", kind: "scalar", label: "Revert rate", group: "quality", better: "asc", percent: true,
    description: "Share of the user's merged MRs later reverted. Lower is better." },
  { key: "revertedCount", kind: "scalar", label: "Reverted", group: "quality", better: "asc",
    description: "Merged MRs the user authored that were later reverted (detected reverts only). Lower is better." },
  { key: "sizeHealthPct", kind: "scalar", label: "Size health", group: "quality", better: "desc", percent: true,
    description: "Share of the user's merged MRs in the reviewable size band. Higher is better." },
  { key: "codingDays", kind: "scalar", label: "Coding days", group: "quality", better: "desc",
    description: "Number of distinct days the user pushed at least one commit (to the tracked project) during the window." },
  { key: "currentStreak", kind: "scalar", label: "Current streak", group: "quality", better: "desc",
    description: "Consecutive calendar days, ending on the user's most recent merge day, on which they merged at least one MR." },
  { key: "longestStreak", kind: "scalar", label: "Merge streak", group: "quality", better: "desc",
    description: "Longest run of consecutive calendar days on which the user merged at least one MR, within the window. E.g. 4 = merged an MR on 4 days in a row at some point. (Based on merges, not pushes.)" },
  { key: "reciprocity", kind: "scalar", label: "Reciprocity", group: "quality", better: "desc",
    description: "Reviews given divided by reviews received ... ~1 means pulling your weight." },
] as const satisfies readonly MetricDescriptor[];

type DescribedKey = (typeof METRIC_TABLE)[number]["key"];

// A UserMetrics key without a row here is computed but never shown, ranked, or validated.
// This fails tsc the moment such a key appears.
const everyMetricKeyIsDescribed = {} satisfies Record<Exclude<MetricKey, DescribedKey>, never>;
void everyMetricKeyIsDescribed;

export const METRICS: MetricDescriptor[] = [...METRIC_TABLE];
```

Keep everything else in the file (the `MetricDescriptor` interface, accessors, formatting) as it is.

- [ ] **Step 4: Run the tests and typecheck**

Run: `bun run test -- test/metadata.test.ts && bun run typecheck`
Expected: PASS for both. If `tsc` reports `Property 'x' is missing in type '{}'` on the `satisfies` line, a `UserMetrics` key still has no row: add its row rather than weakening the check.

- [ ] **Step 5: Run the whole suite**

Run: `bun run test`
Expected: PASS. `test/ranking.test.ts` and `test/validate.test.ts` iterate `METRICS` and must accept the two new rows without edits; the inline snapshots in `test/slicing.test.ts` pin `computeSnapshot`, which this task does not touch.

- [ ] **Step 6: Commit**

```bash
git add shared/metrics.ts test/metadata.test.ts
git commit -m "metrics: describe revertedCount and currentStreak; pin the table to UserMetrics"
```

---

### Task 2: Filter builders move to `server/metrics/filters.ts`

**Files:**
- Create: `server/metrics/filters.ts`
- Modify: `server/metrics/snapshot.ts` (remove the moved code, import it), `server/metrics/evidence.ts:10` (import path)
- Test: `test/filters.test.ts`

**Interfaces:**
- Produces, from `server/metrics/filters.ts`, with the exact signatures snapshot.ts has today:
  - `buildIgnoredMrSet(entries: string[] | undefined): (mr: { iid: number; projectPath: string }) => boolean`
  - `globToRegExp(pattern: string): RegExp`
  - `interface MetricFilters { lineCounts(mr: NormMr): { additions: number; deletions: number }; isBot(username: string | null): boolean; hasTeamTicket(mr: Pick<NormMr, "title" | "sourceBranch" | "description">): boolean }`
  - `buildMetricFilters(opts: { linearTeam?: string; extraBotPatterns?: string[]; excludeFilePatterns?: string[] }): MetricFilters`
  - `isDoneState(stateType: string | null, stateName: string | null, doneStates?: string[]): boolean`
  - `matchesTeam(identifier: string, linearTeam?: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildIgnoredMrSet, buildMetricFilters, globToRegExp, isDoneState, matchesTeam } from "../server/metrics/filters.js";
import { mr } from "./fixtures.js";

describe("globToRegExp", () => {
  it("matches at any depth when the pattern has no slash", () => {
    const re = globToRegExp("*.json");
    expect(re.test("package.json")).toBe(true);
    expect(re.test("apps/backend/package.json")).toBe(true);
    expect(re.test("apps/backend/index.ts")).toBe(false);
  });

  it("anchors to the path when the pattern has a slash", () => {
    const re = globToRegExp("generated/*");
    expect(re.test("generated/schema.ts")).toBe(true);
    expect(re.test("apps/generated/schema.ts")).toBe(false);
  });
});

describe("buildIgnoredMrSet", () => {
  const ignored = buildIgnoredMrSet(["!7", "org/app!9", " ", "org/other!7"]);

  it("bare !iid matches every project; project!iid matches one", () => {
    expect(ignored({ iid: 7, projectPath: "org/app" })).toBe(true);
    expect(ignored({ iid: 7, projectPath: "org/zzz" })).toBe(true);
    expect(ignored({ iid: 9, projectPath: "org/app" })).toBe(true);
    expect(ignored({ iid: 9, projectPath: "org/other" })).toBe(false);
  });

  it("an empty list ignores nothing", () => {
    expect(buildIgnoredMrSet([])({ iid: 7, projectPath: "org/app" })).toBe(false);
    expect(buildIgnoredMrSet(undefined)({ iid: 7, projectPath: "org/app" })).toBe(false);
  });
});

describe("buildMetricFilters", () => {
  it("excludes matching files from line counts and memoizes per MR", () => {
    const f = buildMetricFilters({ excludeFilePatterns: ["*.json"] });
    const m = mr({
      iid: 1,
      authorUsername: "alice",
      title: "x",
      additions: 30,
      deletions: 3,
      diffStats: [
        { path: "src/a.ts", additions: 10, deletions: 1 },
        { path: "package.json", additions: 20, deletions: 2 },
      ],
    });
    expect(f.lineCounts(m)).toEqual({ additions: 10, deletions: 1 });
    expect(f.lineCounts(m)).toBe(f.lineCounts(m));
  });

  it("hasTeamTicket scans title, branch, and description, and passes everything with no team", () => {
    const gated = buildMetricFilters({ linearTeam: "ENG" });
    expect(gated.hasTeamTicket({ title: "fix", sourceBranch: "eng-12-fix", description: null })).toBe(true);
    expect(gated.hasTeamTicket({ title: "fix", sourceBranch: null, description: "closes ENG:9" })).toBe(true);
    expect(gated.hasTeamTicket({ title: "fix", sourceBranch: null, description: null })).toBe(false);
    const open = buildMetricFilters({});
    expect(open.hasTeamTicket({ title: "fix", sourceBranch: null, description: null })).toBe(true);
  });

  it("isBot honors extra patterns and skips a bad regex", () => {
    const f = buildMetricFilters({ extraBotPatterns: ["^ci-", "("] });
    expect(f.isBot("ci-runner")).toBe(true);
    expect(f.isBot("alice")).toBe(false);
  });
});

describe("Linear gates", () => {
  it("matchesTeam is a case-insensitive prefix check", () => {
    expect(matchesTeam("eng-1", "ENG")).toBe(true);
    expect(matchesTeam("ENGX-1", "ENG")).toBe(false);
    expect(matchesTeam("PLA-1", undefined)).toBe(true);
  });

  it("isDoneState falls open on missing data and honors explicit state names", () => {
    expect(isDoneState(null, null, ["Done"])).toBe(true);
    expect(isDoneState("started", "In Progress", ["Done"])).toBe(false);
    expect(isDoneState("completed", "Shipped", ["Done"])).toBe(false);
    expect(isDoneState("canceled", "Won't do", [])).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- test/filters.test.ts`
Expected: FAIL with a module-not-found error for `../server/metrics/filters.js`.

- [ ] **Step 3: Create `server/metrics/filters.ts` with the moved code**

```ts
import { mrTicketHaystack, teamTicketRegex } from "../linear/ticket.js";
import { compileBotPatterns, isBotUsername } from "./stats.js";
import type { NormMr } from "../pipeline/model.js";

/** Build a predicate that returns true for MRs matching the ignore list. */
export function buildIgnoredMrSet(
  entries: string[] | undefined,
): (mr: { iid: number; projectPath: string }) => boolean {
  if (!entries || entries.length === 0) return () => false;
  const byProject = new Map<string, Set<number>>();
  const global = new Set<number>();
  for (const raw of entries) {
    const s = raw.trim();
    if (!s) continue;
    const bangIdx = s.indexOf("!");
    if (bangIdx >= 1) {
      const project = s.slice(0, bangIdx);
      const iid = Number(s.slice(bangIdx + 1));
      if (Number.isFinite(iid)) {
        let set = byProject.get(project);
        if (!set) { set = new Set(); byProject.set(project, set); }
        set.add(iid);
      }
    } else {
      const iid = Number(s.replace(/^!/, ""));
      if (Number.isFinite(iid)) global.add(iid);
    }
  }
  return (mr) => global.has(mr.iid) || (byProject.get(mr.projectPath)?.has(mr.iid) ?? false);
}

function filteredLineCounts(
  mr: NormMr,
  excludeRes: readonly RegExp[],
): { additions: number; deletions: number } {
  if (excludeRes.length === 0 || mr.diffStats.length === 0) {
    return { additions: mr.additions, deletions: mr.deletions };
  }
  let additions = 0;
  let deletions = 0;
  for (const f of mr.diffStats) {
    if (excludeRes.some((re) => re.test(f.path))) continue;
    additions += f.additions;
    deletions += f.deletions;
  }
  return { additions, deletions };
}

/** Compile a minimal glob (supports *, **, and literal segments) to a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  // Patterns without a "/" match at any depth (gitignore-style):
  // "*.json" should match "apps/backend/package.json" and "package.json".
  const effective = pattern.includes("/") ? pattern : `**/${pattern}`;
  return new RegExp(
    "^" +
    effective
      .replace(/\*\*\//g, "\x00")
      .replace(/\*\*/g, "\x01")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\x00/g, "(.*/)?")
      .replace(/\x01/g, ".*") +
    "$",
    "i",
  );
}

/** Settings-derived predicates, compiled once per snapshot/evidence build. */
export interface MetricFilters {
  /** Additions/deletions with excluded files removed, memoized per MR. */
  lineCounts(mr: NormMr): { additions: number; deletions: number };
  isBot(username: string | null): boolean;
  hasTeamTicket(mr: Pick<NormMr, "title" | "sourceBranch" | "description">): boolean;
}

export function buildMetricFilters(
  opts: { linearTeam?: string; extraBotPatterns?: string[]; excludeFilePatterns?: string[] },
): MetricFilters {
  const excludeRes = (opts.excludeFilePatterns ?? []).map(globToRegExp);
  const extraBots = compileBotPatterns(opts.extraBotPatterns);
  const ticketRe = opts.linearTeam ? teamTicketRegex(opts.linearTeam) : null;
  const counts = new WeakMap<NormMr, { additions: number; deletions: number }>();
  return {
    lineCounts(mr) {
      let c = counts.get(mr);
      if (!c) {
        c = filteredLineCounts(mr, excludeRes);
        counts.set(mr, c);
      }
      return c;
    },
    isBot: (username) => isBotUsername(username, extraBots),
    hasTeamTicket: (mr) => !ticketRe || ticketRe.test(mrTicketHaystack(mr)),
  };
}

/**
 * True when a ticket's current state counts as "done". When doneStates is empty,
 * falls back to type-based default: issues whose stateType is "completed" or "canceled".
 */
export function isDoneState(stateType: string | null, stateName: string | null, doneStates?: string[]): boolean {
  if (stateType === null) return true; // missing data... fall open
  if (doneStates && doneStates.length > 0) {
    return stateName !== null && doneStates.includes(stateName);
  }
  return stateType === "completed" || stateType === "canceled";
}

/** True when a Linear identifier belongs to the configured team (no team = all match). */
export function matchesTeam(identifier: string, linearTeam?: string): boolean {
  return !linearTeam || identifier.toUpperCase().startsWith(linearTeam.toUpperCase() + "-");
}
```

- [ ] **Step 4: Remove the moved code from `snapshot.ts` and import it**

In `server/metrics/snapshot.ts`:
- Delete `buildIgnoredMrSet`, `filteredLineCounts`, `globToRegExp`, the `MetricFilters` interface, `buildMetricFilters`, `isDoneState`, and `matchesTeam` (lines 60-150 and 173-188 of the current file), plus the now-unused `changedLines` constant on line 58.
- Replace the import block at the top with:

```ts
import { inWindow } from "../util/window.js";
import { buildIgnoredMrSet, buildMetricFilters, isDoneState, matchesTeam, type MetricFilters } from "./filters.js";
import { buildRevertedTitleSet, isReverted } from "./reverts.js";
import { mean, percentile, round, streaks } from "./stats.js";
import type { FetchResult, NormMr } from "../pipeline/model.js";
import type { PipelineStatusBreakdown, TimeWindow } from "../../shared/types.js";
```

In `server/metrics/evidence.ts`, change line 10 to:

```ts
import { buildIgnoredMrSet, buildMetricFilters, isDoneState, matchesTeam } from "./filters.js";
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS. `test/slicing.test.ts` snapshots are byte-identical because nothing computed changed.

- [ ] **Step 6: Commit**

```bash
git add server/metrics/filters.ts server/metrics/snapshot.ts server/metrics/evidence.ts test/filters.test.ts
git commit -m "metrics: move filter builders to filters.ts"
```

---

### Task 3: One cohort module; the snapshot derives its numbers from it

**Files:**
- Create: `server/metrics/cohorts.ts`
- Modify: `server/metrics/snapshot.ts` (replace `computeSnapshot` internals and `computeUser`)
- Test: `test/cohorts.test.ts`, existing `test/metrics.test.ts`, `test/slicing.test.ts`

**Interfaces:**
- Consumes: everything in `server/metrics/filters.ts` (Task 2), `buildRevertedTitleSet`/`isReverted` from `reverts.ts`, `inWindow` from `server/util/window.ts`.
- Produces, from `server/metrics/cohorts.ts`:

```ts
export interface CohortOptions {
  window: TimeWindow;
  sizeBand: { tooSmall: number; tooLarge: number };
  linearTeam?: string;
  doneStates?: string[];
  extraBotPatterns?: string[];
  excludeFilePatterns?: string[];
  ignoredMrs?: string[];
}
export interface Corpus {
  mrs: NormMr[];
  pipelines: NormPipeline[];
  pushEvents: NormPushEvent[];
  linearIssues: NormLinearIssue[];
  approvalsAvailable: boolean;
  revertedTitles: Set<string>;
  filters: MetricFilters;
}
export function buildCorpus(fetched: FetchResult, opts: CohortOptions): Corpus;
export interface ReviewedMr { mr: NormMr; notes: NormNote[]; inlineCount: number; responseHours: number | null }
export interface WaitedMr { mr: NormMr; waitHours: number }
export interface IssueCohort { counted: NormLinearIssue[]; teamExcluded: number; stateExcluded: number }
export interface UserCohorts {
  authoredMerged: NormMr[];
  inBand: (mr: NormMr) => boolean;
  reverted: NormMr[];
  reviewed: ReviewedMr[];
  waited: WaitedMr[];
  reviewersOfMine: Map<string, number>;
  pipelines: NormPipeline[];
  pushTimestamps: string[];
  mergeTimestamps: string[];
  issues: IssueCohort;
}
export function buildUserCohorts(corpus: Corpus, u: string, opts: CohortOptions): UserCohorts;
```

  `SnapshotOptions` becomes `CohortOptions & { users: readonly string[] }` and is still exported from `snapshot.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/cohorts.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildCorpus, buildUserCohorts } from "../server/metrics/cohorts.js";
import { FETCH, WINDOW } from "./fixtures.js";

const OPTS = { window: WINDOW, sizeBand: { tooSmall: 10, tooLarge: 400 } };

describe("buildCorpus", () => {
  it("drops ignored MRs before anything else sees them", () => {
    const corpus = buildCorpus(FETCH, { ...OPTS, ignoredMrs: ["!1"] });
    expect(corpus.mrs.map((m) => m.iid)).toEqual([2, 3, 4]);
  });

  it("tolerates a fetch result with no linearIssues field", () => {
    const { linearIssues: _drop, ...legacy } = FETCH;
    const corpus = buildCorpus(legacy as typeof FETCH, OPTS);
    expect(corpus.linearIssues).toEqual([]);
  });
});

describe("buildUserCohorts for alice", () => {
  const corpus = buildCorpus(FETCH, OPTS);
  const c = buildUserCohorts(corpus, "alice", OPTS);

  it("authoredMerged is her two merged MRs; MR2 is out of the size band", () => {
    expect(c.authoredMerged.map((m) => m.iid)).toEqual([1, 2]);
    expect(c.authoredMerged.map(c.inBand)).toEqual([true, false]);
  });

  it("reverted is the subset later reverted by anyone", () => {
    expect(c.reverted.map((m) => m.iid)).toEqual([1]);
  });

  it("reviewed carries her notes, inline count, and first-response hours on MR3", () => {
    expect(c.reviewed).toHaveLength(1);
    const r = c.reviewed[0]!;
    expect(r.mr.iid).toBe(3);
    expect(r.notes).toHaveLength(3);
    expect(r.inlineCount).toBe(2);
    expect(r.responseHours).toBe(24);
  });

  it("waited is MR1 with the bot note ignored for first touch", () => {
    expect(c.waited.map((w) => [w.mr.iid, w.waitHours])).toEqual([[1, 26]]);
  });

  it("reviewersOfMine counts bob once for MR1 and excludes the bot", () => {
    expect([...c.reviewersOfMine.entries()]).toEqual([["bob", 1]]);
  });

  it("pipelines, pushes, merges, and issues are windowed and attributed", () => {
    expect(c.pipelines).toHaveLength(2);
    expect(c.pushTimestamps).toHaveLength(5);
    expect(c.mergeTimestamps).toEqual(["2026-05-10T00:00:00.000Z", "2026-05-11T00:00:00.000Z"]);
    expect(c.issues).toEqual({ counted: FETCH.linearIssues!.slice(0, 2), teamExcluded: 0, stateExcluded: 0 });
  });
});

describe("the Linear team gate", () => {
  it("removes merged MRs with no team ticket from authoredMerged", () => {
    const gated = buildCorpus(FETCH, { ...OPTS, linearTeam: "ENG" });
    const c = buildUserCohorts(gated, "alice", { ...OPTS, linearTeam: "ENG" });
    expect(c.authoredMerged).toEqual([]);
  });

  it("tallies issues excluded by team and by state", () => {
    const withNoise = {
      ...FETCH,
      linearIssues: [
        ...FETCH.linearIssues!,
        { ...FETCH.linearIssues![0]!, id: "PLA-9", identifier: "PLA-9" },
        { ...FETCH.linearIssues![0]!, id: "ENG-9", identifier: "ENG-9", stateType: "started", stateName: "In Progress" },
      ],
    };
    const opts = { ...OPTS, linearTeam: "ENG" };
    const c = buildUserCohorts(buildCorpus(withNoise, opts), "alice", opts);
    expect(c.issues.counted.map((i) => i.identifier)).toEqual(["ENG-1", "ENG-2"]);
    expect(c.issues.teamExcluded).toBe(1);
    expect(c.issues.stateExcluded).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- test/cohorts.test.ts`
Expected: FAIL with a module-not-found error for `../server/metrics/cohorts.js`.

- [ ] **Step 3: Create `server/metrics/cohorts.ts`**

```ts
import { inWindow } from "../util/window.js";
import { buildIgnoredMrSet, buildMetricFilters, isDoneState, matchesTeam, type MetricFilters } from "./filters.js";
import { buildRevertedTitleSet, isReverted } from "./reverts.js";
import type { FetchResult, NormLinearIssue, NormMr, NormNote, NormPipeline, NormPushEvent } from "../pipeline/model.js";
import type { TimeWindow } from "../../shared/types.js";

export interface CohortOptions {
  window: TimeWindow;
  sizeBand: { tooSmall: number; tooLarge: number };
  /** Linear team key. When set, only merged MRs referencing this team's tickets count. */
  linearTeam?: string;
  /** Linear state names that count as "done". Empty = default (completed + canceled types). */
  doneStates?: string[];
  /** Additional regex patterns for bot username detection, from settings. */
  extraBotPatterns?: string[];
  /** Glob patterns for files to exclude from additions/deletions. */
  excludeFilePatterns?: string[];
  /** MR identifiers to exclude from all metrics. Format: "!123" or "project/path!123". */
  ignoredMrs?: string[];
}

/** The fetch result with settings applied once: ignored MRs dropped, reverts and filters precomputed. */
export interface Corpus {
  mrs: NormMr[];
  pipelines: NormPipeline[];
  pushEvents: NormPushEvent[];
  linearIssues: NormLinearIssue[];
  approvalsAvailable: boolean;
  revertedTitles: Set<string>;
  filters: MetricFilters;
}

export function buildCorpus(fetched: FetchResult, opts: CohortOptions): Corpus {
  const isIgnored = buildIgnoredMrSet(opts.ignoredMrs);
  const mrs = fetched.mrs.filter((m) => !isIgnored(m));
  return {
    mrs,
    pipelines: fetched.pipelines,
    pushEvents: fetched.pushEvents,
    // Older cache envelopes predate the Linear field.
    linearIssues: fetched.linearIssues ?? [],
    approvalsAvailable: fetched.approvalsAvailable,
    revertedTitles: buildRevertedTitleSet(mrs),
    filters: buildMetricFilters(opts),
  };
}

/** A teammate's MR this user reviewed: their in-window notes, and their first response if any. */
export interface ReviewedMr {
  mr: NormMr;
  notes: NormNote[];
  inlineCount: number;
  /** Hours from the MR's clock start to the user's earliest note; null when they only approved. */
  responseHours: number | null;
}

/** One of this user's MRs that got a first human touch. */
export interface WaitedMr {
  mr: NormMr;
  waitHours: number;
}

export interface IssueCohort {
  counted: NormLinearIssue[];
  teamExcluded: number;
  stateExcluded: number;
}

/**
 * Every record set a metric is derived from, for one user, with all settings applied.
 * snapshot.ts turns these into numbers and evidence.ts into rows, so the two cannot drift.
 */
export interface UserCohorts {
  /** Authored, merged in window, and (when a Linear team is set) referencing a team ticket. */
  authoredMerged: NormMr[];
  inBand: (mr: NormMr) => boolean;
  /** The subset of authoredMerged that a later MR reverted. */
  reverted: NormMr[];
  reviewed: ReviewedMr[];
  waited: WaitedMr[];
  /** Reviewer username to the number of this user's merged MRs they touched. */
  reviewersOfMine: Map<string, number>;
  pipelines: NormPipeline[];
  pushTimestamps: string[];
  mergeTimestamps: string[];
  issues: IssueCohort;
}

const HOUR_MS = 60 * 60 * 1000;

const hoursFrom = (clockStartIso: string, toMs: number): number => (toMs - Date.parse(clockStartIso)) / HOUR_MS;

export function buildUserCohorts(corpus: Corpus, u: string, opts: CohortOptions): UserCohorts {
  const { window, sizeBand } = opts;
  const { mrs, filters: f } = corpus;

  const authoredMerged = mrs.filter(
    (m) => m.authorUsername === u && m.state === "merged" && f.hasTeamTicket(m) && inWindow(m.mergedAt, window),
  );

  const inBand = (m: NormMr): boolean => {
    const c = f.lineCounts(m);
    const changed = c.additions + c.deletions;
    return changed >= sizeBand.tooSmall && changed <= sizeBand.tooLarge;
  };

  const reverted = authoredMerged.filter((m) => isReverted(m, corpus.revertedTitles));

  const reviewed: ReviewedMr[] = [];
  for (const m of mrs) {
    if (m.authorUsername === u) continue;
    const notes = m.notes.filter((n) => n.authorUsername === u && !n.system && inWindow(n.createdAt, window));
    const approvedInScope =
      corpus.approvalsAvailable && m.approvedByUsernames.includes(u) && inWindow(m.mergedAt, window);
    if (notes.length === 0 && !approvedInScope) continue;

    let responseHours: number | null = null;
    if (notes.length > 0) {
      const earliest = Math.min(...notes.map((n) => Date.parse(n.createdAt)));
      const hours = hoursFrom(m.preparedAt ?? m.createdAt, earliest);
      if (hours >= 0) responseHours = hours;
    }
    reviewed.push({ mr: m, notes, inlineCount: notes.filter((n) => n.inline).length, responseHours });
  }

  const waited: WaitedMr[] = [];
  for (const m of mrs) {
    if (m.authorUsername !== u || !inWindow(m.createdAt, window)) continue;
    const firstTouch = m.notes
      .filter((n) => !n.system && n.authorUsername !== u && !f.isBot(n.authorUsername))
      .map((n) => Date.parse(n.createdAt))
      .sort((a, b) => a - b)[0];
    if (firstTouch === undefined) continue;
    const hours = hoursFrom(m.preparedAt ?? m.createdAt, firstTouch);
    if (hours >= 0) waited.push({ mr: m, waitHours: hours });
  }

  const reviewersOfMine = new Map<string, number>();
  for (const m of authoredMerged) {
    const seen = new Set<string>();
    for (const n of m.notes) {
      if (!n.system && n.authorUsername && n.authorUsername !== u && !f.isBot(n.authorUsername)) {
        seen.add(n.authorUsername);
      }
    }
    if (corpus.approvalsAvailable) {
      for (const a of m.approvedByUsernames) if (a !== u && !f.isBot(a)) seen.add(a);
    }
    for (const r of seen) reviewersOfMine.set(r, (reviewersOfMine.get(r) ?? 0) + 1);
  }

  const pipelines = corpus.pipelines.filter((p) => p.username === u && inWindow(p.createdAt, window));
  const pushTimestamps = corpus.pushEvents
    .filter((e) => e.username === u && inWindow(e.createdAt, window))
    .map((e) => e.createdAt);
  const mergeTimestamps = authoredMerged.map((m) => m.mergedAt ?? "").filter(Boolean);

  const issues: IssueCohort = { counted: [], teamExcluded: 0, stateExcluded: 0 };
  for (const i of corpus.linearIssues) {
    if (i.assignedUser !== u) continue;
    if (!matchesTeam(i.identifier, opts.linearTeam)) { issues.teamExcluded++; continue; }
    if (!isDoneState(i.stateType, i.stateName, opts.doneStates)) { issues.stateExcluded++; continue; }
    issues.counted.push(i);
  }

  return { authoredMerged, inBand, reverted, reviewed, waited, reviewersOfMine, pipelines, pushTimestamps, mergeTimestamps, issues };
}
```

- [ ] **Step 4: Run the cohort test**

Run: `bun run test -- test/cohorts.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `snapshot.ts` over the cohorts**

Replace the whole of `server/metrics/snapshot.ts` with:

```ts
import { buildCorpus, buildUserCohorts, type CohortOptions, type Corpus } from "./cohorts.js";
import { mean, percentile, round, streaks } from "./stats.js";
import type { FetchResult } from "../pipeline/model.js";
import type { PipelineStatusBreakdown } from "../../shared/types.js";

export interface RawDist {
  p50: number | null;
  p90: number | null;
}

/** Per-user metric values before trend deltas are applied. */
export interface RawUserMetrics {
  additions: number;
  deletions: number;
  mrsMerged: number;
  mrsReviewed: number;
  pipelines: number;
  pipelineStatus: PipelineStatusBreakdown;
  reviewDepth: number;
  reviewLatencyHours: RawDist;
  responseLatencyHours: RawDist;
  revertRate: number;
  revertedCount: number;
  sizeHealthPct: number;
  codingDays: number;
  currentStreak: number;
  longestStreak: number;
  reciprocity: number;
  issuesCompleted: number;
}

export interface Snapshot {
  byUser: Record<string, RawUserMetrics>;
  approvalsAvailable: boolean;
}

export interface SnapshotOptions extends CohortOptions {
  users: readonly string[];
}

/** Compute every metric for every configured user over one window. Pure. */
export function computeSnapshot(fetched: FetchResult, opts: SnapshotOptions): Snapshot {
  const corpus = buildCorpus(fetched, opts);
  const byUser: Record<string, RawUserMetrics> = {};
  for (const u of opts.users) {
    byUser[u] = computeUser(u, corpus, opts);
  }
  return { byUser, approvalsAvailable: corpus.approvalsAvailable };
}

function computeUser(u: string, corpus: Corpus, opts: CohortOptions): RawUserMetrics {
  const c = buildUserCohorts(corpus, u, opts);
  const lines = corpus.filters.lineCounts;

  // --- Volume: authored & merged in window (spec 4.1, 4.2) ---
  const mrsMerged = c.authoredMerged.length;
  const additions = sum(c.authoredMerged, (m) => lines(m).additions);
  const deletions = sum(c.authoredMerged, (m) => lines(m).deletions);

  // --- MR size health (spec 4.8): share in the healthy band ---
  const healthy = c.authoredMerged.filter(c.inBand).length;
  const sizeHealthPct = mrsMerged === 0 ? 0 : round(healthy / mrsMerged, 3);

  // --- Revert rate (spec 4.7) ---
  const revertedCount = c.reverted.length;
  const revertRate = mrsMerged === 0 ? 0 : round(revertedCount / mrsMerged, 3);

  // --- Pipelines (spec 4.4) ---
  const pipelineStatus: PipelineStatusBreakdown = { success: 0, failed: 0, canceled: 0, other: 0 };
  for (const p of c.pipelines) {
    if (p.status === "success") pipelineStatus.success++;
    else if (p.status === "failed") pipelineStatus.failed++;
    else if (p.status === "canceled") pipelineStatus.canceled++;
    else pipelineStatus.other++;
  }

  // --- Reviewed MRs + depth + reviewer-side response latency (spec 4.3, 4.5, 4.6) ---
  const mrsReviewed = c.reviewed.length;
  // Mean (not median) inline comments per reviewed MR: median collapses to 0 whenever
  // fewer than half of a reviewer's MRs have inline comments (the common case), which
  // makes it useless for discriminating reviewers. Mean keeps the signal.
  const reviewDepth = round(mean(c.reviewed.map((r) => r.inlineCount)), 2);
  const responseLatencies = c.reviewed.flatMap((r) => (r.responseHours === null ? [] : [r.responseHours]));

  // --- Author-side review latency (spec 4.6): how long the user's own MRs wait ---
  const authorLatencies = c.waited.map((w) => w.waitHours);

  // --- Reciprocity (spec 4.10): reviews given / reviews received ---
  const given = mrsReviewed;
  const received = c.reviewersOfMine.size;
  const reciprocity = received === 0 ? (given === 0 ? 0 : given) : round(given / received, 2);

  // --- Coding days are push-based; the streak is merge-based (spec 4.9) ---
  const codingDayStreaks = streaks(c.pushTimestamps);
  const mergeStreaks = streaks(c.mergeTimestamps);

  return {
    additions,
    deletions,
    mrsMerged,
    mrsReviewed,
    pipelines: c.pipelines.length,
    pipelineStatus,
    reviewDepth,
    reviewLatencyHours: dist(authorLatencies),
    responseLatencyHours: dist(responseLatencies),
    revertRate,
    revertedCount,
    sizeHealthPct,
    codingDays: codingDayStreaks.distinct,
    currentStreak: mergeStreaks.current,
    longestStreak: mergeStreaks.longest,
    reciprocity,
    issuesCompleted: c.issues.counted.length,
  };
}

function dist(samples: number[]): RawDist {
  const p50 = percentile(samples, 0.5);
  const p90 = percentile(samples, 0.9);
  return { p50: p50 === null ? null : round(p50, 2), p90: p90 === null ? null : round(p90, 2) };
}

function sum<T>(items: readonly T[], pick: (t: T) => number): number {
  let total = 0;
  for (const it of items) total += pick(it);
  return total;
}
```

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS, and the inline snapshots in `test/slicing.test.ts` are unchanged. `evidence.ts` still imports from `filters.ts` and compiles untouched. If a snapshot differs, diff the number against the old `computeUser` and fix the cohort, never the snapshot.

- [ ] **Step 7: Commit**

```bash
git add server/metrics/cohorts.ts server/metrics/snapshot.ts test/cohorts.test.ts
git commit -m "metrics: derive the snapshot from one cohort module"
```

---

### Task 4: Evidence derives its rows from the same cohorts (fixes the team-ticket divergence)

**Files:**
- Modify: `server/metrics/evidence.ts` (full rewrite of `buildUserEvidence`)
- Test: `test/parity.test.ts` (new), existing `test/evidence.test.ts`

**Interfaces:**
- Consumes: `buildCorpus`, `buildUserCohorts`, `CohortOptions` from Task 3; `mean`, `percentile`, `round`, `streaks` from `stats.ts`.
- Produces: `EvidenceContext extends CohortOptions { baseUrl: string }` and `buildUserEvidence(fetched: FetchResult, u: string, ctx: EvidenceContext): Partial<Record<MetricKey, MetricEvidence>>`, same signature as today. Row and summary text formats are unchanged.

- [ ] **Step 1: Write the failing parity test**

Create `test/parity.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildUserEvidence } from "../server/metrics/evidence.js";
import { computeSnapshot } from "../server/metrics/snapshot.js";
import type { FetchResult } from "../server/pipeline/model.js";
import { FETCH, USERS, WINDOW } from "./fixtures.js";

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };

// Only MR1 references an ENG ticket (through its source branch), so with a Linear team set
// the merged cohort shrinks and every merged-backed table must shrink with it.
const GATED: FetchResult = {
  ...FETCH,
  mrs: FETCH.mrs.map((m) => (m.iid === 1 ? { ...m, sourceBranch: "eng-1-add-feature-x" } : m)),
};

describe("snapshot and evidence agree when a Linear team gates the merged cohort", () => {
  const opts = { window: WINDOW, sizeBand: SIZE_BAND, linearTeam: "ENG" };
  const snap = computeSnapshot(GATED, { ...opts, users: USERS });

  it("the gate bites in this fixture", () => {
    expect(snap.byUser.alice!.mrsMerged).toBe(1);
    expect(snap.byUser.bob!.mrsMerged).toBe(0);
  });

  for (const u of USERS) {
    it(`${u}: every cohort-backed table has as many rows as the metric counts`, () => {
      const m = snap.byUser[u]!;
      const ev = buildUserEvidence(GATED, u, { ...opts, baseUrl: "https://gitlab.com" });
      expect(ev.mrsMerged!.rows.length).toBe(m.mrsMerged);
      expect(ev.additions!.rows.length).toBe(m.mrsMerged);
      expect(ev.sizeHealthPct!.rows.length).toBe(m.mrsMerged);
      expect(ev.revertedCount!.rows.filter((r) => !r.muted).length).toBe(m.revertedCount);
      expect(ev.mrsReviewed!.rows.length).toBe(m.mrsReviewed);
      expect(ev.pipelines!.rows.length).toBe(m.pipelines);
      expect(ev.codingDays!.rows.length).toBe(m.codingDays);
      expect(ev.issuesCompleted!.rows.length).toBe(m.issuesCompleted);
    });
  }

  it("the merged summary counts the gated cohort, not every merged MR", () => {
    const ev = buildUserEvidence(GATED, "alice", { ...opts, baseUrl: "https://gitlab.com" });
    expect(ev.mrsMerged!.summary).toBe("1 MRs merged");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- test/parity.test.ts`
Expected: FAIL on alice: `ev.mrsMerged.rows.length` is 2 while `m.mrsMerged` is 1.

- [ ] **Step 3: Rewrite `evidence.ts` over the cohorts**

Replace the whole of `server/metrics/evidence.ts` with:

```ts
/**
 * Per-stat evidence: the underlying records behind one person's value for each metric.
 * Pure. Rows come from the same cohorts snapshot.ts counts (test/parity.test.ts pins that),
 * and the output is render-agnostic (columns + rows + summary) so the UI renders every stat
 * with one component.
 */
import { buildCorpus, buildUserCohorts, type CohortOptions } from "./cohorts.js";
import { mean, percentile, round, streaks } from "./stats.js";
import type { FetchResult, NormMr } from "../pipeline/model.js";
import type { EvidenceRow, MetricEvidence, MetricKey } from "../../shared/types.js";

export interface EvidenceContext extends CohortOptions {
  baseUrl: string;
}

const MAX_ROWS = 300;

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");
const hrs = (n: number): string => `${round(n, 1)}h`;
const byIidDesc = (a: { mr: NormMr }, b: { mr: NormMr }): number => b.mr.iid - a.mr.iid;

/** Build every metric's evidence for one user. Metrics with no records are omitted. */
export function buildUserEvidence(
  fetched: FetchResult,
  u: string,
  ctx: EvidenceContext,
): Partial<Record<MetricKey, MetricEvidence>> {
  const { baseUrl, sizeBand } = ctx;
  const corpus = buildCorpus(fetched, ctx);
  const c = buildUserCohorts(corpus, u, ctx);
  const lines = corpus.filters.lineCounts;
  const mrUrl = (m: NormMr) => `${baseUrl}/${m.projectPath}/-/merge_requests/${m.iid}`;

  const out: Partial<Record<MetricKey, MetricEvidence>> = {};

  // Highest iid first so every MR-keyed table renders newest work at the top.
  const merged = [...c.authoredMerged].sort((a, b) => b.iid - a.iid);

  // additions / deletions / mrsMerged all share the merged-MR list.
  const mergedRows: EvidenceRow[] = merged.map((m) => {
    const f = lines(m);
    return {
      cells: [`!${m.iid}`, m.title, `+${f.additions}`, `−${f.deletions}`, day(m.mergedAt)],
      href: mrUrl(m),
    };
  });
  const mergedCols = ["MR", "Title", "Added", "Deleted", "Merged"];
  const totalAdd = merged.reduce((s, m) => s + lines(m).additions, 0);
  const totalDel = merged.reduce((s, m) => s + lines(m).deletions, 0);
  out.additions = { columns: mergedCols, rows: mergedRows, summary: `${totalAdd} lines added across ${merged.length} merged MRs` };
  out.deletions = { columns: mergedCols, rows: mergedRows, summary: `${totalDel} lines deleted across ${merged.length} merged MRs` };
  out.mrsMerged = { columns: mergedCols, rows: mergedRows, summary: `${merged.length} MRs merged` };

  out.sizeHealthPct = {
    columns: ["MR", "Title", "Changed", "In band?"],
    rows: merged.map((m) => {
      const f = lines(m);
      return {
        cells: [`!${m.iid}`, m.title, String(f.additions + f.deletions), c.inBand(m) ? "✓" : "✗"],
        href: mrUrl(m),
        muted: !c.inBand(m),
      };
    }),
    summary: `${merged.filter(c.inBand).length} of ${merged.length} MRs in the ${sizeBand.tooSmall}–${sizeBand.tooLarge} line band`,
  };

  const reverted = new Set(c.reverted);
  const revertEvidence: MetricEvidence = {
    columns: ["MR", "Title", "Merged", "Reverted?"],
    rows: merged.map((m) => ({
      cells: [`!${m.iid}`, m.title, day(m.mergedAt), reverted.has(m) ? "reverted" : "—"],
      href: mrUrl(m),
      muted: !reverted.has(m),
    })),
    summary: `${c.reverted.length} of ${merged.length} merged MRs later reverted`,
  };
  out.revertRate = revertEvidence;
  out.revertedCount = revertEvidence;

  // --- Reviewed teammates' MRs: depth + reviewer-side response latency ---
  const reviewed = [...c.reviewed].sort(byIidDesc);
  out.mrsReviewed = {
    columns: ["MR", "Author", "Title", "Comments", "Inline"],
    rows: reviewed.map((r) => ({
      cells: [`!${r.mr.iid}`, r.mr.authorUsername ?? "—", r.mr.title, String(r.notes.length), String(r.inlineCount)],
      href: mrUrl(r.mr),
    })),
    summary: `${reviewed.length} teammates' MRs reviewed`,
  };
  out.reviewDepth = {
    columns: ["MR", "Title", "Inline comments"],
    rows: reviewed.map((r) => ({ cells: [`!${r.mr.iid}`, r.mr.title, String(r.inlineCount)], href: mrUrl(r.mr) })),
    summary: `mean ${round(mean(reviewed.map((r) => r.inlineCount)), 2)} inline comments per reviewed MR`,
  };
  const responded = reviewed.flatMap((r) => (r.responseHours === null ? [] : [{ mr: r.mr, hours: r.responseHours }]));
  out.responseLatencyHours = {
    columns: ["MR", "Title", "Response"],
    rows: responded.map((r) => ({ cells: [`!${r.mr.iid}`, r.mr.title, hrs(r.hours)], href: mrUrl(r.mr) })),
    summary: distSummary(responded.map((r) => r.hours), "first response"),
  };

  // --- Author-side review latency: how long the user's own MRs waited ---
  const waited = [...c.waited].sort(byIidDesc);
  out.reviewLatencyHours = {
    columns: ["MR", "Title", "Wait"],
    rows: waited.map((w) => ({ cells: [`!${w.mr.iid}`, w.mr.title, hrs(w.waitHours)], href: mrUrl(w.mr) })),
    summary: distSummary(waited.map((w) => w.waitHours), "first review"),
  };

  // --- Reciprocity: who reviewed this user's merged MRs (received side) ---
  const given = reviewed.length;
  const received = c.reviewersOfMine.size;
  out.reciprocity = {
    columns: ["Reviewer", "Your MRs they reviewed"],
    rows: [...c.reviewersOfMine.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ cells: [name, String(n)] })),
    summary: `gave ${given} reviews, received from ${received} reviewer(s) ... ratio ${received === 0 ? given : round(given / received, 2)}`,
  };

  // --- Pipelines triggered ---
  const statusCount = c.pipelines.reduce<Record<string, number>>((acc, p) => ((acc[p.status] = (acc[p.status] ?? 0) + 1), acc), {});
  out.pipelines = {
    columns: ["Status", "Created"],
    rows: [...c.pipelines]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((p) => ({ cells: [p.status, day(p.createdAt)], muted: p.status !== "success" })),
    summary: Object.entries(statusCount).map(([s, n]) => `${n} ${s}`).join(" · ") || "no pipelines",
  };

  // --- Coding days: distinct days the user pushed to the tracked project ---
  const pushDays = new Map<string, number>();
  for (const ts of c.pushTimestamps) pushDays.set(day(ts), (pushDays.get(day(ts)) ?? 0) + 1);
  out.codingDays = {
    columns: ["Date", "Pushes"],
    rows: [...pushDays.entries()].sort().reverse().map(([d, n]) => ({ cells: [d, String(n)] })),
    summary: `${pushDays.size} distinct days with a push`,
  };

  // --- Merge streak: days the user merged at least one MR ---
  const mergeByDay = new Map<string, number>();
  for (const ts of c.mergeTimestamps) mergeByDay.set(day(ts), (mergeByDay.get(day(ts)) ?? 0) + 1);
  const ms = streaks(c.mergeTimestamps);
  const mergeDayEvidence: MetricEvidence = {
    columns: ["Date", "MRs merged"],
    rows: [...mergeByDay.entries()].sort().reverse().map(([d, n]) => ({ cells: [d, String(n)] })),
    summary: `longest run ${ms.longest} day(s), current ${ms.current}, across ${mergeByDay.size} merge day(s)`,
  };
  out.longestStreak = mergeDayEvidence;
  out.currentStreak = mergeDayEvidence;

  // --- Issues done (Linear): gated-out issues surface only as counts in the summary ---
  // Highest ticket number first, with numeric collation so ACME-2007 outranks ACME-938.
  const counted = [...c.issues.counted].sort((a, b) => b.identifier.localeCompare(a.identifier, undefined, { numeric: true }));
  const parts: string[] = [`${counted.length} counted`];
  if (c.issues.teamExcluded > 0) parts.push(`${c.issues.teamExcluded} excluded by team`);
  if (c.issues.stateExcluded > 0) parts.push(`${c.issues.stateExcluded} excluded by state`);
  out.issuesCompleted = {
    columns: ["Issue", "Title", "State", "MR(s)"],
    rows: counted.map((i) => ({
      cells: [i.identifier, i.title, i.stateName ?? i.stateType ?? "—", i.linkedMrs.map((m) => `!${m.iid}`).join(", ") || "—"],
      href: i.url,
    })),
    summary: parts.join(" · "),
  };

  // Bound any pathologically large evidence list so a response stays sane.
  for (const key of Object.keys(out) as MetricKey[]) {
    const ev = out[key]!;
    if (ev.rows.length > MAX_ROWS) {
      const extra = ev.rows.length - MAX_ROWS;
      ev.rows = ev.rows.slice(0, MAX_ROWS);
      ev.summary = `${ev.summary ?? ""} (showing first ${MAX_ROWS}, ${extra} more)`.trim();
    }
  }

  return out;
}

function distSummary(samples: number[], label: string): string {
  if (samples.length === 0) return `no ${label} samples`;
  const p50 = percentile(samples, 0.5);
  const p90 = percentile(samples, 0.9);
  return `p50 ${round(p50 ?? 0, 1)}h · p90 ${round(p90 ?? 0, 1)}h over ${samples.length} MR(s)`;
}
```

- [ ] **Step 4: Run the parity, evidence, and full suites, then typecheck**

Run: `bun run test -- test/parity.test.ts test/evidence.test.ts && bun run test && bun run typecheck`
Expected: PASS. `test/evidence.test.ts` still passes because row contents, ordering, and summary strings are unchanged for the ungated fixture; `test/detail-persist.test.ts` and `test/endpoints.test.ts` exercise `getUserDetail` end to end and must stay green.

- [ ] **Step 5: Commit**

```bash
git add server/metrics/evidence.ts test/parity.test.ts
git commit -m "metrics: build evidence from the shared cohorts so it honors the team-ticket gate"
```

---

### Task 5: The fetch pipeline stops depending on the metrics layer

**Files:**
- Create: `shared/reverts.ts`
- Modify: `server/metrics/reverts.ts:16-24`, `server/pipeline/model.ts` (append), `server/metrics/trend.ts:15-21`, `server/pipeline/fetch.ts:8,13`
- Test: `test/layering.test.ts` (new), `test/metrics.test.ts` (one added case)

**Interfaces:**
- Produces: `shared/reverts.ts` exporting `REVERT_TITLE_RE: RegExp` and `isRevertTitle(title: string): boolean`; `server/pipeline/model.ts` exporting `interface UserIdentity { username: string; name: string | null; resolved: boolean; userId?: number }`.
- `server/metrics/trend.ts` re-exports `UserIdentity` as a type so `BuildContext` and existing importers keep compiling.

- [ ] **Step 1: Write the failing tests**

Create `test/layering.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Ratchet: the fetch pipeline feeds the metrics layer, never the reverse. A pipeline
 * module importing from server/metrics would make an external data source impossible.
 */
describe("layering", () => {
  it("server/pipeline never imports server/metrics", () => {
    for (const file of readdirSync("server/pipeline")) {
      const src = readFileSync(`server/pipeline/${file}`, "utf8");
      expect(src, file).not.toMatch(/from "\.\.\/metrics\//);
    }
  });
});
```

Append to the `describe("revert detection", ...)` block in `test/metrics.test.ts`:

```ts
  it("isRevertTitle is the dependency-free title test the fetcher uses", () => {
    expect(isRevertTitle('Revert "Add feature X"')).toBe(true);
    expect(isRevertTitle("Add feature X")).toBe(false);
  });
```

and add `import { isRevertTitle } from "../shared/reverts.js";` to that file's imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test -- test/layering.test.ts test/metrics.test.ts`
Expected: FAIL. `layering` fails on `fetch.ts` (it imports `../metrics/reverts.js` and `../metrics/trend.js`); `metrics.test.ts` fails to resolve `../shared/reverts.js`.

- [ ] **Step 3: Create `shared/reverts.ts` and point `server/metrics/reverts.ts` at it**

Create `shared/reverts.ts`:

```ts
/** The auto-generated GitLab revert title, shared by the fetcher's cheap pre-test and the metric layer. */
export const REVERT_TITLE_RE = /^revert\s+"(.+)"\s*$/i;

/** Title-only test for raw list nodes, which carry no labels. */
export function isRevertTitle(title: string): boolean {
  return REVERT_TITLE_RE.test(title);
}
```

In `server/metrics/reverts.ts`, replace lines 16-24 (the `REVERT_TITLE_RE` constant, the `isRevertTitle` docblock, and the function) with a single import placed after the existing `import type { NormMr }` line:

```ts
import { REVERT_TITLE_RE } from "../../shared/reverts.js";
```

The rest of the file (`revertTarget`, `buildRevertedTitleSet`, `isReverted`, `normalizeTitle`) is unchanged and still uses `REVERT_TITLE_RE`.

- [ ] **Step 4: Move `UserIdentity` into the model**

Append to `server/pipeline/model.ts`:

```ts
/** A configured username resolved against the GitLab instance. */
export interface UserIdentity {
  username: string;
  name: string | null;
  resolved: boolean;
  /** GitLab numeric id, used internally for the per-user events endpoint. */
  userId?: number;
}
```

In `server/metrics/trend.ts`, delete the `export interface UserIdentity { ... }` block (lines 15-21) and add, next to the other imports:

```ts
import type { UserIdentity } from "../pipeline/model.js";
export type { UserIdentity };
```

In `server/pipeline/fetch.ts`, replace line 8 and line 13:

```ts
import { isRevertTitle } from "../../shared/reverts.js";
```

```ts
import type { FetchResult, NormMr, UserIdentity } from "./model.js";
```

and delete the now-duplicate `import type { FetchResult, NormMr } from "./model.js";` on line 14.

- [ ] **Step 5: Run the suite and typecheck**

Run: `bun run test && bun run typecheck`
Expected: PASS, including `test/layering.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add shared/reverts.ts server/metrics/reverts.ts server/pipeline/model.ts server/metrics/trend.ts server/pipeline/fetch.ts test/layering.test.ts test/metrics.test.ts
git commit -m "pipeline: stop importing the metrics layer; identity type lives in the model"
```

---

### Task 6: Warning codes become a literal union

**Files:**
- Modify: `shared/types.ts:103-106`
- Test: `bun run typecheck` is the test; every code literal in `server/` must be in the union.

**Interfaces:**
- Produces: `export type WarningCode = ...` and `LeaderboardWarning.code: WarningCode`. The JSON is unchanged.

- [ ] **Step 1: Narrow the type**

In `shared/types.ts`, replace:

```ts
export interface LeaderboardWarning {
  code: string;
  message: string;
}
```

with:

```ts
/** Every warning the pipeline can attach to a response. Adding a site means adding a code here. */
export type WarningCode =
  | "user_unresolved"
  | "user_lookup_failed"
  | "mr_fetch_failed"
  | "mr_detail_partial"
  | "projects_fetch_failed"
  | "project_id_failed"
  | "pipeline_fetch_failed"
  | "events_fetch_failed"
  | "linear_partial"
  | "trend_unavailable";

export interface LeaderboardWarning {
  code: WarningCode;
  message: string;
}
```

- [ ] **Step 2: Typecheck and test**

Run: `bun run typecheck && bun run test`
Expected: PASS. The ten literals above are the complete set in `server/` today (`grep -rhoE 'code: "[a-z_]+"' server` lists exactly them). If `tsc` names a site with another literal, add that literal to the union; never widen `code` back to `string`.

- [ ] **Step 3: Commit**

```bash
git add shared/types.ts
git commit -m "types: warning codes are a literal union"
```

---

### Task 7: Docs say mean, like the code

**Files:**
- Modify: `README.md:85`, `shared/types.ts:53`, `gitlab-leaderboard-spec.md` (section 4.5)

- [ ] **Step 1: Align the three doc sites**

`README.md`, the metrics table row for review depth becomes:

```markdown
| **Review depth** | mean inline (DiffNote) comments per reviewed MR | nitpick-spam (a per-MR mean, never a total; a median collapses to 0 for most reviewers) |
```

`shared/types.ts`, the comment above `reviewDepth: MetricValue;` becomes:

```ts
  /** Mean inline (DiffNote) comments per reviewed MR. */
```

`gitlab-leaderboard-spec.md`, section 4.5, after the bullet that begins `- Output per user: median DiffNotes per reviewed MR`, add:

```markdown
- **Implemented as the mean.** A median collapses to 0 whenever fewer than half a reviewer's
  MRs carry inline comments, which is the common case, so it cannot discriminate reviewers.
```

- [ ] **Step 2: Verify nothing else still says median for this metric**

Run: `grep -rn "median" README.md shared/ server/metrics/ | grep -iv "stats.ts\|collapses\|not median\|Implemented as the mean"`
Expected: no output.

- [ ] **Step 3: Run the suite once more and commit**

Run: `bun run test && bun run typecheck`
Expected: PASS.

```bash
git add README.md shared/types.ts gitlab-leaderboard-spec.md
git commit -m "docs: review depth is a mean"
```

---

## Done criteria

- `bun run test` and `bun run typecheck` pass on the branch.
- `test/parity.test.ts`, `test/cohorts.test.ts`, `test/filters.test.ts`, and `test/layering.test.ts` exist and pass.
- `git diff feat/mattstack-integration-spec -- test/slicing.test.ts` is empty.
- `server/metrics/snapshot.ts` and `server/metrics/evidence.ts` each import from `cohorts.ts` and contain no cohort-building loops of their own.
