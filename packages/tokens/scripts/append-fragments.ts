import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderFontSmoothing } from '../src/fragments.ts';

/**
 * Paths are relative to this script's own location, not the caller's cwd:
 * tui-kit's codegen chain invokes this as `bun run ../tokens/scripts/append-fragments.ts`
 * from packages/tui-kit, same convention as append-font-faces.ts.
 */
const THEME_CSS = join(
  import.meta.dirname,
  '..',
  '..',
  'tui-kit',
  'src',
  'generated',
  'theme.css'
);

/**
 * Runs after `soribashi build` (which fully overwrites theme.css) and
 * append-font-faces.ts, so the file never already carries this fragment --
 * a plain append is idempotent by construction here, unlike tokyo-theme.css.
 */
function main() {
  const generated = readFileSync(THEME_CSS, 'utf8');
  writeFileSync(
    THEME_CSS,
    `${generated.trimEnd()}\n\n${renderFontSmoothing()}\n`
  );
}

if (import.meta.main) {
  main();
}
