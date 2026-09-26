/** DOM-level test for the full-screen review gate sheet: the findings list
    collapses `findings-1`/`findings-2` chunks into one list, the tally and
    submit label track the checked set, tier groups show their counts, and
    the verdict renders as gate choices with the recommended badge. The
    fixtures carry review@1 (gate-level) and findings@1 (per-chunk) contexts,
    the shapes `readReviewGate` actually joins. Mirrors
    gate-form-skip-dom.test.tsx's direct-mount harness rather than a full
    Board render, since the sheet is host-agnostic. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import { gateDraftKey } from '@mattstack/gate-kit/react';
import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { useGateForm } from '../GateForm.tsx';
import { ReviewGateSheet } from '../ReviewGateSheet.tsx';
import {
  installFakeResizeObserver,
  reserveOf,
} from './fake-resize-observer.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const j = (v: unknown) => JSON.stringify(v);

function entry(
  id: string,
  severity: 'critical' | 'important' | 'minor',
  title: string,
  file: string | undefined,
  fix: string | undefined,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    severity,
    title,
    body: `${title}: the full finding text, never truncated.`,
    ...(file !== undefined ? { file } : {}),
    ...(fix !== undefined ? { fix } : {}),
    ...extra,
  };
}

const E = {
  f1: entry(
    'f1',
    'critical',
    'SQL built from unsanitized input',
    'lib/db/query.ts:42',
    'parameterize the query'
  ),
  f2: entry(
    'f2',
    'important',
    'Missing null check on response',
    'lib/api/client.ts:88',
    'guard before dereferencing'
  ),
  f3: entry(
    'f3',
    'important',
    'Inconsistent error wording',
    'lib/errors.ts:15',
    'align with the style guide'
  ),
  f4: entry(
    'f4',
    'minor',
    'Unused import',
    'lib/utils.ts:3',
    'drop the dead import'
  ),
  f5: entry(
    'f5',
    'important',
    'Retry loop lacks backoff',
    'lib/retry.ts:41',
    'add exponential backoff'
  ),
  f6: entry(
    'f6',
    'minor',
    'Inconsistent spacing',
    'lib/format.ts:9',
    'run prettier'
  ),
};

const findingsCtx = (...entries: object[]) =>
  j({ 'gate-ctx': 'findings@1', findings: entries });

const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary: 'One critical injection path; the rest are cleanups.',
  findings: { critical: 1, important: 3, minor: 2 },
};

const GATE: GateRow = {
  gateId: 'g-review',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1,
  context: j(REVIEW),
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(E.f1, E.f2, E.f3, E.f4),
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
      context: findingsCtx(E.f5, E.f6),
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
  canNext: true,
  onPrev: () => {},
  onNext: () => {},
};

function Host({
  gate = GATE,
  queueIndex = QUEUE.index,
  onPrev = () => {},
  onContinue = () => {},
}: {
  gate?: GateRow;
  queueIndex?: number;
  onPrev?: () => void;
  onContinue?: () => void;
}) {
  const form = useGateForm(gate);
  return (
    <ReviewGateSheet
      gate={gate}
      mr={MR}
      form={form}
      queue={{
        ...QUEUE,
        index: queueIndex,
        canPrev: queueIndex > 0,
        states: [...QUEUE.states],
        onPrev,
      }}
      onClose={() => {}}
      onContinue={onContinue}
      onFocusPane={() => {}}
    />
  );
}

let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;
let answeredElsewhere: boolean;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  answeredElsewhere = false;
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response('no structured review yet', { status: 404 });
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (answeredElsewhere && url === '/gate/answer')
      return new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          row: { answer: { answers: {}, by: 'pane' } },
        }),
        { status: 409 }
      );
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

async function render(
  gate?: GateRow,
  hostProps?: {
    queueIndex?: number;
    onPrev?: () => void;
    onContinue?: () => void;
  }
) {
  await React.act(async () => {
    root.render(<Host gate={gate} {...hostProps} />);
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

  const tally = container.querySelector('.tui-sheet-list-tally');
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

  const submitBefore = container.querySelector('.tui-sheet-submit');
  expect(submitBefore?.textContent).toBe('post 6 · approve');

  const first = container.querySelector(
    '.tui-review-finding-row input[type="checkbox"]'
  ) as HTMLInputElement;
  expect(first.checked).toBe(true);
  await click(first);

  const tally = container.querySelector('.tui-sheet-list-tally');
  expect(tally?.textContent).toContain('5 of 6 selected');

  const submitAfter = container.querySelector('.tui-sheet-submit');
  expect(submitAfter?.textContent).toBe('post 5 · approve');
});

test('the verdict radios form one radio group named by the question', async () => {
  await render();
  const group = container.querySelector(
    '[role="radiogroup"][aria-label="Verdict on !31"]'
  );
  expect(group?.querySelectorAll('input[type="radio"]').length).toBe(2);
});

test('the verdict renders as gate choices with the recommended badge', async () => {
  await render();

  const choices = container.querySelectorAll(
    '.tui-sheet-rail .tui-gate-choice'
  );
  expect(choices.length).toBe(2);

  const radios = [
    ...container.querySelectorAll('.tui-sheet-rail input[type=radio]'),
  ] as HTMLInputElement[];
  expect(radios.map(r => r.value).sort()).toEqual(['approve', 'comment']);
  expect(radios.find(r => r.value === 'approve')?.checked).toBe(true);

  const recommended = container.querySelector('[data-gate="recommended"]');
  expect(recommended).not.toBeNull();
  expect(recommended?.textContent?.trim()).toBe('recommended');
});

/** No findings question at all: the outcome question rides alone, and the
    sheet still renders since `readReviewGate`'s join only touches
    `findings-N` chunks when the gate actually has one. */
