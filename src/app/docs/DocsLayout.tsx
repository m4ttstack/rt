import {
  Anchor,
  Divider,
  Group,
  NavLink,
  PageShell,
  Stack,
  Text,
  usePageShellContext,
} from '@ui/core';
import { Icon } from '@ui/icons';
import { Link } from '../router/Link';
import {
  DOCS_NAV_GROUPS,
  DOCS_NAV_ITEMS,
  docsPath,
  type DocsSlug,
} from './docsNav';
import { AppChromePage } from './pages/AppChromePage';
import { AcceptableListPage } from './pages/components/AcceptableListPage';
import { AnimatedBorderBoxPage } from './pages/components/AnimatedBorderBoxPage';
import { CodeHighlightPage } from './pages/components/CodeHighlightPage';
import { CodeMirrorPage } from './pages/components/CodeMirrorPage';
import { CollapsibleAlertCardPage } from './pages/components/CollapsibleAlertCardPage';
import { ContentContainerPage } from './pages/components/ContentContainerPage';
import { CopyButtonsPage } from './pages/components/CopyButtonsPage';
import { FormContainerPage } from './pages/components/FormContainerPage';
import { GenericErrorPage } from './pages/components/GenericErrorPage';
import { GradientBorderPage } from './pages/components/GradientBorderPage';
import { HoverWrappersPage } from './pages/components/HoverWrappersPage';
import { HybridMenuPage } from './pages/components/HybridMenuPage';
import { IconTooltipPage } from './pages/components/IconTooltipPage';
import { LazyLoaderPage } from './pages/components/LazyLoaderPage';
import { NotchPage } from './pages/components/NotchPage';
import { PageShellPage } from './pages/components/PageShellPage';
import { RailShellPage } from './pages/components/RailShellPage';
import { RangePickerPage } from './pages/components/RangePickerPage';
import { SearchableMenuPage } from './pages/components/SearchableMenuPage';
import { SelectableListPage } from './pages/components/SelectableListPage';
import { SiteShellPage } from './pages/components/SiteShellPage';
import { SlideInSidebarPage } from './pages/components/SlideInSidebarPage';
import { TablePage } from './pages/components/TablePage';
import { TextInputPage } from './pages/components/TextInputPage';
import { ThemeIslandPage } from './pages/components/ThemeIslandPage';
import { ThemeOverrideWrapperPage } from './pages/components/ThemeOverrideWrapperPage';
import { TimedRingProgressPage } from './pages/components/TimedRingProgressPage';
import { UseModalFormPage } from './pages/components/UseModalFormPage';
import { VirtualListPage } from './pages/components/VirtualListPage';
import { VirtualTablePage } from './pages/components/VirtualTablePage';
import { ComponentsPage } from './pages/ComponentsPage';
import { FormsGuidePage } from './pages/FormsGuidePage';
import { GettingStartedPage } from './pages/GettingStartedPage';
import { UseColorSchemePage } from './pages/hooks/UseColorSchemePage';
import { UseHasOverflowXPage } from './pages/hooks/UseHasOverflowXPage';
import { UseHoverableTextStylePage } from './pages/hooks/UseHoverableTextStylePage';
import { UseIsMobilePage } from './pages/hooks/UseIsMobilePage';
import { UseSchemeColorsPage } from './pages/hooks/UseSchemeColorsPage';
import { UseStoragePage } from './pages/hooks/UseStoragePage';
import { UseUIStatePage } from './pages/hooks/UseUIStatePage';
import { HooksPage } from './pages/HooksPage';
import { IconsPage } from './pages/IconsPage';
import { ImportWallsPage } from './pages/ImportWallsPage';
import { LazyLoadingPage } from './pages/LazyLoadingPage';
import { ModalsPage } from './pages/ModalsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ScaffoldingPage } from './pages/ScaffoldingPage';
import { ThemingPage } from './pages/ThemingPage';

/** One component per docs route -- the slug union guarantees every nav entry
 * has a page and vice versa. */
