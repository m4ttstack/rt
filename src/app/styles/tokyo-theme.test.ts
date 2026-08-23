import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'tokyo-theme.css'), 'utf8');

/** Declarations inside the block whose selector is exactly `selector`. */
function blockFor(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no block for ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

function varNames(block: string): string[] {
  return [...block.matchAll(/--tk-[\w-]+/g)].map(m => m[0]).sort();
}

describe('tokyo-theme.css', () => {
  it('declares the same --tk-* names in both schemes', () => {
    const light = varNames(
      blockFor(":root[data-mantine-color-scheme='light']")
    );
    const dark = varNames(blockFor(":root[data-mantine-color-scheme='dark']"));

    expect(light).toEqual(dark);
    expect(light.length).toBe(19);
  });

  /** Mantine derives `-light` by parsing a tuple shade into `rgba()`; every
      tuple here is `var(--tk-*)`, which that parse cannot read, so it emits
      the hue for both the fill and the label -- a `variant="light"` Badge or
      Alert renders same-on-same and its text vanishes. */
  it('restates the light-variant wash for every hue, so light variants stay readable', () => {
    for (const [name, hue] of [
      ['accent', '--tk-accent'],
      ['ok', '--tk-green'],
      ['warn', '--tk-amber'],
      ['bad', '--tk-red'],
      ['purple', '--tk-purple'],
      ['cyan', '--tk-cyan'],
    ]) {
      expect(css, `${name} has no light wash`).toMatch(
        new RegExp(
          `--mantine-color-${name}-light:\\s*color-mix\\(\\s*in srgb,\\s*var\\(${hue}\\) var\\(--tk-wash\\)`
        )
      );
      expect(css).toContain(
        `--mantine-color-${name}-light-color: var(${hue});`
      );
      expect(css, `${name} has no light hover`).toContain(
        `--mantine-color-${name}-light-hover:`
      );
    }
  });

  it("carries tui-kit's exact Tokyo Day and Tokyo Night values", () => {
    const light = blockFor(":root[data-mantine-color-scheme='light']");
    const dark = blockFor(":root[data-mantine-color-scheme='dark']");

    expect(light).toContain('--tk-bg: #e1e2e7;');
    expect(light).toContain('--tk-accent: #2e7de9;');
    expect(light).toContain('--tk-fg: #111;');
    expect(dark).toContain('--tk-bg: #16161e;');
    expect(dark).toContain('--tk-accent: #7aa2f7;');
    expect(dark).toContain('--tk-fg: #e3e7f6;');
  });

  it('remaps the live --ui-* slots and never DECLARES a --ui-base-* one', () => {
    expect(css).toContain('--ui-bg-1: var(--tk-bg);');
    expect(css).toContain('--ui-bg-2: var(--tk-panel);');
    expect(css).toContain('--ui-bg-3: var(--tk-card);');
    // Scoped to declarations: the file MENTIONS --ui-base-* in a comment
    // explaining that the layer stays kit-owned, and a bare `not.toContain`
    // fails on that prose.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(
      /--ui-base-[\w-]+\s*:/
    );
  });

  it('vendors Tomorrow at the four weights tui-kit ships', () => {
    for (const weight of [400, 500, 600, 700]) {
      expect(css).toContain(`/fonts/tomorrow-${weight}.woff2`);
    }
  });

  // PageShell's root and RailShell's AppShell.Main both fill the viewport
  // with an opaque, identically-colored `bg.level1`, so a grid painted on
  // `body` (their shared ancestor) is permanently covered -- it has to live
  // on `#page-shell-content`, the first surface downstream of those fills
  // that every route actually renders into, and it has to beat that
  // surface's own inline `bg` style, which only `!important` can do.
  it('paints the grid on the page-shell content surface, not body', () => {
    const bodyBlock = blockFor('body');
    expect(bodyBlock).not.toContain('background-image');
    expect(bodyBlock).not.toContain('--tk-grid-line');

    const contentBlock = blockFor('#page-shell-content');
    expect(contentBlock).toContain('--tk-grid-line');
    expect(contentBlock).toMatch(/background-image:[\s\S]*!important/);
    expect(contentBlock).toContain('background-attachment: fixed !important');
  });
});
