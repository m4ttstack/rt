import { ActionIcon, Group, Paper } from '@mantine/core';
import type { GroupProps, MantineColor, PaperProps } from '@mantine/core';

import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import { MAX_CONTENT_WIDTH } from '../content-container/ContentContainer';

export interface NotchProps
  extends
    Omit<PaperProps, 'children'>,
    Pick<GroupProps, 'gap' | 'justify' | 'align' | 'wrap'> {
  children: React.ReactNode;
  /** Shows a dismiss button. @default true */
  withCloseButton?: boolean;
  /** Called when the dismiss button is clicked. */
  onClose: () => void;
  /** Tint color for the background and border. @default 'indigo' */
  color?: MantineColor;
}

/**
 * A top-docked banner strip, designed to hang from the top edge of
 * `PageShell`'s content area (its `topNotch` slot) just under the shell
 * header. It owns its docked look: its top corners are squared and its top
 * border omitted so the host's own edge completes the outline -- it is not
 * designed to float free-standing. Sized relative to the content column
 * (`MAX_CONTENT_WIDTH * 1.25`) so it reads as page-level chrome rather than
 * a card.
 *
 * Background and border are scheme-aware through `useSchemeColors` (a soft
 * lightened tint of `color` for the fill, a per-scheme border), so the
 * banner reads correctly in both light and dark.
 */
export function Notch({
  children,
  withCloseButton = true,
  onClose,
  color = 'indigo',
  style,
  gap = 'lg',
  justify,
  align,
  wrap,
  ...paperProps
}: NotchProps) {
  const { bg, border } = useSchemeColors();
  return (
    <Paper
      component={Group}
      maw={MAX_CONTENT_WIDTH * 1.25}
      flex={1}
      mx="xl"
      p="md"
      px="lg"
      gap={gap}
      justify={justify}
      align={align}
      wrap={wrap}
      radius="md"
      bg={bg.lightened(color)}
      style={{
        border: border.style(color),
        borderTop: 'none',
        borderTopLeftRadius: 0,
        borderTopRightRadius: 0,
        ...style,
      }}
      {...paperProps}
    >
      {children}
      {withCloseButton && (
        <ActionIcon variant="subtle" onClick={onClose} aria-label="close notch">
          <Icons.close size={16} />
        </ActionIcon>
      )}
    </Paper>
  );
}
