/** Every gate that is neither a respond nor a review gate opens the same
    two-column sheet: all of its questions stacked in the main column, the
    MR card and the decision context in the rail, and the answer docked
    under them. A pane-attention notice shows the pane's prompt as terminal
    text and answers with one big action plus quiet text actions. */

import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateDomain } from '@mattstack/gate-kit';
import { answersFromForm, noteFieldName } from '@mattstack/gate-kit/react';
import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';
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

const MR = {
  iid: 1235,
  title: 'add a temperature factor',
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1235',
  sourceBranch: 'temperature-factor',
  targetBranch: 'main',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  author: { username: 'jvasquez', name: 'Joel Vasquez' },
  pipelineState: 'passed',
  blockers: { any: false, hasConflicts: false },
  reviews: { isApproved: false, given: 0, required: 1 },
} as unknown as BoardMRWithReview;

function ship(overrides: Partial<GateRow> = {}): GateRow {
  return {
    gateId: 'g-ship',
    subject: 'run:20260923-0900-demo',
    kind: 'ship',
    label: 'ship',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: 'Three commits are ready.\n\n- Branch: `share-link-guard`',
    origin: { paneId: 'pane-9', worktree: '/work/demo' },
    questions: [
      {
        id: 'handoff',
        label: 'How do we hand off?',
        multi: false,
        options: [
          {
            value: 'hand-back',
            label: 'Hand back (Recommended). I give you the branch.',
          },
          { value: 'hold', label: 'Hold the run here.' },
        ],
      },
      {
        id: 'preview',
        label: 'Which preview environments?',
        multi: true,
        options: [
          { value: 'preview-a', label: 'preview-a (Recommended)' },
          { value: 'preview-b', label: 'preview-b' },
        ],
      },
      {
        id: 'draft',
        label: 'Draft or ready?',
        multi: false,
        options: ['draft', 'ready'],
      },
    ],
    ...overrides,
  };
}

const RULE = '─'.repeat(60);
const SCREEN = [
  'Ran the suite, all green.',
  '',
  'Entering worktree(harbor)',
  RULE,
  ' Tool use',
  '   Entering worktree(harbor)',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
].join('\n');

function pane(
  reason: 'blocked' | 'gone',
  overrides: Partial<GateRow> = {}
): GateRow {
  return {
    gateId: 'g-pane',
    subject: 'agent:pane-1',
    kind: 'pane-attention',
    label: 'pane-attention',
    status: 'open',
    openedAt: Date.now() - 60_000,
    context: SCREEN,
    meta: { agentId: 'agent-1', paneRef: 'w18:p1', reason },
    questions: [
      {
        id: 'action',
        label: 'Pane needs attention',
        multi: false,
        options: ['focus-pane', 'resume', 'clear', 'dismiss'],
      },
    ],
    ...overrides,
  };
}

let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;
let answeredElsewhere: boolean;
let focusFails: boolean;
let continues: number;
let answeredCount: number;
let focused: Array<{ iid: number; domain: GateDomain }>;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  answeredElsewhere = false;
  focusFails = false;
  continues = 0;
  answeredCount = 0;
  focused = [];
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (focusFails && url === '/gate/focus')
      return new Response(JSON.stringify({ error: 'pane w18:p1 is gone' }), {
        status: 404,
      });
    if (answeredElsewhere && url === '/gate/answer')
      return new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          row: { answer: { answers: { draft: 'ready' }, by: 'pane' } },
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

async function render(row: GateRow, mr?: BoardMRWithReview) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={row}
        mr={mr}
        position={1}
        states={['active']}
        onClose={() => {}}
        onNext={() => {}}
        onBack={() => {}}
        onFocusPane={(m, domain) => {
          focused.push({ iid: m.iid, domain });
        }}
        onAnswered={() => {
          answeredCount++;
        }}
        onContinue={() => {
          continues++;
        }}
      />
    );
  });
}

const $ = (selector: string) => document.body.querySelector(selector);
const $$ = (selector: string) => [...document.body.querySelectorAll(selector)];
const text = (selector: string) => $(selector)?.textContent?.trim() ?? '';

