import { useEffect, useMemo, useRef, useState } from 'react';

import {
  collapseChunks,
  displayForValue,
  optionDescription,
  optionDisplayFor,
  optionValue,
  splitChunkSelections,
  type GateAnswers,
  type GateDomain,
  type GateOption,
  type GateQuestion,
} from '@mattstack/gate-kit';
import { Button, Chip, Markdown } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { Disclosure, DisclosureHead } from './Disclosure.tsx';
import type { Disposition, FindingEntry, FindingSeverity } from './gate-ctx.ts';
import type { GateFormState } from './GateForm.tsx';
import { GateSheet, type GateSheetQueue } from './GateSheet.tsx';
import {
  CircleCheckFilledIcon,
  PencilLineIcon,
  SearchCheckIcon,
} from './icons.tsx';
import { MrCard } from './MrCard.tsx';
import {
  readinessProse,
  readReviewGate,
  reviewMeta,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
} from './review-gate.ts';
import { reserveDock, SheetLost } from './SheetParts.tsx';

/** The engine's optional record fields (`docs/superpowers/specs/
    2026-09-18-review-gate-redesign-design.md` §1): all absent on a report
    that only carries `summary`/`findings`, in which case the sheet falls
    back to the raw markdown instead of an empty cluster. */
interface ReviewReportJson {
  depth?: string;
  strengths?: Array<{ lead: string; detail?: string }>;
  checks?: Array<{ tag: string; text: string }>;
  notes?: string[];
}

/** report.json arrives from disk unvalidated; the record arrays each have
    their own safe* guard at render, and `depth` lands in JSX directly, so
    a non-string one is dropped here. */
function sanitizeReport(j: unknown): ReviewReportJson | null {
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return null;
  const raw = j as Record<string, unknown>;
  const out: ReviewReportJson = { ...(raw as ReviewReportJson) };
  if (typeof raw['depth'] !== 'string') delete out.depth;
  return out;
}

/** The engine's own emission and hand-edits of report.json both land here
    unvalidated, so every optional field is guarded at its actual shape
    (not just presence) before it reaches JSX: an entry a React child can't
    render (an object, a wrong-typed leaf) is dropped rather than thrown. */
function safeStrengths(
  report: ReviewReportJson | null
): Array<{ lead: string; detail?: string }> {
  if (!report || !Array.isArray(report.strengths)) return [];
  return report.strengths.filter(
    (s): s is { lead: string; detail?: string } =>
      Boolean(s) && typeof s.lead === 'string'
  );
}

function safeChecks(
  report: ReviewReportJson | null
): Array<{ tag: string; text: string }> {
  if (!report || !Array.isArray(report.checks)) return [];
  return report.checks.filter(
    (c): c is { tag: string; text: string } =>
      Boolean(c) && typeof c.tag === 'string' && typeof c.text === 'string'
  );
}

function safeNotes(report: ReviewReportJson | null): string[] {
  if (!report || !Array.isArray(report.notes)) return [];
  return report.notes.filter((n): n is string => typeof n === 'string');
}

function safeDepth(report: ReviewReportJson | null): string | undefined {
  return report && typeof report.depth === 'string' && report.depth
    ? report.depth
    : undefined;
}

/** Checks are rail material only (the CHECKS card), never part of the main
    column's record cluster, so they don't count toward whether that cluster
    has anything to show. */
function hasRecord(report: ReviewReportJson | null): boolean {
  if (!report) return false;
  return Boolean(
    safeDepth(report) ||
    safeStrengths(report).length > 0 ||
    safeNotes(report).length > 0
  );
}

/** Fallback for a report with no optional record fields (or none reachable
    at all): the review's prose is never unreachable, it just costs an extra
    click. Same fetch/render shape as ReviewModal's report fetch. */
function FullReportDisclosure({ mrUrl }: { mrUrl?: string | null }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || body !== null || failed || !mrUrl) return;
    let live = true;
    fetch(`/review/report?mr=${encodeURIComponent(mrUrl)}`)
      .then(r =>
        r.ok ? r.text() : Promise.reject(new Error(String(r.status)))
      )
      .then(t => live && setBody(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [open, mrUrl, body, failed]);
  return (
    <div className="tui-review-full-report">
      <DisclosureHead
        open={open}
        label="full report"
        onToggle={() => setOpen(o => !o)}
      >
        <span className="tui-review-full-report-label">full report</span>
      </DisclosureHead>
      <Disclosure open={open}>
        {failed ? (
          <p className="tui-comments-empty">couldn't load the full report</p>
        ) : body === null ? (
          <p className="tui-comments-empty">loading…</p>
        ) : (
          <Markdown unstyled linkTargetBlank>
            {body}
          </Markdown>
        )}
      </Disclosure>
    </div>
  );
}

