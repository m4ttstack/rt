import { useState } from "react";
import { Chip, RadioGroup, SelectBox } from "@mattstack/tui-kit";
import type { GateAnswers, GateOption, GateQuestion, GateRow } from "../../gates/store.ts";
import type { BoardMRWithReview } from "../types.ts";
import {
  gateAnswerPayload,
  parseConflictResponse,
  unwrapGateAnswer,
  optionValue,
  optionDisplayFor,
  displayForValue,
  codeChangesHidden,
  CODE_CHANGES_QUESTION_ID,
  CODE_CHANGES_SENTINEL,
  type GateSelections,
  type GateDomain,
} from "./gate-format.ts";
import { Disclosure, DisclosureHead } from "./Disclosure.tsx";

/** An option as it should read on screen -- a labeled option's label, a
    bare string's verb-token transform, both with the full value kept in
    `title` for anyone who hovers. Shared by the question inputs and the
    answered summary so the same option always reads the same way in both
    places. */
function GateOptionText({ option }: { option: GateOption }) {
  const { text, title } = optionDisplayFor(option);
  return <span title={title}>{text}</span>;
}

/** One question's input: a SelectBox per option for a `multi` question (a
    checkbox group -- the same toggle recipe the row's own select-box uses),
    a RadioGroup for a single-select. */