async function click(el: Element | null) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

const pick = (value: string) => click($(`input[value="${value}"]`));

async function type(label: string, value: string) {
  const input = $(`input[aria-label="${label}"]`) as HTMLInputElement;
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const submit = () => $('.tui-sheet-submit') as HTMLButtonElement;
const answerPosts = () => posts.filter(p => p.url === '/gate/answer');
const dockRows = () =>
  $$('.tui-sheet-dock .tui-sheet-card-row').map(r => [
    r.querySelector('.tui-sheet-card-chip')?.textContent,
    r.querySelector('.tui-sheet-card-text')?.textContent,
  ]);

test('a stage gate stacks every question in the main column beside the rail', async () => {
  await render(ship(), MR);
  expect($('.tui-stage-sheet .tui-sheet-body')).not.toBeNull();
  expect(
    $$('.tui-sheet-main .tui-gate-question').map(
      q => q.querySelector('.tui-gate-question-label')?.textContent
    )
  ).toEqual([
    'How do we hand off?',
    'Which preview environments?',
    'Draft or ready?',
  ]);
  expect($$('.tui-sheet-main button')).toEqual([]);
  expect(text('.tui-sheet-list-title')).toBe('Ship: 3 questions');
  expect(text('.tui-sheet-list-tally')).toBe('0 of 3 answered');
  expect(text('.tui-gate-sheet-tag')).toBe('ship');
  expect(text('.tui-sheet-dock-heading')).toBe('Answers on !1235');
  expect(dockRows()).toEqual([
    ['…', 'How do we hand off?'],
    ['…', 'Which preview environments?'],
    ['…', 'Draft or ready?'],
  ]);
});

test('a stage dock row holds one line and carries its full question as a title', async () => {
  await render(ship(), MR);
  expect(
    $$('.tui-sheet-dock [data-card="answers"] .tui-sheet-card-text').map(t =>
      t.getAttribute('title')
    )
  ).toEqual([
    'How do we hand off?',
    'Which preview environments?',
    'Draft or ready?',
  ]);
  const css = readFileSync(join(import.meta.dir, '../../../style.css'), 'utf8');
  const rule =
    /\.tui-sheet-card-list\[data-card='answers'\] \.tui-sheet-card-text\s*\{([^}]*)\}/.exec(
      css
    )?.[1] ?? '';
  expect(rule).toContain('white-space: nowrap');
  expect(rule).toContain('text-overflow: ellipsis');
  expect(rule).toContain('overflow: hidden');
  expect(
    /^\.tui-sheet-card-text\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
  ).not.toContain('nowrap');
});

test('one question reads in the singular', async () => {
  await render(ship({ questions: ship().questions.slice(2, 3) }));
  expect(text('.tui-sheet-list-title')).toBe('Ship: 1 question');
});

test('a mid-label recommended marker becomes the label, the chip and the subtitle', async () => {
  await render(ship(), MR);
  const choice = $('input[value="hand-back"]')!.closest('.tui-gate-choice')!;
  expect(
    choice.querySelector('.tui-gate-choice-label-row > span')?.textContent
  ).toBe('Hand back');
  expect(choice.querySelector('[data-gate="recommended"]')).not.toBeNull();
  expect(choice.querySelector('.tui-gate-choice-subtitle')?.textContent).toBe(
    'I give you the branch.'
  );
  const multi = $('input[value="preview-a"]')!.closest('.tui-gate-choice')!;
  expect(
    multi.querySelector('.tui-gate-choice-label-row > span')?.textContent
  ).toBe('preview-a');
  expect(multi.querySelector('[data-gate="recommended"]')).not.toBeNull();
  expect(multi.querySelector('.tui-gate-choice-subtitle')).toBeNull();
});

