import {
  optionDisplayFor,
  optionValue,
  type GateQuestion,
  type GateSelections,
} from '@mattstack/gate-kit';
import { parseGateCtx, type ReplyEntry } from './gate-ctx.ts';

/** One respond-post thread question: a multi whose two options post the
    thread's reply and resolve the thread, picked independently. */
export interface PostPick {
  name: string;
  threadId: string;
  /** The question label: the thread's file:line. */
  label: string;
  /** Absent when the question's context fell back to prose. */
  reply?: ReplyEntry;
  post: string;
  resolve: string;
  /** The recommended option values, which a fresh gate starts with. */
  defaults: string[];
}

/** The gate's per-thread questions, recognized by their option pair
    `post:<id>` / `resolve:<id>` rather than by context, so a thread whose
    context was dropped to prose keeps its controls. */
export function postPicks(questions: GateQuestion[]): PostPick[] {
  return questions.flatMap(q => {
    if (!q.multi || q.options.length !== 2) return [];
    const values = q.options.map(optionValue);
    const post = values.find(v => v.startsWith('post:'));
    const threadId = post?.slice('post:'.length);
    const resolve = `resolve:${threadId}`;
    if (!post || !threadId || !values.includes(resolve)) return [];
    const ctx = parseGateCtx(q.context);
    const reply =
      ctx?.shape === 'reply@1' && ctx.thread === threadId ? ctx : undefined;
    return [
      {
        name: q.id,
        threadId,
        label: q.label,
        ...(reply ? { reply } : {}),
        post,
        resolve,
        defaults: q.options
          .filter(o => optionDisplayFor(o).recommended)
          .map(optionValue),
      },
    ];
  });
}

/** An edit counts only when it differs from the draft once surrounding
    whitespace is ignored. */
export function editedText(
  name: string,
  draft: string,
  texts: Record<string, string>
): boolean {
  const edit = texts[name];
  return edit !== undefined && edit.trim() !== draft.trim();
}

export function isEdited(
  pick: PostPick,
  texts: Record<string, string>
): boolean {
  return editedText(pick.name, pick.reply?.text ?? '', texts);
}

/** The trimmed edit each active item sends, keyed by question id. Null when
    an active item's edit is empty: an empty reply cannot post. */
function sendableTexts(
  items: Array<{ name: string; draft: string; active: boolean }>,
  texts: Record<string, string>
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const it of items) {
    if (!it.active) continue;
    const edit = texts[it.name];
    if (edit === undefined) continue;
    if (edit.trim() === '') return null;
    if (editedText(it.name, it.draft, texts)) out[it.name] = edit.trim();
  }
  return out;
}

/** A posting thread is active; holding the thread is how nothing posts. */
export function postTexts(
  picks: PostPick[],
  selections: GateSelections,
  texts: Record<string, string>
): Record<string, string> | null {
  return sendableTexts(
    picks.map(p => {
      const v = selections[p.name];
      return {
        name: p.name,
        draft: p.reply?.text ?? '',
        active: Array.isArray(v) && v.includes(p.post),
      };
    }),
    texts
  );
}

/** A respond-plan thread whose reply is shown verbatim: the only kind the
    developer can edit before it posts. */
export interface PlanReply {
  name: string;
  label: string;
  draft: string;
  value: string;
}

export function planReplies(questions: GateQuestion[]): PlanReply[] {
  return questions.flatMap(q => {
    if (q.multi) return [];
    const ctx = parseGateCtx(q.context);
    if (ctx?.shape !== 'thread@1' || ctx.reply.kind !== 'verbatim') return [];
    const value = q.options.map(optionValue).find(v => v.startsWith('reply:'));
    return value
      ? [{ name: q.id, label: q.label, draft: ctx.reply.text, value }]
      : [];
  });
}

/** A thread picked `reply:` is active; a fix or skip keeps its edit unsent. */
export function planTexts(
  replies: PlanReply[],
  selections: GateSelections,
  texts: Record<string, string>
): Record<string, string> | null {
  return sendableTexts(
    replies.map(r => ({
      name: r.name,
      draft: r.draft,
      active: selections[r.name] === r.value,
    })),
    texts
  );
}

export function postTally(
  picks: PostPick[],
  selections: GateSelections
): { posting: number; resolving: number } {
  let posting = 0;
  let resolving = 0;
  for (const p of picks) {
    const v = selections[p.name];
    const picked = Array.isArray(v) ? v : [];
    if (picked.includes(p.post)) posting++;
    if (picked.includes(p.resolve)) resolving++;
  }
  return { posting, resolving };
}
