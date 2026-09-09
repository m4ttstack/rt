import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from 'storybook/test';

import type { GateDomain, GateSelections } from '@mattstack/gate-kit';
import { gateDraftKey } from '@mattstack/gate-kit/react';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';
// The board's own global chrome. theme.css/canvas.css carry the `:root`
// token block and page ground; style.css is the board's unlayered
// `.tui-gate-*` rules, all written against those tokens. Scoped to this file
// (rather than a shared entry) since story files are the only place outside
// apps/board/src/client/main.tsx that mount board components standalone.
import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { GateQuestion, GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { AnsweredChip, GateCard } from './GateCard.tsx';

/**
 * Sign-off catalog for the board's questionnaire chrome -- the same states
 * as Gates/Console/GateQuestionnaire, but rendered through the board's own
 * GateCard (a self-contained component: no QueryClientProvider or daemon
 * client, just the kit theme). Unlike console's GateQuestionnaire, GateCard
 * owns selections/notes/step as internal state seeded from a localStorage
 * draft (`useGateDraft`), so a story that needs a preset pick seeds that
 * draft directly -- under the exact key `gateDraftKey()` produces --
 * synchronously before the component's own first render, using a distinct
 * `gateId` per story so drafts never leak between them.
 */
const meta = {
  title: 'Gates/Board/GateCard',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

// registerTheme is module-scope, once -- soribashi's factory reads the
// registered theme for its intent resolver regardless of how many stories
// mount; SoribashiProvider is still required per-render for useTheme().
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
  iid: 42,
  title: 'Story fixture MR',
} as unknown as BoardMRWithReview;

/** Dark stage: the board always renders on the kit's dark ramp in its real
    chrome. `.dark` only flips `color-scheme` (theme.css); every `--fg`/
    `--bg`/... value is a `light-dark()` call that resolves against whichever
    element's color-scheme it's consumed under, not where it's declared --
    the same mechanism tui-kit's own Chip visual harness relies on to mount
    dark without touching <html>. */
function DarkStage({ children }: { children: ReactNode }) {
  return (
    <div
      className="dark"
      style={{ background: 'var(--bg)', color: 'var(--fg)', padding: '1.5rem' }}
    >
      <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>
    </div>
  );
}

/** Seeds the exact draft `useGateDraft` reads on GateCard's first render --
    a plain localStorage write under the module's own key convention, done
    in the render body so it lands before React invokes GateCard's function
    (React fully evaluates a parent's render before descending to children,
    so this write-then-mount ordering is guaranteed within one render pass). */
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

function BoardGateCardHarness({
  gate,
  onFocusPane = () => {},
}: {
  gate: GateRow;
  onFocusPane?: (mr: BoardMRWithReview, domain: GateDomain) => void;
}) {
  return (
    <DarkStage>
      <GateCard gate={gate} mr={boardMr} onFocusPane={onFocusPane} />
    </DarkStage>
  );
}

// --- FlatSingleQuestion -----------------------------------------------------

const selfReviewGate: GateRow = {
  gateId: 'story-flat',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/42',
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

export const FlatSingleQuestion: Story = {
  render: () => <BoardGateCardHarness gate={selfReviewGate} />,
};

// --- StepOneIdle -------------------------------------------------------------

const clarifyGate: GateRow = {
  gateId: 'story-step-idle',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/43',
  kind: 'clarify',
  label: 'clarify',
  status: 'open',
  openedAt: 0,
  questions: [
    question('scope', 'Is the scope clear?', false, ['yes', 'no']),
    question('blocking', 'Is this blocking?', false, ['yes', 'no']),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

export const StepOneIdle: Story = {
  render: () => <BoardGateCardHarness gate={clarifyGate} />,
};

// --- StepOneSelectedWithNote --------------------------------------------------

const selectedNoteGate: GateRow = {
  ...clarifyGate,
  gateId: 'story-selected-note',
};
seedDraft(selectedNoteGate.gateId, {
  selections: { scope: 'yes' },
  notes: { scope: 'Confirmed with the reporter.' },
  item: 'scope',
});

export const StepOneSelectedWithNote: Story = {
  render: () => <BoardGateCardHarness gate={selectedNoteGate} />,
};

// --- StepTwoMulti --------------------------------------------------------------

const severityGate: GateRow = {
  gateId: 'story-multi',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/44',
  kind: 'clarify',
  label: 'clarify',
  status: 'open',
  openedAt: 0,
  questions: [
    question('severity', 'Severity?', false, ['minor', 'major']),
    question('areas', 'Which areas are affected?', true, ['ui', 'api', 'docs']),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};
seedDraft(severityGate.gateId, {
  selections: { severity: 'minor', areas: ['ui', 'docs'] },
  notes: {},
  item: 'areas',
});

export const StepTwoMulti: Story = {
  render: () => <BoardGateCardHarness gate={severityGate} />,
};

// --- ErrorState: the primitive's own validation, driven for real -----------

/** Same technique as Gates/Console/GateQuestionnaire's ErrorState: Cmd/
    Ctrl+Enter on the last unanswered required item calls the primitive's
    real `validate()` (see @shadcn/react/questionnaire) without submitting,
    which is what flips its computed `invalid` state. Board's markup carries
    no test ids, so the item fieldset is queried by its recipe class. */
const errorGate: GateRow = { ...selfReviewGate, gateId: 'story-error' };

export const ErrorState: Story = {
  render: () => <BoardGateCardHarness gate={errorGate} />,
  play: async ({ canvasElement }) => {
    const item = within(canvasElement)
      .getAllByText('Ready to merge?')[0]
      ?.closest('.tui-gate-question');
    if (item) fireEvent.keyDown(item, { key: 'Enter', ctrlKey: true });
  },
};

// --- RespondPlanCollapse -----------------------------------------------------

const respondPlanGate: GateRow = {
  gateId: 'story-collapse',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/45',
  kind: 'respond-plan',
  label: 'respond-plan',
  status: 'open',
  openedAt: 0,
  questions: [
    question('thread-1', 'Thread 1: naming', false, [
      { value: 'reply:aaaaaaaaaaaa', label: 'reply' },
      { value: 'fix:bbbbbbbbbbbb', label: 'fix' },
      { value: 'skip:cccccccccccc', label: 'skip' },
    ]),
    question('thread-2', 'Thread 2: test coverage', false, [
      { value: 'reply:dddddddddddd', label: 'reply' },
      { value: 'fix:eeeeeeeeeeee', label: 'fix' },
      { value: 'skip:ffffffffffff', label: 'skip' },
    ]),
    question('code-changes', 'What changed?', false, [
      'skip',
      'inline-diff',
      'separate-commit',
    ]),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};
seedDraft(respondPlanGate.gateId, {
  selections: { 'thread-1': 'fix:bbbbbbbbbbbb' },
  notes: {},
  item: 'thread-1',
});

export const RespondPlanCollapse: Story = {
  render: () => <BoardGateCardHarness gate={respondPlanGate} />,
};

// --- AnsweredChipCollapsed / AnsweredChipExpanded --------------------------

const answeredGate: GateRow = {
  gateId: 'story-answered',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/46',
  kind: 'self-review',
  label: 'self-review',
  status: 'answered',
  openedAt: 0,
  questions: [
    question('verdict', 'Ready to merge?', false, [
      { value: 'approve', label: 'Approve (recommended)' },
      { value: 'changes', label: 'Request changes' },
    ]),
  ],
  answers: { verdict: 'approve' },
  answeredBy: 'pane',
  answeredAt: 0,
};

export const AnsweredChipCollapsed: Story = {
  render: () => <BoardGateCardHarness gate={answeredGate} />,
};

/** GateCard's AnsweredChip has no prop to start expanded; its own toggle is
    a plain click (`DisclosureHead`, accessible name "expand answered gate
    summary"), so a play function drives it the same way a reviewer would. */
export const AnsweredChipExpanded: Story = {
  render: () => (
    <BoardGateCardHarness
      gate={{ ...answeredGate, gateId: 'story-answered-open' }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await fireEvent.click(
      canvas.getByRole('button', { name: /answered gate summary/i })
    );
  },
};

// --- ConflictAnsweredElsewhere ----------------------------------------------

/** GateCard's `lost` branch only exists inside its own post-submit state
    (`setLost` after a 409); the board never renders it from props alone.
    This reproduces that branch's exact composition -- GateCard's own
    "answered elsewhere" line plus its exported `AnsweredChip` startOpen --
    using the same `tui-gate-*` classes GateCard.tsx renders that line with. */
const conflictGate: GateRow = { ...answeredGate, gateId: 'story-conflict' };

export const ConflictAnsweredElsewhere: Story = {
  render: () => (
    <DarkStage>
      <div className="tui-gate-card">
        <div className="tui-gate-head">
          <span className="tui-gate-title">{conflictGate.label}</span>
        </div>
        <div className="tui-gate-error">answered elsewhere</div>
        <AnsweredChip
          startOpen
          row={{
            subject: conflictGate.subject,
            kind: conflictGate.kind,
            status: 'answered',
            questions: conflictGate.questions,
            answer: { answers: { verdict: 'changes' }, by: 'someone-else' },
          }}
        />
      </div>
    </DarkStage>
  ),
};

// --- Parked: parked badge + focus-pane resume button ------------------------

const parkedGate: GateRow = {
  ...selfReviewGate,
  gateId: 'story-parked',
  status: 'parked',
  domain: 'review',
};

export const Parked: Story = {
  render: () => <BoardGateCardHarness gate={parkedGate} />,
};

// --- FocusDisabled: no origin, disabled button with its title --------------

const noOriginGate: GateRow = {
  ...selfReviewGate,
  gateId: 'story-no-origin',
  origin: undefined,
};

export const FocusDisabled: Story = {
  render: () => <BoardGateCardHarness gate={noOriginGate} />,
};
