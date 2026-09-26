import { describe, expect, test } from 'bun:test';

import { GATE_KINDS } from '@mattstack/gate-kit';
import { gateNotifyCopy } from '../gates/notify-copy.ts';

const thread = (n: number) => ({ id: `thread-${n}` });
const CODE_CHANGES = { id: 'code-changes' };

describe('gateNotifyCopy', () => {
  test('a review gate says the review is ready to pick from', () => {
    expect(gateNotifyCopy('review-post', 812, [{ id: 'findings-1' }])).toEqual({
      headline: 'Your review of !812 is ready',
      summary: 'Pick what to post',
    });
  });

  test('a respond planning gate counts the threads waiting, not code-changes', () => {
    expect(
      gateNotifyCopy('respond-plan', 774, [
        thread(1),
        thread(2),
        thread(3),
        CODE_CHANGES,
      ])
    ).toEqual({
      headline: 'Replies on !774 need you',
      summary: '3 review threads waiting on your call',
    });
  });

  test('one thread reads singular', () => {
    expect(
      gateNotifyCopy('respond-plan', 739, [thread(1), CODE_CHANGES]).summary
    ).toBe('1 review thread waiting on your call');
  });

  test('a respond posting gate says the replies are drafted', () => {
    expect(gateNotifyCopy('respond-post', 774, [thread(1)])).toEqual({
      headline: 'Replies on !774 are drafted',
      summary: 'Check them before they post',
    });
  });

  test('any other kind asks for a decision', () => {
    expect(gateNotifyCopy('doctor-escalation', 702, [{ id: 'q' }])).toEqual({
      headline: '!702 needs your call',
      summary: 'Waiting on your decision',
    });
  });

  test('no copy carries a file path or a question label', () => {
    const questions = [
      { id: 'thread-1', label: 'apps/web/src/hooks/useFlagClient.tsx:56' },
    ];
    for (const kind of GATE_KINDS) {
      const { headline, summary } = gateNotifyCopy(kind, 1, questions);
      expect(`${headline} ${summary}`).not.toContain('useFlagClient');
    }
  });
});
