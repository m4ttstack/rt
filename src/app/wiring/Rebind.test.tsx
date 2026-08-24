import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import { Rebind } from './Rebind';
import type { RebindComposition, RebindProps } from './Rebind';

/** watch-ci and ship both bind demo:watch-ci-domain, so rebinding
    watch-ci's slot must surface that ship binds it too. */
const SHARED: RebindComposition = {
  verbs: [
    {
      name: 'watch-ci',
      engineRef: 'mattstack:watch-ci',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
    {
      name: 'ship',
      engineRef: 'mattstack:stage-ship',
      slots: [{ name: 'domain', boundTo: 'demo:watch-ci-domain' }],
    },
  ],
  fills: [
    { binding: 'demo:watch-ci-domain' },
    { binding: 'demo:solo-fill' },
  ],
};

/** The pack's only fill is the one already bound -- there is no other fill
    to rebind to, which is exactly the shape that must not blank out the
    outgoing blast radius. */
const SOLO: RebindComposition = {
  verbs: [
    {
      name: 'watch-ci',
      engineRef: 'mattstack:watch-ci',
      slots: [{ name: 'domain', boundTo: 'demo:solo-fill' }],
    },
  ],
  fills: [{ binding: 'demo:solo-fill' }],
};

function renderRebind(over: Partial<RebindProps> = {}) {
  return renderWithProviders(
    <Rebind
      pack={over.pack ?? 'demo'}
      verb={over.verb ?? 'watch-ci'}
      slot={over.slot ?? 'domain'}
      composition={over.composition ?? SHARED}
      manifestPath={over.manifestPath}
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

describe('Rebind: the edit rt cannot make for you', () => {
  test('the panel names the manifest path, the bindings key, and the old -> new values', async () => {
    renderRebind({ verb: 'watch-ci', slot: 'domain', composition: SHARED });

    await userEvent.click(screen.getByRole('button', { name: /rebind/i }));

    const panel = screen.getByTestId('manifest-edit');
    expect(panel).toHaveTextContent('demo/skills.jsonc');
    expect(panel).toHaveTextContent('bindings.watch-ci.domain');
    expect(panel).toHaveTextContent('demo:watch-ci-domain');
    expect(panel).toHaveTextContent('demo:solo-fill');
    expect(panel).toHaveTextContent(
      'rt skills compile --pack demo --verb watch-ci'
    );
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

    expect(onOpenManifest).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /^apply$/i })
    ).not.toBeInTheDocument();
  });
});
