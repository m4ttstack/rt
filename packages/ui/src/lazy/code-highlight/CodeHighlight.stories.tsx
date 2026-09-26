import { Stack } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { CodeHighlight } from './CodeHighlight';

// No `component` on `meta` -- `MultipleLanguages` renders more than one
// instance, so every story here is a plain `render` demo instead of being
// args-driven (see GradientBorder.stories.tsx for the same pattern).
const meta = {
  title: 'Lazy/CodeHighlight',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const sample = `function greet(name) {
  return \`Hello, \${name}!\`;
}`;

export const Default: Story = {
  render: () => <CodeHighlight code={sample} language="javascript" />,
};

export const WithLineNumbers: Story = {
  render: () => (
    <CodeHighlight code={sample} language="javascript" withLineNumbers />
  ),
};

// A few languages side by side, to show the same lazily-loaded component
// handling more than one `language` value.
export const MultipleLanguages: Story = {
  render: () => (
    <Stack maw={480} gap="md">
      <CodeHighlight code={`{ "hello": "world" }`} language="json" />
      <CodeHighlight
        code={`SELECT * FROM users WHERE id = 1;`}
        language="sql"
      />
      <CodeHighlight code={sample} language="javascript" />
    </Stack>
  ),
};
