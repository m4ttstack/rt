import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { HUES, TOKENS } from '../src/values.ts';

const css = readFileSync(
  join(import.meta.dirname, '..', '..', 'tokyo', 'src', 'tokyo-theme.css'),
  'utf8'
);

function block(scheme: 'light' | 'dark'): string {
  const begin = css.indexOf(`/* BEGIN GENERATED: tokyo tokens ${scheme} */`);
  const end = css.indexOf('/* END GENERATED */', begin);
  return css.slice(begin, end);
}

describe('tokyo-theme.css carries the ramps', () => {
  it.each(['light', 'dark'] as const)(
    '%s: numbered ramps and roles match TOKENS',
    scheme => {
      const b = block(scheme);
      const t = TOKENS[scheme];
      t.surfaceRamp.forEach((v, i) =>
        expect(b).toContain(`--tk-surface-${i + 1}: ${v};`)
      );
      t.textRamp.forEach((v, i) =>
        expect(b).toContain(`--tk-text-${i + 1}: ${v};`)
      );
      t.lineRamp.forEach((v, i) =>
        expect(b).toContain(`--tk-line-${i + 1}: ${v};`)
      );
      expect(b).toContain(`--tk-raised: ${t.surface.raised};`);
    }
  );

  it.each(['light', 'dark'] as const)(
    '%s: fill, hover and text names per hue',
    scheme => {
      const b = block(scheme);
      const t = TOKENS[scheme];
      for (const hue of HUES) {
        expect(b).toContain(`--tk-fill-${hue}: ${t.hue[hue]};`);
        expect(b).toContain(`--tk-fill-${hue}-hover: ${t.hueHover[hue]};`);
        expect(b).toContain(`--tk-text-${hue}: ${t.hueText[hue]};`);
        expect(b).toContain(`--tk-text-${hue}-small: ${t.hueTextSmall[hue]};`);
      }
    }
  );
});
