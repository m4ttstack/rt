/**
 * The shared assertion set.
 *
 * Written once and driven against every fixture. Where the providers
 * legitimately differ, the difference is read from the expectation table
 * rather than branched on inline, so a divergence nobody declared shows up
 * as a failure instead of as an `if (fixture.name === 'github')`.
 */

import { expectationFor, type ProviderMethod } from './expectations.ts';
import type { ProviderFixture } from './fixture.ts';
import { pollUntil } from './poll.ts';
import type { Reporter } from './report.ts';

/**
 * Thrown from inside a `check()` callback to report a skip rather than a
 * pass or fail. Some assertions depend on live data the fixture may not
 * have right now (e.g. an open PR to inspect); when that data is absent the
 * check has not passed, it has proven nothing, and reporting it as green
 * would claim coverage that didn't happen.
 */
class Inconclusive extends Error {}

async function check(
  report: Reporter,
  fixture: ProviderFixture,
  method: ProviderMethod,
  label: string,
  fn: () => Promise<void>
): Promise<void> {
  try {
    await fn();
    report.pass(fixture.name, method, label);
  } catch (err) {
    if (err instanceof Inconclusive) {
      report.skip(fixture.name, method, label, err.message);
      return;
    }
    report.fail(
      fixture.name,
      method,
      label,
      err instanceof Error ? err.message : String(err)
    );
  }
}

// `asserts condition` (not just `: void`) lets TypeScript narrow whatever
// expression was checked, e.g. `assert(main !== undefined, ...)` then using
// `main` unguarded afterward, instead of forcing a redundant non-null
// assertion at every call site.
function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Prefix a REST path for the provider's actual API root.
 *
 * `GitProvider.restRequest`'s docstring claims "implementations translate the
 * path to the provider's API URL format", but GitLabProvider does not: it
 * concatenates `baseURL + path` verbatim, so a GitLab caller must supply
 * `/api/v4` itself while a GitHub caller must not. Provider-agnostic code
 * therefore cannot call `restRequest` portably, which contradicts the
 * interface's own documentation. Record that in the findings document: it is a
 * real parity defect, not merely a harness inconvenience.
 */
function apiPath(fixture: ProviderFixture, path: string): string {
  return fixture.name === 'gitlab' ? `/api/v4${path}` : path;
}

/**
 * Resolves the fixture project's own numeric id independent of whatever
 * `fetchPullRequests` just returned, so the projectPath-mode scoping check
 * below has a ground truth to compare against rather than trusting the very
 * data it exists to verify.
 *
 * `PullRequest.repositoryId` (e.g. "gitlab:42", "github:12345") is set by a
 * single mapper function on each provider, reused by every fetchPullRequests
 * code path, which makes it a strict identity check. A substring match on
 * `webUrl` is weaker than this: `projectPath = "owner/repo"` is a substring
 * of a sibling project's URL ".../owner/repo-archive/pull/5", and
 * `"group/project"` is a substring of ".../meta-group/project/-/merge_requests/1",
 * so a provider that ignored the filter and returned a similarly-named
 * project's PRs could still pass a webUrl-substring check.
 */
async function fetchProjectId(fixture: ProviderFixture): Promise<number> {
  const path =
    fixture.name === 'github'
      ? `/repos/${fixture.projectPath}`
      : `/projects/${encodeURIComponent(fixture.projectPath)}`;
  const res = await fixture.provider.restRequest('GET', apiPath(fixture, path));
  if (!res.ok) {
    throw new Error(
      `could not resolve project id for "${fixture.projectPath}": HTTP ${res.status}`
    );
  }
  const body = (await res.json()) as { id: number };
  return body.id;
}

