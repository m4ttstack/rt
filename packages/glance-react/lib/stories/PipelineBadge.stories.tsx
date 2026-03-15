import type { Meta, StoryObj } from '@storybook/react-vite';

import { PipelineBadge } from '../components/forge/PipelineBadge';
import * as mocks from './mocks/mrDashboard.mock';

const meta: Meta<typeof PipelineBadge> = {
  title: 'Forge/PipelineBadge',
  component: PipelineBadge,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof PipelineBadge>;

export const Passing: Story = { args: { pipeline: mocks.mergeable.pipeline } };
export const Failing: Story = {
  args: { pipeline: mocks.pipelineBlocked.pipeline },
};
export const Running: Story = { args: { pipeline: mocks.draft.pipeline } };
export const NoPipeline: Story = { args: { pipeline: null } };
export const WithWarning: Story = {
  args: {
    pipeline: {
      status: 'success',
      passing: 22,
      failing: 0,
      running: 0,
      total: 24,
      hasWarnings: true,
      jobs: [],
    },
  },
};
export const Loading: Story = { args: { loading: true } };
