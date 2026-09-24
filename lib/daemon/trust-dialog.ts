/**
 * Claude Code's pre-claude folder-trust modal, read off a pane screen.
 *
 * Two variants ship with the same header and opposite defaults: the plain
 * first-run dialog starts on "Yes, proceed", and the elevated one a repo's
 * pre-approved tool permissions raise starts on "No, exit". A bare Enter
 * therefore accepts one and kills the other, so the key sequence is computed
 * from the cursor's position rather than assumed.
 *
 * A dialog whose cursor or accept option cannot be located comes back
 * `undrivable` instead of falling back to Enter: pressing Enter blind is
 * exactly the move that exits the session on the elevated variant, and a
 * surfaced stuck pane costs a keypress where a wrong guess costs the worker.
 */

export type TrustPrompt =
  | { kind: "accept"; variant: "plain" | "elevated" | "relocation"; keys: Array<"up" | "down" | "enter"> }
  | { kind: "undrivable" };

const HEADER_RE = /do you trust the files in this folder/i;
// Leading box-drawing runs and the trailing border are stripped so a boxed
// option line parses the same as a bare one.
const OPTION_RE = /^[\s│|┃╎┆]*(?<cursor>[❯>])?\s*(?<index>\d+)\.\s+(?<label>.*?)\s*[│|┃╎┆]?\s*$/;
const ACCEPT_RE = /^yes\b/i;
// The elevated variant's own body text, and the only honest way to name it:
// the cursor's distance says which keys to press, never which dialog this is.
const ELEVATED_RE = /pre-approve\w*\s+\d*\s*tool permissions/i;

interface Option { cursor: boolean; label: string }

function readOptions(screen: string): Option[] {
  const out: Option[] = [];
  for (const line of screen.split("\n")) {
    const m = OPTION_RE.exec(line);
    if (!m?.groups) continue;
    out.push({ cursor: m.groups.cursor !== undefined, label: m.groups.label ?? "" });
  }
  return out;
}

/**
 * The trust modal on `screen` and how to accept it, or null when the screen
 * is not showing one. Anchored on the dialog header, which both variants
 * share, so a brief or a transcript that merely says "trust" never matches.
 */
export function readTrustPrompt(screen: string): TrustPrompt | null {
  if (!HEADER_RE.test(screen)) return null;
  const options = readOptions(screen);
  return walkToAccept(options, (keys) => ({ kind: "accept", variant: ELEVATED_RE.test(screen) ? "elevated" : "plain", keys }));
}

function walkToAccept<T>(options: Option[], make: (keys: Array<"up" | "down" | "enter">) => T): T | { kind: "undrivable" } {
  const selected = options.findIndex((o) => o.cursor);
  const accept = options.findIndex((o) => ACCEPT_RE.test(o.label));
  if (selected < 0 || accept < 0) return { kind: "undrivable" };
  const distance = accept - selected;
  const step = distance < 0 ? "up" : "down";
  return make([...Array(Math.abs(distance)).fill(step), "enter"]);
}

export type RelocationPrompt =
  | { kind: "accept"; path: string; resolvesTo?: string; keys: Array<"up" | "down" | "enter"> }
  | { kind: "undrivable" };

// Everything this parser reads comes from the LIVE prompt's own body: the
// last contiguous numbered-options block on screen, plus the lines above it
// up to the dialog's top (a box top, or on Claude Code 2.1.x the full-width
// rule every permission prompt paints under). Transcript text above that
// routinely quotes the reason line and the proceed question (a session
// discussing the very prompt it hit, or these tests on an editor screen), and
// an ordinary tool-permission prompt asks the same proceed question, so a
// whole-screen match would let transcript text steer a keypress at an
// unrelated dialog. The reason template, from the installed binary:
// `permission-root relocation to "<path>"[ (resolves to "<realpath>")][ (path
// sanitized for display)] — a model-supplied worktree outside
// .claude/worktrees/`. \s* between words because the wrap can drop an
// inter-word space when lines are rejoined.
const REASON_RE = /permission-root\s*relocation\s*to\s*"(?<path>[^"]*)"/i;
const REASON_PHRASE_RE = /permission-root\s*relocation\s*to/i;
const RESOLVES_RE = /\(\s*resolves\s*to\s*"(?<real>[^"]*)"\s*\)/i;
const PROCEED_RE = /do\s*you\s*want\s*to\s*proceed/i;
const BOX_TOP_RE = /[╭┌]/;
const RULE_RE = /^\s*─{8,}\s*$/;
// A Bash, Edit or MCP prompt sits under the same rule (or box), asks the same
// proceed question, and shows text the model wrote: a command, a diff, tool
// arguments. So the reason phrase never identifies this dialog on its own;
// its heading does, and under a rule so does the tool line echoing the path
// the reason names. That echo wraps at a different column than the gutter
// line, so a path collapsed by a dropped wrap space cannot pass both.
const TOOL_USE_HEADING = "Tool use";
const ENTER_ECHO_RE = /^Entering worktree\((?<path>.*)\)$/;
const BOXED_HEADING = "EnterWorktree";
const GUTTER_RE = /^\s*[│┃╎┆|]/;
// The dialog body (heading, echo, reason, suffixes, question) fits well
// inside this many lines above the options even with a long wrapped path;
// the cap keeps transcript text out when the top has scrolled off.
const WINDOW_CAP = 16;

