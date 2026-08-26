import { Anchor, Group, Stack, Text } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { APP_NAME } from '../landing/branding';
import { Link } from '../router/Link';

const FOOTER_LINKS: { href: string; label: string }[] = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/demo', label: 'Demo' },
];

/** The site-wide footer: branding plus the same top-level routes as the header. */
export function SiteFooter() {
  const { bg } = useSchemeColors();

  return (
    <Group
      component="footer"
      bg={bg.level2}
      px="md"
      py="xl"
      justify="center"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
    >
      <Group
        justify="space-between"
        align="flex-start"
        maw={1200}
        w="100%"
        gap="md"
        wrap="wrap"
      >
        <Stack gap={2}>
          <Text fw={600}>{APP_NAME}</Text>
          <Text size="xs" c="dimmed">
            Built with its own components.
          </Text>
        </Stack>

        <Group gap="md">
          {FOOTER_LINKS.map(({ href, label }) => (
            <Anchor
              key={href}
              component={Link}
              href={href}
              size="sm"
              c="dimmed"
            >
              {label}
            </Anchor>
          ))}
        </Group>
      </Group>
    </Group>
  );
}
