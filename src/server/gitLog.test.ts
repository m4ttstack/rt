// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { GIT_LOG_FORMAT, parseGitLog } from './gitLog';

const RS = '\x1e';
const US = '\x1f';

/** Assembled the way git does under `--name-only`: the format's fields, then
    a blank line, then the paths. Two real commits from the demo pack. */
function record(
  fields: [string, string, string, string, string],
  files: string[]
): string {
  const head = RS + fields.join(US) + US;
  return files.length === 0 ? head : `${head}\n\n${files.join('\n')}\n`;
}

const RESTAMP = record(
  [
    'ed24bc4348aa6a6b5ad7c4bc9b8d263aac2375f6',
    'ed24bc4',
    '2026-08-21T21:47:31-05:00',
    'Matthew Goodwin',
    'pack: restamp self-referential fills at the registered 0.4.11 install',
  ],
  ['mattstack/packs/demo/skills/review/SKILL.md']
);

const RELEASE = record(
  [
    '17f827321cc1699dc1f40e4879ef45a42689fd65',
    '17f8273',
    '2026-08-21T21:46:52-05:00',
    'Matthew Goodwin',
    'pack: 0.4.11 — compiled verbs carry run-DB state (mattstack 0.8.0 fills)',
  ],
  [
    'mattstack/packs/demo/attachments/review-criteria/SKILL.md',
    'mattstack/packs/demo/skills/review/SKILL.md',
  ]
);

describe('GIT_LOG_FORMAT', () => {
  it('closes the field run so the file list cannot glue onto the subject', () => {
    expect(GIT_LOG_FORMAT.startsWith(RS)).toBe(true);
    expect(GIT_LOG_FORMAT.endsWith(US)).toBe(true);
    expect(GIT_LOG_FORMAT.split(US)).toHaveLength(6);
  });
});

describe('parseGitLog', () => {
  it('reads every field of a commit, files included', () => {
    expect(parseGitLog(RESTAMP)).toEqual([
      {
        sha: 'ed24bc4348aa6a6b5ad7c4bc9b8d263aac2375f6',
        shortSha: 'ed24bc4',
        authoredAt: '2026-08-21T21:47:31-05:00',
        author: 'Matthew Goodwin',
        subject:
          'pack: restamp self-referential fills at the registered 0.4.11 install',
        files: ['mattstack/packs/demo/skills/review/SKILL.md'],
      },
    ]);
  });

  it('keeps consecutive commits apart and in log order', () => {
    const parsed = parseGitLog(RESTAMP + RELEASE);

    expect(parsed.map(c => c.shortSha)).toEqual(['ed24bc4', '17f8273']);
    expect(parsed[1].files).toEqual([
      'mattstack/packs/demo/attachments/review-criteria/SKILL.md',
      'mattstack/packs/demo/skills/review/SKILL.md',
    ]);
    expect(parsed[1].subject).toBe(
      'pack: 0.4.11 — compiled verbs carry run-DB state (mattstack 0.8.0 fills)'
    );
  });

  it('reads a commit that touched no files as a commit with no files', () => {
    const parsed = parseGitLog(
      record(
        ['a'.repeat(40), 'aaaaaaa', '2026-08-21T00:00:00-05:00', 'M', 'x'],
        []
      )
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].files).toEqual([]);
    expect(parsed[0].subject).toBe('x');
  });

  it('keeps a subject whole when it carries the field separator itself', () => {
    const parsed = parseGitLog(
      record(
        [
          'b'.repeat(40),
          'bbbbbbb',
          '2026-08-21T00:00:00-05:00',
          'M',
          `before${US}after`,
        ],
        ['PACK.md']
      )
    );

    expect(parsed[0].subject).toBe(`before${US}after`);
    expect(parsed[0].files).toEqual(['PACK.md']);
  });

  it('drops a truncated record instead of returning it half-filled', () => {
    const truncated = RS + ['abc', 'abc'].join(US);

    expect(parseGitLog(truncated + RESTAMP).map(c => c.shortSha)).toEqual([
      'ed24bc4',
    ]);
  });

  it('does not invent a commit out of empty output', () => {
    expect(parseGitLog('')).toEqual([]);
    expect(parseGitLog('\n')).toEqual([]);
  });
});
