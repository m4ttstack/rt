import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@ui/core';
import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import type { ExplainRowWire, SettingDefWire } from '../../server/settings';
import { shortValue } from './chain';

export type VerdictRole = 'winner' | 'overridden' | 'contributor' | 'inert';

export interface LayerRowProps {
  def: SettingDefWire;
  row: ExplainRowWire;
  role: VerdictRole;
  /** Fired with the staged draft when Apply is pressed. `LayerRow` never
      writes anything itself -- the caller owns the `useSetSetting` mutation
      and passes `applying`/`applyError` back in from it, exactly as
      `Rebind`'s caller owns `rt skills bind`. */
  onApply?: (value: unknown, scope: 'user' | 'team' | 'machine') => void;
  /** True while the caller's apply is in flight -- disables Discard and
      Apply so a second click cannot start a second, concurrent write. */
  applying?: boolean;
  /** Set by the caller after a failed apply (a refused `rt settings set`,
      say), so the staged block can say what went wrong. */
  applyError?: string | null;
}

/** `default` and the repo rungs are never write targets in v1; everything
    else maps 1:1 onto a store scope. */
export function writeScopeOf(
  row: ExplainRowWire
): 'user' | 'team' | 'machine' | null {
  return row.scope === 'user' || row.scope === 'team' || row.scope === 'machine'
    ? row.scope
    : null;
}

function isComposite(def: SettingDefWire): boolean {
  return def.type === 'object' || def.type === 'array';
}

function isEditable(def: SettingDefWire, row: ExplainRowWire): boolean {
  const scope = writeScopeOf(row);
  return def.writable && scope !== null && def.scopes.includes(scope);
}

function initialDraft(def: SettingDefWire, row: ExplainRowWire): unknown {
  if (row.present) return row.value;
  if (def.hasDefault) return def.defaultValue;
  if (def.type === 'boolean') return false;
  if (def.type === 'number') return 0;
  return '';
}

