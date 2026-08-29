/**
 * Console's chrome ladder, in px: the shell header, then exactly one page
 * row under it -- a title row, or a tab row standing in for one. The kit
 * defaults (64 / 64 / 46) are sized for a roomy sidebar layout; console's
 * pages are dense lists, so the ladder is tightened here and threaded to
 * `MattstackShell` and every `PageShell` so the pages never disagree.
 */
export const SHELL_HEADER_HEIGHT = 48;
export const PAGE_HEADER_HEIGHT = 44;
export const PAGE_TAB_BAR_HEIGHT = 40;
