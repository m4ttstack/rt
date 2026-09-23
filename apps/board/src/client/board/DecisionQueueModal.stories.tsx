import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import type { GateSelections } from '@mattstack/gate-kit';
import { gateDraftKey } from '@mattstack/gate-kit/react';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { GateQuestion, GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import {
  DecisionQueueComplete,
  DecisionQueueModal,
} from './DecisionQueueModal.tsx';

/**
 * Sign-off catalog for the decision queue's stage sheet and pane notice:
 * every question of a gate stacked in the main column, the MR card and the
 * decision context in the rail, and the answer docked under them; the head
 * is one row (title, gate-level actions, queue nav, tag, close). The sheet is
 * fixed-position, so each story renders inside a tall stage it covers;
 * drafts seed via the same `gateDraftKey()` localStorage write
 * `useGateDraft` reads.
 */
function BoardStage({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark';
  children: ReactNode;
}) {
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      style={{
        background: 'var(--page)',
        color: 'var(--text-1)',
        padding: '1.5rem',
        minHeight: '620px',
      }}
    >
      <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>
    </div>
  );
}

const boardStage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <BoardStage scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}>
    <Story />
  </BoardStage>
);

const meta = {
  title: 'Gates/Board/DecisionQueueModal',
  decorators: [boardStage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

function question(
  id: string,
  label: string,
  multi: boolean,
  options: GateQuestion['options']
): GateQuestion {
  return { id, label, multi, options };
}

const boardMr = {
  iid: 31,
  title: 'themed gate controls',
  author: { id: 'gitlab:7', username: 'paul', name: 'Paul', avatarUrl: null },
  sourceBranch: 'board-28-themed-gate-controls',
  targetBranch: 'main',
  createdAt: '2026-09-22T12:00:00Z',
} as unknown as BoardMRWithReview;

function seedDraft(
  gateId: string,
  draft: {
    selections: GateSelections;
    notes: Record<string, string>;
    item: string | null;
  }
) {
  localStorage.setItem(gateDraftKey(gateId), JSON.stringify(draft));
}

const noop = () => {};

const respondPlanQuestions = [
  question('thread-1', 'Thread 1: naming', false, [
    { value: 'reply:aaaaaaaaaaaa', label: 'reply' },
    { value: 'fix:bbbbbbbbbbbb', label: 'fix (recommended)' },
    { value: 'skip:cccccccccccc', label: 'skip' },
  ]),
  question('thread-2', 'Thread 2: test coverage', false, [
    { value: 'reply:dddddddddddd', label: 'reply' },
    { value: 'fix:eeeeeeeeeeee', label: 'fix (recommended)' },
    { value: 'skip:ffffffffffff', label: 'skip' },
  ]),
  question('code-changes', 'What changed?', false, [
    'skip',
    'inline-diff',
    'separate-commit',
  ]),
];

// --- FirstGateIdle ----------------------------------------------------------

const firstGate: GateRow = {
  gateId: 'triage-first',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'respond-plan',
  label: 'respond-plan',
  status: 'open',
  openedAt: 1788962100000,
  questions: respondPlanQuestions,
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

export const FirstGateIdle: Story = {
  render: () => (
    <DecisionQueueModal
      gate={firstGate}
      mr={boardMr}
      position={1}
      states={['active', 'todo', 'todo', 'todo', 'todo']}
      nextPeek="rt!218 · picker follow-ups"
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
};

// --- MidGateSelected --------------------------------------------------------

const midGate: GateRow = { ...firstGate, gateId: 'triage-mid' };

export const MidGateSelected: Story = {
  render: () => {
    seedDraft(midGate.gateId, {
      selections: {
        'thread-1': 'fix:bbbbbbbbbbbb',
        'thread-2': 'fix:eeeeeeeeeeee',
      },
      notes: {},
      item: 'thread-2',
    });
    return (
      <DecisionQueueModal
        gate={midGate}
        mr={boardMr}
        position={2}
        states={['done', 'active', 'todo', 'todo', 'todo']}
        nextPeek="rt!218 · picker follow-ups"
        onClose={noop}
        onNext={noop}
        onBack={noop}
        onFocusPane={noop}
        onAnswered={noop}
        onContinue={noop}
      />
    );
  },
};

// --- LastGateSubmit ---------------------------------------------------------

const lastGate: GateRow = {
  gateId: 'triage-last',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/46',
  kind: 'self-review',
  label: 'self-review',
  status: 'open',
  openedAt: 1788964320000,
  questions: [
    question('verdict', 'Ready to merge?', false, [
      { value: 'approve', label: 'Approve (recommended)' },
      { value: 'changes', label: 'Request changes' },
      { value: 'discuss', label: 'Discuss further' },
    ]),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

export const LastGateSubmit: Story = {
  render: () => {
    seedDraft(lastGate.gateId, {
      selections: { verdict: 'approve' },
      notes: {},
      item: null,
    });
    return (
      <DecisionQueueModal
        gate={lastGate}
        mr={boardMr}
        position={5}
        states={['done', 'done', 'done', 'done', 'active']}
        onClose={noop}
        onNext={noop}
        onBack={noop}
        onFocusPane={noop}
        onAnswered={noop}
        onContinue={noop}
      />
    );
  },
};

// --- ShipGate ---------------------------------------------------------------

/** A Runs stage gate on no MR: the rail opens on the decision context, and
    an option that carries its "(Recommended)" marker mid-label reads as the
    label, the recommended chip, and the rest as its subtitle. */
const shipGate: GateRow = {
  gateId: 'triage-ship',
  subject: 'run:20260923-120115-widgets',
  kind: 'ship',
  label: 'ship',
  status: 'open',
  openedAt: 1788964320000,
  context:
    'Three commits are ready on a clean tree. The after screenshots are still outstanding, so I recommend a draft.\n\n- Branch: `themed-gate-controls`\n- Target: `main`',
  questions: [
    question('handoff', 'How do we hand off?', false, [
      {
        value: 'hand-back',
        label:
          'Hand back (Recommended). I give you the branch, the target and the description.',
      },
      { value: 'hold', label: 'Hold the run here.' },
    ]),
    question('preview', 'Which preview environments?', true, [
      { value: 'preview-a', label: 'preview-a (Recommended)' },
      { value: 'preview-b', label: 'preview-b' },
    ]),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

export const ShipGate: Story = {
  render: () => (
    <DecisionQueueModal
      gate={shipGate}
      position={3}
      states={['done', 'done', 'active', 'todo', 'todo']}
      nextPeek="widgets!44 · retry loop"
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
};

// --- ParkedGate -------------------------------------------------------------

const parkedGate: GateRow = {
  ...firstGate,
  gateId: 'triage-parked',
  status: 'parked',
  domain: 'review',
  origin: undefined,
};

export const ParkedGate: Story = {
  render: () => (
    <DecisionQueueModal
      gate={parkedGate}
      mr={boardMr}
      position={4}
      states={['done', 'done', 'done', 'active', 'todo']}
      nextPeek="widgets!46 · pane tokens"
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
};

// --- WithContext ------------------------------------------------------------

/** The gate's context renders open in the rail's decision context card,
    beside every question. */
const contextBody = `The reviewer left two threads on this MR.

**Thread 1 · \`lib/retry.ts:41\` · naming**

> \`withBackoff\` reads like it adds backoff to an existing retry, but it IS
> the retry loop. Suggest \`retryWithBackoff\` so call sites read correctly.

**Thread 2 · \`lib/retry.ts:58\` · test coverage**

> The abort path has no test. If the signal fires between attempts, the loop
> should stop without scheduling another timer:

\`\`\`ts
if (signal?.aborted) return { ok: false, reason: 'aborted' };
await delay(backoff(attempt), { signal });
\`\`\`

Recommended plan: fix both in this MR as a separate commit.`;

const contextGate: GateRow = {
  ...firstGate,
  gateId: 'triage-context',
  context: contextBody,
};

export const WithContext: Story = {
  render: () => {
    seedDraft(contextGate.gateId, {
      selections: { 'thread-1': 'fix:bbbbbbbbbbbb' },
      notes: {},
      item: 'thread-2',
    });
    return (
      <DecisionQueueModal
        gate={contextGate}
        mr={boardMr}
        position={2}
        states={['done', 'active', 'todo', 'todo', 'todo']}
        nextPeek="rt!218 · picker follow-ups"
        onClose={noop}
        onNext={noop}
        onBack={noop}
        onFocusPane={noop}
        onAnswered={noop}
        onContinue={noop}
      />
    );
  },
};

// --- LongContextScroll ------------------------------------------------------

/** Context taller than the rail: the rail scrolls above the docked
    answer, which never moves. */
const longContextGate: GateRow = {
  ...firstGate,
  gateId: 'triage-context-long',
  context: [
    contextBody,
    ...Array.from(
      { length: 6 },
      (_, i) => `**Follow-up note ${i + 1}**

> Additional reviewer discussion quoted here so the pane overflows: the
> retry loop's jitter window, the timer cleanup on unmount, and how the
> abort reason propagates to the caller were each debated at length.`
    ),
  ].join('\n\n'),
};

export const LongContextScroll: Story = {
  render: () => (
    <DecisionQueueModal
      gate={longContextGate}
      mr={boardMr}
      position={2}
      states={['done', 'active', 'todo', 'todo', 'todo']}
      nextPeek="rt!218 · picker follow-ups"
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
};

// --- WriteInAnswer ----------------------------------------------------------

/** Visual spec for RT-116's `allowOther`: an "Other (write in)" choice whose
    written answer travels in the text field below it ({value: 'other',
    note}). Until rt ships the schema field and the kit appends the choice
    itself, this fixture carries the option explicitly; the rendering is
    already exactly the ratified UX. */
const writeInGate: GateRow = {
  ...lastGate,
  gateId: 'triage-write-in',
  questions: [
    question('verdict', 'Ready to merge?', false, [
      { value: 'approve', label: 'Approve (recommended)' },
      { value: 'changes', label: 'Request changes' },
      { value: 'other', label: 'Other (write in)' },
    ]),
  ],
};

export const WriteInAnswer: Story = {
  render: () => {
    seedDraft(writeInGate.gateId, {
      selections: { verdict: 'other' },
      notes: {
        verdict: 'Merge after the deploy freeze lifts on Thursday.',
      },
      item: null,
    });
    return (
      <DecisionQueueModal
        gate={writeInGate}
        mr={boardMr}
        position={3}
        states={['done', 'done', 'active', 'todo', 'todo']}
        nextPeek="widgets!44 · retry loop"
        onClose={noop}
        onNext={noop}
        onBack={noop}
        onFocusPane={noop}
        onAnswered={noop}
        onContinue={noop}
      />
    );
  },
};

// --- PaneBlocked / PaneGone ------------------------------------------------

const paneScreen = [
  'The fix is in and the suite is green, so I will resume the review.',
  '',
  'Entering worktree(~/worktrees/widgets/harbor)',
  '\u2500'.repeat(80),
  ' Tool use',
  '',
  '   Entering worktree(~/worktrees/widgets/harbor)',
  '',
  ' Do you want to proceed?',
  ' \u276f 1. Yes',
  '   2. No',
].join('\n');

const paneGate = (reason: 'blocked' | 'gone'): GateRow => ({
  gateId: `triage-pane-${reason}`,
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'pane-attention',
  label: 'pane-attention',
  status: 'open',
  openedAt: 1788964320000,
  context: paneScreen,
  meta: { agentId: 'agent-7', paneRef: 'w4:p2', reason },
  questions: [
    question('action', 'Pane needs attention', false, [
      'focus-pane',
      'resume',
      'clear',
      'dismiss',
    ]),
  ],
});

/** A blocked pane: its prompt as terminal text, earlier output folded away,
    focus pane as the one big action and the rest as text actions. */
export const PaneBlocked: Story = {
  render: () => (
    <DecisionQueueModal
      gate={paneGate('blocked')}
      mr={boardMr}
      position={2}
      states={['done', 'active', 'todo']}
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
};

/** A gone pane: its last screen, with resume as the big action. */
export const PaneGone: Story = {
  render: () => (
    <DecisionQueueModal
      gate={paneGate('gone')}
      mr={boardMr}
      position={3}
      states={['done', 'done', 'active']}
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
};

// --- AnsweredGate / AnswerStuck / AgentNotRunning --------------------------

const answeredShip: GateRow = {
  ...shipGate,
  gateId: 'answered-ship',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  status: 'answered',
  answers: {
    handoff: { value: 'hand-back', note: 'Push after the standup.' },
    preview: ['preview-a'],
  },
  answeredBy: 'paul',
  answeredAt: 1788964500000,
};

const answeredStory = (gate: GateRow): Story => ({
  render: () => (
    <DecisionQueueModal
      gate={gate}
      mr={boardMr}
      position={2}
      states={['done', 'active', 'todo']}
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
});

/** A recorded answer, read-only: every pick checked, nothing to press. */
export const AnsweredGate = answeredStory(answeredShip);

/** The pane never picked the answer up: focus pane is the one action. */
export const AnswerStuck = answeredStory({
  ...answeredShip,
  gateId: 'answered-stuck',
  delivery: { outcome: 'stuck', at: 1788964600000 },
});

/** No agent was left to run the answer: retry posts it again. */
export const AgentNotRunning = answeredStory({
  ...answeredShip,
  gateId: 'answered-unassigned',
  execution: 'unassigned',
});

// --- QueueComplete ----------------------------------------------------------

const decidedMr = (iid: number, title: string) =>
  ({ ...boardMr, iid, title }) as BoardMRWithReview;

const postThread = (n: number, t: string) =>
  question(`thread-${n}`, `widgets/${t}.ts:${n * 12}`, true, [
    { value: `post:${t}`, label: 'Post' },
    { value: `resolve:${t}`, label: 'Resolve' },
  ]);

const decided: Array<{ gate: GateRow; mr?: BoardMRWithReview }> = [
  {
    gate: {
      ...firstGate,
      gateId: 'done-post',
      kind: 'respond-post',
      status: 'answered',
      questions: [
        postThread(1, 'queue'),
        postThread(2, 'retry'),
        postThread(3, 'drain'),
      ],
      answers: {
        'thread-1': {
          value: ['post:queue', 'resolve:queue'],
          text: 'Reworded reply',
        },
        'thread-2': ['post:retry'],
        'thread-3': [],
      },
      answeredBy: 'board',
    },
    mr: decidedMr(31, 'themed gate controls'),
  },
  {
    gate: {
      ...firstGate,
      gateId: 'done-plan',
      status: 'answered',
      answers: {
        'thread-1': 'fix:bbbbbbbbbbbb',
        'thread-2': 'reply:dddddddddddd',
        'code-changes': 'separate-commit',
      },
      answeredBy: 'board',
    },
    mr: decidedMr(44, 'retry loop backs off on a 429 from the export queue'),
  },
  {
    gate: {
      ...lastGate,
      gateId: 'done-review',
      kind: 'review-post',
      status: 'answered',
      answers: { verdict: 'approve' },
      answeredBy: 'dana',
    },
    mr: decidedMr(46, 'drain the widget queue before shutdown'),
  },
  {
    gate: { ...lastGate, gateId: 'done-lagging', kind: 'review-post' },
    mr: decidedMr(52, 'split the settings form into sections'),
  },
  {
    gate: {
      ...lastGate,
      gateId: 'done-attention',
      subject: 'agent:pane-4',
      kind: 'pane-attention',
      status: 'answered',
      questions: [question('next', 'What next?', false, ['resume', 'stop'])],
      answers: { next: 'resume' },
      answeredBy: 'board',
    },
  },
];

export const QueueComplete: Story = {
  render: () => <DecisionQueueComplete decided={decided} onClose={noop} />,
};

export const QueueCompleteEmpty: Story = {
  render: () => <DecisionQueueComplete decided={[]} onClose={noop} />,
};
