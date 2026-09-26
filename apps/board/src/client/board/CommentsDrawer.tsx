import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button, ICONS, Markdown, SideDrawer } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import type { BoardMR } from '../../data.ts';
import { getDiscussions, postThreadWrite } from '../api.ts';
import type { CommentNote, CommentThread, GeneralComment } from '../types.ts';
import { ago, cleanTitle, THREAD_ICON, THREAD_LABEL } from './format.ts';
import { MessageGlyph } from './icons.tsx';

/** The facts line's threads token, the drawer's entry. A status outranks
    the count and takes its place, with the total in the tooltip: `awaitYou`
    (the seat's own MR threads waiting on them) reads "N threads waiting",
    `replied` (the author answered the seat's threads on someone else's MR)
    reads "author replied". `stopPropagation` keeps the click off the row's
    own handler, which would open the MR in GitLab. */
function ThreadsLink({
  count,
  fresh,
  grew,
  awaitYou,
  replied,
  onOpen,
}: {
  count: number;
  fresh: boolean;
  grew: number;
  awaitYou: number;
  replied: boolean;
  onOpen: () => void;
}) {
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const lit = fresh && openedAt !== count;
  const total = `${count} thread${count === 1 ? '' : 's'}`;
  const title = lit
    ? `${grew} new since you last looked`
    : awaitYou > 0
      ? `${total}, ${awaitYou} waiting on you`
      : replied
        ? `${total}, the author answered yours`
        : 'open the comments drawer';
  return (
    <button
      type="button"
      className="tui-threads"
      data-new={lit ? 'true' : undefined}
      title={title}
      onClick={e => {
        e.stopPropagation();
        setOpenedAt(count);
        onOpen();
      }}
    >
      <MessageGlyph />
      {awaitYou > 0 ? (
        <span className="tui-threads-await">
          {awaitYou} thread{awaitYou === 1 ? '' : 's'} waiting
        </span>
      ) : replied ? (
        <span className="tui-threads-replied">author replied</span>
      ) : (
        <span className="tui-threads-count">{total}</span>
      )}
    </button>
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
      <NoteBody body={note.body} />
    </div>
  );
}

/** A note's markdown under the drawer's height cap, with "show more" only
    when the note actually runs past it. Measured rather than guessed from the
    text's length: a short note with a code block can stand taller than a long
    paragraph. The cap is on before the first measure, so an overflowing note
    never flashes open. */
