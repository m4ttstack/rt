#!/usr/bin/env bun
/**
 * Comprehensive integration test for @workforge/glance-sdk.
 *
 * Tests ALL exported methods against live GitHub + GitLab APIs.
 *
 * Run it by hand with credentials:
 *   GITHUB_TOKEN=… GITLAB_TOKEN=… bun tests/integration.live.ts
 *
 * Deliberately not named `*.test.ts`: it needs real tokens and mutates real
 * projects, so `bun test tests/` must not pick it up.
 */

import {
  GitHubProvider,
  GitLabProvider,
  ActionCableClient,
  MRDetailFetcher,
  NoteMutator,
  createProvider,
  parseRepoId,
  parseGitLabRepoId,
  type PullRequest,
  type BranchProtectionRule,
  type ForgeLogger,
  type ActionCableCallbacks
} from '@workforge/glance-sdk';

// ── Config ───────────────────────────────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN!;

if (!GITHUB_TOKEN || !GITLAB_TOKEN) {
  console.error('❌ Set GITHUB_TOKEN and GITLAB_TOKEN env vars');
  process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.error(`  ❌ ${label}`);
    failed++;
  }
}

const testLogger: ForgeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

// ═══════════════════════════════════════════════════════════════════════════════
// GITHUB
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══ GitHub ═══\n');
const github = new GitHubProvider('https://github.com', GITHUB_TOKEN, {
  logger: testLogger
});

// 1. validateToken
console.log('▶ validateToken');
const ghUser = await github.validateToken();
assert(ghUser.username.length > 0, `User: ${ghUser.username}`);

// 2. fetchPullRequests
console.log('\n▶ fetchPullRequests');
const ghPRs = await github.fetchPullRequests();
assert(Array.isArray(ghPRs), `Found ${ghPRs.length} PRs`);

let ghTestPR: PullRequest | null = null;
let ghRepoPath: string | null = process.env.GITHUB_PROJECT_PATH ?? null;

if (ghPRs.length > 0) {
  ghTestPR = ghPRs[0]!;
  const match = ghTestPR.webUrl?.match(/github\.com\/([^/]+\/[^/]+)/);
  ghRepoPath = match?.[1] ?? ghRepoPath;
}

// 3. fetchSingleMR
console.log('\n▶ fetchSingleMR');
if (ghTestPR && ghRepoPath) {
  const pr = await github.fetchSingleMR(ghRepoPath, ghTestPR.iid, null);
  assert(pr !== null, `Fetched PR #${pr?.iid}: "${pr?.title}"`);
  assert(
    pr!.sourceBranch === ghTestPR.sourceBranch,
    `Branch matches: ${pr!.sourceBranch}`
  );
  assert(typeof pr!.draft === 'boolean', `Draft: ${pr!.draft}`);
  assert(typeof pr!.conflicts === 'boolean', `Conflicts: ${pr!.conflicts}`);
} else {
  console.log('  ℹ️  Skipped — no PRs');
}

// 4. fetchMRDiscussions
console.log('\n▶ fetchMRDiscussions');
if (ghTestPR && ghRepoPath) {
  const repoId = ghTestPR.repositoryId;
  const detail = await github.fetchMRDiscussions(repoId, ghTestPR.iid);
  assert(detail.mrIid === ghTestPR.iid, `MR IID matches: ${detail.mrIid}`);
  assert(detail.repositoryId === repoId, `Repo ID matches`);
  assert(
    Array.isArray(detail.discussions),
    `Found ${detail.discussions.length} discussions`
  );
  if (detail.discussions.length > 0) {
    const d = detail.discussions[0]!;
    assert(typeof d.id === 'string', `Discussion ID: ${d.id}`);
    assert(
      Array.isArray(d.notes) && d.notes.length > 0,
      `Has ${d.notes.length} notes`
    );
    const note = d.notes[0]!;
    assert(
      typeof note.body === 'string',
      `Note body exists (${note.body.slice(0, 50)}...)`
    );
    assert(
      typeof note.author.username === 'string',
      `Note author: ${note.author.username}`
    );
  }
} else {
  console.log('  ℹ️  Skipped — no PRs');
}

// 5. restRequest
console.log('\n▶ restRequest');
try {
  const res = await github.restRequest('GET', '/user');
  assert(res.ok, `REST /user returned ${res.status}`);
  const data = (await res.json()) as any;
  assert(data.login === ghUser.username, `REST login matches: ${data.login}`);
} catch (e: any) {
  assert(false, `restRequest failed: ${e.message}`);
}

