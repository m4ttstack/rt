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
  const res = await fixture.provider.restRequest('GET', path);
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

      // Not proof that MAT-131 is fixed: this fixture's protection read always
      // succeeds, so the failure path never runs here. It does make the
      // fabricated shape detectable if it ever comes back, since only the
      // success path attaches raw.
      for (const rule of rules) {
        assert(
          rule.raw !== undefined,
          `rule for "${rule.pattern}" has no raw field, which is the shape a fabricated rule had (MAT-131)`
        );
      }
    }
  );

  await check(report, fixture, 'restRequest', 'authenticated GET succeeds', async () => {
    const res = await provider.restRequest('GET', '/user');
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
      // No placeholder skip here any more. Every method in `probes` now
      // reaches a real result on both providers, by one route or another:
      //   rebasePullRequest   GitLab (supported) via runGitLabMutationConformance;
      //                       GitHub declares it unsupported, so it never
      //                       reaches this branch at all and is probed below.
      //   setAutoMerge        GitLab (supported) via runGitLabMutationConformance;
      //   cancelAutoMerge     GitHub declares setAutoMerge `approximate` and
      //                       cancelAutoMerge supported, both exercised by the
      //                       measured block in runWriteConformance.
      //   unapprovePullRequest,
      //   resolveDiscussion,
      //   unresolveDiscussion by runWriteConformance on either provider.
      // A "supported-path not exercised here" line next to a real result for
      // the same method reads as a coverage gap that no longer exists, and
      // the runner's assertFullCoverage is the honest backstop if one of
      // those routes ever stops running: it reports the absence as a FAIL
      // rather than as a skip that was pre-written to look accounted for.
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
      : `/projects/${encodeURIComponent(projectPath)}`;
  const res = await provider.restRequest('GET', path);
  if (!res.ok) throw new Error(`could not resolve repo id: HTTP ${res.status}`);
  const { id } = (await res.json()) as { id: number };
  return `${fixture.name}:${id}`;
}

/**
 * `from` defaults to the fixture's default branch, which is what every
 * existing caller wants. It is a parameter because the rebase cycle needs a
 * throwaway branch cut from another throwaway branch: rebasing proves nothing
 * unless the target can be advanced underneath the merge request, and on this
 * fixture the default branch is protected with push access "No one", so
 * advancing it is not an option even where it would be acceptable.
 */
async function createBranch(
  fixture: ProviderFixture,
  branch: string,
  from?: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const ref = from ?? fixture.defaultBranch;
  if (fixture.name === 'github') {
    const refRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/git/ref/heads/${ref}`
    );
    if (!refRes.ok) throw new Error(`read ref "${ref}" failed: HTTP ${refRes.status}`);
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
    `/projects/${encoded}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(ref)}`
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
    `/projects/${encoded}/repository/files/${encodeURIComponent(path)}`,
    { branch, content, commit_message: `conformance: add ${path}` }
  );
  if (!res.ok) throw new Error(`commit failed: HTTP ${res.status}`);
}

/**
 * Post a comment anchored to a line of `path`, which must already be
 * committed on the PR's branch. This is what gives resolveDiscussion and
 * unresolveDiscussion a thread to act on: neither method creates one of its
 * own, and a plain issue-level comment carries no resolvable state on either
 * provider, only a diff-anchored one does.
 */
async function postDiffComment(
  fixture: ProviderFixture,
  iid: number,
  path: string
): Promise<void> {
  const { provider, projectPath } = fixture;
  const body = 'conformance: harness-created review thread';
  // A bare status code is not enough to diagnose a 400 on this endpoint: the
  // body carries GitHub's/GitLab's own explanation of which field it
  // rejected, and without it a bad payload here is nearly unreadable from a
  // log.
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
  // GitLab needs the MR's own diff_refs (not just any sha) to anchor a
  // position-based note; these come from the merge request itself, not from
  // the commit that was just pushed.
  const mrRes = await provider.restRequest(
    'GET',
    `/projects/${encoded}/merge_requests/${iid}`
  );
  if (!mrRes.ok) throw await readError(mrRes, 'could not read MR for diff comment');
  const { diff_refs } = (await mrRes.json()) as {
    diff_refs: { base_sha: string; start_sha: string; head_sha: string };
  };
  const res = await provider.restRequest(
    'POST',
    `/projects/${encoded}/merge_requests/${iid}/discussions`,
    {
      body,
      position: {
        base_sha: diff_refs.base_sha,
        start_sha: diff_refs.start_sha,
        head_sha: diff_refs.head_sha,
        position_type: 'text',
        // GitLab's text-position schema has historically required old_path
        // even for a line that has no "old" side at all. Since `path` is a
        // freshly-added file, the only value that makes sense is the same
        // path on both sides.
        old_path: path,
        new_path: path,
        new_line: 1
      }
    }
  );
  if (!res.ok) throw await readError(res, 'diff comment');
}

export async function runWriteConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  const { provider, projectPath, defaultBranch } = fixture;
  const branch = `${runPrefix()}-write`;
  // Reused later to seed the discussion-resolution checks: they need a diff
  // comment anchored to a real file already in the PR, and this is the one
  // the PR is opened with.
  const seedFilePath = `conformance-${Date.now()}.md`;
  let prIid: number | null = null;

  try {
    await check(report, fixture, 'deleteBranch', 'the branch is gone afterwards', async () => {
      // Deliberately not asserting on the cleanup deletions in this
      // function's own finally block below: those must stay non-fatal, and
      // an assertion there would make a cleanup failure fail the run it was
      // cleaning up after. This is a dedicated throwaway branch instead.
      const throwaway = `conformance/delete-${Date.now()}`;
      await createBranch(fixture, throwaway);
      assert(await branchExists(fixture, throwaway), 'setup failed: branch was not created');

      await provider.deleteBranch(projectPath, throwaway);

      // `pollUntil` only ever resolves once its predicate has already seen
      // the branch gone, or throws its own generic "timed out" error, so an
      // `assert` chained after a successful resolution could never fire and
      // its message could never reach a reader. Catching the timeout and
      // rethrowing with the diagnostic that actually names the failure
      // (rather than a follow-up assert on a value known safe) is what makes
      // that message reachable.
      try {
        await pollUntil(`absence of ${throwaway}`, async () =>
          (await branchExists(fixture, throwaway)) ? null : true
        );
      } catch {
        throw new Error(`branch ${throwaway} still exists after deleteBranch`);
      }
    });

    await check(report, fixture, 'createPullRequest', 'opens a PR from a new branch', async () => {
      await createBranch(fixture, branch);
      await commitFile(fixture, branch, seedFilePath, '# conformance\n');
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

    // A second identity, when present, is strictly stronger evidence than the
    // self-approval-rejection probe: it exercises the actual accept and
    // revoke paths instead of only proving the request reaches the API. So
    // it is tried first regardless of provider, and the probe -- read from
    // the expectation table rather than an `if (fixture.name === 'github')`
    // -- is only the fallback for when no second identity is configured.
    const approveExpectation = expectationFor(fixture.name, 'approvePullRequest');
    if (fixture.approver) {
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
          // Same reasoning as requestReReview's check below: pollUntil
          // resolves only once its predicate already found approved ===
          // false, so a follow-up assert on that same condition could never
          // fire, and this success path has never run live before, so a
          // failure here is exactly where phase 4's real bug would recur.
          // Catching the timeout and re-reading gets the actual
          // approved/approvedBy state into the failure message instead of
          // pollUntil's generic "timed out" text.
          try {
            await pollUntil(`unapproved state of ${iid}`, async () => {
              const fresh = await provider.fetchSingleMR(projectPath, iid, null);
              return fresh?.approved === false ? fresh : null;
            });
          } catch {
            const fresh = await provider.fetchSingleMR(projectPath, iid, null).catch(() => null);
            throw new Error(
              `expected approved to become false, got ${fresh?.approved} ` +
                `(approvedBy: ${JSON.stringify(fresh?.approvedBy.map(u => u.username) ?? [])})`
            );
          }
        }
      );
    } else if (approveExpectation.selfApprovalRejectionStatus !== undefined) {
      const rejectionStatus = approveExpectation.selfApprovalRejectionStatus;
      await check(
        report,
        fixture,
        'approvePullRequest',
        `self-approval is rejected with ${rejectionStatus}, proving request shape reaches the provider`,
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
          // The provider throws this same shape for ANY non-ok response, so
          // a bare "did it throw" cannot tell "self-approval rejected" apart
          // from "the request never reached the right endpoint" (a 401,
          // 404, or 403 would pass identically). Pinning the status code is
          // what actually proves the claim in the label.
          assert(
            new RegExp(`approvePullRequest failed: ${rejectionStatus}\\b`).test(message),
            `expected a ${rejectionStatus} (self-approval rejected), got: ${message}`
          );
        }
      );
      report.skip(
        fixture.name,
        'unapprovePullRequest',
        'dismissal',
        'no second identity: dismissal needs an approval, and this provider rejects self-approval instead of accepting one'
      );
    } else {
      report.skip(fixture.name, 'approvePullRequest', 'approval', 'no second identity');
      report.skip(
        fixture.name,
        'unapprovePullRequest',
        'dismissal',
        'no second identity: dismissal needs an approval'
      );
    }

    if (fixture.approver) {
      await check(
        report,
        fixture,
        'requestReReview',
        'names a reviewer who was not already one',
        async () => {
          // The PR created above never assigned reviewers, so the approver
          // identity starts outside the reviewer set. Asserting on the
          // re-read (not on "did not throw") is what makes this a real
          // check: a no-op that swallows the username would pass a
          // throw-only assertion identically.
          const approverUsername = (await fixture.approver!.validateToken()).username;
          await provider.requestReReview(projectPath, iid, [approverUsername]);
          // Same reasoning as deleteBranch's check above: pollUntil resolves
          // only once its predicate already found approverUsername in the
          // reviewer list, so a follow-up assert on that same condition could
          // never fire. Catching the timeout and re-reading here is what
          // gets the actual reviewer list into the failure message instead
          // of pollUntil's generic "timed out" text.
          try {
            await pollUntil(`reviewers of ${iid}`, async () => {
              const fresh = await provider.fetchSingleMR(projectPath, iid, null);
              return fresh?.reviewers.some(r => r.username === approverUsername) ? fresh : null;
            });
          } catch {
            const fresh = await provider.fetchSingleMR(projectPath, iid, null).catch(() => null);
            throw new Error(
              `expected reviewers to include "${approverUsername}", got ${JSON.stringify(fresh?.reviewers.map(r => r.username) ?? [])}`
            );
          }
        }
      );
    } else {
      report.skip(
        fixture.name,
        'requestReReview',
        're-request',
        'no second identity: GitHub rejects a review request from the PR author'
      );
    }

    if (expectationFor(fixture.name, 'resolveDiscussion').support === 'supported') {
      // Neither resolveDiscussion nor unresolveDiscussion creates a thread of
      // its own, so without one there is nothing for either to act on. A
      // diff comment is required, not a plain issue comment: an issue-level
      // comment carries no resolvable state on either provider (see
      // GitHubProvider's toNote and GitLabProvider's rollUpResolution, both
      // of which report `resolvable: null`/`false` for those).
      let setupError: string | null = null;
      try {
        await postDiffComment(fixture, iid, seedFilePath);
      } catch (err) {
        setupError = err instanceof Error ? err.message : String(err);
      }

      if (setupError !== null) {
        // Recorded through the Reporter, not console.error alone: a swallowed
        // setup failure here used to leave both checks below to fall into
        // their own "no resolvable discussion" Inconclusive skip, which
        // renders identically to "the fixture PR genuinely had no thread" --
        // indistinguishable from a harness that is working correctly against
        // a fixture with nothing to check. report.fail (not skip) because
        // this is a failure in the harness's own write path, not an absent
        // fixture precondition; it is also the only report state whose
        // entries print individually in Reporter.render()'s summary, which
        // is what actually closes the visibility gap.
        report.fail(
          fixture.name,
          'resolveDiscussion',
          'resolves a harness-created thread and the read side reports it',
          `setup failed before this check could run: could not post the diff comment it needs a thread from: ${setupError}`
        );
        report.fail(
          fixture.name,
          'unresolveDiscussion',
          'unresolves the same harness-created thread',
          `setup failed before this check could run: could not post the diff comment it needs a thread from: ${setupError}`
        );
      } else {
        await check(
          report,
          fixture,
          'resolveDiscussion',
          'resolves a harness-created thread and the read side reports it',
          async () => {
            // `repoId` is local to runReadConformance; the write cycle has to
            // derive its own. `fetchMRDiscussions` takes the scoped
            // `<provider>:<numericId>` form, not `owner/repo`.
            const repoId = await scopedRepoId(fixture);
            const detail = await provider.fetchMRDiscussions(repoId, iid);
            const target = detail.discussions.find(d => d.resolvable === true);
            if (!target) throw new Inconclusive('no resolvable discussion on the fixture PR');

            // This has to run before the mutation, and on its own. The thread
            // was just created and is unresolved, so a healthy read reports
            // `resolved: false`. `null` is what GitHub's provider returns
            // when fetchMRDiscussions catches a GraphQL failure on its own
            // read and degrades silently -- the exact shape that let the
            // isResolvable bug ship with ten green unit tests and a passing
            // "returns a detail object" harness check. resolveDiscussion's
            // mutation call below cannot degrade the same way, so asserting
            // only after it runs would let a broken read hide behind a
            // mutation that still throws or succeeds on its own.
            assert(
              target.resolved === false,
              `expected the read side to report resolved: false for a fresh thread, got ${target.resolved} -- ` +
                'null means fetchMRDiscussions degraded instead of reporting real state'
            );

            await provider.resolveDiscussion(projectPath, iid, target.id);

            // Re-reading is the assertion. "Did not throw" also passes for a
            // provider that accepts the call and changes nothing, which is the
            // shape MAT-25 and shouldRemoveSourceBranch were built to catch.
            // pollUntil itself only resolves once `resolved === true` is
            // already true, so a trailing assert on that same value could
            // never fire; catching the timeout and re-reading here is what
            // puts the actual resolved state into the failure message.
            try {
              await pollUntil(`resolved state of ${target.id}`, async () => {
                const fresh = await provider.fetchMRDiscussions(repoId, iid);
                const d = fresh.discussions.find(x => x.id === target.id);
                return d?.resolved === true ? d : null;
              });
            } catch {
              const fresh = await provider.fetchMRDiscussions(repoId, iid).catch(() => null);
              const d = fresh?.discussions.find(x => x.id === target.id);
              throw new Error(`expected resolved true, got ${d?.resolved}`);
            }
          }
        );

        await check(
          report,
          fixture,
          'unresolveDiscussion',
          'unresolves the same harness-created thread',
          async () => {
            const repoId = await scopedRepoId(fixture);
            const detail = await provider.fetchMRDiscussions(repoId, iid);
            const target = detail.discussions.find(d => d.resolved === true);
            if (!target) throw new Inconclusive('no resolved discussion to unresolve');

            await provider.unresolveDiscussion(projectPath, iid, target.id);

            // Same reasoning as resolveDiscussion's check above: catch the
            // poll timeout and re-read, rather than chaining an assert that
            // pollUntil's own success already guarantees.
            try {
              await pollUntil(`unresolved state of ${target.id}`, async () => {
                const fresh = await provider.fetchMRDiscussions(repoId, iid);
                const d = fresh.discussions.find(x => x.id === target.id);
                return d?.resolved === false ? d : null;
              });
            } catch {
              const fresh = await provider.fetchMRDiscussions(repoId, iid).catch(() => null);
              const d = fresh?.discussions.find(x => x.id === target.id);
              throw new Error(`expected resolved false, got ${d?.resolved}`);
            }
          }
        );
      }
    }

    // GitHub only: task 7's spike measured this fixture's own required
    // check, not GitLab's, and the armable window this block navigates is a
    // property of GitHub's enablePullRequestAutoMerge, which refuses at both
    // ends of the mergeability range. GitLab's auto-merge is a different
    // behaviour ("merge when the pipeline succeeds") needing a different
    // precondition, so it has its own cycle in
    // runGitLabMutationConformance rather than a branch inside this one.
    // That is where GitLab's coverage of both methods now comes from; it
    // used to come from a placeholder skip in runUnsupportedConformance,
    // which is gone precisely because a real check replaced it.
    if (fixture.name === 'github' && expectationFor(fixture.name, 'setAutoMerge').support === 'approximate') {
      await check(
        report,
        fixture,
        'setAutoMerge',
        'arms auto-merge and a re-read confirms it',
        async () => {
          // Tracks whether `provider.setAutoMerge` itself completed without
          // throwing, i.e. GitHub actually accepted the mutation and
          // confirmed `enabledAt` (see GitHubProvider.setAutoMerge). That is
          // the only signal that anything was armed. Gating the finally
          // block's cancelAutoMerge grading on it matters because run 2 hit
          // exactly the case where this would otherwise go unnoticed:
          // setAutoMerge failed outright, nothing was ever armed, and a
          // re-read confirming auto-merge is off would have been satisfied
          // by a pull request that never had it -- a vacuous pass of the
          // cancelAutoMerge check.
          let armed = false;
          try {
            try {
              await provider.setAutoMerge(projectPath, iid);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              // GitHub refuses enablePullRequestAutoMerge at both ends of the
              // mergeability range: "unstable" (checks failing or pending in
              // a way GitHub will not queue behind) and "clean" (every
              // required check already passed, so there is nothing left to
              // wait for). Arming is only possible in the window between
              // those two states, which is what run 1 hit. Run 1 armed
              // auto-merge successfully with identical code, so either
              // refusal is a fixture-timing precondition, not a setAutoMerge
              // defect; matching only these two exact GitHub wordings
              // (rather than every GraphQL error) keeps a genuine defect --
              // a bad node id, a real 4xx, a malformed mutation, or a
              // mutation GitHub accepts while arming nothing -- reporting as
              // a hard fail.
              if (/\bis in (?:unstable|clean) status\b/.test(message)) {
                throw new Inconclusive(
                  `pull request is at an end of the mergeability range GitHub refuses to arm auto-merge on: ${message}`
                );
              }
              throw err;
            }
            armed = true;
            const after = await provider.fetchSingleMR(projectPath, iid, null);
            assert(
              after?.autoMergeEnabled === true,
              `expected autoMergeEnabled true after setAutoMerge, got ${after?.autoMergeEnabled}`
            );
          } finally {
            if (!armed) {
              // Nothing was armed, so there is nothing for cancelAutoMerge
              // to disarm. Calling it anyway and grading the re-read would
              // report a pass that a pull request which never had
              // auto-merge on would satisfy just as well; that proves
              // nothing about cancelAutoMerge, so it must not be reported
              // as a check result at all.
              report.skip(
                fixture.name,
                'cancelAutoMerge',
                'disarms auto-merge and a re-read confirms it',
                'setAutoMerge did not arm auto-merge on this run, so there was nothing for cancelAutoMerge to disarm'
              );
            } else {
              // The task 7 spike proved this fixture's required check can
              // settle, and GitHub's own automation will complete a real merge
              // the moment it does, while auto-merge is armed -- inside a
              // window as wide as 90 seconds. No sleep and no poll between
              // enabling above and cancelling here: every call inserted into
              // that gap only widens the window this project has no way to
              // close to zero, only to the minimum number of round trips. If
              // the required check wins that race before this cancel lands,
              // GitHub answers with "Can't disable auto-merge for this pull
              // request" because there is nothing left to cancel; that is not
              // a defect, so it is recorded as a measured skip rather than a
              // failure. Losing the race also costs nothing new: the result is
              // the same one file-and-commit artifact every merge-cycle run
              // already leaves on this fixture by design, not a new kind of
              // permanent side effect.
              try {
                await provider.cancelAutoMerge(projectPath, iid);
                const after = await provider.fetchSingleMR(projectPath, iid, null);
                if (after?.autoMergeEnabled === false) {
                  report.pass(fixture.name, 'cancelAutoMerge', 'disarms auto-merge and a re-read confirms it');
                } else {
                  report.fail(
                    fixture.name,
                    'cancelAutoMerge',
                    'disarms auto-merge and a re-read confirms it',
                    `cancelAutoMerge did not throw but autoMergeEnabled reads back as ${after?.autoMergeEnabled}`
                  );
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // The message alone is not proof of the race: GitHub returns
                // this exact string whenever there is nothing to cancel for
                // ANY reason, including cancelAutoMerge being simply broken, or
                // the enable step above never having armed anything in the
                // first place. Trusting the substring would let a genuinely
                // broken cancelAutoMerge report "skip: the check won the race"
                // on every single call, forever, and a skip asserting a cause
                // nobody checked is worse than a failure, because it reads as
                // accounted for. Re-reading the PR's own state is what actually
                // tells the race apart from that.
                const reread = await provider.fetchSingleMR(projectPath, iid, null).catch(() => null);
                if (reread?.state === 'merged' || reread?.state === 'closed') {
                  report.skip(
                    fixture.name,
                    'cancelAutoMerge',
                    'disarms auto-merge and a re-read confirms it',
                    `the required check won the race and GitHub merged the PR before this call could land (confirmed by re-read: state="${reread.state}"): ${message}`
                  );
                } else {
                  report.fail(
                    fixture.name,
                    'cancelAutoMerge',
                    'disarms auto-merge and a re-read confirms it',
                    `cancelAutoMerge failed and a re-read does not support the "already merged" narrative (state="${reread?.state ?? 'unreadable'}"): ${message}`
                  );
                }
              }
            }
          }
        }
      );
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
      : `/projects/${encodeURIComponent(projectPath)}/repository/branches/${encodeURIComponent(branch)}`;
  const res = await provider.restRequest('GET', path);
  return res.ok;
}

/**
 * Pipeline statuses GitLab itself treats as still active.
 *
 * Deliberately not the complement of TERMINAL_GITLAB_PIPELINE_STATUSES far
 * below: `manual`, `scheduled`, and `skipped` belong to neither set. What
 * decides whether merge-when-pipeline-succeeds has anything left to wait on
 * is GitLab's own active list, not "has not finished", and arming against a
 * pipeline outside that list is what makes GitLab merge the request
 * immediately instead.
 */
const ACTIVE_GITLAB_PIPELINE_STATUSES = new Set([
  'created',
  'waiting_for_resource',
  'preparing',
  'pending',
  'running'
]);

/**
 * The CI configuration the rebase/auto-merge cycle commits onto its own
 * throwaway source branch, replacing (only on that branch) the fixture's
 * real one.
 *
 * setAutoMerge on GitLab means "merge when the pipeline succeeds", so it can
 * only be armed while a pipeline is actually active. The fixture's own
 * pipelines settle to `failed` about fifteen seconds after a push, which
 * would make the precondition for this check a race against a stopwatch: a
 * run that lost it would report Inconclusive with nothing wrong, and a run
 * that won it by a second would leave the cancelAutoMerge check no window at
 * all. A job that just sleeps turns that race into a controlled precondition.
 * This is the same technique withFailedGitHubJob already uses on the GitHub
 * side, where a `fail-marker` file is committed to make a job fail on demand.
 *
 * The fixture's committed `.gitlab-ci.yml` is not modified: this content
 * exists only on a branch this harness created and deletes again, and the
 * pipeline is cancelled in the cleanup below rather than left to sleep out
 * the fixture's shared-runner quota.
 */
const HOLD_OPEN_CI_YML = `# Written by the glance live conformance harness onto a throwaway branch.
# Keeps a pipeline active long enough to arm merge-when-pipeline-succeeds.
hold-open:
  image: alpine:3
  script:
    - sleep 240
`;

/**
 * Overwrite `.gitlab-ci.yml` on one branch.
 *
 * Separate from `commitFile` because it is an update, not a create: every
 * branch this cycle cuts descends from the default branch, so the file is
 * already there and GitLab's create endpoint answers "a file with this name
 * already exists". Kept GitLab-only for the same reason the rest of this
 * section is.
 */
async function overwriteGitLabCiConfig(
  fixture: ProviderFixture,
  branch: string,
  content: string
): Promise<void> {
  const encoded = encodeURIComponent(fixture.projectPath);
  const res = await fixture.provider.restRequest(
    'PUT',
    `/projects/${encoded}/repository/files/${encodeURIComponent('.gitlab-ci.yml')}`,
    {
      branch,
      content,
      commit_message: 'conformance: hold a pipeline open on this throwaway branch'
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`could not overwrite .gitlab-ci.yml on ${branch}: HTTP ${res.status}${text ? `: ${text}` : ''}`);
  }
}

/**
 * The GitLab merge request state these checks reason about, read straight
 * from REST rather than through the provider.
 *
 * Same rationale as fetchProjectId's: this is the ground truth a check
 * compares against, and reading it through the very provider under test
 * would let one broken mapping satisfy both sides of an assertion. It also
 * carries fields the domain PullRequest deliberately does not model at all
 * (`merge_error`, the head pipeline's own sha), which the diagnostics below
 * need in order to name why a precondition was not met.
 */
interface GitLabMrProbe {
  state: string;
  headPipelineId: number | null;
  headPipelineStatus: string | null;
  headPipelineSha: string | null;
  mergeError: string | null;
  rebaseInProgress: boolean;
}

async function gitlabMrProbe(fixture: ProviderFixture, iid: number): Promise<GitLabMrProbe> {
  const encoded = encodeURIComponent(fixture.projectPath);
  const res = await fixture.provider.restRequest(
    'GET',
    `/projects/${encoded}/merge_requests/${iid}?include_rebase_in_progress=true`
  );
  if (!res.ok) throw new Error(`could not read merge request !${iid}: HTTP ${res.status}`);
  const body = (await res.json()) as {
    state: string;
    merge_error: string | null;
    rebase_in_progress?: boolean;
    head_pipeline?: { id: number; status: string; sha: string } | null;
  };
  return {
    state: body.state,
    headPipelineId: body.head_pipeline?.id ?? null,
    headPipelineStatus: body.head_pipeline?.status ?? null,
    headPipelineSha: body.head_pipeline?.sha ?? null,
    mergeError: body.merge_error ?? null,
    rebaseInProgress: body.rebase_in_progress ?? false
  };
}

/**
 * A branch's head commit and that commit's parents.
 *
 * The parents are the point. A rebase that landed rewrites the source
 * branch's commit onto the target's current head, so the new head's parent
 * IS the target's head sha. A changed sha on its own would also be produced
 * by an unrelated push, and an unchanged sha would also be produced by a
 * rebase GitLab accepted and never ran.
 */
async function gitlabBranchHead(
  fixture: ProviderFixture,
  branch: string
): Promise<{ sha: string; parentIds: string[] }> {
  const encoded = encodeURIComponent(fixture.projectPath);
  const res = await fixture.provider.restRequest(
    'GET',
    `/projects/${encoded}/repository/branches/${encodeURIComponent(branch)}`
  );
  if (!res.ok) throw new Error(`could not read branch "${branch}": HTTP ${res.status}`);
  const body = (await res.json()) as { commit: { id: string; parent_ids: string[] } };
  return { sha: body.commit.id, parentIds: body.commit.parent_ids };
}

/**
 * Stop the hold-open pipeline (and anything else still running on that ref).
 *
 * Deleting a branch does not cancel a pipeline already running on it, and
 * this cycle deliberately starts one designed to run for minutes. Failures
 * here are logged rather than thrown: this is cleanup, and a cleanup failure
 * must not fail the run it is cleaning up after.
 */
async function cancelActiveGitLabPipelines(
  fixture: ProviderFixture,
  ref: string
): Promise<void> {
  const encoded = encodeURIComponent(fixture.projectPath);
  try {
    const res = await fixture.provider.restRequest(
      'GET',
      `/projects/${encoded}/pipelines?ref=${encodeURIComponent(ref)}`
    );
    if (!res.ok) return;
    const pipelines = (await res.json()) as Array<{ id: number; status: string }>;
    for (const pipeline of pipelines) {
      if (!ACTIVE_GITLAB_PIPELINE_STATUSES.has(pipeline.status)) continue;
      await fixture.provider.restRequest(
        'POST',
        `/projects/${encoded}/pipelines/${pipeline.id}/cancel`
      );
    }
  } catch (err) {
    console.error(`  cleanup: could not cancel pipelines on ${ref}: ${err}`);
  }
}

/**
 * GitLab's rebasePullRequest, setAutoMerge, and cancelAutoMerge: three
 * methods the expectation table has declared supported since before this
 * harness existed, and which nothing had ever run live.
 *
 * GitLab-only, for the same reason the measured auto-merge block inside
 * runWriteConformance is GitHub-only: these are not one behaviour with two
 * spellings. GitHub declares rebasePullRequest permanently unsupported (its
 * update-branch merges base into head), and its auto-merge pair is exercised
 * against GitHub's own enablePullRequestAutoMerge semantics, which are
 * "queue behind required checks", not GitLab's "merge when the pipeline
 * succeeds".
 *
 * The whole cycle runs between two throwaway branches, never against the
 * default branch. Two independent reasons: the rebase needs a target that
 * can be advanced underneath the merge request, and the fixture's default
 * branch is protected with push access "No one"; and auto-merge, if any
 * precondition reasoning below turns out to be wrong, could actually fire,
 * so the branch it would merge into must be one whose contents nobody keeps.
 */
export async function runGitLabMutationConformance(
  fixture: ProviderFixture,
  report: Reporter
): Promise<void> {
  if (fixture.name !== 'gitlab') return;

  // Read from the table rather than assumed: if either declaration is ever
  // flipped away from `supported`, runUnsupportedConformance's probe list is
  // what covers it instead, and running a happy-path cycle for a method
  // nobody claims works would be asserting the table's opposite.
  const rebaseSupported =
    expectationFor(fixture.name, 'rebasePullRequest').support === 'supported';
  const autoMergeSupported =
    expectationFor(fixture.name, 'setAutoMerge').support === 'supported' &&
    expectationFor(fixture.name, 'cancelAutoMerge').support === 'supported';
  if (!rebaseSupported && !autoMergeSupported) return;

  const { provider, projectPath, defaultBranch } = fixture;
  const prefix = runPrefix();
  const target = `${prefix}-rebase-target`;
  const source = `${prefix}-rebase-source`;
  // Null until the whole setup has succeeded, not merely until the merge
  // request exists: every check below depends on the target having been
  // advanced too, and a half-built fixture would make them fail for a reason
  // that says nothing about the method named in the report line.
  let readyIid: number | null = null;

  try {
    await check(
      report,
      fixture,
      'createPullRequest',
      'opens an MR whose source branch is behind its target',
      async () => {
        await createBranch(fixture, target, defaultBranch);
        await createBranch(fixture, source, target);
        // The only commit on the source branch, which matters: after a
        // rebase the head's parent is asserted to be the target's head, and
        // that identity only holds for a single-commit branch.
        await overwriteGitLabCiConfig(fixture, source, HOLD_OPEN_CI_YML);
        const pr = await provider.createPullRequest({
          projectPath,
          title: 'conformance: rebase and auto-merge cycle',
          description:
            'Opened by the glance conformance harness against a throwaway target branch. Safe to close.',
          sourceBranch: source,
          targetBranch: target
        });
        assert(pr.iid > 0, `expected a positive iid, got ${pr.iid}`);
        // Advancing the target after the merge request exists is what leaves
        // the source branch genuinely behind, which is the precondition
        // without which a rebase has nothing observable to do.
        await commitFile(
          fixture,
          target,
          `conformance-target-moved-${Date.now()}.md`,
          '# the target branch moved under the merge request\n'
        );
        readyIid = pr.iid;
      }
    );

    if (readyIid === null) {
      // Same reasoning as the merge cycle's post-failure skips: a setup that
      // never completed must not leave these three silently absent from the
      // report, because absence is indistinguishable from nobody having
      // written the check at all.
      for (const method of ['rebasePullRequest', 'setAutoMerge', 'cancelAutoMerge'] as const) {
        report.skip(
          fixture.name,
          method,
          'GitLab mutation cycle',
          'not run: the fixture merge request and its behind-the-target branch could not be set up'
        );
      }
      return;
    }
    const iid: number = readyIid;

    if (rebaseSupported) {
      await check(
        report,
        fixture,
        'rebasePullRequest',
        'the source branch is rewritten onto the advanced target',
        async () => {
          const targetHead = await gitlabBranchHead(fixture, target);
          const before = await gitlabBranchHead(fixture, source);
          // Asserted, not assumed. If the setup above left the source branch
          // already sitting on the target's head, the post-rebase assertion
          // would be satisfied by a rebasePullRequest that did nothing at
          // all, which is precisely the vacuous pass this check exists to
          // avoid.
          assert(
            !before.parentIds.includes(targetHead.sha),
            `setup did not leave "${source}" behind "${target}": its head ${before.sha} already has ` +
              `${targetHead.sha} among its parents, so a no-op rebase would satisfy this check`
          );

          await provider.rebasePullRequest(projectPath, iid);

          // GitLab's rebase is asynchronous: the API accepts the request and
          // reports rebase_in_progress, so the call returning proves only
          // that it was enqueued. Polling for the source branch to actually
          // move is the difference between observing the rebase and
          // observing the request.
          let after: { sha: string; parentIds: string[] };
          try {
            after = await pollUntil(
              `"${source}" to be rewritten by the rebase`,
              async () => {
                const head = await gitlabBranchHead(fixture, source);
                return head.sha === before.sha ? null : head;
              },
              { timeoutMs: 90_000, intervalMs: 2_000 }
            );
          } catch {
            // pollUntil's own timeout text names neither the rebase state nor
            // the merge_error GitLab writes when an async rebase fails, and
            // those are the only two things that explain a branch that never
            // moved.
            const probe = await gitlabMrProbe(fixture, iid).catch(() => null);
            throw new Error(
              `"${source}" still points at ${before.sha} after rebasePullRequest ` +
                `(rebase_in_progress=${probe?.rebaseInProgress ?? 'unreadable'}, ` +
                `merge_error=${probe?.mergeError ?? 'null'})`
            );
          }

          // The sha changing is not the proof; the new parent is. A rebase
          // that landed puts the target's head directly beneath the rewritten
          // commit, and nothing else this cycle does would.
          assert(
            after.parentIds.includes(targetHead.sha),
            `rebase rewrote "${source}" to ${after.sha}, but its parents ` +
              `${JSON.stringify(after.parentIds)} do not include "${target}"'s head ${targetHead.sha}, ` +
              'so the branch was rewritten by something other than a rebase onto the target'
          );
        }
      );
    }

    if (!autoMergeSupported) return;

    await check(
      report,
      fixture,
      'setAutoMerge',
      'arms merge-when-pipeline-succeeds and a re-read confirms it',
      async () => {
        // Mirrors the GitHub block's `armed` flag, and for the same measured
        // reason: a cancelAutoMerge graded against a merge request that never
        // had auto-merge on is satisfied by doing nothing, which is the
        // vacuous pass this project keeps re-inventing.
        let armed = false;
        try {
          const sourceHead = await gitlabBranchHead(fixture, source);
          // The pipeline must belong to the CURRENT head. After the rebase
          // above there is a window where the merge request's head_pipeline
          // still refers to the pipeline of the pre-rebase commit; arming
          // against that would be arming against a pipeline GitLab is about
          // to stop treating as the head one.
          let probe: GitLabMrProbe;
          try {
            probe = await pollUntil(
              `an active head pipeline on !${iid} for ${sourceHead.sha}`,
              async () => {
                const p = await gitlabMrProbe(fixture, iid);
                return p.headPipelineSha === sourceHead.sha &&
                  ACTIVE_GITLAB_PIPELINE_STATUSES.has(p.headPipelineStatus ?? '')
                  ? p
                  : null;
              },
              { timeoutMs: 120_000, intervalMs: 3_000 }
            );
          } catch {
            const latest = await gitlabMrProbe(fixture, iid).catch(() => null);
            throw new Inconclusive(
              `no active pipeline ever attached to !${iid}'s head commit ${sourceHead.sha} ` +
                `(head pipeline ${latest?.headPipelineId ?? 'none'} status ` +
                `"${latest?.headPipelineStatus ?? 'none'}" on sha ${latest?.headPipelineSha ?? 'none'}), ` +
                'and merge-when-pipeline-succeeds has nothing to wait on without one'
            );
          }

          // Printed, not just used: this line is the evidence that the
          // precondition was real on the run being read, which is the
          // difference between "auto-merge armed" and "auto-merge armed
          // against something that was actually waiting".
          console.log(
            `  setAutoMerge precondition: !${iid} head pipeline ${probe.headPipelineId} ` +
              `is "${probe.headPipelineStatus}" on ${probe.headPipelineSha}`
          );

          try {
            await provider.setAutoMerge(projectPath, iid);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // GitLab answers 405 on this endpoint for "the merge request is
            // not able to be merged" and 406 for a merge it will not accept
            // in the request's current state, both unmet preconditions rather
            // than malformed requests (a bad shape gets 400). Matching only
            // those two, and only after re-reading what the merge request
            // actually looks like, keeps every other failure -- a 403, a
            // 404, a mutation GitLab accepts while arming nothing -- a hard
            // fail.
            if (/\bsetAutoMerge failed: 40[56]\b/.test(message)) {
              const latest = await gitlabMrProbe(fixture, iid).catch(() => null);
              throw new Inconclusive(
                `GitLab refused to arm auto-merge on !${iid} (state "${latest?.state ?? 'unreadable'}", ` +
                  `head pipeline "${latest?.headPipelineStatus ?? 'none'}", ` +
                  `merge_error=${latest?.mergeError ?? 'null'}): ${message}`
              );
            }
            throw err;
          }

          // Re-reading through the provider is the assertion. "Did not throw"
          // is also what a setAutoMerge that silently armed nothing produces,
          // and this same read is what a consumer would use to decide whether
          // the button it just drew is on.
          const after = await provider.fetchSingleMR(projectPath, iid, null);
          if (after?.autoMergeEnabled === true) {
            armed = true;
          } else {
            // Two things other than a broken setAutoMerge produce this, and
            // both are observable rather than assumed. GitLab merges the
            // request outright when merge_when_pipeline_succeeds is asked for
            // with nothing left to wait on, and it abandons an armed
            // auto-merge the moment the pipeline it was waiting on fails --
            // which this fixture's pipelines do by design, on the far side of
            // the hold-open job. Neither is graded as a pass, and neither is
            // accepted on the strength of a plausible story: the merge
            // request's own state has to say so.
            const latest = await gitlabMrProbe(fixture, iid).catch(() => null);
            if (latest?.state === 'merged') {
              throw new Inconclusive(
                `GitLab merged !${iid} immediately instead of arming auto-merge, so nothing was armed ` +
                  `(confirmed by re-read: state="${latest.state}")`
              );
            }
            if (
              latest !== null &&
              latest.headPipelineStatus !== null &&
              !ACTIVE_GITLAB_PIPELINE_STATUSES.has(latest.headPipelineStatus)
            ) {
              // Weaker evidence than the merged case above, and labelled as
              // such: a settled pipeline is a real cause for GitLab dropping
              // the auto-merge, but this cannot fully separate it from a
              // setAutoMerge that armed nothing in the first place. It is
              // reported as inconclusive rather than either a pass or a fail
              // for exactly that reason.
              throw new Inconclusive(
                `auto-merge did not read back as enabled on !${iid}, and its head pipeline had already ` +
                  `settled to "${latest.headPipelineStatus}" (GitLab drops an armed auto-merge when the ` +
                  'pipeline it waits on stops); this run cannot tell that apart from setAutoMerge arming nothing'
              );
            }
            assert(
              false,
              `expected autoMergeEnabled true after setAutoMerge, got ${after?.autoMergeEnabled} ` +
                `(state "${latest?.state ?? 'unreadable'}", head pipeline ` +
                `"${latest?.headPipelineStatus ?? 'none'}", merge_error=${latest?.mergeError ?? 'null'})`
            );
          }
        } finally {
          if (!armed) {
            report.skip(
              fixture.name,
              'cancelAutoMerge',
              'disarms auto-merge and a re-read confirms it',
              'setAutoMerge did not arm auto-merge on this run, so there was nothing for cancelAutoMerge to disarm'
            );
          } else {
            await gradeGitLabCancelAutoMerge(fixture, report, iid);
          }
        }
      }
    );
  } finally {
    await cancelActiveGitLabPipelines(fixture, source);
    for (const branch of [source, target]) {
      await provider.deleteBranch(projectPath, branch).catch(err => {
        console.error(`  cleanup: could not delete ${branch}: ${err}`);
      });
    }
  }
}

