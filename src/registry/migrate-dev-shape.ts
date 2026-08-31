import { listRecords, putRecord, type AppRecord } from "./records.ts";
import { readDeckManifest } from "./deck-manifest.ts";
import { isPlatformManagedBy } from "../services/manager.ts";

/** Uptime guard: a slim row must carry its dev
    link in the same write that clears its legacy source command, or the app
    would be left with neither a bundle nor a source to fall back to. */
export function assertSlimRowKeepsAFallback(name: string, next: AppRecord): void {
  if (!next.dev?.workingDirectory) {
    throw new Error(`migration guard: refusing to slim ${name} without dev.workingDirectory`);
  }
}

/** The only sanctioned way to persist a slimmed row: asserts, then writes. */
function writeSlimRow(next: AppRecord): void {
  assertSlimRowKeepsAFallback(next.name, next);
  putRecord(next);
}

export function migrateManagedDevShape(): { slimmed: string[]; skipped: string[] } {
  const slimmed: string[] = [];
  const skipped: string[] = [];
  for (const record of listRecords()) {
    if (record.managedBy === "user") continue;
    if (isPlatformManagedBy(record.managedBy)) {
      if (record.sourceDirectory && !record.dev) {
        putRecord({ ...record, dev: { workingDirectory: record.sourceDirectory }, sourceDirectory: undefined, commands: undefined });
        slimmed.push(record.name);
      }
      continue;
    }
    if (record.dev?.workingDirectory) continue;
    const dir = record.workingDirectory;
    const parsed = dir ? readDeckManifest(dir) : null;
    if (!parsed?.ok || parsed.manifest.name !== record.name || parsed.manifest.includeInBundle !== true) {
      skipped.push(record.name);
      continue;
    }
    const next: AppRecord = {
      ...record,
      dev: { workingDirectory: dir! },
      command: undefined,
      workingDirectory: undefined,
      commands: undefined,
      sourceDirectory: undefined,
    };
    writeSlimRow(next);
    slimmed.push(record.name);
  }
  return { slimmed, skipped };
}
