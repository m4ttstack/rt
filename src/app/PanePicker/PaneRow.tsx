import type { ReactNode } from 'react';
import {
  Box,
  Group,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useIsMobile } from '@mattstack/app-kit/hooks';
import { Icon } from '@mattstack/app-kit/icons';

import { DOT_COLOR, headTruncatePath } from '../presence-bits';
import type { AgentStatus, ChatPane } from './types';

const MUTED = 'var(--tk-muted-text)';
const BORDER = 'var(--tk-border)';
const BORDER_SOFT = 'var(--tk-border-soft)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';
const ACCENT_WASH = `color-mix(in srgb, ${ACCENT_TEXT} var(--tk-wash), transparent)`;
const ACCENT_DEEP =
  'light-dark(var(--mantine-color-accent-7), var(--mantine-color-accent-text))';
const ACCENT_ON = 'light-dark(var(--mantine-color-white), var(--tk-bg))';

const STATE_COLOR: Record<AgentStatus, string> = {
  working: 'var(--mantine-color-warn-text)',
  blocked: 'var(--mantine-color-bad-text)',
  idle: MUTED,
  done: MUTED,
  unknown: MUTED,
};

const STATE_WORD: Record<AgentStatus, string> = {
  working: 'working',
  blocked: 'at a prompt',
  idle: 'idle',
  done: 'done',
  unknown: 'unknown',
};

// The queueing/answering mechanics live in the tooltip, not the row, so a
// dense list stays scannable at a glance.
const STATE_TOOLTIP: Partial<Record<AgentStatus, string>> = {
  working: 'the invite queues until its turn ends',
  blocked: 'answer its prompt first',
};

function paneWhere(pane: ChatPane): string {
  return [pane.repo, pane.branch].filter(Boolean).join(' · ');
}

function paneDetail(pane: ChatPane, withRooms: boolean): string {
  const where = paneWhere(pane);
  if (!withRooms) return where;
  const rooms = pane.presence?.rooms.length
    ? ` · in ${pane.presence.rooms.map(r => `#${r}`).join(', ')}`
    : '';
  return `${where}${rooms}`;
}

function withTooltip(label: string, node: ReactNode) {
  return label ? <Tooltip label={label}>{node}</Tooltip> : node;
}

function StateWord({ status }: { status: AgentStatus }) {
  const text = (
    <Text
      component="span"
      size="xs"
      style={{ color: STATE_COLOR[status], fontWeight: 500, flex: 'none' }}
    >
      {STATE_WORD[status]}
    </Text>
  );
  const tip = STATE_TOOLTIP[status];
  return tip ? <Tooltip label={tip}>{text}</Tooltip> : text;
}

export interface PaneRowProps {
  pane: ChatPane;
  /** Absent: no checkbox (the picked list in New room). */
  selected?: boolean;
  disabledReason?: string | null;
  onToggle?: () => void;
  onPeek?: () => void;
  peek?: string[] | 'loading';
  /** Rendered under the path: the note input, or the remove control. */
  extra?: ReactNode;
  trailing?: ReactNode;
  /** First row in its list: no top border (the list container's own border stands in for it). */
  first?: boolean;
}

