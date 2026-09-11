# Boxscore Issues-Done Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Issues done" count a Linear ticket only when its implementing MR (Linear gitlab attachment, or closing-grade text reference) merges, anchored to that merge date, and ungate "MRs merged" from team-ticket references.

**Architecture:** The Linear verify query gains `attachments`; the fetch layer grades every issue-MR link (attachment > closing > mention), computes `closedAt` (latest qualifying merge) and `creditedUser` (earliest-merged roster author), and the store preserves those when links age out. The cohort layer windows issues on `closedAt` instead of linked-MR `updatedAt`, and `authoredMerged` drops its `hasTeamTicket` gate.

**Tech Stack:** Bun + TypeScript, vitest (`bun --bun vitest run`), bun:sqlite store. All commands below run from `apps/boxscore/` inside the worktree.

**Spec:** `docs/superpowers/specs/2026-09-10-boxscore-issues-done-redesign.md`

## Global Constraints

- Never use em dashes or en dashes in any text, comment, or description.
- Comments only state constraints code cannot show (repo rule: clean-code comments); no decision-history or reviewer-facing comments.
- Full gates: `bun run typecheck && bun run test && bun run lint` must pass at every commit; a task may not leave the suite red.
- Closing keywords: `close/closes/closed/closing`, `fix/fixes/fixed/fixing`, `resolve/resolves/resolved/resolving`, `implement/implements/implemented/implementing`; keyword and identifier at most 40 non-newline chars apart.
- Identifier matching must not prefix-match (CV-302 must not match CV-3027); branch form accepts `cv-123` and `cv_123`; title/description form accepts `CV-123` and `CV:123`, case-insensitive.
- Revert MRs (`isRevertTitle` from `src/shared/reverts.ts`) never earn closing grade.
- Verify-query chunk size is 25 (attachments raise per-issue query cost; the spike ran 20 without a failure, 100 risks complexity limits).

---

### Task 1: Text reference classifier

**Files:**
- Modify: `src/server/linear/ticket.ts`
- Test: `test/ticket-grade.test.ts` (create)

**Interfaces:**
- Consumes: `isRevertTitle` from `../../shared/reverts.js`; `NormMr` from `../store/model.js`.
- Produces: `textRefGrade(mr: Pick<NormMr, 'title' | 'sourceBranch' | 'description'>, identifier: string): 'closing' | 'mention' | null`. Task 4 calls this for every (source MR, identifier) pair.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/ticket-grade.test.ts
import { describe, expect, it } from 'vitest';

import { textRefGrade } from '../src/server/linear/ticket.js';

const base = { title: 'Refactor widgets', sourceBranch: 'refactor-widgets', description: null as string | null };