export function LayerRow({
  def,
  row,
  role,
  onApply,
  applying = false,
  applyError = null,
}: LayerRowProps) {
  const { text, border } = useSchemeColors();
  const rowId = `${row.scope}${row.file ? `:${row.file}` : ''}`;
  const composite = isComposite(def);
  const editable = isEditable(def, row);
  const scope = writeScopeOf(row);

  const [editing, setEditing] = useState(false);
  const [staged, setStaged] = useState(false);
  const [draft, setDraft] = useState<unknown>(() => initialDraft(def, row));

  function openEdit() {
    setDraft(initialDraft(def, row));
    setEditing(true);
  }

  const discard = useCallback(() => {
    setDraft(initialDraft(def, row));
    setStaged(false);
    setEditing(false);
  }, [def, row]);

  // Props carry no explicit success signal -- ExplainKeyPage passes only
  // applying/applyError, and this row stays mounted (stably keyed) across
  // the post-apply refetch. So the falling edge of `applying` with no
  // `applyError` IS success, and is the only way this component can learn
  // Apply worked and close its own stale staged block.
  const wasApplying = useRef(applying);
  useEffect(() => {
    if (wasApplying.current && !applying && !applyError) discard();
    wasApplying.current = applying;
  }, [applying, applyError, discard]);

  return (
    <Paper
      radius="sm"
      px="md"
      py={8}
      data-testid={`layer-row-${rowId}`}
      data-winner={role === 'winner' || undefined}
      data-overridden={role === 'overridden' || undefined}
    >
      <Group gap="md" wrap="nowrap" align="baseline">
        <Text size="sm" fw={role === 'winner' ? 700 : 500} w={104} style={{ flex: 'none' }}>
          {row.scope}
        </Text>
        {role === 'winner' && <Badge size="xs">wins</Badge>}
        {role === 'contributor' && (
          <Badge size="xs" variant="light">
            contributes
          </Badge>
        )}
        {row.shadowed && (
          <Badge size="xs" variant="light" color="warn">
            ignored — teamLocked
          </Badge>
        )}
        {row.invalid && (
          <Badge size="xs" variant="light" color="bad">
            refused
          </Badge>
        )}
        <RowBody def={def} row={row} role={role} />
        {composite ? (
          <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
            composite value — edit the file
          </Text>
        ) : editable ? (
          !editing && (
            <Tooltip label="Edit">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={openEdit}
                aria-label={`edit ${rowId}`}
                data-testid={`edit-layer-${rowId}`}
                style={{ flex: 'none' }}
              >
                <Icons.edit size={12} />
              </ActionIcon>
            </Tooltip>
          )
        ) : (
          <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
            not allowed at this layer (allowed: {def.scopes.join(', ')})
          </Text>
        )}
        <Text size="xs" c={text.dimmed} ff="monospace" truncate style={{ flex: 1 }}>
          {row.file ?? 'registry default'}
        </Text>
      </Group>
      {row.invalid && (
        <Text size="xs" c={text.muted} pl={104}>
          {row.invalid}
        </Text>
      )}
      {editable && editing && !staged && (
        <Group gap={6} wrap="nowrap" align="center" pl={104} pt={6}>
          <EditControl def={def} draft={draft} onChange={setDraft} />
          <Button size="xs" onClick={() => setStaged(true)}>
            Stage
          </Button>
        </Group>
      )}
      {editable && staged && scope && (
        <Stack
          gap={6}
          pl={104}
          pt="sm"
          mt={6}
          style={{ borderTop: `1px solid ${border.default}` }}
          data-testid={`layer-stage-${rowId}`}
        >
          <Group gap={6} wrap="nowrap">
            <Icons.checkCircle size={14} color={text.muted} />
            <Text size="sm" fw={600}>
              1 change staged — nothing is written until you apply
            </Text>
          </Group>
          <Text size="xs" ff="monospace">
            {row.present ? shortValue(row.value) : 'unset'} → {shortValue(draft)}
          </Text>
          <Paper radius="sm" p="xs" style={{ border: `1px solid ${border.default}` }}>
            <Text
              size="xs"
              ff="monospace"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              {`rt settings set ${def.key} '${JSON.stringify(draft)}' --scope ${scope}`}
            </Text>
          </Paper>
          <Text size="xs" c={text.muted}>
            writes the {scope} store, then this chain re-reads
          </Text>
          {applyError && (
            <Alert variant="light" color="bad" icon={<Icons.error size={14} />}>
              <Text size="xs">{applyError}</Text>
            </Alert>
          )}
          <Group gap={6} justify="flex-end">
            <Button size="xs" variant="default" disabled={applying} onClick={discard}>
              Discard
            </Button>
            <Button
              size="xs"
              disabled={applying}
              loading={applying}
              onClick={() => onApply?.(draft, scope)}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      )}
    </Paper>
  );
}

function EditControl({
  def,
  draft,
  onChange,
}: {
  def: SettingDefWire;
  draft: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = `new value for ${def.key}`;

  if (def.type === 'boolean')
    return (
      <Select
        size="xs"
        w={100}
        data={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
        ]}
        value={draft === true ? 'true' : 'false'}
        onChange={value => onChange(value === 'true')}
        allowDeselect={false}
        aria-label={label}
      />
    );

  if (def.type === 'number')
    return (
      <NumberInput
        size="xs"
        w={140}
        value={typeof draft === 'number' ? draft : ''}
        onChange={value => onChange(typeof value === 'number' ? value : Number(value) || 0)}
        aria-label={label}
      />
    );

  return (
    <TextInput
      size="xs"
      w={200}
      value={typeof draft === 'string' ? draft : ''}
      onTextChange={onChange}
      aria-label={label}
    />
  );
}

function RowBody({ def, row, role }: LayerRowProps) {
  const { text } = useSchemeColors();

  if (!row.present)
    return (
      <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
        not set at this layer
      </Text>
    );
  if (def.secret)
    return (
      <Text size="xs" c={text.muted} style={{ flex: 'none' }}>
        value present — never shown here
      </Text>
    );
  return (
    <Text
      size="sm"
      ff="monospace"
      style={{
        flex: 'none',
        textDecoration: role === 'overridden' ? 'line-through' : undefined,
      }}
      data-testid={`layer-value-${row.scope}`}
    >
      {shortValue(row.value)}
    </Text>
  );
}
