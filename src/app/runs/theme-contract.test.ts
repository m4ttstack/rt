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
 */
describe('theme contract the run views depend on', () => {
  it('carries every spacing step the surfaces name', () => {
    expect(theme.spacing).toMatchObject({
      xs: '0.3rem',
      sm: '0.45rem',
      md: '0.6rem',
      lg: '0.7rem',
      xl: '0.9rem',
      xxl: '1.125rem',
      xxxl: '1.5rem',
    });
  });

  it('carries the radius steps the cards name', () => {
    expect(theme.radius).toMatchObject({ lg: '8px', xl: '10px' });
  });

  it('sizes every heading level, so no page title falls back to Mantine stock', () => {
    const sizes = theme.headings?.sizes;
    expect(sizes).toBeDefined();
    for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      expect(sizes?.[level]?.fontSize, `${level} fontSize`).toBeTruthy();
      expect(sizes?.[level]?.fontWeight, `${level} fontWeight`).toBeTruthy();
    }
    // The one that regressed in practice: an unsized h2 renders ~2x the
    // largest body step in this monospace kit and swallows its header row.
    expect(sizes?.h2?.fontSize).toBe('1.1rem');
  });
});
