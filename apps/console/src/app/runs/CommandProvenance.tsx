import { Group, Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

export interface CommandProvenanceProps {
  /** The rt verb a person would type to get this panel's data. */
  command: string;
  /** `dataUpdatedAt` off the query that fetched it -- `undefined` before the
      first successful fetch. */
  asOf: number | undefined;
}

function formatAsOf(asOf: number | undefined): string {
  if (!asOf) return 'not yet fetched';
  return new Date(asOf).toLocaleTimeString();
}

/** Design law: every panel names the command that produced its data, and
    when. Kept to one quiet row -- provenance, not chrome -- so it never
    competes with the panel's own content. */
export function CommandProvenance({ command, asOf }: CommandProvenanceProps) {
  const { text } = useSchemeColors();
  return (
    <Group
      gap={6}
      wrap="nowrap"
      data-testid="command-provenance"
      style={{ color: text.dimmed }}
    >
      <Icons.terminal size={12} />
      <Text c={text.muted} size="xs" ff="monospace">
        {command}
      </Text>
      <Text c={text.dimmed} size="xs">
        as of {formatAsOf(asOf)}
      </Text>
    </Group>
  );
}