test("submit waits for every single-select, then posts the answer gate-kit's answersFromForm builds", async () => {
  const gate = ship();
  await render(gate, MR);
  expect(submit().disabled).toBe(true);
  await pick('hand-back');
  await pick('preview-a');
  await type('Note for How do we hand off?', '  push after lunch ');
  expect(submit().disabled).toBe(true);
  await pick('draft');
  expect(submit().disabled).toBe(false);
  expect(text('.tui-sheet-list-tally')).toBe('3 of 3 answered');
  expect(dockRows().map(([chip]) => chip)).toEqual([
    'Hand back',
    'preview-a',
    'draft',
  ]);
  await click(submit());

  const form = new FormData();
  form.set('handoff', 'hand-back');
  form.set(noteFieldName('handoff'), '  push after lunch ');
  form.append('preview', 'preview-a');
  form.set('draft', 'draft');
  const gateForm = answersFromForm(gate, form);
  expect(answerPosts()).toEqual([
    { url: '/gate/answer', body: { gateId: 'g-ship', ...gateForm } },
  ]);
  expect(gateForm).toEqual({
    answers: {
      handoff: { value: 'hand-back', note: 'push after lunch' },
      preview: ['preview-a'],
      draft: 'draft',
    },
  });
});

test('a multi left empty submits an empty list, matching answersFromForm', async () => {
  const gate = ship();
  await render(gate);
  await pick('hold');
  await pick('ready');
  await type('Note for Which preview environments?', 'none needed');
  expect(dockRows()[1]![0]).toBe('…');
  await click(submit());
  const form = new FormData();
  form.set('handoff', 'hold');
  form.set('draft', 'ready');
  form.set(noteFieldName('preview'), 'none needed');
  expect(answerPosts()[0]!.body).toEqual({
    gateId: 'g-ship',
    ...answersFromForm(gate, form),
  });
  expect(answerPosts()[0]!.body).toEqual({
    gateId: 'g-ship',
    answers: {
      handoff: 'hold',
      preview: { value: [], note: 'none needed' },
      draft: 'ready',
    },
  });
});

test('multi picks post in option order, whatever order they were clicked in', async () => {
  const gate = ship();
  await render(gate);
  await pick('hand-back');
  await pick('preview-b');
  await pick('preview-a');
  await pick('draft');
  await click(submit());
  const form = new FormData();
  form.set('handoff', 'hand-back');
  form.append('preview', 'preview-a');
  form.append('preview', 'preview-b');
  form.set('draft', 'draft');
  expect(answerPosts()[0]!.body).toEqual({
    gateId: 'g-ship',
    ...answersFromForm(gate, form),
  });
  expect(
    (answerPosts()[0]!.body as { answers: Record<string, unknown> }).answers[
      'preview'
    ]
  ).toEqual(['preview-a', 'preview-b']);
});

const CANT_ANSWER =
  "This gate needs an answer the board can't give; answer it in its pane.";
const dockNote = () => text('.tui-sheet-dock .tui-sheet-dock-next');

test('a gate with no questions offers no submit and says why', async () => {
  await render(ship({ questions: [] }));
  expect(submit().disabled).toBe(true);
  expect(dockNote()).toBe(CANT_ANSWER);
  await click(submit());
  expect(answerPosts()).toEqual([]);
});

test('a gate whose every question has no options offers no submit and says why', async () => {
  await render(
    ship({
      questions: [
        { id: 'why', label: 'Why hold?', multi: false, options: [] },
        { id: 'what', label: 'What next?', multi: false, options: [] },
      ],
    })
  );
  expect(submit().disabled).toBe(true);
  expect(dockNote()).toBe(CANT_ANSWER);
});

test('one question with no options blocks submit even once the rest are answered', async () => {
  await render(
    ship({
      questions: [
        ...ship().questions.slice(2, 3),
        { id: 'why', label: 'Why hold?', multi: false, options: [] },
      ],
    })
  );
  await pick('draft');
  expect(submit().disabled).toBe(true);
  expect(dockNote()).toBe(CANT_ANSWER);
  await click(submit());
  expect(answerPosts()).toEqual([]);
});

test('an answerable gate carries no such note', async () => {
  await render(ship());
  expect($('.tui-sheet-dock .tui-sheet-dock-next')).toBeNull();
});

