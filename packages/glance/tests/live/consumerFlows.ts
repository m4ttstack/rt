/**
 * Consumer use-case flows: each check reproduces a call pattern a real
 * consumer of glance uses today (source: .local-dev/derisk/consumer-matrix.md,
 * "use cases to encode"), driven against both providers. Where a consumer
 * feature-detects an optional method, the flow exercises BOTH branches the
 * consumer can take, so the fallback path has coverage too.
 *
 * Scope: the fifteen rows that matrix tags NOT events-dependent, U1 through
 * U15, one `check()` per row in matrix order. The nine events-dependent rows
 * (U16-U24) belong to a separate task; `runConsumerFlows` stays the single
 * export so adding them is one more call inside it rather than a second entry
 * point the runner has to remember.
 *
 * The consumer set is smaller than the phase-5 brief assumed, and the matrix
 * is the authority on it: two direct consumers (gitq, and `rt` -- the
 * `repo-tools` repo, which ships `bin: { rt }`) plus one indirect (mr-board,
 * whose data plane is rt's daemon over a socket, never glance). Every check
 * below names the consumer whose call pattern it reproduces and the matrix row
 * it comes from, so the suite documents WHY each flow exists rather than only
 * what it asserts.
 *
 * Consumer-side logic is REPRODUCED here, not imported. gitq's
 * `filterPRsToProject`/`discoverStacksFromPRs`/`PublishSkipReason`, rt's
 * `effectiveAuthors`/`withinWindow`/scope post-filter, and gitq's
 * `SnapshotCache` are all copied down to the few lines each flow turns on.
 * These tests exist to catch a *glance* change breaking a consumer, so
 * pinning the consumer's behaviour as a constant in this file is the point:
 * importing it would let a consumer-side change silently move the goalposts,
 * and this repo cannot depend on its own consumers anyway.
 *
 * Provider differences go through a declared expectation table
 * (`expectationFor` for GitProvider method support, `flowExpectationFor` for
 * the behavioural differences this suite needs that the method table has no
 * row for), never an inline `if (fixture.name === 'github')`. Raw API
 * mechanics -- how to create a branch, how to anchor a diff comment -- do
 * branch on the fixture name, following conformance.ts's own precedent: those
 * are transport shapes, not claims about what a provider owes a caller.
 */

import type { FetchPullRequestsOptions, GitProvider, MRState } from '../../src/GitProvider.ts';
import { getMRDashboardProps } from '../../src/MRDashboard.ts';
import type {
  Discussion,
  MergeRequestReviewState,
  PullRequest,
  ReviewDisplayState
} from '../../src/types.ts';
import { getReviewDisplayState } from '../../src/types.ts';
import { expectationFor } from './expectations.ts';
import type { ProviderFixture } from './fixture.ts';
import { pollUntil } from './poll.ts';
import type { Reporter } from './report.ts';

// ── Harness plumbing ────────────────────────────────────────────────────────
//
// `Inconclusive`, `check` and `assert` are deliberate copies of
// conformance.ts's. They are module-private there, and this task's scope is
// one new file plus a runner hook -- exporting them would mean editing the
// conformance suite, which is the one file a consumer-flow task must not
// destabilise. The semantics are identical on purpose: a flow that cannot
// prove its claim reports a skip carrying the reason, never a green tick.

class Inconclusive extends Error {}

/**
 * Every result this suite records uses the method label `consumer-flow`
 * rather than the `ProviderMethod` the flow happens to call.
 *
 * That is not cosmetic. `Reporter.assertFullCoverage` fails a run when a
 * `ProviderMethod` never appears for a provider, which is how conformance.ts
 * detects an early return that silently dropped an assertion. If these flows
 * reported under real method names, a consumer flow passing would satisfy
 * that coverage check on behalf of a conformance check that never ran --
 * quietly disabling the guard. The glance method each flow exercises is named
 * in its label instead.
 */
const FLOW = 'consumer-flow';

