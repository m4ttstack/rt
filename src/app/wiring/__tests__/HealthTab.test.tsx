import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const compositionGet = vi.fn();
const checkGet = vi.fn();

vi.mock('../../api', () => ({
  client: {
    api: {
      skills: {
        composition: { $get: (...args: unknown[]) => compositionGet(...args) },
        check: { $get: (...args: unknown[]) => checkGet(...args) },
      },
    },
  },
}));

const { HealthTab } = await import('../HealthTab');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function verb(name: string, engineRef: string, isPublic = true) {
  return {
    name,
    engine: name,
    engineRef,
    plugin: engineRef.split(':')[0],
    description: name,
    public: isPublic,
    sourcePath: `/plugins/${engineRef.split(':')[0]}/attachments/${name}/SKILL.md`,
    artifactPath: `/p/skills/${name}`,
    slots: [],
  };
}

/** `work` is the orchestrator (in-sync). `review-criteria`/`reply-rules` are
    bound by a `verb`-kind binder, so they are wired -- their drift is real
    drift, not a side effect of also being unwired. `checkout`/
    `checkout-and-open` are in neither `binders` nor the pipeline, so
    `buildSpine` sweeps them in as unwired, both otherwise in-sync. */
const COMPOSITION = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    verb('work', 'mattstack:work'),
    verb('review-criteria', 'acme:review-criteria'),
    verb('reply-rules', 'acme:reply-rules'),
    verb('checkout', 'mattstack:checkout', false),
    verb('checkout-and-open', 'mattstack:checkout-and-open', false),
  ],
  fills: [],
  binders: [
    {
      ref: 'acme:review-criteria',
      verb: 'review-criteria',
      kind: 'verb' as const,
      slots: [],
    },
    {
      ref: 'acme:reply-rules',
      verb: 'reply-rules',
      kind: 'verb' as const,
      slots: [],
    },
  ],
  pipelines: { feature: [] as string[] },
};

const CHECK = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    { name: 'work', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    {
      name: 'review-criteria',
      status: 'stale',
      staleFiles: ['SKILL.md'],
      orphanFiles: [],
    },
    {
      name: 'reply-rules',
      status: 'never-compiled',
      staleFiles: [],
      orphanFiles: [],
    },
    { name: 'checkout', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    {
      name: 'checkout-and-open',
      status: 'in-sync',
      staleFiles: [],
      orphanFiles: [],
    },
  ],
};

const ALL_IN_SYNC_COMPOSITION = {
  ...COMPOSITION,
  verbs: [
    verb('work', 'mattstack:work'),
    verb('review-criteria', 'acme:review-criteria'),
  ],
  binders: [
    {
      ref: 'acme:review-criteria',
      verb: 'review-criteria',
      kind: 'verb' as const,
      slots: [],
    },
  ],
};

const ALL_IN_SYNC_CHECK = {
  pack: 'demo',
  packDir: '/p',
  verbs: [
    { name: 'work', status: 'in-sync', staleFiles: [], orphanFiles: [] },
    {
      name: 'review-criteria',
      status: 'in-sync',
      staleFiles: [],
      orphanFiles: [],
    },
  ],
};

/** COMPOSITION plus one fill (`demo:unused`) that no binder names -- an
    orphan, which Health lists in the Unwired group beside the unwired verbs. */
const COMPOSITION_WITH_ORPHAN = {
  ...COMPOSITION,
  fills: [
    {
      binding: 'demo:unused',
      provides: 'unused@1',
      sourcePath: '/fills/unused/SKILL.md',
      registered: false,
    },
  ],
};