test('a multi checked then cleared never blocks submit and answers with an empty list', async () => {
  const gate = ship({ questions: ship().questions.slice(1, 3) });
  await render(gate);
  await pick('preview-a');
  await pick('preview-a');
  expect(submit().disabled).toBe(true);
  await pick('draft');
  expect(submit().disabled).toBe(false);
  await click(submit());
  expect(answerPosts().map(p => p.body)).toEqual([
    { gateId: 'g-ship', answers: { preview: [], draft: 'draft' } },
  ]);
  expect(answeredCount).toBe(1);
});

test("a question's own context and an option's description render on its card; a plain question carries neither", async () => {
  await render(
    ship({
      questions: [
        {
          id: 'outcome',
          label: 'Verdict',
          multi: false,
          context: 'The reviewer flagged a possible race condition.',
          options: [
            {
              value: 'approve',
              label: 'Approve',
              description: 'Ship as-is, no changes requested.',
            },
            { value: 'comment', label: 'Comment' },
          ],
        },
        {
          id: 'tiers',
          label: 'Which severities?',
          multi: true,
          options: ['Major', 'Minor'],
        },
      ],
    })
  );
  const [first, second] = $$('.tui-sheet-main .tui-gate-question');
  expect(first!.querySelector('.tui-gate-question-context')?.textContent).toBe(
    'The reviewer flagged a possible race condition.'
  );
  expect(
    [...first!.querySelectorAll('.tui-gate-choice-subtitle')].map(
      n => n.textContent
    )
  ).toEqual(['Ship as-is, no changes requested.']);
  expect(second!.querySelector('.tui-gate-question-context')).toBeNull();
  expect(second!.querySelector('.tui-gate-choice-subtitle')).toBeNull();
});

test('a review@1 gate context reads as flattened prose in the rail, never raw JSON', async () => {
  await render(
    ship({
      context: JSON.stringify({
        'gate-ctx': 'review@1',
        readiness: 'yes',
        summary: 'nothing worth a thread.',
        findings: {},
      }),
    })
  );
  const card = $('.tui-sheet-context-card')!;
  expect(card.textContent).toContain('Ready to merge: yes');
  expect(card.textContent).toContain('nothing worth a thread.');
  expect(document.body.textContent).not.toContain('gate-ctx');
});

test('a structured gate context with no card of its own shows nothing raw', async () => {
  await render(
    ship({
      context: JSON.stringify({
        'gate-ctx': 'replies@1',
        replies: [{ thread: 't1', file: 'a.ts:1', verb: 'reply', text: 'x' }],
      }),
    })
  );
  expect($('.tui-sheet-context-card .tui-sheet-context-reasoning')).toBeNull();
  expect(text('.tui-sheet-context-card .tui-sheet-context-meta')).toContain(
    'run:20260923-0900-demo'
  );
  expect(document.body.textContent).not.toContain('gate-ctx');
});

test('picking two multis reads as a count in the dock', async () => {
  await render(ship());
  await pick('preview-a');
  await pick('preview-b');
  expect(dockRows()[1]![0]).toBe('2 picked');
  await pick('preview-a');
  await pick('preview-b');
  expect(dockRows()[1]![0]).toBe('none');
});

test('reset clears every pick and note', async () => {
  await render(ship());
  await pick('hand-back');
  await type('Note for How do we hand off?', 'later');
  await click($('.tui-sheet-reset'));
  expect(($('input[value="hand-back"]') as HTMLInputElement).checked).toBe(
    false
  );
  expect(
    ($('input[aria-label="Note for How do we hand off?"]') as HTMLInputElement)
      .value
  ).toBe('');
  expect(text('.tui-sheet-list-tally')).toBe('0 of 3 answered');
});

test('with no MR the rail opens on the context card and the dock names the subject', async () => {
  await render(ship());
  expect($('.tui-mr-card')).toBeNull();
  const first = $('.tui-sheet-rail-scroll')!.firstElementChild!;
  expect(first.className).toContain('tui-sheet-context-card');
  expect(first.querySelector('.tui-sheet-context-label')?.textContent).toBe(
    'decision context'
  );
  expect(first.textContent).toContain('Three commits are ready.');
  expect(first.querySelector('code')?.textContent).toBe('share-link-guard');
  expect(text('.tui-sheet-dock-heading')).toBe(
    'Answers on run:20260923-0900-demo'
  );
});

