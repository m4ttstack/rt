/**
 * Shared phone-shell chrome. `PhoneHeader`/`PhoneChat` (App.tsx), the
 * reader's phone header (Reader.tsx) and the fleet drawer (RoomRail.tsx)
 * all draw the same 44px tap-target floor and muted/border tokens -- one
 * definition keeps the three from drifting apart.
 */

/** Every phone header/drawer control is 44px -- `.aicon.tap`, the hit-target
    floor CONFORMANCE.md pins. */
export const PHONE_TAP = 44;
/** `PhoneHeader`/`PhoneInboxHeader` (App.tsx) are called from inside
    `PhoneChat`/`PhoneInboxPage`, both wrapped in `ThemeOverrideWrapper
    theme={chatFontTheme}` -- the call site, not the callee's own function
    body, decides the theme context, so every text glyph under this app's
    phone chrome is themed. `PHONE_MUTED` now serves icon tints only (no
    text glyph to band): `tapButtonStyle`'s buttons and the icon-only
    containers in `App.tsx`, `--tk-text-3` per the icon-tint default (see
    the shared reasoning at FleetTree.tsx's `CloseControl`). Every actual
    text use of "muted phone chrome" reads `PHONE_MUTED_META` instead,
    since all of it renders at `chatFontTheme`'s meta-band `xs` (13px). */
export const PHONE_MUTED = 'var(--tk-text-3)';
export const PHONE_MUTED_META = 'var(--tk-text-3)';
export const PHONE_BORDER = 'var(--tk-border)';

export function tapButtonStyle(size: number) {
  return {
    display: 'inline-flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    width: size,
    height: size,
    flex: 'none' as const,
    borderRadius: 'var(--mantine-radius-md)',
    color: PHONE_MUTED,
    background: 'transparent',
    border: 0,
  };
}
