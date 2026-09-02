# Glance Metric-Grade Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@mattstack/glance` the stateless, typed reads a metrics consumer needs (a cheap merge-request index with `mergedAt`, per-MR metric detail with paginated notes, group projects, project lookup, per-user pipelines, and user activity events), plus `mergedAt` and `labels` on `PullRequest`, so boxscore's data layer can be rebuilt on the SDK instead of its own GitLab client.

**Architecture:** Every new read is an optional `GitProvider` method paired with a `ProviderCapabilities` flag; `GitLabProvider` implements all six over its existing GraphQL runner and `restRequest`, `GitHubProvider` declares the flags false and implements nothing. New domain types live in `types.ts`, new option types in `GitProvider.ts`, and everything is re-exported from `index.ts`. The two `PullRequest` additions are optional fields, following the `isStacked` precedent, and both providers populate them.

**Tech Stack:** Bun, TypeScript (glance imports carry `.ts` suffixes and use single quotes), `bun:test` unit tests that stub `runQuery` or `globalThis.fetch`, no new dependencies. Package version moves 0.22.0 to 0.23.0.

**Spec:** `docs/superpowers/specs/2026-09-02-mattstack-integration-design.md` in the boxscore repo, section 6 (sub-project 3). Section 7 describes the consumer these reads serve. Live conformance entries are deferred per spec section 6.3; the unit tests here stub the transport.

## Global Constraints

