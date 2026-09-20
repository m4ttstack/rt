/** DOM-level test for the full-screen review gate sheet (task 6): the
    findings list collapses `findings-1`/`findings-2` chunks into one list,
    the tally and submit label track the checked set, tier groups show their
    counts, and the verdict renders as gate choices with the recommended
    badge. Mirrors gate-form-skip-dom.test.tsx's direct-mount harness rather
    than a full Board render, since the sheet is host-agnostic (Task 7 wires
    it into DecisionQueueModal). */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { gateDraftKey } from '@mattstack/gate-kit/react';
import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { useGateForm } from '../GateForm.tsx';
import { isReviewSheetGate, ReviewGateSheet } from '../ReviewGateSheet.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const GATE: GateRow = {
  gateId: 'g-review',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1,
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      options: [
        {
          value: 'f1',
          label: '[Critical] SQL built from unsanitized input',
          description: 'lib/db/query.ts:42 · parameterize the query',
        },
        {
          value: 'f2',
          label: '[Important] Missing null check on response',
          description:
            'lib/api/client.ts:88 · guard before dereferencing · kind:bug',
        },
        {
          value: 'f3',
          label: '[Important] Inconsistent error wording',
          description: 'lib/errors.ts:15 · align with the style guide',
        },
        {
          value: 'f4',
          label: '[Minor] Unused import',
          description: 'lib/utils.ts:3 · drop the dead import',
        },
      ],
    },
    {
      id: 'findings-2',
      label: 'Post which findings to !31?',
      multi: true,
      options: [
        {
          value: 'f5',
          label: '[Important] Retry loop lacks backoff',
          description: 'lib/retry.ts:41 · add exponential backoff',
        },
        {
          value: 'f6',
          label: '[Minor] Inconsistent spacing',
          description: 'lib/format.ts:9 · run prettier',
        },
      ],
    },
    {
      id: 'outcome',
      label: 'Verdict on !31',
      multi: false,
      options: [
        { value: 'approve', label: 'approve (recommended)' },
        { value: 'comment', label: 'comment' },
      ],
    },
  ],
};

const TIER_GATE: GateRow = {
  ...GATE,
  gateId: 'g-tier',
  questions: [
    {
      id: 'tiers',
      label: 'Post which findings?',
      multi: true,
      options: [{ value: 'Minor', label: 'Minor (4)' }],
    },
  ],
};

/** Neither option carries a "(recommended)" suffix; the recommendation
    lives only in gate.context (design doc §3's "gate-level --context
    carries the readiness line"), the way a real wrapper-built outcome
    question sections it (GateForm.tsx's own sectionFor path). */
const CONTEXT_GATE: GateRow = {
  ...GATE,
  gateId: 'g-context',
  context:
    '=== outcome verdict: with-fixes -> recommend comment ===\n' +
    'Holding for the flaky suite fix before approving.',
  questions: [
    ...GATE.questions.slice(0, 2),
    {
      id: 'outcome',
      label: 'Verdict on !31',
      multi: false,
      options: [
        { value: 'approve', label: 'approve' },
        { value: 'comment', label: 'comment' },
      ],
    },
  ],
};

const MR = {
  iid: 31,
  title: 'themed gate controls',
  webUrl: 'https://gitlab.example.com/acme/widgets/-/merge_requests/31',
  author: { username: 'paul', name: 'Paul' },
  sourceBranch: 'board-28-themed-gate-controls',
  targetBranch: 'main',
  createdAt: '2026-09-17T00:00:00.000Z',
  diff: { additions: 40, deletions: 12, filesChanged: 3 },
} as unknown as BoardMRWithReview;

const QUEUE = {
  index: 1,
  total: 3,
  states: ['done', 'active', 'todo'] as const,
  onPrev: () => {},
  onNext: () => {},
};

function Host({ gate = GATE }: { gate?: GateRow }) {
  const form = useGateForm(gate);
  return (
    <ReviewGateSheet
      gate={gate}
      mr={MR}
      form={form}
      queue={{ ...QUEUE, states: [...QUEUE.states] }}
      onClose={() => {}}
      onSkip={() => {}}
      onFocusPane={() => {}}
    />
  );
}

let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response('no structured review yet', { status: 404 });
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(gate?: GateRow) {
  await React.act(async () => {
    root.render(<Host gate={gate} />);
  });
}

async function click(el: Element) {
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    b => b.textContent?.trim() === text
  );
  if (!found) throw new Error(`no button with text "${text}"`);
  return found as HTMLButtonElement;
}

/** Seeds `useGateForm`'s draft the way DecisionQueueModal.stories.tsx's own
    `seedDraft` does, so a note reaches `form.notes` without simulating a
    keystroke -- happy-dom's `<input>` does not install React's value
    tracker the way it does for a `<textarea>` (row-view-dom.test.tsx's own
    technique), so a synthetic `input` event on this field never reaches
    React's onChange here. The draft is the same path a resumed gate's note
    takes in production, so this exercises the same submit code the note
    field's onChange would otherwise feed. */