export async function runReadConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  const { provider, projectPath } = fixture;

  await check(report, fixture, 'validateToken', 'returns a non-empty username', async () => {
    const user = await provider.validateToken();
    assert(user.username.length > 0, 'username was empty');
  });

  await check(
    report,
    fixture,
    'fetchPullRequests',
    'returns an array of well-formed PRs',
    async () => {
      const prs = await provider.fetchPullRequests();
      assert(Array.isArray(prs), `expected an array, got ${typeof prs}`);
      // An empty array satisfies Array.isArray without ever running the
      // per-PR shape assertions below, which would let this pass while
      // proving nothing about the "well-formed" half of its own label; the
      // projectPath-mode check ~30 lines below hits the same case and
      // reports it the same way.
      if (prs.length === 0) {
        throw new Inconclusive('no PRs returned; well-formedness of PR shape is unverified');
      }
      for (const pr of prs) {
        assert(
          typeof pr.id === 'string' && pr.id.length > 0,
          `PR missing non-empty id: ${JSON.stringify(pr).slice(0, 80)}`
        );
        assert(
          typeof pr.iid === 'number',
          `PR ${pr.id} missing numeric iid: ${JSON.stringify(pr).slice(0, 80)}`
        );
      }
    }
  );

  await check(
    report,
    fixture,
    'fetchPullRequests',
    'projectPath mode returns only that project',
    async () => {
      const prs = await provider.fetchPullRequests({ projectPath, state: 'opened' });
      assert(Array.isArray(prs), 'expected an array');
      if (prs.length === 0) {
        // A provider that ignored projectPath and returned everything, and
        // a provider that scoped correctly, both produce "[]" whenever the
        // fixture project happens to have zero open PRs right now. Neither
        // case can be told apart from the other here, so this is not a
        // pass: it's unverified, and must say so rather than imply the
        // scoping was checked.
        throw new Inconclusive('no open PRs in the fixture project; scoping is unverified');
      }
      const projectId = await fetchProjectId(fixture);
      const expectedRepositoryId = `${fixture.name}:${projectId}`;
      for (const pr of prs) {
        assert(
          pr.repositoryId === expectedRepositoryId,
          `PR ${pr.iid} repositoryId "${pr.repositoryId}" does not match fixture project "${expectedRepositoryId}"`
        );
      }
    }
  );

  await check(
    report,
    fixture,
    'fetchPullRequests',
    'empty iids selects that mode and returns []',
    async () => {
      const prs = await provider.fetchPullRequests({ iids: [], projectPath });
      assert(prs.length === 0, `expected [], got ${prs.length} items`);
    }
  );

  await check(
    report,
    fixture,
    'fetchPullRequests',
    'iids without projectPath throws',
    async () => {
      let threw = false;
      try {
        await provider.fetchPullRequests({ iids: [1] });
      } catch {
        threw = true;
      }
      assert(threw, 'expected a throw, got a resolved value');
    }
  );

  await check(
    report,
    fixture,
    'fetchPullRequests',
    'unparseable updatedAfter throws',
    async () => {
      let threw = false;
      try {
        await provider.fetchPullRequests({ projectPath, updatedAfter: 'not-a-date' });
      } catch {
        threw = true;
      }
      assert(threw, 'expected a throw, got a resolved value');
    }
  );

  await check(
    report,
    fixture,
    'fetchBranchProtectionRules',
    'returns rules for the default branch',
    async () => {
      const rules = await provider.fetchBranchProtectionRules(projectPath);
      assert(Array.isArray(rules), 'expected an array');
      const main = rules.find(r => r.pattern === fixture.defaultBranch);
      assert(
        main !== undefined,
        `no rule for "${fixture.defaultBranch}" among [${rules.map(r => r.pattern).join(', ')}]`
      );

      // GitHub's fixture is provisioned by setup-github-fixture.ts with
      // known values (allow_force_pushes: true, allow_deletions: true, a
      // required status check), so those exact values can be asserted:
      // this is what GitHubProvider's all-false fabrication-on-read-failure
      // bug (recorded separately) would violate, and existence-only
      // checking would sail straight past. GitLab's project configuration
      // isn't controlled by this harness, so only the field TYPES are
      // checked there, which still catches an undefined or mis-typed
      // mapping without asserting values this harness doesn't own.
      if (fixture.name === 'github') {
        assert(
          main.allowForcePush === true,
          `allowForcePush should be true, got ${main.allowForcePush}`
        );
        assert(
          main.allowDeletion === true,
          `allowDeletion should be true, got ${main.allowDeletion}`
        );
        assert(
          main.requireStatusChecks === true,
          `requireStatusChecks should be true, got ${main.requireStatusChecks}`
        );
      } else {
        assert(
          typeof main.allowForcePush === 'boolean',
          `allowForcePush should be boolean, got ${typeof main.allowForcePush}`
        );
        assert(
          typeof main.allowDeletion === 'boolean',
          `allowDeletion should be boolean, got ${typeof main.allowDeletion}`
        );
        assert(
          typeof main.requiredApprovals === 'number',
          `requiredApprovals should be number, got ${typeof main.requiredApprovals}`
        );
        assert(
          typeof main.requireStatusChecks === 'boolean',
          `requireStatusChecks should be boolean, got ${typeof main.requireStatusChecks}`
        );
      }
    }
  );

  await check(report, fixture, 'restRequest', 'authenticated GET succeeds', async () => {
    const res = await provider.restRequest('GET', apiPath(fixture, '/user'));
    assert(res.ok, `expected ok, got HTTP ${res.status}`);
  });

  await check(
    report,
    fixture,
    'fetchPullRequestByBranch',
    'returns null for a branch with no MR',
    async () => {
      const pr = await provider.fetchPullRequestByBranch(
        projectPath,
        'branch-that-does-not-exist-conformance',
        'all'
      );
      assert(pr === null, `expected null, got ${JSON.stringify(pr)?.slice(0, 80)}`);
    }
  );
}

