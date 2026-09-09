import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from 'storybook/test';

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
 * Sign-off catalog for the triage-queue modal (the gate-kit design pass's
 * ratified direction): the kit Modal hosting GateForm, with queue chrome
 * around it -- pips in the head, gate-level actions on the gate strip,
 * next-gate peek in the footer. The Modal recipe is fixed-position, so each
 * story renders inside a tall stage that the overlay covers; drafts seed via
 * the same `gateDraftKey()` localStorage write `useGateDraft` reads.
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
        background: 'var(--bg)',
        color: 'var(--fg)',
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
      onSkip={noop}
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
        onSkip={noop}
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
        states={['done', 'done', 'skipped', 'done', 'active']}
        onClose={noop}
        onSkip={noop}
        onFocusPane={noop}
        onAnswered={noop}
        onContinue={noop}
      />
    );
  },
};

// --- ErrorState -------------------------------------------------------------

/** Cmd/Ctrl+Enter on the unanswered required item calls the primitive's real
    `validate()` without submitting, flipping its computed `invalid` state. */
const errorGate: GateRow = { ...lastGate, gateId: 'triage-error' };

export const ErrorState: Story = {
  render: () => (
    <DecisionQueueModal
      gate={errorGate}
      mr={boardMr}
      position={3}
      states={['done', 'done', 'active', 'todo', 'todo']}
      nextPeek="widgets!44 · retry loop"
      onClose={noop}
      onSkip={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
  play: async ({ canvasElement }) => {
    const item = within(canvasElement.ownerDocument.body)
      .getAllByText('Ready to merge?')[0]
      ?.closest('.tui-gate-question');
    if (item) fireEvent.keyDown(item, { key: 'Enter', ctrlKey: true });
  },
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
      states={['done', 'done', 'skipped', 'active', 'todo']}
      nextPeek="widgets!46 · pane tokens"
      onClose={noop}
      onSkip={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  ),
};

// --- WithContext ------------------------------------------------------------

/** The modal's reason to exist over the row card: the gate's context renders
    OPEN in its own pane beside the form (the card only offers a collapsed
    disclosure). A context gate takes the wide frame. */
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
        onSkip={noop}
        onFocusPane={noop}
        onAnswered={noop}
        onContinue={noop}
      />
    );
  },
};

// --- LongContextScroll ------------------------------------------------------

/** Context taller than the pane's 56vh cap: the pane scrolls on its own
    while the form column stays put. */
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
      onSkip={noop}
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
        onSkip={noop}
        onFocusPane={noop}
        onAnswered={noop}
        onContinue={noop}
      />
    );
  },
};

// --- QueueComplete ----------------------------------------------------------

export const QueueComplete: Story = {
  render: () => (
    <DecisionQueueComplete answered={4} skipped={1} onClose={noop} />
  ),
};
