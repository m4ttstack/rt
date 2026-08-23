import { describe, expect, it } from 'vitest';

import {
  buildOutline,
  type OutlineCheck,
  type OutlineComposition,
  type OutlineNode,
  type VerbOutlineNode,
} from './outline';

function asVerb(node: OutlineNode | undefined): VerbOutlineNode {
  if (node?.kind !== 'verb') throw new Error('expected a verb node');
  return node;
}

const watchCiComposition: OutlineComposition = {
  verbs: [
    {
      name: 'watch-ci',
      engine: 'watch-ci',
      engineRef: 'mattstack:watch-ci',
      plugin: 'mattstack',
      description: 'watch ci',
      public: true,
      sourcePath: '/plugins/mattstack/skills/pipeline/watch-ci/SKILL.md',
      artifactPath: '/p/skills/watch-ci',
      slots: [
        {
          name: 'domain',
          contract: 'watch-ci-domain@1',
          required: true,
          boundTo: 'demo:watch-ci-domain',
          fillSourcePath: '/plugins/demo/watch-ci-domain/SKILL.md',
          fillVersion: '0.4.11',
          registered: false,
          inlined: true,
        },
      ],
    },
  ],
  fills: [
    {
      binding: 'demo:watch-ci-domain',
      provides: 'watch-ci-domain@1',
      sourcePath: '/plugins/demo/watch-ci-domain/SKILL.md',
      registered: false,
    },
    {
      binding: 'demo:unused',
      provides: 'unused@1',
      sourcePath: '/plugins/demo/unused/SKILL.md',
      registered: false,
    },
  ],
};

describe('buildOutline: check-status health mapping', () => {
  it('a verb whose compiled output is missing reads never-compiled, not in-sync', () => {
    const check: OutlineCheck = {
      verbs: [
        {
          name: 'watch-ci',
          status: 'never-compiled',
          staleFiles: [],
          orphanFiles: [],
        },
      ],
    };

    expect(buildOutline(watchCiComposition, check)[0].health).toBe(
      'never-compiled'
    );
  });

  it('a verb with stale files reads source-newer-than-compiled', () => {
    const check: OutlineCheck = {
      verbs: [
        {
          name: 'watch-ci',
          status: 'stale',
          staleFiles: ['SKILL.md'],
          orphanFiles: [],
        },
      ],
    };

    expect(buildOutline(watchCiComposition, check)[0].health).toBe(
      'source-newer'
    );
  });

  it('an in-sync verb reads in-sync', () => {
    const check: OutlineCheck = {
      verbs: [
        {
          name: 'watch-ci',
          status: 'in-sync',
          staleFiles: [],
          orphanFiles: [],
        },
      ],
    };

    expect(buildOutline(watchCiComposition, check)[0].health).toBe('in-sync');
  });

  it('an internal-unchecked verb is not reported as drift', () => {
    const composition: OutlineComposition = {
      verbs: [
        {
          name: 'internal-helper',
          engine: 'internal-helper',
          engineRef: 'mattstack:internal-helper',
          plugin: 'mattstack',
          description: 'internal helper',
          public: false,
          sourcePath: '/plugins/mattstack/internal-helper/SKILL.md',
          artifactPath: '/p/skills/internal-helper',
          slots: [],
        },
      ],
      fills: [],
    };
    const check: OutlineCheck = {
      verbs: [
        {
          name: 'internal-helper',
          status: 'internal-unchecked',
          staleFiles: [],
          orphanFiles: [],
        },
      ],
    };

    const node = buildOutline(composition, check).find(
      n => n.verb === 'internal-helper'
    );
    expect(node?.health).not.toBe('never-compiled');
    expect(node?.health).toBe('internal-unchecked');
  });

  it('an internal verb whose output still exists can legitimately read stale -- no blanket internal filter', () => {
    const composition: OutlineComposition = {
      verbs: [
        {
          name: 'internal-helper',
          engine: 'internal-helper',
          engineRef: 'mattstack:internal-helper',
          plugin: 'mattstack',
          description: 'internal helper',
          public: false,
          sourcePath: '/plugins/mattstack/internal-helper/SKILL.md',
          artifactPath: '/p/skills/internal-helper',
          slots: [],
        },
      ],
      fills: [],
    };
    const check: OutlineCheck = {
      verbs: [
        {
          name: 'internal-helper',
          status: 'stale',
          staleFiles: ['SKILL.md'],
          orphanFiles: [],
        },
      ],
    };

    const node = buildOutline(composition, check).find(
      n => n.verb === 'internal-helper'
    );
    expect(node?.health).toBe('source-newer');
  });
});

