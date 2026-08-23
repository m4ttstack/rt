import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import { Link } from './Link';
import { navigate, usePath } from './navigation';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

test('renders a real anchor with the href', () => {
  render(<Link href="/docs">Docs</Link>);
  const anchor = screen.getByRole('link', { name: 'Docs' });
  expect(anchor.getAttribute('href')).toBe('/docs');
});

test('a plain left-click navigates via pushState instead of a page load', () => {
  render(<Link href="/docs">Docs</Link>);

  fireEvent.click(screen.getByRole('link', { name: 'Docs' }));

  expect(window.location.pathname).toBe('/docs');
});

test('modified clicks are left to the browser (no SPA navigation)', () => {
  render(<Link href="/docs">Docs</Link>);
  const anchor = screen.getByRole('link', { name: 'Docs' });

  fireEvent.click(anchor, { metaKey: true });
  fireEvent.click(anchor, { ctrlKey: true });
  fireEvent.click(anchor, { shiftKey: true });
  fireEvent.click(anchor, { button: 1 });

  expect(window.location.pathname).toBe('/');
});

test('a target=_blank link is left to the browser', () => {
  render(
    <Link href="/docs" target="_blank">
      Docs
    </Link>
  );

  fireEvent.click(screen.getByRole('link', { name: 'Docs' }));

  expect(window.location.pathname).toBe('/');
});

test('a caller onClick that prevents default suppresses the SPA navigation', () => {
  render(
    <Link href="/docs" onClick={event => event.preventDefault()}>
      Docs
    </Link>
  );

  fireEvent.click(screen.getByRole('link', { name: 'Docs' }));

  expect(window.location.pathname).toBe('/');
});

test('replace links use replaceState (no new history entry)', () => {
  const initialLength = window.history.length;
  render(
    <Link href="/docs" replace>
      Docs
    </Link>
  );

  fireEvent.click(screen.getByRole('link', { name: 'Docs' }));

  expect(window.location.pathname).toBe('/docs');
  expect(window.history.length).toBe(initialLength);
});

function PathProbe() {
  return <span data-testid="path">{usePath()}</span>;
}

test('usePath re-renders on navigate() and on popstate', () => {
  render(<PathProbe />);
  expect(screen.getByTestId('path').textContent).toBe('/');

  act(() => navigate('/demo'));
  expect(screen.getByTestId('path').textContent).toBe('/demo');

  // Simulate the browser back button: history moves on its own and only a
  // popstate event tells the app about it.
  act(() => {
    window.history.pushState(null, '', '/docs');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(screen.getByTestId('path').textContent).toBe('/docs');
});

test('navigate to the current URL does not stack a duplicate history entry', () => {
  navigate('/docs');
  const lengthAfterFirst = window.history.length;

  navigate('/docs');

  expect(window.history.length).toBe(lengthAfterFirst);
  expect(window.location.pathname).toBe('/docs');
});
