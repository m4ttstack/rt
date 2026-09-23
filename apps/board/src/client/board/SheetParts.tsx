import type { ReactNode } from 'react';

import type { GateItemDisplay } from '@mattstack/gate-kit/react';
import { Button, Chip, Markdown } from '@mattstack/tui-kit';
import type { GateRow } from '../../gates/store.ts';
import { AnsweredChip, type GateFormState } from './GateForm.tsx';

function RecommendedChip() {
  return (
    <Chip
      intent="ok"
      variant="outline"
      uppercase
      data-gate="recommended"
      className="tui-gate-recommended"
    >
      recommended
    </Chip>
  );
}

/** What a question's choices read and write: a live form, or a recorded
    answer shown read-only. */
type ChoiceState = Pick<
  GateFormState,
  'selections' | 'setSingle' | 'toggleMulti'
>;

function Choices({
  q,
  form,
  disabled = false,
  renderLabel,
}: {
  q: GateItemDisplay;
  form: ChoiceState;
  disabled?: boolean;
  /** A choice's own label markup; returning undefined keeps the default. */
  renderLabel?: (value: string, chip: ReactNode) => ReactNode;
}) {
  const current = form.selections[q.name];
  const picked = new Set(Array.isArray(current) ? current : []);
  return (
    <div
      className="tui-gate-choices"
      role={q.multiple ? 'group' : 'radiogroup'}
      aria-label={q.prompt}
    >
      {q.choices.map(choice => {
        const checked = q.multiple
          ? picked.has(choice.value)
          : current === choice.value;
        const chip = choice.recommended ? <RecommendedChip /> : null;
        const custom = renderLabel?.(choice.value, chip);
        return (
          <label
            className="tui-gate-choice"
            data-checked={checked || undefined}
            data-recommended={choice.recommended ? 'true' : undefined}
            key={choice.value}
          >
            <input
              type={q.multiple ? 'checkbox' : 'radio'}
              className="tui-gate-choice-input"
              data-type={q.multiple ? 'checkbox' : 'radio'}
              data-checked={checked ? '' : undefined}
              name={q.name}
              value={choice.value}
              checked={checked}
              disabled={disabled}
              onChange={e =>
                q.multiple
                  ? form.toggleMulti(
                      q.name,
                      choice.value,
                      e.currentTarget.checked
                    )
                  : form.setSingle(q.name, choice.value)
              }
            />
            <span className="tui-gate-choice-label">
              {custom ?? (
                <>
                  <span className="tui-gate-choice-label-row">
                    <span title={choice.description}>{choice.label}</span>
                    {chip}
                  </span>
                  {choice.subtitle && (
                    <span className="tui-gate-choice-subtitle">
                      {choice.subtitle}
                    </span>
                  )}
                </>
              )}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function Note({ q, form }: { q: GateItemDisplay; form: GateFormState }) {
  return (
    <input
      type="text"
      className="tui-gate-note"
      aria-label={`Note for ${q.prompt}`}
      placeholder="Add a note"
      value={form.notes[q.name] ?? ''}
      onChange={e => form.setNote(q.name, e.currentTarget.value)}
    />
  );
}

/** A question's own context when it is prose; a structured context that
    has no card here renders nothing rather than raw JSON. */
function ProseContext({
  q,
  structured,
}: {
  q: GateItemDisplay;
  structured: boolean;
}) {
  if (!q.context || structured) return null;
  return (
    <div className="tui-gate-question-context">
      <Markdown unstyled linkTargetBlank>
        {q.context}
      </Markdown>
    </div>
  );
}

type RowChip = {
  text: string;
  intent: 'ok' | 'muted' | 'accent';
  title?: string;
} | null;

interface SheetRow {
  key: string;
  text: ReactNode;
  /** The row's full text on hover, for a dock that clips it. */
  title?: string;
  chips: RowChip[];
}

/** A break opportunity after every slash, so a path that wraps in a narrow
    dock splits between segments, never inside one. */
function slashBreaks(text: string): ReactNode {
  const parts = text.split('/');
  if (parts.length === 1) return text;
  return parts.flatMap((part, i) =>
    i === parts.length - 1 ? [part] : [`${part}/`, <wbr key={i} />]
  );
}

/** The dock's one line per decision: its chips, then what it decides. A
    null chip keeps its slot empty so every row's text starts at one edge. */
function SheetRows({ card, rows }: { card: string; rows: SheetRow[] }) {
  return (
    <div className="tui-sheet-card-list" data-card={card}>
      {rows.map(r => (
        <div className="tui-sheet-card-row" key={r.key}>
          {r.chips.map((c, i) =>
            c ? (
              <Chip
                key={c.text}
                intent={c.intent}
                variant="outline"
                uppercase
                className="tui-sheet-card-chip"
                title={c.title}
              >
                {c.text}
              </Chip>
            ) : (
              <span
                key={`slot-${i}`}
                className="tui-sheet-card-chip-slot"
                aria-hidden="true"
              />
            )
          )}
          <span
            className="tui-sheet-card-text"
            title={r.title ?? (typeof r.text === 'string' ? r.text : undefined)}
          >
            {typeof r.text === 'string' ? slashBreaks(r.text) : r.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Ref for a sheet's pinned panel (its dock, or the lost panel): keeps the
    panel's height on its scroller as --sheet-dock-h, which the stacked
    layout reserves as scroll padding, so a control scrolled into view clears
    the panel however tall its rows make it. */
function reserveDock(panel: HTMLElement | null) {
  const body = panel?.closest<HTMLElement>('.tui-sheet-body');
  if (!panel || !body || typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() =>
    body.style.setProperty(
      '--sheet-dock-h',
      `${Math.ceil(panel.getBoundingClientRect().height)}px`
    )
  );
  observer.observe(panel);
  return () => {
    observer.disconnect();
    body.style.removeProperty('--sheet-dock-h');
  };
}

/** The rail once another surface answered the gate first: the answer that
    won, and a way on to the next gate. */
function SheetLost({
  gate,
  lost,
  onContinue,
}: {
  gate: GateRow;
  lost: NonNullable<GateFormState['lost']>;
  onContinue: () => void;
}) {
  return (
    <div className="tui-sheet-lost" ref={reserveDock}>
      <span className="tui-gate-error">answered elsewhere</span>
      <AnsweredChip
        startOpen
        row={{
          subject: gate.subject,
          kind: gate.kind,
          status: 'answered',
          questions: gate.questions,
          answer: { answers: lost.answers, by: lost.by },
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
    </div>
  );
}

export { Choices, Note, ProseContext, reserveDock, SheetLost, SheetRows };
export type { ChoiceState, RowChip, SheetRow };
