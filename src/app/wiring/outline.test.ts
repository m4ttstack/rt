import { describe, expect, it } from 'vitest';

import {
  buildSpine,
  type OutlineCheck,
  type SpineComposition,
} from './outline';

const EMPTY_CHECK: OutlineCheck = { verbs: [] };

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

function fill(binding: string, provides: string) {
  return {
    binding,
    provides,
    sourcePath: `/fills/${binding}`,
    registered: false,
  };
}

/** The live pack in miniature: a work orchestrator, a three-stage pipeline
    whose middle stage binds nothing, an outside verb that binds exactly what
    a stage binds, a cross-plugin binder, and a fill nothing reaches. */
const PACK: SpineComposition = {
  verbs: [
    verb('work', {
      slots: [
        {
          name: 'tiering',
          contract: 'model-tiering@1',
          required: false,
          boundTo: 'mattstack:model-tiering',
          fillSourcePath: '/fills/mattstack:model-tiering',
          fillVersion: '0.8.0',
          registered: false,
          inlined: true,
        },
      ],
    }),
    verb('ship', {
      slots: [
        {
          name: 'domain',
          contract: 'ship-domain@1',
          required: false,
          boundTo: 'demo:ship-domain',
          fillSourcePath: '/fills/demo:ship-domain',
          fillVersion: '1.0.0',
          registered: false,
          inlined: true,
        },
      ],
    }),
  ],
  fills: [
    fill('mattstack:model-tiering', 'model-tiering@1'),
    fill('demo:work-provision', 'provision-domain@1'),
    fill('demo:ship-domain', 'ship-domain@1'),
    fill('demo:mr-board-review', 'mr-review@1'),
    fill('mattstack:self-review', 'self-review-domain@1'),
  ],
  binders: [
    {
      ref: 'mattstack:work',
      verb: 'work',
      kind: 'verb',
      slots: [{ name: 'tiering', boundTo: 'mattstack:model-tiering' }],
    },
    {
      ref: 'mattstack:stage-provision',
      verb: null,
      kind: 'stage',
      slots: [{ name: 'domain', boundTo: 'demo:work-provision' }],
    },
    {
      ref: 'mattstack:stage-ship',
      verb: null,
      kind: 'stage',
      slots: [{ name: 'domain', boundTo: 'demo:ship-domain' }],
    },
    {
      ref: 'mattstack:ship',
      verb: 'ship',
      kind: 'verb',
      slots: [{ name: 'domain', boundTo: 'demo:ship-domain' }],
    },
    {
      ref: 'mattstack:review-core',
      verb: null,
      kind: 'skill',
      slots: [{ name: 'criteria', boundTo: 'demo:work-provision' }],
    },
    {
      ref: 'mr-board:review',
      verb: null,
      kind: 'external',
      slots: [{ name: 'skill', boundTo: 'demo:mr-board-review' }],
    },
  ],
  pipelines: {
    feature: [
      'mattstack:stage-provision',
      'mattstack:stage-implement',
      'mattstack:stage-ship',
    ],
    hotfix: ['mattstack:stage-ship'],
  },
};

describe('buildSpine: the run order comes from pipelines and nowhere else', () => {
  it('numbers the stages in the manifest order, not in binders order or sorted', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.stages.map(s => [s.step, s.ref])).toEqual([
      [1, 'mattstack:stage-provision'],
      [2, 'mattstack:stage-implement'],
      [3, 'mattstack:stage-ship'],
    ]);
  });

  it('follows the requested work type, and falls back to the first when it is unknown', () => {
    expect(
      buildSpine(PACK, EMPTY_CHECK, 'hotfix').stages.map(s => s.ref)
    ).toEqual(['mattstack:stage-ship']);
    expect(buildSpine(PACK, EMPTY_CHECK, 'nonexistent').workType).toBe(
      'feature'
    );
    expect(buildSpine(PACK, EMPTY_CHECK).workTypes).toEqual([
      'feature',
      'hotfix',
    ]);
  });

  it('a stage no binder covers still gets its numbered row, saying it binds nothing', () => {
    const stage = buildSpine(PACK, EMPTY_CHECK).stages[1];

    expect(stage.ref).toBe('mattstack:stage-implement');
    expect(stage.slots).toEqual([]);
    expect(stage.note).toBe(
      'no slots — this stage takes nothing from the pack'
    );
  });

  it('tells an rt with no pipelines field apart from a pack with no pipelines', () => {
    const withoutField: SpineComposition = {
      verbs: PACK.verbs,
      fills: PACK.fills,
      binders: PACK.binders,
    };

    expect(buildSpine(withoutField, EMPTY_CHECK).pipelineState).toBe('absent');
    expect(
      buildSpine({ ...PACK, pipelines: {} }, EMPTY_CHECK).pipelineState
    ).toBe('empty');
    expect(buildSpine(PACK, EMPTY_CHECK).pipelineState).toBe('ok');
  });

  it('puts every binder the pipeline never names outside it, and the orchestrator nowhere but the head', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.orchestrator?.ref).toBe('mattstack:work');
    expect(spine.outside.map(e => e.key)).toEqual([
      'mattstack:ship',
      'mattstack:review-core',
      'external:mr-board',
    ]);
  });

  it('names the stage an outside skill duplicates, by its bindings rather than its name', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);
    const ship = spine.outside.find(e => e.key === 'mattstack:ship');

    expect(ship?.sameWiringAsStep).toBe(3);
    expect(
      spine.outside.find(e => e.key === 'mattstack:review-core')
        ?.sameWiringAsStep
    ).toBeUndefined();
  });
});

