import { useEffect, useState } from "react";
import type { BoardMRWithReview } from "../types.ts";
import { ICONS } from "../ui/Icon.tsx";
import { Markdown } from "../ui/Markdown.tsx";
import { useEscapeClose } from "../ui/hooks.ts";
import { cleanTitle } from "./format.ts";

/** Modal that fetches and renders the agent's written review markdown for an MR. */
function ReviewModal({ mr, onClose }: { mr: BoardMRWithReview; onClose: () => void }) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (!mr.webUrl) {
      setFailed(true);
      return;
    }
    fetch(`/review/report?mr=${encodeURIComponent(mr.webUrl)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setBody(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [mr.webUrl]);
  useEscapeClose(onClose);
  return (
    <div className="tui-modal-overlay tui-review-overlay" onClick={onClose}>
      <div className="tui-modal tui-review-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={`review for !${mr.iid}`}>
        <div className="tui-modal-head">
          <span className="tui-modal-title">❯ review · !{mr.iid}</span>
          <button className="tui-modal-x" onClick={onClose} aria-label="close">
            {ICONS.close}
          </button>
        </div>
        <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
        <div className="tui-review-body">
          {failed ? (
            <p className="tui-comments-empty">couldn't load the review</p>
          ) : body === null ? (
            <p className="tui-comments-empty">loading…</p>
          ) : (
            <div className="tui-md">
              <Markdown>{body}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { ReviewModal };
