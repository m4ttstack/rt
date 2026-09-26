/**
 * Boot-time fatal-error safety net. Dependency-free (no React, no Mantine --
 * everything here has to work even if React itself is the thing that failed
 * to load or mount), plain DOM.
 *
 * Usage (see `src/main.tsx`):
 *
 *   registerSimpleAlerts();       // BEFORE the React render call
 *   createRoot(...).render(...);  // if this throws synchronously, the
 *                                 // uncaught exception fires a window
 *                                 // 'error' event, which is still caught
 *                                 // below since markMounted() below it
 *                                 // never runs
 *   markMounted();                // only reached on successful render
 *
 * Once `markMounted()` has run, this module goes back to sleep -- the
 * mounted app owns its own error handling (error boundaries, notifications,
 * etc.) from that point on. Before it, this is the *only* thing standing
 * between a boot failure and a blank white page.
 */

const PANEL_TEST_ID = 'simple-alerts-panel';

let mounted = false;
let panelInjected = false;

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return 'An unexpected error occurred while loading the application.';
}

function buildPanel(message: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.setAttribute('data-testid', PANEL_TEST_ID);
  panel.setAttribute('role', 'alert');
  panel.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:10000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:rgba(20,20,20,0.85)',
    'color:#fff',
    'font-family:system-ui,sans-serif',
    'padding:1.5rem',
    'text-align:center',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'max-width:28rem',
    'display:flex',
    'flex-direction:column',
    'gap:0.75rem',
    'align-items:center',
  ].join(';');

  const heading = document.createElement('strong');
  heading.textContent = 'Something went wrong loading the application';
  heading.style.fontSize = '1.1rem';

  const messageEl = document.createElement('p');
  messageEl.textContent = message;
  messageEl.style.cssText = 'margin:0;opacity:0.85;font-size:0.9rem';

  const reloadButton = document.createElement('button');
  reloadButton.type = 'button';
  reloadButton.textContent = 'Reload';
  reloadButton.style.cssText = [
    'padding:0.5rem 1.25rem',
    'border-radius:4px',
    'border:none',
    'background:#4c6ef5',
    'color:#fff',
    'font-size:0.9rem',
    'cursor:pointer',
  ].join(';');
  reloadButton.addEventListener('click', () => {
    window.location.reload();
  });

  card.append(heading, messageEl, reloadButton);
  panel.append(card);
  return panel;
}

function injectPanelOnce(message: string): void {
  if (panelInjected) return;
  document.body.appendChild(buildPanel(message));
  panelInjected = true;
}

function handleWindowError(event: ErrorEvent): void {
  if (mounted) return;
  injectPanelOnce(event.message || describeReason(event.error));
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  if (mounted) return;
  injectPanelOnce(describeReason(event.reason));
}

/**
 * Registers the boot-time `error`/`unhandledrejection` listeners. Call
 * exactly once, before the React render call. Safe to call more than once
 * (the underlying `addEventListener` calls use stable function references,
 * so duplicate registrations are no-ops per the DOM spec).
 */
export function registerSimpleAlerts(): void {
  window.addEventListener('error', handleWindowError);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
}

/**
 * Marks the app as successfully mounted. Call once, immediately after the
 * React render call returns. From then on, `registerSimpleAlerts`'s
 * listeners no-op -- the mounted app is responsible for its own errors.
 */
export function markMounted(): void {
  mounted = true;
}

/** Test-only: resets module state between test cases. Not used by the app. */
export function __resetSimpleAlertsForTests(): void {
  mounted = false;
  panelInjected = false;
}