const CLEAN_GATE: GateRow = {
  ...GATE,
  gateId: 'g-clean',
  context: j({
    'gate-ctx': 'review@1',
    readiness: 'yes',
    summary: 'Nothing worth a thread.',
    findings: {},
  }),
  questions: [GATE.questions[2]!],
};

test('the previous-gate chevron is enabled past the first gate and calls its handler', async () => {
  let calls = 0;
  await render(undefined, {
    queueIndex: 1,
    onPrev: () => {
      calls++;
    },
  });

  const prev = container.querySelector(
    '[aria-label="previous gate"]'
  ) as HTMLButtonElement;
  expect(prev.disabled).toBe(false);
  await click(prev);
  expect(calls).toBe(1);
});

test('the previous-gate chevron is disabled at the first gate', async () => {
  await render(undefined, { queueIndex: 0 });

  const prev = container.querySelector(
    '[aria-label="previous gate"]'
  ) as HTMLButtonElement;
  expect(prev.disabled).toBe(true);
});

test('the head carries no skip-gate chip', async () => {
  await render();
  expect(
    [...container.querySelectorAll('button')].some(
      b => b.textContent?.trim() === 'skip gate'
    )
  ).toBe(false);
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

test('a note on the outcome question posts as {value, note}, not silently dropped', async () => {
  seedDraft(GATE.gateId, { notes: { outcome: 'Merge once CI settles.' } });
  await render();

  const note = container.querySelector(
    '.tui-sheet-dock .tui-gate-note'
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

test('a gate answered elsewhere offers continue, which retires it from the queue', async () => {
  answeredElsewhere = true;
  let continues = 0;
  await render(undefined, {
    onContinue: () => {
      continues++;
    },
  });
  await click(buttonByText('post 6 · approve'));
  expect(container.querySelector('.tui-sheet-lost')!.textContent).toContain(
    'answered elsewhere'
  );
  await click(buttonByText('continue'));
  expect(continues).toBe(1);
});

test('an unchunked findings question posts its answer under its own id', async () => {
  const unchunked: GateRow = {
    ...GATE,
    gateId: 'g-unchunked',
    context: j({ ...REVIEW, findings: { important: 1, minor: 1 } }),
    questions: [
      {
        ...GATE.questions[1]!,
        id: 'findings',
      },
      GATE.questions[2]!,
    ],
  };
  await render(unchunked);

  await click(buttonByText('post 2 · approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers).toEqual({ findings: ['f5', 'f6'], outcome: 'approve' });
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

  expect(container.querySelector('.tui-sheet-submit')?.textContent).toBe(
    'post 5 · comment'
  );

  await click(buttonByText('reset'));

  expect(
    container.querySelector('.tui-sheet-list-tally')?.textContent
  ).toContain('6 of 6 selected');
  expect(container.querySelector('.tui-sheet-submit')?.textContent).toBe(
    'post 6 · approve'
  );
  expect(container.querySelector('.tui-sheet-submit')?.textContent).not.toBe(
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

const RE_REVIEW_GATE: GateRow = {
  ...GATE,
  gateId: 'g-re-review',
  context: j({
    ...REVIEW,
    summary: 'One important finding carried over; the rest are cleanups.',
    findings: { critical: 0, important: 1, minor: 2 },
    round: 2,
    re_review: true,
    prior: { addressed: 3, still_open: 1 },
  }),
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(
        { ...E.f2, disposition: 'still-open' },
        { ...E.f4, disposition: 'new' },
        entry('f7', 'minor', 'Changelog entry missing', undefined, undefined, {
          disposition: 'addressed-check',
        })
      ),
      options: [
        GATE.questions[0]!.options[1]!,
        GATE.questions[0]!.options[3]!,
        {
          value: 'f7',
          label: '[Minor] Changelog entry missing',
          description: 'not inline-anchorable',
        },
      ],
    },
    GATE.questions[2]!,
  ],
};

test('a row reads title, accent file:line, the full body, and the fix line, in that order', async () => {
  await render();
  const row = container.querySelector('.tui-review-finding-row')!;
  const parts = [
    ...row.querySelectorAll(
      '.tui-review-finding-title, .tui-review-finding-anchor, .tui-review-finding-text, .tui-review-finding-fix'
    ),
  ].map(el => el.className);
  expect(parts).toEqual([
    'tui-review-finding-title',
    'tui-review-finding-anchor',
    'tui-review-finding-text',
    'tui-review-finding-fix',
  ]);
  expect(row.querySelector('.tui-review-finding-title')!.textContent).toBe(
    'SQL built from unsanitized input'
  );
  expect(row.querySelector('.tui-review-finding-anchor')!.textContent).toBe(
    'lib/db/query.ts:42'
  );
  expect(row.querySelector('.tui-review-finding-text')!.textContent).toContain(
    'SQL built from unsanitized input: the full finding text, never truncated.'
  );
  expect(row.querySelector('.tui-review-finding-fix')!.textContent).toBe(
    'parameterize the query'
  );
});

test("a finding row's checkbox is labelled by the title alone, not the whole row", async () => {
  await render();
  const row = container.querySelector('.tui-review-finding-row')!;
  const checkbox = row.querySelector('input[type="checkbox"]')!;
  const labelledBy = checkbox.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  const label = document.getElementById(labelledBy!);
  expect(label).toBe(row.querySelector('.tui-review-finding-title'));
  expect(label!.textContent).toBe('SQL built from unsanitized input');
});

/** findings-1's first option is a minor finding, not the critical one GATE
    leads with: a grouping that follows first-appearance order would put
    Minor first here, so this is the case that actually distinguishes
    severity order from arrival order. */
const MINOR_FIRST_GATE: GateRow = {
  ...GATE,
  gateId: 'g-minor-first',
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(E.f1, E.f2, E.f3, E.f4),
      options: [
        GATE.questions[0]!.options[3]!,
        GATE.questions[0]!.options[0]!,
        GATE.questions[0]!.options[1]!,
        GATE.questions[0]!.options[2]!,
      ],
    },
    GATE.questions[1]!,
    GATE.questions[2]!,
  ],
};

test('groups follow the severity order, whatever order the options arrive in', async () => {
  await render(MINOR_FIRST_GATE);
  const groups = [
    ...container.querySelectorAll(
      '.tui-review-tier-group .tui-review-tier-pill'
    ),
  ].map(p => p.textContent);
  expect(groups).toEqual(['Critical (1)', 'Important (3)', 'Minor (2)']);
});

test('a row with no file shows no anchor line, and no pill without a disposition', async () => {
  await render(RE_REVIEW_GATE);
  const rows = [...container.querySelectorAll('.tui-review-finding-row')];
  const changelog = rows.find(r =>
    r.textContent?.includes('Changelog entry missing')
  )!;
  expect(changelog.querySelector('.tui-review-finding-anchor')).toBeNull();
  await render();
  expect(
    container.querySelector('.tui-review-finding-row [data-disposition]')
  ).toBeNull();
});

test('a disposition renders as a small state pill on its row', async () => {
  await render(RE_REVIEW_GATE);
  const pills = Object.fromEntries(
    [
      ...container.querySelectorAll(
        '.tui-review-finding-row [data-disposition]'
      ),
    ].map(p => [
      p.getAttribute('data-disposition'),
      [p.textContent, p.getAttribute('data-hue')],
    ])
  );
  expect(pills).toEqual({
    'still-open': ['still open', 'amber'],
    new: ['new', 'accent'],
    'addressed-check': ['confirm fix', 'green'],
  });
});

test('the decision card reads readiness, summary, counts, and the re-review line from review@1', async () => {
  await render(RE_REVIEW_GATE);
  expect(container.querySelector('.tui-sheet-context-lead')!.textContent).toBe(
    'Ready to merge: with fixes'
  );
  expect(
    container.querySelector('.tui-sheet-context-reasoning')!.textContent
  ).toContain('One important finding carried over; the rest are cleanups.');
  expect(container.querySelector('.tui-sheet-context-meta')!.textContent).toBe(
    'renee · round 2 · 3 addressed, 1 still open'
  );
  const railPills = [
    ...container.querySelectorAll(
      '.tui-sheet-context-card .tui-review-tier-pill'
    ),
  ].map(p => p.textContent);
  expect(railPills).toEqual(['Important (1)', 'Minor (2)']);
});

test('a first-round review has no meta line beyond the reviewer', async () => {
  await render();
  expect(container.querySelector('.tui-sheet-context-meta')!.textContent).toBe(
    'renee'
  );
});

test("report.json's summary never reaches the decision card", async () => {
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response(
        JSON.stringify({
          summary: { readiness: 'no', reasoning: 'from the report file' },
          depth: 'verify. suite green',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await render();
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(container.querySelector('.tui-sheet-context-lead')!.textContent).toBe(
    'Ready to merge: with fixes'
  );
  expect(container.textContent).not.toContain('from the report file');
  expect(container.textContent).toContain('verify. suite green');
});

test('a gate the join rejects renders nothing', async () => {
  await render({ ...GATE, context: 'prose' });
  expect(container.querySelector('.tui-review-sheet')).toBeNull();
});

test('the verdict dock and the lost panel each reserve their height on the scroller', async () => {
  const restore = installFakeResizeObserver();
  try {
    answeredElsewhere = true;
    await render();
    expect(await reserveOf('.tui-sheet-dock', 294)).toBe('294px');
    await click(buttonByText('post 6 · approve'));
    expect(await reserveOf('.tui-sheet-lost', 332)).toBe('332px');
  } finally {
    restore();
  }
});