/** The collapsed multi's checked union, e.g. `{ findings: [...] }` -- the
    only array-valued answer on this form -- ready for
    `splitChunkSelections`'s per-chunk `Record<string, string[]>` input. */
function pickMultis(answers: GateAnswers): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(answers))
    if (Array.isArray(value)) out[key] = value;
  return out;
}

/** Every non-array answer (the outcome, bare or `{value, note}`) untouched. */
function singles(answers: GateAnswers): GateAnswers {
  const out: GateAnswers = {};
  for (const [key, value] of Object.entries(answers))
    if (!Array.isArray(value)) out[key] = value;
  return out;
}

const DISPOSITION: Record<
  Disposition,
  { text: string; hue: 'accent' | 'amber' | 'green' }
> = {
  new: { text: 'new', hue: 'accent' },
  'still-open': { text: 'still open', hue: 'amber' },
  'addressed-check': { text: 'confirm fix', hue: 'green' },
};

function severityGroups(
  findings: FindingEntry[]
): Array<[FindingSeverity, FindingEntry[]]> {
  return SEVERITY_ORDER.map(
    s =>
      [s, findings.filter(f => f.severity === s)] as [
        FindingSeverity,
        FindingEntry[],
      ]
  ).filter(([, items]) => items.length > 0);
}

/** The full-screen sheet a `review-post` gate opens (design doc §4). Header
    carries queue chrome; the main column is the findings and the optional
    record cluster; the rail is the MR card, decision context and checks,
    over the pinned verdict dock. Selection state keys by the COLLAPSED question ids
    (`collapseChunks`), so a fresh gate defaults to every finding checked and
    the recommended verdict picked -- the reviewer opts OUT rather than in. */
