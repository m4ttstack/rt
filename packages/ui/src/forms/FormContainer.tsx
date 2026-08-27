import type { ReactNode } from 'react';
import type { UseFormReturnType } from '@mantine/form';

import {
  Alert,
  Box,
  Button,
  Group,
  LoadingOverlay,
  Paper,
  Stack,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { FormStyle } from './types';

export interface FormContainerProps<
  Values extends Record<string, unknown>,
> extends FormStyle {
  /** The form to wire submission up to (created via `useForm`, typically with `validate: zodResolver(schema)`). */
  form: UseFormReturnType<Values>;
  /** Called with the form's (already-validated) values when submit succeeds. */
  onSubmit: (values: Values) => void;
  /** Disables the submit button and shows a loading overlay over the fields. @default false */
  loading?: boolean;
  /** Top-level error to summarize above the submit row (e.g. a failed mutation). */
  error?: ReactNode;
  submitLabel?: ReactNode;
  /**
   * Skips the built-in error `Alert` and submit-button row, so the form
   * renders just its fields and you supply your own error/submit UI in
   * `children`. @default false
   */
  hideChrome?: boolean;
  /**
   * Renders no `Paper` chrome at all (no surface, shadow, or padding) for
   * forms hosted inside a surface something else already owns -- most
   * commonly a modal body. `useModalForm` sets this automatically; when
   * `plain` is set, `noPadding`/`noShadow` are moot. @default false
   */
  plain?: boolean;
  children: ReactNode;
}

/**
 * Layout + submit wiring shared by every kit form: a `<form>` wired to
 * `form.onSubmit`, a loading overlay while submitting, the field
 * `children`, a top-level error summary, and a submit row.
 *
 * Flat by default (`noPadding`/`noShadow` both `true`): the container is a
 * plain wrapper unless you opt into `Paper` chrome. Pass `hideChrome` to
 * drop the built-in error/submit row and supply your own, or `plain` to
 * skip the `Paper` wrapper entirely (a form inside a surface something else
 * provides -- the modal-form path does this automatically).
 */
export function FormContainer<Values extends Record<string, unknown>>({
  form,
  onSubmit,
  loading = false,
  noPadding = true,
  noShadow = true,
  plain = false,
  hideChrome = false,
  error,
  submitLabel = 'Submit',
  children,
}: FormContainerProps<Values>) {
  const body = (
    <form
      autoComplete="off"
      onSubmit={form.onSubmit(values => onSubmit(values))}
    >
      <LoadingOverlay visible={loading} />
      <Stack gap="sm">
        {children}

        {!hideChrome && error ? (
          <Alert
            color="red"
            title="Error"
            icon={<Icon name="warning" size={16} />}
          >
            {error}
          </Alert>
        ) : null}

        {!hideChrome && (
          <Group justify="flex-end" mt="sm">
            <Button type="submit" loading={loading}>
              {submitLabel}
            </Button>
          </Group>
        )}
      </Stack>
    </form>
  );

  // The chrome-free wrapper still has to exist (as a positioned Box) so the
  // LoadingOverlay has an ancestor to fill.
  if (plain) {
    return <Box pos="relative">{body}</Box>;
  }

  return (
    <Paper
      p={noPadding ? 0 : 'lg'}
      shadow={noShadow ? 'none' : 'sm'}
      pos="relative"
    >
      {body}
    </Paper>
  );
}
