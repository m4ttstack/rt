import type { Meta, StoryObj } from '@storybook/react-vite';
import { MRCardError } from '../components/forge/MRCardError';

const meta: Meta<typeof MRCardError> = {
  title: 'Forge/MRCard/Error',
  component: MRCardError,
  parameters: { layout: 'centered' },
  decorators: [
    Story => (
      <div style={{ width: 380 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MRCardError>;

export const Standalone: Story = {
  args: {
    error: new Error('WebSocket connection failed after 3 retries'),
    onRetry: () => alert('onRetry()'),
  },
};

export const StandaloneNoRetry: Story = {
  name: 'Standalone (no retry)',
  args: {
    error: new Error('MR not found — it may have been deleted'),
  },
};

export const Inline: Story = {
  args: {
    error: new Error('Failed to fetch latest pipeline status'),
    variant: 'inline',
    onRetry: () => alert('onRetry()'),
  },
};

export const InlineNoRetry: Story = {
  name: 'Inline (no retry)',
  args: {
    error: new Error('Branch "feat/old" no longer exists'),
    variant: 'inline',
  },
};

/** Standalone + inline shown together for comparison. */
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <MRCardError
        error={new Error('WebSocket connection failed after 3 retries')}
        onRetry={() => {}}
      />
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-3 py-2 text-sm text-foreground">Card content above error</div>
        <MRCardError
          error={new Error('Failed to fetch latest pipeline status')}
          variant="inline"
          onRetry={() => {}}
        />
      </div>
    </div>
  ),
};
