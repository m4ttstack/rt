import { useEffect, useRef, useState } from "react";
import type { BoardMR } from "../../data.ts";
import type { BoardMRWithReview, RowContext, RowMenuState } from "../types.ts";
import { useAutoGrowTextarea, useEscapeClose } from "../ui/hooks.ts";
import { getSlackMarks, nudgeTargets, reviewMenuItems, respondItemLabel, doctorItemLabel } from "./format.ts";

function MenuItem({
  label,
  hint,
  trailing,
  disabled,
  onClick,
}: {
  label: React.ReactNode;
  hint?: string;
  trailing?: React.ReactNode;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button className="tui-menu-item" role="menuitem" disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      {trailing ?? (hint && <span className="tui-menu-hint">{hint}</span>)}
    </button>
  );
}

/** shadcn-style context menu anchored at the cursor. State-aware: the review
    item reflects review status, and the Slack items are disabled until the
    MR's review-request thread has been resolved. Dismisses on outside click,
    Escape, scroll, or resize. */
function RowMenu({
  menu,
  ctx,
  onClose,
  onLaunch,
  onReReview,
  onCopy,
  onResolveSlack,
  onReactSlack,
  onPostSlack,
  onRespond,
  canRespond,
  onDoctor,
  canDoctor,
  onDraftState,
  canDraftState,
  onNudge,
  canNudge,
  onResumeReview,
}: {
  menu: RowMenuState;
  ctx: RowContext;
  onClose: () => void;
  onLaunch: (mr: BoardMR, note?: string) => void;
  onReReview: (mr: BoardMR, note?: string) => void;
  onCopy: (mr: BoardMR) => void;
  onResolveSlack: (mr: BoardMR) => void;
  onReactSlack: (mr: BoardMR, emoji: string, remove: boolean) => Promise<string[] | null>;
  onPostSlack: (mr: BoardMR) => void;
  onRespond: (mr: BoardMR, note?: string) => void;
  canRespond: boolean;
  onDoctor: (mr: BoardMR, note?: string) => void;
  canDoctor: boolean;
  onDraftState: (mr: BoardMR, draft: boolean) => void;
  canDraftState: boolean;
  onNudge: (mr: BoardMR, reviewer: string) => void;
  canNudge: boolean;
  onResumeReview: (mr: BoardMR, note?: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Local reaction state so the open menu updates immediately after a mark,
  // and per-emoji pending so the clicked item shows a spinner + disables.
  const [reactions, setReactions] = useState<string[]>((menu.mr as BoardMRWithReview).slack?.reactions ?? []);
  const [pending, setPending] = useState<string[]>([]);
  // Alt-held flips pane-launching items into "+ note" mode; alt-clicking one
  // swaps the menu for a note box whose Enter fires the captured action.
  const [altHeld, setAltHeld] = useState(false);
  const [noteFor, setNoteFor] = useState<{ label: string; fire: (note?: string) => void } | null>(null);
  const [noteText, setNoteText] = useState("");
  // Same auto-grow mechanism as the selection bar's header textarea.
  const noteRef = useAutoGrowTextarea([noteFor, noteText]);
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => setAltHeld(e.altKey);
    const onBlur = () => setAltHeld(false);
    document.addEventListener("keydown", onAlt);
    document.addEventListener("keyup", onAlt);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onAlt);
      document.removeEventListener("keyup", onAlt);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  useEscapeClose(onClose);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const { mr } = menu;
  const mrx = mr as BoardMRWithReview;
  const slack = mrx.slack;
  const found = slack?.status === "found";
  const showSlack = ctx.local && ctx.slackEnabled;
  const peers = ctx.local && canNudge ? nudgeTargets(mrx) : [];
  // Keep the menu on-screen; estimate generously since item count varies.
  const W = noteFor ? 320 : 230;
  const H = 60 + (ctx.local ? 34 : 0) + 68 + peers.length * 30 + (showSlack ? (found ? 170 : 60) : 0);
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - H - 8));
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  // Pane-launching items: a plain click fires immediately; an alt-click captures
  // the action and opens the note box instead. Focus-tab variants stay plain —
  // there is nothing to note into an already-running pane.
  const paneClick = (label: string, fire: (note?: string) => void) => (e: React.MouseEvent) => {
    if (e.altKey) {
      setNoteText("");
      setNoteFor({ label, fire });
      return;
    }
    fire();
    onClose();
  };
  const paneHint = altHeld ? "+ note" : "herdr";
  // Slack marks stay open (set several at once) and drive per-item pending +
  // a live check, so the click has immediate feedback. Clicking an item that
  // already carries our reaction removes it — the ✓ toggles the mark.
  const react = (emoji: string) => {
    if (pending.includes(emoji)) return;
    const remove = reactions.includes(emoji);
    setPending((p) => [...p, emoji]);
    onReactSlack(mr, emoji, remove).then((next) => {
      if (next) setReactions(next);
      setPending((p) => p.filter((e) => e !== emoji));
    });
  };

  if (noteFor) {
    return (
      <div ref={ref} className="tui-menu tui-menu-noting" style={{ left, top }} role="menu" aria-label={`note for !${mr.iid}`}>
        <div className="tui-menu-label">note for {noteFor.label} !{mr.iid}</div>
        <textarea
          ref={noteRef}
          className="tui-menu-note"
          rows={1}
          autoFocus
          value={noteText}
          placeholder="extra instruction…"
          maxLength={2000}
          aria-label="launch note"
          onChange={(e) => {
            setNoteText(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            // Keep Escape local (back to the menu, not menu close) and keep
            // the alt tracker honest while its document listener is muted.
            e.stopPropagation();
            setAltHeld(e.altKey);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              noteFor.fire(noteText.trim() || undefined);
              onClose();
            } else if (e.key === "Escape") {
              setNoteFor(null);
            }
          }}
        />
        <div className="tui-menu-note-hint">↵ launch with note · ⇧↵ newline · esc back</div>
      </div>
    );
  }

  const reviewRunning = mrx.review?.status === "queued" || mrx.review?.status === "reviewing";
  return (
    <div ref={ref} className="tui-menu" style={{ left, top }} role="menu" aria-label={`actions for !${mr.iid}`}>
      <div className="tui-menu-label">!{mr.iid}</div>

      {ctx.local && reviewMenuItems(mrx.review?.status).map((item) => (
        <MenuItem
          key={item.kind}
          label={item.label}
          hint={reviewRunning ? "herdr" : paneHint}
          onClick={
            reviewRunning
              ? run(() => onLaunch(mr))
              : paneClick(item.label, (note) => (item.kind === "re-review" ? onReReview(mr, note) : onLaunch(mr, note)))
          }
        />
      ))}
      {ctx.local && mrx.review?.sessionId && (
        <MenuItem
          label="resume review"
          hint={paneHint}
          onClick={paneClick("resume review", (note) => onResumeReview(mr, note))}
        />
      )}
      {ctx.local && canRespond && (
        <MenuItem
          label={respondItemLabel(mrx.respond?.status)}
          hint={respondItemLabel(mrx.respond?.status) === "focus response tab" ? "herdr" : paneHint}
          onClick={
            respondItemLabel(mrx.respond?.status) === "focus response tab"
              ? run(() => onRespond(mr))
              : paneClick(respondItemLabel(mrx.respond?.status), (note) => onRespond(mr, note))
          }
        />
      )}
      {ctx.local && canRespond && mrx.respond?.sessionId && (
        <MenuItem
          label="resume response"
          hint={paneHint}
          onClick={paneClick("resume response", (note) => ctx.onResumeRespond(mr, note))}
        />
      )}
      {ctx.local && canDoctor && (
        <MenuItem
          label={doctorItemLabel(mrx.doctor?.status)}
          hint={doctorItemLabel(mrx.doctor?.status) === "focus doctor tab" ? "herdr" : paneHint}
          onClick={
            doctorItemLabel(mrx.doctor?.status) === "focus doctor tab"
              ? run(() => onDoctor(mr))
              : paneClick(doctorItemLabel(mrx.doctor?.status), (note) => onDoctor(mr, note))
          }
        />
      )}
      {ctx.local && canDraftState && (
        <MenuItem
          label={mr.isDraft ? "mark ready" : "mark as draft"}
          hint="gitlab"
          onClick={run(() => onDraftState(mr, !mr.isDraft))}
        />
      )}
      {/* Ask a peer whose review left comments to look again. Only ever offered
          for your own MR, and only while no ask of yours is still outstanding. */}
      {peers.map((peer) => (
        <MenuItem
          key={peer.reviewer}
          label={`request re-review from ${peer.reviewer}`}
          hint="peer"
          onClick={run(() => onNudge(mr, peer.reviewer))}
        />
      ))}
      {mrx.review?.reportReady && (
        <MenuItem label="view review" onClick={run(() => ctx.onOpenReview(mrx))} />
      )}
      <MenuItem label="open in gitlab" onClick={run(() => mr.webUrl && window.open(mr.webUrl, "_blank", "noopener"))} />
      <MenuItem label="copy for slack" onClick={run(() => onCopy(mr))} />

      {showSlack && (
        <>
          <div className="tui-menu-sep" />
          {found ? (
            <>
              {getSlackMarks().map((m) => {
                const isPending = pending.includes(m.emoji);
                const isMarked = reactions.includes(m.emoji);
                return (
                  <MenuItem
                    key={m.emoji}
                    label={isMarked ? `unmark ${m.glyph} on slack` : m.label}
                    disabled={isPending}
                    trailing={
                      isPending ? (
                        <span className="tui-menu-spin" aria-label="working" />
                      ) : isMarked ? (
                        <span className="tui-menu-check">✓</span>
                      ) : undefined
                    }
                    onClick={() => react(m.emoji)}
                  />
                );
              })}
              {slack?.permalink && (
                <MenuItem label="open MR post in slack" onClick={run(() => window.open(slack.permalink!, "_blank", "noopener"))} />
              )}
            </>
          ) : (
            <>
              <MenuItem
                label={slack?.status === "notfound" ? "no thread — retry find" : "find slack thread"}
                onClick={run(() => onResolveSlack(mr))}
              />
              <MenuItem label="post to slack" onClick={run(() => onPostSlack(mr))} />
              {getSlackMarks().map((m) => (
                <MenuItem key={m.emoji} label={m.label} disabled />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

export { MenuItem, RowMenu };