- Work happens in the glance repo at `/Users/matt/Documents/GitHub/glance`, package `packages/glance`. Branch `feat/metrics-reads` from `main`, in a worktree at `.claude/worktrees/metrics-reads` (add `.claude/worktrees/` to the repo's `.gitignore` in a first commit on `main` if it is not ignored yet). All paths below are relative to `packages/glance` unless they start with `/`.
- Tests: `cd packages/glance && bun test` runs the unit suite (the live conformance suite is skipped without `GLANCE_LIVE=1`; never set it in this plan). Types: `bun run check-types`. Both must pass before every commit.
- Style: single quotes, 2-space indent, `import type` for types, relative imports with `.ts` suffixes (`from './types.ts'`), `private async` methods on the provider class, a `non-advancing cursor` guard on every paginated loop (the existing `fetchApprovalRules` shape).
- New `GitProvider` methods are optional (`name?(...)`), each paired with a boolean on `ProviderCapabilities` named `canFetch<Method>`. `GitHubProvider` sets every new flag to `false` and implements none of the methods. The `providerConformance.ts` guard already tolerates omitted optional methods.
- `PullRequest.mergedAt` and `PullRequest.labels` are optional fields (`mergedAt?: string | null`, `labels?: string[]`), so no consumer that constructs a `PullRequest` literal breaks. Both providers populate them.
- No existing export changes shape. No existing test is edited. The `build` script's explicit entry list is unchanged because no new source files are created.
- Comments state constraints the code cannot show; never narrate the next line or the change. No em dashes anywhere (use "..." or rephrase).
- One commit per task, messages in the repo's `glance: <what>` style. The final task bumps the version and writes the changelog entry; publishing to npm is Matt's step and is not part of this plan.

---

### Task 1: `PullRequest` gains `mergedAt` and `labels` on both providers

**Files:**
- Modify: `src/types.ts` (the `PullRequest` interface)
- Modify: `src/GitLabProvider.ts` (`MR_DASHBOARD_FRAGMENT`, `MR_LIST_FRAGMENT`, `interface GQLMR`, `toMR`)
- Modify: `src/GitHubProvider.ts` (`toPullRequest`)
- Test: `tests/pr-merged-at-labels.test.ts`

**Interfaces:**
- Produces: `PullRequest.mergedAt?: string | null` and `PullRequest.labels?: string[]`, populated by `GitLabProvider` (every fetch path that uses either fragment) and by `GitHubProvider.toPullRequest`.

- [ ] **Step 1: Write the failing test**

Create `tests/pr-merged-at-labels.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * PullRequest.mergedAt and PullRequest.labels: both providers populate them,
 * so a consumer windowing on merge time or reading labels needs no second
 * fetch. Optional on the type because older SDK builds never set them.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider, MR_DASHBOARD_FRAGMENT, MR_LIST_FRAGMENT } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';

function gitlabNode(over: Record<string, unknown> = {}) {
  const user = { id: 'gid://gitlab/User/1', username: 'ada', name: 'Ada', avatarUrl: null };
  return {
    id: 'gid://gitlab/MergeRequest/7',
    iid: '7',
    projectId: 42,
    title: 'Add feature',
    description: null,
    state: 'merged',
    draft: false,
    conflicts: false,
    detailedMergeStatus: 'MERGEABLE',
    webUrl: 'https://gitlab.example/g/p/-/merge_requests/7',
    sourceBranch: 'feat',
    targetBranch: 'main',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
    diffHeadSha: 'abc',
    author: user,
    assignees: { nodes: [] },
    reviewers: { nodes: [] },
    approvedBy: { nodes: [] },
    headPipeline: null,
    mergeabilityChecks: [],
    targetProject: { repository: { rootRef: 'main' } },
    ...over,
  };
}

describe('GitLab PullRequest.mergedAt and labels', () => {
  test('maps mergedAt and label titles from the fragment', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      project: {
        mergeRequests: {
          nodes: [gitlabNode({ mergedAt: '2026-08-02T10:00:00Z', labels: { nodes: [{ title: 'bug' }, { title: 'backend' }] } })],
        },
      },
    });
    const [pr] = await p.fetchPullRequests({ projectPath: 'g/p', iids: [7], state: 'merged' });
    expect(pr!.mergedAt).toBe('2026-08-02T10:00:00Z');
    expect(pr!.labels).toEqual(['bug', 'backend']);
  });

  test('an open MR has a null mergedAt and no labels', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      project: { mergeRequests: { nodes: [gitlabNode({ state: 'opened', mergedAt: null, labels: { nodes: [] } })] } },
    });
    const [pr] = await p.fetchPullRequests({ projectPath: 'g/p', iids: [7], state: 'opened' });
    expect(pr!.mergedAt).toBeNull();
    expect(pr!.labels).toEqual([]);
  });

  test('both fragments request both fields', () => {
    for (const fragment of [MR_DASHBOARD_FRAGMENT, MR_LIST_FRAGMENT]) {
      expect(fragment).toContain('mergedAt');
      expect(fragment).toContain('labels(first: 50) { nodes { title } }');
    }
  });
});

describe('GitHub PullRequest.mergedAt and labels', () => {
  test('maps merged_at and label names in toPullRequest', () => {
    const p = new GitHubProvider('https://github.com', 't');
    const user = { id: 3, login: 'ada', avatar_url: null, name: 'Ada' };
    const raw = {
      number: 7,
      id: 700,
      node_id: 'PR_700',
      title: 'Add feature',
      body: null,
      merged_at: '2026-08-02T10:00:00Z',
      html_url: 'https://github.com/o/r/pull/7',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-03T00:00:00Z',
      state: 'closed',
      draft: false,
      head: { sha: 'abc', ref: 'feat', repo: { full_name: 'o/r' } },
      base: { ref: 'main', repo: { full_name: 'o/r', default_branch: 'main', id: 9 } },
      user,
      assignees: [],
      requested_reviewers: [],
      labels: [{ id: 1, name: 'bug', color: 'f00' }],
    };
    const pr = (p as any).toPullRequest(raw, ['author'], [], [], null);
    expect(pr.mergedAt).toBe('2026-08-02T10:00:00Z');
    expect(pr.labels).toEqual(['bug']);
  });
});
```

If `toPullRequest` reads a field the `raw` literal lacks and throws, add that field to the literal with a neutral value (`null`, `[]`, or `false`); do not change `toPullRequest` to tolerate it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/pr-merged-at-labels.test.ts`
Expected: FAIL. `pr.mergedAt` is `undefined` on both providers, and the fragment assertion fails on `mergedAt`.

- [ ] **Step 3: Add the fields to the type**

In `src/types.ts`, inside `export interface PullRequest`, directly after `updatedAt: string | null;`:

```ts
  /**
   * When the MR merged; null while it is open or closed unmerged. Absent on a
   * PullRequest built by an SDK version before 0.23.0, populated by both
   * providers from then on.
   */
  mergedAt?: string | null;
  /** Label names as the forge shows them. Absent before 0.23.0, populated by both providers from then on. */
  labels?: string[];
```

- [ ] **Step 4: Fetch and map the fields on GitLab**

In `src/GitLabProvider.ts`:

In both `MR_DASHBOARD_FRAGMENT` and `MR_LIST_FRAGMENT`, replace the line `    updatedAt createdAt` with:

```
    updatedAt createdAt mergedAt
    labels(first: 50) { nodes { title } }
```

In `interface GQLMR`, after `createdAt: string;` add:

```ts
  mergedAt?: string | null;
  labels?: { nodes: Array<{ title: string }> } | null;
```

In `toMR`, after `updatedAt: gql.updatedAt,` add:

```ts
    mergedAt: gql.mergedAt ?? null,
    labels: (gql.labels?.nodes ?? []).map((l) => l.title),
```

- [ ] **Step 5: Map the fields on GitHub**

In `src/GitHubProvider.ts`, inside `toPullRequest`'s returned object, after `updatedAt: pr.updated_at,` add:

```ts
      mergedAt: pr.merged_at ?? null,
      labels: pr.labels.map((l) => l.name),
```

- [ ] **Step 6: Run the test, the suite, and the types**

Run: `cd packages/glance && bun test tests/pr-merged-at-labels.test.ts && bun test && bun run check-types`
Expected: PASS. Existing tests that build `PullRequest` literals compile unchanged because the fields are optional.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/GitLabProvider.ts src/GitHubProvider.ts tests/pr-merged-at-labels.test.ts
git commit -m "glance: PullRequest carries mergedAt and labels on both providers"
```

---

### Task 2: Types, options, optional interface methods, capability flags, exports

**Files:**
- Modify: `src/types.ts` (new domain types; `ProviderCapabilities`)
- Modify: `src/GitProvider.ts` (option types; optional methods on `GitProvider`; type imports)
- Modify: `src/GitLabProvider.ts` (`capabilities` literal)
- Modify: `src/GitHubProvider.ts` (`capabilities` literal)
- Modify: `src/index.ts` (exports)
- Test: `tests/metrics-reads-capabilities.test.ts`

**Interfaces:**
- Produces, from `types.ts`: `MergeRequestIndexRow`, `MetricsNote`, `MergeRequestMetrics`, `ProjectRef`, `PipelineSummary`, `UserEvent`, and six new booleans on `ProviderCapabilities`: `canFetchMergeRequestIndex`, `canFetchMergeRequestMetrics`, `canFetchGroupProjects`, `canFetchProject`, `canFetchProjectPipelines`, `canFetchUserEvents`.
- Produces, from `GitProvider.ts`: `FetchMergeRequestIndexOptions`, `FetchProjectPipelinesOptions`, `FetchUserEventsOptions`, and six optional methods with the exact signatures below. Tasks 3 to 5 implement them on GitLab and flip the matching flag to `true`; in this task both providers declare all six `false`.

- [ ] **Step 1: Write the failing test**

Create `tests/metrics-reads-capabilities.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * The metric-grade reads are optional interface methods, each behind a
 * capability flag. A consumer feature-detects on the flag, never on the
 * method's presence, so both providers must declare every flag.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const FLAGS = [
  'canFetchMergeRequestIndex',
  'canFetchMergeRequestMetrics',
  'canFetchGroupProjects',
  'canFetchProject',
  'canFetchProjectPipelines',
  'canFetchUserEvents',
] as const;

describe('metric-grade read capability flags', () => {
  test('both providers declare every flag as a boolean', () => {
    const gl = new GitLabProvider('https://gitlab.example', 't');
    const gh = new GitHubProvider('https://github.com', 't');
    for (const flag of FLAGS) {
      expect(typeof gl.capabilities[flag], flag).toBe('boolean');
      expect(typeof gh.capabilities[flag], flag).toBe('boolean');
    }
  });

  test('GitHub implements none of the reads', () => {
    const gh = new GitHubProvider('https://github.com', 't');
    for (const flag of FLAGS) expect(gh.capabilities[flag], flag).toBe(false);
    expect((gh as any).fetchMergeRequestIndex).toBeUndefined();
    expect((gh as any).fetchUserEvents).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/metrics-reads-capabilities.test.ts`
Expected: FAIL with `typeof ... toBe('boolean')` receiving `"undefined"` (the type error from `check-types` would also name the missing flags).

- [ ] **Step 3: Add the domain types**

In `src/types.ts`, after the `ProviderCapabilities` interface's closing brace, add:

```ts
// ── Metric-grade reads ────────────────────────────────────────────────────────

/**
 * One merge request as a metrics index sees it: cheap scalar fields only,
 * none of the dashboard resolvers. A consumer keeps its own history from
 * these rows and fetches `MergeRequestMetrics` for the ones it scores.
 */
export interface MergeRequestIndexRow {
  iid: number;
  /** "group/project", so a group-scoped index still names each MR's project. */
  projectPath: string;
  title: string;
  /** The forge's lifecycle state, lowercased: "opened" | "merged" | "closed" | "locked". */
  state: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  /** Null when the author's account is gone. */
  authorUsername: string | null;
  sourceBranch: string;
  labels: string[];
}

/** A note as review metrics read it: who, when, whether the forge wrote it, whether it sits on a diff line. */
export interface MetricsNote {
  authorUsername: string | null;
  createdAt: string;
  system: boolean;
  /** Anchored to a diff line (GitLab's DiffNote), as opposed to a general comment. */
  inline: boolean;
}

/** Everything one MR contributes to volume and quality metrics. */
export interface MergeRequestMetrics {
  iid: number;
  projectPath: string;
  description: string | null;
  diffStats: DiffStats | null;
  /** Per-file line counts, so a consumer can exclude generated files. */
  fileStats: Array<{ path: string; additions: number; deletions: number }>;
  labels: string[];
  approvedByUsernames: string[];
  /** Every note on the MR, paginated to exhaustion. */
  notes: MetricsNote[];
}

/** A project resolved by path. */
export interface ProjectRef {
  /** Scoped provider ID, the same value `PullRequest.repositoryId` carries, e.g. "gitlab:42". */
  id: string;
  fullPath: string;
}

/** One pipeline as a per-user pipeline count reads it; no jobs. */
export interface PipelineSummary {
  /** Scoped provider ID, e.g. "gitlab:pipeline:12345". */
  id: string;
  /** The forge's status, lowercased. */
  status: string;
  createdAt: string | null;
  /** The user the caller filtered by, or null for an unfiltered listing. */
  username: string | null;
}

/** One entry of a user's activity feed. */
export interface UserEvent {
  /** The forge's action name, e.g. "pushed to". */
  action: string;
  createdAt: string;
  /** Scoped repository ID the event happened in, e.g. "gitlab:42", or null when the feed omits it. */
  repositoryId: string | null;
}
```

Inside `export interface ProviderCapabilities`, after `canWatchEvents: boolean;` add:

```ts
  /** Can list merge requests across a group or project set with `fetchMergeRequestIndex`. */
  canFetchMergeRequestIndex: boolean;
  /** Can read one MR's metric-grade detail with `fetchMergeRequestMetrics`. */
  canFetchMergeRequestMetrics: boolean;
  /** Can enumerate a group's projects with `fetchGroupProjects`. */
  canFetchGroupProjects: boolean;
  /** Can resolve a project path with `fetchProject`. */
  canFetchProject: boolean;
  /** Can list a project's pipelines by user and window with `fetchProjectPipelines`. */
  canFetchProjectPipelines: boolean;
  /** Can read a user's activity feed with `fetchUserEvents`. */
  canFetchUserEvents: boolean;
```

- [ ] **Step 4: Add the option types and optional methods**

In `src/GitProvider.ts`, extend the `import type { ... } from './types.ts'` list with `MergeRequestIndexRow`, `MergeRequestMetrics`, `PipelineSummary`, `ProjectRef`, `UserEvent` (alphabetical among the existing names).

After the `parseUpdatedAfter` function, add:

```ts
/** Options for `fetchMergeRequestIndex`. Exactly one of `groupPath` or `projectPaths`. */
export interface FetchMergeRequestIndexOptions {
  /** A group, including its subgroups. */
  groupPath?: string;
  /** Explicit "group/project" paths. */
  projectPaths?: string[];
  /**
   * Only MRs updated at/after this ISO-8601 instant. Required: an index with
   * no lower bound walks the project's whole history.
   */
  updatedAfter: string;
  /** Any state when omitted. */
  states?: MRState[];
  /** Called after each page with the rows collected so far. */
  onPage?: (rowsSoFar: number) => void;
}

/** Options for `fetchProjectPipelines`. */
export interface FetchProjectPipelinesOptions {
  /** Only pipelines triggered by this username. */
  username?: string;
  /** ISO-8601 instants; GitLab applies both to the pipeline's `updated_at`. */
  updatedAfter: string;
  updatedBefore: string;
}

/** Options for `fetchUserEvents`. */
export interface FetchUserEventsOptions {
  /** The forge's action filter, e.g. "pushed". */
  action: string;
  /**
   * Calendar dates (YYYY-MM-DD). GitLab treats both as exclusive, so a caller
   * wanting the days D1..D2 inclusive passes the day before D1 and the day
   * after D2.
   */
  after: string;
  before: string;
}
```

Inside `export interface GitProvider`, directly after the `fetchMRDiscussions` declaration and before the `// ── Mutation capabilities` comment, add:

```ts
  // ── Metric-grade reads (optional; check the matching capability flag) ───

  /**
   * Cheap index of merge requests across a group (with subgroups) or a set
   * of projects, bounded by `updatedAfter`. Scalar fields only: this is the
   * list a metrics consumer keeps history from, and it is what GitLab's
   * resolvers can page through without timing out on a busy monorepo.
   * Check `capabilities.canFetchMergeRequestIndex`.
   */
  fetchMergeRequestIndex?(options: FetchMergeRequestIndexOptions): Promise<MergeRequestIndexRow[]>;

  /**
   * One MR's metric-grade detail: description, summary and per-file diff
   * stats, labels, approver usernames, and every note (paginated to
   * exhaustion) with its author, time, system flag, and whether it sits on
   * a diff line. Null when the project or MR does not exist.
   * Check `capabilities.canFetchMergeRequestMetrics`.
   */
  fetchMergeRequestMetrics?(projectPath: string, mrIid: number): Promise<MergeRequestMetrics | null>;

  /** Full paths of a group's projects, subgroups included. Check `capabilities.canFetchGroupProjects`. */
  fetchGroupProjects?(groupPath: string): Promise<string[]>;

  /** Resolve a "group/project" path, or null when it does not exist. Check `capabilities.canFetchProject`. */
  fetchProject?(projectPath: string): Promise<ProjectRef | null>;

  /**
   * A project's pipelines inside a window, optionally for one user.
   * Check `capabilities.canFetchProjectPipelines`.
   */
  fetchProjectPipelines?(projectPath: string, options: FetchProjectPipelinesOptions): Promise<PipelineSummary[]>;

  /**
   * A user's activity feed for one action between two dates. `userId` is
   * the scoped id `UserRef.id` carries (`fetchUser` returns it).
   * Check `capabilities.canFetchUserEvents`.
   */
  fetchUserEvents?(userId: string, options: FetchUserEventsOptions): Promise<UserEvent[]>;
```

- [ ] **Step 5: Declare the flags on both providers**

In `src/GitLabProvider.ts`, inside `readonly capabilities: ProviderCapabilities = { ... }`, after `canWatchEvents: true,` add:

```ts
    canFetchMergeRequestIndex: false,
    canFetchMergeRequestMetrics: false,
    canFetchGroupProjects: false,
    canFetchProject: false,
    canFetchProjectPipelines: false,
    canFetchUserEvents: false,
```

In `src/GitHubProvider.ts`, inside its `capabilities` literal, after the `canWatchEvents: true` entry (add a trailing comma to it), add:

```ts
    canFetchMergeRequestIndex: false,
    canFetchMergeRequestMetrics: false,
    canFetchGroupProjects: false,
    canFetchProject: false,
    canFetchProjectPipelines: false,
    canFetchUserEvents: false
```

- [ ] **Step 6: Export the new types**

In `src/index.ts`, extend the `export type { ... } from './types.ts'` block with `MergeRequestIndexRow`, `MetricsNote`, `MergeRequestMetrics`, `ProjectRef`, `PipelineSummary`, `UserEvent`, and extend the `export type { GitProvider, FetchPullRequestsOptions, FetchPullRequestsWarning } from './GitProvider.ts'` block with `FetchMergeRequestIndexOptions`, `FetchProjectPipelinesOptions`, `FetchUserEventsOptions`.

- [ ] **Step 7: Run the test, the suite, and the types**

Run: `cd packages/glance && bun test tests/metrics-reads-capabilities.test.ts && bun test && bun run check-types`
Expected: PASS. If `check-types` names a test fixture that builds a `ProviderCapabilities` literal without the new flags, add the six flags as `false` to that fixture.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/GitProvider.ts src/GitLabProvider.ts src/GitHubProvider.ts src/index.ts tests/metrics-reads-capabilities.test.ts
git commit -m "glance: declare the metric-grade reads, their types, and capability flags"
```

---

### Task 3: GitLab `fetchMergeRequestIndex`

**Files:**
- Modify: `src/GitLabProvider.ts` (queries, response types, the method, `canFetchMergeRequestIndex: true`)
- Test: `tests/gitlab-mr-index.test.ts`

**Interfaces:**
- Consumes: `FetchMergeRequestIndexOptions`, `MRState`, `parseUpdatedAfter` from `./GitProvider.ts`; `MergeRequestIndexRow` from `./types.ts`; the private `runQuery`.
- Produces: `GitLabProvider.fetchMergeRequestIndex(options): Promise<MergeRequestIndexRow[]>`.

- [ ] **Step 1: Write the failing test**

Create `tests/gitlab-mr-index.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * fetchMergeRequestIndex: scalar-only MR rows across a group (subgroups
 * included) or a set of projects, bounded by updatedAfter, 100 per page,
 * paginated to exhaustion per scope.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

interface Call { op: string; query: string; vars: Record<string, unknown> }

function node(iid: number, over: Record<string, unknown> = {}) {
  return {
    iid: String(iid),
    title: `MR ${iid}`,
    state: 'merged',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
    mergedAt: '2026-08-02T00:00:00Z',
    sourceBranch: `feat-${iid}`,
    author: { username: 'ada' },
    project: { fullPath: 'g/p' },
    labels: { nodes: [{ title: 'bug' }] },
    ...over,
  };
}

/**
 * Serves one response per call under the root the query names ("group" or
 * "project") and records every call. With `paged`, each response but the
 * last points at the next; without it every response is a final page.
 */
function stubPages(provider: GitLabProvider, pages: Array<ReturnType<typeof node>[]>, paged = true): Call[] {
  const calls: Call[] = [];
  (provider as any).runQuery = async (op: string, query: string, vars: Record<string, unknown>) => {
    calls.push({ op, query, vars });
    const idx = calls.length - 1;
    const hasNextPage = paged && idx < pages.length - 1;
    const root = query.includes('group(fullPath') ? 'group' : 'project';
    return {
      [root]: {
        mergeRequests: {
          pageInfo: { hasNextPage, endCursor: hasNextPage ? `c${idx}` : null },
          nodes: pages[idx] ?? [],
        },
      },
    };
  };
  return calls;
}

const UA = '2026-08-01T00:00:00Z';

describe('GitLabProvider.fetchMergeRequestIndex', () => {
  test('group mode walks subgroups, pages to exhaustion, and maps rows', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubPages(p, [[node(1), node(2)], [node(3, { state: 'opened', mergedAt: null, author: null })]]);
    const seen: number[] = [];
    const rows = await p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA, onPage: (n) => seen.push(n) });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.op).toBe('fetchMergeRequestIndex');
    expect(calls[0]!.query).toContain('includeSubgroups: true');
    expect(calls[0]!.vars).toEqual({ fullPath: 'g', ua: UA, after: null });
    expect(calls[1]!.vars.after).toBe('c0');
    expect(seen).toEqual([2, 3]);
    expect(rows[0]).toEqual({
      iid: 1, projectPath: 'g/p', title: 'MR 1', state: 'merged',
      createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z', mergedAt: '2026-08-02T00:00:00Z',
      authorUsername: 'ada', sourceBranch: 'feat-1', labels: ['bug'],
    });
    expect(rows[2]).toMatchObject({ iid: 3, state: 'opened', mergedAt: null, authorUsername: null });
  });

  test('project mode queries each project in turn and never sends includeSubgroups', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubPages(p, [[node(1)], [node(9, { project: { fullPath: 'g/q' } })]], false);
    const rows = await p.fetchMergeRequestIndex({ projectPaths: ['g/p', 'g/q'], updatedAfter: UA });
    expect(calls.map((c) => c.vars.fullPath)).toEqual(['g/p', 'g/q']);
    expect(calls[0]!.query).not.toContain('includeSubgroups');
    expect(rows.map((r) => r.projectPath)).toEqual(['g/p', 'g/q']);
  });

  test('one state is sent to the API; several are filtered here with no state variable', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const page = [node(1, { state: 'merged' }), node(2, { state: 'closed' }), node(3, { state: 'opened' })];
    const calls = stubPages(p, [page, page], false);
    const one = await p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA, states: ['merged'] });
    expect(calls[0]!.vars.state).toBe('merged');
    expect(calls[0]!.query).toContain('$state: MergeRequestState');
    expect(one).toHaveLength(3);
    const many = await p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA, states: ['merged', 'opened'] });
    expect(calls[1]!.vars).not.toHaveProperty('state');
    expect(calls[1]!.query).not.toContain('$state');
    expect(many.map((r) => r.iid)).toEqual([1, 3]);
  });

  test('refuses both or neither scope, and an unparseable updatedAfter', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubPages(p, [[]]);
    await expect(p.fetchMergeRequestIndex({ updatedAfter: UA } as any)).rejects.toThrow('exactly one of groupPath or projectPaths');
    await expect(p.fetchMergeRequestIndex({ groupPath: 'g', projectPaths: ['g/p'], updatedAfter: UA })).rejects.toThrow('exactly one of groupPath or projectPaths');
    await expect(p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: 'yesterday' })).rejects.toThrow('ISO-8601');
  });

  test('a cursor that does not advance throws instead of looping', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    (p as any).runQuery = async () => ({
      group: { mergeRequests: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [node(1)] } },
    });
    await expect(p.fetchMergeRequestIndex({ groupPath: 'g', updatedAfter: UA })).rejects.toThrow('non-advancing cursor');
  });

  test('the capability flag is on', () => {
    expect(new GitLabProvider('https://gitlab.example', 't').capabilities.canFetchMergeRequestIndex).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gitlab-mr-index.test.ts`
Expected: FAIL with `p.fetchMergeRequestIndex is not a function`.

- [ ] **Step 3: Add the query builder and response types**

In `src/GitLabProvider.ts`, after the `CodeownersBlobsResponse` interface (the last top-level query/response block before `export class GitLabProvider`), add:

```ts
const MR_INDEX_FIELDS = `
  iid title state createdAt updatedAt mergedAt sourceBranch
  author { username }
  project { fullPath }
  labels(first: 50) { nodes { title } }
`;

/**
 * The index query for one root. Built rather than written four times: group
 * and project roots differ only in `includeSubgroups`, and GitLab reads a
 * null `state` argument as a filter, so a request for several states must
 * omit the variable entirely.
 */
function mrIndexQuery(root: 'group' | 'project', withState: boolean): string {
  const scopeArg = root === 'group' ? 'includeSubgroups: true, ' : '';
  const stateVar = withState ? ', $state: MergeRequestState' : '';
  const stateArg = withState ? 'state: $state, ' : '';
  return `
    query GlanceMRIndex($fullPath: ID!, $ua: Time!, $after: String${stateVar}) {
      ${root}(fullPath: $fullPath) {
        mergeRequests(${scopeArg}${stateArg}updatedAfter: $ua, sort: UPDATED_DESC, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${MR_INDEX_FIELDS} }
        }
      }
    }
  `;
}

interface GQLIndexNode {
  iid: string;
  title: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  sourceBranch: string;
  author: { username: string } | null;
  project: { fullPath: string };
  labels: { nodes: Array<{ title: string }> } | null;
}

interface MRIndexConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: GQLIndexNode[];
}

interface MRIndexResponse {
  group?: { mergeRequests: MRIndexConnection } | null;
  project?: { mergeRequests: MRIndexConnection } | null;
}

function toIndexRow(n: GQLIndexNode): MergeRequestIndexRow {
  return {
    iid: parseInt(n.iid, 10),
    projectPath: n.project.fullPath,
    title: n.title,
    state: n.state.toLowerCase(),
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    mergedAt: n.mergedAt ?? null,
    authorUsername: n.author?.username ?? null,
    sourceBranch: n.sourceBranch,
    labels: (n.labels?.nodes ?? []).map((l) => l.title),
  };
}
```

Add `MergeRequestIndexRow` to the file's `import type { ... } from './types.ts'` list and `FetchMergeRequestIndexOptions` to its `import ... from './GitProvider.ts'` type imports.

- [ ] **Step 4: Add the method**

In `class GitLabProvider`, directly after `fetchCodeownerSections`, add:

```ts
  async fetchMergeRequestIndex(options: FetchMergeRequestIndexOptions): Promise<MergeRequestIndexRow[]> {
    const hasGroup = options.groupPath !== undefined;
    const hasProjects = options.projectPaths !== undefined;
    if (hasGroup === hasProjects) {
      throw new Error('fetchMergeRequestIndex: pass exactly one of groupPath or projectPaths');
    }
    parseUpdatedAfter(options.updatedAfter);

    const states = options.states ?? [];
    const apiState = states.length === 1 ? states[0]! : null;
    const filterSet = states.length > 1 ? new Set<string>(states) : null;
    const scopes: Array<{ root: 'group' | 'project'; fullPath: string }> = hasGroup
      ? [{ root: 'group', fullPath: options.groupPath! }]
      : options.projectPaths!.map((fullPath) => ({ root: 'project' as const, fullPath }));

    const out: MergeRequestIndexRow[] = [];
    for (const scope of scopes) {
      const query = mrIndexQuery(scope.root, apiState !== null);
      let after: string | null = null;
      do {
        const vars: Record<string, unknown> = { fullPath: scope.fullPath, ua: options.updatedAfter, after };
        if (apiState !== null) vars.state = apiState;
        const resp: MRIndexResponse = await this.runQuery<MRIndexResponse>('fetchMergeRequestIndex', query, vars);
        const conn = resp[scope.root]?.mergeRequests;
        for (const n of conn?.nodes ?? []) {
          const row = toIndexRow(n);
          if (filterSet && !filterSet.has(row.state)) continue;
          out.push(row);
        }
        options.onPage?.(out.length);
        const next = conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor ?? null) : null;
        if (conn?.pageInfo?.hasNextPage && (next === null || next === after)) {
          throw new Error(`fetchMergeRequestIndex: non-advancing cursor '${next}' for ${scope.fullPath}`);
        }
        after = next;
      } while (after);
    }
    return out;
  }
