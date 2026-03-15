import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReviewerList } from '../components/forge/ReviewerList';
import * as mocks from './mocks/mrDashboard.mock';

const meta: Meta<typeof ReviewerList> = {
  title: 'Forge/ReviewerList',
  component: ReviewerList,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 280 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ReviewerList>;

export const AllStates: Story = {
  args: { reviewers: mocks.mergeable.reviews.reviewers },
};

export const SingleApproved: Story = {
  args: { reviewers: [mocks.mergeable.reviews.reviewers[0]] },
};

export const Empty: Story = {
  args: { reviewers: [] },
};

export const Loading: Story = {
  args: { loading: true, loadingCount: 3 },
};