describe('textRefGrade', () => {
  it('grades a title reference closing', () => {
    expect(textRefGrade({ ...base, title: 'CV-3027: delete v1 components' }, 'CV-3027')).toBe('closing');
  });

  it('grades a branch reference closing, in dash and underscore forms', () => {
    expect(textRefGrade({ ...base, sourceBranch: 'cv-3027-delete-v1' }, 'CV-3027')).toBe('closing');
    expect(textRefGrade({ ...base, sourceBranch: 'cv_3027_delete_v1' }, 'CV-3027')).toBe('closing');
  });

  it('grades a closing keyword in the description closing, through markdown links', () => {
    const description = 'Closes [CV-2994](https://linear.app/acme/issue/CV-2994/foo).';
    expect(textRefGrade({ ...base, description }, 'CV-2994')).toBe('closing');
  });

  it('grades a bare description mention as mention', () => {
    expect(textRefGrade({ ...base, description: 'context from CV-28 applies here' }, 'CV-28')).toBe('mention');
  });

  it('keeps a keyword too far from the identifier at mention grade', () => {
    const description = `Fixes the flaky loader. ${'x'.repeat(40)} CV-28 is related.`;
    expect(textRefGrade({ ...base, description }, 'CV-28')).toBe('mention');
  });

  it('does not prefix-match identifiers', () => {
    expect(textRefGrade({ ...base, title: 'CV-3027: thing' }, 'CV-302')).toBeNull();
  });

  it('returns null when the identifier appears nowhere', () => {
    expect(textRefGrade(base, 'CV-1')).toBeNull();
  });

  it('caps revert MRs at mention grade even with a title reference', () => {
    expect(textRefGrade({ ...base, title: 'Revert "CV-3027: delete v1 components"' }, 'CV-3027')).toBe('mention');
  });

  it('accepts the colon identifier form', () => {
    expect(textRefGrade({ ...base, description: 'fixes CV:28' }, 'CV-28')).toBe('closing');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run test/ticket-grade.test.ts`
Expected: FAIL, `textRefGrade` is not exported.

- [ ] **Step 3: Implement**

Append to `src/server/linear/ticket.ts` (keep the existing exports untouched):

```typescript
import { isRevertTitle } from '../../shared/reverts.js';

const CLOSING_KEYWORD =
  'clos(?:e|es|ed|ing)|fix(?:es|ed|ing)?|resolv(?:e|es|ed|ing)|implement(?:s|ed|ing)?';

export type TextRefGrade = 'closing' | 'mention';

/**
 * Grade one MR's textual reference to a Linear identifier. Reverts cap at
 * "mention": their titles quote the original MR, so a title hit proves
 * nothing about implementing the ticket.
 */
export function textRefGrade(
  mr: Pick<NormMr, 'title' | 'sourceBranch' | 'description'>,
  identifier: string
): TextRefGrade | null {
  const [team, num] = identifier.split('-');
  if (!team || !num) return null;
  const t = escapeRegex(team);
  const idRe = new RegExp(`\\b${t}[-:]${num}\\b`, 'i');
  const anywhere =
    idRe.test(mr.title) ||
    (mr.description !== null && idRe.test(mr.description)) ||
    (mr.sourceBranch !== null &&
      new RegExp(`\\b${t}[-_]${num}\\b`, 'i').test(mr.sourceBranch));
  if (!anywhere) return null;
  if (isRevertTitle(mr.title)) return 'mention';
  if (idRe.test(mr.title)) return 'closing';
  if (
    mr.sourceBranch !== null &&
    new RegExp(`\\b${t}[-_]${num}\\b`, 'i').test(mr.sourceBranch)
  ) {
    return 'closing';
  }
  if (
    mr.description !== null &&
    new RegExp(
      `\\b(?:${CLOSING_KEYWORD})\\b[^\\n]{0,40}?\\b${t}[-:]${num}\\b`,
      'i'
    ).test(mr.description)
  ) {
    return 'closing';
  }
  return 'mention';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun --bun vitest run test/ticket-grade.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Full gates, then commit**

Run: `bun run typecheck && bun run test && bun run lint`

```bash
git add src/server/linear/ticket.ts test/ticket-grade.test.ts
git commit -m "boxscore: add textRefGrade closing/mention classifier"
```

---

### Task 2: Model rename and new fields

**Files:**
- Modify: `src/server/store/model.ts` (NormLinearIssue), `src/server/store/index.ts` (StoredLinearIssue), `src/server/linear/raw-types.ts`, `src/server/linear/map.ts`, `src/server/metrics/cohorts.ts:217` (one-line rename), `src/server/metrics/evidence.ts` (rows read fields, rename only), `test/fixtures.ts`, and every test naming `assignedUser` (`test/linear-resolve.test.ts`, `test/linear.test.ts`, `test/query.test.ts`, `test/refresh.test.ts`, `test/store.test.ts`, `test/evidence.test.ts`).

**Interfaces:**
- Produces (later tasks depend on these exact shapes):

```typescript
// store/model.ts
export type LinkVia = 'attachment' | 'closing' | 'mention';
export interface LinkedMr {
  iid: number;
  projectPath: string;
  via: LinkVia;
}
export interface NormLinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  /** GitLab author of the earliest-merged qualifying MR; null when nothing qualifying merged. */
  creditedUser: string | null;
  linkedMrs: LinkedMr[];
  /** Latest mergedAt among qualifying merged MRs; null until one is visible. */
  closedAt: string | null;
  stateType: string | null;
  stateName: string | null;
}
```

```typescript
// linear/raw-types.ts — RawIssue gains:
attachments: { nodes: { url: string; sourceType: string | null }[] } | null;
```

```typescript
// linear/map.ts
export function mapIssue(
  raw: RawIssue,
  creditedUser: string | null,
  linkedMrs: LinkedMr[],
  closedAt: string | null
): NormLinearIssue;
```

- [ ] **Step 1: Apply the model change**

Rename `assignedUser` to `creditedUser`, add `closedAt` and the `via` field per the shapes above. `StoredLinearIssue` in `store/index.ts` mirrors `NormLinearIssue` field-for-field; make it `export type StoredLinearIssue = NormLinearIssue` is NOT the current pattern (it is a separate interface), so update the interface in place to the same fields. In `linear/fetch.ts`, at the `mapIssue` call site, pass `via: 'mention' as const` on each linked MR and `null` for `closedAt` for now (Task 4 replaces this). In `test/fixtures.ts`, extend the `li` builder:

```typescript
const li = (
  identifier: string,
  creditedUser: string | null,
  closedAt: string | null = '2026-05-15T00:00:00.000Z'
): NormLinearIssue => ({
  id: identifier,
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/acme/issue/${identifier}`,
  creditedUser,
  linkedMrs: [],
  closedAt,
  stateType: 'completed',
  stateName: 'Done',
});
```

(The default `closedAt` sits inside `WINDOW`, so cohort counts in existing tests survive Task 5.)

- [ ] **Step 2: Chase the rename through tests**

Mechanical `assignedUser` -> `creditedUser` in the listed test files; any object literal building a `NormLinearIssue`/`StoredLinearIssue` gains `closedAt: null` (or a date where the test's intent is a counted issue) and `via` on linked MRs.

- [ ] **Step 3: Full gates**

Run: `bun run typecheck && bun run test && bun run lint`
Expected: PASS. This task changes no behavior; the suite is the test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "boxscore: rename assignedUser to creditedUser, add closedAt and link via"
```

---

### Task 3: Store — sticky upsert, key lookup, all-rows read

**Files:**
- Modify: `src/server/store/index.ts`
- Test: `test/store.test.ts` (extend)

**Interfaces:**
- Produces:
  - `indexRowsByKeys(keys: readonly string[]): IndexRow[]` (Task 4 resolves attachment MR keys with it)
  - `allLinearIssues(): StoredLinearIssue[]` (Task 5's query layer reads it)
  - `upsertLinearIssues` sticky contract: an incoming row with `closedAt: null` never clears a stored row's non-null `closedAt`, `creditedUser`, or `linkedMrs`; an incoming row with non-null `closedAt` replaces all three.
- Removes: `linearIssuesForMrKeys` (its only caller, `store/query.ts`, is rewritten in Task 5; leave `query.ts` compiling by switching it to `allLinearIssues()` filtered the same way it filters today — Task 5 then deletes the filter).

- [ ] **Step 1: Write the failing tests**

Append to `test/store.test.ts` (reuse its existing store setup helpers):

```typescript
describe('linear issue stickiness', () => {
  const closed = (over: Partial<StoredLinearIssue> = {}): StoredLinearIssue => ({
    id: 'uuid-CV-1',
    identifier: 'CV-1',
    title: 'Ticket CV-1',
    url: 'https://linear.app/acme/issue/CV-1',
    creditedUser: 'alice',
    linkedMrs: [{ iid: 10, projectPath: 'org/app', via: 'attachment' }],
    closedAt: '2026-05-10T00:00:00.000Z',
    stateType: 'completed',
    stateName: 'Done',
    ...over,
  });

  it('an incoming null closedAt preserves the stored closure', () => {
    getStore().upsertLinearIssues([closed()]);
    getStore().upsertLinearIssues([
      closed({ creditedUser: null, linkedMrs: [], closedAt: null, stateName: 'Ready for Release' }),
    ]);
    const row = getStore().allLinearIssues().find(i => i.identifier === 'CV-1')!;
    expect(row.closedAt).toBe('2026-05-10T00:00:00.000Z');
    expect(row.creditedUser).toBe('alice');
    expect(row.linkedMrs).toEqual([{ iid: 10, projectPath: 'org/app', via: 'attachment' }]);
    expect(row.stateName).toBe('Ready for Release');
  });

  it('an incoming non-null closedAt replaces the stored closure', () => {
    getStore().upsertLinearIssues([closed()]);
    getStore().upsertLinearIssues([
      closed({ creditedUser: 'bob', closedAt: '2026-05-20T00:00:00.000Z' }),
    ]);
    const row = getStore().allLinearIssues().find(i => i.identifier === 'CV-1')!;
    expect(row.closedAt).toBe('2026-05-20T00:00:00.000Z');
    expect(row.creditedUser).toBe('bob');
  });
});

describe('indexRowsByKeys', () => {
  it('returns only the requested rows', () => {
    // Insert two index rows via the existing upsertIndexRows helper this file already uses,
    // with keys org/app:1 and org/app:2, then:
    const rows = getStore().indexRowsByKeys(['org/app:2']);
    expect(rows.map(r => r.iid)).toEqual([2]);
  });
});

describe('legacy row normalization', () => {
  it('reads pre-redesign rows with defaults for the new fields', () => {
    // Rows written before this change carry assignedUser, no closedAt, and
    // linkedMrs entries without via. Write one raw to prove reads normalize it.
    getStore().__rawInsertLinearIssue?.('CV-9', JSON.stringify({
      id: 'uuid-CV-9', identifier: 'CV-9', title: 'old', url: 'https://linear.app/acme/issue/CV-9',
      assignedUser: 'alice', linkedMrs: [{ iid: 7, projectPath: 'org/app' }],
      stateType: 'completed', stateName: 'Done',
    }));
    const row = getStore().allLinearIssues().find(i => i.identifier === 'CV-9')!;
    expect(row.closedAt).toBeNull();
    expect(row.creditedUser).toBe('alice');
    expect(row.linkedMrs).toEqual([{ iid: 7, projectPath: 'org/app', via: 'mention' }]);
  });
});
```

(`__rawInsertLinearIssue(identifier, json)` is a small test-only escape hatch to add
alongside the store's existing `clear()`-style helpers; it runs the raw INSERT so the
test can plant a legacy-shaped row without the typed upsert normalizing it first.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run test/store.test.ts`
Expected: FAIL (`allLinearIssues` / `indexRowsByKeys` missing; stickiness absent).

- [ ] **Step 3: Implement**

In `store/index.ts`:

```typescript
allLinearIssues(): StoredLinearIssue[] {
  const rows = stmtAllLinearIssues.all() as { data: string }[];
  // Rows written before the redesign carry assignedUser, no closedAt, and
  // linkedMrs without via; normalize on read so no caller sees the old shape.
  return rows.map(r => {
    const raw = JSON.parse(r.data) as StoredLinearIssue & {
      assignedUser?: string | null;
    };
    return {
      ...raw,
      creditedUser: raw.creditedUser ?? raw.assignedUser ?? null,
      closedAt: raw.closedAt ?? null,
      linkedMrs: (raw.linkedMrs ?? []).map(m => ({ ...m, via: m.via ?? 'mention' })),
    };
  });
},

indexRowsByKeys(keys: readonly string[]): IndexRow[] {
  // Follow metricsByKeys's existing chunked SELECT ... IN pattern verbatim.
},

upsertLinearIssues(rows: readonly StoredLinearIssue[]): void {
  const tx = db.transaction((batch: readonly StoredLinearIssue[]) => {
    for (const r of batch) {
      let toWrite = r;
      if (r.closedAt === null) {
        const existing = stmtGetLinearIssue.get(r.identifier) as { data: string } | null;
        if (existing) {
          const prev = JSON.parse(existing.data) as StoredLinearIssue;
          if (prev.closedAt !== null) {
            toWrite = { ...r, closedAt: prev.closedAt, creditedUser: prev.creditedUser, linkedMrs: prev.linkedMrs };
          }
        }
      }
      stmtUpsertLinearIssue.run(toWrite.identifier, JSON.stringify(toWrite));
    }
  });
  tx(rows);
},
```

with `stmtGetLinearIssue = db.query('SELECT data FROM linear_issues WHERE identifier = ?')`. Delete `linearIssuesForMrKeys` and point `store/query.ts`'s call at `allLinearIssues()` keeping its current eligible-key filter inline (temporary; removed in Task 5).

- [ ] **Step 4: Run tests, full gates**

Run: `bun --bun vitest run test/store.test.ts` then `bun run typecheck && bun run test && bun run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "boxscore: sticky linear-issue upsert, indexRowsByKeys, allLinearIssues"
```

---

### Task 4: Fetch — attachments, qualifying links, credit, closedAt

**Files:**
- Modify: `src/server/linear/fetch.ts`, `src/server/linear/raw-types.ts` (if not finished in Task 2)
- Test: `test/linear-resolve.test.ts` (extend; reuse its `stubLinear`/`rawFor` helpers)

**Interfaces:**
- Consumes: `textRefGrade` (Task 1), `indexRowsByKeys` (Task 3), `LinkedMr`/`LinkVia` (Task 2).
- Produces: `resolveLinearTickets` unchanged in signature, but every returned `NormLinearIssue` now carries graded `linkedMrs`, `creditedUser` from the earliest-merged qualifying MR (roster preferred, existing mergedAt/projectPath/iid tiebreak), and `closedAt` = latest qualifying merge. Also exports `parseMrUrl(url: string): { projectPath: string; iid: number } | null` for tests.

**Behavior to implement:**

1. `FIELDS` gains `attachments(first: 50) { nodes { url sourceType } }`; `CHUNK_SIZE` becomes 25.
2. For each verified issue: text links come from the existing `ticketMap` scan, but each carries `via: textRefGrade(mr, identifier)` (skip null grades — identifier extraction already guarantees a hit, but reverts downgrade). Attachment links come from `raw.attachments.nodes` where `sourceType === 'gitlab'`, parsed by `parseMrUrl`; resolve each key first against the scanned source MRs, then via `getStore().indexRowsByKeys`. A key found nowhere is dropped. An MR that is both attached and text-linked collapses to `via: 'attachment'`.
3. Qualifying merged MRs: merged, non-revert, `via: 'attachment'`; when the issue has zero attachment-grade links, merged non-revert `via: 'closing'` instead.
4. `creditedUser`: earliest-merged qualifying MR, roster authors preferred (keep the existing `earliestMr` tiebreak helper); null when nothing qualifies. Delete the unmerged single-author fallback in `creditedAuthor`.
5. `closedAt`: max `mergedAt` over qualifying merged MRs; null when none.

- [ ] **Step 1: Write the failing tests**

```typescript
// appended to test/linear-resolve.test.ts
import { parseMrUrl } from '../src/server/linear/fetch.js';

const rawWithAttachment = (id: string, urls: string[]) => ({
  ...rawFor(id),
  attachments: { nodes: urls.map(url => ({ url, sourceType: 'gitlab' })) },
});

describe('parseMrUrl', () => {
  it('extracts projectPath and iid', () => {
    expect(parseMrUrl('https://gitlab.com/assured/assured-dev/-/merge_requests/43944'))
      .toEqual({ projectPath: 'assured/assured-dev', iid: 43944 });
  });
  it('rejects non-MR urls', () => {
    expect(parseMrUrl('https://gitlab.com/assured/assured-dev/-/issues/9')).toBeNull();
  });
});

describe('attachment-graded resolution', () => {
  it('credits and dates from the attached MR, not the mentioning MR', async () => {
    // impl is the real (attached) MR, merged 05-10; cleanup only mentions the id in prose.
    const impl = mr({ iid: 100, authorUsername: 'alice', title: 'ACME-1: build it', mergedAt: '2026-05-10T00:00:00.000Z' });
    const cleanup = mr({ iid: 200, authorUsername: 'bob', title: 'delete dead code', description: 'context from ACME-1 applies', mergedAt: '2026-05-20T00:00:00.000Z' });
    stubLinear(ids => okData(ids, id => rawWithAttachment(id, ['https://gitlab.example/org/app/-/merge_requests/100'])));
    const issues = await resolveLinearTickets('key', [impl, cleanup], [], ['alice', 'bob']);
    const issue = issues.find(i => i.identifier === 'ACME-1')!;
    expect(issue.creditedUser).toBe('alice');
    expect(issue.closedAt).toBe('2026-05-10T00:00:00.000Z');
    expect(issue.linkedMrs).toContainEqual({ iid: 100, projectPath: 'org/app', via: 'attachment' });
    expect(issue.linkedMrs).toContainEqual({ iid: 200, projectPath: 'org/app', via: 'mention' });
  });

  it('falls back to closing-grade text links when no attachment exists', async () => {
    const impl = mr({ iid: 300, authorUsername: 'alice', title: 'ACME-2: ship it', mergedAt: '2026-05-12T00:00:00.000Z' });
    stubLinear(ids => okData(ids, id => rawFor(id)));
    const issues = await resolveLinearTickets('key', [impl], [], ['alice']);
    const issue = issues.find(i => i.identifier === 'ACME-2')!;
    expect(issue.creditedUser).toBe('alice');
    expect(issue.closedAt).toBe('2026-05-12T00:00:00.000Z');
  });

  it('resolves an attached MR outside the source set via the store index', async () => {
    // Insert an index row for org/app:400 (merged 2026-05-01, author carol) with the
    // store's upsertIndexRows, do NOT pass it as a source MR, then attach it:
    const mention = mr({ iid: 500, authorUsername: 'bob', title: 'notes', description: 'see ACME-3', mergedAt: '2026-05-21T00:00:00.000Z' });
    stubLinear(ids => okData(ids, id => rawWithAttachment(id, ['https://gitlab.example/org/app/-/merge_requests/400'])));
    const issues = await resolveLinearTickets('key', [mention], [], ['bob', 'carol']);
    const issue = issues.find(i => i.identifier === 'ACME-3')!;
    expect(issue.creditedUser).toBe('carol');
    expect(issue.closedAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('yields null credit and closedAt when nothing qualifying merged', async () => {
    const open = mr({ iid: 600, authorUsername: 'alice', title: 'ACME-4: wip', state: 'opened', mergedAt: null });
    stubLinear(ids => okData(ids, id => rawFor(id)));
    const issues = await resolveLinearTickets('key', [open], [], ['alice']);
    const issue = issues.find(i => i.identifier === 'ACME-4')!;
    expect(issue.creditedUser).toBeNull();
    expect(issue.closedAt).toBeNull();
  });
});
```

(Adjust `okData`/`stubLinear` plumbing to whatever the file's existing helpers expect; `warnings` argument is the empty-array literal in existing tests. The tests must key off identifiers actually extractable from the source MRs, per the existing `LINEAR_ID_RE` discovery.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run test/linear-resolve.test.ts`
Expected: new tests FAIL (`parseMrUrl` missing, `via`/`closedAt` absent).

- [ ] **Step 3: Implement** per the behavior list above. `parseMrUrl`:

```typescript
export function parseMrUrl(
  url: string
): { projectPath: string; iid: number } | null {
  const m = url.match(/^https?:\/\/[^/]+\/(.+?)\/-\/merge_requests\/(\d+)(?:[/?#]|$)/);
  return m ? { projectPath: m[1]!, iid: Number(m[2]) } : null;
}
```

The qualifying/credit/closedAt computation replaces the current `creditedAuthor` body; keep `earliestMr` as the tiebreak. The `TicketMr` shape gains `title` (for the revert check) or, simpler, filter reverts out with `isRevertTitle(mr.title)` when building the per-ticket MR list grades.

- [ ] **Step 4: Run tests, full gates**

Run: `bun --bun vitest run test/linear-resolve.test.ts` then `bun run typecheck && bun run test && bun run lint`
Expected: PASS, including the pre-existing resolve tests (update any that pinned the unmerged-author fallback: with nothing merged, credit is now null).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "boxscore: grade linear links, credit and date issues from qualifying merged MRs"
```

---

### Task 5: Cohorts and query — closedAt windowing, ungated MRs merged

**Files:**
- Modify: `src/server/metrics/cohorts.ts`, `src/server/store/query.ts`, `src/server/metrics/filters.ts`, `src/server/linear/ticket.ts` (delete `teamTicketRegex` if now unreferenced)
- Test: `test/cohorts.test.ts`, `test/window.test.ts`, `test/filters.test.ts`, `test/query.test.ts` (extend/adjust)

**Interfaces:**
- Consumes: `closedAt`/`creditedUser` (Task 2), `allLinearIssues` (Task 3).
- Produces: `IssueCohort` gains `windowExcluded: number` (issues passing team+state whose `closedAt` is null or outside the window). `MetricFilters` loses `hasTeamTicket`. `buildFetchResult` returns every stored issue.

- [ ] **Step 1: Write the failing tests**

```typescript
// appended to test/cohorts.test.ts (or the file where buildUserCohorts is tested; follow existing setup)
it('counts an issue only when closedAt falls inside the window', () => {
  const fetched: FetchResult = {
    ...FETCH,
    linearIssues: [
      li('ENG-10', 'alice', '2026-05-15T00:00:00.000Z'),
      li('ENG-11', 'alice', '2026-04-01T00:00:00.000Z'),
      li('ENG-12', 'alice', null),
    ],
  };
  const c = buildUserCohorts(buildCorpus(fetched, OPTS), 'alice', OPTS);
  expect(c.issues.counted.map(i => i.identifier)).toEqual(['ENG-10']);
  expect(c.issues.windowExcluded).toBe(2);
});

it('counts merged MRs without any team-ticket reference', () => {
  const opts = { ...OPTS, linearTeam: 'ENG' };
  const c = buildUserCohorts(buildCorpus(FETCH, opts), 'alice', opts);
  // MR1 and MR2 carry no ENG-* reference anywhere yet still count.
  expect(c.authoredMerged.map(m => m.iid)).toEqual([1, 2]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun --bun vitest run test/cohorts.test.ts`
Expected: FAIL (windowExcluded missing; with linearTeam set, MR1/MR2 currently drop out).

- [ ] **Step 3: Implement**

In `cohorts.ts`: `authoredMerged` filter becomes author + merged + `inWindow(m.mergedAt, window)` (delete `f.hasTeamTicket(m)`). The issue loop becomes:

```typescript
const issues: IssueCohort = { counted: [], teamExcluded: 0, stateExcluded: 0, windowExcluded: 0 };
for (const i of corpus.linearIssues) {
  if (i.creditedUser !== u) continue;
  if (!matchesTeam(i.identifier, opts.linearTeam)) { issues.teamExcluded++; continue; }
  if (!isDoneState(i.stateType, i.stateName, opts.doneStates)) { issues.stateExcluded++; continue; }
  if (i.closedAt === null || !inWindow(i.closedAt, window)) { issues.windowExcluded++; continue; }
  issues.counted.push(i);
}
```

In `store/query.ts`: replace the eligible-key selection block (`query.ts:83-88`) with `const linearIssues = store.allLinearIssues();` and drop the now-unused `eligibleForLinearDiscovery` import. In `filters.ts`: delete `hasTeamTicket` from `MetricFilters` and `buildMetricFilters`; in `ticket.ts` delete `teamTicketRegex` if nothing else references it (grep first). Update `test/filters.test.ts` accordingly.

- [ ] **Step 4: Run tests, full gates**

Run: `bun run typecheck && bun run test && bun run lint`
Expected: PASS. Existing cohort/leaderboard tests relying on the fixture default `closedAt` inside `WINDOW` keep passing; fix any that asserted team-gated `authoredMerged`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "boxscore: window issues on closedAt, ungate authoredMerged from team tickets"
```

---

### Task 6: Evidence and metric descriptions

**Files:**
- Modify: `src/server/metrics/evidence.ts`, `src/shared/metrics.ts`
- Test: `test/evidence.test.ts`, `test/parity.test.ts`, `test/metadata.test.ts` (adjust as pinned)

**Interfaces:**
- Consumes: `IssueCohort.windowExcluded` (Task 5), `LinkedMr.via`, `closedAt`.

- [ ] **Step 1: Write the failing test**

```typescript
// appended to test/evidence.test.ts, following its existing buildUserEvidence setup
it('issue evidence shows the closed date and ignores mention-only links in the MR column', () => {
  const ev = buildUserEvidence(fetchedWithIssues, 'alice', CTX);
  const issues = ev.issuesCompleted!;
  expect(issues.columns).toEqual(['Issue', 'Title', 'State', 'Closed', 'MR(s)']);
  const row = issues.rows.find(r => r.cells[0] === 'ENG-10')!;
  expect(row.cells[3]).toBe('2026-05-15');
  expect(row.cells[4]).not.toContain('!200'); // 200 is the mention-only link
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun --bun vitest run test/evidence.test.ts`
Expected: FAIL (no Closed column).

- [ ] **Step 3: Implement**

In `evidence.ts` (`out.issuesCompleted`): columns `['Issue', 'Title', 'State', 'Closed', 'MR(s)']`; the MR cell joins only `i.linkedMrs.filter(m => m.via !== 'mention')`; add `day(i.closedAt)` for the Closed cell; the summary keeps counted/team/state parts and appends `` `${c.issues.windowExcluded} outside window` `` when non-zero.

In `shared/metrics.ts`, replace the `issuesCompleted` description with:

```
'Linear issues closed by merged work: an issue counts in the window its implementing MR merged (Linear's attached MR, or one referencing the issue in its title, branch, or a closing phrase), credited to that MR's author. Issues whose current state is not a done state, or with no merged implementing MR, do not count.'
```

and confirm the `mrsMerged` description ('Count of MRs the user authored that merged in the window.') now matches behavior; leave it as is.

- [ ] **Step 4: Run tests, full gates**

Run: `bun run typecheck && bun run test && bun run lint`
Expected: PASS (parity test pins evidence rows to snapshot counts; if it fails, the cohort and evidence layers disagree and the evidence change is wrong, not the test).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "boxscore: issue evidence shows closed date, description matches merge-anchored rule"
```

---

### Task 7: End-to-end verification against the live store

**Files:** none created; verification only.

- [ ] **Step 1: Full gates plus build**

Run (from the worktree root): `bun run boxscore:typecheck && bun run boxscore:test && bun run boxscore:lint && bun run boxscore:build`
Expected: all PASS.

- [ ] **Step 2: Replay the real board**

Run (from `apps/boxscore/`): `bun run report -- --range 90d` against the live store (`~/.mattstack/boxscore/boxscore.sqlite`, read via a `--refresh`-free invocation; it may need one refresh first to populate `closedAt`: `bun run report -- --range 90d --refresh`).
Expected: Issues-done column lands near the spike's R2-last numbers (Matthew ~102, Doug ~74, Jorge ~36, Ed ~37 as of 2026-09-10; drift from new merges is fine). `bun run validate` reports no integrity failures.

- [ ] **Step 3: Report the observed numbers in the task report** (not in code comments), then commit any straggler fixes.

---

## Self-Review Notes

- Spec coverage: link grades (T1, T4), qualifying/fallback (T4), counting rule and windowing (T5), sticky store (T3), credit (T4), MRs-merged ungating (T5), evidence + descriptions (T6), chunk size 25 (T4), model rename (T2), legacy-row migration (T3's read-time normalization, so cohort checks may use strict `=== null`).
- Type consistency: `LinkedMr`/`LinkVia` defined once in Task 2, consumed in Tasks 3-6; `windowExcluded` defined in Task 5, consumed in Task 6.