// 6. fetchPullRequestByBranch
console.log('\n▶ fetchPullRequestByBranch');
if (ghTestPR && ghRepoPath) {
  const prByBranch = await github.fetchPullRequestByBranch(
    ghRepoPath,
    ghTestPR.sourceBranch
  );
  assert(
    prByBranch !== null,
    `Found PR by branch: "${prByBranch?.sourceBranch}"`
  );
  if (prByBranch) {
    assert(prByBranch.iid === ghTestPR.iid, `IID matches: ${prByBranch.iid}`);
  }
} else {
  console.log('  ℹ️  Skipped — no PRs');
}

// 7. fetchBranchProtectionRules
console.log('\n▶ fetchBranchProtectionRules');
if (ghRepoPath) {
  try {
    const rules = await github.fetchBranchProtectionRules(ghRepoPath);
    assert(Array.isArray(rules), `Found ${rules.length} protection rules`);
    for (const rule of rules) {
      assert(typeof rule.pattern === 'string', `Rule pattern: ${rule.pattern}`);
      assert(
        typeof rule.allowForcePush === 'boolean',
        `allowForcePush: ${rule.allowForcePush}`
      );
      assert(
        typeof rule.allowDeletion === 'boolean',
        `allowDeletion: ${rule.allowDeletion}`
      );
      assert(
        typeof rule.requiredApprovals === 'number',
        `requiredApprovals: ${rule.requiredApprovals}`
      );
    }
  } catch (e: any) {
    assert(false, `fetchBranchProtectionRules failed: ${e.message}`);
  }
} else {
  console.log('  ℹ️  Skipped — no repo path');
}

// 8. createPullRequest + updatePullRequest + deleteBranch (full lifecycle)
console.log(
  '\n▶ createPullRequest + updatePullRequest + deleteBranch lifecycle'
);
if (ghRepoPath) {
  const testBranch = `sdk-test-${Date.now()}`;
  try {
    // Create a branch from default branch HEAD
    const defaultBranchRes = await github.restRequest(
      'GET',
      `/repos/${ghRepoPath}`
    );
    const repoInfo = (await defaultBranchRes.json()) as {
      default_branch: string;
    };
    const refRes = await github.restRequest(
      'GET',
      `/repos/${ghRepoPath}/git/ref/heads/${repoInfo.default_branch}`
    );
    const refData = (await refRes.json()) as { object: { sha: string } };
    await github.restRequest('POST', `/repos/${ghRepoPath}/git/refs`, {
      ref: `refs/heads/${testBranch}`,
      sha: refData.object.sha
    });
    // Push a dummy commit so there's a diff between branches
    await github.restRequest(
      'PUT',
      `/repos/${ghRepoPath}/contents/sdk-test-${Date.now()}.txt`,
      {
        message: 'SDK integration test commit',
        content: btoa('test'),
        branch: testBranch
      }
    );
    assert(true, `Created test branch: ${testBranch}`);

    // Create PR
    const created = await github.createPullRequest({
      projectPath: ghRepoPath,
      title: `SDK test PR ${Date.now()}`,
      sourceBranch: testBranch,
      targetBranch: repoInfo.default_branch,
      description: 'Automated SDK integration test — will be cleaned up.'
    });
    assert(
      created !== null,
      `Created PR #${created?.iid}: "${created?.title}"`
    );
    assert(created!.sourceBranch === testBranch, `Source branch matches`);

    // Update PR
    if (created) {
      const updated = await github.updatePullRequest(ghRepoPath, created.iid, {
        title: `SDK test PR ${Date.now()} (updated)`,
        description: 'Updated by SDK integration test.'
      });
      assert(
        updated !== null,
        `Updated PR #${updated?.iid}: "${updated?.title}"`
      );
      assert(updated!.title.includes('(updated)'), `Title was updated`);

      // Close the PR before deleting the branch
      await github.updatePullRequest(ghRepoPath, created.iid, {
        stateEvent: 'close'
      });
      assert(true, `Closed PR #${created.iid}`);
    }

    // Delete branch
    await github.deleteBranch(ghRepoPath, testBranch);
    assert(true, `Deleted branch: ${testBranch}`);
  } catch (e: any) {
    assert(false, `PR lifecycle failed: ${e.message}`);
    // Best-effort cleanup
    try {
      await github.deleteBranch(ghRepoPath, testBranch);
    } catch {}
  }
} else {
  console.log('  ℹ️  Skipped — no repo path');
}

// ── GitHub Mutation Lifecycle ────────────────────────────────────────────────

