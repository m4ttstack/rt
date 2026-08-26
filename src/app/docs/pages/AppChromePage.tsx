import { Anchor, Table, Text } from '@ui/core';
import { CodeBlock } from '../../components/CodeBlock';
import { Link } from '../../router/Link';
import { DocPage, DocSection } from '../DocPage';
import { docsPath } from '../docsNav';

// Mirrors the site's own chrome wiring in src/app/chrome/AppChrome.tsx --
// keep in sync when that file changes.
const RECIPE_SNIPPET = [
  "import { Rail, RailEntry, RailShell, useRailState } from '@ui/core';",
  '',
  'const HEADER_HEIGHT = 64;',
  '',
  'function AppChrome({ children }: { children: React.ReactNode }) {',
  '  const rail = useRailState();',
  '',
  '  return (',
  '    <RailShell',
  '      headerHeight={HEADER_HEIGHT}',
  '      header={<Wordmark />}',
  '      rail={',
  '        <Rail',
  '          label="Site sections"',
  '          expanded={rail.effectiveExpanded}',
  '          onToggleExpanded={rail.toggleExpanded}',
  '          pinBottom={',
  '            <RailEntry',
  '              icon="moon"',
  '              label="Switch to dark mode"',
  '              expanded={rail.effectiveExpanded}',
  '              onClick={toggleScheme}',
  '            />',
  '          }',
  '        >',
  '          <RailEntry',
  '            icon="bookOpen"',
  '            label="Docs"',
  '            component={Link}',
  '            href="/docs"',
  '            expanded={rail.effectiveExpanded}',
  '            active',
  '            onClick={rail.close}',
  '          />',
  '        </Rail>',
  '      }',
  '      railExpanded={rail.effectiveExpanded}',
  '      railOpened={rail.opened}',
  '      onToggleRail={rail.toggleOpened}',
  '      onCloseRail={rail.close}',
  '    >',
  '      {/* host a PageShell here -- its topOffset defaults to */}',
  "      {/* this shell's headerHeight, so pass nothing */}",
  '      {children}',
  '    </RailShell>',
  '  );',
  '}',
].join('\n');

interface LayerRow {
  layer: string;
  z: string;
  note: string;
}

const Z_INDEX_LAYERS: LayerRow[] = [
  {
    layer: 'Desktop rail (AppShell.Navbar)',
    z: '5',
    note: 'Deliberately low: it sits UNDER the hosted PageShell root, so edge-riding page UI (the collapsed sidebar trigger) paints in front of the rail instead of behind it.',
  },
  {
    layer: 'PageShell root',
    z: '10',
    note: 'contain: layout plus a modest explicit stacking level -- the other half of the pair with the rail at 5.',
  },
  {
    layer: 'Chrome header (AppShell.Header)',
    z: '100',
    note: "Mantine's default; stays above scrolled content.",
  },
  {
    layer: 'Mobile click-to-close overlay',
    z: '999',
    note: 'Fixed dimmer under the open rail; tapping it closes the rail.',
  },
  {
    layer: 'Mobile-open chrome',
    z: '1000',
    note: 'Header and navbar lift over the overlay while the rail is open. Mantine renders the navbar at zIndex + 1 (1001), so the open rail paints over the header strip.',
  },
];

export function AppChromePage() {
  return (
    <DocPage
      title="App chrome"
      lead="Two levels of navigation, by import: an app-level mini icon rail (slim icon strip that expands into a labeled drawer) wrapping page-level sidebars -- the double-nav geometry this site's docs and demo sections run on."
    >
      <DocSection title="Which shell, when">
        <Text size="sm">
          SiteShell is the plain chrome: a fixed header over body-scrolled
          content, with an optional fixed sidebar (the marketing landing page
          uses its header-only form). RailShell is the app chrome: a SiteShell
          in layout=&quot;alt&quot; whose navbar is a mini icon rail, composed
          from Rail (the nav container with the built-in desktop expand trigger)
          and RailEntry (fixed icon column, tooltip while slim, slide-in label
          once expanded), wired by useRailState. Inside either, a PageShell
          provides the page-level sidebar -- rail and sidebar collapse
          independently, which is the whole point of the double-nav geometry.
        </Text>
        <Text size="sm" c="dimmed">
          The rail&apos;s two widths ship as exported constants: RAIL_WIDTH
          (68px slim) and RAIL_WIDTH_EXPANDED (260px labeled), overridable per
          shell via railWidth / railWidthExpanded.
        </Text>
        <Text size="sm">
          This page is the conceptual guide; each component&apos;s reference
          page carries its live demo and full props tables:{' '}
          <Anchor
            component={Link}
            href={docsPath('components/site-shell')}
            size="sm"
            fw={500}
          >
            SiteShell
          </Anchor>
          ,{' '}
          <Anchor
            component={Link}
            href={docsPath('components/rail-shell')}
            size="sm"
            fw={500}
          >
            RailShell
          </Anchor>{' '}
          (covering Rail, RailEntry, and useRailState), and{' '}
          <Anchor
            component={Link}
            href={docsPath('components/page-shell')}
            size="sm"
            fw={500}
          >
            PageShell
          </Anchor>
          .
        </Text>
      </DocSection>

      <DocSection title="The double-nav recipe">
        <Text size="sm">
          This is the site&apos;s own chrome wiring (src/app/chrome/
          AppChrome.tsx), trimmed to the moving parts. Entries link via
          Mantine&apos;s polymorphic component prop, so any router&apos;s anchor
          works; the color-scheme toggle rides the pinBottom slot, which pins it
          to the rail&apos;s bottom through a flex spacer. Each hosted section
          brings its own PageShell, and needs no topOffset: RailShell publishes
          its headerHeight on context and a hosted PageShell defaults to it, so
          the shell&apos;s height math clears the fixed header exactly with the
          number living in one place. Sub-navigation between sibling views
          inside a section rides the PageShell&apos;s own tabs prop (a
          page-level tab bar above the body) rather than more chrome.
        </Text>
        <CodeBlock code={RECIPE_SNIPPET} language="tsx" minHeight={1180} />
      </DocSection>

      <DocSection title="The z-index contract">
        <Text size="sm">
          RailShell keeps the layering internal, but composing your own chrome
          around it means knowing where each layer sits:
        </Text>
        <Table.ScrollContainer minWidth={520}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Layer</Table.Th>
                <Table.Th>z-index</Table.Th>
                <Table.Th>Why</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Z_INDEX_LAYERS.map(({ layer, z, note }) => (
                <Table.Tr key={layer}>
                  <Table.Td>
                    <Text size="sm">{layer}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {z}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{note}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </DocSection>

      <DocSection title="Mobile behavior">
        <Text size="sm">
          Below the sm breakpoint the rail collapses behind a toggle button
          RailShell adds to its header. Opening follows useRailState&apos;s
          expand-then-open rule: the rail opens already expanded (a slim icon
          strip floating over a dimmed page is a trap; a labeled nav is the
          point), floating over the click-to-close overlay at its explicit 260px
          width -- never Mantine&apos;s full-width mobile navbar default.
          Dismissal is tapping the overlay or navigating from an entry (wire the
          entries&apos; onClick to rail.close) -- the header toggle sits under
          the open rail, so it cannot be the close affordance. The desktop
          expand toggle state is untouched by any of it, and Rail&apos;s own
          expand trigger is desktop-only (visibleFrom=&quot;sm&quot;).
        </Text>
      </DocSection>
    </DocPage>
  );
}
