import {
  Box,
  Button,
  Group,
  HoverCard,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Invadr } from 'invadrs/react';

import classes from './agent-name.module.css';
import { useBuddies } from './buddies-context';
import {
  DOT_COLOR,
  headTruncatePath,
  STATUS_TEXT_COLOR,
  Tag,
} from './presence-bits';
import type { RosterBuddy } from './Roster';
import { HANDLE_PALETTE } from './speaker-hue';
import { STATUS_WORD, statusDetail } from './statusDetail';

export type AgentNameVariant = 'row' | 'inline' | 'name';

/** One avatar size per variant, each lifted from an existing spec value
    (tag height, badge height, chip height) rather than a new number. */
const AVATAR_SIZE: Record<AgentNameVariant, number> = {
  row: 18,
  inline: 22,
  name: 14,
};

/** Every handle gets one, deterministically, from the same theme-token
    palette the name chip's hue rotation draws from -- see `HANDLE_PALETTE`. */
function HandleAvatar({
  handle,
  variant,
}: {
  handle: string;
  variant: AgentNameVariant;
}) {
  return (
    <Invadr
      id={handle}
      palette={HANDLE_PALETTE}
      size={AVATAR_SIZE[variant]}
      className={classes.avatar}
    />
  );
}

/** Carries the per-speaker hue into `.hueChip`'s CSS as a custom property,
    since the color itself is only known at render time. */
type HueStyle = React.CSSProperties & { '--speaker-hue': string };

export interface AgentNameProps {
  handle: string;
  /** `row`: a roster row (sm name, status word, away line). `inline`: a
      message sender (lg name, repo token). `name`: the bare name at the
      surrounding size, for chips and DM pairs. */
  variant?: AgentNameVariant;
  /** `false` drops the hover card and, with it, the hover styling -- both
      hang off the card's `.target` wrapper, so neither survives without it.
      For touch surfaces (the phone drawer) and dense lists that should not
      react to hover (the sidebar DM rows). */
  withCard?: boolean;
  /** `false` drops the invadrs sprite that otherwise leads every handle.
      For dense rows (the sidebar's DM list) where a fifth icon per row
      is more noise than signal. @default true */
  withAvatar?: boolean;
  /** `inline` only: renders the handle as a chip in this hue (color and
      wash background). Unset keeps today's plain-name rendering. */
  hue?: string;
  /** The roster already holds the buddy and its room membership; these
      override the context lookup so the roster renders outside a provider
      (and in its own tests) the same way. */
  buddy?: RosterBuddy;
  reachable?: boolean;
  now?: number;
  inRoom?: boolean;
}

const LABEL = {
  fontSize: 'var(--tk-fs-4xs)',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--tk-muted-text)',
} as const;

const MUTED_XS = {
  fontSize: 'var(--tk-fs-3xs)',
  color: 'var(--tk-muted-text)',
} as const;

const RULE = { height: 1, background: 'var(--tk-border-soft)' } as const;

/** `• repo` after a name: a real bullet (a middle dot reads as a speck at
    10px), 3px either side, the repo truncating before the name ever does. */
function RepoToken({ repo }: { repo: string }) {
  return (
    <Text
      component="span"
      truncate
      style={{ ...MUTED_XS, minWidth: 0, alignSelf: 'baseline' }}
    >
      <span style={{ fontSize: 'var(--tk-fs-2xs)', margin: '0 3px' }}>•</span>
      {repo}
    </Text>
  );
}

/** The repo label a buddy works in: the one token that tells you what a
    first name is doing, short enough to sit inline. */
function repoToken(buddy: RosterBuddy | undefined): string | undefined {
  return buddy?.repo || undefined;
}

function CardRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <Text component="dt" style={LABEL}>
        {label}
      </Text>
      <Text
        component="dd"
        size="sm"
        truncate
        style={{ margin: 0, minWidth: 0 }}
      >
        {children}
      </Text>
    </>
  );
}

