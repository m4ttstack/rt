const CLAUSE_CAP = 44;
const CLAUSE_MIN = CLAUSE_CAP / 2;
const CLAUSE_BOUNDARY = /;|\. |\s\(/g;

/** The status line's detail slot fits one clause; agent messages arrive as
    whole sentences. Cut a long message at its first natural boundary (a
    semicolon, a sentence stop, an opening parenthesis) in the cap's second
    half, else at the last word inside the cap, and hand the full text back
    for a tooltip. A boundary in the first half would keep a label and drop
    the fact ("STACKED MR: !1234"), so the word cut wins there. `full` is
    null when nothing was cut. */
export function clauseOf(detail: string): {
  text: string;
  full: string | null;
} {
  if (detail.length <= CLAUSE_CAP) return { text: detail, full: null };
  for (const m of detail.matchAll(CLAUSE_BOUNDARY)) {
    const at = m.index ?? 0;
    if (at < CLAUSE_MIN) continue;
    if (at > CLAUSE_CAP) break;
    return { text: detail.slice(0, at).trimEnd(), full: detail };
  }
  const head = detail.slice(0, CLAUSE_CAP - 1);
  const endsOnWord = detail.charAt(CLAUSE_CAP - 1) === ' ';
  const space = head.lastIndexOf(' ');
  const cut = endsOnWord || space <= CLAUSE_MIN ? head : head.slice(0, space);
  return { text: `${cut.trimEnd()}…`, full: detail };
}
