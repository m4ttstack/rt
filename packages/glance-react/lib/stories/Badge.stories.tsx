import type { Meta, StoryObj } from '@storybook/react-vite';
import { Badge } from '../components/ui/badge';

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Badge>;

/* ── Variants ─────────────────────────────────────────────────────── */

export const Filled: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Badge color="emphasis">Emphasis</Badge>
      <Badge color="merge">Merge</Badge>
      <Badge color="action">Action</Badge>
      <Badge color="positive">Positive</Badge>
      <Badge color="negative">Negative</Badge>
      <Badge color="caution">Caution</Badge>
      <Badge color="neutral">Neutral</Badge>
    </div>
  ),
};

export const Outline: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Badge variant="outline" color="emphasis">Emphasis</Badge>
      <Badge variant="outline" color="merge">Merge</Badge>
      <Badge variant="outline" color="action">Action</Badge>
      <Badge variant="outline" color="positive">Positive</Badge>
      <Badge variant="outline" color="negative">Negative</Badge>
      <Badge variant="outline" color="caution">Caution</Badge>
      <Badge variant="outline" color="neutral">Neutral</Badge>
    </div>
  ),
};

export const Subtle: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Badge variant="subtle" color="emphasis">Emphasis</Badge>
      <Badge variant="subtle" color="merge">Merge</Badge>
      <Badge variant="subtle" color="action">Action</Badge>
      <Badge variant="subtle" color="positive">Positive</Badge>
      <Badge variant="subtle" color="negative">Negative</Badge>
      <Badge variant="subtle" color="caution">Caution</Badge>
      <Badge variant="subtle" color="neutral">Neutral</Badge>
    </div>
  ),
};

export const Ghost: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Badge variant="ghost" color="emphasis">Emphasis</Badge>
      <Badge variant="ghost" color="merge">Merge</Badge>
      <Badge variant="ghost" color="action">Action</Badge>
      <Badge variant="ghost" color="positive">Positive</Badge>
      <Badge variant="ghost" color="negative">Negative</Badge>
      <Badge variant="ghost" color="caution">Caution</Badge>
      <Badge variant="ghost" color="neutral">Neutral</Badge>
    </div>
  ),
};

/* ── Loading ──────────────────────────────────────────────────────── */

export const Loading: Story = {
  render: () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">loading preserves width of content</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Badge loading color="positive">Ready to merge</Badge>
        <Badge loading color="caution">Blocked</Badge>
        <Badge loading color="neutral">Draft</Badge>
        <Badge loading color="merge">Merged</Badge>
        <Badge loading color="negative">Closed</Badge>
      </div>
      <p className="text-xs text-muted-foreground">normal for comparison</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Badge color="positive">Ready to merge</Badge>
        <Badge color="caution">Blocked</Badge>
        <Badge color="neutral">Draft</Badge>
        <Badge color="merge">Merged</Badge>
        <Badge color="negative">Closed</Badge>
      </div>
    </div>
  ),
};

/* ── Sizes ────────────────────────────────────────────────────────── */

const colors = ['emphasis', 'merge', 'action', 'positive', 'negative', 'caution', 'neutral'] as const;

export const Sizes: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground mb-2">default</p>
        <div className="flex flex-wrap gap-2 items-center">
          {colors.map(c => (
            <Badge key={c} color={c}>{c}</Badge>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">lg</p>
        <div className="flex flex-wrap gap-2 items-center">
          {colors.map(c => (
            <Badge key={c} size="lg" color={c}>{c}</Badge>
          ))}
        </div>
      </div>
    </div>
  ),
};
