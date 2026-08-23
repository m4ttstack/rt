import { Anchor, Text } from '@ui/core';
import { Link } from '../../../router/Link';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';
import { docsPath } from '../../docsNav';

const USAGE = [
  "import { SiteShell } from '@ui/core';",
  '',
  '<SiteShell',
  '  header={<MyHeader />}',
  '  headerHeight={56}',
  '  // Optional fixed sidebar; omit for the header-only layout.',
  '  navbar={<MyNav />}',
  '  navbarWidth={240}',
  '>',
  '  {pageContent}',
  '</SiteShell>',
].join('\n');

// Rows transcribed from src/ui/core/site-shell/SiteShell.tsx (SiteShellProps).
const PROPS_ROWS = [
  {
    name: 'header',
    type: 'ReactNode',
    note: 'Required. Rendered inside the fixed AppShell.Header at the top of the viewport.',
  },
  {
    name: 'headerHeight?',
    type: 'number',
    note: 'Height of the fixed header in px; content is offset by the same amount. Default 56.',
  },
  {
    name: 'headerProps?',
    type: 'AppShellHeaderProps',
    note: "Props for the AppShell.Header element itself (e.g. a translucent surface). Caller styles win over the kit's defaults.",
  },
  {
    name: 'mainProps?',
    type: 'AppShellMainProps',
    note: 'Props for the AppShell.Main element wrapping children.',
  },
  {
    name: 'navbar?',
    type: 'ReactNode',
    note: 'Rendered inside a fixed left AppShell.Navbar (bg.level2 surface, 1px right hairline, scrollable). Omit it and the shell renders exactly as the header-only layout.',
  },
  {
    name: 'navbarWidth?',
    type: 'number',
    note: 'Width of the fixed navbar in px; only meaningful with navbar. Default 240.',
  },
  {
    name: 'navbarBreakpoint?',
    type: 'MantineBreakpoint',
    note: "Breakpoint below which the navbar's collapsed.mobile state applies. Default 'sm'.",
  },
  {
    name: 'navbarCollapsed?',
    type: '{ mobile?, desktop? }',
    note: "Mantine AppShell's own collapsed flags, for wiring a burger/toggle.",
  },
  {
    name: 'navbarProps?',
    type: 'AppShellNavbarProps',
    note: 'Props for the AppShell.Navbar element itself; caller styles win, same as headerProps.',
  },
  {
    name: '...rest',
    type: 'AppShellProps',
    note: 'Remaining AppShell props (padding, layout, zIndex, transitionDuration, ...) pass straight through.',
  },
];

export function SiteShellPage() {
  return (
    <ComponentDoc
      title="SiteShell"
      lead="Site-level chrome: a fixed header above normally-scrolling page content, as a thin kit-styled wrapper over Mantine's AppShell, with an optional fixed sidebar via the navbar slot."
      bareDemo
      demo={
        <Text size="sm">
          A fixed-position shell cannot render inside a docs page, so its live
          demos are the site itself: the{' '}
          <Anchor component={Link} href="/" size="sm" fw={500}>
            landing page
          </Anchor>{' '}
          runs the header-only form, and the chrome around these docs is a
          SiteShell in its alt layout, driven by{' '}
          <Anchor
            component={Link}
            href={docsPath('components/rail-shell')}
            size="sm"
            fw={500}
          >
            RailShell
          </Anchor>
          .
        </Text>
      }
      usage={USAGE}
      usageMinHeight={260}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The page keeps normal document scrolling: AppShell.Main is offset by
          the header height (and the navbar width when one is given), so sticky
          elements and in-page anchors behave as usual. Layering follows the
          kit&apos;s surface convention -- header and navbar are raised
          bg.level2 surfaces with 1px default-border hairlines, main content
          sits on bg.level1.
        </Text>
        <Text size="sm" c="dimmed">
          Aside/footer sections are out of scope: reach for raw AppShell when
          the chrome outgrows &quot;header + sidebar + content&quot;. For the
          mini-icon-rail app chrome, use RailShell instead of composing it by
          hand.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
