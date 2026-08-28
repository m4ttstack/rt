import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { theme } from '@mattstack/app-kit/design-system';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SpineEntry } from '../outline';
import { SummaryStrip } from '../SummaryStrip';

vi.mock('../../api', () => ({
  client: {
    api: {
      skills: {
        bind: { $post: vi.fn() },
        surface: { apply: { $post: vi.fn() } },
        compile: { $get: vi.fn() },
        history: { $get: vi.fn() },
        diff: { $get: vi.fn() },
      },
    },
  },
}));

const { SkillDetailPanel } = await import('../SkillDetailPanel');
const { buildSpine } = await import('../outline');

/**
 * The wiring surfaces consume Mantine spacing/radius theme keys BY NAME
 * (`px="xxl"`, `radius="xl"`). An unknown name doesn't throw or fail a type
 * check -- Mantine's style-prop resolver falls back to treating it as a raw
 * CSS value, so a typo'd token silently renders `padding-right: xxl` (an
 * invalid length, collapsing to 0) instead of `padding-right:
 * var(--mantine-spacing-xxl)`. Same failure mode `theme-contract.test.ts`
 * guards for the runs views; this is the wiring surfaces' own copy so the
 * guard travels with this code rather than living only under `runs/`.
 *
 * jsdom's `getComputedStyle` never resolves `var(...)` into a length (a
 * spot-check confirmed this: a real Mantine-rendered padding reads back as
 * `"0px"`), so the check below is on the rendered inline `style` STRING --
 * the literal `var(--mantine-spacing-xxl)` substring is exactly what a valid
 * token name (and only a valid one) produces.
 */
describe('wiring parity: theme tokens consumed by name', () => {
  it("the summary strip's fact padding names spacing.xxl/xl, not literal px", () => {
    renderWithProviders(
      <SummaryStrip
        orchestrator={null}
        workType="feature"
        stageCount={3}
        health="in-sync"
        attentionCount={0}
      />
    );

    const strip = screen.getByTestId('summary-strip');
    expect(strip.getAttribute('style')).toContain('var(--mantine-spacing-xxl)');
    expect(strip.getAttribute('style')).toContain('var(--mantine-spacing-xl)');

    // A non-first fact carries the divider inset on both sides -- `Main.dc.html`
    // `.fact` padding is 18px, i.e. `spacing.xxl`, never a bare "18px"/"xxl".
    const fact = screen.getByTestId('fact-work-type');
    expect(fact.getAttribute('style')).toContain('var(--mantine-spacing-xxl)');
    expect(fact.getAttribute('style')).not.toMatch(/padding-\w+:\s*xxl/);
  });

  it("the detail panel's outer card and slot card name radius.xl/lg, not literal px", () => {
    const composition = {
      pack: 'demo',
      packDir: '/p',
      verbs: [
        {
          name: 'watch-ci',
          engine: 'watch-ci',
          engineRef: 'mattstack:watch-ci',
          plugin: 'mattstack',
          description: 'watch ci',
          public: true,
          sourcePath: '/plugins/mattstack/skills/watch-ci/SKILL.md',
          artifactPath: '/p/skills/watch-ci',
          slots: [
            {
              name: 'domain',
              contract: 'watch-ci-domain@1',
              required: false,
              boundTo: 'demo:watch-ci-domain',
              fillSourcePath: null,
              fillVersion: null,
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
          sourcePath: '/fills/a/SKILL.md',
          registered: false,
        },
      ],
      binders: [
        {
          ref: 'mattstack:watch-ci',
          verb: 'watch-ci',
          kind: 'verb' as const,
          slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
        },
      ],
      pipelines: { feature: [] as string[] },
    };

    const spine = buildSpine(
      composition,
      {
        verbs: [
          {
            name: 'watch-ci',
            status: 'in-sync',
            staleFiles: [],
            orphanFiles: [],
          },
        ],
      },
      'feature'
    );
    const entry = spine.outside.find(e => e.verb === 'watch-ci') as SpineEntry;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWithProviders(
      <QueryClientProvider client={queryClient}>
        <SkillDetailPanel
          pack="demo"
          entry={entry}
          composition={composition}
          bindingSites={spine.bindingSites}
          onClose={() => {}}
          onCopyContext={() => {}}
          onShowInMap={() => {}}
        />
      </QueryClientProvider>
    );

    const panel = screen.getByTestId('skill-detail-panel');
    expect(panel.getAttribute('style')).toContain(
      '--paper-radius: var(--mantine-radius-xl)'
    );

    const slotCard = screen.getByTestId('slot-card-domain');
    expect(slotCard.getAttribute('style')).toContain(
      '--paper-radius: var(--mantine-radius-lg)'
    );
  });

  it('the theme still carries the spacing/radius keys these surfaces name', () => {
    // Belt-and-suspenders alongside the rendered-DOM checks above: even if a
    // future refactor moves a token off a directly-inspectable inline style
    // (e.g. into a CSS module), the theme itself must still define every
    // step the wiring surfaces name, or the same silent-collapse failure
    // resurfaces one layer down.
    expect(theme.spacing).toMatchObject({
      xl: '0.9rem',
      xxl: '1.125rem',
      xxxl: '1.5rem',
    });
    expect(theme.radius).toMatchObject({ lg: '8px', xl: '10px' });
  });
});
