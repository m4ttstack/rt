import { createTheme } from '@mattstack/app-kit/core';

/**
 * A step up from the kit's default Mantine font scale (xs–xl of 12/14/16/18/20
 * px). Merged onto the tokyo theme for the chat subtree only, via
 * `ThemeOverrideWrapper`: the transcript prose, room list and roster all size
 * off these tokens, so this enlarges the reading surface, while the app rail
 * and nav bar sit outside the wrapped subtree and keep the default scale.
 */
export const chatFontTheme = createTheme({
  fontSizes: {
    xs: '0.8125rem',
    sm: '0.9375rem',
    md: '1.125rem',
    lg: '1.25rem',
    xl: '1.375rem',
  },
});
