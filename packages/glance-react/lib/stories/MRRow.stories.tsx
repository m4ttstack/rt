import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRRow, MRRowList } from '../components/forge/MRRow';
import { CARD_WIDTH } from './constants';
import * as mocks from './mocks/mrDashboard.mock';

const meta: Meta<typeof MRRowList> = {
  title: 'Forge/MRRow',
  component: MRRowList,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    Story => (
      <div
        style={{
          width: CARD_WIDTH,
          background: 'var(--color-bg-dark)',
          borderTopRightRadius: 8,
          borderBottomRightRadius: 8,
          overflow: 'hidden',
        }}
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MRRowList>;

/** Full queue — all states visible at once, matching the Graphite queue activity layout */
export const Queue: Story = {
  args: {
    mrs: [
      mocks.mergeable,
      mocks.pipelineBlocked,
      mocks.draft,
      mocks.needsRebase,
      mocks.merging,
      mocks.merged,
      mocks.conflicts,
      mocks.autoMergeActive,
    ],
  },
};

export const Empty: Story = {
  args: { mrs: [] },
};

// Individual row stories for interactive controls
export const SingleMergeable: StoryObj<typeof MRRow> = {
  render: args => <MRRow {...args} />,
  args: { mr: mocks.mergeable },
};
export const SingleBlocked: StoryObj<typeof MRRow> = {
  render: args => <MRRow {...args} />,
  args: { mr: mocks.pipelineBlocked },
};
export const SingleDraft: StoryObj<typeof MRRow> = {
  render: args => <MRRow {...args} />,
  args: { mr: mocks.draft },
};
export const SingleMerged: StoryObj<typeof MRRow> = {
  render: args => <MRRow {...args} />,
  args: { mr: mocks.merged },
};

export const LoadingRow: StoryObj<typeof MRRow> = {
  render: args => <MRRow {...args} />,
  args: { loading: true },
};

export const LoadingList: Story = {
  args: { loading: true, loadingCount: 4 },
};
