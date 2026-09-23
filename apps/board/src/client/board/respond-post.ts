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

/** A thread's edit counts only when it differs from the drafted reply once
    surrounding whitespace is ignored. */
export function isEdited(
  pick: PostPick,
  texts: Record<string, string>
): boolean {
  const edit = texts[pick.name];
  return edit !== undefined && edit.trim() !== (pick.reply?.text ?? '').trim();
}

/** The trimmed edit each posting thread sends, keyed by question id. Null
    when a posting thread's edit is empty: an empty reply cannot post, and
    holding the thread is how nothing posts. */
export function postTexts(
  picks: PostPick[],
  selections: GateSelections,
  texts: Record<string, string>
): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const p of picks) {
    const v = selections[p.name];
    if (!Array.isArray(v) || !v.includes(p.post)) continue;
    const edit = texts[p.name];
    if (edit === undefined) continue;
    if (edit.trim() === '') return null;
    if (isEdited(p, texts)) out[p.name] = edit.trim();
  }
  return out;
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
