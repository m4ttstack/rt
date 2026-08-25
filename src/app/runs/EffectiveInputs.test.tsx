import type { RunDecisionRow } from '@mattstack/rt-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { EffectiveInputsPayload } from '../../server/effectiveInputs';

const effectiveInputsGet = vi.fn();
const stageDocGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      runs: {
        ':repo': {
          ':runId': {
            'effective-inputs': {
              $get: (...args: unknown[]) => effectiveInputsGet(...args),
            },
            'stage-doc': {
              $get: (...args: unknown[]) => stageDocGet(...args),
            },
          },
        },
      },
    },
  },
}));

const { EffectiveInputs } = await import('./EffectiveInputs');

function ok(data: unknown) {
  return { ok: true, status: 200, json: async () => data };
}

function fail(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) };
}

const PAYLOAD: EffectiveInputsPayload = {
  pipeline: 'implement',
  workType: 'feature',
  packVersions: [
    {
      pack: 'core',
      recordedSha: 'abc1234',
      currentSha: 'def5678',
      drifted: true,
    },
    {
      pack: 'ops',
      recordedSha: 'aaa1111',
      currentSha: 'aaa1111',
      drifted: false,
    },
  ],
  packDirty: false,
  stages: ['provision', 'implement'],
  config: [
    {
      key: 'rt.runsPruneDays',
      value: 30,
      provenance: [
        { scope: 'default', file: null },
        { scope: 'user', file: '/home/u/.rt/settings.json' },
      ],
    },
  ],
};

const DECISIONS: RunDecisionRow[] = [
  {
    contract: 'execution-strategy@1',
    scope: 'run',
    selection: '{"tier":"direct-tdd"}',
    decided_by: 'implement',
    decided_at: 1_700_000_000_000,
  },
];

