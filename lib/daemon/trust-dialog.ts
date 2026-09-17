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
  | { kind: "accept"; variant: "plain" | "elevated"; keys: Array<"up" | "down" | "enter"> }
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
  | { kind: "accept"; path: string; keys: Array<"up" | "down" | "enter"> }
  | { kind: "undrivable" };

// Both phrases are required before this counts as the dialog: the reason line
// alone appears in transcripts (a session discussing the very prompt it hit),
// and tool output quoting it must never draw a keypress. The reason line is
// byte-faithful to Claude Code's own template, verified against the installed
// binary: `permission-root relocation to "<path>" — a model-supplied
// worktree outside .claude/worktrees/`.
const RELOCATION_RE = /permission-root relocation to\s*"(?<path>[^"]+)"/i;
const PROCEED_RE = /do you want to proceed/i;

/** Screen text flattened for phrase matching across wrapped lines: borders
    become spaces, lines join on a space, runs collapse. A wrapped PATH gains
    a spurious space at each break this way; rt tree paths contain none, so
    stripping all whitespace from the capture restores the original, and a
    path this reassembly ever got wrong simply fails the caller's registry
    lookup rather than accepting anything. */
function flatten(screen: string): string {
  return screen.replace(/[│┃╎┆|]/g, " ").replace(/\s+/g, " ");
}

/**
 * The EnterWorktree permission-root relocation prompt on `screen`, with the
 * worktree path the dialog itself names, or null when the screen is not
 * showing one. The path is the caller's provenance input: accept only a path
 * rt's own worktree registry knows.
 */
export function readRelocationPrompt(screen: string): RelocationPrompt | null {
  const flat = flatten(screen);
  if (!PROCEED_RE.test(flat)) return null;
  const reason = RELOCATION_RE.exec(flat);
  const anchored = /permission-root relocation to/i.test(flat);
  if (!anchored) return null;
  if (!reason?.groups?.path) return { kind: "undrivable" };
  const path = reason.groups.path.replace(/\s+/g, "");
  return walkToAccept(readOptions(screen), (keys) => ({ kind: "accept", path, keys }));
}
