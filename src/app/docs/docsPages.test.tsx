import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { DocsLayout } from './DocsLayout';
import {
  DOCS_NAV_GROUPS,
  DOCS_NAV_ITEMS,
  DOCS_SLUGS,
  docsPath,
} from './docsNav';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

// Sidebar labels double as each page's h1, so nav and content stay in sync.
const PAGE_TITLES: Record<string, string> = {
  '': 'Getting started',
  'import-walls': 'Import walls',
  theming: 'Theming & layered backgrounds',
  hooks: 'Hooks',
  modals: 'Modals',
  notifications: 'Notifications',
  forms: 'Forms',
  'app-chrome': 'App chrome',
  components: 'Components',
  'components/site-shell': 'SiteShell',
  'components/rail-shell': 'RailShell',
  'components/page-shell': 'PageShell',
  'components/content-container': 'ContentContainer',
  'components/slide-in-sidebar': 'SlideInSidebar',
  'components/notch': 'Notch',
  'components/gradient-border': 'GradientBorder',
  'components/animated-border-box': 'AnimatedBorderBox',
  'components/selectable-list': 'SelectableList',
  'components/acceptable-list': 'AcceptableList',
  'components/searchable-menu': 'SearchableMenu',
  'components/hybrid-menu': 'HybridMenu',
  'components/text-input': 'TextInput',
  'components/range-picker': 'RangePicker',
  'components/collapsible-alert-card': 'CollapsibleAlertCard',
  'components/generic-error': 'GenericError',
  'components/lazy-loader': 'LazyLoader',
  'components/copy-buttons': 'Copy buttons',
  'components/icon-tooltip': 'IconTooltip',
  'components/hover-wrappers': 'Hover wrappers',
  'components/table': 'Table',
  'components/virtual-list': 'VirtualList',
  'components/virtual-table': 'VirtualTable',
  'components/code-highlight': 'CodeHighlight',
  'components/codemirror': 'CodeMirror',
  icons: 'Icons',
  'lazy-loading': 'Lazy loading',
  'components/form-container': 'FormContainer',
  'components/use-modal-form': 'useModalForm',
  'components/timed-ring-progress': 'TimedRingProgress',
  'components/theme-override-wrapper': 'ThemeOverrideWrapper',
  'hooks/use-scheme-colors': 'useSchemeColors',
  'hooks/use-color-scheme': 'useColorScheme',
  'hooks/use-ui-state': 'useUIState',
  'hooks/use-storage': 'Storage hooks',
  'hooks/use-is-mobile': 'useIsMobile',
  'hooks/use-has-overflow-x': 'useHasOverflowX',
  'hooks/use-hoverable-text-style': 'useHoverableTextStyle',
  scaffolding: 'Scaffolding',
};

test.each(
  DOCS_SLUGS.map(
    slug => [slug === '' ? '(getting started)' : slug, slug] as const
  )
)('docs page %s renders its heading inside the docs shell', (_label, slug) => {
  const { unmount } = renderWithProviders(<DocsLayout slug={slug} />);

  expect(
    screen.getByRole('heading', { level: 1, name: PAGE_TITLES[slug] })
  ).toBeTruthy();
  // The persistent sidebar is present on every docs page (desktop layout in
  // jsdom: useIsMobile reports false for an unmeasured viewport).
  expect(
    screen.getByRole('navigation', { name: 'Documentation' })
  ).toBeTruthy();
  unmount();
});

test('every nav item has a page and every page has a nav item', () => {
  expect(DOCS_NAV_ITEMS.map(item => item.slug).sort()).toEqual(
    [...DOCS_SLUGS].sort()
  );
});

