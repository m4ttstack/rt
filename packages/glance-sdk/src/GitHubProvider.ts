/**
 * GitHub provider implementation (Phase C1 spike).
 *
 * Uses the GitHub REST API v3 to fetch pull requests, PR details, and
 * discussions. Maps GitHub responses to the same provider-agnostic domain
 * types used by GitLab, so the Swift client renders them identically.
 *
 * Auth: expects a GitHub Personal Access Token (classic or fine-grained)
 * with `repo` scope. Passed as `Authorization: Bearer <token>`.
 *
 * Base URL: "https://api.github.com" for github.com; for GHES, the user
 * provides the instance URL and we append "/api/v3".
 */

import type { GitProvider } from './GitProvider.ts';
import type {
  BranchProtectionRule,
  CreatePullRequestInput,
  DiffStats,
  Discussion,
  MergePullRequestInput,
  MRDetail,
  Note,
  NoteAuthor,
  NotePosition,
  Pipeline,
  PipelineJob,
  ProviderCapabilities,
  PullRequest,
  UpdatePullRequestInput,
  UserRef
} from './types.ts';
import { type ForgeLogger, noopLogger } from './logger.ts';

// ---------------------------------------------------------------------------
// GitHub REST API response shapes (only fields we consume)
// ---------------------------------------------------------------------------

interface GHUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url: string | null;
}

interface GHLabel {
  id: number;
  name: string;
  color: string;
}

interface GHPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string; // "open" | "closed"
  draft: boolean;
  merged_at: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  head: {
    sha: string;
    ref: string;
  };
  base: {
    ref: string;
    repo: {
      id: number;
      full_name: string;
    };
  };
  user: GHUser;
  assignees: GHUser[];
  requested_reviewers: GHUser[];
  labels: GHLabel[];
  additions?: number;
  deletions?: number;
  changed_files?: number;
  mergeable?: boolean | null;
  mergeable_state?: string; // "dirty" | "clean" | "unstable" | "blocked" | ...
  auto_merge?: {
    enabled_by: GHUser;
    merge_method: string; // "merge" | "squash" | "rebase"
  } | null;
}

interface GHReview {
  id: number;
  user: GHUser;
  state: string; // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
  submitted_at: string;
}

interface GHCheckRun {
  id: number;
  name: string;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped" | null
  html_url: string;
}

interface GHCheckSuite {
  check_runs: GHCheckRun[];
  total_count: number;
}