/** What the roster used to spell out on every row, once, on demand. */
export function AgentCard({
  buddy,
  reachable: reachableProp,
  now: nowProp,
  inRoom: inRoomProp,
}: {
  buddy: RosterBuddy;
  reachable?: boolean;
  now?: number;
  inRoom?: boolean;
}) {
  const ctx = useBuddies();
  const reachable = reachableProp ?? ctx?.reachable ?? true;
  const now = nowProp ?? ctx?.now ?? Date.now();
  const status = buddy.status;
  const inRoom = inRoomProp ?? ctx?.roomMembers.includes(buddy.handle) ?? false;
  const branchPane = [
    buddy.branch,
    buddy.pane !== undefined ? `pane ${buddy.pane}` : undefined,
  ]
    .filter((p): p is string => Boolean(p))
    .join(' · ');
  return (
    <Stack gap="sm" data-testid={`detail-${buddy.handle}`}>
      <Group gap="sm" wrap="nowrap" justify="space-between">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Box
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              flex: 'none',
              background:
                reachable && status !== 'offline'
                  ? DOT_COLOR[status]
                  : 'transparent',
              border:
                reachable && status !== 'offline'
                  ? undefined
                  : '1px solid var(--tk-border)',
            }}
          />
          <Text size="lg" fw={600} truncate>
            {buddy.handle}
          </Text>
        </Group>
        <Text
          component="span"
          style={{
            fontSize: 'var(--tk-fs-3xs)',
            fontWeight: 500,
            flex: 'none',
            color:
              reachable && status !== 'offline'
                ? STATUS_TEXT_COLOR[status]
                : 'var(--tk-muted-text)',
          }}
        >
          {reachable ? STATUS_WORD[buddy.status] : '—'}
        </Text>
      </Group>
      {reachable && buddy.statusText && (
        <Text component="span" style={{ ...MUTED_XS, fontStyle: 'italic' }}>
          “{buddy.statusText}”
        </Text>
      )}
      <Box style={RULE} />
      <Box
        component="dl"
        style={{
          display: 'grid',
          gridTemplateColumns: '52px minmax(0, 1fr)',
          alignItems: 'baseline',
          columnGap: 'var(--mantine-spacing-sm)',
          rowGap: 3,
          margin: 0,
        }}
      >
        {buddy.repo && <CardRow label="repo">{buddy.repo}</CardRow>}
        {branchPane && <CardRow label="where">{branchPane}</CardRow>}
        {buddy.cwd && (
          <CardRow label="path">
            <span style={MUTED_XS}>{headTruncatePath(buddy.cwd)}</span>
          </CardRow>
        )}
        <CardRow label="seen">
          <span style={MUTED_XS} data-testid={`sub-${buddy.handle}`}>
            {reachable
              ? statusDetail(buddy, now)
              : 'presence unknown while the daemon is down'}
          </span>
        </CardRow>
        {reachable && buddy.rooms.length > 0 && (
          <CardRow label="rooms">
            <Group gap={3} wrap="wrap" component="span">
              {buddy.rooms.map(room => (
                <Tag key={room} handle={buddy.handle} room={room} />
              ))}
            </Group>
          </CardRow>
        )}
      </Box>
      {ctx?.actions && (
        <>
          <Box style={RULE} />
          <Group gap="xs" wrap="nowrap">
            <Button
              size="xs"
              variant="default"
              radius="md"
              disabled={!inRoom}
              onClick={() => ctx.actions?.mention(buddy.handle)}
              data-testid={`card-mention-${buddy.handle}`}
            >
              @mention
            </Button>
            <Button
              size="xs"
              variant="default"
              radius="md"
              onClick={() => ctx.actions?.dm(buddy.handle)}
              data-testid={`card-dm-${buddy.handle}`}
            >
              DM
            </Button>
            {buddy.pane !== undefined && ctx.actions.focusPane && (
              <Button
                size="xs"
                variant="default"
                radius="md"
                onClick={() => ctx.actions?.focusPane?.(buddy.pane!)}
                data-testid={`card-focus-${buddy.handle}`}
              >
                Focus pane
              </Button>
            )}
          </Group>
        </>
      )}
    </Stack>
  );
}

