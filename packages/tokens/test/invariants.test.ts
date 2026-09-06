import { describe, expect, it } from 'vitest';

import { contrastRatio, srgbLuminance } from '../src/color-math.ts';
import { TOKENS } from '../src/values.ts';

const SCHEMES = ['light', 'dark'] as const;

describe('surface ladder', () => {
  it.each(SCHEMES)('%s: bg < panel < card by luminance direction', scheme => {
    const s = TOKENS[scheme].surface;
    const [bg, panel, card] = [s.bg, s.panel, s.card].map(srgbLuminance);
    expect(bg).toBeLessThan(panel);
    expect(panel).toBeLessThan(card);
  });
});

describe('AA floors for text-role tokens', () => {
  const surfaces = ['chrome', 'bg', 'panel', 'card'] as const;
  it.each(SCHEMES)(
    '%s: fg, mutedText, accentText clear 4.5:1 on every surface',
    scheme => {
      const t = TOKENS[scheme];
      for (const roleName of ['fg', 'mutedText', 'accentText'] as const) {
        for (const surface of surfaces) {
          const ratio = contrastRatio(t.text[roleName], t.surface[surface]);
          expect(
            ratio,
            `${scheme} ${roleName} on ${surface}`
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  );
});
