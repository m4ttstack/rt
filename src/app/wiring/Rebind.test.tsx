import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
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
  fills: [fill('demo:watch-ci-domain'), fill('demo:solo-fill')],
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
  verbs: [
    verb('watch-ci', { slots: [boundSlot('domain', 'demo:solo-fill')] }),
  ],
  fills: [fill('demo:solo-fill')],
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
  fills: [fill('demo:watch-ci-domain'), fill('demo:new-fill')],
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

function renderRebind(over: Partial<RebindProps> = {}) {
  return renderWithProviders(
    <Rebind
      pack={over.pack ?? 'demo'}
      verb={over.verb ?? 'watch-ci'}
      slot={over.slot ?? 'domain'}
      composition={over.composition ?? SHARED}
      onOpenManifest={over.onOpenManifest}
      onCopy={over.onCopy}
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

describe('Rebind: the edit rt cannot make for you', () => {
  test('the panel names the real manifest path, the bindings key, and the old -> new values', async () => {
    renderRebind({ verb: 'watch-ci', slot: 'domain', composition: SHARED });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

    const panel = screen.getByTestId('manifest-edit');
    expect(panel).toHaveTextContent(
      '/repos/gitlab.com-acme-acme-dev/skills.jsonc'
    );
    expect(panel).toHaveTextContent('bindings.watch-ci.domain');
    expect(panel).toHaveTextContent('demo:watch-ci-domain');
    expect(panel).toHaveTextContent('demo:solo-fill');
    expect(panel).toHaveTextContent(
      'rt skills compile --pack demo --verb watch-ci'
    );
  });

  test('names the path as unavailable, never a constructed one, when rt reported none', async () => {
    renderRebind({
      verb: 'watch-ci',
      slot: 'domain',
      composition: { ...SHARED, manifestPath: null },
    });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

    const panel = screen.getByTestId('manifest-edit');
    expect(panel).toHaveTextContent(/manifest path not available/i);
    expect(panel).not.toHaveTextContent('~/.mattstack');
    expect(panel).not.toHaveTextContent('demo/skills.jsonc');
    expect(
      screen.getByRole('button', { name: /open manifest/i })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /^copy/i })).toBeDisabled();
  });

  test('offers Open manifest and Copy actions rather than a write', async () => {
    const onOpenManifest = vi.fn();
    const onCopy = vi.fn();
    renderRebind({
      verb: 'watch-ci',
      slot: 'domain',
      composition: SHARED,
      onOpenManifest,
      onCopy,
    });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));
    await userEvent.click(
      screen.getByRole('button', { name: /open manifest/i })
    );
    await userEvent.click(screen.getByRole('button', { name: /^copy/i }));

    expect(onOpenManifest).toHaveBeenCalledWith(
      '/repos/gitlab.com-acme-acme-dev/skills.jsonc'
    );
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /^apply$/i })
    ).not.toBeInTheDocument();
  });
});