interface GHComment {
  id: number;
  body: string;
  user: GHUser;
  created_at: string;
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
  diff_hunk?: string | null;
  pull_request_review_id?: number | null;
  in_reply_to_id?: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toUserRef(u: GHUser): UserRef {
  return {
    id: `github:user:${u.id}`,
    username: u.login,
    name: u.name ?? u.login,
    avatarUrl: u.avatar_url
  };
}

/**
 * Normalize GitHub PR state to our domain states.
 * GitHub only has "open" and "closed"; we check `merged_at` to distinguish merges.
 */
function normalizePRState(pr: GHPullRequest): string {
  if (pr.merged_at) return 'merged';
  if (pr.state === 'open') return 'opened';
  return 'closed';
}

/**
 * Map GitHub check runs to our Pipeline model.
 * GitHub doesn't have a single "pipeline" concept; we synthesize one from check runs.
 */
function toPipeline(
  checkRuns: GHCheckRun[],
  prHtmlUrl: string
): Pipeline | null {
  if (checkRuns.length === 0) return null;

  const jobs: PipelineJob[] = checkRuns.map(cr => ({
    id: `github:check:${cr.id}`,
    name: cr.name,
    stage: 'checks', // GitHub doesn't have stages; use a flat stage name
    status: normalizeCheckStatus(cr),
    allowFailure: false,
    webUrl: cr.html_url
  }));

  // Derive overall pipeline status from individual check runs
  const statuses = jobs.map(j => j.status);
  let overallStatus: string;
  if (statuses.some(s => s === 'failed')) {
    overallStatus = 'failed';
  } else if (statuses.some(s => s === 'running')) {
    overallStatus = 'running';
  } else if (statuses.some(s => s === 'pending')) {
    overallStatus = 'pending';
  } else if (statuses.every(s => s === 'success' || s === 'skipped')) {
    overallStatus = 'success';
  } else {
    overallStatus = 'pending';
  }

  return {
    id: `github:checks:${prHtmlUrl}`,
    status: overallStatus,
    createdAt: null,
    webUrl: `${prHtmlUrl}/checks`,
    jobs
  };
}

function normalizeCheckStatus(cr: GHCheckRun): string {
  if (cr.status === 'completed') {
    switch (cr.conclusion) {
      case 'success':
        return 'success';
      case 'failure':
      case 'timed_out':
        return 'failed';
      case 'cancelled':
        return 'canceled';
      case 'skipped':
        return 'skipped';
      case 'neutral':
        return 'success';
      case 'action_required':
        return 'manual';
      default:
        return 'pending';
    }
  }
  if (cr.status === 'in_progress') return 'running';
  return 'pending'; // "queued"
}

// ---------------------------------------------------------------------------
// GitHubProvider
// ---------------------------------------------------------------------------

export class GitHubProvider implements GitProvider {
  readonly providerName = 'github' as const;
  readonly baseURL: string;
  private readonly apiBase: string;
  private readonly token: string;
  private readonly log: ForgeLogger;

  /**
   * @param baseURL — The user-facing GitHub URL. For github.com: "https://github.com".
   *   For GHES: "https://github.mycompany.com".
   * @param token — A GitHub PAT (classic or fine-grained) with `repo` scope.
   * @param options.logger — Optional logger; defaults to noop.
   */
  constructor(
    baseURL: string,
    token: string,
    options: { logger?: ForgeLogger } = {}
  ) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.token = token;
    this.log = options.logger ?? noopLogger;

    // API base: github.com uses api.github.com; GHES uses <host>/api/v3
    if (
      this.baseURL === 'https://github.com' ||
      this.baseURL === 'https://www.github.com'
    ) {
      this.apiBase = 'https://api.github.com';
    } else {
      this.apiBase = `${this.baseURL}/api/v3`;
    }
  }

  // ── Capabilities ──────────────────────────────────────────────────────

  readonly capabilities: ProviderCapabilities = {
    canMerge: true,
    canApprove: true,
    canUnapprove: false,
    canRebase: false,
    canAutoMerge: false,
    canResolveDiscussions: false,
    canRetryPipeline: true,
    canRequestReReview: true
  };

  // ── GitProvider interface ─────────────────────────────────────────────────

  async validateToken(): Promise<UserRef> {
    const res = await this.api('GET', '/user');
    if (!res.ok) {
      throw new Error(
        `GitHub token validation failed: ${res.status} ${res.statusText}`
      );
    }
    const user = (await res.json()) as GHUser;
    return toUserRef(user);
  }

