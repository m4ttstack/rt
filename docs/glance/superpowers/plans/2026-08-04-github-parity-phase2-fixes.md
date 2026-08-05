# GitHub Parity Phase 2: Merge and Read Correctness Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three `GitHubProvider` defects that make it silently do the wrong thing (MAT-25, MAT-127, MAT-131), and strengthen the live harness so each fix is proven by an assertion that could not pass for the wrong reason.

**Architecture:** Every fix is contained in `packages/glance/src/GitHubProvider.ts`. Each gets unit tests that stub the provider's private `api()` method, following the idiom already used in `tests/draft.test.ts`. Two of the three are additionally proven by the live conformance harness, whose merge assertions are tightened first so they measure semantics rather than the presence of a substring. The design doc is corrected before any code is written, because two of its phase 2 prescriptions are wrong and an implementer following them would ship the wrong fix.

**Tech Stack:** TypeScript, Bun (test runner and script runtime), GitHub REST API, the existing live conformance harness under `packages/glance/tests/live/`.

## Global Constraints

- **No em dashes or en dashes** in anything authored here: code, comments, commit messages, docs. Use an ellipsis or rephrase. (`~/.claude/rules/no-em-dashes.mdc`) Pre-existing dashes in `src/` predate the rule and are out of scope; do not sweep them, and do not add new ones. The verbatim GitHub error string quoted in the findings doc stays exactly as it is.
- **Comments explain why, never what.** (`~/.claude/rules/clean-code-comments.mdc`)
- **Commit after each completed task.** Six tasks, at least six commits. (`~/.claude/rules/incremental-commits.mdc`)
- **`harness_credentials.json` is gitignored and holds three real GitLab tokens. This repo is public.** Never stage it, never print it, never paste a token anywhere. Stage files by explicit path. Never `git add -A`.
- **Baseline before starting:** `bun test tests/` from `packages/glance` reports **175 pass, 0 fail**. Do not regress this. (Some passing tests print the words `FAIL` inside fixture strings; read the summary line, not the body.)
- **`bun run check-types` type-checks `tests/live/` too**, and `prepublishOnly` calls it. A type error under `tests/live/` blocks a publish.
- **The live runner mutates real repositories.** It creates branches, opens PRs, and merges into the default branch of both fixtures. Each full run permanently adds one file and two commits to each fixture's default branch, and nothing cleans that up. Budget runs deliberately: this plan calls for exactly one.
- **Never point the harness at `m4ttheweric/gitq-test-sandbox`.** That belongs to another project's live suite. The fixtures are `m4ttheweric/glance-conformance` (GitHub) and `m4tthew-dev/glance-test-repo` (GitLab).
- **The runner exits non-zero even on a good run.** `assertFullCoverage` fails because `deleteBranch`, `requestReReview`, `watchEvents`, and GitLab's `retryJob` are genuinely never exercised. That is the harness reporting its own gaps. Do not weaken the check to make it green.
- **`expectations.ts` needs no change in this plan.** GitHub's `mergePullRequest` is already declared `{ support: 'supported', capability: 'canMerge' }` at `tests/live/expectations.ts:50`, and `fetchBranchProtectionRules` is already `supported`. No capability flag flips in this phase, so the table stays as it is. If you find yourself editing it, stop and re-read the task.

## Scope

**In scope:** MAT-25, MAT-127, MAT-131, and the harness work that proves them.

**Explicitly deferred, with the open question stated so the next session does not rediscover it:**

| Ticket | Why it is not here |
| --- | --- |
| MAT-24 (reviewers/assignees) | Needs new harness coverage that does not exist, and its GitHub reviewer half may be unverifiable: GitHub rejects a review request from the PR author and the fixture has one collaborator. Its Linear title also names a GitLab defect (usernames sent where numeric IDs are required) that the design doc scopes out. Three decisions, no live evidence. |
| MAT-128 (`retryJob` 403) | The findings doc states the run-versus-job timing gap is "the evidence available, not a proven root cause," and notes the harness does not log when `retryJob` was actually called. Fixing it now is guessing. Instrument first. |
| MAT-129 (`fetchPullRequestsByBranches`, `watchEvents`) | Split ticket: the first half is a performance gap owned by phase 2a, the second is phase 4 work. Needs splitting before it can be planned. |
| MAT-130 (`restRequest` portability) | Decided direction below, but it is an API-compatibility call, not a bug fix. |
| MAT-132 (GitLab merge race) | GitLab-side, and the harness's `waitForMergeReadiness` currently compensates. |
| MAT-133 (`graphql()` swallows errors) | The findings doc assigns it to phase 4; the handoff says do it early. No failing assertion drives it, and changing it now is a behavior change to two live-passing read paths. Recommend following the findings doc. |

