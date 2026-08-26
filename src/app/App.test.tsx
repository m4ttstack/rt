import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import {
  renderWithProviders,
  setViewportWidth,
} from '@ui/storybook/test-utils';
import { App } from './App';

const DESKTOP_WIDTH = window.innerWidth;

// Route tests drive the app the same way the browser does: seed the URL,
// mount, and (optionally) click real links. Reset both the URL and the
// persisted scheme preference so nothing leaks across tests.
afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.removeItem('ui-color-scheme');
  window.localStorage.removeItem('demo-page-shell-sidebar');
  window.localStorage.removeItem('docs-sidebar');
  setViewportWidth(DESKTOP_WIDTH);
});

function renderAt(path: string) {
  window.history.replaceState(null, '', path);
  return renderWithProviders(<App />);
}

test('/ renders the landing page only: hero, features, quickstart', () => {
  renderAt('/');

  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'A batteries-included Mantine starter',
    })
  ).toBeTruthy();
  expect(
    screen.getByRole('heading', { name: 'Batteries included' })
  ).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Quickstart' })).toBeTruthy();
  // The hero's copyable scaffold command chip shows the real command.
  expect(screen.getByText('bun create-cli/create.ts my-app')).toBeTruthy();

  // The hero's secondary CTA invites straight into the full-screen
  // PageShell demo, next to "Get started".
  expect(
    screen
      .getByRole('link', { name: 'See the full-screen demo' })
      .getAttribute('href')
  ).toBe('/demo/page-shell');

  // The promoted app-chrome card leads the features section and links both
  // the guide and the live demo.
  expect(
    screen.getByRole('heading', { name: 'Double-nav app chrome' })
  ).toBeTruthy();
  expect(
    screen
      .getByRole('link', { name: 'Read the App chrome guide' })
      .getAttribute('href')
  ).toBe('/docs/app-chrome');
  expect(
    screen
      .getByRole('link', { name: 'Launch the full-screen demo' })
      .getAttribute('href')
  ).toBe('/demo/page-shell');

  // No inline docs -- the docs are their own routes.
  expect(
    screen.queryByRole('navigation', { name: 'Documentation' })
  ).toBeNull();

  // Each feature card links to its docs page.
  const docsLinks = screen.getAllByRole('link', { name: 'Read the docs' });
  expect(docsLinks.map(link => link.getAttribute('href'))).toContain(
    '/docs/import-walls'
  );
});

test('header nav routes to the docs without a page load', () => {
  renderAt('/');

  const headerNav = within(
    screen.getByRole('navigation', { name: 'Main navigation' })
  );
  fireEvent.click(headerNav.getByRole('link', { name: 'Docs' }));

  expect(window.location.pathname).toBe('/docs');
  expect(
    screen.getByRole('heading', { level: 1, name: 'Getting started' })
  ).toBeTruthy();
  expect(
    screen.getByRole('navigation', { name: 'Documentation' })
  ).toBeTruthy();
});

test('/docs/theming deep-links straight into a docs topic page', () => {
  renderAt('/docs/theming');

  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'Theming & layered backgrounds',
    })
  ).toBeTruthy();
  // The sidebar highlights the active topic.
  const nav = screen.getByRole('navigation', { name: 'Documentation' });
  const active = Array.from(nav.querySelectorAll('a[data-active="true"]'));
  expect(active).toHaveLength(1);
  expect(active[0].textContent).toContain('Theming & backgrounds');
});

test('/docs/hooks/use-scheme-colors deep-links a hook reference page', () => {
  // Hook reference pages ride the composite 'hooks/<name>' slug, matched by
  // the /docs/hooks/:slug route the same way components/<name> pages are.
  renderAt('/docs/hooks/use-scheme-colors');

  expect(
    screen.getByRole('heading', { level: 1, name: 'useSchemeColors' })
  ).toBeTruthy();
  const nav = screen.getByRole('navigation', { name: 'Documentation' });
  const active = Array.from(nav.querySelectorAll('a[data-active="true"]'));
  expect(active).toHaveLength(1);
  expect(active[0].textContent).toContain('useSchemeColors');
});

