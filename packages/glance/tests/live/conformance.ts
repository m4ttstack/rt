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
      // The zero-arg call is a distinct code path from the projectPath-mode
      // calls below (current-user MRs vs. a specific project), so this
      // stays even though it can be empty: a shape check on whatever comes
      // back is still real coverage of that path, unlike a bare
      // Array.isArray which only proves fetchPullRequests() didn't throw.
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