function seedDraft(
  gateId: string,
  draft: {
    selections?: Record<string, string | string[]>;
    notes?: Record<string, string>;
    item?: string | null;
  }
) {
  localStorage.setItem(
    gateDraftKey(gateId),
    JSON.stringify({ selections: {}, notes: {}, item: null, ...draft })
  );
}

test('collapses findings-1/findings-2 into one six-row list with a full tally', async () => {
  await render();

  const rows = container.querySelectorAll('.tui-review-finding-row');
  expect(rows.length).toBe(6);

  const tally = container.querySelector('.tui-review-find-tally');
  expect(tally?.textContent).toContain('6 of 6 selected');
});

test('tier group headers show their counts', async () => {
  await render();

  const pills = [...container.querySelectorAll('.tui-review-tier-pill')].map(
    p => p.textContent?.trim()
  );
  expect(pills).toContain('Critical (1)');
  expect(pills).toContain('Important (3)');
  expect(pills).toContain('Minor (2)');
});

test('unchecking a finding updates the tally and the submit label', async () => {
  await render();

  const submitBefore = container.querySelector('.tui-review-submit');
  expect(submitBefore?.textContent).toBe('post 6 · approve');

  const first = container.querySelector(
    '.tui-review-finding-row input[type="checkbox"]'
  ) as HTMLInputElement;
  expect(first.checked).toBe(true);
  await click(first);

  const tally = container.querySelector('.tui-review-find-tally');
  expect(tally?.textContent).toContain('5 of 6 selected');

  const submitAfter = container.querySelector('.tui-review-submit');
  expect(submitAfter?.textContent).toBe('post 5 · approve');
});

test('the verdict renders as gate choices with the recommended badge', async () => {
  await render();

  const choices = container.querySelectorAll(
    '.tui-review-sheet-rail .tui-gate-choice'
  );
  expect(choices.length).toBe(2);

  const radios = [
    ...container.querySelectorAll('.tui-review-sheet-rail input[type=radio]'),
  ] as HTMLInputElement[];
  expect(radios.map(r => r.value).sort()).toEqual(['approve', 'comment']);
  expect(radios.find(r => r.value === 'approve')?.checked).toBe(true);

  const recommended = container.querySelector('[data-gate="recommended"]');
  expect(recommended).not.toBeNull();
  expect(recommended?.textContent?.trim()).toBe('recommended');
});

/** No findings question at all: a clean review still opens the sheet
    (controller ruling, Task 6/7) since there's nothing a tier-option gate
    would have that a bare verdict question doesn't already cover. */
const CLEAN_GATE: GateRow = {
  ...GATE,
  gateId: 'g-clean',
  questions: [GATE.questions[2]!],
};

const RESPOND_GATE: GateRow = {
  ...GATE,
  gateId: 'g-respond',
  kind: 'respond-plan',
};

test('the previous-gate chevron is disabled even when queue.index > 0, since backward queue traversal does not exist', async () => {
  await render(); // QUEUE.index is 1

  const prev = container.querySelector(
    '[aria-label="previous gate"]'
  ) as HTMLButtonElement;
  expect(prev.disabled).toBe(true);
});

test('a clean review labels the submit with the outcome alone, never post 0', async () => {
  await render(CLEAN_GATE);

  expect(buttonByText('approve')).toBeDefined();
  expect(
    [...container.querySelectorAll('button')].some(b =>
      b.textContent?.includes('post 0')
    )
  ).toBe(false);
});

test('isReviewSheetGate is true for a finding-shaped gate and an outcome-only gate, false for a tier-option gate or a respond-plan gate', () => {
  expect(isReviewSheetGate(GATE)).toBe(true);
  expect(isReviewSheetGate(CLEAN_GATE)).toBe(true);
  expect(isReviewSheetGate(TIER_GATE)).toBe(false);
  expect(isReviewSheetGate(RESPOND_GATE)).toBe(false);
});

