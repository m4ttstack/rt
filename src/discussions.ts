import type { MRDetail } from "@mattstack/glance";

export type ThreadStatus = "resolved" | "replied" | "awaiting";

export interface CommentNote {
  id: number;
  name: string;
  username: string | null;
  at: string;
  body: string;
}

export interface CommentThread {
  status: ThreadStatus;
  notes: CommentNote[];
}

/** A general (non-resolvable) comment on the MR — the Overview-tab notes GitLab
    doesn't make into resolvable threads. These are dropped from the thread
    accounting but shown in the drawer so a later author comment isn't invisible. */
export type GeneralComment = CommentNote;

/** Integration linkback notes (e.g. Linear's `<!-- linear-linkback --> <details>…`)
    are non-resolvable notes but not real comments — an automated HTML blob, not
    something a human wrote. Drop them from the general-comments list. */
function isAutomatedNote(body: string): boolean {
  return /^\s*<!--[^>]*linkback/i.test(body);
}

/** GitLab doesn't flag note authors as bots, so infer it from the username:
    service accounts (`service_account_…`, `project_<id>_bot_…`, `group_<id>_bot_…`),
    a delimited "bot" token (`review-bot`, `alert_bot`), and the deleted-user
    `ghost` placeholder. Conservative on purpose — "bot" mid-word (e.g. "abbott")
    is not treated as a bot, so real people's general comments aren't hidden. */
export function isBotUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  return (
    /^service_account_/i.test(username) ||
    /^(project|group)_\d+_bot/i.test(username) ||
    /(^|[._-])bot([._-]|\d|$)/i.test(username) ||
    /^ghost$/i.test(username)
  );
}

/** A note author is a bot if config lists their username or display name (the
    escape hatch for named integration bots), or the username-heuristic flags it. */
function isBotAuthor(
  author: { username?: string | null; name?: string | null } | null | undefined,
  configBots: Set<string>,
): boolean {
  if (!author) return false;
  if (author.username && configBots.has(author.username.toLowerCase())) return true;
  if (author.name && configBots.has(author.name.toLowerCase())) return true;
  return isBotUsername(author.username);
}

function toNote(n: MRDetail["discussions"][number]["notes"][number]): CommentNote {
  return {
    id: n.id,
    name: n.author?.name ?? n.author?.username ?? "?",
    username: n.author?.username ?? null,
    at: n.createdAt,
    body: n.body ?? "",
  };
}

/**
 * Split an MR's discussions into resolvable reviewer threads and general MR
 * comments. Threads: a discussion with ≥1 resolvable note and a non-author
 * participant (drops system notes, bot linkbacks, and the author's solo threads).
 * General comments: every other non-system note (e.g. a comment the author leaves
 * on the MR later, outside any thread).
 *
 * Thread status is from the author's perspective — resolved, author replied last,
 * or awaiting the author — with one refinement: if the author left a general
 * comment AFTER an awaiting thread's last note, that counts as a reply (they
 * responded on the MR, just not inline), so the thread flips to "replied".
 * Threads sorted actionable-first; comments oldest-first.
 */
export function summarizeDiscussions(
  detail: MRDetail,
  author: string | null,
  botUsernames: string[] = [],
): { threads: CommentThread[]; comments: GeneralComment[] } {
  const configBots = new Set(botUsernames.map((b) => b.toLowerCase()));
  const threads: CommentThread[] = [];
  const comments: GeneralComment[] = [];
  for (const d of detail.discussions) {
    const notes = d.notes.filter((n) => !n.system);
    if (!notes.length) continue;
    const resolvable = notes.filter((n) => n.resolvable);
    if (!resolvable.length) {
      // No resolvable note ⇒ a general MR comment, not a review thread. Skip
      // automated linkbacks and bot-authored notes (not real comments).
      for (const n of notes) {
        if (isAutomatedNote(n.body ?? "") || isBotAuthor(n.author, configBots)) continue;
        comments.push(toNote(n));
      }
      continue;
    }
    // Author-only thread (the author commenting on their own MR) — not feedback.
    if (!notes.some((n) => n.author?.username && n.author.username !== author)) continue;
    const resolved = resolvable.every((n) => n.resolved === true);
    const last = notes[notes.length - 1]!;
    const status: ThreadStatus = resolved
      ? "resolved"
      : author && last.author?.username === author
        ? "replied"
        : "awaiting";
    threads.push({ status, notes: notes.map(toNote) });
  }
  // "Author replied elsewhere": the latest general comment the author left. Any
  // awaiting thread whose last note predates it counts as replied.
  const authorLastCommentAt = comments
    .filter((c) => author && c.username === author)
    .reduce((max, c) => (c.at > max ? c.at : max), "");
  if (authorLastCommentAt) {
    for (const t of threads) {
      const lastAt = t.notes[t.notes.length - 1]?.at ?? "";
      if (t.status === "awaiting" && lastAt && lastAt < authorLastCommentAt) t.status = "replied";
    }
  }
  comments.sort((a, b) => a.at.localeCompare(b.at));
  const rank = { awaiting: 0, replied: 1, resolved: 2 };
  threads.sort((a, b) => rank[a.status] - rank[b.status]);
  return { threads, comments };
}

/** Just the resolvable reviewer threads (back-compat; see summarizeDiscussions). */
export function summarizeThreads(detail: MRDetail, author: string | null): CommentThread[] {
  return summarizeDiscussions(detail, author).threads;
}

/** Count of reviewer threads still needing attention (not yet resolved). */
export function unresolvedReviewerCount(threads: CommentThread[]): number {
  return threads.filter((t) => t.status !== "resolved").length;
}

/** Per-status thread counts, for the row's comment-action dot. */
export function threadStatusCounts(threads: CommentThread[]): {
  awaiting: number;
  replied: number;
  resolved: number;
} {
  const counts = { awaiting: 0, replied: 0, resolved: 0 };
  for (const t of threads) counts[t.status]++;
  return counts;
}
