import { useLayoutEffect, useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  MAX_CONTENT_WIDTH,
  PageShell,
  usePageShellContext,
} from '@mattstack/app-kit/core';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { TabBar } from './components/TabBar';

afterEach(() => {
  window.localStorage.clear();
});

// jsdom never measures a viewport (useViewportSize reports width 0), so
// every test here runs the desktop branch: the sidebar is the inline
// slide-away rail, not the mobile overlay drawer.

function CompoundShell({ drawerStateKey }: { drawerStateKey?: string }) {
  return (
    <PageShell drawerStateKey={drawerStateKey} sidebarWidth={240}>
      <PageShell.Sidebar>
        <div>sidebar nav</div>
      </PageShell.Sidebar>
      <PageShell.Main>
        <PageShell.Header title="Gear library" actions={<button>Add</button>} />
        <PageShell.Content>
          <div>content body</div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}

test('compound PageShell renders sidebar, header title/actions, and content', () => {
  renderWithProviders(<CompoundShell />);

  expect(screen.getByText('sidebar nav')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Gear library' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  expect(screen.getByText('content body')).toBeTruthy();
});

test('a registered Sidebar narrows Main by the sidebar width', () => {
  const { container } = renderWithProviders(<CompoundShell />);

  const main = container.querySelector('#page-shell-main') as HTMLElement;
  expect(main.style.width).toContain('calc(100% - ');
  expect(main.style.width).toContain('15rem'); // 240px, rem-scaled
});

test('Main spans the full width when no Sidebar is mounted', () => {
  const { container } = renderWithProviders(
    <PageShell>
      <PageShell.Main>
        <PageShell.Content>
          <div>content body</div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  const main = container.querySelector('#page-shell-main') as HTMLElement;
  expect(main.style.width).toBe('100%');
});

test('the collapse trigger toggles the sidebar rail closed and open', () => {
  const { container } = renderWithProviders(<CompoundShell />);

  const rail = () =>
    container.querySelector('#page-shell-sidebar') as HTMLElement;
  expect(rail().style.width).toContain('15rem');

  fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
  expect(rail().style.width).toContain('0rem');
  // Collapsing hides the content without unmounting it.
  expect(screen.getByText('sidebar nav')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
  expect(rail().style.width).toContain('15rem');
});

test('drawerStateKey persists the sidebar state and restores it on mount', () => {
  const { unmount } = renderWithProviders(
    <CompoundShell drawerStateKey="test-shell-sidebar" />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
  expect(
    JSON.parse(window.localStorage.getItem('test-shell-sidebar') ?? 'null')
  ).toBe(false);
  unmount();

  // A fresh mount reads the persisted collapsed state synchronously (the
  // kit's anti-flicker useLocalStorage shadow), so the rail starts closed.
  const { container } = renderWithProviders(
    <CompoundShell drawerStateKey="test-shell-sidebar" />
  );
  const rail = container.querySelector('#page-shell-sidebar') as HTMLElement;
  expect(rail.style.width).toContain('0rem');
});

test('Content passes the computed height to a render-prop child', () => {
  renderWithProviders(
    <PageShell topOffset={32}>
      <PageShell.Main>
        <PageShell.Header title="Gear library" />
        <PageShell.Content>
          {height => <div>height:{height}</div>}
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  // 100vh minus the 32px top offset minus the 64px default header, all
  // rem-scaled by Mantine.
  const readout = screen.getByText(/^height:/).textContent!;
  expect(readout).toContain('calc(100vh');
  expect(readout).toContain('2rem');
  expect(readout).toContain('4rem');
});

test('heightMode="auto" opts out of height clamping', () => {
  renderWithProviders(
    <PageShell heightMode="auto">
      <PageShell.Main>
        <PageShell.Content>
          {height => <div>height:{height}</div>}
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  expect(screen.getByText('height:auto')).toBeTruthy();
});

test('scrollClamp renders a fixed-height overflow-hidden content frame', () => {
  const { container } = renderWithProviders(
    <PageShell scrollClamp>
      <PageShell.Main>
        <PageShell.Content>
          <div>clamped body</div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  const content = container.querySelector('#page-shell-content') as HTMLElement;
  expect(content.style.overflow).toBe('hidden');
  expect(content.style.height).toContain('calc(100vh');
  // The scroll-mode frame is a ScrollArea; the clamp mode must not be.
  expect(content.classList.toString()).not.toContain('ScrollArea');
});

test('Content defaults to a ContentContainer in scroll mode and none under scrollClamp', () => {
  const renderContent = (
    shellProps?: { scrollClamp: boolean },
    contentProps?: { contentContainer: boolean }
  ) =>
    renderWithProviders(
      <PageShell {...shellProps}>
        <PageShell.Main>
          <PageShell.Content {...contentProps}>
            <div>body</div>
          </PageShell.Content>
        </PageShell.Main>
      </PageShell>
    ).container.querySelector('.mantine-Container-root');

  // ContentContainer is `Container.withProps`, so the Container root class
  // plus its MAX_CONTENT_WIDTH cap is what marks the wrapper as present.
  // Mantine emits the cap in rem, scaled: `calc(80rem * var(--mantine-scale))`.
  const byDefault = renderContent();
  expect(byDefault).toBeTruthy();
  expect(byDefault!.getAttribute('style')).toContain(
    `${MAX_CONTENT_WIDTH / 16}rem`
  );

  // Clamp mode hands the frame to the caller, so no column unless asked.
  expect(renderContent({ scrollClamp: true })).toBeNull();

  // An explicit prop wins in both directions.
  expect(renderContent(undefined, { contentContainer: false })).toBeNull();
  expect(
    renderContent({ scrollClamp: true }, { contentContainer: true })
  ).toBeTruthy();
});

test('sub-components throw actionable errors outside their required parents', () => {
  // React logs the thrown error before the boundaryless render rethrows
  // it; silence the noise without hiding real failures elsewhere.
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    expect(() =>
      renderWithProviders(
        <PageShell.Sidebar>
          <div>stray</div>
        </PageShell.Sidebar>
      )
    ).toThrow(
      '<PageShell.Sidebar /> should only be used as a child of <PageShell />'
    );

    expect(() =>
      renderWithProviders(
        <PageShell>
          <PageShell.Content>
            <div>stray</div>
          </PageShell.Content>
        </PageShell>
      )
    ).toThrow(
      '<PageShell.Content /> should only be used as a child of <PageShell.Main />'
    );
  } finally {
    consoleError.mockRestore();
  }
});

test('tabs render a tab bar above the body with active state, and clicks fire', () => {
  const onClick = vi.fn();
  renderWithProviders(
    <PageShell
      title="Gear library"
      tabs={[
        { id: 'inventory', label: 'Inventory', active: true },
        { id: 'activity', label: 'Activity', onClick },
      ]}
    >
      <div>content body</div>
    </PageShell>
  );

  const tabList = screen.getByRole('tablist', { name: 'Page tabs' });
  expect(tabList.id).toBe('page-shell-tab-bar');

  const inventory = screen.getByRole('tab', { name: 'Inventory' });
  const activity = screen.getByRole('tab', { name: 'Activity' });
  expect(inventory.getAttribute('aria-selected')).toBe('true');
  expect(inventory.getAttribute('data-active')).toBe('true');
  expect(activity.getAttribute('aria-selected')).toBe('false');
  expect(activity.getAttribute('data-active')).toBeNull();

  fireEvent.click(activity);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('no tabs prop means no tab bar', () => {
  renderWithProviders(
    <PageShell title="Gear library">
      <div>content body</div>
    </PageShell>
  );

  expect(screen.queryByRole('tablist')).toBeNull();
});

test('a tab bar subtracts its height from the content height math', () => {
  renderWithProviders(
    <PageShell
      topOffset={32}
      tabs={[{ id: 'inventory', label: 'Inventory', active: true }]}
    >
      <PageShell.Main>
        <PageShell.Header title="Gear library" />
        <PageShell.Content>
          {height => <div>height:{height}</div>}
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  // 100vh minus the 32px top offset, the 64px header, and the 46px default
  // tab bar (2.875rem), all rem-scaled by Mantine.
  const readout = screen.getByText(/^height:/).textContent!;
  expect(readout).toContain('calc(100vh');
  expect(readout).toContain('2rem');
  expect(readout).toContain('4rem');
  expect(readout).toContain('2.875rem');
});

test('a tab bar subtracts its custom height from the sidebar height math', () => {
  const { container } = renderWithProviders(
    <PageShell
      tabs={[{ id: 'inventory', label: 'Inventory', active: true }]}
      tabBarHeight={64}
    >
      <PageShell.Sidebar>
        <div>sidebar nav</div>
      </PageShell.Sidebar>
      <PageShell.Main>
        <PageShell.Content>
          <div>content body</div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  // The computed sidebar height lands on the scroll frame's max-height.
  const scrollFrame = container.querySelector(
    '#page-shell-sidebar-scrollarea'
  ) as HTMLElement;
  expect(scrollFrame.style.maxHeight).toContain('calc(100vh');
  expect(scrollFrame.style.maxHeight).toContain('4rem'); // the 64px tabBarHeight
});

test('a tab carrying component/href renders as a link', () => {
  renderWithProviders(
    <PageShell
      tabs={[
        { id: 'inventory', label: 'Inventory', active: true },
        {
          id: 'activity',
          label: 'Activity',
          component: 'a',
          href: '/activity',
        },
      ]}
    >
      <div>content body</div>
    </PageShell>
  );

  const activity = screen.getByRole('tab', { name: 'Activity' });
  expect(activity.tagName).toBe('A');
  expect(activity.getAttribute('href')).toBe('/activity');
});

test('fragment-wrapped compound children still opt into compound mode', () => {
  // A composition helper returning `<><Sidebar/><Main/></>` must behave
  // exactly like listing the statics inline: before fragment flattening,
  // this silently fell into simple mode and auto-wrapped the fragment
  // (sidebar and all) inside the content column.
  const { container } = renderWithProviders(
    <PageShell sidebarWidth={240}>
      <>
        <PageShell.Sidebar>
          <div>sidebar nav</div>
        </PageShell.Sidebar>
        <PageShell.Main>
          <PageShell.Content>
            <div>content body</div>
          </PageShell.Content>
        </PageShell.Main>
      </>
    </PageShell>
  );

  // Compound mode: the sidebar renders as the inline rail, not inside the
  // content area, and Main narrows for it.
  expect(container.querySelector('#page-shell-sidebar')).toBeTruthy();
  const main = container.querySelector('#page-shell-main') as HTMLElement;
  expect(main.style.width).toContain('calc(100% - ');
  const content = container.querySelector('#page-shell-content') as HTMLElement;
  expect(content.contains(screen.getByText('sidebar nav'))).toBe(false);
});

test('sideBarHeaderBg overrides the shared sidebar/header surface', () => {
  const { container } = renderWithProviders(
    <PageShell sideBarHeaderBg="var(--mantine-color-teal-1)" sidebarWidth={240}>
      <PageShell.Sidebar>
        <div>sidebar nav</div>
      </PageShell.Sidebar>
      <PageShell.Main>
        <PageShell.Header title="Gear library" />
        <PageShell.Content>
          <div>content body</div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  const sidebar = container.querySelector('#page-shell-sidebar') as HTMLElement;
  const header = container.querySelector('#page-shell-header') as HTMLElement;
  expect(sidebar.style.background).toContain('teal');
  expect(header.style.background).toContain('teal');
});

test('sideBarHeaderBg defaults to bg.level2 when not passed', () => {
  const { container } = renderWithProviders(
    <PageShell sidebarWidth={240}>
      <PageShell.Sidebar>
        <div>sidebar nav</div>
      </PageShell.Sidebar>
      <PageShell.Main>
        <PageShell.Header title="Gear library" />
        <PageShell.Content>
          <div>content body</div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  const sidebar = container.querySelector('#page-shell-sidebar') as HTMLElement;
  expect(sidebar.style.background).toContain('--ui-bg-2');
});

function CustomTabBar() {
  const { setHasTabBar } = usePageShellContext();

  useLayoutEffect(() => {
    setHasTabBar(true);
    return () => setHasTabBar(false);
  }, [setHasTabBar]);

  return <div>custom tab row</div>;
}

test('a custom tab row can register presence via setHasTabBar', () => {
  // No `tabs` prop -- the built-in TabBar never mounts -- but a consumer's
  // own tab row still subtracts tabBarHeight from the content height math
  // by calling setHasTabBar itself, the same registration path the
  // built-in TabBar uses.
  renderWithProviders(
    <PageShell tabBarHeight={64}>
      <>
        <CustomTabBar />
        <PageShell.Main>
          <PageShell.Content>
            {height => <div>height:{height}</div>}
          </PageShell.Content>
        </PageShell.Main>
      </>
    </PageShell>
  );

  expect(screen.getByText('custom tab row')).toBeTruthy();
  const readout = screen.getByText(/^height:/).textContent!;
  expect(readout).toContain('calc(100vh');
  expect(readout).toContain('4rem'); // the 64px tabBarHeight, registered by the custom row
});

test('unmounting a custom tab row un-registers it from the height math', () => {
  function Toggle() {
    const [show, setShow] = useState(true);
    return (
      <PageShell tabBarHeight={64}>
        <>
          {show && <CustomTabBar />}
          <PageShell.Main>
            <PageShell.Content>
              {height => (
                <div>
                  height:{height}
                  <button onClick={() => setShow(false)}>hide</button>
                </div>
              )}
            </PageShell.Content>
          </PageShell.Main>
        </>
      </PageShell>
    );
  }

  renderWithProviders(<Toggle />);

  expect(screen.getByText(/^height:/).textContent).toContain('4rem');

  fireEvent.click(screen.getByRole('button', { name: 'hide' }));

  expect(screen.getByText(/^height:/).textContent).not.toContain('4rem');
});

test('TabBar renders iconRight and labelComponent', () => {
  renderWithProviders(
    <PageShell>
      <PageShell.Main>
        <PageShell.Content>
          <TabBar
            tabs={[
              {
                id: 'inventory',
                label: 'Inventory',
                active: true,
                iconRight: 'chevronRight',
              },
              {
                id: 'activity',
                label: 'Activity',
                labelComponent: <span>Custom activity label</span>,
                onClick: () => {},
              },
            ]}
          />
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  const inventory = screen.getByRole('tab', { name: 'Inventory' });
  expect(inventory.querySelector('svg')).toBeTruthy();
  expect(screen.getByText('Custom activity label')).toBeTruthy();
  expect(screen.queryByText('Activity')).toBeNull();
});

test('TabBar threads color/radius to the underlying Mantine Tabs', () => {
  const { container } = renderWithProviders(
    <PageShell>
      <PageShell.Main>
        <PageShell.Content>
          <TabBar
            color="grape"
            radius="md"
            tabs={[{ id: 'inventory', label: 'Inventory', active: true }]}
          />
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  const tabsRoot = container.querySelector('#page-shell-tab-bar')
    ?.parentElement as HTMLElement;
  expect(tabsRoot.style.getPropertyValue('--tabs-radius')).toContain(
    'var(--mantine-radius-md)'
  );
});

test('TabBar title leads the tablist as the page heading and actions trail it, neither inside the tablist', () => {
  renderWithProviders(
    <PageShell>
      <PageShell.Main>
        <PageShell.TabBar
          title="Wiring"
          tabs={[{ id: 'pipeline', label: 'Pipeline', active: true }]}
          actions={<button>Open pack</button>}
        />
        <PageShell.Content>
          <div>content body</div>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );

  const tabList = screen.getByRole('tablist', { name: 'Page tabs' });
  const heading = screen.getByRole('heading', { level: 2, name: 'Wiring' });
  const action = screen.getByRole('button', { name: 'Open pack' });

  expect(tabList.contains(heading)).toBe(false);
  expect(tabList.contains(action)).toBe(false);
  expect(
    heading.compareDocumentPosition(tabList) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
  expect(
    tabList.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

test('a TabBar with neither title nor actions renders no heading', () => {
  renderWithProviders(
    <PageShell tabs={[{ id: 'inventory', label: 'Inventory', active: true }]}>
      <div>content body</div>
    </PageShell>
  );

  expect(screen.getByRole('tablist', { name: 'Page tabs' })).toBeTruthy();
  expect(screen.queryByRole('heading')).toBeNull();
});

test('PageShell.TabBar is the same component the root renders for its tabs prop', () => {
  expect(PageShell.TabBar).toBe(TabBar);
});