describe('buildSpine: slots', () => {
  it("shows a binder-only slot's contract as what the bound fill provides", () => {
    const stage = buildSpine(PACK, EMPTY_CHECK).stages[0];

    expect(stage.slots).toEqual([
      expect.objectContaining({
        name: 'domain',
        contract: 'provision-domain@1',
        required: null,
        boundTo: 'demo:work-provision',
      }),
    ]);
  });

  it('leaves a binder-only slot contract null when no fill answers it, rather than inventing one', () => {
    const composition: SpineComposition = {
      ...PACK,
      binders: [
        {
          ref: 'mattstack:stage-provision',
          verb: null,
          kind: 'stage',
          slots: [{ name: 'domain', boundTo: 'demo:vanished' }],
        },
      ],
    };

    expect(buildSpine(composition, EMPTY_CHECK).stages[0].slots[0]).toEqual(
      expect.objectContaining({ contract: null, fill: null })
    );
  });

  it("counts every binding site that resolves to a fill, not just the roster's", () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);
    const shipDomain = spine.stages[2].slots[0];
    const provision = spine.stages[0].slots[0];

    // stage-ship and the ship verb both bind it; stage-provision and
    // review-core both bind work-provision.
    expect(shipDomain.siteCount).toBe(2);
    expect(provision.siteCount).toBe(2);
  });

  it('a slot with a resolveError carries the error through, not a fill', () => {
    const composition: SpineComposition = {
      ...PACK,
      verbs: [
        verb('work', {
          slots: [
            {
              name: 'tiering',
              contract: 'model-tiering@1',
              required: true,
              boundTo: 'mattstack:missing',
              fillSourcePath: null,
              fillVersion: null,
              registered: null,
              inlined: null,
              resolveError: 'no fill provides model-tiering@1',
            },
          ],
        }),
      ],
    };

    const slot = buildSpine(composition, EMPTY_CHECK).orchestrator?.slots[0];
    expect(slot?.resolveError).toBe('no fill provides model-tiering@1');
    expect(slot?.fill).toBeNull();
  });
});

describe('buildSpine: check-status health mapping', () => {
  const checkFor = (
    name: string,
    status: OutlineCheck['verbs'][number]['status']
  ): OutlineCheck => ({
    verbs: [{ name, status, staleFiles: ['SKILL.md'], orphanFiles: [] }],
  });

  it('a verb whose compiled output is missing reads never-compiled, not in-sync', () => {
    expect(
      buildSpine(PACK, checkFor('work', 'never-compiled')).orchestrator?.health
    ).toBe('never-compiled');
  });

  it('a verb with stale files reads source-newer', () => {
    expect(
      buildSpine(PACK, checkFor('work', 'stale')).orchestrator?.health
    ).toBe('source-newer');
  });

  it('an in-sync verb reads in-sync', () => {
    expect(
      buildSpine(PACK, checkFor('work', 'in-sync')).orchestrator?.health
    ).toBe('in-sync');
  });

  it('an internal-unchecked verb is not reported as drift', () => {
    const health = buildSpine(PACK, checkFor('work', 'internal-unchecked'))
      .orchestrator?.health;

    expect(health).not.toBe('never-compiled');
    expect(health).toBe('internal-unchecked');
  });

  it('a stage check never covers reads unknown, and never borrows a verb row', () => {
    const spine = buildSpine(PACK, checkFor('work', 'stale'));

    expect(spine.stages.every(s => s.health === 'unknown')).toBe(true);
  });

  it('counts drift, engine errors and unresolved required slots as needing attention', () => {
    const spine = buildSpine(PACK, {
      verbs: [
        {
          name: 'work',
          status: 'stale',
          staleFiles: ['SKILL.md'],
          orphanFiles: [],
        },
        { name: 'ship', status: 'in-sync', staleFiles: [], orphanFiles: [] },
      ],
    });

    expect(spine.attentionCount).toBe(1);
  });
});

describe('buildSpine: nodes never vanish or narrate away real state', () => {
  it('a verb with a null engineRef and an engineError still appears', () => {
    const composition: SpineComposition = {
      ...PACK,
      verbs: [verb('work', { engineError: 'engine "work" not found' })],
    };

    const orchestrator = buildSpine(composition, EMPTY_CHECK).orchestrator;
    expect(orchestrator?.label).toBe('work');
    expect(orchestrator?.engineError).toBe('engine "work" not found');
  });

  it('keeps sourcePath and artifactPath as distinct fields', () => {
    const orchestrator = buildSpine(PACK, EMPTY_CHECK).orchestrator;

    expect(orchestrator?.sourcePath).toBe('/steps/work/SKILL.md');
    expect(orchestrator?.artifactPath).toBe('/p/skills/work');
    expect(orchestrator?.sourcePath).not.toBe(orchestrator?.artifactPath);
  });
});

describe('buildSpine: orphaned fills', () => {
  it('a fill bound by nothing at all reads orphaned', () => {
    expect(buildSpine(PACK, EMPTY_CHECK).orphans.map(o => o.fill)).toEqual([
      'mattstack:self-review',
    ]);
  });

  it('a fill bound only by a pipeline stage, never by a roster verb, is not orphaned', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.orphans.map(o => o.fill)).not.toContain(
      'demo:work-provision'
    );
  });

  it('a fill bound only by another plugin is not orphaned', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.orphans.map(o => o.fill)).not.toContain(
      'demo:mr-board-review'
    );
  });
});