**MAT-130, recommended resolution when it is picked up:** make `GitLabProvider.restRequest` prefix `/api/v4` itself, matching the interface docstring. Evidence gathered while writing this plan: there is exactly one production call site across Matt's repos, `repo-tools/lib/daemon/freshness.ts` in `fetchProjectId`, and it already carries a comment documenting the divergence it works around. gitq and mr-board reference `restRequest` only in mock-provider test stubs. The change deletes that workaround plus the equivalents in `tests/integration.live.ts` and the harness's `apiPath()` helper. The only real risk is external: `@mattstack/glance` is published publicly, so this is a semver decision.

## Design doc defects this plan corrects

Recorded here because Task 1 fixes them in the doc itself, and because a reviewer needs to know the plan deliberately contradicts an approved document.

1. **The prescribed MAT-25 fix is wrong.** `docs/superpowers/specs/2026-08-04-github-parity-design.md:114-116` says GitHub's merge endpoint "has a distinct `commit_message` field; map them separately." `commit_title` and `commit_message` are the title and body of one commit, not a merge variant and a squash variant. `types.ts:471-474` defines `commitMessage` as the merge commit message and `squashCommitMessage` as the squash commit message "(when merge method is squash)": they are alternates selected by strategy. Mapping them to the two GitHub fields would put a squash message into the body of a merge commit and would produce a commit carrying both. The correct fix selects one message by effective merge method.

2. **The prescribed MAT-127 fix offers a non-viable option.** The same doc at lines 122-124 offers "a separate `DELETE /git/refs/heads/{branch}` call **or** the repository-level `delete_branch_on_merge` setting." The second cannot honor a per-call `shouldRemoveSourceBranch: false`, and it directly contradicts `tests/live/conformance.ts:869-875`, which documents that the live assertion is only meaningful because the fixture has that setting off. Only the explicit DELETE is viable.

3. **The phase 2 section omits that the live assertion for MAT-25 is too weak to prove the fix.** Covered by Task 2.

## Discovered while planning, not in scope, not yet ticketed

- **`GitLabProvider.fetchBranchProtectionRules` hardcodes three fields for every rule.** `GitLabProvider.ts:929-936` returns `allowDeletion: false`, `requiredApprovals: 0`, and `requireStatusChecks: false` unconditionally, for every branch, because GitLab's protected-branches endpoint does not carry them. This is the same class as MAT-131 and as MAT-14's hardcoded `unresolvedThreadCount: 0`, except it is unconditional rather than a failure path, and unlike MAT-131 it sets `raw`, so `raw`'s presence does not distinguish it. A caller reading `requiredApprovals` from GitLab today is reading a constant, not data. Worth a ticket; not fixed here, since it is GitLab-side and the design doc scopes GitLab out.
- **`updatePullRequest`'s reviewers, assignees, and labels sub-requests never check `res.ok`** (`GitHubProvider.ts:905-927`). A failed reviewer assignment is silently swallowed. This belongs with MAT-24 and is arguably worse than the append-versus-replace defect that ticket names.

---

## File Structure

| File | Change |
| --- | --- |
| `docs/superpowers/specs/2026-08-04-github-parity-design.md` | Correct the two wrong phase 2 prescriptions (Task 1). |
| `packages/glance/tests/live/conformance.ts` | Strengthen the merge-cycle assertions; add `approvals_syncing` to the merge-readiness poll; add a fabrication guard to the protection assertion (Tasks 2 and 5). |
| `packages/glance/src/GitHubProvider.ts` | The three fixes (Tasks 3, 4, 5). |
| `packages/glance/tests/gh-merge.test.ts` | New. Unit tests for message mapping and source-branch deletion (Tasks 3 and 4). |
| `packages/glance/tests/gh-branch-protection.test.ts` | New. Unit tests for the protection read-failure path (Task 5). |
| `docs/superpowers/specs/2026-08-04-github-parity-phase2-results.md` | New. The live verification record (Task 6). |
| `.superpowers/handoff-phase2.md` | Update for phase 3 (Task 6). Gitignored, never staged. |

Tasks 1 through 5 need no network. Task 6 is the single live run.

---

### Task 1: Correct the design doc

The design doc is an approved, tracked artifact that two later tasks would otherwise be implemented against. Correcting it first means an implementer reading it in isolation gets the right instruction.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-github-parity-design.md:112-125`

**Interfaces:**
- Consumes: nothing.
- Produces: the corrected prescriptions Tasks 3 and 4 implement. No code symbols.

- [ ] **Step 1: Replace the MAT-25 bullet**

Find this text under "### Phase 2: bug fixes":

```markdown
- **MAT-25.** `GitHubProvider.ts:962-964` assigns both `commitMessage` and
  `squashCommitMessage` to `commit_title`, so the second silently clobbers the first.
  GitHub's merge endpoint has a distinct `commit_message` field; map them separately.
