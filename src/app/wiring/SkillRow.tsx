import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from '@ui/core';
import type { MantineColor } from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import type { SpineEntry, WiringHealth } from './outline';
import { SlotTable } from './SlotRow';

/** Only the two states a reader has to act on carry a badge. `in-sync` and
    `internal-unchecked` are the quiet answers, and `unknown` is rt having
    said nothing about this ref -- none of the three earn a label. */
const HEALTH_BADGE: Partial<Record<WiringHealth, string>> = {
  'source-newer': 'source newer',
  'never-compiled': 'never compiled',
};

export const HEALTH_COLOR: Partial<Record<WiringHealth, MantineColor>> = {
  'in-sync': 'ok',
  'source-newer': 'warn',
  'never-compiled': 'bad',
  orphaned: 'purple',
};

/**
 * What the health state means for THIS row, said in the row rather than in a
 * legend. `check` reports which files it found newer, so the drift line names
 * them instead of guessing at "SKILL.md".
 */
function healthLines(entry: SpineEntry): string[] {
  const lines: string[] = [];

  if (entry.kind === 'orchestrator') {
    lines.push('reads the pipeline below and runs each stage in order');
  }
  if (entry.external) {
    lines.push("binds this pack's fills; nothing in the roster names these");
  }
  if (entry.health === 'source-newer') {
    const files =
      entry.staleFiles.length > 0
        ? entry.staleFiles.join(', ')
        : 'the artifact';
    lines.push(
      `${files} on disk is older than its sources — Claude is reading the previous compile`
    );
  }
  if (entry.health === 'never-compiled') {
    lines.push(
      entry.kind === 'stage'
        ? 'no artifact on disk — this stage will not load when the pipeline reaches it'
        : 'no artifact on disk — this skill will not load when it is invoked'
    );
  }
  if (entry.note) lines.push(entry.note);
  if (entry.engineError) lines.push(entry.engineError);

  return lines;
}

interface RowActionsProps {
  entry: SpineEntry;
  previewOpen: boolean;
  onPreview: () => void;
}

/**
 * An action appears only when it has a real target. A pipeline stage is
 * compiled INTO its orchestrator rather than into a skill of its own, so the
 * payload carries no source, no artifact and no verb to compile for it --
 * three disabled buttons would be three lies about what this page can do.
 */
function RowActions({ entry, previewOpen, onPreview }: RowActionsProps) {
  if (!entry.sourcePath && !entry.artifactPath && !entry.verb) return null;

  return (
    <Group gap="xs" wrap="nowrap" style={{ flex: 'none' }}>
      {entry.sourcePath && (
        <Tooltip label="Open source">
          <ActionIcon
            component="a"
            href={`vscode://file${entry.sourcePath}`}
            variant="subtle"
            color="gray"
            aria-label={`open source for ${entry.label}`}
            data-testid="open-source"
          >
            <Icons.edit size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      {entry.artifactPath && (
        <Tooltip label="Reveal artifact">
          <ActionIcon
            component="a"
            href={`vscode://file${entry.artifactPath}`}
            variant="subtle"
            color="gray"
            aria-label={`reveal artifact for ${entry.label}`}
            data-testid="reveal-artifact"
          >
            <Icons.eye size={16} />
          </ActionIcon>
        </Tooltip>
      )}
      {entry.verb && (
        <Tooltip label="Preview compile">
          <ActionIcon
            variant={previewOpen ? 'light' : 'subtle'}
            color={previewOpen ? 'accent' : 'gray'}
            onClick={onPreview}
            aria-label={`preview compile of ${entry.label}`}
            data-testid="toggle-compile-preview"
          >
            <Icons.zap size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

export interface SkillRowProps {
  entry: SpineEntry;
  previewOpen: boolean;
  onPreview: () => void;
  /** Outside-the-pipeline rows carry no step number, so health rides a dot
      in front of the name instead of the timeline bullet. */
  withDot?: boolean;
}

/**
 * One skill's row: what it is, what state it is in, and every slot it opens.
 * Health indicates ON the row -- it never groups the rows, never sorts them,
 * and never takes the place of a stage's number.
 */
export function SkillRow({
  entry,
  previewOpen,
  onPreview,
  withDot = false,
}: SkillRowProps) {
  const { text } = useSchemeColors();
  const badge = HEALTH_BADGE[entry.health];
  const color = HEALTH_COLOR[entry.health];
  const lines = healthLines(entry);

  return (
    <Stack gap={1} data-testid={`skill-row-${entry.key}`}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            {withDot && (
              <div
                aria-hidden
                data-testid="health-dot"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  flex: 'none',
                  background: color ? text.highContrast(color) : text.dimmed,
                }}
              />
            )}
            <Text fw={600} size="lg">
              {entry.label}
            </Text>
            {entry.ref && (
              <Text size="sm" c={text.muted} truncate>
                {entry.ref}
              </Text>
            )}
            {entry.kind === 'orchestrator' && (
              <Badge size="xs" variant="outline" color="gray">
                orchestrator
              </Badge>
            )}
            {badge && color && (
              <Badge
                size="sm"
                variant="light"
                color={color}
                data-testid="health-badge"
              >
                {badge}
              </Badge>
            )}
            {entry.external && (
              <Badge size="sm" variant="light" color="purple">
                another plugin
              </Badge>
            )}
            {entry.kind === 'outside' &&
              !entry.external &&
              !entry.invocable && (
                <Badge size="xs" variant="outline" color="gray">
                  internal
                </Badge>
              )}
            {entry.sameWiringAsStep !== undefined && (
              <Badge size="xs" variant="outline" color="gray">
                same wiring as stage {entry.sameWiringAsStep}
              </Badge>
            )}
          </Group>
          {lines.map(line => (
            <Text key={line} size="xs" c={text.muted}>
              {line}
            </Text>
          ))}
        </Stack>
        <RowActions
          entry={entry}
          previewOpen={previewOpen}
          onPreview={onPreview}
        />
      </Group>
      <SlotTable slots={entry.slots} />
    </Stack>
  );
}