test('a gate with no context still fills its context card with a meta line', async () => {
  await render(ship({ context: undefined }));
  const card = $('.tui-sheet-context-card')!;
  expect(card.querySelector('.tui-sheet-context-label')?.textContent).toBe(
    'decision context'
  );
  expect(card.querySelector('.tui-sheet-context-meta')?.textContent).toContain(
    'run:20260923-0900-demo'
  );
});

test('a wait-style gate reads its context and pane from meta', async () => {
  await render(
    ship({
      kind: 'login',
      label: 'login',
      context: undefined,
      origin: undefined,
      meta: {
        presentation: 'wait',
        context: 'I need an interactive login at http://localhost:4001.',
        paneId: 'w4:pC',
        worktree: '/work/aspen',
      },
    })
  );
  const card = $('.tui-sheet-context-card')!;
  expect(
    card.querySelector('.tui-sheet-context-reasoning')?.textContent?.trim()
  ).toBe('I need an interactive login at http://localhost:4001.');
  expect(card.querySelector('.tui-sheet-context-meta')?.textContent).toContain(
    'aspen · w4:pC'
  );
  const focus = $$('.tui-gate-sheet-actions button').find(
    b => b.textContent?.trim() === 'focus pane'
  ) as HTMLButtonElement;
  expect(focus.disabled).toBe(false);
  await click(focus);
  expect(posts.filter(p => p.url === '/gate/focus')).toEqual([
    { url: '/gate/focus', body: { gateId: 'g-ship' } },
  ]);
});

test('with an MR the rail opens on the MR card', async () => {
  await render(ship(), MR);
  const first = $('.tui-sheet-rail-scroll')!.firstElementChild!;
  expect(first.className).toContain('tui-mr-card');
  expect(first.textContent).toContain('add a temperature factor');
});

test('parked and escalated chips ride the head', async () => {
  await render(ship({ status: 'parked', escalatedAt: 5 }), MR);
  expect($('.tui-gate-sheet-actions [data-gate="parked"]')).not.toBeNull();
  expect($('.tui-gate-sheet-actions [data-gate="escalated"]')).not.toBeNull();
});

test('a gate answered elsewhere swaps the rail for the winning answer and continue', async () => {
  answeredElsewhere = true;
  await render(ship({ questions: ship().questions.slice(2, 3) }), MR);
  await pick('draft');
  await click(submit());
  expect(text('.tui-sheet-rail .tui-gate-error')).toBe('answered elsewhere');
  expect($('.tui-sheet-dock')).toBeNull();
  const cont = $$('.tui-sheet-rail button').find(
    b => b.textContent?.trim() === 'continue'
  );
  await click(cont ?? null);
  expect(continues).toBe(1);
});

test("a failed focus from the head shows the daemon's reason in the stage dock", async () => {
  focusFails = true;
  await render(ship(), MR);
  const focus = $$('.tui-gate-sheet-actions button').find(
    b => b.textContent?.trim() === 'focus pane'
  );
  await click(focus ?? null);
  expect(text('.tui-sheet-dock .tui-gate-error')).toBe('pane w18:p1 is gone');
});

test('a failed submit says nothing was sent', async () => {
  (globalThis as { fetch: unknown }).fetch = async () =>
    new Response('{}', { status: 500 });
  await render(ship({ questions: ship().questions.slice(2, 3) }));
  await pick('draft');
  await click(submit());
  expect(text('.tui-sheet-dock .tui-gate-error')).toBe(
    'submit failed... nothing was sent, try again'
  );
});

