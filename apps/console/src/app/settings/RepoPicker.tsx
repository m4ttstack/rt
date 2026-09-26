import { Select } from '@mattstack/app-kit/core';

import { INPUT_TYPE } from './controlStyles';
import { useRepos } from './useConsoleSettings';
import { repoLabel } from './view';

const ALL = '';

/** All repos, or one repo whose sections resolve the repo-scoped rows. A
    picked repo the list does not name yet (still loading, or only in the
    url) stays selectable under its own label. */
export function RepoPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (repo: string | null) => void;
}) {
  const { repos } = useRepos();
  const known = repos.some(r => r.identity === value);
  return (
    <Select
      aria-label="repo"
      size="xs"
      w={180}
      styles={INPUT_TYPE.label}
      allowDeselect={false}
      value={value ?? ALL}
      data={[
        { value: ALL, label: 'All repos' },
        ...repos.map(r => ({ value: r.identity, label: r.label })),
        ...(value && !known ? [{ value, label: repoLabel(value) }] : []),
      ]}
      onChange={v => onChange(v ? v : null)}
    />
  );
}
