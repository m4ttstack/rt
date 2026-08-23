import type { ReactNode } from 'react';
import { openConfirmModal } from '@mantine/modals';
import type { OpenConfirmModal } from '@mantine/modals';

import { Group, Text } from '@ui/core';
import { Icon } from '@ui/icons';

export interface ConfirmLabels {
  confirm?: ReactNode;
  cancel?: ReactNode;
}

export interface ConfirmOptions extends Omit<
  OpenConfirmModal,
  'title' | 'children' | 'labels' | 'onConfirm' | 'onCancel'
> {
  title: ReactNode;
  message: ReactNode;
  /** Renders a warning icon next to the title and a red confirm button. */
  destructive?: boolean;
  /** Hides the cancel button entirely (not just disables it). */
  hideCancelButton?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  labels?: ConfirmLabels;
}

// Thin wrapper around @mantine/modals' openConfirmModal: fixed title/message
// rendering, plus the kit's `destructive` and `hideCancelButton`
// conveniences. Any other openConfirmModal option (size, modalId,
// closeOnConfirm, ...) passes through.
export function confirm(options: ConfirmOptions): void {
  const {
    title,
    message,
    destructive = false,
    hideCancelButton = false,
    onConfirm,
    onCancel,
    labels,
    confirmProps,
    cancelProps,
    ...rest
  } = options;

  openConfirmModal({
    ...rest,
    title: destructive ? (
      <Group gap="xs" wrap="nowrap">
        <Icon name="warning" size={18} color="var(--mantine-color-red-6)" />
        <Text fw={600}>{title}</Text>
      </Group>
    ) : (
      <Text fw={600}>{title}</Text>
    ),
    children:
      typeof message === 'string' ? <Text size="sm">{message}</Text> : message,
    labels: {
      confirm: labels?.confirm ?? 'Confirm',
      cancel: labels?.cancel ?? 'Cancel',
    },
    confirmProps: destructive
      ? { color: 'red', ...confirmProps }
      : confirmProps,
    // Cancel reads as the quiet, secondary action by default.
    cancelProps: hideCancelButton
      ? { display: 'none' }
      : { color: 'gray', variant: 'light', ...cancelProps },
    onConfirm,
    onCancel,
  });
}
