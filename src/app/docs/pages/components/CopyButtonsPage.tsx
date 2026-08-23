import { Code, CopyActionIcon, CopyButton, Group, Stack, Text } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { CopyActionIcon, CopyButton } from '@ui/core';",
  '',
  '// Icon-only, for tight spots (table cells, code block corners):',
  '<Group gap="xs">',
  '  <Code>bun create-cli/create.ts my-app</Code>',
  '  <CopyActionIcon',
  '    value="bun create-cli/create.ts my-app"',
  '    label="Copy command"',
  '  />',
  '</Group>;',
  '',
  '// Labeled, when the copy action IS the control:',
  '<CopyButton value="bun create-cli/create.ts my-app">',
  '  Copy scaffold command',
  '</CopyButton>;',
  '',
  '// Code-chip form: the value doubles as a monospace label.',
  '<CopyButton value="bun install" codeStyle />;',
].join('\n');

// Rows transcribed from src/ui/core/copy-button/CopyButton.tsx
// (CopyActionIconProps).
const ACTION_ICON_ROWS = [
  {
    name: 'value',
    type: 'string',
    note: 'Required. The text written to the clipboard when clicked.',
  },
  {
    name: 'label?',
    type: 'string',
    note: 'Tooltip shown while hovering, before a copy happens. Without it (and with the default copiedLabel) the tooltip only appears after a copy.',
  },
  {
    name: 'copiedLabel?',
    type: 'string',
    note: "Tooltip shown briefly after a successful copy. Default 'Copied!'.",
  },
  {
    name: 'tooltipPosition?',
    type: 'FloatingPosition',
    note: "Tooltip position. Default 'bottom'.",
  },
  {
    name: 'iconSize?',
    type: 'number',
    note: 'Icon size in px. Default 16.',
  },
  {
    name: 'onCopy?',
    type: '() => void',
    note: 'Called after a successful copy, in addition to the built-in feedback.',
  },
  {
    name: '...rest',
    type: 'ActionIconProps',
    note: "Passthrough to the ActionIcon; kit defaults variant 'subtle', color 'gray'.",
  },
];

// Rows transcribed from src/ui/core/copy-button/CopyButton.tsx
// (CopyButtonProps).
const BUTTON_ROWS = [
  {
    name: 'value',
    type: 'string',
    note: 'Required. The text written to the clipboard when clicked.',
  },
  {
    name: 'children?',
    type: 'ReactNode',
    note: 'Button label. Defaults to value itself (handy for copyable snippets).',
  },
  {
    name: 'copiedLabel?',
    type: 'string',
    note: "Feedback tooltip, opened only while the copied state is active. Default 'Copied!'.",
  },
  {
    name: 'tooltipPosition?',
    type: 'FloatingPosition',
    note: "Tooltip position. Default 'bottom'.",
  },
  {
    name: 'codeStyle?',
    type: 'boolean',
    note: 'Code-chip styling: monospace label on the raised bg.level3 surface slot with normal text color -- scheme-aware through the kit tokens. Any explicit Button prop overrides it. Default false.',
  },
  {
    name: 'icon?',
    type: 'ReactNode',
    note: 'Overrides the idle (not-yet-copied) right-section icon; the copied checkmark is fixed.',
  },
  {
    name: 'iconSize?',
    type: 'number',
    note: "Icon size in px, matching CopyActionIcon's default. Default 16.",
  },
  {
    name: 'onCopy?',
    type: '() => void',
    note: 'Called after a successful copy, in addition to the built-in feedback.',
  },
  {
    name: '...rest',
    type: 'ButtonProps',
    note: "Passthrough to the Button; kit default variant 'default'.",
  },
];

function CopyButtonsDemo() {
  const value = 'bun create-cli/create.ts my-app';

  return (
    <Stack gap="md" align="flex-start">
      <Group gap="xs">
        <Code>{value}</Code>
        <CopyActionIcon value={value} label="Copy command" />
      </Group>
      <Group gap="sm">
        <CopyButton value={value}>Copy scaffold command</CopyButton>
        <CopyButton value="bun install" codeStyle />
      </Group>
    </Stack>
  );
}

export function CopyButtonsPage() {
  return (
    <ComponentDoc
      title="Copy buttons"
      lead="Copy-to-clipboard two ways: CopyActionIcon (icon-only, hover tooltip) and CopyButton (a full labeled Button, deliberately shadowing Mantine's headless render-prop CopyButton). Both swap to a checkmark for a couple of seconds after a copy, reverting on their own."
      demoIntro="Click any of them: the clipboard gets the text, the icon flips to a checkmark, and the tooltip feedback shows until the built-in timeout reverts it. The second CopyButton is the codeStyle chip, using its value as the label."
      demo={<CopyButtonsDemo />}
      usage={USAGE}
      usageMinHeight={430}
      propsTables={[
        { title: 'CopyActionIcon props', rows: ACTION_ICON_ROWS },
        {
          title: 'CopyButton props',
          intro:
            'The labeled sibling. Unlike CopyActionIcon, its tooltip is feedback-only: it opens while the copied state is active rather than on hover.',
          rows: BUTTON_ROWS,
        },
      ]}
    >
      <DocSection title="The CopyButton shadow">
        <Text size="sm">
          Importing CopyButton from @ui/core gets this labeled,
          batteries-included component, not Mantine&apos;s headless render-prop
          CopyButton -- a deliberate shadow following the same convention as
          Table and TextInput (a named export after the barrel&apos;s star
          re-exports, with the import wall banning the raw Mantine name inside
          src/). The copied state comes from @mantine/hooks&apos; useClipboard,
          whose built-in timeout reverts the icon and tooltip automatically, and
          both components stop click propagation so they can sit inside
          clickable rows. Reach for CopyActionIcon in tight spots, CopyButton
          when the copy action is the control itself.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