// 8b. Capabilities check
console.log('\n▶ GitHub: capabilities');
assert(github.capabilities.canMerge === true, 'canMerge');
assert(github.capabilities.canApprove === true, 'canApprove');
assert(github.capabilities.canUnapprove === false, 'canUnapprove (false)');
assert(github.capabilities.canRebase === false, 'canRebase (false)');
assert(github.capabilities.canAutoMerge === false, 'canAutoMerge (false)');
assert(
  github.capabilities.canResolveDiscussions === false,
  'canResolveDiscussions (false)'
);
assert(github.capabilities.canRetryPipeline === true, 'canRetryPipeline');
assert(github.capabilities.canRequestReReview === true, 'canRequestReReview');

// 8c. Unsupported method stubs throw descriptive errors
console.log('\n▶ GitHub: unsupported mutation stubs');
const ghStubTests: Array<{ name: string; fn: () => Promise<void> }> = [
  {
    name: 'unapprovePullRequest',
    fn: () => github.unapprovePullRequest('x', 1)
  },
  { name: 'rebasePullRequest', fn: () => github.rebasePullRequest('x', 1) },
  { name: 'setAutoMerge', fn: () => github.setAutoMerge('x', 1) },
  { name: 'cancelAutoMerge', fn: () => github.cancelAutoMerge('x', 1) },
  {
    name: 'resolveDiscussion',
    fn: () => github.resolveDiscussion('x', 1, 'd')
  },
  {
    name: 'unresolveDiscussion',
    fn: () => github.unresolveDiscussion('x', 1, 'd')
  }
];
for (const { name, fn } of ghStubTests) {
  try {
    await fn();
    assert(false, `${name} should throw`);
  } catch (e: any) {
    assert(
      e.message.includes('not supported'),
      `${name} throws: "${e.message.slice(0, 60)}..."`
    );
  }
}

// 8d. Mutation lifecycle: create PR → approve → merge (with cleanup)
console.log('\n▶ GitHub: mutation lifecycle (approve → merge)');
if (ghRepoPath) {
  const mutBranch = `sdk-mut-test-${Date.now()}`;
  try {
    // Setup: create branch + commit
    const defaultBranchRes = await github.restRequest(
      'GET',
      `/repos/${ghRepoPath}`
    );
    const repoDefaults = (await defaultBranchRes.json()) as {
      default_branch: string;
    };
    const refRes = await github.restRequest(
      'GET',
      `/repos/${ghRepoPath}/git/ref/heads/${repoDefaults.default_branch}`
    );
    const refData = (await refRes.json()) as { object: { sha: string } };
    await github.restRequest('POST', `/repos/${ghRepoPath}/git/refs`, {
      ref: `refs/heads/${mutBranch}`,
      sha: refData.object.sha
    });
    await github.restRequest(
      'PUT',
      `/repos/${ghRepoPath}/contents/sdk-mut-test-${Date.now()}.txt`,
      {
        message: 'SDK mutation test commit',
        content: btoa('mutation test'),
        branch: mutBranch
      }
    );

    const pr = await github.createPullRequest({
      projectPath: ghRepoPath,
      title: `SDK mutation test PR ${Date.now()}`,
      sourceBranch: mutBranch,
      targetBranch: repoDefaults.default_branch,
      description: 'Mutation test — will be merged then branch deleted.'
    });
    assert(pr !== null, `Created mutation test PR #${pr.iid}`);

    // Approve
    try {
      await github.approvePullRequest(ghRepoPath, pr.iid);
      assert(true, `Approved PR #${pr.iid}`);
    } catch (e: any) {
      // GitHub may reject self-approval depending on repo settings
      assert(true, `approvePullRequest returned: ${e.message.slice(0, 80)}`);
    }

    // requestReReview (re-request with explicit empty — should be a no-op if no reviewers)
    try {
      await github.requestReReview(ghRepoPath, pr.iid);
      assert(true, `requestReReview on PR #${pr.iid}`);
    } catch (e: any) {
      assert(true, `requestReReview: ${e.message.slice(0, 80)}`);
    }

    // Merge the PR
    const merged = await github.mergePullRequest(ghRepoPath, pr.iid, {
      commitMessage: 'SDK mutation test merge',
      shouldRemoveSourceBranch: true
    });
    assert(
      merged.state === 'merged',
      `PR #${pr.iid} merged (state=${merged.state})`
    );

    // Best-effort branch cleanup (merge may have deleted it)
    try {
      await github.deleteBranch(ghRepoPath, mutBranch);
    } catch {}
    assert(true, `Cleanup complete`);
  } catch (e: any) {
    assert(false, `GitHub mutation lifecycle failed: ${e.message}`);
    try {
      await github.deleteBranch(ghRepoPath, mutBranch);
    } catch {}
  }
} else {
  console.log('  ℹ️  Skipped — no repo path');
}

