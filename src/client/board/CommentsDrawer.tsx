import { useEffect, useState } from "react";
import type { BoardMR } from "../../data.ts";
import { commentDot } from "../../view.ts";
import type { CommentNote, CommentThread, GeneralComment } from "../types.ts";
import { Markdown } from "../ui/Markdown.tsx";
import { ICONS } from "@mattstack/tui-kit";
import { SideDrawer } from "@mattstack/tui-kit";
import { ago, cleanTitle, statusPhrase, THREAD_ICON, THREAD_LABEL, commentCount } from "./format.ts";
import { getDiscussions } from "../api.ts";

/** A button that opens the comments drawer. Shared by the "N comments" status
    label and the persistent 💬 token, so both routes reach the same drawer. */
function CommentsTrigger({
  mr,
  className,
  title,
  children,
}: {
  mr: BoardMR;
  className: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={className}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open && <CommentsDrawer mr={mr} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The "N comments" / "comments resolved" status label; clicking it opens the
    drawer. A dot beside it hints whether the author has acted (see `commentDot`). */
function CommentsButton({ mr, label, cls }: { mr: BoardMR; label: string; cls: string }) {
  const dot = commentDot(mr.threadSummary);
  return (
    <>
      <CommentsTrigger mr={mr} className={`tui-phrase tui-comments-btn ${cls}`} title="view comment threads">
        {label}
      </CommentsTrigger>
      {dot && (
        <span className={`tui-comment-dot ${dot.cls}`} title={dot.title} aria-label={dot.title}>
          ●
        </span>
      )}
    </>
  );
}

/** Persistent 💬 token in the row meta, shown whenever an MR has comment activity
    even in states where the status phrase isn't the clickable comments label (e.g.
    approved). Hidden when the status label already opens the drawer, to avoid two
    entry points on the same row. */
function CommentsToken({ mr }: { mr: BoardMR }) {
  const n = commentCount(mr);
  if (n === 0 || statusPhrase(mr).comments) return null;
  return (
    <CommentsTrigger mr={mr} className="tui-comment-token" title="view comments">
      <span className="tui-comment-token-icon" aria-hidden>💬</span>
      <span>{n}</span>
    </CommentsTrigger>
  );
}

/** One note in the drawer: author (highlighted when it's the MR author), a
    timestamp that deep-links to the note in GitLab, and the markdown body. */
function CommentNoteView({ mr, note, now }: { mr: BoardMR; note: CommentNote; now: number }) {
  const isAuthor = note.username === mr.author.username;
  return (
    <div className="tui-cd-note">
      <div className="tui-cd-note-head">
        <span className={`tui-cd-note-author ${isAuthor ? "author" : "commenter"}`}>{note.name}</span>
        <a
          className="tui-cd-note-time"
          href={mr.webUrl ? `${mr.webUrl}#note_${note.id}` : "#"}
          target="_blank"
          rel="noopener noreferrer"
          title="open this comment in gitlab"
        >
          {ago(note.at, now)} ↗
        </a>
      </div>
      <div className="tui-cd-note-body">
        <Markdown linkTargetBlank>{note.body}</Markdown>
      </div>
    </div>
  );
}

/** Right-side drawer showing an MR's review threads (each with its status and
    notes) plus a section for general MR comments — the Overview-tab notes that
    aren't threads, so a later author comment isn't invisible. Lazily fetched. */
function CommentsDrawer({ mr, onClose }: { mr: BoardMR; onClose: () => void }) {
  const [data, setData] = useState<{ threads: CommentThread[]; comments: GeneralComment[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const now = Date.now();
  useEffect(() => {
    getDiscussions(mr.rtRepo ?? "", mr.iid, mr.author.username)
      .then((d) => setData(d))
      .catch(() => setFailed(true));
  }, [mr]);
  return (
    <SideDrawer
      // `side="right"` replaces .tui-cd-overlay/.tui-cd: the recipe carries
      // the 460px measure, the left border + drawer shadow, and the overlay's
      // flex-end alignment and cursor/white-space resets this drawer needs
      // because it renders inside a clickable, nowrap row.
      side="right"
      ariaLabel="comment threads"
      onClose={onClose}
      onOverlayClick={(e) => {
        // The drawer renders inside the row (whose onClick opens the MR); React
        // events bubble by component tree, so stop here or clicking the overlay
        // would also open the MR.
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="tui-cd-head">
        <div className="tui-cd-title">
          <span className="tui-cd-iid">!{mr.iid}</span> {cleanTitle(mr.title)}
        </div>
        <button className="tui-modal-x" onClick={onClose} aria-label="close">
          {ICONS.close}
        </button>
      </div>
      <a className="tui-cd-open" href={mr.webUrl ?? "#"} target="_blank" rel="noopener noreferrer">
        open in gitlab ↗
      </a>
      <div className="tui-cd-body">
        {failed ? (
          <p className="tui-comments-empty">couldn't load comments</p>
        ) : !data ? (
          <p className="tui-comments-empty">loading…</p>
        ) : data.threads.length === 0 && data.comments.length === 0 ? (
          <p className="tui-comments-empty">no comments</p>
        ) : (
          <>
            {data.threads.map((t, i) => (
              <section key={i} className={`tui-cd-thread ${t.status}`}>
                <div className="tui-cd-thread-status">
                  <span>
                    <span className="tui-comment-icon">{THREAD_ICON[t.status]}</span> {THREAD_LABEL[t.status]}
                  </span>
                  {mr.webUrl && t.notes[0] && (
                    <a
                      className="tui-cd-thread-open"
                      href={`${mr.webUrl}#note_${t.notes[0].id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      open ↗
                    </a>
                  )}
                </div>
                {t.notes.map((n) => (
                  <CommentNoteView key={n.id} mr={mr} note={n} now={now} />
                ))}
              </section>
            ))}
            {data.comments.length > 0 && (
              <section className="tui-cd-comments">
                <div className="tui-cd-comments-head">MR comments</div>
                {data.comments.map((c) => (
                  <CommentNoteView key={c.id} mr={mr} note={c} now={now} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </SideDrawer>
  );
}

export { CommentsTrigger, CommentsButton, CommentsToken, CommentNoteView, CommentsDrawer };
