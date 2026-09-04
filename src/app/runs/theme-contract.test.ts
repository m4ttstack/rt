import { theme } from '@mattstack/app-kit/design-system';
import { describe, expect, it } from 'vitest';

/**
 * The run views consume theme keys BY NAME (`px="xxl"`, `p="xxxl"`,
 * `--mantine-radius-lg/xl`, an `h2` page title). Mantine resolves an unknown
 * spacing name to the literal string, so a dropped key does not throw or
 * fail a type check -- it silently renders `padding: xxxl` and the surface
 * quietly collapses back to unpadded.
 *
 * That is the exact failure mode of moving this theme into its own package:
 * a hand-transcribed ladder that loses one row. A static-mock parity capture
 * cannot see it, because the mocks never resolve the real theme. This does.
 *
 * Asserted structurally, never by literal value: the kit retunes this ladder
 * whenever the body font changes, and a test that pins `1.1rem` fails on a
 * deliberate retune while catching nothing a shape check misses.
 */

interface Length {
  value: number;
  unit: string;
}

/** Pure, so the guards below can be tested against synthetic input rather
    than only against whatever the kit currently ships. */
function parseLength(value: string | undefined): Length | null {
  const match = /^([\d.]+)(rem|em|px)$/.exec((value ?? '').trim());
  if (!match) return null;
  const size = Number(match[1]);
  return size > 0 ? { value: size, unit: match[2] } : null;
}

/**
 * Every step resolves to a CSS length, and all of them share one unit.
 *
 * The shared unit is the point: comparing raw numbers across units is
 * meaningless, since 4px is smaller than 0.45rem while 4 is larger than
 * 0.45. A ladder that mixes units cannot be ordered at all, so this reports
 * that rather than ordering the numbers and drawing a confident wrong
 * conclusion.
 */
function ladder(
  labels: readonly string[],
  values: readonly (string | undefined)[]
): number[] {
  const parsed = values.map((value, i) => {
    const length = parseLength(value);
    expect(
      length,
      `${labels[i]} is a CSS length, got ${String(value)}`
    ).not.toBeNull();
    return length as Length;
  });

  const units = [...new Set(parsed.map(length => length.unit))];
  expect(
    units,
    `${labels.join('/')} share one unit, got ${units.join(' and ')}`
  ).toHaveLength(1);

  return parsed.map(length => length.value);
}

const SPACING_STEPS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'xxxl'] as const;

const HEADING_LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * A ladder that reverted to Mantine stock lands h1 at ~2.3x the largest body
 * step; one landed on this kit's body scale sits near 1.5x. Two is the gap
 * between them, so a retune for a new body font passes and a lost ladder
 * does not.
 */
const MAX_H1_TO_BODY_RATIO = 2;

function headingSize(
  level: (typeof HEADING_LEVELS)[number]
): string | undefined {
  return theme.headings?.sizes?.[level]?.fontSize as string | undefined;
}

describe('theme contract the run views depend on', () => {
  it('carries every spacing step the surfaces name, in one unit', () => {
    ladder(
      SPACING_STEPS,
      SPACING_STEPS.map(step => theme.spacing?.[step])
    );
  });

  it('orders the spacing ladder, so no step collapses into its neighbour', () => {
    const sizes = ladder(
      SPACING_STEPS,
      SPACING_STEPS.map(step => theme.spacing?.[step])
    );
    for (let i = 1; i < sizes.length; i++) {
      expect(
        sizes[i],
        `spacing.${SPACING_STEPS[i]} exceeds ${SPACING_STEPS[i - 1]}`
      ).toBeGreaterThan(sizes[i - 1]);
    }
  });

  it('carries the radius steps the cards name', () => {
    ladder(['radius.lg', 'radius.xl'], [theme.radius?.lg, theme.radius?.xl]);
  });

  it('sizes every heading level, so no page title falls back to Mantine stock', () => {
    ladder(HEADING_LEVELS, HEADING_LEVELS.map(headingSize));
    for (const level of HEADING_LEVELS) {
      expect(
        theme.headings?.sizes?.[level]?.fontWeight,
        `${level} fontWeight`
      ).toBeTruthy();
    }
  });

  it('descends the heading ladder, so h2 never outgrows h1', () => {
    const sizes = ladder(HEADING_LEVELS, HEADING_LEVELS.map(headingSize));
    for (let i = 1; i < sizes.length; i++) {
      expect(
        sizes[i],
        `${HEADING_LEVELS[i]} is smaller than ${HEADING_LEVELS[i - 1]}`
      ).toBeLessThan(sizes[i - 1]);
    }
  });

  /**
   * The one that regressed in practice: an unsized h2 renders about twice the
   * largest body step and swallows its own header row. The guard is the
   * relationship, not the number, so it survives a font retune.
   */
  it('lands the heading ladder on the body scale, not Mantine stock', () => {
    const [bodyTop, h1] = ladder(
      ['fontSizes.xl', 'h1'],
      [theme.fontSizes?.xl, headingSize('h1')]
    );
    expect(h1 / bodyTop).toBeLessThan(MAX_H1_TO_BODY_RATIO);
  });
});

describe('the length guard itself', () => {
  it('reads the units this kit ships', () => {
    expect(parseLength('0.45rem')).toEqual({ value: 0.45, unit: 'rem' });
    expect(parseLength('8px')).toEqual({ value: 8, unit: 'px' });
  });

  it('rejects a key that survived as a bare name or went missing', () => {
    expect(parseLength('xxxl')).toBeNull();
    expect(parseLength(undefined)).toBeNull();
    expect(parseLength('0rem')).toBeNull();
  });

  /**
   * Without this the ladder assertions would compare 4 against 0.45 and call
   * a px step larger than a rem one four times its size.
   */
  it('refuses to order a ladder that mixes units', () => {
    expect(() => ladder(['a', 'b'], ['4px', '0.45rem'])).toThrow();
    expect(() => ladder(['a', 'b'], ['0.3rem', '0.45rem'])).not.toThrow();
  });
});
