import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Code,
  Group,
  NumberInput,
  Pill,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import {
  useSettingKey,
  type ExplainRowWire,
  type SettingDefWire,
} from '@mattstack/settings-kit/react';
import {
  addToList,
  getLeaf,
  matchesShape,
  SHAPES,
  summarize,
  targetScope,
  type CompositeShape,
  type LeafType,
  type RowKind,
} from '@mattstack/settings-kit/shapes';

import {
  enumWidth,
  INPUT_TYPE,
  numberWidth,
  SWITCH_SIZE,
} from './controlStyles';
import { ExpandToggle } from './ExpandToggle';
import { ScopeBadge } from './ScopeBadge';
import { unitOf } from './units';
import type { useRowSave } from './useRowSave';
import { fieldSource, isStoreScope, leafWrite } from './view';

type Row = ReturnType<typeof useRowSave>;
const INLINE_MAX_ITEMS = 3;
const INLINE_MAX_CHARS = 16;
const LEAVES_FIRST = 5;

const PREVIEW_STYLE = {
  background: 'var(--tk-inset)',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
} as const;

function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.currentTarget.blur();
}

function Body({ children }: { children: ReactNode }) {
  return (
    <Box pl={16} pr={52} pb={14}>
      <Stack
        gap={0}
        pl={16}
        style={{ borderLeft: '1px solid var(--tk-line-2)' }}
      >
        {children}
      </Stack>
    </Box>
  );
}

function FieldRow({
  label,
  source,
  children,
}: {
  label: ReactNode;
  source?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Group gap={24} wrap="nowrap" mih={38}>
      <Group gap={8} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
        {label}
        {source}
      </Group>
      <Group w={260} gap={8} wrap="nowrap" style={{ flex: 'none' }}>
        {children}
      </Group>
    </Group>
  );
}

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

function StringListBody({ def, row }: { def: SettingDefWire; row: Row }) {
  const list = strings(def.effective.value);
  const saving = row.status === 'saving';
  const [draft, setDraft] = useState('');
  return (
    <Body>
      {list.map((item, i) => (
        <FieldRow
          key={`${i}:${item}`}
          label={
            <Text fz={12} ff="monospace">
              {item}
            </Text>
          }
        >
          <UnstyledButton
            aria-label={`remove ${item}`}
            disabled={saving}
            onClick={() => void row.save(list.filter(x => x !== item))}
          >
            <Icons.close size={14} />
          </UnstyledButton>
        </FieldRow>
      ))}
      <Box py={6}>
        <TextInput
          aria-label={`add to ${def.key}`}
          disabled={saving}
          size="xs"
          maw={360}
          ff="monospace"
          placeholder="add an item"
          value={draft}
          onTextChange={setDraft}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            const next = addToList(list, draft);
            if (next) void row.save(next).then(ok => ok && setDraft(''));
          }}
        />
      </Box>
    </Body>
  );
}

const TAG_HEIGHT = 24;
const TAG_STYLES = {
  root: {
    height: TAG_HEIGHT,
    borderRadius: 4,
    background: 'var(--tk-raised)',
    color: 'var(--tk-text-1)',
  },
  remove: { color: 'var(--tk-text-3)' },
} as const;

/** A short list edited in place: each item a tag with its own x, and a
    separate + that opens a field for the next one. */
