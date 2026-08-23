import { readFileSync } from 'node:fs';
import path from 'node:path';

import { staticSchemeColors } from '../hooks/useSchemeColors';

// Contract test for the scheme-vars layer: jsdom does not reliably cascade
// custom properties, so instead of getComputedStyle this reads
// scheme-vars.css as text and asserts the contract `useSchemeColors` depends
// on. The var list is derived from `staticSchemeColors` itself, so hook and
// stylesheet can't drift apart without this failing. Deliberately not a
// snapshot: re-pointing a slot to a different Mantine var (a supported
// re-theme, see AGENTS.md section 4) must keep passing.
//
// The stylesheet is two layers -- kit-owned `--ui-base-*` values per scheme,
// and the live `--ui-*` slots an app may remap -- so the contract is that
// every live slot has a base counterpart, and that `.ui-base-surfaces` can
// restore all of them at once.

// vitest (per vite.config.ts) runs with the repo root as cwd, so this path
// is stable regardless of which file imports/runs this test.
const CSS_PATH = path.resolve(process.cwd(), 'src/ui/styles/scheme-vars.css');
const css = readFileSync(CSS_PATH, 'utf-8');

const SCHEMES = ['light', 'dark'] as const;

function block(selectorPattern: string, label: string): string {
  const match = css.match(new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`));
  if (!match) {
    throw new Error(`scheme-vars.css has no ${label} block`);
  }
  return match[1];
}

const schemeBlock = (scheme: (typeof SCHEMES)[number]) =>
  block(
    `:root\\[data-mantine-color-scheme='${scheme}'\\]`,
    `:root[data-mantine-color-scheme='${scheme}']`
  );

/** The live-slot block: `:root {`, not `:root[data-...]`. */
const slotBlock = () => block(':root(?!\\[)', ':root');

const restoreBlock = () => block('\\.ui-base-surfaces', '.ui-base-surfaces');

function declarations(blockBody: string): Map<string, string> {
  return new Map(
    Array.from(blockBody.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g), m => [
      m[1],
      m[2].trim(),
    ])
  );
}

/** `'var(--ui-bg-1)'` -> `'--ui-bg-1'`; throws if a token ever stops being a
 * bare var() reference, so the derivation below can't silently skip one. */
function varName(token: string): string {
  const match = token.match(/^var\((--[\w-]+)\)$/);
  if (!match) {
    throw new Error(
      `useSchemeColors token ${token} is not a bare var() reference`
    );
  }
  return match[1];
}

/** `--ui-bg-1` -> `--ui-base-bg-1`: the kit-owned counterpart of a live slot. */
const baseName = (name: string) => name.replace(/^--ui-/, '--ui-base-');

// The token groups now hold both fixed CSS strings and color-taking
// helper functions (bg.color, bg.lightened, text.highContrast, border.*);
// only the fixed strings name a var this file has to define.
const fixedTokens = (group: Record<string, unknown>): string[] =>
  Object.values(group).filter((value): value is string => {
    return typeof value === 'string' && value.startsWith('var(');
  });

const hookVars = [
  ...fixedTokens(staticSchemeColors.bg),
  ...fixedTokens(staticSchemeColors.text),
].map(varName);

const liveVars = [
  ...new Set([
    ...hookVars.filter(name => name.startsWith('--ui-')),
    '--ui-bg-1',
    '--ui-bg-2',
    '--ui-bg-3',
    '--ui-bg-4',
  ]),
];

test('light and dark scheme blocks both exist', () => {
  for (const scheme of SCHEMES) {
    expect(schemeBlock(scheme)).toBeTruthy();
  }
});

test('each scheme block defines the base counterpart of every live slot', () => {
  for (const scheme of SCHEMES) {
    const defined = declarations(schemeBlock(scheme));
    for (const name of liveVars) {
      expect(
        defined.has(baseName(name)),
        `${scheme} block is missing ${baseName(name)}`
      ).toBe(true);
    }
  }
});

test('every live slot points at its base counterpart by default', () => {
  const slots = declarations(slotBlock());
  for (const name of liveVars) {
    expect(slots.get(name), `:root does not define ${name}`).toBe(
      `var(${baseName(name)})`
    );
  }
});

test('.ui-base-surfaces restores every live slot to the base ramp', () => {
  // This is what lets a subtree of a re-themed app get the kit's surfaces
  // back as one class instead of hand-copying the values out of the kit.
  const restored = declarations(restoreBlock());
  for (const name of liveVars) {
    expect(
      restored.get(name),
      `.ui-base-surfaces does not restore ${name}`
    ).toBe(`var(${baseName(name)})`);
  }
});

test('no base var reads a live slot, so an app remap cannot make a cycle', () => {
  // A CSS cycle makes every property in it invalid at computed-value time
  // and both sides silently fall back to their initial value. The specific
  // trap: the kit used to write `--ui-bg-1: var(--mantine-color-body)` while
  // a remapping app naturally writes the inverse.
  for (const scheme of SCHEMES) {
    for (const [name, value] of declarations(schemeBlock(scheme))) {
      if (!name.startsWith('--ui-base-')) continue;
      expect(
        /var\(--ui-(?!base-)/.test(value),
        `${name} in the ${scheme} block reads a live --ui-* slot (${value})`
      ).toBe(false);
      expect(
        value.includes('--mantine-color-body'),
        `${name} in the ${scheme} block reads --mantine-color-body, which a remapping app points back at this ramp`
      ).toBe(false);
    }
  }
});

test('color scheme-vars reference Mantine color vars (scheme-aware, no literals)', () => {
  for (const scheme of SCHEMES) {
    for (const [name, value] of declarations(schemeBlock(scheme))) {
      // Non-color tokens (shadows) are inherently literal rgba stacks; the
      // rule is about COLOR slots never hardcoding a hex/rgb value, which
      // would freeze them to one scheme.
      if (!/^--ui-base-(bg|text)-/.test(name)) continue;
      expect(
        /var\(--mantine-color-[\w-]+\)/.test(value),
        `${name} in the ${scheme} block (${value}) does not reference a --mantine-color-* var`
      ).toBe(true);
    }
  }
});

test('both scheme blocks define the same var names', () => {
  const [light, dark] = SCHEMES.map(scheme =>
    [...declarations(schemeBlock(scheme)).keys()].sort()
  );
  // A token defined in only one block silently falls back to whatever the
  // other scheme inherited -- the most common way these drift.
  expect(light).toEqual(dark);
});
