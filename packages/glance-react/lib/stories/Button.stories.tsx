import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '../components/ui/button';
import { GitLabIcon } from '../components/forge/brand-icons';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof Button>;

/* ── Variants ─────────────────────────────────────────────────────── */

export const Filled: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Button color="emphasis">Emphasis</Button>
      <Button color="merge">Merge</Button>
      <Button color="action">Action</Button>
      <Button color="positive">Positive</Button>
      <Button color="negative">Negative</Button>
      <Button color="caution">Caution</Button>
      <Button color="neutral">Neutral</Button>
    </div>
  ),
};

export const Outline: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Button variant="outline" color="emphasis">Emphasis</Button>
      <Button variant="outline" color="action">Action</Button>
      <Button variant="outline" color="positive">Positive</Button>
      <Button variant="outline" color="negative">Negative</Button>
      <Button variant="outline" color="caution">Caution</Button>
      <Button variant="outline" color="neutral">Neutral</Button>
    </div>
  ),
};

export const Subtle: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Button variant="subtle" color="emphasis">Emphasis</Button>
      <Button variant="subtle" color="action">Action</Button>
      <Button variant="subtle" color="positive">Positive</Button>
      <Button variant="subtle" color="negative">Negative</Button>
      <Button variant="subtle" color="caution">Caution</Button>
      <Button variant="subtle" color="neutral">Neutral</Button>
    </div>
  ),
};

export const Ghost: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Button variant="ghost" color="emphasis">Emphasis</Button>
      <Button variant="ghost" color="action">Action</Button>
      <Button variant="ghost" color="positive">Positive</Button>
      <Button variant="ghost" color="negative">Negative</Button>
      <Button variant="ghost" color="caution">Caution</Button>
      <Button variant="ghost" color="neutral">Neutral</Button>
    </div>
  ),
};

export const Link: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Button variant="link" color="emphasis">Emphasis</Button>
      <Button variant="link" color="action">Action</Button>
      <Button variant="link" color="positive">Positive</Button>
      <Button variant="link" color="negative">Negative</Button>
      <Button variant="link" color="caution">Caution</Button>
      <Button variant="link" color="neutral">Neutral</Button>
    </div>
  ),
};

/* ── Sizes ────────────────────────────────────────────────────────── */

export const StandardSizes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="xs">XS</Button>
      <Button size="sm">SM</Button>
      <Button size="default">Default</Button>
      <Button size="lg">LG</Button>
    </div>
  ),
};

export const CompactSizes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="compact-xs">Compact XS</Button>
      <Button size="compact-sm">Compact SM</Button>
      <Button size="compact-md">Compact MD</Button>
      <Button size="compact-lg">Compact LG</Button>
    </div>
  ),
};

/** Side-by-side comparison of standard vs compact sizes. */
export const SizeComparison: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground mb-2">standard</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="xs">XS</Button>
          <Button size="sm">SM</Button>
          <Button size="default">Default</Button>
          <Button size="lg">LG</Button>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">compact</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="compact-xs">Compact XS</Button>
          <Button size="compact-sm">Compact SM</Button>
          <Button size="compact-md">Compact MD</Button>
          <Button size="compact-lg">Compact LG</Button>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">compact outline</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" color="neutral" size="compact-xs">Compact XS</Button>
          <Button variant="outline" color="neutral" size="compact-sm">Compact SM</Button>
          <Button variant="outline" color="neutral" size="compact-md">Compact MD</Button>
          <Button variant="outline" color="neutral" size="compact-lg">Compact LG</Button>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">compact with icon</p>
        <div className="flex flex-wrap gap-2 items-center">
          <Button size="compact-xs"><GitLabIcon className="size-3" />XS</Button>
          <Button size="compact-sm"><GitLabIcon className="size-3" />SM</Button>
          <Button size="compact-md"><GitLabIcon className="size-4" />MD</Button>
          <Button size="compact-lg"><GitLabIcon className="size-4" />LG</Button>
        </div>
      </div>
    </div>
  ),
};

/* ── Loading (async action in-progress) ──────────────────────────── */

export const Loading: Story = {
  render: () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">spinner — async action in progress</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Button loading color="emphasis">Merging…</Button>
        <Button loading color="merge">Merge</Button>
        <Button loading color="positive">Approve</Button>
        <Button loading color="neutral">Rebase</Button>
      </div>
      <p className="text-xs text-muted-foreground">outline + compact</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Button loading variant="outline" color="emphasis">Saving…</Button>
        <Button loading variant="outline" color="neutral">Loading</Button>
        <Button loading size="compact-sm">SM</Button>
        <Button loading size="compact-md">MD</Button>
      </div>
    </div>
  ),
};

/* ── Skeleton (UI placeholder while page loads) ──────────────────── */

export const SkeletonPlaceholder: Story = {
  name: 'Skeleton',
  render: () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">skeleton — placeholder while UI loads</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Button skeleton>Merge</Button>
        <Button skeleton>Rebase</Button>
        <Button skeleton size="sm">Approve</Button>
      </div>
      <p className="text-xs text-muted-foreground">normal for comparison</p>
      <div className="flex flex-wrap gap-2 items-center">
        <Button color="merge">Merge</Button>
        <Button variant="outline" color="neutral">Rebase</Button>
        <Button color="positive" size="sm">Approve</Button>
      </div>
    </div>
  ),
};