export const DOCS_PAGES: Record<DocsSlug, () => React.ReactElement> = {
  '': GettingStartedPage,
  'import-walls': ImportWallsPage,
  theming: ThemingPage,
  hooks: HooksPage,
  modals: ModalsPage,
  notifications: NotificationsPage,
  forms: FormsGuidePage,
  'app-chrome': AppChromePage,
  components: ComponentsPage,
  'components/site-shell': SiteShellPage,
  'components/rail-shell': RailShellPage,
  'components/page-shell': PageShellPage,
  'components/content-container': ContentContainerPage,
  'components/slide-in-sidebar': SlideInSidebarPage,
  'components/notch': NotchPage,
  'components/gradient-border': GradientBorderPage,
  'components/animated-border-box': AnimatedBorderBoxPage,
  'components/selectable-list': SelectableListPage,
  'components/acceptable-list': AcceptableListPage,
  'components/searchable-menu': SearchableMenuPage,
  'components/hybrid-menu': HybridMenuPage,
  'components/text-input': TextInputPage,
  'components/range-picker': RangePickerPage,
  'components/collapsible-alert-card': CollapsibleAlertCardPage,
  'components/generic-error': GenericErrorPage,
  'components/lazy-loader': LazyLoaderPage,
  'components/copy-buttons': CopyButtonsPage,
  'components/icon-tooltip': IconTooltipPage,
  'components/hover-wrappers': HoverWrappersPage,
  'components/table': TablePage,
  'components/virtual-list': VirtualListPage,
  'components/virtual-table': VirtualTablePage,
  'components/code-highlight': CodeHighlightPage,
  'components/codemirror': CodeMirrorPage,
  icons: IconsPage,
  'lazy-loading': LazyLoadingPage,
  'components/form-container': FormContainerPage,
  'components/use-modal-form': UseModalFormPage,
  'components/timed-ring-progress': TimedRingProgressPage,
  'components/theme-override-wrapper': ThemeOverrideWrapperPage,
  'components/theme-island': ThemeIslandPage,
  'hooks/use-scheme-colors': UseSchemeColorsPage,
  'hooks/use-color-scheme': UseColorSchemePage,
  'hooks/use-ui-state': UseUIStatePage,
  'hooks/use-storage': UseStoragePage,
  'hooks/use-is-mobile': UseIsMobilePage,
  'hooks/use-has-overflow-x': UseHasOverflowXPage,
  'hooks/use-hoverable-text-style': UseHoverableTextStylePage,
  scaffolding: ScaffoldingPage,
};

/** The grouped docs nav, riding `PageShell.Sidebar`: same group-label and
 * active-tint conventions as the old hand-styled sidebar. Navigating closes
 * the sidebar when it's collapsed into the mobile overlay drawer. */
function DocsNav({ activeSlug }: { activeSlug: DocsSlug }) {
  const { collapsedSidebar, sidebarOpen, toggleSidebar } =
    usePageShellContext();

  const closeDrawer = () => {
    if (collapsedSidebar && sidebarOpen) toggleSidebar();
  };

  return (
    <Stack gap="md" p="md" component="nav" aria-label="Documentation">
      {DOCS_NAV_GROUPS.map(({ label, items }) => (
        <Stack key={label} gap={2}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="sm" pb={4}>
            {label}
          </Text>
          {items.map(({ slug, label: itemLabel }) => (
            <NavLink
              key={slug}
              component={Link}
              href={docsPath(slug)}
              label={itemLabel}
              active={slug === activeSlug}
              onClick={closeDrawer}
              style={{ borderRadius: 'var(--mantine-radius-md)' }}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

/** Prev/next links along the flat sidebar order, at the bottom of every docs page. */
function DocsPager({ slug }: { slug: DocsSlug }) {
  const index = DOCS_NAV_ITEMS.findIndex(item => item.slug === slug);
  const prev = index > 0 ? DOCS_NAV_ITEMS[index - 1] : null;
  const next =
    index < DOCS_NAV_ITEMS.length - 1 ? DOCS_NAV_ITEMS[index + 1] : null;

  return (
    <Stack gap="md" maw={860} component="nav" aria-label="Docs pager">
      <Divider />
      <Group justify="space-between">
        {prev ? (
          <Anchor
            component={Link}
            href={docsPath(prev.slug)}
            size="sm"
            fw={500}
          >
            <Group gap={4} wrap="nowrap">
              <Icon name="arrowLeft" size={14} />
              {prev.label}
            </Group>
          </Anchor>
        ) : (
          <span />
        )}
        {next ? (
          <Anchor
            component={Link}
            href={docsPath(next.slug)}
            size="sm"
            fw={500}
          >
            <Group gap={4} wrap="nowrap">
              {next.label}
              <Icon name="arrowRight" size={14} />
            </Group>
          </Anchor>
        ) : (
          <span />
        )}
      </Group>
    </Stack>
  );
}

/**
 * The docs section, as a compound `PageShell` inside the site's rail chrome
 * (`AppChrome` hosts it): the grouped docs nav rides `PageShell.Sidebar`
 * (collapse persisted via the 'docs-sidebar' drawer key; an overlay drawer
 * on mobile), a slim `PageShell.Header` carries the section label while
 * each page keeps its own h1, and `PageShell.Content` wraps the active
 * topic plus the prev/next pager in a width-capped column.
 *
 * The content area is keyed by slug so each route change remounts its
 * scroll frame at the top -- the section scrolls inside the shell, not with
 * the document.
 */
export function DocsLayout({ slug }: { slug: DocsSlug }) {
  const ActivePage = DOCS_PAGES[slug];

  return (
    <PageShell
      drawerStateKey="docs-sidebar"
      // No topOffset: AppChrome's RailShell publishes its headerHeight and
      // a hosted PageShell defaults to it.
      sidebarWidth={260}
    >
      <PageShell.Sidebar>
        <DocsNav activeSlug={slug} />
      </PageShell.Sidebar>
      <PageShell.Main>
        <PageShell.Header>
          <Text fw={600}>Documentation</Text>
        </PageShell.Header>
        <PageShell.Content key={slug}>
          <Stack gap="xl" py="md">
            <ActivePage />
            <DocsPager slug={slug} />
          </Stack>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}
