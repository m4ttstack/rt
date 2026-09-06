import type {
  MergeRequestIndexRow,
  MergeRequestMetrics,
} from '@mattstack/glance';
import type { IndexRow, MrState, StoredMetrics } from '../store/index.js';
import type { SourceIO, SourceProvider } from './provider.js';

export function toIndexRow(
  row: MergeRequestIndexRow,
  scannedAt: string
): IndexRow {
  return {
    projectPath: row.projectPath,
    iid: row.iid,
    title: row.title,
    state: row.state as MrState,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mergedAt: row.mergedAt,
    authorUsername: row.authorUsername,
    sourceBranch: row.sourceBranch,
    labels: row.labels ?? [],
    scannedAt,
  };
}

export async function scanProject(
  provider: SourceProvider,
  projectPath: string,
  updatedAfter: string,
  io: SourceIO = {}
): Promise<IndexRow[]> {
  const rows = await provider.fetchMergeRequestIndex({
    projectPaths: [projectPath],
    updatedAfter,
    signal: io.signal,
  });
  const scannedAt = new Date().toISOString();
  return rows.map(row => toIndexRow(row, scannedAt));
}

export function toStoredMetrics(metrics: MergeRequestMetrics): StoredMetrics {
  return {
    projectPath: metrics.projectPath,
    iid: metrics.iid,
    description: metrics.description,
    diffStats: metrics.diffStats
      ? {
          additions: metrics.diffStats.additions,
          deletions: metrics.diffStats.deletions,
          filesChanged: metrics.diffStats.filesChanged,
        }
      : null,
    fileStats: metrics.fileStats.map(f => ({
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })),
    labels: metrics.labels,
    approvedByUsernames: metrics.approvedByUsernames,
    notes: metrics.notes.map(n => ({
      authorUsername: n.authorUsername,
      createdAt: n.createdAt,
      system: n.system,
      inline: n.inline,
    })),
  };
}

export async function fetchMetrics(
  provider: SourceProvider,
  projectPath: string,
  iid: number,
  io: SourceIO = {}
): Promise<StoredMetrics | null> {
  const metrics = await provider.fetchMergeRequestMetrics(projectPath, iid, {
    signal: io.signal,
  });
  return metrics ? toStoredMetrics(metrics) : null;
}
