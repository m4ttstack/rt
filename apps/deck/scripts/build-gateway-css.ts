import { join } from 'path';

import { tuiTheme } from '@mattstack/tui-kit/theme';

const ROOT = join(import.meta.dir, '..');

// Gateway pages ship zero client JS, so they lean on exactly these seven
// tokens (never a full kit recipe), named as the ramp names gateway-pages.tsx
// reads. Non-null: theme.ts declares every family/shade below for both light
// and dark, so an absent one is a theme regression, not a normal runtime case.
function readTokens(colors: typeof tuiTheme.tokens.colors) {
  return {
    page: colors.surface!.bg!,
    panel: colors.surface!.panel!,
    'text-1': colors.ink!['1']!,
    border: colors.line!.border!,
    'fill-accent': colors.blue!['500']!,
    'text-accent': colors.blue!['text']!,
    'text-bad-vivid': colors.red!['textVivid']!,
  };
}

function varsBlock(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(' ');
}

export function buildGatewayCss(): string {
  const light = readTokens(tuiTheme.tokens.colors);
  const dark = readTokens(
    tuiTheme.dark.colors! as typeof tuiTheme.tokens.colors
  );
  return `:root { ${varsBlock(light)} }
@media (prefers-color-scheme: dark) { :root { ${varsBlock(dark)} } }
`;
}

if (import.meta.main) {
  await Bun.write(join(ROOT, 'core/generated/gateway.css'), buildGatewayCss());
  console.log('core/generated/gateway.css written');
}
