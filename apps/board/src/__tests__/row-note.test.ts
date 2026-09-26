/** The row's note store (B10): what a save keeps, what an empty save
    clears, and how a note reaches /data.json. */
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import {
  attachNotes,
  MAX_NOTE_LEN,
  readNotes,
  writeNote,
} from '../row-note.ts';
import { openStateDb } from '../state/db.ts';

const db = openStateDb(
  join(mkdtempSync(join(tmpdir(), 'board-note-')), 'state.db')
);
afterAll(() => db.close());

const MR = 'https://gitlab.example.com/g/p/-/merge_requests/7';
const OTHER = 'https://gitlab.example.com/g/p/-/merge_requests/8';

test('a note round-trips, trimmed', () => {
  expect(writeNote(MR, '  rebase after !8 lands  ', db)).toBe(
    'rebase after !8 lands'
  );
  expect(readNotes(db).get(MR)).toBe('rebase after !8 lands');
});

test('a second save replaces the first', () => {
  writeNote(MR, 'first', db);
  writeNote(MR, 'second', db);
  expect(readNotes(db).get(MR)).toBe('second');
});

test('an empty save clears the note, and clears only that MR', () => {
  writeNote(MR, 'mine', db);
  writeNote(OTHER, 'theirs', db);
  expect(writeNote(MR, '   \n ', db)).toBeUndefined();
  const notes = readNotes(db);
  expect(notes.has(MR)).toBe(false);
  expect(notes.get(OTHER)).toBe('theirs');
});

test('a note is capped, not refused', () => {
  const long = 'x'.repeat(MAX_NOTE_LEN + 50);
  expect(writeNote(MR, long, db)!.length).toBe(MAX_NOTE_LEN);
  writeNote(MR, '', db);
});

test('attachNotes hangs the note on its own MR only', () => {
  const notes = new Map([[MR, 'mine']]);
  const rows = attachNotes(
    [{ webUrl: MR, iid: 7 }, { webUrl: OTHER, iid: 8 }, { iid: 9 }],
    notes
  );
  expect(rows[0]!.note).toBe('mine');
  expect(rows[1]!.note).toBeUndefined();
  expect(rows[2]!.note).toBeUndefined();
});
