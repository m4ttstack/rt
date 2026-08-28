import { useMemo } from 'react';
import { navigate } from 'wouter/use-browser-location';

import { CopyActionIcon } from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';
import { Spotlight } from '@mattstack/app-kit/spotlight';
import type { SpotlightActionData } from '@mattstack/app-kit/spotlight';
import { useSettingsDefs } from '../config/useSettings';
import {
  BRANCH_CHECKOUT_LABEL,
  branchCheckoutCommand,
} from '../runs/branchCheckout';
import { repoLabel } from '../runs/repoLabel';
import { useRunList } from '../runs/useRuns';

/** wouter's `navigate` pushes a history entry even when `to` is the current
    URL; the palette can select the page you are already on, so this guards
    the no-op to avoid a dead back-button entry (the retired router did the
    same). */
function go(to: string) {
  const current =
    window.location.pathname + window.location.search + window.location.hash;
  if (to !== current) navigate(to);
}

function runAction(run: {
  id: string;
  repo: string;
  ticket: string | null;
  branch: string | null;
  status: string;
}): SpotlightActionData {
  return {
    id: `run-${run.repo}-${run.id}`,
    label: `${run.ticket ?? run.id} — ${repoLabel(run.repo)} ${run.status}`,
    keywords: [run.repo, run.ticket, run.branch, run.status].filter(
      (v): v is string => typeof v === 'string'
    ),
    onClick: () => go(`/runs/${run.repo}/${run.id}`),
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
    onClick: () => go('/'),
  },
  {
    id: 'nav-search',
    label: 'Search runs',
    leftSection: <Icons.search size={16} />,
    onClick: () => go('/search'),
  },
];

/**
 * One global instance, mounted once in App -- Spotlight owns its own portal
 * and keyboard shortcut, so a second instance would fight the first over the
 * same `mod+K`.
 */
export function ConsolePalette() {
  const runsQuery = useRunList();
  const defsQuery = useSettingsDefs();

  const actions: SpotlightActionData[] = useMemo(() => {
    const runs = runsQuery.data?.runs ?? [];
    const configActions: SpotlightActionData[] = (
      defsQuery.data?.defs ?? []
    ).map(def => ({
      id: `config-${def.key}`,
      label: `${def.key} — ${def.description}`,
      keywords: [def.key, ...def.key.split('.'), 'config', 'setting'],
      onClick: () => go(`/config/${def.key}`),
      leftSection: <Icons.settings size={16} />,
    }));
    return [...runs.map(runAction), ...configActions, ...STATIC_ACTIONS];
  }, [runsQuery.data, defsQuery.data]);

  return (
    <Spotlight
      actions={actions}
      shortcut="mod + K"
      nothingFound="No matching runs or actions."
      searchProps={{ placeholder: 'Search runs, or jump to a page…' }}
    />
  );
}