/** Box lines rejoined so a wrapped path reads back byte for byte: borders
    stripped, each line trimmed at its ends only, lines joined with NOTHING
    between them. A wrap break contributes no character; a space AT the break
    is lost, which is why a ruled prompt's path must also match its echo. */
function joinBoxLines(lines: string[]): string {
  return lines.map((l) => l.replace(/[│┃╎┆|╭╮╰╯]/g, " ").replace(/^[\s─]+|[\s─]+$/g, "")).join("");
}

function stripDecoration(line: string): string {
  return line.replace(/[│┃╎┆|╭╮╰╯─]/g, " ").trim();
}

/** The path the ruled dialog's own tool line echoes, or null when the lines under the rule are not this dialog's heading and echo. */
function ruledEchoPath(bodyLines: string[]): string | null {
  const stripped = bodyLines.map(stripDecoration).filter((l) => l !== "");
  if (stripped[0] !== TOOL_USE_HEADING) return null;
  const echo = ENTER_ECHO_RE.exec(stripped[1] ?? "");
  if (!echo) return null;
  if (!bodyLines.some((l) => GUTTER_RE.test(l) && REASON_PHRASE_RE.test(l))) return null;
  return echo.groups?.path ?? null;
}

/**
 * The EnterWorktree permission-root relocation prompt on `screen`, with the
 * worktree path (and resolved real path, when the dialog shows one) that the
 * dialog itself names, or null when the live prompt is not one. Both paths
 * are the caller's provenance input: accept only paths rt's own worktree
 * registry knows.
 */
export function readRelocationPrompt(screen: string): RelocationPrompt | null {
  const lines = screen.split("\n");
  const optionIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) if (OPTION_RE.test(lines[i] as string)) optionIdx.push(i);
  if (optionIdx.length === 0) return null;
  // The live prompt paints at the bottom, so its options are the last
  // contiguous numbered block; anything numbered higher up is transcript.
  let start = optionIdx.length - 1;
  while (start > 0 && optionIdx[start - 1] === (optionIdx[start] as number) - 1) start--;
  const block = optionIdx.slice(start);
  const first = block[0] as number;
  const last = block[block.length - 1] as number;
  // No box top or rule within reach means the body cannot be bounded, and an
  // unbounded body lets transcript text supply the path (a partial capture
  // with the ╭ scrolled off reproduced exactly that), so this fails closed:
  // the real dialog always paints under one or the other.
  let top = -1;
  for (let i = first - 1; i >= Math.max(0, first - WINDOW_CAP); i--) {
    const line = lines[i] as string;
    if (BOX_TOP_RE.test(line) || RULE_RE.test(line)) { top = i; break; }
  }
  if (top < 0) return null;
  const bodyLines = lines.slice(top + 1, first);
  const ruled = RULE_RE.test(lines[top] as string);
  const echoPath = ruled ? ruledEchoPath(bodyLines) : null;
  if (ruled ? echoPath === null : !bodyLines.map(stripDecoration).includes(BOXED_HEADING)) return null;
  const body = joinBoxLines(bodyLines);
  if (!PROCEED_RE.test(body)) return null;
  // The LAST reason match: the live dialog's reason sits nearest its own
  // options, so anything earlier in the body is quoted text, never the
  // dialog speaking.
  const reason = [...body.matchAll(new RegExp(REASON_RE, "gi"))].at(-1);
  if (!reason) {
    // The reason phrase without a readable quoted path is still this
    // dialog; a dialog whose path cannot be read is never guessed at.
    return REASON_PHRASE_RE.test(body) ? { kind: "undrivable" } : null;
  }
  const path = reason.groups?.path ?? "";
  if (path.length === 0) return { kind: "undrivable" };
  if (echoPath !== null && echoPath !== path) return { kind: "undrivable" };
  const resolvesTo = RESOLVES_RE.exec(body.slice(reason.index))?.groups?.real;
  return walkToAccept(readOptions(lines.slice(first, last + 1).join("\n")), (keys) => ({
    kind: "accept", path, ...(resolvesTo !== undefined && resolvesTo.length > 0 ? { resolvesTo } : {}), keys,
  }));
}
