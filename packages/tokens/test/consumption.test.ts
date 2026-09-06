import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 1 controller ruling: a consumption failure is never fixed by deleting
 * the token here. Every name below is a real prior-run failure, waived with
 * the one-line reason that justifies keeping it definition-only for now.
 * Deletion is Phase 2 material.
 */
const WAIVED_TUI: Record<string, string> = {
  '--color-gray-muted':
    "raw muted token for non-text intents (StatusDot's/Badge's 'muted' variant and wash mixes reach it via intent-resolver.ts's FAMILY['muted'] === 'gray' branch, var(--color-gray-muted)), outside this test's CSS-module scope; --text-muted now reads --color-gray-mutedText instead, so this raw value has no remaining CSS-file reference.",
  '--muted-text':
    "new text-role alias mirroring tokyo's --tk-muted-text naming; existing recipes still read --muted (unaffected, same value) -- Phase 3 apps are the intended consumer of the explicit name.",
  '--accent-text':
    "new text-role alias mirroring tokyo's --tk-accent-text naming; no recipe paints link/accent text through it yet -- Phase 3 apps are the intended consumer.",
  '--red-text':
    "new text-role alias mirroring tokyo's --tk-red-text naming; no recipe paints error/bad text through it yet -- Phase 3 apps are the intended consumer.",
  '--chrome':
    "public alias contract (soribashi.config.ts's cssVariablesResolver + docs/css-contract.md); guaranteed for consumer apps regardless of this repo's own recipe usage.",
  '--dot-ok':
    "public alias contract (soribashi.config.ts's cssVariablesResolver + docs/css-contract.md); consumed via inline style in StatusDot.tsx, outside this test's CSS-module scope.",
  '--dot-warn':
    "public alias contract (soribashi.config.ts's cssVariablesResolver + docs/css-contract.md); consumed via inline style in StatusDot.tsx, outside this test's CSS-module scope.",
  '--dot-bad':
    "public alias contract (soribashi.config.ts's cssVariablesResolver + docs/css-contract.md); consumed via inline style in StatusDot.tsx, outside this test's CSS-module scope.",
  '--purple':
    "public alias contract (soribashi.config.ts's cssVariablesResolver + docs/css-contract.md); referenced only from Chip.test.tsx today.",
  '--terminal-bg':
    'scheme-invariant public alias for consumer terminal/log surfaces, documented in docs/css-contract.md; not consumed by any recipe in this repo.',
  '--terminal-fg':
    'scheme-invariant public alias for consumer terminal/log surfaces, documented in docs/css-contract.md; not consumed by any recipe in this repo.',
  '--terminal-border':
    'scheme-invariant public alias for consumer terminal/log surfaces, documented in docs/css-contract.md; not consumed by any recipe in this repo.',
  '--breakpoint-2xl':
    "soribashi's default breakpoint scale; only the framework's `utilities` visibility-class layer reads it, and soribashi.config.ts sets `utilities: false` because this kit emits no such classes.",
  '--breakpoint-3xl':
    "soribashi's default breakpoint scale; only the framework's `utilities` visibility-class layer reads it, and soribashi.config.ts sets `utilities: false` because this kit emits no such classes.",
  '--breakpoint-lg':
    "soribashi's default breakpoint scale; only the framework's `utilities` visibility-class layer reads it, and soribashi.config.ts sets `utilities: false` because this kit emits no such classes.",
  '--breakpoint-md':
    "soribashi's default breakpoint scale; only the framework's `utilities` visibility-class layer reads it, and soribashi.config.ts sets `utilities: false` because this kit emits no such classes.",
  '--breakpoint-sm':
    "soribashi's default breakpoint scale; only the framework's `utilities` visibility-class layer reads it, and soribashi.config.ts sets `utilities: false` because this kit emits no such classes.",
  '--breakpoint-xl':
    "soribashi's default breakpoint scale; only the framework's `utilities` visibility-class layer reads it, and soribashi.config.ts sets `utilities: false` because this kit emits no such classes.",
  '--breakpoint-xs':
    "soribashi's default breakpoint scale; only the framework's `utilities` visibility-class layer reads it, and soribashi.config.ts sets `utilities: false` because this kit emits no such classes.",
  '--font-size-base':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-lg':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-md':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; referenced only from *.visual.test.tsx / workshop pages today.",
  '--font-size-px9':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-px12':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-rem60':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-rem68':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-rem72':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-rem75':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-rem78':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-rem80':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-rem82':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--font-size-xxl':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the fontSize scale; this repo's currently-ported recipes do not reference this rung.",
  '--radius-xs':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the radius scale; this repo's currently-ported recipes do not reference this rung.",
  '--spacing-px10':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the spacing scale; this repo's currently-ported recipes do not reference this rung.",
  '--spacing-rem35':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the spacing scale; this repo's currently-ported recipes do not reference this rung.",
  '--spacing-rem80':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the spacing scale; this repo's currently-ported recipes do not reference this rung.",
  '--spacing-rem140':
    "ported wholesale from mr-board's real stylesheet census (docs/token-census.md, scripts/census.ts) into the spacing scale; this repo's currently-ported recipes do not reference this rung.",
  '--surface-wash-accent-7':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
  '--surface-wash-amber-7':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
  '--surface-wash-amber-45':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
  '--surface-wash-cyan-border-45':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
  '--surface-wash-cyan-panel-38':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
  '--surface-wash-fg-8':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
  '--surface-wash-panel-55':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
  '--surface-wash-panel-94':
    "theme.ts: 'every distinct color-mix() expression in mr-board's stylesheet, carried as RAW strings' -- ported verbatim from that external stylesheet, not yet used by a recipe in this repo.",
};

