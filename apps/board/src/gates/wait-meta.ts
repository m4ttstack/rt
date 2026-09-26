// Wait-style gates (login, next) are opened with their prose and their pane
// in `meta` rather than in the row's own `context` and `origin`, so every
// reader of either goes through these helpers, which fall back to `meta`
// when the row's field is empty.

import type { GateOrigin } from '@mattstack/gate-kit';

interface GateFields {
  context?: string | null;
  origin?: GateOrigin | null;
  meta?: Record<string, unknown> | null;
}

function metaString(gate: GateFields, key: string): string | undefined {
  const value = gate.meta?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

export function gateContext(gate: GateFields): string | undefined {
  return gate.context || metaString(gate, 'context');
}

export function gateOrigin(gate: GateFields): GateOrigin | undefined {
  if (gate.origin?.paneId || gate.origin?.worktree) return gate.origin;
  const paneId = metaString(gate, 'paneId');
  const worktree = metaString(gate, 'worktree');
  if (!paneId && !worktree) return gate.origin ?? undefined;
  return {
    ...gate.origin,
    ...(paneId && { paneId }),
    ...(worktree && { worktree }),
  };
}
