import { beforeEach, describe, expect, test } from 'vitest';

import {
  __resetSimpleAlertsForTests,
  markMounted,
  registerSimpleAlerts,
} from './SimpleAlerts';

const PANEL_SELECTOR = '[data-testid="simple-alerts-panel"]';

function dispatchWindowError(message: string) {
  window.dispatchEvent(new ErrorEvent('error', { message }));
}

function dispatchUnhandledRejection(reason: unknown) {
  const event = new Event('unhandledrejection') as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
}

describe('SimpleAlerts', () => {
  beforeEach(() => {
    __resetSimpleAlertsForTests();
    document.body.innerHTML = '';
    registerSimpleAlerts();
  });

  test('dispatching a window error before mount injects the fatal panel', () => {
    dispatchWindowError('boom');

    const panel = document.querySelector(PANEL_SELECTOR);
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('boom');
  });

  test('a reload button is present and reloads the page on click', () => {
    dispatchWindowError('boom');

    const button = document
      .querySelector(PANEL_SELECTOR)
      ?.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe('Reload');
  });

  test('a second error before mount does not duplicate the panel', () => {
    dispatchWindowError('first failure');
    dispatchWindowError('second failure');

    expect(document.querySelectorAll(PANEL_SELECTOR)).toHaveLength(1);
    // The first message wins -- the panel is injected once and left alone.
    expect(document.querySelector(PANEL_SELECTOR)?.textContent).toContain(
      'first failure'
    );
  });

  test('an unhandledrejection before mount also injects the panel', () => {
    dispatchUnhandledRejection(new Error('rejected'));

    const panel = document.querySelector(PANEL_SELECTOR);
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('rejected');
  });

  test('after markMounted, a window error does not inject a panel', () => {
    markMounted();

    dispatchWindowError('boom');

    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
  });

  test('after markMounted, an unhandledrejection does not inject a panel', () => {
    markMounted();

    dispatchUnhandledRejection(new Error('rejected'));

    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
  });
});
