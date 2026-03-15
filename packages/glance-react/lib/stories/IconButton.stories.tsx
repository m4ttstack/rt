import type { Meta, StoryObj } from '@storybook/react-vite';
import { IconButton } from '../components/ui/icon-button';
import { GitLabIcon, GitHubIcon } from '../components/forge/brand-icons';

const meta: Meta<typeof IconButton> = {
  title: 'Primitives/IconButton',
  component: IconButton,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof IconButton>;

const colors = ['emphasis', 'action', 'positive', 'negative', 'caution', 'neutral', 'merge'] as const;

/* ── Variants × Colors ────────────────────────────────────────────── */

export const Ghost: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      {colors.map(c => (
        <IconButton key={c} variant="ghost" color={c} aria-label={c}>
          <GitLabIcon className="size-4" />
        </IconButton>
      ))}
    </div>
  ),
};

export const Outline: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      {colors.map(c => (
        <IconButton key={c} variant="outline" color={c} aria-label={c}>
          <GitLabIcon className="size-4" />
        </IconButton>
      ))}
    </div>
  ),
};

export const Subtle: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      {colors.map(c => (
        <IconButton key={c} variant="subtle" color={c} aria-label={c}>
          <GitLabIcon className="size-4" />
        </IconButton>
      ))}
    </div>
  ),
};

export const Filled: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      {colors.map(c => (
        <IconButton key={c} variant="filled" color={c} aria-label={c}>
          <GitLabIcon className="size-4" />
        </IconButton>
      ))}
    </div>
  ),
};

/* ── Sizes ────────────────────────────────────────────────────────── */

export const StandardSizes: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <IconButton aria-label="xs" size="xs"><GitLabIcon className="size-3" /></IconButton>
      <IconButton aria-label="sm" size="sm"><GitLabIcon className="size-4" /></IconButton>
      <IconButton aria-label="default"><GitLabIcon className="size-5" /></IconButton>
      <IconButton aria-label="lg" size="lg"><GitLabIcon className="size-5" /></IconButton>
      <span className="text-xs text-muted-foreground mx-2">│</span>
      <IconButton aria-label="xs" size="xs"><GitHubIcon className="size-3" /></IconButton>
      <IconButton aria-label="sm" size="sm"><GitHubIcon className="size-4" /></IconButton>
      <IconButton aria-label="default"><GitHubIcon className="size-5" /></IconButton>
      <IconButton aria-label="lg" size="lg"><GitHubIcon className="size-5" /></IconButton>
    </div>
  ),
};

/* ── Compact Sizes ────────────────────────────────────────────────── */

export const CompactGhost: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <IconButton aria-label="compact-xs" size="compact-xs"><GitLabIcon className="size-3" /></IconButton>
      <IconButton aria-label="compact-sm" size="compact-sm"><GitLabIcon className="size-3.5" /></IconButton>
      <IconButton aria-label="compact-md" size="compact-md"><GitLabIcon className="size-4" /></IconButton>
      <IconButton aria-label="compact-lg" size="compact-lg"><GitLabIcon className="size-4" /></IconButton>
    </div>
  ),
};

export const CompactOutline: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <IconButton variant="outline" aria-label="compact-xs" size="compact-xs"><GitLabIcon className="size-3" /></IconButton>
      <IconButton variant="outline" aria-label="compact-sm" size="compact-sm"><GitLabIcon className="size-3.5" /></IconButton>
      <IconButton variant="outline" aria-label="compact-md" size="compact-md"><GitLabIcon className="size-4" /></IconButton>
      <IconButton variant="outline" aria-label="compact-lg" size="compact-lg"><GitLabIcon className="size-4" /></IconButton>
    </div>
  ),
};

