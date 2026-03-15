import type { MRDashboardProps } from '@workforge/glance-sdk';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRRow } from '../components/forge/MRRow';
import { CARD_WIDTH } from './constants';
import { mergeable } from './mocks/mrDashboard.mock';

interface PlaygroundArgs {
  title: string;
  iid: number;
  sourceBranch: string;
  targetBranch: string;
  status: MRDashboardProps['status'];
  isLoading: boolean;

  // Pipeline
  pipelineStatus: 'success' | 'failed' | 'running' | 'none';
  pipelinePassing: number;
  pipelineFailing: number;
  pipelineRunning: number;
  pipelineTotal: number;

  // Reviews
  approvalsGiven: number;
  approvalsRequired: number;
  reviewersActed: number;
  reviewersTotal: number;
  isApproved: boolean;

  // Diff
  additions: number;
  deletions: number;
}

function assembleMR(args: PlaygroundArgs): MRDashboardProps {
  const pipeline: MRDashboardProps['pipeline'] =
    args.pipelineStatus === 'none'
      ? null
      : {
          status: args.pipelineStatus,
          passing: args.pipelinePassing,
          failing: args.pipelineFailing,
          running: args.pipelineRunning,
          total: args.pipelineTotal,
          hasWarnings: false,
          jobs: [],
        };

  return {
    ...mergeable,
    iid: args.iid,
    title: args.title,
    sourceBranch: args.sourceBranch,
    targetBranch: args.targetBranch,
    status: args.status,
    isLoading: args.isLoading,
    pipeline,
    diff: {
      additions: args.additions,
      deletions: args.deletions,
      filesChanged: 0,
    },
    reviews: {
      ...mergeable.reviews,
      given: args.approvalsGiven,
      required: args.approvalsRequired,
      remaining: args.approvalsRequired - args.approvalsGiven,
      isApproved: args.isApproved,
      haveActed: args.reviewersActed,
      totalAssigned: args.reviewersTotal,
    },
  };
}

const meta: Meta<PlaygroundArgs> = {
  title: 'Forge/MRRow/Playground',
  parameters: { layout: 'padded', save: { disable: true } },
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
  argTypes: {
    status: {
      control: 'select',
      options: ['mergeable', 'blocked', 'draft', 'merged', 'closed'],
    },
    pipelineStatus: {
      control: 'select',
      options: ['success', 'failed', 'running', 'none'],
    },
    pipelinePassing: { control: { type: 'range', min: 0, max: 50 } },
    pipelineFailing: { control: { type: 'range', min: 0, max: 50 } },
    pipelineRunning: { control: { type: 'range', min: 0, max: 50 } },
    pipelineTotal: { control: { type: 'range', min: 0, max: 50 } },
    approvalsGiven: { control: { type: 'range', min: 0, max: 10 } },
    approvalsRequired: { control: { type: 'range', min: 0, max: 10 } },
    reviewersActed: { control: { type: 'range', min: 0, max: 10 } },
    reviewersTotal: { control: { type: 'range', min: 0, max: 10 } },
    additions: { control: { type: 'range', min: 0, max: 500 } },
    deletions: { control: { type: 'range', min: 0, max: 500 } },
  },
  args: {
    title: 'feat: add getMRDashboardProps — headless UI props',
    iid: 42,
    sourceBranch: 'feat/mr-dashboard-props',
    targetBranch: 'main',
    status: 'mergeable',
    isLoading: false,
    pipelineStatus: 'success',
    pipelinePassing: 24,
    pipelineFailing: 0,
    pipelineRunning: 0,
    pipelineTotal: 24,
    approvalsGiven: 2,
    approvalsRequired: 2,
    reviewersActed: 1,
    reviewersTotal: 3,
    isApproved: true,
    additions: 142,
    deletions: 38,
  },
};
export default meta;

type Story = StoryObj<PlaygroundArgs>;

export const Playground: Story = {
  render: args => <MRRow mr={assembleMR(args)} />,
};
