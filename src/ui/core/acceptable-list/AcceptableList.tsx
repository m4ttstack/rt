import { Fragment } from 'react';
import type { ReactNode } from 'react';
import {
  Button,
  Center,
  Divider,
  Group,
  LoadingOverlay,
  Paper,
  ScrollArea,
  Stack,
  Text,
} from '@mantine/core';
import type { ButtonProps } from '@mantine/core';

import { useSchemeColors } from '@ui/hooks';
import { Icons } from '@ui/icons';
import classes from './AcceptableList.module.css';

export interface AcceptableListItemProps {
  /** The row's content, left of the Accept/Decline buttons. */
  children: ReactNode;
  onAccept: () => void;
  onDecline: () => void;
  accepting?: boolean;
  declining?: boolean;
  acceptLabel?: string;
  declineLabel?: string;
  /** Test id stem for the two buttons (`${testId}-accept` / `-decline`). */
  testId?: string;
}

/**
 * A single Accept/Decline row -- the unit `AcceptableList` renders per item,
 * exported so callers can compose the same row shape outside the list (e.g.
 * a one-off confirmation row). Lifts to the next surface slot on hover.
 */
export function AcceptableListItem({
  children,
  onAccept,
  onDecline,
  accepting = false,
  declining = false,
  acceptLabel = 'Accept',
  declineLabel = 'Decline',
  testId,
}: AcceptableListItemProps) {
  return (
    <Group p="md" wrap="wrap" justify="space-between" className={classes.row}>
      {children}
      <Group>
        <Button
          size="compact-sm"
          onClick={onAccept}
          loading={accepting}
          disabled={declining}
          variant="filled"
          data-testid={testId ? `${testId}-accept` : undefined}
        >
          {acceptLabel}
        </Button>
        <Button
          color="gray"
          variant="subtle"
          size="compact-sm"
          disabled={accepting}
          loading={declining}
          onClick={onDecline}
          data-testid={testId ? `${testId}-decline` : undefined}
        >
          {declineLabel}
        </Button>
      </Group>
    </Group>
  );
}

export interface AcceptableListProps<T> {
  items: T[];
  /** Stable identity for an item, used to key rows and look up accepting/declining state. */
  getItemId: (item: T) => string;
  /** Renders the row's content (left of the Accept/Decline buttons). */
  renderItemDetail: (item: T) => ReactNode;
  onAccept: (item: T) => void;
  onDecline: (item: T) => void;
  /** Shows an "Accept All" button above the list when given. */
  onAcceptAll?: () => void;
  acceptingAll?: boolean;
  /** Customize the Accept All button; `loading`/`loaderProps` aren't allowed here (`acceptingAll` owns that). */
  acceptAllButton?: Omit<ButtonProps, 'loading' | 'loaderProps'> & {
    label?: string;
  };
  /** Item ids currently mid-accept (shows a spinner on that row's Accept button). */
  acceptingIds?: Set<string>;
  /** Item ids currently mid-decline (shows a spinner on that row's Decline button). */
  decliningIds?: Set<string>;
  acceptLabel?: string;
  declineLabel?: string;
  /** Shown instead of the list when `items` is empty. @default 'No items to display' */
  noItemsMessage?: string;
}

/**
 * A scrollable list of items each carrying its own Accept/Decline actions,
 * with an optional bulk "Accept All".
 *
 * The wrapping `Paper` sits on the kit's `bg.level2` surface slot (with the
 * default hairline border), matching `SelectableList`'s own surface, instead
 * of the scheme-static body background a bare `Paper` would give.
 */
export function AcceptableList<T>({
  items,
  onAccept,
  onDecline,
  onAcceptAll,
  acceptingAll = false,
  acceptAllButton,
  acceptingIds = new Set(),
  decliningIds = new Set(),
  getItemId,
  renderItemDetail,
  acceptLabel = 'Accept',
  declineLabel = 'Decline',
  noItemsMessage = 'No items to display',
}: AcceptableListProps<T>) {
  const { bg } = useSchemeColors();

  return (
    <Paper withBorder bg={bg.level2}>
      {onAcceptAll && (
        <>
          <Group justify="flex-end" py={8} px="sm">
            <Button
              variant="subtle"
              leftSection={<Icons.checkCheck size={16} />}
              {...acceptAllButton}
              onClick={onAcceptAll}
              loaderProps={{ type: 'dots' }}
              loading={acceptingAll}
              disabled={items.length === 0 || acceptAllButton?.disabled}
              data-testid="acceptable-list-accept-all"
            >
              {acceptAllButton?.label ?? 'Accept All'}
            </Button>
          </Group>
          <Divider />
        </>
      )}
      <ScrollArea.Autosize type="auto" mah="35dvh">
        <Stack gap={0} mx="sm" my="xs" pos="relative">
          <LoadingOverlay visible={acceptingAll} />
          {items.length === 0 && (
            <Center my="lg">
              <Text c="dimmed">{noItemsMessage}</Text>
            </Center>
          )}
          {items.map((item, index) => {
            const id = getItemId(item);
            return (
              <Fragment key={id}>
                <AcceptableListItem
                  onAccept={() => onAccept(item)}
                  onDecline={() => onDecline(item)}
                  accepting={acceptingIds.has(id)}
                  declining={decliningIds.has(id)}
                  acceptLabel={acceptLabel}
                  declineLabel={declineLabel}
                  testId={`acceptable-list-item-${id}`}
                >
                  {renderItemDetail(item)}
                </AcceptableListItem>
                {index < items.length - 1 && <Divider m={6} />}
              </Fragment>
            );
          })}
        </Stack>
      </ScrollArea.Autosize>
    </Paper>
  );
}