function NoteBody({ body }: { body: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [body, expanded]);
  return (
    <div className="tui-cd-note-body">
      <div
        ref={ref}
        className="tui-cd-note-clamp"
        data-clamped={expanded ? 'false' : 'true'}
        data-overflow={overflows ? 'true' : undefined}
      >
        {/* `unstyled` is the parity choice, not an omission. .tui-cd-note-body
            is a SEPARATE board-owned prose block that was never .tui-md;
            without this the recipe's own font-family/size/line-height would sit
            directly on the element ReactMarkdown mounts into (beating an
            inherited font regardless of layer order) and its layered
            h1-h6/pre/table rules would apply with no unlayered competitor.
            data-part="markdown" is still stamped either way. */}
        <Markdown unstyled linkTargetBlank>
          {body}
        </Markdown>
      </div>
      {overflows && (
        <button
          type="button"
          className="tui-cd-verb tui-cd-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(open => !open)}
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
    </div>
  );
}

type Discussions = { threads: CommentThread[]; comments: GeneralComment[] };

/** `next` in the order the drawer first showed, so a thread the seat just
    resolved or answered stays under the pointer instead of re-sorting away.
    Threads the drawer has not shown yet keep the server's order, after. */
function inPlace(
  prev: CommentThread[] | undefined,
  next: CommentThread[]
): CommentThread[] {
  if (!prev) return next;
  const at = new Map(prev.map((t, i) => [t.discussionId, i]));
  const rank = (t: CommentThread) => at.get(t.discussionId) ?? prev.length;
  return [...next].sort((a, b) => rank(a) - rank(b));
}

type Pending = { id: string; what: 'send' | 'send-resolve' | 'resolve' };

interface ThreadWrites {
  composing: string | null;
  drafts: Readonly<Record<string, string>>;
  pending: Pending | null;
  errors: Readonly<Record<string, string>>;
  open: (id: string) => void;
  close: () => void;
  setDraft: (id: string, text: string) => void;
  send: (t: CommentThread, alsoResolve: boolean) => void;
  toggleResolved: (t: CommentThread) => void;
}

/** Reply and resolve for one MR's threads. One write at a time: a second
    click while one is in flight is ignored, not queued. */
function useThreadWrites(
  mr: BoardMR,
  apply: (d: Discussions) => void
): ThreadWrites {
  const [composing, setComposing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  // `pending` is a render behind: two clicks in one frame both read null.
  const inFlight = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError = (id: string, error: string | null) =>
    setErrors(({ [id]: _dropped, ...rest }) =>
      error === null ? rest : { ...rest, [id]: error }
    );
  const address = (id: string) => ({
    repo: mr.rtRepo,
    iid: mr.iid,
    discussionId: id,
    author: mr.author.username,
  });

  const send = async (t: CommentThread, alsoResolve: boolean) => {
    const id = t.discussionId;
    const body = drafts[id] ?? '';
    if (inFlight.current || !body.trim()) return;
    inFlight.current = true;
    setPending({ id, what: alsoResolve ? 'send-resolve' : 'send' });
    setError(id, null);
    const replied = await postThreadWrite('/discussions/reply', {
      ...address(id),
      body,
    });
    if (!replied.ok) {
      setError(id, `reply not sent: ${replied.error}`);
      inFlight.current = false;
      setPending(null);
      return;
    }
    apply(replied);
    setDrafts(({ [id]: _sent, ...rest }) => rest);
    setComposing(open => (open === id ? null : open));
    if (alsoResolve) {
      const resolved = await postThreadWrite('/discussions/resolve', {
        ...address(id),
        resolved: true,
      });
      if (resolved.ok) apply(resolved);
      else setError(id, `reply sent, but resolve failed: ${resolved.error}`);
    }
    inFlight.current = false;
    setPending(null);
  };

  const toggleResolved = async (t: CommentThread) => {
    const id = t.discussionId;
    if (inFlight.current) return;
    inFlight.current = true;
    setPending({ id, what: 'resolve' });
    setError(id, null);
    const res = await postThreadWrite('/discussions/resolve', {
      ...address(id),
      resolved: t.status !== 'resolved',
    });
    if (res.ok) apply(res);
    else setError(id, res.error);
    inFlight.current = false;
    setPending(null);
  };

  return {
    composing,
    drafts,
    pending,
    errors,
    open: setComposing,
    close: () => setComposing(null),
    setDraft: (id, text) => setDrafts(d => ({ ...d, [id]: text })),
    send: (t, alsoResolve) => void send(t, alsoResolve),
    toggleResolved: t => void toggleResolved(t),
  };
}

/** The reply box at a thread's foot. ⌘↵ sends; Escape closes the box and
    keeps the draft, and stops there so the drawer behind it stays open. */
function ReplyBox({
  thread,
  writes,
}: {
  thread: CommentThread;
  writes: ThreadWrites;
}) {
  const id = thread.discussionId;
  const draft = writes.drafts[id] ?? '';
  const ref = useAutoGrowTextarea([draft]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [ref]);
  const busy = writes.pending?.id === id ? writes.pending.what : null;
  const locked = writes.pending !== null;
  const empty = !draft.trim();
  return (
    <div className="tui-cd-reply">
      <textarea
        ref={ref}
        className="tui-cd-reply-input"
        rows={2}
        value={draft}
        placeholder="reply…"
        aria-label="reply to this thread"
        onChange={e => writes.setDraft(id, e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            writes.close();
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            writes.send(thread, false);
          }
        }}
      />
      <div className="tui-cd-reply-foot">
        <span className="tui-cd-reply-hint">⌘↵ sends · esc closes</span>
        <Button
          type="button"
          size="sm"
          variant="subtle"
          intent="muted"
          onClick={writes.close}
        >
          cancel
        </Button>
        {thread.status !== 'resolved' && (
          <Button
            type="button"
            size="sm"
            variant="light"
            intent="accent"
            busy={busy === 'send-resolve'}
            disabled={locked || empty}
            onClick={() => writes.send(thread, true)}
          >
            send & resolve
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="filled"
          intent="accent"
          busy={busy === 'send'}
          disabled={locked || empty}
          onClick={() => writes.send(thread, false)}
        >
          send
        </Button>
      </div>
    </div>
  );
}

/** One review thread: its status bar (with reply / resolve when the board can
    write), its notes, the reply box when open, and the last write's error. */
function ThreadCard({
  mr,
  thread,
  now,
  writes,
}: {
  mr: BoardMR;
  thread: CommentThread;
  now: number;
  writes: ThreadWrites | null;
}) {
  const id = thread.discussionId;
  const resolved = thread.status === 'resolved';
  const resolving =
    writes?.pending?.id === id && writes.pending.what === 'resolve';
  const error = writes?.errors[id];
  return (
    <section
      className={`tui-cd-thread ${thread.status}`}
      data-discussion-id={id}
    >
      <div className="tui-cd-thread-status">
        <span>
          <span className="tui-comment-icon">{THREAD_ICON[thread.status]}</span>{' '}
          {THREAD_LABEL[thread.status]}
        </span>
        <span className="tui-cd-thread-verbs">
          {writes && (
            <>
              <button
                type="button"
                className="tui-cd-verb"
                onClick={() => writes.open(id)}
              >
                reply
              </button>
              <button
                type="button"
                className="tui-cd-verb"
                disabled={writes.pending !== null}
                aria-busy={resolving || undefined}
                onClick={() => writes.toggleResolved(thread)}
              >
                {resolving
                  ? resolved
                    ? 'unresolving…'
                    : 'resolving…'
                  : resolved
                    ? 'unresolve'
                    : 'resolve'}
              </button>
            </>
          )}
          {mr.webUrl && thread.notes[0] && (
            <a
              className="tui-cd-thread-open"
              href={`${mr.webUrl}#note_${thread.notes[0].id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              open ↗
            </a>
          )}
        </span>
      </div>
      {thread.notes.map(n => (
        <CommentNoteView key={n.id} mr={mr} note={n} now={now} />
      ))}
      {writes?.composing === id && <ReplyBox thread={thread} writes={writes} />}
      {error && (
        <p className="tui-cd-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Right-side drawer showing an MR's review threads (each with its status and
    notes) plus a section for general MR comments: the Overview-tab notes that
    aren't threads, so a later author comment isn't invisible. Lazily fetched.
    A local board can also reply to and resolve threads from here. */
function CommentsDrawer({
  mr,
  local,
  onClose,
}: {
  mr: BoardMR;
  local: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<Discussions | null>(null);
  const [failed, setFailed] = useState(false);
  const now = Date.now();
  const apply = (d: Discussions) =>
    setData(prev => ({
      threads: inPlace(prev?.threads, d.threads),
      comments: d.comments,
    }));
  // A read started before a write landed would roll that write back.
  const writeSeq = useRef(0);
  const writes = useThreadWrites(mr, d => {
    writeSeq.current++;
    apply(d);
  });
  // Board polls hand over a fresh MR object every time; only a change to what
  // the threads could have become is worth another read.
  const s = mr.threadSummary;
  const freshness = `${mr.updatedAt}|${s?.awaiting}|${s?.replied}|${s?.resolved}|${mr.generalComments ?? 0}`;
  useEffect(() => {
    const seq = writeSeq.current;
    let live = true;
    getDiscussions(mr.rtRepo ?? '', mr.iid, mr.author.username)
      .then(d => {
        if (!live || seq !== writeSeq.current) return;
        setFailed(false);
        apply(d);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mr.rtRepo, mr.iid, mr.author.username, freshness]);
  const canWrite = local && !!mr.rtRepo;
  return (
    <SideDrawer
      side="right"
      className="tui-cd-panel"
      ariaLabel="comment threads"
      onClose={onClose}
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
        {!data ? (
          <p className="tui-comments-empty">
            {failed ? "couldn't load comments" : 'loading…'}
          </p>
        ) : data.threads.length === 0 && data.comments.length === 0 ? (
          <p className="tui-comments-empty">no comments</p>
        ) : (
          <>
            {data.threads.map(t => (
              <ThreadCard
                key={t.discussionId}
                mr={mr}
                thread={t}
                now={now}
                writes={canWrite ? writes : null}
              />
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