```

Flip `canFetchMergeRequestIndex: false,` to `canFetchMergeRequestIndex: true,` in the class's `capabilities` literal.

- [ ] **Step 5: Run the test, the suite, and the types**

Run: `cd packages/glance && bun test tests/gitlab-mr-index.test.ts && bun test && bun run check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/GitLabProvider.ts tests/gitlab-mr-index.test.ts
git commit -m "glance: fetchMergeRequestIndex lists scalar MR rows across a group or projects"
```

---

### Task 4: GitLab `fetchMergeRequestMetrics`

**Files:**
- Modify: `src/GitLabProvider.ts` (queries, response types, the method, `canFetchMergeRequestMetrics: true`)
- Test: `tests/gitlab-mr-metrics.test.ts`

**Interfaces:**
- Consumes: `MergeRequestMetrics`, `MetricsNote`, `DiffStats` from `./types.ts`; the existing `GQLDiffStats` interface; the private `runQuery`.
- Produces: `GitLabProvider.fetchMergeRequestMetrics(projectPath, mrIid): Promise<MergeRequestMetrics | null>`, notes paginated to exhaustion.

- [ ] **Step 1: Write the failing test**

Create `tests/gitlab-mr-metrics.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * fetchMergeRequestMetrics: one MR's metric-grade detail. The first query
 * carries the MR fields plus the first page of notes; later pages fetch
 * notes only. `inline` is whether the note has a diff position.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

