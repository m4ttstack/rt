import { useState } from 'react';
import { Button, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { z } from 'zod';

import { Table, TextInput } from '@mattstack/app-kit/core';
import { FormContainer, identifierRegex, useModalForm, zodResolver } from '.';

const meta = {
  title: 'UI/Forms',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

// --- Form page: FormContainer + a standalone zod-validated form ------------

const gearItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Item name is required')
    .regex(
      identifierRegex,
      'Only letters, numbers, and underscores are allowed'
    ),
  description: z.string().optional(),
});

type GearItem = z.infer<typeof gearItemSchema>;

function FormPageDemo() {
  const [saved, setSaved] = useState<GearItem | null>(null);

  const form = useForm({
    initialValues: { name: '', description: '' },
    validate: zodResolver(gearItemSchema),
  });

  return (
    <Container py="lg" size="sm">
      <Title order={2} mb="sm">
        Form page
      </Title>
      <FormContainer
        form={form}
        onSubmit={values => {
          setSaved(values);
          form.reset();
        }}
      >
        <TextInput
          label="Item name"
          placeholder="camera_kit"
          {...form.getInputProps('name')}
        />
        <TextInput
          label="Description"
          placeholder="Optional"
          {...form.getInputProps('description')}
        />
      </FormContainer>

      {saved ? (
        <Text size="sm" mt="md" c="dimmed">
          Last saved: {saved.name}{' '}
          {saved.description ? `(${saved.description})` : ''}
        </Text>
      ) : null}
    </Container>
  );
}

export const FormPage: Story = {
  render: () => <FormPageDemo />,
};

// --- Plain: chrome-free FormContainer inside a host-owned surface ----------

function PlainFormDemo() {
  const form = useForm({
    initialValues: { name: '', description: '' },
    validate: zodResolver(gearItemSchema),
  });

  return (
    <Container py="lg" size="sm">
      <Title order={2} mb="sm">
        Plain form in a host surface
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        `plain` skips FormContainer&apos;s own Paper chrome entirely -- here the
        outer Paper owns the surface, the same situation `useModalForm` handles
        automatically inside a modal body.
      </Text>
      <Paper withBorder p="lg">
        <FormContainer form={form} onSubmit={() => {}} plain>
          <TextInput
            label="Item name"
            placeholder="camera_kit"
            {...form.getInputProps('name')}
          />
          <TextInput
            label="Description"
            placeholder="Optional"
            {...form.getInputProps('description')}
          />
        </FormContainer>
      </Paper>
    </Container>
  );
}

export const PlainForm: Story = {
  name: 'plain (host-owned surface)',
  render: () => <PlainFormDemo />,
};

// --- Modal form: useModalForm hosting the same schema via @mattstack/app-kit/modals -------

function ModalFormDemo() {
  const [items, setItems] = useState<GearItem[]>([]);

  const { open } = useModalForm({
    schema: gearItemSchema,
    initialValues: { name: '', description: '' },
    successMessage: 'Gear item added',
    modalProps: { title: 'Add gear item' },
    onSubmit: async values => {
      // simulate a mutation
      await new Promise(resolve => setTimeout(resolve, 300));
      setItems(current => [...current, values]);
    },
  });

  return (
    <Container py="lg" size="sm">
      <Title order={2} mb="sm">
        Modal form
      </Title>
      <Stack gap="sm" align="flex-start">
        <Button
          onClick={() =>
            open(form => (
              <>
                <TextInput
                  data-autofocus
                  label="Item name"
                  placeholder="camera_kit"
                  {...form.getInputProps('name')}
                />
                <TextInput
                  label="Description"
                  placeholder="Optional"
                  {...form.getInputProps('description')}
                />
              </>
            ))
          }
        >
          Add gear item
        </Button>

        {items.length > 0 ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Description</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map(item => (
                <Table.Tr key={item.name}>
                  <Table.Td>{item.name}</Table.Td>
                  <Table.Td>{item.description || '--'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="dimmed">
            No gear items yet.
          </Text>
        )}
      </Stack>
    </Container>
  );
}

export const ModalForm: Story = {
  render: () => <ModalFormDemo />,
};

// --- Table shadow: layered header background + sticky header --------------

const rows = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: `gear_item_${i + 1}`,
  status: i % 3 === 0 ? 'on loan' : 'available',
}));

function TableDemo() {
  return (
    <Container py="lg" size="sm">
      <Title order={2} mb="sm">
        Table shadow
      </Title>
      <Table.ScrollContainer minWidth={320} h={320}>
        <Table stickyHeader>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>Item</Table.Th>
              <Table.Th>Status</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(row => (
              <Table.Tr key={row.id}>
                <Table.Td>{row.id}</Table.Td>
                <Table.Td>{row.name}</Table.Td>
                <Table.Td>{row.status}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Container>
  );
}

export const TableShadow: Story = {
  render: () => <TableDemo />,
};