export async function runUnsupportedConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  const { provider, projectPath } = fixture;

  const probes: Array<[ProviderMethod, () => Promise<unknown>]> = [
    ['rebasePullRequest', () => provider.rebasePullRequest(projectPath, 1)],
    ['unapprovePullRequest', () => provider.unapprovePullRequest(projectPath, 1)],
    ['setAutoMerge', () => provider.setAutoMerge(projectPath, 1)],
    ['cancelAutoMerge', () => provider.cancelAutoMerge(projectPath, 1)],
    ['resolveDiscussion', () => provider.resolveDiscussion(projectPath, 1, 'x')],
    ['unresolveDiscussion', () => provider.unresolveDiscussion(projectPath, 1, 'x')]
  ];

  for (const [method, invoke] of probes) {
    const expectation = expectationFor(fixture.name, method);
    if (expectation.support !== 'unsupported') {
      report.skip(fixture.name, method, 'supported-path not exercised here', 'this provider declares it supported');
      continue;
    }
    await check(report, fixture, method, 'throws, and its capability flag is false', async () => {
      if (expectation.capability) {
        assert(
          provider.capabilities[expectation.capability] === false,
          `capabilities.${expectation.capability} should be false`
        );
      }
      let threw = false;
      try {
        await invoke();
      } catch {
        threw = true;
      }
      assert(threw, 'expected a throw, got a resolved value');
    });
  }

  const watchExpectation = expectationFor(fixture.name, 'watchMR');
  if (watchExpectation.support === 'unsupported') {
    await check(report, fixture, 'watchMR', 'throws synchronously', async () => {
      let threw = false;
      try {
        provider.watchMR(projectPath, 1, null, () => {});
      } catch {
        threw = true;
      }
      assert(threw, 'expected a throw, got a subscription');
    });
  } else {
    // Actually calling watchMR here would open a real ActionCable WebSocket
    // subscription against a PR that may not exist, with nothing in this
    // script to ever close it. Exercising subscribe/dispose is out of
    // scope for read-path conformance, so the gap is recorded explicitly
    // instead of being left to vanish: without this branch, a provider
    // that declares watchMR supported gets no report entry for it at all,
    // neither pass, fail, nor skip.
    report.skip(
      fixture.name,
      'watchMR',
      'supported-path not exercised here',
      'this provider declares it supported; invoking it would open a real websocket subscription'
    );
  }
}

/** Unique per run, so an aborted run never collides with the next. */
function runPrefix(): string {
  return `conformance/${Date.now().toString(36)}`;
}

/**
 * The `<provider>:<numericId>` form fetchMRDiscussions expects, which is not
 * derivable from a project path without asking the API for the numeric id.
 */
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

async function createBranch(
  fixture: ProviderFixture,
  branch: string
): Promise<void> {
  const { provider, projectPath, defaultBranch } = fixture;
  if (fixture.name === 'github') {
    const refRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/git/ref/heads/${defaultBranch}`
    );
    if (!refRes.ok) throw new Error(`read default ref failed: HTTP ${refRes.status}`);
    const { object } = (await refRes.json()) as { object: { sha: string } };
    const res = await provider.restRequest('POST', `/repos/${projectPath}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: object.sha
    });
    if (!res.ok) throw new Error(`create branch failed: HTTP ${res.status}`);
    return;
  }
  const encoded = encodeURIComponent(projectPath);
  const res = await provider.restRequest(
    'POST',
    apiPath(fixture, `/projects/${encoded}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(defaultBranch)}`)
  );
  if (!res.ok) throw new Error(`create branch failed: HTTP ${res.status}`);
}

/**
 * Commit a file so the branch differs from the default. GitLab rejects an MR
 * whose source and target are identical, and GitHub will not open a PR with
 * no diff.
 */
async function commitFile(
  fixture: ProviderFixture,
  branch: string,
  path: string,
  content: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  if (fixture.name === 'github') {
    const res = await provider.restRequest(
      'PUT',
      `/repos/${projectPath}/contents/${path}`,
      {
        message: `conformance: add ${path}`,
        content: Buffer.from(content).toString('base64'),
        branch
      }
    );
    if (!res.ok) throw new Error(`commit failed: HTTP ${res.status}`);
    return;
  }
  const encoded = encodeURIComponent(projectPath);
  const res = await provider.restRequest(
    'POST',
    apiPath(fixture, `/projects/${encoded}/repository/files/${encodeURIComponent(path)}`),
    { branch, content, commit_message: `conformance: add ${path}` }
  );
  if (!res.ok) throw new Error(`commit failed: HTTP ${res.status}`);
}