test('a blocked pane shows its prompt as terminal text with earlier output folded away', async () => {
  await render(pane('blocked'), MR);
  expect($('.tui-pane-sheet .tui-sheet-body')).not.toBeNull();
  expect(text('.tui-gate-sheet-tag')).toBe('pane blocked');
  expect(text('.tui-sheet-list-title')).toBe('Pane waiting on a prompt');
  const card = $('.tui-sheet-main .tui-gate-question')!;
  expect(card.querySelector('.tui-gate-question-label')?.textContent).toBe(
    'Claude Code is asking'
  );
  const screen = card.querySelector('pre.tui-pane-screen')!;
  expect(screen.textContent).toBe(
    [
      ' Tool use',
      '   Entering worktree(harbor)',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
    ].join('\n')
  );
  expect($('.tui-sheet-main [data-part="markdown"]')).toBeNull();
  const head = $('.tui-sheet-main [aria-label="expand earlier pane output"]')!;
  expect(head.getAttribute('aria-expanded')).toBe('false');
  expect(head.textContent).toBe('earlier pane output');
  expect(
    $('.tui-sheet-main .tui-disclosure pre.tui-pane-screen')?.textContent
  ).toBe(
    ['Ran the suite, all green.', '', 'Entering worktree(harbor)'].join('\n')
  );
  await click(head);
  expect(
    $('.tui-sheet-main [aria-label="collapse earlier pane output"]')
  ).not.toBeNull();
});

test('the pane screen block is monospace and keeps its line breaks', () => {
  const css = readFileSync(join(import.meta.dir, '../../../style.css'), 'utf8');
  const rule = /\.tui-pane-screen\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(rule).toContain('var(--font-mono)');
  expect(rule).toContain('white-space: pre-wrap');
});

test('a blocked pane docks focus pane as the one big action and the rest as text actions', async () => {
  await render(pane('blocked'), MR);
  expect(submit().textContent).toBe('focus pane');
  expect($$('.tui-sheet-text-actions button').map(b => b.textContent)).toEqual([
    'resume',
    'clear',
    'dismiss',
  ]);
  expect(text('.tui-sheet-dock-heading')).toBe('Pane on !1235');
  const rail = $('.tui-sheet-context-card')!;
  expect(rail.textContent).toContain(
    'The agent stopped on a prompt only its pane can answer.'
  );
  expect(
    $$('.tui-sheet-context-card .tui-respond-chip').map(c => c.textContent)
  ).toEqual(['w18:p1', 'blocked']);
  expect($('.tui-sheet-rail-scroll')!.firstElementChild!.className).toContain(
    'tui-mr-card'
  );
});

test('focus pane answers the gate and jumps into the pane', async () => {
  await render(pane('blocked'));
  await click(submit());
  expect(answerPosts().map(p => p.body)).toEqual([
    { gateId: 'g-pane', answers: { action: 'focus-pane' } },
  ]);
  expect(posts.find(p => p.url === '/gate/focus')?.body).toEqual({
    gateId: 'g-pane',
  });
});

test('focus pane on a gate that names a domain and an MR relaunches through the board', async () => {
  await render(pane('blocked', { domain: 'respond' }), MR);
  await click(submit());
  expect(focused).toEqual([{ iid: 1235, domain: 'respond' }]);
  expect(posts.find(p => p.url === '/gate/focus')).toBeUndefined();
});

for (const value of ['resume', 'clear', 'dismiss']) {
  test(`the ${value} text action answers with its own value`, async () => {
    await render(pane('blocked'));
    const button = $$('.tui-sheet-text-actions button').find(
      b => b.textContent === value
    );
    await click(button ?? null);
    expect(answerPosts().map(p => p.body)).toEqual([
      { gateId: 'g-pane', answers: { action: value } },
    ]);
    expect(posts.find(p => p.url === '/gate/focus')).toBeUndefined();
  });
}

test("a pane focus that fails still answers, and the dock shows the daemon's reason", async () => {
  focusFails = true;
  await render(pane('blocked'));
  await click(submit());
  expect(answerPosts().map(p => p.body)).toEqual([
    { gateId: 'g-pane', answers: { action: 'focus-pane' } },
  ]);
  expect(text('.tui-sheet-dock .tui-gate-error')).toBe('pane w18:p1 is gone');
});