```

Replace it with:

```markdown
- **MAT-25.** `GitHubProvider.ts:962-964` assigns both `commitMessage` and
  `squashCommitMessage` to `commit_title`, so the second silently clobbers the first.

  **Corrected 2026-08-04, while planning phase 2.** An earlier version of this bullet
  prescribed mapping the two onto GitHub's `commit_title` and `commit_message`. That was
  wrong. Those two GitHub fields are the title and the body of a single commit, not a
  merge variant and a squash variant. `types.ts:471-474` defines `commitMessage` as the
  merge commit message and `squashCommitMessage` as the squash commit message "(when
  merge method is squash)", so they are alternates selected by strategy, not two halves
  of one message. Sending both would put a squash message in the body of a merge commit.

  The fix: resolve the effective merge method first (`mergeMethod`, else `squash` implying
  `squash`, else GitHub's repository default), select `squashCommitMessage` when squashing
  and `commitMessage` otherwise, and split the selected string into `commit_title` (first
  line) and `commit_message` (remainder, when there is one).
```

- [ ] **Step 2: Replace the `shouldRemoveSourceBranch` bullet**

Find:

```markdown
  Deleting the branch needs either a separate `DELETE /git/refs/heads/{branch}` call or
  the repository-level `delete_branch_on_merge` setting. Found while planning phase 1,
  not yet ticketed. Same silent-no-op class as MAT-15.
```

Replace with:

```markdown
  Deleting the branch needs a separate `DELETE /git/refs/heads/{branch}` call after a
  successful merge. Ticketed as MAT-127. Same silent-no-op class as MAT-15.

  **Corrected 2026-08-04, while planning phase 2.** An earlier version of this bullet also
  offered the repository-level `delete_branch_on_merge` setting as an alternative. It is
  not one: a repository setting cannot honor a per-call `shouldRemoveSourceBranch: false`,
  and enabling it would invalidate the live assertion that catches this defect, which
  `tests/live/conformance.ts:869-875` documents as depending on that setting being off.
```

- [ ] **Step 3: Verify no dashes were introduced**

Run: `grep -n "—\|–" docs/superpowers/specs/2026-08-04-github-parity-design.md`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-04-github-parity-design.md
git commit -m "docs: correct two wrong phase 2 prescriptions in the design doc"
```

---

### Task 2: Make the merge-cycle assertions prove semantics

The current MAT-25 assertion only checks that the head commit *contains* `merge-commit-message`. The harness sends both messages in one call, so a fix that wrote both into the commit would turn the assertion green while the semantics stayed wrong. This task closes that hole before any fix exists, so the assertion cannot be tuned to a fix after the fact.

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts:751` (merge-readiness states)
- Modify: `packages/glance/tests/live/conformance.ts:851-867` (the MAT-25 assertion)

**Interfaces:**
- Consumes: existing `check`, `assert`, `headCommitMessage`, `report` helpers in the same file. No new exports.
- Produces: no new symbols. The behavior change is that the MAT-25 assertion now fails for a second, independent reason.

- [ ] **Step 1: Add `approvals_syncing` to the merge-readiness poll**

The findings doc names this as a specific residual flake risk: `waitForMergeReadiness`'s `stillComputing` set omits `approvals_syncing`, which the SDK's own `MRDashboard.ts:105` treats as transitional. A merge attempted in that state races the same ambiguous HTTP 405 documented under MAT-132. This plan spends exactly one live run, so it is worth one line to reduce the chance that run is wasted.

At `packages/glance/tests/live/conformance.ts:751`, change:

```typescript
  const stillComputing = new Set(['checking', 'unchecked', 'preparing']);
```

to:

```typescript
  // approvals_syncing is transitional too, per MRDashboard.ts:105. Merging
  // during it races the same ambiguous 405 as the other three (MAT-132).
  const stillComputing = new Set([
    'checking',
    'unchecked',
    'preparing',
    'approvals_syncing'
  ]);
```

- [ ] **Step 2: Strengthen the MAT-25 assertion**

Replace the whole `check(...)` block at `packages/glance/tests/live/conformance.ts:851-867` with:

```typescript
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
```

Note for whoever reads the run output: this assertion is expected to fail on GitHub before Task 3, for two reasons at once rather than one. On GitLab it is expected to keep passing, since GitLab's recorded head commit carried only the merge message. A GitLab failure here would be a genuine new finding about GitLab's squash defaults, not a harness bug, and should be reported rather than worked around.

- [ ] **Step 3: Type-check**

Run: `cd packages/glance && bun run check-types`
Expected: clean. This covers `tests/live/` as well as `src/`.

- [ ] **Step 4: Run the unit tests**

Run: `cd packages/glance && bun test tests/`
Expected: 175 pass, 0 fail. The live harness is not a `*.test.ts` file, so this does not execute it; the run only confirms nothing else broke.

- [ ] **Step 5: Verify no dashes were introduced**

Run: `grep -n "—\|–" packages/glance/tests/live/conformance.ts`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add packages/glance/tests/live/conformance.ts
git commit -m "harness: assert squashCommitMessage cannot leak into a non-squash merge"
```

---

### Task 3: MAT-25, select the merge message by strategy

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts:955-988` (`mergePullRequest`)
- Test: `packages/glance/tests/gh-merge.test.ts` (create)

**Interfaces:**
- Consumes: `MergePullRequestInput` from `../src/types.ts` (fields used here: `commitMessage`, `squashCommitMessage`, `squash`, `mergeMethod`, `sha`, `shouldRemoveSourceBranch`). The private `api(method, path, body)` method, stubbed in tests.
- Produces: a new private method on `GitHubProvider`:
  `private mergeCommitFields(input: MergePullRequestInput | undefined, mergeMethod: string | undefined): { commit_title?: string; commit_message?: string }`
  Task 4 adds a second private method to the same class and does not call this one.

- [ ] **Step 1: Write the failing tests**

Create `packages/glance/tests/gh-merge.test.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Merge semantics on GitHub (MAT-25, MAT-127).
 *
 * GitHub's merge endpoint carries one commit-message pair, `commit_title` plus
 * `commit_message`, which are the title and body of a single commit. It has no
 * separate squash-message field and no delete-branch parameter. `commitMessage`
 * and `squashCommitMessage` are alternates selected by merge strategy, so
 * exactly one of them can reach any given merge.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface MergeCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

/**
 * Records every api() call and answers all of them 200. `fetchSingleMR` is
 * stubbed too: mergePullRequest re-fetches the PR to return it, and that read
 * is not what these tests are about.
 */
function stubGitHub(
  provider: GitHubProvider,
  sourceBranch = 'feature-branch'
): MergeCall[] {
  const calls: MergeCall[] = [];
  (provider as any).api = async (
    method: string,
    path: string,
    body?: unknown
  ) => {
    calls.push({ method, path, body: body as Record<string, unknown> | undefined });
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
      headers: { get: () => null }
    } as unknown as Response;
  };
  (provider as any).fetchSingleMR = async () => ({ iid: 1, sourceBranch });
  return calls;
}