interface Call { op: string; vars: Record<string, unknown> }

const note = (author: string | null, createdAt: string, inline = false, system = false) => ({
  system,
  createdAt,
  author: author === null ? null : { username: author },
  position: inline ? { __typename: 'DiffPosition' } : null,
});

function detail(notesPage: { hasNextPage: boolean; endCursor: string | null; nodes: unknown[] }) {
  return {
    project: {
      id: 'gid://gitlab/Project/42',
      mergeRequest: {
        description: 'closes ENG-1',
        diffStatsSummary: { additions: 30, deletions: 3, fileCount: 2 },
        diffStats: [{ path: 'src/a.ts', additions: 10, deletions: 1 }, { path: 'package.json', additions: 20, deletions: 2 }],
        labels: { nodes: [{ title: 'bug' }] },
        approvedBy: { nodes: [{ username: 'bob' }] },
        notes: { pageInfo: { hasNextPage: notesPage.hasNextPage, endCursor: notesPage.endCursor }, nodes: notesPage.nodes },
      },
    },
  };
}

function stub(provider: GitLabProvider, responses: unknown[]): Call[] {
  const calls: Call[] = [];
  (provider as any).runQuery = async (op: string, _query: string, vars: Record<string, unknown>) => {
    calls.push({ op, vars });
    return responses[calls.length - 1];
  };
  return calls;
}

