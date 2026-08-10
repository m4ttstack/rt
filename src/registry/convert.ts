import { join } from "path";
import { checkHealth, type Health } from "../../core/discover.ts";
import { PLATFORM_LABEL, LABEL_PREFIX, type ServiceManager, type ServiceSpec } from "../services/manager.ts";
import { putRecord, listRecords, addIssue, type AppRecord } from "./records.ts";
import { DEFAULT_LEGACY_PREFIX } from "./migrate.ts";
import { logsDir } from "../api/state.ts";

export interface ConvertResult {
  converted: string[];
  rolledBack: string[];
  skipped: string[];
}

export interface ConvertOpts {
  manager: ServiceManager;
  legacyPrefix?: string;
  /** Injectable for tests: the bounded-wait health probe. Defaults to core/discover's checkHealth. */
  healthCheck?: (port: number) => Promise<Health>;
  /** Bounded-wait tuning, injectable so tests don't pay the production timeout. */
  waitMs?: number;
  intervalMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll healthCheck until it reports ok or the deadline passes. Always tries at least once. */
async function waitForHealthy(
  port: number,
  healthCheck: (port: number) => Promise<Health>,
  waitMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (true) {
    if ((await healthCheck(port)).ok) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

function specFor(record: AppRecord, label: string): ServiceSpec {
  return {
    label,
    programArguments: record.command ?? [],
    workingDirectory: record.workingDirectory ?? "",
    environment: { ...(record.env ?? {}), PORT: String(record.port) },
    stdoutPath: join(logsDir(), `${record.name}.out.log`),
    stderrPath: join(logsDir(), `${record.name}.err.log`),
  };
}

/**
 * Convert legacy-prefixed launchd-supervised apps to the com.mattstack.local.
 * label convention, in place: same program/args/workingDir/PORT, same app
 * name, same route and port (untouched here). Unlike migrate() (adopt in
 * place, ruled), this one DOES write: a new plist goes up, the legacy one
 * comes down. A failed health-check rolls the single app back and records a
 * loud SyncIssue rather than leaving it half-migrated; one app's failure
 * never aborts the rest of the batch.
 */
export async function convert(opts: ConvertOpts): Promise<ConvertResult> {
  const legacyPrefix = opts.legacyPrefix ?? DEFAULT_LEGACY_PREFIX;
  const healthCheck = opts.healthCheck ?? checkHealth;
  const waitMs = opts.waitMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 500;
  const { manager } = opts;

  const converted: string[] = [];
  const rolledBack: string[] = [];
  const skipped: string[] = [];

  for (const record of listRecords()) {
    // Local's own platform record is excluded, exactly as migrate.ts's
    // defense-in-depth check for its bootstrap alias: never touch it under
    // any code path, checked ahead of (and independent of) the prefix test.
    if (record.label === PLATFORM_LABEL) { skipped.push(record.name); continue; }
    // Not a launchd-supervised app (external/route-only, or no label yet) —
    // nothing to convert.
    if (record.kind !== "service" || !record.label) { skipped.push(record.name); continue; }
    // Already on the new convention (a fresh app, or a previous convert run):
    // this is the idempotency path — a second run is a no-op per app.
    if (!record.label.startsWith(legacyPrefix)) { skipped.push(record.name); continue; }

    const oldLabel = record.label;
    const newLabel = `${LABEL_PREFIX}${record.name}`;

    let healthy = false;
    let failureReason = "";
    try {
      // 1. Render + write the new plist (same program/args/workingDir/PORT).
      await manager.install(specFor(record, newLabel));
      // 2. Boot out the legacy label and remove its plist file.
      await manager.uninstall(oldLabel);
      // 3. Load the new label, then health-check the app (bounded wait).
      await manager.kickstart(newLabel);
      healthy = await waitForHealthy(record.port, healthCheck, waitMs, intervalMs);
      if (!healthy) failureReason = `health-check failed for ${newLabel} on port ${record.port} after conversion`;
    } catch (err) {
      failureReason = String((err as Error).message ?? err);
    }

    if (healthy) {
      const { grandfathered: _grandfathered, ...rest } = record;
      putRecord({ ...rest, label: newLabel });
      converted.push(record.name);
      continue;
    }

    // Roll back: tear down whatever the new label got to, restore the legacy
    // plist under its original label, and never let a rollback-step failure
    // itself abort the batch — this is already the failure path.
    try { await manager.uninstall(newLabel); } catch { /* best effort */ }
    try { await manager.install(specFor(record, oldLabel)); } catch { /* best effort */ }
    addIssue(record.name, {
      source: "launchd",
      message: failureReason.slice(0, 300),
      at: new Date().toISOString(),
    });
    rolledBack.push(record.name);
  }

  return { converted, rolledBack, skipped };
}