  async fetchPullRequests(): Promise<PullRequest[]> {
    // Fetch PRs where the user is involved (author, assignee, reviewer, mentioned)
    // The `pulls` search qualifier covers authored PRs; `review-requested` covers
    // review requests. We merge the results.

    const [authored, reviewRequested, assigned] = await Promise.all([
      this.searchPRs('is:open is:pr author:@me'),
      this.searchPRs('is:open is:pr review-requested:@me'),
      this.searchPRs('is:open is:pr assignee:@me')
    ]);

    // Deduplicate by PR number+repo
    const byKey = new Map<string, GHPullRequest>();
    const roles = new Map<string, string[]>();

    const addAll = (prs: GHPullRequest[], role: string) => {
      for (const pr of prs) {
        const key = `${pr.base.repo.id}:${pr.number}`;
        if (!byKey.has(key)) {
          byKey.set(key, pr);
          roles.set(key, [role]);
        } else {
          const existing = roles.get(key)!;
          if (!existing.includes(role)) existing.push(role);
        }
      }
    };

    addAll(authored, 'author');
    addAll(reviewRequested, 'reviewer');
    addAll(assigned, 'assignee');

    // For each unique PR, fetch check runs and reviews in parallel
    const entries = [...byKey.entries()];
    const results = await Promise.all(
      entries.map(async ([key, pr]) => {
        const prRoles = roles.get(key) ?? ['author'];
        const [reviews, checkRuns] = await Promise.all([
          this.fetchReviews(pr.base.repo.full_name, pr.number),
          this.fetchCheckRuns(pr.base.repo.full_name, pr.head.sha)
        ]);
        return this.toPullRequest(pr, prRoles, reviews, checkRuns);
      })
    );

    this.log.debug('GitHubProvider.fetchPullRequests', {
      count: results.length
    });
    return results;
  }

