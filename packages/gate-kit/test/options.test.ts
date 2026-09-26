import { describe, expect, test } from 'vitest';

import {
  displayForValue,
  formatGateOption,
  gateAnswerPayload,
  optionDisplayFor,
  optionLabel,
  optionValue,
  stripRecommended,
} from '@mattstack/gate-kit';
import type { GateQuestion } from '@mattstack/rt-client';

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

describe('recommended marker', () => {
  test('stripRecommended lifts a trailing "(recommended)" off the text', () => {
    expect(stripRecommended('Approve (recommended)')).toEqual({
      text: 'Approve',
      recommended: true,
    });
    expect(stripRecommended('Approve (Recommended)')).toEqual({
      text: 'Approve',
      recommended: true,
    });
    expect(stripRecommended('Approve  ( RECOMMENDED ) ')).toEqual({
      text: 'Approve',
      recommended: true,
    });
  });

  test('stripRecommended leaves other text alone', () => {
    expect(stripRecommended('Approve')).toEqual({ text: 'Approve' });
    expect(stripRecommended('(recommended) approve')).toEqual({
      text: '(recommended) approve',
    });
    expect(stripRecommended('recommended')).toEqual({ text: 'recommended' });
  });

  test('a labeled option renders the stripped label and keeps its value as title', () => {
    const d = optionDisplayFor({
      value: 'fix:8709b19264237de0fb023ce216d174d282ab6840',
      label: 'fix: add characterization test (recommended)',
    });
    expect(d).toEqual({
      text: 'fix: add characterization test',
      title: 'fix:8709b19264237de0fb023ce216d174d282ab6840',
      recommended: true,
    });
  });

  test('a bare option string with the suffix strips for display only', () => {
    expect(formatGateOption('approve (recommended)')).toEqual({
      text: 'approve',
      title: 'approve (recommended)',
      recommended: true,
    });
  });

  test('formatGateOption lifts the flag off a bare verb-token string too', () => {
    const original =
      'fix:8709b19264237de0fb023ce216d174d282ab6840 (recommended)';
    expect(formatGateOption(original)).toEqual({
      text: 'fix · 8709b192',
      title: original,
      recommended: true,
    });
    expect(
      formatGateOption('fix:8709b19264237de0fb023ce216d174d282ab6840')
    ).toEqual({
      text: 'fix · 8709b192',
      title: 'fix:8709b19264237de0fb023ce216d174d282ab6840',
    });
  });

  test('displayForValue carries the flag through', () => {
    const options = [
      { value: 'approve', label: 'Approve (recommended)' },
      { value: 'comment', label: 'Comment' },
    ];
    expect(displayForValue('approve', options)).toEqual({
      text: 'Approve',
      title: 'approve',
      recommended: true,
    });
    expect(displayForValue('comment', options)).toEqual({
      text: 'Comment',
      title: 'comment',
    });
  });
});