/**
 * Cancel an auto-merge that was just proven to be armed, and grade the
 * re-read.
 *
 * Lifted out of the setAutoMerge check's `finally` only for readability;
 * it reports its own result directly, because it runs from a `finally` inside
 * another check() and so has no result of its own to throw into. It records
 * exactly one cancelAutoMerge entry on every path, including the ones where
 * its own reads fail: anything that escaped would be graded against
 * setAutoMerge instead and leave this method with no line at all.
 *
 * Called with no intervening calls after the arm was confirmed, deliberately.
 * The hold-open pipeline makes the window wide rather than instantaneous, but
 * it is still a window: GitLab drops the auto-merge as soon as that pipeline
 * stops for any reason, and every round trip inserted here only widens the
 * gap in which that can happen.
 */
async function gradeGitLabCancelAutoMerge(
  fixture: ProviderFixture,
  report: Reporter,
  iid: number
): Promise<void> {
  const { provider, projectPath } = fixture;
  const label = 'disarms auto-merge and a re-read confirms it';
  try {
    await provider.cancelAutoMerge(projectPath, iid);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // GitLab refuses this whenever there is nothing left to cancel, which
    // includes both "auto-merge already fired or was dropped" and
    // "cancelAutoMerge is simply broken". The message alone cannot tell those
    // apart, so it is never trusted on its own: only the merge request's own
    // re-read decides, exactly as the GitHub side does.
    const reread = await gitlabMrProbe(fixture, iid).catch(() => null);
    if (reread?.state === 'merged' || reread?.state === 'closed') {
      report.skip(
        fixture.name,
        'cancelAutoMerge',
        label,
        `the armed auto-merge fired before this call could land (confirmed by re-read: state="${reread.state}"): ${message}`
      );
      return;
    }
    if (
      reread !== null &&
      reread.headPipelineStatus !== null &&
      !ACTIVE_GITLAB_PIPELINE_STATUSES.has(reread.headPipelineStatus)
    ) {
      report.skip(
        fixture.name,
        'cancelAutoMerge',
        label,
        `the head pipeline settled to "${reread.headPipelineStatus}" and GitLab dropped the armed ` +
          `auto-merge before this call could disarm it, so there was nothing left to cancel: ${message}`
      );
      return;
    }
    report.fail(
      fixture.name,
      'cancelAutoMerge',
      label,
      `cancelAutoMerge failed while the merge request was still open with an active pipeline ` +
        `(state="${reread?.state ?? 'unreadable'}", head pipeline "${reread?.headPipelineStatus ?? 'none'}"): ${message}`
    );
    return;
  }

  try {
    const after = await provider.fetchSingleMR(projectPath, iid, null);
    if (after?.state === 'merged' || after?.state === 'closed') {
      report.skip(
        fixture.name,
        'cancelAutoMerge',
        label,
        `cancelAutoMerge returned, but the merge request is "${after.state}", so the armed auto-merge ` +
          'had already fired and there was nothing for it to disarm'
      );
      return;
    }
    // `state === 'opened'` is load-bearing, not decoration. A merged merge
    // request also reads autoMergeEnabled false, so without it this "pass"
    // would be satisfied by the auto-merge having fired -- the opposite of
    // what cancelAutoMerge is supposed to have done.
    if (after?.autoMergeEnabled === false && after.state === 'opened') {
      // Still not enough on its own, and this is the last place a vacuous
      // pass was reachable. GitLab abandons an armed auto-merge by itself the
      // moment the pipeline it waits on stops, and that leaves exactly the
      // reading this branch just made: open, auto-merge off. A
      // cancelAutoMerge that did nothing at all would be graded green by it.
      // Confirming the head pipeline is STILL active rules that cause out --
      // GitLab had no occasion to drop the arm, so the only thing that
      // disarmed it is the call above. The hold-open job makes this the
      // normal case rather than a lucky one; when it is not the case the
      // evidence genuinely is ambiguous, so it is reported as a skip naming
      // the ambiguity instead of a pass nobody can check.
      const still = await gitlabMrProbe(fixture, iid).catch(() => null);
      if (still !== null && ACTIVE_GITLAB_PIPELINE_STATUSES.has(still.headPipelineStatus ?? '')) {
        report.pass(fixture.name, 'cancelAutoMerge', label);
      } else {
        report.skip(
          fixture.name,
          'cancelAutoMerge',
          label,
          'auto-merge reads back as off, but the head pipeline is no longer active ' +
            `(status "${still?.headPipelineStatus ?? 'unreadable'}"), and GitLab drops an armed ` +
            'auto-merge on its own when that happens, so this run cannot tell the cancel apart ' +
            'from GitLab having dropped it'
        );
      }
      return;
    }
    report.fail(
      fixture.name,
      'cancelAutoMerge',
      label,
      `cancelAutoMerge did not throw but autoMergeEnabled reads back as ${after?.autoMergeEnabled} ` +
        `on a merge request in state "${after?.state ?? 'unreadable'}"`
    );
  } catch (err) {
    // This function runs from a check()'s `finally`, so an escaping throw
    // would be attributed to setAutoMerge -- turning a genuine setAutoMerge
    // pass into a FAIL with a message about the wrong method, while leaving
    // cancelAutoMerge with no line at all until assertFullCoverage reported
    // its absence at the very end. Reporting here keeps the promise that
    // this function makes exactly one cancelAutoMerge entry no matter what.
    // fail, not skip, for the same reason the resolveDiscussion setup
    // failure above is a fail: the mutation was issued and its effect was
    // never observed, and a skip would render that as accounted for.
    report.fail(
      fixture.name,
      'cancelAutoMerge',
      label,
      'cancelAutoMerge was issued but the re-read that would prove it did anything could not be ' +
        `made: ${err instanceof Error ? err.message : String(err)}`
    );
  }
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
        `/projects/${encodeURIComponent(projectPath)}/repository/commits/${encodeURIComponent(defaultBranch)}`
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

  // MAT-132 timed out twice on two different MRs with nothing to show for
  // it: pollUntil's predicate reports "not yet" as `null`, so every
  // intermediate detailedMergeStatus vanished before the timeout message
  // was built, and nobody could tell which state it was stuck in. This is
  // the same evidentiary hole MAT-128 sat in for three phases, closed only
  // by recording what actually happened instead of reasoning about it.
  // "not-found" is tracked separately from a real status: the predicate
  // below treats a missing MR the same as one still computing, but a
  // fetchSingleMR miss and "still processing" are different problems and
  // must not be folded into the same observation.
  const observed: string[] = [];

  // Bound: raised from 20s to 90s. Live run 3's instrumentation recorded
  // "preparing x1 -> unchecked x1 -> checking x12" -- `detailedMergeStatus`
  // reached `checking` and never left it before the old 20s bound expired.
  // Phase 1 measured this same transitional window at roughly a second on
  // this fixture, so the 20s bound (already ~20x that baseline) was not
  // itself the guess; what changed is the fixture, which is now taking
  // markedly longer to finish computing mergeability than it did when that
  // bound was set. 90s gives more than 4x the old bound's headroom on top of
  // a window that has already grown by at least 20x over its phase-1
  // baseline, without waiting indefinitely: a merge that is genuinely stuck
  // (not merely slow) still times out and still fails, and the observation
  // trail below still names the exact status it stuck in.
  try {
    await pollUntil(`merge readiness of ${iid}`, async () => {
      const fresh = await fixture.provider.fetchSingleMR(fixture.projectPath, iid, null);
      if (!fresh) {
        observed.push('not-found');
        return null;
      }
      observed.push(fresh.detailedMergeStatus ?? 'null');
      return stillComputing.has(fresh.detailedMergeStatus ?? '') ? null : fresh;
    }, { timeoutMs: 90_000 });
  } catch (err) {
    // Collapse consecutive repeats into counts rather than dumping up to
    // ~20 raw entries: "checking x2 -> preparing x18" names the stuck
    // state directly, which is the whole point of recording this.
    const runs: Array<{ status: string; count: number }> = [];
    for (const status of observed) {
      const last = runs[runs.length - 1];
      if (last && last.status === status) {
        last.count++;
      } else {
        runs.push({ status, count: 1 });
      }
    }
    const summary = runs.length > 0
      ? runs.map(r => `${r.status} x${r.count}`).join(' -> ')
      : '(no observations)';
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  waitForMergeReadiness(${iid}) observed detailedMergeStatus: ${summary}`);
    throw new Error(`${message}. Observed detailedMergeStatus: ${summary}`);
  }
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
  // Set when mergePullRequest throws its own "merged but could not delete"
  // error: the DELETE now happens inside that call, after the merge PUT has
  // already succeeded, so a deletion failure surfaces through the same catch
  // as a genuine merge failure. Treating it as one would cost this run both
  // downstream proofs (MAT-25 and the source-branch deletion) to a problem
  // that is neither: the merge already landed, only the cleanup after it
  // failed. Only one live run is budgeted for this work, so losing both
  // proofs to an unrelated deletion failure is not acceptable.
  let deletionError: string | null = null;

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
        // Recognize the deletion-failure shape specifically (see the
        // deletionError comment above): the merge succeeded, so this is not
        // the "merge itself did not complete" case the block below guards
        // against. Stash the message for the source-branch check to report
        // instead of re-deriving it, and let the merge be treated as done.
        if (/mergePullRequest merged but could not delete source branch/.test(message)) {
          deletionError = message;
        } else {
          throw err;
        }
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
        // A captured deletionError means the merge succeeded but the
        // deletion itself is the thing that failed; that is a real failure
        // of this exact assertion, not an absence of data to check, so it
        // must fail loudly here rather than be masked by a branchExists
        // read that was never going to prove anything past this point.
        if (deletionError !== null) {
          throw new Error(deletionError);
        }
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
  /**
   * Whether the selected job specifically failed, as opposed to merely
   * having settled into some other terminal state. The reads below
   * (fetchJobTrace, fetchJobDetail, fetchDownstreamPipeline, retryPipeline)
   * don't care whether the job passed or failed; retryJob does, which is why
   * this wasn't tracked before it needed a GitLab-side gate.
   */
  jobFailed: boolean;
}

/**
 * Statuses that mean a job produced output worth asserting on.
 *
 * `skipped` and `manual` jobs genuinely have no trace, so selecting one turns
 * a working `fetchJobTrace` into a failing assertion and reports a harness
 * defect as a provider defect. That is exactly what phase 1 root-caused on
 * GitLab, where `jobs[0]` landed on a skipped job. GitHub uses `conclusion`
 * for the same idea, so the two are checked separately below.
 */
const RAN_GITLAB_JOB_STATUSES = new Set(['success', 'failed']);
const RAN_GITHUB_JOB_CONCLUSIONS = new Set(['success', 'failure']);

/**
 * Pipeline statuses that mean every job in it has settled.
 *
 * An in-flight pipeline has no completed jobs at all, so a probe that lands
 * on one has nothing to assert against and fails for a reason that has
 * nothing to do with the provider.
 */
const TERMINAL_GITLAB_PIPELINE_STATUSES = new Set(['success', 'failed', 'canceled']);

/**
 * How many recent pipelines (or, on GitHub, runs) to consider before giving
 * up on finding a settled one.
 *
 * Not arbitrary: 20 is GitLab's own default `per_page`, so the scan stays a
 * single request instead of paginating. If the last 20 pipelines are all
 * still running, or GitHub's last 20 runs all settled with every job
 * skipped or cancelled, that is a fixture problem for someone to
 * investigate, not something this bound should silently paper over by
 * growing.
 */
const PIPELINE_SCAN_LIMIT = 20;

async function latestPipelineAndJob(fixture: ProviderFixture): Promise<PipelineProbe | null> {
  const { provider, projectPath } = fixture;

  if (fixture.name === 'github') {
    const runsRes = await provider.restRequest(
      'GET',
      `/repos/${projectPath}/actions/runs?per_page=${PIPELINE_SCAN_LIMIT}&status=completed`
    );
    if (!runsRes.ok) return null;
    const runs = (await runsRes.json()) as { workflow_runs: Array<{ id: number }> };

    // Scanning several runs rather than trusting the single newest one, for
    // the same reason the GitLab branch below scans several pipelines: the
    // newest run's jobs can all be skipped or cancelled (e.g. a workflow
    // whose trigger conditions excluded every job that run), which would
    // make this probe return null and the CI checks skip where GitLab, with
    // its own multi-pipeline scan, would keep looking.
    for (const run of runs.workflow_runs) {
      const jobsRes = await provider.restRequest(
        'GET',
        `/repos/${projectPath}/actions/runs/${run.id}/jobs`
      );
      if (!jobsRes.ok) continue;
      const { jobs } = (await jobsRes.json()) as {
        jobs: Array<{ id: number; status: string; conclusion: string | null }>;
      };
      const job = jobs.find(
        j => j.status === 'completed' && RAN_GITHUB_JOB_CONCLUSIONS.has(j.conclusion ?? '')
      );
      if (job) {
        return { pipelineId: run.id, jobId: job.id, jobFailed: job.conclusion === 'failure' };
      }
    }

    return null;
  }

  const encoded = encodeURIComponent(projectPath);
  // Scanning several rather than filtering server-side: GitLab's `status`
  // parameter takes one value, and the terminal set has three.
  const pipeRes = await provider.restRequest(
    'GET',
    `/projects/${encoded}/pipelines?per_page=${PIPELINE_SCAN_LIMIT}`
  );
  if (!pipeRes.ok) return null;
  const pipes = (await pipeRes.json()) as Array<{ id: number; status: string }>;

  for (const pipe of pipes) {
    if (!TERMINAL_GITLAB_PIPELINE_STATUSES.has(pipe.status)) continue;
    const jobsRes = await provider.restRequest(
      'GET',
      `/projects/${encoded}/pipelines/${pipe.id}/jobs`
    );
    if (!jobsRes.ok) continue;
    const jobs = (await jobsRes.json()) as Array<{ id: number; status: string }>;
    const job = jobs.find(j => RAN_GITLAB_JOB_STATUSES.has(j.status));
    if (job) return { pipelineId: pipe.id, jobId: job.id, jobFailed: job.status === 'failed' };
  }

  return null;
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
          if (failed) return { pipelineId: run.id, jobId: failed.id, jobFailed: true };
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

/**
 * Job completion time and run status/update time for the job `retryJob` is
 * about to retry.
 *
 * GitHub-only: MAT-128's hypothesis is about the gap between a job finishing
 * and its workflow run finishing, and GitLab has no equivalent two-level
 * completion. Returns nulls rather than throwing, because failing to read a
 * diagnostic must never fail the check it is diagnosing.
 *
 * `failed.pipelineId` is already the workflow run id: `withFailedGitHubJob`
 * (the only source of `failed` on this path) sets it from `run.id`, so there
 * is no need to fall back to a `run_id` read off the job.
 *
 * The run object has no dedicated completion timestamp the way the job does;
 * `updated_at` is the closest available proxy, so it is named and reported
 * as "updated", not "completed" -- this log is the only evidence MAT-128 has
 * ever produced, and a label claiming a completion time the API never
 * returned would get read as measured fact.
 *
 * The two GETs run via `Promise.all`, not sequentially, because this
 * diagnostic sits directly in front of the exact call under study: the
 * hypothesis is that added delay before `retryJob` is what makes the 403
 * disappear, so a diagnostic that itself burns two sequential round trips
 * immediately before that call would bias the measurement toward the very
 * outcome it exists to observe. One round trip of overhead is unavoidable;
 * a second one is not.
 */
async function retryJobTimings(
  fixture: ProviderFixture,
  failed: PipelineProbe
): Promise<{ jobCompletedAt: string | null; runUpdatedAt: string | null; runStatus: string | null }> {
  const empty = { jobCompletedAt: null, runUpdatedAt: null, runStatus: null };
  if (fixture.name !== 'github') return empty;
  const { provider, projectPath } = fixture;
  try {
    const [jobRes, runRes] = await Promise.all([
      provider.restRequest('GET', `/repos/${projectPath}/actions/jobs/${failed.jobId}`),
      provider.restRequest('GET', `/repos/${projectPath}/actions/runs/${failed.pipelineId}`)
    ]);
    const job = jobRes.ok
      ? ((await jobRes.json()) as { completed_at?: string | null })
      : null;
    const run = runRes.ok
      ? ((await runRes.json()) as { status?: string; updated_at?: string | null })
      : null;
    return {
      jobCompletedAt: job?.completed_at ?? null,
      runUpdatedAt: run?.updated_at ?? null,
      runStatus: run?.status ?? null
    };
  } catch {
    return empty;
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
    try {
      await provider.retryPipeline(projectPath, probe.pipelineId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // `latestPipelineAndJob` already scans newest-first and keeps the
      // first pipeline that clears task 9's settled-status filter (kept
      // deliberately: an in-flight pipeline has no completed jobs to probe
      // at all), so there is no more-recent eligible pipeline this
      // selection is passing over. On this fixture the merge cycle just
      // above triggers a fresh default-branch pipeline that has typically
      // not settled by the time this scan runs, which pushes the scan back
      // onto an older, already-settled pipeline instead -- old enough that
      // GitLab's own bookkeeping has moved past it and refuses the retry
      // with exactly this 409. That is the fixture's timing, not a
      // retryPipeline defect, so it is Inconclusive instead, following the
      // same precedent as mergePullRequest's 405 handling above; anything
      // else still fails hard.
      if (/\bError updating stale job\b/.test(message)) {
        throw new Inconclusive(
          `pipeline ${probe.pipelineId} settled long enough ago that GitLab now refuses to retry it: ${message}`
        );
      }
      throw err;
    }
  });

  if (fixture.name !== 'github') {
    // The GitLab fixture's `install` job fails on every pipeline by design
    // (see the RAN_GITLAB_JOB_STATUSES comment above), so there is no need
    // for GitHub's branch-and-poll trick to manufacture a failure here --
    // `latestPipelineAndJob` already told us above whether the job it
    // settled on genuinely failed. Extending that probe rather than writing
    // a second withFailedGitHubJob-style helper: a failing GitLab job is
    // already there for the taking, so manufacturing one would be work with
    // no evidence to show for it. Manufacturing IS available on this side if
    // some future check needs a job the fixture does not already produce --
    // `overwriteGitLabCiConfig` puts arbitrary CI config on a throwaway
    // branch, which is how the auto-merge cycle gets its long-running
    // pipeline -- so the constraint here is "unnecessary", not "impossible".
    if (probe.jobFailed) {
      await check(report, fixture, 'retryJob', 'accepts a retry of the failed job', async () => {
        const encoded = encodeURIComponent(projectPath);

        // Retrying a pipeline supersedes its jobs: GitLab does not mutate
        // `probe.jobId` in place when `retryPipeline` above reruns it --
        // it creates a brand-new job instance and leaves the old one as a
        // superseded attempt that GitLab's own retry endpoint refuses with
        // 403 "Job is not retryable". Calling `provider.retryJob` on
        // `probe.jobId` here would retry exactly that superseded job, which
        // is the bug this re-selection exists to avoid: the ordering of
        // `retryPipeline` before `retryJob` is load-bearing precisely
        // because of this supersession, not just because the checks happen
        // to read better in that order.
        //
        // No dedicated retryability signal exists to select on instead: as
        // far as could be checked against docs.gitlab.com/api/jobs and the
        // open feature request asking for exactly such a field
        // (gitlab-org/gitlab #499704), the job object documents `archived`,
        // not `retryable` or `retried`, and that request is still open. That
        // reading of GitLab's docs is the best available evidence, not a
        // verified fact, so it is not load-bearing here: this poll's
        // correctness depends only on a job id showing up that was not
        // `probe.jobId`, not on GitLab actually excluding the old one from
        // this listing. `j.id !== probe.jobId` does the real exclusion work
        // regardless of what the listing itself does or doesn't filter.
        //
        // A timeout here means "no fresh job ever showed up to retry" -- a
        // fixture/harness precondition failure (retryPipeline had nothing
        // eligible to retry, a fixture hiccup, GitLab lag), not a statement
        // about retryJob, which this poll never calls. Reporting it as a
        // hard FAIL on retryJob would be exactly the defect class this task
        // was opened to close, so it is caught and re-thrown as Inconclusive
        // instead, following the same precedent as the HTTP-405 handling in
        // mergePullRequest above. The retryJob call itself, below, is
        // deliberately left outside this try/catch: a 403 from that call is
        // a real provider failure and must stay a hard fail.
        let freshJob: { id: number; status: string };
        try {
          freshJob = await pollUntil(
            `pipeline ${probe.pipelineId} settling a fresh job after retryPipeline`,
            async () => {
              const res = await provider.restRequest(
                'GET',
                `/projects/${encoded}/pipelines/${probe.pipelineId}/jobs`
              );
              if (!res.ok) return null;
              const jobs = (await res.json()) as Array<{ id: number; status: string }>;
              return jobs.find(j => j.id !== probe.jobId && RAN_GITLAB_JOB_STATUSES.has(j.status)) ?? null;
            },
            { timeoutMs: 30_000, intervalMs: 2_000 }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Inconclusive(
            `could not find a fresh job to retry after retryPipeline: ${message}`
          );
        }

        if (freshJob.status !== 'failed') {
          // Same design fact the outer `probe.jobFailed` skip below relies
          // on -- the fixture's `install` job fails on every pipeline by
          // design -- just re-checked against the retried attempt instead
          // of trusting that a pre-retry observation still holds post-retry.
          throw new Inconclusive(
            'the retried job settled without failing, so there is no failed job to retry'
          );
        }

        await provider.retryJob(projectPath, freshJob.id);

        // GitLab jobs are immutable once they finish: retrying one creates a
        // NEW job rather than mutating `freshJob.id` in place, so re-reading
        // that same job id would show "failed" forever regardless of whether
        // the retry did anything. The pipeline's own aggregate status is the
        // observable effect instead -- it leaves its terminal state the
        // moment the new job is queued, which is exactly what a no-op
        // retryJob would never produce.
        //
        // Bound (2s sampling, 30s timeout): the risk a 2s gap runs is
        // missing a retry that both leaves and re-enters a terminal status
        // inside that single gap -- plausible in principle on this fixture,
        // whose `install` job fails on every pipeline by design and could
        // fail fast again on retry. What makes 2s defensible anyway:
        // `pollUntil` takes its first sample immediately, with no initial
        // sleep, and GitLab's job-retry endpoint returns the newly created
        // job in its own response body, meaning that job (and the
        // pipeline's recomputed aggregate status) already exists before
        // this poll ever samples. The transition this check needs to see
        // has therefore almost certainly already happened by the first
        // sample; the remaining ~28s of headroom is for a slow runner
        // pickup, not for catching a fast one. A timeout here is still
        // ambiguous: it means either the retry did nothing, or the retry
        // fired and the pipeline settled back to a terminal status between
        // two samples before either one caught the transition. Read a red
        // result here as "investigate further", not as proof retryJob is
        // broken. Left both numbers unchanged rather than shrinking the
        // interval further: the first-sample argument already covers the
        // structural risk, so a tighter interval would only add API calls
        // without closing the remaining ambiguity.
        await pollUntil(
          `pipeline ${probe.pipelineId} leaving its terminal status after retryJob`,
          async () => {
            const res = await provider.restRequest(
              'GET',
              `/projects/${encoded}/pipelines/${probe.pipelineId}`
            );
            if (!res.ok) return null;
            const pipeline = (await res.json()) as { status?: string };
            return pipeline.status && !TERMINAL_GITLAB_PIPELINE_STATUSES.has(pipeline.status)
              ? true
              : null;
          },
          { timeoutMs: 30_000, intervalMs: 2_000 }
        );
      });
    } else {
      report.skip(
        fixture.name,
        'retryJob',
        'accepts a retry of the failed job',
        'the CI probe landed on a job that settled but did not fail'
      );
    }
    return;
  }

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
        // MAT-128 is now root-caused, not hypothesized: three live runs, read
        // against the timing instrumentation below, all agree on what
        // separates a pass from the 403. Run 1 (run "completed", called
        // 1.9s later) passed; run 2 (run "completed", called 1.4s later)
        // passed; run 3 (run still "in_progress" when called) got 403 "The
        // workflow run containing this job is already running" -- GitHub's
        // own error naming the exact precondition. The JOB had completed in
        // all three; only the RUN had not in the one that failed. So the
        // precondition this check must establish is the run's own status,
        // not the job's -- waiting on the job (as earlier phases tried) left
        // this race open, because the job can and does finish before its
        // containing run does.
        //
        // This wait was deliberately withheld until that measurement existed
        // (see task 18/19's brief): adding it earlier would have removed the
        // gap the instrumentation needed to catch run 3's failure in the
        // first place. That measurement is done, so waiting here is no
        // longer a guess.
        //
        // Bound (2s sampling, 30s timeout): matches the post-retry poll a few
        // lines below, in this same function, for the analogous transition.
        // It is far larger than any gap actually observed between job and
        // run completion (1.4s and 1.9s above) -- comfortable headroom for a
        // slower run without being unbounded. If the run never gets there,
        // that is this fixture failing to settle, not a retryJob defect, so
        // it is reported Inconclusive below rather than blamed on the call
        // this precondition exists to protect.
        try {
          await pollUntil(
            `workflow run ${failed.pipelineId} reaching "completed" before retryJob`,
            async () => {
              const res = await provider.restRequest(
                'GET',
                `/repos/${projectPath}/actions/runs/${failed.pipelineId}`
              );
              if (!res.ok) return null;
              const run = (await res.json()) as { status?: string };
              return run.status === 'completed' ? true : null;
            },
            { timeoutMs: 30_000, intervalMs: 2_000 }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Inconclusive(
            `workflow run ${failed.pipelineId} never reached "completed" before retryJob could be called: ${message}`
          );
        }

        // Everything below is the pre-existing MAT-128 diagnostic, kept
        // unperturbed: it should now read "completed" on every run, which is
        // how a future reader confirms the wait above is still doing its job.
        // These three timestamps are what nobody had before, printed whether
        // the call succeeds or fails so a passing run is evidence too.
        // `retryJobTimings` itself costs one round trip (its two GETs run
        // concurrently to avoid costing two), which the log below says
        // explicitly so "called at" is never mistaken for an unperturbed
        // reading of when this check reached the retry call.
        const timings = await retryJobTimings(fixture, failed);
        const calledAt = new Date().toISOString();
        console.log(
          `  retryJob timing: job completed ${timings.jobCompletedAt ?? 'unknown'}, ` +
            `run status "${timings.runStatus ?? 'unknown'}" last updated ${timings.runUpdatedAt ?? 'unknown'}, ` +
            `called at ${calledAt} (after one round trip added by this diagnostic)`
        );
        await provider.retryJob(projectPath, failed.jobId);

        // Everything above this line exists to keep the retry call itself
        // unperturbed for MAT-128's measurement, so the effect check belongs
        // strictly after it. GitHub's job-rerun moves the containing run out
        // of "completed" (into "queued", then "in_progress") before it
        // settles again; that transition is the one effect observable here
        // without diffing individual job attempts, so poll for it rather
        // than trusting the accepted call alone.
        //
        // Bound (2s sampling, 30s timeout): same pair, and the same risk, as
        // GitLab's retryJob poll above -- a rerun that both leaves and
        // re-enters "completed" inside one 2s gap would be missed by every
        // sample. The same first-sample argument narrows that risk here too
        // (`pollUntil` samples immediately, with no initial sleep), but with
        // less certainty than GitLab's: accepting a rerun request is
        // understood to queue the run, flipping its status, as part of that
        // request completing rather than as a separate later step, but
        // Octokit's rerun response carries no body confirming that the way
        // GitLab's retry response confirms its new job. A timeout on this
        // poll is therefore ambiguous between "the retry did nothing" and
        // "the retry fired and the run resettled to completed before any
        // sample landed inside the gap that would have shown the
        // transition" -- it is not, by itself, proof of a broken retryJob.
        await pollUntil(
          `workflow run ${failed.pipelineId} leaving "completed" after retryJob`,
          async () => {
            const res = await provider.restRequest(
              'GET',
              `/repos/${projectPath}/actions/runs/${failed.pipelineId}`
            );
            if (!res.ok) return null;
            const run = (await res.json()) as { status?: string };
            return run.status !== 'completed' ? true : null;
          },
          { timeoutMs: 30_000, intervalMs: 2_000 }
        );
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
