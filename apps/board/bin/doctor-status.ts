import { existsSync } from 'fs';

import {
  boardRootFromStatePath,
  emitAgentStatus,
} from '../src/agent-status/emit.ts';
import type { DoctorState, DoctorStatus } from '../src/doctor-state.ts';
import {
  dbPathForRoot,
  openStateDb,
  updateByHandle,
} from '../src/state/index.ts';

const VALID: DoctorStatus[] = [
  'queued',
  'diagnosing',
  'rebasing',
  'fixing',
  'watching',
  'done',
  'error',
];

const [path, status, ...rest] = process.argv.slice(2);
const message = rest.join(' ').trim();

if (!path || !status || !VALID.includes(status as DoctorStatus)) {
  console.error(
    `usage: doctor-status <statePath> <${VALID.join('|')}> [message]`
  );
  process.exit(1);
}

const dbPath = dbPathForRoot(boardRootFromStatePath(path));
if (!existsSync(dbPath)) {
  console.error(`no board db at ${dbPath}; stale pre-upgrade handle?`);
  process.exit(1);
}
const db = openStateDb(dbPath, 'cli');
const merged = updateByHandle(
  path,
  {
    status: status as DoctorStatus,
    ...(message ? { message } : {}),
  },
  Date.now(),
  db
) as (DoctorState & { mrUrl: string; iid: number }) | null;
if (!merged) {
  console.error(
    `no state row for ${path}; was this pane launched by a board on this machine?`
  );
  process.exit(1);
}

await emitAgentStatus(
  {
    mrUrl: merged.mrUrl,
    iid: merged.iid,
    kind: 'doctor',
    status,
  },
  boardRootFromStatePath(path)
);

// AUTO doctors leave a full audit trail (spec §6: one line per autonomous
// action). The pane reports each action as a status write whose message names
// it (see the wrapper contract), so mirroring every transition of an
// origin-auto doctor into the JSONL covers actions and outcomes alike.
if (merged.origin === 'auto') {
  try {
    const { appendAudit, auditPathForRoot } = await import(
      '../src/triage/audit.ts'
    );
    appendAudit(
      {
        ts: Date.now(),
        mrUrl: merged.mrUrl,
        iid: merged.iid,
        event: 'doctor-status',
        action: status,
        outcome: merged.message,
      },
      auditPathForRoot(boardRootFromStatePath(path))
    );
  } catch (err) {
    console.error(
      `audit append failed: ${err instanceof Error ? err.message : err}`
    );
  }
}

// Escalation is the one loud moment (spec §3): an AUTO doctor hitting `error`
// pushes a one-line summary of the diagnosis to the tray (the full text stays
// in the state row and audit log). Manual doctors stay quiet -- the human
// launched that pane and is watching its badge.
if (status === 'error' && merged.origin === 'auto') {
  try {
    const { loadTriageConfig } = await import('../src/triage/config.ts');
    const { escalationBody, notifyEscalation } =
      await import('../src/triage/notify.ts');
    await notifyEscalation(
      `doctor stuck on !${merged.iid}`,
      escalationBody(merged.message ?? 'escalated without a message'),
      loadTriageConfig().notify
    );
  } catch (err) {
    console.error(
      `escalation notify failed: ${err instanceof Error ? err.message : err}`
    );
  }
}
