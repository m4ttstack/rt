import { useRef, useState } from 'react';
import {
  Autocomplete,
  Group,
  NumberInput,
  Select,
  Switch,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';
import { ENUMS } from '@mattstack/settings-kit/shapes';

import {
  enumWidth,
  INPUT_TYPE,
  numberWidth,
  SWITCH_SIZE,
} from './controlStyles';
import { unitOf } from './units';
import { isStoreScope } from './view';

const OPTION_LABELS: Record<string, Record<string, string>> = {
  'agent.provider': { claude: 'Claude', codex: 'Codex' },
};

/** The text and number inputs are uncontrolled so a refused save leaves the
    typed text in place. They are keyed on the effective scope and value, or a
    refresh leaves stale text that the next blur writes back. Switch and
    Select are controlled and unkeyed, so a save never drops their focus. */
export function ScalarControl({
  def,
  onSave,
  suggestions,
}: {
  def: SettingDefWire;
  onSave: (value: unknown) => void;
  suggestions?: string[];
}) {
  const { text } = useSchemeColors();
  const value = def.effective.value;
  const label = def.key;
  const [resets, setResets] = useState(0);
  const abandoned = useRef(false);
  const seed = JSON.stringify([def.effective.scope, value, resets]);
  // A default or unset value has no store layer to unset; emptying the field
  // just restores the text the value still resolves to.
  const clear = () =>
    isStoreScope(def.effective.scope)
      ? onSave(undefined)
      : setResets(n => n + 1);

  if (def.type === 'boolean')
    return (
      <Switch
        aria-label={label}
        size="sm"
        style={SWITCH_SIZE}
        checked={value === true}
        onChange={e => onSave(e.currentTarget.checked)}
      />
    );

  const options = ENUMS[def.key];
  if (options) {
    const labels = OPTION_LABELS[def.key] ?? {};
    const data = options.map(o => ({ value: o, label: labels[o] ?? o }));
    return (
      <Select
        aria-label={label}
        size="xs"
        w={enumWidth(data.map(o => o.label))}
        styles={INPUT_TYPE.label}
        placeholder="unset"
        data={data}
        value={typeof value === 'string' ? value : null}
        allowDeselect={false}
        onChange={v => {
          if (v !== null && v !== value) onSave(v);
        }}
      />
    );
  }

  if (def.type === 'number') {
    const unit = unitOf(def.key);
    return (
      <Group gap={8} wrap="nowrap">
        <NumberInput
          key={seed}
          aria-label={label}
          size="xs"
          w={numberWidth(value)}
          styles={INPUT_TYPE.number}
          placeholder="unset"
          hideControls
          defaultValue={typeof value === 'number' ? value : undefined}
          onKeyDown={e => {
            if (e.key === 'Escape') abandoned.current = true;
            if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
          }}
          onBlur={e => {
            if (abandoned.current) {
              abandoned.current = false;
              setResets(n => n + 1);
              return;
            }
            const raw = e.currentTarget.value.trim();
            if (raw === '') {
              if (value !== undefined) clear();
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

  const current = typeof value === 'string' ? value : '';
  const commit = (next: string) => {
    if (next === current) return;
    if (next === '') clear();
    else onSave(next);
  };
  if (suggestions)
    return (
      <SuggestInput
        key={seed}
        label={label}
        initial={current}
        suggestions={suggestions}
        commit={commit}
        abandon={() => setResets(n => n + 1)}
      />
    );
  return (
    <TextInput
      key={seed}
      aria-label={label}
      size="xs"
      w={200}
      styles={INPUT_TYPE.code}
      placeholder="unset"
      defaultValue={current}
      onKeyDown={e => {
        if (e.key === 'Escape') e.currentTarget.value = current;
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
      }}
      onBlur={e => commit(e.currentTarget.value)}
    />
  );
}

function SuggestInput({
  label,
  initial,
  suggestions,
  commit,
  abandon,
}: {
  label: string;
  initial: string;
  suggestions: string[];
  commit: (next: string) => void;
  abandon: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const picked = useRef<string | null>(null);
  const abandoned = useRef(false);
  return (
    <Autocomplete
      ref={input}
      aria-label={label}
      size="xs"
      w={200}
      styles={INPUT_TYPE.label}
      placeholder="unset"
      data={suggestions}
      defaultValue={initial}
      onKeyDown={e => {
        // An open dropdown takes the first Escape; the next one abandons.
        if (
          e.key === 'Escape' &&
          e.currentTarget.getAttribute('aria-expanded') !== 'true'
        ) {
          abandoned.current = true;
          e.currentTarget.blur();
          return;
        }
        // The combobox runs this before it submits the highlighted option,
        // and the input still holds the typed fragment until that submit.
        if (e.key !== 'Enter') return;
        if (e.currentTarget.getAttribute('aria-activedescendant')) return;
        e.currentTarget.blur();
      }}
      onOptionSubmit={v => {
        picked.current = v;
        input.current?.blur();
      }}
      onBlur={e => {
        if (abandoned.current) {
          abandoned.current = false;
          picked.current = null;
          abandon();
          return;
        }
        commit(picked.current ?? e.currentTarget.value);
        picked.current = null;
      }}
    />
  );
}