export async function runWriteConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  const { provider, projectPath, defaultBranch } = fixture;
  const branch = `${runPrefix()}-write`;
  let prIid: number | null = null;

  try {
    await check(report, fixture, 'createPullRequest', 'opens a PR from a new branch', async () => {
      await createBranch(fixture, branch);
      await commitFile(fixture, branch, `conformance-${Date.now()}.md`, '# conformance\n');
      const pr = await provider.createPullRequest({
        projectPath,
        title: 'conformance: write cycle',
        description: 'Opened by the glance conformance harness. Safe to close.',
        sourceBranch: branch,
        targetBranch: defaultBranch
      });
      assert(pr.iid > 0, `expected a positive iid, got ${pr.iid}`);
      prIid = pr.iid;
    });

    if (prIid === null) return;
    const iid = prIid;

    await check(
      report,
      fixture,
      'fetchSingleMR',
      'finds the PR just created',
      async () => {
        const pr = await pollUntil(`fetchSingleMR ${iid}`, () =>
          provider.fetchSingleMR(projectPath, iid, null)
        );
        assert(pr.iid === iid, `expected iid ${iid}, got ${pr.iid}`);
      }
    );

    await check(
      report,
      fixture,
      'fetchPullRequestByBranch',
      'finds the PR by its source branch',
      async () => {
        const pr = await pollUntil(`byBranch ${branch}`, () =>
          provider.fetchPullRequestByBranch(projectPath, branch, 'opened')
        );
        assert(pr.iid === iid, `expected iid ${iid}, got ${pr.iid}`);
      }
    );

    if (expectationFor(fixture.name, 'fetchPullRequestsByBranches').support === 'absent') {
      await check(
        report,
        fixture,
        'fetchPullRequestsByBranches',
        'is absent, so callers feature-detect and fall back',
        async () => {
          assert(
            provider.fetchPullRequestsByBranches === undefined,
            'declared absent but the method exists, so the table is stale'
          );
        }
      );
    } else {
      await check(
        report,
        fixture,
        'fetchPullRequestsByBranches',
        'batch lookup maps the branch to the PR',
        async () => {
          if (!provider.fetchPullRequestsByBranches) {
            throw new Error('declared present but the method is undefined');
          }
          const map = await provider.fetchPullRequestsByBranches(projectPath, [branch], 'opened');
          const found = map.get(branch);
          assert(found?.iid === iid, `expected iid ${iid}, got ${found?.iid ?? 'null'}`);
        }
      );
    }

    // Same shape as the fetchPullRequestsByBranches check above: on the
    // provider that declares this absent, prove it live rather than leaving
    // it as a code-read claim about GitHubProvider's source.
    if (expectationFor(fixture.name, 'watchEvents').support === 'absent') {
      await check(
        report,
        fixture,
        'watchEvents',
        'is absent, so callers feature-detect and fall back',
        async () => {
          assert(
            provider.watchEvents === undefined,
            'declared absent but the method exists, so the table is stale'
          );
        }
      );
    } else {
      // Actually calling watchEvents here would start a real polling loop
      // against a live repository with nothing in this script to ever stop
      // it, the same reasoning that keeps watchMR's supported path
      // unexercised above.
      report.skip(
        fixture.name,
        'watchEvents',
        'supported-path not exercised here',
        'this provider declares it supported; invoking it would start a real polling subscription with nothing in the harness to close it'
      );
    }

    await check(report, fixture, 'updatePullRequest', 'changes the title', async () => {
      const updated = await provider.updatePullRequest(projectPath, iid, {
        title: 'conformance: write cycle (updated)'
      });
      assert(
        updated.title.includes('updated'),
        `title did not change, got "${updated.title}"`
      );
    });

    await check(report, fixture, 'updatePullRequest', 'toggles draft on', async () => {
      const updated = await provider.updatePullRequest(projectPath, iid, { draft: true });
      assert(updated.draft === true, 'draft did not become true');
    });

    await check(report, fixture, 'updatePullRequest', 'toggles draft off', async () => {
      const updated = await provider.updatePullRequest(projectPath, iid, { draft: false });
      assert(updated.draft === false, 'draft did not become false');
    });

    await check(report, fixture, 'fetchMRDiscussions', 'returns a detail object', async () => {
      const repoId = await scopedRepoId(fixture);
      const detail = await provider.fetchMRDiscussions(repoId, iid);
      assert(Array.isArray(detail.discussions), 'discussions was not an array');
    });

    const approveExpectation = expectationFor(fixture.name, 'approvePullRequest');
    if (approveExpectation.support === 'approximate') {
      await check(
        report,
        fixture,
        'approvePullRequest',
        'self-approval is rejected with 422, proving request shape reaches GitHub',
        async () => {
          let message = '';
          try {
            await provider.approvePullRequest(projectPath, iid);
          } catch (err) {
            message = err instanceof Error ? err.message : String(err);
          }
          assert(
            message.length > 0,
            'self-approval unexpectedly succeeded, which contradicts the expectation table'
          );
          // GitHubProvider.approvePullRequest throws this same shape for ANY
          // non-ok response, so a bare "did it throw" cannot tell "GitHub
          // rejected self-approval" apart from "the request never reached
          // the right endpoint" (a 401, 404, or 403 would pass identically).
          // Pinning the status code is what actually proves the claim in
          // the label.
          assert(
            /approvePullRequest failed: 422\b/.test(message),
            `expected a 422 (self-approval rejected), got: ${message}`
          );
        }
      );
    } else if (fixture.approver) {
      await check(
        report,
        fixture,
        'approvePullRequest',
        'a second identity can approve',
        async () => {
          // "Did not throw" also passes for a provider that accepts the call
          // and silently changes nothing, the same silent-no-op shape MAT-25
          // and shouldRemoveSourceBranch were built to catch. Re-fetching and
          // checking approved/approvedBy is what actually proves the call
          // did something.
          const approverUsername = (await fixture.approver!.validateToken()).username;
          await fixture.approver!.approvePullRequest(projectPath, iid);
          const after = await pollUntil(`approved state of ${iid}`, async () => {
            const fresh = await provider.fetchSingleMR(projectPath, iid, null);
            return fresh?.approved === true ? fresh : null;
          });
          assert(after.approved === true, `expected approved to become true, got ${after.approved}`);
          assert(
            after.approvedBy.some(u => u.username === approverUsername),
            `expected approvedBy to include "${approverUsername}", got ${JSON.stringify(after.approvedBy.map(u => u.username))}`
          );
        }
      );
      await check(
        report,
        fixture,
        'unapprovePullRequest',
        'the same identity can revoke',
        async () => {
          await fixture.approver!.unapprovePullRequest(projectPath, iid);
          const after = await pollUntil(`unapproved state of ${iid}`, async () => {
            const fresh = await provider.fetchSingleMR(projectPath, iid, null);
            return fresh?.approved === false ? fresh : null;
          });
          assert(after.approved === false, `expected approved to become false, got ${after.approved}`);
        }
      );
    } else {
      report.skip(fixture.name, 'approvePullRequest', 'approval', 'no second identity');
    }
  } finally {
    // Deleting the source branch closes the PR on both providers, which is
    // the only close path available: GitProvider exposes no closePullRequest.
    await provider.deleteBranch(projectPath, branch).catch(err => {
      console.error(`  cleanup: could not delete ${branch}: ${err}`);
    });
  }
}

