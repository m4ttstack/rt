import { Link } from 'wouter';

import { Box, Button, Stack, Text, Title } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

/** Rendered for any path the route table doesn't recognize. */
export function NotFoundPage() {
  return (
    <Box px="md" py={{ base: 80, md: 120 }}>
      <Stack align="center" gap="md" maw={480} mx="auto" ta="center">
        <Text fz={64} fw={700} lh={1} c="dimmed" ff="monospace" aria-hidden>
          404
        </Text>
        <Title order={1} fz="h2">
          Page not found
        </Title>
        <Text c="dimmed">
          Nothing lives at this address. The run board is one click away.
        </Text>
        <Button
          component={Link}
          href="/"
          mt="xs"
          leftSection={<Icon name="arrowLeft" size={16} />}
        >
          Back to the run board
        </Button>
      </Stack>
    </Box>
  );
}
