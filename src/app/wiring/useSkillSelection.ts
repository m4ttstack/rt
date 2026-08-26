import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { notifications } from '@ui/notifications';
import { buildAgentContext } from './agentContext';
import {
  pluginOf,
  type BindingSite,
  type SkillsComposition,
  type SpineEntry,
} from './outline';
import { splitCompiledBody } from './parseSeam';
import { fetchCompilePreview } from './useWiring';

export interface SkillSelection {
  selectedKey: string | null;
  setSelectedKey: (key: string | null) => void;
  /** Resolved from `entries` on every render, never a stale snapshot: a
      rebind or a re-fetched composition rebuilds the spine, and the panel
      has to read the fresh entry rather than the one captured on click. */
  selectedEntry: SpineEntry | null;
  panelOpen: boolean;
  /** Jumps the selection to whatever row owns a Used-by site, resolving a
      cross-plugin ref to its grouped row the same way `entries` renders it. */
  showInMap: (site: BindingSite) => void;
  copyAgentContext: (entry: SpineEntry) => Promise<void>;
}

export interface UseSkillSelectionParams {
  pack: string;
  /** Every row a click can select in THIS view -- both what resolves
      `selectedKey` to an entry and what `showInMap` can jump to. The
      Pipeline tab passes its whole spine's rows; the On-demand tab passes
      only its own Group 1 rows, so a Used-by site outside that group
      silently fails to jump rather than opening a panel this view never
      shows a row for. */
  entries: SpineEntry[];
  composition: SkillsComposition;
  /** Runs before a "show in map" jump changes the selection -- the Pipeline
      tab uses this to drop the attention filter first, since the target row
      may be one the filter is currently hiding. */
  beforeShowInMap?: () => void;
}

/**
 * The selection state and detail-panel actions `WiringSpineView` and
 * `OnDemandView` both need: which row's panel is open, resolving a Used-by
 * site back to a row, and the agent-context copy action. Extracted so a
 * fix to any of these (a resolution rule, an error path) lands once rather
 * than twice.
 */
export function useSkillSelection({
  pack,
  entries,
  composition,
  beforeShowInMap,
}: UseSkillSelectionParams): SkillSelection {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selectedEntry =
    selectedKey !== null
      ? (entries.find(entry => entry.key === selectedKey) ?? null)
      : null;
  const panelOpen = selectedEntry !== null;

  // A cross-plugin binder has no row of its own: it is one line inside its
  // plugin's grouped row, keyed by the plugin rather than the ref.
  const rowKeys = useMemo(
    () => new Set(entries.map(entry => entry.key)),
    [entries]
  );

  const showInMap = (site: BindingSite) => {
    const grouped = `external:${pluginOf(site.ref)}`;
    const key = rowKeys.has(site.ref)
      ? site.ref
      : rowKeys.has(grouped)
        ? grouped
        : null;
    if (!key) return;
    beforeShowInMap?.();
    setSelectedKey(key);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-testid="skill-row-${key}"]`)
        ?.scrollIntoView?.({ block: 'center' })
    );
  };

  // Fetches the compiled preview on demand and reads its seams the same way
  // `CompiledView` does, so the copied blob and the panel's own reading of
  // this verb's seams can never disagree.
  const copyAgentContext = async (entry: SpineEntry) => {
    if (!entry.verb) return;
    const verbEntry = composition.verbs.find(v => v.name === entry.verb);
    if (!verbEntry) return;
    try {
      const preview = await fetchCompilePreview(queryClient, pack, entry.verb);
      const seams = splitCompiledBody(preview.content).map(
        section => section.seam
      );
      await navigator.clipboard.writeText(
        buildAgentContext({ verb: verbEntry, seams })
      );
      notifications.success('Copied agent context');
    } catch (err) {
      notifications.error(
        `Could not copy agent context: ${(err as Error).message}`
      );
    }
  };

  return {
    selectedKey,
    setSelectedKey,
    selectedEntry,
    panelOpen,
    showInMap,
    copyAgentContext,
  };
}
