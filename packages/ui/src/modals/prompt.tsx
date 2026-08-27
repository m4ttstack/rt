import { useState, type FormEvent, type ReactNode } from 'react';
import { closeModal, openModal } from '@mantine/modals';
import type { ModalSettings } from '@mantine/modals';

import { Button, Stack, Text, TextInput } from '@mattstack/app-kit/core';
import type { ButtonProps } from '@mattstack/app-kit/core';

export interface PromptOptions extends Omit<
  ModalSettings,
  'title' | 'children' | 'modalId' | 'onSubmit'
> {
  title: ReactNode;
  message?: ReactNode;
  /** Label rendered above the text input. */
  label?: ReactNode;
  /** Placeholder for the text input. */
  placeholder?: string;
  /**
   * Marks the input with an asterisk and rejects empty/whitespace-only
   * submits with a "Value is required" error (after `validate`, which
   * still runs first and can impose stricter rules). @default false
   */
  required?: boolean;
  initialValue?: string;
  validate?: (value: string) => string | null;
  /**
   * Called with the entered value on a valid submit. May return a promise:
   * while it is pending the submit button shows a loading state and the
   * input is disabled; the modal closes once it settles.
   */
  onSubmit: (value: string) => void | Promise<unknown>;
  /** Submit button label. @default 'Submit' */
  confirmLabel?: ReactNode;
  /** Extra props for the submit button. */
  confirmProps?: Partial<ButtonProps>;
}

interface PromptFormProps extends Pick<
  PromptOptions,
  | 'message'
  | 'label'
  | 'placeholder'
  | 'required'
  | 'validate'
  | 'onSubmit'
  | 'confirmLabel'
  | 'confirmProps'
> {
  modalId: string;
  initialValue: string;
}

// State can't be shared between the caller and the modal's children, so the
// form owns its own value/error/loading state internally.
function PromptForm({
  modalId,
  message,
  label,
  placeholder,
  required,
  initialValue,
  validate,
  onSubmit,
  confirmLabel = 'Submit',
  confirmProps,
}: PromptFormProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = () => {
    const validationError = validate ? validate(value) : null;
    if (validationError) {
      setError(validationError);
      return;
    }
    if (required && !value.trim()) {
      setError('Value is required');
      return;
    }
    const result = onSubmit(value);
    if (result instanceof Promise) {
      // Keep the modal open, showing the button's loading state, until the
      // async submit settles.
      setLoading(true);
      result.finally(() => {
        setLoading(false);
        closeModal(modalId);
      });
      return;
    }
    closeModal(modalId);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  return (
    <Stack gap="sm">
      {message ? (
        typeof message === 'string' ? (
          <Text size="sm">{message}</Text>
        ) : (
          message
        )
      ) : null}
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            data-autofocus
            label={label}
            placeholder={placeholder}
            withAsterisk={required}
            disabled={loading}
            value={value}
            error={error}
            onChange={event => {
              setValue(event.currentTarget.value);
              if (error) setError(null);
            }}
          />
          <Button type="submit" fullWidth loading={loading} {...confirmProps}>
            {confirmLabel}
          </Button>
        </Stack>
      </form>
    </Stack>
  );
}

let promptModalCounter = 0;

// Small form modal built on the same `openModal` primitive as `modals.open`,
// used directly here (rather than importing the facade from ./modals) to
// avoid a circular module reference between modals.tsx and prompt.tsx. Any
// other openModal option (size, ...) passes through.
export function prompt(options: PromptOptions): void {
  const {
    title,
    message,
    label,
    placeholder,
    required,
    initialValue = '',
    validate,
    onSubmit,
    confirmLabel,
    confirmProps,
    ...rest
  } = options;
  const modalId = `prompt-${promptModalCounter++}`;

  openModal({
    closeOnClickOutside: false,
    ...rest,
    modalId,
    title,
    children: (
      <PromptForm
        modalId={modalId}
        message={message}
        label={label}
        placeholder={placeholder}
        required={required}
        initialValue={initialValue}
        validate={validate}
        onSubmit={onSubmit}
        confirmLabel={confirmLabel}
        confirmProps={confirmProps}
      />
    ),
  });
}
