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

/** The three configured Slack templates, as the board and the server both see
    them (`/api/board` serves exactly this shape). */
export interface SlackTemplates {
  single: string;
  multiHeader: string;
  multiItem: string;
}

/** The message body `/slack/post` sends, for the MRs it resolved and an
    optional client-supplied header line.

    One MR and no header keeps the compact single-line rendering the row menu's
    "post to slack" has always produced. One MR WITH a header must still go
    through renderMulti: the single template has no header line, so rendering a
    header there would silently drop the words the user typed. */
export function renderPost(templates: SlackTemplates, facts: MrFacts[], headerOverride: string | null): string {
  if (facts.length === 1 && headerOverride === null) return renderMr(templates.single, facts[0]!);
  return renderMulti(headerOverride ?? templates.multiHeader, templates.multiItem, facts);
}

/** The selection bar's header line, in the three forms the board needs. */
export interface SelectionHeader {
  /** What the input shows. Echoes the user's keystrokes verbatim once touched,
      so a trailing space survives mid-typing. */
  display: string;
  /** The header the clipboard copy renders from. `{count}` in it is resolved by
      renderMulti against the MRs actually being copied. */
  copy: string;
  /** The `header` field for POST /slack/post — `undefined` means send no
      override at all and let the server use its own configured header. */
  post: string | undefined;
}

/** Resolve the header for a selection of `selectedCount` MRs. `edited` is the
    raw input value once the user has typed, and null while they haven't.

    `post` is deliberately `undefined` for the auto-generated header, and that is
    the whole point of this function. The board posts the *postable* subset —
    the selection minus MRs already in Slack — so a header with `{count}`
    substituted client-side against the selection size would announce "3 MR's
    ready for review" above 2 links. Sending no override lets the server render
    its own configured header against the facts it actually posts, so the stated
    number always matches the message. Do NOT "simplify" this by sending
    `display`: that is exactly the bug it exists to prevent. The visible
    consequence is intended — the input can read "3 …" while the posted message
    says 2, and the post button's "post 2" label is what signals it. Copy is
    unaffected: it renders the same header against the full selection, so
    copying 3 MRs still says 3.

    A typed header is the user's own words: it goes over verbatim (trimmed), and
    nothing rewrites the numbers inside it.

    A blank or whitespace-only input means "no header supplied" on BOTH paths, so
    copy and post agree and both fall back to the configured template — rather
    than copy emitting an empty first line while post quietly falls back and a
    whitespace-only value 400s. */
export function selectionHeader(configured: string, edited: string | null, selectedCount: number): SelectionHeader {
  if (edited === null) {
    return { display: replace(configured, { count: String(selectedCount) }), copy: configured, post: undefined };
  }
  const typed = tidyHeader(edited);
  if (!typed) return { display: edited, copy: configured, post: undefined };
  return { display: edited, copy: typed, post: typed };
}

/** Longest header we'll render from outside this process, counting the line
    breaks. Roomy enough for a short multi-line note above the links, small
    enough that a stray paste can't push the MRs out of view in the channel.
    Newlines count toward it, so a header made only of breaks still gets
    rejected. */
export const MAX_HEADER_LEN = 600;

/** Normalise a header that came from outside this process -- the board's header
    input, arriving via /slack/post.

    The header is deliberately multi-line: line breaks survive, because writing
    a couple of lines above the MR links is the point of letting you edit it.
    An earlier version collapsed every newline to a space, on the theory that a
    single line couldn't then fake a multi-line message body. That guard is gone
    on purpose -- it was never what made this safe. What makes it safe is
    slackEscape: no amount of text or line breaks can form a link, a mention or
    a broadcast once `<`, `>` and `&` are entities.

    What the newline handling still does is tidy: CRLF and lone CR normalise to
    \n so the posted text matches what was typed, trailing spaces come off each
    line, and runs of blank lines collapse to at most one -- a paragraph break
    is worth keeping, ten of them are a lean on the Enter key.

    The cap is measured on the ESCAPED string, since it bounds what actually
    reaches the channel rather than what was typed: escaping alone can turn a
    short raw string into a much longer posted one, and the cap must catch that.

    Returns null when the value is unusable; the caller decides whether that's a
    400 or a fallback. */
export function sanitizeHeader(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tidied = tidyHeader(raw);
  if (!tidied) return null;
  const escaped = slackEscape(tidied);
  if (escaped.length > MAX_HEADER_LEN) return null;
  return escaped;
}

/** The cosmetic half of sanitizeHeader, shared with the clipboard path so what
    you copy is laid out the same as what you post. Deliberately NOT the
    security half -- escaping stays on the posting path only, because the
    clipboard is your own words going into your own paste. Keeping the layout
    rules here is what stops a header with six blank lines copying with six and
    posting with one. */
export function tidyHeader(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