  async fetchSingleMR(
    projectPath: string,
    mrIid: number,
    _currentUserNumericId: number | null
  ): Promise<PullRequest | null> {
    // projectPath for GitHub is "owner/repo"
    try {
      const res = await this.api('GET', `/repos/${projectPath}/pulls/${mrIid}`);
      if (!res.ok) return null;

      const pr = (await res.json()) as GHPullRequest;
      const [reviews, checkRuns] = await Promise.all([
        this.fetchReviews(projectPath, mrIid),
        this.fetchCheckRuns(projectPath, pr.head.sha)
      ]);

      // Determine roles from the current user
      const currentUser = await this.api('GET', '/user');
      const currentUserData = (await currentUser.json()) as GHUser;
      const prRoles: string[] = [];
      if (pr.user.id === currentUserData.id) prRoles.push('author');
      if (pr.assignees.some(a => a.id === currentUserData.id))
        prRoles.push('assignee');
      if (pr.requested_reviewers.some(r => r.id === currentUserData.id))
        prRoles.push('reviewer');

      return this.toPullRequest(
        pr,
        prRoles.length > 0 ? prRoles : ['author'],
        reviews,
        checkRuns
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn('GitHubProvider.fetchSingleMR failed', {
        projectPath,
        mrIid,
        message
      });
      return null;
    }
  }

  async fetchMRDiscussions(
    repositoryId: string,
    mrIid: number
  ): Promise<MRDetail> {
    const repoId = parseInt(repositoryId.split(':').pop() ?? '0', 10);
    // We need the repo full_name. For now, look it up from the API.
    const repoRes = await this.api('GET', `/repositories/${repoId}`);
    if (!repoRes.ok) {
      throw new Error(`Failed to fetch repo: ${repoRes.status}`);
    }
    const repo = (await repoRes.json()) as { full_name: string };

    // Fetch review comments (diff-level) and issue comments (PR-level)
    const [reviewComments, issueComments] = await Promise.all([
      this.fetchAllPages<GHComment>(
        `/repos/${repo.full_name}/pulls/${mrIid}/comments?per_page=100`
      ),
      this.fetchAllPages<GHComment>(
        `/repos/${repo.full_name}/issues/${mrIid}/comments?per_page=100`
      )
    ]);

    // Group review comments into threads (by pull_request_review_id and in_reply_to_id)
    const discussions: Discussion[] = [];

    // Issue comments become individual discussions (no threading)
    for (const c of issueComments) {
      discussions.push({
        id: `gh-issue-comment-${c.id}`,
        resolvable: null,
        resolved: null,
        notes: [toNote(c)]
      });
    }

    // Group review comments by thread root
    const threadMap = new Map<number, GHComment[]>();
    for (const c of reviewComments) {
      const rootId = c.in_reply_to_id ?? c.id;
      const thread = threadMap.get(rootId) ?? [];
      thread.push(c);
      threadMap.set(rootId, thread);
    }

    for (const [rootId, comments] of threadMap) {
      comments.sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      discussions.push({
        id: `gh-review-thread-${rootId}`,
        resolvable: true,
        resolved: null, // GitHub doesn't have a native "resolved" state on review threads
        notes: comments.map(toNote)
      });
    }

    return { mrIid, repositoryId, discussions };
  }

  async fetchBranchProtectionRules(
    projectPath: string
  ): Promise<BranchProtectionRule[]> {
    const res = await this.api(
      'GET',
      `/repos/${projectPath}/branches?protected=true&per_page=100`
    );
    if (!res.ok) {
      throw new Error(
        `fetchBranchProtectionRules failed: ${res.status} ${await res.text()}`
      );
    }
    const branches = (await res.json()) as Array<{
      name: string;
      protected: boolean;
      protection?: {
        enabled: boolean;
        required_status_checks?: {
          enforcement_level: string;
          contexts: string[];
        } | null;
      };
    }>;

    const rules: BranchProtectionRule[] = [];
    for (const b of branches) {
      if (!b.protected) continue;
      // Fetch detailed protection for each protected branch
      const detailRes = await this.api(
        'GET',
        `/repos/${projectPath}/branches/${encodeURIComponent(b.name)}/protection`
      );
      if (!detailRes.ok) {
        rules.push({
          pattern: b.name,
          allowForcePush: false,
          allowDeletion: false,
          requiredApprovals: 0,
          requireStatusChecks: false
        });
        continue;
      }
      const detail = (await detailRes.json()) as {
        allow_force_pushes?: { enabled: boolean };
        allow_deletions?: { enabled: boolean };
        required_pull_request_reviews?: {
          required_approving_review_count?: number;
        } | null;
        required_status_checks?: { strict: boolean; contexts: string[] } | null;
      };
      rules.push({
        pattern: b.name,
        allowForcePush: detail.allow_force_pushes?.enabled ?? false,
        allowDeletion: detail.allow_deletions?.enabled ?? false,
        requiredApprovals:
          detail.required_pull_request_reviews
            ?.required_approving_review_count ?? 0,
        requireStatusChecks:
          detail.required_status_checks !== null &&
          detail.required_status_checks !== undefined,
        raw: detail as unknown as Record<string, unknown>
      });
    }
    return rules;
  }

  async deleteBranch(projectPath: string, branch: string): Promise<void> {
    const res = await this.api(
      'DELETE',
      `/repos/${projectPath}/git/refs/heads/${encodeURIComponent(branch)}`
    );
    if (!res.ok) {
      throw new Error(`deleteBranch failed: ${res.status} ${await res.text()}`);
    }
  }

  async fetchPullRequestByBranch(
    projectPath: string,
    sourceBranch: string
  ): Promise<PullRequest | null> {
    const res = await this.api(
      'GET',
      `/repos/${projectPath}/pulls?head=${projectPath.split('/')[0]}:${encodeURIComponent(sourceBranch)}&state=open&per_page=1`
    );
    if (!res.ok) {
      this.log.warn('fetchPullRequestByBranch failed', {
        projectPath,
        sourceBranch,
        status: res.status
      });
      return null;
    }
    const prs = (await res.json()) as GHPullRequest[];
    if (!prs[0]) return null;
    return this.fetchSingleMR(projectPath, prs[0].number, null);
  }

  async createPullRequest(input: CreatePullRequestInput): Promise<PullRequest> {
    const body: Record<string, unknown> = {
      head: input.sourceBranch,
      base: input.targetBranch,
      title: input.title
    };
    if (input.description != null) body.body = input.description;
    if (input.draft != null) body.draft = input.draft;

    const res = await this.api(
      'POST',
      `/repos/${input.projectPath}/pulls`,
      body
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`createPullRequest failed: ${res.status} ${text}`);
    }
    const created = (await res.json()) as GHPullRequest;

    // GitHub doesn't support reviewers/assignees/labels on create — add them separately
    if (input.reviewers?.length) {
      await this.api(
        'POST',
        `/repos/${input.projectPath}/pulls/${created.number}/requested_reviewers`,
        {
          reviewers: input.reviewers
        }
      );
    }
    if (input.assignees?.length) {
      await this.api(
        'POST',
        `/repos/${input.projectPath}/issues/${created.number}/assignees`,
        {
          assignees: input.assignees
        }
      );
    }
    if (input.labels?.length) {
      await this.api(
        'POST',
        `/repos/${input.projectPath}/issues/${created.number}/labels`,
        {
          labels: input.labels
        }
      );
    }

    const pr = await this.fetchSingleMR(
      input.projectPath,
      created.number,
      null
    );
    if (!pr) throw new Error('Created PR but failed to fetch it back');
    return pr;
  }

