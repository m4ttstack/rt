import { describe, expect, test } from 'bun:test';

import type { MRDetail } from '@mattstack/glance';
import {
  canonicalLatch,
  findLatches,
  hasArmedLatch,
  hasRequest,
  requestCarriers,
} from '../latch/discussions.ts';
import { armedLatchBody, spentLatchBody } from '../latch/markers.ts';

const IMG = '![re-review latch](/uploads/ab12/latch.png)';

function disc(id: string, body: string, createdAt: string, resolved: boolean) {
  return {
    id,
    resolvable: true,
    resolved,
    notes: [
      {
        id: 1,
        body,
        author: { id: 1, username: 'matt', name: 'Matt', avatarUrl: null },
        createdAt,
        system: false,
        type: 'DiscussionNote',
        resolvable: true,
        resolved,
        position: null,
      },
    ],
  };
}

function detail(...discussions: ReturnType<typeof disc>[]): MRDetail {
  return {
    mrIid: 1,
    repositoryId: 'gitlab:42',
    discussions,
  } as unknown as MRDetail;
}

describe('findLatches', () => {
  test('ignores ordinary discussions', () => {
    const d = detail(
      disc('d1', 'please rename this', '2026-09-01T10:00:00Z', false)
    );
    expect(findLatches(d)).toEqual([]);
  });

  test('finds armed and spent latches with their state', () => {
    const d = detail(
      disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
      disc('d2', spentLatchBody(IMG), '2026-09-01T09:00:00Z', true)
    );
    const found = findLatches(d);
    expect(found.map(l => [l.discussionId, l.kind, l.resolved])).toEqual([
      ['d1', 'armed', false],
      ['d2', 'spent', true],
    ]);
  });

  test('reads the marker from the ROOT note only', () => {
    // A reply quoting the marker must not turn a normal thread into a latch.
    const d = detail({
      ...disc('d1', 'please rename this', '2026-09-01T10:00:00Z', false),
      notes: [
        disc('d1', 'please rename this', '2026-09-01T10:00:00Z', false)
          .notes[0]!,
        {
          ...disc('x', armedLatchBody(IMG), '2026-09-01T11:00:00Z', false)
            .notes[0]!,
          id: 2,
        },
      ],
    });
    expect(findLatches(d)).toEqual([]);
  });

  test('sorts newest first', () => {
    const d = detail(
      disc('old', spentLatchBody(IMG), '2026-08-01T10:00:00Z', true),
      disc('new', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
    );
    expect(findLatches(d).map(l => l.discussionId)).toEqual(['new', 'old']);
  });

  test('breaks createdAt ties on discussion id', () => {
    // Seeded in ascending id order so a stable sort with no tie-break would
    // return them unchanged; only a real descending id tie-break reorders
    // them to bbb, aaa.
    const d = detail(
      disc('aaa', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
      disc('bbb', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
    );
    expect(findLatches(d).map(l => l.discussionId)).toEqual(['bbb', 'aaa']);
  });
});

describe('canonicalLatch', () => {
  // The bug that would silently disable the feature per MR: a spent relic from
  // review cycle 1 must never outrank cycle 2's live latch.
  test('picks the newest, so a spent relic never beats a fresh latch', () => {
    const d = detail(
      disc('relic', spentLatchBody(IMG), '2026-08-01T10:00:00Z', true),
      disc('fresh', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
    );
    expect(canonicalLatch(findLatches(d))!.discussionId).toBe('fresh');
  });

  test('is null when there are no latches', () => {
    expect(canonicalLatch([])).toBeNull();
  });
});

describe('requestCarriers / hasRequest', () => {
  test('an armed resolved latch is a request', () => {
    const d = detail(
      disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true)
    );
    expect(hasRequest(findLatches(d))).toBe(true);
    expect(requestCarriers(findLatches(d)).map(l => l.discussionId)).toEqual([
      'd1',
    ]);
  });

  test('an armed unresolved latch is not a request', () => {
    const d = detail(
      disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false)
    );
    expect(hasRequest(findLatches(d))).toBe(false);
  });

  // The invariant: a spent latch is never a request, however it got resolved.
  test('a spent resolved latch is not a request', () => {
    const d = detail(
      disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true)
    );
    expect(hasRequest(findLatches(d))).toBe(false);
    expect(requestCarriers(findLatches(d))).toEqual([]);
  });

  // Resolving the DUPLICATE is still asking; reading only the canonical latch
  // would eat the request with no reply.
  test('a resolved extra carries the request even when the canonical is not resolved', () => {
    const d = detail(
      disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false),
      disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
    );
    const latches = findLatches(d);
    expect(canonicalLatch(latches)!.discussionId).toBe('canon');
    expect(hasRequest(latches)).toBe(true);
    expect(requestCarriers(latches).map(l => l.discussionId)).toEqual([
      'extra',
    ]);
  });

  test('both resolved means both carry, so both get consumed', () => {
    const d = detail(
      disc('canon', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true),
      disc('extra', armedLatchBody(IMG), '2026-09-01T09:00:00Z', true)
    );
    expect(requestCarriers(findLatches(d)).map(l => l.discussionId)).toEqual([
      'canon',
      'extra',
    ]);
  });
});

describe('hasArmedLatch', () => {
  test('false with no latch at all', () => {
    expect(hasArmedLatch(findLatches(detail()))).toBe(false);
  });

  test('true for an armed latch, resolved or not', () => {
    expect(
      hasArmedLatch(
        findLatches(
          detail(disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', false))
        )
      )
    ).toBe(true);
    expect(
      hasArmedLatch(
        findLatches(
          detail(disc('d1', armedLatchBody(IMG), '2026-09-01T10:00:00Z', true))
        )
      )
    ).toBe(true);
  });

  // The bug this guards: canonicalLatch returns the newest latch of EITHER
  // kind, so a spent-only MR must read as unlatched here, not as latched.
  test('false when only a spent latch exists, even though canonicalLatch returns it', () => {
    const latches = findLatches(
      detail(disc('d1', spentLatchBody(IMG), '2026-09-01T10:00:00Z', true))
    );
    expect(canonicalLatch(latches)).not.toBeNull();
    expect(hasArmedLatch(latches)).toBe(false);
  });
});
