import { readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { expect, test } from 'bun:test';

import { ROOT } from './helpers.ts';

// A test that resolves the repo root reads other packages from disk, which
// turbo's per-package hash cannot see; it must declare $TURBO_ROOT$ inputs.
const REACHES_ROOT =
  /import\.meta\.dirname,\s*(['"])\.\.\1,\s*\1\.\.\1,\s*\1\.\.\1/;

function packageOf(file: string): string {
  const [kind, name] = relative(ROOT, file).split(sep);
  const pkg = JSON.parse(
    readFileSync(join(ROOT, kind, name, 'package.json'), 'utf8')
  );
  return pkg.name as string;
}

test('every test that reads outside its package declares $TURBO_ROOT$ inputs', () => {
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  const glob = new Bun.Glob('{apps,packages}/*/**/*.test.{ts,tsx}');
  const offenders: string[] = [];
  for (const rel of glob.scanSync(ROOT)) {
    if (rel.includes('/node_modules/')) continue;
    const file = join(ROOT, rel);
    if (!REACHES_ROOT.test(readFileSync(file, 'utf8'))) continue;
    const inputs: string[] =
      turbo.tasks[`${packageOf(file)}#test`]?.inputs ?? [];
    if (!inputs.some(i => i.startsWith('$TURBO_ROOT$/'))) offenders.push(rel);
  }
  expect(offenders).toEqual([]);
});
