# GitHub Parity Phase 1: Live Conformance Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live conformance harness that drives one shared assertion set against both `GitHubProvider` and `GitLabProvider`, and report exactly which `GitProvider` methods work on GitHub today.

**Architecture:** A new `packages/glance/tests/live/` directory holding a credentials loader, a compile-time-complete expectation table, a shared assertion set, and a runner. The expectation table declares every `GitProvider` method as `supported`, `unsupported`, or `approximate`; a type-level check fails `tsc` when a method is missing from it. Live assertions run against two real fixture repositories.

**Tech Stack:** TypeScript, Bun (test runner and script runtime), GitHub REST + GraphQL APIs, GitLab REST API via gitbeaker, `gh` CLI for GitHub token resolution.

## Global Constraints

- **No em dashes or en dashes** in any output: code, comments, commit messages, docs. Use an ellipsis or rephrase. (`~/.claude/rules/no-em-dashes.mdc`)
- **Comments explain why, never what.** No narration, no restating names in English, no "Step 1" comments. (`~/.claude/rules/clean-code-comments.mdc`)
- **Commit after each completed task.** Never finish a multi-task plan with one commit. (`~/.claude/rules/incremental-commits.mdc`)
- **`harness_credentials.json` is gitignored and must never be staged.** This repo is public. Verify with `git check-ignore -v harness_credentials.json` before any commit that touches credentials handling.
- **The harness never deletes repositories.** The `gh` token lacks `delete_repo` scope by design. Cleanup deletes branches and closes PRs only.
- **Never `sleep` a guessed interval to wait for GitHub.** GitHub's involvement-mode fetch is search-backed and eventually consistent (measured: absent at t+3.7s, present at t+9.7s). Always poll until a condition holds.
- Baseline before starting: `bun test tests/` from `packages/glance` reports **133 pass, 0 fail**. Do not regress this.
- Run `bun install` from the repo root first if `@gitbeaker/rest` fails to resolve.

## Fixture Environment (already verified live)

| Item | Value |
| --- | --- |
| GitLab project | `m4tthew-dev/glance-test-repo`, id `79691134` |
| GitLab owner identity | `goodwin.matthew.eric`, access level 50 |
| GitLab approver identities | `luke.skycoder` (30), `han.solocoder` (30) |
| GitHub fixture repo | `m4ttheweric/glance-conformance` (public, created in Task 3) |
| GitHub identity | `m4ttheweric` only. Self-approval returns 422. |
| GitHub plan | Free. Branch protection requires the repo be public. |

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/glance/tests/live/credentials.ts` | Load and validate `harness_credentials.json`; resolve the GitHub token from `gh auth token`. |
| `packages/glance/tests/live/expectations.ts` | The per-provider expectation table plus its compile-time completeness guard. |
| `packages/glance/tests/live/poll.ts` | `pollUntil` helper for eventually-consistent reads. |
| `packages/glance/tests/live/report.ts` | Result collection and formatted output. |
| `packages/glance/tests/live/fixture.ts` | `ProviderFixture` descriptor type and per-provider construction. |
| `packages/glance/tests/live/conformance.ts` | The shared assertion set, written once, driven per fixture. |
| `packages/glance/tests/live/runner.ts` | Entrypoint: build both fixtures, run conformance, print the report. |
| `packages/glance/tests/live/setup-github-fixture.ts` | Idempotent creation of the GitHub fixture repo, workflow, protection, and settings. |
| `packages/glance/tests/live-credentials.test.ts` | Unit tests for the credentials loader. |
| `packages/glance/tests/live-expectations.test.ts` | Unit tests for expectation-table completeness. |

Tasks 1, 2, and 4 are testable with no network. Tasks 3, 5, 6, and 7 are live and are verified by running them.

---

### Task 1: Credentials loader

**Files:**
- Create: `packages/glance/tests/live/credentials.ts`
- Test: `packages/glance/tests/live-credentials.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface HarnessUser { username: string; name: string; role: 'owner' | 'approver'; token: string }`
  - `interface HarnessRepo { provider: 'gitlab' | 'github'; name: string; web_url: string; owner: string; project_id?: number; path_with_namespace?: string }`
  - `interface HarnessCredentials { users: HarnessUser[]; repos: HarnessRepo[] }`
  - `function parseCredentials(raw: unknown): HarnessCredentials` throws `Error` with a legible message on malformed input.
  - `function ownerUser(creds: HarnessCredentials): HarnessUser`
  - `function approverUsers(creds: HarnessCredentials): HarnessUser[]`
  - `function gitlabRepo(creds: HarnessCredentials): HarnessRepo`
  - `function githubRepo(creds: HarnessCredentials): HarnessRepo`
  - `async function loadCredentials(path?: string): Promise<HarnessCredentials | null>` returns `null` when the file is absent.
  - `async function resolveGitHubToken(): Promise<string | null>` shells `gh auth token`, returns `null` when unavailable.

- [ ] **Step 1: Write the failing tests**

Create `packages/glance/tests/live-credentials.test.ts`:

```typescript
/**
 * Unit tests for the live harness credentials loader.
 *
 * Pure parsing only. No file reads and no network: a malformed credentials
 * file must fail with a message naming the problem, because the alternative
 * is a live run dying halfway through with a cleanup step already skipped.
 */
import { describe, expect, test } from 'bun:test';
import {
  approverUsers,
  githubRepo,
  gitlabRepo,
  ownerUser,
  parseCredentials,
  resolveGitHubToken
} from './live/credentials.ts';

const VALID = {
  users: [
    { username: 'owner.person', name: 'Owner', role: 'owner', token: 'glpat-a' },
    { username: 'dev.one', name: 'Dev One', role: 'approver', token: 'glpat-b' },
    { username: 'dev.two', name: 'Dev Two', role: 'approver', token: 'glpat-c' }
  ],
  repos: [
    {
      provider: 'gitlab',
      name: 'glance-test-repo',
      web_url: 'https://gitlab.com/g/glance-test-repo',
      owner: 'owner.person',
      project_id: 1,
      path_with_namespace: 'g/glance-test-repo'
    },
    {
      provider: 'github',
      name: 'glance-conformance',
      web_url: 'https://github.com/u/glance-conformance',
      owner: 'u'
    }
  ]
};

describe('parseCredentials', () => {
  test('accepts a well-formed document', () => {
    const creds = parseCredentials(VALID);
    expect(creds.users).toHaveLength(3);
    expect(creds.repos).toHaveLength(2);
  });

  test('rejects a non-object', () => {
    expect(() => parseCredentials('nope')).toThrow(/must be a JSON object/);
  });

  test('rejects a missing users array', () => {
    expect(() => parseCredentials({ repos: [] })).toThrow(/users/);
  });

  test('names the offending user index on a missing token', () => {
    const bad = { ...VALID, users: [{ username: 'x', name: 'X', role: 'owner' }] };
    expect(() => parseCredentials(bad)).toThrow(/users\[0\].*token/);
  });

  test('rejects an unknown role', () => {
    const bad = {
      ...VALID,
      users: [{ username: 'x', name: 'X', role: 'wizard', token: 't' }]
    };
    expect(() => parseCredentials(bad)).toThrow(/role/);
  });
});

