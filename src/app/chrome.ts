/**
 * Console's chrome, in px: a shell header, then exactly one page row under
 * it -- a title row or the tab row that stands in for one. Every page draws
 * that row at ONE height with ONE title treatment, so the pages never look
 * inconsistent side by side. The kit defaults (64/64/46) are sized for a
 * roomy sidebar layout; console's pages are dense lists, so the ladder is
 * tightened here and threaded to `MattstackShell` and every `PageShell`.
 */
export const SHELL_HEADER_HEIGHT = 48;
export const PAGE_ROW_HEIGHT = 40;