  async updatePullRequest(
    projectPath: string,
    mrIid: number,
    input: UpdatePullRequestInput
  ): Promise<PullRequest> {
    const body: Record<string, unknown> = {};
    if (input.title != null) body.title = input.title;
    if (input.description != null) body.body = input.description;
    if (input.draft != null) body.draft = input.draft;
    if (input.targetBranch != null) body.base = input.targetBranch;
    if (input.stateEvent)
      body.state = input.stateEvent === 'close' ? 'closed' : 'open';

    const res = await this.api(
      'PATCH',
      `/repos/${projectPath}/pulls/${mrIid}`,
      body
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`updatePullRequest failed: ${res.status} ${text}`);
    }

    // Handle reviewers/assignees/labels replacement if provided
    if (input.reviewers) {
      await this.api(
        'POST',
        `/repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
        {
          reviewers: input.reviewers
        }
      );
    }
    if (input.assignees) {
      await this.api(
        'POST',
        `/repos/${projectPath}/issues/${mrIid}/assignees`,
        {
          assignees: input.assignees
        }
      );
    }
    if (input.labels) {
      await this.api('PUT', `/repos/${projectPath}/issues/${mrIid}/labels`, {
        labels: input.labels
      });
    }

    const pr = await this.fetchSingleMR(projectPath, mrIid, null);
    if (!pr) throw new Error('Updated PR but failed to fetch it back');
    return pr;
  }

  async restRequest(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    return this.api(method, path, body);
  }

  watchMR(
    _projectPath: string,
    _mrIid: number,
    _currentUserNumericId: number | null,
    _onUpdate: (pr: PullRequest) => void,
    _options?: import('./RealtimeWatcher.ts').RealtimeWatcherOptions
  ): () => void {
    throw new Error(
      'watchMR is not supported by the GitHub REST API. ' +
        'GitHub does not offer a WebSocket subscription equivalent. ' +
        'Check provider capabilities before calling.'
    );
  }

  async mergePullRequest(
    projectPath: string,
    mrIid: number,
    input?: MergePullRequestInput
  ): Promise<PullRequest> {
    const body: Record<string, unknown> = {};
    if (input?.commitMessage != null) body.commit_title = input.commitMessage;
    if (input?.squashCommitMessage != null)
      body.commit_title = input.squashCommitMessage;
    if (input?.shouldRemoveSourceBranch != null)
      body.delete_branch = input.shouldRemoveSourceBranch;
    if (input?.sha != null) body.sha = input.sha;

    // Map mergeMethod / squash to GitHub's merge_method parameter.
    // GitHub accepts: "merge", "squash", "rebase".
    if (input?.mergeMethod) {
      body.merge_method = input.mergeMethod;
    } else if (input?.squash) {
      body.merge_method = 'squash';
    }

    const res = await this.api(
      'PUT',
      `/repos/${projectPath}/pulls/${mrIid}/merge`,
      body
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`mergePullRequest failed: ${res.status} ${text}`);
    }
    const pr = await this.fetchSingleMR(projectPath, mrIid, null);
    if (!pr) throw new Error('Merged PR but failed to fetch it back');
    return pr;
  }

  async approvePullRequest(projectPath: string, mrIid: number): Promise<void> {
    const res = await this.api(
      'POST',
      `/repos/${projectPath}/pulls/${mrIid}/reviews`,
      {
        event: 'APPROVE'
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `approvePullRequest failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
  }

  async unapprovePullRequest(
    _projectPath: string,
    _mrIid: number
  ): Promise<void> {
    // TODO: GitHub does not support unapproving via REST API.
    // A possible workaround is to dismiss the review via
    //   PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals
    // but that requires knowing the review ID and is semantically different
    // (dismissal vs. unapproval). Leave as stub until a use case emerges.
    throw new Error(
      'unapprovePullRequest is not supported by GitHub. ' +
        'Check provider.capabilities.canUnapprove before calling.'
    );
  }

  async rebasePullRequest(_projectPath: string, _mrIid: number): Promise<void> {
    // TODO: GitHub has no native "rebase" API for pull requests.
    // The closest equivalent is the update-branch API:
    //   PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch
    // which updates the PR branch with the latest from the base branch,
    // but it's a merge (not a rebase). True rebase requires pushing
    // locally rebased commits.
    throw new Error(
      'rebasePullRequest is not supported by GitHub. ' +
        'Check provider.capabilities.canRebase before calling.'
    );
  }

  async setAutoMerge(_projectPath: string, _mrIid: number): Promise<void> {
    // TODO: GitHub supports auto-merge via GraphQL mutation:
    //   mutation { enablePullRequestAutoMerge(input: { pullRequestId: "..." }) { ... } }
    // Requires the repository to have "Allow auto-merge" enabled in settings.
    // The REST API does not support this — GraphQL only.
    throw new Error(
      'setAutoMerge is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canAutoMerge before calling.'
    );
  }

  async cancelAutoMerge(_projectPath: string, _mrIid: number): Promise<void> {
    // TODO: GitHub GraphQL mutation:
    //   mutation { disablePullRequestAutoMerge(input: { pullRequestId: "..." }) { ... } }
    // Same pre-requisites as setAutoMerge.
    throw new Error(
      'cancelAutoMerge is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canAutoMerge before calling.'
    );
  }

  // ── Discussion mutations ────────────────────────────────────────────────

  async resolveDiscussion(
    _projectPath: string,
    _mrIid: number,
    _discussionId: string
  ): Promise<void> {
    // TODO: GitHub GraphQL mutation:
    //   mutation { resolveReviewThread(input: { threadId: "..." }) { ... } }
    // REST API does not support resolving review threads.
    throw new Error(
      'resolveDiscussion is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canResolveDiscussions before calling.'
    );
  }

  async unresolveDiscussion(
    _projectPath: string,
    _mrIid: number,
    _discussionId: string
  ): Promise<void> {
    // TODO: GitHub GraphQL mutation:
    //   mutation { unresolveReviewThread(input: { threadId: "..." }) { ... } }
    // REST API does not support unresolving review threads.
    throw new Error(
      'unresolveDiscussion is not supported by the GitHub REST API. ' +
        'Check provider.capabilities.canResolveDiscussions before calling.'
    );
  }

  // ── Pipeline mutations ──────────────────────────────────────────────────

  async retryPipeline(projectPath: string, pipelineId: number): Promise<void> {
    // GitHub Actions: re-run a workflow run.
    // pipelineId maps to the workflow run ID.
    const res = await this.api(
      'POST',
      `/repos/${projectPath}/actions/runs/${pipelineId}/rerun`
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `retryPipeline failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
  }

  // ── Review mutations ────────────────────────────────────────────────────

  async requestReReview(
    projectPath: string,
    mrIid: number,
    reviewerUsernames?: string[]
  ): Promise<void> {
    // GitHub: POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers
    // If no usernames provided, we'd need to fetch the current PR to get
    // the existing reviewer list. For now, require explicit usernames.
    if (!reviewerUsernames?.length) {
      // Fetch current reviewers from the PR
      const prRes = await this.api(
        'GET',
        `/repos/${projectPath}/pulls/${mrIid}`
      );
      if (!prRes.ok) {
        throw new Error(`requestReReview: failed to fetch PR: ${prRes.status}`);
      }
      const pr = (await prRes.json()) as GHPullRequest;
      reviewerUsernames = pr.requested_reviewers.map(r => r.login);
      if (!reviewerUsernames.length) {
        // Nothing to re-request
        return;
      }
    }

    const res = await this.api(
      'POST',
      `/repos/${projectPath}/pulls/${mrIid}/requested_reviewers`,
      { reviewers: reviewerUsernames }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `requestReReview failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private async api(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Response> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    return fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  }

  /**
   * Search for PRs using the GitHub search API.
   * Returns up to 100 results per query.
   */
  private async searchPRs(qualifiers: string): Promise<GHPullRequest[]> {
    const q = encodeURIComponent(qualifiers);
    const res = await this.api(
      'GET',
      `/search/issues?q=${q}&per_page=100&sort=updated`
    );
    if (!res.ok) {
      this.log.warn('GitHub search failed', { status: res.status, qualifiers });
      return [];
    }

    const data = (await res.json()) as {
      items: Array<{
        number: number;
        pull_request?: { url: string };
        repository_url: string;
      }>;
    };

    // The search API returns issue-shaped results; fetch full PR details
    const prPromises = data.items
      .filter(item => item.pull_request) // Only PRs
      .map(async item => {
        // Extract owner/repo from repository_url
        const repoPath = item.repository_url.replace(
          `${this.apiBase}/repos/`,
          ''
        );
        const res = await this.api(
          'GET',
          `/repos/${repoPath}/pulls/${item.number}`
        );
        if (!res.ok) return null;
        return (await res.json()) as GHPullRequest;
      });

    const results = await Promise.all(prPromises);
    return results.filter((pr): pr is GHPullRequest => pr !== null);
  }

  private async fetchReviews(
    repoPath: string,
    prNumber: number
  ): Promise<GHReview[]> {
    return this.fetchAllPages<GHReview>(
      `/repos/${repoPath}/pulls/${prNumber}/reviews?per_page=100`
    );
  }

  private async fetchCheckRuns(
    repoPath: string,
    sha: string
  ): Promise<GHCheckRun[]> {
    try {
      const res = await this.api(
        'GET',
        `/repos/${repoPath}/commits/${sha}/check-runs?per_page=100`
      );
      if (!res.ok) return [];
      const data = (await res.json()) as GHCheckSuite;
      return data.check_runs;
    } catch {
      return [];
    }
  }

  private async fetchAllPages<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let url: string | null = path;

    while (url) {
      const res = await this.api('GET', url);
      if (!res.ok) break;
      const items = (await res.json()) as T[];
      results.push(...items);

      // Parse Link header for pagination
      const linkHeader = res.headers.get('Link');
      const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        // Strip apiBase prefix — `api()` will re-add it
        url = nextMatch[1]!.replace(this.apiBase, '');
      } else {
        url = null;
      }
    }

    return results;
  }

  /**
   * Convert a GitHub PR + reviews + check runs into our domain PullRequest.
   */
  private toPullRequest(
    pr: GHPullRequest,
    roles: string[],
    reviews: GHReview[],
    checkRuns: GHCheckRun[]
  ): PullRequest {
    // Compute approvals: latest review per user, count "APPROVED" ones
    const latestReviewByUser = new Map<number, GHReview>();
    for (const r of reviews.sort(
      (a, b) =>
        new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime()
    )) {
      latestReviewByUser.set(r.user.id, r);
    }

    const approvedBy: UserRef[] = [];
    let changesRequested = 0;
    for (const r of latestReviewByUser.values()) {
      if (r.state === 'APPROVED') {
        approvedBy.push(toUserRef(r.user));
      } else if (r.state === 'CHANGES_REQUESTED') {
        changesRequested++;
      }
    }

    // GitHub doesn't expose required approval count via REST without the
    // branch protection API. We use changesRequested as a blocking signal:
    // 0 = not blocked by reviews, 1 = at least one CHANGES_REQUESTED review.
    const approvalsLeft = changesRequested > 0 ? 1 : 0;

    const diffStats: DiffStats | null =
      pr.additions !== undefined
        ? {
            additions: pr.additions!,
            deletions: pr.deletions ?? 0,
            filesChanged: pr.changed_files ?? 0
          }
        : null;

    // Conflicts: GitHub's mergeable_state "dirty" indicates conflicts
    const conflicts = pr.mergeable === false || pr.mergeable_state === 'dirty';

    const pipeline = toPipeline(checkRuns, pr.html_url);

    return {
      id: `github:pr:${pr.id}`,
      iid: pr.number,
      repositoryId: `github:${pr.base.repo.id}`,
      title: pr.title,
      state: normalizePRState(pr),
      draft: pr.draft,
      conflicts,
      webUrl: pr.html_url,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      sha: pr.head.sha,
      author: toUserRef(pr.user),
      assignees: pr.assignees.map(toUserRef),
      reviewers: pr.requested_reviewers.map(u => ({
        ...toUserRef(u),
        reviewState: null as import('./types.ts').Reviewer['reviewState']
      })),
      roles,
      pipeline,
      description: pr.body ?? null,
      unresolvedThreadCount: 0, // Would need separate API call to count; keep 0 for spike
      approvalsLeft,
      approved: approvedBy.length > 0 && changesRequested === 0,
      approvedBy,
      diffStats,
      detailedMergeStatus: pr.mergeable_state ?? null, // "clean"|"dirty"|"blocked"|"unstable"|"behind"|"draft"
      autoMergeEnabled: pr.auto_merge != null,
      autoMergeStrategy: pr.auto_merge?.merge_method ?? null,
      mergeUser: pr.auto_merge ? toUserRef(pr.auto_merge.enabled_by) : null,
      mergeAfter: null, // GitHub doesn't have scheduled merge
      divergedCommitsCount: null, // Would need GET /compare/{base}...{head} — too costly per PR
      rebaseInProgress: false,
      mergeOngoing: false,
      inProgressMergeCommitSha: null,
      mergeError: null,
      shouldBeRebased: false,
      mergeabilityChecks: [], // GitHub doesn't expose individual check list via REST
      blockingMergeRequestsCount: 0,
      approvalsRequired: 0, // Not available without branch protection API
      squash: false,
      squashOnMerge: false,
      mergeTrainIndex: null
    };
  }
}

// ---------------------------------------------------------------------------
// Note mapping
// ---------------------------------------------------------------------------

function toNote(c: GHComment): Note {
  const position: NotePosition | null = c.path
    ? {
        newPath: c.path,
        oldPath: c.path,
        newLine: c.line ?? null,
        oldLine: c.original_line ?? null,
        positionType: c.path ? 'text' : null
      }
    : null;

  return {
    id: c.id,
    body: c.body,
    author: toNoteAuthor(c.user),
    createdAt: c.created_at,
    system: false,
    type: c.path ? 'DiffNote' : 'DiscussionNote',
    resolvable: c.path ? true : null,
    resolved: null,
    position
  };
}

function toNoteAuthor(u: GHUser): NoteAuthor {
  return {
    id: `github:user:${u.id}`,
    username: u.login,
    name: u.name ?? u.login,
    avatarUrl: u.avatar_url
  };
}
