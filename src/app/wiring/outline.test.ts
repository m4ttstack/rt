import { describe, expect, it } from 'vitest';

import {
  buildSpine,
  invertBindings,
  needsAttention,
  pluginRootOf,
  spineRows,
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
    // Binds nothing, so rt emits no binder for it and no pipeline names it.
    verb('rebase-worktree', {}),
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
      'mattstack:rebase-worktree',
    ]);
  });

  it('names the stage an outside skill duplicates, by its bindings rather than its name', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);
    const ship = spine.outside.find(e => e.key === 'mattstack:ship');
    const reviewCore = spine.outside.find(
      e => e.key === 'mattstack:review-core'
    );

    expect(ship?.sameWiringAsStep).toBe(3);
    expect(reviewCore).toBeDefined();
    expect(reviewCore?.sameWiringAsStep).toBeUndefined();
  });
});

describe('buildSpine: a roster verb no binder names', () => {
  it('lands outside the pipeline, marked unwired, rather than rendering nowhere', () => {
    const entry = buildSpine(PACK, EMPTY_CHECK).outside.find(
      e => e.key === 'mattstack:rebase-worktree'
    );

    expect(entry).toBeDefined();
    expect(entry?.unwired).toBe(true);
    expect(entry?.verb).toBe('rebase-worktree');
    expect(entry?.note).toBe(
      'no slots — this skill takes nothing from the pack'
    );
  });

  it('keeps the source and artifact a compile action needs', () => {
    const entry = buildSpine(PACK, EMPTY_CHECK).outside.find(
      e => e.key === 'mattstack:rebase-worktree'
    );

    expect(entry?.sourcePath).toBe('/steps/rebase-worktree/SKILL.md');
    expect(entry?.artifactPath).toBe('/p/skills/rebase-worktree');
  });

  it('carries its own drift, and that drift reaches the attention count', () => {
    const check: OutlineCheck = {
      verbs: [
        {
          name: 'rebase-worktree',
          status: 'stale',
          staleFiles: ['SKILL.md'],
          orphanFiles: [],
        },
      ],
    };
    const spine = buildSpine(PACK, check);

    expect(
      spine.outside.find(e => e.key === 'mattstack:rebase-worktree')?.health
    ).toBe('source-newer');
    expect(spine.attentionCount).toBe(1);
  });

  it('leaves every wired binder unmarked, so the badge means something', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.orchestrator?.unwired).toBe(false);
    expect(spine.stages.map(s => s.unwired)).toEqual([false, false, false]);
    expect(
      spine.outside
        .filter(e => e.key !== 'mattstack:rebase-worktree')
        .map(e => e.unwired)
    ).toEqual([false, false, false]);
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

  it("carries rt's inlined flag through, and leaves a binder-only slot at null", () => {
    // The compiler emits a seam only for an INLINED fill, so this flag is the
    // only thing that tells a reader whether a bound slot is absent from the
    // compiled body because it is referenced or because something is wrong.
    // A binder-only slot carries no flag at all -- neither, not false.
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.orchestrator?.slots[0].inlined).toBe(true);
    expect(spine.stages[0].slots[0].inlined).toBeNull();
  });

  it('reports a referenced fill as referenced rather than as unflagged', () => {
    const composition: SpineComposition = {
      ...PACK,
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
              registered: true,
              inlined: false,
            },
          ],
        }),
      ],
    };

    expect(
      buildSpine(composition, EMPTY_CHECK).orchestrator?.slots[0].inlined
    ).toBe(false);
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

  /**
   * Nothing in the filtering path reads `public`: a non-public verb is
   * compared exactly like any other, and this pins that suppressing internal
   * verbs wholesale would hide a row that has to show.
   */
  it('a non-public verb still reports its drift', () => {
    const internalPack: SpineComposition = {
      ...PACK,
      verbs: PACK.verbs.map(v =>
        v.name === 'work' ? { ...v, public: false } : v
      ),
    };

    const entry = buildSpine(
      internalPack,
      checkFor('work', 'stale')
    ).orchestrator;

    expect(entry).toBeDefined();
    expect(entry?.health).toBe('source-newer');
    expect(needsAttention(entry!)).toBe(true);
  });

  it('a stage check never covers reads unknown, and never borrows a verb row', () => {
    const spine = buildSpine(PACK, checkFor('work', 'stale'));

    // `every` is vacuously true on an empty list, so the length assertion is
    // what makes this test able to fail.
    expect(spine.stages).toHaveLength(3);
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

/**
 * The rail badge has no work-type picker, so it counts against the pack's
 * default while the page counts against the picker. These pin the property
 * that makes those two numbers the same one.
 */
describe('buildSpine: attentionCount does not move with the work type', () => {
  const DRIFTED: OutlineCheck = {
    verbs: [
      {
        name: 'work',
        status: 'stale',
        staleFiles: ['SKILL.md'],
        orphanFiles: [],
      },
      {
        name: 'ship',
        status: 'never-compiled',
        staleFiles: [],
        orphanFiles: [],
      },
      {
        name: 'rebase-worktree',
        status: 'stale',
        staleFiles: ['SKILL.md'],
        orphanFiles: [],
      },
    ],
  };

  it('answers the same count for two pipelines of different lengths', () => {
    // `feature` names three stages, one of which (`stage-implement`) has no
    // binder and no roster verb, so it is a row in `feature` and absent from
    // `hotfix` entirely. That asymmetric row is the only way the count could
    // diverge, and it is exactly what a stage "contributing" would look like.
    const feature = buildSpine(PACK, DRIFTED, 'feature');
    const hotfix = buildSpine(PACK, DRIFTED, 'hotfix');

    expect(feature.stages).toHaveLength(3);
    expect(hotfix.stages).toHaveLength(1);
    // Non-zero, or the equality below would hold on two empty counts.
    expect(feature.attentionCount).toBe(3);
    expect(hotfix.attentionCount).toBe(feature.attentionCount);
  });

  it('flags nothing that has no roster verb behind it', () => {
    const spine = buildSpine(PACK, DRIFTED, 'feature');
    const flagged = spineRows(spine).filter(needsAttention);

    expect(flagged).toHaveLength(spine.attentionCount);
    // `every` is vacuously true on an empty list, so this is what lets the
    // assertion below fail.
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every(entry => entry.verb !== null)).toBe(true);
  });

  it('gives every roster verb exactly one row, in every work type', () => {
    for (const workType of ['feature', 'hotfix']) {
      const rows = spineRows(buildSpine(PACK, DRIFTED, workType));
      const verbs = rows
        .map(row => row.verb)
        .filter((name): name is string => name !== null);

      expect(new Set(verbs).size).toBe(verbs.length);
      expect([...verbs].sort()).toEqual(['rebase-worktree', 'ship', 'work']);
    }
  });
});

describe('buildSpine: nodes never vanish or narrate away real state', () => {
  it('a verb whose engine failed to resolve still leads the spine, carrying the error', () => {
    const composition: SpineComposition = {
      ...PACK,
      verbs: [verb('work', { engineError: 'engine "work" not found' })],
    };

    const orchestrator = buildSpine(composition, EMPTY_CHECK).orchestrator;
    expect(orchestrator?.label).toBe('work');
    expect(orchestrator?.engineError).toBe('engine "work" not found');
  });

  it('a verb with a null engineRef still gets a row, keyed by its name', () => {
    const composition: SpineComposition = {
      ...PACK,
      verbs: [
        verb('work', {
          engineRef: null,
          engineError: 'engine "work" not found',
        }),
      ],
    };

    const spine = buildSpine(composition, EMPTY_CHECK);
    const entry = spine.outside.find(e => e.key === 'verb:work');

    expect(spine.orchestrator).toBeNull();
    expect(entry).toBeDefined();
    expect(entry?.label).toBe('work');
    expect(entry?.engineError).toBe('engine "work" not found');
  });

  it('keeps sourcePath and artifactPath as distinct fields', () => {
    const orchestrator = buildSpine(PACK, EMPTY_CHECK).orchestrator;

    expect(orchestrator?.sourcePath).toBe('/steps/work/SKILL.md');
    expect(orchestrator?.artifactPath).toBe('/p/skills/work');
    expect(orchestrator?.sourcePath).not.toBe(orchestrator?.artifactPath);
  });
});

describe('invertBindings: every site that resolves to a fill', () => {
  it('lists a verb and a stage that bind the same fill, each with its own kind', () => {
    const sites = invertBindings(PACK)['demo:ship-domain'];

    expect(sites).toHaveLength(2);
    expect(sites).toEqual([
      { ref: 'mattstack:ship', verb: 'ship', kind: 'verb', slot: 'domain' },
      {
        ref: 'mattstack:stage-ship',
        verb: null,
        kind: 'stage',
        slot: 'domain',
      },
    ]);
  });

  it('keeps a `skill` binder, the ref that is neither a roster verb nor a stage', () => {
    const sites = invertBindings(PACK)['demo:work-provision'];

    expect(sites).toHaveLength(2);
    const skill = sites.find(site => site.kind === 'skill');
    expect(skill).toBeDefined();
    expect(skill?.ref).toBe('mattstack:review-core');
    expect(skill?.verb).toBeNull();
    expect(skill?.slot).toBe('criteria');
  });

  it('a cross-plugin binder is a real binding site, not an orphan', () => {
    const sites = invertBindings(PACK)['demo:mr-board-review'];

    expect(sites).toHaveLength(1);
    expect(sites[0]).toEqual({
      ref: 'mr-board:review',
      verb: null,
      kind: 'external',
      slot: 'skill',
    });
  });

  it('a declared fill nobody binds gets an empty array, not a missing key', () => {
    const sites = invertBindings(PACK);

    // Absent and bound-by-nothing are different facts: a missing key renders
    // as "unknown" where the honest answer is "bound by nothing".
    expect(Object.keys(sites)).toContain('mattstack:self-review');
    expect(sites['mattstack:self-review']).toEqual([]);
  });

  it('a slot the payload leaves unbound contributes nothing, not a null-keyed entry', () => {
    // The response type says `boundTo: string`, but it is unvalidated JSON
    // off an rt subprocess -- the guard is what keeps `null` out of the keys.
    const composition: SpineComposition = {
      verbs: [],
      fills: [],
      binders: [
        {
          ref: 'mattstack:watch-ci',
          verb: 'watch-ci',
          kind: 'verb',
          slots: [{ name: 'domain', boundTo: null as unknown as string }],
        },
      ],
    };

    expect(invertBindings(composition)).toEqual({});
  });

  it('orders two verbs on one fill by name, not by the order the manifest listed them', () => {
    const composition: SpineComposition = {
      verbs: [],
      fills: [fill('demo:shared', 'shared@1')],
      binders: [
        {
          ref: 'mattstack:zeta',
          verb: 'zeta',
          kind: 'verb',
          slots: [{ name: 'domain', boundTo: 'demo:shared' }],
        },
        {
          ref: 'mattstack:alpha',
          verb: 'alpha',
          kind: 'verb',
          slots: [{ name: 'domain', boundTo: 'demo:shared' }],
        },
      ],
    };

    const sites = invertBindings(composition)['demo:shared'];
    expect(sites).toHaveLength(2);
    expect(sites.map(site => site.verb)).toEqual(['alpha', 'zeta']);
  });

  it("the slot row's site count is the length of the index's list for that fill", () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);
    const slot = spine.stages[2].slots[0];

    // One inversion, two readers -- the chip cannot claim a number the
    // drawer's list does not have rows for.
    expect(slot.boundTo).toBe('demo:ship-domain');
    expect(spine.bindingSites['demo:ship-domain']).toHaveLength(2);
    expect(slot.siteCount).toBe(2);
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

    expect(spine.orphans.map(o => o.fill)).not.toContain('demo:work-provision');
  });

  it('a fill bound only by another plugin is not orphaned', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.orphans.map(o => o.fill)).not.toContain(
      'demo:mr-board-review'
    );
  });
});

