import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { appTheme } from '@ui/design-system';

const css = readFileSync(join(__dirname, 'tokyo-theme.css'), 'utf8');

/** The `--tk-*` declaration for one hue, out of one scheme's block. */
function tkVar(scheme: 'light' | 'dark', name: string): string {
  const block = css.slice(
    css.indexOf(`:root[data-mantine-color-scheme='${scheme}']`)
  );
  const match = block
    .slice(0, block.indexOf('}'))
    .match(new RegExp(`--tk-${name}:\\s*(#[0-9a-f]{3,8})`, 'i'));
  if (!match) throw new Error(`--tk-${name} not declared in ${scheme}`);
  return match[1].toLowerCase();
}

/** hue -> the `--tk-*` name carrying tui-kit's canonical value for it. */
const HUES = {
  accent: 'accent',
  ok: 'green',
  warn: 'amber',
  bad: 'red',
  purple: 'purple',
  cyan: 'cyan',
} as const;

describe('tokyo ramps', () => {
  /**
   * The whole point of the ramps. Mantine reads ONE primary shade per scheme
   * for `filled`/`outline`/`text`, so tui-kit's canonical hex has to sit
   * exactly there; the generator places its seed by lightness (5..9 across
   * Tokyo Day, 2..4 across Tokyo Night) and would otherwise leave every
   * primary surface on a value tui-kit never specified.
   */
  it.each(Object.entries(HUES))(
    '%s: the canonical hex is at the primary shade in both schemes',
    (hue, tkName) => {
      const day = appTheme.colors?.[`${hue}Day`];
      const night = appTheme.colors?.[`${hue}Night`];
      expect(day, `${hue}Day is not registered`).toBeDefined();
      expect(night, `${hue}Night is not registered`).toBeDefined();

      expect(day![6].toLowerCase()).toBe(tkVar('light', tkName));
      expect(night![4].toLowerCase()).toBe(tkVar('dark', tkName));
    }
  );

  /** The anchor indices above are only correct because primaryShade names
      them. Changing one without regenerating the ramps re-points every
      primary surface silently, so the two are pinned together here. */
  it('primaryShade names the indices the ramps were anchored on', () => {
    expect(appTheme.primaryShade).toEqual({ light: 6, dark: 4 });
  });

  /**
   * Mantine's `light` variant is shade 1 behind shade 9 in light scheme, and
   * `darken(shade 9)` behind shade 0 in dark. A ramp that is flat anywhere
   * collapses fill onto label -- the exact defect the ten-identical-shade
   * tuples caused, and the one a resample can silently reintroduce by
   * scaling between two endpoints that are already the same colour.
   */
  it.each(Object.keys(HUES).flatMap(h => [`${h}Day`, `${h}Night`]))(
    '%s has ten distinct shades',
    name => {
      const tuple = appTheme.colors?.[name];
      expect(tuple).toHaveLength(10);
      expect(new Set(tuple!.map(s => s.toLowerCase())).size).toBe(10);
    }
  );

  /** `virtualColor` resolves its two sides by NAME out of this same map; a
      renamed or missing half fails at runtime, not at build. */
  it.each([
    'accent',
    'ok',
    'warn',
    'bad',
    'purple',
    'cyan',
    'blue',
    'green',
    'red',
    'yellow',
    'violet',
  ])('%s is a virtual color whose both halves are registered', name => {
    const color = appTheme.colors?.[name] as unknown as {
      'mantine-virtual-color'?: boolean;
      light?: string;
      dark?: string;
    };
    expect(color?.['mantine-virtual-color']).toBe(true);
    expect(appTheme.colors?.[color.light!]).toBeDefined();
    expect(appTheme.colors?.[color.dark!]).toBeDefined();
  });
});
