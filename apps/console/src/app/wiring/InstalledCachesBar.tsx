import {
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';

import { SOFT_RULE } from './SlotRow';
import {
  useSkillsSync,
  type SkillsInstalled,
  type SkillsSyncReport,
} from './useWiring';

export interface InstalledCachesBarProps {
  pack: string;
  installed: SkillsInstalled | null | undefined;
  /** Any verb stale or never-compiled per check -- the bar's warn state.
      Sync fixes exactly this class, so it shares the group cards' framing. */
  drift: boolean;
}

type BarState =
  'syncing' | 'synced' | 'refused' | 'recompile' | 'update' | 'in-sync';

const STATE_LABEL: Record<BarState, string> = {
  syncing: 'syncing',
  synced: 'synced',
  refused: 'refused',
  recompile: 'recompile needed',
  update: 'update needed',
  'in-sync': 'in sync',
};

const STATE_COLOR: Record<BarState, MantineColor> = {
  syncing: 'accent',
  synced: 'ok',
  refused: 'bad',
  recompile: 'warn',
  update: 'accent',
  'in-sync': 'ok',
};

function refusalDetailOf(report: SkillsSyncReport | undefined): string | null {
  if (!report || report.ok) return null;
  if (typeof report.error === 'string') return report.error;
  const stopped = report.steps?.find(
    step => step.status === 'refused' || step.status === 'failed'
  );
  return stopped?.detail ?? 'sync stopped without a reason';
}

function versionsLine(
  installed: SkillsInstalled | null | undefined,
  report: SkillsSyncReport | undefined
): string | null {
  if (report?.versions) {
    const { installedBefore, installedAfter, source } = report.versions.pack;
    if (installedBefore === installedAfter && installedAfter === source) {
      return 'matches source';
    }
    return `${installedBefore ?? 'none'} installed to ${installedAfter ?? 'none'} (source ${source})`;
  }
  if (!installed) return null;
  if (installed.status === 'current') return 'matches source';
  return `${installed.version ?? 'none'} installed, ${installed.sourceVersion} source`;
}

/**
 * Pack-level "Installed caches" bar: the one surface that sees past compiled
 * output to the installed plugin cache, and the door to `rt skills sync`.
 * Renders nothing when there is neither drift nor installed data (an rt too
 * old to report the field must not be dressed as "in sync").
 */
export function InstalledCachesBar({
  pack,
  installed,
  drift,
}: InstalledCachesBarProps) {
  const { bg, text, border } = useSchemeColors();
  const sync = useSkillsSync(pack);
  const report = sync.data;

  if (!drift && installed == null && !report && !sync.isPending) return null;

  const state: BarState = sync.isPending
    ? 'syncing'
    : report
      ? report.ok
        ? 'synced'
        : 'refused'
      : drift
        ? 'recompile'
        : installed && installed.status !== 'current'
          ? 'update'
          : 'in-sync';

  const refusal = state === 'refused' ? refusalDetailOf(report) : null;
  const versions = versionsLine(installed, report);
  const showRestart = state === 'synced' && report?.restartNeeded === true;
  const stepTone = (status: string) =>
    status === 'ran'
      ? text.highContrast('ok')
      : status === 'skipped'
        ? text.muted
        : text.highContrast('bad');

  return (
    <Paper
      bg={bg.level2}
      radius="xl"
      style={{ border: `1px solid ${border.default}`, padding: '13px 16px' }}
      data-testid="installed-caches-bar"
    >
      <Group gap={9} align="center" wrap="nowrap">
        <div
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            flex: 'none',
            background: text.highContrast(STATE_COLOR[state]),
          }}
        />
        <Text fz={12.5} fw={700} style={{ flex: 'none' }}>
          Installed caches
        </Text>
        <Badge
          size="xs"
          variant="light"
          color={STATE_COLOR[state]}
          radius="xl"
          style={{ flex: 'none' }}
          data-testid="installed-caches-badge"
        >
          {STATE_LABEL[state]}
        </Badge>
        {versions && (
          <Text ff="monospace" fz={11} c={text.muted} truncate>
            {versions}
          </Text>
        )}
        <div style={{ flex: 1 }} />
        {showRestart ? (
          <Group
            gap={6}
            align="center"
            wrap="nowrap"
            bg={bg.level3}
            style={{ borderRadius: 999, padding: '5px 12px', flex: 'none' }}
            data-testid="installed-caches-restart"
          >
            <Icons.info
              size={12}
              color={text.highContrast('accent')}
              aria-hidden
            />
            <Text fz={11} c={text.muted}>
              restart running sessions to apply
            </Text>
          </Group>
        ) : (
          <UnstyledButton
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            data-testid="installed-caches-sync"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 26,
              padding: '0 10px',
              border: `1px solid ${border.color('accent')}`,
              borderRadius: 7,
              background: bg.color('accent'),
              color: text.highContrast('accent'),
              fontSize: 11,
              fontWeight: 600,
              flex: 'none',
              opacity: sync.isPending ? 0.5 : 1,
            }}
          >
            <Icons.refresh size={13} aria-hidden />
            {sync.isPending ? 'Syncing' : 'Sync'}
          </UnstyledButton>
        )}
      </Group>

      {refusal && (
        <Paper
          bg={bg.color('bad')}
          radius="md"
          style={{
            border: `1px solid ${border.color('bad')}`,
            padding: '10px 12px',
            marginTop: 12,
          }}
          data-testid="installed-caches-refusal"
        >
          <Text ff="monospace" fz={11.5} c={text.highContrast('bad')}>
            {refusal}
          </Text>
        </Paper>
      )}

      {report?.steps && report.steps.length > 0 && (
        <Stack
          gap={6}
          style={{
            marginTop: 12,
            borderTop: `1px solid ${SOFT_RULE}`,
            paddingTop: 10,
          }}
          data-testid="installed-caches-steps"
        >
          {report.steps.map(step => (
            <Group key={step.name} gap={8} align="center" wrap="nowrap">
              <Text
                ff="monospace"
                fz={11}
                c={stepTone(step.status)}
                style={{ flex: 'none' }}
              >
                {step.name}
              </Text>
              <Text ff="monospace" fz={11} c={text.muted} truncate>
                {step.status}
                {step.detail ? ` (${step.detail})` : ''}
              </Text>
            </Group>
          ))}
          {report.warnings?.map(warning => (
            <Text
              key={warning}
              ff="monospace"
              fz={11}
              c={text.highContrast('warn')}
            >
              {warning}
            </Text>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
