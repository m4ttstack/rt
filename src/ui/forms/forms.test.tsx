/* eslint-disable no-restricted-imports -- deliberately importing the real mantine originals to prove @ui/core's shadows are NOT the same reference. */
import {
  CopyButton as MantineCopyButton,
  Table as MantineTable,
  TextInput as MantineTextInput,
} from '@mantine/core';
/* eslint-enable no-restricted-imports */
import { useForm } from '@mantine/form';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { z } from 'zod';

import { CopyButton, Table, TextInput } from '@ui/core';
import {
  FormContainer,
  identifierRegex,
  useModalForm,
  zodResolver,
} from '@ui/forms';
import { renderWithProviders } from '@ui/storybook/test-utils';

// --- identifierRegex -------------------------------------------------------

test('identifierRegex accepts a valid identifier', () => {
  expect(identifierRegex.test('my_name1')).toBe(true);
});

test('identifierRegex rejects a string starting with a digit', () => {
  expect(identifierRegex.test('1bad-name')).toBe(false);
});

// --- @ui/core shadows --------------------------------------------------

test('@ui/core TextInput is a shadow, not a re-export of @mantine/core TextInput', () => {
  expect(TextInput).not.toBe(MantineTextInput);
});

test('@ui/core Table is a shadow, not a re-export of @mantine/core Table', () => {
  expect(Table).not.toBe(MantineTable);
});

test('@ui/core CopyButton is a shadow, not a re-export of @mantine/core CopyButton', () => {
  expect(CopyButton).not.toBe(MantineCopyButton);
});

// --- FormContainer -----------------------------------------------------

const nameSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
});

function NameForm({
  onSubmit,
  plain,
}: {
  onSubmit: (values: z.infer<typeof nameSchema>) => void;
  plain?: boolean;
}) {
  const form = useForm({
    initialValues: { name: '' },
    validate: zodResolver(nameSchema),
  });

  return (
    <FormContainer form={form} onSubmit={onSubmit} plain={plain}>
      <TextInput label="Name" {...form.getInputProps('name')} />
    </FormContainer>
  );
}

test('FormContainer shows a field error on invalid submit and does not call onSubmit', async () => {
  const onSubmit = vi.fn();
  renderWithProviders(<NameForm onSubmit={onSubmit} />);

  await userEvent.click(screen.getByRole('button', { name: /submit/i }));

  expect(
    await screen.findByText('Name must be at least 2 characters')
  ).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('FormContainer calls onSubmit with the parsed values on valid submit', async () => {
  const onSubmit = vi.fn();
  renderWithProviders(<NameForm onSubmit={onSubmit} />);

  await userEvent.type(screen.getByLabelText('Name'), 'Ada Lovelace');
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada Lovelace' })
  );
});

test('FormContainer renders a Paper surface by default and none when plain', () => {
  const { container, unmount } = renderWithProviders(
    <NameForm onSubmit={vi.fn()} />
  );
  const paper = container.querySelector('.mantine-Paper-root');
  expect(paper).not.toBeNull();
  // The Paper is the form's own chrome: it directly wraps the <form>.
  expect(paper?.querySelector('form')).not.toBeNull();
  unmount();

  const { container: plainContainer } = renderWithProviders(
    <NameForm onSubmit={vi.fn()} plain />
  );
  expect(plainContainer.querySelector('.mantine-Paper-root')).toBeNull();
  // The form itself (and its submit row) still renders.
  expect(plainContainer.querySelector('form')).not.toBeNull();
});

// --- useModalForm --------------------------------------------------------

const renameSchema = z.object({
  name: z.string().min(2, 'Too short'),
});

function RenameModalDemo({
  onSubmit,
}: {
  onSubmit: (values: z.infer<typeof renameSchema>) => Promise<void>;
}) {
  const { open } = useModalForm({
    schema: renameSchema,
    initialValues: { name: '' },
    onSubmit,
    successMessage: 'Renamed successfully',
    modalProps: { title: 'Rename' },
  });

  return (
    <button
      onClick={() =>
        open(form => (
          <TextInput
            label="Name"
            data-autofocus
            {...form.getInputProps('name')}
          />
        ))
      }
    >
      open rename modal
    </button>
  );
}

// Never invoked -- exists only so `tsc` (via `bun run typecheck`) checks that
// `modalProps` can't smuggle in a `modalId` override. `modalId` is generated
// internally by `useModalForm` and must stay the only source of truth the
// close-on-success handle relies on (see useModalForm.tsx).
function useModalIdOverrideGuardTypeCheck() {
  return useModalForm({
    schema: renameSchema,
    initialValues: { name: '' },
    onSubmit: async () => {},
    // @ts-expect-error -- modalId is generated internally; modalProps's type omits it.
    modalProps: { modalId: 'not-allowed' },
  });
}
void useModalIdOverrideGuardTypeCheck;

test('useModalForm opens a modal, submits, closes it, and shows a success notification', async () => {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(<RenameModalDemo onSubmit={onSubmit} />);

  await userEvent.click(screen.getByText('open rename modal'));

  const input = await screen.findByLabelText('Name');
  await userEvent.type(input, 'New Name');
  await userEvent.click(screen.getByRole('button', { name: /submit/i }));

  await waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith({ name: 'New Name' })
  );

  // modal closes
  await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());

  // success notification shown
  expect(await screen.findByText('Renamed successfully')).toBeTruthy();
});

test('useModalForm hosts its FormContainer chrome-free inside the modal body', async () => {
  renderWithProviders(<RenameModalDemo onSubmit={vi.fn()} />);

  await userEvent.click(screen.getByText('open rename modal'));
  await screen.findByLabelText('Name');

  // The modal body already IS the surface; the automatic `plain` on the
  // hosted FormContainer means no second Paper (border/shadow/padding)
  // renders inside it.
  const modalBody = document.querySelector('.mantine-Modal-body');
  expect(modalBody).not.toBeNull();
  expect(modalBody?.querySelector('.mantine-Paper-root')).toBeNull();
  expect(modalBody?.querySelector('form')).not.toBeNull();
});
