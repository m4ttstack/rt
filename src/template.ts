/** Template rendering shared by the copy button (client) and post-to-slack (server).
    Placeholders use `{name}` and are replaced with the MR's field. Unknown
    placeholders are left as-is so users see what they mistyped. */

export interface MrFacts {
  iid: number;
  title: string;
  url: string;
  ticket: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
}

const KEYS: Array<keyof MrFacts> = ["iid", "title", "url", "ticket", "author", "sourceBranch", "targetBranch"];

function replace(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k]! : m));
}

export function renderMr(template: string, facts: MrFacts): string {
  const values: Record<string, string> = {};
  for (const k of KEYS) values[k] = String(facts[k] ?? "");
  return replace(template, values);
}

export function renderMulti(header: string, item: string, facts: MrFacts[]): string {
  const head = replace(header, { count: String(facts.length) });
  const lines = facts.map((f) => renderMr(item, f));
  return [head, ...lines].join("\n");
}

/** Longest header line we'll render from outside this process. Long enough for
    a real sentence with emoji, short enough that a stray paste can't become a
    wall of text in the channel. */
export const MAX_HEADER_LEN = 300;

/** Normalise a header line that came from outside this process -- the board's
    header input, arriving via /slack/post. Newlines collapse to spaces so a
    single line can't fake a multi-line message body. Returns null when the
    value is unusable; the caller decides whether that's a 400 or a fallback. */
export function sanitizeHeader(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(/[\r\n]+/g, " ").trim();
  if (!flat || flat.length > MAX_HEADER_LEN) return null;
  return flat;
}