function renderPanel({
  decisions = DECISIONS,
}: { decisions?: RunDecisionRow[] } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <EffectiveInputs repo="repo-tools" runId="run-1" decisions={decisions} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('EffectiveInputs', () => {
  it('renders the heading and all three list sections', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));

    renderPanel();

    expect(
      await screen.findByText(
        'Effective inputs — what was this run actually told?'
      )
    ).toBeInTheDocument();
    const pipelineSection = await screen.findByTestId(
      'effective-inputs-pipeline'
    );
    expect(pipelineSection).toBeInTheDocument();
    expect(
      within(pipelineSection).getByText('Pipeline & stages')
    ).toBeInTheDocument();

    const decisionsSection = screen.getByTestId('effective-inputs-decisions');
    expect(decisionsSection).toBeInTheDocument();
    expect(
      within(decisionsSection).getByText('Decisions in force')
    ).toBeInTheDocument();

    const configSection = screen.getByTestId('effective-inputs-config');
    expect(configSection).toBeInTheDocument();
    expect(
      within(configSection).getByText('Configuration')
    ).toBeInTheDocument();
  });

  it('renders "unset" (never the literal "undefined") for a config row with no value property', async () => {
    effectiveInputsGet.mockResolvedValue(
      ok({
        ...PAYLOAD,
        config: [
          {
            key: 'rt.runaway',
            provenance: [{ scope: 'default', file: null }],
          },
        ],
      })
    );

    renderPanel();

    const row = await screen.findByTestId('config-row-rt.runaway');
    expect(within(row).getByText('unset')).toBeInTheDocument();
    expect(within(row).queryByText('undefined')).not.toBeInTheDocument();
  });

  it('shows the config caveat caption verbatim', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));

    renderPanel();

    expect(
      await screen.findByText(
        'Current values, not as-run — runs do not record the config they read.'
      )
    ).toBeInTheDocument();
  });

  it('shows a drifted pack with the "source has moved since" badge', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));

    renderPanel();

    const coreRow = await screen.findByTestId('pack-row-core');
    expect(
      within(coreRow).getByText('source has moved since')
    ).toBeInTheDocument();

    const opsRow = screen.getByTestId('pack-row-ops');
    expect(within(opsRow).getByText('matches source')).toBeInTheDocument();
  });

  it('shows the pre-v2 caption when packVersions is null, without listing any pack rows', async () => {
    effectiveInputsGet.mockResolvedValue(
      ok({ ...PAYLOAD, packVersions: null })
    );

    renderPanel();

    expect(
      await screen.findByText('pre-v2 run — pack version not recorded')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('pack-row-core')).not.toBeInTheDocument();
  });

  it('shows the pack-dirty caption when packDirty is true', async () => {
    effectiveInputsGet.mockResolvedValue(ok({ ...PAYLOAD, packDirty: true }));

    renderPanel();

    expect(
      await screen.findByText(
        'pack tree had uncommitted changes — the as-run text may exist in no commit'
      )
    ).toBeInTheDocument();
  });

  it('shows a pack that could not be resolved here as "pack not resolvable here"', async () => {
    effectiveInputsGet.mockResolvedValue(
      ok({
        ...PAYLOAD,
        packVersions: [
          {
            pack: 'core',
            recordedSha: 'abc1234',
            currentSha: null,
            drifted: null,
          },
        ],
      })
    );

    renderPanel();

    const coreRow = await screen.findByTestId('pack-row-core');
    expect(
      within(coreRow).getByText('pack not resolvable here')
    ).toBeInTheDocument();
  });

  it('renders one row per decision as "contract → selection", with scope and decided_by', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));

    renderPanel();

    const row = await screen.findByTestId('decision-row-execution-strategy@1');
    expect(row).toHaveTextContent(
      'execution-strategy@1 → {"tier":"direct-tdd"}'
    );
    expect(row).toHaveTextContent('run');
    expect(row).toHaveTextContent('implement');
  });

  it('shows the empty-decisions copy when no decisions were recorded', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));

    renderPanel({ decisions: [] });

    expect(
      await screen.findByText('No decisions were recorded for this run.')
    ).toBeInTheDocument();
  });

  it('navigates to the config lens for a config row', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));

    renderPanel();

    const before = window.location.pathname;
    const row = await screen.findByTestId('config-row-rt.runsPruneDays');
    await userEvent.click(row);

    expect(window.location.pathname).toBe('/config/rt.runsPruneDays');
    expect(window.location.pathname).not.toBe(before);
  });

  it('opens a drawer with the compiled stage doc when a stage row is clicked', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));
    stageDocGet.mockResolvedValue(ok({ text: '# implement\n\nDo the thing.' }));

    renderPanel();

    await userEvent.click(await screen.findByTestId('stage-row-implement'));

    expect(stageDocGet).toHaveBeenCalledWith({
      param: { repo: 'repo-tools', runId: 'run-1' },
      query: { stage: 'implement' },
    });
    expect(
      await screen.findByText(/# implement\s+Do the thing\./)
    ).toBeInTheDocument();
  });

  it('shows the 404 no-doc copy as muted text instead of a code block', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));
    stageDocGet.mockResolvedValue(
      fail(404, 'no compiled doc recorded at this version')
    );

    renderPanel();

    await userEvent.click(await screen.findByTestId('stage-row-implement'));

    expect(
      await screen.findByText('no compiled doc recorded at this version')
    ).toBeInTheDocument();
  });

  it('names the joined inputs in words rather than a single fabricated command', async () => {
    effectiveInputsGet.mockResolvedValue(ok(PAYLOAD));

    renderPanel();

    await screen.findByTestId('effective-inputs');
    expect(
      screen.getByText(
        'joins rt runs show, rt skills packs --json, and git show at the recorded pack sha'
      )
    ).toBeInTheDocument();
  });

  it('renders an inline error instead of throwing when the fetch fails', async () => {
    effectiveInputsGet.mockResolvedValue(fail(502, 'daemon unreachable'));

    expect(() => renderPanel()).not.toThrow();

    expect(
      await screen.findByTestId('effective-inputs-error')
    ).toHaveTextContent('daemon unreachable');
    // The rest of the panel (heading, attribution) survives the failed fetch.
    expect(
      screen.getByText('Effective inputs — what was this run actually told?')
    ).toBeInTheDocument();
  });
});