function mergeBody(calls: MergeCall[]): Record<string, unknown> {
  const call = calls.find(c => c.path.endsWith('/merge'));
  if (!call) throw new Error('no merge call was made');
  return call.body ?? {};
}

describe('GitHubProvider merge commit messages (MAT-25)', () => {
  test('commitMessage reaches commit_title on a default-strategy merge', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: 'Ship the thing'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('Ship the thing');
    expect(body.commit_message).toBeUndefined();
    expect(body.merge_method).toBeUndefined();
  });

  test('squashCommitMessage does not reach a non-squash merge at all', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: 'merge-commit-message',
      squashCommitMessage: 'squash-commit-message'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('merge-commit-message');
    expect(JSON.stringify(body)).not.toContain('squash-commit-message');
  });

  test('squash selects squashCommitMessage and drops commitMessage', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      squash: true,
      commitMessage: 'merge-commit-message',
      squashCommitMessage: 'squash-commit-message'
    });

    const body = mergeBody(calls);
    expect(body.merge_method).toBe('squash');
    expect(body.commit_title).toBe('squash-commit-message');
    expect(JSON.stringify(body)).not.toContain('merge-commit-message');
  });

  test('squashing with no squash message falls back to commitMessage', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      mergeMethod: 'squash',
      commitMessage: 'the only message the caller gave'
    });

    const body = mergeBody(calls);
    expect(body.merge_method).toBe('squash');
    expect(body.commit_title).toBe('the only message the caller gave');
  });

  test('a multi-line message splits into title and body', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      commitMessage: 'Short title\n\nA longer explanation.\nSecond line.'
    });

    const body = mergeBody(calls);
    expect(body.commit_title).toBe('Short title');
    expect(body.commit_message).toBe('A longer explanation.\nSecond line.');
  });

  test('no messages sends neither field', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, { sha: 'abc123' });

    const body = mergeBody(calls);
    expect(body.commit_title).toBeUndefined();
    expect(body.commit_message).toBeUndefined();
    expect(body.sha).toBe('abc123');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/glance && bun test tests/gh-merge.test.ts`
Expected: FAIL. The "squashCommitMessage does not reach a non-squash merge" and "squash selects squashCommitMessage" tests fail because both messages currently land on `commit_title`; the multi-line test fails because nothing splits today.

- [ ] **Step 3: Implement the mapping**

In `packages/glance/src/GitHubProvider.ts`, replace lines 961-975 of `mergePullRequest` (from `const body: Record<string, unknown> = {};` through the `merge_method` block) with:

```typescript
    const body: Record<string, unknown> = {};
    const mergeMethod =
      input?.mergeMethod ?? (input?.squash ? 'squash' : undefined);
    if (mergeMethod) body.merge_method = mergeMethod;
    Object.assign(body, this.mergeCommitFields(input, mergeMethod));
    if (input?.sha != null) body.sha = input.sha;
