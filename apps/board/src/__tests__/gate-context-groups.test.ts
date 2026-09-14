import { expect, test } from 'bun:test';

import { parseLabelledLines } from '../client/board/gate-context.ts';

const FINDINGS = `Findings: Important (2), Minor (3)
[Important] Dropped injury gate exposes a state-changing mutation CV2 blocks (confirm safe)
[Important] Access-link URL renders into a DOM anchor href; session-replay not in the threat model (confirm)
[Minor] key={link.name} collides on duplicate contact names
[Minor] Non-menuitem interactive controls inside a Radix menu (keyboard reachability)
[Minor] Doc overstates the godControls separation rationale`;

test('the bracketed lines group by their label, in first-seen order, prefix dropped', () => {
  const parsed = parseLabelledLines(FINDINGS)!;
  expect(parsed.total).toBe(5);
  expect(parsed.groups.map(g => [g.label, g.items.length] as const)).toEqual([
    ['Important', 2],
    ['Minor', 3],
  ]);
  expect(parsed.groups[0]!.items[0]).toBe(
    'Dropped injury gate exposes a state-changing mutation CV2 blocks (confirm safe)'
  );
});

test('a preamble that only tallies the groups is dropped; one with words of its own stays', () => {
  expect(parseLabelledLines(FINDINGS)!.preamble).toBe('');
  const withProse = parseLabelledLines(
    'Two of these block the merge.\n[Important] one\n[Minor] two'
  )!;
  expect(withProse.preamble).toBe('Two of these block the merge.');
});

test('a label is whatever the asker bracketed, and a repeat label folds back into its group', () => {
  const parsed = parseLabelledLines(
    '[blocking] one\n[nit] two\n[blocking] three'
  )!;
  expect(parsed.groups.map(g => [g.label, g.items] as const)).toEqual([
    ['blocking', ['one', 'three']],
    ['nit', ['two']],
  ]);
  expect(parsed.preamble).toBe('');
});

test('an indented line continues the finding above it rather than starting a group', () => {
  const parsed = parseLabelledLines(
    '[Minor] first half\n  second half\n[Minor] another'
  )!;
  expect(parsed.groups[0]!.items).toEqual([
    'first half second half',
    'another',
  ]);
});

test('one lone finding is not a grouped context: two is the floor', () => {
  expect(parseLabelledLines('[Minor] just the one')).toBeNull();
});

test('a label carrying regex metacharacters neither throws nor eats the preamble', () => {
  const parsed = parseLabelledLines(
    'Two of these block the build.\n[C++] one\n[a.b] two'
  )!;
  expect(parsed.groups.map(g => g.label)).toEqual(['C++', 'a.b']);
  expect(parsed.preamble).toBe('Two of these block the build.');
  // `[` alone is a legal label and used to throw when it became a RegExp.
  expect(parseLabelledLines('[[] one\n[nit] two')!.groups[0]!.label).toBe('[');
});

test('prose on both sides of a blank line is a document, not a lead-in', () => {
  expect(
    parseLabelledLines('First paragraph.\n\nSecond.\n[Minor] one\n[Minor] two')
  ).toBeNull();
  // One paragraph, blank line, then the findings is still the shape.
  expect(
    parseLabelledLines('Lead-in.\n\n[Minor] one\n[Minor] two')!.preamble
  ).toBe('Lead-in.');
});

test('a context that is not a run of bracketed lines parses to null', () => {
  expect(parseLabelledLines('just a paragraph')).toBeNull();
  expect(parseLabelledLines('')).toBeNull();
  // One bracketed line among prose is not a grouped context either: the
  // pane renders it as it always did rather than inventing a group.
  expect(
    parseLabelledLines('A paragraph.\n\n[Minor] a finding\n\nAnother.')
  ).toBeNull();
});

test('a tally that disagrees with the lines stays: it is the one cross-check the reader has', () => {
  const parsed = parseLabelledLines(
    'Findings: Important (2), Minor (4)\n[Important] a\n[Important] b\n[Minor] c\n[Minor] d\n[Minor] e'
  )!;
  expect(parsed.preamble).toBe('Findings: Important (2), Minor (4)');
  const agrees = parseLabelledLines(
    'Findings: Important (2), Minor (1)\n[Important] a\n[Important] b\n[Minor] c'
  )!;
  expect(agrees.preamble).toBe('');
});

test('task lists and markdown links are not labelled findings', () => {
  expect(parseLabelledLines('[ ] one\n[ ] two')).toBeNull();
  expect(parseLabelledLines('[x] done\n[ ] todo')).toBeNull();
  expect(
    parseLabelledLines(
      '[!1288](https://x/1) needs rebase\n[!1289](https://x/2) too'
    )
  ).toBeNull();
});

test('labels fold case-insensitively onto the first spelling, and a colon after the bracket is not part of the finding', () => {
  const parsed = parseLabelledLines('[Minor]: one\n[minor] two')!;
  expect(parsed.groups.map(g => [g.label, g.items] as const)).toEqual([
    ['Minor', ['one', 'two']],
  ]);
});
