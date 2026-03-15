import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRNode } from '../components/forge/MRNode';
import * as mocks from './mocks/mrDashboard.mock';

const meta: Meta<typeof MRNode> = {
  title: 'Forge/MRNode',
  component: MRNode,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 320 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MRNode>;

export const Default: Story = {
  args: {
    mr: mocks.mergeable,
    ticketId: 'ACME-1231',
  },
};

export const Selected: Story = {
  args: {
    mr: mocks.mergeable,
    ticketId: 'ACME-1231',
    selected: true,
    onClick: () => {},
  },
};

export const WithClose: Story = {
  args: {
    mr: mocks.pipelineBlocked,
    ticketId: 'ACME-1233',
    onClose: () => alert('onClose()'),
    onClick: () => alert('onClick()'),
  },
};

export const Draft: Story = {
  args: {
    mr: mocks.draft,
    ticketId: 'ACME-1234',
  },
};

export const Merged: Story = {
  args: {
    mr: mocks.merged,
  },
};

/** All status variants shown in a vertical stack (simulating a graph pipeline) */
export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <MRNode mr={mocks.mergeable} ticketId="ACME-1231" />
      <MRNode mr={mocks.pipelineBlocked} ticketId="ACME-1232" />
      <MRNode mr={mocks.draft} ticketId="ACME-1233" />
      <MRNode mr={mocks.merged} ticketId="ACME-1234" />
      <MRNode mr={mocks.conflicts} ticketId="ACME-1235" />
      <MRNode mr={mocks.autoMergeActive} ticketId="ACME-1236" />
    </div>
  ),
};

export const Loading: Story = {
  args: { loading: true },
};
