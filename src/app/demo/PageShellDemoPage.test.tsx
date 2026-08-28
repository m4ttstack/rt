import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import {
  renderWithProviders,
  setViewportWidth,
} from '@mattstack/app-kit/test-utils';
import { PageShellDemoPage } from './PageShellDemoPage';

const DESKTOP_WIDTH = window.innerWidth;

afterEach(() => {
  window.localStorage.removeItem('demo-page-shell-sidebar');
  setViewportWidth(DESKTOP_WIDTH);
});

// jsdom reports a zero-width viewport, so these tests exercise the desktop
// geometry: the mini rail is always visible and the PageShell sidebar is
// the inline slide-away rail (not the mobile overlay drawer).

test('renders the double-nav geometry: mini rail, category sidebar, header, gear table', () => {
  renderWithProviders(<PageShellDemoPage />);

  // App-level mini rail with its entries (icon-only: names via aria-label).
  expect(
    screen.getByRole('navigation', { name: 'Gear app navigation' })
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Inventory' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Maintenance' })).toBeTruthy();

  // Page-level PageShell: category sidebar, header title, content table.
  expect(
    screen.getByRole('navigation', { name: 'Gear categories' })
  ).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Inventory' })).toBeTruthy();
  expect(screen.getByText('field_camera_a')).toBeTruthy();

  // The maintenance banner rides the topNotch slot.
  expect(screen.getByText(/inventory audit runs friday/i)).toBeTruthy();

  // The exit affordance returns to the components reference.
  expect(
    screen.getByRole('link', { name: /exit full screen/i }).getAttribute('href')
  ).toBe('/docs/components');
});

test('category sidebar filters the gear table', () => {
  renderWithProviders(<PageShellDemoPage />);

  fireEvent.click(screen.getByRole('button', { name: /^Audio/ }));

  expect(screen.getByText('podcast_mic_kit')).toBeTruthy();
  expect(screen.queryByText('field_camera_a')).toBeNull();
});

test('the PageShell sidebar opens expanded and collapses without persisting', () => {
  const { container } = renderWithProviders(<PageShellDemoPage />);

  const rail = () =>
    container.querySelector('#page-shell-sidebar') as HTMLElement;
  // Expanded by default: the showcase deliberately passes no
  // drawerStateKey, so every visit opens with the sidebar out.
  expect(rail().style.width).toContain('17.5rem'); // 280px open width

  fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));

  expect(rail().style.width).toContain('0rem');
  expect(window.localStorage.getItem('demo-page-shell-sidebar')).toBeNull();
});

test('the mini rail expands and collapses independently of the PageShell sidebar', () => {
  const { container } = renderWithProviders(<PageShellDemoPage />);

  // Mantine's AppShell publishes its geometry via a generated <style> tag
  // (InlineStyles), so the rail width is asserted from the emitted
  // --app-shell-navbar-width declaration rather than an element style.
  const navbarWidth = () => {
    const styleTag = Array.from(document.querySelectorAll('style')).find(tag =>
      tag.textContent?.includes('--app-shell-navbar-width')
    );
    return styleTag?.textContent ?? '';
  };
  const pageSidebar = () =>
    container.querySelector('#page-shell-sidebar') as HTMLElement;

  // Slim by default: labels stay mounted but hidden (aria-hidden, no
  // data-expanded) so collapse can animate them out symmetrically.
  expect(navbarWidth()).toContain('4.25rem'); // 68px
  expect(
    screen.getByText('Borrow requests').hasAttribute('data-expanded')
  ).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));

  expect(navbarWidth()).toContain('16.25rem'); // 260px
  expect(
    screen.getByText('Borrow requests').hasAttribute('data-expanded')
  ).toBe(true);
  // Expanding the rail leaves the page-level sidebar alone.
  expect(pageSidebar().style.width).toContain('17.5rem');

  // And collapsing the page-level sidebar leaves the rail expanded.
  fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
  expect(pageSidebar().style.width).toContain('0rem');
  expect(navbarWidth()).toContain('16.25rem');
  expect(
    screen.getByRole('button', { name: 'Collapse navigation' })
  ).toBeTruthy();
});

test('on mobile the demo rail opens expanded over an overlay that dismisses it', () => {
  setViewportWidth(390);
  const { container } = renderWithProviders(<PageShellDemoPage />);

  fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));

  // Mobile opens the labeled, expanded rail (260px = 16.25rem), never
  // Mantine's full-width mobile navbar default; the expand trigger itself
  // is desktop-only (visibleFrom sm), so labels come from the forced
  // expansion, not the trigger.
  const navbar = container.querySelector(
    '.mantine-AppShell-navbar'
  ) as HTMLElement;
  expect(navbar.style.width).toContain('16.25rem');
  expect(navbar.style.maxWidth).toContain('16.25rem');
  expect(
    screen.getByRole('button', { name: 'Inventory' }).textContent
  ).toContain('Inventory');

  fireEvent.click(screen.getByTestId('rail-overlay'));
  expect(screen.queryByTestId('rail-overlay')).toBeNull();
});

test('the clamp-scroll switch flips the content area into its inner-scroll mode', () => {
  const { container } = renderWithProviders(<PageShellDemoPage />);

  expect(screen.queryByTestId('clamped-scroll-frame')).toBeNull();

  fireEvent.click(screen.getByRole('switch', { name: 'Clamp scroll' }));

  const content = container.querySelector('#page-shell-content') as HTMLElement;
  expect(content.style.overflow).toBe('hidden');
  expect(screen.getByTestId('clamped-scroll-frame')).toBeTruthy();
});
