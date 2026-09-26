import { expect, test } from 'bun:test';

import { slackLadder } from '../slack-ladder.ts';

const MARKS = [
  { emoji: 'eyes', stage: 'looking' as const },
  { emoji: 'speech_balloon', stage: 'commented' as const },
  { emoji: 'white_check_mark', stage: 'approved' as const },
];
const stageOf = (reactions: string[], posted = true) =>
  slackLadder({ status: 'found', reactions, posted }, MARKS).mark?.stage ??
  null;

test('no slack info: not posted, no mark', () => {
  expect(slackLadder(undefined, MARKS)).toEqual({ posted: false, mark: null });
});

test('posted with no reactions: the logo alone', () => {
  expect(
    slackLadder({ status: 'found', reactions: [], posted: true }, MARKS)
  ).toEqual({ posted: true, mark: null });
});

test('the furthest reaction wins, whatever order the reactions or marks come in', () => {
  expect(stageOf(['eyes'])).toBe('looking');
  expect(stageOf(['eyes', 'speech_balloon'])).toBe('commented');
  expect(stageOf(['white_check_mark', 'eyes'])).toBe('approved');
  expect(
    slackLadder(
      {
        status: 'found',
        reactions: ['eyes', 'white_check_mark'],
        posted: true,
      },
      [...MARKS].reverse()
    ).mark?.stage
  ).toBe('approved');
});

test('reactions on an unposted message count for nothing', () => {
  expect(
    slackLadder(
      { status: 'found', reactions: ['white_check_mark'], posted: false },
      MARKS
    )
  ).toEqual({ posted: false, mark: null });
});

test('unknown reactions are ignored', () => {
  expect(stageOf(['tada'])).toBeNull();
});
