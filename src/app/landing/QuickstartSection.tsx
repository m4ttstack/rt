import { Anchor, Box, Stack, Text, Title } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { CodeBlock } from '../components/CodeBlock';
import { Link } from '../router/Link';

// Run from a checkout of this template repo; the scaffold output itself
// prints the same cd/install/dev follow-ups.
const SCAFFOLD_STEPS = [
  '# scaffold a new app from this template',
  'bun create-cli/create.ts my-app',
  '',
  'cd my-app',
  'bun install',
  'bun run dev',
].join('\n');

const IMPORT_WALL_SNIPPET = [
  "// app code imports the kit's barrels, never Mantine directly",
  "import { Button, ContentContainer, PageShell } from '@ui/core';",
  "import { useSchemeColors } from '@ui/hooks';",
  "import { notifications } from '@ui/notifications';",
].join('\n');

export function QuickstartSection() {
  const { bg } = useSchemeColors();

  return (
    <Box
      component="section"
      px="md"
      py={{ base: 40, md: 64 }}
      bg={bg.level2}
      style={{
        borderTop: '1px solid var(--mantine-color-default-border)',
        borderBottom: '1px solid var(--mantine-color-default-border)',
      }}
    >
      <Stack maw={760} mx="auto" gap="xl">
        <Stack gap={4}>
          <Title order={2}>Quickstart</Title>
          <Text c="dimmed">
            From template checkout to a running app in four commands.
          </Text>
        </Stack>

        <CodeBlock code={SCAFFOLD_STEPS} language="bash" minHeight={150} />

        <Stack gap="xs">
          <Title order={4}>The conventions are pre-wired</Title>
          <Text size="sm" c="dimmed">
            The scaffolded app already follows the kit&apos;s conventions: every
            Mantine-shaped thing enters through a @ui/* barrel, so kit defaults
            and overrides apply without any setup on your part.
          </Text>
          <CodeBlock
            code={IMPORT_WALL_SNIPPET}
            language="tsx"
            minHeight={108}
          />
        </Stack>

        <Text size="sm" c="dimmed">
          The full walkthrough (project structure, per-topic guides, the
          scaffold CLI&apos;s exact behavior) lives in the{' '}
          <Anchor component={Link} href="/docs" size="sm" fw={500}>
            docs
          </Anchor>
          .
        </Text>
      </Stack>
    </Box>
  );
}
