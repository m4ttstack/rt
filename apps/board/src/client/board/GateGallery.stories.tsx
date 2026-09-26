import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import type { GateSelections } from '@mattstack/gate-kit';
import { gateDraftKey } from '@mattstack/gate-kit/react';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import {
  DecisionQueueComplete,
  DecisionQueueModal,
  type TriageGateState,
} from './DecisionQueueModal.tsx';
import * as G from './gate-gallery.fixtures.ts';

/**
 * Every decision-queue face the daemon's real gate kinds produce, one story
 * per kind and variant, from `gate-gallery.fixtures.ts`. Open gates show the
 * answerable face; the answered group covers the read-only, stuck,
 * no-agent and lost-the-race faces.
 */
function Stage({
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
        height: '100vh',
      }}
    >
      <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>
    </div>
  );
}

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <Stage scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}>
    <Story />
  </Stage>
);

const meta = {
  title: 'Gates/Board/Gallery',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

const noop = () => {};

function pips(position: number, total: number): TriageGateState[] {
  return Array.from({ length: total }, (_, i) =>
    i + 1 < position ? 'done' : i + 1 === position ? 'active' : 'todo'
  );
}

function Face({
  entry,
  position = 2,
  total = 4,
}: {
  entry: G.GalleryGate;
  position?: number;
  total?: number;
}) {
  return (
    <DecisionQueueModal
      gate={entry.gate}
      mr={entry.mr}
      position={position}
      states={pips(position, total)}
      nextPeek={
        position < total
          ? '!739 · sensors summary chip shows a count'
          : undefined
      }
      people={G.PEOPLE}
      onClose={noop}
      onNext={noop}
      onBack={noop}
      onFocusPane={noop}
      onAnswered={noop}
      onContinue={noop}
    />
  );
}

const face = (name: string, entry: G.GalleryGate): Story => ({
  name,
  render: () => <Face entry={entry} />,
});

// --- Respond ----------------------------------------------------------------

export const RespondPlan = face(
  'Respond: plan, structured (plan@1, thread@1)',
  G.respondPlan
);
export const RespondPlanTwoThreads = face(
  'Respond: plan, structured, two threads',
  G.respondPlanTwoThreads
);
export const RespondPlanProse = face(
  'Respond: plan, prose contexts',
  G.respondPlanProse
);
export const RespondPost = face(
  'Respond: post, structured (post@1, reply@1)',
  G.respondPost
);
export const RespondPostLongReplies = face(
  'Respond: post, long replies, no fixes',
  G.respondPostLongReplies
);
export const RespondPostProse = face(
  'Respond: post, prose, replies and disposition',
  G.respondPostProse
);
export const RespondPostNoContext = face(
  'Respond: post, no context',
  G.respondPostNoContext
);

// --- Review -----------------------------------------------------------------

export const ReviewPost = face(
  'Review: post, structured (review@1, findings@1)',
  G.reviewPost
);
export const ReviewPostVerdictOnly = face(
  'Review: post, prose, verdict only',
  G.reviewPostVerdictOnly
);
export const ReviewPostBySeverity = face(
  'Review: post, prose, chunked by severity',
  G.reviewPostProseBySeverity
);
export const ReviewPostByCount = face(
  'Review: post, prose, chunked by count',
  G.reviewPostProseByCount
);

// --- Stage ------------------------------------------------------------------

export const StagePlan = face('Stage: plan (escalated)', G.plan);
export const StageClarify = face('Stage: clarify', G.clarify);
export const StageEvidence = face('Stage: evidence', G.evidence);
export const StageEvidenceFinding = face(
  'Stage: evidence finding',
  G.evidenceFinding
);
export const StageEvidenceAttach = face(
  'Stage: evidence attach',
  G.evidenceAttach
);
export const StageImplementProgress = face(
  'Stage: implement progress',
  G.implementProgress
);
export const StageSelfReviewProgress = face(
  'Stage: self-review progress',
  G.selfReviewProgress
);
export const StageSelfReview = face('Stage: self-review', G.selfReview);
export const StageShip = face('Stage: ship', G.ship);
export const StageWatchCi = face('Stage: watch-ci', G.watchCi);
export const StageCiWatchWaiting = face(
  'Stage: ci-watch, waiting',
  G.ciWatchWaiting
);
export const StageCiResult = face('Stage: ci-result', G.ciResult);
export const StageCiWatch = face('Stage: ci:watch-ci:1', G.ciWatchStage);
export const StageCiFix = face('Stage: ci-fix', G.ciFix);
export const StageMarkReady = face('Stage: mark-ready', G.markReady);
export const StageClose = face('Stage: close', G.close);
export const StageLogin = face('Stage: login (wait, meta context)', G.login);
export const StageNext = face('Stage: next (wait, meta context)', G.next);
export const StageConfirm = face('Stage: confirm, with a multi', G.confirm);
export const StageValidation = face(
  'Stage: validation, string options',
  G.validation
);
export const StageApproval = face('Stage: approval', G.approval);

// --- Herd and milestone -----------------------------------------------------

export const HerdQuestion = face('Herd: question', G.herdQuestion);
export const HerdMilestone = face('Herd: milestone', G.milestone);

// --- Escalations ------------------------------------------------------------

export const EscalationCiWatch = face(
  'Escalation: ci:watch-ci:2 (escalated)',
  G.ciWatchEscalated
);
export const EscalationDoctor = face(
  'Escalation: doctor-escalation',
  G.doctorEscalation
);
export const EscalationRespond = face(
  'Escalation: respond-escalation',
  G.respondEscalation
);
export const EscalationWrapUp = face('Escalation: wrap-up', G.wrapUp);

// --- Pane -------------------------------------------------------------------

export const PaneTrustPrompt = face(
  'Pane: blocked on a trust prompt',
  G.paneBlocked
);
export const PaneTrustPromptGone = face('Pane: gone, no MR', G.paneGone);

// --- Answered states --------------------------------------------------------

export const AnsweredReview = face(
  'Answered: review post on the board',
  G.answeredReview
);
export const AnsweredRespondPost = face(
  'Answered: respond post on the board',
  G.answeredRespondPost
);
export const AnsweredMilestoneNote = face(
  'Answered: milestone with a note',
  G.answeredMilestoneNote
);
export const AnsweredInPane = face('Answered: in the pane', G.answeredInPane);
export const AnswerStuck = face('Answered: stuck', G.answerStuck);
export const AgentNotRunning = face(
  'Answered: agent not running',
  G.agentNotRunning
);

function seedDraft(gateId: string, selections: GateSelections) {
  localStorage.setItem(
    gateDraftKey(gateId),
    JSON.stringify({ selections, notes: {}, item: null })
  );
}

/** Submits a different answer than the one the stubbed daemon says won. */
export const AnsweredElsewhere: Story = {
  name: 'Answered: elsewhere (lost the race)',
  beforeEach: () => {
    const real = window.fetch;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        input instanceof Request ? input.url : new URL(input, location.href);
      if (String(url).endsWith('/gate/answer'))
        return new Response(
          JSON.stringify({
            ok: false,
            conflict: true,
            row: {
              answer: { answers: G.shipWinningAnswer, by: 'shepherd' },
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        );
      return real(input, init);
    }) as typeof fetch;
    return () => {
      window.fetch = real;
    };
  },
  render: () => {
    seedDraft(G.answeredElsewhere.gate.gateId, {
      mr_open: 'update-description',
      open_as: 'ready',
      next: 'hold',
    });
    return <Face entry={G.answeredElsewhere} />;
  },
  play: async ({ canvasElement }) => {
    const submit = await within(canvasElement).findByRole('button', {
      name: 'submit',
    });
    await userEvent.click(submit);
  },
};

// --- Queue recap ------------------------------------------------------------

export const QueueRecap: Story = {
  name: 'Queue recap: decided this session',
  render: () => <DecisionQueueComplete decided={G.queueRecap} onClose={noop} />,
};
