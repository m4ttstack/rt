import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRSidebar } from '../components/forge/MRSidebar';
import * as mocks from './mocks/mrDashboard.mock';

const meta: Meta<typeof MRSidebar> = {
  title: 'Forge/MRSidebar',
  component: MRSidebar,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div
        style={{ width: 340 }}
        className="rounded-lg border border-border bg-card overflow-hidden"
      >
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MRSidebar>;

/** All sections including actions. */
export const Default: Story = {
  args: { mr: mocks.mergeable },
  render: args => (
    <MRSidebar {...args}>
      <MRSidebar.Header />
      <MRSidebar.Changes />
      <MRSidebar.Status />
      <MRSidebar.Actions />
    </MRSidebar>
  ),
};

/** With a linked ticket section. */
export const WithTicket: Story = {
  args: { mr: mocks.mergeable },
  render: args => (
    <MRSidebar {...args}>
      <MRSidebar.Header />
      <MRSidebar.Ticket
        ticket={{
          id: 'ACME-1231',
          label: 'Van Images + Unsupported Body Type + Dark Mode Vehicle Images',
          url: 'https://linear.app/acme/issue/ACME-1231',
        }}
      />
      <MRSidebar.Changes />
      <MRSidebar.Status />
      <MRSidebar.Actions />
    </MRSidebar>
  ),
};

/** Pipeline failing + rebase needed. */
export const Blocked: Story = {
  args: { mr: mocks.needsRebase },
  render: args => (
    <MRSidebar {...args}>
      <MRSidebar.Header />
      <MRSidebar.Changes />
      <MRSidebar.Status />
      <MRSidebar.Actions />
    </MRSidebar>
  ),
};

/** Draft MR — no merge button visible. */
export const Draft: Story = {
  args: { mr: mocks.draft },
  render: args => (
    <MRSidebar {...args}>
      <MRSidebar.Header />
      <MRSidebar.Changes />
      <MRSidebar.Status />
      <MRSidebar.Actions />
    </MRSidebar>
  ),
};

/** Merged MR — no actions visible. */
export const Merged: Story = {
  args: { mr: mocks.merged },
  render: args => (
    <MRSidebar {...args}>
      <MRSidebar.Header />
      <MRSidebar.Changes />
      <MRSidebar.Status />
      <MRSidebar.Actions />
    </MRSidebar>
  ),
};

/** Auto-merge enabled. */
export const AutoMerge: Story = {
  args: { mr: mocks.autoMergeActive },
  render: args => (
    <MRSidebar {...args}>
      <MRSidebar.Header />
      <MRSidebar.Changes />
      <MRSidebar.Status />
      <MRSidebar.Actions />
    </MRSidebar>
  ),
};

/** Loading skeleton before data arrives. */
export const Loading: Story = {
  render: () => (
    <MRSidebar loading>
      <MRSidebar.Header />
    </MRSidebar>
  ),
};