```

Then add this private method immediately after `mergePullRequest`:

```typescript
  /**
   * Pick the one commit message that applies to this merge.
   *
   * GitHub carries a single commit-message pair per merge: `commit_title` and
   * `commit_message` are the title and body of one commit, not a merge variant
   * and a squash variant. `commitMessage` and `squashCommitMessage` are
   * alternates selected by strategy (types.ts), so sending both would put a
   * squash message in the body of a merge commit. Sending both onto
   * `commit_title` is MAT-25, where the second silently overwrote the first.
   */
  private mergeCommitFields(
    input: MergePullRequestInput | undefined,
    mergeMethod: string | undefined
  ): { commit_title?: string; commit_message?: string } {
    // A squash with no squash-specific message still has the caller's intent in
    // commitMessage, and GitHub produces exactly one commit either way, so
    // falling back preserves it instead of discarding it.
    const chosen =
      mergeMethod === 'squash'
        ? (input?.squashCommitMessage ?? input?.commitMessage)
        : input?.commitMessage;
    if (chosen == null) return {};

    const firstBreak = chosen.indexOf('\n');
    if (firstBreak === -1) return { commit_title: chosen };
    const rest = chosen.slice(firstBreak + 1).replace(/^\n+/, '');
    return rest
      ? { commit_title: chosen.slice(0, firstBreak), commit_message: rest }
      : { commit_title: chosen.slice(0, firstBreak) };
  }
```

Note: `mergeMethod` here is the *requested* strategy. When the caller requests none, GitHub applies the repository default, which may itself be squash. In that case `commitMessage` is what gets sent, which is the caller's only stated intent, so it is the right value regardless of which commit GitHub ends up producing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/gh-merge.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the full unit suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 181 pass, 0 fail, and a clean type-check.

- [ ] **Step 6: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-merge.test.ts
git commit -m "fix: select the merge commit message by strategy on GitHub (MAT-25)"
```

---

