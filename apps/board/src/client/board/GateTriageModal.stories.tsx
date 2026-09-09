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
import { GateTriageComplete, GateTriageModal } from './GateTriageModal.tsx';

/**
 * Sign-off catalog for the triage-queue modal (the gate-kit design pass's
 * ratified direction): the kit Modal hosting the same GateForm the row card
 * renders, with queue chrome around it -- pips in the head, gate-level
 * actions on the gate strip, next-gate peek in the footer. The Modal recipe
 * is fixed-position, so each story renders inside a tall stage that the
 * overlay covers; drafts seed exactly as in Gates/Board/GateCard.
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
  title: 'Gates/Board/GateTriageModal',
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
  openedAt: 0,
  questions: respondPlanQuestions,
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

export const FirstGateIdle: Story = {
  render: () => (
    <GateTriageModal
      gate={firstGate}
      mr={boardMr}
      position={1}
      states={['active', 'todo', 'todo', 'todo', 'todo']}
      nextPeek="clarify · rt#218 · picker follow-ups"
      onClose={noop}
      onSkip={noop}
      onFocusPane={noop}
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
      <GateTriageModal
        gate={midGate}
        mr={boardMr}
        position={2}
        states={['done', 'active', 'todo', 'todo', 'todo']}
        nextPeek="clarify · rt#218 · picker follow-ups"
        onClose={noop}
        onSkip={noop}
        onFocusPane={noop}
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
  openedAt: 0,
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
      <GateTriageModal
        gate={lastGate}
        mr={boardMr}
        position={5}
        states={['done', 'done', 'skipped', 'done', 'active']}
        onClose={noop}
        onSkip={noop}
        onFocusPane={noop}
      />
    );
  },
};

// --- ErrorState -------------------------------------------------------------

/** Same technique as Gates/Board/GateCard's ErrorState: Cmd/Ctrl+Enter on
    the unanswered required item calls the primitive's real `validate()`
    without submitting, flipping its computed `invalid` state. */
const errorGate: GateRow = { ...lastGate, gateId: 'triage-error' };

export const ErrorState: Story = {
  render: () => (
    <GateTriageModal
      gate={errorGate}
      mr={boardMr}
      position={3}
      states={['done', 'done', 'active', 'todo', 'todo']}
      nextPeek="respond-plan · widgets!44 · retry loop"
      onClose={noop}
      onSkip={noop}
      onFocusPane={noop}
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
    <GateTriageModal
      gate={parkedGate}
      mr={boardMr}
      position={4}
      states={['done', 'done', 'skipped', 'active', 'todo']}
      nextPeek="self-review · widgets!46 · pane tokens"
      onClose={noop}
      onSkip={noop}
      onFocusPane={noop}
    />
  ),
};

// --- AnsweredGate -----------------------------------------------------------

/** A gate that flipped to answered while queued (the SSE poll beat the
    queue): the modal shows the summary chip where the form would be. */
const answeredGate: GateRow = {
  ...lastGate,
  gateId: 'triage-answered',
  status: 'answered',
  answers: { verdict: 'approve' },
  answeredBy: 'matt',
  answeredAt: 1757430000000,
};

export const AnsweredGate: Story = {
  render: () => (
    <GateTriageModal
      gate={answeredGate}
      mr={boardMr}
      position={2}
      states={['done', 'active', 'todo', 'todo', 'todo']}
      nextPeek="clarify · rt#218 · picker follow-ups"
      onClose={noop}
      onSkip={noop}
      onFocusPane={noop}
    />
  ),
};

// --- QueueComplete ----------------------------------------------------------

export const QueueComplete: Story = {
  render: () => <GateTriageComplete answered={4} skipped={1} onClose={noop} />,
};
