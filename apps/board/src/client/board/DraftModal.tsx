import { useState } from "react";
import type { BoardMRWithReview, DraftInfo } from "../types.ts";
import { Modal } from "@mattstack/tui-kit";
import { cleanTitle } from "./format.ts";

/** Drawer for one held outbound note. Shows the full body verbatim — exactly
    the text that would post — with the MR context, and holds the approval
    gate: post arms into an in-drawer confirm step (no native dialogs), and
    only the confirmed click sends. Dismiss is one click; it only deletes a
    local draft file. */
function DraftModal({
  mr,
  draft,
  local,
  onResolved,
  onClose,
}: {
  mr: BoardMRWithReview;
  draft: DraftInfo;
  local: boolean;
  onResolved: (outcome: "posted" | "dismissed") => void;
  onClose: () => void;
}) {
  // Post is two clicks: the first arms the button into "confirm post", the
  // second sends. Any failure disarms so a retry restates intent.
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState<"post" | "dismiss" | null>(null);
  const [failed, setFailed] = useState(false);
  const act = async (action: "post" | "dismiss") => {
    setBusy(action);
    setFailed(false);
    try {
      const res = await fetch("/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mrUrl: mr.webUrl, kind: draft.kind, action }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onResolved(action === "post" ? "posted" : "dismissed");
    } catch {
      setBusy(null);
      setArmed(false);
      setFailed(true);
    }
  };
  return (
    <Modal
      title={<>❯ held: {draft.kind} · !{mr.iid}</>}
      ariaLabel={`held draft for !${mr.iid}`}
      onClose={onClose}
      className="tui-draft-modal"
    >
      <p className="tui-modal-sub">{cleanTitle(mr.title)}</p>
      <pre className="tui-draft-body">{draft.body}</pre>
      <div className="tui-draft-actions">
        {failed && <span className="tui-draft-error">action failed — nothing was sent, try again</span>}
        {local ? (
          armed ? (
            <>
              <button className="tui-draft-act" disabled={busy !== null} onClick={() => setArmed(false)}>back</button>
              <button className="tui-draft-act tui-draft-act-post armed" disabled={busy !== null} onClick={() => act("post")}>
                {busy === "post" ? "posting…" : "confirm post"}
              </button>
            </>
          ) : (
            <>
              <button className="tui-draft-act" disabled={busy !== null} onClick={() => act("dismiss")}>
                {busy === "dismiss" ? "dismissing…" : "dismiss"}
              </button>
              <button className="tui-draft-act tui-draft-act-post" disabled={busy !== null} onClick={() => setArmed(true)}>post</button>
            </>
          )
        ) : (
          <span className="tui-draft-note">read-only — post and dismiss live on the local board</span>
        )}
      </div>
    </Modal>
  );
}

export { DraftModal };
