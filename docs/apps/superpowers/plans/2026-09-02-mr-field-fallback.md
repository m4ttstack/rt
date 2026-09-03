# MR Field Fallback on Run Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The run detail card's MR column falls back to the run's recorded `mr` field when the enrichment join has nothing for the branch, instead of reading "not recorded" while holding the URL.

**Architecture:** A pure resolver (`src/app/runs/mrRef.ts`) merges `enrichment.mr` (preferred: it knows state and CI) with the `mr` field's URL (fallback: link only, iid parsed from the URL tail). Only `SummaryCard` in `RunDetail.tsx` consumes it; the board row and search list stay enrichment-only because list rows denormalize only `ticket`/`branch` (no `mr` in hand there, by design).

**Tech Stack:** React + Mantine via `@mattstack/app-kit`, vitest + testing-library, bun.

**Spec:** `../../../mattstack-skills/docs/superpowers/specs/2026-09-02-run-identity-design.md` (section 4; sections 6-7 bound the scope)

## Global Constraints

- Enrichment always wins when present; the fallback never invents `state` or CI status (only enrichment knows them).
- The `m` hotkey's copy precedence is preserved exactly: enrichment `webUrl` when present, else the raw `mr` field value.
- `RunRow.tsx`, `RunBoard.tsx`, `RunSearch.tsx` are not modified.
- The existing test "shows a missing summary-card value as dimmed `not recorded`" must keep passing: no `mr` field and no enrichment still renders "not recorded".
- No em or en dashes in any text or code comment.
- Work on a branch (worktree via the rt:worktree skill if provisioning fresh); commit after each task.

---

### Task 1: The mrRef resolver

**Files:**
- Create: `src/app/runs/mrRef.ts`
- Test: `src/app/runs/mrRef.test.ts`

**Interfaces:**
- Consumes: `BranchEnrichment` from `@mattstack/rt-client` (`mr: { iid: number; webUrl: string | null; state: string; pipeline: { status: string } | null } | null`).
- Produces (Task 2 relies on these exact names):

```ts
export interface MrRef {
  /** "43166": String(enrichment iid), or parsed from the field URL tail; null when unparseable. */
  iid: string | null;
  /** Enrichment only ("merged", "opened", ...); null on the field fallback. */
  state: string | null;
  /** Link target: enrichment webUrl, or the field value when it is an http(s) URL. */
  webUrl: string | null;
  /** enrichment mr.pipeline?.status, else null. */
  ciStatus: string | null;
  /** Raw field value for linkless display when it is not a URL; null otherwise. */
  text: string | null;
}

export function mrRef(
  enrichmentMr: BranchEnrichment['mr'] | undefined,
  mrField: string | null
): MrRef | null;
```

- [ ] **Step 1: Write the failing tests**

