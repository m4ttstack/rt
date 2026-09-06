/**
 * Shared phone-shell chrome. `PhoneHeader`/`PhoneChat` (App.tsx), the
 * reader's phone header (Reader.tsx) and the fleet drawer (RoomRail.tsx)
 * all draw the same 44px tap-target floor and muted/border tokens -- one
 * definition keeps the three from drifting apart.
 */

/** Every phone header/drawer control is 44px -- `.aicon.tap`, the hit-target
    floor CONFORMANCE.md pins. */
export const PHONE_TAP = 44;
export const PHONE_MUTED = 'var(--tk-muted-text)';
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
