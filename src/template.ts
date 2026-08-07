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
    single line can't fake a multi-line message body. The result is then
    Slack-escaped (see below) and the cap is measured on that escaped string,
    since the cap bounds what actually reaches the channel, not what the user
    typed -- escaping alone can turn a short raw string into a much longer
    posted one, and the cap must catch that. Returns null when the value is
    unusable; the caller decides whether that's a 400 or a fallback. */
export function sanitizeHeader(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const flat = raw.replace(/[\r\n]+/g, " ").trim();
  if (!flat) return null;
  const escaped = slackEscape(flat);
  if (escaped.length > MAX_HEADER_LEN) return null;
  return escaped;
}

/** Escape the characters Slack's message formatting treats as control syntax,
    per Slack's documented escaping (https://api.slack.com/reference/surfaces/formatting#escaping).
    `&` must go first, or the `&` introduced by escaping `<`/`>` would itself
    get escaped into `&amp;amp;`. This is what stops a client-supplied header
    from forming a `<url|anchor>` link, an `<@user>`/`<!channel>` mention or
    broadcast -- Slack renders the entities back as literal `&`, `<`, `>`. */
function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
