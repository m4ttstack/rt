import type { MRDetail } from "@workforge/glance-sdk";

export type ThreadStatus = "resolved" | "replied" | "awaiting";

export interface CommentThread {
  status: ThreadStatus;
  notes: Array<{ id: number; name: string; username: string | null; at: string; body: string }>;
}

/**
 * Comment threads a reviewer actually participated in, so the board doesn't
 * treat the MR author's own notes (e.g. a "Crank Author" status thread on their
 * own MR) as review feedback. A thread counts only if a non-author left a note.
 *
 * GitLab puts resolvable/resolved on the notes, not the discussion; a real
 * comment thread has ≥1 resolvable note (this also drops system notes and bot
 * linkbacks). Status is from the MR author's perspective: resolved, the author
 * replied last, or it's awaiting the author. Sorted actionable-first.
 */
export function summarizeThreads(detail: MRDetail, author: string | null): CommentThread[] {
  const threads: CommentThread[] = [];
  for (const d of detail.discussions) {
    const notes = d.notes.filter((n) => !n.system);
    const resolvable = notes.filter((n) => n.resolvable);
    if (!resolvable.length) continue;
    // Author-only thread (the author commenting on their own MR) — not feedback.
    if (!notes.some((n) => n.author?.username && n.author.username !== author)) continue;
    const resolved = resolvable.every((n) => n.resolved === true);
    const last = notes[notes.length - 1]!;
    const status: ThreadStatus = resolved
      ? "resolved"
      : author && last.author?.username === author
        ? "replied"
        : "awaiting";
    threads.push({
      status,
      notes: notes.map((n) => ({
        id: n.id,
        name: n.author?.name ?? n.author?.username ?? "?",
        username: n.author?.username ?? null,
        at: n.createdAt,
        body: n.body ?? "",
      })),
    });
  }
  const rank = { awaiting: 0, replied: 1, resolved: 2 };
  threads.sort((a, b) => rank[a.status] - rank[b.status]);
  return threads;
}

/** Count of reviewer threads still needing attention (not yet resolved). */
export function unresolvedReviewerCount(threads: CommentThread[]): number {
  return threads.filter((t) => t.status !== "resolved").length;
}
