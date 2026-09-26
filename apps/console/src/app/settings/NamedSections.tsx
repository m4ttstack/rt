import { useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { Icons } from '@mattstack/app-kit/icons';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import { INPUT_TYPE } from './controlStyles';
import { FieldGrid } from './FieldGrid';
import { newEntry, type FormShape } from './formShape';
import { footerSummary, issuesByCard, issuesUnder } from './issues';
import { CARD_STYLE, CardAction, CardsFooter } from './ItemCards';

type Entry = Record<string, unknown>;

const NO_TOUCHED: ReadonlySet<string> = new Set();

/** One card per entry, titled by its own name (no reorder: the name is the
    entry's identity). A new entry needs a name that is neither empty nor
    already taken. */
export function NamedSections({
  shape,
  value,
  onChange,
  disabled,
  issues,
  footerEnd,
  issueTestId,
}: {
  shape: FormShape;
  value: Record<string, Entry>;
  onChange: (next: Record<string, Entry>) => void;
  disabled: boolean;
  issues: SchemaIssue[];
  footerEnd: ReactNode;
  issueTestId?: string;
}) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  // A Map, not a Record: an entry can be named "constructor" or
  // "toString", and a plain-object lookup for a key not yet touched would
  // resolve to the inherited Object.prototype function of that name
  // instead of undefined. Seeded from the mount-time issues, so an entry
  // opened already nonconforming starts touched on its own bad fields.
  const [touched, setTouched] = useState<Map<string, Set<string>>>(() => {
    const seed = new Map<string, Set<string>>();
    for (const [card, fields] of issuesByCard(issues))
      if (typeof card === 'string') seed.set(card, new Set(fields));
    return seed;
  });
  const [noun] = shape.labels;

  const add = () => {
    const n = name.trim();
    if (!n) return setNameError(`${noun} is required`);
    if (Object.hasOwn(value, n)) return setNameError(`${n} already exists`);
    onChange({ ...value, [n]: newEntry(shape) });
    setName('');
    setNameError(null);
  };
  const remove = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
    setTouched(t => {
      if (!t.has(key)) return t;
      const untouched = new Map(t);
      untouched.delete(key);
      return untouched;
    });
  };
  const markTouched = (key: string, field: string) =>
    setTouched(t => {
      if (t.get(key)?.has(field)) return t;
      const next = new Map(t);
      const set = new Set(t.get(key));
      set.add(field);
      next.set(key, set);
      return next;
    });

  const summary = footerSummary(
    issues,
    new Map(Object.keys(value).map(k => [k, touched.get(k) ?? NO_TOUCHED]))
  );

  return (
    <Stack gap={8}>
      {Object.entries(value).map(([key, entry]) => (
        <Box key={key} p={12} style={CARD_STYLE} data-testid={`entry-${key}`}>
          <Group justify="space-between" wrap="nowrap" pb={4}>
            <Text fz={12} fw={500} ff="monospace" c="var(--tk-text-1)" truncate>
              {key}
            </Text>
            <CardAction
              label={`remove entry ${key}`}
              icon={<Icons.trash size={14} />}
              disabled={disabled}
              onClick={() => remove(key)}
            />
          </Group>
          <FieldGrid
            shape={shape}
            entry={entry}
            disabled={disabled}
            issues={issuesUnder(issues, key)}
            touched={touched.get(key) ?? NO_TOUCHED}
            onTouch={field => markTouched(key, field)}
            onChange={e => onChange({ ...value, [key]: e })}
          />
        </Box>
      ))}
      <CardsFooter
        leading={
          <>
            <TextInput
              aria-label={`new ${noun}`}
              size="xs"
              w={200}
              style={{ flex: 'none' }}
              styles={INPUT_TYPE.code}
              placeholder={noun}
              disabled={disabled}
              error={Boolean(nameError)}
              value={name}
              onTextChange={v => {
                setName(v);
                setNameError(null);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') add();
              }}
            />
            <Button
              size="compact-sm"
              variant="default"
              disabled={disabled}
              leftSection={<Icons.plus size={14} />}
              onClick={add}
              style={{ flex: 'none' }}
            >
              Add entry
            </Button>
            {nameError && (
              <Text
                fz={12}
                c="var(--tk-text-bad-small)"
                truncate
                title={nameError}
                style={{ minWidth: 0 }}
              >
                {nameError}
              </Text>
            )}
          </>
        }
        summary={summary}
        footerEnd={footerEnd}
        issueTestId={issueTestId}
      />
    </Stack>
  );
}