describe('selectors', () => {
  test('ownerUser returns the single owner', () => {
    expect(ownerUser(parseCredentials(VALID)).username).toBe('owner.person');
  });

  test('approverUsers returns every approver', () => {
    expect(approverUsers(parseCredentials(VALID)).map(u => u.username)).toEqual([
      'dev.one',
      'dev.two'
    ]);
  });

  test('gitlabRepo and githubRepo select by provider', () => {
    const creds = parseCredentials(VALID);
    expect(gitlabRepo(creds).name).toBe('glance-test-repo');
    expect(githubRepo(creds).name).toBe('glance-conformance');
  });

  test('ownerUser throws when no owner is declared', () => {
    const noOwner = {
      ...VALID,
      users: [{ username: 'x', name: 'X', role: 'approver', token: 't' }]
    };
    expect(() => ownerUser(parseCredentials(noOwner))).toThrow(/no user with role "owner"/);
  });
});

describe('repo optional field validation', () => {
  test('rejects a non-numeric project_id', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], project_id: 'not-a-number' }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.project_id.*integer/);
  });

  test('rejects a non-integer project_id (e.g. float)', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], project_id: 1.5 }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.project_id.*integer/);
  });

  test('rejects NaN as project_id', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], project_id: NaN }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.project_id.*integer/);
  });

  test('rejects a non-string path_with_namespace', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], path_with_namespace: 12345 }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.path_with_namespace.*string/);
  });

  test('rejects an empty path_with_namespace', () => {
    const bad = {
      ...VALID,
      repos: [{ ...VALID.repos[0], path_with_namespace: '' }]
    };
    expect(() => parseCredentials(bad)).toThrow(/repos\[0\]\.path_with_namespace.*string/);
  });

  test('accepts a repo with no optional fields', () => {
    const minimal = {
      ...VALID,
      repos: [{ provider: 'github', name: 'test', web_url: 'https://example.com', owner: 'user' }]
    };
    const creds = parseCredentials(minimal);
    expect(creds.repos[0].project_id).toBeUndefined();
    expect(creds.repos[0].path_with_namespace).toBeUndefined();
  });
});

