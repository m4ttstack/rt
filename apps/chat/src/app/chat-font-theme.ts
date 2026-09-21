import { createTheme } from '@mattstack/app-kit/core';

/**
 * Chat's type ladder, and the only one it has. Four text steps plus a
 * heading step, each a whole pixel or more apart:
 *
 * | step | px | carries                                                  |
 * |------|----|----------------------------------------------------------|
 * | xs   | 12 | meta: agent rows, DM names, chips, badges, counts, labels |
 * | sm   | 13 | chrome: room names, buttons, inputs, menu items           |
 * | md   | 14 | the inbox card's preview line                             |
 * | lg   | 16 | message prose                                             |
 * | xl   | 20 | headings                                                  |
 *
 * Merged at the ROOT provider, not through `ThemeOverrideWrapper`. A scoped
 * override emits its variables on a wrapper element, so portalled content
 * (menus, tooltips, modals, the composer's dropdown) fell through to tokyo's
 * own 10.56/11.2/12.16 ladder and `size="xs"` meant two different sizes
 * depending on whether the element was portalled. At the root there is one
 * answer for both.
 */
export const chatFontTheme = createTheme({
  fontSizes: {
    xs: '0.75rem',
    sm: '0.8125rem',
    md: '0.875rem',
    lg: '1rem',
    xl: '1.25rem',
  },
});
