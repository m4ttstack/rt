import { Fragment, useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import { FieldGrid } from './FieldGrid';
import { newEntry, type FormShape } from './formShape';
import {
  footerSummary,
  issuesByCard,
  issuesUnder,
  type FooterSummary,
} from './issues';

type Entry = Record<string, unknown>;

/** The footer's issue segments in display order: the touched-field issue
    and the fallback both block Save the same way a touched issue does, so
    both read in the bad colour; the note is informational. */
function footerSegments(
  summary: FooterSummary
): { text: string; color: string }[] {
  const segs: { text: string; color: string }[] = [];
  if (summary.touchedText)
    segs.push({ text: summary.touchedText, color: 'var(--tk-text-bad-small)' });
  if (summary.fallbackText)
    segs.push({
      text: summary.fallbackText,
      color: 'var(--tk-text-bad-small)',
    });
  if (summary.noteText)
    segs.push({ text: summary.noteText, color: 'var(--tk-text-3)' });
  return segs;
}

/** Item cards' and named sections' shared footer: a leading add control,
    the issue summary (shrinks and truncates first so it never displaces the
    buttons), then Cancel/Save. */
export function CardsFooter({
  leading,
  summary,
  footerEnd,
  issueTestId,
}: {
  leading: ReactNode;
  summary: FooterSummary;
  footerEnd: ReactNode;
  issueTestId?: string;
}) {
  return (
    <Group wrap="nowrap" gap={8} align="center">
      {/* Can shrink -- a long name error inside (NamedSections) must give
          way before Cancel/Save do; its own flex-none controls hold their
          size regardless. */}
      <Group
        gap={8}
        wrap="nowrap"
        align="center"
        style={{ flex: '0 1 auto', minWidth: 0 }}
      >
        {leading}
      </Group>
      <Group
        gap={8}
        wrap="nowrap"
        justify="flex-end"
        data-testid={issueTestId}
        style={{ flex: 1, minWidth: 0 }}
      >
        {footerSegments(summary).map((seg, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <Text fz={12} c="var(--tk-text-3)" style={{ flex: 'none' }}>
                ·
              </Text>
            )}
            <Text
              fz={12}
              c={seg.color}
              truncate
              title={seg.text}
              style={{ minWidth: 0 }}
            >
              {seg.text}
            </Text>
          </Fragment>
        ))}
      </Group>
      <Group gap={8} wrap="nowrap" style={{ flex: 'none' }}>
        {footerEnd}
      </Group>
    </Group>
  );
}

// --tk-card reads almost flat against the page in dark scheme; --tk-raised
// is the step tuned to read as a distinct surface in both schemes.
export const CARD_STYLE = {
  border: '1px solid var(--tk-border-soft)',
  borderRadius: 4,
  background: 'var(--tk-raised)',
} as const;

const NO_TOUCHED: ReadonlySet<string> = new Set();

/** A card head icon button. Enabled reads in the muted role colour;
    disabled leaves colour to Mantine's own disabled styling (it already
    sets a readable, faded text colour) and clears its filled disabled
    background, which otherwise reads as a selected square rather than an
    unavailable action. */
export function CardAction({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  const { text } = useSchemeColors();
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      c={disabled ? undefined : text.muted}
      style={disabled ? { background: 'transparent' } : undefined}
      size="sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </ActionIcon>
  );
}

/** One card per item, in order. Cards carry stable ids so a card's local
    state (the optional fields it revealed, its touched fields) follows it
    through a reorder. */
export function ItemCards({
  shape,
  value,
  onChange,
  disabled,
  issues,
  footerEnd,
  issueTestId,
}: {
  shape: FormShape;
  value: Entry[];
  onChange: (next: Entry[]) => void;
  disabled: boolean;
  issues: SchemaIssue[];
  footerEnd: ReactNode;
  issueTestId?: string;
}) {
  const next = useRef(value.length);
  const [ids, setIds] = useState(() => value.map((_, i) => i));
  // Seeded from the mount-time issues (ids[i] === i at mount, before any
  // reorder), so a card opened already nonconforming starts touched on its
  // own bad fields instead of waiting for the user to touch them first.
  const [touched, setTouched] = useState<Record<number, Set<string>>>(() => {
    const seed: Record<number, Set<string>> = {};
    for (const [card, fields] of issuesByCard(issues))
      if (typeof card === 'number') seed[card] = new Set(fields);
    return seed;
  });
  const swap = <T,>(list: T[], a: number, b: number) => {
    const out = [...list];
    [out[a], out[b]] = [out[b]!, out[a]!];
    return out;
  };
  const move = (from: number, to: number) => {
    setIds(swap(ids, from, to));
    onChange(swap(value, from, to));
  };
  const remove = (at: number) => {
    setIds(ids.filter((_, i) => i !== at));
    onChange(value.filter((_, i) => i !== at));
  };
  const add = () => {
    setIds([...ids, next.current++]);
    onChange([...value, newEntry(shape)]);
  };
  const markTouched = (id: number, name: string) =>
    setTouched(t => {
      if (t[id]?.has(name)) return t;
      const set = new Set(t[id]);
      set.add(name);
      return { ...t, [id]: set };
    });
  const first = shape.required[0];
  const summary = footerSummary(
    issues,
    new Map(ids.map((id, i) => [i, touched[id] ?? NO_TOUCHED]))
  );

  return (
    <Stack gap={8}>
      {value.map((item, i) => (
        <Box key={ids[i]} p={12} style={CARD_STYLE} data-testid={`item-${i}`}>
          <Group justify="space-between" wrap="nowrap" pb={4}>
            <Text fz={12} ff="monospace" truncate>
              <Text span inherit c="var(--tk-text-3)">
                {`#${i + 1}`}
              </Text>
              {first && typeof item[first] === 'string' && (
                <Text span inherit fw={500} c="var(--tk-text-1)">
                  {`  ${item[first] as string}`}
                </Text>
              )}
            </Text>
            <Group gap={2} wrap="nowrap">
              <CardAction
                label={`move item ${i + 1} up`}
                icon={<Icons.chevronUp size={14} />}
                disabled={disabled || i === 0}
                onClick={() => move(i, i - 1)}
              />
              <CardAction
                label={`move item ${i + 1} down`}
                icon={<Icons.chevronDown size={14} />}
                disabled={disabled || i === value.length - 1}
                onClick={() => move(i, i + 1)}
              />
              <CardAction
                label={`remove item ${i + 1}`}
                icon={<Icons.trash size={14} />}
                disabled={disabled}
                onClick={() => remove(i)}
              />
            </Group>
          </Group>
          <FieldGrid
            shape={shape}
            entry={item}
            disabled={disabled}
            issues={issuesUnder(issues, i)}
            touched={touched[ids[i]!] ?? NO_TOUCHED}
            onTouch={name => markTouched(ids[i]!, name)}
            onChange={e => onChange(value.map((x, j) => (j === i ? e : x)))}
          />
        </Box>
      ))}
      <CardsFooter
        leading={
          <Button
            size="compact-sm"
            variant="default"
            disabled={disabled}
            leftSection={<Icons.plus size={14} />}
            onClick={add}
            style={{ flex: 'none' }}
          >
            Add item
          </Button>
        }
        summary={summary}
        footerEnd={footerEnd}
        issueTestId={issueTestId}
      />
    </Stack>
  );
}