### Task 4: MAT-127, actually delete the source branch

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts:955-988` (`mergePullRequest`)
- Test: `packages/glance/tests/gh-merge.test.ts` (extend the file created in Task 3)

**Interfaces:**
- Consumes: `stubGitHub` and `MergeCall` from `tests/gh-merge.test.ts` as written in Task 3. `PullRequest.sourceBranch` (`types.ts:126`).
- Produces: a new private method on `GitHubProvider`:
  `private deleteMergedSourceBranch(projectPath: string, branch: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `packages/glance/tests/gh-merge.test.ts`:

```typescript
describe('GitHubProvider shouldRemoveSourceBranch (MAT-127)', () => {
  test('deletes the source ref after a successful merge', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider, 'feature/x');

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    const deletion = calls.find(c => c.method === 'DELETE');
    expect(deletion?.path).toBe('/repos/acme/repo/git/refs/heads/feature%2Fx');
  });

  test('sends no delete_branch field, which GitHub would ignore', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    expect(mergeBody(calls).delete_branch).toBeUndefined();
  });

  test('deletes nothing when the caller did not ask', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);

    await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: false
    });

    expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  });

  test('an already-deleted ref is the requested end state, not an error', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    const calls = stubGitHub(provider);
    const api = (provider as any).api;
    (provider as any).api = async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        calls.push({ method, path, body: undefined });
        return {
          ok: false,
          status: 422,
          json: async () => ({}),
          text: async () => '{"message":"Reference does not exist"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    };

    // The repository-level delete_branch_on_merge setting races this call, so
    // "already gone" has to read as success or every merge on a repo with that
    // setting enabled would throw.
    const pr = await provider.mergePullRequest('acme/repo', 1, {
      shouldRemoveSourceBranch: true
    });

    expect(pr.iid).toBe(1);
    // The deletion must still have been attempted: swallowing a 422 is only
    // correct if the call happened and the ref was genuinely already gone.
    expect(calls.some(c => c.method === 'DELETE')).toBe(true);
  });

  test('a real deletion failure throws rather than reporting a silent no-op', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider);
    const api = (provider as any).api;
    (provider as any).api = async (method: string, path: string, body?: unknown) => {
      if (method === 'DELETE') {
        return {
          ok: false,
          status: 403,
          json: async () => ({}),
          text: async () => '{"message":"Protected branch"}',
          headers: { get: () => null }
        } as unknown as Response;
      }
      return api(method, path, body);
    };

    await expect(
      provider.mergePullRequest('acme/repo', 1, { shouldRemoveSourceBranch: true })
    ).rejects.toThrow(/could not delete source branch/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/glance && bun test tests/gh-merge.test.ts`
Expected: FAIL. No DELETE is issued today, and `delete_branch` is still in the merge body.

- [ ] **Step 3: Implement the deletion**

In `mergePullRequest`, delete this line entirely:

```typescript
    if (input?.shouldRemoveSourceBranch != null)
      body.delete_branch = input.shouldRemoveSourceBranch;
```

Then, at the end of `mergePullRequest`, replace:

```typescript
    const pr = await this.fetchSingleMR(projectPath, mrIid, null);
    if (!pr) throw new Error('Merged PR but failed to fetch it back');
    return pr;
```

with:

```typescript
    const pr = await this.fetchSingleMR(projectPath, mrIid, null);
    if (!pr) throw new Error('Merged PR but failed to fetch it back');
    if (input?.shouldRemoveSourceBranch) {
      await this.deleteMergedSourceBranch(projectPath, pr.sourceBranch);
    }
    return pr;
```

And add this private method after `mergeCommitFields`:

```typescript
  /**
   * GitHub's merge endpoint has no delete-branch parameter: it accepts only
   * commit_title, commit_message, sha, and merge_method. The `delete_branch`
   * field this used to send was silently ignored, so callers asking for branch
   * removal never got it (MAT-127). The ref has to be deleted in a second call.
   *
   * A ref that is already gone satisfies what the caller asked for. The
   * repository-level delete_branch_on_merge setting deletes it asynchronously
   * and races this call, so treating "not there" as failure would make every
   * merge on such a repository throw.
   */
  private async deleteMergedSourceBranch(
    projectPath: string,
    branch: string
  ): Promise<void> {
    const res = await this.api(
      'DELETE',
      `/repos/${projectPath}/git/refs/heads/${encodeURIComponent(branch)}`
    );
    if (res.ok || res.status === 404 || res.status === 422) return;
    const text = await res.text().catch(() => '');
    throw new Error(
      `mergePullRequest merged but could not delete source branch "${branch}": ${res.status} ${text}`
    );
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/gh-merge.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the full unit suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 186 pass, 0 fail, clean type-check.

- [ ] **Step 6: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-merge.test.ts
git commit -m "fix: delete the source branch after merging on GitHub (MAT-127)"
```

---

### Task 5: MAT-131, stop inventing a protection rule when the read fails

**Files:**
- Modify: `packages/glance/src/GitHubProvider.ts:695-708` (`fetchBranchProtectionRules`)
- Modify: `packages/glance/tests/live/conformance.ts` (the existing `fetchBranchProtectionRules` assertion in `runReadConformance`)
- Test: `packages/glance/tests/gh-branch-protection.test.ts` (create)

**Interfaces:**
- Consumes: `BranchProtectionRule` from `../src/types.ts` (`pattern`, `allowForcePush`, `allowDeletion`, `requiredApprovals`, `requireStatusChecks`, optional `raw`). The private `api()` method, stubbed in tests.
- Produces: no new symbols. `fetchBranchProtectionRules` gains a throwing failure path.

**Known consequence, accepted deliberately:** on a private repository on GitHub's free plan, the per-branch protection endpoint returns 403 ("Upgrade to GitHub Pro or make this repository public to enable this feature," established live in the design doc's environment facts). Today those callers receive fabricated rules; after this change they receive an error. That is the intended trade: the findings doc records that the fabricated values are wrong in both directions at once, over-reporting protection on `allowForcePush` and `allowDeletion` while under-reporting it on `requiredApprovals` and `requireStatusChecks`. An error a caller can see beats four values a caller cannot tell from real ones. The error text names the branch and the status so the 403 case is self-explanatory.

- [ ] **Step 1: Write the failing tests**

