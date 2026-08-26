import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  CollapsibleAlertCard,
  CopyActionIcon,
  CopyButton,
  GenericError,
  HoverBox,
  IconTooltip,
  LazyLoader,
} from '@ui/core';
import { renderWithProviders } from '@ui/storybook/test-utils';

// --- CopyActionIcon --------------------------------------------------------

const originalClipboard = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    configurable: true,
  });
});

test('CopyActionIcon writes to the clipboard and flips to the check icon', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });

  renderWithProviders(
    <CopyActionIcon value="hello world" label="Copy value" />
  );

  const button = screen.getByRole('button', { name: 'copy to clipboard' });
  expect(button.querySelector('.lucide-copy')).not.toBeNull();

  await userEvent.click(button);

  expect(writeText).toHaveBeenCalledWith('hello world');
  await waitFor(() =>
    expect(button.querySelector('.lucide-check')).not.toBeNull()
  );
});

// --- CopyButton (the labeled shadow) ----------------------------------------

test('CopyButton renders its label, copies on click, and fires onCopy', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  const onCopy = vi.fn();

  renderWithProviders(
    <CopyButton value="bun install" onCopy={onCopy}>
      Copy install command
    </CopyButton>
  );

  // The visible label is the accessible name (no icon-only aria-label here).
  const button = screen.getByRole('button', { name: 'Copy install command' });
  expect(button.querySelector('.lucide-copy')).not.toBeNull();
  // The feedback tooltip only opens while copied.
  expect(screen.queryByText('Copied!')).toBeNull();

  await userEvent.click(button);

  expect(writeText).toHaveBeenCalledWith('bun install');
  expect(onCopy).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(button.querySelector('.lucide-check')).not.toBeNull()
  );
  expect(await screen.findByText('Copied!')).toBeTruthy();
});

test('CopyButton falls back to its value as the label', () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });

  renderWithProviders(<CopyButton value="npm run dev" />);

  expect(screen.getByRole('button', { name: 'npm run dev' })).toBeTruthy();
});

// Both copy components render Mantine buttons, which default to
// type="button" -- so nesting one in a form is safe. Pinned because
// swapping either for a bare <button> would silently make copy clicks
// submit the form.
test('the copy components never submit a form they are nested in', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });
  const user = userEvent.setup();
  const onSubmit = vi.fn(event => event.preventDefault());

  renderWithProviders(
    <form onSubmit={onSubmit}>
      <CopyButton value="secret-key">Copy key</CopyButton>
      <CopyActionIcon value="secret-key" label="Copy key" />
    </form>
  );

  await user.click(screen.getByRole('button', { name: 'Copy key' }));
  await user.click(screen.getByRole('button', { name: 'copy to clipboard' }));

  expect(onSubmit).not.toHaveBeenCalled();
});

// --- IconTooltip -----------------------------------------------------------

test('IconTooltip shows its label on hover and on focus', async () => {
  renderWithProviders(<IconTooltip label="More info here" />);

  const trigger = screen.getByLabelText('more info');
  expect(screen.queryByText('More info here')).toBeNull();

  await userEvent.hover(trigger);
  expect(await screen.findByText('More info here')).toBeTruthy();

  await userEvent.unhover(trigger);
  await waitFor(() => expect(screen.queryByText('More info here')).toBeNull());

  trigger.focus();
  expect(await screen.findByText('More info here')).toBeTruthy();
});

// --- HoverBox (hover wrappers) ----------------------------------------------

test('HoverBox reveals its child content only while hovered', async () => {
  renderWithProviders(
    <HoverBox data-testid="hover-box">
      {hovered => (hovered ? <span>revealed</span> : null)}
    </HoverBox>
  );

  expect(screen.queryByText('revealed')).toBeNull();

  await userEvent.hover(screen.getByTestId('hover-box'));
  expect(await screen.findByText('revealed')).toBeTruthy();

  await userEvent.unhover(screen.getByTestId('hover-box'));
  await waitFor(() => expect(screen.queryByText('revealed')).toBeNull());
});

// --- CollapsibleAlertCard ----------------------------------------------------

test('CollapsibleAlertCard toggles its content visibility', async () => {
  renderWithProviders(
    <CollapsibleAlertCard title="A title" color="blue" icon={null}>
      <div>secret content</div>
    </CollapsibleAlertCard>
  );

  // The body animates via Mantine Collapse: content stays mounted, and the
  // collapse wrapper carries aria-hidden reflecting the open state (the
  // reliable cross-state signal, since jsdom never fires the transitionend
  // that would otherwise unmount a closed body).
  const collapseWrapper = () =>
    screen.getByText('secret content').closest('[aria-hidden]') as HTMLElement;
  expect(collapseWrapper().getAttribute('aria-hidden')).toBe('true');

  await userEvent.click(
    screen.getByRole('button', { name: 'toggle card content' })
  );
  await waitFor(() =>
    expect(collapseWrapper().getAttribute('aria-hidden')).toBe('false')
  );

  await userEvent.click(
    screen.getByRole('button', { name: 'toggle card content' })
  );
  await waitFor(() =>
    expect(collapseWrapper().getAttribute('aria-hidden')).toBe('true')
  );
});

test('CollapsibleAlertCard respects defaultOpened', () => {
  renderWithProviders(
    <CollapsibleAlertCard
      title="A title"
      color="blue"
      icon={null}
      defaultOpened
    >
      <div>secret content</div>
    </CollapsibleAlertCard>
  );

  expect(screen.getByText('secret content')).toBeTruthy();
});

// --- GenericError ------------------------------------------------------------

test('GenericError renders the message and fires onRetry when clicked', async () => {
  const onRetry = vi.fn();
  renderWithProviders(<GenericError message="It broke." onRetry={onRetry} />);

  expect(screen.getByText('It broke.')).toBeTruthy();

  await userEvent.click(screen.getByRole('button', { name: /try again/i }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('GenericError does not render a retry button when onRetry is omitted', () => {
  renderWithProviders(<GenericError message="It broke." />);
  expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
});

test('GenericError passes className/style through to its root Stack', () => {
  renderWithProviders(
    <GenericError message="It broke." className="probe" style={{ margin: 3 }} />
  );

  const root = screen.getByTestId('generic-error');
  expect(root.classList.contains('probe')).toBe(true);
  expect(root.style.margin).toBe('3px');
});

// --- LazyLoader ----------------------------------------------------------------

function createLazyProbe(delayMs: number) {
  let status: 'pending' | 'ready' = 'pending';
  let pending: Promise<void> | null = null;

  return function LazyProbe() {
    if (status === 'pending') {
      pending ??= new Promise<void>(resolve => {
        setTimeout(() => {
          status = 'ready';
          resolve();
        }, delayMs);
      });
      throw pending;
    }
    return <div>lazy content loaded</div>;
  };
}

test('LazyLoader shows a centered loader while suspended, then the lazy content', async () => {
  const LazyProbe = createLazyProbe(10);

  renderWithProviders(
    <LazyLoader>
      <LazyProbe />
    </LazyLoader>
  );

  expect(screen.getByTestId('lazy-loader-fallback')).toBeTruthy();
  expect(screen.queryByText('lazy content loaded')).toBeNull();

  expect(await screen.findByText('lazy content loaded')).toBeTruthy();
});
