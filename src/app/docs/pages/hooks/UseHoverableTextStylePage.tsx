import { useState } from 'react';

import { Stack, Switch, Text, Tooltip } from '@ui/core';
import { useHoverableTextStyle } from '@ui/hooks';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { useHoverableTextStyle } from '@ui/hooks';",
  '',
  'const hoverableStyle = useHoverableTextStyle();',
  '',
  '<Tooltip label="Last serviced 12 weeks ago">',
  '  <Text style={hoverableStyle} span>',
  '    service history',
  '  </Text>',
  '</Tooltip>;',
].join('\n');

// Rows transcribed from src/ui/hooks/useHoverableTextStyle.ts.
const API_ROWS = [
  {
    name: 'useHoverableTextStyle(props?)',
    type: "(props?: { disabled? }) => TextProps['style']",
    note: 'Returns a dotted-underline style object (2px dotted bottom border in the text.dimmed token, inline-block, pointer cursor). With disabled: true it returns {} so the text renders plain.',
  },
];

function UseHoverableTextStyleDemo() {
  const [disabled, setDisabled] = useState(false);
  const hoverableStyle = useHoverableTextStyle({ disabled });

  return (
    <Stack gap="sm">
      <Text size="sm">
        The projector is{' '}
        <Tooltip label="Checked out by the AV crew until Friday.">
          <Text size="sm" span style={hoverableStyle}>
            on loan
          </Text>
        </Tooltip>{' '}
        right now.
      </Text>
      <Switch
        label="disabled (style collapses to plain text)"
        checked={disabled}
        onChange={event => setDisabled(event.currentTarget.checked)}
      />
    </Stack>
  );
}

export function UseHoverableTextStylePage() {
  return (
    <ComponentDoc
      title="useHoverableTextStyle"
      lead="A dotted-underline style object for text that should read as hoverable or clickable -- the classic 'there's a definition or tooltip here' affordance -- built on the kit's text.dimmed token so it stays scheme-aware."
      demoIntro="Hover the dotted phrase for its tooltip; the switch shows the disabled escape hatch, where the style collapses to nothing."
      demo={<UseHoverableTextStyleDemo />}
      usage={USAGE}
      usageMinHeight={210}
      propsTables={[{ title: 'API', rows: API_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          It is a style object, not a component: spread it into any Text (or
          other element) via style, typically paired with a Tooltip or an
          onClick. The underline is a bottom border rather than text-decoration
          so the dotted line keeps a consistent gap, and the color comes from
          useSchemeColors&apos; text.dimmed -- quieter than the text itself in
          both schemes. The disabled option exists so conditional affordances (a
          row that is only sometimes clickable) can keep one call site.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
