import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FONT_SMOOTHING_BEGIN_MARKER,
  FONT_SMOOTHING_END_MARKER,
  renderFontSmoothing,
} from '../src/fragments.ts';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const TUI_KIT_THEME_CSS = join(
  REPO_ROOT,
  'packages',
  'tui-kit',
  'src',
  'generated',
  'theme.css'
);
const TOKYO_THEME_CSS = join(
  REPO_ROOT,
  'packages',
  'tokyo',
  'src',
  'tokyo-theme.css'
);

function extractFragment(css: string, label: string): string {
  const beginIdx = css.indexOf(FONT_SMOOTHING_BEGIN_MARKER);
  if (beginIdx === -1) {
    throw new Error(`${label}: missing "${FONT_SMOOTHING_BEGIN_MARKER}"`);
  }
  const endIdx = css.indexOf(FONT_SMOOTHING_END_MARKER, beginIdx);
  if (endIdx === -1) {
    throw new Error(
      `${label}: missing "${FONT_SMOOTHING_END_MARKER}" after BEGIN`
    );
  }
  return css.slice(beginIdx, endIdx + FONT_SMOOTHING_END_MARKER.length);
}

describe('font-smoothing fragment sync', () => {
  const expected = renderFontSmoothing();

  it('tui-kit theme.css carries the exact fragment', () => {
    const css = readFileSync(TUI_KIT_THEME_CSS, 'utf8');
    expect(extractFragment(css, 'tui-kit theme.css')).toBe(expected);
  });

  it('tokyo-theme.css carries the exact fragment', () => {
    const css = readFileSync(TOKYO_THEME_CSS, 'utf8');
    expect(extractFragment(css, 'tokyo-theme.css')).toBe(expected);
  });
});
