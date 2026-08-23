import { useRef, useState } from 'react';

import { Button, Center, GenericError, Loader, Paper, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { GenericError } from '@ui/core';",
  '',
  '// The standard "this section failed to load" state:',
  'if (query.isError) {',
  '  return (',
  '    <GenericError',
  '      message="The gear list failed to load."',
  '      onRetry={() => query.refetch()}',
  '    />',
  '  );',
  '}',
].join('\n');

// Rows transcribed from src/ui/core/generic-error/GenericError.tsx
// (GenericErrorProps).
const PROPS_ROWS = [
  {
    name: 'title?',
    type: 'ReactNode',
    note: 'Optional heading above the message.',
  },
  {
    name: 'message?',
    type: 'ReactNode',
    note: "Explanation shown under the illustration. Default 'Something went wrong.'",
  },
  {
    name: 'actionButton?',
    type: 'ButtonProps & { text, onClick }',
    note: 'An arbitrary action button (custom label + variant/color/...). Takes precedence over onRetry.',
  },
  {
    name: 'onRetry?',
    type: '() => void',
    note: 'Shortcut for a "Try again" light button calling this. Omit (and omit actionButton) to hide the button.',
  },
  {
    name: '...rest',
    type: 'StackProps',
    note: 'Passthrough to the root Stack (className/style/spacing/...).',
  },
];

/** A panel that fails to load until Try again is clicked: the retry runs a
 * short fake fetch, then the panel renders its content. */
function GenericErrorDemo() {
  const [phase, setPhase] = useState<'failed' | 'loading' | 'loaded'>('failed');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = () => {
    setPhase('loading');
    timer.current = setTimeout(() => setPhase('loaded'), 800);
  };

  return (
    <Paper withBorder p="md" mih={220}>
      {phase === 'failed' && (
        <GenericError message="The gear list failed to load." onRetry={retry} />
      )}
      {phase === 'loading' && (
        <Center mih={180}>
          <Loader />
        </Center>
      )}
      {phase === 'loaded' && (
        <Center mih={180}>
          <Text size="sm" ta="center">
            Loaded on retry -- 8 gear items, 2 open borrow requests.{' '}
            <Button
              variant="subtle"
              size="compact-sm"
              onClick={() => setPhase('failed')}
            >
              Break it again
            </Button>
          </Text>
        </Center>
      )}
    </Paper>
  );
}

export function GenericErrorPage() {
  return (
    <ComponentDoc
      title="GenericError"
      lead="A neutral placeholder for 'this section failed to load': an inline hand-drawn illustration (a cracked pane) plus an optional title, a message, and an optional action button (a custom action or the onRetry shortcut)."
      bareDemo
      demoIntro="The retry flow live: this panel starts failed; Try again runs a short fake fetch and the content lands. Break it again to loop."
      demo={<GenericErrorDemo />}
      usage={USAGE}
      usageMinHeight={230}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The component renders the failed state only -- your code owns the
          retry: onRetry typically flips the section back into its loading path
          (a query refetch, a remount key bump) and re-renders content when it
          resolves. Every stroke of the illustration is scheme-aware: the pane
          sits on the layered --ui-bg-* surface scale with the default border
          var, and the crack uses currentColor from the dimmed text wrapper, so
          it genuinely flips with the color scheme instead of only adapting in
          one of the two. The root carries data-testid=&quot;generic-error&quot;
          for tests.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
