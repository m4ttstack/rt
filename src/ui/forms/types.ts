import type { UseFormReturnType } from '@mantine/form';
import type { z } from 'zod';

/** Paper surface toggles shared by `FormContainer` and the modal-form plumbing. */
export type FormStyle = {
  /** @default false */
  noShadow?: boolean;
  /** @default false */
  noPadding?: boolean;
};

/**
 * Props shape for a component that renders the *fields* of a zod-typed form.
 * The form itself is created once (by the caller, or by `useModalForm`) and
 * handed down as `form` -- field components wire themselves up via
 * `form.getInputProps('someField')` the same way they would with a form
 * created directly via `useForm`.
 *
 * `Schema` is the zod schema describing the form's values; `ComponentProps`
 * lets a field component declare any extra props of its own (on top of
 * `form`).
 */
export type FormComponentProps<
  Schema extends z.ZodType<Record<string, unknown>>,
  ComponentProps = Record<string, unknown>,
> = {
  form: UseFormReturnType<z.infer<Schema>>;
} & ComponentProps;
