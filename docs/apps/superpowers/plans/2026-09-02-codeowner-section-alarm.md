# Codeowner Section Alarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A codeowners tab whose configured section is not in the project's default-branch CODEOWNERS says so, with the closest real section name, instead of showing a clean empty queue.

**Architecture:** glance gains a GitLab-only read of the default-branch CODEOWNERS section headers. The rt daemon stores that list as `knownSections` on the project scope during deep syncs and section backfills and returns it through `project-mrs:read`. The board unions it across projects into `scopeKnownSections` and renders a banner, a tab-strip chip, and tab-editor hints for any configured section absent from the set. An older daemon (field absent) disables the feature, never alarms.

**Tech Stack:** TypeScript on bun; React 19 client with @mattstack/tui-kit; bun:test; Playwright capture baselines in board; GitLab GraphQL via glance.

**Spec:** `docs/superpowers/specs/2026-09-02-codeowner-section-alarm-design.md` (board repo, branch `codeowner-section-alarm`)

## Global Constraints

- Three repos in dependency order: glance, then rt (repo-tools), then board. Phase B needs glance 0.22.0 on npm; Phase C needs rt-client 0.11.1 on npm. Both publishes are Matt's (OTP); stop at each gate and report.
- Versions: glance `0.22.0`; rt-client `0.11.1`; repo-tools depends on glance `^0.22.0`; board depends on rt-client `^0.11.1`.
- `knownSections` semantics from the spec: `string[]` sorted verbatim headers; `[]` when no CODEOWNERS file or no sections; absent when the daemon predates the field or no deep/backfill has run since a section was demanded. A failed fetch keeps the previous stored value and never clears it.
- Board copy, exact: banner `⚠ no CODEOWNERS section "<section>"` followed by ` · did you mean "<suggestion>"?` only when there is a suggestion, then a `fix in settings` button; strip chip text `no such section`; editor hint `not in CODEOWNERS` plus the same did-you-mean clause.
- No em dashes or en dashes anywhere (code, comments, commit messages, docs). Use `...` or rephrase.
- Comments state constraints only (parity anchors, ordering traps, invariants, a why). No narration, no reviewer notes, no ticket ids in source.
- board is public: neutral placeholders only (Acme, g/p, gitlab.example). Run `sh scripts/repo-purity.sh` before every board commit; it must print `ok   repo-purity`.
- rt-client is release-class: publish from `main` only, never `--ignore-scripts`; run `bun run build` in `packages/rt-client` after touching its source so `test/dist-freshness.test.ts` passes.
- Worktrees: in each repo run `rt worktree provision --branch <branch> --json` and work in the printed path. If rt answers that the repo is not registered, use `git worktree add .worktrees/<branch> -b <branch>` from the repo root instead. Never create a worktree as a sibling of the repo.
- Commit after every task with a short imperative message. Each task's final step is its commit.

---

## Phase A: glance

Repo: `~/Documents/GitHub/glance`, package `packages/glance`. Branch `codeowner-sections`. Run tests with `bun test` from `packages/glance`.

### Task 1: `parseCodeownerSections`

**Files:**
- Create: `packages/glance/src/codeowners.ts`
- Modify: `packages/glance/src/index.ts:99-108` (the `export { GitLabProvider, ... } from './GitLabProvider.ts'` block; add a sibling export line after it)
- Test: `packages/glance/tests/codeowner-sections.test.ts`

**Interfaces:**
- Produces: `parseCodeownerSections(text: string): string[]` exported from `@mattstack/glance` and imported by Task 2.

- [ ] **Step 1: Write the failing test**

```ts
#!/usr/bin/env bun
/**
 * parseCodeownerSections: section headers only, verbatim, sorted, de-duplicated
 * the way GitLab merges them (case-insensitively, first casing kept). A path
 * rule containing brackets is not a header because it does not start with
 * one; an approvals count and default owners are not part of the name.
 */
import { describe, expect, test } from 'bun:test';
import { parseCodeownerSections } from '../src/codeowners.ts';

describe('parseCodeownerSections', () => {
  test('reads plain, optional, counted, defaulted and indented headers once each, first casing wins', () => {
    const text = [
      '# owners',
      '[Docs] @writers',
      '^[Optional Section]',
      '[Backend][2] @acme/backend-pod',
      '  [Indented]',
      'src/foo/[bar].ts @someone',
      '[DOCS] @again',
      '',
    ].join('\n');
    expect(parseCodeownerSections(text)).toEqual(['Backend', 'Docs', 'Indented', 'Optional Section']);
  });

  test('keeps spaces and a channel suffix verbatim', () => {
    expect(parseCodeownerSections('[Acme - #pod-acme] @acme/pod\r\n[Platform QA] @qa')).toEqual([
      'Acme - #pod-acme',
      'Platform QA',
    ]);
  });

  test('a file with no headers yields an empty list', () => {
    expect(parseCodeownerSections('* @everyone\n# note\n')).toEqual([]);
    expect(parseCodeownerSections('')).toEqual([]);
  });

  test('an empty bracket pair is not a section', () => {
    expect(parseCodeownerSections('[] @nobody\n[ ] @nobody')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Documents/GitHub/glance/packages/glance && bun test tests/codeowner-sections.test.ts`
Expected: FAIL, cannot resolve `../src/codeowners.ts`.

- [ ] **Step 3: Write the implementation**

`packages/glance/src/codeowners.ts`:

```ts
/**
 * Section headers of a GitLab CODEOWNERS file: a line whose first non-blank
 * character opens a bracket, optionally prefixed with `^` for an optional
 * section. The approvals-count suffix (`[Name][2]`) and trailing default
 * owners are not part of the name. GitLab merges same-named sections
 * case-insensitively and keeps the first heading's casing, so this does too;
 * the kept text is what the approval rule's `section` carries and what
 * consumers match exactly.
 */
export function parseCodeownerSections(text: string): string[] {
  const byKey = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\^?\[([^\]]*)\]/.exec(raw.trimStart());
    if (!m) continue;
    const name = m[1]!.trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort();
}
```

Then in `packages/glance/src/index.ts`, directly after the `} from './GitLabProvider.ts';` line of the Providers block, add:

```ts
export { parseCodeownerSections } from './codeowners.ts';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/Documents/GitHub/glance/packages/glance && bun test tests/codeowner-sections.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/glance
git add packages/glance/src/codeowners.ts packages/glance/src/index.ts packages/glance/tests/codeowner-sections.test.ts
git commit -m "glance: parseCodeownerSections reads section headers verbatim"
```

### Task 2: `GitLabProvider.fetchCodeownerSections`

**Files:**
- Modify: `packages/glance/src/GitLabProvider.ts` (query constants after `MR_APPROVAL_RULES_BY_IID_QUERY` near line 627; method after `fetchApprovalRules` which ends near line 999; import at the top)
- Test: `packages/glance/tests/gitlab-codeowner-sections.test.ts`

**Interfaces:**
- Consumes: `parseCodeownerSections` from Task 1; the private `runQuery<T>(op, query, variables)` already on the class.
- Produces: `fetchCodeownerSections(options: { projectPath: string }): Promise<string[] | null>` on `GitLabProvider`, used by rt in Tasks 6 and 7.

- [ ] **Step 1: Write the failing test**

