import { Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { useSettingsRepo } from './useConsoleSettings';
import { repoLabel } from './view';

/** What an edit of a repo-scoped row reaches: every repo, or the picked
    one; with all repos, also how many repos set the key in a section. */
export function RepoReach({ def }: { def: SettingDefWire }) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  if (!def.repoScoped) return null;
  let label: string;
  if (repo) label = `for ${repoLabel(repo)}`;
  else {
    const n = def.repos?.length ?? 0;
    label =
      n === 0
        ? 'all repos'
        : `all repos · set in ${n} ${n === 1 ? 'repo' : 'repos'}`;
  }
  return (
    <Text fz={12} c={text.muted} style={{ whiteSpace: 'nowrap' }}>
      {label}
    </Text>
  );
}
