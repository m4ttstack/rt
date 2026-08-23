import { useMemo } from 'react';

import { CopyActionIcon } from '@ui/core';
import { Icons } from '@ui/icons';
import { Spotlight } from '@ui/spotlight';
import type { SpotlightActionData } from '@ui/spotlight';
import { navigate } from '../router/navigation';
import {
  BRANCH_CHECKOUT_LABEL,
  branchCheckoutCommand,
} from '../runs/branchCheckout';
import { useRunList } from '../runs/useRuns';

function runAction(run: {
  id: string;
  repo: string;
  ticket: string | null;
  branch: string | null;
  status: string;
}): SpotlightActionData {
  return {
    id: `run-${run.repo}-${run.id}`,
    label: `${run.ticket ?? run.id} — ${run.repo} ${run.status}`,
    keywords: [run.repo, run.ticket, run.branch, run.status].filter(
      (v): v is string => typeof v === 'string'
    ),
    onClick: () => navigate(`/runs/${run.repo}/${run.id}`),
    leftSection: <Icons.layers size={16} />,
    rightSection: run.branch ? (
      <CopyActionIcon
        value={branchCheckoutCommand(run.branch)}
        label={BRANCH_CHECKOUT_LABEL}
      />
    ) : undefined,
  };
}

const STATIC_ACTIONS: SpotlightActionData[] = [
  {
    id: 'nav-board',
    label: 'Run board',
    leftSection: <Icons.layers size={16} />,
    onClick: () => navigate('/'),
  },
  {
    id: 'nav-search',
    label: 'Search runs',
    leftSection: <Icons.search size={16} />,
    onClick: () => navigate('/search'),
  },
];

/**
 * One global instance, mounted once in App -- Spotlight owns its own portal
 * and keyboard shortcut, so a second instance would fight the first over the
 * same `mod+K`.
 */
export function ConsolePalette() {
  const runsQuery = useRunList();

  const actions: SpotlightActionData[] = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    return [...runs.map(runAction), ...STATIC_ACTIONS];
  }, [runsQuery.data]);

  return (
    <Spotlight
      actions={actions}
      shortcut="mod + K"
      nothingFound="No matching runs or actions."
      searchProps={{ placeholder: 'Search runs, or jump to a page…' }}
    />
  );
}
