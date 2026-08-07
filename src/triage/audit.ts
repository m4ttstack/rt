import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

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

export const AUDIT_PATH = join(import.meta.dir, "..", "..", "logs", "doctor-audit.jsonl");

export function appendAudit(entry: AuditEntry, path: string = AUDIT_PATH): void {
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + "\n");
}
