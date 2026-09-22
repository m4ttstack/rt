import { useEffect, useMemo, useState } from 'react';

import type { GateDomain } from '@mattstack/gate-kit';
import { Button, Chip, Markdown, Modal, ScrollPane } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { extractTicketId, ticketUrl } from '../../ticket.ts';
import type { BoardMRWithReview, ExecutorState } from '../types.ts';
import { AttentionCard } from './AttentionCard.tsx';
import { ago, cleanTitle } from './format.ts';
import {
  parseGateContext,
  parseLabelledLines,
  sectionFor,
  type ParsedGateContext,
  type ParsedLabelledLines,
} from './gate-context.ts';
import {
  AnsweredChip,
  GateForm,
  useGateForm,
  type GateFormState,
} from './GateForm.tsx';
import { isReviewSheetGate, ReviewGateSheet } from './ReviewGateSheet.tsx';
import {
  DELIVERY_STUCK_MESSAGE,
  EXECUTION_UNASSIGNED_MESSAGE,
} from './row-status.ts';

/** The face for an answered gate the daemon's executor guarantee could not
    fully deliver: "stuck" reuses `form.focusGate()` (the same `/gate/focus`
    POST GateForm's own focus button makes) to jump into the blocked pane;
    "unassigned" reuses `form.submit` with the gate's OWN recorded answers to
    retry the relaunch the daemon gave up on -- both paths lean on
    `useGateForm`'s existing busy/error plumbing rather than a third fetch
    implementation. */
function DeliveryStatusCard({
  kind,
  gate,
  form,
}: {
  kind: 'stuck' | 'unassigned';
  gate: GateRow;
  form: GateFormState;
}) {
  const stuck = kind === 'stuck';
  return (
    <div className="tui-gate-delivery-status" data-gate-delivery-state={kind}>
      <p className="tui-gate-delivery-message">
        {stuck ? DELIVERY_STUCK_MESSAGE : EXECUTION_UNASSIGNED_MESSAGE}
      </p>
      <Button
        type="button"
        variant="filled"
        intent="warn"
        size="lg"
        disabled={stuck ? form.focusBusy : form.busy}
        onClick={() =>
          stuck
            ? void form.focusGate()
            : void form.submit({ answers: gate.answers ?? {} })
        }
      >
        {stuck ? 'focus pane' : 'retry'}
      </Button>
      {stuck && form.focusError && (
        <span className="tui-gate-error">{form.focusError}</span>
      )}
      {!stuck && form.failed && (
        <span className="tui-gate-error">
          retry failed... nothing was sent, try again
        </span>
      )}
    </div>
  );
}

/** One pip per queued gate. `skipped` gates come from the queue's local
    skip action, which advances without answering and leaves the gate (and
    its draft) untouched. */
export type TriageGateState = 'done' | 'active' | 'todo' | 'skipped';

