import { forwardRef, useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  renderWithProviders,
  setViewportWidth,
} from '@ui/storybook/test-utils';
import { PageShell } from '../page-shell/PageShell';
import { Rail } from './Rail';
import { RailEntry } from './RailEntry';
import { RailShell } from './RailShell';
import { useRailState } from './useRailState';

const DESKTOP_WIDTH = window.innerWidth;

afterEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

const navbar = (container: HTMLElement) =>
  container.querySelector('.mantine-AppShell-navbar') as HTMLElement;
const header = (container: HTMLElement) =>
  container.querySelector('.mantine-AppShell-header') as HTMLElement;

/** The shell alone, rail permanently slim -- isolates the width caps and
 * the z-index dance from the expand-then-open rule `useRailState` adds. */
function ShellHarness({
  railWidth,
  railWidthExpanded,
}: {
  railWidth?: number;
  railWidthExpanded?: number;
}) {
  const [railOpened, setRailOpened] = useState(false);

  return (
    <RailShell
      headerHeight={64}
      header={<span>Header content</span>}
      rail={<nav aria-label="Rail content" />}
      railExpanded={false}
      railOpened={railOpened}
      onToggleRail={() => setRailOpened(opened => !opened)}
      onCloseRail={() => setRailOpened(false)}
      railWidth={railWidth}
      railWidthExpanded={railWidthExpanded}
    >
      <div>page body</div>
    </RailShell>
  );
}

test('mobile toggle opens the rail at its slim width above a click-to-close overlay', () => {
  setViewportWidth(390);
  const { container } = renderWithProviders(<ShellHarness />);

  // Closed: no overlay, normal chrome stacking.
  expect(screen.queryByTestId('rail-overlay')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));

  // The navbar keeps the slim rail width (68px = 4.25rem) instead of
  // Mantine's full-width mobile navbar default.
  expect(navbar(container).style.width).toContain('4.25rem');
  expect(navbar(container).style.maxWidth).toContain('4.25rem');

  // The z-index dance: navbar and header ride above the 999 overlay.
  expect(navbar(container).getAttribute('style')).toContain(
    '--app-shell-navbar-z-index: calc(1000 + 1)'
  );
  expect(header(container).getAttribute('style')).toContain('1000');
  // Overlay publishes its z-index through Mantine's CSS variable.
  const overlay = screen.getByTestId('rail-overlay');
  expect(overlay.getAttribute('style')).toContain('--overlay-z-index: 999');

  // Tapping the overlay closes the rail again.
  fireEvent.click(overlay);
  expect(screen.queryByTestId('rail-overlay')).toBeNull();
  expect(navbar(container).getAttribute('style')).not.toContain(
    '--app-shell-navbar-z-index: calc(1000 + 1)'
  );
});

test('the header toggle also closes an open mobile rail', () => {
  setViewportWidth(390);
  renderWithProviders(<ShellHarness />);

  const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
  fireEvent.click(toggle);
  expect(screen.getByTestId('rail-overlay')).toBeTruthy();

  fireEvent.click(toggle);
  expect(screen.queryByTestId('rail-overlay')).toBeNull();
});

test('desktop renders neither the mobile toggle nor the overlay', () => {
  const { container } = renderWithProviders(<ShellHarness />);

  expect(
    screen.queryByRole('button', { name: 'Toggle navigation' })
  ).toBeNull();
  expect(screen.queryByTestId('rail-overlay')).toBeNull();
  // The slim width caps are unconditional -- they are what keeps the
  // mobile stylesheet's 100% width from ever applying.
  expect(navbar(container).style.width).toContain('4.25rem');
});

test('railWidth overrides replace the default 68px geometry', () => {
  const { container } = renderWithProviders(
    <ShellHarness railWidth={80} railWidthExpanded={300} />
  );

  expect(navbar(container).style.width).toContain('5rem');
  expect(navbar(container).style.maxWidth).toContain('5rem');
});

/** The full composition the site chrome ships: Rail + RailEntry wired by
 * useRailState. */
function ComposedHarness() {
  const rail = useRailState();

  return (
    <RailShell
      headerHeight={64}
      header={<span>Header content</span>}
      rail={
        <Rail
          label="Sections"
          expanded={rail.effectiveExpanded}
          onToggleExpanded={rail.toggleExpanded}
          pinBottom={
            <RailEntry
              icon="moon"
              label="Scheme"
              expanded={rail.effectiveExpanded}
              onClick={() => {}}
            />
          }
        >
          <RailEntry
            icon="package"
            label="Inventory"
            expanded={rail.effectiveExpanded}
            active
          />
          <RailEntry
            icon="settings"
            label="Settings"
            expanded={rail.effectiveExpanded}
            disabled
          />
        </Rail>
      }
      railExpanded={rail.effectiveExpanded}
      railOpened={rail.opened}
      onToggleRail={rail.toggleOpened}
      onCloseRail={rail.close}
    >
      <div>page body</div>
    </RailShell>
  );
}

