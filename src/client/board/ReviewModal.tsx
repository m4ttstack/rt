import { useEffect, useState } from "react";
import type { BoardMRWithReview } from "../types.ts";
import { Markdown, Modal } from "@mattstack/tui-kit";
import { cleanTitle } from "./format.ts";

/** Modal that fetches and renders an agent's written report markdown for an
    MR -- the review's write-up or the respond fill's adjudication, whichever
    `endpoint` names. Both wear the same shell; only the fetch target and the
    label differ, so a report is never presented two different ways. */
function ReportModal({
  mr,
  endpoint,
  kindLabel,
  onClose,
}: {
  mr: BoardMRWithReview;
  endpoint: string;
  kindLabel: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    if (!mr.webUrl) {
      setFailed(true);
      return;
    }
    fetch(`${endpoint}?mr=${encodeURIComponent(mr.webUrl)}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => live && setBody(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [mr.webUrl, endpoint]);
  return (
    <Modal
      title={<>❯ {kindLabel} · !{mr.iid}</>}
      ariaLabel={`${kindLabel} for !${mr.iid}`}
      onClose={onClose}
      overlayClassName="tui-review-overlay"
      className="tui-review-modal"
    >
      <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
      <div className="tui-review-body">
        {failed ? (
          <p className="tui-comments-empty">couldn't load the {kindLabel}</p>
        ) : body === null ? (
          <p className="tui-comments-empty">loading…</p>
        ) : (
          <Markdown>{body}</Markdown>
        )}
      </div>
    </Modal>
  );
}

/** The review's written report for an MR. */
function ReviewModal({ mr, onClose }: { mr: BoardMRWithReview; onClose: () => void }) {
  return <ReportModal mr={mr} endpoint="/review/report" kindLabel="review" onClose={onClose} />;
}

/** The respond fill's adjudication (verdict table + drafted replies/fixes)
    for an MR -- the context a respond gate card gives no other way to
    reach. Same modal shell as ReviewModal, different report. */
function RespondModal({ mr, onClose }: { mr: BoardMRWithReview; onClose: () => void }) {
  return <ReportModal mr={mr} endpoint="/respond/report" kindLabel="respond" onClose={onClose} />;
}

export { ReviewModal, RespondModal };
