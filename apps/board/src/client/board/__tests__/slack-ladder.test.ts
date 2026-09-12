import { expect, test } from 'bun:test';

import { slackLadder } from '../slack-ladder.ts';

const MARKS = [
  { emoji: 'eyes' },
  { emoji: 'speech_balloon' },
  { emoji: 'white_check_mark' },
];

test('no slack info: not posted, no stage', () => {
  expect(slackLadder(undefined, MARKS)).toEqual({ posted: false, stage: null });
});

test('posted with no reactions: the logo alone', () => {
  expect(
    slackLadder({ status: 'found', reactions: [], posted: true }, MARKS)
  ).toEqual({
    posted: true,
    stage: null,
  });
});

test('the furthest reaction wins the stage', () => {
  expect(
    slackLadder({ status: 'found', reactions: ['eyes'], posted: true }, MARKS)
      .stage
  ).toBe('looking');
  expect(
    slackLadder(
      { status: 'found', reactions: ['eyes', 'speech_balloon'], posted: true },
      MARKS
    ).stage
  ).toBe('commented');
  expect(
    slackLadder(
      {
        status: 'found',
        reactions: ['white_check_mark', 'eyes'],
        posted: true,
      },
      MARKS
    ).stage
  ).toBe('approved');
});

test('reactions on an unposted message count for nothing', () => {
  expect(
    slackLadder(
      { status: 'found', reactions: ['white_check_mark'], posted: false },
      MARKS
    )
  ).toEqual({ posted: false, stage: null });
});

test('unknown reactions are ignored', () => {
  expect(
    slackLadder({ status: 'found', reactions: ['tada'], posted: true }, MARKS)
      .stage
  ).toBeNull();
});
