import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRCard } from '../components/forge/MRCard';
import { CARD_WIDTH } from './constants';
import * as mocks from './mocks/mrDashboard.mock';

const meta: Meta<typeof MRCard> = {
  title: 'Forge/MRCard',
  component: MRCard,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: CARD_WIDTH }}>
        <Story />
      </div>
    ),
  ],
  args: {},
};
export default meta;

type Story = StoryObj<typeof MRCard>;

export const Mergeable: Story = { args: { mr: mocks.mergeable } };
export const PipelineBlocked: Story = { args: { mr: mocks.pipelineBlocked } };
export const Draft: Story = { args: { mr: mocks.draft } };
export const NeedsRebase: Story = { args: { mr: mocks.needsRebase } };
export const Merging: Story = { args: { mr: mocks.merging } };
export const Merged: Story = { args: { mr: mocks.merged } };
export const Conflicts: Story = { args: { mr: mocks.conflicts } };
export const AutoMergeActive: Story = { args: { mr: mocks.autoMergeActive } };
export const Loading: Story = { args: { loading: true } };