```ts
#!/usr/bin/env bun
/**
 * fetchCodeownerSections: one blobs query for every documented CODEOWNERS
 * location, first-in-precedence wins, null when none exists. No ref is sent:
 * GitLab resolves the default branch.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';

function stubRunQuery(provider: GitLabProvider, response: unknown) {
  const calls: Array<{ op: string; vars: any }> = [];
  (provider as any).runQuery = async (op: string, _query: string, vars: any) => {
    calls.push({ op, vars });
    return response;
  };
  return calls;
}

const blobs = (nodes: Array<{ path: string; rawTextBlob: string | null }>) => ({
  project: { repository: { blobs: { nodes } } },
});

describe('fetchCodeownerSections', () => {
  test('parses the file and asks for every documented location in one query', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    const calls = stubRunQuery(p, blobs([{ path: '.gitlab/CODEOWNERS', rawTextBlob: '[Docs] @a\n[Api - #pod-x] @b\n' }]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toEqual(['Api - #pod-x', 'Docs']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.op).toBe('fetchCodeownerSections');
    expect(calls[0]!.vars).toEqual({ projectPath: 'g/p', paths: ['CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'] });
  });

  test('the root file wins when several locations exist, then docs over .gitlab', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, blobs([
      { path: 'docs/CODEOWNERS', rawTextBlob: '[FromDocs]' },
      { path: 'CODEOWNERS', rawTextBlob: '[FromRoot]' },
    ]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toEqual(['FromRoot']);
    stubRunQuery(p, blobs([
      { path: '.gitlab/CODEOWNERS', rawTextBlob: '[FromGitlabDir]' },
      { path: 'docs/CODEOWNERS', rawTextBlob: '[FromDocs]' },
    ]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toEqual(['FromDocs']);
  });

  test('null when no location exists; [] when the file has no sections', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, blobs([]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toBeNull();
    stubRunQuery(p, blobs([{ path: 'CODEOWNERS', rawTextBlob: '* @everyone\n' }]));
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toEqual([]);
  });

  test('a missing project or repository reads as no file', async () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    stubRunQuery(p, { project: null });
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toBeNull();
    stubRunQuery(p, { project: { repository: null } });
    expect(await p.fetchCodeownerSections({ projectPath: 'g/p' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ~/Documents/GitHub/glance/packages/glance && bun test tests/gitlab-codeowner-sections.test.ts`
Expected: FAIL, `p.fetchCodeownerSections is not a function`.

- [ ] **Step 3: Write the implementation**

At the top of `packages/glance/src/GitLabProvider.ts`, next to the other local imports:

```ts
import { parseCodeownerSections } from './codeowners.ts';
```

After the `ApprovalRulesResponse` interface (near line 645), add:

```ts
/** GitLab's documented CODEOWNERS locations in its precedence order (root,
    then docs/, then .gitlab/): the first that exists is the one GitLab reads.
    No `ref`: GitLab resolves the default branch, which is the only branch
    whose sections new MRs will match. */
const CODEOWNERS_PATHS = ['CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'] as const;

const CODEOWNERS_BLOBS_QUERY = `
  query GlanceCodeownersBlobs($projectPath: ID!, $paths: [String!]!) {
    project(fullPath: $projectPath) {
      repository {
        blobs(paths: $paths) { nodes { path rawTextBlob } }
      }
    }
  }
`;

interface CodeownersBlobsResponse {
  project: {
    repository: {
      blobs: { nodes: Array<{ path: string; rawTextBlob: string | null }> } | null;
    } | null;
  } | null;
}
```

After the closing brace of `fetchApprovalRules` (the method ending with `return out;`), add:

```ts
  /**
   * Section headers of the project's default-branch CODEOWNERS, or null when
   * no CODEOWNERS file exists at any documented location. Per-MR approval
   * rules snapshot section names at MR sync time and keep old names after a
   * rename; this is the live list a new MR will match against.
   */
  async fetchCodeownerSections(options: { projectPath: string }): Promise<string[] | null> {
    const resp = await this.runQuery<CodeownersBlobsResponse>(
      'fetchCodeownerSections', CODEOWNERS_BLOBS_QUERY,
      { projectPath: options.projectPath, paths: [...CODEOWNERS_PATHS] },
    );
    const nodes = resp.project?.repository?.blobs?.nodes ?? [];
    for (const path of CODEOWNERS_PATHS) {
      const node = nodes.find((n) => n.path === path);
      if (node) return parseCodeownerSections(node.rawTextBlob ?? '');
    }
    return null;
  }
```

- [ ] **Step 4: Run the tests and the type check**

Run: `cd ~/Documents/GitHub/glance/packages/glance && bun test tests/gitlab-codeowner-sections.test.ts tests/approval-rules.test.ts && bun run check-types`
Expected: both test files PASS; `check-types` exits 0. `providerConformance.ts` only checks methods declared on the `GitProvider` interface, and this method is not on it, so no conformance change is needed.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/glance
git add packages/glance/src/GitLabProvider.ts packages/glance/tests/gitlab-codeowner-sections.test.ts
git commit -m "glance: fetchCodeownerSections reads the default-branch CODEOWNERS headers"
```

### Task 3: glance 0.22.0 release prep

**Files:**
- Modify: `packages/glance/package.json:3` (`"version": "0.21.1"` to `"0.22.0"`)
- Modify: `packages/glance/CHANGELOG.md:1-3` (insert a new section under the `# @mattstack/glance` heading)

- [ ] **Step 1: Bump the version**

In `packages/glance/package.json` change `"version": "0.21.1"` to `"version": "0.22.0"`.

- [ ] **Step 2: Add the changelog entry**

Insert directly under the `# @mattstack/glance` line:

```md
## 0.22.0

### Minor Changes

- New `GitLabProvider.fetchCodeownerSections({ projectPath })`: the section
  headers of the project's default-branch CODEOWNERS (first documented
  location wins), or `null` when the project has no such file. New export
  `parseCodeownerSections(text)`, the pure parser behind it. Per-MR approval
  rules keep a section name as it was when the MR last synced, so after a
  section rename they cannot say which names still exist; this can.

```

- [ ] **Step 3: Run the full package verification**

Run: `cd ~/Documents/GitHub/glance/packages/glance && bun test && bun run check-types && bun run check:node`
Expected: all tests PASS; type check exits 0; `check:node` builds `dist/` and the node smoke passes. Then confirm the built bundle carries the verb: `grep -c fetchCodeownerSections dist/GitLabProvider.js` prints a number greater than 0.

- [ ] **Step 4: Commit and open the PR**

