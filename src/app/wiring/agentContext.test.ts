import { describe, expect, it } from 'vitest';

import { buildAgentContext } from './agentContext';

// Brief fixture, kept verbatim: a plugin-relative-looking path with no
// composition source attached, so every case below exercises the labelled
// fallback -- the primary (composition-path) branch gets its own fixtures
// further down.
const VERB = {
  name: 'watch-ci',
  engineRef: 'mattstack:watch-ci',
  description: 'Watch CI',
};
const GOOD_SEAM = {
  kind: 'step' as const,
  slot: null,
  ref: 'mattstack:watch-ci',
  version: '1.2.0',
  path: 'skills/watch-ci/SKILL.md',
  lines: [8, 42] as [number, number],
};

describe('buildAgentContext', () => {
  it('the copied context names real source paths and line spans, never invented ones', () => {
    const ctx = buildAgentContext({ verb: VERB, seams: [GOOD_SEAM] });

    expect(ctx).toContain('skills/watch-ci/SKILL.md:8-42');
    expect(ctx).toContain('watch-ci');
  });

  it('a seam that failed to parse is omitted, and the good ones still appear', () => {
    const ctx = buildAgentContext({ verb: VERB, seams: [GOOD_SEAM, null] });

    // Both halves matter. The negative alone passes for an empty string or a
    // builder that emits no spans at all, which is why the positive is here.
    expect(ctx).toContain('skills/watch-ci/SKILL.md:8-42');
    expect(ctx).not.toMatch(/undefined|NaN|:0-0/);
  });

  it('prints the bare engine plus engineError, never the literal string "null", when engineRef failed to load', () => {
    const ctx = buildAgentContext({
      verb: {
        name: 'watch-ci',
        engine: 'watch-ci',
        engineRef: null,
        engineError: 'module not found',
      },
      seams: [],
    });

    expect(ctx).toContain('watch-ci');
    expect(ctx).toContain('module not found');
    expect(ctx).not.toMatch(/\bnull\b/);
  });

  it('a seam whose composition path is unknown gets a labelled fallback line, never a bare relative path that looks resolvable', () => {
    const ctx = buildAgentContext({ verb: VERB, seams: [GOOD_SEAM] });

    const line = ctx
      .split('\n')
      .find(l => l.includes('skills/watch-ci/SKILL.md:8-42'));
    expect(line).toBeDefined();
    // Falsify by dropping the label: the line above would still contain the
    // path:span substring, so the label -- not the path -- is what this
    // assertion pins.
    expect(line).toMatch(/plugin-relative|unresolved/i);
  });

  it('uses the composition absolute path when the verb carries one, paired by seam kind -- not the seam own plugin-relative path', () => {
    const ctx = buildAgentContext({
      verb: {
        name: 'watch-ci',
        engineRef: 'mattstack:watch-ci',
        sourcePath: '/plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md',
      },
      seams: [GOOD_SEAM],
    });

    expect(ctx).toContain(
      '/plugins/mattstack/attachments/pipeline/watch-ci/SKILL.md:8-42'
    );
    // The composition path won, so the seam's own plugin-relative path never
    // appears as a path:span pair -- it would name the wrong root directory.
    expect(ctx).not.toContain('skills/watch-ci/SKILL.md:8-42');
  });

  it('pairs a slot seam to its fill by slot NAME, not by comparing path strings, index, or substring overlap', () => {
    const slotSeam = {
      kind: 'slot' as const,
      slot: 'tiering',
      ref: 'mattstack:model-tiering',
      version: '0.4.0',
      path: 'attachments/model-tiering/SKILL.md',
      lines: [8, 117] as [number, number],
    };

    const ctx = buildAgentContext({
      verb: {
        name: 'watch-ci',
        engineRef: 'mattstack:watch-ci',
        slots: [
          // The target slot is SECOND, not first -- an implementation that
          // pairs by index (verb.slots[0]) rather than by matching
          // `seam.slot` against `slot.name` would grab this row instead.
          {
            name: 'domain',
            boundTo: 'mattstack:watch-ci-domain',
            fillSourcePath:
              '/plugins/mattstack/attachments/model-tiering/SKILL.md',
          },
          {
            name: 'tiering',
            boundTo: 'mattstack:model-tiering',
            // No suffix in common with the seam's own `path` string
            // ('attachments/model-tiering/SKILL.md') -- an implementation
            // that pairs by suffix/substring overlap between the seam's
            // plugin-relative path and a slot's absolute one, instead of by
            // `name`, would fail to match this row (or would wrongly match
            // the `domain` row above, whose fillSourcePath DOES share that
            // suffix).
            fillSourcePath: '/vendor/tiering-source/NOTES.txt',
          },
        ],
      },
      seams: [slotSeam],
    });

    expect(ctx).toContain('/vendor/tiering-source/NOTES.txt:8-117');
    expect(ctx).toContain('tiering');
    // Neither the other slot's path nor the seam's own plugin-relative path
    // appears as the resolved span -- confirms the match was `tiering`'s row
    // specifically, not the first slot or a suffix-overlap coincidence.
    expect(ctx).not.toContain(
      '/plugins/mattstack/attachments/model-tiering/SKILL.md:8-117'
    );
    expect(ctx).not.toContain('attachments/model-tiering/SKILL.md:8-117');
  });

  it('lists bound fills from the verb slots', () => {
    const ctx = buildAgentContext({
      verb: {
        name: 'watch-ci',
        engineRef: 'mattstack:watch-ci',
        slots: [
          {
            name: 'tiering',
            boundTo: 'mattstack:model-tiering',
            fillSourcePath:
              '/plugins/mattstack/attachments/model-tiering/SKILL.md',
          },
        ],
      },
      seams: [],
    });

    expect(ctx).toContain('tiering');
    expect(ctx).toContain('mattstack:model-tiering');
  });
});
