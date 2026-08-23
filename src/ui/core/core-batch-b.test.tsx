import { fireEvent, screen } from '@testing-library/react';

import {
  AnimatedBorderBox,
  ContentContainer,
  GradientBorder,
  Notch,
  PageShell,
  SiteShell,
  SlideInSidebar,
} from '@ui/core';
import { renderWithProviders } from '@ui/storybook/test-utils';

// --- PageShell -------------------------------------------------------------

test('PageShell renders its title, actions, and children', () => {
  renderWithProviders(
    <PageShell title="Dashboard" actions={<button type="button">New</button>}>
      <div>page body</div>
    </PageShell>
  );

  expect(screen.getByText('Dashboard')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'New' })).toBeTruthy();
  expect(screen.getByText('page body')).toBeTruthy();
});

test('PageShell applies topOffset as a top padding style', () => {
  renderWithProviders(
    <PageShell title="Dashboard" topOffset={64} data-testid="page-shell-root">
      <div>body</div>
    </PageShell>
  );

  expect(screen.getByTestId('page-shell-root').style.paddingTop).toBe('64px');
});

test('PageShell defaults topOffset to 0', () => {
  renderWithProviders(
    <PageShell data-testid="page-shell-root">
      <div>body</div>
    </PageShell>
  );

  expect(screen.getByTestId('page-shell-root').style.paddingTop).toBe('0px');
});

test('PageShell renders without a header row when neither title nor actions are given', () => {
  renderWithProviders(
    <PageShell>
      <div>just body</div>
    </PageShell>
  );

  expect(screen.getByText('just body')).toBeTruthy();
});

// The topNotch slot's collapse wrapper, walked up from the banner content:
// content -> centering Group -> the Transition's measured div -> wrapper Box.
function topNotchWrapper(content: HTMLElement) {
  return content.parentElement!.parentElement!.parentElement as HTMLElement;
}

test('PageShell renders topNotch content inside the content area when opened', () => {
  renderWithProviders(
    <PageShell
      title="Dashboard"
      topNotch={{ content: <div>banner</div>, opened: true }}
    >
      <div>body</div>
    </PageShell>
  );

  expect(screen.getByText('banner')).toBeTruthy();
});

test('PageShell keeps a closed topNotch mounted but collapses its wrapper to zero height', () => {
  renderWithProviders(
    <PageShell topNotch={{ content: <div>banner</div>, opened: false }}>
      <div>body</div>
    </PageShell>
  );

  // keepMounted: the banner stays in the DOM so the slide transition can
  // play; only the wrapper's animated height removes it from layout.
  const banner = screen.getByText('banner');
  expect(topNotchWrapper(banner).style.height).toBe('0px');
});