function InlineTags({
  def,
  row,
  list,
}: {
  def: SettingDefWire;
  row: Row;
  list: string[];
}) {
  const { text } = useSchemeColors();
  const saving = row.status === 'saving';
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const plus = useRef<HTMLButtonElement>(null);
  // Escape unmounts the field, and a blur that still fires must not save.
  const cancelled = useRef(false);
  // Closing the field or removing a tag takes the focused control away.
  const refocus = useRef(false);
  useEffect(() => {
    if (adding || saving || !refocus.current) return;
    refocus.current = false;
    plus.current?.focus();
  }, [adding, saving]);

  const commit = () => {
    if (saving) return;
    const next = addToList(list, draft);
    if (next) void row.save(next).then(ok => ok && setDraft(''));
  };
  const remove = (at: number) => {
    if (saving) return;
    void row.save(list.filter((_, i) => i !== at));
  };

  return (
    <Group gap={6} wrap="wrap">
      {list.length === 0 && !adding && (
        <Text fz={12} c={text.muted}>
          {def.effective.value === undefined ? 'unset' : 'none'}
        </Text>
      )}
      {list.map((item, i) => (
        <Pill
          key={`${i}:${item}`}
          ff="monospace"
          styles={TAG_STYLES}
          withRemoveButton
          onRemove={() => {
            refocus.current = true;
            remove(i);
          }}
          removeButtonProps={{
            'aria-label': `remove ${item}`,
            'aria-hidden': false,
            tabIndex: 0,
            disabled: saving,
          }}
        >
          {item}
        </Pill>
      ))}
      {adding ? (
        <TextInput
          aria-label={def.key}
          size="xs"
          w={120}
          styles={{
            input: {
              ...INPUT_TYPE.code.input,
              height: TAG_HEIGHT,
              minHeight: TAG_HEIGHT,
            },
          }}
          autoFocus
          readOnly={saving}
          value={draft}
          onTextChange={setDraft}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Backspace' && draft === '' && list.length > 0)
              remove(list.length - 1);
            if (e.key === 'Escape') {
              e.stopPropagation();
              cancelled.current = true;
              refocus.current = true;
              setDraft('');
              setAdding(false);
            }
          }}
          onBlur={() => {
            if (!cancelled.current) commit();
            cancelled.current = false;
            setAdding(false);
          }}
        />
      ) : (
        <ActionIcon
          ref={plus}
          variant="default"
          size={TAG_HEIGHT}
          radius={4}
          c={text.muted}
          aria-label={`add to ${def.key}`}
          disabled={saving}
          onClick={() => {
            cancelled.current = false;
            setAdding(true);
          }}
        >
          <Icons.plus size={14} />
        </ActionIcon>
      )}
    </Group>
  );
}

function StringMapBody({
  def,
  row,
  labels,
}: {
  def: SettingDefWire;
  row: Row;
  labels: readonly [string, string];
}) {
  const map = (def.effective.value ?? {}) as Record<string, string>;
  const saving = row.status === 'saving';
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <Body>
      {Object.entries(map).map(([key, value]) => (
        <FieldRow
          key={key}
          label={
            <Text fz={12} ff="monospace" truncate>
              {key}
            </Text>
          }
        >
          {/* Uncontrolled so a refused save keeps the typed text; keyed on
              the seeded value so a refresh remounts it instead of leaving
              stale text that the next blur would write back. */}
          <TextInput
            key={value}
            aria-label={`${labels[1]} for ${key}`}
            disabled={saving}
            size="xs"
            w={200}
            defaultValue={value}
            onKeyDown={blurOnEnter}
            onBlur={e => {
              const next = e.currentTarget.value.trim();
              if (next && next !== value)
                void row.save({ ...map, [key]: next });
            }}
          />
          <UnstyledButton
            aria-label={`remove ${key}`}
            disabled={saving}
            onClick={() =>
              void row.save(
                Object.fromEntries(
                  Object.entries(map).filter(([other]) => other !== key)
                )
              )
            }
          >
            <Icons.close size={14} />
          </UnstyledButton>
        </FieldRow>
      ))}
      <Group gap={8} py={6} wrap="nowrap">
        <TextInput
          aria-label={`new ${labels[0]}`}
          disabled={saving}
          size="xs"
          style={{ flex: 1 }}
          placeholder={labels[0]}
          value={k}
          onTextChange={setK}
        />
        <TextInput
          aria-label={`new ${labels[1]}`}
          disabled={saving}
          size="xs"
          w={200}
          placeholder={labels[1]}
          value={v}
          onTextChange={setV}
        />
        <UnstyledButton
          aria-label={`add ${labels[0]}`}
          disabled={saving}
          onClick={() => {
            if (!k.trim() || !v.trim()) return;
            void row
              .save({ ...map, [k.trim()]: v.trim() })
              .then(ok => ok && (setK(''), setV('')));
          }}
        >
          <Icons.plus size={14} />
        </UnstyledButton>
      </Group>
    </Body>
  );
}

/** Callers key this on `value`: the number and text inputs are
    uncontrolled, the same contract as ScalarControl. */
