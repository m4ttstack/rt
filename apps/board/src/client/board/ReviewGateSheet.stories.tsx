import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { gateDraftKey } from '@mattstack/gate-kit/react';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { GateQuestion, GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { useGateForm } from './GateForm.tsx';
import { ReviewGateSheet } from './ReviewGateSheet.tsx';

/**
 * Storybook coverage for the full-screen review gate sheet (design doc
 * `docs/superpowers/specs/2026-09-18-review-gate-redesign-design.md` §4):
 * six invented findings across two chunked questions plus a clean-review
 * (outcome-only) variant. The sheet fills the viewport itself, so the stage
 * only needs the theme provider, not DecisionQueueModal.stories.tsx's tall
 * padded stage.
 */
function Stage({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark';
  children: ReactNode;
}) {
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      style={{ background: 'var(--bg)', color: 'var(--fg)', height: '100vh' }}
    >
      <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>
    </div>
  );
}

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <Stage scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}>
    <Story />
  </Stage>
);

const meta = {
  title: 'Gates/Board/ReviewGateSheet',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

function question(
  id: string,
  label: string,
  multi: boolean,
  options: GateQuestion['options']
): GateQuestion {
  return { id, label, multi, options };
}

const boardMr = {
  iid: 31,
  title: 'themed gate controls',
  webUrl: 'https://gitlab.example.com/acme/widgets/-/merge_requests/31',
  author: { id: 'gitlab:7', username: 'paul', name: 'Paul', avatarUrl: null },
  sourceBranch: 'board-28-themed-gate-controls',
  targetBranch: 'main',
  createdAt: '2026-09-17T09:00:00.000Z',
  diff: { additions: 84, deletions: 21, filesChanged: 6 },
} as unknown as BoardMRWithReview;

const findingsQuestions = [
  question('findings-1', 'Post which findings to !31?', true, [
    {
      value: 'f1',
      label: '[Critical] SQL built from unsanitized input',
      description: 'lib/db/query.ts:42 · parameterize the query',
    },
    {
      value: 'f2',
      label: '[Important] Missing null check on response',
      description:
        'lib/api/client.ts:88 · guard before dereferencing · kind:bug',
    },
    {
      value: 'f3',
      label: '[Important] Inconsistent error wording',
      description: 'lib/errors.ts:15 · align with the style guide',
    },
    {
      value: 'f4',
      label: '[Minor] Unused import',
      description: 'lib/utils.ts:3 · drop the dead import',
    },
  ]),
  question('findings-2', 'Post which findings to !31?', true, [
    {
      value: 'f5',
      label: '[Important] Retry loop lacks backoff',
      description:
        'lib/retry.ts:41 · add exponential backoff · kind:suggestion',
    },
    {
      value: 'f6',
      label: '[Minor] Inconsistent spacing',
      description: 'lib/format.ts:9 · run prettier',
    },
  ]),
  question('outcome', 'Verdict on !31', false, [
    {
      value: 'approve',
      label: 'approve (recommended)',
      description:
        'Approve !31 and post the selected findings as inline threads.',
    },
    {
      value: 'comment',
      label: 'comment',
      description:
        'Post the selected findings without a verdict; the important ones stay open.',
    },
  ]),
];

const sixFindingGate: GateRow = {
  gateId: 'sheet-six-findings',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1788962100000,
  questions: findingsQuestions,
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

const reportJson = JSON.stringify({
  summary: {
    readiness: 'with-fixes',
    reasoning: 'One critical injection risk; everything else is polish.',
  },
  findings: [],
  depth:
    'verify. jest 120/120 green; typecheck noise was codegen, not defects.',
  strengths: [
    {
      lead: 'Retry loop now covers the abort path',
      detail: 'lib/retry.ts:58, matches the earlier thread',
    },
    { lead: 'Config validation reads clean', detail: 'lib/config.ts:12-40' },
  ],
  checks: [
    { tag: 'PASS', text: 'jest suite (120/120)' },
    { tag: 'PASS', text: 'typecheck' },
    { tag: 'N/A', text: 'visual regression (no UI touched)' },
  ],
  notes: ['Consider a follow-up MR to backfill retry tests for the old path.'],
});

// Captured once at module scope, before any story stubs it: the restore
// target every fetchStub decorator falls back to and resets to on cleanup.
const REAL_FETCH = globalThis.fetch;

/** Installs a fetch stub for the story's mount only and restores the real
    fetch on unmount, rather than clobbering globalThis.fetch permanently.
    `handler` answers `/review/*` urls; anything it returns undefined for
    falls through to the real fetch. */
function fetchStub(
  handler: (url: string) => Response | Promise<Response> | undefined
) {
  return function FetchStubDecorator(Story: () => ReactNode) {
    // Installed during render, not in an effect: the sheet's own mount
    // effect fetches report.json, and child effects run before this
    // decorator's would, so an effect-installed stub arrives too late.
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = typeof input === 'string' ? input : input.toString();
      const stubbed = await handler(url);
      if (stubbed !== undefined) return stubbed;
      return REAL_FETCH(input as RequestInfo, init);
    }) as typeof fetch;
    useEffect(
      () => () => {
        globalThis.fetch = REAL_FETCH;
      },
      []
    );
    return <Story />;
  };
}

