import type { ReactNode } from 'react';
import { DatePickerInput } from '@mantine/dates';
import type { DatePickerInputProps } from '@mantine/dates';
import dayjs from 'dayjs';

export type RangePickerValue = [Date | null, Date | null];

export interface RangePickerPreset {
  label: ReactNode;
  value: [Date, Date];
}

export interface RangePickerProps extends Omit<
  DatePickerInputProps<'range'>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'presets' | 'valueFormat'
> {
  value: RangePickerValue;
  onChange: (value: RangePickerValue) => void;
  minDate?: Date;
  maxDate?: Date;
  /** `dayjs` format for the input's display value. @default 'MMM D, YYYY' */
  valueFormat?: string;
  /** Quick-pick ranges shown in the dropdown (native `@mantine/dates` presets list). */
  presets?: RangePickerPreset[];
}

const toDate = (value: string | Date | null | undefined): Date | null =>
  value ? dayjs(value).toDate() : null;
const toDateString = (value: Date): string => dayjs(value).format('YYYY-MM-DD');

/**
 * A date-range picker on `@mantine/dates`' `DatePickerInput` (`type="range"`).
 *
 * `dayjs` bridges an API mismatch: `@mantine/dates`' own `onChange` always
 * hands back plain ISO date *strings* (`DateStringValue`), never `Date`
 * objects, so this wrapper converts both ways to expose a `Date`-based API
 * to callers.
 *
 * Supports `presets` (quick-pick ranges) which `@mantine/dates`' own
 * `DatePickerInput` supports natively, with `RangePickerPreset`'s `Date`
 * values converted through the same `dayjs` bridge.
 */
export function RangePicker({
  value,
  onChange,
  minDate,
  maxDate,
  valueFormat = 'MMM D, YYYY',
  presets,
  ...props
}: RangePickerProps) {
  return (
    <DatePickerInput
      type="range"
      value={value}
      onChange={([start, end]) => onChange([toDate(start), toDate(end)])}
      minDate={minDate}
      maxDate={maxDate}
      valueFormat={valueFormat}
      placeholder="Pick a date range"
      presets={presets?.map(preset => ({
        label: preset.label,
        value: [
          toDateString(preset.value[0]),
          toDateString(preset.value[1]),
        ] as [string, string],
      }))}
      {...props}
    />
  );
}