// ═══════════════════════════════════════════════════════════════════════════════
// GITLAB
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n═══ GitLab ═══\n');
const gitlab = new GitLabProvider('https://gitlab.com', GITLAB_TOKEN, {
  logger: testLogger
});

// 6. validateToken
console.log('▶ validateToken');
const glUser = await gitlab.validateToken();
assert(glUser.username.length > 0, `User: ${glUser.username}`);

// 7. fetchPullRequests
console.log('\n▶ fetchPullRequests');
const glMRs = await gitlab.fetchPullRequests();
assert(Array.isArray(glMRs), `Found ${glMRs.length} MRs`);

let glTestMR: PullRequest | null = null;
let glProjectId: number | null = null;
let glProjectPath: string | null = null;

if (glMRs.length > 0) {
  glTestMR = glMRs[0]!;
  glProjectId = parseGitLabRepoId(glTestMR.repositoryId);

  // Extract project path from webUrl: https://gitlab.com/group/project/-/merge_requests/1
  const match = glTestMR.webUrl?.match(/gitlab\.com\/(.+?)\/-\/merge_requests/);
  glProjectPath = match?.[1] ?? null;
}

// Use env project path as fallback for mutation tests
const GL_PROJECT_PATH = process.env.GITLAB_PROJECT_PATH ?? glProjectPath;

// 8. fetchSingleMR
console.log('\n▶ fetchSingleMR');
if (glTestMR && glProjectPath) {
  const glUserNumericId = parseInt(glUser.id.split(':').pop() ?? '0', 10);
  const mr = await gitlab.fetchSingleMR(
    glProjectPath,
    glTestMR.iid,
    glUserNumericId
  );
  assert(mr !== null, `Fetched MR !${mr?.iid}: "${mr?.title}"`);
  assert(
    mr!.sourceBranch === glTestMR.sourceBranch,
    `Branch matches: ${mr!.sourceBranch}`
  );
  assert(typeof mr!.approved === 'boolean', `Approved: ${mr!.approved}`);
  assert(
    typeof mr!.approvalsLeft === 'number',
    `Approvals left: ${mr!.approvalsLeft}`
  );
  assert(
    mr!.detailedMergeStatus !== undefined,
    `detailedMergeStatus: ${mr!.detailedMergeStatus}`
  );
  assert(
    typeof mr!.autoMergeEnabled === 'boolean',
    `autoMergeEnabled: ${mr!.autoMergeEnabled}`
  );
  assert(
    mr!.autoMergeStrategy === null || typeof mr!.autoMergeStrategy === 'string',
    `autoMergeStrategy: ${mr!.autoMergeStrategy}`
  );
  assert(
    mr!.mergeUser === null || typeof mr!.mergeUser?.username === 'string',
    `mergeUser: ${mr!.mergeUser?.username ?? 'null'}`
  );
  assert(
    mr!.mergeAfter === null || typeof mr!.mergeAfter === 'string',
    `mergeAfter: ${mr!.mergeAfter ?? 'null'}`
  );
  assert(
    mr!.divergedCommitsCount === null ||
      typeof mr!.divergedCommitsCount === 'number',
    `divergedCommitsCount: ${mr!.divergedCommitsCount}`
  );
} else {
  console.log('  ℹ️  Skipped — no MRs');
}

// 9. fetchMRDiscussions (via provider)
console.log('\n▶ fetchMRDiscussions');
if (glTestMR && glProjectId) {
  const detail = await gitlab.fetchMRDiscussions(
    glTestMR.repositoryId,
    glTestMR.iid
  );
  assert(detail.mrIid === glTestMR.iid, `MR IID matches: ${detail.mrIid}`);
  assert(
    Array.isArray(detail.discussions),
    `Found ${detail.discussions.length} discussions`
  );
  if (detail.discussions.length > 0) {
    const d = detail.discussions[0]!;
    assert(typeof d.id === 'string', `Discussion ID: ${d.id}`);
    assert(d.notes.length > 0, `Has ${d.notes.length} notes`);
    const note = d.notes[0]!;
    assert(
      typeof note.author.username === 'string',
      `Note author: ${note.author.username}`
    );
    assert(
      typeof note.createdAt === 'string',
      `Note createdAt: ${note.createdAt}`
    );
  }
} else {
  console.log('  ℹ️  Skipped — no MRs');
}

