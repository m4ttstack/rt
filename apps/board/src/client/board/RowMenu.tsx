import { useEffect, useState } from 'react';

import { ContextMenu } from '@mattstack/tui-kit';
import { useAutoGrowTextarea } from '@mattstack/tui-kit/hooks';
import type { BoardMR } from '../../data.ts';
import type { MrAction } from '../../mr-action.ts';
import type { BoardMRWithReview, RowContext, RowMenuState } from '../types.ts';
import {
  doctorItemLabel,
  firstReviewTargets,
  getSlackMarks,
  gitlabMenuItems,
  laneInterrupted,
  nudgeTargets,
  respondAskTarget,
  respondItemLabel,
  reviewLogged,
  reviewMenuItems,
} from './format.ts';
import {
  AgentGlyph,
  ArrowOutGlyph,
  FlagGlyph,
  MenuGlyph,
  SlackLogo,
} from './icons.tsx';
import { laneDismissed } from './row-status.ts';

type Lane = 'review' | 'respond' | 'doctor';

/** An agent action's label: the bot mark in the lane's color, then the
    row's own verb, so the menu and the status line say the same thing. */
function agentLabel(lane: Lane, text: string) {
  return (
    <span className="tui-menu-agent" data-lane={lane}>
      <AgentGlyph />
      {text}
    </span>
  );
}

/** Every other item: one icon that says where the click lands, then the
    words. The icon replaces the old trailing "gitlab" / "herdr" hints. */
function iconLabel(icon: React.ReactNode, text: string) {
  return (
    <span className="tui-menu-icon-label">
      {icon}
      {text}
    </span>
  );
}

const FileGlyph = () => <MenuGlyph kind="file" />;
const PeopleGlyph = () => <MenuGlyph kind="people" />;
const CopyGlyph = () => <MenuGlyph kind="copy" />;
const DismissGlyph = () => <MenuGlyph kind="dismiss" />;
const NoteMenuGlyph = () => <MenuGlyph kind="note" />;
const GITLAB_GLYPH: Record<
  ReturnType<typeof gitlabMenuItems>[number]['kind'],
  React.ReactNode
> = {
  merge: <FlagGlyph kind="conflicts" />,
  rebase: <MenuGlyph kind="branch" />,
  setAutoMerge: <FlagGlyph kind="auto-merge" />,
  cancelAutoMerge: <FlagGlyph kind="auto-merge" />,
};