export const CompactFilled: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2 items-center">
      <IconButton variant="filled" color="emphasis" aria-label="compact-xs" size="compact-xs"><GitLabIcon className="size-3" /></IconButton>
      <IconButton variant="filled" color="emphasis" aria-label="compact-sm" size="compact-sm"><GitLabIcon className="size-3.5" /></IconButton>
      <IconButton variant="filled" color="emphasis" aria-label="compact-md" size="compact-md"><GitLabIcon className="size-4" /></IconButton>
      <IconButton variant="filled" color="emphasis" aria-label="compact-lg" size="compact-lg"><GitLabIcon className="size-4" /></IconButton>
    </div>
  ),
};

/** Side-by-side comparison of standard vs compact sizes. */
export const SizeComparison: Story = {
  render: () => (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-muted-foreground mb-2">standard (xs → lg)</p>
        <div className="flex flex-wrap gap-2 items-center">
          <IconButton aria-label="xs" size="xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton aria-label="sm" size="sm"><GitLabIcon className="size-4" /></IconButton>
          <IconButton aria-label="default"><GitLabIcon className="size-5" /></IconButton>
          <IconButton aria-label="lg" size="lg"><GitLabIcon className="size-5" /></IconButton>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-2">compact (compact-xs → compact-lg)</p>
        <div className="flex flex-wrap gap-2 items-center">
          <IconButton aria-label="compact-xs" size="compact-xs"><GitLabIcon className="size-3" /></IconButton>
          <IconButton aria-label="compact-sm" size="compact-sm"><GitLabIcon className="size-3.5" /></IconButton>
          <IconButton aria-label="compact-md" size="compact-md"><GitLabIcon className="size-4" /></IconButton>
          <IconButton aria-label="compact-lg" size="compact-lg"><GitLabIcon className="size-4" /></IconButton>
        </div>
      </div>
    </div>
  ),
};

/* ── Loading (spinner replaces icon) ─────────────────────────────── */

export const Loading: Story = {
  render: () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">spinner replaces icon</p>
      <div className="flex flex-wrap gap-2 items-center">
        <IconButton loading aria-label="xs" size="xs"><GitLabIcon className="size-3" /></IconButton>
        <IconButton loading aria-label="sm" size="sm"><GitLabIcon className="size-4" /></IconButton>
        <IconButton loading aria-label="default"><GitLabIcon className="size-5" /></IconButton>
        <IconButton loading aria-label="lg" size="lg"><GitLabIcon className="size-5" /></IconButton>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <IconButton loading variant="outline" color="emphasis" aria-label="outline"><GitLabIcon className="size-4" /></IconButton>
        <IconButton loading variant="filled" color="emphasis" aria-label="filled"><GitLabIcon className="size-4" /></IconButton>
      </div>
    </div>
  ),
};

/* ── Skeleton (placeholder while UI loads) ───────────────────────── */

export const SkeletonPlaceholder: Story = {
  name: 'Skeleton',
  render: () => (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">skeleton placeholder</p>
      <div className="flex flex-wrap gap-2 items-center">
        <IconButton skeleton aria-label="xs" size="xs"><GitLabIcon className="size-3" /></IconButton>
        <IconButton skeleton aria-label="sm" size="sm"><GitLabIcon className="size-4" /></IconButton>
        <IconButton skeleton aria-label="default"><GitLabIcon className="size-5" /></IconButton>
        <IconButton skeleton aria-label="lg" size="lg"><GitLabIcon className="size-5" /></IconButton>
      </div>
      <p className="text-xs text-muted-foreground">normal for comparison</p>
      <div className="flex flex-wrap gap-2 items-center">
        <IconButton aria-label="xs" size="xs"><GitLabIcon className="size-3" /></IconButton>
        <IconButton aria-label="sm" size="sm"><GitLabIcon className="size-4" /></IconButton>
        <IconButton aria-label="default"><GitLabIcon className="size-5" /></IconButton>
        <IconButton aria-label="lg" size="lg"><GitLabIcon className="size-5" /></IconButton>
      </div>
    </div>
  ),
};
