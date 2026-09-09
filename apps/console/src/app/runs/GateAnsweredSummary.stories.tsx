import { Text } from '@mattstack/app-kit/core';
import type { GateQuestion, GateSummaryInput } from '@mattstack/gate-kit';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AnsweredSummary } from './GateCard';

/**
 * The console's answered face -- GateCard's own `AnsweredSummary`, exported
 * for exactly this coverage rather than storied through GateCard (which
 * would need a QueryClientProvider and a stubbed daemon client that this
 * chip/detail rendering never touches).
 *
 * No `component` on this meta: every story fully replaces `render`, and
 * declaring `component` makes `StoryObj` require an `args` object matching
 * AnsweredSummary's props even when render never reads it.
 */
const meta = {
  title: 'Gates/Console/AnsweredSummary',
  parameters: { layout: 'padded' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const questions: GateQuestion[] = [
  {
    id: 'verdict',
    label: 'Ready to merge?',
    multi: false,
    options: [
      { value: 'approve', label: 'Approve (recommended)' },
      { value: 'changes', label: 'Request changes' },
    ],
  },
];

const answeredRow: GateSummaryInput = {
  subject: 'run:abcdef123456',
  kind: 'self-review',
  status: 'answered',
  questions,
  answer: { answers: { verdict: 'approve' }, by: 'pane', answeredAt: 0 },
};

export const AnsweredChipCollapsed: Story = {
  render: () => <AnsweredSummary row={answeredRow} />,
};

export const AnsweredChipExpanded: Story = {
  render: () => <AnsweredSummary row={answeredRow} startOpen />,
};

const withNoteRow: GateSummaryInput = {
  subject: 'run:abcdef123456',
  kind: 'self-review',
  status: 'answered',
  questions,
  answer: {
    answers: {
      verdict: {
        value: 'changes',
        note: 'Needs another pass on the auth flow before merge.',
      },
    },
    by: 'jordan',
    answeredAt: 0,
  },
};

export const AnsweredWithNote: Story = {
  render: () => <AnsweredSummary row={withNoteRow} startOpen />,
};

// --- ConflictAnsweredElsewhere: GateCard's `lost` face, composed here as --
// the same two elements GateCard renders together (a bad-colored line plus
// AnsweredSummary startOpen) -- not a separate exported component, just the
// exact composition GateCard.tsx's `lost` branch uses.

const conflictRow: GateSummaryInput = {
  subject: 'run:abcdef123456',
  kind: 'self-review',
  status: 'answered',
  questions,
  answer: { answers: { verdict: 'changes' }, by: 'someone-else' },
};

export const ConflictAnsweredElsewhere: Story = {
  render: () => (
    <>
      <Text c="bad" fz={12}>
        answered elsewhere
      </Text>
      <AnsweredSummary startOpen row={conflictRow} />
    </>
  ),
};
