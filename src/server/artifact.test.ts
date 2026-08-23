// @vitest-environment node
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EXCERPT_LINES, readExcerpt } from './artifact';

const root = mkdtempSync(join(tmpdir(), 'console-artifact-'));

describe('readExcerpt', () => {
  it('returns the last EXCERPT_LINES lines of a long file', () => {
    const path = join(root, 'long.log');
    writeFileSync(
      path,
      Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    );

    const out = readExcerpt(path, root);

    expect(out.truncated).toBe(true);
    expect(out.lines).toHaveLength(EXCERPT_LINES);
    expect(out.lines.at(-1)).toBe('line 199');
  });

  it('returns a short file whole and marks it untruncated', () => {
    const path = join(root, 'short.log');
    writeFileSync(path, 'only line');

    expect(readExcerpt(path, root)).toEqual({
      lines: ['only line'],
      truncated: false,
    });
  });

  it('refuses a path that escapes the root', () => {
    expect(() =>
      readExcerpt(join(root, '..', '..', 'etc', 'passwd'), root)
    ).toThrow(/outside/i);
  });

  it('refuses a path that escapes the root via a symlink-shaped string', () => {
    expect(() => readExcerpt(`${root}/../sneaky.log`, root)).toThrow(
      /outside/i
    );
  });

  it('reports a missing file as a normal absence, not a crash', () => {
    expect(readExcerpt(join(root, 'nope.log'), root)).toEqual({
      lines: [],
      truncated: false,
    });
  });
});