async function branchExists(fixture: ProviderFixture, branch: string): Promise<boolean> {
  const { provider, projectPath } = fixture;
  const path =
    fixture.name === 'github'
      ? `/repos/${projectPath}/git/ref/heads/${branch}`
      : apiPath(fixture, `/projects/${encodeURIComponent(projectPath)}/repository/branches/${encodeURIComponent(branch)}`);
  const res = await provider.restRequest('GET', path);
  return res.ok;
}

/**
 * Read back the message of the commit a merge produced.
 *
 * The merge call returning without throwing proves almost nothing: MAT-25 is a
 * silent overwrite of one message field by another, and the API reports success
 * either way. Only the resulting commit says which message actually landed.
 *
 * Polls until the message contains `marker` rather than reading once. The
 * merge-state check just above this already waits for `state === 'merged'`,
 * but that is a different field than the branch's HEAD commit, and the two
 * are not guaranteed to be consistent in the same instant. A single unguarded
 * read that raced that lag would misreport as MAT-25 for an unrelated
 * reason, which would be indistinguishable from the real defect in the
 * failure text; polling for the marker makes the evidence airtight by
 * construction rather than by observed timing.
 */
async function headCommitMessage(fixture: ProviderFixture, marker: string): Promise<string> {
  const { provider, projectPath, defaultBranch } = fixture;
  return pollUntil(`head commit for ${defaultBranch} containing "${marker}"`, async () => {
    let message: string;
    if (fixture.name === 'github') {
      const res = await provider.restRequest(
        'GET',
        `/repos/${projectPath}/commits/${defaultBranch}`
      );
      if (!res.ok) throw new Error(`could not read head commit: HTTP ${res.status}`);
      const { commit } = (await res.json()) as { commit: { message: string } };
      message = commit.message;
    } else {
      const res = await provider.restRequest(
        'GET',
        apiPath(fixture, `/projects/${encodeURIComponent(projectPath)}/repository/commits/${encodeURIComponent(defaultBranch)}`)
      );
      if (!res.ok) throw new Error(`could not read head commit: HTTP ${res.status}`);
      const { message: raw } = (await res.json()) as { message: string };
      message = raw;
    }
    return message.includes(marker) ? message : null;
  }, { timeoutMs: 15_000 });
}

/**
 * Best-effort explanation for why a merge attempt returned HTTP 405, which
 * both providers document as "the merge request cannot be merged" rather
 * than a malformed request. Used only to enrich the Inconclusive reason with
 * the MR's own current state, so the report names the actual blocking
 * precondition instead of repeating the opaque 405. A failed lookup here
 * must not mask the original 405, so every failure degrades to null instead
 * of throwing; one retry absorbs a transient GraphQL hiccup (the same class
 * of blip pollUntil's own docstring calls out) without adding the latency of
 * a full pollUntil for what is only enrichment text.
 */
