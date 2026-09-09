import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// apps/board root, regardless of where bun invokes this file from.
const BOARD_ROOT = join(import.meta.dir, '..', '..');
const ROOTS = ['src', 'bin'];
const ALLOWED = new Set([
  'src/state/db.ts',
  'src/state/legacy-import.ts',
  'src/state/agent-states.ts',
]);

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.ts')) yield p;
  }
}

describe('state purity', () => {
  test("no module outside src/state joins a 'state' path under APP_ROOT", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(BOARD_ROOT, root))) {
        const rel = file.slice(BOARD_ROOT.length + 1);
        if (ALLOWED.has(rel) || rel.includes('__tests__')) continue;
        const src = readFileSync(file, 'utf8');
        if (/join\(APP_ROOT,\s*'state'/.test(src)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
