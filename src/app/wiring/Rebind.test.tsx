import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import type { SkillsComposition } from './outline';
import { Rebind } from './Rebind';
import type { RebindProps } from './Rebind';

function verb(
  name: string,
  over: Partial<SkillsComposition['verbs'][number]> = {}
): SkillsComposition['verbs'][number] {
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
  };
}

function fill(
  binding: string,
  over: Partial<SkillsComposition['fills'][number]> = {}
): SkillsComposition['fills'][number] {
  return {
    binding,
    provides: binding,
    sourcePath: `/fills/${binding}`,
    registered: false,
    ...over,
  };
}

function boundSlot(
  name: string,
  boundTo: string | null
): SkillsComposition['verbs'][number]['slots'][number] {
  return {
    name,
    contract: `${name}@1`,
    required: true,
    boundTo,
    fillSourcePath: null,
    fillVersion: null,
    registered: null,
    inlined: null,
  };
}

/** watch-ci and ship both bind demo:watch-ci-domain, so rebinding
    watch-ci's slot must surface that ship binds it too. */
const SHARED: SkillsComposition = {
  pack: 'demo',
  packDir: '/repos/demo',
  manifestPath: '/repos/gitlab.com-acme-acme-dev/skills.jsonc',
  verbs: [
    verb('watch-ci', {
      slots: [boundSlot('domain', 'demo:watch-ci-domain')],
    }),
    verb('ship', {
      engineRef: 'mattstack:stage-ship',
      slots: [boundSlot('domain', 'demo:watch-ci-domain')],
    }),
  ],
  fills: [
    fill('demo:watch-ci-domain', { provides: 'domain@1' }),
    fill('demo:solo-fill', { provides: 'domain@1' }),
  ],
  binders: [
    {
      ref: 'mattstack:watch-ci',
      verb: 'watch-ci',
      kind: 'verb',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
    {
      ref: 'mattstack:stage-ship',
      verb: 'ship',
      kind: 'verb',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
  ],
};

/** The pack's only fill is the one already bound -- there is no other fill
    to rebind to, which is exactly the shape that must not blank out the
    outgoing blast radius. */
const SOLO: SkillsComposition = {
  pack: 'demo',
  packDir: '/repos/demo',
  manifestPath: null,
  verbs: [verb('watch-ci', { slots: [boundSlot('domain', 'demo:solo-fill')] })],
  fills: [fill('demo:solo-fill', { provides: 'domain@1' })],
  binders: [
    {
      ref: 'mattstack:watch-ci',
      verb: 'watch-ci',
      kind: 'verb',
      slots: [{ name: 'domain', boundTo: 'demo:solo-fill' }],
    },
  ],
};

/** The candidate fill is bound by a pipeline STAGE, not a roster verb -- the
    ~2/3 of the manifest's binding keys a verbs-only view can never see. */
const STAGE_BOUND: SkillsComposition = {
  pack: 'demo',
  packDir: '/repos/demo',
  manifestPath: '/repos/gitlab.com-acme-acme-dev/skills.jsonc',
  verbs: [
    verb('watch-ci', {
      slots: [boundSlot('domain', 'demo:watch-ci-domain')],
    }),
  ],
  fills: [
    fill('demo:watch-ci-domain', { provides: 'domain@1' }),
    fill('demo:new-fill', { provides: 'domain@1' }),
  ],
  binders: [
    {
      ref: 'mattstack:watch-ci',
      verb: 'watch-ci',
      kind: 'verb',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
    {
      ref: 'mattstack:stage-implement',
      verb: null,
      kind: 'stage',
      slots: [{ name: 'domain', boundTo: 'demo:new-fill' }],
    },
  ],
};

/** watch-ci's `domain` slot has contract `domain@1`; `wrong-contract-fill`
    provides something else entirely. The rebind picker must never offer a
    fill the target slot cannot actually accept -- rt's own bind would 502
    on it, but the picker should not let it be chosen in the first place. */
const MIXED_CONTRACTS: SkillsComposition = {
  pack: 'demo',
  packDir: '/repos/demo',
  manifestPath: '/repos/gitlab.com-acme-acme-dev/skills.jsonc',
  verbs: [
    verb('watch-ci', {
      slots: [boundSlot('domain', 'demo:watch-ci-domain')],
    }),
  ],
  fills: [
    fill('demo:watch-ci-domain', { provides: 'domain@1' }),
    fill('demo:solo-fill', { provides: 'domain@1' }),
    fill('demo:wrong-contract-fill', { provides: 'verdict@1' }),
  ],
  binders: [
    {
      ref: 'mattstack:watch-ci',
      verb: 'watch-ci',
      kind: 'verb',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
  ],
};

/** Same shape as MIXED_CONTRACTS but with no compatible fill left once the
    current binding is excluded -- the picker's zero-candidates state must
    still render, not an empty `Select`. */
const NO_COMPATIBLE_FILL: SkillsComposition = {
  ...MIXED_CONTRACTS,
  fills: [
    fill('demo:watch-ci-domain', { provides: 'domain@1' }),
    fill('demo:wrong-contract-fill', { provides: 'verdict@1' }),
  ],
};

function renderRebind(over: Partial<RebindProps> = {}) {
  return renderWithProviders(
    <Rebind
      pack={over.pack ?? 'demo'}
      verb={over.verb ?? 'watch-ci'}
      slot={over.slot ?? 'domain'}
      composition={over.composition ?? SHARED}
      onApply={over.onApply}
      applying={over.applying}
      applyError={over.applyError}
      onClose={over.onClose}
    />
  );
}

test('the confirm step names every other verb that binds the outgoing fill', async () => {
  renderRebind({ verb: 'watch-ci', slot: 'domain', composition: SHARED });

  await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

  expect(screen.getByText(/ship/)).toBeInTheDocument();
});

test('a fill bound by nobody else says so, rather than showing an empty list', async () => {
  renderRebind({ verb: 'watch-ci', slot: 'domain', composition: SOLO });

  await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

  // "Nothing else binds this" is a fact worth stating; a blank region reads
  // as a rendering failure and leaves you unsure the check ran.
  expect(screen.getByText(/nothing else binds/i)).toBeInTheDocument();
});

test('an incoming fill bound by a pipeline stage shows in the blast radius, not "nothing else binds"', async () => {
  renderRebind({ verb: 'watch-ci', slot: 'domain', composition: STAGE_BOUND });

  await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

  expect(screen.getByText(/stage-implement/)).toBeInTheDocument();
  expect(
    screen.queryByText(/would be its first site/i)
  ).not.toBeInTheDocument();
});

test('the picker omits a fill that does not provide the slot contract', async () => {
  renderRebind({
    verb: 'watch-ci',
    slot: 'domain',
    composition: MIXED_CONTRACTS,
  });

  await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

  await userEvent.click(
    screen.getByRole('combobox', { name: /rebind target fill/i })
  );
  expect(
    screen.getByRole('option', { name: 'demo:solo-fill' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: 'demo:wrong-contract-fill' })
  ).not.toBeInTheDocument();
});

test('zero fills provide the slot contract shows the empty state, not an empty picker', async () => {
  renderRebind({
    verb: 'watch-ci',
    slot: 'domain',
    composition: NO_COMPATIBLE_FILL,
  });

  await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

  expect(
    screen.getByText(/no other fill in this pack to rebind/i)
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('combobox', { name: /rebind target fill/i })
  ).not.toBeInTheDocument();
});

describe('Rebind: the staged Apply', () => {
  test('names the exact rt skills bind command, never a hand edit', async () => {
    renderRebind({ verb: 'watch-ci', slot: 'domain', composition: SHARED });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

    const panel = screen.getByTestId('rebind-apply');
    expect(panel).toHaveTextContent(
      'rt skills bind watch-ci domain demo:solo-fill --pack demo'
    );
    expect(panel).toHaveTextContent(
      '1 change staged — nothing is written until you apply'
    );
    expect(screen.queryByTestId('manifest-edit')).not.toBeInTheDocument();
  });

  test('names the real manifest path and the bindings key in the caption', async () => {
    renderRebind({ verb: 'watch-ci', slot: 'domain', composition: SHARED });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

    const panel = screen.getByTestId('rebind-apply');
    expect(panel).toHaveTextContent('bindings.watch-ci.domain');
    expect(panel).toHaveTextContent(
      '/repos/gitlab.com-acme-acme-dev/skills.jsonc'
    );
  });

  test('names the binding without a path, never a constructed one, when rt reported none', async () => {
    renderRebind({
      verb: 'watch-ci',
      slot: 'domain',
      composition: { ...SHARED, manifestPath: null },
    });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

    const panel = screen.getByTestId('rebind-apply');
    expect(panel).toHaveTextContent('bindings.watch-ci.domain');
    expect(panel).not.toHaveTextContent('~/.mattstack');
    expect(panel).not.toHaveTextContent('demo/skills.jsonc');
  });

  test('pressing Apply calls onApply with the staged fill, never before pressed', async () => {
    const onApply = vi.fn();
    renderRebind({
      verb: 'watch-ci',
      slot: 'domain',
      composition: SHARED,
      onApply,
    });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));
    expect(onApply).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith('demo:solo-fill');
  });

  test('Discard steps back out of the confirm view without calling onApply', async () => {
    const onApply = vi.fn();
    renderRebind({
      verb: 'watch-ci',
      slot: 'domain',
      composition: SHARED,
      onApply,
    });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));

    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rebind-apply')).not.toBeInTheDocument();
  });

  test('disables Discard and Apply while applying, and shows a failed apply error', async () => {
    renderRebind({
      verb: 'watch-ci',
      slot: 'domain',
      composition: SHARED,
      applying: true,
      applyError: 'rt skills: manifest is not writable',
    });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

    expect(screen.getByRole('button', { name: /discard/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeDisabled();
    expect(
      screen.getByText('rt skills: manifest is not writable')
    ).toBeInTheDocument();
  });
});
