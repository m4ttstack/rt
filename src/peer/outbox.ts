import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { DraftEnvelope } from "./envelope.ts";

/** One file per envelope id. Both the board's 60s tick and a triage run may
    drain concurrently; per-file enqueue/rm makes every operation atomic with
    no shared read-modify-write, so the worst race is a double send -- which
    the relay's (id, recipient) primary key makes idempotent. */
export const OUTBOX_DIR = join(import.meta.dir, "..", "..", "state", "outbox");

export interface OutboxEntry {
  envelope: DraftEnvelope;
  queuedAt: number;
  attempts: number;
}

function entryPath(dir: string, id: string): string {
  return join(dir, `${id.replace(/[^a-zA-Z0-9-]+/g, "-")}.json`);
}

function writeEntry(dir: string, entry: OutboxEntry): void {
  mkdirSync(dir, { recursive: true });
  const path = entryPath(dir, entry.envelope.id);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(entry, null, 2) + "\n");
  renameSync(tmp, path);
}

export function enqueueOutbox(draft: DraftEnvelope, dir: string = OUTBOX_DIR, now: number = Date.now()): void {
  if (existsSync(entryPath(dir, draft.id))) return;
  writeEntry(dir, { envelope: draft, queuedAt: now, attempts: 0 });
}

export function readOutbox(dir: string = OUTBOX_DIR): OutboxEntry[] {
  if (!existsSync(dir)) return [];
  const out: OutboxEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const e = JSON.parse(readFileSync(join(dir, name), "utf8")) as OutboxEntry;
      if (e.envelope?.id) out.push(e);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => a.queuedAt - b.queuedAt);
}

/** 2xx delivered. Any other 4xx is permanent (notably 422 unknown-recipient,
    the common case while most MR authors aren't on the switchboard): drop and
    log, never a forever-retry loop. 5xx and network errors retry next drain. */
export function classifySend(status: number | "network"): "sent" | "drop" | "retry" {
  if (status === "network") return "retry";
  if (status >= 200 && status < 300) return "sent";
  if (status >= 400 && status < 500) return "drop";
  return "retry";
}

export async function drainOutbox(
  send: (d: DraftEnvelope) => Promise<number | "network">,
  dir: string = OUTBOX_DIR,
): Promise<{ sent: number; dropped: number; kept: number }> {
  const result = { sent: 0, dropped: 0, kept: 0 };
  for (const entry of readOutbox(dir)) {
    const status = await send(entry.envelope);
    const cls = classifySend(status);
    if (cls === "sent") {
      result.sent++;
      rmSync(entryPath(dir, entry.envelope.id), { force: true });
    } else if (cls === "drop") {
      result.dropped++;
      console.error(`outbox: dropping ${entry.envelope.type} ${entry.envelope.id} to ${entry.envelope.to} (${status})`);
      rmSync(entryPath(dir, entry.envelope.id), { force: true });
    } else {
      result.kept++;
      writeEntry(dir, { ...entry, attempts: entry.attempts + 1 });
    }
  }
  return result;
}
