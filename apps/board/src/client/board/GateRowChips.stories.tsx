import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { GateQuestion, GateRow } from '../../gates/store.ts';
import { GateRowChips } from './GateRowChips.tsx';

/**
 * The row's whole gate face after the design pass: chips, never a form.
 * An actionable gate opens the decision queue; anything else is the same
 * answered summary the queue itself renders.
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
      style={{ background: 'var(--bg)', color: 'var(--fg)', padding: '1.5rem' }}
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
  title: 'Gates/Board/GateRowChips',
  decorators: [boardStage],
  parameters: { layout: 'padded' },
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

const noop = () => {};

const openGate: GateRow = {
  gateId: 'story-open',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/42',
  kind: 'self-review',
  label: 'self-review',
  status: 'open',
  openedAt: 0,
  questions: [
    question('verdict', 'Ready to merge?', false, [
      { value: 'approve', label: 'Approve (recommended)' },
      { value: 'changes', label: 'Request changes' },
    ]),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

export const ActionableGate: Story = {
  render: () => <GateRowChips gates={[openGate]} onOpenGate={noop} />,
};

const parkedGate: GateRow = {
  ...openGate,
  gateId: 'story-parked',
  status: 'parked',
  domain: 'review',
};

export const ParkedGate: Story = {
  render: () => <GateRowChips gates={[parkedGate]} onOpenGate={noop} />,
};

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

export const AnsweredGate: Story = {
  render: () => <GateRowChips gates={[answeredGate]} onOpenGate={noop} />,
};

export const MixedRow: Story = {
  render: () => (
    <GateRowChips
      gates={[openGate, { ...answeredGate, gateId: 'story-mixed-answered' }]}
      onOpenGate={noop}
    />
  ),
};