function ReviewGateSheet({
  gate,
  mr,
  form,
  queue,
  onClose,
  onContinue,
  onFocusPane,
}: {
  gate: GateRow;
  mr?: BoardMRWithReview;
  form: GateFormState;
  queue: GateSheetQueue;
  onClose: () => void;
  /** Retires a gate answered elsewhere from the queue. */
  onContinue: () => void;
  onFocusPane: (mr: BoardMRWithReview, domain: GateDomain) => void;
}) {
  const { questions, groups } = useMemo(
    () => collapseChunks(gate.questions),
    [gate.questions]
  );
  const data = useMemo(() => readReviewGate(gate), [gate]);
  const findingsQuestion = useMemo<GateQuestion | undefined>(
    () => questions.find(q => q.multi && q.id === 'findings'),
    [questions]
  );
  const outcomeQuestion = useMemo<GateQuestion | undefined>(
    () => questions.find(q => !q.multi),
    [questions]
  );
  const findingsName = findingsQuestion?.id;
  const outcomeName = outcomeQuestion?.id;

  const findings = useMemo<FindingEntry[]>(
    () =>
      (findingsQuestion?.options ?? []).flatMap(o => {
        const f = data?.findings.get(optionValue(o));
        return f ? [f] : [];
      }),
    [findingsQuestion, data]
  );
  const tierGroups = useMemo(() => severityGroups(findings), [findings]);
  const isRecommended = (o: GateOption) =>
    Boolean(optionDisplayFor(o).recommended);

  // A fresh gate (or an explicit reset) proposes posting everything with the
  // recommended verdict; the reviewer unchecks rather than builds the set
  // from nothing. `force` skips the per-key "already touched" guard, since
  // a reset just cleared every key and wants them rewritten unconditionally.
  const seedDefaults = (force: boolean) => {
    if (
      findingsName &&
      (force || form.selections[findingsName] === undefined)
    ) {
      for (const f of findings) form.toggleMulti(findingsName, f.id, true);
    }
    if (
      outcomeName &&
      outcomeQuestion &&
      (force || form.selections[outcomeName] === undefined)
    ) {
      const recommended = outcomeQuestion.options.find(isRecommended);
      const fallback = recommended ?? outcomeQuestion.options[0];
      if (fallback) form.setSingle(outcomeName, optionValue(fallback));
    }
  };
  // Only seeds a key that has never been touched (no draft, no prior
  // toggle), so a resumed selection is never overwritten.
  useEffect(() => {
    seedDefaults(false);
    // Seeds once per gate; toggleMulti/setSingle are stable-enough setState
    // wrappers and re-running on their identity would fight the seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.gateId]);

  const handleReset = () => {
    form.resetAll();
    seedDefaults(true);
  };

  const selectedFindings = useMemo(() => {
    const current = findingsName ? form.selections[findingsName] : undefined;
    return new Set(Array.isArray(current) ? current : []);
  }, [form.selections, findingsName]);
  const selectedOutcome = outcomeName
    ? form.selections[outcomeName]
    : undefined;
  const outcomeText =
    outcomeQuestion && typeof selectedOutcome === 'string'
      ? displayForValue(selectedOutcome, outcomeQuestion.options).text
      : '';
  const outcomeNote = outcomeName ? (form.notes[outcomeName] ?? '') : '';

  const [report, setReport] = useState<ReviewReportJson | null>(null);
  useEffect(() => {
    let live = true;
    setReport(null);
    if (!mr?.webUrl) return;
    fetch(`/review/report.json?mr=${encodeURIComponent(mr.webUrl)}`)
      .then(r =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status)))
      )
      .then(j => live && setReport(sanitizeReport(j)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mr?.webUrl]);
  const record = hasRecord(report);
  const strengths = useMemo(() => safeStrengths(report), [report]);
  const checks = useMemo(() => safeChecks(report), [report]);
  const notes = useMemo(() => safeNotes(report), [report]);
  const depth = safeDepth(report);

  const mainRef = useRef<HTMLElement | null>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [moreBelow, setMoreBelow] = useState(0);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    // Rect-to-rect, not offsetTop-to-scrollTop: offsetTop is relative to the
    // nearest positioned ancestor, which is not necessarily this scroll
    // container, so mixing it with scrollTop/clientHeight silently drifts
    // once any row's offsetParent differs from `el`.
    const measure = () => {
      const box = el.getBoundingClientRect();
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      setAtEnd(remaining <= 1);
      const rows = el.querySelectorAll<HTMLElement>('.tui-review-finding-row');
      let below = 0;
      rows.forEach(row => {
        if (row.getBoundingClientRect().top >= box.bottom) below++;
      });
      setMoreBelow(below);
    };
    measure();
    el.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [findings.length, report]);

  const toggleTier = (items: FindingEntry[], on: boolean) => {
    if (!findingsName) return;
    for (const f of items) form.toggleMulti(findingsName, f.id, on);
  };

  const submit = () => {
    if (!outcomeName || typeof selectedOutcome !== 'string') return;
    const trimmedNote = outcomeNote.trim();
    const answers: GateAnswers = {
      ...(findingsName ? { [findingsName]: [...selectedFindings] } : {}),
      [outcomeName]:
        trimmedNote.length > 0
          ? { value: selectedOutcome, note: trimmedNote }
          : selectedOutcome,
    };
    void form.submit({ answers }, submitted => {
      const multis = pickMultis(submitted);
      return {
        ...Object.fromEntries(
          Object.entries(multis).filter(([id]) => !groups.has(id))
        ),
        ...splitChunkSelections(groups, gate.questions, multis),
        ...singles(submitted),
      };
    });
  };

  const parked = gate.status === 'parked';

  if (!data) return null;
  const { review } = data;
  const meta = reviewMeta(review);

  return (
    <GateSheet
      variant="review"
      ariaLabel="review gate"
      actions={
        <Button
          type="button"
          variant="light"
          intent="accent"
          size="sm"
          disabled={
            parked
              ? !(gate.domain && mr)
              : !form.originFocusable || form.focusBusy
          }
          onClick={() =>
            parked
              ? gate.domain && mr && onFocusPane(mr, gate.domain)
              : void form.focusGate()
          }
        >
          focus pane
        </Button>
      }
      queue={queue}
      tag={`review gate${mr ? ` !${mr.iid}` : ''}`}
      onClose={onClose}
    >
      <div className="tui-sheet-body">
        <section className="tui-sheet-main" ref={mainRef}>
          {findingsQuestion && (
            <>
              <div className="tui-sheet-list-head">
                <span className="tui-sheet-list-title">
                  {findingsQuestion.label}
                </span>
                <span className="tui-sheet-list-tally">
                  {selectedFindings.size} of {findings.length} selected
                  {!atEnd && moreBelow > 0 ? ` · ${moreBelow} more below` : ''}
                </span>
              </div>
              <div
                className="tui-review-find-list"
                data-at-end={atEnd || undefined}
              >
                {tierGroups.map(([tier, items]) => {
                  const allOn = items.every(f => selectedFindings.has(f.id));
                  const allOff = items.every(f => !selectedFindings.has(f.id));
                  return (
                    <div className="tui-review-tier-group" key={tier}>
                      <div className="tui-review-tier-head">
                        <span
                          className="tui-review-tier-pill"
                          data-tier={SEVERITY_LABEL[tier]}
                        >
                          {SEVERITY_LABEL[tier]} ({items.length})
                        </span>
                        <span className="tui-review-allnone-group">
                          <button
                            type="button"
                            className="tui-review-allnone"
                            data-noop={allOn || undefined}
                            onClick={() => toggleTier(items, true)}
                          >
                            all
                          </button>
                          <span
                            className="tui-review-allnone-sep"
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <button
                            type="button"
                            className="tui-review-allnone"
                            data-noop={allOff || undefined}
                            onClick={() => toggleTier(items, false)}
                          >
                            none
                          </button>
                        </span>
                      </div>
                      {items.map(f => {
                        const checked = selectedFindings.has(f.id);
                        return (
                          <label className="tui-review-finding-row" key={f.id}>
                            <input
                              type="checkbox"
                              className="tui-gate-choice-input"
                              data-type="checkbox"
                              data-checked={checked ? '' : undefined}
                              checked={checked}
                              aria-labelledby={`tui-review-finding-title-${f.id}`}
                              onChange={e =>
                                findingsName &&
                                form.toggleMulti(
                                  findingsName,
                                  f.id,
                                  e.currentTarget.checked
                                )
                              }
                            />
                            <span className="tui-review-finding-body">
                              <span className="tui-review-finding-line1">
                                <span
                                  className="tui-review-finding-title"
                                  id={`tui-review-finding-title-${f.id}`}
                                >
                                  {f.title}
                                </span>
                                {f.disposition && (
                                  <span
                                    className="tui-respond-pill"
                                    data-hue={DISPOSITION[f.disposition].hue}
                                    data-disposition={f.disposition}
                                  >
                                    {DISPOSITION[f.disposition].text}
                                  </span>
                                )}
                              </span>
                              {f.file && (
                                <span className="tui-review-finding-anchor">
                                  {f.file}
                                </span>
                              )}
                              <span className="tui-review-finding-text">
                                <Markdown unstyled linkTargetBlank>
                                  {f.body}
                                </Markdown>
                              </span>
                              {f.fix && (
                                <span className="tui-review-finding-fix">
                                  {f.fix}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <hr className="tui-review-divider" />
          {record ? (
            <dl className="tui-review-record">
              {strengths.length > 0 && (
                <div className="tui-review-record-row">
                  <dt className="tui-review-record-label">strengths</dt>
                  <dd className="tui-review-record-content">
                    {strengths.map((s, i) => (
                      <div className="tui-review-record-item" key={i}>
                        <span className="tui-review-record-icon tui-review-record-icon-ok">
                          <CircleCheckFilledIcon />
                        </span>
                        <span className="tui-review-record-stack">
                          <span className="tui-review-record-lead">
                            {s.lead}
                          </span>
                          {typeof s.detail === 'string' && s.detail && (
                            <span className="tui-review-record-detail">
                              {s.detail}
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
              {depth && (
                <div className="tui-review-record-row">
                  <dt className="tui-review-record-label">depth</dt>
                  <dd className="tui-review-record-content">
                    <div className="tui-review-record-item">
                      <span className="tui-review-record-icon">
                        <SearchCheckIcon />
                      </span>
                      <span>{depth}</span>
                    </div>
                  </dd>
                </div>
              )}
              {notes.length > 0 && (
                <div className="tui-review-record-row">
                  <dt className="tui-review-record-label">notes</dt>
                  <dd className="tui-review-record-content">
                    {notes.map((n, i) => (
                      <div className="tui-review-record-item" key={i}>
                        <span className="tui-review-record-icon">
                          <PencilLineIcon />
                        </span>
                        <span>{n}</span>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <FullReportDisclosure mrUrl={mr?.webUrl} />
          )}
        </section>
        <aside className="tui-sheet-rail">
          {form.lost ? (
            <SheetLost gate={gate} lost={form.lost} onContinue={onContinue} />
          ) : (
            <>
              <div className="tui-sheet-rail-scroll">
                {mr && <MrCard mr={mr} />}
                <div className="tui-sheet-context-card">
                  <span className="tui-sheet-context-label">
                    decision context
                  </span>
                  <p className="tui-sheet-context-lead">
                    {readinessProse(review.readiness)}
                  </p>
                  <div className="tui-sheet-context-reasoning">
                    <Markdown unstyled linkTargetBlank>
                      {review.summary}
                    </Markdown>
                  </div>
                  {meta && <p className="tui-sheet-context-meta">{meta}</p>}
                  {SEVERITY_ORDER.some(s => review.findings[s] > 0) && (
                    <div className="tui-review-tier-pills">
                      {SEVERITY_ORDER.filter(s => review.findings[s] > 0).map(
                        s => (
                          <span
                            className="tui-review-tier-pill"
                            data-tier={SEVERITY_LABEL[s]}
                            key={s}
                          >
                            {SEVERITY_LABEL[s]} ({review.findings[s]})
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>

                {checks.length > 0 && (
                  <div className="tui-sheet-card">
                    <span className="tui-sheet-card-title">checks</span>
                    <div className="tui-sheet-card-list">
                      {checks.map((c, i) => (
                        <div className="tui-sheet-card-row" key={i}>
                          <Chip
                            intent={
                              c.tag === 'FAIL'
                                ? 'bad'
                                : c.tag === 'PASS'
                                  ? 'ok'
                                  : 'muted'
                            }
                            variant="outline"
                            uppercase
                            className="tui-sheet-card-chip"
                          >
                            {c.tag}
                          </Chip>
                          <span className="tui-sheet-card-text">{c.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {outcomeQuestion && (
                <div className="tui-sheet-dock" ref={reserveDock}>
                  <div className="tui-sheet-dock-head">
                    <h3 className="tui-sheet-dock-heading">
                      Verdict on !{mr?.iid ?? ''}
                    </h3>
                    <button
                      type="button"
                      className="tui-sheet-reset"
                      onClick={handleReset}
                    >
                      reset
                    </button>
                  </div>
                  <div
                    className="tui-gate-choices"
                    role="radiogroup"
                    aria-label={outcomeQuestion.label}
                  >
                    {outcomeQuestion.options.map((o: GateOption) => {
                      const display = optionDisplayFor(o);
                      const value = optionValue(o);
                      const checked = selectedOutcome === value;
                      const recommended = isRecommended(o);
                      return (
                        <label
                          className="tui-gate-choice"
                          data-checked={checked || undefined}
                          data-recommended={
                            recommended && !checked ? 'true' : undefined
                          }
                          key={value}
                        >
                          <input
                            type="radio"
                            className="tui-gate-choice-input"
                            data-type="radio"
                            data-checked={checked ? '' : undefined}
                            name={outcomeName}
                            value={value}
                            checked={checked}
                            onChange={() =>
                              outcomeName && form.setSingle(outcomeName, value)
                            }
                          />
                          <span className="tui-gate-choice-label">
                            <span className="tui-gate-choice-label-row">
                              <span title={display.title}>{display.text}</span>
                              {recommended && (
                                <Chip
                                  intent="ok"
                                  variant="outline"
                                  uppercase
                                  data-gate="recommended"
                                  className="tui-gate-recommended"
                                >
                                  recommended
                                </Chip>
                              )}
                            </span>
                            {optionDescription(o) && (
                              <span className="tui-gate-choice-subtitle">
                                {optionDescription(o)}
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    className="tui-gate-note"
                    aria-label={`Note for ${outcomeQuestion.label}`}
                    placeholder="Add a note"
                    value={outcomeNote}
                    onChange={e =>
                      outcomeName &&
                      form.setNote(outcomeName, e.currentTarget.value)
                    }
                  />
                  <Button
                    type="button"
                    variant="filled"
                    intent="accent"
                    size="lg"
                    className="tui-sheet-submit"
                    disabled={form.busy || typeof selectedOutcome !== 'string'}
                    onClick={submit}
                  >
                    {form.busy
                      ? 'submitting…'
                      : findingsQuestion === undefined
                        ? (outcomeText ?? 'submit')
                        : outcomeText
                          ? `post ${selectedFindings.size} · ${outcomeText}`
                          : `post ${selectedFindings.size}`}
                  </Button>
                  {form.failed && (
                    <span className="tui-gate-error">
                      submit failed... nothing was sent, try again
                    </span>
                  )}
                  {form.focusError && (
                    <span className="tui-gate-error">{form.focusError}</span>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </GateSheet>
  );
}

export { ReviewGateSheet };