describe('buildSpine: includes', () => {
  const MATTSTACK_ROOT = '/plugins/mattstack';

  function withShipIncludes(
    includes: string[] | undefined,
    sourcePath:
      string | null = `${MATTSTACK_ROOT}/attachments/review/ship/SKILL.md`
  ): SpineComposition {
    return {
      ...PACK,
      verbs: PACK.verbs.map(v =>
        v.name === 'ship' ? { ...v, sourcePath, includes } : v
      ),
    };
  }

  it("threads a verb's includes onto its row, each as the mattstack attachment rt inlines", () => {
    const ship = buildSpine(
      withShipIncludes(['review-core-body', 'review-posting']),
      EMPTY_CHECK
    ).outside.find(e => e.verb === 'ship');

    expect(ship?.includes).toEqual([
      {
        name: 'review-core-body',
        ref: 'mattstack:review-core-body',
        sourcePath: `${MATTSTACK_ROOT}/attachments/review-core-body/SKILL.md`,
      },
      {
        name: 'review-posting',
        ref: 'mattstack:review-posting',
        sourcePath: `${MATTSTACK_ROOT}/attachments/review-posting/SKILL.md`,
      },
    ]);
  });

  it('reads an rt older than the includes field as a verb including nothing', () => {
    const spine = buildSpine(PACK, EMPTY_CHECK);

    expect(spine.orchestrator?.includes).toEqual([]);
    for (const row of [...spine.stages, ...spine.outside])
      expect(row.includes).toEqual([]);
  });

  it('resolves includes at the mattstack root even for a verb from another plugin', () => {
    const composition: SpineComposition = {
      ...withShipIncludes(undefined, `${MATTSTACK_ROOT}/skills/ship/SKILL.md`),
    };
    composition.verbs = [
      ...composition.verbs,
      verb('custom', {
        plugin: 'demo',
        engineRef: 'demo:custom',
        sourcePath: '/packs/demo/skills/custom/SKILL.md',
        includes: ['gitlab-mr-threads'],
      } as Partial<SpineComposition['verbs'][number]>),
    ];

    const custom = buildSpine(composition, EMPTY_CHECK).outside.find(
      e => e.verb === 'custom'
    );

    expect(custom?.includes).toEqual([
      {
        name: 'gitlab-mr-threads',
        ref: 'mattstack:gitlab-mr-threads',
        sourcePath: `${MATTSTACK_ROOT}/attachments/gitlab-mr-threads/SKILL.md`,
      },
    ]);
  });

  it('leaves the include path null, ref intact, when no mattstack source is on hand to derive the root from', () => {
    const ship = buildSpine(
      withShipIncludes(['review-posting'], null),
      EMPTY_CHECK
    ).outside.find(e => e.verb === 'ship');

    expect(ship?.includes).toEqual([
      {
        name: 'review-posting',
        ref: 'mattstack:review-posting',
        sourcePath: null,
      },
    ]);
  });
});

describe('pluginRootOf', () => {
  it('strips a flat skills or attachments layout back to the plugin root', () => {
    expect(pluginRootOf('/r/skills/ship/SKILL.md')).toBe('/r');
    expect(pluginRootOf('/r/attachments/review-posting/SKILL.md')).toBe('/r');
  });

  it('strips a grouped attachments layout back to the plugin root', () => {
    expect(pluginRootOf('/r/attachments/review/review/SKILL.md')).toBe('/r');
  });

  it('takes the innermost layout when the root itself contains a skills dir', () => {
    expect(pluginRootOf('/a/skills/b/attachments/c/SKILL.md')).toBe(
      '/a/skills/b'
    );
  });

  it('answers null for a path in neither layout rather than guessing', () => {
    expect(pluginRootOf('/steps/ship/SKILL.md')).toBeNull();
    expect(pluginRootOf('/r/skills/ship/README.md')).toBeNull();
  });
});