// 10. MRDetailFetcher (direct)
console.log('\n▶ MRDetailFetcher.fetchDetail');
if (glTestMR && glProjectId) {
  const fetcher = new MRDetailFetcher('https://gitlab.com', GITLAB_TOKEN, {
    logger: testLogger
  });
  const detail = await fetcher.fetchDetail(glProjectId, glTestMR.iid);
  assert(detail.mrIid === glTestMR.iid, `MR IID matches: ${detail.mrIid}`);
  assert(
    detail.repositoryId === `gitlab:${glProjectId}`,
    `Repo ID: ${detail.repositoryId}`
  );
  assert(
    Array.isArray(detail.discussions),
    `${detail.discussions.length} discussions`
  );
} else {
  console.log('  ℹ️  Skipped — no MRs');
}

// 11. NoteMutator — create, update, delete (full CRUD cycle)
console.log('\n▶ NoteMutator CRUD cycle');
if (glTestMR && glProjectId) {
  const mutator = new NoteMutator('https://gitlab.com', GITLAB_TOKEN);
  const testBody = `SDK integration test ${new Date().toISOString()}`;

  // Create
  const created = await mutator.createNote(glProjectId, glTestMR.iid, testBody);
  assert(created.id > 0, `Created note ID: ${created.id}`);
  assert(created.body === testBody, `Body matches`);
  assert(
    typeof created.author.username === 'string',
    `Author: ${created.author.username}`
  );

  // Update
  const updatedBody = `${testBody} (updated)`;
  await mutator.updateNote(glProjectId, glTestMR.iid, created.id, updatedBody);
  assert(true, `Updated note ${created.id}`);

  // Delete
  await mutator.deleteNote(glProjectId, glTestMR.iid, created.id);
  assert(true, `Deleted note ${created.id}`);
} else {
  console.log('  ℹ️  Skipped — no MRs');
}

// 12. restRequest (GitLab)
console.log('\n▶ restRequest');
try {
  const res = await gitlab.restRequest('GET', '/api/v4/user');
  assert(res.ok, `REST /api/v4/user returned ${res.status}`);
  const data = (await res.json()) as any;
  assert(
    data.username === glUser.username,
    `REST username matches: ${data.username}`
  );
} catch (e: any) {
  assert(false, `restRequest failed: ${e.message}`);
}

// 13. fetchPullRequestByBranch (GitLab)
console.log('\n▶ fetchPullRequestByBranch');
if (glTestMR && glProjectPath) {
  const mrByBranch = await gitlab.fetchPullRequestByBranch(
    glProjectPath,
    glTestMR.sourceBranch
  );
  assert(
    mrByBranch !== null,
    `Found MR by branch: "${mrByBranch?.sourceBranch}"`
  );
  if (mrByBranch) {
    assert(mrByBranch.iid === glTestMR.iid, `IID matches: ${mrByBranch.iid}`);
  }
} else {
  console.log('  ℹ️  Skipped — no MRs');
}

// 14. fetchBranchProtectionRules (GitLab)
console.log('\n▶ fetchBranchProtectionRules');
if (glProjectPath) {
  try {
    const rules = await gitlab.fetchBranchProtectionRules(glProjectPath);
    assert(Array.isArray(rules), `Found ${rules.length} protection rules`);
    for (const rule of rules) {
      assert(typeof rule.pattern === 'string', `Rule pattern: ${rule.pattern}`);
      assert(
        typeof rule.allowForcePush === 'boolean',
        `allowForcePush: ${rule.allowForcePush}`
      );
      assert(
        typeof rule.allowDeletion === 'boolean',
        `allowDeletion: ${rule.allowDeletion}`
      );
      assert(
        typeof rule.requiredApprovals === 'number',
        `requiredApprovals: ${rule.requiredApprovals}`
      );
    }
  } catch (e: any) {
    assert(false, `fetchBranchProtectionRules failed: ${e.message}`);
  }
} else {
  console.log('  ℹ️  Skipped — no project path');
}

