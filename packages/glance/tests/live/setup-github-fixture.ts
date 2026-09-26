#!/usr/bin/env bun
/**
 * Idempotent setup for the GitHub conformance fixture.
 *
 * The repository is public because the account is on the free plan, where
 * `GET /branches/{branch}/protection` answers 403 "Upgrade to GitHub Pro or
 * make this repository public". Branch protection and auto-merge are
 * untestable on a private repo, so public is a requirement here, not a
 * preference.
 *
 * Run: bun tests/live/setup-github-fixture.ts
 */

import { loadCredentials, githubRepo, parseGitHubSlug, resolveGitHubToken } from './credentials.ts';

const creds = await loadCredentials();
if (!creds) {
  console.error(
    'No harness_credentials.json found. Copy harness_credentials.example.json ' +
      'to harness_credentials.json and fill in a github repo entry before running this script.'
  );
  process.exit(1);
}

// githubRepo() throws if the entry is missing. That is expected on a
// from-scratch setup: the entry names the repo this script creates, so the
// file must already point at the target before provisioning can run.
const { owner: OWNER, repo: REPO } = parseGitHubSlug(githubRepo(creds).web_url);
const SLUG = `${OWNER}/${REPO}`;

const token = await resolveGitHubToken();
if (!token) {
  console.error('No GitHub token. Run `gh auth login`.');
  process.exit(1);
}

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function ensureRepo(): Promise<void> {
  const res = await api('GET', `/repos/${SLUG}`);
  if (res.ok) {
    console.log(`repo ${SLUG} exists`);
    return;
  }
  // Only a 404 means "doesn't exist yet". A transient failure (secondary
  // rate limit, a 5xx) is not absence, and reading it as absence would
  // attempt to create a repo that already exists, surfacing a confusing
  // "422 name already exists" instead of the real problem.
  if (res.status !== 404) {
    throw new Error(`check repo failed: ${res.status} ${await res.text()}`);
  }
  const createRes = await api('POST', '/user/repos', {
    name: REPO,
    description: 'Live conformance fixture for @mattstack/glance. Safe to force-push.',
    private: false,
    auto_init: true,
    has_issues: true
  });
  if (!createRes.ok) {
    throw new Error(`create repo failed: ${createRes.status} ${await createRes.text()}`);
  }
  console.log(`created ${SLUG}`);
}

async function putFile(path: string, content: string, message: string): Promise<void> {
  const existing = await api('GET', `/repos/${SLUG}/contents/${path}`);
  let sha: string | undefined;
  if (existing.ok) {
    const body = (await existing.json()) as { sha: string; content: string };
    sha = body.sha;
    // GitHub base64-encodes content with embedded newlines; Buffer.from
    // skips non-base64 characters so this decodes cleanly regardless.
    // Comparing before writing is what makes re-running after fixture drift
    // safe without also permanently growing the commit log and firing a
    // fresh Actions run on every unchanged re-provision.
    const currentContent = Buffer.from(body.content, 'base64').toString('utf8');
    if (currentContent === content) {
      console.log(`unchanged ${path}`);
      return;
    }
  } else if (existing.status !== 404) {
    // Same reasoning as ensureRepo: a non-404 failure is not "the file is
    // absent". Treating it as absent would PUT without a `sha` against a
    // path that does exist, which GitHub rejects, but only after masking
    // the real cause.
    throw new Error(`check ${path} failed: ${existing.status} ${await existing.text()}`);
  }
  const res = await api('PUT', `/repos/${SLUG}/contents/${path}`, {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(sha ? { sha } : {})
  });
  if (!res.ok) throw new Error(`put ${path} failed: ${res.status} ${await res.text()}`);
  console.log(`wrote ${path}`);
}

const WORKFLOW = `name: conformance
on:
  pull_request:
  push:
    branches: [main]

jobs:
  always-passes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: echo "conformance-ok"

  controllable:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fail only when the branch carries a fail-marker file
        run: |
          if [ -f fail-marker ]; then
            echo "fail-marker present, failing deliberately"
            exit 1
          fi
          echo "no marker, passing"
`;

const README = `# glance-conformance

Live conformance fixture for [@mattstack/glance](https://github.com/m4ttstack/glance).

Branches and pull requests here are created and cleaned up by the conformance
harness. Nothing in this repository is precious.

The \`controllable\` CI job fails when a branch contains a file named
\`fail-marker\`, which is how the harness gets a deterministically failing job
to exercise retryJob and fetchJobTrace against.
`;

async function enableAutoMerge(): Promise<void> {
  const res = await api('PATCH', `/repos/${SLUG}`, {
    allow_auto_merge: true,
    delete_branch_on_merge: false,
    allow_squash_merge: true,
    allow_rebase_merge: true
  });
  if (!res.ok) throw new Error(`enable auto-merge failed: ${res.status} ${await res.text()}`);
  console.log('auto-merge enabled');
}

async function protectMain(): Promise<void> {
  const res = await api('PUT', `/repos/${SLUG}/branches/main/protection`, {
    required_status_checks: { strict: false, contexts: ['always-passes'] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: true,
    allow_deletions: true
  });
  if (!res.ok) {
    throw new Error(
      `protect main failed: ${res.status} ${await res.text()}\n` +
        'A 403 here means the repository is private on a free plan.'
    );
  }
  console.log('main protected with required status check');
}

export async function setupGitHubFixture(): Promise<void> {
  await ensureRepo();
  await putFile('README.md', README, 'seed README');
  await putFile('.github/workflows/ci.yml', WORKFLOW, 'seed conformance workflow');
  await enableAutoMerge();
  await protectMain();
  console.log(`\nfixture ready: https://github.com/${SLUG}`);
}

if (import.meta.main) await setupGitHubFixture();