const noop = () => {};

function seedDraft(
  gateId: string,
  draft: {
    selections: Record<string, string | string[]>;
    notes: Record<string, string>;
    item: string | null;
  }
) {
  localStorage.setItem(gateDraftKey(gateId), JSON.stringify(draft));
}

function Host({ gate, mr }: { gate: GateRow; mr: BoardMRWithReview }) {
  const form = useGateForm(gate, noop);
  return (
    <ReviewGateSheet
      gate={gate}
      mr={mr}
      form={form}
      queue={{
        index: 1,
        total: 3,
        states: ['done', 'active', 'todo'],
        onPrev: noop,
        onNext: noop,
      }}
      onClose={noop}
      onSkip={noop}
      onFocusPane={noop}
    />
  );
}

// --- SixFindings -------------------------------------------------------

/** The full record cluster: report.json resolves with every optional array
    populated, so `/review/report.json` is mocked in rather than left to hit
    the network from Storybook's iframe. */
export const SixFindings: Story = {
  decorators: [
    fetchStub(url =>
      url.startsWith('/review/report.json')
        ? new Response(reportJson, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : undefined
    ),
  ],
  render: () => <Host gate={sixFindingGate} mr={boardMr} />,
};

// --- UnselectedSome ------------------------------------------------------

/** Mid-triage: three findings unchecked, so the tally and submit label both
    read a partial count -- the draft seed drives the same localStorage key
    useGateForm reads on mount. */
const partialGate: GateRow = { ...sixFindingGate, gateId: 'sheet-partial' };

export const UnselectedSome: Story = {
  decorators: [
    fetchStub(url =>
      url.includes('/review/')
        ? new Response('no structured review yet', { status: 404 })
        : undefined
    ),
  ],
  render: () => {
    seedDraft(partialGate.gateId, {
      selections: { findings: ['f1', 'f3', 'f5'], outcome: 'comment' },
      notes: {},
      item: null,
    });
    return <Host gate={partialGate} mr={boardMr} />;
  },
};

// --- CleanReview -----------------------------------------------------------

/** No findings at all: the outcome question rides alone, so the sheet skips
    the findings head/list entirely and shows only the MR card, the (absent)
    record cluster's full-report fallback, and the verdict. */
const cleanGate: GateRow = {
  gateId: 'sheet-clean',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/46',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1788964320000,
  questions: [
    question('outcome', 'Verdict on !46', false, [
      {
        value: 'approve',
        label: 'approve (recommended)',
        description: 'Approve !46; nothing was flagged worth a thread.',
      },
      {
        value: 'comment',
        label: 'comment',
        description: 'Leave a comment without approving.',
      },
    ]),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

const cleanMr = { ...boardMr, iid: 46 } as BoardMRWithReview;

export const CleanReview: Story = {
  decorators: [
    fetchStub(url =>
      url.includes('/review/')
        ? new Response('no structured review yet', { status: 404 })
        : undefined
    ),
  ],
  render: () => <Host gate={cleanGate} mr={cleanMr} />,
};