test('the rail expands into labels from its trigger and collapses them symmetrically', () => {
  renderWithProviders(<ComposedHarness />);

  // Slim rail: labels stay mounted (so collapse can animate them out
  // symmetrically) but are hidden: aria-hidden, no data-expanded.
  const label = () => screen.getByText('Inventory');
  expect(label().getAttribute('aria-hidden')).toBe('true');
  expect(label().hasAttribute('data-expanded')).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Expand navigation' }));

  for (const text of ['Inventory', 'Settings', 'Scheme']) {
    const el = screen.getByText(text);
    expect(el.hasAttribute('data-expanded')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('false');
  }
  expect(
    screen.getByRole('button', { name: 'Collapse navigation' })
  ).toBeTruthy();

  // Collapse: the same labels transition back to hidden, never unmounting.
  fireEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
  expect(label().hasAttribute('data-expanded')).toBe(false);
  expect(label().getAttribute('aria-hidden')).toBe('true');
});

test('entries keep the fixed icon column and the transitioned label classes', () => {
  renderWithProviders(<ComposedHarness />);

  const entry = screen.getByRole('button', { name: 'Inventory' });
  // The fixed 9px icon column (railEntryRow) is what keeps icons pinned
  // while the shell animates the width; the label carries the symmetric
  // opacity/offset transition (railLabel).
  expect(entry.querySelector('[class*="railEntryRow"]')).toBeTruthy();
  expect(screen.getByText('Inventory').className).toContain('railLabel');
});

test('on mobile the rail opens expanded (useRailState expand-then-open)', () => {
  setViewportWidth(390);
  const { container } = renderWithProviders(<ComposedHarness />);

  fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }));

  // The labeled, expanded rail (260px = 16.25rem) floats over the page --
  // never Mantine's full-width mobile navbar default, and never the bare
  // icon strip (the expand trigger itself is desktop-only).
  expect(navbar(container).style.width).toContain('16.25rem');
  expect(navbar(container).style.maxWidth).toContain('16.25rem');
  expect(screen.getByText('Inventory').hasAttribute('data-expanded')).toBe(
    true
  );

  // Dismissing restores the slim, unexpanded state (the desktop expand
  // toggle was never touched).
  fireEvent.click(screen.getByTestId('rail-overlay'));
  expect(screen.queryByTestId('rail-overlay')).toBeNull();
  expect(navbar(container).style.width).toContain('4.25rem');
  expect(screen.getByText('Inventory').hasAttribute('data-expanded')).toBe(
    false
  );
});

test('pinBottom stretches the rail full-height and renders after a spacer', () => {
  renderWithProviders(
    <Rail
      label="Pinned"
      expanded={false}
      onToggleExpanded={() => {}}
      pinBottom={
        <RailEntry
          icon="moon"
          label="Scheme"
          expanded={false}
          onClick={() => {}}
        />
      }
    >
      <RailEntry icon="package" label="Inventory" expanded={false} />
    </Rail>
  );

  const nav = screen.getByRole('navigation', { name: 'Pinned' });
  expect(nav.style.minHeight).toBe('100dvh');
  // The pinned entry is the nav's last element (the flex spacer between
  // pushes it to the rail's bottom).
  const buttons = nav.querySelectorAll('button');
  expect(buttons[buttons.length - 1].getAttribute('aria-label')).toBe('Scheme');
});

test('without pinBottom the rail does not assume the full-height navbar', () => {
  renderWithProviders(
    <Rail label="Plain" expanded={false} onToggleExpanded={() => {}}>
      <RailEntry icon="package" label="Inventory" expanded={false} />
    </Rail>
  );

  expect(
    screen.getByRole('navigation', { name: 'Plain' }).style.minHeight
  ).toBe('');
});

test('a disabled entry is aria-disabled and suppresses its onClick', () => {
  const onClick = vi.fn();
  renderWithProviders(
    <Rail label="Sections" expanded={false} onToggleExpanded={() => {}}>
      <RailEntry
        icon="settings"
        label="Settings"
        expanded={false}
        disabled
        onClick={onClick}
      />
    </Rail>
  );

  const entry = screen.getByRole('button', { name: 'Settings' });
  expect(entry.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(entry);
  expect(onClick).not.toHaveBeenCalled();
});

test('entries link via the polymorphic component prop, carrying aria-current', () => {
  const FakeLink = forwardRef<
    HTMLAnchorElement,
    React.ComponentPropsWithoutRef<'a'>
  >(function FakeLink(props, ref) {
    return <a ref={ref} {...props} />;
  });

  renderWithProviders(
    <Rail label="Sections" expanded={false} onToggleExpanded={() => {}}>
      <RailEntry
        icon="bookOpen"
        label="Docs"
        expanded={false}
        active
        component={FakeLink}
        href="/docs"
      />
    </Rail>
  );

  const link = screen.getByRole('link', { name: 'Docs' });
  expect(link.getAttribute('href')).toBe('/docs');
  expect(link.getAttribute('aria-current')).toBe('page');
});

test('a hosted PageShell defaults its topOffset to the rail header height', () => {
  // The double-nav case: the rail's header is fixed, so the page below it
  // has to clear exactly that height. Before the shell published it, the two
  // were kept in sync by hand and nothing caught a drift.
  const { container } = renderWithProviders(
    <RailShell
      headerHeight={72}
      header={<span>Header content</span>}
      rail={<nav aria-label="Rail content" />}
      railExpanded={false}
      railOpened={false}
      onToggleRail={() => {}}
      onCloseRail={() => {}}
    >
      <PageShell>
        <PageShell.Main>
          <PageShell.Content>
            <div>page body</div>
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </RailShell>
  );

  const root = container.querySelector('#page-shell-root') as HTMLElement;
  expect(root.style.paddingTop).toBe('72px');
});

test('an explicit PageShell topOffset still wins inside a RailShell', () => {
  const { container } = renderWithProviders(
    <RailShell
      headerHeight={72}
      header={<span>Header content</span>}
      rail={<nav aria-label="Rail content" />}
      railExpanded={false}
      railOpened={false}
      onToggleRail={() => {}}
      onCloseRail={() => {}}
    >
      <PageShell topOffset={10}>
        <PageShell.Main>
          <PageShell.Content>
            <div>page body</div>
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    </RailShell>
  );

  const root = container.querySelector('#page-shell-root') as HTMLElement;
  expect(root.style.paddingTop).toBe('10px');
});
