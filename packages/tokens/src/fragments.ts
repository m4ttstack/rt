export const FONT_SMOOTHING_BEGIN_MARKER =
  '/* BEGIN GENERATED: base rules (font smoothing) */';
export const FONT_SMOOTHING_END_MARKER =
  '/* END GENERATED: base rules (font smoothing) */';

/**
 * Base rules every consumer's stylesheet ships verbatim -- font smoothing is
 * global, not scheme- or token-derived, so it renders as a fixed string
 * rather than reading from TOKENS.
 */
export function renderFontSmoothing(): string {
  return [
    FONT_SMOOTHING_BEGIN_MARKER,
    'body {',
    '  -webkit-font-smoothing: antialiased;',
    '  -moz-osx-font-smoothing: grayscale;',
    '}',
    FONT_SMOOTHING_END_MARKER,
  ].join('\n');
}
