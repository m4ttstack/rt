import { useEffect, useState } from "react";
import type { BoardMRWithReview } from "../types.ts";
import { Markdown } from "../ui/Markdown.tsx";
import { Modal } from "@mattstack/tui-kit";
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
  return (
    <Modal
      title={<>❯ review · !{mr.iid}</>}
      ariaLabel={`review for !${mr.iid}`}
      onClose={onClose}
      overlayClassName="tui-review-overlay"
      className="tui-review-modal"
    >
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
    </Modal>
  );
}

export { ReviewModal };