async function check(
  report: Reporter,
  fixture: ProviderFixture,
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    report.pass(fixture.name, FLOW, label);
  } catch (err) {
    if (err instanceof Inconclusive) {
      report.skip(fixture.name, FLOW, label, err.message);
      return;
    }
    report.fail(fixture.name, FLOW, label, err instanceof Error ? err.message : String(err));
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Prefix a REST path for the provider's actual API root.
 *
 * Same divergence conformance.ts records: `restRequest`'s docstring claims
 * implementations translate the path, and GitLabProvider concatenates
 * `baseURL + path` verbatim instead, so a GitLab caller must supply
 * `/api/v4` and a GitHub caller must not.
 */
function apiPath(fixture: ProviderFixture, path: string): string {
  return fixture.name === 'gitlab' ? `/api/v4${path}` : path;
}

/** Unique per run, so an aborted run never collides with the next. */
function runPrefix(): string {
  return `conformance/${Date.now().toString(36)}`;
}

/** The `<provider>:<numericId>` form `fetchMRDiscussions` and `repositoryId` use. */
async function scopedRepoId(fixture: ProviderFixture): Promise<string> {
  const { provider, projectPath } = fixture;
  const path =
    fixture.name === 'github'
      ? `/repos/${projectPath}`
      : apiPath(fixture, `/projects/${encodeURIComponent(projectPath)}`);
  const res = await provider.restRequest('GET', path);
  if (!res.ok) throw new Error(`could not resolve repo id: HTTP ${res.status}`);
  const { id } = (await res.json()) as { id: number };
  return `${fixture.name}:${id}`;
}

/**
 * Create `branch` off `from` using `actor`'s credentials.
 *
 * Takes the acting provider rather than reading `fixture.provider`, because
 * the author-scoping flows (U13-U15) need a pull request authored by somebody
 * other than the token user, which means the second identity has to push its
 * own branch.
 */
async function createBranch(
  fixture: ProviderFixture,
  actor: GitProvider,
  branch: string,
  from: string
): Promise<void> {
  const { projectPath } = fixture;
  if (fixture.name === 'github') {
    const refRes = await actor.restRequest('GET', `/repos/${projectPath}/git/ref/heads/${from}`);
    if (!refRes.ok) throw new Error(`read ref ${from} failed: HTTP ${refRes.status}`);
    const { object } = (await refRes.json()) as { object: { sha: string } };
    const res = await actor.restRequest('POST', `/repos/${projectPath}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: object.sha
    });
    if (!res.ok) throw new Error(`create branch failed: HTTP ${res.status}`);
    return;
  }
  const encoded = encodeURIComponent(projectPath);
  const res = await actor.restRequest(
    'POST',
    apiPath(
      fixture,
      `/projects/${encoded}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(from)}`
    )
  );
  if (!res.ok) throw new Error(`create branch failed: HTTP ${res.status}`);
}

/** Commit a file so the branch differs from its base; neither forge opens a PR with no diff. */
async function commitFile(
  fixture: ProviderFixture,
  actor: GitProvider,
  branch: string,
  path: string,
  content: string
): Promise<void> {
  const { projectPath } = fixture;
  if (fixture.name === 'github') {
    const res = await actor.restRequest('PUT', `/repos/${projectPath}/contents/${path}`, {
      message: `conformance: add ${path}`,
      content: Buffer.from(content).toString('base64'),
      branch
    });
    if (!res.ok) throw new Error(`commit failed: HTTP ${res.status}`);
    return;
  }
  const encoded = encodeURIComponent(projectPath);
  const res = await actor.restRequest(
    'POST',
    apiPath(fixture, `/projects/${encoded}/repository/files/${encodeURIComponent(path)}`),
    { branch, content, commit_message: `conformance: add ${path}` }
  );
  if (!res.ok) throw new Error(`commit failed: HTTP ${res.status}`);
}

/**
 * Post a comment anchored to a line of `path`, which must already be committed
 * on the PR's branch. A plain issue-level comment carries no resolvable state
 * on either provider, so only a diff-anchored one produces the unresolved
 * thread U6 and U11 read back.
 */
async function postDiffComment(
  fixture: ProviderFixture,
  iid: number,
  path: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const body = 'consumer-flow: harness-created review thread';
  const readError = async (res: Response, label: string): Promise<Error> => {
    const text = await res.text().catch(() => '');
    return new Error(`${label} failed: HTTP ${res.status}${text ? `: ${text}` : ''}`);
  };
  if (fixture.name === 'github') {
    const prRes = await provider.restRequest('GET', `/repos/${projectPath}/pulls/${iid}`);
    if (!prRes.ok) throw await readError(prRes, 'could not read PR for diff comment');
    const { head } = (await prRes.json()) as { head: { sha: string } };
    const res = await provider.restRequest('POST', `/repos/${projectPath}/pulls/${iid}/comments`, {
      body,
      commit_id: head.sha,
      path,
      line: 1,
      side: 'RIGHT'
    });
    if (!res.ok) throw await readError(res, 'diff comment');
    return;
  }
  const encoded = encodeURIComponent(projectPath);
  const mrRes = await provider.restRequest(
    'GET',
    apiPath(fixture, `/projects/${encoded}/merge_requests/${iid}`)
  );
  if (!mrRes.ok) throw await readError(mrRes, 'could not read MR for diff comment');
  const { diff_refs } = (await mrRes.json()) as {
    diff_refs: { base_sha: string; start_sha: string; head_sha: string };
  };
  const res = await provider.restRequest(
    'POST',
    apiPath(fixture, `/projects/${encoded}/merge_requests/${iid}/discussions`),
    {
      body,
      position: {
        base_sha: diff_refs.base_sha,
        start_sha: diff_refs.start_sha,
        head_sha: diff_refs.head_sha,
        position_type: 'text',
        old_path: path,
        new_path: path,
        new_line: 1
      }
    }
  );
  if (!res.ok) throw await readError(res, 'diff comment');
}

// ── Consumer-flow expectation table ─────────────────────────────────────────

/**
 * Provider differences these flows turn on that `expectations.ts` has no row
 * for, because they are not statements about whether a `GitProvider` method
 * is supported.
 *
 * Kept as a declared table for the same reason the method table exists: a
 * divergence nobody wrote down should surface as a failing check, not as an
 * `if (fixture.name === 'github')` that quietly encodes one provider's
 * behaviour as the rule.
 */
interface FlowExpectation {
  /**
   * U7 (gitq): what `PullRequest.diffStats` carries for a PR returned by the
   * `projectPath`-alone listing mode.
   *
   * `null` is the correct answer on GitHub, not a gap: that mode is a REST
   * `/pulls` listing, and GitHub only returns additions/deletions/changed
   * files from the single-PR endpoint (GitHubProvider.fetchPullRequests'
   * own docstring says so). What gitq depends on is that the absence
   * degrades to `null` -- not a throw, and not fabricated zeros, which would
   * render as "no changes" in gitq's UI.
   */
  projectListDiffStats: 'populated' | 'null';
}

const FLOW_EXPECTATIONS: Record<ProviderFixture['name'], FlowExpectation> = {
  github: { projectListDiffStats: 'null' },
  gitlab: { projectListDiffStats: 'populated' }
};

function flowExpectationFor(provider: ProviderFixture['name']): FlowExpectation {
  return FLOW_EXPECTATIONS[provider];
}

// ── Reproduced consumer logic ───────────────────────────────────────────────

/** gitq: `forge-helpers.ts` `projectScopeFromWebUrl`. */
function projectPathFromWebUrl(webUrl: string | null): string | null {
  if (!webUrl) return null;
  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    return null;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const dashIdx = parts.indexOf('-');
  if (dashIdx >= 2 && parts[dashIdx + 1] === 'merge_requests') {
    return parts.slice(0, dashIdx).join('/');
  }
  const pullIdx = parts.indexOf('pull');
  if (pullIdx >= 2) return parts.slice(0, pullIdx).join('/');
  return null;
}

/**
 * gitq: `forge-helpers.ts` `filterPRsToProject`. Matches on the web URL, not
 * `repositoryId`, exactly as gitq does -- the URL is the only repo identity a
 * `PullRequest` carries that gitq can compare against a local git remote
 * without an extra API call.
 */
function filterPRsToProject(prs: PullRequest[], wanted: string): PullRequest[] {
  return prs.filter(pr => projectPathFromWebUrl(pr.webUrl) === wanted);
}

interface DiscoveredStack {
  root: string;
  branches: string[];
}

/** gitq: `forge-helpers.ts` `discoverStacksInRepo`. */
function discoverStacksInBucket(prs: PullRequest[]): DiscoveredStack[] {
  const childrenOf = new Map<string, string[]>();
  for (const pr of prs) {
    const children = childrenOf.get(pr.targetBranch) ?? [];
    children.push(pr.sourceBranch);
    childrenOf.set(pr.targetBranch, children);
  }
  const sourceBranches = new Set(prs.map(pr => pr.sourceBranch));
  const roots = new Set<string>();
  for (const pr of prs) {
    if (!sourceBranches.has(pr.targetBranch)) roots.add(pr.targetBranch);
  }

  const stacks: DiscoveredStack[] = [];
  for (const root of roots) {
    for (const child of childrenOf.get(root) ?? []) {
      const branches: string[] = [];
      const queue = [child];
      while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined) break;
        branches.push(current);
        for (const gc of childrenOf.get(current) ?? []) queue.push(gc);
      }
      if (branches.length >= 2) stacks.push({ root, branches });
    }
  }
  return stacks;
}

/**
 * gitq: `forge-helpers.ts` `discoverStacksFromPRs`. Buckets by
 * `(repositoryId, author.username)` before walking target->source chains --
 * MAT-22, where adjacency alone spliced two developers stacking on the same
 * intermediate branch into one stack neither was working on.
 */
function discoverStacksFromPRs(prs: PullRequest[]): DiscoveredStack[] {
  const byRepoAndAuthor = new Map<string, PullRequest[]>();
  const unidentified: PullRequest[][] = [];
  for (const pr of prs) {
    const author = pr.author?.username;
    if (!pr.repositoryId || !author) {
      unidentified.push([pr]);
      continue;
    }
    const key = `${pr.repositoryId}\0${author}`;
    const bucket = byRepoAndAuthor.get(key);
    if (bucket) bucket.push(pr);
    else byRepoAndAuthor.set(key, [pr]);
  }
  return [...byRepoAndAuthor.values(), ...unidentified].flatMap(discoverStacksInBucket);
}

/** gitq: the three `PublishSkipReason` branches at `forge-sync.ts:455-484`. */
type PublishSkipReason = 'mr-unreadable' | 'mr-not-open' | 'source-branch-mismatch' | null;

function publishSkipReason(pr: PullRequest | undefined, branch: string): PublishSkipReason {
  if (!pr) return 'mr-unreadable';
  if (pr.state !== 'opened') return 'mr-not-open';
  if (pr.sourceBranch !== branch) return 'source-branch-mismatch';
  return null;
}

/**
 * gitq: `server/data.ts` `fetchMrsByBranch`, minus the rt-daemon shortcut.
 *
 * The feature detect is on the optional interface member, not on a provider
 * slug: `GitHubProvider` does not implement `fetchPullRequestsByBranches` and
 * must fall back rather than fail.
 */
async function gitqFetchMrsByBranch(
  provider: GitProvider,
  projectPath: string,
  branches: string[]
): Promise<Map<string, PullRequest>> {
  const out = new Map<string, PullRequest>();
  if (branches.length === 0) return out;
  if (provider.fetchPullRequestsByBranches) {
    const map = await provider.fetchPullRequestsByBranches(projectPath, branches, 'all');
    for (const [branch, pr] of map) if (pr) out.set(branch, pr);
    return out;
  }
  for (const branch of branches) {
    const pr = await provider.fetchPullRequestByBranch(projectPath, branch, 'all');
    if (pr) out.set(branch, pr);
  }
  return out;
}

/**
 * rt: `daemon/freshness.ts` `upsertProject`'s gap-fill arm. Where gitq falls
 * back sequentially, rt deliberately no-ops: no batch method means no
 * gap-fill at all, and the 5-minute full poll heals it instead.
 */
async function rtGapFill(
  provider: GitProvider,
  projectPath: string,
  branches: string[]
): Promise<Map<string, PullRequest | null> | null> {
  if (!provider.fetchPullRequestsByBranches) return null;
  return provider.fetchPullRequestsByBranches(projectPath, branches, 'all');
}

/** rt: `daemon/project-sync.ts` `effectiveAuthors`. */
function effectiveAuthors(demandAuthors: string[][], selfUsername: string | null): string[] | null {
  const authors = new Set<string>();
  for (const d of demandAuthors) for (const a of d) authors.add(a);
  if (selfUsername) authors.add(selfUsername);
  if (authors.size === 0) return null;
  return [...authors].sort();
}

/** rt: `daemon/project-sync.ts` `withinWindow`. A missing/unparseable timestamp is kept. */
function withinWindow(prs: PullRequest[], windowDays: number, now: number): PullRequest[] {
  const cutoff = now - windowDays * 86_400_000;
  return prs.filter(pr => {
    const t = Date.parse(pr.updatedAt ?? '');
    return !Number.isFinite(t) || t >= cutoff;
  });
}

/** rt: the delta-path author post-filter at `project-sync.ts:247`. */
function rtScopeFilter(prs: PullRequest[], authors: string[]): PullRequest[] {
  return prs.filter(pr => !pr.author?.username || authors.includes(pr.author.username));
}

/**
 * gitq: `server/cache.ts` `SnapshotCache`, trimmed to what U8 turns on.
 *
 * `now` and `ttlMs` are constructor seams in gitq's own implementation, which
 * is what lets U8 exercise a 60s TTL window without a 60-second sleep in a
 * live harness.
 */
interface Snapshot<T> {
  data: T;
  fetchedAt: number;
}

class SnapshotCache<T> {
  private snapshot: Snapshot<T> | null = null;
  private inflight: Promise<Snapshot<T>> | null = null;

  constructor(
    private fetchData: () => Promise<T>,
    private now: () => number,
    private ttlMs: number
  ) {}

  /** gitq's `?fresh=1` path: drop the snapshot so the next get() blocks on a real fetch. */
  invalidate(): void {
    this.snapshot = null;
  }

  get fetchedAt(): number | null {
    return this.snapshot?.fetchedAt ?? null;
  }

  async get(): Promise<Snapshot<T>> {
    if (this.snapshot && this.now() - this.snapshot.fetchedAt < this.ttlMs) return this.snapshot;
    const refresh = this.refresh();
    // Stale-while-revalidate: an existing snapshot is served immediately and
    // the refresh lands in the background. This is exactly why gitq's worst
    // case is ~60-120s rather than ~60s.
    if (this.snapshot) {
      refresh.catch(() => {});
      return this.snapshot;
    }
    return refresh;
  }

  private refresh(): Promise<Snapshot<T>> {
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchData()
      .then(data => {
        this.snapshot = { data, fetchedAt: this.now() };
        return this.snapshot;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}

/**
 * A provider that records the `fetchPullRequests` options it was handed and
 * then makes the real call.
 *
 * U14's claim is about the shape of the SDK call rt issues, which no response
 * body can show. Recording the argument and still performing the live fetch
 * keeps the assertion honest: the options asserted on are the options a real
 * request was built from, not a mock's.
 */
function recordingProvider(provider: GitProvider, calls: (FetchPullRequestsOptions | undefined)[]): GitProvider {
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'fetchPullRequests' && typeof value === 'function') {
        return (options?: FetchPullRequestsOptions) => {
          calls.push(options);
          return (value as GitProvider['fetchPullRequests']).call(target, options);
        };
      }
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    }
  }) as GitProvider;
}

// ── Shared live fixture for the flows ───────────────────────────────────────

interface SecondAuthor {
  username: string;
  branch: string;
  pr: PullRequest;
}

interface FlowFixture {
  ownerUsername: string;
  repositoryId: string;
  /** U1/U6/U9/U11: a draft PR whose branch carries the seed file threads anchor to. */
  draftPr: PullRequest;
  draftBranch: string;
  seedFilePath: string;
  /** U2/U3/U4/U5/U8: a second open PR, retargeted onto `draftBranch` by U3. */
  stackPr: PullRequest;
  stackBranch: string;
  /** U3: a PR closed by deleting its source branch, the only close path GitProvider offers. */
  closedIid: number;
  /** U5/U13/U14: a PR authored by the second identity, or null with the reason why not. */
  secondAuthor: SecondAuthor | null;
  secondAuthorReason: string;
  /** U10: empty when a reviewer was assigned to `draftPr`, else why not. */
  reviewerReason: string;
  /**
   * Null when the author-scoped search has caught up with the PRs created
   * above, or the reason it had not. GitHub's author and involvement modes
   * are search-API backed and index asynchronously; GitLab's are GraphQL and
   * immediate. Waiting once here rather than per-flow keeps six searches out
   * of a 30-request-per-minute budget.
   */
  searchLag: string | null;
}

function requireFixture(state: FlowFixture | null, setupError: string | null): FlowFixture {
  if (state) return state;
  throw new Inconclusive(
    `the shared flow fixture could not be built, so this flow never ran: ${setupError ?? 'unknown reason'}`
  );
}

/**
 * `createdBranches` is the caller's array, not a local one, so a setup that
 * throws halfway still leaves every branch it managed to create behind for
 * teardown. A local list would be lost with the exception, and the branches
 * with it -- each one holding an open pull request on a shared fixture.
 */
async function buildFlowFixture(
  fixture: ProviderFixture,
  createdBranches: string[]
): Promise<FlowFixture> {
  const { provider, projectPath, defaultBranch } = fixture;
  const prefix = runPrefix();
  const draftBranch = `${prefix}-flow-base`;
  const stackBranch = `${prefix}-flow-child`;
  const closedBranch = `${prefix}-flow-closed`;
  const seedFilePath = `consumer-flow-${Date.now()}.md`;

  const ownerUsername = (await provider.validateToken()).username;
  const repositoryId = await scopedRepoId(fixture);

  await createBranch(fixture, provider, draftBranch, defaultBranch);
  createdBranches.unshift(draftBranch);
  await commitFile(fixture, provider, draftBranch, seedFilePath, '# consumer flow\n');
  const draftPr = await provider.createPullRequest({
    projectPath,
    title: 'consumer-flow: draft base',
    description: 'Opened by the glance consumer-flow suite. Safe to close.',
    sourceBranch: draftBranch,
    targetBranch: defaultBranch,
    draft: true
  });

  // A reviewer, when a second identity exists, is what gives U10 a live
  // `reviewState` to map. Assigned through `requestReReview` rather than
  // `createPullRequest({reviewers})`: GitLabProvider's `asUserIds` casts
  // usernames straight to numbers, so the create-time path silently assigns
  // nobody there. Best-effort, and the reason is carried into U10's skip:
  // a reviewer is this suite's convenience, not one of the fifteen rows.
  let reviewerReason = 'no second identity is configured for this fixture';
  if (fixture.approver) {
    try {
      const reviewer = (await fixture.approver.validateToken()).username;
      await provider.requestReReview(projectPath, draftPr.iid, [reviewer]);
      reviewerReason = '';
    } catch (err) {
      reviewerReason = `requesting a review failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  await createBranch(fixture, provider, stackBranch, defaultBranch);
  createdBranches.unshift(stackBranch);
  await commitFile(fixture, provider, stackBranch, `${stackBranch.split('/').pop()}.md`, '# child\n');
  const stackPr = await provider.createPullRequest({
    projectPath,
    title: 'consumer-flow: stack child',
    description: 'Opened by the glance consumer-flow suite. Safe to close.',
    sourceBranch: stackBranch,
    targetBranch: defaultBranch
  });

  await createBranch(fixture, provider, closedBranch, defaultBranch);
  createdBranches.unshift(closedBranch);
  await commitFile(fixture, provider, closedBranch, `${closedBranch.split('/').pop()}.md`, '# closed\n');
  const closedPr = await provider.createPullRequest({
    projectPath,
    title: 'consumer-flow: to be closed',
    description: 'Opened by the glance consumer-flow suite. Safe to close.',
    sourceBranch: closedBranch,
    targetBranch: defaultBranch
  });
  // Deleting the source branch closes the PR on both providers; GitProvider
  // exposes no closePullRequest, so this is the only close path available.
  // Dropped from the teardown list only once the delete has actually
  // happened, so a failure between creating it and closing it still leaves
  // the branch for cleanup instead of stranding an open PR on the fixture.
  await provider.deleteBranch(projectPath, closedBranch);
  createdBranches.splice(createdBranches.indexOf(closedBranch), 1);

  let secondAuthor: SecondAuthor | null = null;
  let secondAuthorReason = 'no second identity is configured for this fixture';
  if (fixture.approver) {
    const approver = fixture.approver;
    const branch = `${prefix}-flow-other-author`;
    try {
      const username = (await approver.validateToken()).username;
      // Branched off `stackBranch` and targeting it: a second author stacking
      // on the first author's branch is precisely the adjacency MAT-22 says
      // must NOT splice the two into one stack (U5).
      await createBranch(fixture, approver, branch, stackBranch);
      createdBranches.unshift(branch);
      await commitFile(fixture, approver, branch, `${branch.split('/').pop()}.md`, '# other author\n');
      const pr = await approver.createPullRequest({
        projectPath,
        title: 'consumer-flow: second author',
        description: 'Opened by the glance consumer-flow suite. Safe to close.',
        sourceBranch: branch,
        targetBranch: stackBranch
      });
      secondAuthor = { username, branch, pr };
      secondAuthorReason = '';
    } catch (err) {
      secondAuthorReason =
        'the second identity could not open a pull request on this fixture: ' +
        (err instanceof Error ? err.message : String(err));
    }
  }

  // One wait for the whole suite. A timeout is recorded rather than thrown:
  // only the search-backed flows depend on it, and failing setup outright
  // would take every other flow down with it.
  let searchLag: string | null = null;
  try {
    await pollUntil(
      `author-scoped search to return ${draftPr.iid} and ${stackPr.iid}`,
      async () => {
        const prs = await provider.fetchPullRequests({
          projectPath,
          authorUsernames: [ownerUsername],
          state: 'opened'
        });
        const iids = new Set(prs.map(p => p.iid));
        return iids.has(draftPr.iid) && iids.has(stackPr.iid) ? true : null;
      },
      { timeoutMs: 120_000, intervalMs: 10_000 }
    );
  } catch (err) {
    searchLag =
      'the author-scoped fetch had not returned the pull requests this suite just created: ' +
      (err instanceof Error ? err.message : String(err));
  }

  return {
    ownerUsername,
    repositoryId,
    draftPr,
    draftBranch,
    seedFilePath,
    stackPr,
    stackBranch,
    closedIid: closedPr.iid,
    secondAuthor,
    secondAuthorReason,
    reviewerReason,
    searchLag
  };
}

// ── The flows ───────────────────────────────────────────────────────────────

export async function runConsumerFlows(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  let state: FlowFixture | null = null;
  let setupError: string | null = null;
  // Owned here, filled by the setup below as each branch is created, so a
  // setup that throws halfway still gets its branches cleaned up. Child
  // branches are unshifted to the front: deleting a branch closes the pull
  // requests pointing at it, and a target branch outliving its source reads
  // more clearly in the forge's own history than the reverse.
  const branchesToClean: string[] = [];

  try {
    state = await buildFlowFixture(fixture, branchesToClean);
  } catch (err) {
    setupError = err instanceof Error ? err.message : String(err);
    // Recorded as a failure, not left to each flow's skip: a setup failure in
    // the harness's own write path is a defect here, and skips alone would
    // render identically to a fixture that legitimately had nothing to check.
    report.fail(
      fixture.name,
      FLOW,
      'shared flow fixture: opens the pull requests the flows read',
      setupError
    );
  }

  try {
    await runGitqFlows(fixture, report, state, setupError);
    await runDashboardFlows(fixture, report, state, setupError);
    await runAuthorScopeFlows(fixture, report, state, setupError);
    // U16-U24, the events-dependent rows of the same matrix section, append
    // here as one more `runEventsFlows(fixture, report, state, setupError)`
    // call: they need the same shared fixture and the same reporting shape,
    // and `runConsumerFlows` stays the runner's single entry point.
  } finally {
    for (const branch of branchesToClean) {
      await fixture.provider.deleteBranch(fixture.projectPath, branch).catch(err => {
        console.error(`  cleanup: could not delete ${branch}: ${err}`);
      });
    }
  }
}

/** U1-U8: gitq's call patterns. */
async function runGitqFlows(
  fixture: ProviderFixture,
  report: Reporter,
  state: FlowFixture | null,
  setupError: string | null
): Promise<void> {
  const { provider, projectPath, defaultBranch } = fixture;

  // U1 (gitq, consumer-gitq.md § use cases #1): gitq opens stack MRs as
  // drafts and persists what comes back. A pass needs a non-null iid and
  // webUrl to persist, AND the PR to be genuinely a draft on the forge --
  // GitHub numbers PRs per repo and expresses draft through a dedicated
  // field, GitLab through a "Draft:" title prefix, a divergence a
  // shared-interface test must not paper over by trusting the returned flag
  // alone.
  await check(
    report,
    fixture,
    'U1 gitq: createPullRequest({draft:true}) returns a persistable iid/webUrl and the forge agrees it is a draft',
    async () => {
      const s = requireFixture(state, setupError);
      assert(s.draftPr.iid > 0, `expected a positive iid, got ${s.draftPr.iid}`);
      assert(
        typeof s.draftPr.webUrl === 'string' && s.draftPr.webUrl.length > 0,
        `expected a webUrl gitq can persist, got ${JSON.stringify(s.draftPr.webUrl)}`
      );
      assert(s.draftPr.draft === true, `createPullRequest returned draft=${s.draftPr.draft}`);
      // Re-read, because "the object we returned says draft" also passes for
      // a provider that set the flag locally and never told the forge.
      const fresh = await provider.fetchSingleMR(projectPath, s.draftPr.iid, null);
      assert(fresh !== null, `fetchSingleMR could not find PR ${s.draftPr.iid} back`);
      assert(fresh.draft === true, `the forge reports draft=${fresh.draft} on a PR created with draft:true`);
      assert(
        fresh.iid === s.draftPr.iid,
        `iid changed between create and read: ${s.draftPr.iid} -> ${fresh.iid}`
      );
    }
  );

  // U2 (gitq + rt, consumer-gitq.md § use cases #2, consumer-repo-tools.md
  // § capability flags): both consumers feature-detect the optional
  // `fetchPullRequestsByBranches` and diverge on the absence -- gitq falls
  // back to N sequential `fetchPullRequestByBranch` calls, rt's gap-fill
  // deliberately no-ops with no fallback at all. This pins both, and where
  // the batch method exists, that the two paths return equivalent data
  // rather than the fallback silently missing fields.
  await check(
    report,
    fixture,
    'U2 gitq/rt: the sequential fallback and the batch lookup agree, and each consumer\'s absence behaviour holds',
    async () => {
      const s = requireFixture(state, setupError);
      const branches = [s.draftBranch, s.stackBranch];
      const declaredAbsent =
        expectationFor(fixture.name, 'fetchPullRequestsByBranches').support === 'absent';
      assert(
        (provider.fetchPullRequestsByBranches === undefined) === declaredAbsent,
        `the expectation table says fetchPullRequestsByBranches is ${declaredAbsent ? 'absent' : 'present'}, ` +
          `but the property is ${provider.fetchPullRequestsByBranches === undefined ? 'undefined' : 'a function'}`
      );

      // gitq's path, whichever branch it takes.
      const gitqResult = await gitqFetchMrsByBranch(provider, projectPath, branches);
      for (const branch of branches) {
        const found = gitqResult.get(branch);
        assert(found !== undefined, `gitq's fetchMrsByBranch resolved no PR for ${branch}`);
        assert(
          found.sourceBranch === branch,
          `gitq's fetchMrsByBranch mapped ${branch} to a PR whose source is ${found.sourceBranch}`
        );
      }

      // rt's path. Null is the correct, documented outcome where the batch
      // method is absent: rt fills no gap and lets its 5-minute poll heal it.
      const rtResult = await rtGapFill(provider, projectPath, branches);
      if (declaredAbsent) {
        assert(rtResult === null, 'rt\'s gap-fill should no-op where the batch method is absent');
        // The sequential loop still has to walk a provider lacking the method
        // without throwing -- that is the whole of gitq's contract here.
        assert(
          gitqResult.size === branches.length,
          `gitq's sequential fallback resolved ${gitqResult.size} of ${branches.length} branches`
        );
        return;
      }

      assert(rtResult !== null, 'the batch method exists, so rt\'s gap-fill should have produced a map');
      // Fields whose value can legitimately move between two live reads
      // (updatedAt, pipeline) are excluded on purpose; everything a consumer
      // keys off is compared.
      for (const branch of branches) {
        const batched = rtResult.get(branch);
        const sequential = await provider.fetchPullRequestByBranch(projectPath, branch, 'all');
        assert(batched != null, `the batch lookup returned no PR for ${branch}`);
        assert(sequential !== null, `the sequential lookup returned no PR for ${branch}`);
        for (const field of ['id', 'iid', 'repositoryId', 'state', 'sourceBranch', 'targetBranch', 'title', 'webUrl'] as const) {
          assert(
            batched[field] === sequential[field],
            `${branch}: batch and sequential disagree on ${field}: ` +
              `${JSON.stringify(batched[field])} vs ${JSON.stringify(sequential[field])}`
          );
        }
        assert(
          batched.author.username === sequential.author.username,
          `${branch}: batch and sequential disagree on author.username`
        );
      }
    }
  );

  // U3 (gitq, consumer-gitq.md § use cases #3): gitq's publish path fetches
  // by iid and retargets. A pass needs the target branch to actually move on
  // the forge -- the retarget is the write, and a provider that accepted it
  // and changed nothing would satisfy a "did not throw" assertion.
  await check(
    report,
    fixture,
    'U3 gitq: fetchPullRequests({iids}) then updatePullRequest({targetBranch}) moves the target on the forge',
    async () => {
      const s = requireFixture(state, setupError);
      const byIid = await provider.fetchPullRequests({ iids: [s.stackPr.iid], projectPath });
      assert(byIid.length === 1, `expected exactly one PR for iid ${s.stackPr.iid}, got ${byIid.length}`);
      const before = byIid[0]!;
      assert(
        before.targetBranch === defaultBranch,
        `expected the fixture PR to start on ${defaultBranch}, got ${before.targetBranch}`
      );
      assert(publishSkipReason(before, s.stackBranch) === null, 'the fixture PR should be eligible to retarget');

      const updated = await provider.updatePullRequest(projectPath, s.stackPr.iid, {
        targetBranch: s.draftBranch
      });
      assert(
        updated.targetBranch === s.draftBranch,
        `updatePullRequest returned targetBranch ${updated.targetBranch}`
      );
      const fresh = await provider.fetchSingleMR(projectPath, s.stackPr.iid, null);
      assert(
        fresh?.targetBranch === s.draftBranch,
        `the forge reports targetBranch ${fresh?.targetBranch} after retargeting to ${s.draftBranch}`
      );
    }
  );

  // U3 continued (gitq, consumer-gitq.md § use cases #3): the same row
  // requires the three PublishSkipReason branches -- a merged, closed, or
  // source-mismatched MR must be SKIPPED rather than retargeted. The closed
  // and mismatched cases are built from harness-created data; the merged case
  // needs a merged MR the fixture may not have, and says so rather than
  // inventing one.
  await check(
    report,
    fixture,
    'U3 gitq: a closed MR and a source-mismatched MR take the skip branches, not the retarget',
    async () => {
      const s = requireFixture(state, setupError);
      const closed = await pollUntil(
        `PR ${s.closedIid} to leave "opened" after its source branch was deleted`,
        async () => {
          const fresh = await provider.fetchSingleMR(projectPath, s.closedIid, null);
          return fresh && fresh.state !== 'opened' ? fresh : null;
        },
        { timeoutMs: 30_000, intervalMs: 2_000 }
      );
      assert(
        publishSkipReason(closed, closed.sourceBranch) === 'mr-not-open',
        `expected mr-not-open for a ${closed.state} MR, got ${publishSkipReason(closed, closed.sourceBranch)}`
      );

      const open = await provider.fetchSingleMR(projectPath, s.stackPr.iid, null);
      assert(open !== null, `fetchSingleMR lost PR ${s.stackPr.iid}`);
      assert(
        publishSkipReason(open, 'a-branch-this-mr-is-not-for') === 'source-branch-mismatch',
        'a stale iid pointing at another branch must take the source-branch-mismatch skip'
      );
      assert(
        publishSkipReason(undefined, s.stackBranch) === 'mr-unreadable',
        'an iid the forge did not return must take the mr-unreadable skip'
      );
    }
  );

  await check(
    report,
    fixture,
    'U3 gitq: a merged MR takes the not-open skip branch',
    async () => {
      requireFixture(state, setupError);
      const merged = await provider.fetchPullRequests({ projectPath, state: 'merged' });
      const sample = merged[0];
      if (!sample) {
        throw new Inconclusive(
          'the fixture project has no merged MR, so the merged arm of PublishSkipReason has nothing live to run against'
        );
      }
      assert(
        sample.state === 'merged',
        `state:'merged' returned an MR in state "${sample.state}"`
      );
      assert(
        publishSkipReason(sample, sample.sourceBranch) === 'mr-not-open',
        'a merged MR must take the mr-not-open skip rather than being retargeted'
      );
    }
  );

  // U4 (gitq, consumer-gitq.md § use cases #4): gitq patches title and
  // description independently and relies on "omitted field means unchanged on
  // the forge". The two forges implement that differently underneath --
  // GitLab's draft state lives IN the title, so a title-only patch there has
  // to read before it writes -- which is exactly why the guarantee is worth a
  // live check rather than a code read.
  await check(
    report,
    fixture,
    'U4 gitq: a title-only patch leaves the description alone, and a description-only patch leaves the title alone',
    async () => {
      const s = requireFixture(state, setupError);
      const stamp = Date.now().toString(36);
      const before = await provider.fetchSingleMR(projectPath, s.stackPr.iid, null);
      assert(before !== null, `fetchSingleMR lost PR ${s.stackPr.iid}`);

      const newTitle = `consumer-flow: stack child (title ${stamp})`;
      const afterTitle = await provider.updatePullRequest(projectPath, s.stackPr.iid, {
        title: newTitle
      });
      assert(afterTitle.title === newTitle, `title did not change, got "${afterTitle.title}"`);
      assert(
        afterTitle.description === before.description,
        `a title-only patch changed the description: ${JSON.stringify(before.description)} -> ${JSON.stringify(afterTitle.description)}`
      );

      const newDescription = `Opened by the glance consumer-flow suite. Safe to close. (body ${stamp})`;
      const afterBody = await provider.updatePullRequest(projectPath, s.stackPr.iid, {
        description: newDescription
      });
      assert(
        afterBody.description === newDescription,
        `description did not change, got ${JSON.stringify(afterBody.description)}`
      );
      assert(
        afterBody.title === newTitle,
        `a description-only patch changed the title: "${newTitle}" -> "${afterBody.title}"`
      );
    }
  );

  // U5 (gitq, consumer-gitq.md § use cases #5): `gitq import` fetches
  // unscoped and filters client-side, deliberately avoiding the member-blind
  // `fetchPullRequests({projectPath})`. A pass needs other projects excluded
  // AND the rebuilt stack tree's parent chain to match each MR's
  // targetBranch/sourceBranch -- including MAT-22's rule that two authors
  // sharing an intermediate branch are not joined into one stack.
  await check(
    report,
    fixture,
    'U5 gitq: unscoped fetch + filterPRsToProject + discoverStacksFromPRs rebuilds the chain without joining authors',
    async () => {
      const s = requireFixture(state, setupError);
      if (s.searchLag) throw new Inconclusive(s.searchLag);

      const all = await provider.fetchPullRequests();
      const mine = filterPRsToProject(all, projectPath);
      assert(mine.length > 0, 'the unscoped fetch returned nothing for the fixture project');
      for (const pr of mine) {
        // Stronger than the webUrl match gitq itself can afford: repositoryId
        // is set by one mapper per provider, so a provider that returned a
        // similarly-named project's MRs (".../owner/repo-archive/pull/5" is a
        // webUrl substring match for "owner/repo") is caught here.
        assert(
          pr.repositoryId === s.repositoryId,
          `filterPRsToProject kept PR ${pr.iid} from repositoryId ${pr.repositoryId}, not ${s.repositoryId}`
        );
      }
      const stray = all.find(pr => projectPathFromWebUrl(pr.webUrl) !== projectPath);
      if (stray) {
        assert(
          !mine.includes(stray),
          `filterPRsToProject kept PR ${stray.iid} from ${projectPathFromWebUrl(stray.webUrl)}`
        );
      }

      const stacks = discoverStacksFromPRs(mine);
      const ours = stacks.find(st => st.branches.includes(s.stackBranch));
      if (!ours) {
        throw new Inconclusive(
          `no stack containing ${s.stackBranch} was discovered; the U3 retarget that forms the chain did not land`
        );
      }
      // The parent chain must be a real chain: every branch in the stack past
      // the root has a PR whose sourceBranch is it and whose targetBranch is
      // either the root or another branch in the same stack.
      const bySource = new Map(mine.map(pr => [pr.sourceBranch, pr]));
      for (const branch of ours.branches) {
        const pr = bySource.get(branch);
        assert(pr !== undefined, `stack branch ${branch} has no MR whose sourceBranch is it`);
        assert(
          pr.targetBranch === ours.root || ours.branches.includes(pr.targetBranch),
          `stack branch ${branch} targets ${pr.targetBranch}, which is neither the root ${ours.root} nor in the stack`
        );
      }
      assert(
        ours.branches.includes(s.draftBranch),
        `the discovered stack ${JSON.stringify(ours.branches)} is missing the parent branch ${s.draftBranch}`
      );

      if (!s.secondAuthor) {
        throw new Inconclusive(
          `the chain and the project filter both hold, but the cross-author half is unverified: ${s.secondAuthorReason}`
        );
      }
      // The unscoped involvement fetch only returns MRs the token user is
      // party to, so on this fixture it is single-author by construction.
      // gitq's list is not: `gitq import` runs on repos where the user
      // reviews other people's MRs. Assembling that list here is what makes
      // the MAT-22 rule testable at all -- and the second author's MR really
      // does stack on ours, so a naive adjacency walk WOULD splice it in.
      const mixed = [...mine, s.secondAuthor.pr];
      const mixedStacks = discoverStacksFromPRs(mixed);
      const oursAgain = mixedStacks.find(st => st.branches.includes(s.stackBranch));
      assert(oursAgain !== undefined, 'the stack disappeared once a second author\'s MR joined the list');
      assert(
        !oursAgain.branches.includes(s.secondAuthor.branch),
        `MAT-22: ${s.secondAuthor.branch} (authored by ${s.secondAuthor.username}) was spliced into ` +
          `${s.ownerUsername}'s stack ${JSON.stringify(oursAgain.branches)}`
      );
    }
  );

  // U6 (gitq, consumer-gitq.md § use cases #6): gitq renders
  // `unresolvedThreadCount`, and its own test name records that its authors
  // distrust the field on GitHub. `null` is a legal value meaning "the
  // provider could not determine the count" -- but a PR with a real
  // unresolved review comment must not report null OR 0, both of which gitq
  // renders as "all resolved".
  await check(
    report,
    fixture,
    'U6 gitq: unresolvedThreadCount is populated for a PR carrying a real unresolved review thread',
    async () => {
      const s = requireFixture(state, setupError);
      await postDiffComment(fixture, s.draftPr.iid, s.seedFilePath);
      const fresh = await pollUntil(
        `unresolvedThreadCount on PR ${s.draftPr.iid}`,
        async () => {
          const pr = await provider.fetchSingleMR(projectPath, s.draftPr.iid, null);
          return pr && pr.unresolvedThreadCount !== null && pr.unresolvedThreadCount > 0 ? pr : null;
        },
        { timeoutMs: 30_000, intervalMs: 3_000 }
      ).catch(async () => {
        const pr = await provider.fetchSingleMR(projectPath, s.draftPr.iid, null).catch(() => null);
        throw new Error(
          `a PR with one harness-created unresolved thread reports unresolvedThreadCount=` +
            `${pr === null ? 'unreadable' : JSON.stringify(pr.unresolvedThreadCount)}; ` +
            'null and 0 both render as "all resolved" in gitq'
        );
      });
      assert(
        fresh.unresolvedThreadCount !== null && fresh.unresolvedThreadCount >= 1,
        `expected at least one unresolved thread, got ${fresh.unresolvedThreadCount}`
      );
    }
  );

  // U7 (gitq, consumer-gitq.md § use cases #7): gitq maps `diffStats` for its
  // board. GitHub's project listing omits diff stats entirely, so what gitq
  // depends on is the degradation: `null`, never a throw and never fabricated
  // zeros, which would render as "no changes". Which provider does which is
  // read from the flow expectation table, not branched on inline.
  await check(
    report,
    fixture,
    'U7 gitq: diffStats from the project listing is either well-formed or exactly null, never fabricated zeros',
    async () => {
      const s = requireFixture(state, setupError);
      const prs = await provider.fetchPullRequests({ projectPath, state: 'opened' });
      const ours = prs.find(pr => pr.iid === s.stackPr.iid);
      assert(ours !== undefined, `the project listing did not return PR ${s.stackPr.iid}`);

      const expected = flowExpectationFor(fixture.name).projectListDiffStats;
      if (expected === 'null') {
        assert(
          ours.diffStats === null,
          `declared to omit diff stats in this mode, but got ${JSON.stringify(ours.diffStats)} -- ` +
            'a fabricated zero would read as "no changes"'
        );
        return;
      }
      assert(ours.diffStats !== null, 'declared to populate diff stats in this mode, but got null');
      assert(
        typeof ours.diffStats.additions === 'number' &&
          typeof ours.diffStats.deletions === 'number' &&
          typeof ours.diffStats.filesChanged === 'number',
        `diffStats is not well-formed: ${JSON.stringify(ours.diffStats)}`
      );
      // The branch adds exactly one file, so zeros here would be the
      // fabrication this row exists to catch rather than a real measurement.
      assert(
        ours.diffStats.additions >= 1 && ours.diffStats.filesChanged >= 1,
        `the PR adds a file, so diffStats should not be zeros: ${JSON.stringify(ours.diffStats)}`
      );
    }
  );

  // U8 (gitq, consumer-gitq.md § use cases #8): gitq's board wraps the
  // fetchMrsByBranch path in a 60s SnapshotCache. A forge-side change is
  // allowed to take one TTL window (~60-120s, because the cache is
  // stale-while-revalidate) or must appear immediately through `?fresh=1`.
  // The clock is injected -- gitq's own cache takes `now` as a constructor
  // seam -- so this asserts the window rather than sleeping through it.
  await check(
    report,
    fixture,
    'U8 gitq: a forge-side change is invisible inside the 60s TTL, immediate via ?fresh=1, and lands within one window',
    async () => {
      const s = requireFixture(state, setupError);
      let clock = 1_000_000;
      const cache = new SnapshotCache(
        () => gitqFetchMrsByBranch(provider, projectPath, [s.draftBranch, s.stackBranch]),
        () => clock,
        60_000
      );

      const first = await cache.get();
      const titleBefore = first.data.get(s.stackBranch)?.title;
      assert(titleBefore !== undefined, `the cached snapshot has no entry for ${s.stackBranch}`);

      // Nothing is asserted about this write yet, deliberately: the only
      // proof it landed is the `?fresh=1` read further down, which is the
      // first read that bypasses the cache. Comparing the new title against
      // the old one here would look like a check and be none -- the two are
      // different by construction, whether or not the forge accepted the
      // update.
      const titleAfter = `consumer-flow: stack child (cache ${Date.now().toString(36)})`;
      await provider.updatePullRequest(projectPath, s.stackPr.iid, { title: titleAfter });

      clock += 30_000;
      const stale = await cache.get();
      assert(
        stale.data.get(s.stackBranch)?.title === titleBefore,
        'the board served a re-fetch inside the TTL window; gitq\'s accepted staleness is the point of the cache'
      );

      // gitq's `?fresh=1` calls invalidate(), which drops the snapshot so the
      // next get() blocks on a real fetch rather than serving stale data.
      cache.invalidate();
      const fresh = await cache.get();
      assert(
        fresh.data.get(s.stackBranch)?.title === titleAfter,
        `?fresh=1 served ${JSON.stringify(fresh.data.get(s.stackBranch)?.title)}, not the new title`
      );

      // And the ordinary path: past the TTL the first caller still gets the
      // old snapshot while the refresh runs behind it, which is where the
      // second 60s of gitq's 60-120s worst case comes from.
      const staleTitle = `consumer-flow: stack child (ttl ${Date.now().toString(36)})`;
      await provider.updatePullRequest(projectPath, s.stackPr.iid, { title: staleTitle });
      const beforeTtl = cache.fetchedAt;
      clock += 61_000;
      const revalidating = await cache.get();
      assert(
        revalidating.data.get(s.stackBranch)?.title === titleAfter,
        'past the TTL the cache should still serve the previous snapshot while it revalidates'
      );
      const settled = await pollUntil(
        'the background revalidation to replace the snapshot',
        async () => {
          const snap = await cache.get();
          return cache.fetchedAt !== beforeTtl ? snap : null;
        },
        { timeoutMs: 30_000, intervalMs: 500 }
      );
      assert(
        settled.data.get(s.stackBranch)?.title === staleTitle,
        `the revalidated snapshot carries ${JSON.stringify(settled.data.get(s.stackBranch)?.title)}, not the newest title`
      );
    }
  );
}

/** U9-U12: mr-board's derivations and the seam feeding rt's freshness fields. */
async function runDashboardFlows(
  fixture: ProviderFixture,
  report: Reporter,
  state: FlowFixture | null,
  setupError: string | null
): Promise<void> {
  const { provider, projectPath } = fixture;

  // U9 (mr-board, also rt via enrich.ts; consumer-mr-board.md § use cases #1):
  // mr-board renders from `getMRDashboardProps`, so the derived fields its UI
  // switches on must come out the same for a GitHub-backed PullRequest as for
  // a GitLab one. Both fixtures run this identical body: the cross-provider
  // identity claim IS the two runs agreeing, since a per-fixture suite can
  // never hold both providers' objects at once.
  await check(
    report,
    fixture,
    'U9 mr-board/rt: getMRDashboardProps derives the same switch surface (state, status, pipeline, blockers) on both providers',
    async () => {
      const s = requireFixture(state, setupError);
      const draft = await provider.fetchSingleMR(projectPath, s.draftPr.iid, null);
      const open = await provider.fetchSingleMR(projectPath, s.stackPr.iid, null);
      assert(draft !== null && open !== null, 'could not read both fixture PRs back');

      const draftProps = getMRDashboardProps(draft);
      const openProps = getMRDashboardProps(open, 'idle');

      // The draft PR is a draft on both forges, so every field derived from
      // draftness must agree across providers -- a value comparison, not just
      // a type check.
      assert(draftProps.state === 'draft', `expected state "draft", got "${draftProps.state}"`);
      assert(draftProps.isDraft === true, 'isDraft should be true for a draft PR');
      assert(draftProps.status === 'draft', `expected status "draft", got "${draftProps.status}"`);
      assert(draftProps.blockers.isDraft === true, 'blockers.isDraft should be true for a draft PR');
      assert(draftProps.blockers.any === true, 'a draft PR is blocked, so blockers.any must be true');
      assert(openProps.isDraft === false, 'the non-draft PR should not read as a draft');
      assert(openProps.state === 'opened', `expected state "opened", got "${openProps.state}"`);
      assert(openProps.connection === 'idle', `expected connection "idle", got "${openProps.connection}"`);

      const statuses = new Set(['mergeable', 'blocked', 'draft', 'closed', 'merged']);
      for (const [label, props] of [['draft', draftProps], ['open', openProps]] as const) {
        assert(statuses.has(props.status), `${label}: status "${props.status}" is outside MRStatus`);
        assert(typeof props.isReady === 'boolean', `${label}: isReady is ${typeof props.isReady}`);
        assert(
          typeof props.isCheckingMergeability === 'boolean',
          `${label}: isCheckingMergeability is ${typeof props.isCheckingMergeability}`
        );
        // `pipeline` is nullable by design (GitHub reports null under
        // listWeight, and a PR can genuinely have no pipeline), but a present
        // one must carry the counts the UI switches on rather than undefined.
        if (props.pipeline !== null) {
          for (const field of ['passing', 'failing', 'running', 'total'] as const) {
            assert(
              typeof props.pipeline[field] === 'number',
              `${label}: pipeline.${field} is ${typeof props.pipeline[field]}`
            );
          }
          assert(typeof props.pipeline.status === 'string', `${label}: pipeline.status is not a string`);
        }
        const blockers = props.blockers;
        for (const field of [
          'isDraft',
          'hasConflicts',
          'needsRebase',
          'pipelineFailing',
          'pipelineRunning',
          'awaitingApprovals',
          'hasUnresolvedDiscussions',
          'hasMergeError',
          'any'
        ] as const) {
          assert(
            typeof blockers[field] === 'boolean',
            `${label}: blockers.${field} is ${typeof blockers[field]}, not a boolean -- ` +
              'an undefined blocker reads as "not blocked" in the UI'
          );
        }
        const individually =
          blockers.isDraft ||
          blockers.hasConflicts ||
          blockers.needsRebase ||
          blockers.pipelineFailing ||
          blockers.pipelineRunning ||
          blockers.awaitingApprovals ||
          blockers.hasUnresolvedDiscussions ||
          blockers.hasMergeError;
        assert(
          blockers.any === individually,
          `${label}: blockers.any is ${blockers.any} but the individual blockers say ${individually}`
        );
      }
    }
  );

  // U10 (mr-board + rt; consumer-mr-board.md § use cases #2, consumer-rt.md
  // § methods called): both consumers branch on the MAPPED display state,
  // never on the raw provider string. The mapping must therefore be total --
  // every MergeRequestReviewState a GitHub-backed PR can produce, plus null
  // and an unknown value, lands on one of the five display states.
  await check(
    report,
    fixture,
    'U10 mr-board/rt: getReviewDisplayState maps every review state, including null and unknown, into the display set',
    async () => {
      const displayStates = new Set<ReviewDisplayState>([
        'approved',
        'commented',
        'changes_requested',
        'reviewing',
        'awaiting_review'
      ]);
      const expected: Array<[MergeRequestReviewState | null, ReviewDisplayState]> = [
        ['APPROVED', 'approved'],
        ['REVIEWED', 'commented'],
        ['REQUESTED_CHANGES', 'changes_requested'],
        ['REVIEW_STARTED', 'reviewing'],
        ['UNAPPROVED', 'awaiting_review'],
        ['UNREVIEWED', 'awaiting_review'],
        [null, 'awaiting_review']
      ];
      for (const [raw, want] of expected) {
        const got = getReviewDisplayState(raw);
        assert(got === want, `getReviewDisplayState(${JSON.stringify(raw)}) returned "${got}", expected "${want}"`);
        assert(displayStates.has(got), `"${got}" is outside ReviewDisplayState`);
      }
      // The default arm is what protects a consumer from a provider growing a
      // review state it has never seen: an unmapped value must fall through
      // to a display state, not leak the raw string into the UI.
      const unknown = getReviewDisplayState('SOMETHING_NEW' as MergeRequestReviewState);
      assert(
        displayStates.has(unknown),
        `an unmapped review state produced "${unknown}", which is outside ReviewDisplayState`
      );
    }
  );

  await check(
    report,
    fixture,
    'U10 mr-board/rt: a live reviewer\'s raw reviewState maps into the display set, and displayState agrees when present',
    async () => {
      const s = requireFixture(state, setupError);
      const pr = await provider.fetchSingleMR(projectPath, s.draftPr.iid, null);
      assert(pr !== null, `fetchSingleMR lost PR ${s.draftPr.iid}`);
      if (pr.reviewers.length === 0) {
        throw new Inconclusive(
          `PR ${s.draftPr.iid} has no assigned reviewers, so no live reviewState exists to map: ${s.reviewerReason || 'the reviewer was requested but the forge reports none'}`
        );
      }
      const displayStates = new Set<ReviewDisplayState>([
        'approved',
        'commented',
        'changes_requested',
        'reviewing',
        'awaiting_review'
      ]);
      for (const reviewer of pr.reviewers) {
        const mapped = getReviewDisplayState(reviewer.reviewState);
        assert(
          displayStates.has(mapped),
          `reviewer ${reviewer.username} raw state ${JSON.stringify(reviewer.reviewState)} mapped to "${mapped}"`
        );
        if (reviewer.displayState !== undefined) {
          assert(
            reviewer.displayState === mapped,
            `reviewer ${reviewer.username}: provider-supplied displayState "${reviewer.displayState}" ` +
              `disagrees with getReviewDisplayState -> "${mapped}"`
          );
        }
      }
    }
  );

  // U11 (mr-board, consumer-mr-board.md § use cases #4): mr-board reconstitutes
  // rt's relayed discussions payload with a cast and reads exactly four fields
  // per note. A GitHub-sourced payload has to satisfy the same shape AND the
  // same semantics -- a fresh review thread is resolvable, unresolved, not a
  // system note, and attributed to its author.
  await check(
    report,
    fixture,
    'U11 mr-board: a fetched discussions payload carries resolvable/resolved/system/author.username with the same semantics',
    async () => {
      const s = requireFixture(state, setupError);
      const detail = await provider.fetchMRDiscussions(s.repositoryId, s.draftPr.iid);
      assert(Array.isArray(detail.discussions), 'discussions was not an array');
      assert(
        detail.mrIid === s.draftPr.iid,
        `MRDetail.mrIid is ${detail.mrIid}, expected ${s.draftPr.iid}`
      );

      const target: Discussion | undefined = detail.discussions.find(d => d.resolvable === true);
      if (!target) {
        throw new Inconclusive(
          'no resolvable discussion on the fixture PR; U6 posts the thread this reads, so it did not land'
        );
      }
      assert(
        target.resolved === false,
        `a freshly created thread reports resolved=${target.resolved}; null means the read degraded ` +
          'instead of reporting real state, which is what mr-board\'s thread status keys off'
      );
      assert(target.notes.length > 0, 'the resolvable discussion carries no notes');
      for (const note of target.notes) {
        assert(typeof note.system === 'boolean', `note ${note.id}: system is ${typeof note.system}`);
        assert(
          note.resolvable === true,
          `note ${note.id}: resolvable is ${JSON.stringify(note.resolvable)} on a thread reported resolvable`
        );
        assert(
          note.resolved === false,
          `note ${note.id}: resolved is ${JSON.stringify(note.resolved)} on an unresolved thread`
        );
        assert(
          typeof note.author.username === 'string' && note.author.username.length > 0,
          `note ${note.id}: author.username is ${JSON.stringify(note.author.username)}`
        );
      }
      const mine = target.notes.find(n => n.author.username === s.ownerUsername);
      assert(
        mine !== undefined,
        `the harness-created thread is attributed to ${JSON.stringify(target.notes.map(n => n.author.username))}, not ${s.ownerUsername}`
      );
      assert(mine.system === false, 'a human review comment must not be flagged as a system note');
    }
  );

  // U12 (mr-board indirect, consumer-mr-board.md § use cases #5): mr-board's
  // freshness UI and scope-uncovered banner read rt-client fields
  // (`syncedAt`, `scope.windowDays`, `scope.uncovered`), not glance ones. What
  // glance owes that seam is narrow and worth pinning: `updatedAt` on every PR
  // (rt's windowDays filter reads it, and never guess-drops a missing one),
  // and an author fetch for someone with no MRs resolving to [] rather than
  // throwing -- a rejection there fails rt's whole deep sync, so `syncedAt`
  // never advances and mr-board paints stale.
  await check(
    report,
    fixture,
    'U12 mr-board/rt: the fields feeding rt\'s syncedAt and scope survive -- updatedAt is present, an empty author scope resolves',
    async () => {
      const s = requireFixture(state, setupError);
      if (s.searchLag) throw new Inconclusive(s.searchLag);

      const prs = await provider.fetchPullRequests({
        projectPath,
        authorUsernames: [s.ownerUsername],
        state: 'opened'
      });
      assert(prs.length > 0, 'the author-scoped fetch returned nothing to reason about');
      for (const pr of prs) {
        assert(
          pr.updatedAt === null || Number.isFinite(Date.parse(pr.updatedAt)),
          `PR ${pr.iid} carries an unparseable updatedAt ${JSON.stringify(pr.updatedAt)}; ` +
            'rt keeps it rather than guess-dropping, so the window silently stops scoping'
        );
      }
      const now = Date.now();
      const kept = withinWindow(prs, 30, now);
      assert(
        kept.some(pr => pr.iid === s.stackPr.iid),
        `rt's 30-day window dropped PR ${s.stackPr.iid}, created moments ago`
      );
      // The fixture project accumulates long-lived open MRs, so the window
      // legitimately drops some. What must hold is that every drop is
      // justified by a timestamp the filter could actually read.
      const cutoff = now - 30 * 86_400_000;
      for (const pr of prs) {
        if (kept.includes(pr)) continue;
        const t = Date.parse(pr.updatedAt ?? '');
        assert(
          Number.isFinite(t) && t < cutoff,
          `the window dropped PR ${pr.iid} whose updatedAt is ${JSON.stringify(pr.updatedAt)}`
        );
      }
      // The never-guess-drop rule, on data the fixture cannot produce on its
      // own: an MR with no usable timestamp stays in scope.
      const undated: PullRequest = { ...prs[0]!, updatedAt: null };
      assert(
        withinWindow([undated], 30, now + 400 * 86_400_000).length === 1,
        'an MR with no updatedAt was dropped by the window filter; rt never guess-drops one'
      );

      // rt's `scope.authors` is the set it ASKED for, and `uncovered` is
      // computed against it, so a demanded author with nothing in the project
      // must come back empty rather than rejecting the deep sync.
      const emptyScope = `consumer-flow-no-such-author-${Date.now().toString(36)}`;
      const none = await provider.fetchPullRequests({
        projectPath,
        authorUsernames: [emptyScope],
        state: 'opened'
      });
      assert(
        Array.isArray(none) && none.length === 0,
        `an author with no MRs in the project returned ${none.length} MRs`
      );
    }
  );
}

/** U13-U15: rt's and mr-board's author scoping. */
async function runAuthorScopeFlows(
  fixture: ProviderFixture,
  report: Reporter,
  state: FlowFixture | null,
  setupError: string | null
): Promise<void> {
  const { provider, projectPath } = fixture;

  // U13 (mr-board + rt; consumer-mr-board.md § use cases #3, consumer-rt.md
  // § use cases #6): the deep-sync half of author scoping. Same authors in,
  // same authors out, no org-wide leakage. The row also names the search
  // query GitHubProvider builds ("<state> is:pr repo:<path> author:<user>");
  // no response carries that string, so it is asserted through its observable
  // consequences -- repo-scoped, author-scoped, state-scoped results -- which
  // is what a consumer can actually depend on.
  await check(
    report,
    fixture,
    'U13 mr-board/rt: fetchPullRequests({projectPath, authorUsernames, state}) returns exactly those authors, scoped to that repo',
    async () => {
      const s = requireFixture(state, setupError);
      if (s.searchLag) throw new Inconclusive(s.searchLag);

      const mine = await provider.fetchPullRequests({
        projectPath,
        authorUsernames: [s.ownerUsername],
        state: 'opened'
      });
      assert(mine.length > 0, `no open MRs authored by ${s.ownerUsername} came back`);
      for (const pr of mine) {
        assert(
          pr.author.username.toLowerCase() === s.ownerUsername.toLowerCase(),
          `author scoping leaked PR ${pr.iid} authored by ${pr.author.username}`
        );
        assert(
          pr.repositoryId === s.repositoryId,
          `author scoping leaked PR ${pr.iid} from repositoryId ${pr.repositoryId}, not ${s.repositoryId}`
        );
        assert(pr.state === 'opened', `state scoping leaked a "${pr.state}" MR`);
      }

      // An empty set selects the mode and asks for no MRs; it must not be
      // read as "no filter" and answer with the whole project.
      const empty = await provider.fetchPullRequests({
        projectPath,
        authorUsernames: [],
        state: 'opened'
      });
      assert(empty.length === 0, `an empty authorUsernames returned ${empty.length} MRs`);

      // And the option is unanswerable without a project, so it throws rather
      // than quietly answering the involvement question instead.
      let threw = false;
      try {
        await provider.fetchPullRequests({ authorUsernames: [s.ownerUsername] });
      } catch {
        threw = true;
      }
      assert(threw, 'authorUsernames without projectPath resolved instead of throwing');

      if (!s.secondAuthor) {
        throw new Inconclusive(
          `single-author scoping holds, but "same authors in, same authors out" for a MULTI-author set is unverified: ${s.secondAuthorReason}`
        );
      }
      const other = await provider.fetchPullRequests({
        projectPath,
        authorUsernames: [s.secondAuthor.username],
        state: 'opened'
      });
      assert(
        other.some(pr => pr.iid === s.secondAuthor!.pr.iid),
        `the second author's MR ${s.secondAuthor.pr.iid} is missing from their own author scope`
      );
      for (const pr of other) {
        assert(
          pr.author.username.toLowerCase() === s.secondAuthor.username.toLowerCase(),
          `the second author's scope leaked PR ${pr.iid} authored by ${pr.author.username}`
        );
      }
      const both = await provider.fetchPullRequests({
        projectPath,
        authorUsernames: [s.ownerUsername, s.secondAuthor.username],
        state: 'opened'
      });
      const union = new Set([...mine, ...other].map(pr => pr.iid));
      const got = new Set(both.map(pr => pr.iid));
      for (const iid of union) {
        assert(got.has(iid), `the two-author fetch dropped MR ${iid} that a single-author fetch returned`);
      }
      for (const pr of both) {
        const author = pr.author.username.toLowerCase();
        assert(
          author === s.ownerUsername.toLowerCase() || author === s.secondAuthor!.username.toLowerCase(),
          `the two-author fetch returned PR ${pr.iid} authored by ${pr.author.username}, who was not asked for`
        );
      }
    }
  );

  // U14 (rt, consumer-rt.md § use cases #1): rt's deep sync computes
  // `effectiveAuthors` (every live demand's authors, plus the token user,
  // sorted and de-duplicated) and, when that set is non-empty, calls the
  // author-scoped fetch INSTEAD of the unscoped `{state:'opened',
  // listWeight:true}` sweep. The claim is about the call rt issues, which no
  // response body shows, so the options are recorded on the way into a real
  // live fetch.
  await check(
    report,
    fixture,
    'U14 rt: a non-empty effectiveAuthors sends exactly that sorted, deduped set and the unscoped sweep is never called',
    async () => {
      const s = requireFixture(state, setupError);
      if (s.searchLag) throw new Inconclusive(s.searchLag);

      // mr-board is the external caller that registers a demand (its
      // `boardDemand.authors` is `config.members`), so the demand shape here
      // is mr-board's; the duplicate is deliberate, since effectiveAuthors
      // dedupes across demands and the token user.
      const demands = [[s.ownerUsername], [s.ownerUsername, s.secondAuthor?.username ?? s.ownerUsername]];
      const scopeAuthors = effectiveAuthors(demands, s.ownerUsername);
      assert(scopeAuthors !== null, 'effectiveAuthors returned null for a non-empty demand set');
      assert(
        JSON.stringify(scopeAuthors) === JSON.stringify([...new Set(scopeAuthors)].sort()),
        `effectiveAuthors produced ${JSON.stringify(scopeAuthors)}, which is not sorted and deduped`
      );

      const calls: (FetchPullRequestsOptions | undefined)[] = [];
      const recorded = recordingProvider(provider, calls);

      // rt's deep sync, verbatim in shape: scoped branch taken, unscoped
      // branch left alone.
      const prs = await recorded.fetchPullRequests({
        projectPath,
        authorUsernames: scopeAuthors,
        state: 'opened'
      });
      const kept = withinWindow(prs, 30, Date.now());

      assert(calls.length === 1, `rt's scoped deep sync issued ${calls.length} fetches, expected exactly 1`);
      const sent = calls[0];
      assert(sent !== undefined, 'the recorded call carried no options at all');
      assert(
        JSON.stringify(sent.authorUsernames) === JSON.stringify(scopeAuthors),
        `the SDK received authorUsernames ${JSON.stringify(sent.authorUsernames)}, not ${JSON.stringify(scopeAuthors)}`
      );
      assert(sent.projectPath === projectPath, `the SDK received projectPath ${JSON.stringify(sent.projectPath)}`);
      assert(sent.state === 'opened', `the SDK received state ${JSON.stringify(sent.state)}`);
      // `listWeight` is the unscoped sweep's marker: rt only sets it on the
      // project-wide fetch it must not make while a scope exists.
      assert(
        sent.listWeight === undefined,
        'the scoped fetch carried listWeight, the marker of the unscoped project sweep'
      );
      assert(
        kept.some(pr => pr.iid === s.stackPr.iid),
        `rt's 30-day window dropped PR ${s.stackPr.iid}, created moments ago`
      );
      for (const pr of prs) {
        assert(
          scopeAuthors.some(a => a.toLowerCase() === pr.author.username.toLowerCase()),
          `the scoped sync received PR ${pr.iid} authored by ${pr.author.username}, outside the requested scope`
        );
      }
    }
  );

  // U15 (rt, consumer-rt.md § use cases #2): rt's DELTA path queries the whole
  // project by `updatedAfter` (which carries no author filter) and re-applies
  // the author scope client-side. The rule that matters is the negative one,
  // asserted by rt's own mapping test: a PR with a missing `author.username`
  // is KEPT, never guess-dropped, because nothing says which side of the
  // scope it belongs on.
  await check(
    report,
    fixture,
    'U15 rt: the delta post-filter keeps in-scope authors plus every author-less PR, and drops only out-of-scope ones',
    async () => {
      const s = requireFixture(state, setupError);
      // rt's delta window is its own freshness minus DELTA_OVERLAP_MS (2 min);
      // 15 minutes back is the same shape with enough slack to cover this
      // suite's own setup.
      const updatedAfter = new Date(Date.now() - 15 * 60_000).toISOString();
      const states: MRState[] = ['opened', 'merged', 'closed'];
      const prs = await provider.fetchPullRequests({
        projectPath,
        state: states,
        updatedAfter,
        listWeight: true
      });
      assert(
        prs.some(pr => pr.iid === s.stackPr.iid),
        `the delta window missed PR ${s.stackPr.iid}, which this suite updated moments ago`
      );

      const scope = [s.ownerUsername];
      const filtered = rtScopeFilter(prs, scope);
      for (const pr of filtered) {
        assert(
          !pr.author?.username || scope.includes(pr.author.username),
          `the post-filter kept PR ${pr.iid} authored by ${pr.author.username}, outside the scope`
        );
      }
      for (const pr of prs) {
        if (filtered.includes(pr)) continue;
        assert(
          Boolean(pr.author?.username) && !scope.includes(pr.author.username),
          `the post-filter dropped PR ${pr.iid} whose author is ${JSON.stringify(pr.author?.username)}`
        );
      }

      // The never-guess-drop rule, on a shape the live forge will not produce:
      // an author-less PR must survive a scope it does not match.
      const anonymous = {
        ...prs[0]!,
        author: { ...prs[0]!.author, username: '' }
      } as PullRequest;
      const withAnonymous = rtScopeFilter([...prs, anonymous], ['somebody-else']);
      assert(
        withAnonymous.includes(anonymous),
        'a PR with no author.username was guess-dropped by the scope filter'
      );
      assert(
        !withAnonymous.some(pr => pr !== anonymous && pr.author?.username === s.ownerUsername),
        'the filter kept an out-of-scope author, so the anonymous keep above proves nothing'
      );
    }
  );
}
