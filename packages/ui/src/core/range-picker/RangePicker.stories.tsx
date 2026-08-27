import { useState } from 'react';
import { Box, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import dayjs from 'dayjs';

import { RangePicker } from './RangePicker';
import type { RangePickerValue } from './RangePicker';

const meta = {
  title: 'Core/RangePicker',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function RangePickerDemo() {
  const [value, setValue] = useState<RangePickerValue>([null, null]);

  return (
    <Box p="xl" maw={360}>
      <RangePicker
        value={value}
        onChange={setValue}
        presets={[
          {
            label: 'Last 7 days',
            value: [dayjs().subtract(7, 'day').toDate(), dayjs().toDate()],
          },
          {
            label: 'Last 30 days',
            value: [dayjs().subtract(30, 'day').toDate(), dayjs().toDate()],
          },
          {
            label: 'This month',
            value: [
              dayjs().startOf('month').toDate(),
              dayjs().endOf('month').toDate(),
            ],
          },
        ]}
        clearable
      />
      <Text size="sm" mt="md" c="dimmed">
        {value[0] && value[1]
          ? `${dayjs(value[0]).format('MMM D, YYYY')} to ${dayjs(value[1]).format('MMM D, YYYY')}`
          : 'No range selected'}
      </Text>
    </Box>
  );
}

export const Default: Story = {
  render: () => <RangePickerDemo />,
};

export const WithMinMax: Story = {
  render: () => {
    const today = dayjs();
    return (
      <Box p="xl" maw={360}>
        <RangePicker
          value={[null, null]}
          onChange={() => {}}
          minDate={today.subtract(30, 'day').toDate()}
          maxDate={today.toDate()}
        />
      </Box>
    );
  },
};
