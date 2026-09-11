import { describe, expect, it } from 'vitest';

import {
  buildCorpus,
  buildUserCohorts,
} from '../src/server/metrics/cohorts.js';
import { buildUserEvidence } from '../src/server/metrics/evidence.js';
import { computeSnapshot } from '../src/server/metrics/snapshot.js';
import type { FetchResult } from '../src/server/store/model.js';
import { FETCH, USERS, WINDOW } from './fixtures.js';

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };

// MR1 references an ENG ticket (through its source branch); the others don't. A Linear
// team no longer gates authoredMerged, so every merged MR counts regardless.
const GATED: FetchResult = {
  ...FETCH,
  mrs: FETCH.mrs.map(m =>
    m.iid === 1 ? { ...m, sourceBranch: 'eng-1-add-feature-x' } : m
  ),
};

describe('snapshot and evidence agree with a Linear team configured', () => {
  const opts = { window: WINDOW, sizeBand: SIZE_BAND, linearTeam: 'ENG' };
  const snap = computeSnapshot(GATED, { ...opts, users: USERS });

  it('authoredMerged is not gated by team ticket reference', () => {
    expect(snap.byUser.alice!.mrsMerged).toBe(2);
    expect(snap.byUser.bob!.mrsMerged).toBe(2);
  });

  for (const u of USERS) {
    it(`${u}: every cohort-backed table has as many rows as the metric counts`, () => {
      const m = snap.byUser[u]!;
      const ev = buildUserEvidence(GATED, u, {
        ...opts,
        baseUrl: 'https://gitlab.com',
      });
      expect(ev.mrsMerged!.rows.length).toBe(m.mrsMerged);
      expect(ev.additions!.rows.length).toBe(m.mrsMerged);
      expect(ev.sizeHealthPct!.rows.length).toBe(m.mrsMerged);
      expect(ev.revertedCount!.rows.filter(r => !r.muted).length).toBe(
        m.revertedCount
      );
      expect(ev.mrsReviewed!.rows.length).toBe(m.mrsReviewed);
      expect(ev.pipelines!.rows.length).toBe(m.pipelines);
      expect(ev.codingDays!.rows.length).toBe(m.codingDays);
      expect(ev.issuesCompleted!.rows.length).toBe(m.issuesCompleted);
    });
  }

  it('the merged summary counts every merged MR, gated or not', () => {
    const ev = buildUserEvidence(GATED, 'alice', {
      ...opts,
      baseUrl: 'https://gitlab.com',
    });
    expect(ev.mrsMerged!.summary).toBe('2 MRs merged');
  });

  const corpus = buildCorpus(GATED, opts);
  for (const u of USERS) {
    it(`${u}: the review-side evidence tables match the cohorts they're drawn from`, () => {
      const c = buildUserCohorts(corpus, u, opts);
      const ev = buildUserEvidence(GATED, u, {
        ...opts,
        baseUrl: 'https://gitlab.com',
      });
      expect(ev.reviewDepth!.rows.length).toBe(c.reviewed.length);
      expect(ev.reviewLatencyHours!.rows.length).toBe(c.waited.length);
      expect(ev.reciprocity!.rows.length).toBe(c.reviewersOfMine.size);

      const responded = c.reviewed.filter(r => r.responseHours !== null).length;
      if (responded === 0) {
        expect(ev.responseLatencyHours!.summary).toBe(
          'no first response samples'
        );
      } else {
        expect(
          ev.responseLatencyHours!.summary!.endsWith(`over ${responded} MR(s)`)
        ).toBe(true);
      }
    });
  }
});
