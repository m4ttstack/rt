import { expect, test } from 'bun:test';

import { parseGateContext, sectionFor } from '../client/board/gate-context.ts';

const CONTEXT = `MR 1288 (ACME-1288) — 4 unresolved threads from Nils Kade. Fresh-context adjudication done. Recommendation per thread below.

=== thread-1 PartyList.tsx:212 — verdict pushback → recommend REPLY ===
Nils: "The dedupe key drops the unit suffix, so two flats at one street address collapse into a single row. Should the key carry the unit?"
Adjudication: the key is built from the normalized address, and normalizeAddress keeps the unit (it strips punctuation only). Reply with the normalizer's contract and the test that pins it.

=== thread-2 partyMerge.ts:58 — verdict valid → recommend FIX ===
Nils: "mergeParties keeps the first party's phone even when it is empty
and the second has one."
Adjudication: correct. Prefer the non-empty value per field.

=== code-changes ===
Threads 2 and 4 are the proposed fixes; one commit, no behavior change outside the merge.
`;

test('parseGateContext splits the blob at its section markers and keeps the preamble', () => {
  const parsed = parseGateContext(CONTEXT)!;
  expect(parsed.preamble).toBe(
    'MR 1288 (ACME-1288) — 4 unresolved threads from Nils Kade. Fresh-context adjudication done. Recommendation per thread below.'
  );
  expect([...parsed.sections.keys()]).toEqual([
    'thread-1',
    'thread-2',
    'code-changes',
  ]);
});

test('a thread section carries its label, verdict, recommendation, quote and adjudication', () => {
  const s = sectionFor(parseGateContext(CONTEXT), {
    id: 'thread-1',
    label: 'PartyList.tsx:212',
  })!;
  expect(s).toMatchObject({
    key: 'thread-1',
    label: 'PartyList.tsx:212',
    verdict: 'pushback',
    recommendation: 'reply',
    quote: {
      who: 'Nils',
      text: 'The dedupe key drops the unit suffix, so two flats at one street address collapse into a single row. Should the key carry the unit?',
    },
  });
  expect(s.adjudication).toBe(
    "the key is built from the normalized address, and normalizeAddress keeps the unit (it strips punctuation only). Reply with the normalizer's contract and the test that pins it."
  );
});

test('a quote may wrap onto more lines; the body keeps its paragraphs', () => {
  const s = sectionFor(parseGateContext(CONTEXT), { id: 'thread-2' })!;
  expect(s.quote?.text).toBe(
    "mergeParties keeps the first party's phone even when it is empty and the second has one."
  );
  expect(s.recommendation).toBe('fix');
  expect(s.adjudication).toBe('correct. Prefer the non-empty value per field.');
});

test('a bare section (no label, no verdict) still matches its question by key', () => {
  const s = sectionFor(parseGateContext(CONTEXT), {
    id: 'code-changes',
    label: 'Approve the proposed code changes?',
  })!;
  expect(s.label).toBeUndefined();
  expect(s.verdict).toBeUndefined();
  expect(s.quote).toBeUndefined();
  expect(s.body).toBe(
    'Threads 2 and 4 are the proposed fixes; one commit, no behavior change outside the merge.'
  );
});

test('a section matches by label when the question id is something else', () => {
  const s = sectionFor(parseGateContext(CONTEXT), {
    id: 'q7',
    label: 'partyMerge.ts:58',
  });
  expect(s?.key).toBe('thread-2');
  expect(
    sectionFor(parseGateContext(CONTEXT), { id: 'q8', label: 'nothing' })
  ).toBeUndefined();
});

test('the parenthetical header form parses too: label, verdict and recommendation', () => {
  const parsed = parseGateContext(
    '=== finding-1 TabBar.tsx:58 (verdict: valid, recommend post) ===\nreviewer: "stray dot"\nAdjudication: correct.'
  );
  expect(sectionFor(parsed, { id: 'finding-1' })).toMatchObject({
    label: 'TabBar.tsx:58',
    verdict: 'valid',
    recommendation: 'post',
    quote: { who: 'reviewer', text: 'stray dot' },
    adjudication: 'correct.',
  });
});

test('an adjudication a paragraph after the quote is still found; without the marker the rest is the remainder', () => {
  const spaced = sectionFor(
    parseGateContext(
      '=== thread-1 a.ts:1 ===\nNils: "why?"\n\nAdjudication: because.\n\nAlso this.'
    ),
    { id: 'thread-1' }
  )!;
  expect(spaced.quote?.text).toBe('why?');
  expect(spaced.adjudication).toBe('because.\n\nAlso this.');
  expect(spaced.remainder).toBeUndefined();

  const bare = sectionFor(
    parseGateContext(
      '=== thread-1 a.ts:1 ===\nNils: "why?"\nIt holds.\n\nMore.'
    ),
    { id: 'thread-1' }
  )!;
  expect(bare.adjudication).toBeUndefined();
  expect(bare.remainder).toBe('It holds.\n\nMore.');
});

test('a context with no markers parses to null, so the form renders as before', () => {
  expect(parseGateContext('just a paragraph of context')).toBeNull();
  expect(parseGateContext('')).toBeNull();
  expect(sectionFor(null, { id: 'thread-1' })).toBeUndefined();
});