/** Context menu anchored at the cursor. The kit's ContextMenu recipe owns the
    shell -- the box, the viewport clamp, the parts, and all four dismissals.
    What stays here is everything board: which items exist for this MR's state,
    the slack marks section, and the alt-note mode, which renders inside the
    menu surface as the recipe's children. */
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
  onMrAction,
  onRebaseLocal,
  onNudge,
  canNudge,
  onResumeReview,
  roster,
  onRequestReview,
  canAskRespond,
  onAskRespond,
}: {
  menu: RowMenuState;
  ctx: RowContext;
  onClose: () => void;
  onLaunch: (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') => void;
  onReReview: (mr: BoardMR, note?: string) => void;
  onCopy: (mr: BoardMR) => void;
  onResolveSlack: (mr: BoardMR) => void;
  onReactSlack: (
    mr: BoardMR,
    emoji: string,
    remove: boolean
  ) => Promise<string[] | null>;
  onPostSlack: (mr: BoardMR) => void;
  onRespond: (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') => void;
  canRespond: boolean;
  onDoctor: (mr: BoardMR, note?: string, intent?: 'launch' | 'focus') => void;
  canDoctor: boolean;
  onDraftState: (mr: BoardMR, draft: boolean) => void;
  canDraftState: boolean;
  onMrAction: (mr: BoardMR, action: MrAction) => void;
  onRebaseLocal: (mr: BoardMR, note?: string) => void;
  onNudge: (mr: BoardMR, reviewer: string) => void;
  canNudge: boolean;
  onResumeReview: (mr: BoardMR, note?: string) => void;
  /** Team roster usernames, the first-look ask's candidate pool. */
  roster: string[];
  onRequestReview: (mr: BoardMR, reviewer: string) => void;
  canAskRespond: boolean;
  onAskRespond: (mr: BoardMR, reviewer: string) => void;
}) {
  // Local reaction state so the open menu updates immediately after a mark,
  // and per-emoji pending so the clicked item shows a spinner + disables.
  const [reactions, setReactions] = useState<string[]>(
    (menu.mr as BoardMRWithReview).slack?.reactions ?? []
  );
  // Merge is the one irreversible item: the first click flips its label to a
  // confirm, the second fires. Any other click closes the menu, which resets.
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  // Alt-held flips pane-launching items into "+ note" mode; alt-clicking one
  // swaps the menu for a note box whose Enter fires the captured action.
  const [altHeld, setAltHeld] = useState(false);
  const [noteFor, setNoteFor] = useState<{
    label: string;
    fire: (note?: string) => void;
  } | null>(null);
  // Second menu stage: picking whom to ask for a first look.
  const [pickingReviewer, setPickingReviewer] = useState(false);
  const [noteText, setNoteText] = useState('');
  // Same auto-grow mechanism as the selection bar's header textarea.
  const noteRef = useAutoGrowTextarea([noteFor, noteText]);
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => setAltHeld(e.altKey);
    const onBlur = () => setAltHeld(false);
    document.addEventListener('keydown', onAlt);
    document.addEventListener('keyup', onAlt);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onAlt);
      document.removeEventListener('keyup', onAlt);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  const { mr } = menu;
  const mrx = mr as BoardMRWithReview;
  const slack = mrx.slack;
  const found = slack?.status === 'found';
  const showSlack = ctx.local && ctx.slackEnabled;
  const peers = ctx.local && canNudge ? nudgeTargets(mrx) : [];
  const askTargets =
    ctx.local && canNudge ? firstReviewTargets(mrx, roster) : [];
  const respondTarget =
    ctx.local && canAskRespond ? respondAskTarget(mrx) : null;
  const gitlabItems = gitlabMenuItems(mr);
  const canRebaseLocal =
    mr.blockers?.hasConflicts ||
    mr.rebaseButton.visible ||
    (mr.behindTarget ?? 0) > 0;
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  // Pane-launching items: a plain click fires immediately; an alt-click captures
  // the action and opens the note box instead. Focus-tab variants stay plain —
  // there is nothing to note into an already-running pane.
  const paneClick =
    (label: string, fire: (note?: string) => void) => (e: React.MouseEvent) => {
      if (e.altKey) {
        setNoteText('');
        setNoteFor({ label, fire });
        return;
      }
      fire();
      onClose();
    };
  const paneHint = altHeld ? '+ note' : undefined;
  // Slack marks stay open (set several at once) and drive per-item pending +
  // a live check, so the click has immediate feedback. Clicking an item that
  // already carries our reaction removes it — the ✓ toggles the mark.
  const react = (emoji: string) => {
    if (pending.includes(emoji)) return;
    const remove = reactions.includes(emoji);
    setPending(p => [...p, emoji]);
    onReactSlack(mr, emoji, remove).then(next => {
      if (next) setReactions(next);
      setPending(p => p.filter(e => e !== emoji));
    });
  };

  if (pickingReviewer) {
    return (
      // Same keyed-remount trick as the note stage below: a distinct key makes
      // the recipe re-run its viewport clamp against this stage's own size.
      <ContextMenu
        key="asking"
        x={menu.x}
        y={menu.y}
        ariaLabel={`request review for !${mr.iid}`}
        onClose={onClose}
      >
        <ContextMenu.Label>request review from</ContextMenu.Label>
        {askTargets.map(u => (
          <ContextMenu.Item
            key={`ask-${u}`}
            label={iconLabel(<PeopleGlyph />, u)}
            onClick={run(() => onRequestReview(mr, u))}
          />
        ))}
      </ContextMenu>
    );
  }

  if (noteFor) {
    return (
      <ContextMenu
        // THE KEY IS LOAD-BEARING. The recipe's clamp is a layout effect keyed
        // on [x, y] only; a distinct key makes React unmount the item-list menu
        // and mount this one, re-running the clamp against the note box's very
        // different size. Accepted cosmetic delta: the entry animation replays.
        key="noting"
        x={menu.x}
        y={menu.y}
        ariaLabel={`note for !${mr.iid}`}
        onClose={onClose}
        // The recipe focuses this once the clamp has committed and the menu has
        // stopped being `visibility: hidden` -- the earliest point a focus call
        // can land. `autoFocus`, or a focus call from our own effect, would run
        // while the subtree is still hidden and silently no-op.
        initialFocusRef={noteRef}
        // The board's own note-mode box (320px wide, tighter padding) plus the
        // scope its label rule needs. style.css is unlayered, so it wins over
        // the recipe's own `.root` padding regardless of specificity.
        className="tui-menu-noting"
      >
        <ContextMenu.Label>
          note for {noteFor.label} !{mr.iid}
        </ContextMenu.Label>
        <textarea
          ref={noteRef}
          className="tui-menu-note"
          rows={1}
          value={noteText}
          placeholder="extra instruction…"
          maxLength={2000}
          aria-label="launch note"
          onChange={e => {
            setNoteText(e.currentTarget.value);
          }}
          onKeyDown={e => {
            // Keep Escape local (back to the menu, not menu close) and keep
            // the alt tracker honest while its document listener is muted.
            e.stopPropagation();
            setAltHeld(e.altKey);
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              noteFor.fire(noteText.trim() || undefined);
              onClose();
            } else if (e.key === 'Escape') {
              setNoteFor(null);
            }
          }}
        />
        <div className="tui-menu-note-hint">
          ↵ launch with note · ⇧↵ newline · esc back
        </div>
      </ContextMenu>
    );
  }

  const reviewRunning =
    mrx.review?.status === 'queued' || mrx.review?.status === 'reviewing';
  // Both the focus and relaunch words ride the same 'focus' intent: the
  // launch route already re-opens a dead pane, the label just stops lying
  // about which of the two it is about to do.
  const respondLabel = respondItemLabel(
    mrx.respond?.status,
    laneInterrupted(mrx.orphan, mrx.respond)
  );
  const respondFocuses =
    respondLabel === 'focus response' || respondLabel === 'relaunch response';
  const doctorLabel = doctorItemLabel(mrx.doctor?.status);
  const doctorFocuses = doctorLabel === 'focus doctor';
  // Only what is possible right now renders: a blocked GitLab action is
  // absent, not greyed, and a section with nothing in it has no label.
  const gitlab = ctx.local ? gitlabItems.filter(item => !item.disabled) : [];
  const agentItems: React.ReactNode[] = [];
  if (ctx.local) {
    for (const item of reviewMenuItems(
      mrx.review?.status,
      laneInterrupted(mrx.orphan, mrx.review),
      reviewLogged(mr)
    )) {
      agentItems.push(
        <ContextMenu.Item
          key={item.kind}
          label={agentLabel('review', item.label)}
          hint={reviewRunning ? undefined : paneHint}
          onClick={
            reviewRunning
              ? run(() => onLaunch(mr, undefined, 'focus'))
              : paneClick(item.label, note =>
                  item.kind === 're-review'
                    ? onReReview(mr, note)
                    : onLaunch(mr, note)
                )
          }
        />
      );
    }
    if (mrx.review?.sessionId)
      agentItems.push(
        <ContextMenu.Item
          key="resume-review"
          label={agentLabel('review', 'resume review')}
          hint={paneHint}
          onClick={paneClick('resume review', note => onResumeReview(mr, note))}
        />
      );
    if (canRespond)
      agentItems.push(
        <ContextMenu.Item
          key="respond"
          label={agentLabel('respond', respondLabel)}
          hint={respondFocuses ? undefined : paneHint}
          onClick={
            respondFocuses
              ? run(() => onRespond(mr, undefined, 'focus'))
              : paneClick(respondLabel, note => onRespond(mr, note))
          }
        />
      );
    if (canRespond && mrx.respond?.sessionId)
      agentItems.push(
        <ContextMenu.Item
          key="resume-respond"
          label={agentLabel('respond', 'resume response')}
          hint={paneHint}
          onClick={paneClick('resume response', note =>
            ctx.onResumeRespond(mr, note)
          )}
        />
      );
    if (canDoctor)
      agentItems.push(
        <ContextMenu.Item
          key="doctor"
          label={agentLabel('doctor', doctorLabel)}
          hint={doctorFocuses ? undefined : paneHint}
          onClick={
            doctorFocuses
              ? run(() => onDoctor(mr, undefined, 'focus'))
              : paneClick(doctorLabel, note => onDoctor(mr, note))
          }
        />
      );
    // The doctor chassis scoped to a checkout rebase, offered whenever a
    // rebase is plausibly wanted (conflicts, GitLab's own rebase button
    // raised, or merely behind target), since it's the fallback for the
    // gitlab-section rebase failing. A doctor already in flight re-focuses
    // via the endpoint's dedup rather than spawning a second pane.
    if (canRebaseLocal)
      agentItems.push(
        <ContextMenu.Item
          key="rebase-local"
          label={agentLabel('doctor', 'rebase locally')}
          hint={paneHint}
          onClick={paneClick('rebase locally', note => onRebaseLocal(mr, note))}
        />
      );
  }
  if (mrx.review?.reportReady)
    agentItems.push(
      <ContextMenu.Item
        key="view-review"
        label={iconLabel(<FileGlyph />, 'view agent review')}
        onClick={run(() => ctx.onOpenReview(mrx))}
      />
    );
  if (mrx.respond?.reportReady)
    agentItems.push(
      <ContextMenu.Item
        key="view-respond"
        label={iconLabel(<FileGlyph />, 'view agent response')}
        onClick={run(() => ctx.onOpenRespond(mrx))}
      />
    );
  // Dismiss a failed lane's line (B8): same verb the status line carries,
  // offered per failed lane so a run that ended in "nothing to do here" can
  // leave the row without calling the agent again.
  for (const lane of ['review', 'respond', 'doctor'] as const) {
    const state = mrx[lane];
    if (state?.status !== 'error' || laneDismissed(state)) continue;
    agentItems.push(
      <ContextMenu.Item
        key={`dismiss-${lane}`}
        label={iconLabel(<DismissGlyph />, `dismiss ${lane} line`)}
        onClick={run(() => ctx.onDismissLane(mr, lane))}
      />
    );
  }
  // Ask a peer whose review left comments to look again. Only ever offered
  // for your own MR, and only while no ask of yours is still outstanding.
  for (const peer of peers)
    agentItems.push(
      <ContextMenu.Item
        key={`nudge-${peer.reviewer}`}
        label={iconLabel(
          <PeopleGlyph />,
          `ask ${peer.reviewer}'s agent to re-review`
        )}
        onClick={run(() => onNudge(mr, peer.reviewer))}
      />
    );
  // Ask the author's agent to answer my review's feedback.
  if (respondTarget)
    agentItems.push(
      <ContextMenu.Item
        key="ask-respond"
        label={iconLabel(
          <PeopleGlyph />,
          `ask ${respondTarget}'s agent to respond`
        )}
        onClick={run(() => onAskRespond(mr, respondTarget))}
      />
    );
  // Ask a free peer for a first look. Swaps to the picker stage rather than
  // closing, so the click that chooses the reviewer is the one that fires.
  if (askTargets.length)
    agentItems.push(
      <ContextMenu.Item
        key="ask-review"
        label={iconLabel(<PeopleGlyph />, 'request review from…')}
        onClick={() => setPickingReviewer(true)}
      />
    );

  return (
    // The other half of the pair above: two menus of the same element type at
    // the same position are only distinct instances to React if the keys differ.
    <ContextMenu
      key="items"
      x={menu.x}
      y={menu.y}
      ariaLabel={`actions for !${mr.iid}`}
      onClose={onClose}
    >
      <ContextMenu.Label>!{mr.iid}</ContextMenu.Label>

      {agentItems.length > 0 && (
        <>
          <ContextMenu.Label>agent actions</ContextMenu.Label>
          {agentItems}
        </>
      )}

      <ContextMenu.Separator />
      <ContextMenu.Label>gitlab</ContextMenu.Label>
      {gitlab.map(item => (
        <ContextMenu.Item
          key={item.kind}
          label={iconLabel(
            GITLAB_GLYPH[item.kind],
            item.kind === 'merge' && confirmMerge ? 'really merge?' : item.label
          )}
          onClick={
            item.kind === 'merge' && !confirmMerge
              ? () => setConfirmMerge(true)
              : run(() => onMrAction(mr, item.kind))
          }
        />
      ))}
      {ctx.local && canDraftState && (
        <ContextMenu.Item
          label={iconLabel(
            <FlagGlyph kind="draft" />,
            mr.isDraft ? 'mark ready' : 'mark as draft'
          )}
          onClick={run(() => onDraftState(mr, !mr.isDraft))}
        />
      )}
      <ContextMenu.Item
        label={iconLabel(<ArrowOutGlyph />, 'open in gitlab')}
        onClick={run(
          () => mr.webUrl && window.open(mr.webUrl, '_blank', 'noopener')
        )}
      />

      <ContextMenu.Separator />
      <ContextMenu.Label>slack</ContextMenu.Label>
      {showSlack && found && (
        <>
          {getSlackMarks().map(m => {
            const isPending = pending.includes(m.emoji);
            const isMarked = reactions.includes(m.emoji);
            return (
              <ContextMenu.Item
                key={m.emoji}
                label={iconLabel(
                  <span className="tui-menu-emoji">{m.glyph}</span>,
                  isMarked ? `unmark ${m.word}` : `mark as ${m.word}`
                )}
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
            <ContextMenu.Item
              label={iconLabel(<SlackLogo />, 'open MR post in slack')}
              onClick={run(() =>
                window.open(slack.permalink!, '_blank', 'noopener')
              )}
            />
          )}
        </>
      )}
      {showSlack && !found && (
        <>
          <ContextMenu.Item
            label={iconLabel(
              <SlackLogo />,
              slack?.status === 'notfound'
                ? 'no thread, find it again'
                : 'find slack thread'
            )}
            onClick={run(() => onResolveSlack(mr))}
          />
          <ContextMenu.Item
            label={iconLabel(<SlackLogo />, 'post to slack')}
            onClick={run(() => onPostSlack(mr))}
          />
        </>
      )}
      <ContextMenu.Item
        label={iconLabel(<CopyGlyph />, 'copy for slack')}
        onClick={run(() => onCopy(mr))}
      />
      <ContextMenu.Item
        label={iconLabel(
          <NoteMenuGlyph />,
          mrx.note ? 'edit note' : 'add a note'
        )}
        onClick={run(() => ctx.onEditNote(mr.webUrl ?? null))}
      />
    </ContextMenu>
  );
}

export { RowMenu };
