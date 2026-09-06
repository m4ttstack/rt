import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import { GATE_KINDS } from '../gates/sweep.ts';

/** The wrapper skills declare gate kinds in prose (`--kind <k>` in their
    status-bin invocations) while the sweep/resume lifecycle maps key off
    GATE_KINDS. Nothing structural ties the two, so drift in either
    direction is silent until a gate opens with an unmapped kind. This
    test is the tie: exact set equality between every `--kind` token in
    skills/ and GATE_KINDS. */
const SKILLS_DIR = join(import.meta.dir, '..', '..', 'skills');

function declaredKinds(): Set<string> {
  const kinds = new Set<string>();
  for (const entry of readdirSync(SKILLS_DIR)) {
    const skillPath = join(SKILLS_DIR, entry, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    const text = readFileSync(skillPath, 'utf8');
    for (const m of text.matchAll(/--kind\s+([a-z][a-z-]*)/g)) {
      kinds.add(m[1]!);
    }
  }
  return kinds;
}

describe('gate kind sync (skills prose vs GATE_KINDS)', () => {
  test('every --kind the wrapper skills declare is a known GATE_KINDS member', () => {
    const declared = declaredKinds();
    const known = new Set<string>(GATE_KINDS);
    const unknown = [...declared].filter(k => !known.has(k));
    expect(unknown).toEqual([]);
  });

  test('every GATE_KINDS member is declared by some wrapper skill', () => {
    const declared = declaredKinds();
    const undeclared = GATE_KINDS.filter(k => !declared.has(k));
    expect(undeclared).toEqual([]);
  });

  test('the skills directory was actually scanned', () => {
    expect(declaredKinds().size).toBeGreaterThan(0);
  });
});
