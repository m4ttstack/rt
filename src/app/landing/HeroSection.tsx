import {
  Badge,
  Box,
  Button,
  CopyActionIcon,
  GradientBorder,
  Group,
  Stack,
  Text,
  Title,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icon } from '@ui/icons';
import { PAGE_SHELL_DEMO_PATH } from '../demo/paths';
import { Link } from '../router/Link';

// The honest, works-today scaffold command (see AGENTS.md §9) -- run from a
// checkout of this template repo.
const SCAFFOLD_COMMAND = 'bun create-cli/create.ts my-app';

const TECH_BADGES = [
  'React 19',
  'Mantine 9',
  'TypeScript strict',
  'Vite 8',
  'Bun',
];

export function HeroSection() {
  const { bg } = useSchemeColors();

  return (
    <Box component="section" px="md" py={{ base: 56, md: 96 }}>
      <Stack align="center" gap="lg" maw={760} mx="auto">
        <Group gap="xs" justify="center">
          {TECH_BADGES.map(label => (
            <Badge
              key={label}
              variant="light"
              color="gray"
              size="sm"
              radius="sm"
            >
              {label}
            </Badge>
          ))}
        </Group>

        <Title
          order={1}
          ta="center"
          fz={{ base: 34, sm: 48 }}
          lh={1.15}
          fw={600}
          maw={680}
        >
          A batteries-included Mantine starter
        </Title>

        <Text ta="center" c="dimmed" size="lg" maw={620}>
          Full app chrome with a collapsible double-nav rail, a catalog of
          components Mantine doesn&apos;t ship, a cohesive theme with dark mode
          done right, and typed modal, notification, and form facades. Scaffold
          an app and start on the product, not the plumbing.
        </Text>

        <Group gap="md" justify="center" wrap="wrap" mt="xs">
          <Button
            component={Link}
            href="/docs"
            size="md"
            rightSection={<Icon name="arrowRight" size={16} />}
          >
            Get started
          </Button>

          <Button
            component={Link}
            href={PAGE_SHELL_DEMO_PATH}
            size="md"
            variant="default"
            rightSection={<Icon name="maximize" size={16} />}
          >
            See the full-screen demo
          </Button>
        </Group>

        <GradientBorder radius={10}>
          <Group
            gap="xs"
            wrap="nowrap"
            px="md"
            py={6}
            bg={bg.level2}
            style={{ borderRadius: 8 }}
          >
            <Text size="sm" ff="monospace" style={{ whiteSpace: 'nowrap' }}>
              {SCAFFOLD_COMMAND}
            </Text>
            <CopyActionIcon
              value={SCAFFOLD_COMMAND}
              label="Copy scaffold command"
            />
          </Group>
        </GradientBorder>

        <Text size="xs" c="dimmed" ta="center">
          Publishing to npm turns this into{' '}
          <code>bunx create-chat my-app</code> -- see PUBLISHING.md.
        </Text>
      </Stack>
    </Box>
  );
}
