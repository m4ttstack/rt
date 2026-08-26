import {
  Anchor,
  Group,
  Rail,
  RailEntry,
  RailShell,
  Text,
  useRailState,
} from '@ui/core';
import { useColorScheme } from '@ui/hooks';
import { APP_NAME } from '../landing/branding';
import { Link } from '../router/Link';
import { useSiteHeaderProps } from './layout';
import { LogoMark } from './LogoMark';

/** Height of the app chrome's slim fixed header, in px. Sections hosted in
 * the chrome pass this to their `PageShell` as `topOffset`, so the shell's
 * height math clears the fixed header exactly. */
export const APP_CHROME_HEADER_HEIGHT = 64;

/** The app-like site sections that live inside the rail chrome. */
export type SiteSection = 'docs' | 'demo';

const SECTION_LABEL: Record<SiteSection, string> = {
  docs: 'Docs',
  demo: 'Demo',
};

/** The site's rail: the kit `Rail` carrying the site's sections (active one
 * highlighted) as router-linked entries, with the color-scheme toggle
 * pinned to the rail's bottom. */
function SiteRail({
  section,
  expanded,
  onToggleExpanded,
  onNavigate,
}: {
  section: SiteSection | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onNavigate: () => void;
}) {
  const { computedColorScheme, setColorScheme } = useColorScheme();
  const isDark = computedColorScheme === 'dark';

  return (
    <Rail
      label="Site sections"
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      pinBottom={
        <RailEntry
          icon={isDark ? 'sun' : 'moon'}
          label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          expanded={expanded}
          onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
        />
      }
    >
      <RailEntry
        icon="layers"
        label="Home"
        component={Link}
        href="/"
        expanded={expanded}
        onClick={onNavigate}
      />
      <RailEntry
        icon="bookOpen"
        label="Docs"
        component={Link}
        href="/docs"
        expanded={expanded}
        active={section === 'docs'}
        onClick={onNavigate}
      />
      <RailEntry
        icon="zap"
        label="Demo"
        component={Link}
        href="/demo"
        expanded={expanded}
        active={section === 'demo'}
        onClick={onNavigate}
      />
    </Rail>
  );
}

/**
 * The site's app chrome, hosting the docs and demo sections: the kit's
 * `RailShell` (a `SiteShell` in `layout="alt"` whose navbar is a mini icon
 * rail -- the same double-nav geometry the full-screen
 * PageShell demo showcases) under a slim fixed header carrying the
 * wordmark and the current section.
 *
 * This is the site's normal chrome for its app-like sections, not a
 * takeover: Home on the rail routes back to the marketing landing page,
 * which deliberately keeps the header-only shell (the marketing-page vs
 * app-chrome split a real product has). Each hosted section brings its own
 * page-level `PageShell` (docs nav, demo screens) as `children`, passing
 * `APP_CHROME_HEADER_HEIGHT` as its `topOffset`.
 *
 * On mobile the rail collapses behind the header's toggle button and opens
 * as the expanded, labeled nav over a dimmed page (`useRailState`'s
 * expand-then-open); navigating or tapping the overlay closes it.
 */
export function AppChrome({
  section,
  children,
}: {
  /** The active rail section, for highlighting. `null` renders the chrome
   * with no section highlighted (e.g. a not-found page under `/docs`). */
  section: SiteSection | null;
  children: React.ReactNode;
}) {
  const headerProps = useSiteHeaderProps();
  const rail = useRailState();

  return (
    <RailShell
      headerHeight={APP_CHROME_HEADER_HEIGHT}
      headerProps={headerProps}
      header={
        <>
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
          {section != null && (
            <Group gap="xs" wrap="nowrap" visibleFrom="sm">
              <Text c="dimmed" aria-hidden>
                /
              </Text>
              <Text size="sm" fw={500}>
                {SECTION_LABEL[section]}
              </Text>
            </Group>
          )}
        </>
      }
      rail={
        <SiteRail
          section={section}
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
          onNavigate={rail.close}
        />
      }
      railExpanded={rail.effectiveExpanded}
      railOpened={rail.opened}
      onToggleRail={rail.toggleOpened}
      onCloseRail={rail.close}
    >
      {children}
    </RailShell>
  );
}
