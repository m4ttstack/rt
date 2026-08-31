import { createTheme } from '@mattstack/app-kit/core';

/**
 * A gentle lift of the kit's default Mantine font scale, merged onto the tokyo
 * theme for the chat subtree only via `ThemeOverrideWrapper` (the app rail and
 * nav bar sit outside it and keep the defaults). Only the small end moves: xs
 * 12->13 and sm 14->15 nudge the room list and roster names, while md/lg/xl
 * stay at the default 16/18/20 so the message prose reads at 16, a clear step
 * above the ~13.5px surrounding base without ballooning. Much of the chrome is
 * hardcoded px (timestamps, meta labels) and does not track these tokens.
 */
export const chatFontTheme = createTheme({
  fontSizes: {
    xs: '0.8125rem',
    sm: '0.9375rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
  },
});