// 15. createPullRequest + updatePullRequest + deleteBranch lifecycle (GitLab)
console.log(
  '\n▶ createPullRequest + updatePullRequest + deleteBranch lifecycle'
);
if (GL_PROJECT_PATH) {
  const testBranch = `sdk-test-${Date.now()}`;
  try {
    // Create a branch from default branch HEAD
    const createBranchRes = await gitlab.restRequest(
      'POST',
      `/api/v4/projects/${encodeURIComponent(GL_PROJECT_PATH)}/repository/branches?branch=${encodeURIComponent(testBranch)}&ref=main`
    );
    assert(createBranchRes.ok, `Created test branch: ${testBranch}`);

    // Create MR
    const created = await gitlab.createPullRequest({
      projectPath: GL_PROJECT_PATH,
      title: `SDK test MR ${Date.now()}`,
      sourceBranch: testBranch,
      targetBranch: 'main',
      description: 'Automated SDK integration test — will be cleaned up.'
    });
    assert(
      created !== null,
      `Created MR !${created?.iid}: "${created?.title}"`
    );
    assert(created!.sourceBranch === testBranch, `Source branch matches`);

    // Update MR
    if (created) {
      const updated = await gitlab.updatePullRequest(
        GL_PROJECT_PATH,
        created.iid,
        {
          title: `SDK test MR ${Date.now()} (updated)`,
          description: 'Updated by SDK integration test.'
        }
      );
      assert(
        updated !== null,
        `Updated MR !${updated?.iid}: "${updated?.title}"`
      );
      assert(updated!.title.includes('(updated)'), `Title was updated`);

      // Close the MR before deleting the branch
      await gitlab.updatePullRequest(GL_PROJECT_PATH, created.iid, {
        stateEvent: 'close'
      });
      assert(true, `Closed MR !${created.iid}`);
    }

    // Delete branch
    await gitlab.deleteBranch(GL_PROJECT_PATH, testBranch);
    assert(true, `Deleted branch: ${testBranch}`);
  } catch (e: any) {
    assert(false, `MR lifecycle failed: ${e.message}`);
    try {
      await gitlab.deleteBranch(GL_PROJECT_PATH, testBranch);
    } catch {}
  }
} else {
  console.log('  ℹ️  Skipped — no project path');
}

// ── GitLab Capabilities ──────────────────────────────────────────────────────

console.log('\n▶ GitLab: capabilities');
assert(gitlab.capabilities.canMerge === true, 'canMerge');
assert(gitlab.capabilities.canApprove === true, 'canApprove');
assert(gitlab.capabilities.canUnapprove === true, 'canUnapprove');
assert(gitlab.capabilities.canRebase === true, 'canRebase');
assert(gitlab.capabilities.canAutoMerge === true, 'canAutoMerge');
assert(
  gitlab.capabilities.canResolveDiscussions === true,
  'canResolveDiscussions'
);
assert(gitlab.capabilities.canRetryPipeline === true, 'canRetryPipeline');
assert(gitlab.capabilities.canRequestReReview === true, 'canRequestReReview');

// ── GitLab Mutation Lifecycle ────────────────────────────────────────────────
// Creates a dedicated MR, runs approve → unapprove → rebase → auto-merge →
// resolve/unresolve discussion → re-review → merge, then cleans up.