const WAIVED_TOKYO: Record<string, string> = {
  '--tk-red-text':
    "AA-compliant red TEXT role (>=4.5:1), mirrors --tk-muted-text/--tk-accent-text; packages/ui's --mantine-color-error still reads the raw --tk-red for the error surface, and no component paints red as inline text yet -- Phase 3 material.",
  '--tk-green':
    "declared for full parity with tui-kit's hue palette (tokyo-theme.css header: 'every hex below is tui-kit's exact string ... parity with tui-kit is by construction'); no packages/ui component wires this hue yet.",
  '--tk-amber':
    "declared for full parity with tui-kit's hue palette (tokyo-theme.css header: 'every hex below is tui-kit's exact string ... parity with tui-kit is by construction'); no packages/ui component wires this hue yet.",
  '--tk-purple':
    "declared for full parity with tui-kit's hue palette (tokyo-theme.css header: 'every hex below is tui-kit's exact string ... parity with tui-kit is by construction'); no packages/ui component wires this hue yet.",
  '--tk-cyan':
    "declared for full parity with tui-kit's hue palette (tokyo-theme.css header: 'every hex below is tui-kit's exact string ... parity with tui-kit is by construction'); no packages/ui component wires this hue yet.",
  '--tk-dot-ok':
    "declared for full parity with tui-kit's hue palette (tokyo-theme.css header: 'every hex below is tui-kit's exact string ... parity with tui-kit is by construction'); no packages/ui component wires this dot role yet.",
  '--tk-dot-warn':
    "declared for full parity with tui-kit's hue palette (tokyo-theme.css header: 'every hex below is tui-kit's exact string ... parity with tui-kit is by construction'); no packages/ui component wires this dot role yet.",
  '--tk-dot-bad':
    "declared for full parity with tui-kit's hue palette (tokyo-theme.css header: 'every hex below is tui-kit's exact string ... parity with tui-kit is by construction'); no packages/ui component wires this dot role yet.",
};

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

function definedVars(css: string): string[] {
  return [...css.matchAll(/^\s*(--[a-z0-9-]+):/gim)].map(m => m[1] as string);
}

/**
 * A `var(--x)` occurrence is never itself a definition line (definitions
 * always start the line with `--name:`), so any match here is a real
 * reference "beyond the definition" -- including one inside the same file
 * that defines the name, which is the intended reading of the consumption
 * rule for tokyo-theme.css's own rules.
 */