function GateQuestionField({
  question,
  value,
  onChange,
}: {
  question: GateQuestion;
  value: string | string[] | undefined;
  onChange: (id: string, value: string | string[]) => void;
}) {
  if (question.multi) {
    const picked = new Set(Array.isArray(value) ? value : []);
    const toggle = (val: string) => {
      const next = new Set(picked);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      onChange(question.id, [...next]);
    };
    return (
      <div className="tui-gate-question">
        <div className="tui-gate-question-label">{question.label}</div>
        <div className="tui-gate-options">
          {question.options.map((opt) => {
            const value = optionValue(opt);
            return (
              <div key={value} className="tui-gate-option">
                <SelectBox checked={picked.has(value)} onToggle={() => toggle(value)} aria-label={value} />
                <span className="tui-gate-option-label" onClick={() => toggle(value)}>
                  <GateOptionText option={opt} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="tui-gate-question">
      <div className="tui-gate-question-label">{question.label}</div>
      <RadioGroup
        name={question.id}
        value={typeof value === "string" ? value : ""}
        onChange={(v) => onChange(question.id, v)}
        options={question.options.map((opt) => ({ value: optionValue(opt), label: <GateOptionText option={opt} /> }))}
      />
    </div>
  );
}

/** One answered value, resolved back to its option's label (or the raw
    verb-token transform when no option matches -- see displayForValue). */
function Answered({ value, options }: { value: string; options: GateOption[] }) {
  const { text, title } = displayForValue(value, options);
  return <span title={title}>{text}</span>;
}

/** The answered branch: what got chosen, read-only -- no inputs, nothing to
    resubmit. A question missing from `answers` (an older or malformed gate
    file) shows a placeholder rather than throwing. A value may be the bare
    option string/array or the wrapper's `{value, note}` note form -- unwrap
    before rendering, or React throws on the object child. */
function GateAnswerSummary({ questions, answers }: { questions: GateQuestion[]; answers?: GateAnswers }) {
  return (
    <dl className="tui-gate-summary">
      {questions.map((q) => {
        const raw = answers?.[q.id];
        const { value, note } = raw !== undefined ? unwrapGateAnswer(raw) : { value: undefined, note: undefined };
        const text = Array.isArray(value)
          ? value.length
            ? value.map((v, i) => (
                <span key={v}>
                  {i > 0 && ", "}
                  <Answered value={v} options={q.options} />
                </span>
              ))
            : "(none)"
          : value
            ? <Answered value={value} options={q.options} />
            : "(none)";
        return (
          <div key={q.id} className="tui-gate-summary-row">
            <dt>{q.label}</dt>
            <dd>
              {text}
              {note && <div className="tui-gate-summary-note">{note}</div>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Renders one gate a review/respond/doctor pane opened on this MR's row.
    `open` and `parked` are both actionable -- the same question inputs and
    submit button render for either, `parked` additionally wears a badge
    since a pane is no longer waiting on it. `answered` swaps to a read-only
    summary.

    No optimistic local state on a successful submit: the request either
    fails (shown inline, same recover-by-retry shape as DraftModal) or
    succeeds and the board's existing SSE-driven poll flips this gate's
    status on its own next refresh, at which point this component re-renders
    into the answered branch on its own. A 409 is the one response rendered
    immediately from local state -- it's not a guess, the daemon's CAS
    already recorded someone else's answer and handed back the real winner.

    The focus button takes two paths: a `parked` gate keeps resuming its
    domain's whole flow in a fresh pane via `onFocusPane`/`gate.domain` (the
    facility has already released this gate's original pane); an `open` gate
    jumps straight into its own still-live origin pane via `/gate/focus`,
    disabled with a reason when no origin resolves to a live pane. */
function GateCard({
  gate,
  mr,
  onFocusPane,
}: {
  gate: GateRow;
  mr: BoardMRWithReview;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
}) {
  const [selections, setSelections] = useState<GateSelections>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState<{ answers: GateAnswers; by: string } | null>(null);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);

  const setAnswer = (id: string, value: string | string[]) => {
    setSelections((prev) => ({ ...prev, [id]: value }));
  };

  const answered = gate.status === "answered";
  const actionable = gate.status === "open" || gate.status === "parked";
  const hidden = actionable && codeChangesHidden(gate.kind, gate.questions, selections);
  const effective = hidden ? { ...selections, [CODE_CHANGES_QUESTION_ID]: CODE_CHANGES_SENTINEL } : selections;
  const payload = actionable
    ? gateAnswerPayload({ gateId: gate.gateId, questions: gate.questions }, effective)
    : null;
  const originFocusable = Boolean(gate.origin?.paneId || gate.origin?.worktree);
  const focusGate = async () => {
    setFocusBusy(true);
    setFocusError(null);
    try {
      const res = await fetch("/gate/focus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gateId: gate.gateId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setFocusError(body?.error ?? `focus failed (${res.status})`);
      }
    } catch {
      setFocusError("focus failed");
    } finally {
      setFocusBusy(false);
    }
  };

  const submit = async () => {
    if (!payload) return;
    setBusy(true);
    setFailed(false);
    setConflict(null);
    try {
      const res = await fetch("/gate/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        // An answer WAS recorded, just not this one -- the body carries the
        // winning row, not a validation failure to retry.
        setBusy(false);
        setConflict(parseConflictResponse(await res.json().catch(() => null)));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setBusy(false);
      setFailed(true);
      return;
    }
    setBusy(false);
  };

  return (
    // Clicks anywhere in here (a radio's own <label>, the checkbox text)
    // aren't inside an `a`/`button` closest() would catch, so they'd
    // otherwise bubble to the row's onRowClick and open the MR in GitLab.
    <div className="tui-gate-card" onClick={(e) => e.stopPropagation()}>
      <div className="tui-gate-head">
        <span className="tui-gate-title">{gate.label}</span>
        {gate.status === "parked" && (
          <Chip intent="warn" variant="outline" uppercase data-gate="parked">
            parked
          </Chip>
        )}
        {(answered || conflict) && (
          <Chip intent="ok" variant="outline" uppercase data-gate="answered">
            answered
          </Chip>
        )}
      </div>
      {gate.context && (
        <div className="tui-gate-context">
          <DisclosureHead open={ctxOpen} label="context" onToggle={() => setCtxOpen((o) => !o)}>
            context
          </DisclosureHead>
          <Disclosure open={ctxOpen}>
            <pre className="tui-gate-context-body">{gate.context}</pre>
          </Disclosure>
        </div>
      )}
      {answered ? (
        <GateAnswerSummary questions={gate.questions} answers={gate.answers} />
      ) : conflict ? (
        <>
          <div className="tui-gate-error">answered elsewhere</div>
          <GateAnswerSummary questions={gate.questions} answers={conflict.answers} />
        </>
      ) : (
        <>
          {gate.questions
            .filter((q) => !(hidden && q.id === CODE_CHANGES_QUESTION_ID))
            .map((q) => (
              <GateQuestionField key={q.id} question={q} value={selections[q.id]} onChange={setAnswer} />
            ))}
          <div className="tui-gate-actions">
            {failed && <span className="tui-gate-error">submit failed... nothing was sent, try again</span>}
            {focusError && <span className="tui-gate-error">{focusError}</span>}
            {gate.status === "parked" ? (
              gate.domain && (
                <button
                  type="button"
                  className="tui-gate-focus"
                  title="resume this gate's flow in a fresh pane"
                  onClick={() => onFocusPane(mr, gate.domain!)}
                >
                  focus pane
                </button>
              )
            ) : (
              <button
                type="button"
                className="tui-gate-focus"
                disabled={!originFocusable || focusBusy}
                title={originFocusable ? "jump into the pane behind this gate" : "no origin on this gate"}
                onClick={() => void focusGate()}
              >
                focus pane
              </button>
            )}
            <button className="tui-gate-submit" disabled={!payload || busy} onClick={submit}>
              {busy ? "submitting…" : "submit"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export { GateCard };
