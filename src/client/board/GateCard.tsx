import { useState } from "react";
import type { BoardMRWithReview } from "../types.ts";
import { Chip, RadioGroup, SelectBox } from "@mattstack/tui-kit";
import type { GateAnswers, GateQuestion } from "../../gates/store.ts";
import { gateAnswerPayload, parseConflictResponse, unwrapGateAnswer, type GateSelections } from "./gate-format.ts";

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
    const toggle = (opt: string) => {
      const next = new Set(picked);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      onChange(question.id, [...next]);
    };
    return (
      <div className="tui-gate-question">
        <div className="tui-gate-question-label">{question.label}</div>
        <div className="tui-gate-options">
          {question.options.map((opt) => (
            <div key={opt} className="tui-gate-option">
              <SelectBox checked={picked.has(opt)} onToggle={() => toggle(opt)} aria-label={opt} />
              <span className="tui-gate-option-label" onClick={() => toggle(opt)}>
                {opt}
              </span>
            </div>
          ))}
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
        options={question.options.map((opt) => ({ value: opt, label: opt }))}
      />
    </div>
  );
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
        const text = Array.isArray(value) ? (value.length ? value.join(", ") : "(none)") : value || "(none)";
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

/** Renders the review gate a review pane opened on this MR's row, when one
    is open. `open` and `parked` are both actionable -- the same question
    inputs and submit button render for either, `parked` additionally wears
    a badge since a pane is no longer waiting on it. `answered` swaps to a
    read-only summary.

    No optimistic local state on a successful submit: the request either
    fails (shown inline, same recover-by-retry shape as DraftModal) or
    succeeds and the board's existing SSE-driven poll flips `mr.gate.status`
    on its own next refresh, at which point this component re-renders into
    the answered branch on its own. A 409 is the one response rendered
    immediately from local state -- it's not a guess, the daemon's CAS
    already recorded someone else's answer and handed back the real winner. */
function GateCard({ mr }: { mr: BoardMRWithReview }) {
  const gate = mr.gate;
  const [selections, setSelections] = useState<GateSelections>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState<{ answers: GateAnswers; by: string } | null>(null);
  if (!gate) return null;

  const setAnswer = (id: string, value: string | string[]) => {
    setSelections((prev) => ({ ...prev, [id]: value }));
  };

  const answered = gate.status === "answered";
  const actionable = gate.status === "open" || gate.status === "parked";
  const payload = actionable && mr.webUrl ? gateAnswerPayload({ mrUrl: mr.webUrl, questions: gate.questions }, selections) : null;

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
        <span className="tui-gate-title">review gate</span>
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
      {answered ? (
        <GateAnswerSummary questions={gate.questions} answers={gate.answers} />
      ) : conflict ? (
        <>
          <div className="tui-gate-error">answered elsewhere</div>
          <GateAnswerSummary questions={gate.questions} answers={conflict.answers} />
        </>
      ) : (
        <>
          {gate.questions.map((q) => (
            <GateQuestionField key={q.id} question={q} value={selections[q.id]} onChange={setAnswer} />
          ))}
          <div className="tui-gate-actions">
            {failed && <span className="tui-gate-error">submit failed... nothing was sent, try again</span>}
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