Create `packages/glance/tests/gh-branch-protection.test.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Branch protection read failures on GitHub (MAT-131).
 *
 * The success path already works and is exercised live. The failure path used
 * to invent a rule whose four fields were wrong in both directions at once:
 * allowForcePush and allowDeletion over-reported protection while
 * requiredApprovals and requireStatusChecks under-reported it, and nothing in
 * the returned shape told a caller which of those it was holding.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    headers: { get: () => null }
  } as unknown as Response;
}

/**
 * One protected branch in the listing, and a per-branch detail read whose
 * status the test chooses.
 */
function stubGitHub(provider: GitHubProvider, detailStatus: number): void {
  (provider as any).api = async (_method: string, path: string) => {
    if (path.includes('/protection')) {
      return detailStatus === 200
        ? response(200, {
            allow_force_pushes: { enabled: true },
            allow_deletions: { enabled: true },
            required_pull_request_reviews: { required_approving_review_count: 2 },
            required_status_checks: { strict: true, contexts: ['ci'] }
          })
        : response(detailStatus, { message: 'Not Found' });
    }
    return response(200, [{ name: 'main', protected: true }]);
  };
}

describe('fetchBranchProtectionRules (MAT-131)', () => {
  test('a failed per-branch read throws instead of inventing a rule', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, 404);

    await expect(provider.fetchBranchProtectionRules('acme/repo')).rejects.toThrow(
      /protection for "main"/
    );
  });

  test('the thrown error names the status so a 403 is self-explanatory', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, 403);

    await expect(provider.fetchBranchProtectionRules('acme/repo')).rejects.toThrow(
      /403/
    );
  });

  test('the success path is unchanged and still carries raw', async () => {
    const provider = new GitHubProvider('https://github.com', 'tok');
    stubGitHub(provider, 200);

    const rules = await provider.fetchBranchProtectionRules('acme/repo');

    expect(rules).toHaveLength(1);
    expect(rules[0]?.pattern).toBe('main');
    expect(rules[0]?.allowForcePush).toBe(true);
    expect(rules[0]?.allowDeletion).toBe(true);
    expect(rules[0]?.requiredApprovals).toBe(2);
    expect(rules[0]?.requireStatusChecks).toBe(true);
    expect(rules[0]?.raw).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/glance && bun test tests/gh-branch-protection.test.ts`
Expected: FAIL on the first two tests. Today the method resolves with a fabricated rule instead of rejecting. The third test passes already.

- [ ] **Step 3: Implement the throw**

In `packages/glance/src/GitHubProvider.ts`, replace lines 699-708:

```typescript
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
```

with:

```typescript
      if (!detailRes.ok) {
        // The invented rule this replaces was wrong in both directions at once:
        // it claimed force-push and deletion were forbidden while also claiming
        // no approvals and no status checks were required, and a caller had no
        // way to tell those four values from real ones (MAT-131). On a private
        // repository on the free plan this is a 403, which the message surfaces.
        const text = await detailRes.text().catch(() => '');
        throw new Error(
          `fetchBranchProtectionRules failed reading protection for "${b.name}": ${detailRes.status} ${text}`
        );
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/gh-branch-protection.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the live fabrication guard**

The fixture's protection read always succeeds, so the failure path cannot be exercised live. What the harness *can* do is assert the fabricated shape is impossible: the success path attaches `raw`, the fabricated rule omitted it. This is a regression guard, not proof of the fix, and the comment says so rather than letting a future reader over-read a green line.

In `packages/glance/tests/live/conformance.ts`, find the existing `fetchBranchProtectionRules` check inside `runReadConformance` (its label is `'returns rules for the default branch'`) and add this assertion at the end of its callback, after the existing assertions:

```typescript
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
```

If the local variable holding the result is not named `rules`, use whatever name the surrounding callback already uses rather than renaming it.

- [ ] **Step 6: Run the full unit suite and type-check**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: 189 pass, 0 fail, clean type-check.

- [ ] **Step 7: Verify no dashes were introduced**

Run: `grep -n "—\|–" packages/glance/tests/gh-branch-protection.test.ts packages/glance/tests/gh-merge.test.ts`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add packages/glance/src/GitHubProvider.ts packages/glance/tests/gh-branch-protection.test.ts packages/glance/tests/live/conformance.ts
git commit -m "fix: surface branch protection read failures instead of inventing a rule (MAT-131)"
```

---

### Task 6: Live verification, once

One run, after all three fixes. The pre-fix baseline is already recorded in the findings doc, so re-running to watch known failures fail again buys nothing and costs both fixtures a permanent file and two commits.

**Files:**
- Create: `docs/superpowers/specs/2026-08-04-github-parity-phase2-results.md` (rename to the actual run date if the run happens on a later day)
- Modify: `.superpowers/handoff-phase2.md` (gitignored, never staged)

**Interfaces:**
- Consumes: everything from Tasks 2 through 5.
- Produces: no code symbols.

- [ ] **Step 1: Confirm the harness target before running**

Run: `grep -rn "gitq-test-sandbox" packages/glance/tests/live/ harness_credentials.example.json`
Expected: no output. A stale config pointing at that repo was the single worst defect found in phase 1's review. Do not run until this is clean.

- [ ] **Step 2: Run the live harness**

Run: `cd packages/glance && bun tests/live/runner.ts`

This mutates both fixtures. Expect it to take several minutes, since the CI stage waits on a real GitHub Actions run.

- [ ] **Step 3: Read the output against these expectations**