function referencedVars(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map(m => m[1] as string)
  );
}

function walk(
  dir: string,
  predicate: (path: string) => boolean,
  out: string[] = []
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, predicate, out);
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

function readAll(paths: string[]): string {
  return paths.map(p => readFileSync(p, 'utf8')).join('\n');
}

function isCss(path: string): boolean {
  return extname(path) === '.css';
}

function isUiSource(path: string): boolean {
  const ext = extname(path);
  return ext === '.ts' || ext === '.tsx' || ext === '.css';
}

describe('token consumption: tokyo', () => {
  const TOKYO_THEME_CSS = join(
    REPO_ROOT,
    'packages',
    'tokyo',
    'src',
    'tokyo-theme.css'
  );
  const themeCss = readFileSync(TOKYO_THEME_CSS, 'utf8');
  const defined = new Set(
    definedVars(themeCss).filter(name => name.startsWith('--tk-'))
  );

  const tokyoCssFiles = walk(
    join(REPO_ROOT, 'packages', 'tokyo', 'src'),
    isCss
  );
  const uiFiles = walk(join(REPO_ROOT, 'packages', 'ui', 'src'), isUiSource);
  const referenced = referencedVars(readAll([...tokyoCssFiles, ...uiFiles]));

  it('every --tk-* name defined in tokyo-theme.css is referenced or waived', () => {
    const unaccounted = [...defined]
      .filter(name => !referenced.has(name) && !(name in WAIVED_TOKYO))
      .sort();

    expect(
      unaccounted,
      unaccounted.length === 0
        ? undefined
        : `These --tk-* names are defined but never referenced beyond their definition, and are not in WAIVED_TOKYO: ${unaccounted.join(', ')}.`
    ).toEqual([]);
  });

  it('every WAIVED_TOKYO entry is a real defined-but-unreferenced name (no stale waivers)', () => {
    const stale = Object.keys(WAIVED_TOKYO).filter(
      name => !defined.has(name) || referenced.has(name)
    );
    expect(
      stale,
      stale.length === 0
        ? undefined
        : `These WAIVED_TOKYO entries no longer describe a real failure -- remove them: ${stale.join(', ')}.`
    ).toEqual([]);
  });
});

describe('token consumption: tui-kit', () => {
  const GENERATED_THEME_CSS = join(
    REPO_ROOT,
    'packages',
    'tui-kit',
    'src',
    'generated',
    'theme.css'
  );
  const themeCss = readFileSync(GENERATED_THEME_CSS, 'utf8');
  const defined = new Set(definedVars(themeCss));

  const canvasCss = readFileSync(
    join(REPO_ROOT, 'packages', 'tui-kit', 'src', 'canvas.css'),
    'utf8'
  );
  const recipeCssFiles = walk(
    join(REPO_ROOT, 'packages', 'tui-kit', 'src', 'recipes'),
    p => p.endsWith('.module.css')
  );
  const referenced = referencedVars(
    [themeCss, canvasCss, readAll(recipeCssFiles)].join('\n')
  );

  it('every custom property emitted in generated/theme.css is referenced or waived', () => {
    const unaccounted = [...defined]
      .filter(name => !referenced.has(name) && !(name in WAIVED_TUI))
      .sort();

    expect(
      unaccounted,
      unaccounted.length === 0
        ? undefined
        : `These custom properties are emitted but never referenced in src/recipes/**/*.module.css, src/canvas.css, or elsewhere in src/generated/theme.css, and are not in WAIVED_TUI: ${unaccounted.join(', ')}.`
    ).toEqual([]);
  });

  it('every WAIVED_TUI entry is a real defined-but-unreferenced name (no stale waivers)', () => {
    const stale = Object.keys(WAIVED_TUI).filter(
      name => !defined.has(name) || referenced.has(name)
    );
    expect(
      stale,
      stale.length === 0
        ? undefined
        : `These WAIVED_TUI entries no longer describe a real failure -- remove them: ${stale.join(', ')}.`
    ).toEqual([]);
  });
});