async function mergeBlockDetail(fixture: ProviderFixture, iid: number): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fresh = await fixture.provider.fetchSingleMR(fixture.projectPath, iid, null);
      // Report the observed value only. This used to name a specific cause
      // (a project setting requiring a passing pipeline), which was true
      // when that setting was still enabled on the fixture; now that it's
      // disabled, the only way this string still fires is the transient
      // mergeability race waitForMergeReadiness exists to wait out, where
      // that diagnosis would be wrong. Naming a cause this function cannot
      // actually distinguish from the others is worse than naming none.
      return fresh?.detailedMergeStatus
        ? `GitLab reported detailedMergeStatus="${fresh.detailedMergeStatus}"; the merge could not proceed`
        : null;
    } catch {
      // fall through to the retry on attempt 0; give up quietly on attempt 1
    }
  }
  return null;
}

/**
 * Wait for a newly created MR to leave GitLab's transient "still computing
 * mergeability" state before attempting to merge it. Right after creation,
 * `detailedMergeStatus` sits in `checking` / `unchecked` / `preparing` for
 * roughly a second; merging during that window returns the same HTTP 405 as
 * a genuinely blocked precondition, which would be indistinguishable from
 * the fixture-precondition case the Inconclusive handling above exists to
 * detect on its own terms. `detailedMergeStatus` is always null on GitHub
 * (per its own docstring in types.ts), so this resolves on the first read
 * there and is effectively a no-op for that provider.
 */
async function waitForMergeReadiness(fixture: ProviderFixture, iid: number): Promise<void> {
  // approvals_syncing is transitional too, per MRDashboard.ts:105. Merging
  // during it races the same ambiguous 405 as the other three (MAT-132).
  const stillComputing = new Set([
    'checking',
    'unchecked',
    'preparing',
    'approvals_syncing'
  ]);
  await pollUntil(`merge readiness of ${iid}`, async () => {
    const fresh = await fixture.provider.fetchSingleMR(fixture.projectPath, iid, null);
    if (!fresh) return null;
    return stillComputing.has(fresh.detailedMergeStatus ?? '') ? null : fresh;
  }, { timeoutMs: 20_000 });
}

