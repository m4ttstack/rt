import { Stack } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { TextInput } from './TextInput';

// No `component` on `meta` -- these are plain `render` demos, not
// args-driven (see PageShell.stories.tsx for why).
const meta = {
  title: 'Core/TextInput',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  name: 'Default (autoComplete off)',
  render: () => (
    <Stack maw={360}>
      <TextInput label="Asset tag" placeholder="camera_kit" />
      <TextInput
        label="Description"
        placeholder="Optional"
        description="The kit shadow defaults autoComplete='off' -- browser autofill is noise on most app fields."
      />
    </Stack>
  ),
};

export const AutofillOptIn: Story = {
  name: 'Opting back into autofill',
  render: () => (
    <Stack maw={360}>
      {/* Real login/signup/profile fields should opt back in with a
          specific token, which beats a generic "on" for autofill quality. */}
      <TextInput
        label="Email"
        placeholder="you@example.com"
        autoComplete="email"
      />
      <TextInput
        label="Search"
        placeholder="Search gear..."
        error="With an error state"
      />
    </Stack>
  ),
};