function LeafInput({
  label,
  type,
  value,
  placeholder,
  disabled,
  onSave,
}: {
  label: string;
  type: LeafType;
  value: unknown;
  placeholder?: string;
  disabled: boolean;
  onSave: (v: unknown) => void;
}) {
  const { text } = useSchemeColors();
  if (type === 'boolean')
    return (
      <Switch
        aria-label={label}
        size="sm"
        style={SWITCH_SIZE}
        disabled={disabled}
        checked={value === true}
        onChange={e => onSave(e.currentTarget.checked)}
      />
    );
  if (typeof type === 'object')
    return (
      <Select
        aria-label={label}
        disabled={disabled}
        size="xs"
        w={enumWidth(type.enum)}
        styles={INPUT_TYPE.label}
        data={[...type.enum]}
        value={typeof value === 'string' ? value : null}
        allowDeselect={false}
        onChange={v => {
          if (v !== null && v !== value) onSave(v);
        }}
      />
    );
  if (type === 'number') {
    const unit = unitOf(label);
    return (
      <Group gap={8} wrap="nowrap">
        <NumberInput
          aria-label={label}
          disabled={disabled}
          size="xs"
          w={numberWidth(value)}
          styles={INPUT_TYPE.number}
          placeholder={placeholder}
          hideControls
          defaultValue={typeof value === 'number' ? value : undefined}
          onKeyDown={blurOnEnter}
          onBlur={e => {
            const raw = e.currentTarget.value.trim();
            if (raw === '') {
              if (value !== undefined) onSave(undefined);
              return;
            }
            const n = Number(raw);
            if (Number.isFinite(n) && n !== value) onSave(n);
          }}
        />
        {unit && (
          <Text fz={12} c={text.muted}>
            {unit}
          </Text>
        )}
      </Group>
    );
  }
  return (
    <TextInput
      aria-label={label}
      disabled={disabled}
      size="xs"
      w={200}
      styles={INPUT_TYPE.code}
      placeholder={placeholder}
      defaultValue={typeof value === 'string' ? value : ''}
      onKeyDown={blurOnEnter}
      onBlur={e => {
        const next = e.currentTarget.value;
        if (next !== (value ?? '')) onSave(next === '' ? undefined : next);
      }}
    />
  );
}

function LeavesBody({
  def,
  row,
  shape,
}: {
  def: SettingDefWire;
  row: Row;
  shape: {
    fields: Record<string, LeafType>;
    fallbacks?: Record<string, string>;
  };
}) {
  const { text } = useSchemeColors();
  const explained = useSettingKey(def.key);
  const [all, setAll] = useState(false);
  const [resets, setResets] = useState(0);
  const paths = Object.keys(shape.fields);
  const shown = all ? paths : paths.slice(0, LEAVES_FIRST);
  const target = targetScope(def);

  // leafWrite rebuilds the target layer's own object from these rows, so they
  // must postdate the def's current scope and value and our last write, or a
  // leaf edit drops the fields a move or a previous edit just put there. The
  // kit raises `loading` only a render after refresh(), so staleness is
  // tracked against the rows array that was current when the def changed.
  const fingerprint = JSON.stringify([
    def.effective.scope,
    def.effective.value,
  ]);
  const [seen, setSeen] = useState(fingerprint);
  const [staleRows, setStaleRows] = useState<ExplainRowWire[] | null>(null);
  if (fingerprint !== seen) {
    setSeen(fingerprint);
    setStaleRows(explained.rows);
  }
  const { refresh } = explained;
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) refresh();
    mounted.current = true;
  }, [fingerprint, refresh]);
  const disabled =
    explained.loading ||
    explained.error !== null ||
    explained.rows === staleRows ||
    row.status === 'saving';
  return (
    <Body>
      {shown.map(path => {
        const source = fieldSource(explained.rows, path);
        const value = getLeaf(def.effective.value, path);
        return (
          <FieldRow
            key={path}
            label={
              <Text fz={12} ff="monospace">
                {path}
              </Text>
            }
            source={
              isStoreScope(source) ? (
                <ScopeBadge scope={source} />
              ) : source ? (
                <Text fz={12} c={text.muted}>
                  {source}
                </Text>
              ) : null
            }
          >
            <LeafInput
              key={`${JSON.stringify(value) ?? ''}:${resets}`}
              label={`${def.key}.${path}`}
              type={shape.fields[path]!}
              value={value}
              placeholder={shape.fallbacks?.[path]}
              disabled={disabled}
              onSave={v => {
                // Emptying a field the target layer does not set would write
                // that layer anyway; the inherited value still applies.
                if (v === undefined && source !== target) {
                  setResets(n => n + 1);
                  return;
                }
                const next = leafWrite(explained.rows, target, path, v);
                const write =
                  Object.keys(next).length === 0
                    ? row.clear(target)
                    : row.save(next);
                void write.then(ok => {
                  if (!ok) return;
                  setStaleRows(explained.rows);
                  refresh();
                });
              }}
            />
          </FieldRow>
        );
      })}
      {paths.length > LEAVES_FIRST && !all && (
        <UnstyledButton onClick={() => setAll(true)} py={8}>
          <Group gap={4} wrap="nowrap" c="var(--tk-text-accent-small)">
            <Text fz={12} fw={500} c="var(--tk-text-accent-small)">
              {paths.length - LEAVES_FIRST} more fields
            </Text>
            <Icons.chevronDown size={12} />
          </Group>
        </UnstyledButton>
      )}
      {explained.error && (
        <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)" py={6}>
          {explained.error}
        </Text>
      )}
    </Body>
  );
}

