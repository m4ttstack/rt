import { describe, expect, it } from 'vitest';

import { contrastRatio, srgbLuminance } from '../src/color-math.ts';
import { RADIX } from '../src/radix.ts';
import { CSS_TEXT, HUE_SCALE, HUES, TOKENS, type Step } from '../src/values.ts';

const SCHEMES = ['light', 'dark'] as const;
const WHITE = '#ffffff';
// text-4 shares text-3's bar: both sit on slate 11, whose worst case (4.86,
// the light row surface) is what set 4.8 in the first place.
const TEXT_BAR = [0, 4.5, 4.8, 4.8] as const;

function worst(hex: string, surfaces: readonly string[]): number {
  return Math.min(...surfaces.map(s => contrastRatio(hex, s)));
}

describe('surface ramp', () => {
  it.each(SCHEMES)(
    '%s: surface-1 has the most contrast against text-1, strictly descending',
    scheme => {
      const t = TOKENS[scheme];
      const ratios = t.surfaceRamp.map(s => contrastRatio(t.textRamp[0], s));
      for (let i = 1; i < ratios.length; i++) {
        expect(
          ratios[i],
          `${scheme} surface-${i + 1} vs surface-${i}`
        ).toBeLessThan(ratios[i - 1]!);
      }
    }
  );

  it.each(SCHEMES)(
    '%s: every surface role is the ramp step its index names',
    scheme => {
      const t = TOKENS[scheme];
      expect(t.surface.card).toBe(t.surfaceRamp[t.surfaceRole.card - 1]);
      expect(t.surface.panel).toBe(t.surfaceRamp[t.surfaceRole.panel - 1]);
      expect(t.surface.bg).toBe(t.surfaceRamp[t.surfaceRole.page - 1]);
      expect(t.surface.chrome).toBe(t.surfaceRamp[t.surfaceRole.chrome - 1]);
      expect(t.surface.inset).toBe(t.surfaceRamp[t.surfaceRole.inset - 1]);
      expect(t.surface.overlay).toBe(t.surfaceRamp[t.surfaceRole.overlay - 1]);
      expect(t.surface.raised).toBe(t.surfaceRamp[t.surfaceRole.raised - 1]);
    }
  );

  it.each(SCHEMES)('%s: bg < panel < card by luminance direction', scheme => {
    const s = TOKENS[scheme].surface;
    const [bg, panel, card] = [s.bg, s.panel, s.card].map(srgbLuminance);
    if (scheme === 'light') {
      expect(bg).toBeLessThan(panel!);
      expect(panel).toBeLessThan(card!);
    } else {
      expect(bg).toBeLessThan(panel!);
      expect(panel).toBeLessThan(card!);
    }
  });

  it.each(SCHEMES)(
    '%s: inset sits below card and overlay separates from the page',
    scheme => {
      const s = TOKENS[scheme].surface;
      expect(srgbLuminance(s.inset)).toBeLessThan(srgbLuminance(s.card));
      // The earlier rule capped overlay at the panel, which in dark put a
      // dialog's ground on the page's own hex. What a modal owes is an edge
      // against what it covers, not a position relative to a panel.
      expect(s.overlay).not.toBe(s.bg);
    }
  );

  it('light surfaces are white then slate 2..4; dark surfaces are slate 1..4', () => {
    expect([...TOKENS.light.surfaceRamp]).toEqual([
      WHITE,
      ...RADIX.slate.light.slice(1, 4),
    ]);
    expect([...TOKENS.dark.surfaceRamp]).toEqual([
      ...RADIX.slate.dark.slice(0, 4),
    ]);
  });
});

describe('text ramp', () => {
  it.each(SCHEMES)(
    '%s: text-2..4 clear their bars on every surface',
    scheme => {
      const t = TOKENS[scheme];
      for (let i = 1; i < 4; i++) {
        expect(
          worst(t.textRamp[i]!, t.surfaceRamp),
          `${scheme} text-${i + 1}`
        ).toBeGreaterThanOrEqual(TEXT_BAR[i]!);
      }
    }
  );

  it.each(SCHEMES)('%s: text-1 clears 7.0 on every surface', scheme => {
    const t = TOKENS[scheme];
    expect(worst(t.textRamp[0], t.surfaceRamp)).toBeGreaterThanOrEqual(7.0);
  });

  it.each(SCHEMES)(
    '%s: text roles are ramp steps and the ramp is slate 12, 11, 11, 11',
    scheme => {
      const t = TOKENS[scheme];
      const s = RADIX.slate[scheme];
      expect([...t.textRamp]).toEqual([s[11], s[10], s[10], s[10]]);
      expect(t.text.fg).toBe(t.textRamp[t.textRole.fg - 1]);
      expect(t.text.mutedText).toBe(t.textRamp[t.textRole.mutedText - 1]);
      expect(t.text.mutedOnCard).toBe(t.textRamp[t.textRole.mutedOnCard - 1]);
    }
  );
});

