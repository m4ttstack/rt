import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { tokyoRamps } from '../../tokyo/src/ramps.ts';
import { mantinePins } from '../src/mantine-pins.ts';
import { RADIX } from '../src/radix.ts';
import { HUE_SCALE, HUES, TOKENS } from '../src/values.ts';

const css = readFileSync(
  join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'tokyo-theme.css'),
  'utf8'
);

function pinBlock(scheme: 'light' | 'dark'): string {
  const begin = css.indexOf(`/* BEGIN GENERATED: mantine pins ${scheme} */`);
  const end = css.indexOf('/* END GENERATED */', begin);
  if (begin === -1 || end === -1)
    throw new Error(`tokyo-theme.css: no mantine pins ${scheme} block`);
  return css.slice(begin, end);
}

const DAY = [
  'accentDay',
  'okDay',
  'badDay',
  'warnDay',
  'purpleDay',
  'cyanDay',
  'goldDay',
] as const;
const NIGHT = [
  'accentNight',
  'okNight',
  'badNight',
  'warnNight',
  'purpleNight',
  'cyanNight',
  'goldNight',
] as const;

describe('tokyo ramps anchor on Radix step 9', () => {
  it.each(HUES.map((h, i) => [h, DAY[i]!, NIGHT[i]!] as const))(
    '%s',
    (hue, day, night) => {
      const scale = RADIX[HUE_SCALE[hue]];
      expect(tokyoRamps[day][6]).toBe(scale.light[8]);
      expect(tokyoRamps[night][3]).toBe(scale.dark[8]);
    }
  );
});

describe('pins land every Mantine derivation on the step the tokens chose', () => {
  it.each(HUES)('%s', hue => {
    const l = TOKENS.light;
    const d = TOKENS.dark;
    const light = mantinePins('light');
    const dark = mantinePins('dark');
    expect(light[`--mantine-color-${hue}-filled`]).toBe(l.hue[hue]);
    expect(light[`--mantine-color-${hue}-filled-hover`]).toBe(l.hueHover[hue]);
    expect(light[`--mantine-color-${hue}-text`]).toBe(l.hueText[hue]);
    expect(light[`--mantine-color-${hue}-outline`]).toBe(l.hueText[hue]);
    expect(dark[`--mantine-color-${hue}-filled`]).toBe(d.hue[hue]);
    expect(dark[`--mantine-color-${hue}-filled-hover`]).toBe(d.hueHover[hue]);
    expect(dark[`--mantine-color-${hue}-text`]).toBe(d.hueText[hue]);
    expect(dark[`--mantine-color-${hue}-outline`]).toBe(d.hueText[hue]);
    expect(dark[`--mantine-color-${hue}-light`]).toBe(
      RADIX[HUE_SCALE[hue]].dark[2]
    );
    expect(dark[`--mantine-color-${hue}-light-hover`]).toBe(
      RADIX[HUE_SCALE[hue]].dark[3]
    );
  });

  it.each(['light', 'dark'] as const)(
    '%s: every pin is in tokyo-theme.css under the doubled-root selector',
    scheme => {
      const begin = css.indexOf(
        `/* BEGIN GENERATED: mantine pins ${scheme} */`
      );
      const selector = `:root:root[data-mantine-color-scheme='${scheme}']`;
      const selectorAt = css.lastIndexOf(selector, begin);
      expect(selectorAt, 'selector precedes the marker').toBeGreaterThan(-1);
      expect(
        css.lastIndexOf('}', begin),
        'no rule closes between the selector and the marker'
      ).toBeLessThan(selectorAt);
      const block = pinBlock(scheme);
      for (const [name, value] of Object.entries(mantinePins(scheme))) {
        expect(block, name).toContain(`${name}: ${value};`);
      }
    }
  );

  it('the hand-written dark tuple remap is gone', () => {
    expect(css).not.toContain('--mantine-color-dark-7: var(--tk-bg)');
  });
});
