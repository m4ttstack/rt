import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useForm } from '@mantine/form';
import type { UseFormReturnType } from '@mantine/form';
import { updateModal } from '@mantine/modals';
import type { z } from 'zod';

import { modals } from '@ui/modals';
import type { OpenModalOptions } from '@ui/modals';
import { FormContainer } from './FormContainer';
import { useModalFormSubmit } from './useModalFormSubmit';
import { zodResolver } from './validation';

export interface UseModalFormOptions<
  Schema extends z.ZodType<Record<string, unknown>>,
> {
  schema: Schema;
  initialValues: z.infer<Schema>;
  /** Perform the actual submission. May be sync or async; the modal stays open (and shows the loading state) until it resolves. */
  onSubmit: (values: z.infer<Schema>) => unknown | Promise<unknown>;
  /** Shown via `notifications.success` once the submission resolves. */
  successMessage?: string;
  /** Extra props for the hosting `@ui/modals` modal (title, size, ...). `children` and `modalId` are set internally and can't be overridden here. */
  modalProps?: Partial<Omit<OpenModalOptions, 'children' | 'modalId'>>;
}

type FieldsRenderer<Schema extends z.ZodType<Record<string, unknown>>> = (
  form: UseFormReturnType<z.infer<Schema>>
) => ReactNode;

let modalFormCounter = 0;

interface ModalFormBodyProps<
  Schema extends z.ZodType<Record<string, unknown>>,
> {
  modalId: string;
  schema: Schema;
  initialValues: z.infer<Schema>;
  onSubmit: (values: z.infer<Schema>) => unknown | Promise<unknown>;
  successMessage?: string;
  fields: FieldsRenderer<Schema>;
}

// The form's own state (`useForm`) has to live in a component that actually
// gets mounted where `@ui/modals` renders it -- that's what makes typing
// into a field re-render just this component, the normal React way, instead
// of the modal showing a frozen snapshot taken when `modals.open` was
// called. See useModalForm.tsx module docs below for why this can't be a
// plain function that builds JSX inline in `open`.
function ModalFormBody<Schema extends z.ZodType<Record<string, unknown>>>({
  modalId,
  schema,
  initialValues,
  onSubmit,
  successMessage,
  fields,
}: ModalFormBodyProps<Schema>) {
  const form = useForm({
    initialValues,
    validate: zodResolver(schema),
  });

  const { loading, error, handleSubmit } = useModalFormSubmit({
    onSubmit: (values: z.infer<Schema>) => onSubmit(schema.parse(values)),
    successMessage,
    onSuccess: () => modals.close(modalId),
  });

  // Lock the modal shut while a submit is in flight: no outside-click,
  // Escape, or close-button dismissal that would strand the pending action.
  useEffect(() => {
    updateModal({
      modalId,
      closeOnClickOutside: !loading,
      closeOnEscape: !loading,
      withCloseButton: !loading,
    });
  }, [modalId, loading]);

  return (
    <FormContainer
      form={form}
      onSubmit={handleSubmit}
      loading={loading}
      // The modal body IS the surface here -- `plain` keeps FormContainer
      // from drawing a second bordered/shadowed Paper inside it.
      plain
      error={
        error ? (error instanceof Error ? error.message : String(error)) : null
      }
    >
      {fields(form)}
    </FormContainer>
  );
}

/**
 * Opens a modal (via `@ui/modals`) hosting a zod-validated form.
 *
 * `open(fields)` takes a render function for the form's fields (called with
 * the `form` the modal creates internally) and opens the modal; submission
 * runs through `useModalFormSubmit` (loading state, success notification,
 * closing the modal on success). On a *valid* submit, the consumer's
 * `onSubmit` is called with the zod-parsed values (`schema.parse(values)`),
 * not the raw form values -- so any zod transforms/coercions/defaults are
 * applied before the consumer sees them.
 *
 * This kit's version owns the modal itself (via `@ui/modals`, matching the
 * rest of the kit's modal facades) and the zod schema, rather than returning
 * props for the caller to wire into their own mounted `<Modal>` and form
 * component.
 */
export function useModalForm<Schema extends z.ZodType<Record<string, unknown>>>(
  options: UseModalFormOptions<Schema>
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const open = useCallback((fields: FieldsRenderer<Schema>) => {
    const modalId = `modal-form-${modalFormCounter++}`;
    const { schema, initialValues, onSubmit, successMessage, modalProps } =
      optionsRef.current;

    modals.open({
      title: modalProps?.title ?? '',
      ...modalProps,
      // Spread AFTER modalProps so a caller-supplied value can never
      // override the internally generated modalId that
      // `useModalFormSubmit`'s onSuccess/`modals.close` rely on to close the
      // right modal.
      modalId,
      children: (
        <ModalFormBody
          modalId={modalId}
          schema={schema}
          initialValues={initialValues}
          onSubmit={onSubmit}
          successMessage={successMessage}
          fields={fields}
        />
      ),
    });

    return modalId;
  }, []);

  return { open, close: modals.close };
}
