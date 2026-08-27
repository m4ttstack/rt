import { useState } from 'react';
import { Stack, Text } from '@mantine/core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AcceptableList } from './AcceptableList';

const meta = {
  title: 'Core/AcceptableList',
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

interface Request {
  id: string;
  title: string;
  detail: string;
}

const seedRequests: Request[] = [
  {
    id: '1',
    title: 'Alice Kim',
    detail: 'Asking to borrow the field camera',
  },
  {
    id: '2',
    title: 'Bilal Ortiz',
    detail: 'Asking to borrow the travel tripod',
  },
  { id: '3', title: 'Chen Wu', detail: 'Asking to borrow the podcast mic kit' },
];

function AcceptableListDemo() {
  const [requests, setRequests] = useState(seedRequests);
  const [acceptingIds, setAcceptingIds] = useState<Set<string>>(new Set());
  const [decliningIds, setDecliningIds] = useState<Set<string>>(new Set());

  const settle = (
    id: string,
    ids: typeof acceptingIds,
    setIds: typeof setAcceptingIds
  ) => {
    const next = new Set(ids);
    next.add(id);
    setIds(next);
    setTimeout(() => {
      setRequests(current => current.filter(r => r.id !== id));
      setIds(current => {
        const cleared = new Set(current);
        cleared.delete(id);
        return cleared;
      });
    }, 600);
  };

  return (
    <Stack w={480}>
      <AcceptableList
        items={requests}
        getItemId={item => item.id}
        renderItemDetail={item => (
          <div>
            <Text fw={500}>{item.title}</Text>
            <Text size="sm" c="dimmed">
              {item.detail}
            </Text>
          </div>
        )}
        acceptingIds={acceptingIds}
        decliningIds={decliningIds}
        onAccept={item => settle(item.id, acceptingIds, setAcceptingIds)}
        onDecline={item => settle(item.id, decliningIds, setDecliningIds)}
        onAcceptAll={() => setRequests([])}
      />
    </Stack>
  );
}

export const Default: Story = {
  render: () => <AcceptableListDemo />,
};

export const Empty: Story = {
  render: () => (
    <Stack w={480}>
      <AcceptableList
        items={[]}
        getItemId={(item: Request) => item.id}
        renderItemDetail={item => item.title}
        onAccept={() => {}}
        onDecline={() => {}}
      />
    </Stack>
  ),
};
