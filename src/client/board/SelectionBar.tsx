import { useState } from "react";
import type { BoardMR } from "../../data.ts";
import { selectionHeader, MAX_HEADER_LEN, type SlackTemplates } from "../../template.ts";
import { CopyButton } from "@mattstack/tui-kit";
import { useAutoGrowTextarea } from "../ui/hooks.ts";
import { boardSummary } from "./format.ts";
import { SLACK_ICON } from "./chips.tsx";

/** Shown only while something is selected. Carries the count, an editable
    header line, and the actions retargeted to the selection. */
function SelectionBar({
  selectedMrs,
  inViewCount,
  templates,
  onClear,
  slackPost,
  posting,
}: {
  selectedMrs: BoardMR[];
  inViewCount: number;
  templates: SlackTemplates;
  onClear: () => void;
  /** null when slack is off, remote, or nothing in the selection is postable.
      `count` is what will actually be sent, which is below the selection count
      once some are already in slack. */
  slackPost: { count: number; send: (header?: string) => void } | null;
  /** True while a post is in flight; disables the post button so two fast
      clicks can't put two messages in the channel. The server's duplicate guard
      reads slack-ref files that are only written once a message lands, so it
      does not catch a second click that starts before the first returns. */
  posting?: boolean;
}) {
  const count = selectedMrs.length;
  // Once you type, the line is yours: re-substituting {count} on every check
  // would stomp your edit, so `edited` stays null until the first keystroke.
  // Reset happens by unmount, when the selection empties -- which only works
  // because Board renders this bar conditionally on `selectedMrs.length > 0`.
  // If you ever render it unconditionally (to animate it out, say), you must
  // add an explicit reset when the selection empties.
  const [edited, setEdited] = useState<string | null>(null);
  // selectionHeader owns the copy/post split; its doc comment says why `post`
  // is undefined for an untouched header. Don't collapse the three forms.
  const header = selectionHeader(templates.multiHeader, edited, count);

  // Grow the textarea to fit its content, so a long header wraps into view
  // rather than scrolling sideways out of it.
  const taRef = useAutoGrowTextarea([header.display]);

  return (
    <div className="tui-selbar">
      <div className="tui-selbar-head">
        <span className="tui-selbar-count">▣ {count} selected</span>
        {inViewCount < count && <span className="tui-selbar-note">({inViewCount} in view)</span>}
      </div>
      <textarea
        ref={taRef}
        className="tui-selbar-input"
        rows={1}
        value={header.display}
        maxLength={MAX_HEADER_LEN}
        aria-label="message header"
        placeholder="header line"
        // Enter inserts a real break: the header is multi-line by design, and
        // sanitizeHeader carries the breaks through to the posted message. The
        // box grows to fit, so there is nothing to scroll out of view.
        onChange={(e) => {
          setEdited(e.currentTarget.value);
        }}
      />
      <div className="tui-selbar-actions">
        {/* No `className="tui-copy"`: the recipe carries that shape itself.
            The roomier selection-bar sizing still applies -- style.css's
            `.tui-selbar-actions` rule now names `[data-part="copybutton"]`
            alongside the `.tui-copy` its two plain sibling buttons still use. */}
        <CopyButton
          text={boardSummary(selectedMrs, templates, header.copy)}
          title={`copy ${count} selected for slack`}
          label={`copy ${count}`}
        />
        {slackPost && (
          <button
            className="tui-copy tui-selbar-post"
            onClick={() => slackPost.send(header.post)}
            disabled={posting}
            title="post the selection to slack"
          >
            {SLACK_ICON} {posting ? "posting…" : `post ${slackPost.count}`}
          </button>
        )}
        <button className="tui-copy" onClick={onClear} title="clear the selection">clear</button>
      </div>
    </div>
  );
}

export { SelectionBar };