describe('GitLabProvider.fetchMergeRequestMetrics', () => {
  test('maps the MR fields and classifies notes', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stub(p, [detail({ hasNextPage: false, endCursor: null, nodes: [
      note('bob', '2026-08-02T10:00:00Z', true),
      note('bob', '2026-08-02T11:00:00Z'),
      note(null, '2026-08-02T11:05:00Z', false, true),
    ] })]);
    const m = await p.fetchMergeRequestMetrics('g/p', 7);
    expect(calls).toEqual([{ op: 'fetchMergeRequestMetrics', vars: { fullPath: 'g/p', iid: '7' } }]);
    expect(m).toEqual({
      iid: 7,
      projectPath: 'g/p',
      description: 'closes ENG-1',
      diffStats: { additions: 30, deletions: 3, filesChanged: 2 },
      fileStats: [{ path: 'src/a.ts', additions: 10, deletions: 1 }, { path: 'package.json', additions: 20, deletions: 2 }],
      labels: ['bug'],
      approvedByUsernames: ['bob'],
      notes: [
        { authorUsername: 'bob', createdAt: '2026-08-02T10:00:00Z', system: false, inline: true },
        { authorUsername: 'bob', createdAt: '2026-08-02T11:00:00Z', system: false, inline: false },
        { authorUsername: null, createdAt: '2026-08-02T11:05:00Z', system: true, inline: false },
      ],
    });
  });

  test('pages notes to exhaustion with notes-only follow-up queries', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stub(p, [
      detail({ hasNextPage: true, endCursor: 'n1', nodes: [note('a', '2026-08-02T10:00:00Z')] }),
      { project: { mergeRequest: { notes: { pageInfo: { hasNextPage: true, endCursor: 'n2' }, nodes: [note('b', '2026-08-02T11:00:00Z')] } } } },
      { project: { mergeRequest: { notes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [note('c', '2026-08-02T12:00:00Z')] } } } },
    ]);
    const m = await p.fetchMergeRequestMetrics('g/p', 7);
    expect(m!.notes.map((n) => n.authorUsername)).toEqual(['a', 'b', 'c']);
    expect(calls.map((c) => c.op)).toEqual(['fetchMergeRequestMetrics', 'fetchMergeRequestMetrics.notes', 'fetchMergeRequestMetrics.notes']);
    expect(calls[1]!.vars).toEqual({ fullPath: 'g/p', iid: '7', after: 'n1' });
    expect(calls[2]!.vars.after).toBe('n2');
  });

  test('null when the project or MR does not exist', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stub(p, [{ project: null }]);
    expect(await p.fetchMergeRequestMetrics('g/p', 7)).toBeNull();
    stub(p, [{ project: { id: 'x', mergeRequest: null } }]);
    expect(await p.fetchMergeRequestMetrics('g/p', 7)).toBeNull();
  });

  test('a notes cursor that does not advance throws', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stub(p, [
      detail({ hasNextPage: true, endCursor: 'n1', nodes: [] }),
      { project: { mergeRequest: { notes: { pageInfo: { hasNextPage: true, endCursor: 'n1' }, nodes: [] } } } },
    ]);
    await expect(p.fetchMergeRequestMetrics('g/p', 7)).rejects.toThrow('non-advancing notes cursor');
  });

  test('the capability flag is on', () => {
    expect(new GitLabProvider('https://gitlab.example', 't').capabilities.canFetchMergeRequestMetrics).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gitlab-mr-metrics.test.ts`
Expected: FAIL with `p.fetchMergeRequestMetrics is not a function`.

- [ ] **Step 3: Add the queries and response types**

In `src/GitLabProvider.ts`, after the Task 3 block (after `toIndexRow`), add:

```ts
const MR_METRICS_NOTE_FIELDS = 'system createdAt author { username } position { __typename }';

const MR_METRICS_QUERY = `
  query GlanceMRMetrics($fullPath: ID!, $iid: String!) {
    project(fullPath: $fullPath) {
      id
      mergeRequest(iid: $iid) {
        description
        diffStatsSummary { additions deletions fileCount }
        diffStats { path additions deletions }
        labels(first: 100) { nodes { title } }
        approvedBy(first: 100) { nodes { username } }
        notes(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes { ${MR_METRICS_NOTE_FIELDS} }
        }
      }
    }
  }
`;

const MR_METRICS_NOTES_QUERY = `
  query GlanceMRMetricsNotes($fullPath: ID!, $iid: String!, $after: String!) {
    project(fullPath: $fullPath) {
      mergeRequest(iid: $iid) {
        notes(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ${MR_METRICS_NOTE_FIELDS} }
        }
      }
    }
  }
`;

interface GQLMetricsNote {
  system: boolean;
  createdAt: string;
  author: { username: string } | null;
  position: { __typename: string } | null;
}

interface GQLNotesConnection {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: GQLMetricsNote[];
}

interface MRMetricsResponse {
  project: {
    mergeRequest: {
      description: string | null;
      diffStatsSummary: GQLDiffStats | null;
      diffStats: Array<{ path: string; additions: number; deletions: number }> | null;
      labels: { nodes: Array<{ title: string }> } | null;
      approvedBy: { nodes: Array<{ username: string }> } | null;
      notes: GQLNotesConnection;
    } | null;
  } | null;
}

interface MRMetricsNotesResponse {
  project: { mergeRequest: { notes: GQLNotesConnection } | null } | null;
}

function toMetricsNote(n: GQLMetricsNote): MetricsNote {
  return {
    authorUsername: n.author?.username ?? null,
    createdAt: n.createdAt,
    system: n.system,
    inline: n.position !== null,
  };
}
```

Add `MergeRequestMetrics` and `MetricsNote` to the file's `import type { ... } from './types.ts'` list.

- [ ] **Step 4: Add the method**

In `class GitLabProvider`, directly after `fetchMergeRequestIndex`, add:

```ts
  async fetchMergeRequestMetrics(projectPath: string, mrIid: number): Promise<MergeRequestMetrics | null> {
    const vars = { fullPath: projectPath, iid: String(mrIid) };
    const resp = await this.runQuery<MRMetricsResponse>('fetchMergeRequestMetrics', MR_METRICS_QUERY, vars);
    const mr = resp.project?.mergeRequest;
    if (!mr) return null;

    const notes: MetricsNote[] = mr.notes.nodes.map(toMetricsNote);
    let after: string | null = mr.notes.pageInfo.hasNextPage ? mr.notes.pageInfo.endCursor : null;
    while (after) {
      const more: MRMetricsNotesResponse = await this.runQuery<MRMetricsNotesResponse>(
        'fetchMergeRequestMetrics.notes', MR_METRICS_NOTES_QUERY, { ...vars, after },
      );
      const conn = more.project?.mergeRequest?.notes;
      if (!conn) break;
      notes.push(...conn.nodes.map(toMetricsNote));
      const next = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      if (conn.pageInfo.hasNextPage && (next === null || next === after)) {
        throw new Error(`fetchMergeRequestMetrics: non-advancing notes cursor '${next}' for ${projectPath}!${mrIid}`);
      }
      after = next;
    }

    return {
      iid: mrIid,
      projectPath,
      description: mr.description ?? null,
      diffStats: mr.diffStatsSummary
        ? {
            additions: mr.diffStatsSummary.additions,
            deletions: mr.diffStatsSummary.deletions,
            filesChanged: mr.diffStatsSummary.fileCount,
          }
        : null,
      fileStats: (mr.diffStats ?? []).map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
      labels: (mr.labels?.nodes ?? []).map((l) => l.title),
      approvedByUsernames: (mr.approvedBy?.nodes ?? []).map((u) => u.username),
      notes,
    };
  }
```

Flip `canFetchMergeRequestMetrics: false,` to `true` in the `capabilities` literal.

- [ ] **Step 5: Run the test, the suite, and the types**

Run: `cd packages/glance && bun test tests/gitlab-mr-metrics.test.ts && bun test && bun run check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/GitLabProvider.ts tests/gitlab-mr-metrics.test.ts
git commit -m "glance: fetchMergeRequestMetrics reads one MR's metric-grade detail with every note"
```

---

### Task 5: GitLab `fetchGroupProjects`, `fetchProject`, `fetchProjectPipelines`, `fetchUserEvents`

**Files:**
- Modify: `src/GitLabProvider.ts` (a group-projects query, two private REST helpers, four methods, four flags flipped to `true`)
- Test: `tests/gitlab-metrics-rest.test.ts`

**Interfaces:**
- Consumes: `restRequest(method, path, body?, op?)` (existing; provider-relative paths, resolves on non-2xx); `runQuery`; `domainId`; `FetchProjectPipelinesOptions`, `FetchUserEventsOptions` from `./GitProvider.ts`; `ProjectRef`, `PipelineSummary`, `UserEvent` from `./types.ts`.
- Produces: the four methods with the interface signatures from Task 2, plus two private helpers `restPages<T>(op, path, query)` and `requireInstant(op, field, value)`.

- [ ] **Step 1: Write the failing test**

Create `tests/gitlab-metrics-rest.test.ts`:

```ts
#!/usr/bin/env bun
/**
 * The REST-backed metric reads. fetch is stubbed so every test asserts the
 * exact URL (path, filters, per_page, page) and the x-next-page walk.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Page { status?: number; body: unknown; nextPage?: string }

/** Answers each fetch with the next page in order and records the URLs asked for. */
function stubFetch(pages: Page[]): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    const page = pages[urls.length - 1] ?? { body: [] };
    const headers = new Headers();
    if (page.nextPage !== undefined) headers.set('x-next-page', page.nextPage);
    return new Response(JSON.stringify(page.body), { status: page.status ?? 200, headers });
  }) as typeof fetch;
  return urls;
}

