import type { GateOption } from '@mattstack/rt-client';
import { optionValue } from './options';

/** The three verbs a respond-plan thread question ever offers. Grouping
    (see `groupThreadOptions`) only fires when every option is one of these
    verbs paired with a thread token -- any other verb leaves the question
    flat, since there'd be no fixed radio row to render. */
const THREAD_VERBS = ['reply', 'fix', 'skip'] as const;
export type ThreadVerb = (typeof THREAD_VERBS)[number];
const THREAD_OPTION = /^(reply|fix|skip):(.+)$/;

export interface ThreadOptionEntry {
  verb: ThreadVerb;
  value: string;
  option: GateOption;
}

export interface ThreadOptionGroup {
  /** The raw token shared by this thread's verb options (e.g. a thread hash). */
  token: string;
  /** What to show as the group's heading -- a labeled option's "verb · <thread
      text>" suffix when present, else the token's own short form. */
  heading: string;
  /** This thread's verb options, ordered reply/fix/skip regardless of the
      question's original option order. */
  entries: ThreadOptionEntry[];
}

/** Pulls the human thread text back out of a labeled option's "verb · <thread
    text>" label (the same join `formatGateOption`/the server use), so the
    group heading reads as the thread rather than repeating a verb. Falls back
    to the token's short form when no option in the group carries a label. */
function threadHeading(token: string, entries: ThreadOptionEntry[]): string {
  for (const { verb, option } of entries) {
    if (typeof option === 'string') continue;
    const prefix = `${verb} · `;
    if (option.label.startsWith(prefix))
      return option.label.slice(prefix.length);
  }
  return token.slice(0, 8);
}

/**
 * Detects the shape a respond-plan threads question renders as N*3 flat
 * checkboxes: every option a `(reply|fix|skip):<token>` pair, spanning 2+
 * distinct tokens, each token offering the identical verb set. When it
 * matches, returns one group per token (for the adapter's display rows to
 * render as a heading plus a compact verb radio row); returns null for any
 * other shape so the caller renders the flat checkbox list unchanged.
 *
 * Selection semantics are unaffected either way -- this only decides how the
 * options are grouped for display, never which values a token's entries
 * carry.
 */
export function groupThreadOptions(
  options: GateOption[]
): ThreadOptionGroup[] | null {
  const byToken = new Map<string, ThreadOptionEntry[]>();
  for (const opt of options) {
    const value = optionValue(opt);
    const m = THREAD_OPTION.exec(value);
    if (!m) return null;
    const [, verb, token] = m as unknown as [string, ThreadVerb, string];
    const list = byToken.get(token) ?? [];
    list.push({ verb, value, option: opt });
    byToken.set(token, list);
  }
  if (byToken.size < 2) return null;
  // Each thread must offer exactly one reply, one fix and one skip -- a
  // missing verb leaves no control for that action, a duplicated verb makes
  // the radio row's "at most one" selection ambiguous. Either shape falls
  // back to the flat rendering rather than grouping a partial/malformed set.
  for (const entries of byToken.values()) {
    if (entries.length !== THREAD_VERBS.length) return null;
    const verbs = new Set(entries.map(e => e.verb));
    if (verbs.size !== THREAD_VERBS.length) return null;
  }
  return [...byToken.entries()].map(([token, entries]) => {
    const ordered = [...entries].sort(
      (a, b) => THREAD_VERBS.indexOf(a.verb) - THREAD_VERBS.indexOf(b.verb)
    );
    return { token, heading: threadHeading(token, ordered), entries: ordered };
  });
}