function plural(verb: string): string {
  if (/[^aeiou]y$/.test(verb)) return `${verb.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(verb)) return `${verb}es`;
  return `${verb}s`;
}

/** A context the asker wrote as `[Label] text` lines: one small heading
    per label with its count, the findings beneath it as bullets, the
    prefixes gone. The preamble (a "Findings: ..." tally, say) leads. */
function GroupedContext({ parsed }: { parsed: ParsedLabelledLines }) {
  return (
    <div className="tui-gate-groups">
      {parsed.preamble && (
        <div className="tui-gate-groups-preamble">
          <Markdown unstyled linkTargetBlank>
            {parsed.preamble}
          </Markdown>
        </div>
      )}
      {parsed.groups.map(group => (
        <section key={group.label} className="tui-gate-group">
          <h4 className="tui-gate-group-head">
            <span className="tui-gate-group-label">{group.label}</span>
            <span className="tui-gate-group-count">{group.items.length}</span>
          </h4>
          <ul className="tui-gate-group-items">
            {group.items.map((item, i) => (
              <li key={i}>
                {/* A finding is prose the agent wrote: it can carry a link
                    or a backticked symbol, which the pane rendered before
                    the grouping existed and still has to. */}
                <Markdown unstyled linkTargetBlank>
                  {item}
                </Markdown>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One line standing in for a context the form has split onto its
    questions: the preamble, a tally of the sections' recommendations, and
    the disclosure that brings the full pane back. */
function OverviewStrip({
  parsed,
  open,
  onToggle,
}: {
  parsed: ParsedGateContext;
  open: boolean;
  onToggle: () => void;
}) {
  const tally = new Map<string, number>();
  for (const s of parsed.sections.values())
    if (s.recommendation)
      tally.set(s.recommendation, (tally.get(s.recommendation) ?? 0) + 1);
  const recommends = [...tally.entries()]
    .map(([verb, n]) => `${n} ${n === 1 ? verb : plural(verb)}`)
    .join(', ');
  return (
    <div className="tui-triage-overview">
      <span className="tui-triage-overview-title">Decision context</span>
      <span className="tui-triage-overview-text">
        {[parsed.preamble, recommends && `recommends ${recommends}`]
          .filter(Boolean)
          .join(' · ')}
      </span>
      <button
        type="button"
        className="tui-triage-overview-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        {open ? 'less ▴' : 'full text ▾'}
      </button>
    </div>
  );
}

/** The queue-hosted face of one gate: `GateForm` inside the kit Modal, with
    queue chrome around it -- the only place a gate's form actually mounts,
    since a row now shows a chip that opens this modal rather than the form
    itself. Actions keep their level: gate-level (focus pane, skip gate) sit
    on the gate strip, step-level (previous / next / submit) stay in the
    form's footer, so the footer never mixes the two. The host owns the
    queue itself (which gates join, the order, advancing on answer or skip);
    this component renders exactly one active gate of it. */
function DecisionQueueModal({
  gate,
  mr,
  position,
  states,
  nextPeek,
  onClose,
  onSkip,
  onFocusPane,
  onAnswered,
  onContinue,
  onLostChange,
}: {
  gate: GateRow & { executor?: ExecutorState };
  /** Absent for a non-MR gate (queueExtras) -- the strip and face below
      render off `gate` alone rather than crash on a missing MR. */
  mr?: BoardMRWithReview;
  /** 1-based place of the active gate in the queue. */
  position: number;
  /** One entry per queued gate, in queue order. */
  states: TriageGateState[];
  /** "!ref · title" glance at the gate after this one; omit on the last. */
  nextPeek?: string;
  onClose: () => void;
  onSkip: () => void;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
  onAnswered: () => void;
  onContinue: () => void;
  /** Fires when the CAS-loss face flips on or off, so the host can hold the
      queue on this gate while it's showing. */
  onLostChange?: (lost: boolean) => void;
}) {
  const form = useGateForm(gate, onAnswered);
  const paneGone = gate.executor === 'gone';
  // Only a context the questions actually pick up collapses to the strip;
  // sections that match no question (a per-option split, say) stay in the
  // pane where they can be read.
  const sectioned = useMemo(() => {
    const parsed = parseGateContext(gate.context);
    return parsed &&
      gate.questions.some(q => sectionFor(parsed, { id: q.id, label: q.label }))
      ? parsed
      : null;
  }, [gate.context, gate.questions]);
  const [fullContext, setFullContext] = useState(false);
  // The grouped pane is a parse of the text, not the text: the toggle in
  // its head brings the asker's own words back, so nothing the parse
  // dropped is ever out of reach.
  const [rawContext, setRawContext] = useState(false);
  useEffect(() => {
    setFullContext(false);
    setRawContext(false);
  }, [gate.gateId]);
  // B9: a context that is nothing but `[Label] text` lines is a list the
  // asker grouped by hand; the pane renders the groups instead of making
  // every line carry its own prefix. Only when no question already owns
  // the context (B7), which is the richer reading of the same blob.
  const grouped = useMemo(
    () => (sectioned ? null : parseLabelledLines(gate.context)),
    [sectioned, gate.context]
  );
  const answered = gate.status === 'answered';
  const actionable = gate.status === 'open' || gate.status === 'parked';
  const deliveryStuck = answered && gate.delivery?.outcome === 'stuck';
  const executionUnassigned = answered && gate.execution === 'unassigned';

  useEffect(() => {
    onLostChange?.(form.lost !== null);
  }, [form.lost, onLostChange]);

  // `actionable` also keeps a stuck/unassigned-delivery review-post gate on
  // DeliveryStatusCard: the sheet has no face for retrying a stored answer,
  // only for building a fresh one.
  if (isReviewSheetGate(gate) && actionable) {
    return (
      <ReviewGateSheet
        gate={gate}
        mr={mr}
        form={form}
        queue={{
          index: position - 1,
          total: states.length,
          states,
          // The queue only ever advances (skip or answer); there is no
          // backward traversal to wire the previous chevron to, so it is
          // inert rather than skipping a gate the reviewer meant to revisit.
          onPrev: () => {},
          onNext: onSkip,
        }}
        onClose={onClose}
        onSkip={onSkip}
        onFocusPane={onFocusPane}
      />
    );
  }

  return (
    <Modal
      className="tui-triage-modal"
      title={<>decision queue</>}
      ariaLabel="decision queue"
      onClose={onClose}
      closeGlyph="✕"
    >
      <div className="tui-triage-queue-row">
        <span className="tui-triage-head-actions">
          {/* A parked gate has no pane: the board closed it on park, and the
              recorded answer is what brings it back (resumeParkedGate). The
              button stays so the head never rearranges, disabled with the
              reason, as it is when the reconciler reports the pane gone. */}
          {gate.status === 'parked' ? (
            <Button
              type="button"
              variant="light"
              intent="accent"
              size="lg"
              disabled
              title="parked: answering this gate resumes its pane"
            >
              focus pane
            </Button>
          ) : (
            <Button
              type="button"
              variant="light"
              intent="accent"
              size="lg"
              disabled={!form.originFocusable || form.focusBusy || paneGone}
              title={
                paneGone
                  ? 'pane is gone'
                  : form.originFocusable
                    ? 'jump into the pane behind this gate'
                    : 'no origin on this gate'
              }
              onClick={() => void form.focusGate()}
            >
              focus pane
            </Button>
          )}
          <Button
            type="button"
            variant="light"
            intent="muted"
            size="lg"
            onClick={onSkip}
          >
            skip gate
          </Button>
        </span>
      </div>
      <div className="tui-triage-strip">
        <div className="tui-triage-row-1">
          {mr ? (
            <>
              <span className="tui-title">{cleanTitle(mr.title)}</span>
              {mr.sourceBranch &&
                extractTicketId(mr.sourceBranch, mr.title) && (
                  <a
                    className="tui-ticket"
                    href={ticketUrl(
                      extractTicketId(mr.sourceBranch, mr.title)!
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`open ${extractTicketId(mr.sourceBranch, mr.title)} in Linear`}
                  >
                    {extractTicketId(mr.sourceBranch, mr.title)}
                  </a>
                )}
              <span className="tui-triage-kind">{gate.label}</span>
            </>
          ) : (
            <span className="tui-title">{gate.label}</span>
          )}
          {gate.status === 'parked' && (
            <Chip intent="warn" variant="outline" uppercase data-gate="parked">
              parked
            </Chip>
          )}
          {gate.escalatedAt != null && (
            <Chip
              intent="warn"
              variant="outline"
              uppercase
              data-gate="escalated"
            >
              escalated
            </Chip>
          )}
        </div>
        <div className="tui-row-2">
          {mr ? (
            <>
              {mr.author && (
                <span className="tui-author-tag">
                  {mr.author.name || mr.author.username}
                </span>
              )}
              <span className="tui-mr-iid">!{mr.iid}</span>
              <span className="tui-row-sep">|</span>
              {mr.sourceBranch && (
                <span className="tui-branch">{mr.sourceBranch}</span>
              )}
            </>
          ) : (
            <span className="tui-subject">{gate.subject}</span>
          )}
          <span className="tui-row-sep">·</span>
          <span>{ago(new Date(gate.openedAt).toISOString(), Date.now())}</span>
          {gate.origin && (
            // Panes pass the worktree as a full path; the strip shows only
            // its basename (the full value stays on hover).
            <span title={gate.origin.worktree}>
              {[
                gate.origin.worktree?.split('/').filter(Boolean).pop(),
                gate.origin.paneId,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
        </div>
      </div>
      {(() => {
        const face =
          deliveryStuck || executionUnassigned ? (
            <DeliveryStatusCard
              kind={deliveryStuck ? 'stuck' : 'unassigned'}
              gate={gate}
              form={form}
            />
          ) : answered || !actionable ? (
            <AnsweredChip
              row={{
                subject: gate.subject,
                kind: gate.kind,
                status: gate.status,
                questions: gate.questions,
                answer: gate.answers
                  ? {
                      answers: gate.answers,
                      by: gate.answeredBy,
                      answeredAt: gate.answeredAt,
                    }
                  : null,
              }}
            />
          ) : form.lost ? (
            <>
              <div className="tui-gate-error">answered elsewhere</div>
              <AnsweredChip
                startOpen
                row={{
                  subject: gate.subject,
                  kind: gate.kind,
                  status: 'answered',
                  questions: gate.questions,
                  answer: { answers: form.lost.answers, by: form.lost.by },
                }}
              />
              <Button
                type="button"
                variant="filled"
                intent="accent"
                size="lg"
                onClick={onContinue}
              >
                continue
              </Button>
            </>
          ) : gate.kind === 'pane-attention' ? (
            <AttentionCard
              gate={gate}
              form={form}
              mr={mr}
              onFocusPane={onFocusPane}
            />
          ) : (
            <GateForm
              gate={gate}
              mr={mr}
              form={form}
              onFocusPane={onFocusPane}
              showFocusAction={false}
              showContextFallback={false}
            />
          );
        // The modal exists to give context room: unlike the row card's
        // collapsed disclosure, context renders open, above the form. A
        // context the form has already split onto its questions (B7)
        // collapses to a one-line strip instead; the disclosure brings the
        // pane back.
        return (
          <div className="tui-triage-body">
            {gate.context && sectioned && (
              <OverviewStrip
                parsed={sectioned}
                open={fullContext}
                onToggle={() => setFullContext(v => !v)}
              />
            )}
            {gate.context && (!sectioned || fullContext) && (
              <ScrollPane
                title={
                  grouped ? (
                    <>
                      Decision context
                      <span className="tui-gate-groups-total">
                        {grouped.total} findings
                      </span>
                      <button
                        type="button"
                        className="tui-gate-groups-raw"
                        aria-pressed={rawContext}
                        onClick={() => setRawContext(v => !v)}
                      >
                        {rawContext ? 'grouped' : 'as written'}
                      </button>
                    </>
                  ) : (
                    'Decision context'
                  )
                }
                maxHeight="46vh"
              >
                {grouped && !rawContext ? (
                  <GroupedContext parsed={grouped} />
                ) : (
                  <Markdown unstyled linkTargetBlank>
                    {gate.context}
                  </Markdown>
                )}
              </ScrollPane>
            )}
            <div className="tui-triage-form-col">{face}</div>
          </div>
        );
      })()}
      <div className="tui-triage-footer">
        <div className="tui-triage-peek">
          {nextPeek && (
            <>
              <span className="tui-triage-peek-k">next:</span>
              <span>{nextPeek}</span>
            </>
          )}
        </div>
        <span className="tui-triage-pips">
          {states.map((state, i) => (
            <i key={i} className="tui-triage-pip" data-state={state} />
          ))}
        </span>
        <span className="tui-triage-pos">
          gate {position} of {states.length}
        </span>
      </div>
    </Modal>
  );
}

/** The queue's terminal face, shown once no gate is left active. */
function DecisionQueueComplete({
  answered,
  skipped,
  onClose,
}: {
  answered: number;
  skipped: number;
  onClose: () => void;
}) {
  return (
    <Modal
      className="tui-triage-modal"
      title="decision queue"
      ariaLabel="decision queue complete"
      onClose={onClose}
      closeGlyph="✕"
    >
      <div className="tui-triage-done">
        <span className="tui-triage-done-line">no gates left in the queue</span>
        <span className="tui-triage-done-counts">
          {answered} answered{skipped > 0 && ` · ${skipped} skipped`}
        </span>
        <Button
          type="button"
          className="tui-triage-done-action"
          variant="filled"
          intent="accent"
          size="lg"
          onClick={onClose}
        >
          done
        </Button>
      </div>
    </Modal>
  );
}

export { DecisionQueueComplete, DecisionQueueModal };