test('/demo renders the full-screen PageShell showcase directly', () => {
  renderAt('/demo');

  // The showcase's own double-nav chrome: mini rail + PageShell category
  // nav, no site chrome around it.
  expect(
    screen.getByRole('navigation', { name: 'Gear app navigation' })
  ).toBeTruthy();
  expect(
    screen.getByRole('navigation', { name: 'Gear categories' })
  ).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Inventory' })).toBeTruthy();
  expect(
    screen.queryByRole('navigation', { name: 'Main navigation' })
  ).toBeNull();
});

test('/demo/page-shell stays the canonical deep link to the same showcase', () => {
  renderAt('/demo/page-shell');

  expect(
    screen.getByRole('navigation', { name: 'Gear app navigation' })
  ).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Inventory' })).toBeTruthy();
  expect(
    screen.queryByRole('navigation', { name: 'Main navigation' })
  ).toBeNull();

  // The exit affordance returns to the components reference (the chromed
  // demo section is gone).
  fireEvent.click(screen.getByRole('link', { name: /exit full screen/i }));
  expect(window.location.pathname).toBe('/docs/components');
  expect(
    screen.getByRole('heading', { level: 1, name: 'Components' })
  ).toBeTruthy();
  expect(
    screen.getByRole('navigation', { name: 'Documentation' })
  ).toBeTruthy();
});

test('stale demo screen deep links 404 inside the rail chrome', () => {
  // The retired /demo/dashboard|forms|lists screens fall through to the
  // chromed not-found rather than redirecting.
  renderAt('/demo/forms');

  expect(
    screen.getByRole('heading', { level: 1, name: 'Page not found' })
  ).toBeTruthy();
  expect(
    screen.getByRole('navigation', { name: 'Site sections' })
  ).toBeTruthy();
});

test('unknown paths render the not-found page with a link home', () => {
  renderAt('/no/such/page');

  expect(
    screen.getByRole('heading', { level: 1, name: 'Page not found' })
  ).toBeTruthy();
  // Outside the /docs and /demo prefixes, the 404 keeps the marketing
  // chrome -- no rail.
  expect(
    screen.queryByRole('navigation', { name: 'Site sections' })
  ).toBeNull();

  fireEvent.click(
    screen.getByRole('link', { name: /Back to the landing page/ })
  );

  expect(window.location.pathname).toBe('/');
  expect(
    screen.getByRole('heading', {
      level: 1,
      name: 'A batteries-included Mantine starter',
    })
  ).toBeTruthy();
});

test('unknown docs topics are not-found, not empty shells', () => {
  renderAt('/docs/no-such-topic');
  expect(
    screen.getByRole('heading', { level: 1, name: 'Page not found' })
  ).toBeTruthy();
  // Under a section prefix, the 404 stays inside the rail chrome.
  expect(
    screen.getByRole('navigation', { name: 'Site sections' })
  ).toBeTruthy();
});