const p = () => new GitLabProvider('https://gitlab.example', 't');

describe('fetchProject', () => {
  test('resolves a path to a scoped id', async () => {
    const urls = stubFetch([{ body: { id: 42, path_with_namespace: 'g/p' } }]);
    expect(await p().fetchProject('g/p')).toEqual({ id: 'gitlab:42', fullPath: 'g/p' });
    expect(urls).toEqual(['https://gitlab.example/api/v4/projects/g%2Fp']);
  });

  test('404 is null; any other failure throws', async () => {
    stubFetch([{ status: 404, body: { message: '404 Project Not Found' } }]);
    expect(await p().fetchProject('g/missing')).toBeNull();
    stubFetch([{ status: 500, body: {} }]);
    await expect(p().fetchProject('g/p')).rejects.toThrow('fetchProject: HTTP 500');
  });
});

describe('fetchGroupProjects', () => {
  test('pages the group projects connection, subgroups included', async () => {
    const prov = p();
    const calls: Array<{ op: string; query: string; vars: Record<string, unknown> }> = [];
    const pages = [
      { group: { projects: { pageInfo: { hasNextPage: true, endCursor: 'c0' }, nodes: [{ fullPath: 'g/a' }] } } },
      { group: { projects: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ fullPath: 'g/sub/b' }] } } },
    ];
    (prov as any).runQuery = async (op: string, query: string, vars: Record<string, unknown>) => {
      calls.push({ op, query, vars });
      return pages[calls.length - 1];
    };
    expect(await prov.fetchGroupProjects('g')).toEqual(['g/a', 'g/sub/b']);
    expect(calls[0]!.query).toContain('includeSubgroups: true');
    expect(calls.map((c) => c.vars.after)).toEqual([null, 'c0']);
  });

  test('an unknown group throws rather than reading as empty', async () => {
    const prov = p();
    (prov as any).runQuery = async () => ({ group: null });
    await expect(prov.fetchGroupProjects('nope')).rejects.toThrow('no group at nope');
  });
});

