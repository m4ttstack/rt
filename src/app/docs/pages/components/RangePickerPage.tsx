import { useState } from 'react';

import { RangePicker, Stack, Text } from '@ui/core';
import type { RangePickerValue } from '@ui/core';
import { ComponentDoc } from '../../ComponentDoc';
import { DocSection } from '../../DocPage';

const USAGE = [
  "import { RangePicker } from '@ui/core';",
  "import type { RangePickerValue } from '@ui/core';",
  '',
  'const [range, setRange] = useState<RangePickerValue>([null, null]);',
  '',
  'const DAY = 24 * 60 * 60 * 1000;',
  'const now = new Date();',
  '',
  '<RangePicker',
  '  value={range}',
  '  onChange={setRange}',
  '  presets={[',
  "    { label: 'Last 7 days', value: [new Date(now.getTime() - 7 * DAY), now] },",
  "    { label: 'Last 30 days', value: [new Date(now.getTime() - 30 * DAY), now] },",
  '  ]}',
  '/>;',
].join('\n');

// Rows transcribed from src/ui/core/range-picker/RangePicker.tsx
// (RangePickerProps).
const PROPS_ROWS = [
  {
    name: 'value',
    type: 'RangePickerValue',
    note: 'Required. [start, end], each a Date or null -- [null, null] is the empty state. The component is fully controlled.',
  },
  {
    name: 'onChange',
    type: '(value: RangePickerValue) => void',
    note: 'Required. Called with real Date objects (start-only mid-pick arrives as [Date, null]).',
  },
  {
    name: 'minDate? / maxDate?',
    type: 'Date',
    note: 'Bounds on what the calendar allows.',
  },
  {
    name: 'valueFormat?',
    type: 'string',
    note: "dayjs format for the input's display value. Default 'MMM D, YYYY'.",
  },
  {
    name: 'presets?',
    type: 'RangePickerPreset[]',
    note: "Quick-pick ranges shown alongside the calendar -- { label: ReactNode, value: [Date, Date] } each, riding @mantine/dates' native presets support.",
  },
  {
    name: '...rest',
    type: "DatePickerInputProps<'range'>",
    note: "Passthrough to the underlying DatePickerInput (label, clearable, numberOfColumns, ...); type/value/onChange/presets/valueFormat are owned by the wrapper. Default placeholder 'Pick a date range'.",
  },
];

const DAY = 24 * 60 * 60 * 1000;

function formatDate(value: Date | null) {
  return value
    ? value.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'null';
}

function RangePickerDemo() {
  const [range, setRange] = useState<RangePickerValue>([null, null]);
  const now = new Date();

  return (
    <Stack gap="sm" maw={360}>
      <RangePicker
        label="Checkout window"
        value={range}
        onChange={setRange}
        clearable
        presets={[
          {
            label: 'Last 7 days',
            value: [new Date(now.getTime() - 7 * DAY), now],
          },
          {
            label: 'Last 30 days',
            value: [new Date(now.getTime() - 30 * DAY), now],
          },
          {
            label: 'This month',
            value: [new Date(now.getFullYear(), now.getMonth(), 1), now],
          },
        ]}
      />
      <Text size="sm" c="dimmed">
        onChange value: [{formatDate(range[0])}, {formatDate(range[1])}]
      </Text>
    </Stack>
  );
}

export function RangePickerPage() {
  return (
    <ComponentDoc
      title="RangePicker"
      lead="A date-range picker on @mantine/dates' DatePickerInput (type='range'), exposing a Date-based API: your value and onChange work in real Date objects, with quick-pick presets riding the native presets support."
      demoIntro="Pick a range from the calendar or hit a preset -- the caller-side value updates below (note the [Date, null] intermediate state while a range is half-picked)."
      demo={<RangePickerDemo />}
      usage={USAGE}
      usageMinHeight={420}
      propsTables={[{ title: 'Props', rows: PROPS_ROWS }]}
    >
      <DocSection title="Notes">
        <Text size="sm">
          The wrapper exists to bridge an API mismatch: @mantine/dates&apos; own
          onChange always hands back plain ISO date strings, never Date objects,
          so RangePicker converts both ways (via dayjs) and your code never
          touches the string form -- preset values included. Expect the
          half-picked intermediate state: after the first calendar click,
          onChange fires with [start, null] until the second date lands.
        </Text>
      </DocSection>
    </ComponentDoc>
  );
}
