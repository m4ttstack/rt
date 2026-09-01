/**
 * Finding latches in an MR's discussions.
 *
 * Two rules carry the design. The canonical latch is the NEWEST, because spent
 * latches are never deleted while review state is per-MR and reused across
 * review cycles: oldest-wins would read a spent relic as canonical and destroy
 * every later cycle's latch. And a request is ANY armed latch that is
 * resolved, not just the canonical one, because an author who resolves a
 * duplicate is still asking.
 */
import type { MRDetail } from "@mattstack/glance";
import { latchKindOf, type LatchKind } from "./markers.ts";

export interface LatchRef {
  discussionId: string;
  /** The thread's first note, which is the one the spend rewrites. */
  rootNoteId: number;
  kind: LatchKind;
  resolved: boolean;
  createdAt: string;
  body: string;
}

/** Every latch on the MR, newest first. glance's Discussion has no timestamp
    of its own, so ordering comes from the root note's createdAt, which GitLab
    leaves untouched when the spend edits the body. */
export function findLatches(detail: MRDetail): LatchRef[] {
  const out: LatchRef[] = [];
  for (const d of detail.discussions) {
    const root = d.notes[0];
    if (!root) continue;
    const kind = latchKindOf(root.body ?? "");
    if (!kind) continue;
    out.push({
      discussionId: d.id,
      rootNoteId: root.id,
      kind,
      resolved: !!d.resolved,
      createdAt: root.createdAt,
      body: root.body ?? "",
    });
  }
  return out.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.discussionId.localeCompare(a.discussionId),
  );
}

export function canonicalLatch(latches: LatchRef[]): LatchRef | null {
  return latches[0] ?? null;
}

/** Every latch holding an unconsumed request. Disposing of a request must
    spend all of these, or the request bit survives in an extra and re-fires on
    every re-entry into scope. */
export function requestCarriers(latches: LatchRef[]): LatchRef[] {
  return latches.filter((l) => l.kind === "armed" && l.resolved);
}

export function hasRequest(latches: LatchRef[]): boolean {
  return requestCarriers(latches).length > 0;
}
