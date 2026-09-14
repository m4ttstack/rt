/** A note the board's seat writes on one MR, for itself: a line of plain
    text kept in the board's own state db, attached to /data.json, and never
    sent to GitLab, Slack or a pane. Notes are not pruned when an MR leaves
    the board -- they are hand-written, tiny, and an MR that comes back
    should still carry what its reader said about it. */

import { Database } from 'bun:sqlite';

import { deleteKvValue, listKvValues, setKvValue } from './state/index.ts';

export const NOTE_NS = 'row-note';
export const MAX_NOTE_LEN = 2000;

/** Trim, cap, and collapse the empty forms to undefined: an empty save is
    how the editor clears a note, so "" and "   " are a delete, not a note. */
export function normalizeNote(text: string): string | undefined {
  const trimmed = text.trim().slice(0, MAX_NOTE_LEN);
  return trimmed || undefined;
}

export function readNotes(db?: Database): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of listKvValues(NOTE_NS, db))
    if (typeof value === 'string' && value) out.set(key, value);
  return out;
}

/** Write or clear one MR's note. Returns what the row now carries, so the
    route can answer with the stored form rather than the typed one. */
export function writeNote(
  mrUrl: string,
  text: string,
  db?: Database
): string | undefined {
  const note = normalizeNote(text);
  if (note === undefined) deleteKvValue(NOTE_NS, mrUrl, db);
  else setKvValue(NOTE_NS, mrUrl, note, db);
  return note;
}

export function attachNotes<T extends { webUrl?: string | null }>(
  mrs: T[],
  notes: Map<string, string>
): Array<T & { note?: string }> {
  return mrs.map(mr => {
    const note = mr.webUrl ? notes.get(mr.webUrl) : undefined;
    return note ? { ...mr, note } : mr;
  });
}
