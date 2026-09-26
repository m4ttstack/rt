import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { RADIX, RADIX_SCALES, RADIX_VERSION } from '../src/radix.ts';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@radix-ui/colors/package.json'));
const installedVersion = (
  JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

function stepsFromCss(file: string, name: string): string[] {
  const css = readFileSync(join(pkgDir, file), 'utf8');
  const out: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const m = new RegExp(`--${name}-${i}: (#[0-9a-f]{6});`).exec(css);
    if (!m) throw new Error(`${file}: no --${name}-${i}`);
    out.push(m[1]!);
  }
  return out;
}

describe('vendored Radix scales', () => {
  it('records the installed package version', () => {
    expect(RADIX_VERSION).toBe(installedVersion);
  });

  it.each(RADIX_SCALES)(
    '%s matches the installed package in both schemes',
    name => {
      expect([...RADIX[name].light]).toEqual(stepsFromCss(`${name}.css`, name));
      expect([...RADIX[name].dark]).toEqual(
        stepsFromCss(`${name}-dark.css`, name)
      );
    }
  );
});
