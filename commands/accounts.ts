/**
 * rt accounts -- credential health for rt's integrations (RT-132).
 *
 *   rt accounts [--json] [--recheck]
 *
 * Reads the credential_health table the daemon's periodic accounts-sweep
 * keeps current. `--recheck` runs that same sweep cycle on demand via the
 * daemon's accounts-recheck IPC verb before printing, so the table reflects
 * live status instead of the last scheduled pass.
 */

import type { Database } from "bun:sqlite";
import { readAllCredentialHealth, type CredentialHealthRow } from "../lib/credential-health/db.ts";
import { daemonQuery } from "../lib/daemon-client.ts";
import { getStateDb } from "../lib/state/index.ts";

export function formatAccountsJson(db: Database): {
  ok: boolean;
  accounts: Array<{
    integration: string;
    status: string;
    detail: string;
    expiresAt: string | null;
    checkedAt: number;
  }>;
} {
  const rows = readAllCredentialHealth(db);
  return {
    ok: true,
    accounts: rows.map((r) => ({
      integration: r.integration,
      status: r.status,
      detail: r.detail,
      expiresAt: r.expiresAt,
      checkedAt: r.checkedAt,
    })),
  };
}

function formatHuman(rows: CredentialHealthRow[], now: number): string {
  if (rows.length === 0) return "No credential health data yet. Run: rt accounts --recheck";
  const lines: string[] = [];
  const pad = (s: string, n: number) => s.padEnd(n);
  lines.push(
    `${pad("Integration", 16)} ${pad("Status", 10)} ${pad("Expiry", 14)} ${pad("Checked", 16)} Detail`,
  );
  lines.push("-".repeat(80));
  for (const r of rows) {
    const ago = humanAgo(now - r.checkedAt);
    const expiry = r.expiresAt ?? "-";
    lines.push(
      `${pad(r.integration, 16)} ${pad(r.status, 10)} ${pad(expiry, 14)} ${pad(ago + " ago", 16)} ${r.detail}`,
    );
  }
  return lines.join("\n");
}

function humanAgo(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export async function run(args: string[]): Promise<void> {
  const json = args.includes("--json");
  const recheck = args.includes("--recheck");

  if (recheck) {
    const res = await daemonQuery("accounts-recheck", undefined, 30_000);
    if (!json) {
      if (res?.ok) {
        console.log("Recheck complete.");
      } else {
        console.error("Recheck failed. Is the daemon running?");
      }
    }
  }

  const db = getStateDb("cli");
  if (json) {
    console.log(JSON.stringify(formatAccountsJson(db)));
  } else {
    const rows = readAllCredentialHealth(db);
    console.log(formatHuman(rows, Date.now()));
  }
}
