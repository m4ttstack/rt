import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The `--tk-*` declarations now live in the package this app consumes them
// from; `tokyo-theme.css` alongside this test is just an `@import` of it.
const css = readFileSync(
  join(__dirname, '../../../packages/mantine-tokyo/src/tokyo-theme.css'),
  'utf8'
);

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
    expect(light.length).toBe(20);
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

  /** One face carrying the whole axis, not four fixed weights: a variable
      woff2 the browser interpolates from. A rule pinned to a single weight
      would silently synthesise the others. */
  it('vendors JetBrains Mono as one variable face spanning 100-800', () => {
    expect(css).toContain('/fonts/jetbrains-mono.woff2');
    expect(css).toMatch(/font-weight:\s*100 800/);
    expect(css.match(/@font-face/g) ?? []).toHaveLength(1);
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
