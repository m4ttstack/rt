import { useEffect, useState } from "react";
import type { BoardMR } from "../../data.ts";
import type { BoardMRWithReview, RowContext, RowMenuState } from "../types.ts";
import { ContextMenu } from "@mattstack/tui-kit";
import { useAutoGrowTextarea } from "@mattstack/tui-kit/hooks";
import { getSlackMarks, nudgeTargets, reviewMenuItems, respondItemLabel, doctorItemLabel } from "./format.ts";

/** shadcn-style context menu anchored at the cursor. The SHELL is the kit's
    ContextMenu recipe -- the fixed box, the measured viewport clamp, the
    item/label/separator parts, and all four dismissals (Escape through the
    shared LIFO layer stack, outside mousedown, scroll capture, resize). What
    stays here is everything board: which items exist for this MR's state, the
    slack marks section, and the alt-note mode, which renders INSIDE the menu
    surface as the recipe's children. */
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
  // FOCUS THE NOTE BOX ON THE NEXT FRAME, not with `autoFocus`. The recipe
  // renders itself `visibility: hidden` until its layout effect has measured
  // and clamped the box, and a `visibility: hidden` subtree cannot take focus
  // at all -- `focus()` on it is a silent no-op (verified in chromium: the
  // element does not become activeElement, and un-hiding does not retroactively
  // give it focus). React fires `autoFocus` in the same commit that leaves the
  // menu hidden, and so does any passive effect (React flushes those before the
  // clamp's own state update re-renders), so a frame is the earliest honest
  // moment. Only matters because note mode now REMOUNTS (see the key below);
  // before the adoption the div was reconciled in place and never went hidden.
  useEffect(() => {
    if (!noteFor) return;
    const id = requestAnimationFrame(() => noteRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [noteFor, noteRef]);

  const { mr } = menu;
  const mrx = mr as BoardMRWithReview;
  const slack = mrx.slack;
  const found = slack?.status === "found";
  const showSlack = ctx.local && ctx.slackEnabled;
  const peers = ctx.local && canNudge ? nudgeTargets(mrx) : [];
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
      <ContextMenu
        // THE KEY IS LOAD-BEARING, not decoration. The recipe's clamp is a
        // layout effect keyed on [x, y]; RowMenu's own third dep (`noteFor`)
        // could not travel with it, because a menu shell has no business
        // knowing a consumer's modes. A distinct key makes React unmount the
        // item-list menu and mount this one instead, which re-runs the clamp
        // against the note box's very different size — the adoption answer the
        // recipe documents. Accepted cosmetic delta: the 90ms entry animation
        // replays on the swap, where the old in-place reconcile did not
        // re-animate.
        key="noting"
        x={menu.x}
        y={menu.y}
        ariaLabel={`note for !${mr.iid}`}
        onClose={onClose}
        // The board's own note-mode box (320px wide, tighter padding) plus the
        // scope its label rule needs. style.css is unlayered, so it wins over
        // the recipe's own `.root` padding regardless of specificity.
        className="tui-menu-noting"
      >
        <ContextMenu.Label>note for {noteFor.label} !{mr.iid}</ContextMenu.Label>
        <textarea
          ref={noteRef}
          className="tui-menu-note"
          rows={1}
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
      </ContextMenu>
    );
  }

  const reviewRunning = mrx.review?.status === "queued" || mrx.review?.status === "reviewing";
  return (
    // The item list's own key, the other half of the pair above: two menus of
    // the same element type at the same position are only distinct instances
    // to React if their keys differ.
    <ContextMenu key="items" x={menu.x} y={menu.y} ariaLabel={`actions for !${mr.iid}`} onClose={onClose}>
      <ContextMenu.Label>!{mr.iid}</ContextMenu.Label>

      {ctx.local && reviewMenuItems(mrx.review?.status).map((item) => (
        <ContextMenu.Item
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
        <ContextMenu.Item
          label="resume review"
          hint={paneHint}
          onClick={paneClick("resume review", (note) => onResumeReview(mr, note))}
        />
      )}
      {ctx.local && canRespond && (
        <ContextMenu.Item
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
        <ContextMenu.Item
          label="resume response"
          hint={paneHint}
          onClick={paneClick("resume response", (note) => ctx.onResumeRespond(mr, note))}
        />
      )}
      {ctx.local && canDoctor && (
        <ContextMenu.Item
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
        <ContextMenu.Item
          label={mr.isDraft ? "mark ready" : "mark as draft"}
          hint="gitlab"
          onClick={run(() => onDraftState(mr, !mr.isDraft))}
        />
      )}
      {/* Ask a peer whose review left comments to look again. Only ever offered
          for your own MR, and only while no ask of yours is still outstanding. */}
      {peers.map((peer) => (
        <ContextMenu.Item
          key={peer.reviewer}
          label={`request re-review from ${peer.reviewer}`}
          hint="peer"
          onClick={run(() => onNudge(mr, peer.reviewer))}
        />
      ))}
      {mrx.review?.reportReady && (
        <ContextMenu.Item label="view review" onClick={run(() => ctx.onOpenReview(mrx))} />
      )}
      <ContextMenu.Item label="open in gitlab" onClick={run(() => mr.webUrl && window.open(mr.webUrl, "_blank", "noopener"))} />
      <ContextMenu.Item label="copy for slack" onClick={run(() => onCopy(mr))} />

      {showSlack && (
        <>
          <ContextMenu.Separator />
          {found ? (
            <>
              {getSlackMarks().map((m) => {
                const isPending = pending.includes(m.emoji);
                const isMarked = reactions.includes(m.emoji);
                return (
                  <ContextMenu.Item
                    key={m.emoji}
                    label={isMarked ? `unmark ${m.glyph} on slack` : m.label}
                    disabled={isPending}
                    // Caller-supplied trailing nodes: the recipe never inspects
                    // them, so both keep their board-side classes.
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
                <ContextMenu.Item label="open MR post in slack" onClick={run(() => window.open(slack.permalink!, "_blank", "noopener"))} />
              )}
            </>
          ) : (
            <>
              <ContextMenu.Item
                label={slack?.status === "notfound" ? "no thread — retry find" : "find slack thread"}
                onClick={run(() => onResolveSlack(mr))}
              />
              <ContextMenu.Item label="post to slack" onClick={run(() => onPostSlack(mr))} />
              {getSlackMarks().map((m) => (
                <ContextMenu.Item key={m.emoji} label={m.label} disabled />
              ))}
            </>
          )}
        </>
      )}
    </ContextMenu>
  );
}

export { RowMenu };
