/**
 * The latch's machine markers and the bodies built around them.
 *
 * Detection depends on the marker and never on the banner image, so a blocked,
 * broken or missing image can never break the latch. The two markers are exact
 * strings: matching by prefix would read the spent marker as armed, because
 * the spent form extends the armed one.
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

const SPENT_COPY = "Approved, so this latch is spent. Nothing further to do here.";

export function armedLatchBody(imageMarkdown: string): string {
  return `${LATCH_MARKER}\n\n${imageMarkdown}\n\n${ARMED_COPY}\n`;
}

export function spentLatchBody(imageMarkdown: string): string {
  return `${LATCH_MARKER_SPENT}\n\n${imageMarkdown}\n\n${SPENT_COPY}\n`;
}

/** The banner's markdown image, pulled back out of a latch body so the spend
    can reuse the uploaded path instead of uploading the banner a second time. */
export function imageMarkdownOf(body: string): string | null {
  const m = body.match(/!\[[^\]]*\]\([^)]+\)/);
  return m ? m[0] : null;
}