function renderHealthTab(
  onOpenSkill?: (verb: string) => void,
  composition: unknown = COMPOSITION,
  check: unknown = CHECK
) {
  compositionGet.mockResolvedValue(ok(composition));
  checkGet.mockResolvedValue(ok(check));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <HealthTab pack="demo" onOpenSkill={onOpenSkill} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('HealthTab: stat cards', () => {
  it('renders the four stat cards with counts derived from check + the binder graph', async () => {
    renderHealthTab();

    expect(await screen.findByTestId('health-stat-in-sync')).toHaveTextContent(
      '3'
    );
    expect(screen.getByTestId('health-stat-source-newer')).toHaveTextContent(
      '1'
    );
    expect(screen.getByTestId('health-stat-never-compiled')).toHaveTextContent(
      '1'
    );
    expect(screen.getByTestId('health-stat-unwired')).toHaveTextContent('2');
  });
});

describe('HealthTab: grouped issues', () => {
  it('lists stale verbs under Recompile needed', async () => {
    renderHealthTab();

    const group = await screen.findByTestId('health-group-recompile-needed');
    expect(group).toHaveTextContent('review-criteria');
    expect(group).toHaveTextContent('acme:review-criteria');
    expect(group).toHaveTextContent('1 stale file');
    expect(
      screen.getByTestId('health-group-count-recompile-needed')
    ).toHaveTextContent('1');
  });

  it('lists never-compiled verbs under Never compiled', async () => {
    renderHealthTab();

    const group = await screen.findByTestId('health-group-never-compiled');
    expect(group).toHaveTextContent('reply-rules');
    expect(group).toHaveTextContent('no artifact on disk yet');
  });

  it('lists unwired verbs under Unwired, without a Preview compile action', async () => {
    renderHealthTab();

    const group = await screen.findByTestId('health-group-unwired');
    expect(group).toHaveTextContent('checkout');
    expect(group).toHaveTextContent('checkout-and-open');
    expect(group).toHaveTextContent('no slots · nothing binds it');
    expect(
      screen.queryByTestId('health-preview-compile-mattstack:checkout')
    ).not.toBeInTheDocument();
  });

  it('lists orphan fills in the Unwired group, counted with the verbs and non-clickable', async () => {
    renderHealthTab(undefined, COMPOSITION_WITH_ORPHAN, CHECK);

    const group = await screen.findByTestId('health-group-unwired');
    expect(group).toHaveTextContent('checkout');
    expect(group).toHaveTextContent('unused');
    expect(group).toHaveTextContent('unused@1');
    expect(group).toHaveTextContent('unregistered fill · nothing binds it');
    // 2 unwired verbs + 1 orphan fill; the pointer on the On-demand tab counts
    // the same three, so the two surfaces now agree.
    expect(screen.getByTestId('health-stat-unwired')).toHaveTextContent('3');
    // A fill has no detail panel, so its row opens nothing.
    expect(
      screen.queryByRole('button', { name: 'open unused' })
    ).not.toBeInTheDocument();
  });
});

describe('HealthTab: row interaction', () => {
  it("clicking a row calls onOpenSkill with that row's verb name", async () => {
    const onOpenSkill = vi.fn();
    const user = userEvent.setup();
    renderHealthTab(onOpenSkill);

    await user.click(
      await screen.findByTestId('health-row-acme:review-criteria')
    );

    expect(onOpenSkill).toHaveBeenCalledWith('review-criteria');
  });

  it('clicking Preview compile also opens the skill, without double-firing the row click', async () => {
    const onOpenSkill = vi.fn();
    const user = userEvent.setup();
    renderHealthTab(onOpenSkill);

    await user.click(
      await screen.findByTestId('health-preview-compile-acme:reply-rules')
    );

    expect(onOpenSkill).toHaveBeenCalledTimes(1);
    expect(onOpenSkill).toHaveBeenCalledWith('reply-rules');
  });
});

describe('HealthTab: empty state', () => {
  it('shows a clean "all in sync" panel when nothing is stale, never-compiled, or unwired', async () => {
    renderHealthTab(undefined, ALL_IN_SYNC_COMPOSITION, ALL_IN_SYNC_CHECK);

    expect(await screen.findByTestId('health-empty')).toHaveTextContent(
      'All in sync.'
    );
    expect(
      screen.queryByTestId('health-group-recompile-needed')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('health-group-never-compiled')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('health-group-unwired')
    ).not.toBeInTheDocument();
  });
});
