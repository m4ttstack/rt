#!/usr/bin/env bun
/**
 * Smoke tests for @workforge/glance-sdk published package.
 *
 * Tests:
 *  1. All expected exports resolve
 *  2. Type shapes match expectations
 *  3. GitHubProvider instantiates and has correct methods
 *  4. GitLabProvider instantiates and has correct methods
 *  5. ActionCableClient instantiates
 *  6. Logger DI works (noopLogger default, custom logger)
 *  7. createProvider factory works for both slugs
 *  8. MRDetailFetcher instantiates
 *  9. NoteMutator instantiates
 * 10. MR_DASHBOARD_FRAGMENT is a non-empty string
 */

import {
  // Providers
  GitHubProvider,
  GitLabProvider,
  createProvider,
  SUPPORTED_PROVIDERS,

  // Real-time
  ActionCableClient,

  // Detail + mutations
  MRDetailFetcher,
  NoteMutator,

  // Events cursor
  EventsPoller,
  classifyEvent,
  startEventsWatcher,

  // Logger
  noopLogger,

  // Helpers
  parseRepoId,
  repoIdProvider,
  parseGitLabRepoId,
  MR_DASHBOARD_FRAGMENT
} from '@workforge/glance-sdk';

import type {
  PullRequest,
  Pipeline,
  PipelineJob,
  UserRef,
  DiffStats,
  Discussion,
  Note,
  NoteAuthor,
  NotePosition,
  MRDetail,
  FeedEvent,
  FeedSnapshot,
  ServerNotification,
  PullRequestsSnapshot,
  BranchProtectionRule,
  CreatePullRequestInput,
  UpdatePullRequestInput,
  MergePullRequestInput,
  MergeMethod,
  ProviderCapabilities,
  GitProvider,
  ForgeLogger,
  ActionCableCallbacks,
  ProviderSlug,
  CreatedNote
} from '@workforge/glance-sdk';

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

// ── Test 1: Exports resolve ──────────────────────────────────────────────────
console.log('\n▶ Test 1: All exports resolve');
assert(typeof GitHubProvider === 'function', 'GitHubProvider is a constructor');
assert(typeof GitLabProvider === 'function', 'GitLabProvider is a constructor');
assert(
  typeof ActionCableClient === 'function',
  'ActionCableClient is a constructor'
);
assert(
  typeof MRDetailFetcher === 'function',
  'MRDetailFetcher is a constructor'
);
assert(typeof NoteMutator === 'function', 'NoteMutator is a constructor');
assert(typeof createProvider === 'function', 'createProvider is a function');
assert(typeof noopLogger === 'object', 'noopLogger is an object');
assert(typeof parseRepoId === 'function', 'parseRepoId is a function');
assert(typeof repoIdProvider === 'function', 'repoIdProvider is a function');
assert(
  typeof parseGitLabRepoId === 'function',
  'parseGitLabRepoId is a function'
);
assert(Array.isArray(SUPPORTED_PROVIDERS), 'SUPPORTED_PROVIDERS is an array');

// ── Test 2: Helper functions work correctly ─────────────────────────────────
console.log('\n▶ Test 2: Helper functions');
assert(parseRepoId('gitlab:42') === 42, "parseRepoId('gitlab:42') === 42");
assert(
  parseRepoId('github:12345') === 12345,
  "parseRepoId('github:12345') === 12345"
);
assert(
  repoIdProvider('gitlab:42') === 'gitlab',
  "repoIdProvider('gitlab:42') === 'gitlab'"
);
assert(
  repoIdProvider('github:12345') === 'github',
  "repoIdProvider('github:12345') === 'github'"
);
assert(
  parseGitLabRepoId('gitlab:99') === 99,
  "parseGitLabRepoId('gitlab:99') === 99"
);

