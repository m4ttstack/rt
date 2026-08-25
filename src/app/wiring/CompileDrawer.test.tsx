import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { renderWithProviders } from '@ui/storybook/test-utils';
import type { SpineEntry } from './outline';

const compileGet = vi.fn();

vi.mock('../api', () => ({
  client: {
    api: {
      skills: {
        compile: { $get: (...args: unknown[]) => compileGet(...args) },
      },
    },
  },
}));

const { CompileDrawer } = await import('./CompileDrawer');

function ok(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function entry(
  over: Partial<SpineEntry> & { key: string; label: string }
): SpineEntry {
  return {
    kind: 'stage',
    ref: null,
    verb: null,
    step: null,
    invocable: false,
    external: false,
    unwired: false,
    sourcePath: null,
    artifactPath: null,
    health: 'unknown',
    staleFiles: [],
    orphanFiles: [],
    slots: [],
    ...over,
  };
}

const ORCHESTRATOR = entry({
  kind: 'orchestrator',
  key: 'mattstack:work',
  label: 'work',
  ref: 'mattstack:work',
  verb: 'work',
  health: 'in-sync',
  staleFiles: ['work/SKILL.md'],
});

/** No binder names it, no roster verb backs it -- exactly the stage that
    must not become a dead option in the switcher. */
const UNVERBED_STAGE = entry({
  key: 'mattstack:stage-provision',
  label: 'stage-provision',
  ref: 'mattstack:stage-provision',
  step: 1,
});

const IMPLEMENT = entry({
  key: 'mattstack:stage-implement',
  label: 'implement',
  ref: 'mattstack:stage-implement',
  verb: 'implement',
  step: 2,
  invocable: true,
  health: 'in-sync',
  orphanFiles: ['implement/old-fill.md'],
  slots: [
    {
      name: 'criteria',
      contract: 'criteria@1',
      required: false,
      boundTo: null,
      fillSourcePath: null,
      fill: null,
      siteCount: 0,
      inlined: null,
    },
  ],
});

const SHIP = entry({
  key: 'mattstack:stage-ship',
  label: 'ship',
  ref: 'mattstack:stage-ship',
  verb: 'ship',
  step: 3,
  invocable: true,
  health: 'source-newer',
  staleFiles: ['ship/SKILL.md'],
});

const PIPELINE = [ORCHESTRATOR, UNVERBED_STAGE, IMPLEMENT, SHIP];

function previewOf(target: SpineEntry) {
  return {
    verb: target.verb as string,
    changedFiles: [...target.staleFiles, ...target.orphanFiles],
    slots: target.slots,
  };
}

/** A minimal stand-in for `WiringMap`'s own preview state: `onSwitch`
    replaces it wholesale with the NEW entry's values, the same contract
    `WiringMap`'s `switchPreview` upholds (see WiringMap.test.tsx for the
    real caller wired to a real spine). */
function Harness({
  initial,
  entries,
  onClose,
}: {
  initial: SpineEntry;
  entries: SpineEntry[];
  onClose?: () => void;
}) {
  const [state, setState] = useState(previewOf(initial));
  return (
    <CompileDrawer
      pack="demo"
      verb={state.verb}
      changedFiles={state.changedFiles}
      slots={state.slots}
      entries={entries}
      onSwitch={next => {
        if (next.verb) setState(previewOf(next));
      }}
      onClose={onClose ?? (() => {})}
    />
  );
}

function switcher() {
  return screen.getByRole('combobox', { name: /walk the pipeline/i });
}

function renderHarness(props: {
  initial: SpineEntry;
  entries: SpineEntry[];
  onClose?: () => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderWithProviders(
    <QueryClientProvider client={queryClient}>
      <Harness {...props} />
    </QueryClientProvider>
  );
}

test('lists the pipeline in spine order, including an in-sync stage, and skips one with no verb', async () => {
  compileGet.mockResolvedValue(ok({ content: '# work' }));
  const user = userEvent.setup();
  renderHarness({ initial: ORCHESTRATOR, entries: PIPELINE });

  await user.click(switcher());

  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
    'work',
    'implement',
    'ship',
  ]);
});

test('switching to another stage refetches and previews that verb', async () => {
  compileGet.mockImplementation(
    async (args: { query: { pack: string; verb: string } }) =>
      ok({ content: `# ${args.query.verb} body` })
  );
  const user = userEvent.setup();
  renderHarness({ initial: ORCHESTRATOR, entries: PIPELINE });

  await waitFor(() =>
    expect(compileGet).toHaveBeenCalledWith(
      expect.objectContaining({ query: { pack: 'demo', verb: 'work' } })
    )
  );

  await user.click(switcher());
  await user.click(screen.getByRole('option', { name: 'ship' }));

  await waitFor(() =>
    expect(compileGet).toHaveBeenCalledWith(
      expect.objectContaining({ query: { pack: 'demo', verb: 'ship' } })
    )
  );
  expect(screen.getByTestId('command-provenance')).toHaveTextContent(
    'rt skills compile --verb ship --preview'
  );
  await waitFor(() =>
    expect(screen.getByTestId('compile-preview-body')).toHaveTextContent(
      'ship body'
    )
  );
});

test("switching carries the NEW entry's changed files and slots, not the previous verb's", async () => {
  compileGet.mockResolvedValue(ok({ content: '# body' }));
  const user = userEvent.setup();
  renderHarness({ initial: ORCHESTRATOR, entries: PIPELINE });

  await screen.findByText('work/SKILL.md');

  await user.click(switcher());
  await user.click(screen.getByRole('option', { name: 'implement' }));

  await screen.findByTestId('compile-preview-body');
  expect(screen.queryByText('work/SKILL.md')).not.toBeInTheDocument();
  expect(screen.getByText('implement/old-fill.md')).toBeInTheDocument();
  expect(screen.getByTestId('compiled-slot-criteria')).toHaveTextContent(
    'nothing bound, so nothing to compile in'
  );
});