test('the docs rail chrome links the top-level destinations and leaves for the demo', () => {
  renderAt('/docs');

  // The rail is icon-only while slim: entries are named by their aria-labels
  // and link the three top-level destinations.
  const rail = within(
    screen.getByRole('navigation', { name: 'Site sections' })
  );
  expect(rail.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe(
    '/'
  );
  expect(rail.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe(
    '/docs'
  );
  expect(rail.getByRole('link', { name: 'Demo' }).getAttribute('href')).toBe(
    '/demo'
  );
  expect(
    rail.getByRole('link', { name: 'Docs' }).getAttribute('aria-current')
  ).toBe('page');
  expect(
    rail.getByRole('link', { name: 'Demo' }).getAttribute('aria-current')
  ).toBeNull();

  // Following the Demo entry leaves the rail chrome for the full-screen
  // showcase.
  fireEvent.click(rail.getByRole('link', { name: 'Demo' }));
  expect(window.location.pathname).toBe('/demo');
  expect(
    screen.getByRole('navigation', { name: 'Gear app navigation' })
  ).toBeTruthy();
  expect(
    screen.queryByRole('navigation', { name: 'Site sections' })
  ).toBeNull();
});

test('the rail expands into labels from its trigger', () => {
  renderAt('/docs');
  const rail = within(
    screen.getByRole('navigation', { name: 'Site sections' })
  );

  // Slim rail: labels stay mounted (so collapse can animate them out
  // symmetrically) but are hidden: aria-hidden, no data-expanded.
  const docsLabel = () => rail.getByText('Docs');
  expect(docsLabel().getAttribute('aria-hidden')).toBe('true');
  expect(docsLabel().hasAttribute('data-expanded')).toBe(false);

  fireEvent.click(rail.getByRole('button', { name: 'Expand navigation' }));

  for (const label of ['Home', 'Docs', 'Demo']) {
    const el = rail.getByText(label);
    expect(el.hasAttribute('data-expanded')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('false');
  }
  expect(
    rail.getByRole('button', { name: 'Collapse navigation' })
  ).toBeTruthy();

  // Collapse: the same labels transition back to hidden, never unmounting.
  fireEvent.click(rail.getByRole('button', { name: 'Collapse navigation' }));
  expect(docsLabel().hasAttribute('data-expanded')).toBe(false);
  expect(docsLabel().getAttribute('aria-hidden')).toBe('true');
});

test('on mobile the rail opens from the header toggle and navigating closes it', () => {
  setViewportWidth(390);
  renderAt('/docs');

  fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));
  expect(screen.getByTestId('rail-overlay')).toBeTruthy();

  const rail = within(
    screen.getByRole('navigation', { name: 'Site sections' })
  );
  fireEvent.click(rail.getByRole('link', { name: 'Home' }));

  expect(window.location.pathname).toBe('/');
  expect(screen.queryByTestId('rail-overlay')).toBeNull();
});

test('the rail hosts the color-scheme toggle on chromed sections', () => {
  renderAt('/docs');
  const rail = within(
    screen.getByRole('navigation', { name: 'Site sections' })
  );
  const scheme = () =>
    document.documentElement.getAttribute('data-mantine-color-scheme');

  expect(scheme()).toBe('light');
  fireEvent.click(rail.getByRole('button', { name: 'Switch to dark mode' }));
  expect(scheme()).toBe('dark');
  fireEvent.click(rail.getByRole('button', { name: 'Switch to light mode' }));
  expect(scheme()).toBe('light');
});

test('the docs sidebar collapse persists via its docs-sidebar drawer key', () => {
  const { container } = renderAt('/docs');

  const sidebar = () =>
    container.querySelector('#page-shell-sidebar') as HTMLElement;
  expect(sidebar().style.width).toContain('16.25rem'); // 260px open width

  fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));

  expect(sidebar().style.width).toContain('0rem');
  expect(
    JSON.parse(window.localStorage.getItem('docs-sidebar') ?? 'null')
  ).toBe(false);
});

test('color-scheme toggle flips the rendered Mantine color scheme', () => {
  renderAt('/');

  const toggle = screen.getByRole('button', { name: 'Toggle color scheme' });
  const scheme = () =>
    document.documentElement.getAttribute('data-mantine-color-scheme');

  // vitest.setup.ts's matchMedia polyfill defaults the OS preference to
  // light, so the initial computed scheme under `auto` is deterministic.
  expect(scheme()).toBe('light');
  fireEvent.click(toggle);
  expect(scheme()).toBe('dark');
  fireEvent.click(toggle);
  expect(scheme()).toBe('light');
});