describe('line ramp', () => {
  it.each(SCHEMES)(
    '%s: slate 8, 7, 6 in light and 9, 7, 6 in dark, strongest first against its ground',
    scheme => {
      const t = TOKENS[scheme];
      const s = RADIX.slate[scheme];
      expect([...t.lineRamp]).toEqual(
        scheme === 'light' ? [s[7], s[6], s[5]] : [s[8], s[6], s[5]]
      );
      const ground = scheme === 'light' ? WHITE : t.surface.card;
      const ratios = t.lineRamp.map(l => contrastRatio(l, ground));
      for (let i = 1; i < ratios.length; i++)
        expect(ratios[i]).toBeLessThanOrEqual(ratios[i - 1]!);
    }
  );

  it('dark line-1 holds the non-text bar against the card', () => {
    expect(
      contrastRatio(TOKENS.dark.line.control, TOKENS.dark.surface.card)
    ).toBeGreaterThanOrEqual(3.0);
  });

  it.each(SCHEMES)('%s: line roles are ramp steps', scheme => {
    const t = TOKENS[scheme];
    expect(t.line.border).toBe(t.lineRamp[t.lineRole.border - 1]);
    expect(t.line.soft).toBe(t.lineRamp[t.lineRole.soft - 1]);
    expect(t.line.control).toBe(t.lineRamp[t.lineRole.control - 1]);
    expect(t.line.edgeOnCard).toBe(t.lineRamp[t.lineRole.edgeOnCard - 1]);
    expect(t.line.softOnCard).toBe(t.lineRamp[t.lineRole.softOnCard - 1]);
    expect(t.line.controlEdgeOnCard).toBe(t.line.control);
  });
});

function ruleFill(
  scale: readonly string[],
  surfaces: readonly string[],
  scheme: 'light' | 'dark',
  hue: string
): Step {
  if (worst(scale[8]!, surfaces) >= 3.0) return 9;
  // Radix amber clears 3.0 at neither 9 nor 10 in light, so the rule has no
  // step to prefer on contrast grounds; gold stays at 9 so its shape matches
  // every hue that is not pushed to 10 by a real 9-vs-10 contrast win.
  if (hue === 'gold') return 9;
  if (scheme === 'dark' && contrastRatio(scale[9]!, WHITE) < 4.5) return 9;
  return 10;
}

function ruleText(): Step {
  // Step 11 is the default and step 12 is the high-contrast step, which is
  // radix-ui/themes' model. The cells where 11 misses 4.5 on the darker
  // surfaces are ledgered, not promoted away.
  return 11;
}

describe('palette', () => {
  it.each(SCHEMES)(
    '%s: every hue value is the Radix step its rule picks',
    scheme => {
      const t = TOKENS[scheme];
      for (const hue of HUES) {
        const scale = RADIX[HUE_SCALE[hue]][scheme];
        const fill = ruleFill(scale, t.surfaceRamp, scheme, hue);
        const text = ruleText();
        expect(t.hueStep[hue], `${scheme} ${hue} steps`).toEqual({
          fill,
          text,
        });
        expect(t.hue[hue]).toBe(scale[fill - 1]);
        expect(t.hueHover[hue]).toBe(
          fill === 9
            ? scale[9]
            : `color-mix(in srgb, ${scale[fill - 1]} 88%, ${t.textRamp[0]})`
        );
        expect(t.hueText[hue]).toBe(scale[text - 1]);
        expect(t.hueTextSmall[hue]).toBe(scale[11]);
      }
    }
  );

  it.each(SCHEMES)('%s: hue small text clears 7.0 on every surface', scheme => {
    const t = TOKENS[scheme];
    for (const hue of HUES) {
      expect(
        worst(t.hueTextSmall[hue], t.surfaceRamp),
        `${scheme} text-${hue}-small`
      ).toBeGreaterThanOrEqual(7.0);
    }
  });

  // The exact per-cell set lives in tui-kit's ledger, whose gate fails on a
  // missing or obsolete entry; this package cannot import it without
  // inverting the dependency, so only the shape is asserted here.
  it('the hue body text that misses 4.5 is light-only and never surface-1', () => {
    // Step 11 is designed against Radix's own grounds, which are steps 1 to 2
    // of the hue on a near-white page. Ours are slate 2 to 4, so the darker
    // surfaces cost these hues the text bar. The cell is still the one that
    // carries the hue, and the same value clears the 3.0 glyph bar.
    const misses: string[] = [];
    for (const scheme of SCHEMES) {
      const t = TOKENS[scheme];
      for (const hue of HUES) {
        for (const [i, surface] of t.surfaceRamp.entries()) {
          if (contrastRatio(t.hueText[hue], surface) < 4.5) {
            misses.push(`${scheme}/${hue}/surface-${i + 1}`);
          }
        }
      }
    }
    expect(misses.every(m => m.startsWith('light/'))).toBe(true);
    expect(misses.some(m => m.endsWith('surface-1'))).toBe(false);
  });

  it('step 9 is the same hex in both schemes for every hue', () => {
    for (const hue of HUES) {
      expect(RADIX[HUE_SCALE[hue]].light[8], hue).toBe(
        RADIX[HUE_SCALE[hue]].dark[8]
      );
    }
  });

  it('the fills that miss 3.0 are exactly the ledgered six', () => {
    const misses: string[] = [];
    for (const scheme of SCHEMES) {
      const t = TOKENS[scheme];
      for (const hue of HUES) {
        if (worst(t.hue[hue], t.surfaceRamp) < 3.0)
          misses.push(`${scheme}/${hue}`);
      }
    }
    expect(misses.sort()).toEqual([
      'dark/accent',
      'dark/purple',
      'light/cyan',
      'light/gold',
      'light/ok',
      'light/warn',
    ]);
  });

  it.each(SCHEMES)('%s: legacy text leaves read the hue text', scheme => {
    const t = TOKENS[scheme];
    expect(t.text.accentText).toBe(t.hueText.accent);
    expect(t.text.okText).toBe(t.hueText.ok);
    expect(t.text.warnText).toBe(t.hueText.warn);
    expect(t.text.redText).toBe(t.hueText.bad);
    expect(t.text.badgeText).toBe(t.textRamp[2]);
    expect(t.text.muted).toBe(RADIX.slate[scheme][8]);
  });
});