describe('fetchProjectPipelines', () => {
  test('filters by user and window, walks x-next-page, and maps summaries', async () => {
    const urls = stubFetch([
      { body: [{ id: 1, status: 'SUCCESS', created_at: '2026-08-02T00:00:00Z' }], nextPage: '2' },
      { body: [{ id: 2, status: 'failed', created_at: null }], nextPage: '' },
    ]);
    const out = await p().fetchProjectPipelines('g/p', {
      username: 'ada', updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: '2026-08-31T00:00:00Z',
    });
    expect(urls).toEqual([
      'https://gitlab.example/api/v4/projects/g%2Fp/pipelines?username=ada&updated_after=2026-08-01T00%3A00%3A00Z&updated_before=2026-08-31T00%3A00%3A00Z&per_page=100&page=1',
      'https://gitlab.example/api/v4/projects/g%2Fp/pipelines?username=ada&updated_after=2026-08-01T00%3A00%3A00Z&updated_before=2026-08-31T00%3A00%3A00Z&per_page=100&page=2',
    ]);
    expect(out).toEqual([
      { id: 'gitlab:pipeline:1', status: 'success', createdAt: '2026-08-02T00:00:00Z', username: 'ada' },
      { id: 'gitlab:pipeline:2', status: 'failed', createdAt: null, username: 'ada' },
    ]);
  });

  test('no username means an unfiltered listing with a null username', async () => {
    const urls = stubFetch([{ body: [] }]);
    const out = await p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: '2026-08-31T00:00:00Z' });
    expect(urls[0]).not.toContain('username=');
    expect(out).toEqual([]);
  });

  test('refuses an unparseable bound and a page that does not advance', async () => {
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: 'x', updatedBefore: '2026-08-31T00:00:00Z' })).rejects.toThrow('updatedAfter must be an ISO-8601 instant');
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: 'x' })).rejects.toThrow('updatedBefore must be an ISO-8601 instant');
    stubFetch([{ body: [], nextPage: '1' }]);
    await expect(p().fetchProjectPipelines('g/p', { updatedAfter: '2026-08-01T00:00:00Z', updatedBefore: '2026-08-31T00:00:00Z' })).rejects.toThrow('non-advancing page');
  });
});

describe('fetchUserEvents', () => {
  test('reads the numeric id out of the scoped user id and maps events', async () => {
    const urls = stubFetch([{ body: [
      { action_name: 'pushed to', created_at: '2026-08-02T09:00:00Z', project_id: 42 },
      { action_name: 'pushed new', created_at: '2026-08-03T09:00:00Z', project_id: null },
    ] }]);
    const out = await p().fetchUserEvents('gitlab:user:7', { action: 'pushed', after: '2026-07-31', before: '2026-09-01' });
    expect(urls).toEqual(['https://gitlab.example/api/v4/users/7/events?action=pushed&after=2026-07-31&before=2026-09-01&per_page=100&page=1']);
    expect(out).toEqual([
      { action: 'pushed to', createdAt: '2026-08-02T09:00:00Z', repositoryId: 'gitlab:42' },
      { action: 'pushed new', createdAt: '2026-08-03T09:00:00Z', repositoryId: null },
    ]);
  });

  test('refuses a non-GitLab user id and non-date bounds', async () => {
    await expect(p().fetchUserEvents('github:user:7', { action: 'pushed', after: '2026-07-31', before: '2026-09-01' })).rejects.toThrow('scoped GitLab user id');
    await expect(p().fetchUserEvents('gitlab:user:7', { action: 'pushed', after: '2026-07-31T00:00:00Z', before: '2026-09-01' })).rejects.toThrow('after must be a calendar date');
  });
});

describe('capability flags', () => {
  test('all four REST-backed reads are on', () => {
    const c = p().capabilities;
    expect([c.canFetchGroupProjects, c.canFetchProject, c.canFetchProjectPipelines, c.canFetchUserEvents]).toEqual([true, true, true, true]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/gitlab-metrics-rest.test.ts`
Expected: FAIL with `is not a function` on the first method called.

- [ ] **Step 3: Add the group-projects query and its response type**

In `src/GitLabProvider.ts`, after the Task 4 block (after `toMetricsNote`), add:

```ts
const GROUP_PROJECTS_QUERY = `
  query GlanceGroupProjects($fullPath: ID!, $after: String) {
    group(fullPath: $fullPath) {
      projects(includeSubgroups: true, first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { fullPath }
      }
    }
  }
`;

interface GroupProjectsResponse {
  group: {
    projects: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{ fullPath: string }>;
    };
  } | null;
}

/** Throws unless `value` parses as an instant; the message names the operation and field. */
function requireInstant(op: string, field: string, value: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${op}: ${field} must be an ISO-8601 instant, got "${value}"`);
  }
}
```

Add `ProjectRef`, `PipelineSummary`, `UserEvent` to the file's `import type { ... } from './types.ts'` list, and `FetchProjectPipelinesOptions`, `FetchUserEventsOptions` to its `./GitProvider.ts` type imports.

- [ ] **Step 4: Add the REST page walker and the four methods**

In `class GitLabProvider`, directly after `fetchMergeRequestMetrics`, add:

```ts
  /**
   * GET a list endpoint across every page. GitLab names the next page in
   * `x-next-page` (empty on the last page); a page that names itself or an
   * earlier page again would loop forever, so that throws.
   */
  private async restPages<T>(op: string, path: string, query: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    for (;;) {
      const params = new URLSearchParams({ ...query, per_page: '100', page: String(page) });
      const res = await this.restRequest('GET', `${path}?${params.toString()}`, undefined, op);
      if (!res.ok) throw new Error(`${op}: HTTP ${res.status} for ${path} page ${page}`);
      out.push(...((await res.json()) as T[]));
      const next = res.headers.get('x-next-page');
      if (!next) return out;
      const nextPage = Number(next);
      if (!Number.isInteger(nextPage) || nextPage <= page) {
        throw new Error(`${op}: non-advancing page '${next}' for ${path}`);
      }
      page = nextPage;
    }
  }

  async fetchGroupProjects(groupPath: string): Promise<string[]> {
    const out: string[] = [];
    let after: string | null = null;
    do {
      const resp: GroupProjectsResponse = await this.runQuery<GroupProjectsResponse>(
        'fetchGroupProjects', GROUP_PROJECTS_QUERY, { fullPath: groupPath, after },
      );
      const conn = resp.group?.projects;
      if (!conn) throw new Error(`fetchGroupProjects: no group at ${groupPath}`);
      out.push(...conn.nodes.map((n) => n.fullPath));
      const next = conn.pageInfo.hasNextPage ? (conn.pageInfo.endCursor ?? null) : null;
      if (conn.pageInfo.hasNextPage && (next === null || next === after)) {
        throw new Error(`fetchGroupProjects: non-advancing cursor '${next}' for ${groupPath}`);
      }
      after = next;
    } while (after);
    return out;
  }

  async fetchProject(projectPath: string): Promise<ProjectRef | null> {
    const res = await this.restRequest('GET', `/projects/${encodeURIComponent(projectPath)}`, undefined, 'fetchProject');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetchProject: HTTP ${res.status} for ${projectPath}`);
    const body = (await res.json()) as { id: number; path_with_namespace: string };
    return { id: `gitlab:${body.id}`, fullPath: body.path_with_namespace };
  }

  async fetchProjectPipelines(projectPath: string, options: FetchProjectPipelinesOptions): Promise<PipelineSummary[]> {
    requireInstant('fetchProjectPipelines', 'updatedAfter', options.updatedAfter);
    requireInstant('fetchProjectPipelines', 'updatedBefore', options.updatedBefore);
    const query: Record<string, string> = {};
    if (options.username) query.username = options.username;
    query.updated_after = options.updatedAfter;
    query.updated_before = options.updatedBefore;
    type RESTPipeline = { id: number; status: string; created_at: string | null };
    const raws = await this.restPages<RESTPipeline>(
      'fetchProjectPipelines', `/projects/${encodeURIComponent(projectPath)}/pipelines`, query,
    );
    return raws.map((r) => ({
      id: domainId('pipeline', r.id),
      status: r.status.toLowerCase(),
      createdAt: r.created_at ?? null,
      username: options.username ?? null,
    }));
  }

  async fetchUserEvents(userId: string, options: FetchUserEventsOptions): Promise<UserEvent[]> {
    const scoped = /^gitlab:user:(\d+)$/.exec(userId);
    if (!scoped) {
      throw new Error(`fetchUserEvents: userId must be a scoped GitLab user id like "gitlab:user:42", got "${userId}"`);
    }
    for (const [field, value] of [['after', options.after], ['before', options.before]] as const) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`fetchUserEvents: ${field} must be a calendar date (YYYY-MM-DD), got "${value}"`);
      }
    }
    type RESTEvent = { action_name: string; created_at: string; project_id: number | null };
    const raws = await this.restPages<RESTEvent>(
      'fetchUserEvents', `/users/${scoped[1]}/events`,
      { action: options.action, after: options.after, before: options.before },
    );
    return raws.map((e) => ({
      action: e.action_name,
      createdAt: e.created_at,
      repositoryId: e.project_id == null ? null : `gitlab:${e.project_id}`,
    }));
  }
