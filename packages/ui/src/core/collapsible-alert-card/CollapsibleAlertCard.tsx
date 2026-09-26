import { useRef } from 'react';
import { ActionIcon, Card, Collapse, Group, Stack, Text } from '@mantine/core';
import type { CardProps, MantineColor } from '@mantine/core';
import { useUncontrolled } from '@mantine/hooks';

import { AnimatedChevron } from '@mattstack/app-kit/icons';
import classes from './CollapsibleAlertCard.module.css';

export interface CollapsibleAlertCardProps extends Omit<CardProps, 'children'> {
  title: React.ReactNode;
  children: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Leading icon shown in the header, tinted with `color`. */
  icon: React.ReactNode;
  /** Accent color for the border and header tint. @default 'indigo' */
  color?: MantineColor;
  /** Controlled open state. Omit to let the card manage its own state. */
  opened?: boolean;
  /** Initial open state when uncontrolled. @default false */
  defaultOpened?: boolean;
  onChange?: (opened: boolean) => void;
}

/**
 * An alert-tinted card with a chevron-toggled collapsible body -- a colored
 * callout that can hide most of its content behind a summary line until the
 * reader opens it. The body animates open/closed (Mantine `Collapse`).
 *
 * Color-driven header tint is implemented as a plain CSS module, generalizing
 * to any Mantine color via a CSS custom property.
 */
export function CollapsibleAlertCard({
  title,
  children,
  subtitle,
  icon,
  color = 'indigo',
  opened,
  defaultOpened = false,
  onChange,
  radius = 'md',
  withBorder = true,
  style,
  ...cardProps
}: CollapsibleAlertCardProps) {
  const [isOpened, handleToggle] = useUncontrolled({
    value: opened,
    defaultValue: defaultOpened,
    finalValue: false,
    onChange,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Card
      radius={radius}
      withBorder={withBorder}
      style={{
        borderColor: `var(--mantine-color-${color}-3)`,
        borderWidth: withBorder ? 2 : undefined,
        ...style,
      }}
      {...cardProps}
    >
      <Card.Section
        p="lg"
        className={classes.section}
        style={
          {
            '--collapsible-alert-card-accent': `var(--mantine-color-${color}-light)`,
            '--collapsible-alert-card-accent-active': `var(--mantine-color-${color}-light-hover)`,
          } as React.CSSProperties
        }
        onClick={() => triggerRef.current?.click()}
      >
        <Group gap="lg" wrap="nowrap">
          <Text c={`var(--mantine-color-${color}-text)`}>{icon}</Text>

          <Group flex={1} justify="space-between" wrap="nowrap">
            <Stack gap={4}>
              {/* component={Group} so a title made of multiple nodes (text +
                  a badge, say) lays out as a flex row. */}
              <Text component={Group} size="lg" fw={500}>
                {title}
              </Text>
              {subtitle && <Text c="gray">{subtitle}</Text>}
            </Stack>
            <ActionIcon
              ref={triggerRef}
              size="lg"
              variant="subtle"
              aria-label="toggle card content"
              onClick={event => {
                event.stopPropagation();
                handleToggle(!isOpened);
              }}
            >
              <AnimatedChevron size={26} opened={isOpened} />
            </ActionIcon>
          </Group>
        </Group>
      </Card.Section>
      <Card.Section>
        {/* `expanded` is Mantine 9's rename of v8's `in`. */}
        <Collapse expanded={isOpened}>{children}</Collapse>
      </Card.Section>
    </Card>
  );
}