/** A handle, wherever one is rendered. The name never truncates; the repo
    token beside it does. Hover opens the buddy's card when presence knows
    the handle; a handle presence does not know (a human, an offline row) is
    plain text. */
export function AgentName({
  handle,
  variant = 'name',
  withCard = true,
  withAvatar = true,
  buddy: buddyProp,
  reachable: reachableProp,
  now,
  inRoom,
  hue,
}: AgentNameProps) {
  const ctx = useBuddies();
  const buddy = buddyProp ?? ctx?.byHandle.get(handle);
  const reachable = reachableProp ?? ctx?.reachable ?? true;
  const repo = repoToken(buddy);

  let label: React.ReactNode;
  if (variant === 'row') {
    label = (
      <Group gap="xs" wrap="nowrap" align="center" style={{ minWidth: 0 }}>
        {withAvatar && <HandleAvatar handle={handle} variant={variant} />}
        <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={0} wrap="nowrap" align="baseline" style={{ minWidth: 0 }}>
            <Group
              gap={0}
              wrap="nowrap"
              align="baseline"
              className={classes.name}
              style={{ minWidth: 0 }}
            >
              <Text
                size="sm"
                fw={600}

                style={{ flex: 'none' }}
              >
                {handle}
              </Text>
              {repo && <RepoToken repo={repo} />}
            </Group>
          </Group>
          {reachable && buddy?.statusText && (
            <Text
              component="span"
              data-testid={`away-${handle}`}
              style={{ ...MUTED_XS, fontStyle: 'italic' }}
            >
              “{buddy.statusText}”
            </Text>
          )}
        </Stack>
      </Group>
    );
  } else if (variant === 'inline') {
    label = (
      <Group
        gap={0}
        wrap="nowrap"
        align="baseline"
        component="span"
        className={hue ? undefined : classes.name}
        style={{ minWidth: 0 }}
      >
        <Group
          gap="xs"
          wrap="nowrap"
          align="center"
          component="span"
          className={hue ? classes.hueChip : undefined}
          data-testid={hue ? 'speaker-chip' : undefined}
          style={
            hue
              ? ({ flex: 'none', '--speaker-hue': hue } as HueStyle)
              : { flex: 'none' }
          }
        >
          {withAvatar && <HandleAvatar handle={handle} variant={variant} />}
          <Text component="span" size="lg" fw={600} style={{ flex: 'none' }}>
            {handle}
          </Text>
        </Group>
        {repo && <RepoToken repo={repo} />}
      </Group>
    );
  } else {
    label = (
      <Group
        gap="xs"
        wrap="nowrap"
        align="center"
        component="span"
        display="inline-flex"
      >
        {withAvatar && <HandleAvatar handle={handle} variant={variant} />}
        <Text component="span" fw={600} inherit className={classes.name}>
          {handle}
        </Text>
      </Group>
    );
  }

  if (!withCard || !buddy) return label;

  return (
    <HoverCard
      position={variant === 'row' ? 'left-start' : 'bottom-start'}
      width={300}
      openDelay={500}
      closeDelay={120}
      withinPortal
      styles={{
        dropdown: {
          background: 'var(--tk-panel)',
          border: '1px solid var(--tk-border)',
          borderRadius: 'var(--mantine-radius-md)',
          padding: 'var(--mantine-spacing-sm)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18)',
        },
      }}
    >
      <HoverCard.Target>
        {variant === 'name' ? (
          <span className={classes.target}>{label}</span>
        ) : (
          <Box
            className={classes.target}
            // The row fills its line (the status word rides its right edge);
            // a sender sizes to its text, or the wash would run to the margin.
            style={
              variant === 'row'
                ? { minWidth: 0, flex: 1 }
                : { minWidth: 0, width: 'fit-content', maxWidth: '100%' }
            }
          >
            {label}
          </Box>
        )}
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <AgentCard
          buddy={buddy}
          reachable={reachableProp}
          now={now}
          inRoom={inRoom}
        />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