describe('buildOutline: orphaned fills', () => {
  const inSyncCheck: OutlineCheck = {
    verbs: [
      { name: 'watch-ci', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    ],
  };

  it('a fill bound by no verb reads orphaned', () => {
    const outline = buildOutline(watchCiComposition, inSyncCheck);

    expect(outline.find(n => n.fill === 'demo:unused')?.health).toBe(
      'orphaned'
    );
  });

  it('a fill bound by a verb slot is not reported as orphaned', () => {
    const outline = buildOutline(watchCiComposition, inSyncCheck);

    expect(
      outline.find(n => n.fill === 'demo:watch-ci-domain')
    ).toBeUndefined();
  });

  it('a fill bound only by a pipeline stage (never by a roster verb) is not orphaned', () => {
    const composition: OutlineComposition = {
      ...watchCiComposition,
      fills: [
        ...watchCiComposition.fills,
        {
          binding: 'mattstack:self-review',
          provides: 'self-review@1',
          sourcePath: '/plugins/mattstack/self-review/SKILL.md',
          registered: true,
        },
      ],
      binders: [
        {
          ref: 'pipeline:review-stage',
          verb: null,
          kind: 'stage',
          slots: [{ name: 'reviewer', boundTo: 'mattstack:self-review' }],
        },
      ],
    };

    const outline = buildOutline(composition, inSyncCheck);

    expect(
      outline.find(n => n.fill === 'mattstack:self-review')
    ).toBeUndefined();
    expect(outline.find(n => n.fill === 'demo:unused')?.health).toBe(
      'orphaned'
    );
  });
});

describe('buildOutline: nodes never vanish or narrate away real state', () => {
  it('a verb with a null engineRef and an engineError still appears', () => {
    const composition: OutlineComposition = {
      verbs: [
        {
          name: 'broken',
          engine: 'broken',
          engineRef: null,
          plugin: 'mattstack',
          description: 'broken',
          public: true,
          sourcePath: '/plugins/mattstack/broken/SKILL.md',
          artifactPath: '/p/skills/broken',
          slots: [],
          engineError: 'engine "broken" not found',
        },
      ],
      fills: [],
    };
    const check: OutlineCheck = {
      verbs: [
        { name: 'broken', status: 'in-sync', staleFiles: [], orphanFiles: [] },
      ],
    };

    const node = asVerb(buildOutline(composition, check)[0]);
    expect(node.verb).toBe('broken');
    expect(node.engineRef).toBeNull();
    expect(node.engineError).toBe('engine "broken" not found');
  });

  it('a slot with a resolveError carries the error through, not a fill', () => {
    const composition: OutlineComposition = {
      verbs: [
        {
          name: 'watch-ci',
          engine: 'watch-ci',
          engineRef: 'mattstack:watch-ci',
          plugin: 'mattstack',
          description: 'watch ci',
          public: true,
          sourcePath: '/plugins/mattstack/watch-ci/SKILL.md',
          artifactPath: '/p/skills/watch-ci',
          slots: [
            {
              name: 'domain',
              contract: 'watch-ci-domain@1',
              required: true,
              boundTo: 'demo:missing',
              fillSourcePath: null,
              fillVersion: null,
              registered: null,
              inlined: null,
              resolveError: 'no fill provides watch-ci-domain@1',
            },
          ],
        },
      ],
      fills: [],
    };
    const check: OutlineCheck = {
      verbs: [
        {
          name: 'watch-ci',
          status: 'in-sync',
          staleFiles: [],
          orphanFiles: [],
        },
      ],
    };

    const slot = asVerb(buildOutline(composition, check)[0]).slots[0];
    expect(slot.resolveError).toBe('no fill provides watch-ci-domain@1');
    expect(slot.fill).toBeNull();
  });

  it('a verb node keeps sourcePath and artifactPath as distinct fields', () => {
    const node = asVerb(
      buildOutline(watchCiComposition, {
        verbs: [
          {
            name: 'watch-ci',
            status: 'in-sync',
            staleFiles: [],
            orphanFiles: [],
          },
        ],
      })[0]
    );

    expect(node.sourcePath).toBe(
      '/plugins/mattstack/skills/pipeline/watch-ci/SKILL.md'
    );
    expect(node.artifactPath).toBe('/p/skills/watch-ci');
    expect(node.sourcePath).not.toBe(node.artifactPath);
  });
});
