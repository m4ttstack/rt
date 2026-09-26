import { describe, expect, test } from 'bun:test';

import {
  respondDoneLabel,
  respondNeedsAttention,
  respondOutcome,
} from '../respond-outcome.ts';

describe('respondOutcome', () => {
  test('every thread answered is posted', () => {
    expect(respondOutcome(3, 3)).toBe('posted');
    expect(respondOutcome(1, 1)).toBe('posted');
  });

  test('nothing posted against real threads is drafted', () => {
    expect(respondOutcome(0, 3)).toBe('drafted');
  });

  test('some but not all is partial', () => {
    expect(respondOutcome(2, 3)).toBe('partial');
    expect(respondOutcome(1, 9)).toBe('partial');
  });

  test('no threads at all is none, not drafted', () => {
    expect(respondOutcome(0, 0)).toBe('none');
  });

  test('a miscounted numerator clamps to posted rather than exceeding the total', () => {
    expect(respondOutcome(4, 3)).toBe('posted');
  });

  test('either count absent is unknown, so the badge never claims what it was not told', () => {
    expect(respondOutcome(undefined, undefined)).toBe('unknown');
    expect(respondOutcome(2, undefined)).toBe('unknown');
    expect(respondOutcome(undefined, 3)).toBe('unknown');
  });

  test('counts that are not non-negative integers are unknown', () => {
    expect(respondOutcome(-1, 3)).toBe('unknown');
    expect(respondOutcome(1.5, 3)).toBe('unknown');
    expect(respondOutcome(2, -3)).toBe('unknown');
    expect(respondOutcome(Number.NaN, 3)).toBe('unknown');
  });

  test('a held reply accounts for its thread, so the run reads finished', () => {
    expect(respondOutcome(1, 2, 1)).toBe('posted');
    expect(respondOutcome(4, 5, 1)).toBe('posted');
  });

  test('every reply held per gate is held, not drafted', () => {
    expect(respondOutcome(0, 2, 2)).toBe('held');
  });

  test('held threads do not finish a run that still has waiting threads', () => {
    expect(respondOutcome(1, 3, 1)).toBe('partial');
    expect(respondOutcome(0, 3, 1)).toBe('drafted');
  });

  test('a miscounted held clamps rather than exceeding the total', () => {
    expect(respondOutcome(2, 3, 5)).toBe('posted');
  });

  test('an invalid held count is ignored, never poisoning the pair', () => {
    expect(respondOutcome(2, 3, Number.NaN)).toBe('partial');
    expect(respondOutcome(2, 3, -1)).toBe('partial');
    expect(respondOutcome(3, 3, undefined)).toBe('posted');
  });
});

describe('respondDoneLabel', () => {
  test('names what actually happened', () => {
    expect(respondDoneLabel(3, 3)).toBe('replies posted');
    expect(respondDoneLabel(0, 3)).toBe('replies drafted, not posted');
    expect(respondDoneLabel(0, 0)).toBe('no threads to answer');
  });

  test('partial carries the count', () => {
    expect(respondDoneLabel(2, 3)).toBe('2 of 3 posted');
  });

  test('clamps the numerator it prints', () => {
    expect(respondDoneLabel(4, 3)).toBe('replies posted');
  });

  test('falls back to a claim-free label when counts are missing', () => {
    expect(respondDoneLabel(undefined, undefined)).toBe('responded');
  });

  test('names the held replies alongside the posted ones', () => {
    expect(respondDoneLabel(1, 2, 1)).toBe('replies posted, 1 held');
    expect(respondDoneLabel(0, 2, 2)).toBe('replies held, none posted');
    expect(respondDoneLabel(2, 5, 1)).toBe('2 of 5 posted, 1 held');
  });
});

describe('respondNeedsAttention', () => {
  test('true only where replies are still sitting unposted', () => {
    expect(respondNeedsAttention('partial')).toBe(true);
    expect(respondNeedsAttention('drafted')).toBe(true);
    expect(respondNeedsAttention('posted')).toBe(false);
    expect(respondNeedsAttention('held')).toBe(false);
    expect(respondNeedsAttention('none')).toBe(false);
    expect(respondNeedsAttention('unknown')).toBe(false);
  });
});
