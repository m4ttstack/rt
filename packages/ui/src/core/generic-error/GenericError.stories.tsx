import type { Meta, StoryObj } from '@storybook/react-vite';

import { GenericError } from './GenericError';

const meta = {
  component: GenericError,
  title: 'Core/GenericError',
} satisfies Meta<typeof GenericError>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    message: "This panel couldn't load its data.",
  },
};

export const WithRetry: Story = {
  args: {
    message: 'We hit a network error loading this section.',
    onRetry: () => {},
  },
};