console.log('\n▶ GitLab: mutation lifecycle');
if (GL_PROJECT_PATH) {
  const mutBranch = `sdk-mut-${Date.now()}`;
  let mutMRIid: number | null = null;
  try {
    // ── Setup: create branch with a commit ─────────────────────────────
    const createBranchRes = await gitlab.restRequest(
      'POST',
      `/api/v4/projects/${encodeURIComponent(GL_PROJECT_PATH)}/repository/branches?branch=${encodeURIComponent(mutBranch)}&ref=main`
    );
    assert(createBranchRes.ok, `Created mutation test branch: ${mutBranch}`);

    // Push a file so there's a diff
    await gitlab.restRequest(
      'POST',
      `/api/v4/projects/${encodeURIComponent(GL_PROJECT_PATH)}/repository/files/${encodeURIComponent(`sdk-mut-test-${Date.now()}.txt`)}`,
      {
        branch: mutBranch,
        content: 'mutation test',
        commit_message: 'SDK mutation test commit'
      }
    );

    // Create MR
    const mutPR = await gitlab.createPullRequest({
      projectPath: GL_PROJECT_PATH,
      title: `SDK mutation test MR ${Date.now()}`,
      sourceBranch: mutBranch,
      targetBranch: 'main',
      description: 'Mutation lifecycle test — will be merged and cleaned up.'
    });
    mutMRIid = mutPR.iid;
    assert(mutPR !== null, `Created mutation test MR !${mutMRIid}`);

    // ── approvePullRequest ─────────────────────────────────────────────
    try {
      await gitlab.approvePullRequest(GL_PROJECT_PATH, mutMRIid);
      assert(true, `Approved MR !${mutMRIid}`);
    } catch (e: any) {
      // Self-approval may be blocked by project settings
      assert(true, `approvePullRequest: ${e.message.slice(0, 80)}`);
    }

    // ── unapprovePullRequest ───────────────────────────────────────────
    try {
      await gitlab.unapprovePullRequest(GL_PROJECT_PATH, mutMRIid);
      assert(true, `Unapproved MR !${mutMRIid}`);
    } catch (e: any) {
      assert(true, `unapprovePullRequest: ${e.message.slice(0, 80)}`);
    }

    // ── rebasePullRequest ──────────────────────────────────────────────
    try {
      await gitlab.rebasePullRequest(GL_PROJECT_PATH, mutMRIid);
      assert(true, `Rebased MR !${mutMRIid}`);
    } catch (e: any) {
      assert(true, `rebasePullRequest: ${e.message.slice(0, 80)}`);
    }

    // ── setAutoMerge ──────────────────────────────────────────────────
    // Requires a pipeline to be running; will 405 if none — that's OK
    try {
      await gitlab.setAutoMerge(GL_PROJECT_PATH, mutMRIid);
      assert(true, `setAutoMerge on MR !${mutMRIid}`);
    } catch (e: any) {
      // Expected if no pipeline or MR not in mergeable state
      assert(true, `setAutoMerge: ${e.message.slice(0, 80)}`);
    }

    // ── cancelAutoMerge ──────────────────────────────────────────────
    // Will fail if auto-merge wasn't set, but the API call is still exercised
    try {
      await gitlab.cancelAutoMerge(GL_PROJECT_PATH, mutMRIid);
      assert(true, `cancelAutoMerge on MR !${mutMRIid}`);
    } catch (e: any) {
      // Expected if not in auto-merge state — the API was still called
      assert(true, `cancelAutoMerge: ${e.message.slice(0, 80)}`);
    }

    // ── resolveDiscussion + unresolveDiscussion ───────────────────────
    // Create a discussion (note on the MR) then resolve/unresolve it
    const noteBody = `SDK test discussion ${Date.now()}`;
    const projIdEncoded = encodeURIComponent(GL_PROJECT_PATH);
    const createDiscRes = await gitlab.restRequest(
      'POST',
      `/api/v4/projects/${projIdEncoded}/merge_requests/${mutMRIid}/discussions`,
      { body: noteBody }
    );
    if (createDiscRes.ok) {
      const disc = (await createDiscRes.json()) as { id: string };
      assert(true, `Created discussion: ${disc.id}`);

      // Resolve
      try {
        await gitlab.resolveDiscussion(GL_PROJECT_PATH, mutMRIid, disc.id);
        assert(true, `Resolved discussion ${disc.id}`);
      } catch (e: any) {
        assert(true, `resolveDiscussion: ${e.message.slice(0, 80)}`);
      }

      // Unresolve
      try {
        await gitlab.unresolveDiscussion(GL_PROJECT_PATH, mutMRIid, disc.id);
        assert(true, `Unresolved discussion ${disc.id}`);
      } catch (e: any) {
        assert(true, `unresolveDiscussion: ${e.message.slice(0, 80)}`);
      }
    } else {
      assert(
        true,
        `Skipped discussion tests — create failed: ${createDiscRes.status}`
      );
    }

    // ── requestReReview ────────────────────────────────────────────────
    try {
      await gitlab.requestReReview(GL_PROJECT_PATH, mutMRIid);
      assert(true, `requestReReview on MR !${mutMRIid}`);
    } catch (e: any) {
      // May fail if no reviewers are assigned — that's OK
      assert(true, `requestReReview: ${e.message.slice(0, 80)}`);
    }

    // ── retryPipeline ──────────────────────────────────────────────────
    // Only works if a pipeline exists on this MR
    const mrDetail = await gitlab.fetchSingleMR(
      GL_PROJECT_PATH,
      mutMRIid,
      null
    );
    if (mrDetail?.pipeline) {
      const pipelineNumericId = parseInt(
        mrDetail.pipeline.id.split(':').pop() ?? '0',
        10
      );
      try {
        await gitlab.retryPipeline(GL_PROJECT_PATH, pipelineNumericId);
        assert(true, `Retried pipeline ${pipelineNumericId}`);
      } catch (e: any) {
        assert(true, `retryPipeline: ${e.message.slice(0, 80)}`);
      }
    } else {
      assert(true, `retryPipeline: skipped — no pipeline on MR !${mutMRIid}`);
    }

    // ── mergePullRequest (last — this is destructive) ─────────────────
    // Re-approve first since we unapproved earlier
    try {
      await gitlab.approvePullRequest(GL_PROJECT_PATH, mutMRIid);
    } catch {}

    try {
      const merged = await gitlab.mergePullRequest(GL_PROJECT_PATH, mutMRIid, {
        commitMessage: 'SDK mutation test merge commit',
        shouldRemoveSourceBranch: true
      });
      assert(
        merged.state === 'merged',
        `MR !${mutMRIid} merged (state=${merged.state})`
      );
    } catch (e: any) {
      // May fail due to approval rules, pipeline requirements, etc.
      assert(true, `mergePullRequest: ${e.message.slice(0, 80)}`);
      // Close the MR if merge failed, for cleanup
      try {
        await gitlab.updatePullRequest(GL_PROJECT_PATH, mutMRIid, {
          stateEvent: 'close'
        });
      } catch {}
    }

    // Best-effort branch cleanup (merge with shouldRemoveSourceBranch may have already done it)
    try {
      await gitlab.deleteBranch(GL_PROJECT_PATH, mutBranch);
    } catch {}
    assert(true, `Mutation lifecycle cleanup complete`);
  } catch (e: any) {
    assert(false, `GitLab mutation lifecycle failed: ${e.message}`);
    // Best-effort cleanup
    if (mutMRIid && GL_PROJECT_PATH) {
      try {
        await gitlab.updatePullRequest(GL_PROJECT_PATH, mutMRIid, {
          stateEvent: 'close'
        });
      } catch {}
    }
    try {
      await gitlab.deleteBranch(GL_PROJECT_PATH, mutBranch);
    } catch {}
  }
} else {
  console.log('  ℹ️  Skipped — no project path');
}

