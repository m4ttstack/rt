import { useCallback, useState } from 'react';

import { notifications } from '@ui/notifications';

export interface UseModalFormSubmitOptions<Values> {
  /** Perform the actual submission (e.g. a mutation). May be sync or async. */
  onSubmit: (values: Values) => unknown | Promise<unknown>;
  /** Shown via `notifications.success` once `onSubmit` resolves. Omit to skip the notification. */
  successMessage?: string;
  /** Called once `onSubmit` resolves (after the success notification, if any) -- e.g. closing a modal. */
  onSuccess?: () => void;
  /** Called if `onSubmit` throws/rejects. The error is also returned as `error`. */
  onError?: (error: unknown) => void;
}

/**
 * Submit orchestration for a kit form: tracks `loading`/`error` state around
 * an (possibly async) `onSubmit`, shows a success notification via
 * `@ui/notifications`, and calls `onSuccess` afterwards -- the hook a
 * `useModalForm`-hosted form uses to close its modal on success.
 */
export function useModalFormSubmit<Values>({
  onSubmit,
  successMessage,
  onSuccess,
  onError,
}: UseModalFormSubmitOptions<Values>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handleSubmit = useCallback(
    (values: Values) => {
      setLoading(true);
      setError(null);

      Promise.resolve(onSubmit(values))
        .then(() => {
          setLoading(false);
          if (successMessage) {
            notifications.success(successMessage);
          }
          onSuccess?.();
        })
        .catch((err: unknown) => {
          setLoading(false);
          setError(err);
          onError?.(err);
        });
    },
    [onSubmit, successMessage, onSuccess, onError]
  );

  return { loading, error, handleSubmit };
}