describe('on-fill and vivid text', () => {
  it('on-fill labels clear 4.5 except the ledgered miss', () => {
    const ledger: string[] = [];
    for (const scheme of SCHEMES) {
      for (const hue of HUES) {
        const fill = TOKENS[scheme].hue[hue];
        const label = TOKENS[scheme].hueOnFill[hue];
        const ratio = contrastRatio(fill, label);
        if (ratio < 4.5) ledger.push(`${scheme}/${hue}`);
        expect(label === WHITE || label === TOKENS.light.textRamp[0]).toBe(
          true
        );
      }
    }
    expect(ledger).toEqual([
      'light/ok',
      'light/bad',
      'light/warn',
      'light/cyan',
      'dark/ok',
      'dark/bad',
      'dark/warn',
      'dark/cyan',
    ]);
  });

  it('on-fill is white except on the pale scales', () => {
    // Radix Themes ships this per scale as `--<scale>-contrast`: white for
    // every scale here except amber, which gold is built from. Picking the
    // higher-contrast label per hue instead gives a row two label colours,
    // which their own components never have.
    const dark = TOKENS.light.textRamp[0];
    for (const scheme of SCHEMES) {
      for (const hue of HUES) {
        expect(TOKENS[scheme].hueOnFill[hue]).toBe(
          hue === 'gold' ? dark : WHITE
        );
      }
    }
  });

  it('the on-fill pick is the same in both schemes', () => {
    for (const hue of HUES) {
      const light = TOKENS.light.hueOnFill[hue] === WHITE;
      const dark = TOKENS.dark.hueOnFill[hue] === WHITE;
      expect(light).toBe(dark);
    }
  });

  it.each(SCHEMES)('%s: vivid text is step 11 for every hue', scheme => {
    for (const hue of HUES) {
      expect(TOKENS[scheme].hueTextVivid[hue]).toBe(
        RADIX[HUE_SCALE[hue]][scheme][10]
      );
    }
  });
});

describe('gold', () => {
  it('is the seventh hue, backed by Radix amber', () => {
    expect(HUES).toContain('gold');
    expect(HUE_SCALE.gold).toBe('amber');
    expect(TOKENS.light.hue.gold).toBe('#ffc53d');
    expect(TOKENS.dark.hue.gold).toBe('#ffc53d');
    expect(TOKENS.light.hueTextVivid.gold).toBe('#ab6400');
    expect(TOKENS.dark.hueTextVivid.gold).toBe('#ffca16');
  });

  it('takes the dark on-fill label', () => {
    expect(TOKENS.light.hueOnFill.gold).toBe(TOKENS.light.textRamp[0]);
    expect(TOKENS.dark.hueOnFill.gold).toBe(TOKENS.light.textRamp[0]);
  });
});

describe('CSS_TEXT overrides', () => {
  it('every key resolves to an existing TOKENS path with the same color', () => {
    for (const [path, cssText] of Object.entries(CSS_TEXT)) {
      const resolved: unknown = path
        .split('.')
        .reduce<unknown>(
          (node, key) => (node as Record<string, unknown>)[key],
          TOKENS
        );
      expect(typeof resolved, `${path} resolves to a TOKENS string`).toBe(
        'string'
      );
      expect(srgbLuminance(cssText)).toBe(srgbLuminance(resolved as string));
    }
  });
});