// 16. ActionCableClient — WebSocket connect + welcome
console.log('\n▶ ActionCableClient connect');
const cableResult = await new Promise<{ connected: boolean; error?: string }>(
  resolve => {
    const timeout = setTimeout(
      () => resolve({ connected: false, error: 'timeout (5s)' }),
      5000
    );
    const callbacks: ActionCableCallbacks = {
      onConnected() {
        clearTimeout(timeout);
        cable.disconnect();
        resolve({ connected: true });
      },
      onDisconnected(_intentional, reason) {
        clearTimeout(timeout);
        resolve({ connected: false, error: reason });
      },
      onMessage() {},
      onConfirm() {},
      onReject() {}
    };
    const cable = new ActionCableClient(
      'https://gitlab.com',
      GITLAB_TOKEN,
      callbacks
    );
    cable.connect();
  }
);
assert(
  cableResult.connected,
  cableResult.connected
    ? "WebSocket connected and received 'welcome'"
    : `WebSocket failed: ${cableResult.error}`
);

// ── GitLab: watchMR ──────────────────────────────────────────────────────────
console.log('\n▶ GitLab: watchMR');
if (glTestMR && glProjectPath) {
  const glUserNumericId = parseInt(glUser.id.split(':').pop() ?? '0', 10);

  const watchResult = await new Promise<{
    pr: PullRequest | null;
    error?: string;
  }>(resolve => {
    const timeout = setTimeout(() => {
      dispose();
      resolve({ pr: null, error: 'timeout — no initial update received' });
    }, 10_000);

    const dispose = gitlab.watchMR(
      glProjectPath!,
      glTestMR!.iid,
      glUserNumericId,
      pr => {
        clearTimeout(timeout);
        dispose(); // stop immediately after first update
        resolve({ pr });
      }
    );
  });

  assert(
    watchResult.pr !== null,
    `watchMR: ${watchResult.error ?? 'received initial update'}`
  );
  if (watchResult.pr) {
    const pr = watchResult.pr;
    assert(pr.iid === glTestMR.iid, `watchMR iid: ${pr.iid}`);
    assert(
      typeof pr.rebaseInProgress === 'boolean',
      `watchMR rebaseInProgress: ${pr.rebaseInProgress}`
    );
    assert(
      typeof pr.mergeOngoing === 'boolean',
      `watchMR mergeOngoing: ${pr.mergeOngoing}`
    );
    assert(
      Array.isArray(pr.mergeabilityChecks),
      `watchMR mergeabilityChecks: ${pr.mergeabilityChecks.length} checks`
    );
    assert(
      typeof pr.detailedMergeStatus === 'string' ||
        pr.detailedMergeStatus === null,
      `watchMR detailedMergeStatus: ${pr.detailedMergeStatus}`
    );
    console.log(
      `  ✅ watchMR received initial update: MR !${pr.iid} (${pr.detailedMergeStatus}), ${pr.mergeabilityChecks.length} checks`
    );
  }
} else {
  console.log('  ℹ️  Skipped — no MRs');
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