test('PageShell opens the topNotch wrapper to the measured banner height', () => {
  // jsdom does no layout, so Mantine's useElementSize would measure 0.
  // Substitute a ResizeObserver that reports a fixed 42px border box, and
  // make requestAnimationFrame synchronous so the measurement lands inside
  // the render act() (Mantine defers the observer callback through rAF).
  const realRaf = window.requestAnimationFrame;
  const realCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  };
  window.cancelAnimationFrame = () => {};
  class FixedSizeResizeObserver {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe() {
      this.cb(
        [
          {
            borderBoxSize: [{ blockSize: 42, inlineSize: 320 }],
            contentRect: {
              x: 0,
              y: 0,
              top: 0,
              left: 0,
              bottom: 42,
              right: 320,
              width: 320,
              height: 42,
            },
          } as unknown as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  }
  const realResizeObserver = window.ResizeObserver;
  window.ResizeObserver =
    FixedSizeResizeObserver as unknown as typeof ResizeObserver;

  try {
    renderWithProviders(
      <PageShell topNotch={{ content: <div>banner</div>, opened: true }}>
        <div>body</div>
      </PageShell>
    );

    const banner = screen.getByText('banner');
    expect(topNotchWrapper(banner).style.height).toBe('42px');
  } finally {
    window.ResizeObserver = realResizeObserver;
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCaf;
  }
});

// --- SiteShell ---------------------------------------------------------------

test('SiteShell renders its header inside a header landmark and its children in main', () => {
  renderWithProviders(
    <SiteShell header={<div>site header</div>}>
      <div>site body</div>
    </SiteShell>
  );

  const header = screen.getByRole('banner');
  expect(header.textContent).toContain('site header');
  expect(header.style.borderBottom).toContain(
    'var(--mantine-color-default-border)'
  );
  const main = screen.getByRole('main');
  expect(main.textContent).toContain('site body');
});

test('SiteShell lets headerProps styles win over the kit header defaults', () => {
  renderWithProviders(
    <SiteShell
      header={<div>site header</div>}
      headerProps={{ style: { backgroundColor: 'rgb(1, 2, 3)' } }}
    >
      <div>site body</div>
    </SiteShell>
  );

  expect(screen.getByRole('banner').style.backgroundColor).toBe('rgb(1, 2, 3)');
});

test('SiteShell renders no navbar element when the navbar prop is omitted', () => {
  const { container } = renderWithProviders(
    <SiteShell header={<div>site header</div>}>
      <div>site body</div>
    </SiteShell>
  );

  expect(container.querySelector('.mantine-AppShell-navbar')).toBeNull();
});

test('SiteShell renders the navbar slot as a hairlined sidebar with scrollable content', () => {
  const { container } = renderWithProviders(
    <SiteShell header={<div>site header</div>} navbar={<div>nav content</div>}>
      <div>site body</div>
    </SiteShell>
  );

  const navbar = container.querySelector(
    '.mantine-AppShell-navbar'
  ) as HTMLElement;
  expect(navbar).not.toBeNull();
  expect(navbar.textContent).toContain('nav content');
  expect(navbar.style.borderRight).toContain(
    'var(--mantine-color-default-border)'
  );
  // The content sits in a growing AppShell.Section rendered as a ScrollArea.
  expect(navbar.querySelector('.mantine-ScrollArea-root')).not.toBeNull();
});

test('SiteShell lets navbarProps styles win over the kit navbar defaults', () => {
  const { container } = renderWithProviders(
    <SiteShell
      header={<div>site header</div>}
      navbar={<div>nav content</div>}
      navbarProps={{ style: { backgroundColor: 'rgb(4, 5, 6)' } }}
    >
      <div>site body</div>
    </SiteShell>
  );

  const navbar = container.querySelector(
    '.mantine-AppShell-navbar'
  ) as HTMLElement;
  expect(navbar.style.backgroundColor).toBe('rgb(4, 5, 6)');
});

// --- ContentContainer --------------------------------------------------------

test('ContentContainer renders its children', () => {
  renderWithProviders(<ContentContainer>content here</ContentContainer>);
  expect(screen.getByText('content here')).toBeTruthy();
});

test('ContentContainer applies a max-width constraint', () => {
  renderWithProviders(
    <ContentContainer data-testid="content-container">
      content here
    </ContentContainer>
  );
  const el = screen.getByTestId('content-container');
  expect(el.style.maxWidth).toBeTruthy();
});

test('ContentContainer paints no background of its own', () => {
  // A transparent width-capping column: content sits on the hosting
  // surface (e.g. PageShell.Content's level3 canvas), never on a
  // container-painted layer.
  renderWithProviders(
    <ContentContainer data-testid="content-container">
      content here
    </ContentContainer>
  );
  const el = screen.getByTestId('content-container');
  expect(el.style.backgroundColor).toBe('');
});

// --- SlideInSidebar ----------------------------------------------------------

test('SlideInSidebar keeps its content mounted while closed, faded and pointer-inert', () => {
  renderWithProviders(
    <SlideInSidebar opened={false} width={240} data-testid="inline-rail">
      <div>rail content</div>
    </SlideInSidebar>
  );

  // Unlike an overlay Drawer, collapsing only animates the rail to width
  // 0 -- the content stays in the DOM (hidden via opacity/pointer-events on
  // its wrapper) so reopening is instant.
  const content = screen.getByText('rail content');
  const rail = screen.getByTestId('inline-rail');
  expect(rail.style.width).toContain('0rem');
  const contentWrapper = content.parentElement as HTMLElement;
  expect(contentWrapper.style.pointerEvents).toBe('none');
  expect(contentWrapper.style.opacity).toBe('0');
});

test('SlideInSidebar opens to its configured width and renders its trigger', () => {
  renderWithProviders(
    <SlideInSidebar
      opened
      width={240}
      data-testid="inline-rail"
      trigger={<button type="button">collapse</button>}
    >
      <div>rail content</div>
    </SlideInSidebar>
  );

  const rail = screen.getByTestId('inline-rail');
  expect(rail.style.width).toContain('15rem'); // 240px, rem-scaled by Mantine
  expect(rail.style.borderRightWidth).toBe('1px');
  expect(screen.getByRole('button', { name: 'collapse' })).toBeTruthy();
});

test('SlideInSidebar draws no hairline when border is false', () => {
  renderWithProviders(
    <SlideInSidebar opened width={240} border={false} data-testid="inline-rail">
      <div>rail content</div>
    </SlideInSidebar>
  );

  const rail = screen.getByTestId('inline-rail');
  expect(rail.style.borderRightWidth).toBeFalsy();
  expect(rail.style.borderRight).not.toContain('1px solid');
});

// --- Notch -------------------------------------------------------------------

test('Notch renders its content without error', () => {
  renderWithProviders(<Notch onClose={() => {}}>hello</Notch>);
  expect(screen.getByText('hello')).toBeTruthy();
});

test('Notch tints its background using the accent color token', () => {
  renderWithProviders(
    <Notch onClose={() => {}} data-testid="notch">
      hello
    </Notch>
  );
  expect(screen.getByTestId('notch').style.background).toContain(
    '--mantine-color-indigo-light'
  );
});

test('Notch owns its docked look: squared top corners and no top border', () => {
  renderWithProviders(
    <Notch onClose={() => {}} data-testid="notch">
      hello
    </Notch>
  );
  const notch = screen.getByTestId('notch');
  expect(notch.style.borderTopLeftRadius).toBe('0px');
  expect(notch.style.borderTopRightRadius).toBe('0px');
  expect(notch.style.borderTopStyle).toBe('none');
});

test('Notch sizes itself relative to the content column (1.25x its max width)', () => {
  renderWithProviders(
    <Notch onClose={() => {}} data-testid="notch">
      hello
    </Notch>
  );
  // 1280 (ContentContainer's MAX_CONTENT_WIDTH) * 1.25 = 1600px, which
  // Mantine's style-prop resolver emits as a scaled rem value (1600/16).
  expect(screen.getByTestId('notch').style.maxWidth).toContain('100rem');
});

test('Notch calls onClose when its close button is clicked', () => {
  const onClose = vi.fn();
  renderWithProviders(<Notch onClose={onClose}>hello</Notch>);

  fireEvent.click(screen.getByRole('button', { name: /close/i }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('Notch hides its close button when withCloseButton is false', () => {
  renderWithProviders(
    <Notch onClose={() => {}} withCloseButton={false}>
      hello
    </Notch>
  );
  expect(screen.queryByRole('button')).toBeNull();
});

// --- GradientBorder ------------------------------------------------------------

test('GradientBorder renders its children without error', () => {
  renderWithProviders(
    <GradientBorder data-testid="gradient-wrapper">
      <div>inside</div>
    </GradientBorder>
  );
  expect(screen.getByText('inside')).toBeTruthy();
});

test('GradientBorder derives its gradient background from the default color triple', () => {
  renderWithProviders(
    <GradientBorder data-testid="gradient-wrapper">
      <div>inside</div>
    </GradientBorder>
  );
  const wrapper = screen.getByTestId('gradient-wrapper');
  expect(wrapper.style.background).toContain('--mantine-color-indigo-4');
  expect(wrapper.style.background).toContain('--mantine-color-grape-4');
  expect(wrapper.style.background).toContain('--mantine-color-pink-4');
});

test('GradientBorder honors a custom color triple', () => {
  renderWithProviders(
    <GradientBorder
      data-testid="gradient-wrapper"
      colors={['teal', 'yellow', 'red']}
    >
      <div>inside</div>
    </GradientBorder>
  );
  const wrapper = screen.getByTestId('gradient-wrapper');
  expect(wrapper.style.background).toContain('--mantine-color-teal-4');
  expect(wrapper.style.background).toContain('--mantine-color-yellow-4');
  expect(wrapper.style.background).toContain('--mantine-color-red-4');
});

test('GradientBorder gives its inner box a default bg.level2 surface so only the ring shows', () => {
  renderWithProviders(
    <GradientBorder data-testid="gradient-wrapper">
      <div>inside</div>
    </GradientBorder>
  );
  const inner = screen.getByText('inside').parentElement as HTMLElement;
  expect(inner.style.background).toContain('--ui-bg-2');
});

test('GradientBorder lets innerBg override the inner surface', () => {
  renderWithProviders(
    <GradientBorder data-testid="gradient-wrapper" innerBg="transparent">
      <div>inside</div>
    </GradientBorder>
  );
  const inner = screen.getByText('inside').parentElement as HTMLElement;
  expect(inner.style.background).toBe('transparent');
});

test('GradientBorder renders only its children when disabled', () => {
  renderWithProviders(
    <GradientBorder enabled={false} data-testid="gradient-wrapper">
      <div>inside</div>
    </GradientBorder>
  );
  expect(screen.getByText('inside')).toBeTruthy();
  expect(screen.queryByTestId('gradient-wrapper')).toBeNull();
});

// --- AnimatedBorderBox ---------------------------------------------------------

test('AnimatedBorderBox renders its children without error', () => {
  renderWithProviders(
    <AnimatedBorderBox data-testid="border-box">hi</AnimatedBorderBox>
  );
  expect(screen.getByText('hi')).toBeTruthy();
});

test('AnimatedBorderBox derives its gradient colors from the colors tuple and shade', () => {
  renderWithProviders(
    <AnimatedBorderBox
      data-testid="border-box"
      colors={['teal', 'orange']}
      shade={5}
    >
      hi
    </AnimatedBorderBox>
  );
  const box = screen.getByTestId('border-box');
  expect(box.style.getPropertyValue('--abb-primary')).toBe(
    'var(--mantine-color-teal-5)'
  );
  expect(box.style.getPropertyValue('--abb-secondary')).toBe(
    'var(--mantine-color-orange-4)'
  );
});

test('AnimatedBorderBox sets a finite animation-iteration-count when loop is false', () => {
  renderWithProviders(
    <AnimatedBorderBox data-testid="border-box" loop={false}>
      hi
    </AnimatedBorderBox>
  );
  expect(screen.getByTestId('border-box').style.animationIterationCount).toBe(
    '1'
  );
});

test('AnimatedBorderBox renders only its children when disabled', () => {
  renderWithProviders(
    <AnimatedBorderBox enabled={false} data-testid="border-box">
      hi
    </AnimatedBorderBox>
  );
  expect(screen.getByText('hi')).toBeTruthy();
  expect(screen.queryByTestId('border-box')).toBeNull();
});
