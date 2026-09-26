import { lazy, useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { LazyLoader } from './LazyLoader';

const meta = {
  title: 'Core/LazyLoader',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

// A component that only "arrives" after an artificial delay, so the story
// can show the Suspense fallback for a moment before the real content pops
// in -- standing in for a real `React.lazy(() => import('./Panel'))`.
const SlowPanel = lazy(
  () =>
    new Promise<{ default: () => React.ReactElement }>(resolve =>
      setTimeout(
        () => resolve({ default: () => <Text>Loaded content, at last.</Text> }),
        1200
      )
    )
);

function LazyLoaderDemo() {
  const [mountKey, setMountKey] = useState(0);

  return (
    <Stack p="lg" gap="md" align="flex-start">
      <Button onClick={() => setMountKey(key => key + 1)}>
        Remount (replay loading)
      </Button>
      <LazyLoader key={mountKey} minHeight={80}>
        <SlowPanel />
      </LazyLoader>
    </Stack>
  );
}

export const Default: Story = {
  render: () => <LazyLoaderDemo />,
};
