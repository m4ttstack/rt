import { join } from "path";
import { checkHealth, type Health } from "../../core/discover.ts";
import {
  PLATFORM_LABEL, LABEL_PREFIX, LEGACY_PLATFORM_LABEL_PREFIX, type ServiceManager, type ServiceSpec,
} from "../services/manager.ts";
import { putRecord, getRecord, listRecords, addIssue, reloadRegistry, type AppRecord } from "./records.ts";
import { DEFAULT_LEGACY_PREFIX } from "./migrate.ts";
import { logsDir } from "../api/state.ts";

export interface ConvertResult {
  converted: string[];
  rolledBack: string[];
  skipped: string[];
}

export interface ConvertOpts {
  manager: ServiceManager;
  /**
   * Label prefixes treated as legacy, i.e. convertible. Defaults to
   * com.matthewgoodwin. (grandfathered pre-product apps, migrate.ts's own
   * constant) AND com.mattstack.local. (the pre-rename product prefix,
   * Local -> Deck): a machine that already converted its apps once, under
   * the old identity, must be able to convert them again to the new one.
   */
  legacyPrefixes?: string[];
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
 * Convert legacy-prefixed launchd-supervised apps to the com.mattstack.deck.
 * label convention, in place: same program/args/workingDir/PORT, same app
 * name, same route and port (untouched here). Unlike migrate() (adopt in
 * place, ruled), this one DOES write: a new plist goes up, the legacy one
 * comes down. A failed health-check rolls the single app back and records a
 * loud SyncIssue rather than leaving it half-migrated; one app's failure
 * never aborts the rest of the batch.
 */
export async function convert(opts: ConvertOpts): Promise<ConvertResult> {
  const legacyPrefixes = opts.legacyPrefixes ?? [DEFAULT_LEGACY_PREFIX, LEGACY_PLATFORM_LABEL_PREFIX];
  const healthCheck = opts.healthCheck ?? checkHealth;
  const waitMs = opts.waitMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 500;
  const { manager } = opts;

  const converted: string[] = [];
  const rolledBack: string[] = [];
  const skipped: string[] = [];

  for (const record of listRecords()) {
    // Deck's own platform record is excluded, exactly as migrate.ts's
    // defense-in-depth check for its bootstrap alias: never touch it under
    // any code path, checked ahead of (and independent of) the prefix test.
    if (record.label === PLATFORM_LABEL) { skipped.push(record.name); continue; }
    // Not a launchd-supervised app (external/route-only, or no label yet)...
    // nothing to convert.
    if (record.kind !== "service" || !record.label) { skipped.push(record.name); continue; }
    // Already on the new convention (a fresh app, or a previous convert run):
    // this is the idempotency path... a second run is a no-op per app.
    if (!legacyPrefixes.some((p) => record.label!.startsWith(p))) { skipped.push(record.name); continue; }

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
      // The record snapshot at the top of this loop iteration can go stale:
      // install/uninstall/kickstart/the health-check wait above are all
      // awaited, and the health-check wait alone can run for the full
      // waitMs. A second writer (unregisterApp's DELETE, in particular) can
      // delete this exact record while that sequence is in flight. Re-check
      // existence, freshly reloaded, immediately before writing: a stale
      // write must never resurrect a deletion that already landed.
      reloadRegistry();
      if (!getRecord(record.name)) {
        // Torn down for real, not left running orphaned under a label no
        // record points at.
        try { await manager.uninstall(newLabel); } catch { /* best effort */ }
        skipped.push(record.name);
        continue;
      }
      // Registry updated LAST, only once the new label is confirmed healthy
      // (crash-safety, not just correctness): if the process dies anywhere
      // before this line, the record still names the legacy label, so a
      // re-run of convert() picks the app up again and redoes the (idempotent)
      // install/uninstall/kickstart sequence rather than leaving the record
      // pointed at a label the app was never actually confirmed to be
      // healthy under. grandfathered is dropped: it specifically means "kept
      // its legacy label", which is no longer true.
      const { grandfathered, ...rest } = record;
      putRecord({ ...rest, label: newLabel });
      converted.push(record.name);
      continue;
    }

    // Roll back: tear down whatever the new label got to and reinstall the
    // legacy spec under its original label, unconditionally... not gated on
    // which step above actually completed. install()/uninstall() are each
    // individually idempotent-safe (write+load / unload+rm), so calling both
    // regardless of exactly where the failure happened is safe in every
    // ordering, including "install(newLabel) itself threw" (nothing to tear
    // down, legacy was never touched, and reinstalling it is a harmless
    // no-op overwrite). The alternative, only restoring the step(s) known to
    // have completed, has a worse failure mode: uninstall()'s rmSync could
    // throw AFTER launchctl unload already succeeded (its exit code isn't
    // checked), which would leave the app down under both labels with no
    // restore attempted. Never let a rollback-step failure itself abort the
    // batch: this is already the failure path.
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