Create `src/app/runs/mrRef.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { mrRef } from './mrRef';

const enrichmentMr = {
  iid: 43166,
  webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
  state: 'merged',
  pipeline: { status: 'success' },
};

describe('mrRef', () => {
  it('prefers enrichment over the field, carrying state and CI', () => {
    expect(mrRef(enrichmentMr, 'https://elsewhere.example.com/x')).toEqual({
      iid: '43166',
      state: 'merged',
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
      ciStatus: 'success',
      text: null,
    });
  });

  it('keeps enrichment without webUrl linkless but labeled', () => {
    expect(mrRef({ ...enrichmentMr, webUrl: null, pipeline: null }, null)).toEqual({
      iid: '43166',
      state: 'merged',
      webUrl: null,
      ciStatus: null,
      text: null,
    });
  });

  it('parses a GitLab merge_requests URL from the field alone', () => {
    expect(
      mrRef(undefined, 'https://gitlab.example.com/g/p/-/merge_requests/43166')
    ).toEqual({
      iid: '43166',
      state: null,
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
      ciStatus: null,
      text: null,
    });
  });

  it('parses a GitHub pull URL from the field alone', () => {
    expect(mrRef(undefined, 'https://github.com/o/r/pull/123')).toMatchObject({
      iid: '123',
      webUrl: 'https://github.com/o/r/pull/123',
    });
  });

  it('keeps an unrecognized URL clickable with no iid', () => {
    expect(mrRef(undefined, 'https://gitlab.example.com/g/p/-/pipelines/9')).toMatchObject({
      iid: null,
      webUrl: 'https://gitlab.example.com/g/p/-/pipelines/9',
    });
  });

  it('renders a non-URL field value as text only', () => {
    expect(mrRef(undefined, 'draft, not opened yet')).toEqual({
      iid: null,
      state: null,
      webUrl: null,
      ciStatus: null,
      text: 'draft, not opened yet',
    });
  });

  it('returns null when neither source has anything', () => {
    expect(mrRef(undefined, null)).toBeNull();
    expect(mrRef(null, null)).toBeNull();
  });

  it('normalizes a URL with surrounding whitespace and parses iid', () => {
    expect(
      mrRef(undefined, '  https://gitlab.example.com/g/p/-/merge_requests/43166\n')
    ).toEqual({
      iid: '43166',
      state: null,
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
      ciStatus: null,
      text: null,
    });
  });

  it('handles uppercase scheme URLs', () => {
    expect(mrRef(undefined, 'HTTPS://github.com/o/r/pull/456')).toMatchObject({
      iid: '456',
      webUrl: 'HTTPS://github.com/o/r/pull/456',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- run src/app/runs/mrRef.test.ts`
Expected: FAIL (module `./mrRef` not found).

- [ ] **Step 3: Implement**

Create `src/app/runs/mrRef.ts`:

```ts
import type { BranchEnrichment } from '@mattstack/rt-client';

export interface MrRef {
  /** "43166": String(enrichment iid), or parsed from the field URL tail; null when unparseable. */
  iid: string | null;
  /** Enrichment only ("merged", "opened", ...); null on the field fallback. */
  state: string | null;
  /** Link target: enrichment webUrl, or the field value when it is an http(s) URL. */
  webUrl: string | null;
  /** enrichment mr.pipeline?.status, else null. */
  ciStatus: string | null;
  /** Raw field value for linkless display when it is not a URL; null otherwise. */
  text: string | null;
}

/** The `mr` field is written by pipelines as a bare URL; the iid rides its
    tail. Enrichment wins outright because only it knows state and CI. */
export function mrRef(
  enrichmentMr: BranchEnrichment['mr'] | undefined,
  mrField: string | null
): MrRef | null {
  if (enrichmentMr) {
    return {
      iid: String(enrichmentMr.iid),
      state: enrichmentMr.state,
      webUrl: enrichmentMr.webUrl ?? null,
      ciStatus: enrichmentMr.pipeline?.status ?? null,
      text: null,
    };
  }
  if (!mrField) return null;
  const raw = mrField.trim();
  if (!/^https?:\/\//i.test(raw)) {
    return { iid: null, state: null, webUrl: null, ciStatus: null, text: raw };
  }
  const iid =
    raw.match(/\/(?:merge_requests|pull)\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
  return { iid, state: null, webUrl: raw, ciStatus: null, text: null };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun run test -- run src/app/runs/mrRef.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add src/app/runs/mrRef.ts src/app/runs/mrRef.test.ts
git commit -m "add runs/mrRef: enrichment-first MR resolver with mr-field URL fallback"
```

---

### Task 2: SummaryCard renders through mrRef

**Files:**
- Modify: `src/app/runs/RunDetail.tsx` (SummaryCard only: the `mr` const, the values-map override, the MR column JSX, the CI status line)
- Test: `src/app/runs/RunDetail.test.tsx` (new cases; existing cases untouched)

**Interfaces:**
- Consumes: `mrRef`/`MrRef` from Task 1, exactly as declared there.
- Produces: nothing later relies on.

- [ ] **Step 1: Write the failing tests**

In `src/app/runs/RunDetail.test.tsx`, add inside the `describe('RunDetail', ...)` block, using the file's own helpers exactly as its neighbors do: `renderDetail()`, `detailResponse(data)` (returns `{ ok, status, json }`), `FIXTURE`, `enrichedBranch`, and the per-test `seenPost` mock. `enrichPost` is already mocked to `{}` by the file's `beforeEach`, so the fallback case needs no enrich override.