describe('resolveGitHubToken', () => {
  test('returns trimmed token when command succeeds', async () => {
    const token = await resolveGitHubToken({
      command: ['printf', 'test-token  '],
      timeoutMs: 100
    });
    expect(token).toBe('test-token');
  });

  test('returns null when command times out', async () => {
    const token = await resolveGitHubToken({
      command: ['sleep', '30'],
      timeoutMs: 50
    });
    expect(token).toBeNull();
  });

  test('returns null when command exits non-zero', async () => {
    const token = await resolveGitHubToken({
      command: ['sh', '-c', 'exit 1'],
      timeoutMs: 100
    });
    expect(token).toBeNull();
  });

  test('returns null when command succeeds but prints nothing', async () => {
    const token = await resolveGitHubToken({
      command: ['printf', ''],
      timeoutMs: 100
    });
    expect(token).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/glance && bun test tests/live-credentials.test.ts`
Expected: FAIL with `Cannot find module './live/credentials.ts'`

- [ ] **Step 3: Implement the loader**

Create `packages/glance/tests/live/credentials.ts`:

```typescript
/**
 * Credentials for the live conformance harness.
 *
 * GitLab needs three identities on one project rather than one. GitLab
 * refuses to let an author approve their own MR, so a single-token harness
 * cannot tell "approval worked" apart from "approval was rejected".
 *
 * GitHub deliberately has no token here. It comes from `gh auth token`, so
 * there is nothing GitHub-credential-shaped on disk to leak.
 */

export interface HarnessUser {
  username: string;
  name: string;
  role: 'owner' | 'approver';
  token: string;
}

export interface HarnessRepo {
  provider: 'gitlab' | 'github';
  name: string;
  web_url: string;
  owner: string;
  project_id?: number;
  path_with_namespace?: string;
}

export interface HarnessCredentials {
  users: HarnessUser[];
  repos: HarnessRepo[];
}

const ROLES = new Set(['owner', 'approver']);

function fail(message: string): never {
  throw new Error(`harness_credentials.json: ${message}`);
}

export function parseCredentials(raw: unknown): HarnessCredentials {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail('must be a JSON object');
  }
  const doc = raw as Record<string, unknown>;

  if (!Array.isArray(doc.users)) fail('`users` must be an array');
  if (!Array.isArray(doc.repos)) fail('`repos` must be an array');

  const users = doc.users.map((entry, i): HarnessUser => {
    const u = entry as Record<string, unknown>;
    for (const field of ['username', 'name', 'role', 'token']) {
      if (typeof u[field] !== 'string' || !u[field]) {
        fail(`users[${i}].${field} must be a non-empty string`);
      }
    }
    if (!ROLES.has(u.role as string)) {
      fail(`users[${i}].role must be "owner" or "approver", got "${String(u.role)}"`);
    }
    return u as unknown as HarnessUser;
  });

  const repos = doc.repos.map((entry, i): HarnessRepo => {
    const r = entry as Record<string, unknown>;
    if (r.provider !== 'gitlab' && r.provider !== 'github') {
      fail(`repos[${i}].provider must be "gitlab" or "github"`);
    }
    for (const field of ['name', 'web_url', 'owner']) {
      if (typeof r[field] !== 'string' || !r[field]) {
        fail(`repos[${i}].${field} must be a non-empty string`);
      }
    }
    if (r.project_id !== undefined) {
      if (typeof r.project_id !== 'number' || !Number.isInteger(r.project_id)) {
        fail(`repos[${i}].project_id must be an integer, got ${String(r.project_id)}`);
      }
    }
    if (r.path_with_namespace !== undefined) {
      if (typeof r.path_with_namespace !== 'string' || !r.path_with_namespace) {
        fail(`repos[${i}].path_with_namespace must be a non-empty string`);
      }
    }
    return r as unknown as HarnessRepo;
  });

  return { users, repos };
}

export function ownerUser(creds: HarnessCredentials): HarnessUser {
  const owner = creds.users.find(u => u.role === 'owner');
  if (!owner) fail('no user with role "owner"');
  return owner;
}

export function approverUsers(creds: HarnessCredentials): HarnessUser[] {
  return creds.users.filter(u => u.role === 'approver');
}

function repoFor(creds: HarnessCredentials, provider: 'gitlab' | 'github'): HarnessRepo {
  const repo = creds.repos.find(r => r.provider === provider);
  if (!repo) fail(`no repo with provider "${provider}"`);
  return repo;
}

export function gitlabRepo(creds: HarnessCredentials): HarnessRepo {
  return repoFor(creds, 'gitlab');
}

export function githubRepo(creds: HarnessCredentials): HarnessRepo {
  return repoFor(creds, 'github');
}

const DEFAULT_PATH = new URL('../../../../harness_credentials.json', import.meta.url).pathname;

/** Returns null when the file is absent, so the runner can skip with a message. */
export async function loadCredentials(
  path: string = DEFAULT_PATH
): Promise<HarnessCredentials | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return parseCredentials(await file.json());
}

/** Returns null when `gh` is missing or logged out. */
export async function resolveGitHubToken(
  opts: { command?: string[]; timeoutMs?: number } = {}
): Promise<string | null> {
  try {
    const command = opts.command ?? ['gh', 'auth', 'token'];
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'ignore' });
    let didTimeout = false;
    const timeoutHandle = setTimeout(() => {
      didTimeout = true;
      proc.kill();
    }, timeoutMs);
    try {
      const token = (await new Response(proc.stdout).text()).trim();
      if (didTimeout) return null;
      return (await proc.exited) === 0 && token ? token : null;
    } finally {
      clearTimeout(timeoutHandle);
    }
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/glance && bun test tests/live-credentials.test.ts`
Expected: PASS, 19 tests

- [ ] **Step 5: Verify DEFAULT_PATH resolves to the real credentials file**

Run: `cd packages/glance && bun -e 'import {loadCredentials} from "./tests/live/credentials.ts"; const c = await loadCredentials(); console.log(c ? c.users.map(u=>u.username+":"+u.role).join(" ") : "NOT FOUND")'`
Expected: `goodwin.matthew.eric:owner luke.skycoder:approver han.solocoder:approver`

If it prints `NOT FOUND`, the relative depth in `DEFAULT_PATH` is wrong. The file lives at the repo root and this module sits at `packages/glance/tests/live/`, so it must climb four levels.

- [ ] **Step 6: Confirm no credentials are staged, then commit**

```bash
cd /Users/matt/Documents/GitHub/glance
git check-ignore -v harness_credentials.json
git add packages/glance/tests/live/credentials.ts packages/glance/tests/live-credentials.test.ts
git status --short
git commit -m "add live harness credentials loader"
```

`git status --short` must not list `harness_credentials.json`.

---

### Task 2: Expectation table with compile-time completeness

**Files:**
- Create: `packages/glance/tests/live/expectations.ts`
- Create: `packages/glance/tsconfig.tests.json`
- Modify: `packages/glance/package.json` (add `@types/bun` devDependency and a `check-types:live` script)
- Test: `packages/glance/tests/live-expectations.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type Support = 'supported' | 'unsupported' | 'approximate'`
  - `interface Expectation { support: Support; capability?: keyof ProviderCapabilities; note?: string }`
  - `type ProviderMethod = ...` (union of `GitProvider` method names)
  - `const GITHUB_EXPECTATIONS: Record<ProviderMethod, Expectation>`
  - `const GITLAB_EXPECTATIONS: Record<ProviderMethod, Expectation>`
  - `function expectationFor(provider: 'github' | 'gitlab', method: ProviderMethod): Expectation`

This is the mechanism that stops the drift the whole project exists to fix. `Record<ProviderMethod, Expectation>` is exhaustive, so adding a method to `GitProvider` fails `tsc` until both tables declare it.

- [ ] **Step 1: Write the failing test**

Create `packages/glance/tests/live-expectations.test.ts`:

```typescript
/**
 * The expectation tables are the anti-drift mechanism: every GitProvider
 * method must be declared supported, unsupported, or approximate on each
 * provider. Exhaustiveness is enforced by `Record<ProviderMethod, ...>` at
 * compile time; these tests cover the runtime invariants that types cannot
 * express, such as an `unsupported` method naming a capability flag that is
 * actually false.
 */
import { describe, expect, test } from 'bun:test';
import { GitHubProvider } from '../src/GitHubProvider.ts';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import {
  GITHUB_EXPECTATIONS,
  GITLAB_EXPECTATIONS,
  expectationFor,
  type ProviderMethod
} from './live/expectations.ts';

const github = new GitHubProvider('https://github.com', 'token-not-used');
const gitlab = new GitLabProvider('https://gitlab.com', 'token-not-used');

describe('expectation tables', () => {
  test('both tables declare the same method set', () => {
    expect(Object.keys(GITHUB_EXPECTATIONS).sort()).toEqual(
      Object.keys(GITLAB_EXPECTATIONS).sort()
    );
  });

  test('a method is a function unless declared absent, and undefined when it is', () => {
    const cases: Array<[string, typeof GITHUB_EXPECTATIONS, object]> = [
      ['github', GITHUB_EXPECTATIONS, github],
      ['gitlab', GITLAB_EXPECTATIONS, gitlab]
    ];
    for (const [name, table, instance] of cases) {
      for (const [method, exp] of Object.entries(table)) {
        const actual = typeof (instance as Record<string, unknown>)[method];
        const wanted = exp.support === 'absent' ? 'undefined' : 'function';
        expect(`${name}.${method}:${actual}`).toBe(`${name}.${method}:${wanted}`);
      }
    }
  });

  test('only optional interface methods may be declared absent', () => {
    const OPTIONAL: string[] = ['fetchPullRequestsByBranches', 'watchEvents'];
    for (const table of [GITHUB_EXPECTATIONS, GITLAB_EXPECTATIONS]) {
      for (const [method, exp] of Object.entries(table)) {
        if (exp.support !== 'absent') continue;
        expect(`${method}:${OPTIONAL.includes(method)}`).toBe(`${method}:true`);
      }
    }
  });

  test('an unsupported or absent method names a capability flag that is false', () => {
    for (const [method, exp] of Object.entries(GITHUB_EXPECTATIONS)) {
      const gated = exp.support === 'unsupported' || exp.support === 'absent';
      if (!gated || !exp.capability) continue;
      expect(`${method}:${github.capabilities[exp.capability]}`).toBe(`${method}:false`);
    }
  });

  test('a supported method names a capability flag that is true', () => {
    for (const [method, exp] of Object.entries(GITHUB_EXPECTATIONS)) {
      if (exp.support !== 'supported' || !exp.capability) continue;
      expect(`${method}:${github.capabilities[exp.capability]}`).toBe(`${method}:true`);
    }
  });

  test('GitLab declares nothing unsupported', () => {
    const unsupported = Object.entries(GITLAB_EXPECTATIONS)
      .filter(([, e]) => e.support === 'unsupported')
      .map(([m]) => m);
    expect(unsupported).toEqual([]);
  });

  test('every entry that is not plainly supported carries a note', () => {
    for (const table of [GITHUB_EXPECTATIONS, GITLAB_EXPECTATIONS]) {
      for (const [method, exp] of Object.entries(table)) {
        if (exp.support === 'supported') continue;
        expect(`${method}:${Boolean(exp.note)}`).toBe(`${method}:true`);
      }
    }
  });

  test('expectationFor selects the right table', () => {
    expect(expectationFor('github', 'rebasePullRequest').support).toBe('unsupported');
    expect(expectationFor('gitlab', 'rebasePullRequest').support).toBe('supported');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/live-expectations.test.ts`
Expected: FAIL with `Cannot find module './live/expectations.ts'`

- [ ] **Step 3: Implement the expectation tables**

Create `packages/glance/tests/live/expectations.ts`:

```typescript
/**
 * What each provider owes a caller, per GitProvider method.
 *
 * `Record<ProviderMethod, Expectation>` is exhaustive, so adding a method to
 * GitProvider fails `tsc` here until both providers declare what it does.
 * That is deliberate: MAT-13 and MAT-14 both shipped because a method could
 * land GitHub-shaped or GitLab-shaped with nothing forcing the question.
 */

import type { GitProvider } from '../../src/GitProvider.ts';
import type { ProviderCapabilities } from '../../src/types.ts';

export type Support = 'supported' | 'unsupported' | 'approximate' | 'absent';

export interface Expectation {
  /**
   * `absent` means the optional interface method is not implemented at all,
   * so the property is `undefined` rather than a function that throws. That
   * is a distinct failure mode: callers feature-detect with `provider.x?.()`
   * and silently take a fallback path, which is why it needs its own state
   * rather than being folded into `unsupported`.
   */
  support: Support;
  /** The capability flag this method is gated on, when it has one. */
  capability?: keyof ProviderCapabilities;
  /** Required for anything not plainly `supported`. Explains the divergence. */
  note?: string;
}

type AnyMethod = (...args: never[]) => unknown;

export type ProviderMethod = {
  [K in keyof GitProvider]-?: NonNullable<GitProvider[K]> extends AnyMethod ? K : never;
}[keyof GitProvider];

export const GITHUB_EXPECTATIONS: Record<ProviderMethod, Expectation> = {
  validateToken: { support: 'supported' },
  fetchPullRequests: { support: 'supported' },
  fetchSingleMR: { support: 'supported' },
  fetchPullRequestByBranch: { support: 'supported' },
  fetchPullRequestsByBranches: {
    support: 'absent',
    note: 'Not implemented on GitHub, so callers fall back to sequential fetchPullRequestByBranch calls: N round-trips where GitLab batches into one. A performance gap rather than a correctness one.'
  },
  createPullRequest: { support: 'supported' },
  updatePullRequest: { support: 'supported' },
  fetchBranchProtectionRules: { support: 'supported' },
  deleteBranch: { support: 'supported' },
  fetchMRDiscussions: { support: 'supported' },
  mergePullRequest: { support: 'supported', capability: 'canMerge' },
  approvePullRequest: {
    support: 'approximate',
    capability: 'canApprove',
    note: 'GitHub rejects self-approval with 422. With one identity the accept path is unverifiable, so the harness asserts the rejection instead.'
  },
  unapprovePullRequest: {
    support: 'unsupported',
    capability: 'canUnapprove',
    note: 'Phase 4 implements this via the review dismissal endpoint.'
  },
  rebasePullRequest: {
    support: 'unsupported',
    capability: 'canRebase',
    note: 'Permanent. GitHub update-branch merges base into head, which is not a rebase.'
  },
  setAutoMerge: {
    support: 'unsupported',
    capability: 'canAutoMerge',
    note: 'Phase 4 implements this via GraphQL enablePullRequestAutoMerge.'
  },
  cancelAutoMerge: {
    support: 'unsupported',
    capability: 'canAutoMerge',
    note: 'Phase 4 implements this via GraphQL disablePullRequestAutoMerge.'
  },
  resolveDiscussion: {
    support: 'unsupported',
    capability: 'canResolveDiscussions',
    note: 'MAT-27. Phase 4 implements this via GraphQL resolveReviewThread.'
  },
  unresolveDiscussion: {
    support: 'unsupported',
    capability: 'canResolveDiscussions',
    note: 'MAT-27. Phase 4 implements this via GraphQL unresolveReviewThread.'
  },
  retryPipeline: { support: 'supported', capability: 'canRetryPipeline' },
  retryJob: { support: 'supported', capability: 'canRetryPipeline' },
  fetchJobTrace: { support: 'supported' },
  fetchDownstreamPipeline: {
    support: 'approximate',
    note: 'Always null. GitHub Actions has no child pipeline concept, so absence is the correct answer rather than a gap.'
  },
  fetchJobDetail: {
    support: 'approximate',
    note: 'Always returns { type: "trace" }. GitHub Actions has no bridge job concept.'
  },
  requestReReview: { support: 'supported', capability: 'canRequestReReview' },
  restRequest: { support: 'supported' },
  watchMR: {
    support: 'unsupported',
    note: 'Permanent. GitHub has no push channel equivalent to ActionCable.'
  },
  watchEvents: {
    support: 'absent',
    capability: 'canWatchEvents',
    note: 'Not implemented on GitHub: the property is undefined, not a throwing stub. Phase 4 implements it by polling the repository events feed.'
  }
};

export const GITLAB_EXPECTATIONS: Record<ProviderMethod, Expectation> = {
  validateToken: { support: 'supported' },
  fetchPullRequests: { support: 'supported' },
  fetchSingleMR: { support: 'supported' },
  fetchPullRequestByBranch: { support: 'supported' },
  fetchPullRequestsByBranches: { support: 'supported' },
  createPullRequest: { support: 'supported' },
  updatePullRequest: { support: 'supported' },
  fetchBranchProtectionRules: { support: 'supported' },
  deleteBranch: { support: 'supported' },
  fetchMRDiscussions: { support: 'supported' },
  mergePullRequest: { support: 'supported', capability: 'canMerge' },
  approvePullRequest: { support: 'supported', capability: 'canApprove' },
  unapprovePullRequest: { support: 'supported', capability: 'canUnapprove' },
  rebasePullRequest: { support: 'supported', capability: 'canRebase' },
  setAutoMerge: { support: 'supported', capability: 'canAutoMerge' },
  cancelAutoMerge: { support: 'supported', capability: 'canAutoMerge' },
  resolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  unresolveDiscussion: { support: 'supported', capability: 'canResolveDiscussions' },
  retryPipeline: { support: 'supported', capability: 'canRetryPipeline' },
  retryJob: { support: 'supported', capability: 'canRetryPipeline' },
  fetchJobTrace: { support: 'supported' },
  fetchDownstreamPipeline: { support: 'supported' },
  fetchJobDetail: { support: 'supported' },
  requestReReview: { support: 'supported', capability: 'canRequestReReview' },
  restRequest: { support: 'supported' },
  watchMR: { support: 'supported' },
  watchEvents: { support: 'supported', capability: 'canWatchEvents' }
};

export function expectationFor(
  provider: 'github' | 'gitlab',
  method: ProviderMethod
): Expectation {
  return provider === 'github' ? GITHUB_EXPECTATIONS[method] : GITLAB_EXPECTATIONS[method];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/glance && bun test tests/live-expectations.test.ts`
Expected: PASS, 8 tests

Two failures are expected to be informative rather than mysterious. If "a method is a function unless declared absent" fails, either a table key is misspelled relative to the real method name, or a method you assumed exists does not. Fix the table, never the test. `fetchPullRequestsByBranches` and `watchEvents` are already known to be `undefined` on `GitHubProvider`, which is why both are declared `absent`.

- [ ] **Step 5: Bring `tests/live` into a type-checked program**

`packages/glance/tsconfig.json` sets `"include": ["src"]`, so `bun run check-types`
type-checks no test file at all. Verified: `tsc --listFiles` reports zero files under
`tests/`. An exhaustiveness guard living in an unchecked file is decorative, so it has to
be wired into a program that actually runs before it can be trusted.

The legacy `tests/*.test.ts` files are deliberately left out of scope. They carry
pre-existing errors that are not this plan's business, and dragging them in would turn a
two-line fix into an unrelated cleanup.

Add `@types/bun` as a devDependency of `packages/glance` (the harness uses `Bun.file`
and `Bun.spawn`, which are otherwise untyped):

```bash
cd packages/glance && bun add -d @types/bun
```

Create `packages/glance/tsconfig.tests.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "types": ["node", "bun"]
  },
  "include": ["src", "tests/live"]
}
```

Add a script to `packages/glance/package.json`, alongside the existing `check-types`:

```json
"check-types:live": "tsc -p tsconfig.tests.json --noEmit"
```

Run: `cd packages/glance && bun run check-types:live`
Expected: PASS with no output.

- [ ] **Step 6: Verify the completeness guard actually bites**

Temporarily delete the whole `watchEvents` entry from `GITHUB_EXPECTATIONS`, then run:

Run: `cd packages/glance && bun run check-types:live`
Expected: FAIL with `error TS2741: Property 'watchEvents' is missing in type ... but required in type 'Record<ProviderMethod, Expectation>'`

Restore the entry and re-run. Expected: PASS with no output.

This step is the entire point of the task. A guard that does not fail is worse than no
guard, because it advertises a safety property the project does not have. If `tsc` stays
green with the entry deleted, do not paper over it with a runtime check: report the
resolved type of `ProviderMethod` and fix the type-level definition, or stop and escalate.

- [ ] **Step 7: Commit**

```bash
git add packages/glance/tests/live/expectations.ts \
        packages/glance/tests/live-expectations.test.ts \
        packages/glance/tsconfig.tests.json \
        packages/glance/package.json \
        ../../bun.lock
git commit -m "add provider expectation tables with compile-time completeness guard"
```

---

### Task 3: GitHub fixture repository

**Files:**
- Create: `packages/glance/tests/live/setup-github-fixture.ts`

**Interfaces:**
- Consumes: `resolveGitHubToken`, `loadCredentials`, `githubRepo` from Task 1.
- Produces: a live repo `m4ttheweric/glance-conformance` and `async function setupGitHubFixture(): Promise<void>`.

The script must be idempotent. It will be re-run whenever the fixture drifts.

- [ ] **Step 1: Write the setup script**

Create `packages/glance/tests/live/setup-github-fixture.ts`:

```typescript
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

import { resolveGitHubToken } from './credentials.ts';

const OWNER = 'm4ttheweric';
const REPO = 'glance-conformance';
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
  if ((await api('GET', `/repos/${SLUG}`)).ok) {
    console.log(`repo ${SLUG} exists`);
    return;
  }
  const res = await api('POST', '/user/repos', {
    name: REPO,
    description: 'Live conformance fixture for @mattstack/glance. Safe to force-push.',
    private: false,
    auto_init: true,
    has_issues: true
  });
  if (!res.ok) throw new Error(`create repo failed: ${res.status} ${await res.text()}`);
  console.log(`created ${SLUG}`);
}

async function putFile(path: string, content: string, message: string): Promise<void> {
  const existing = await api('GET', `/repos/${SLUG}/contents/${path}`);
  const sha = existing.ok ? ((await existing.json()) as { sha: string }).sha : undefined;
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
```

- [ ] **Step 2: Run the setup script**

Run: `cd packages/glance && bun tests/live/setup-github-fixture.ts`
Expected output, in order: `created m4ttheweric/glance-conformance`, `wrote README.md`, `wrote .github/workflows/ci.yml`, `auto-merge enabled`, `main protected with required status check`, then the fixture URL.

If `protect main failed: 403`, the repo was created private. Fix with `gh repo edit m4ttheweric/glance-conformance --visibility public --accept-visibility-change-consequences` and re-run.

- [ ] **Step 3: Verify idempotency**

Run the exact same command a second time.
Expected: `repo m4ttheweric/glance-conformance exists` followed by the same writes succeeding. No errors. This proves re-running after fixture drift is safe.

- [ ] **Step 4: Verify the workflow actually runs**

Run: `gh api repos/m4ttheweric/glance-conformance/actions/runs --jq '.workflow_runs[0] | "\(.name) \(.status) \(.conclusion)"'`
Expected: a run for the `conformance` workflow. Wait for `completed success` before continuing. If no runs appear, Actions is disabled on the repo; enable it in repository settings.

- [ ] **Step 5: Record the fixture in credentials, then commit the script**

Confirm `harness_credentials.json` names the new repo. Its `github` entry must read `"name": "glance-conformance"` and `"web_url": "https://github.com/m4ttheweric/glance-conformance"`. Edit if it still points at `gitq-test-sandbox`.

```bash
cd /Users/matt/Documents/GitHub/glance
git status --short
git add packages/glance/tests/live/setup-github-fixture.ts
git commit -m "add idempotent GitHub conformance fixture setup"
```

`git status --short` must not list `harness_credentials.json`.

---

### Task 4: Polling and reporting helpers

**Files:**
- Create: `packages/glance/tests/live/poll.ts`
- Create: `packages/glance/tests/live/report.ts`
- Test: `packages/glance/tests/live-poll.test.ts`
- Modify: `packages/glance/tsconfig.tests.json` (widen `include` to cover the live test files)
- Modify: `packages/glance/tests/live-credentials.test.ts:145-146` (fix two errors the widening exposes)

**Interfaces:**
- Consumes: `Support` and `Expectation` from Task 2.
- Produces:
  - `async function pollUntil<T>(label: string, fn: () => Promise<T | null>, opts?: { timeoutMs?: number; intervalMs?: number }): Promise<T>` throws on timeout.
  - `interface Result { provider: string; method: string; label: string; ok: boolean; detail?: string }`
  - `class Reporter` with `pass(provider, method, label)`, `fail(provider, method, label, detail)`, `skip(provider, method, label, reason)`, `render(): string`, `get exitCode(): number`.

- [ ] **Step 1: Write the failing test**

Create `packages/glance/tests/live-poll.test.ts`:

```typescript
/**
 * pollUntil exists because GitHub's involvement-mode fetch is search-backed
 * and eventually consistent. Measured on a sandbox: two fresh PRs absent at
 * t+3.7s, present at t+9.7s, while the REST listing had them at t+0.9s.
 * A guessed sleep is how MAT-80 got mistaken for a deleted branch.
 */
import { describe, expect, test } from 'bun:test';
import { pollUntil } from './live/poll.ts';
import { Reporter } from './live/report.ts';

describe('pollUntil', () => {
  test('returns the first non-null value', async () => {
    let calls = 0;
    const value = await pollUntil(
      'eventual',
      async () => (++calls < 3 ? null : `after ${calls}`),
      { intervalMs: 1, timeoutMs: 1000 }
    );
    expect(value).toBe('after 3');
  });

  test('returns immediately when the first call succeeds', async () => {
    let calls = 0;
    await pollUntil('instant', async () => { calls++; return 'ok'; }, { intervalMs: 50 });
    expect(calls).toBe(1);
  });

  test('throws a labelled error on timeout', async () => {
    await expect(
      pollUntil('never-appears', async () => null, { intervalMs: 1, timeoutMs: 20 })
    ).rejects.toThrow(/never-appears.*timed out/);
  });

  test('a thrown predicate does not abort the poll', async () => {
    let calls = 0;
    const value = await pollUntil(
      'flaky',
      async () => {
        if (++calls < 3) throw new Error('transient 502');
        return 'recovered';
      },
      { intervalMs: 1, timeoutMs: 1000 }
    );
    expect(value).toBe('recovered');
  });
});

describe('Reporter', () => {
  test('exitCode is 0 when nothing failed', () => {
    const r = new Reporter();
    r.pass('github', 'validateToken', 'returns a username');
    r.skip('github', 'watchMR', 'realtime', 'no push channel');
    expect(r.exitCode).toBe(0);
  });

  test('exitCode is 1 once anything failed', () => {
    const r = new Reporter();
    r.pass('github', 'validateToken', 'returns a username');
    r.fail('github', 'fetchJobTrace', 'returns log text', 'HTTP 400');
    expect(r.exitCode).toBe(1);
  });

  test('render groups by provider and shows failure detail', () => {
    const r = new Reporter();
    r.fail('github', 'fetchJobTrace', 'returns log text', 'HTTP 400 from blob storage');
    const out = r.render();
    expect(out).toContain('github');
    expect(out).toContain('fetchJobTrace');
    expect(out).toContain('HTTP 400 from blob storage');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/glance && bun test tests/live-poll.test.ts`
Expected: FAIL with `Cannot find module './live/poll.ts'`

- [ ] **Step 3: Implement both helpers**

Create `packages/glance/tests/live/poll.ts`:

```typescript
/**
 * Wait for an eventually-consistent read.
 *
 * A rejected predicate is treated as "not yet" rather than fatal: GitHub
 * answers 502 under load often enough that one transient failure must not
 * end a run that has already created branches needing cleanup.
 */
export async function pollUntil<T>(
  label: string,
  fn: () => Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    try {
      const value = await fn();
      if (value !== null && value !== undefined) return value;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      const because =
        lastError instanceof Error ? `, last error: ${lastError.message}` : '';
      throw new Error(`pollUntil("${label}") timed out after ${timeoutMs}ms${because}`);
    }
    await Bun.sleep(intervalMs);
  }
}
```

Create `packages/glance/tests/live/report.ts`:

```typescript
export interface Result {
  provider: string;
  method: string;
  label: string;
  ok: boolean;
  skipped?: boolean;
  detail?: string;
}

export class Reporter {
  private readonly results: Result[] = [];

  pass(provider: string, method: string, label: string): void {
    this.results.push({ provider, method, label, ok: true });
    console.log(`  ok    ${provider} ${method}: ${label}`);
  }

  fail(provider: string, method: string, label: string, detail: string): void {
    this.results.push({ provider, method, label, ok: false, detail });
    console.error(`  FAIL  ${provider} ${method}: ${label}\n        ${detail}`);
  }

  skip(provider: string, method: string, label: string, reason: string): void {
    this.results.push({ provider, method, label, ok: true, skipped: true, detail: reason });
    console.log(`  skip  ${provider} ${method}: ${label} (${reason})`);
  }

  get exitCode(): number {
    return this.results.some(r => !r.ok) ? 1 : 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const provider of [...new Set(this.results.map(r => r.provider))]) {
      const mine = this.results.filter(r => r.provider === provider);
      const failed = mine.filter(r => !r.ok);
      const skipped = mine.filter(r => r.skipped);
      lines.push(
        `${provider}: ${mine.length - failed.length - skipped.length} passed, ` +
          `${failed.length} failed, ${skipped.length} skipped`
      );
      for (const f of failed) {
        lines.push(`  FAIL ${f.method}: ${f.label}`);
        if (f.detail) lines.push(`       ${f.detail}`);
      }
    }
    return lines.join('\n');
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/glance && bun test tests/live-poll.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Widen the type-check to cover the live test files**

Task 2 created `tsconfig.tests.json` including `["src", "tests/live"]`. The `tests/live-*.test.ts`
files are siblings of `tests/live/`, not children, so none of them are type-checked. Every
later task adds more of them, so the gap widens with each one.

Change the `include` in `packages/glance/tsconfig.tests.json` to:

```json
  "include": ["src", "tests/live", "tests/live-*.test.ts"]
```

Then run: `cd packages/glance && bun run check-types:live`

This exposes exactly two pre-existing errors, both in Task 1's test file, both from
`noUncheckedIndexedAccess`:

```
tests/live-credentials.test.ts(145,12): error TS2532: Object is possibly 'undefined'.
tests/live-credentials.test.ts(146,12): error TS2532: Object is possibly 'undefined'.
```

Fix them by optional-chaining the indexed access at `tests/live-credentials.test.ts:145-146`:

```typescript
    expect(creds.repos[0]?.project_id).toBeUndefined();
    expect(creds.repos[0]?.path_with_namespace).toBeUndefined();
```

Re-run `bun run check-types:live`. Expected: PASS with no output.
Also run `bun run check-types` and confirm it still passes unchanged.

- [ ] **Step 6: Run the whole suite to confirm no regression**

Run: `cd packages/glance && bun test tests/`
Expected: PASS. Total is at least 133 plus the tests added in Tasks 1, 2, and 4.

- [ ] **Step 7: Commit**

```bash
git add packages/glance/tests/live/poll.ts \
        packages/glance/tests/live/report.ts \
        packages/glance/tests/live-poll.test.ts \
        packages/glance/tsconfig.tests.json \
        packages/glance/tests/live-credentials.test.ts
git commit -m "add pollUntil and Reporter helpers, type-check the live test files"
```

---

### Task 5: Fixture descriptor and read-path conformance

**Files:**
- Create: `packages/glance/tests/live/fixture.ts`
- Create: `packages/glance/tests/live/conformance.ts`
- Create: `packages/glance/tests/live/runner.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 2, and 4.
- Produces:
  - `interface ProviderFixture { name: 'github' | 'gitlab'; provider: GitProvider; projectPath: string; defaultBranch: string; approver: GitProvider | null }`
  - `async function buildFixtures(): Promise<ProviderFixture[]>`
  - `async function runReadConformance(fixture: ProviderFixture, report: Reporter): Promise<void>`
  - `async function runUnsupportedConformance(fixture: ProviderFixture, report: Reporter): Promise<void>`

`approver` is a second authenticated `GitProvider` for approval assertions, or `null` where no second identity exists (GitHub).

- [ ] **Step 1: Implement the fixture descriptor**

Create `packages/glance/tests/live/fixture.ts`:

```typescript
import { GitHubProvider } from '../../src/GitHubProvider.ts';
import { GitLabProvider } from '../../src/GitLabProvider.ts';
import type { GitProvider } from '../../src/GitProvider.ts';
import {
  approverUsers,
  githubRepo,
  gitlabRepo,
  loadCredentials,
  ownerUser,
  resolveGitHubToken
} from './credentials.ts';

export interface ProviderFixture {
  name: 'github' | 'gitlab';
  provider: GitProvider;
  projectPath: string;
  defaultBranch: string;
  /** A second identity for approval assertions, or null when only one exists. */
  approver: GitProvider | null;
}

function githubSlug(webUrl: string): string {
  const match = webUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match?.[1]) throw new Error(`cannot parse owner/repo from "${webUrl}"`);
  return match[1];
}

export async function buildFixtures(): Promise<ProviderFixture[]> {
  const creds = await loadCredentials();
  if (!creds) {
    console.error('No harness_credentials.json. Copy harness_credentials.example.json and fill it in.');
    return [];
  }

  const fixtures: ProviderFixture[] = [];

  const ghToken = await resolveGitHubToken();
  if (ghToken) {
    fixtures.push({
      name: 'github',
      provider: new GitHubProvider('https://github.com', ghToken),
      projectPath: githubSlug(githubRepo(creds).web_url),
      defaultBranch: 'main',
      approver: null
    });
  } else {
    console.error('Skipping GitHub: `gh auth token` produced nothing. Run `gh auth login`.');
  }

  const glRepo = gitlabRepo(creds);
  const glPath = glRepo.path_with_namespace;
  if (!glPath) throw new Error('gitlab repo entry needs path_with_namespace');
  const approvers = approverUsers(creds);
  fixtures.push({
    name: 'gitlab',
    provider: new GitLabProvider('https://gitlab.com', ownerUser(creds).token),
    projectPath: glPath,
    defaultBranch: 'main',
    approver: approvers[0]
      ? new GitLabProvider('https://gitlab.com', approvers[0].token)
      : null
  });

  return fixtures;
}
```

- [ ] **Step 2: Implement the read-path and unsupported-path assertions**

Create `packages/glance/tests/live/conformance.ts`:

```typescript
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
    report.fail(
      fixture.name,
      method,
      label,
      err instanceof Error ? err.message : String(err)
    );
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
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

  await check(report, fixture, 'fetchPullRequests', 'returns an array', async () => {
    const prs = await provider.fetchPullRequests();
    assert(Array.isArray(prs), `expected an array, got ${typeof prs}`);
  });

  await check(
    report,
    fixture,
    'fetchPullRequests',
    'projectPath mode returns only that project',
    async () => {
      const prs = await provider.fetchPullRequests({ projectPath, state: 'opened' });
      assert(Array.isArray(prs), 'expected an array');
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
    }
  );

  await check(report, fixture, 'restRequest', 'authenticated GET succeeds', async () => {
    // Both providers expose the current user at /user, so no branch is needed.
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
      report.skip(fixture.name, method, 'declared unsupported', 'declared supported here');
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
  }
}
```

- [ ] **Step 3: Implement the runner**

Create `packages/glance/tests/live/runner.ts`:

```typescript
#!/usr/bin/env bun
/**
 * Live conformance runner.
 *
 * Deliberately not named `*.test.ts`: it needs real credentials and mutates
 * real projects, so `bun test tests/` must never pick it up.
 *
 * Run: bun tests/live/runner.ts
 */

import { runReadConformance, runUnsupportedConformance } from './conformance.ts';
import { buildFixtures } from './fixture.ts';
import { Reporter } from './report.ts';

const fixtures = await buildFixtures();
if (fixtures.length === 0) {
  console.error('No fixtures could be built. Nothing to run.');
  process.exit(1);
}

const report = new Reporter();

for (const fixture of fixtures) {
  console.log(`\n=== ${fixture.name} (${fixture.projectPath}) ===\n`);
  await runReadConformance(fixture, report);
  await runUnsupportedConformance(fixture, report);
}

console.log(`\n${'='.repeat(60)}\n`);
console.log(report.render());
process.exit(report.exitCode);
```

- [ ] **Step 4: Run the harness**

Run: `cd packages/glance && bun tests/live/runner.ts`
Expected: both provider sections run to completion and a summary prints.

**Failures here are the deliverable, not a blocker.** This is the first time these paths have run against a live API. Record every failure verbatim, because phases 2 through 4 are planned from this output. Do not fix provider code in this task.

- [ ] **Step 5: Verify `bun test tests/` still ignores the live directory**

Run: `cd packages/glance && bun test tests/ 2>&1 | tail -4`
Expected: the same pass count as after Task 4, with no live files executed. If Bun picks up anything under `tests/live/`, rename the offending file so it does not match `*.test.ts`.

- [ ] **Step 6: Commit**

```bash
cd /Users/matt/Documents/GitHub/glance
git add packages/glance/tests/live/fixture.ts packages/glance/tests/live/conformance.ts packages/glance/tests/live/runner.ts
git commit -m "add read-path and unsupported-path live conformance"
```

---

### Task 6: Write-cycle conformance

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`
- Modify: `packages/glance/tests/live/runner.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: `async function runWriteConformance(fixture: ProviderFixture, report: Reporter): Promise<void>`

Covers the full lifecycle: branch, PR, update, discussions, approval, merge, cleanup. Every created branch is deleted in a `finally`.

- [ ] **Step 1: Add the write cycle to `conformance.ts`**

Append to `packages/glance/tests/live/conformance.ts`:

```typescript
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
    `/projects/${encoded}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(defaultBranch)}`
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
      assert(updated.isDraft === true, 'isDraft did not become true');
    });

    await check(report, fixture, 'updatePullRequest', 'toggles draft off', async () => {
      const updated = await provider.updatePullRequest(projectPath, iid, { draft: false });
      assert(updated.isDraft === false, 'isDraft did not become false');
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
        'self-approval is rejected, proving request shape reaches GitHub',
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
        }
      );
    } else if (fixture.approver) {
      await check(
        report,
        fixture,
        'approvePullRequest',
        'a second identity can approve',
        async () => {
          await fixture.approver!.approvePullRequest(projectPath, iid);
        }
      );
      await check(
        report,
        fixture,
        'unapprovePullRequest',
        'the same identity can revoke',
        async () => {
          await fixture.approver!.unapprovePullRequest(projectPath, iid);
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
```

- [ ] **Step 2: Wire the write cycle into the runner**

In `packages/glance/tests/live/runner.ts`, change the import to add `runWriteConformance`:

```typescript
import {
  runReadConformance,
  runUnsupportedConformance,
  runWriteConformance
} from './conformance.ts';
```

and add the call inside the fixture loop, after `runUnsupportedConformance`:

```typescript
  await runWriteConformance(fixture, report);
```

- [ ] **Step 3: Run the harness**

Run: `cd packages/glance && bun tests/live/runner.ts`
Expected: the write cycle runs on both providers. Record every failure verbatim.

- [ ] **Step 4: Verify cleanup left nothing behind**

Run: `gh api repos/m4ttheweric/glance-conformance/branches --jq '.[].name'`
Expected: only `main`. Any leftover `conformance/...` branch means the `finally` block did not run or `deleteBranch` failed. Delete leftovers by hand and investigate before continuing.

Run: `cd packages/glance && bun -e 'import {buildFixtures} from "./tests/live/fixture.ts"; const [,gl] = await buildFixtures(); const r = await gl.provider.restRequest("GET", "/projects/" + encodeURIComponent(gl.projectPath) + "/repository/branches"); console.log(((await r.json()) as {name:string}[]).map(b=>b.name).join(" "))'`
Expected: no `conformance/` branches.

- [ ] **Step 5: Commit**

```bash
cd /Users/matt/Documents/GitHub/glance
git add packages/glance/tests/live/conformance.ts packages/glance/tests/live/runner.ts
git commit -m "add write-cycle live conformance with guaranteed branch cleanup"
```

---

### Task 7: CI conformance and the parity report

**Files:**
- Modify: `packages/glance/tests/live/conformance.ts`
- Modify: `packages/glance/tests/live/runner.ts`
- Create: `docs/superpowers/specs/2026-08-04-github-parity-findings.md`

**Interfaces:**
- Consumes: everything from Task 6.
- Produces: `async function runCiConformance(fixture: ProviderFixture, report: Reporter): Promise<void>` and the findings document that phases 2 through 4 are planned from.

- [ ] **Step 1: Add CI assertions to `conformance.ts`**

Append to `packages/glance/tests/live/conformance.ts`:

```typescript
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
  const pipeRes = await provider.restRequest('GET', `/projects/${encoded}/pipelines?per_page=1`);
  if (!pipeRes.ok) return null;
  const pipes = (await pipeRes.json()) as Array<{ id: number }>;
  const pipe = pipes[0];
  if (!pipe) return null;
  const jobsRes = await provider.restRequest(
    'GET',
    `/projects/${encoded}/pipelines/${pipe.id}/jobs`
  );
  if (!jobsRes.ok) return null;
  const jobs = (await jobsRes.json()) as Array<{ id: number }>;
  const job = jobs[0];
  return job ? { pipelineId: pipe.id, jobId: job.id } : null;
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
}
```

- [ ] **Step 2: Wire it into the runner**

In `packages/glance/tests/live/runner.ts`, extend the import and add the call after `runWriteConformance`:

```typescript
import {
  runCiConformance,
  runReadConformance,
  runUnsupportedConformance,
  runWriteConformance
} from './conformance.ts';
```

```typescript
  await runCiConformance(fixture, report);
```

- [ ] **Step 3: Run the full harness and capture the output**

Run: `cd packages/glance && bun tests/live/runner.ts 2>&1 | tee /tmp/conformance-run.txt`
Expected: every section runs on both providers and a summary prints.

`fetchJobTrace` on GitHub is the specific assertion to watch. The spec predicts it fails, because the Actions logs endpoint returns 302 to signed blob storage and forwarding the `Authorization` header there typically answers 400. The `starts with <` assertion exists to catch an error page being returned as if it were a log.

- [ ] **Step 4: Write the findings document**

Create `docs/superpowers/specs/2026-08-04-github-parity-findings.md` recording, from the actual run output:

- The full summary line for each provider.
- Every failing method, with the verbatim error.
- For each failure, which phase owns the fix: phase 2 for MAT-24 and MAT-25, phase 3 for anything the Octokit swap addresses (redirects, rate limits, pagination), phase 4 for capability work.
- Anything that passed unexpectedly, since the expectation table may be wrong rather than the code.

Do not speculate about causes not evidenced by the output. This document is the input to three more plans, so a guess recorded here becomes a task built on sand.

- [ ] **Step 5: Verify the suite and types are still clean**

Run: `cd packages/glance && bun test tests/ && bun run check-types`
Expected: tests pass with no live files picked up, and `check-types` produces no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/matt/Documents/GitHub/glance
git add packages/glance/tests/live/conformance.ts packages/glance/tests/live/runner.ts docs/superpowers/specs/2026-08-04-github-parity-findings.md
git commit -m "add CI live conformance and record phase 1 findings"
```

---

## Done when

- `bun tests/live/runner.ts` runs end to end against both providers and prints a summary.
- `bun test tests/` still passes, at 133 plus the unit tests added here, with nothing under `tests/live/` picked up.
- `bun run check-types` is clean, and deleting any line from either expectation table breaks it.
- No `conformance/` branches remain on either fixture repo.
- `harness_credentials.json` has never appeared in `git status`.
- The findings document records what actually broke, in the API's own words.

## Explicitly not in this plan

Fixing anything the harness finds. Phase 1 measures; it does not repair. Phases 2, 3, and 4 get their own plans, written from the findings document rather than from prediction.
