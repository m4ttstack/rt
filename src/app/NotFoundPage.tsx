import { Box, Button, Stack, Text, Title } from '@ui/core';
import { Icon } from '@ui/icons';
import { Link } from './router/Link';

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
          Nothing lives at this address. The landing page, the docs, and the
          live demo are all one click away.
        </Text>
        <Button
          component={Link}
          href="/"
          mt="xs"
          leftSection={<Icon name="arrowLeft" size={16} />}
        >
          Back to the landing page
        </Button>
      </Stack>
    </Box>
  );
}
