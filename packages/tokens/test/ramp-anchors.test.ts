import { describe, expect, it } from 'vitest';

import { tokyoRamps } from '../../tokyo/src/ramps.ts';
import { TOKENS } from '../src/values.ts';

const ANCHORS = [
  ['accent', 'accentDay', 'accentNight'],
  ['ok', 'okDay', 'okNight'],
  ['bad', 'badDay', 'badNight'],
  ['warn', 'warnDay', 'warnNight'],
  ['purple', 'purpleDay', 'purpleNight'],
  ['cyan', 'cyanDay', 'cyanNight'],
] as const;

describe('tokyo ramps anchor on the canonical hues', () => {
  it.each(ANCHORS)('%s', (hue, day, night) => {
    expect(tokyoRamps[day][6]).toBe(TOKENS.light.hue[hue]);
    expect(tokyoRamps[night][4]).toBe(TOKENS.dark.hue[hue]);
  });
});