| Line | Before | Expected now |
| --- | --- | --- |
| `github mergePullRequest: the commitMessage we asked for actually reaches the commit (MAT-25)` | FAIL | ok |
| `github mergePullRequest: shouldRemoveSourceBranch actually deletes the source branch` | FAIL | ok |
| `github fetchBranchProtectionRules: returns rules for the default branch` | ok | ok, now also guarding `raw` |
| `gitlab mergePullRequest: the commitMessage we asked for actually reaches the commit (MAT-25)` | ok | ok, now also proving no squash-message leak |
| `github retryJob: accepts a retry of the failed job` | FAIL | either, MAT-128 is untouched and its result is timing-dependent |
| `gitlab fetchJobTrace: returns non-empty log text` | FAIL | FAIL, the known harness job-selection gap, untouched |
| Exit code | 1 | 1, `assertFullCoverage` still reports four unexercised methods |

Be suspicious of passes, which is what caught most of phase 1's defects. Two specific traps:

- If the MAT-127 line passes, confirm the *harness cleanup* did not do the deleting. The cleanup runs in a `finally` after the assertion, so ordering already rules this out, but confirm the assertion line appears in the output before any cleanup error, and confirm the fixture's `delete_branch_on_merge` is still off: `gh api repos/m4ttheweric/glance-conformance --jq .delete_branch_on_merge` should print `false`.
- If the MAT-25 line passes, read the actual head commit rather than trusting the assertion: `gh api repos/m4ttheweric/glance-conformance/commits/main --jq .commit.message`. It must contain `merge-commit-message` and must not contain `squash-commit-message`.

- [ ] **Step 4: Write the results document**

Create `docs/superpowers/specs/2026-08-04-github-parity-phase2-results.md` recording, in the style of the phase 1 findings doc:

- the full verbatim runner output, in a collapsed `<details>` block
- the per-provider pass/fail/skip counts
- for each of MAT-25, MAT-127, MAT-131: what flipped, and the independent evidence from Step 3's traps where it applies
- anything that regressed or newly failed, stated plainly rather than explained away
- what this run still does not cover, carried forward from the phase 1 findings doc's own "What phase 1 did not cover" list, since none of those gaps are closed by this phase

Do not edit the phase 1 findings document. It is a record of one run at one moment, and amending it would destroy that property.

- [ ] **Step 5: Commit the results**

```bash
git add docs/superpowers/specs/2026-08-04-github-parity-phase2-results.md
git commit -m "docs: record the phase 2 live verification run"
```

- [ ] **Step 6: Update the handoff for phase 3**

Rewrite `.superpowers/handoff-phase2.md` for whoever picks up next. It is gitignored, so it is edited but never staged. It needs:

- which three tickets are fixed and verified, and by which assertions
- the deferred table from this plan's Scope section, verbatim, including MAT-130's recommended resolution and its evidence
- the two items under "Discovered while planning" above, which still need tickets
- the correction that the handoff's own "MAT-133 blocks phase 4, do it early" advice conflicts with the findings doc's phase 4 ownership, and that this plan followed the findings doc
- the standing warnings that still apply: fixture mutation per run, the credentials file, the deliberate non-zero exit

- [ ] **Step 7: Verify the credentials file was never staged**

Run: `git log --stat -6 | grep -c harness_credentials.json`
Expected: `0`.

---

## Self-Review

**Spec coverage.** Every phase 2 item the design doc names is either implemented here (MAT-25, `shouldRemoveSourceBranch`/MAT-127, phase 2c/MAT-131) or listed in the Scope table with the reason it is deferred (MAT-24, phase 2a/MAT-129, phase 2b/MAT-130, phase 2d/MAT-132). MAT-128 and MAT-133 are covered in the same table. The findings doc's "Owner: phase 2" rows all appear in one of those two groups.

**Placeholders.** None. Every code step carries the actual code. The one deliberate flexibility is Task 5 Step 5's note about the local variable name, which is a "match what is already there" instruction rather than an unwritten decision, and Task 6 Step 4, which specifies the contents of a document that cannot be written before the run it records.

**Type consistency.** `mergeCommitFields` (Task 3) and `deleteMergedSourceBranch` (Task 4) are the only new symbols, both private methods on `GitHubProvider`, and neither calls the other. `stubGitHub` and `mergeBody` are defined once in Task 3 and reused by Task 4, which is why Task 4 says it extends that file rather than creating one. Task 5's `stubGitHub` lives in a different file with a different signature, which is intentional: the two suites stub different endpoints, and sharing would couple them for no gain.

**Test counts.** 175 at baseline, plus 6 in Task 3, plus 5 in Task 4, plus 3 in Task 5, equals 189 at the end. Each task states the running total so a drift shows up immediately.