// ── Test 3: GitHubProvider instantiation ────────────────────────────────────
console.log('\n▶ Test 3: GitHubProvider');
const gh = new GitHubProvider('https://github.com', 'fake-token');
assert(gh.providerName === 'github', "providerName === 'github'");
assert(typeof gh.fetchPullRequests === 'function', 'has fetchPullRequests()');
assert(typeof gh.fetchSingleMR === 'function', 'has fetchSingleMR()');
assert(typeof gh.fetchMRDiscussions === 'function', 'has fetchMRDiscussions()');
assert(typeof gh.validateToken === 'function', 'has validateToken()');
assert(typeof gh.restRequest === 'function', 'has restRequest()');
assert(typeof gh.createPullRequest === 'function', 'has createPullRequest()');
assert(typeof gh.updatePullRequest === 'function', 'has updatePullRequest()');
assert(
  typeof gh.fetchPullRequestByBranch === 'function',
  'has fetchPullRequestByBranch()'
);
assert(
  typeof gh.fetchBranchProtectionRules === 'function',
  'has fetchBranchProtectionRules()'
);
assert(typeof gh.deleteBranch === 'function', 'has deleteBranch()');
assert(typeof gh.mergePullRequest === 'function', 'has mergePullRequest()');
assert(typeof gh.approvePullRequest === 'function', 'has approvePullRequest()');
assert(
  typeof gh.unapprovePullRequest === 'function',
  'has unapprovePullRequest()'
);
assert(typeof gh.rebasePullRequest === 'function', 'has rebasePullRequest()');
assert(typeof gh.setAutoMerge === 'function', 'has setAutoMerge()');
assert(typeof gh.cancelAutoMerge === 'function', 'has cancelAutoMerge()');
assert(typeof gh.resolveDiscussion === 'function', 'has resolveDiscussion()');
assert(
  typeof gh.unresolveDiscussion === 'function',
  'has unresolveDiscussion()'
);
assert(typeof gh.retryPipeline === 'function', 'has retryPipeline()');
assert(typeof gh.requestReReview === 'function', 'has requestReReview()');
assert(typeof gh.capabilities === 'object', 'has capabilities object');
assert(gh.capabilities.canMerge === true, 'GitHub: canMerge');
assert(gh.capabilities.canApprove === true, 'GitHub: canApprove');
assert(gh.capabilities.canUnapprove === false, 'GitHub: canUnapprove (false)');
assert(gh.capabilities.canRebase === false, 'GitHub: canRebase (false)');
assert(gh.capabilities.canAutoMerge === false, 'GitHub: canAutoMerge (false)');
assert(
  gh.capabilities.canResolveDiscussions === false,
  'GitHub: canResolveDiscussions (false)'
);
assert(gh.capabilities.canRetryPipeline === true, 'GitHub: canRetryPipeline');
assert(
  gh.capabilities.canRequestReReview === true,
  'GitHub: canRequestReReview'
);

// GHES URL normalization
const ghes = new GitHubProvider('https://github.mycompany.com', 'fake-token');
assert(ghes.providerName === 'github', "GHES: providerName === 'github'");

