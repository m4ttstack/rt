import type { MRDashboardProps } from '@mattstack/glance';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRCard } from '../components/forge/MRCard';
import { CARD_WIDTH } from './constants';
import { mergeable } from './mocks/mrDashboard.mock';

/**
 * Playground args — flat controls that get assembled into MRDashboardProps.
 */
interface PlaygroundArgs {
  // Identity
  title: string;
  iid: number;
  sourceBranch: string;
  targetBranch: string;

  // Status
  status: MRDashboardProps['status'];
  isDraft: boolean;
  isLoading: boolean;
  isMerging: boolean;

  // Pipeline
  pipelineStatus: 'success' | 'failed' | 'running' | 'none';
  pipelinePassing: number;
  pipelineFailing: number;
  pipelineRunning: number;
  pipelineTotal: number;
  pipelineHasWarnings: boolean;

  // Reviews
  approvalsGiven: number;
  approvalsRequired: number;
  approvalsRemaining: number;

  // Diff
  additions: number;
  deletions: number;
  filesChanged: number;

  // Blockers
  hasConflicts: boolean;
  needsRebase: boolean;
  pipelineFailing_blocker: boolean;
  awaitingApprovals: boolean;
  hasUnresolvedDiscussions: boolean;
  isDraft_blocker: boolean;
  behindBy: number;

  // Buttons
  mergeVisible: boolean;
  mergeDisabled: boolean;
  rebaseVisible: boolean;
  autoMergeActive: boolean;
}

function assembleMR(args: PlaygroundArgs): MRDashboardProps {
  const pipeline: MRDashboardProps['pipeline'] =
    args.pipelineStatus === 'none'
      ? null
      : (() => {
          const jobNames = ['lint', 'typecheck', 'unit-tests', 'integration-tests', 'e2e-chrome', 'e2e-firefox', 'build', 'deploy-staging'];
          const jobs: NonNullable<MRDashboardProps['pipeline']>['jobs'] = [];
          for (let i = 0; i < args.pipelineFailing; i++) {
            jobs.push({ id: `mock:f${i}`, name: jobNames[i % jobNames.length], stage: 'test', status: 'failed', allowFailure: false, webUrl: null, duration: null });
          }
          for (let i = 0; i < args.pipelineRunning; i++) {
            jobs.push({ id: `mock:r${i}`, name: jobNames[(i + args.pipelineFailing) % jobNames.length], stage: 'test', status: 'running', allowFailure: false, webUrl: null, duration: null });
          }
          return {
            id: 'mock:pipeline:1',
            status: args.pipelineStatus,
            passing: args.pipelinePassing,
            failing: args.pipelineFailing,
            running: args.pipelineRunning,
            total: args.pipelineTotal,
            hasWarnings: args.pipelineHasWarnings,
            jobs,
          };
        })();

  const isDraftBlocker = args.isDraft || args.isDraft_blocker;

  const anyBlocker =
    args.hasConflicts ||
    args.needsRebase ||
    args.pipelineFailing_blocker ||
    args.awaitingApprovals ||
    args.hasUnresolvedDiscussions ||
    isDraftBlocker;

  // isDraft overrides status to 'draft' (matching SDK behavior)
  const status = args.isDraft ? 'draft' : args.status;

  return {
    ...mergeable,
    iid: args.iid,
    title: args.title,
    sourceBranch: args.sourceBranch,
    targetBranch: args.targetBranch,
    isDraft: args.isDraft,
    status,
    isLoading: args.isLoading,
    isMerging: args.isMerging,
    pipeline,
    diff: {
      additions: args.additions,
      deletions: args.deletions,
      filesChanged: args.filesChanged,
    },
    reviews: {
      ...mergeable.reviews,
      given: args.approvalsGiven,
      required: args.approvalsRequired,
      remaining: args.approvalsRemaining,
      isApproved: args.approvalsRemaining === 0,
    },
    blockers: {
      isDraft: isDraftBlocker,
      hasConflicts: args.hasConflicts,
      needsRebase: args.needsRebase,
      pipelineFailing: args.pipelineFailing_blocker,
      pipelineRunning: false,
      awaitingApprovals: args.awaitingApprovals,
      hasUnresolvedDiscussions: args.hasUnresolvedDiscussions,
      hasMergeError: false,
      mergeError: null,
      any: anyBlocker,
    },
    mergeButton: {
      visible: args.mergeVisible,
      disabled: args.mergeDisabled,
      loading: args.isMerging,
      label: 'Merge',
    },
    rebaseButton: {
      visible: args.rebaseVisible,
      loading: false,
      label: 'Rebase',
      behindBy: args.behindBy,
    },
    autoMergeButton: {
      ...mergeable.autoMergeButton,
      isActive: args.autoMergeActive,
    },
  };
}

const meta: Meta<PlaygroundArgs> = {
  title: 'Forge/MRCard/Playground',
  parameters: { layout: 'centered', save: { disable: true } },
  decorators: [
    Story => (
      <div style={{ width: CARD_WIDTH }}>
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
    approvalsRemaining: { control: { type: 'range', min: 0, max: 10 } },
    additions: { control: { type: 'range', min: 0, max: 500 } },
    deletions: { control: { type: 'range', min: 0, max: 500 } },
    filesChanged: { control: { type: 'range', min: 0, max: 50 } },
    behindBy: { control: { type: 'range', min: 0, max: 100 } },
  },
  args: {
    title: 'feat: add getMRDashboardProps — headless UI props',
    iid: 42,
    sourceBranch: 'feat/mr-dashboard-props',
    targetBranch: 'main',
    status: 'mergeable',
    isDraft: false,
    isLoading: false,
    isMerging: false,
    pipelineStatus: 'success',
    pipelinePassing: 24,
    pipelineFailing: 0,
    pipelineRunning: 0,
    pipelineTotal: 24,
    pipelineHasWarnings: false,
    approvalsGiven: 2,
    approvalsRequired: 2,
    approvalsRemaining: 0,
    additions: 142,
    deletions: 38,
    filesChanged: 9,
    hasConflicts: false,
    needsRebase: false,
    pipelineFailing_blocker: false,
    awaitingApprovals: false,
    hasUnresolvedDiscussions: false,
    isDraft_blocker: false,
    behindBy: 0,
    mergeVisible: true,
    mergeDisabled: false,
    rebaseVisible: false,
    autoMergeActive: false,
  },
};
export default meta;

type Story = StoryObj<PlaygroundArgs>;

export const Playground: Story = {
  render: args => <MRCard mr={assembleMR(args)} />,
};
