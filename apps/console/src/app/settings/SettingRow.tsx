import { useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Collapse,
  Group,
  Highlight,
  Stack,
  Text,
  type TextProps,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import {
  formatValue,
  rowKind,
  SHAPES,
  summarize,
} from '@mattstack/settings-kit/shapes';

import { compositeParts } from './CompositeControls';
import { RowMenu } from './RowMenu';
import { ScalarControl } from './ScalarControl';
import { ScopeBadge } from './ScopeBadge';
import { useRowSave, type RowStore } from './useRowSave';
import {
  badgeScope,
  firstSentence,
  sourceText,
  splitKey,
  type StoreScope,
} from './view';

function Marked({
  text,
  query,
  ...props
}: { text: string; query: string } & Omit<TextProps, 'color'>) {
  return query.trim() === '' ? (
    <Text {...props}>{text}</Text>
  ) : (
    <Highlight
      {...props}
      highlight={query.trim()}
      highlightStyles={{
        backgroundColor: 'var(--mantine-color-warn-light)',
        color: 'inherit',
      }}
    >
      {text}
    </Highlight>
  );
}

export function SettingRow({
  def,
  store,
  subhead,
  query,
  suggestions,
  onExplain,
  fullDescription = false,
}: {
  def: SettingDefWire;
  store: RowStore;
  subhead: StoreScope | null;
  query: string;
  suggestions?: string[];
  onExplain?: (key: string) => void;
  fullDescription?: boolean;
}) {
  const { text } = useSchemeColors();
  const row = useRowSave(store, def);
  const [open, setOpen] = useState(false);
  const kind = rowKind(def);
  const [ns, name] = splitKey(def.key);
  const badge = badgeScope(def, subhead);
  const plain = sourceText(def);

  let control: ReactNode;
  let body: ReactNode = null;
  if (kind === 'scalar' || kind === 'enum') {
    control = (
      <ScalarControl
        def={def}
        onSave={v => void row.save(v)}
        suggestions={suggestions}
      />
    );
  } else if (kind === 'external') {
    const shape = SHAPES[def.key];
    const owner = shape?.kind === 'external' ? shape.app : 'another app';
    control = (
      <Text fz={12} c={text.muted}>
        {def.effective.value === undefined
          ? `edited in ${owner}`
          : `${summarize(def)} · edited in ${owner}`}
      </Text>
    );
  } else if (
    kind === 'readonly' &&
    def.type !== 'object' &&
    def.type !== 'array'
  ) {
    // An unset or rejected value is already said by the source text or the
    // error line; the control repeats nothing.
    const shown = def.secret
      ? def.effective.scope === null
        ? null
        : '•••'
      : def.effective.value === undefined
        ? null
        : formatValue(def.effective.value);
    control =
      shown === null ? null : (
        <Text fz={12} c={text.muted} ff="monospace">
          {shown}
        </Text>
      );
  } else {
    const composite = compositeParts(def, kind, row, open, () =>
      setOpen(o => !o)
    );
    control = composite.control;
    body = composite.body;
  }

  return (
    <Box
      data-key={def.key}
      style={{ borderBottom: '1px solid var(--tk-border-soft)' }}
    >
      <Group gap={24} wrap="nowrap" py={12}>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={8} wrap="nowrap">
            <Text fz={14} lh="18px" ff="monospace" span>
              <Text span inherit c={text.muted}>
                {ns}
              </Text>
              <Marked text={name} query={query} span inherit fw={500} />
            </Text>
            {badge ? (
              <ScopeBadge scope={badge} />
            ) : plain ? (
              <Text fz={12} c={text.muted}>
                {plain}
              </Text>
            ) : null}
          </Group>
          <Marked
            text={
              fullDescription ? def.description : firstSentence(def.description)
            }
            query={query}
            fz={12}
            lh="15px"
            c={text.muted}
            lineClamp={fullDescription ? undefined : 1}
          />
        </Stack>
        <Group w={260} gap={8} wrap="nowrap" style={{ flex: 'none' }}>
          {control}
          {row.status === 'saving' && (
            <Text fz={12} c={text.muted}>
              saving…
            </Text>
          )}
          {row.status === 'saved' && (
            <Group gap={4} wrap="nowrap">
              <Text fz={12} c="var(--tk-text-ok-small)">
                saved
              </Text>
              <Icons.check size={12} color="var(--tk-text-ok-vivid)" />
            </Group>
          )}
        </Group>
        <Group gap={4} wrap="nowrap" style={{ flex: 'none' }}>
          <RowMenu def={def} row={row} />
          {onExplain && (
            <ActionIcon
              variant="subtle"
              color="gray"
              c={text.muted}
              aria-label={`explain ${def.key}`}
              onClick={() => onExplain(def.key)}
            >
              <Icons.chevronRight size={16} />
            </ActionIcon>
          )}
        </Group>
      </Group>
      {(row.error || def.effective.invalid) && (
        <Stack gap={4} pb={12}>
          {row.error && (
            <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
              {row.error}
            </Text>
          )}
          {def.effective.invalid && (
            <Text fz={12} ff="monospace" c="var(--tk-text-bad-small)">
              stored value rejected: {def.effective.invalid}
            </Text>
          )}
        </Stack>
      )}
      {body && <Collapse expanded={open}>{body}</Collapse>}
    </Box>
  );
}