export function PaneRow({
  pane,
  selected,
  disabledReason,
  onToggle,
  onPeek,
  peek,
  extra,
  trailing,
  first,
}: PaneRowProps) {
  const disabled = !!disabledReason;
  const handle = pane.presence?.handle;
  const sub =
    handle && pane.title === handle
      ? pane.workspace
      : `${pane.workspace}${pane.title ? ` · ${pane.title}` : ''}`;
  const mobile = useIsMobile();
  const checkSize = mobile ? 24 : 16;
  const eyeSize = mobile ? 44 : 22;
  const picked = !onToggle;
  const subText = (
    <Text component="span" size="xs" truncate style={{ color: MUTED, flex: 1 }}>
      {sub}
    </Text>
  );
  return (
    <Box
      data-testid={`pane-row-${pane.paneId}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--mantine-spacing-md)',
        padding: '8.4px var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        borderTop: first ? undefined : `1px solid ${BORDER_SOFT}`,
        minWidth: 0,
        background: selected ? ACCENT_WASH : undefined,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {onToggle && (
        <UnstyledButton
          role="checkbox"
          aria-checked={!!selected}
          aria-disabled={disabled}
          aria-label={`select ${handle ?? pane.paneId}`}
          data-testid={`pane-check-${pane.paneId}`}
          onClick={() => {
            if (!disabled) onToggle();
          }}
          style={{
            width: checkSize,
            height: checkSize,
            marginTop: 2,
            flex: 'none',
            borderRadius: 4,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `1px solid ${disabled ? MUTED : selected ? ACCENT_DEEP : BORDER}`,
            background: disabled
              ? 'var(--ui-bg-4)'
              : selected
                ? ACCENT_DEEP
                : 'var(--tk-bg)',
            color: ACCENT_ON,
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          {selected && !disabled && <Icon name="check" size={11} />}
        </UnstyledButton>
      )}
      <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Box
            component="span"
            data-testid={`pane-dot-${pane.paneId}`}
            style={{
              width: 8,
              height: 8,
              marginTop: 5,
              flex: 'none',
              borderRadius: '50%',
              // Hollow for both "no presence" and an offline one -- the same
              // muted/grey treatment `Roster`'s offline dot uses.
              background:
                pane.presence && pane.presence.status !== 'offline'
                  ? (DOT_COLOR[pane.presence.status as 'live' | 'idle'] ??
                    'transparent')
                  : 'transparent',
              border:
                pane.presence && pane.presence.status !== 'offline'
                  ? undefined
                  : `1px solid ${BORDER}`,
            }}
          />
          {handle ? (
            <Text component="span" size="sm" fw={600}>
              {handle}
            </Text>
          ) : (
            <Text component="span" size="sm" style={{ color: MUTED }}>
              not signed in
            </Text>
          )}
          <Text component="span" size="xs" style={{ color: MUTED }}>
            ·
          </Text>
          {picked ? withTooltip(paneDetail(pane, false), subText) : subText}
          {disabledReason ? (
            <Text
              component="span"
              size="xs"
              style={{ color: STATE_COLOR.blocked, flex: 'none' }}
            >
              {disabledReason}
            </Text>
          ) : (
            <StateWord status={pane.agentStatus} />
          )}
          {trailing}
          {onPeek &&
            withTooltip(
              'peek at recent output',
              <UnstyledButton
                aria-label="Peek at pane"
                data-testid={`pane-peek-button-${pane.paneId}`}
                onClick={onPeek}
                style={{
                  width: eyeSize,
                  height: eyeSize,
                  flex: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--mantine-radius-md)',
                  color: MUTED,
                }}
              >
                <Icon name="eye" size={13} />
              </UnstyledButton>
            )}
        </Group>
        {!picked &&
          pane.cwd &&
          withTooltip(
            paneDetail(pane, true),
            <Text component="span" size="xs" truncate style={{ color: MUTED }}>
              {headTruncatePath(pane.cwd)}
            </Text>
          )}
        {extra}
        {peek && (
          <Box
            component="pre"
            data-testid={`pane-peek-${pane.paneId}`}
            style={{
              margin: '4.8px 0 0',
              padding: '7.2px var(--mantine-spacing-md)',
              background: 'var(--tk-bg)',
              border: `1px solid ${BORDER}`,
              borderRadius: 4,
              fontFamily: 'inherit',
              fontSize: 'var(--tk-fs-2xs)',
              lineHeight: 1.5,
              whiteSpace: 'pre',
              overflowX: 'auto',
              color: MUTED,
            }}
          >
            {peek === 'loading' ? 'reading the pane…' : peek.join('\n')}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
