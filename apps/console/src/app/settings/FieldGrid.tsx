import { useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Box,
  Button,
  Group,
  Menu,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import {
  enumWidth,
  INPUT_TYPE,
  numberWidth,
  SWITCH_SIZE,
} from './controlStyles';
import {
  addableFields,
  extraKeys,
  visibleFields,
  type FieldSpec,
  type FormShape,
} from './formShape';
import { shortIssue } from './issues';
import { BLOCK_STYLE } from './JsonBlock';

type Entry = Record<string, unknown>;

const NAME_W = 168;
const MESSAGE_W = 176;
const REMOVE_W = 24;
const ROW_H = 38;

/** Controlled; the number input keeps its raw text so a half-typed "-"
    survives until it parses. */
function FieldInput({
  label,
  spec,
  value,
  disabled,
  error,
  onChange,
  onTouch,
}: {
  label: string;
  spec: FieldSpec;
  value: unknown;
  disabled: boolean;
  error: boolean;
  onChange: (v: unknown) => void;
  onTouch: () => void;
}) {
  const [raw, setRaw] = useState<string | number>(
    typeof value === 'number' ? value : ''
  );
  if (spec.type === 'boolean') {
    const checked = value === true;
    return (
      <Switch
        aria-label={label}
        size="sm"
        style={SWITCH_SIZE}
        // Mantine's own off-track colour (dark-5) is the same hex as
        // --tk-raised in dark scheme, so an off switch on a card reads as a
        // bare thumb with no visible track. Overridden only off/enabled --
        // checked keeps Mantine's own filled colour, disabled keeps
        // Mantine's own disabled styling (see CardAction for the same
        // reasoning).
        styles={
          !checked && !disabled
            ? { track: { '--switch-bg': 'var(--tk-border)' } }
            : undefined
        }
        disabled={disabled}
        error={error}
        checked={checked}
        onChange={e => {
          onTouch();
          onChange(e.currentTarget.checked);
        }}
      />
    );
  }
  if (typeof spec.type === 'object')
    return (
      <Select
        aria-label={label}
        size="xs"
        w={enumWidth(spec.type.enum)}
        styles={INPUT_TYPE.label}
        disabled={disabled}
        error={error}
        data={[...spec.type.enum]}
        value={typeof value === 'string' ? value : null}
        allowDeselect={false}
        onChange={v => {
          if (v !== null) {
            onTouch();
            onChange(v);
          }
        }}
        onBlur={onTouch}
      />
    );
  if (spec.type === 'number')
    return (
      <NumberInput
        aria-label={label}
        size="xs"
        w={numberWidth(value)}
        styles={INPUT_TYPE.number}
        placeholder={spec.placeholder}
        hideControls
        disabled={disabled}
        error={error}
        value={raw}
        onChange={v => {
          onTouch();
          setRaw(v);
          if (typeof v === 'number') onChange(v);
          else if (v === '') onChange(undefined);
        }}
        onBlur={onTouch}
      />
    );
  const text = typeof value === 'string' ? value : '';
  const change = (v: string) => {
    onTouch();
    onChange(v === '' ? undefined : v);
  };
  return spec.suggestions ? (
    <Autocomplete
      aria-label={label}
      size="xs"
      w="100%"
      styles={INPUT_TYPE.code}
      placeholder={spec.placeholder}
      disabled={disabled}
      error={error}
      data={spec.suggestions}
      value={text}
      onChange={change}
      onBlur={onTouch}
    />
  ) : (
    <TextInput
      aria-label={label}
      size="xs"
      w="100%"
      styles={INPUT_TYPE.code}
      placeholder={spec.placeholder}
      disabled={disabled}
      error={error}
      value={text}
      onTextChange={change}
      onBlur={onTouch}
    />
  );
}

/** One row of the shared grid: a fixed name column, an input column that
    fills the rest, a fixed message column and a fixed remove slot, all at
    one height so a message or a missing remove control never shifts a
    neighbouring row. */
function Row({
  name,
  message,
  remove,
  children,
  testId,
}: {
  name: ReactNode;
  message?: ReactNode;
  remove?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Group gap={12} wrap="nowrap" h={ROW_H} align="center" data-testid={testId}>
      <Box style={{ flex: `0 0 ${NAME_W}px`, minWidth: 0 }}>{name}</Box>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
      <Box style={{ flex: `0 0 ${MESSAGE_W}px`, minWidth: 0 }}>{message}</Box>
      <Box style={{ flex: `0 0 ${REMOVE_W}px` }}>{remove}</Box>
    </Group>
  );
}

/** One object's fields: required first, then set or added optional ones,
    an Add property menu, and read-only rows for properties the form does
    not draw (kept as they are on save). */
export function FieldGrid({
  shape,
  entry,
  onChange,
  disabled,
  issues,
  touched,
  onTouch,
}: {
  shape: FormShape;
  entry: Entry;
  onChange: (next: Entry) => void;
  disabled: boolean;
  issues: SchemaIssue[];
  touched: ReadonlySet<string>;
  onTouch: (name: string) => void;
}) {
  const { text } = useSchemeColors();
  // Seeded from what's already set, so clearing a stored optional field's
  // text (undefined round-trips through here too) never drops its row --
  // only the remove control below does that.
  const [shown, setShown] = useState<string[]>(() =>
    Object.keys(entry).filter(
      k => k in shape.fields && !shape.required.includes(k)
    )
  );
  // The written object's key order, seeded from the entry's own order and
  // extended (once) the first time a new name is set, so clearing and
  // retyping a field returns it to its original position instead of the end.
  const order = useRef<string[]>(Object.keys(entry));
  const set = (name: string, v: unknown) => {
    if (!order.current.includes(name)) order.current = [...order.current, name];
    // A key present in the entry but missing from order.current (a stale
    // instance sharing state across an entry swap it never remounted for)
    // would otherwise drop that key on this write.
    const keys = [
      ...order.current,
      ...Object.keys(entry).filter(k => !order.current.includes(k)),
    ];
    const next: Entry = {};
    for (const k of keys) {
      const value = k === name ? v : entry[k];
      if (value !== undefined) next[k] = value;
    }
    onChange(next);
  };
  const drop = (name: string) => {
    setShown(s => s.filter(n => n !== name));
    set(name, undefined);
  };
  const issueFor = (name: string) => issues.find(i => i.path[0] === name);
  const addable = addableFields(shape, entry, shown);
  const extras = extraKeys(shape, entry);

  return (
    <Stack gap={0}>
      {visibleFields(shape, entry, shown).map(name => {
        const spec = shape.fields[name]!;
        const required = shape.required.includes(name);
        const issue = issueFor(name);
        const showIssue = touched.has(name) && issue !== undefined;
        return (
          <Row
            key={name}
            testId={`field-row-${name}`}
            name={
              <Text
                fz={12}
                ff="monospace"
                c="var(--tk-text-1)"
                truncate
                title={spec.description}
              >
                {spec.title ?? name}
              </Text>
            }
            message={
              showIssue && (
                <Text
                  fz={12}
                  c="var(--tk-text-bad-small)"
                  truncate
                  title={issue.message}
                >
                  {shortIssue(issue)}
                </Text>
              )
            }
            remove={
              !required && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  c={text.muted}
                  size="sm"
                  aria-label={`remove ${name}`}
                  disabled={disabled}
                  onClick={() => drop(name)}
                >
                  <Icons.close size={14} />
                </ActionIcon>
              )
            }
          >
            <FieldInput
              label={name}
              spec={spec}
              value={entry[name]}
              disabled={disabled}
              error={showIssue}
              onChange={v => set(name, v)}
              onTouch={() => onTouch(name)}
            />
          </Row>
        );
      })}
      {extras.length > 0 && (
        <Box style={{ borderTop: '1px solid var(--tk-line-2)' }} mt={4} pt={4}>
          {extras.map(name => {
            const raw = JSON.stringify(entry[name]);
            return (
              <Row
                key={name}
                name={
                  <Text fz={12} ff="monospace" c={text.muted} truncate>
                    {name}
                  </Text>
                }
                message={
                  <Text fz={12} c={text.muted} truncate>
                    kept on save · edit in JSON
                  </Text>
                }
              >
                <Box
                  style={{
                    ...BLOCK_STYLE,
                    fontFamily: 'var(--mantine-font-family-monospace)',
                    color: 'var(--tk-text-3)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    padding: '4px 8px',
                    borderRadius: 4,
                    // An unbroken JSON string (no spaces for `white-space:
                    // nowrap` to break on) has an effectively unbounded
                    // min-content width. Without size containment that
                    // propagates through Mantine's ScrollArea, whose own
                    // content wrapper is `min-width: min-content`, and
                    // widens the whole settings panel instead of
                    // ellipsizing in place.
                    contain: 'inline-size',
                  }}
                  title={raw}
                >
                  {raw}
                </Box>
              </Row>
            );
          })}
        </Box>
      )}
      {addable.length > 0 && (
        <Group py={4}>
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={disabled}
                leftSection={<Icons.plus size={12} />}
              >
                Add property
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {addable.map(name => (
                <Menu.Item
                  key={name}
                  onClick={() => setShown(s => [...s, name])}
                >
                  {shape.fields[name]!.title ?? name}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      )}
    </Stack>
  );
}