export async function runMergeConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  const { provider, projectPath, defaultBranch } = fixture;
  const branch = `${runPrefix()}-merge`;
  const marker = `conformance-merge-${Date.now().toString(36)}`;
  let prIid: number | null = null;
  let merged = false;

  try {
    // Wrapped in check(), matching the write cycle's setup step: an
    // unguarded createBranch/commitFile/createPullRequest here would throw
    // straight out of this function on a transient failure, producing no
    // report entry and crashing the runner before it prints anything,
    // including results already gathered for other fixtures.
    await check(report, fixture, 'createPullRequest', 'opens a PR for the merge cycle', async () => {
      await createBranch(fixture, branch);
      await commitFile(fixture, branch, `${marker}.md`, `# ${marker}\n`);
      const pr = await provider.createPullRequest({
        projectPath,
        title: 'conformance: merge cycle',
        description: 'Opened by the glance conformance harness to exercise merge. Safe to close.',
        sourceBranch: branch,
        targetBranch: defaultBranch
      });
      assert(pr.iid > 0, `expected a positive iid, got ${pr.iid}`);
      prIid = pr.iid;
    });

    if (prIid === null) return;
    const iid = prIid;

    await check(report, fixture, 'mergePullRequest', 'merges and reports merged state', async () => {
      try {
        await waitForMergeReadiness(fixture, iid);
        await provider.mergePullRequest(projectPath, iid, {
          commitMessage: `${marker} merge-commit-message`,
          squashCommitMessage: `${marker} squash-commit-message`,
          shouldRemoveSourceBranch: true
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Both providers document HTTP 405 on this endpoint as "the merge
        // request cannot be merged", an unmet precondition rather than a
        // malformed request (a bad request shape gets 400/422, not 405).
        // The GitLab fixture is known to have only_allow_merge_if_pipeline_
        // succeeds enabled with a permanently failing pipeline, so no merge
        // through this endpoint can ever succeed there no matter what
        // GitLabProvider sends. Reporting that as a hard fail would
        // misattribute a fixture precondition to the provider, so it is
        // Inconclusive instead; anything else still fails hard.
        if (/\bmergePullRequest failed: 405\b/.test(message)) {
          const detail = await mergeBlockDetail(fixture, iid);
          throw new Inconclusive(
            `merge blocked by an unmet precondition (HTTP 405)${detail ? `: ${detail}` : `. Provider said: ${message}`}`
          );
        }
        throw err;
      }
      merged = true;
      const after = await pollUntil(`merged state of ${iid}`, async () => {
        const fresh = await provider.fetchSingleMR(projectPath, iid, null);
        return fresh && fresh.state !== 'opened' ? fresh : null;
      });
      assert(
        after.state === 'merged',
        `expected state "merged", got "${after.state}"`
      );
    });

    if (!merged) {
      // A merge that never completed, whether a hard failure or an
      // Inconclusive precondition, must not leave these two downstream
      // assertions silently missing from the report: silent absence is
      // indistinguishable from them never having been written at all, which
      // is exactly the failure mode this harness exists to catch.
      report.skip(
        fixture.name,
        'mergePullRequest',
        'the commitMessage we asked for actually reaches the commit (MAT-25)',
        'not run: the merge itself did not complete'
      );
      report.skip(
        fixture.name,
        'mergePullRequest',
        'shouldRemoveSourceBranch actually deletes the source branch',
        'not run: the merge itself did not complete'
      );
      return;
    }

    await check(
      report,
      fixture,
      'mergePullRequest',
      'the commitMessage we asked for actually reaches the commit (MAT-25)',
      async () => {
        const message = await headCommitMessage(fixture, marker);
        assert(
          message.includes(marker),
          `head commit does not mention this run at all. Got: ${message.slice(0, 200)}`
        );
        assert(
          message.includes('merge-commit-message'),
          `commitMessage was dropped. Head commit was: ${message.slice(0, 200)}`
        );
        // The positive check alone cannot fail a fix that writes both messages
        // into the same commit, which is what the design doc originally
        // prescribed. This merge asked for no merge method, so it is not a
        // squash, so squashCommitMessage does not apply to it and must not
        // appear anywhere in the resulting commit.
        assert(
          !message.includes('squash-commit-message'),
          `squashCommitMessage leaked into a non-squash merge commit. Head commit was: ${message.slice(0, 200)}`
        );
      }
    );

    // This assumes the fixture has GitHub's "automatically delete head
    // branches" repo setting (delete_branch_on_merge) turned off, which is
    // true today. If that setting were ever enabled, GitHub's own async
    // post-merge cleanup could delete the branch on its own, independent of
    // shouldRemoveSourceBranch, and this assertion would pass for the wrong
    // reason: a false pass that would silently stop proving the defect it
    // exists to catch.
    await check(
      report,
      fixture,
      'mergePullRequest',
      'shouldRemoveSourceBranch actually deletes the source branch',
      async () => {
        const stillThere = await branchExists(fixture, branch);
        assert(
          !stillThere,
          'branch still exists after merging with shouldRemoveSourceBranch: true'
        );
      }
    );
  } finally {
    // branchExists itself can throw (a network blip), and an unguarded call
    // here would skip deleteBranch entirely on exactly that failure, leaving
    // a branch behind, which is the outcome this cleanup exists to prevent.
    // Defaulting to "assume it's still there" and attempting the delete
    // anyway is safe: deleteBranch on an already-gone branch just fails
    // harmlessly into the .catch below.
    let stillThere = true;
    try {
      stillThere = await branchExists(fixture, branch);
    } catch (err) {
      console.error(`  cleanup: could not check whether ${branch} exists, deleting anyway: ${err}`);
    }
    if (stillThere) {
      await provider.deleteBranch(projectPath, branch).catch(err => {
        console.error(`  cleanup: could not delete ${branch}: ${err}`);
      });
    }
  }
}

interface PipelineProbe {
  pipelineId: number;
  jobId: number;
}

async function latestPipelineAndJob(fixture: ProviderFixture): Promise<PipelineProbe | null> {
  const { provider, projectPath } = fixture;

  if (fixture.name === 'github') {
    const runsRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/actions/runs?per_page=1&status=completed`
    );
    if (!runsRes.ok) return null;
    const runs = (await runsRes.json()) as { workflow_runs: Array<{ id: number }> };
    const run = runs.workflow_runs[0];
    if (!run) return null;
    const jobsRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/actions/runs/${run.id}/jobs`
    );
    if (!jobsRes.ok) return null;
    const jobs = (await jobsRes.json()) as { jobs: Array<{ id: number }> };
    const job = jobs.jobs[0];
    return job ? { pipelineId: run.id, jobId: job.id } : null;
  }

  const encoded = encodeURIComponent(projectPath);
  const pipeRes = await provider.restRequest(
    'GET',
    apiPath(fixture, `/projects/${encoded}/pipelines?per_page=1`)
  );
  if (!pipeRes.ok) return null;
  const pipes = (await pipeRes.json()) as Array<{ id: number }>;
  const pipe = pipes[0];
  if (!pipe) return null;
  const jobsRes = await provider.restRequest(
    'GET',
    apiPath(fixture, `/projects/${encoded}/pipelines/${pipe.id}/jobs`)
  );
  if (!jobsRes.ok) return null;
  const jobs = (await jobsRes.json()) as Array<{ id: number }>;
  const job = jobs[0];
  return job ? { pipelineId: pipe.id, jobId: job.id } : null;
}

