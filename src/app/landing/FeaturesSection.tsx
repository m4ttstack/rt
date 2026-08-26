import {
  Anchor,
  Box,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icon } from '@ui/icons';
import type { IconName } from '@ui/icons';
import { PAGE_SHELL_DEMO_PATH } from '../demo/paths';
import { docsPath, type DocsSlug } from '../docs/docsNav';
import { Link } from '../router/Link';

interface Feature {
  icon: IconName;
  title: string;
  description: string;
  /** The docs page this card links into. */
  slug: DocsSlug;
}

// Copy describes what actually exists in this repo -- see AGENTS.md for each
// feature's contract (components §2, backgrounds §6, facades §5, forms §5,
// scaffold CLI §9, walls §1). Each card links to that feature's full docs
// page. The app chrome leads as its own full-width card above this grid;
// then what a consumer gets (components, theme, facades, forms, fast start),
// and how the conventions are enforced (walls, lint rules, lazy deps) closes
// the grid as a supporting card.
const FEATURES: Feature[] = [
  {
    icon: 'bookOpen',
    title: 'Component catalog',
    slug: 'components',
    description:
      'Components Mantine does not ship: virtualized lists and tables, range pickers, searchable and hybrid menus, copy and hover affordances -- all exported from @ui/core.',
  },
  {
    icon: 'layers',
    title: 'Theming & layered backgrounds',
    slug: 'theming',
    description:
      'One cohesive theme with scheme-aware bg.level1-4 elevation tokens: every surface holds up in light and dark mode, and the four slots are re-skinnable per app.',
  },
  {
    icon: 'bell',
    title: 'Modal & notification facades',
    slug: 'modals',
    description:
      'modals.confirm and modals.prompt helpers, plus typed notifications.success/error shorthands with level-appropriate defaults.',
  },
  {
    icon: 'checkCircle',
    title: 'Typed zod forms',
    slug: 'forms',
    description:
      'zod-validated forms via FormContainer and useModalForm -- submit handlers receive parsed values, with loading and error states built in.',
  },
  {
    icon: 'zap',
    title: 'Fast start',
    slug: 'scaffolding',
    description:
      'One scaffold command (standalone, or --workspace for monorepos) with Prettier, ESLint, and CI preconfigured -- and a warning-clean production build from day one.',
  },
  {
    icon: 'shield',
    title: 'Conventions, enforced',
    slug: 'import-walls',
    description:
      'The quiet plumbing: import walls keep app code on the @ui/* barrels, optional lint rules ship off by default, and heavy deps stay lazy-loaded out of the entry bundle.',
  },
];

/** The headline feature, promoted above the grid: the double-nav app
 * chrome (RailShell + PageShell), linking both the guide and the live
 * full-screen demo. Copy matches the App chrome guide's own claims. */
function AppChromeCard() {
  const { bg } = useSchemeColors();

  return (
    <Card padding="lg" bg={bg.level2} withBorder>
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" size="lg" radius="md">
            <Icon name="sidebar" size={18} />
          </ThemeIcon>
          <Title order={4}>Double-nav app chrome</Title>
        </Group>
        <Text size="sm" c="dimmed">
          RailShell&apos;s mini icon rail wrapping PageShell&apos;s collapsible,
          persisted sidebar: two levels of navigation that collapse
          independently, with the mobile behavior and z-index contract built in.
          This site&apos;s docs and demo sections run on it.
        </Text>
        <Group gap="lg">
          <Anchor
            component={Link}
            href={docsPath('app-chrome')}
            size="sm"
            fw={500}
          >
            Read the App chrome guide
          </Anchor>
          <Anchor
            component={Link}
            href={PAGE_SHELL_DEMO_PATH}
            size="sm"
            fw={500}
          >
            Launch the full-screen demo
          </Anchor>
        </Group>
      </Stack>
    </Card>
  );
}

export function FeaturesSection() {
  const { bg } = useSchemeColors();

  return (
    <Box component="section" px="md" py={{ base: 40, md: 64 }}>
      <Stack maw={1200} mx="auto" gap="xl">
        <Stack gap={4} align="center">
          <Title order={2} ta="center">
            Batteries included
          </Title>
          <Text c="dimmed" ta="center">
            What the kit hands you before you write a line of app code.
          </Text>
        </Stack>

        <Stack gap="lg">
          <AppChromeCard />

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            {FEATURES.map(({ icon, title, description, slug }) => (
              <Card key={title} padding="lg" bg={bg.level2} withBorder>
                <Stack gap="sm" h="100%">
                  <ThemeIcon variant="light" size="lg" radius="md">
                    <Icon name={icon} size={18} />
                  </ThemeIcon>
                  <Title order={4}>{title}</Title>
                  <Text size="sm" c="dimmed" style={{ flexGrow: 1 }}>
                    {description}
                  </Text>
                  <Anchor
                    component={Link}
                    href={docsPath(slug)}
                    size="sm"
                    fw={500}
                  >
                    Read the docs
                  </Anchor>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </Stack>
    </Box>
  );
}
