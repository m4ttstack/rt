import { ActionIcon, Anchor, Group, Menu, Text } from '@ui/core';
import { useColorScheme, useIsMobile } from '@ui/hooks';
import { Icon } from '@ui/icons';
import { APP_NAME } from '../landing/branding';
import { Link } from '../router/Link';
import { usePath } from '../router/navigation';
import { LogoMark } from './LogoMark';

const NAV_LINKS: { href: string; label: string }[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/demo', label: 'Demo' },
];

function isActive(href: string, path: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

/** Content of the site-wide fixed header: logo (home link), top-level nav
 * with active-route highlighting, and the color-scheme toggle. The header
 * surface itself (hairline, translucent bg.level2 blur) lives on App.tsx's
 * `SiteShell`, which renders this inside its header slot. */
export function SiteHeader() {
  const { computedColorScheme, setColorScheme } = useColorScheme();
  const isMobile = useIsMobile();
  const path = usePath();
  const isDark = computedColorScheme === 'dark';

  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      maw={1200}
      mx="auto"
      px="md"
      h="100%"
    >
      <Anchor
        component={Link}
        href="/"
        underline="never"
        c="inherit"
        aria-label={`${APP_NAME} home`}
      >
        <Group gap="xs" wrap="nowrap">
          <LogoMark />
          <Text fw={700} style={{ whiteSpace: 'nowrap' }}>
            {APP_NAME}
          </Text>
        </Group>
      </Anchor>

      <Group gap="xs" wrap="nowrap">
        {isMobile ? (
          <Menu position="bottom-end" width={180}>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label="Open navigation menu"
              >
                <Icon name="menu" size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component={Link} href="/">
                Home
              </Menu.Item>
              {NAV_LINKS.map(({ href, label }) => (
                <Menu.Item key={href} component={Link} href={href}>
                  {label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <Group
            component="nav"
            aria-label="Main navigation"
            gap={4}
            wrap="nowrap"
            mr="xs"
          >
            {NAV_LINKS.map(({ href, label }) => {
              const active = isActive(href, path);
              return (
                <Anchor
                  key={href}
                  component={Link}
                  href={href}
                  size="sm"
                  fw={500}
                  c={active ? undefined : 'dimmed'}
                  px="xs"
                  py={4}
                  aria-current={active ? 'page' : undefined}
                >
                  {label}
                </Anchor>
              );
            })}
          </Group>
        )}

        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Toggle color scheme"
          onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
        >
          <Icon name={isDark ? 'sun' : 'moon'} size={16} />
        </ActionIcon>
      </Group>
    </Group>
  );
}