/**
 * Run `body` against a job that has genuinely FAILED, then clean up.
 *
 * `retryJob` and `fetchJobTrace` exist for failed jobs, so probing them with
 * whatever job happened to run last tests the wrong state: a passing job's log
 * proves nothing about how a failure is surfaced. The fixture's `controllable`
 * job fails exactly when the branch carries a `fail-marker` file, and the
 * workflow triggers on `pull_request`, so the branch needs a PR to run at all.
 *
 * GitHub only. The GitLab fixture's `.gitlab-ci.yml` is not ours to change.
 */
async function withFailedGitHubJob(
  fixture: ProviderFixture,
  body: (probe: PipelineProbe) => Promise<void>
): Promise<void> {
  const { provider, projectPath, defaultBranch } = fixture;
  const branch = `${runPrefix()}-failjob`;

  try {
    await createBranch(fixture, branch);
    await commitFile(fixture, branch, 'fail-marker', 'makes the controllable job fail\n');
    await provider.createPullRequest({
      projectPath,
      title: 'conformance: failed-job fixture',
      description: 'Opened by the glance conformance harness to produce a failed job. Safe to close.',
      sourceBranch: branch,
      targetBranch: defaultBranch
    });

    const probe = await pollUntil(
      `controllable job to fail on ${branch}`,
      async () => {
        const runsRes = await provider.restRequest(
          'GET',
          `/repos/${projectPath}/actions/runs?branch=${encodeURIComponent(branch)}`
        );
        if (!runsRes.ok) return null;
        const { workflow_runs: runs } = (await runsRes.json()) as {
          workflow_runs: Array<{ id: number }>;
        };
        for (const run of runs) {
          const jobsRes = await provider.restRequest(
            'GET',
            `/repos/${projectPath}/actions/runs/${run.id}/jobs`
          );
          if (!jobsRes.ok) continue;
          const { jobs } = (await jobsRes.json()) as {
            jobs: Array<{ id: number; name: string; status: string; conclusion: string | null }>;
          };
          const failed = jobs.find(
            j => j.name === 'controllable' && j.status === 'completed' && j.conclusion === 'failure'
          );
          if (failed) return { pipelineId: run.id, jobId: failed.id };
        }
        return null;
      },
      { timeoutMs: 300_000, intervalMs: 5_000 }
    );

    await body(probe);
  } finally {
    // Deleting the branch also closes the PR. There is no closePullRequest.
    await provider.deleteBranch(projectPath, branch).catch(err => {
      console.error(`  cleanup: could not delete ${branch}: ${err}`);
    });
  }
}

export async function runCiConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  const { provider, projectPath } = fixture;

  const probe = await latestPipelineAndJob(fixture);
  if (!probe) {
    report.skip(fixture.name, 'fetchJobTrace', 'CI probe', 'no completed pipeline found');
    return;
  }

  await check(report, fixture, 'fetchJobTrace', 'returns non-empty log text', async () => {
    const trace = await provider.fetchJobTrace(projectPath, probe.jobId);
    assert(typeof trace === 'string', `expected a string, got ${typeof trace}`);
    assert(trace.length > 0, 'trace was empty');
    assert(
      !trace.trimStart().startsWith('<'),
      'trace looks like HTML or XML, which usually means a redirect returned an error page'
    );
  });

  await check(report, fixture, 'fetchJobDetail', 'returns a discriminated detail', async () => {
    const detail = await provider.fetchJobDetail(projectPath, probe.jobId, probe.pipelineId);
    assert(
      detail.type === 'trace' || detail.type === 'bridge',
      `unexpected detail type ${JSON.stringify(detail)}`
    );
  });

  await check(report, fixture, 'fetchDownstreamPipeline', 'resolves without throwing', async () => {
    await provider.fetchDownstreamPipeline(projectPath, probe.jobId);
  });

  await check(report, fixture, 'retryPipeline', 'accepts a retry request', async () => {
    await provider.retryPipeline(projectPath, probe.pipelineId);
  });

  if (fixture.name !== 'github') return;

  try {
    await withFailedGitHubJob(fixture, async failed => {
      await check(
        report,
        fixture,
        'fetchJobTrace',
        'returns the log of a job that actually failed',
        async () => {
          const trace = await provider.fetchJobTrace(projectPath, failed.jobId);
          assert(typeof trace === 'string', `expected a string, got ${typeof trace}`);
          assert(trace.length > 0, 'trace was empty');
          assert(
            !trace.trimStart().startsWith('<'),
            'trace looks like HTML or XML, which usually means a redirect returned an error page'
          );
          assert(
            trace.includes('fail-marker present'),
            `trace did not contain the fixture's failure line. First 200 chars: ${trace.slice(0, 200)}`
          );
        }
      );

      await check(report, fixture, 'retryJob', 'accepts a retry of the failed job', async () => {
        await provider.retryJob(projectPath, failed.jobId);
      });
    });
  } catch (err) {
    report.fail(
      fixture.name,
      'retryJob',
      'provision a genuinely failed job',
      err instanceof Error ? err.message : String(err)
    );
  }
}
