import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { checkValue, type SchemaIssue } from '@mattstack/settings-kit/shapes';

import { canDraw, type FormShape } from './formShape';
import {
  footerSummary,
  issueText,
  standingIssues,
  type CardKey,
} from './issues';
import { CardsFooter, ItemCards } from './ItemCards';
import { JsonDraft } from './JsonDraft';
import { NamedSections } from './NamedSections';

type Entry = Record<string, unknown>;
type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2) ?? '';
}

function parse(text: string): Parsed {
  if (text.trim() === '') return { ok: false, message: 'empty document' };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function emptyOf(def: SettingDefWire): unknown {
  return def.type === 'array' ? [] : {};
}

/** A local draft of one layer's value, as a form or as JSON, checked
    against the def's layer schema as it changes and saved only when it
    parses and passes. Switching modes carries the draft across; the form is
    out of reach while the JSON does not parse or does not fit it. Escape
    and Cancel discard the draft; Escape is marked handled so an enclosing
    modal stays open. */
export function DraftEditor({
  def,
  form,
  initial,
  startIn = 'form',
  targetLabel,
  saving,
  replaceWith,
  reported = [],
  reveal = false,
  onSave,
  onCancel,
}: {
  def: SettingDefWire;
  form: FormShape | null;
  initial: unknown;
  startIn?: 'form' | 'json';
  targetLabel: string;
  saving: boolean;
  /** Swaps the draft (form and JSON alike) for a value from elsewhere,
      such as a diverged older store's value. */
  replaceWith?: { label: string; value: unknown };
  /** The store's own issues on this layer, shown until their value is
      edited even where the local check passes it. */
  reported?: SchemaIssue[];
  /** Scrolls the first invalid field into view on mount. */
  reveal?: boolean;
  onSave: (value: unknown) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { text: colors } = useSchemeColors();
  const start = initial ?? emptyOf(def);
  const schema = def.layerSchema ?? def.schema;
  const [mode, setMode] = useState<'form' | 'json'>(
    form && startIn === 'form' && canDraw(form, start) ? 'form' : 'json'
  );
  const [draft, setDraft] = useState<unknown>(() => structuredClone(start));
  const [text, setText] = useState(() => pretty(start));
  // Bumped whenever the draft is replaced wholesale (Use the older value),
  // keyed onto ItemCards/NamedSections so they remount from the new value
  // instead of keeping card ids, key order and per-field local state seeded
  // from the value they had at mount.
  const [formGeneration, setFormGeneration] = useState(0);
  // The stored index of each top-level entry, so a reported issue follows
  // its card; lost once the draft is rewritten outside the cards.
  const [origin, setOrigin] = useState<number[] | null>(() =>
    Array.isArray(start) ? start.map((_, i) => i) : null
  );

  const parsed: Parsed =
    mode === 'json' ? parse(text) : { ok: true, value: draft };
  const checked = parsed.ok && schema ? checkValue(schema, parsed.value) : [];
  const issues = parsed.ok
    ? [
        ...checked,
        ...standingIssues(reported, start, parsed.value, checked, origin),
      ]
    : checked;
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reveal) return;
    root.current
      ?.querySelector('[aria-invalid="true"]')
      ?.scrollIntoView({ block: 'center' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const changed =
    parsed.ok && JSON.stringify(parsed.value) !== JSON.stringify(start);
  const fits = parsed.ok && form !== null && canDraw(form, parsed.value);

  // The form's touched fields at the switch to JSON, so an untouched new
  // card reads the same there; any edit to the JSON text counts as a touch.
  const formTouched = useRef<ReadonlyMap<CardKey, ReadonlySet<string>> | null>(
    null
  );
  const [jsonTouched, setJsonTouched] = useState<{
    text: string;
    touched: ReadonlyMap<CardKey, ReadonlySet<string>>;
  } | null>(null);
  const onTouched = (t: ReadonlyMap<CardKey, ReadonlySet<string>>) => {
    formTouched.current = t;
  };

  const toJson = () => {
    setOrigin(null);
    const next = pretty(draft);
    setText(next);
    setJsonTouched(
      formTouched.current ? { text: next, touched: formTouched.current } : null
    );
    setMode('json');
  };
  const toForm = () => {
    if (!parsed.ok || !fits) return;
    setDraft(parsed.value);
    setMode('form');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    if (target.closest('[role="menu"], [role="listbox"]')) return;
    // A Select/Autocomplete target closes its own dropdown on Escape without
    // stopping the event; its aria-expanded is still "true" here since that
    // close hasn't re-rendered yet. Let that Escape stop there instead of
    // also discarding the draft.
    if (target.getAttribute('aria-expanded') === 'true') return;
    e.preventDefault();
    onCancel();
  };

  const footerEnd = (
    <>
      <Button size="compact-sm" variant="default" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        size="compact-sm"
        disabled={!parsed.ok || !changed || issues.length > 0 || saving}
        onClick={() => {
          if (parsed.ok) void onSave(parsed.value);
        }}
      >
        Save
      </Button>
    </>
  );

  return (
    <Stack ref={root} gap={10} onKeyDown={onKeyDown}>
      <Group justify="space-between" wrap="nowrap" gap={8}>
        <Text fz={12} c={colors.muted}>
          {`Editing the ${targetLabel} layer`}
        </Text>
        {(form || replaceWith) && (
          <Group gap={8} wrap="nowrap">
            {form && mode === 'json' && !fits && (
              <Text fz={12} c={colors.muted}>
                {parsed.ok
                  ? 'This value does not fit the form.'
                  : 'Fix the JSON to switch back to the form.'}
              </Text>
            )}
            {replaceWith && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => {
                  setOrigin(null);
                  setDraft(structuredClone(replaceWith.value));
                  setText(pretty(replaceWith.value));
                  setFormGeneration(g => g + 1);
                  if (form && !canDraw(form, replaceWith.value))
                    setMode('json');
                }}
              >
                {replaceWith.label}
              </Button>
            )}
            {form && (
              <SegmentedControl
                size="xs"
                value={mode}
                onChange={v => (v === 'json' ? toJson() : toForm())}
                data={[
                  {
                    value: 'form',
                    label: 'Form',
                    disabled: mode === 'json' && !fits,
                  },
                  { value: 'json', label: 'JSON' },
                ]}
              />
            )}
          </Group>
        )}
      </Group>
      {mode === 'json' && (
        <JsonDraft
          key={`${def.key}:${targetLabel}:${JSON.stringify(schema) ?? ''}`}
          text={text}
          onText={setText}
          schema={schema}
        />
      )}
      {mode === 'form' && form?.kind === 'objectList' && (
        <ItemCards
          key={formGeneration}
          shape={form}
          value={draft as Entry[]}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
          footerEnd={footerEnd}
          issueTestId="draft-issue"
          onOrder={origin ? setOrigin : undefined}
          onTouched={onTouched}
        />
      )}
      {mode === 'form' && form?.kind === 'objectMap' && (
        <NamedSections
          key={formGeneration}
          shape={form}
          value={draft as Record<string, Entry>}
          onChange={setDraft}
          disabled={saving}
          issues={issues}
          footerEnd={footerEnd}
          issueTestId="draft-issue"
          onTouched={onTouched}
        />
      )}
      {mode === 'json' && (
        <CardsFooter
          leading={null}
          summary={
            parsed.ok && jsonTouched && jsonTouched.text === text
              ? footerSummary(issues, jsonTouched.touched)
              : {
                  touchedText: null,
                  noteText: null,
                  fallbackText: parsed.ok
                    ? issues[0]
                      ? issueText(issues[0])
                      : null
                    : `JSON: ${parsed.message}`,
                }
          }
          issueTestId="draft-issue"
          footerEnd={footerEnd}
        />
      )}
    </Stack>
  );
}
