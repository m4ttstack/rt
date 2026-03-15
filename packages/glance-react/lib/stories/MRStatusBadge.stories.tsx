import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRStatusBadge } from '../components/forge/MRStatusBadge';

const meta: Meta<typeof MRStatusBadge> = {
  title: 'Forge/MRStatusBadge',
  component: MRStatusBadge,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof MRStatusBadge>;

export const Mergeable: Story = { args: { status: 'mergeable' } };
export const Blocked: Story = { args: { status: 'blocked' } };
export const Draft: Story = { args: { status: 'draft' } };
export const Merged: Story = { args: { status: 'merged' } };
export const Closed: Story = { args: { status: 'closed' } };
export const Loading: Story = { args: { status: 'blocked', loading: true } };
export const Skeleton: Story = { args: { loading: true } };
