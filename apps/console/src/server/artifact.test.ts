// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

    const out = readExcerpt(path, [root]);

    expect(out.truncated).toBe(true);
    expect(out.lines).toHaveLength(EXCERPT_LINES);
    expect(out.lines.at(-1)).toBe('line 199');
  });

  it('returns a short file whole and marks it untruncated', () => {
    const path = join(root, 'short.log');
    writeFileSync(path, 'only line');

    expect(readExcerpt(path, [root])).toEqual({
      lines: ['only line'],
      truncated: false,
    });
  });

  it('refuses a path that escapes the root', () => {
    expect(() =>
      readExcerpt(join(root, '..', '..', 'etc', 'passwd'), [root])
    ).toThrow(/outside/i);
  });

  it('refuses a `..` escape written as a literal string rather than joined via path.join', () => {
    expect(() => readExcerpt(`${root}/../sneaky.log`, [root])).toThrow(
      /outside/i
    );
  });

  it('reports a missing file as a normal absence, not a crash', () => {
    expect(readExcerpt(join(root, 'nope.log'), [root])).toEqual({
      lines: [],
      truncated: false,
    });
  });

  // A prefix comparison (`abs.startsWith(resolve(root))`) would wrongly
  // admit a sibling directory whose name merely starts with the root's
  // name -- `run-1-evil` string-starts-with `run-1` even though it is not
  // inside it. Resolving + relative() is what tells them apart.
  it('refuses a sibling directory that string-prefixes the root (run-1 vs run-1-evil)', () => {
    const runRoot = join(root, 'run-1');
    mkdirSync(runRoot, { recursive: true });
    const evilDir = join(root, 'run-1-evil');
    mkdirSync(evilDir, { recursive: true });
    const evilFile = join(evilDir, 'secret.log');
    writeFileSync(evilFile, 'not yours');

    expect(() => readExcerpt(evilFile, [runRoot])).toThrow(/outside/i);
  });

  it('allows a path under a second root when the first root refuses it', () => {
    const worktree = mkdtempSync(join(tmpdir(), 'console-worktree-'));
    const path = join(worktree, 'triage.md');
    writeFileSync(path, 'triage notes');

    expect(readExcerpt(path, [root, worktree])).toEqual({
      lines: ['triage notes'],
      truncated: false,
    });
  });

  it('refuses a path outside every given root', () => {
    const worktree = mkdtempSync(join(tmpdir(), 'console-worktree-'));
    const elsewhere = mkdtempSync(join(tmpdir(), 'console-elsewhere-'));
    const path = join(elsewhere, 'secret.log');
    writeFileSync(path, 'not yours');

    expect(() => readExcerpt(path, [root, worktree])).toThrow(/outside/i);
  });
});