```

Flip `canFetchGroupProjects`, `canFetchProject`, `canFetchProjectPipelines`, and `canFetchUserEvents` from `false` to `true` in the `capabilities` literal.

- [ ] **Step 5: Run the test, the suite, and the types**

Run: `cd packages/glance && bun test tests/gitlab-metrics-rest.test.ts && bun test && bun run check-types`
Expected: PASS. The pipelines URL assertion depends on `URLSearchParams` ordering, which follows insertion order: `username` (when set), `updated_after`, `updated_before`, `per_page`, `page`.

- [ ] **Step 6: Commit**

```bash
git add src/GitLabProvider.ts tests/gitlab-metrics-rest.test.ts
git commit -m "glance: fetchGroupProjects, fetchProject, fetchProjectPipelines, fetchUserEvents"
```

---

### Task 6: Changelog, README, version 0.23.0, build smoke

**Files:**
- Modify: `CHANGELOG.md` (new top section)
- Modify: `README.md` (one bullet in the Features list)
- Modify: `package.json` (`"version": "0.23.0"`)

- [ ] **Step 1: Write the changelog entry**

At the top of `CHANGELOG.md`, directly under the `# @mattstack/glance` heading, add:

```markdown
## 0.23.0

### Minor Changes

- `PullRequest` carries `mergedAt` (when the MR merged, null while open or
  closed unmerged) and `labels` (label names). Both providers populate them;
  the fields are optional on the type so a `PullRequest` built by an older
  SDK still type-checks.
- Metric-grade reads on `GitProvider`, each optional and paired with a
  `ProviderCapabilities` flag; `GitLabProvider` implements all six,
  `GitHubProvider` declares them `false`:
  - `fetchMergeRequestIndex({ groupPath | projectPaths, updatedAfter, states?, onPage? })`:
    scalar MR rows (`MergeRequestIndexRow`) across a group with its
    subgroups or a project set, 100 per page to exhaustion. The list a
    metrics consumer keeps history from.
  - `fetchMergeRequestMetrics(projectPath, iid)`: one MR's
    `MergeRequestMetrics` (description, summary and per-file diff stats,
    labels, approver usernames, every note with author, time, system flag,
    and whether it sits on a diff line), notes paginated to exhaustion.
  - `fetchGroupProjects(groupPath)`, `fetchProject(projectPath)`,
    `fetchProjectPipelines(projectPath, { username?, updatedAfter, updatedBefore })`,
    and `fetchUserEvents(userId, { action, after, before })`, returning
    `string[]`, `ProjectRef | null`, `PipelineSummary[]`, and `UserEvent[]`.
  - New exports: those five types plus `MetricsNote`, and the option types
    `FetchMergeRequestIndexOptions`, `FetchProjectPipelinesOptions`,
    `FetchUserEventsOptions`.
```

- [ ] **Step 2: Add the README bullet**

In `README.md` (the package README at `packages/glance/README.md`), in the `## Features` list, after the dashboard-helpers bullet, add:

```markdown
- **Metric-grade reads.** `fetchMergeRequestIndex` pages scalar MR rows
  (with `mergedAt` and labels) across a group or project set,
  `fetchMergeRequestMetrics` reads one MR's diff stats and every note, and
  `fetchProjectPipelines` / `fetchUserEvents` / `fetchGroupProjects` /
  `fetchProject` cover the rest of what an engineering-metrics consumer
  needs. GitLab today; each is optional on `GitProvider` behind a
  capability flag.
```

If the package README has no `## Features` list, add the bullet to the repo-root `README.md`'s Features list instead and say so in the report.

- [ ] **Step 3: Bump the version**

In `package.json`, change `"version": "0.22.0"` to `"version": "0.23.0"`.

- [ ] **Step 4: Run the suite, the types, and the node build smoke**

Run: `cd packages/glance && bun test && bun run check-types && bun run check:node`
Expected: PASS for all three. `check:node` builds `dist/` and imports it under plain `node`, which is what a published consumer does.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md README.md package.json
git commit -m "glance 0.23.0: metric-grade reads and PullRequest.mergedAt/labels"
```

Publishing (`bun publish` from `packages/glance`, which runs `prepublishOnly`) is Matt's step after review; the plan ends here.

---

## Done criteria

- `cd packages/glance && bun test`, `bun run check-types`, and `bun run check:node` pass on the branch.
- `tests/pr-merged-at-labels.test.ts`, `tests/metrics-reads-capabilities.test.ts`, `tests/gitlab-mr-index.test.ts`, `tests/gitlab-mr-metrics.test.ts`, and `tests/gitlab-metrics-rest.test.ts` exist and pass; no existing test file changed.
- `GitLabProvider.capabilities` reports all six new flags `true`; `GitHubProvider.capabilities` reports all six `false` and defines none of the methods.
- `CHANGELOG.md` has a `## 0.23.0` section and `package.json` is at `0.23.0`.