test('a note on the outcome question posts as {value, note}, not silently dropped', async () => {
  seedDraft(GATE.gateId, { notes: { outcome: 'Merge once CI settles.' } });
  await render();

  const note = container.querySelector(
    '.tui-review-verdict .tui-gate-note'
  ) as HTMLInputElement;
  expect(note.value).toBe('Merge once CI settles.');

  await click(buttonByText('post 6 · approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  expect(answerPost).toBeDefined();
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers.outcome).toEqual({
    value: 'approve',
    note: 'Merge once CI settles.',
  });
  // The note wrap on outcome doesn't disturb the chunk split.
  expect(body.answers.findings).toBeUndefined();
  expect(body.answers['findings-1']).toEqual(['f1', 'f2', 'f3', 'f4']);
  expect(body.answers['findings-2']).toEqual(['f5', 'f6']);
});

test('a blank or whitespace-only note posts the bare selection, not an empty note', async () => {
  seedDraft(GATE.gateId, { notes: { outcome: '   ' } });
  await render();

  await click(buttonByText('post 6 · approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers.outcome).toBe('approve');
});

test('reset re-seeds every finding checked and the recommended outcome, never a bare "post N ·" label', async () => {
  await render();

  const first = container.querySelector(
    '.tui-review-finding-row input[type="checkbox"]'
  ) as HTMLInputElement;
  await click(first);
  const comment = [...container.querySelectorAll('input[type=radio]')].find(
    i => (i as HTMLInputElement).value === 'comment'
  ) as HTMLInputElement;
  await click(comment);

  expect(container.querySelector('.tui-review-submit')?.textContent).toBe(
    'post 5 · comment'
  );

  await click(buttonByText('reset'));

  expect(
    container.querySelector('.tui-review-find-tally')?.textContent
  ).toContain('6 of 6 selected');
  expect(container.querySelector('.tui-review-submit')?.textContent).toBe(
    'post 6 · approve'
  );
  expect(container.querySelector('.tui-review-submit')?.textContent).not.toBe(
    'post 6 · '
  );
});

function checkboxForTitle(title: string): HTMLInputElement {
  const row = [...container.querySelectorAll('.tui-review-finding-row')].find(
    r => r.querySelector('.tui-review-finding-title')?.textContent === title
  );
  if (!row) throw new Error(`no finding row titled "${title}"`);
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

test('submit splits the checked union back into the original findings-1/findings-2 chunks, with an explicit [] for an emptied chunk', async () => {
  await render();

  // Both findings-2 rows unchecked: that chunk posts an explicit [], while
  // findings-1 (untouched) posts its full four-id union.
  await click(checkboxForTitle('Retry loop lacks backoff'));
  await click(checkboxForTitle('Inconsistent spacing'));

  await click(buttonByText('post 4 · approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  expect(answerPost).toBeDefined();
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers).toEqual({
    'findings-1': ['f1', 'f2', 'f3', 'f4'],
    'findings-2': [],
    outcome: 'approve',
  });
  expect(body.answers.findings).toBeUndefined();
});

const MALFORMED_OPTION_GATE: GateRow = {
  ...GATE,
  gateId: 'g-malformed-option',
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      options: [
        {
          value: 'f1',
          label: '[Critical] SQL built from unsanitized input',
          description: 'lib/db/query.ts:42 · parameterize the query',
        },
        // Does not match the `[Tier] title` shape parseFindingOption
        // requires: this is the one malformed row the filter at ~203
        // already drops from `findings`, but findingsQuestion binding used
        // to require every option to parse, hiding the two good ones too.
        { value: 'bad', label: 'not a finding at all' },
        {
          value: 'f2',
          label: '[Important] Missing null check on response',
          description: 'lib/api/client.ts:88 · guard before dereferencing',
        },
      ],
    },
    GATE.questions[2]!,
  ],
};

test('one malformed option in a findings question does not hide the rest: the question still binds and the tally stays honest', async () => {
  await render(MALFORMED_OPTION_GATE);

  const rows = container.querySelectorAll('.tui-review-finding-row');
  expect(rows.length).toBe(2);

  const tally = container.querySelector('.tui-review-find-tally');
  expect(tally?.textContent).toContain('2 of 2 selected');
});

test("a malformed report.json renders the sheet without throwing and skips the record cluster's bad parts", async () => {
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json')) {
      return new Response(
        JSON.stringify({
          depth: 'clean run, one flake unrelated to this change',
          strengths: 'not an array',
          checks: [{ tag: 'PASS' }, { tag: 'FAIL', text: 'real check' }],
          notes: 'also not an array',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await render();
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  const labels = [
    ...container.querySelectorAll('.tui-review-record-label'),
  ].map(l => l.textContent);
  // strengths and notes are dropped whole (not arrays); checks render in the
  // rail's CHECKS card, not the main column, so they never add a label here.
  expect(labels).toEqual(['depth']);
  // The one malformed check entry (missing `text`) is dropped, the
  // well-typed one stays and shows up in the rail card.
  expect(container.textContent).toContain('real check');
  expect(container.textContent).not.toContain('not an array');
});

test('a report whose summary fields are not strings renders without throwing and shows no context lead', async () => {
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json')) {
      return new Response(
        JSON.stringify({
          // an object readiness would throw as a React child unsanitized
          summary: { readiness: { value: 'yes' }, reasoning: 42 },
          depth: 'verify. suite green',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await render();
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  expect(
    container.querySelector('.tui-review-decision-lead')?.textContent ?? ''
  ).not.toContain('object');
  expect(container.textContent).not.toContain('Ready to merge: [object');
  expect(container.textContent).toContain('verify. suite green');
});

test('a verdict recommendation carried in gate.context drives the badge, the default pick, and the decision-card fallback prose', async () => {
  await render(CONTEXT_GATE);

  const recommended = container.querySelector('[data-gate="recommended"]');
  expect(recommended).not.toBeNull();

  const commentRadio = [
    ...container.querySelectorAll('input[type=radio]'),
  ].find(i => (i as HTMLInputElement).value === 'comment') as HTMLInputElement;
  expect(commentRadio.checked).toBe(true);
  expect(container.querySelector('.tui-review-submit')?.textContent).toBe(
    'post 6 · comment'
  );

  const reasoning = container.querySelector('.tui-review-decision-reasoning');
  expect(reasoning?.textContent).toContain('Holding for the flaky suite fix');
});
