/**
 * The latch's machine markers and the bodies built around them.
 *
 * Detection depends on the marker and never on the banner image, so a blocked,
 * broken or missing image can never break the latch. A body may contain both
 * markers (e.g., a spent latch quoting the armed marker in its text), so spent
 * is checked first... the spent classification must win over armed.
 */

export const LATCH_MARKER = "<!-- mattstack:board re-review-latch v1 -->";
export const LATCH_MARKER_SPENT = "<!-- mattstack:board re-review-latch v1 spent -->";

export type LatchKind = "armed" | "spent";

/** Which latch a note body is, or null if it is not a latch this board knows.
    An unrecognized version (v2 from a newer board) is null, not armed. */
export function latchKindOf(body: string): LatchKind | null {
  if (body.includes(LATCH_MARKER_SPENT)) return "spent";
  if (body.includes(LATCH_MARKER)) return "armed";
  return null;
}

const ARMED_COPY = [
  "**Addressed everything?** Resolve this thread and I'll take another pass over the MR.",
  "",
  "Leave it open while there's still work in flight.",
].join("\n");

/** Why a latch was spent -- the wording differs because only one of these is
    a real reviewer verdict. "approved" is the terminal outcome; "duplicate"
    is an extra copy going defunct because another latch on the same MR
    already carries the live state, which must never read as an approval
    that did not happen. */
export type SpentReason = "approved" | "duplicate";

const SPENT_COPY = "Approved, so this latch is spent. Nothing further to do here.";
const DUPLICATE_COPY = "Superseded by a newer latch on this MR; nothing to do here.";

export function armedLatchBody(imageMarkdown: string): string {
  return `${LATCH_MARKER}\n\n${imageMarkdown}\n\n${ARMED_COPY}\n`;
}

export function spentLatchBody(imageMarkdown: string, reason: SpentReason = "approved"): string {
  const copy = reason === "duplicate" ? DUPLICATE_COPY : SPENT_COPY;
  return `${LATCH_MARKER_SPENT}\n\n${imageMarkdown}\n\n${copy}\n`;
}

/** The banner's markdown image, pulled back out of a latch body so the spend
    can reuse the uploaded path instead of uploading the banner a second time. */
export function imageMarkdownOf(body: string): string | null {
  const m = body.match(/!\[[^\]]*\]\([^)]+\)/);
  return m ? m[0] : null;
}