```ts
it('falls back to the mr field URL when enrichment has nothing for the branch', async () => {
  detailGet.mockResolvedValue(
    detailResponse({
      ...FIXTURE,
      fields: [
        ...FIXTURE.fields,
        {
          key: 'mr',
          value: 'https://gitlab.example.com/g/p/-/merge_requests/43166',
          produced_by: 'review',
          at: 5,
        },
      ],
    })
  );
  seenPost.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

  renderDetail();

  const link = await screen.findByTestId('mr-link');
  expect(link).toHaveAttribute(
    'href',
    'https://gitlab.example.com/g/p/-/merge_requests/43166'
  );
  expect(link).toHaveTextContent('!43166');
});

it('still prefers enrichment when both the field and the cache answer', async () => {
  enrichPost.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ 'feat/x': enrichedBranch }),
  });
  detailGet.mockResolvedValue(
    detailResponse({
      ...FIXTURE,
      fields: [
        ...FIXTURE.fields,
        {
          key: 'mr',
          value: 'https://stale.example.com/mr/1',
          produced_by: 'ship',
          at: 5,
        },
      ],
    })
  );
  seenPost.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });

  renderDetail();

  const link = await screen.findByTestId('mr-link');
  expect(link).toHaveAttribute('href', 'https://example.com/mr/7');
  expect(link).toHaveTextContent('!7 opened');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test -- run src/app/runs/RunDetail.test.tsx`
Expected: the two new cases FAIL (fallback renders "not recorded" today); every pre-existing case still passes.

- [ ] **Step 3: Wire SummaryCard through mrRef**

In `src/app/runs/RunDetail.tsx`:

1. Import: `import { mrRef } from './mrRef';`
2. In `SummaryCard`, replace the enrichment-only read:

```ts
const mrField = byKey.get('mr')?.value ?? null;
const mr = mrRef(enrichment?.mr, mrField);
const mrLabel = mr
  ? (mr.text ??
    `${mr.iid ? `!${mr.iid}` : 'MR'}${mr.state ? ` ${mr.state}` : ''}`)
  : null;
```

(The old `const mr = enrichment?.mr;` line goes away; `title` keeps reading `enrichment?.ticket?.title`.)

3. The values-map override keeps its exact semantics against the new shape:

```ts
if (mr?.webUrl && enrichment?.mr) values.set('mr', mr.webUrl);
```

(Enrichment URL overrides the field for the `m` hotkey; a field-only run already has the field in the map.)

4. The MR column renders the one label both ways:

```tsx
{mr ? (
  mr.webUrl ? (
    <Anchor
      href={mr.webUrl}
      target="_blank"
      rel="noopener noreferrer"
      fz={13}
      data-testid="mr-link"
    >
      {mrLabel}
    </Anchor>
  ) : (
    <Text fz={13} truncate style={{ minWidth: 0 }}>
      {mrLabel}
    </Text>
  )
) : (
  <Text c={text.dimmed} fz={13}>
    not recorded
  </Text>
)}
```

5. The CI line reads the resolver:

```tsx
{mr?.ciStatus && (
  <Text c={text.muted} fz={11}>
    {ciStatusLabel(mr.ciStatus)}
  </Text>
)}
```

- [ ] **Step 4: Run the file, then the suite**

Run: `bun run test -- run src/app/runs/RunDetail.test.tsx`
Expected: PASS, new and old cases (the "not recorded" count test still sees the MR column dimmed when no field and no enrichment).

Run: `bun run test -- run && bun run typecheck && bun run lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/app/runs/RunDetail.tsx src/app/runs/RunDetail.test.tsx
git commit -m "run detail: MR column falls back to the recorded mr field when enrichment is cold"
```

---

### After the plan

Merge per repo habit; deploy is `bun run build` then `deck restart console` (port 11001), operator-gated. Real-world proof arrives with the skills-side release: a board-launched review run whose detail card links the MR from its own field before the branch cache warms.
