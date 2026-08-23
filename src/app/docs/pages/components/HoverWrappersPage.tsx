import {
  ActionIcon,
  Badge,
  HoverBox,
  HoverGroup,
  HoverStack,
  Paper,
  Stack,
  Text,
} from '@ui/core';
import { Icon } from '@ui/icons';
import { notifications } from '@ui/notifications';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { HoverBox, HoverGroup, HoverStack } from '@ui/core';",
  '',
  '// The render prop receives the hovered state; the caller decides what',
  '// to reveal (row actions, a secondary line, a highlight).',
  '<HoverGroup justify="space-between" p="xs">',
  '  {hovered => (',
  '    <>',
  '      <Text size="sm">field_camera_a</Text>',
  '      <ActionIcon',
  '        variant="subtle"',
  '        style={{ opacity: hovered ? 1 : 0 }}',
  '        aria-label="Edit item"',
  '      >',
  '        <Icon name="edit" />',
  '      </ActionIcon>',
  '    </>',
  '  )}',
  '</HoverGroup>;',
].join('\n');

// Rows transcribed from src/ui/core/hover-wrappers/HoverWrappers.tsx --
// all three flavors share this shape.
const SHARED_ROWS = [
  {
    name: 'children',
    type: '(hovered: boolean) => ReactNode',
    note: "Required. Render prop receiving the wrapper's current hovered state.",
  },
  {
    name: '...rest',
    type: 'BoxProps / GroupProps / StackProps',
    note: "The matching layout container's own props (per flavor), passed through unchanged.",
  },
];

const DEMO_ROWS = [
  { name: 'field_camera_a', status: 'available' },
  { name: 'podcast_mic_kit', status: 'on loan' },
];

function HoverWrappersDemo() {
  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          HoverGroup: reveal row actions
        </Text>
        <Paper withBorder>
          {DEMO_ROWS.map(row => (
            <HoverGroup key={row.name} justify="space-between" px="sm" py={4}>
              {hovered => (
                <>
                  <Text size="sm" ff="monospace">
                    {row.name}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    aria-label={`Edit ${row.name}`}
                    style={{ opacity: hovered ? 1 : 0 }}
                    onClick={() => notifications.info(`Edit ${row.name}`)}
                  >
                    <Icon name="edit" />
                  </ActionIcon>
                </>
              )}
            </HoverGroup>
          ))}
        </Paper>
      </Stack>
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          HoverBox: read the state directly
        </Text>
        <HoverBox p="sm" style={{ border: '1px dashed transparent' }}>
          {hovered => (
            <Badge variant={hovered ? 'filled' : 'light'}>
              hovered: {String(hovered)}
            </Badge>
          )}
        </HoverBox>
      </Stack>
      <Stack gap={4}>
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
          HoverStack: reveal a secondary line
        </Text>
        <HoverStack gap={2} p="sm" w="fit-content">
          {hovered => (
            <>
              <Text size="sm" fw={500}>
                light_panel_a
              </Text>
              <Text size="xs" c="dimmed" opacity={hovered ? 1 : 0}>
                Last serviced 12 weeks ago -- due for a check.
              </Text>
            </>
          )}
        </HoverStack>
      </Stack>
    </Stack>
  );
}

export function HoverWrappersPage() {
  return (
    <ComponentDoc
      title="Hover wrappers"
      lead="Show-on-hover containers, as a family: HoverBox, HoverGroup, and HoverStack each track their own hovered state and hand it to a render-prop children -- the caller decides what to reveal or restyle, instead of the wrapper guessing."
      demoIntro="Move the pointer across each example: the row actions fade in, the badge reads its own hovered state, and the stack reveals its secondary line."
      demo={<HoverWrappersDemo />}
      usage={USAGE}
      usageMinHeight={420}
      propsTables={[
        {
          title: 'Shared props',
          intro:
            'All three flavors share one shape; only the layout container (and its passthrough props) differs.',
          rows: SHARED_ROWS,
        },
      ]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          Three flavors exist so the wrapper itself can be the layout container
          the content already needed -- a Box, a Group (flex row), or a Stack
          (flex column) -- rather than an extra div around one. The hovered
          state comes from @mantine/hooks&apos; useHover on the wrapper&apos;s
          own element. Prefer revealing with opacity (as the demos do) over
          conditional mounting when the hidden content should keep its layout
          space and stay reachable to keyboard focus.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
