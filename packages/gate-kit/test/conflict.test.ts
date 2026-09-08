import { describe, expect, test } from 'vitest';

import { resolveAnswerOutcome } from '@mattstack/gate-kit';

describe('resolveAnswerOutcome', () => {
  test("a board-shaped 409 body ({ok:false, conflict:true, row}) is a loss carrying the winner's answers and by", () => {
    const body = {
      ok: false,
      conflict: true,
      row: { answer: { answers: { outcome: 'approve' }, by: 'board' } },
    };
    const outcome = resolveAnswerOutcome(409, body);
    expect(outcome.kind).toBe('lost');
    expect(outcome.answers).toEqual({ outcome: 'approve' });
    expect(outcome.by).toBe('board');
    expect(outcome.row).toBe(body.row);
  });

  test('a console-shaped 409 body ({row}, no conflict flag) is a loss too', () => {
    const body = {
      row: { answer: { answers: { outcome: 'comment' }, by: 'pane' } },
    };
    const outcome = resolveAnswerOutcome(409, body);
    expect(outcome.kind).toBe('lost');
    expect(outcome.answers).toEqual({ outcome: 'comment' });
    expect(outcome.by).toBe('pane');
  });

  test('a conflict:true body is a loss even when the surface did not preserve the 409 status', () => {
    const outcome = resolveAnswerOutcome(200, {
      ok: false,
      conflict: true,
      row: { answer: { answers: {}, by: 'x' } },
    });
    expect(outcome.kind).toBe('lost');
  });

  test('a 200 with a row (console win shape) and a bare {ok:true} (board win shape) are both wins', () => {
    const row = { answer: { answers: { q: 'a' }, by: 'console' } };
    expect(resolveAnswerOutcome(200, { row }).kind).toBe('won');
    expect(resolveAnswerOutcome(200, { row }).row).toBe(row);
    const bare = resolveAnswerOutcome(200, { ok: true });
    expect(bare.kind).toBe('won');
    expect(bare.row).toBeNull();
  });

  test('a loss with a missing or malformed row never throws', () => {
    expect(resolveAnswerOutcome(409, null)).toEqual({
      kind: 'lost',
      row: null,
      answers: {},
      by: '',
    });
    expect(resolveAnswerOutcome(409, {})).toEqual({
      kind: 'lost',
      row: null,
      answers: {},
      by: '',
    });
    expect(resolveAnswerOutcome(409, { row: {} })).toEqual({
      kind: 'lost',
      row: {},
      answers: {},
      by: '',
    });
  });
});
