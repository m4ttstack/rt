import { useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { Button, Group, Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { CodeMirror } from './CodeMirror';
import type { CodeMirrorRef } from './CodeMirror.Base';

// No `component` on `meta` -- `Controlled` owns its own state, so every
// story here is a plain `render` demo instead of being args-driven (see
// GradientBorder.stories.tsx for the same pattern).
const meta = {
  title: 'Lazy/CodeMirror',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <CodeMirror
      value={'function greet(name) {\n  return `Hello, ${name}!`;\n}'}
      language="javascript"
    />
  ),
};

export const JsonReadOnly: Story = {
  render: () => (
    <CodeMirror value={'{\n  "hello": "world"\n}'} language="json" readOnly />
  ),
};

export const EmptyWithPlaceholder: Story = {
  render: () => (
    <CodeMirror placeholder="Type some JavaScript..." language="javascript" />
  ),
};

// A controlled editor -- `value` + `onChange` kept in a parent's state, the
// same pattern a real form field would use.
function ControlledDemo() {
  const [value, setValue] = useState('const total = 1 + 1;');

  return (
    <Stack maw={480} gap="sm">
      <CodeMirror
        value={value}
        onChange={setValue}
        language="javascript"
        height="150px"
      />
      <Text size="sm" c="dimmed">
        {value.length} characters
      </Text>
    </Stack>
  );
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

// Demonstrates the extensibility tier: a custom `extensions` entry
// (CodeMirror's own `EditorView.lineWrapping`, applied on top of the kit's
// basics/language/theme), `onUpdate` for observing every editor update (not
// just doc changes), and the forwarded `ref` reaching the live `EditorView`
// through the lazy + Suspense boundary.
function ExtensibilityDemo() {
  const editorRef = useRef<CodeMirrorRef>(null);
  const [cursor, setCursor] = useState(0);

  return (
    <Stack maw={480} gap="sm">
      <CodeMirror
        ref={editorRef}
        value={
          'A single long comment line to show line wrapping in action once the extension is applied.\nconst total = 1 + 1;'
        }
        language="javascript"
        height="150px"
        extensions={[EditorView.lineWrapping]}
        onUpdate={(update: ViewUpdate) =>
          setCursor(update.state.selection.main.head)
        }
      />
      <Group gap="sm">
        <Button size="xs" onClick={() => editorRef.current?.view?.focus()}>
          Focus via ref
        </Button>
        <Text size="sm" c="dimmed">
          Cursor at {cursor} (from onUpdate)
        </Text>
      </Group>
    </Stack>
  );
}

export const Extensibility: Story = {
  render: () => <ExtensibilityDemo />,
};
