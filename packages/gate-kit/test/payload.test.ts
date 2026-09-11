import { expect, test } from 'vitest';

import { gateAnswerPayload, unwrapGateAnswer } from '@mattstack/gate-kit';
import type { GateQuestion } from '@mattstack/rt-client';

const QUESTIONS: GateQuestion[] = [
  {
    id: 'tiers',
    label: 'Which tiers?',
    multi: true,
    options: ['nit', 'must-fix'],
  },
  {
    id: 'outcome',
    label: 'Outcome?',
    multi: false,
    options: ['comment', 'approve'],
  },
];

test('gateAnswerPayload shapes a multi answer to an array and a single answer to a string', () => {
  const payload = gateAnswerPayload(QUESTIONS, {
    tiers: ['must-fix'],
    outcome: 'approve',
  });
  expect(payload).toEqual({
    answers: { tiers: ['must-fix'], outcome: 'approve' },
  });
});

test("gateAnswerPayload refuses when a multi question's selection is missing", () => {
  const payload = gateAnswerPayload(QUESTIONS, { outcome: 'approve' });
  expect(payload).toBeNull();
});

test("gateAnswerPayload accepts a multi question's explicit empty array as a deliberate 'none'", () => {
  const payload = gateAnswerPayload(QUESTIONS, {
    tiers: [],
    outcome: 'approve',
  });
  expect(payload).toEqual({
    answers: { tiers: [], outcome: 'approve' },
  });
});

test("gateAnswerPayload refuses when a single question's selection is missing", () => {
  const payload = gateAnswerPayload(QUESTIONS, { tiers: ['nit'] });
  expect(payload).toBeNull();
});

test("gateAnswerPayload refuses when a single question's selection is an empty string", () => {
  const payload = gateAnswerPayload(QUESTIONS, { tiers: ['nit'], outcome: '' });
  expect(payload).toBeNull();
});

test("gateAnswerPayload drops selections for questions the gate doesn't have", () => {
  const payload = gateAnswerPayload(QUESTIONS, {
    tiers: ['nit'],
    outcome: 'comment',
    bogus: 'ignored',
  });
  expect(payload).toEqual({
    answers: { tiers: ['nit'], outcome: 'comment' },
  });
});

test('gateAnswerPayload with no questions on the gate always succeeds with empty answers', () => {
  const payload = gateAnswerPayload([], {});
  expect(payload).toEqual({ answers: {} });
});

test('gateAnswerPayload is not blocked by a zero-option question -- a clean review with no severity levels stays answerable via outcome alone', () => {
  const questions: GateQuestion[] = [
    { id: 'tiers', label: 'Post which findings?', multi: true, options: [] },
    {
      id: 'outcome',
      label: 'Verdict',
      multi: false,
      options: ['comment', 'approve'],
    },
  ];
  const payload = gateAnswerPayload(questions, { outcome: 'approve' });
  expect(payload).toEqual({ answers: { outcome: 'approve' } });
});

test('unwrapGateAnswer passes a bare string through unchanged', () => {
  expect(unwrapGateAnswer('approve')).toEqual({ value: 'approve' });
});

test('unwrapGateAnswer passes a bare array through unchanged', () => {
  expect(unwrapGateAnswer(['critical', 'nit'])).toEqual({
    value: ['critical', 'nit'],
  });
});

test('unwrapGateAnswer unwraps the {value, note} object form', () => {
  expect(
    unwrapGateAnswer({ value: 'comment', note: 'approve once CI is green' })
  ).toEqual({
    value: 'comment',
    note: 'approve once CI is green',
  });
});

test('unwrapGateAnswer unwraps an array value inside the object form, with no note', () => {
  expect(unwrapGateAnswer({ value: ['critical'] })).toEqual({
    value: ['critical'],
  });
});