test('sidebar highlights the active page and links the others by href', () => {
  renderWithProviders(<DocsLayout slug="theming" />);
  const nav = screen.getByRole('navigation', { name: 'Documentation' });

  const links = Array.from(nav.querySelectorAll('a'));
  expect(links.map(link => link.getAttribute('href'))).toEqual(
    DOCS_NAV_ITEMS.map(item => docsPath(item.slug))
  );

  const active = links.filter(
    link => link.getAttribute('data-active') === 'true'
  );
  expect(active).toHaveLength(1);
  expect(active[0].textContent).toContain('Theming & backgrounds');

  // Group labels render as section headers. (getAllByText: 'Overview' is
  // both the first group's label and the components index's item label.)
  for (const { label } of DOCS_NAV_GROUPS) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

test('modals page: the try-it buttons fire the real modal facade', async () => {
  renderWithProviders(<DocsLayout slug="modals" />);

  fireEvent.click(screen.getByRole('button', { name: 'Try modals.confirm' }));
  expect(
    await screen.findByText(/confirm modal with destructive: true/)
  ).toBeTruthy();
});

test('notifications page: the try-it button fires the real notification facade', async () => {
  renderWithProviders(<DocsLayout slug="notifications" />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Try notifications.success' })
  );
  expect(
    await screen.findByText(
      'This is notifications.success with its level defaults.'
    )
  ).toBeTruthy();
});

test('docs pager walks the sidebar order', () => {
  // Theming leads the Guides group, so its pager points back to Getting
  // started and forward to Hooks; Import walls closes the group.
  renderWithProviders(<DocsLayout slug="theming" />);
  const pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));

  expect(
    pager.getByRole('link', { name: /Getting started/ }).getAttribute('href')
  ).toBe('/docs');
  expect(pager.getByRole('link', { name: /Hooks/ }).getAttribute('href')).toBe(
    '/docs/hooks'
  );
});

test('scaffolding closes the Guides group, before the components reference', () => {
  renderWithProviders(<DocsLayout slug="scaffolding" />);
  const pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));

  expect(
    pager.getByRole('link', { name: /Import walls/ }).getAttribute('href')
  ).toBe('/docs/import-walls');
  expect(
    pager.getByRole('link', { name: /Overview/ }).getAttribute('href')
  ).toBe('/docs/components');
});

test('the Lists & menus group follows Layout in the pager order', () => {
  // SelectableList opens Lists & menus, so its pager points back to the last
  // Layout page (AnimatedBorderBox) and forward to AcceptableList.
  renderWithProviders(<DocsLayout slug="components/selectable-list" />);
  const pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));

  expect(
    pager.getByRole('link', { name: /AnimatedBorderBox/ }).getAttribute('href')
  ).toBe('/docs/components/animated-border-box');
  expect(
    pager.getByRole('link', { name: /AcceptableList/ }).getAttribute('href')
  ).toBe('/docs/components/acceptable-list');
});

test('Inputs & pickers hands off to Feedback & overlays', () => {
  // RangePicker closes Inputs & pickers; CollapsibleAlertCard opens the
  // Feedback & overlays group.
  renderWithProviders(<DocsLayout slug="components/range-picker" />);
  const pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));

  expect(
    pager.getByRole('link', { name: /TextInput/ }).getAttribute('href')
  ).toBe('/docs/components/text-input');
  expect(
    pager
      .getByRole('link', { name: /CollapsibleAlertCard/ })
      .getAttribute('href')
  ).toBe('/docs/components/collapsible-alert-card');
});

test('Feedback & overlays closes into Data & code', () => {
  // Hover wrappers is the group's last page; the next page is the Table
  // shadow, opening Data & code.
  renderWithProviders(<DocsLayout slug="components/hover-wrappers" />);
  const pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));

  expect(
    pager.getByRole('link', { name: /IconTooltip/ }).getAttribute('href')
  ).toBe('/docs/components/icon-tooltip');
  expect(pager.getByRole('link', { name: /Table/ }).getAttribute('href')).toBe(
    '/docs/components/table'
  );
});

test('Forms & facades follows Data & code, then Design system', () => {
  // FormContainer opens Forms & facades right after the Lazy loading page;
  // TimedRingProgress closes the group into Design system's only page.
  const first = renderWithProviders(
    <DocsLayout slug="components/form-container" />
  );
  let pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));
  expect(
    pager.getByRole('link', { name: /Lazy loading/ }).getAttribute('href')
  ).toBe('/docs/lazy-loading');
  expect(
    pager.getByRole('link', { name: /useModalForm/ }).getAttribute('href')
  ).toBe('/docs/components/use-modal-form');
  first.unmount();

  renderWithProviders(<DocsLayout slug="components/timed-ring-progress" />);
  pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));
  expect(
    pager
      .getByRole('link', { name: /ThemeOverrideWrapper/ })
      .getAttribute('href')
  ).toBe('/docs/components/theme-override-wrapper');
});

