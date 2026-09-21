import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge, Button, Group, Stack, Text } from '@mattstack/app-kit/core';

const COLORS = ['accent', 'ok', 'warn', 'bad', 'cyan', 'purple'] as const;
const VARIANTS = ['filled', 'light', 'outline', 'subtle'] as const;
const GROUNDS = ['--ui-bg-1', '--ui-bg-2', '--ui-bg-3', '--ui-bg-4'] as const;

function ButtonWall() {
  return (
    <Stack gap="md">
      {GROUNDS.map(ground => (
        <Stack
          key={ground}
          gap="xs"
          p="md"
          style={{ background: `var(${ground})`, borderRadius: 8 }}
        >
          <Text size="sm">{ground}</Text>
          {VARIANTS.map(variant => (
            <Group key={variant} gap="xs">
              {COLORS.map(color => (
                <Button key={color} color={color} variant={variant}>
                  {color}
                </Button>
              ))}
            </Group>
          ))}
          <Group gap="xs">
            {COLORS.map(color => (
              <Badge key={color} color={color}>
                {color}
              </Badge>
            ))}
          </Group>
        </Stack>
      ))}
    </Stack>
  );
}

function TextWall() {
  return (
    <Stack gap="md">
      {GROUNDS.map(ground => (
        <Stack
          key={ground}
          gap={4}
          p="md"
          style={{ background: `var(${ground})`, borderRadius: 8 }}
        >
          <Text>
            Default text on {ground}: inventory counts pause on Friday.
          </Text>
          <Text c="dimmed">
            Dimmed text on {ground}: items on loan keep their due dates.
          </Text>
          {/* eslint-disable-next-line local/no-dimmed-xs --
              this row is the specimen for the combination the rule forbids;
              a wall that cannot render the failing case cannot show it. */}
          <Text size="xs" c="dimmed">
            Small dimmed text on {ground}: returns reopen Monday.
          </Text>
        </Stack>
      ))}
    </Stack>
  );
}

const meta = {
  title: 'Specimens/app-kit',
  parameters: { layout: 'padded', a11y: { test: 'error' } },
} satisfies Meta;

export default meta;

export const Buttons: StoryObj = { render: () => <ButtonWall /> };
export const TextRoles: StoryObj = { render: () => <TextWall /> };
