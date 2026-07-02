import type { MrState, NormMr, NormNote, NormPipeline, NormPushEvent } from "../pipeline/model.js";
import type { RawEvent, RawMrDetail, RawMrListNode, RawNoteNode, RawPipeline } from "./raw-types.js";

/** Map a lightweight MR list node to a NormMr with empty/zero detail (filled later). */
export function mapMrListNode(raw: RawMrListNode): NormMr {
  return {
    iid: Number(raw.iid),
    projectPath: raw.project?.fullPath ?? "",
    authorUsername: raw.author?.username ?? null,
    state: normalizeState(raw.state),
    createdAt: raw.createdAt,
    preparedAt: raw.preparedAt ?? null,
    mergedAt: raw.mergedAt,
    title: raw.title,
    sourceBranch: raw.sourceBranch ?? null,
    description: null, // filled by applyMrDetail
    labels: [],
    additions: 0,
    deletions: 0,
    fileCount: 0,
    approvedByUsernames: [],
    notes: [],
    diffStats: [],
  };
}

/** Merge expensive per-MR detail into a NormMr built from the list node. */
export function applyMrDetail(mr: NormMr, detail: RawMrDetail): NormMr {
  return {
    ...mr,
    labels: detail.labels?.nodes.map((l) => l.title) ?? [],
    additions: detail.diffStatsSummary?.additions ?? 0,
    deletions: detail.diffStatsSummary?.deletions ?? 0,
    fileCount: detail.diffStatsSummary?.fileCount ?? 0,
    diffStats: detail.diffStats ?? mr.diffStats,
    approvedByUsernames:
      detail.approvedBy?.nodes.map((u) => u.username).filter((x): x is string => !!x) ?? [],
    notes: (detail.notes?.nodes ?? []).map(mapNote),
    description: detail.description ?? mr.description,
  };
}

function mapNote(raw: RawNoteNode): NormNote {
  return {
    authorUsername: raw.author?.username ?? null,
    createdAt: raw.createdAt,
    system: raw.system,
    inline: raw.position != null,
  };
}

function normalizeState(state: string): MrState {
  const s = state.toLowerCase();
  if (s === "merged" || s === "opened" || s === "closed" || s === "locked") return s;
  return "opened";
}

export function mapPipeline(raw: RawPipeline, projectPath: string, username: string): NormPipeline {
  return {
    projectPath,
    username,
    status: raw.status.toLowerCase(),
    createdAt: raw.created_at,
  };
}

export function mapEvent(raw: RawEvent, username: string): NormPushEvent {
  return { username, createdAt: raw.created_at };
}