function ReadonlyBody({ def }: { def: SettingDefWire }) {
  const { text } = useSchemeColors();
  const value = def.effective.value;
  return (
    <Body>
      {def.secret ? (
        <Text fz={12} ff="monospace" c={text.muted}>
          •••
        </Text>
      ) : (
        <Code block style={PREVIEW_STYLE}>
          {JSON.stringify(value, null, 2)}
        </Code>
      )}
      {def.effective.file && (
        <Text fz={12} ff="monospace" c={text.muted} pt={8}>
          {def.effective.file}
        </Text>
      )}
    </Body>
  );
}

function ShapeLock({
  at,
  row,
  loading = false,
}: {
  at: string | null;
  row: Row;
  loading?: boolean;
}) {
  return (
    <Group gap={8} wrap="nowrap">
      <Text fz={12} fw={500} c="var(--tk-text-bad-small)">
        unexpected shape
      </Text>
      {(loading || isStoreScope(at)) && (
        <Button
          size="compact-xs"
          variant="default"
          disabled={loading}
          onClick={() => {
            if (isStoreScope(at)) void row.clear(at);
          }}
        >
          Clear
        </Button>
      )}
    </Group>
  );
}

/** A deep key's merged value can fail its shape because of any layer, so
    Clear targets the strongest layer whose own value fails, not the winner. */
function DeepShapeLock({
  def,
  row,
  shape,
}: {
  def: SettingDefWire;
  row: Row;
  shape: CompositeShape;
}) {
  const { rows, loading } = useSettingKey(def.key);
  const bad = [...rows]
    .reverse()
    .find(
      r =>
        r.present &&
        isStoreScope(r.scope) &&
        r.value !== undefined &&
        !matchesShape(shape, r.value)
    );
  return (
    <ShapeLock
      at={bad?.scope ?? def.effective.scope}
      row={row}
      loading={loading}
    />
  );
}

function UnsetSummary() {
  const { text } = useSchemeColors();
  return (
    <Text fz={12} c={text.muted}>
      unset
    </Text>
  );
}

/** Composite rows: the control column holds an inline editor or a summary
    toggle, and the body expands under the row. */
export function compositeParts(
  def: SettingDefWire,
  kind: RowKind,
  row: Row,
  open: boolean,
  onToggle: () => void
): { control: ReactNode; body: ReactNode } {
  const shape = SHAPES[def.key];
  const value = def.effective.value;
  const toggle = (
    <ExpandToggle label={summarize(def)} open={open} onToggle={onToggle} />
  );
  const readonly =
    (value === undefined && !def.secret) || def.effective.scope === null
      ? { control: <UnsetSummary />, body: null }
      : { control: toggle, body: open ? <ReadonlyBody def={def} /> : null };

  // Secret and unwritable keys can still carry a SHAPES entry; they must
  // reach neither an editor nor the Clear escape hatch.
  if (kind === 'readonly' || !shape) return readonly;

  // An invalid winning layer arrives with no value; an editor seeded from
  // nothing would discard whatever that layer stores on its first edit.
  if (
    shape.kind !== 'external' &&
    (def.effective.invalid !== undefined ||
      (value !== undefined && !matchesShape(shape, value)))
  ) {
    return {
      control:
        def.merge === 'deep' && def.effective.invalid === undefined ? (
          <DeepShapeLock def={def} row={row} shape={shape} />
        ) : (
          <ShapeLock at={def.effective.scope} row={row} />
        ),
      body: null,
    };
  }

  if (kind === 'stringList') {
    const list = strings(value);
    if (
      list.length <= INLINE_MAX_ITEMS &&
      list.every(x => x.length <= INLINE_MAX_CHARS)
    )
      return {
        control: <InlineTags def={def} row={row} list={list} />,
        body: null,
      };
    return {
      control: toggle,
      body: open ? <StringListBody def={def} row={row} /> : null,
    };
  }
  if (kind === 'stringMap' && shape.kind === 'stringMap')
    return {
      control: toggle,
      body: open ? (
        <StringMapBody def={def} row={row} labels={shape.labels} />
      ) : null,
    };
  if (kind === 'leaves' && shape.kind === 'leaves')
    return {
      control: toggle,
      body: open ? <LeavesBody def={def} row={row} shape={shape} /> : null,
    };
  return readonly;
}
