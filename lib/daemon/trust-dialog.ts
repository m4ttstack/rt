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
  const selected = options.findIndex((o) => o.cursor);
  const accept = options.findIndex((o) => ACCEPT_RE.test(o.label));
  if (selected < 0 || accept < 0) return { kind: "undrivable" };
  const distance = accept - selected;
  const step = distance < 0 ? "up" : "down";
  const keys: Array<"up" | "down" | "enter"> = [...Array(Math.abs(distance)).fill(step), "enter"];
  return { kind: "accept", variant: ELEVATED_RE.test(screen) ? "elevated" : "plain", keys };
}
