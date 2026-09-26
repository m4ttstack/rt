import type { Meta, StoryObj } from '@storybook/react-vite';

import { MRCardSkeleton } from '../components/forge/MRSkeletons';
import { MRRowSkeleton, MRRowListSkeleton } from '../components/forge/MRSkeletons';
import { MRNodeSkeleton } from '../components/forge/MRSkeletons';
import { CARD_WIDTH } from './constants';

// ── MRCardSkeleton ─────────────────────────────────────────────────────────────

const cardMeta: Meta<typeof MRCardSkeleton> = {
  title: 'Forge/MRCard/Skeleton',
  component: MRCardSkeleton,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: CARD_WIDTH }}>
        <Story />
      </div>
    ),
  ],
};
export default cardMeta;

type CardStory = StoryObj<typeof MRCardSkeleton>;

export const Default: CardStory = {};

// ── MRRowSkeleton ──────────────────────────────────────────────────────────────

export const Row: StoryObj<typeof MRRowSkeleton> = {
  render: () => (
    <div style={{ width: CARD_WIDTH }}>
      <MRRowSkeleton />
    </div>
  ),
};

export const RowList: StoryObj<typeof MRRowListSkeleton> = {
  render: () => (
    <div style={{ width: CARD_WIDTH }}>
      <MRRowListSkeleton count={4} />
    </div>
  ),
};

// ── MRNodeSkeleton ─────────────────────────────────────────────────────────────

export const Node: StoryObj<typeof MRNodeSkeleton> = {
  render: () => (
    <div style={{ width: 260 }}>
      <MRNodeSkeleton />
    </div>
  ),
};
