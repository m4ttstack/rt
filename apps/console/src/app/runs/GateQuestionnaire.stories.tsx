import { useState } from 'react';
import type { GateQuestion, GateSelections } from '@mattstack/gate-kit';
import type { GateForItems } from '@mattstack/gate-kit/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fireEvent, within } from 'storybook/test';

import { GateQuestionnaire } from './GateQuestionnaire';

/**
 * Sign-off catalog for the console's questionnaire layer. Every state is
 * frozen from OUTSIDE the component: GateQuestionnaire is a pure controlled
 * component (selections/notes/step are props, not internal state), so a
 * small local wrapper seeds `useState` with the frozen values and never
 * touches them again -- no timers, no network, no daemon.
 *
 * No `component` on this meta: every story fully replaces `render`, and
 * declaring `component` here makes Storybook's `StoryObj` require an `args`
 * object matching GateQuestionnaire's props even when render never reads it.
 */
const meta = {
  title: 'Gates/Console/GateQuestionnaire',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function question(
  id: string,
  label: string,
  multi: boolean,
  options: GateQuestion['options']
): GateQuestion {
  return { id, label, multi, options };
}

/** Controlled harness: owns selections/notes/step so GateQuestionnaire keeps
    its real onChange wiring, but every story seeds a fixed starting point
    and nothing in the harness ever drives it forward on its own. */
function GateQuestionnaireHarness({
  gate,
  initialSelections = {},
  initialNotes = {},
  initialStep = null,
}: {
  gate: GateForItems;
  initialSelections?: GateSelections;
  initialNotes?: Record<string, string>;
  initialStep?: string | null;
}) {
  const [selections, setSelections] =
    useState<GateSelections>(initialSelections);
  const [notes, setNotes] = useState<Record<string, string>>(initialNotes);
  const [step, setStep] = useState<string | null>(initialStep);
  return (
    <GateQuestionnaire
      gate={gate}
      selections={selections}
      onSelectionsChange={setSelections}
      notes={notes}
      onNoteChange={(name, value) =>
        setNotes(prev => ({ ...prev, [name]: value }))
      }
      step={step}
      onStepChange={setStep}
      onReset={() => {
        setSelections(initialSelections);
        setNotes(initialNotes);
        setStep(initialStep);
      }}
      busy={false}
      onSubmitAnswers={() => {}}
      status={null}
      focus={null}
    />
  );
}

// --- FlatSingleQuestion: one question, recommended badge, key hints -------

const selfReviewGate: GateForItems = {
  kind: 'self-review',
  questions: [
    question('verdict', 'Ready to merge?', false, [
      { value: 'approve', label: 'Approve (recommended)' },
      { value: 'changes', label: 'Request changes' },
      { value: 'discuss', label: 'Discuss further' },
    ]),
  ],
};

export const FlatSingleQuestion: Story = {
  render: () => <GateQuestionnaireHarness gate={selfReviewGate} />,
};

// --- StepOneIdle: two questions, progress "1 of 2" -------------------------

const clarifyGate: GateForItems = {
  kind: 'clarify',
  questions: [
    question('scope', 'Is the scope clear?', false, ['yes', 'no']),
    question('blocking', 'Is this blocking?', false, ['yes', 'no']),
  ],
};

export const StepOneIdle: Story = {
  render: () => <GateQuestionnaireHarness gate={clarifyGate} />,
};

// --- StepOneSelectedWithNote: preset selection + note on step one ---------

export const StepOneSelectedWithNote: Story = {
  render: () => (
    <GateQuestionnaireHarness
      gate={clarifyGate}
      initialSelections={{ scope: 'yes' }}
      initialNotes={{ scope: 'Confirmed with the reporter.' }}
      initialStep="scope"
    />
  ),
};

// --- StepTwoMulti: checkbox question, landed on step two ------------------

const severityGate: GateForItems = {
  kind: 'clarify',
  questions: [
    question('severity', 'Severity?', false, ['minor', 'major']),
    question('areas', 'Which areas are affected?', true, ['ui', 'api', 'docs']),
  ],
};

export const StepTwoMulti: Story = {
  render: () => (
    <GateQuestionnaireHarness
      gate={severityGate}
      initialSelections={{ severity: 'minor', areas: ['ui', 'docs'] }}
      initialStep="areas"
    />
  ),
};

// --- ErrorState: the primitive's own validation, driven for real ----------

/**
 * The kit's `invalid` state is computed internally (an "attempted" flag set
 * by `Questionnaire.Item.validate()`); GateQuestionnaire never forwards an
 * external `invalid` prop, so faking it from outside would mean rendering a
 * story-only fork. Driving the real path instead: Cmd/Ctrl+Enter on an
 * unanswered required item is GateQuestionnaire's own documented
 * "validate-and-advance" shortcut (see its note on the note-field
 * onKeyDown), and firing it on the last item calls the primitive's
 * `validate()` without ever calling `requestSubmit()` -- exactly what
 * surfaces `Questionnaire.Error` without a network round trip.
 */
export const ErrorState: Story = {
  render: () => <GateQuestionnaireHarness gate={selfReviewGate} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const item = canvas.getByTestId('gate-item-verdict');
    fireEvent.keyDown(item, { key: 'Enter', ctrlKey: true });
  },
};

// --- RespondPlanCollapse: code-changes question un-collapsed ---------------

/**
 * `codeChangesHidden` (packages/gate-kit/src/collapse.ts) hides the
 * code-changes question until some other selection carries a `fix:`-prefixed
 * value. This preset picks a `fix:` option on the first thread so the third
 * question renders -- proving the collapse wiring reacts to `selections`
 * exactly as gateItems() documents, from the un-collapsed side (the
 * collapsed side is just StepOneIdle-shaped and adds nothing to look at).
 */
const respondPlanGate: GateForItems = {
  kind: 'respond-plan',
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
};

export const RespondPlanCollapse: Story = {
  render: () => (
    <GateQuestionnaireHarness
      gate={respondPlanGate}
      initialSelections={{ 'thread-1': 'fix:bbbbbbbbbbbb' }}
      initialStep="thread-1"
    />
  ),
};
