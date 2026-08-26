import { Anchor, Text } from '@ui/core';
import { CodeHighlight } from '@ui/lazy';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { CodeHighlight } from '@ui/lazy';",
  '',
  '// The highlighting engine loads only when this first renders -- never',
  '// as part of the entry chunk.',
  '<CodeHighlight code={snippet} language="tsx" />',
].join('\n');

const DEMO_SNIPPET = [
  'function greet(name: string) {',
  '  return `Hello, ${name}!`;',
  '}',
].join('\n');

// The wrapper passes props straight through to @mantine/code-highlight's
// CodeHighlight; rows transcribed from that package's CodeHighlightProps
// (the commonly used surface -- BoxProps/styles-API props also apply).
const PROPS_ROWS = [
  {
    name: 'code',
    type: 'string',
    note: 'Required. The code to highlight.',
  },
  {
    name: 'language?',
    type: 'string',
    note: 'Language used for syntax highlighting.',
  },
  {
    name: 'withCopyButton?',
    type: 'boolean',
    note: "Shows the copy control. Default true; copyLabel/copiedLabel customize its labels ('Copy'/'Copied').",
  },
  {
    name: 'withExpandButton?',
    type: 'boolean',
    note: 'Shows an expand/collapse control; maxCollapsedHeight (default 180px) caps the collapsed state, defaultExpanded/expanded/onExpandedChange control it.',
  },
  {
    name: 'withLineNumbers?',
    type: 'boolean',
    note: 'Displays line numbers. Default false.',
  },
  {
    name: 'withBorder? / radius? / background?',
    type: 'styling',
    note: 'Border, corner radius (default 0), and background color of the block.',
  },
  {
    name: 'codeColorScheme?',
    type: "'dark' | 'light' | string",
    note: 'Forces a dark or light code theme; by default it follows the app color scheme.',
  },
];

export function CodeHighlightPage() {
  return (
    <ComponentDoc
      title="CodeHighlight"
      lead="@mantine/code-highlight's CodeHighlight behind React.lazy: the same component and props, with the highlighting engine kept out of the app's entry bundle until a block first renders."
      demoIntro="A live block with the built-in copy control -- and itself a demo of the lazy loading: this page fetched the highlighter chunk on first render."
      demo={<CodeHighlight code={DEMO_SNIPPET} language="typescript" />}
      usage={USAGE}
      usageMinHeight={160}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The wrapper adds no props of its own: CodeHighlightProps IS the
          Mantine type, passed straight through, and the component renders
          inside a LazyLoader (minHeight 60) while its chunk resolves. Wrap it
          in the kit&apos;s Paper for a bordered surface. Why the indirection
          exists -- and the import wall that keeps @mantine/code-highlight out
          of app code -- is covered by the{' '}
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
      </DocSection>
    </ComponentDoc>
  );
}
