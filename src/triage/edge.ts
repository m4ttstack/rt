import { emptyMrMemory, rollDay, type DispatchMemory } from "./memory.ts";

export type PipelineState = "passed" | "running" | "failed" | "none";

export interface OwnMrFacts {
  mrUrl: string;
  iid: number;
  /** Numeric pipeline id, parsed from glance's scoped "gitlab:pipeline:N". */
  pipelineId: number | null;
  pipelineState: PipelineState;
  needsRebase: boolean;
}

export type EdgeKind = "pipeline-red" | "needs-rebase";

export interface Edge {
  mrUrl: string;
  iid: number;
  kind: EdgeKind;
  pipelineId: number | null;
}

/** Fold this run's observations into memory: ensure entries exist, roll the
    day, and RE-ARM the needs-rebase latch when the MR is observed clean.
    Handled-marking is deliberately NOT here -- a cooldown-skipped edge must
    re-fire on the next run (spec §6), so only dispatch/escalate marks. */
export function observe(mem: DispatchMemory, mrs: OwnMrFacts[], dayStamp: string): void {
  for (const facts of mrs) {
    const m = rollDay(mem.mrs[facts.mrUrl] ?? emptyMrMemory(dayStamp), dayStamp);
    if (!facts.needsRebase) m.lastNeedsRebase = false;
    mem.mrs[facts.mrUrl] = m;
  }
}

/** Pure read: the edges this run should evaluate. Call observe() first. */
export function detectEdges(mem: DispatchMemory, mrs: OwnMrFacts[]): Edge[] {
  const edges: Edge[] = [];
  for (const facts of mrs) {
    const m = mem.mrs[facts.mrUrl];
    if (!m) continue;
    if (facts.pipelineState === "failed" && facts.pipelineId !== null && facts.pipelineId !== m.lastHandledPipelineId) {
      edges.push({ mrUrl: facts.mrUrl, iid: facts.iid, kind: "pipeline-red", pipelineId: facts.pipelineId });
    }
    if (facts.needsRebase && !m.lastNeedsRebase) {
      edges.push({ mrUrl: facts.mrUrl, iid: facts.iid, kind: "needs-rebase", pipelineId: facts.pipelineId });
    }
  }
  return edges;
}

/** Latch an edge as handled, called only on dispatch or escalate. */
export function markHandled(mem: DispatchMemory, edge: Edge): void {
  const m = mem.mrs[edge.mrUrl];
  if (!m) return;
  if (edge.kind === "pipeline-red") m.lastHandledPipelineId = edge.pipelineId;
  if (edge.kind === "needs-rebase") m.lastNeedsRebase = true;
}