```bash
cd ~/Documents/GitHub/glance
git add packages/glance/package.json packages/glance/CHANGELOG.md
git commit -m "glance 0.22.0: fetchCodeownerSections"
git push -u origin codeowner-sections
gh pr create --title "glance 0.22.0: fetchCodeownerSections" --body "$(cat <<'EOF'
## Default-branch CODEOWNERS section headers

Adds `GitLabProvider.fetchCodeownerSections` and the pure `parseCodeownerSections`, so a consumer can tell which section names still exist after a CODEOWNERS rename. Per-MR approval rules snapshot the old name and cannot.

### What changed

**Provider** (`src/GitLabProvider.ts`)

- one blobs query over the three documented locations, first-in-precedence wins
- `null` when no file exists, `[]` when it has no sections

**Parser** (`src/codeowners.ts`)

- headers verbatim, optional-section prefix and approvals count ignored, sorted and de-duplicated

---

**Checklist**

- [x] Appropriate tests have been created or updated
  - 8 new tests across `tests/codeowner-sections.test.ts` and `tests/gitlab-codeowner-sections.test.ts`; package suite green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Gate: report to Matt**

Stop here. Matt merges the PR, waits for CodeRabbit and CI, then publishes from a `main` checkout with `cd packages/glance && npm publish` (prepublishOnly runs the checks; OTP prompt). Phase B starts once `npm view @mattstack/glance version` prints `0.22.0`.

---

## Phase B: rt (repo-tools)

Repo: `~/Documents/GitHub/repo-tools`. Branch `codeowner-known-sections`. Provision with `rt worktree provision --branch codeowner-known-sections --json` and work in the printed path; run `rt worktree await-ready <tree>` before the first test run. Run tests with `bun test <file>` from the tree root.

### Task 4: depend on glance 0.22.0

**Files:**
- Modify: `package.json:34` (`"@mattstack/glance": "^0.20.0"` to `"^0.22.0"`)
- Modify: `bun.lock` (by `bun install`)

- [ ] **Step 1: Bump and install**

Change the dependency line to `"@mattstack/glance": "^0.22.0"`, then run `bun install`.

- [ ] **Step 2: Verify the method resolved**

Run: `bun -e 'import { GitLabProvider } from "@mattstack/glance"; console.log(typeof GitLabProvider.prototype.fetchCodeownerSections)'`
Expected: `function`.

- [ ] **Step 3: Run the daemon suites that touch the provider**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts lib/daemon/__tests__/project-mrs-store.test.ts`
Expected: PASS, unchanged counts.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "deps: glance 0.22.0 for fetchCodeownerSections"
```

### Task 5: `knownSections` on the stored scope

**Files:**
- Modify: `lib/daemon/project-mrs-store.ts:52-60` (add a `ProjectScope` type, use it in `ProjectMRStore.scope`), `:78` (`setScope` signature), `:395-404` (`setScope` body)
- Test: `lib/daemon/__tests__/project-mrs-store.test.ts` (after the `setScope(repoName, null) clears an existing scope` test near line 334)

**Interfaces:**
- Produces: `export interface ProjectScope { authors: string[]; sections?: string[]; windowDays: number; knownSections?: string[] }`; `setScope(repoName, scope: ProjectScope | null)` persists `knownSections`; `store.read(repo)?.scope?.knownSections` reads it back. Tasks 6 and 7 rely on all three.

- [ ] **Step 1: Write the failing test**

Add to the `describe` block that holds the existing `setScope` tests:

```ts
  test("setScope round-trips knownSections and drops it when absent", () => {
    const s = tmpStore();
    s.fullSync("r", "g/p", [], Date.now());
    s.setScope("r", { authors: ["alice"], windowDays: 30, knownSections: ["Beta", "Acme"] });
    expect(s.read("r")!.scope).toEqual({ authors: ["alice"], windowDays: 30, knownSections: ["Beta", "Acme"] });
    s.setScope("r", { authors: ["alice"], windowDays: 30 });
    expect(s.read("r")!.scope!.knownSections).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test lib/daemon/__tests__/project-mrs-store.test.ts -t "round-trips knownSections"`
Expected: FAIL, the type error on `knownSections` surfaces at runtime as the stored scope lacking the field (`expect ... toEqual` fails).

- [ ] **Step 3: Write the implementation**

In `lib/daemon/project-mrs-store.ts`, replace the three inline scope literals with one type. Add above `ProjectMRStore`:

```ts
/** A demand-scoped repo's sync scope. `knownSections` is the default-branch
    CODEOWNERS header list at the last deep or backfill; absent until one has
    run with a section demanded. */
export interface ProjectScope {
  authors: string[];
  sections?: string[];
  windowDays: number;
  knownSections?: string[];
}
```

Change the `ProjectMRStore` field to `scope?: ProjectScope;`, the interface method to `setScope(repoName: string, scope: ProjectScope | null): void;`, and the implementation to:

```ts
  function setScope(repoName: string, scope: ProjectScope | null): void {
    const store = data[repoName];
    if (!store) return;
    if (scope === null) {
      delete store.scope;
    } else {
      store.scope = {
        authors: [...scope.authors],
        sections: scope.sections ? [...scope.sections] : undefined,
        windowDays: scope.windowDays,
        knownSections: scope.knownSections ? [...scope.knownSections] : undefined,
      };
    }
    persistOrWarn("project-mrs", () => writeMeta(repoName, store), { repo: repoName, op: "setScope" });
  }
```

- [ ] **Step 4: Run the store suite**

Run: `bun test lib/daemon/__tests__/project-mrs-store.test.ts`
Expected: PASS including the new test. The meta column is JSON, so no schema change and no migration.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/project-mrs-store.ts lib/daemon/__tests__/project-mrs-store.test.ts
git commit -m "project-mrs store: knownSections rides the scope JSON"
```

### Task 6: deep sync records `knownSections`

**Files:**
- Modify: `lib/daemon/project-sync.ts:102-126` (`ProjectSyncOverrides`), `:171-175` (next to the `fetchRules` default in `syncImpl`), `:217-285` (the scoped deep block and its `setScope` call), plus a module-level helper near `sameSections`
- Test: `lib/daemon/__tests__/project-sync.test.ts` (inside the `describe` that starts near line 968 with `const deps = (repo: string) => ...`, after the `deep with a sections demand sweeps rules...` test)

**Interfaces:**
- Consumes: `ProjectScope.knownSections` and `setScope` from Task 5; `provider.fetchCodeownerSections` from Task 2.
- Produces: `ProjectSyncOverrides.fetchKnownSections?: (repoName: string) => Promise<string[] | null>` and the helper `readKnownSections(fetch, repoName, previous)`; Task 7 reuses both.

- [ ] **Step 1: Write the failing tests**

```ts
  test("deep with a sections demand records the CODEOWNERS header list as knownSections", async () => {
    const store = tmpStore();
    store.registerDemand("ks1", "board:1", ["ada"], 1, ["Acme"]);
    await syncProjectMRs(deps("ks1"), "ks1", {
      store, selfUsername: "self", windowDays: 30, mode: "deep",
      fetchAuthors: async () => ({ projectPath: "g/p", prs: [] }),
      fetchRules: async () => ({ projectPath: "g/p", rules: [] }),
      fetchKnownSections: async () => ["Beta", "Acme - #pod-acme"],
    });
    expect(store.read("ks1")!.scope).toMatchObject({ sections: ["Acme"], knownSections: ["Beta", "Acme - #pod-acme"] });
  });

  test("deep keeps the previous knownSections when the fetch throws, and still completes", async () => {
    const store = tmpStore();
    store.registerDemand("ks2", "board:1", ["ada"], 1, ["Acme"]);
    const base = {
      store, selfUsername: "self", windowDays: 30, mode: "deep" as const,
      fetchAuthors: async () => ({ projectPath: "g/p", prs: [pr(1, { author: { username: "ada" } as any })] }),
      fetchRules: async () => ({ projectPath: "g/p", rules: [] }),
    };
    await syncProjectMRs(deps("ks2"), "ks2", { ...base, fetchKnownSections: async () => ["Acme"] });
    await syncProjectMRs(deps("ks2"), "ks2", { ...base, fetchKnownSections: async () => { throw new Error("500"); } });
    const rec = store.read("ks2")!;
    expect(rec.scope!.knownSections).toEqual(["Acme"]);
    expect(Object.keys(rec.mrs)).toEqual(["1"]);
  });

  test("deep stores [] as knownSections when the project has no CODEOWNERS file", async () => {
    const store = tmpStore();
    store.registerDemand("ks3", "board:1", ["ada"], 1, ["Acme"]);
    await syncProjectMRs(deps("ks3"), "ks3", {
      store, selfUsername: "self", windowDays: 30, mode: "deep",
      fetchAuthors: async () => ({ projectPath: "g/p", prs: [] }),
      fetchRules: async () => ({ projectPath: "g/p", rules: [] }),
      fetchKnownSections: async () => null,
    });
    expect(store.read("ks3")!.scope!.knownSections).toEqual([]);
  });

  test("containment: a demand without sections never fetches knownSections", async () => {
    const store = tmpStore();
    store.registerDemand("ks4", "board:1", ["ada"], 1);
    await syncProjectMRs(deps("ks4"), "ks4", {
      store, selfUsername: "self", windowDays: 30, mode: "deep",
      fetchAuthors: async () => ({ projectPath: "g/p", prs: [] }),
      fetchKnownSections: async () => { throw new Error("must not fetch"); },
    });
    expect(store.read("ks4")!.scope!.knownSections).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts -t "knownSections"`
Expected: the first three FAIL (`knownSections` undefined); the containment test passes already. Four tests matched.

- [ ] **Step 3: Write the implementation**

In `ProjectSyncOverrides`, after `fetchRules`:

```ts
  /** Default-branch CODEOWNERS section headers; null when the project has none. Deep and backfillSections only. */
  fetchKnownSections?: (repoName: string) => Promise<string[] | null>;
```

Module-level, after `sameSections`:

```ts
/**
 * The live section list, or the previous one when the fetch fails: a flaky
 * read must never clear a stored value, or a board would alarm on a section
 * that still exists. `null` (no CODEOWNERS file) stores as [].
 */
async function readKnownSections(
  fetch: (repoName: string) => Promise<string[] | null>,
  repoName: string,
  previous: string[] | undefined,
): Promise<string[] | undefined> {
  try {
    return (await fetch(repoName)) ?? [];
  } catch (err) {
    log.warn({ err, repo: repoName }, "codeowner sections fetch failed");
    return previous;
  }
}
```

In `syncImpl`, directly after the `fetchRules` default (the block ending `return { projectPath, rules };\n  });`):

```ts
  const fetchKnownSections = overrides.fetchKnownSections ?? (async (repo: string) => {
    const { provider, projectPath } = await getRepoContext(repo, deps.repoIndex()[repo]);
    return provider.fetchCodeownerSections({ projectPath });
  });
```

In the scoped deep block, after `const hasStaleTags = ...;` add:

```ts
        let knownSections = record?.scope?.knownSections;
```

Inside `if (sections.length > 0) {`, directly after `const { rules } = await fetchRules(repoName, { updatedAfter });` add:

```ts
          knownSections = await readKnownSections(fetchKnownSections, repoName, knownSections);
```

Replace the scoped deep's `setScope` call:

```ts
        store.setScope(repoName, {
          authors: scopeAuthors,
          ...(sections.length > 0 ? { sections } : {}),
          windowDays,
          ...(knownSections ? { knownSections } : {}),
        });
```

- [ ] **Step 4: Run the sync suite**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts`
Expected: PASS, four new tests included, no existing test changed.

- [ ] **Step 5: Commit**

```bash
git add lib/daemon/project-sync.ts lib/daemon/__tests__/project-sync.test.ts
git commit -m "project-sync: deep records the CODEOWNERS headers as knownSections"
```

### Task 7: `backfillSections` records `knownSections`

**Files:**
- Modify: `lib/daemon/project-sync.ts` (`backfillSections`: the defaults after `fetchSingle`, and the `setScope` at the end near line 558)
- Test: `lib/daemon/__tests__/project-sync.test.ts` (inside `describe("backfillSections (finding 4)")`, after the `unions sections into an existing scope, sorted` test)

**Interfaces:**
- Consumes: `readKnownSections` and `ProjectSyncOverrides.fetchKnownSections` from Task 6.

- [ ] **Step 1: Write the failing tests**

```ts
    test("records knownSections from the CODEOWNERS fetch", async () => {
      const store = tmpStore();
      store.fullSync("bs6", "g/p", [], Date.now() - 1000);
      store.setScope("bs6", { authors: ["alice"], windowDays: 30 });
      await backfillSections(
        { repoIndex: () => ({ bs6: "/tmp/repo" }), broadcast: () => {} },
        "bs6", ["Acme"],
        {
          store, windowDays: 30,
          fetchRules: async () => ({ projectPath: "g/p", rules: [] }),
          fetchKnownSections: async () => ["Acme", "Beta"],
        },
      );
      expect(store.read("bs6")!.scope).toEqual({ authors: ["alice"], sections: ["Acme"], windowDays: 30, knownSections: ["Acme", "Beta"] });
    });

    test("a failed CODEOWNERS fetch keeps the stored knownSections and still unions sections", async () => {
      const store = tmpStore();
      store.fullSync("bs7", "g/p", [], Date.now() - 1000);
      store.setScope("bs7", { authors: ["alice"], sections: ["Beta"], windowDays: 30, knownSections: ["Old"] });
      await backfillSections(
        { repoIndex: () => ({ bs7: "/tmp/repo" }), broadcast: () => {} },
        "bs7", ["Acme"],
        {
          store, windowDays: 30,
          fetchRules: async () => ({ projectPath: "g/p", rules: [] }),
          fetchKnownSections: async () => { throw new Error("500"); },
        },
      );
      expect(store.read("bs7")!.scope).toEqual({ authors: ["alice"], sections: ["Acme", "Beta"], windowDays: 30, knownSections: ["Old"] });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts -t "CODEOWNERS fetch"`
Expected: both FAIL on `knownSections`.

- [ ] **Step 3: Write the implementation**

In `backfillSections`, after the `fetchSingle` default:

```ts
  const fetchKnownSections = overrides.fetchKnownSections ?? (async (repo: string) => {
    const { provider, projectPath } = await getRepoContext(repo, deps.repoIndex()[repo]);
    return provider.fetchCodeownerSections({ projectPath });
  });
```

Replace the two lines

```ts
  const scope = store.read(repoName)?.scope;
  if (scope) store.setScope(repoName, { ...scope, sections: [...union].sort() });
```

with

```ts
  const scope = store.read(repoName)?.scope;
  if (scope) {
    const knownSections = await readKnownSections(fetchKnownSections, repoName, scope.knownSections);
    store.setScope(repoName, { ...scope, sections: [...union].sort(), ...(knownSections ? { knownSections } : {}) });
  }
```

- [ ] **Step 4: `backfillAuthors` carries `knownSections` forward**

`backfillAuthors` also rebuilds the scope through `setScope` (near line 524). It already carries `sections` forward; add the same for `knownSections` so an author backfill never blanks the list:

```ts
  store.setScope(repoName, {
    authors: [...union].sort(),
    ...(record?.scope?.sections ? { sections: record.scope.sections } : {}),
    ...(record?.scope?.knownSections ? { knownSections: record.scope.knownSections } : {}),
    windowDays,
  });
```

Add this test directly after `backfillAuthors preserves an existing scope's sections (finding 1)`:

```ts
  test("backfillAuthors preserves an existing scope's knownSections", async () => {
    const store = tmpStore();
    store.fullSync("ba-ks", "g/p", [], Date.now() - 1000);
    store.setScope("ba-ks", { authors: ["alice"], sections: ["Acme"], windowDays: 30, knownSections: ["Acme", "Beta"] });
    await backfillAuthors(
      { repoIndex: () => ({ "ba-ks": "/tmp/repo" }), broadcast: () => {} },
      "ba-ks", ["bob"],
      { store, windowDays: 30, fetchAuthors: async () => ({ projectPath: "g/p", prs: [] }) },
    );
    expect(store.read("ba-ks")!.scope).toEqual({ authors: ["alice", "bob"], sections: ["Acme"], windowDays: 30, knownSections: ["Acme", "Beta"] });
  });
```

- [ ] **Step 5: Run the sync suite and the type check**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts && bun run check-types`
Expected: PASS. The existing `with no existing scope leaves scope unset` test still passes because the fetch sits inside the `if (scope)` guard. If the repo's type-check script has a different name, use the one `package.json` defines for `tsc`.

- [ ] **Step 6: Commit**

```bash
git add lib/daemon/project-sync.ts lib/daemon/__tests__/project-sync.test.ts
git commit -m "project-sync: backfillSections refreshes knownSections, backfillAuthors keeps it"
```

### Task 8: rt-client 0.11.1 and the rt PR

**Files:**
- Modify: `packages/rt-client/src/commands.ts:20-28` (`ProjectMRsScope`)
- Modify: `packages/rt-client/package.json:3` (`"version": "0.11.0"` to `"0.11.1"`)
- Modify: `packages/rt-client/dist/**` (by `bun run build`; gitignored)

**Interfaces:**
- Produces: `ProjectMRsScope.knownSections?: string[]`, which board Task 9 reads from `res.data.scope`.

- [ ] **Step 1: Add the field**

In `ProjectMRsScope`, after `uncoveredSections?: string[];`:

```ts
  /** Section headers in the default-branch CODEOWNERS at the last deep or
      backfill. `[]` when the project has none. Absent from a pre-knownSections
      daemon or before the first sweep that demanded a section. */
  knownSections?: string[];
```

The `project-mrs:read` handler already spreads `record.scope` into its response, so nothing else changes on the wire.

- [ ] **Step 2: Bump and rebuild**

Change `"version": "0.11.0"` to `"version": "0.11.1"` in `packages/rt-client/package.json`, then:

Run: `cd packages/rt-client && bun run build && cd ../..`
Expected: exits 0; `dist/index.d.ts` now contains `knownSections`.

- [ ] **Step 3: Verify the wire end to end and the client package**

Run: `bun test lib/daemon/__tests__/project-sync.test.ts packages/rt-client`
Expected: PASS. The `project-mrs:read` handler tests live in `project-sync.test.ts` (the `read returns entry tags and scope sections` test near line 429 exercises the spread), and `packages/rt-client/test/dist-freshness.test.ts` confirms `dist/` matches the source you just built.

- [ ] **Step 4: Commit and open the PR**

```bash
git add packages/rt-client/src/commands.ts packages/rt-client/package.json
git commit -m "rt-client 0.11.1: knownSections on the project-mrs scope"
git push -u origin codeowner-known-sections
gh pr create --title "daemon: report the CODEOWNERS section headers as knownSections" --body "$(cat <<'EOF'
## knownSections on the project scope

After a CODEOWNERS section rename, a board's exact-name tab matches nothing and looks like an empty queue. The daemon now records the default-branch header list beside its scope so a consumer can tell a wrong name from an empty queue.

### What changed

**Sync** (`lib/daemon/project-sync.ts`)

- deep and `backfillSections` fetch the headers through the new `fetchKnownSections` seam
- a failed fetch keeps the previous value, never clears it

**Store and wire**

- `ProjectScope.knownSections` rides the scope JSON, no migration
- rt-client 0.11.1 types the optional field; the read handler already spreads scope

**Also**

- glance `^0.22.0` for `fetchCodeownerSections`

---

**Checklist**

- [x] Appropriate tests have been created or updated
  - 7 new tests across `project-sync.test.ts` and `project-mrs-store.test.ts`; daemon and rt-client suites green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Gate: report to Matt**

Stop here. After merge and green CI, Matt publishes from a `main` checkout: `cd packages/rt-client && npm publish` (prepack rebuilds `dist/`; OTP prompt), then restarts the daemon with `rt daemon restart`. Phase C starts once `npm view @mattstack/rt-client version` prints `0.11.1`.

---

## Phase C: board

Repo: this worktree (`codeowner-section-alarm`). Run unit tests with `bun test`, the type check with `bun run typecheck`, the purity sweep with `sh scripts/repo-purity.sh`.

### Task 9: carry `scopeKnownSections` from the daemon to the client

**Files:**
- Modify: `package.json:23` (`"@mattstack/rt-client": "^0.11.0"` to `"^0.11.1"`), `bun.lock`
- Modify: `src/data.ts:50-60` (`Snapshot`), `:229-232` (`SyncScopeRead`), `:243-258` (`aggregateSyncScope`)
- Modify: `src/cache.ts:116-123` (the empty-snapshot literal)
- Modify: `src/server.ts:178-185` (`TeamMRsResult`), `:297-300` (the cache fetch), `:598-601` (the `/data.json` body)
- Modify: `src/client/types.ts:66-70` (`BoardData`)
- Modify: `tests/fixture/data.json` (new key)
- Test: `src/__tests__/board.test.ts:505-545` and its `fetchResult` helper at `:546-548`; `src/__tests__/cache.test.ts:6`

**Interfaces:**
- Consumes: `ProjectMRsScope.knownSections` (Task 8).
- Produces: `aggregateSyncScope(...)` returns `scopeKnownSections: string[] | null`; `Snapshot.scopeKnownSections`, `BoardData.scopeKnownSections: string[] | null` (same name everywhere). Tasks 12 and 13 read `data.scopeKnownSections`.

- [ ] **Step 1: Bump and install**

Change the dependency to `"@mattstack/rt-client": "^0.11.1"`, run `bun install`, and confirm `grep -c knownSections node_modules/@mattstack/rt-client/dist/index.d.ts` prints a number greater than 0.

- [ ] **Step 2: Write the failing tests**

In `src/__tests__/board.test.ts`, inside `describe("aggregateSyncScope")`, change the `no reads yields ...` expectation to include the new field:

```ts
    expect(aggregateSyncScope([])).toEqual({
      dataSyncedAt: null,
      scopeUncovered: [],
      scopeWindowDays: null,
      scopeUncoveredSections: [],
      scopeKnownSections: null,
    });
```

and add:

```ts
  test("scopeKnownSections is null until a read carries the field, then the sorted union", () => {
    expect(aggregateSyncScope([{ syncedAt: 1, scope: { authors: [], windowDays: 30, uncovered: [] } }]).scopeKnownSections).toBeNull();
    const agg = aggregateSyncScope([
      { syncedAt: 1, scope: { authors: [], windowDays: 30, uncovered: [], knownSections: ["Zeta", "Acme"] } },
      { syncedAt: 2, scope: { authors: [], windowDays: 30, uncovered: [], knownSections: ["Acme"] } },
      { syncedAt: 3 },
    ]);
    expect(agg.scopeKnownSections).toEqual(["Acme", "Zeta"]);
  });

  test("an empty knownSections list is an answer, not null", () => {
    const agg = aggregateSyncScope([{ syncedAt: 1, scope: { authors: [], windowDays: 30, uncovered: [], knownSections: [] } }]);
    expect(agg.scopeKnownSections).toEqual([]);
  });
```

Update the two `FetchResult` helpers so the type still checks:

`src/__tests__/board.test.ts`:
```ts
function fetchResult(mrs: unknown[]): FetchResult {
  return { mrs: mrs as BoardMR[], dataSyncedAt: null, scopeUncovered: [], scopeWindowDays: null, scopeUncoveredSections: [], scopeKnownSections: null };
}
```

`src/__tests__/cache.test.ts:6`:
```ts
  return { mrs: mrs as FetchResult["mrs"], dataSyncedAt: null, scopeUncovered: [], scopeWindowDays: null, scopeUncoveredSections: [], scopeKnownSections: null };
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/__tests__/board.test.ts -t "aggregateSyncScope"`
Expected: the three touched tests FAIL (`scopeKnownSections` missing or undefined).

- [ ] **Step 4: Write the implementation**

`src/data.ts`, in `Snapshot` after `scopeUncoveredSections: string[];`:

```ts
  /** Union of `scope.knownSections` across the daemon reads: the section
      headers in each project's default-branch CODEOWNERS. Null when no read
      carried the field (an older rt), which disables the wrong-section alarm
      rather than raising it. */
  scopeKnownSections: string[] | null;
```

`SyncScopeRead`:

```ts
export interface SyncScopeRead {
  syncedAt: number;
  scope?: { authors: string[]; windowDays: number; uncovered: string[]; sections?: string[]; uncoveredSections?: string[]; knownSections?: string[] };
}
```

`aggregateSyncScope` (whole function; the doc comment above it gains one clause: `scopeKnownSections` unions every project's CODEOWNERS headers and is null when none reported them):

```ts
export function aggregateSyncScope(
  reads: SyncScopeRead[],
): { dataSyncedAt: number | null; scopeUncovered: string[]; scopeWindowDays: number | null; scopeUncoveredSections: string[]; scopeKnownSections: string[] | null } {
  let dataSyncedAt: number | null = null;
  let scopeWindowDays: number | null = null;
  const uncovered = new Set<string>();
  const uncoveredSections = new Set<string>();
  let known: Set<string> | null = null;
  for (const read of reads) {
    dataSyncedAt = dataSyncedAt === null ? read.syncedAt : Math.min(dataSyncedAt, read.syncedAt);
    if (read.scope) {
      scopeWindowDays = scopeWindowDays === null ? read.scope.windowDays : Math.min(scopeWindowDays, read.scope.windowDays);
      for (const author of read.scope.uncovered) uncovered.add(author);
      for (const section of read.scope.uncoveredSections ?? []) uncoveredSections.add(section);
      if (read.scope.knownSections) {
        known ??= new Set<string>();
        for (const section of read.scope.knownSections) known.add(section);
      }
    }
  }
  return {
    dataSyncedAt,
    scopeUncovered: [...uncovered],
    scopeWindowDays,
    scopeUncoveredSections: [...uncoveredSections],
    scopeKnownSections: known ? [...known].sort() : null,
  };
}
```

`src/cache.ts`, in the empty-snapshot literal after `scopeUncoveredSections: [],`:

```ts
                scopeKnownSections: null,
```

`src/server.ts`:
- `TeamMRsResult` gains `scopeKnownSections: string[] | null;` after `scopeUncoveredSections: string[];`. `fetchTeamMRs` already returns `...aggregateSyncScope(reads)`, so the value arrives without a code change there.
- The cache fetch becomes:

```ts
  const { prs, dataSyncedAt, scopeUncovered, scopeWindowDays, scopeUncoveredSections, scopeKnownSections, tags } = await fetchTeamMRs(force);
  const mrs = buildBoard(prs, config, undefined, tags);
  await enrichReviewerComments(mrs);
  return { mrs, dataSyncedAt, scopeUncovered, scopeWindowDays, scopeUncoveredSections, scopeKnownSections };
```

- The `/data.json` body gains, after `scopeUncoveredSections: snapshot.scopeUncoveredSections,`:

```ts
            scopeKnownSections: snapshot.scopeKnownSections,
```

`src/client/types.ts`, in `BoardData` after `scopeUncoveredSections: string[];`:

```ts
  /** Section headers in the projects' default-branch CODEOWNERS, unioned; null
      when rt did not report them. Drives the wrong-section banner, chip and
      editor hints; null disables all three. */
  scopeKnownSections: string[] | null;
```

`tests/fixture/data.json`: add `"scopeKnownSections": null` after the `"scopeUncoveredSections": []` key (Task 14 replaces the value).

- [ ] **Step 5: Run the tests and the type check**

Run: `bun test && bun run typecheck && sh scripts/repo-purity.sh`
Expected: all PASS; typecheck exits 0 for all three projects; purity `ok`.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/data.ts src/cache.ts src/server.ts src/client/types.ts tests/fixture/data.json src/__tests__/board.test.ts src/__tests__/cache.test.ts
git commit -m "data: carry the daemon's knownSections to the client as scopeKnownSections"
```

### Task 10: `sectionStatus` helper

**Files:**
- Create: `src/sections.ts`
- Test: `src/__tests__/sections.test.ts`

**Interfaces:**
- Produces: `sectionStatus(section: string, known: string[] | null): { unknown: boolean; suggestion: string | null }`. Tasks 12 and 13 import it from `../../sections.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { sectionStatus } from "../sections.ts";

describe("sectionStatus", () => {
  const known = ["Billing - #pod-billing", "Acme - #pod-acme", "Platform QA"];

  test("an exact match is known", () => {
    expect(sectionStatus("Platform QA", known)).toEqual({ unknown: false, suggestion: null });
  });

  test("null known never judges", () => {
    expect(sectionStatus("Anything", null)).toEqual({ unknown: false, suggestion: null });
  });

  test("a renamed section suggests the entry that starts with the old name, ignoring case", () => {
    expect(sectionStatus("acme", known)).toEqual({ unknown: true, suggestion: "Acme - #pod-acme" });
  });

  test("falls back to an entry that contains the name", () => {
    expect(sectionStatus("QA", known)).toEqual({ unknown: true, suggestion: "Platform QA" });
  });

  test("no resemblance yields no suggestion", () => {
    expect(sectionStatus("Fraud", known)).toEqual({ unknown: true, suggestion: null });
  });

  test("an empty known list marks every section unknown without a suggestion", () => {
    expect(sectionStatus("Fraud", [])).toEqual({ unknown: true, suggestion: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/__tests__/sections.test.ts`
Expected: FAIL, cannot resolve `../sections.ts`.

- [ ] **Step 3: Write the implementation**

`src/sections.ts`:

```ts
/**
 * Whether a configured codeowners section exists in the project's CODEOWNERS,
 * and the closest existing name when it does not. `known` null means rt could
 * not say (older daemon, or no sweep yet): never unknown, never a suggestion,
 * so the board shows nothing it cannot stand behind. The prefix pass comes
 * first because the rename this guards against appends to the old name.
 */
export function sectionStatus(section: string, known: string[] | null): { unknown: boolean; suggestion: string | null } {
  if (known === null || known.includes(section)) return { unknown: false, suggestion: null };
  const needle = section.toLowerCase();
  const suggestion =
    known.find((k) => k.toLowerCase().startsWith(needle)) ??
    known.find((k) => k.toLowerCase().includes(needle)) ??
    null;
  return { unknown: true, suggestion };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/__tests__/sections.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sections.ts src/__tests__/sections.test.ts
git commit -m "add src/sections.ts: sectionStatus with a did-you-mean suggestion"
```

### Task 11: tab-strip chip

**Files:**
- Modify: `src/client/board/TabBar.tsx` (whole component)

**Interfaces:**
- Produces: `TabBar` prop `unknown: string[]` (tab ids). Task 12 passes it.

This repo has no React render tests; components are verified by `bun run typecheck` and the capture baselines in Task 14.

- [ ] **Step 1: Write the component**

Replace the file's contents with:

```tsx
import { Fragment } from "react";
import { Chip } from "@mattstack/tui-kit";
import type { TabConfig } from "../../config.ts";

/** Board tabs, rendered as a strip above the content they scope rather than as
    another control in the header row. Renders nothing for a single tab, so a
    board with no tabs configured looks exactly as it did before tabs existed. */
export function TabBar({
  tabs,
  active,
  onPick,
  syncing,
  unknown,
}: {
  tabs: TabConfig[];
  active: string;
  onPick: (tab: string) => void;
  /** The active codeowners tab's section is still mid-backfill. */
  syncing: boolean;
  /** Ids of codeowners tabs whose section is not in the project's CODEOWNERS.
      Marked on every tab, active or not: the alarm must be visible from
      wherever the reader is. */
  unknown: string[];
}) {
  if (tabs.length < 2) return null;
  return (
    <div className="tui-tabs" role="tablist" aria-label="board tabs">
      {tabs.map((tab) => (
        <Fragment key={tab.id}>
          <button
            role="tab"
            type="button"
            aria-selected={tab.id === active}
            className={`tui-tab${tab.id === active ? " active" : ""}`}
            onClick={() => onPick(tab.id)}
          >
            {tab.label}
          </button>
          {unknown.includes(tab.id) && (
            <Chip intent="bad" data-flag="" title="this tab's section is not in the project's CODEOWNERS">
              no such section
            </Chip>
          )}
        </Fragment>
      ))}
      {syncing && !unknown.includes(active) && (
        <Chip intent="warn" data-flag="" title="rt hasn't finished backfilling this codeowner section... counts may be low">
          syncing
        </Chip>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bun run typecheck`
Expected: exactly one error, in `src/client/board/Board.tsx`: `TabBar` is missing the required `unknown` prop. Task 12 supplies it. No other errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/board/TabBar.tsx
git commit -m "TabBar: no-such-section chip beside a tab whose section is unknown"
```

### Task 12: banner and wiring in Board.tsx

**Files:**
- Modify: `src/client/board/Board.tsx:30` (imports), `:441-442` (`tabSyncing`), `:579-584` (`TabBar`), `:606-612` (banners and empty state), `:687-696` (`ConfigModal` props)
- Modify: `src/style.css:339-343` (after `.tui-banner`)

**Interfaces:**
- Consumes: `sectionStatus` (Task 10), `TabBar.unknown` (Task 11), `data.scopeKnownSections` (Task 9).
- Produces: passes `knownSections={data.scopeKnownSections}` to `ConfigModal`; Task 13 adds that prop, so this task's type check ends with exactly one expected error until then.

- [ ] **Step 1: Import the helper**

Next to the other relative imports at the top of `Board.tsx` (after the `ConfigModal` import on line 30):

```ts
import { sectionStatus } from "../../sections.ts";
```

- [ ] **Step 2: Compute the statuses**

Replace

```ts
  const tabSyncing =
    activeTab.source.kind === "codeowners" && data.scopeUncoveredSections.includes(activeTab.source.section);
```

with

```ts
  const activeSection =
    activeTab.source.kind === "codeowners" ? sectionStatus(activeTab.source.section, data.scopeKnownSections) : null;
  const unknownTabs = data.tabs.flatMap((t) =>
    t.source.kind === "codeowners" && sectionStatus(t.source.section, data.scopeKnownSections).unknown ? [t.id] : [],
  );
  // A wrong name is not "still syncing": the unknown state owns the tab.
  const tabSyncing =
    activeTab.source.kind === "codeowners" &&
    !activeSection?.unknown &&
    data.scopeUncoveredSections.includes(activeTab.source.section);
```

- [ ] **Step 3: Pass the ids to the strip**

In the `<TabBar ... />` element add `unknown={unknownTabs}` after `syncing={tabSyncing}`.

- [ ] **Step 4: Render the banner and gate the empty state**

Leave the two existing banner lines (`data.fetchError` and `windowMismatch`) exactly as they are. Between the `windowMismatch` banner line and the blank line before the `filtered.length === 0` ternary, insert:

```tsx
        {activeTab.source.kind === "codeowners" && activeSection?.unknown && (
          <div className="tui-banner" data-intent="bad" role="alert">
            ⚠ no CODEOWNERS section "{activeTab.source.section}"
            {activeSection.suggestion && <> · did you mean "{activeSection.suggestion}"?</>}
            <button type="button" className="tui-banner-btn" onClick={openConfig}>
              fix in settings
            </button>
          </div>
        )}
```

Then change the ternary's condition from

```tsx
        {filtered.length === 0 && !data.fetchError ? (
```

to

```tsx
        {filtered.length === 0 && !data.fetchError && !activeSection?.unknown ? (
```

With an unknown section there are no rows, so the ternary's other branch renders an empty group list and the banner stands alone.

- [ ] **Step 5: Pass the known set to the settings modal**

In the `<ConfigModal ... />` element add `knownSections={data.scopeKnownSections}` after `tabs={data.tabs}`.

- [ ] **Step 6: Style the bad banner**

In `src/style.css`, directly after the `.tui-banner { ... }` rule:

```css
.tui-banner[data-intent="bad"] {
  color: var(--red); border-color: color-mix(in srgb, var(--red) 45%, transparent);
  background: color-mix(in srgb, var(--red) 7%, transparent);
}
.tui-banner-btn {
  margin-left: 0.6rem; font: inherit; color: inherit; background: transparent;
  border: 1px solid currentColor; border-radius: 4px; padding: 0.1rem 0.5rem; cursor: pointer;
}
.tui-banner-btn:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
```

- [ ] **Step 7: Type-check**

Run: `bun run typecheck`
Expected: exactly one error, in `Board.tsx` at the `<ConfigModal` element: `knownSections` is not a known prop. Task 13 adds it. Nothing else.

- [ ] **Step 8: Commit**

```bash
git add src/client/board/Board.tsx src/style.css
git commit -m "Board: wrong-section banner replaces the empty state on a codeowners tab"
```

### Task 13: tab editor suggestions and hint

**Files:**
- Modify: `src/client/board/ConfigModal.tsx`: the `react` import line; `TextField` (`:69-109`); `TabsControl` signature (`:546-555`), the existing-tab section field (`:694-716`), the new-tab section input (`:803-811`), `ROW_HINTS` (`:832-836`); `SettingRow` signature (`:875-891`) and its `TabsControl` render (`:910-921`); `ConfigModal` signature (`:1061-1074`) and its `SettingRow` render (`:1107-1116`)

**Interfaces:**
- Consumes: `sectionStatus` (Task 10); `ConfigModal` prop `knownSections: string[] | null` (passed by Task 12).

- [ ] **Step 1: Imports**

Add `useId` to the `react` import (the line that already imports `useState` and `useEffect`), and add:

```ts
import { sectionStatus } from "../../sections.ts";
```

- [ ] **Step 2: Let `TextField` carry a datalist id**

Add an optional `list?: string;` prop (doc: `/** A datalist id for native suggestions. */`) to `TextField`'s props and forward it: `list={list}` on the `<input>`.

- [ ] **Step 3: Thread `knownSections` down**

`ConfigModal` props: add

```ts
  /** Section headers rt saw in the projects' CODEOWNERS; null when rt did not report them. */
  knownSections: string[] | null;
```

and pass `knownSections={knownSections}` to each `<SettingRow>`. `SettingRow` props: add `knownSections: string[] | null;` and pass `knownSections={knownSections}` to `<TabsControl>`. `TabsControl` props: add

```ts
  /** Drives the section field's suggestions and the not-in-CODEOWNERS hint. */
  knownSections: string[] | null;
```

- [ ] **Step 4: One datalist per editor, both section fields use it**

At the top of `TabsControl`'s body (after the `useState` lines):

```ts
  const sectionListId = useId();
```

In the JSX, immediately inside the control's root element (before the tab rows), render:

```tsx
      <datalist id={sectionListId}>
        {(knownSections ?? []).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
```

Pass `list={sectionListId}` to the existing tab's section `<TextField>` and add `list={sectionListId}` to the new-tab `<input>`.

- [ ] **Step 5: The hint under an unknown section**

Add a small component above `TabsControl`:

```tsx
/** Under a tab's section field: the section is not a CODEOWNERS header, and
    the closest one that is. Renders nothing while rt cannot say. */
function SectionHint({ section, known }: { section: string; known: string[] | null }) {
  const status = sectionStatus(section, known);
  if (!status.unknown) return null;
  return (
    <p className="tui-modal-error">
      not in CODEOWNERS{status.suggestion ? ` · did you mean "${status.suggestion}"?` : ""}
    </p>
  );
}
```

Directly after the existing tab's section `<label className="tui-tabs-field">...</label>` (inside the `tab.source.kind === "codeowners" && (<>...</>)` fragment), add:

```tsx
                  <SectionHint section={tab.source.section} known={knownSections} />
```

- [ ] **Step 6: Help copy**

Change the `"board.tabs"` entry of `ROW_HINTS` to:

```ts
  "board.tabs":
    'A new section\'s MRs land once rt has backfilled it; the tab shows "syncing" until then. A section must match a CODEOWNERS header exactly; the field suggests the headers rt has seen.',
```

- [ ] **Step 7: Type-check and the client tests**

Run: `bun run typecheck && bun test src/client/__tests__ && sh scripts/repo-purity.sh`
Expected: typecheck exits 0 with no errors anywhere; client tests PASS; purity `ok`.

- [ ] **Step 8: Commit**

```bash
git add src/client/board/ConfigModal.tsx
git commit -m "ConfigModal: CODEOWNERS section suggestions and a not-in-CODEOWNERS hint"
```

### Task 14: fixture, capture state, baselines

**Files:**
- Modify: `tests/fixture/data.json` (`tabs`, `scopeKnownSections`)
- Modify: `tests/capture.ts` (after the settings-modal shot, before the selection bar)
- Modify: `tests/fixture/README.md` (the states sentence in "Editing it")
- Regenerate: `tests/baselines/*.png`

- [ ] **Step 1: Give the fixture an unknown section**

In `tests/fixture/data.json` set

```json
  "tabs": [
    { "id": "team", "label": "Team", "source": { "kind": "authors" } },
    { "id": "acme-queue", "label": "Acme Queue", "source": { "kind": "codeowners", "section": "Acme", "excludeMembers": true } }
  ],
  "scopeKnownSections": ["Acme - #pod-acme", "Docs"]
```

No fixture MR carries a `codeownerSections` tag, so the new tab is empty and its section is absent from the known set: the banner, the chip and the editor hint all render.

- [ ] **Step 2: Shoot the state**

In `tests/capture.ts`, after the `await shoot(page, \`settings-${theme}\`); await page.keyboard.press("Escape");` pair and before the `// selection bar` comment, add:

```ts
  // codeowners tab whose section is not a CODEOWNERS header: the alarm
  await page.click('[role="tab"]:has-text("Acme Queue")');
  await page.waitForSelector('.tui-banner[data-intent="bad"]');
  await shoot(page, `badsection-${theme}`);
  await page.click('[role="tab"]:has-text("Team")');
  await page.waitForSelector(".tui-row, .tui-card");
```

- [ ] **Step 3: Document the state**

In `tests/fixture/README.md`, in the "Editing it" paragraph that lists the states, append the sentence: `The second tab, "Acme Queue", names a section absent from scopeKnownSections so the wrong-section banner and chip render.`

- [ ] **Step 4: Regenerate the baselines and compare**

Run: `bun run capture:baseline && bun run capture:compare && sh scripts/repo-purity.sh`
Expected: `capture:baseline` writes every state including `badsection-light.png` and `badsection-dark.png`; `capture:compare` reports zero diffs; purity `ok`. Open `tests/baselines/badsection-light.png` and confirm the banner reads `⚠ no CODEOWNERS section "Acme" · did you mean "Acme - #pod-acme"?` with the `fix in settings` button, and the strip shows `no such section` beside `Acme Queue`. The existing states now carry the two-tab strip; that is the expected visual change.

- [ ] **Step 5: Commit**

```bash
git add tests/fixture/data.json tests/capture.ts tests/fixture/README.md tests/baselines
git commit -m "capture: badsection state, fixture gains an unknown codeowners section"
```

### Task 15: verification and the board PR

- [ ] **Step 1: Full verification**

Run: `bun test && bun run typecheck && bun run capture:compare && sh scripts/repo-purity.sh`
Expected: everything green.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin codeowner-section-alarm
gh pr create --title "Codeowner section alarm" --body "$(cat <<'EOF'
## Say so when a codeowners tab's section no longer exists

A CODEOWNERS section rename left a codeowners tab matching nothing and showing "nothing waiting on review". The daemon now reports the default-branch headers; the board alarms on a configured section that is not one of them.

### What changed

**Data** (`src/data.ts`, `src/server.ts`)

- `scopeKnownSections`: union of rt's `knownSections` across projects, null on an older daemon

**Client**

- banner replaces the empty state on the tab, with a did-you-mean suggestion and a `fix in settings` button
- `no such section` chip beside the tab in the strip
- tab editor: datalist of known headers and a hint under an unknown value

**Also**

- rt-client `^0.11.1`
- new capture state `badsection`; baselines regenerated for the two-tab strip

Spec: `docs/superpowers/specs/2026-09-02-codeowner-section-alarm-design.md`

---

**Checklist**

- [x] Appropriate tests have been created or updated
  - 9 new tests across `board.test.ts` and `sections.test.ts`; suite, typecheck and capture compare green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Gate: report to Matt**

Stop here. Matt waits for CodeRabbit and CI, merges with confirmation, then deploys with `bun run build && deck restart board` from the main checkout, and opens the board to confirm the two codeowners surfaces render against the live daemon.
