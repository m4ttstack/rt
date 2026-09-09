import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

import { boardStateRoot } from '../state/index.ts';

/** One line per policy decision and per autonomous action. Append-only,
    survives MR pruning (doctor state files do not, by design), never pruned
    automatically. Plain-named path: no working-name proliferation. */
export interface AuditEntry {
  ts: number;
  mrUrl: string;
  iid: number;
  event: string;
  decision?: string;
  reason?: string;
  action?: string;
  pipelineId?: number | null;
  attempt?: number;
  outcome?: string;
}

export function auditPathForRoot(root: string): string {
  return join(root, 'logs', 'doctor-audit.jsonl');
}

/** `path` defaults from boardStateRoot() at CALL time, not module load: the
    ambient default is only correct for the auto-triage pass, which runs
    under the same root as getStateDb()'s default. A caller resolving a
    handle-derived root (doctor-status.ts, an overridden board) must pass
    that root's own path explicitly via auditPathForRoot. */
export function appendAudit(
  entry: AuditEntry,
  path: string = auditPathForRoot(boardStateRoot())
): void {
  mkdirSync(join(path, '..'), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n');
}
