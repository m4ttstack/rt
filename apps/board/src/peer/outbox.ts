import { Database } from 'bun:sqlite';

import { getStateDb, runCriticalWrite } from '../state/index.ts';
import type { DraftEnvelope } from './envelope.ts';

export interface OutboxEntry {
  envelope: DraftEnvelope;
  queuedAt: number;
  attempts: number;
}

/** Enqueue an outbound envelope. INSERT OR IGNORE: the UNIQUE envelope_id
    index makes a repeat enqueue for the same id a no-op, so the board's 60s
    tick and a triage run can both attempt the same send without duplicating
    the queue entry. */
export function enqueueOutbox(
  draft: DraftEnvelope,
  db: Database = getStateDb(),
  now: number = Date.now()
): void {
  runCriticalWrite('outbox enqueue', () => {
    db.query(
      'INSERT OR IGNORE INTO outbox (envelope_id, entry) VALUES (?, ?)'
    ).run(
      draft.id,
      JSON.stringify({ envelope: draft, queuedAt: now, attempts: 0 })
    );
  });
}

/** Every queued entry, in `id` order (insertion order). */
export function readOutbox(db: Database = getStateDb()): OutboxEntry[] {
  const rows = db.query('SELECT entry FROM outbox ORDER BY id ASC').all() as {
    entry: string;
  }[];
  const out: OutboxEntry[] = [];
  for (const row of rows) {
    try {
      const e = JSON.parse(row.entry) as OutboxEntry;
      if (e.envelope?.id) out.push(e);
    } catch {
      continue;
    }
  }
  return out;
}

/** 2xx delivered. 401/403 is the board's credential, not the envelope: the
    operator re-minted this board's token and it has not re-joined yet, so the
    queue must survive that window and go out after the re-join. Any other 4xx
    is permanent (notably 422 unknown-recipient, the common case while most MR
    authors aren't on the switchboard): drop and log, never a forever-retry
    loop. 5xx and network errors retry next drain. */
export function classifySend(
  status: number | 'network'
): 'sent' | 'drop' | 'retry' {
  if (status === 'network') return 'retry';
  if (status >= 200 && status < 300) return 'sent';
  if (status === 401 || status === 403) return 'retry';
  if (status >= 400 && status < 500) return 'drop';
  return 'retry';
}

export async function drainOutbox(
  send: (d: DraftEnvelope) => Promise<number | 'network'>,
  db: Database = getStateDb()
): Promise<{ sent: number; dropped: number; kept: number }> {
  const result = { sent: 0, dropped: 0, kept: 0 };
  for (const entry of readOutbox(db)) {
    const status = await send(entry.envelope);
    const cls = classifySend(status);
    if (cls === 'sent' || cls === 'drop') {
      if (cls === 'drop') {
        console.error(
          `outbox: dropping ${entry.envelope.type} ${entry.envelope.id} to ${entry.envelope.to} (${status})`
        );
      }
      runCriticalWrite('outbox dequeue', () => {
        db.query('DELETE FROM outbox WHERE envelope_id = ?').run(
          entry.envelope.id
        );
      });
      result[cls === 'sent' ? 'sent' : 'dropped']++;
    } else {
      result.kept++;
      runCriticalWrite('outbox retry bump', () => {
        db.query('UPDATE outbox SET entry = ? WHERE envelope_id = ?').run(
          JSON.stringify({ ...entry, attempts: entry.attempts + 1 }),
          entry.envelope.id
        );
      });
    }
  }
  return result;
}
