import { RADIX } from './radix.ts';
import { HUE_SCALE, HUES, TOKENS } from './values.ts';

// Mantine 9.5 derives text, outline, filled-hover and the dark light tint
// from fixed tuple indices (get-css-color-variables.mjs); these are the
// variables where that derivation and the tokens' step choices differ.
export function mantinePins(scheme: 'light' | 'dark'): Record<string, string> {
  const t = TOKENS[scheme];
  const out: Record<string, string> = {};
  for (const hue of HUES) {
    const scale = RADIX[HUE_SCALE[hue]][scheme];
    out[`--mantine-color-${hue}-filled`] = t.hue[hue];
    out[`--mantine-color-${hue}-filled-hover`] = t.hueHover[hue];
    out[`--mantine-color-${hue}-text`] = t.hueText[hue];
    out[`--mantine-color-${hue}-outline`] = t.hueText[hue];
    if (scheme === 'dark') {
      out[`--mantine-color-${hue}-light`] = scale[2]!;
      out[`--mantine-color-${hue}-light-hover`] = scale[3]!;
    }
  }
  return out;
}