// ── Test 4: GitLabProvider instantiation ────────────────────────────────────
console.log('\n▶ Test 4: GitLabProvider');
const gl = new GitLabProvider('https://gitlab.com', 'fake-token');
assert(gl.providerName === 'gitlab', "providerName === 'gitlab'");
assert(gl.baseURL === 'https://gitlab.com', 'baseURL strips trailing slash');
assert(typeof gl.fetchPullRequests === 'function', 'has fetchPullRequests()');
assert(typeof gl.fetchSingleMR === 'function', 'has fetchSingleMR()');
assert(typeof gl.fetchMRDiscussions === 'function', 'has fetchMRDiscussions()');
assert(typeof gl.createPullRequest === 'function', 'has createPullRequest()');
assert(typeof gl.updatePullRequest === 'function', 'has updatePullRequest()');
assert(
  typeof gl.fetchPullRequestByBranch === 'function',
  'has fetchPullRequestByBranch()'
);
assert(
  typeof gl.fetchBranchProtectionRules === 'function',
  'has fetchBranchProtectionRules()'
);
assert(typeof gl.deleteBranch === 'function', 'has deleteBranch()');
assert(typeof gl.mergePullRequest === 'function', 'has mergePullRequest()');
assert(typeof gl.approvePullRequest === 'function', 'has approvePullRequest()');
assert(
  typeof gl.unapprovePullRequest === 'function',
  'has unapprovePullRequest()'
);
assert(typeof gl.rebasePullRequest === 'function', 'has rebasePullRequest()');
assert(typeof gl.setAutoMerge === 'function', 'has setAutoMerge()');
assert(typeof gl.cancelAutoMerge === 'function', 'has cancelAutoMerge()');
assert(typeof gl.resolveDiscussion === 'function', 'has resolveDiscussion()');
assert(
  typeof gl.unresolveDiscussion === 'function',
  'has unresolveDiscussion()'
);
assert(typeof gl.retryPipeline === 'function', 'has retryPipeline()');
assert(typeof gl.requestReReview === 'function', 'has requestReReview()');
assert(typeof gl.capabilities === 'object', 'has capabilities object');
assert(gl.capabilities.canMerge === true, 'GitLab: canMerge');
assert(gl.capabilities.canApprove === true, 'GitLab: canApprove');
assert(gl.capabilities.canUnapprove === true, 'GitLab: canUnapprove');
assert(gl.capabilities.canRebase === true, 'GitLab: canRebase');
assert(gl.capabilities.canAutoMerge === true, 'GitLab: canAutoMerge');
assert(
  gl.capabilities.canResolveDiscussions === true,
  'GitLab: canResolveDiscussions'
);
assert(gl.capabilities.canRetryPipeline === true, 'GitLab: canRetryPipeline');
assert(
  gl.capabilities.canRequestReReview === true,
  'GitLab: canRequestReReview'
);

// Trailing slash normalization
const gl2 = new GitLabProvider('https://gitlab.com/', 'fake-token');
assert(
  gl2.baseURL === 'https://gitlab.com',
  'baseURL normalizes trailing slash'
);

// ── Test 5: ActionCableClient instantiation ─────────────────────────────────
console.log('\n▶ Test 5: ActionCableClient');
const callbacks: ActionCableCallbacks = {
  onConnected: () => {},
  onDisconnected: () => {},
  onMessage: () => {},
  onConfirm: () => {},
  onReject: () => {}
};
const cable = new ActionCableClient(
  'https://gitlab.com',
  'fake-token',
  callbacks
);
assert(cable instanceof ActionCableClient, 'instantiates without error');
assert(typeof cable.connect === 'function', 'has connect()');
assert(typeof cable.disconnect === 'function', 'has disconnect()');
assert(typeof cable.subscribe === 'function', 'has subscribe()');
assert(typeof cable.unsubscribe === 'function', 'has unsubscribe()');

// ── Test 6: Logger DI ───────────────────────────────────────────────────────
console.log('\n▶ Test 6: Logger DI');
assert(typeof noopLogger.debug === 'function', 'noopLogger has debug()');
assert(typeof noopLogger.info === 'function', 'noopLogger has info()');
assert(typeof noopLogger.warn === 'function', 'noopLogger has warn()');
assert(typeof noopLogger.error === 'function', 'noopLogger has error()');

// Custom logger captures calls
const captured: string[] = [];
const testLogger: ForgeLogger = {
  debug(msg) {
    captured.push(`debug:${msg}`);
  },
  info(msg) {
    captured.push(`info:${msg}`);
  },
  warn(msg) {
    captured.push(`warn:${msg}`);
  },
  error(msg) {
    captured.push(`error:${msg}`);
  }
};
const ghWithLogger = new GitHubProvider('https://github.com', 'fake-token', {
  logger: testLogger
});
assert(
  ghWithLogger.providerName === 'github',
  'GitHubProvider accepts logger option'
);

// ── Test 7: createProvider factory ──────────────────────────────────────────
console.log('\n▶ Test 7: createProvider factory');
assert(
  SUPPORTED_PROVIDERS.includes('github' as ProviderSlug),
  "SUPPORTED_PROVIDERS includes 'github'"
);
assert(
  SUPPORTED_PROVIDERS.includes('gitlab' as ProviderSlug),
  "SUPPORTED_PROVIDERS includes 'gitlab'"
);

