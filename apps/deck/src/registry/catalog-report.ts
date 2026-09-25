import type { SyncIssue } from './records.ts';

let report: SyncIssue | null = null;

/**
 * The catalog apps the sweep could not create or adopt have no row of their
 * own, so deck's board row carries them. Kept in memory rather than on a
 * record: every deck start sweeps again, and a machine whose deck runs as the
 * bundle helper has no platform record at all.
 */
export function setCatalogReport(
  refusals: Array<{ name: string; error: string }>
): void {
  report = refusals.length
    ? {
        source: 'launchd',
        message: `bundled apps deck cannot serve: ${refusals
          .map(r => `${r.name} (${r.error})`)
          .join('; ')}`,
        at: new Date().toISOString(),
      }
    : null;
}

export function catalogReport(): SyncIssue | null {
  return report;
}

/** The board keys a row's issues by source, so the report joins an existing
    issue of its source instead of sitting beside it. */
export function withCatalogReport(issues: SyncIssue[]): SyncIssue[] {
  if (!report) return issues;
  const { source, message } = report;
  if (!issues.some(i => i.source === source)) return [...issues, report];
  return issues.map(i =>
    i.source === source ? { ...i, message: `${i.message}; ${message}` } : i
  );
}
