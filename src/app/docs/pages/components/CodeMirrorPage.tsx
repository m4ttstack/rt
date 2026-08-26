import { useState } from 'react';

import { Anchor, Stack, Switch, Text } from '@ui/core';
import { CodeMirror } from '@ui/lazy';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { CodeMirror } from '@ui/lazy';",
  '',
  '// CodeMirror 6 + its language packages load only when this first',
  '// renders (the chunk is around 500 kB minified in this repo).',
  '<CodeMirror',
  '  value={code}',
  '  onChange={setCode}',
  '  language="javascript"',
  '  height="160px"',
  '/>',
].join('\n');

// Rows transcribed from src/ui/lazy/codemirror/CodeMirror.Base.tsx
// (CodeMirrorBaseProps).
const PROPS_ROWS = [
  {
    name: 'value?',
    type: 'string',
    note: 'The editor content. Uncontrolled if omitted; controlled (kept in sync on change) if provided.',
  },
  {
    name: 'onChange?',
    type: '(value: string) => void',
    note: 'Fired with the new document text whenever the user edits the content -- just the text, no CodeMirror types leaking out.',
  },
  {
    name: 'language?',
    type: "'javascript' | 'json'",
    note: 'Enables syntax highlighting + language-aware editing. No language support when omitted.',
  },
  {
    name: 'readOnly?',
    type: 'boolean',
    note: 'Blocks edits; the editor still allows selecting/copying text. Default false.',
  },
  {
    name: 'height?',
    type: 'string',
    note: "CSS height of the editor. Default '300px'.",
  },
  {
    name: 'placeholder?',
    type: 'string',
    note: 'Placeholder content shown when the editor is empty.',
  },
  {
    name: 'autoFocus?',
    type: 'boolean',
    note: 'Focus the editor on mount. Default false.',
  },
];

// Extensibility tier -- see CodeMirrorBaseProps in CodeMirror.Base.tsx.
const EXTENSIBILITY_PROPS_ROWS = [
  {
    name: 'extensions?',
    type: 'Extension[]',
    note: 'Extra CodeMirror extensions (linting, autocompletion, custom keymaps, ...), appended to the editor at creation. Read once on mount -- changing this afterward does not reconfigure the live editor (remount via key to pick up a new list).',
  },
  {
    name: 'onCreateEditor?',
    type: '(view: EditorView, state: EditorState) => void',
    note: 'Fired once, right after the EditorView is created, with the view and its initial state.',
  },
  {
    name: 'onUpdate?',
    type: '(update: ViewUpdate) => void',
    note: 'Fired on every editor update (selection, focus, doc changes, ...), alongside onChange.',
  },
  {
    name: 'theme?',
    type: "'light' | 'dark' | Extension",
    note: "Overrides the automatic scheme-aware theme. 'light'/'dark' force the kit's own chrome to that scheme; an Extension replaces the theme entirely. Omitted (default): follows the computed color scheme.",
  },
];

function CodeMirrorDemo() {
  const [code, setCode] = useState('const total = 1 + 1;\n');
  const [readOnly, setReadOnly] = useState(false);

  return (
    <Stack gap="sm">
      <CodeMirror
        value={code}
        onChange={setCode}
        language="javascript"
        height="160px"
        readOnly={readOnly}
      />
      <Switch
        label="readOnly"
        checked={readOnly}
        onChange={event => setReadOnly(event.currentTarget.checked)}
      />
      <Text size="sm" c="dimmed">
        {code.length} characters -- onChange feeds this count live.
      </Text>
    </Stack>
  );
}

export function CodeMirrorPage() {
  return (
    <ComponentDoc
      title="CodeMirror"
      lead="A CodeMirror 6 text/code editor behind React.lazy, with a small value/onChange prop surface -- line numbers, history, bracket matching, and the default keymap included via basicSetup -- plus an extensibility tier for consumers that need direct CodeMirror access."
      demo={<CodeMirrorDemo />}
      usage={USAGE}
      usageMinHeight={250}
      propsTables={[
        { title: 'Props', rows: PROPS_ROWS },
        {
          title: 'Extensibility props',
          intro:
            'Additive to the props above -- restore direct CodeMirror access (custom extensions, update observation, a theme override, the live EditorView) without breaking the small default surface.',
          rows: EXTENSIBILITY_PROPS_ROWS,
        },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          language, readOnly, and theme are held in CodeMirror compartments, so
          changing any of them reconfigures the live editor instead of tearing
          it down (undo history and selection survive). extensions and
          onCreateEditor are read once at creation instead -- see their prop
          notes above. The import wall bans codemirror/@codemirror/* everywhere
          outside this wrapper&apos;s own lazy module, so the editor physically
          cannot end up in the entry bundle -- background in the{' '}
          <Anchor
            component={Link}
            href={docsPath('lazy-loading')}
            size="sm"
            fw={500}
          >
            Lazy loading guide
          </Anchor>
          .
        </Text>
        <Text size="sm" mt="xs">
          A ref forwarded to CodeMirror resolves to{' '}
          <code>{'{ view: EditorView | null }'}</code> -- it reaches the live
          editor through the React.lazy + Suspense boundary via forwardRef on
          both the public component and the lazy-loaded base.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