const ghFromFactory = createProvider(
  'github',
  'https://github.com',
  'fake-token'
);
assert(
  ghFromFactory.providerName === 'github',
  "createProvider('github') returns GitHubProvider"
);

const glFromFactory = createProvider(
  'gitlab',
  'https://gitlab.com',
  'fake-token'
);
assert(
  glFromFactory.providerName === 'gitlab',
  "createProvider('gitlab') returns GitLabProvider"
);

try {
  createProvider('bitbucket' as any, 'https://bitbucket.org', 't');
  assert(false, "createProvider('bitbucket') should throw");
} catch (e) {
  assert(true, "createProvider('bitbucket') throws for unsupported provider");
}

// ── Test 8: MRDetailFetcher ─────────────────────────────────────────────────
console.log('\n▶ Test 8: MRDetailFetcher');
const fetcher = new MRDetailFetcher('https://gitlab.com', 'fake-token');
assert(fetcher instanceof MRDetailFetcher, 'instantiates without error');
assert(typeof fetcher.fetchDetail === 'function', 'has fetchDetail()');

// ── Test 9: NoteMutator ─────────────────────────────────────────────────────
console.log('\n▶ Test 9: NoteMutator');
const mutator = new NoteMutator('https://gitlab.com', 'fake-token');
assert(mutator instanceof NoteMutator, 'instantiates without error');

// ── Test 10: MR_DASHBOARD_FRAGMENT ──────────────────────────────────────────
console.log('\n▶ Test 10: MR_DASHBOARD_FRAGMENT');
assert(typeof MR_DASHBOARD_FRAGMENT === 'string', 'is a string');
assert(MR_DASHBOARD_FRAGMENT.length > 100, 'is non-trivial length');
assert(
  MR_DASHBOARD_FRAGMENT.includes('MRDashboardFields'),
  'contains fragment name'
);
assert(
  MR_DASHBOARD_FRAGMENT.includes('headPipeline'),
  'contains headPipeline field'
);
assert(
  MR_DASHBOARD_FRAGMENT.includes('approvedBy'),
  'contains approvedBy field'
);

// ── Test 11: Events cursor surface ──────────────────────────────────────────
console.log('\n▶ Test 11: Events cursor surface');
assert(typeof EventsPoller === 'function', 'EventsPoller exported');
assert(typeof classifyEvent === 'function', 'classifyEvent exported');
assert(typeof startEventsWatcher === 'function', 'startEventsWatcher exported');
assert(
  typeof GitLabProvider.prototype.watchEvents === 'function',
  'GitLabProvider.watchEvents exists'
);
assert(gl.capabilities.canWatchEvents === true, 'GitLab: canWatchEvents');
assert(gh.capabilities.canWatchEvents === false, 'GitHub: canWatchEvents (false)');

// ── Test 12: Type compatibility (compile-time) ──────────────────────────────
console.log('\n▶ Test 12: Type compatibility (compile-time check)');
// If this file compiles, these type imports are valid
const _typeCheck: {
  pr: PullRequest;
  pipeline: Pipeline;
  job: PipelineJob;
  user: UserRef;
  diff: DiffStats;
  discussion: Discussion;
  note: Note;
  author: NoteAuthor;
  pos: NotePosition;
  detail: MRDetail;
  event: FeedEvent;
  snap: FeedSnapshot;
  notif: ServerNotification;
  prSnap: PullRequestsSnapshot;
  protection: BranchProtectionRule;
  createInput: CreatePullRequestInput;
  updateInput: UpdatePullRequestInput;
  mergeInput: MergePullRequestInput;
  mergeMethod: MergeMethod;
  capabilities: ProviderCapabilities;
  provider: GitProvider;
  logger: ForgeLogger;
  callbacks: ActionCableCallbacks;
  slug: ProviderSlug;
  created: CreatedNote;
} = null as any; // compile-time only
assert(true, 'All 25 type imports compile successfully');

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);

