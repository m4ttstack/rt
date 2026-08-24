import { describe, expect, it } from 'vitest';

import {
  comparedVerbCount,
  isAttentionOnly,
  onlyNeedsAttention,
  WIRING_ATTENTION_HREF,
} from './attentionFilter';
import {
  buildSpine,
  type OutlineCheck,
  type SpineComposition,
} from './outline';

function verb(name: string, over: Partial<SpineComposition['verbs'][number]>) {
  return {
    name,
    engine: name,
    engineRef: `mattstack:${name}`,
    plugin: 'mattstack',
    description: name,
    public: true,
    sourcePath: `/steps/${name}/SKILL.md`,
    artifactPath: `/p/skills/${name}`,
    slots: [],
    ...over,
  } as SpineComposition['verbs'][number];
}

/** An orchestrator, a two-stage pipeline, an outside verb, and a fill
    nothing binds -- enough that a filter which forgot the pipeline order, or
    which reached into the wrong list, produces a visibly wrong answer. */
const PACK: SpineComposition = {
  verbs: [verb('work', {}), verb('ship', {}), verb('rebase-worktree', {})],
  fills: [
    {
      binding: 'demo:unused',
      provides: 'unused@1',
      sourcePath: '/fills/unused',
      registered: false,
    },
  ],
  binders: [
    { ref: 'mattstack:work', verb: 'work', kind: 'verb', slots: [] },
    { ref: 'mattstack:stage-provision', verb: null, kind: 'stage', slots: [] },
    { ref: 'mattstack:stage-ship', verb: null, kind: 'stage', slots: [] },
  ],
  pipelines: {
    feature: ['mattstack:stage-provision', 'mattstack:stage-ship'],
  },
};

const CHECK: OutlineCheck = {
  verbs: [
    {
      name: 'work',
      status: 'stale',
      staleFiles: ['SKILL.md'],
      orphanFiles: [],
    },
    { name: 'ship', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    {
      name: 'rebase-worktree',
      status: 'never-compiled',
      staleFiles: [],
      orphanFiles: [],
    },
  ],
};

describe('isAttentionOnly', () => {
  it('is on only for the param the rail badge links with', () => {
    expect(
      isAttentionOnly(new URL(WIRING_ATTENTION_HREF, 'http://x').search)
    ).toBe(true);
    expect(isAttentionOnly('')).toBe(false);
    expect(isAttentionOnly('?attention=0')).toBe(false);
    expect(isAttentionOnly('?pack=demo')).toBe(false);
  });
});

describe('onlyNeedsAttention', () => {
  it('drops the healthy rows and keeps the ones check flagged', () => {
    const filtered = onlyNeedsAttention(buildSpine(PACK, CHECK));

    expect(filtered.orchestrator?.label).toBe('work');
    expect(filtered.outside.map(entry => entry.label)).toEqual([
      'rebase-worktree',
    ]);
    // `ship` is in sync, so its row is gone even though the pack still has it.
    expect(filtered.outside.some(entry => entry.label === 'ship')).toBe(false);
  });

  it('shows exactly as many rows as the badge that reached it claims', () => {
    const spine = buildSpine(PACK, CHECK);
    const filtered = onlyNeedsAttention(spine);

    const rows =
      (filtered.orchestrator ? 1 : 0) +
      filtered.stages.length +
      filtered.outside.length;

    expect(spine.attentionCount).toBe(2);
    expect(rows).toBe(spine.attentionCount);
  });

  it('leaves the count alone, so the header still states the whole pack', () => {
    expect(onlyNeedsAttention(buildSpine(PACK, CHECK)).attentionCount).toBe(2);
  });

  it('keeps the surviving stages in pipeline order rather than resorting them', () => {
    // Both stages are made to need attention via a resolve error on a
    // required slot, so the ONLY thing that can reorder them is the filter.
    const withStageTrouble: SpineComposition = {
      ...PACK,
      verbs: [
        ...PACK.verbs,
        verb('stage-provision', {
          engineRef: 'mattstack:stage-provision',
          slots: [
            {
              name: 'domain',
              contract: 'd@1',
              required: true,
              boundTo: null,
              fillSourcePath: null,
              fillVersion: null,
              registered: null,
              inlined: null,
            },
          ],
        }),
        verb('stage-ship', {
          engineRef: 'mattstack:stage-ship',
          slots: [
            {
              name: 'domain',
              contract: 'd@1',
              required: true,
              boundTo: null,
              fillSourcePath: null,
              fillVersion: null,
              registered: null,
              inlined: null,
            },
          ],
        }),
      ],
    };

    const filtered = onlyNeedsAttention(buildSpine(withStageTrouble, CHECK));

    expect(filtered.stages.map(stage => stage.step)).toEqual([1, 2]);
    expect(filtered.stages.map(stage => stage.key)).toEqual([
      'mattstack:stage-provision',
      'mattstack:stage-ship',
    ]);
  });

  it('drops orphaned fills, which the count it inherits never included', () => {
    const spine = buildSpine(PACK, CHECK);

    expect(spine.orphans).toHaveLength(1);
    expect(onlyNeedsAttention(spine).orphans).toEqual([]);
  });

  it('empties completely when every verb is in sync', () => {
    const clean: OutlineCheck = {
      verbs: CHECK.verbs.map(row => ({
        ...row,
        status: 'in-sync' as const,
        staleFiles: [],
      })),
    };
    const filtered = onlyNeedsAttention(buildSpine(PACK, clean));

    expect(filtered.orchestrator).toBeNull();
    expect(filtered.stages).toEqual([]);
    expect(filtered.outside).toEqual([]);
  });
});

describe('comparedVerbCount', () => {
  it('counts only the verbs check actually compared', () => {
    expect(
      comparedVerbCount({
        verbs: [
          { name: 'a', status: 'in-sync', staleFiles: [], orphanFiles: [] },
          { name: 'b', status: 'stale', staleFiles: ['x'], orphanFiles: [] },
          {
            name: 'c',
            status: 'internal-unchecked',
            staleFiles: [],
            orphanFiles: [],
          },
        ],
      })
    ).toBe(2);
  });
});
