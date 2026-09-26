import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { modals } from '@mattstack/app-kit/modals';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';

test('confirm shows destructive styling and fires onConfirm', async () => {
  const onConfirm = vi.fn();
  renderWithProviders(
    <button
      onClick={() =>
        modals.confirm({
          title: 'Delete?',
          message: 'Sure?',
          destructive: true,
          onConfirm,
        })
      }
    >
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  const confirmButton = await screen.findByRole('button', {
    name: /delete|confirm/i,
  });
  // destructive styling: the confirm button carries the red color CSS vars
  expect(confirmButton.getAttribute('style')).toMatch(/red/);

  await userEvent.click(confirmButton);
  expect(onConfirm).toHaveBeenCalled();
});

test('confirm hides the cancel button when hideCancelButton is set', async () => {
  const onConfirm = vi.fn();
  renderWithProviders(
    <button
      onClick={() =>
        modals.confirm({
          title: 'Archive?',
          message: 'Sure?',
          hideCancelButton: true,
          onConfirm,
        })
      }
    >
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  await screen.findByRole('button', { name: /confirm/i });
  expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
});

test('prompt submits the typed value on Enter', async () => {
  const onSubmit = vi.fn();
  renderWithProviders(
    <button onClick={() => modals.prompt({ title: 'Rename', onSubmit })}>
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  const input = await screen.findByRole('textbox');
  expect(document.activeElement).toBe(input);

  await userEvent.type(input, 'new name{Enter}');

  expect(onSubmit).toHaveBeenCalledWith('new name');
});

test('prompt blocks submit when validate returns an error', async () => {
  const onSubmit = vi.fn();
  const validate = (value: string) => (value.length < 3 ? 'Too short' : null);
  renderWithProviders(
    <button
      onClick={() => modals.prompt({ title: 'Rename', validate, onSubmit })}
    >
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  const input = await screen.findByRole('textbox');
  await userEvent.type(input, 'ab{Enter}');

  expect(await screen.findByText('Too short')).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('prompt renders the labeled input and required blocks empty submits', async () => {
  const onSubmit = vi.fn();
  renderWithProviders(
    <button
      onClick={() =>
        modals.prompt({
          title: 'Rename',
          label: 'New name',
          placeholder: 'e.g. field_camera_a',
          required: true,
          onSubmit,
        })
      }
    >
      go
    </button>
  );

  await userEvent.click(screen.getByText('go'));

  // The field props land on the input: an accessible label (with the
  // required asterisk) and a placeholder.
  const input = await screen.findByLabelText(/New name/);
  expect(input.getAttribute('placeholder')).toBe('e.g. field_camera_a');

  // Empty submit is rejected by the built-in required check...
  await userEvent.type(input, '{Enter}');
  expect(await screen.findByText('Value is required')).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();

  // ...and a real value goes through.
  await userEvent.type(input, 'tripod_b{Enter}');
  expect(onSubmit).toHaveBeenCalledWith('tripod_b');
});
