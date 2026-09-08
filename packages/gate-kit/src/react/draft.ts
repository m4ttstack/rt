import { useCallback, useEffect, useState } from 'react';

import type { GateSelections } from '../payload';

/** What a card keeps between visits to an open gate: the picks, the
    per-question notes, and which step was showing. */
export interface GateDraft {
  selections: GateSelections;
  notes: Record<string, string>;
  item: string | null;
}

export function gateDraftKey(gateId: string): string {
  return `gate-kit:draft:${gateId}`;
}

/** The `localStorage` getter itself throws when a browser blocks site data,
    and `setItem` throws on quota; a card must never see either. */
function guarded<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string');
}

function parseDraft(raw: string | null): GateDraft | null {
  if (raw === null) return null;
  const parsed = guarded<unknown>(() => JSON.parse(raw), null);
  if (parsed === null || typeof parsed !== 'object') return null;
  const { selections, notes, item } = parsed as Record<string, unknown>;
  if (selections === null || typeof selections !== 'object') return null;
  if (notes === null || typeof notes !== 'object') return null;
  if (item !== null && typeof item !== 'string') return null;
  const draft: GateDraft = { selections: {}, notes: {}, item };
  for (const [id, v] of Object.entries(selections as Record<string, unknown>))
    if (typeof v === 'string' || isStringArray(v)) draft.selections[id] = v;
  for (const [id, v] of Object.entries(notes as Record<string, unknown>))
    if (typeof v === 'string') draft.notes[id] = v;
  return draft;
}

function draftIsEmpty(draft: GateDraft): boolean {
  const picked = Object.values(draft.selections).some(v => v.length > 0);
  const noted = Object.values(draft.notes).some(n => n.trim().length > 0);
  return !picked && !noted;
}

export function readGateDraft(gateId: string): GateDraft | null {
  return guarded(
    () => parseDraft(localStorage.getItem(gateDraftKey(gateId))),
    null
  );
}

export function writeGateDraft(gateId: string, draft: GateDraft): void {
  guarded(() => {
    if (draftIsEmpty(draft)) localStorage.removeItem(gateDraftKey(gateId));
    else localStorage.setItem(gateDraftKey(gateId), JSON.stringify(draft));
  }, undefined);
}

export function clearGateDraft(gateId: string): void {
  guarded(() => localStorage.removeItem(gateDraftKey(gateId)), undefined);
}

/**
 * Per-gate resume state in localStorage. `initial` is read once, in the
 * state initializer, so a card can seed its own state from it on the first
 * render; `save` is a no-op while the gate is not open and removes the entry
 * rather than storing an empty draft; going not-open clears the entry. A
 * successful submit and a conflict loss are the card's own `clear` calls.
 */
export function useGateDraft(
  gateId: string,
  enabled: boolean
): {
  initial: GateDraft | null;
  save: (draft: GateDraft) => void;
  clear: () => void;
} {
  const [initial] = useState<GateDraft | null>(() =>
    enabled ? readGateDraft(gateId) : null
  );
  const save = useCallback(
    (draft: GateDraft) => {
      if (enabled) writeGateDraft(gateId, draft);
    },
    [enabled, gateId]
  );
  const clear = useCallback(() => clearGateDraft(gateId), [gateId]);
  useEffect(() => {
    if (!enabled) clearGateDraft(gateId);
  }, [enabled, gateId]);
  return { initial, save, clear };
}