test('a pane notice answered elsewhere swaps the rail for the winning answer and continue', async () => {
  answeredElsewhere = true;
  await render(pane('blocked'), MR);
  const clear = $$('.tui-sheet-text-actions button').find(
    b => b.textContent === 'clear'
  );
  await click(clear ?? null);
  expect(text('.tui-sheet-rail .tui-gate-error')).toBe('answered elsewhere');
  expect($('.tui-sheet-dock')).toBeNull();
  const cont = $$('.tui-sheet-rail button').find(
    b => b.textContent?.trim() === 'continue'
  );
  await click(cont ?? null);
  expect(continues).toBe(1);
});

test('a gone pane makes resume the big action and says the pane is gone', async () => {
  await render(pane('gone'));
  expect(text('.tui-gate-sheet-tag')).toBe('pane gone');
  expect(text('.tui-sheet-list-title')).toBe('The pane is gone');
  expect(text('.tui-sheet-main .tui-gate-question-label')).toBe(
    'Its last screen'
  );
  expect(submit().textContent).toBe('resume');
  expect($$('.tui-sheet-text-actions button').map(b => b.textContent)).toEqual([
    'focus pane',
    'clear',
    'dismiss',
  ]);
  expect(text('.tui-sheet-context-card')).toContain(
    "The agent's pane is gone."
  );
  expect(text('.tui-sheet-dock-heading')).toBe('Pane on agent:pane-1');
  await click(submit());
  expect(answerPosts().map(p => p.body)).toEqual([
    { gateId: 'g-pane', answers: { action: 'resume' } },
  ]);
});

test('without its preferred option the first option leads, and an unknown value shows raw', async () => {
  await render(
    pane('gone', {
      questions: [
        {
          id: 'action',
          label: 'Pane needs attention',
          multi: false,
          options: ['clear', 'reattach', 'dismiss'],
        },
      ],
    })
  );
  expect(submit().textContent).toBe('clear');
  expect($$('.tui-sheet-text-actions button').map(b => b.textContent)).toEqual([
    'reattach',
    'dismiss',
  ]);
});

test('a pane with no screen text says so and folds nothing away', async () => {
  await render(pane('blocked', { context: undefined }));
  expect(text('.tui-sheet-main .tui-gate-question')).toContain(
    'The pane sent no screen text.'
  );
  expect($('.tui-sheet-main .tui-disclosure-head')).toBeNull();
});

test('a screen that is all prompt folds nothing away', async () => {
  await render(pane('blocked', { context: `${RULE}\n Do you trust me?` }));
  expect(text('.tui-sheet-main pre.tui-pane-screen')).toBe('Do you trust me?');
  expect($('.tui-sheet-main .tui-disclosure-head')).toBeNull();
});

test('the pane actions go quiet while an answer is in flight', async () => {
  let release: () => void = () => {};
  (globalThis as { fetch: unknown }).fetch = async () => {
    await new Promise<void>(resolve => {
      release = resolve;
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await render(pane('blocked'));
  await React.act(async () => {
    ($$('.tui-sheet-text-actions button')[0] as HTMLButtonElement).click();
  });
  expect(submit().disabled).toBe(true);
  expect(
    $$('.tui-sheet-text-actions button').every(
      b => (b as HTMLButtonElement).disabled
    )
  ).toBe(true);
  await React.act(async () => {
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
});

test('the stage dock, the pane dock and the lost panel each reserve their height on the scroller', async () => {
  const restore = installFakeResizeObserver();
  try {
    await render(ship(), MR);
    expect(await reserveOf('.tui-sheet-dock', 402)).toBe('402px');
    await render(pane('blocked'), MR);
    expect(await reserveOf('.tui-sheet-dock', 134)).toBe('134px');
    answeredElsewhere = true;
    const clear = $$('.tui-sheet-text-actions button').find(
      b => b.textContent === 'clear'
    );
    await click(clear ?? null);
    expect(await reserveOf('.tui-sheet-lost', 298)).toBe('298px');
  } finally {
    restore();
  }
});
