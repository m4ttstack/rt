import type { ReactNode } from 'react';
import { Box } from '@mattstack/app-kit/core';
import type { MantineColor } from '@mattstack/app-kit/core';
import type { RunSummary } from '@mattstack/rt-client';

/** The pill's tint/ink pair. Exported so surfaces and their tests read the
    same definition rather than each spelling the CSS out. */
export const pillTint = (color: MantineColor) =>
  `var(--mantine-color-${color}-light)`;
export const pillInk = (color: MantineColor) =>
  `light-dark(var(--mantine-color-${color}-9), var(--mantine-color-${color}-1))`;

export interface PillProps {
  color: MantineColor;
  /** `sm` annotates a dense row; `md` is the one a card header carries. */
  size?: 'sm' | 'md';
  children: ReactNode;
  'data-testid'?: string;
  'data-state'?: string;
}

/** The small rounded status-pill chrome shared by `LivenessChip` and
    `RunDetail`'s stage/status pill -- same tinted-background-on-high-contrast-
    text treatment, differing only in color and label. */
export function Pill({
  color,
  size = 'sm',
  children,
  'data-testid': dataTestId,
  'data-state': dataState,
}: PillProps) {
  return (
    <Box
      data-testid={dataTestId}
      data-state={dataState}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        padding: size === 'md' ? '5px 14px' : '2px 10px',
        fontSize: size === 'md' ? 12 : 11,
        fontWeight: 600,
        // The pill sits on a white card, so the tint has to carry real
        // contrast against white -- the palest ramp step disappears there.
        // Ink flips per scheme so the label stays readable on both fills.
        backgroundColor: pillTint(color),
        color: pillInk(color),
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

export type LivenessState =
  | 'blocked'
  | 'failed'
  | 'stale'
  | 'stranded'
  | 'driven'
  | 'idle'
  | 'running'
  | 'done'
  | 'finished-other';

export interface LivenessSpec {
  state: LivenessState;
  color: MantineColor;
  label: string;
}

/**
 * Precedence is a ladder, not independent conditions: `attention.reason`
 * (rt's own predicate) outranks agent status, which outranks the run's own
 * status. Each rung fires on the first match, so a blocked run never falls
 * through to its agent's status even when they'd disagree.
 */
export function livenessSpec(run: RunSummary): LivenessSpec {
  const { attention, agent } = run;

  if (attention.reason === 'blocked') {
    return {
      state: 'blocked',
      color: 'bad',
      label: agent?.pane ? `waiting on you · ${agent.pane}` : 'waiting on you',
    };
  }
  if (attention.reason === 'failed') {
    return { state: 'failed', color: 'bad', label: 'failed' };
  }
  if (attention.reason === 'stale') {
    // Evidence enumerates every rung the liveness ladder checked; a chip
    // only has room for the first.
    const [firstClause] = attention.evidence.split(',');
    return { state: 'stale', color: 'bad', label: `stale · ${firstClause}` };
  }
  if (attention.reason === 'stranded') {
    return { state: 'stranded', color: 'warn', label: 'stranded' };
  }
  if (agent?.status === 'working') {
    return {
      state: 'driven',
      color: 'ok',
      label: '● driven · agent working',
    };
  }
  if (agent?.status === 'idle') {
    return { state: 'idle', color: 'warn', label: '◌ idle' };
  }
  if (run.ended_at == null) {
    return { state: 'running', color: 'accent', label: 'running' };
  }
  // `status` is a free string past this point (done/abandoned/whatever a
  // future pipeline terminal state adds) -- the label carries the specifics
  // while `data-state` stays a closed set consumers can switch on.
  if (run.status === 'done') {
    return { state: 'done', color: 'ok', label: 'done' };
  }
  return { state: 'finished-other', color: 'warn', label: run.status };
}

export interface LivenessChipProps {
  run: RunSummary;
  size?: PillProps['size'];
}

export function LivenessChip({ run, size }: LivenessChipProps) {
  const { state, color, label } = livenessSpec(run);

  return (
    <Pill
      color={color}
      size={size}
      data-testid="liveness-chip"
      data-state={state}
    >
      {label}
    </Pill>
  );
}
