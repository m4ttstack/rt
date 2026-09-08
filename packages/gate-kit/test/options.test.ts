import { describe, expect, test } from 'vitest';

import type { GateQuestion } from '@mattstack/rt-client';
import {
  displayForValue,
  formatGateOption,
  gateAnswerPayload,
  optionDisplayFor,
  optionLabel,
  optionValue,
} from '@mattstack/gate-kit';

describe('formatGateOption', () => {
  test('compacts a verb:longtoken option, carrying the full string as title', () => {
    expect(formatGateOption('fix:7080da2fcf93c1a2')).toEqual({
      text: 'fix · 7080da2f',
      title: 'fix:7080da2fcf93c1a2',
    });
    expect(formatGateOption('reply:a1b2c3d4e5f60718')).toEqual({
      text: 'reply · a1b2c3d4',
      title: 'reply:a1b2c3d4e5f60718',
    });
  });

  test('leaves a bare word untouched, no title', () => {
    expect(formatGateOption('approve')).toEqual({ text: 'approve' });
    expect(formatGateOption('comment')).toEqual({ text: 'comment' });
  });

  test('leaves a verb:value pair untouched when the value is under 12 characters', () => {
    expect(formatGateOption('skip:abc')).toEqual({ text: 'skip:abc' });
    expect(formatGateOption('resolve-addressed')).toEqual({
      text: 'resolve-addressed',
    });
  });

  test('gateAnswerPayload still carries the verbatim option string, never the display form', () => {
    const questions: GateQuestion[] = [
      {
        id: 'threads-1',
        label: 't',
        multi: true,
        options: ['fix:7080da2fcf93c1a2'],
      },
    ];
    const payload = gateAnswerPayload(questions, {
      'threads-1': ['fix:7080da2fcf93c1a2'],
    });
    expect(payload).toEqual({
      answers: { 'threads-1': ['fix:7080da2fcf93c1a2'] },
    });
  });
});

describe('labeled options (W4)', () => {
  test("optionValue returns the string or the object's value", () => {
    expect(optionValue('approve')).toBe('approve');
    expect(optionValue({ value: 'Major', label: 'Major (2)' })).toBe('Major');
  });

  test('optionDisplayFor renders label with the value as hover title', () => {
    expect(
      optionDisplayFor({
        value: 'fix:7080da2fcf93c1a2',
        label: 'fix · api.ts:42',
      })
    ).toEqual({ text: 'fix · api.ts:42', title: 'fix:7080da2fcf93c1a2' });
  });

  test('optionDisplayFor keeps the verb-token transform for bare strings', () => {
    expect(optionDisplayFor('fix:7080da2fcf93c1a2')).toEqual({
      text: 'fix · 7080da2f',
      title: 'fix:7080da2fcf93c1a2',
    });
    expect(optionDisplayFor('approve')).toEqual({ text: 'approve' });
  });

  test("displayForValue maps an answered value back to its option's label", () => {
    const options = [{ value: 'Major', label: 'Major (2)' }, 'approve'];
    expect(displayForValue('Major', options)).toEqual({
      text: 'Major (2)',
      title: 'Major',
    });
    expect(displayForValue('gone', options)).toEqual({ text: 'gone' });
  });
});

test('optionLabel returns the label, falling back to the value', () => {
  expect(optionLabel('approve')).toBe('approve');
  expect(optionLabel({ value: 'Major', label: 'Major (2)' })).toBe('Major (2)');
  expect(optionLabel({ value: 'Major', label: '' })).toBe('Major');
});
