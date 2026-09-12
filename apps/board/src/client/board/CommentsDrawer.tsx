import { useEffect, useState } from 'react';

import { ICONS, Markdown, SideDrawer } from '@mattstack/tui-kit';
import type { BoardMR } from '../../data.ts';
import { getDiscussions } from '../api.ts';
import type { CommentNote, CommentThread, GeneralComment } from '../types.ts';
import { ago, cleanTitle, THREAD_ICON, THREAD_LABEL } from './format.ts';
import { MessageGlyph } from './icons.tsx';

/** A button that opens the comments drawer. `stopPropagation` keeps the
    click off the row's own handler, which would open the MR in GitLab. */
function CommentsTrigger({
  mr,
  className,
  title,
  fresh = false,
  onOpen,
  children,
}: {
  mr: BoardMR;
  className: string;
  title: string;
  fresh?: boolean;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        data-new={fresh ? 'true' : undefined}
        title={title}
        onClick={e => {
          e.stopPropagation();
          onOpen?.();
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open && <CommentsDrawer mr={mr} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The facts line's threads token, the drawer's entry. `awaitYou` counts
    the seat's own MR threads waiting on them; `replied` says the author
    answered the seat's threads on someone else's MR. */
function ThreadsLink({
  mr,
  count,
  fresh,
  grew,
  awaitYou,
  replied,
  onOpen,
}: {
  mr: BoardMR;
  count: number;
  fresh: boolean;
  grew: number;
  awaitYou: number;
  replied: boolean;
  onOpen: () => void;
}) {
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const lit = fresh && openedAt !== count;
  return (
    <CommentsTrigger
      mr={mr}
      className="tui-threads"
      title={
        lit ? `${grew} new since you last looked` : 'open the comments drawer'
      }
      fresh={lit}
      onOpen={() => {
        setOpenedAt(count);
        onOpen();
      }}
    >
      <MessageGlyph />
      <span className="tui-threads-count">
        {count} thread{count === 1 ? '' : 's'}
      </span>
      {awaitYou > 0 && (
        <span className="tui-threads-await">
          {awaitYou} await{awaitYou === 1 ? 's' : ''} you
        </span>
      )}
      {replied && <span className="tui-threads-replied">author replied</span>}
    </CommentsTrigger>
  );
}

/** One note in the drawer: author (highlighted when it's the MR author), a
    timestamp that deep-links to the note in GitLab, and the markdown body. */
function CommentNoteView({
  mr,
  note,
  now,
}: {
  mr: BoardMR;
  note: CommentNote;
  now: number;
}) {
  const isAuthor = note.username === mr.author.username;
  return (
    <div className="tui-cd-note">
      <div className="tui-cd-note-head">
        <span
          className={`tui-cd-note-author ${isAuthor ? 'author' : 'commenter'}`}
        >
          {note.name}
        </span>
        <a
          className="tui-cd-note-time"
          href={mr.webUrl ? `${mr.webUrl}#note_${note.id}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          title="open this comment in gitlab"
        >
          {ago(note.at, now)} ↗
        </a>
      </div>
      <div className="tui-cd-note-body">
        {/* `unstyled` is the parity choice, not an omission. .tui-cd-note-body
            is a SEPARATE board-owned prose block that was never .tui-md;
            without this the recipe's own font-family/size/line-height would sit
            directly on the element ReactMarkdown mounts into (beating an
            inherited font regardless of layer order) and its layered
            h1-h6/pre/table rules would apply with no unlayered competitor.
            data-part="markdown" is still stamped either way. */}
        <Markdown unstyled linkTargetBlank>
          {note.body}
        </Markdown>
      </div>
    </div>
  );
}

/** Right-side drawer showing an MR's review threads (each with its status and
    notes) plus a section for general MR comments: the Overview-tab notes that
    aren't threads, so a later author comment isn't invisible. Lazily fetched. */
function CommentsDrawer({ mr, onClose }: { mr: BoardMR; onClose: () => void }) {
  const [data, setData] = useState<{
    threads: CommentThread[];
    comments: GeneralComment[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const now = Date.now();
  useEffect(() => {
    getDiscussions(mr.rtRepo ?? '', mr.iid, mr.author.username)
      .then(d => setData(d))
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
      onOverlayClick={e => {
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
      <a
        className="tui-cd-open"
        href={mr.webUrl ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
      >
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
                    <span className="tui-comment-icon">
                      {THREAD_ICON[t.status]}
                    </span>{' '}
                    {THREAD_LABEL[t.status]}
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
                {t.notes.map(n => (
                  <CommentNoteView key={n.id} mr={mr} note={n} now={now} />
                ))}
              </section>
            ))}
            {data.comments.length > 0 && (
              <section className="tui-cd-comments">
                <div className="tui-cd-comments-head">MR comments</div>
                {data.comments.map(c => (
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

export { ThreadsLink, CommentsDrawer };