test('the Hooks group closes the sidebar order', () => {
  // useSchemeColors opens Hooks right after Design system's last page
  // (ThemeIsland); useHoverableTextStyle is the last docs page (no next link).
  const first = renderWithProviders(
    <DocsLayout slug="hooks/use-scheme-colors" />
  );
  let pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));
  expect(
    pager.getByRole('link', { name: /ThemeIsland/ }).getAttribute('href')
  ).toBe('/docs/components/theme-island');
  expect(
    pager.getByRole('link', { name: /useColorScheme/ }).getAttribute('href')
  ).toBe('/docs/hooks/use-color-scheme');
  first.unmount();

  renderWithProviders(<DocsLayout slug="hooks/use-hoverable-text-style" />);
  pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));
  expect(
    pager.getByRole('link', { name: /useHasOverflowX/ }).getAttribute('href')
  ).toBe('/docs/hooks/use-has-overflow-x');
  // The last docs page has a prev link only.
  expect(pager.getAllByRole('link')).toHaveLength(1);
});

test('use-ui-state page: the persisted switch round-trips through localStorage', async () => {
  window.localStorage.removeItem('docs-use-ui-state-compact');
  renderWithProviders(<DocsLayout slug="hooks/use-ui-state" />);

  const toggle = screen.getByRole('switch', { name: /Compact results/ });
  await userEvent.click(toggle);
  expect(
    JSON.parse(
      window.localStorage.getItem('docs-use-ui-state-compact') ?? 'null'
    )
  ).toBe(true);
  window.localStorage.removeItem('docs-use-ui-state-compact');
});

test('modal form page: the demo opens a live zod-validated modal form', async () => {
  renderWithProviders(<DocsLayout slug="components/use-modal-form" />);

  await userEvent.click(screen.getByRole('button', { name: 'Add gear item' }));
  expect(await screen.findByLabelText('Item name')).toBeTruthy();

  // Submitting empty surfaces a schema field error inside the modal (the
  // empty string fails both rules; zodResolver reports the regex one).
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(
    await screen.findByText('Only letters, numbers, and underscores')
  ).toBeTruthy();
});

test('generic error page: the retry flow loads the panel', async () => {
  renderWithProviders(<DocsLayout slug="components/generic-error" />);

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  // The demo's fake fetch resolves after ~800ms of real time.
  expect(
    await screen.findByText(/Loaded on retry/, undefined, { timeout: 3000 })
  ).toBeTruthy();
});

test('selectable list page: the controlled demo buttons drive selectedKeys', () => {
  renderWithProviders(<DocsLayout slug="components/selectable-list" />);

  // The controlled demo starts empty, then the external button pushes the
  // camera keys into selectedKeys -- echoed as badges under the list.
  // queryAllByText: relative counts, since how many list rows the
  // virtualizer mounts in jsdom is not this test's business.
  const before = screen.queryAllByText('field_camera_a').length;
  fireEvent.click(screen.getByRole('button', { name: 'Select the cameras' }));
  expect(screen.queryAllByText('field_camera_a')).toHaveLength(before + 1);
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.queryAllByText('field_camera_a')).toHaveLength(before);
});

test('app chrome sits between Forms and Import walls in the Guides group', () => {
  renderWithProviders(<DocsLayout slug="app-chrome" />);
  const pager = within(screen.getByRole('navigation', { name: 'Docs pager' }));

  expect(pager.getByRole('link', { name: /Forms/ }).getAttribute('href')).toBe(
    '/docs/forms'
  );
  expect(
    pager.getByRole('link', { name: /Import walls/ }).getAttribute('href')
  ).toBe('/docs/import-walls');
});
