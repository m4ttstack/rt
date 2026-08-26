import { Anchor, List, Paper, SimpleGrid, Stack, Text, Title } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { CodeBlock } from '../../components/CodeBlock';
import { PAGE_SHELL_DEMO_PATH } from '../../demo/paths';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { DOCS_NAV_GROUPS, docsPath } from '../docsNav';

// The honest, works-today scaffold flow (see AGENTS.md §9) -- run from a
// checkout of this template repo.
const SCAFFOLD_STEPS = [
  '# from a checkout of this template repo:',
  'bun create-cli/create.ts my-app',
  '',
  'cd my-app',
  'bun install',
  'bun run dev',
].join('\n');

const PROJECT_STRUCTURE = [
  'src/',
  '  ui/          the kit: @ui/* barrels (core, hooks, forms, modals,',
  '               notifications, icons, lazy, ...), theme, styles',
  '  app/         the product: pages and app-specific components,',
  '               built only from @ui/* imports',
  '  boot/        pre-React loading bar + fatal-error safety net',
  '  main.tsx     providers + mount',
  'create-cli/    the scaffold CLI (template repo only)',
].join('\n');

function AudienceIntro() {
  const { bg } = useSchemeColors();

  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
      <Paper withBorder radius="md" p="lg" bg={bg.level2}>
        <Stack gap="xs">
          <Title order={3} fz="h5">
            Already use Mantine?
          </Title>
          <Text size="sm" c="dimmed">
            Everything here is Mantine 9 -- your knowledge transfers 1:1. The
            kit adds a catalog of components Mantine does not ship, a four-level
            background ramp, typed modal/notification/form facades, and two
            shadowed components with kit defaults (Table, TextInput). Import
            from @ui/* instead of @mantine/* and you have the whole surface plus
            the extras -- an ESLint wall enforces that convention so the kit
            defaults always apply.
          </Text>
        </Stack>
      </Paper>
      <Paper withBorder radius="md" p="lg" bg={bg.level2}>
        <Stack gap="xs">
          <Title order={3} fz="h5">
            New to Mantine?
          </Title>
          <Text size="sm" c="dimmed">
            <Anchor href="https://mantine.dev" target="_blank" rel="noreferrer">
              Mantine
            </Anchor>{' '}
            is a full-featured React components library -- inputs, overlays,
            hooks, and a theming system. This kit hands you a curated,
            guard-railed setup of it: a working app shell, one theme of
            defaults, lint rules that keep imports on the paved path, and
            per-topic guides in the sidebar for everything it adds.
          </Text>
        </Stack>
      </Paper>
    </SimpleGrid>
  );
}

export function GettingStartedPage() {
  return (
    <DocPage
      title="Getting started"
      lead="A batteries-included Vite + React 19 + Mantine 9 + TypeScript starter: a catalog of kit components, layered scheme-aware backgrounds, typed modal, notification, and form facades, and a scaffold CLI -- with ESLint-enforced conventions keeping app code on the paved path. Start on the product, not the plumbing."
    >
      <AudienceIntro />

      <DocSection title="Scaffold an app">
        <Text size="sm">
          The template ships its own create CLI. From a checkout of this repo,
          one command copies the template, renames it to your app, and commits a
          fresh git repo:
        </Text>
        <CodeBlock code={SCAFFOLD_STEPS} language="bash" minHeight={150} />
        <Text size="xs" c="dimmed">
          Publishing the template to npm turns this into{' '}
          <code>bunx create-chat my-app</code> -- see PUBLISHING.md at
          the repo root for the runbook. The{' '}
          <Anchor component={Link} href={docsPath('scaffolding')} size="xs">
            Scaffolding page
          </Anchor>{' '}
          documents exactly what one run does.
        </Text>
      </DocSection>

      <DocSection title="Project structure">
        <Text size="sm">
          Two worlds, one wall between them: <code>src/ui</code> is the kit
          (imported as <code>@ui/*</code>), <code>src/app</code> is the product.
          App code never imports <code>@mantine/*</code> directly -- ESLint
          redirects every Mantine import to the matching barrel.
        </Text>
        <CodeBlock
          code={PROJECT_STRUCTURE}
          language="bash"
          minHeight={190}
          withCopyButton={false}
        />
      </DocSection>

      <DocSection title="Bring your own router">
        <Text size="sm">
          The kit is router-agnostic: nothing in <code>@ui/*</code> imports or
          assumes a router, and the demo site&apos;s hand-rolled router (
          <code>src/app/router/</code>) is deliberately disposable. Adding a
          real router (TanStack Router, React Router, ...) is one child swap in{' '}
          <code>main.tsx</code>: keep every provider, replace the{' '}
          <code>&lt;App /&gt;</code> child with your router&apos;s root.
        </Text>
        <Text size="xs" c="dimmed">
          One trap with typed routers: Mantine&apos;s polymorphic{' '}
          <code>component={'{Link}'}</code> prop silently widens TanStack
          Router&apos;s route-literal <code>to</code> to string, so nonexistent
          routes compile. For typed internal navigation, wrap kit components
          with the router&apos;s createLink() instead -- AGENTS.md section 10
          has the full recipe.
        </Text>
      </DocSection>

      <DocSection title="Where to next">
        <List size="sm" spacing={6}>
          {/* The guides, plus the component reference's index (the per-
              component pages are one click further -- listing all of them
              here would drown the guides). */}
          {[
            ...(DOCS_NAV_GROUPS.find(group => group.label === 'Guides')
              ?.items ?? []),
            { slug: 'components' as const, label: 'Components reference' },
          ].map(({ slug, label }) => (
            <List.Item key={slug}>
              <Anchor component={Link} href={docsPath(slug)} size="sm" fw={500}>
                {label}
              </Anchor>
            </List.Item>
          ))}
        </List>
        <Text size="sm" c="dimmed">
          Every component page in the reference carries its own live demo, built
          entirely from @ui/* components.
        </Text>
        <Text size="sm">
          Ready to build chrome? The{' '}
          <Anchor
            component={Link}
            href={docsPath('app-chrome')}
            size="sm"
            fw={500}
          >
            App chrome guide
          </Anchor>{' '}
          walks the double-nav recipe end-to-end, and the{' '}
          <Anchor
            component={Link}
            href={PAGE_SHELL_DEMO_PATH}
            size="sm"
            fw={500}
          >
            full-screen PageShell demo
          </Anchor>{' '}
          shows the finished geometry live.
        </Text>
      </DocSection>
    </DocPage>
  );
}
