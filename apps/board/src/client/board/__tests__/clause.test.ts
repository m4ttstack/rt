import { expect, test } from 'bun:test';

import { clauseOf } from '../clause.ts';

test('a short detail passes through untouched', () => {
  expect(clauseOf('pane closed 12m ago')).toEqual({
    text: 'pane closed 12m ago',
    full: null,
  });
});

test('a long message is cut at its first natural boundary and keeps the full text', () => {
  const msg =
    'rebased acme-2214 onto origin/main (pat); resolved Overview.test.tsx conflict (kept both sides)';
  expect(clauseOf(msg)).toEqual({
    text: 'rebased acme-2214 onto origin/main',
    full: msg,
  });
});

test('a sentence stop counts as a boundary', () => {
  const msg =
    'pane lost to machine reboot. the run had no lease so nothing resumed it';
  expect(clauseOf(msg).text).toBe('pane lost to machine reboot');
});

test('with no boundary inside the cap it cuts at the last word before the cap', () => {
  const msg =
    'STACKED MR targets acme-widget-port-cleanup which is itself still open';
  const { text, full } = clauseOf(msg);
  expect(text).toBe('STACKED MR targets acme-widget-port-cleanup…');
  expect(full).toBe(msg);
});

test('a boundary that would leave a stub is skipped for a later one', () => {
  const msg = 'ok. rebased onto main after the conflict was resolved by hand';
  expect(clauseOf(msg).text).toBe('ok. rebased onto main after the conflict…');
});

test('an early parenthesis keeps the fact after it instead of stopping at the label', () => {
  const msg =
    'STACKED MR: !4321 (pat) targets acme-widget-port, not main, so the doctor does not rebase it';
  expect(clauseOf(msg).text).toBe('STACKED MR: !4321 (pat) targets…');
});
