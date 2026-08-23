import { Anchor, Stack, Text } from '@ui/core';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { COMPONENT_NAV_GROUPS, docsPath } from '../docsNav';

export function ComponentsPage() {
  return (
    <DocPage
      title="Components"
      lead="Every kit-unique component and hook has its own reference page -- a live demo, a usage snippet, and a props table. Components ship from @ui/core (icons from @ui/icons, code components from @ui/lazy, form helpers from @ui/forms) alongside the full re-exported Mantine surface; hooks ship from @ui/hooks the same way."
    >
      {COMPONENT_NAV_GROUPS.filter(group => group.label !== 'Components').map(
        ({ label, items }) => (
          <DocSection key={label} title={label}>
            <Stack gap={6}>
              {items.map(({ slug, label: itemLabel, description }) => (
                <Text key={slug} size="sm">
                  <Anchor
                    component={Link}
                    href={docsPath(slug)}
                    size="sm"
                    fw={600}
                    ff="monospace"
                  >
                    {itemLabel}
                  </Anchor>{' '}
                  <Text span c="dimmed" size="sm">
                    {description}
                  </Text>
                </Text>
              ))}
            </Stack>
          </DocSection>
        )
      )}

      <DocSection title="Hooks documented with their components">
        <Text size="sm">
          Two kit hooks only exist as part of a compound component, so they are
          documented there instead of in the Hooks group: useRailState (the
          rail&apos;s open/expand wiring) lives on{' '}
          <Anchor
            component={Link}
            href={docsPath('components/rail-shell')}
            size="sm"
            fw={600}
          >
            the RailShell page
          </Anchor>
          , and usePageShellContext (reading the shell&apos;s shared state from
          custom sub-components) on{' '}
          <Anchor
            component={Link}
            href={docsPath('components/page-shell')}
            size="sm"
            fw={600}
          >
            the PageShell page
          </Anchor>
          . The{' '}
          <Anchor component={Link} href={docsPath('hooks')} size="sm" fw={600}>
            Hooks guide
          </Anchor>{' '}
          remains the one-table cheat sheet across all of them.
        </Text>
      </DocSection>

      <DocSection title="Modal & notification facades">
        <Text size="sm">
          The modals facade (modals.confirm, modals.prompt, and the typed
          modals.open pass-through) and the notifications facade (the
          success/error/warning/info shorthands and their level defaults) are
          documented in{' '}
          <Anchor component={Link} href={docsPath('modals')} size="sm" fw={600}>
            the Modals guide
          </Anchor>{' '}
          and{' '}
          <Anchor
            component={Link}
            href={docsPath('notifications')}
            size="sm"
            fw={600}
          >
            the Notifications guide
          </Anchor>{' '}
          -- each already carries the full options tables and live try-it
          buttons, so those guides are the reference for the facades themselves.
          The components the facades ship alongside (useModalForm,
          TimedRingProgress) have their own pages above.
        </Text>
      </DocSection>

      <DocSection title="Kit vs. app: where a new component goes">
        <Text size="sm">
          Add a component to the kit (src/ui/core/&lt;name&gt;/) when it&apos;s
          generic: no product-specific copy, data, or business logic. Every kit
          component follows the same shape -- the component file, a Storybook
          story next to it, and a named export from src/ui/core/index.ts. Add it
          to the app (src/app/**) when it only makes sense for this one product;
          app components still reach Mantine primitives only through @ui/*. If a
          kit component&apos;s name collides with something @mantine/core or
          @mantine/dates already exports, it becomes a shadow: a named export
          placed after the barrel&apos;s star exports, which wins for every
          @ui/core caller (that&apos;s how Table and TextInput work).
        </Text>
      </DocSection>
    </DocPage>
  );
}
