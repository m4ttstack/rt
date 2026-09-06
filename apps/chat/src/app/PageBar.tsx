import { useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { AnimatedChevron, Icon } from '@mattstack/app-kit/icons';
import type { BuddyStatus, RoomSummary } from '@mattstack/rt-client';

import { AgentName } from './AgentName';
import { doing, type DoingInput } from './doing';
import { postMarkRead } from './mark-read';
import { STATUS_WORD } from './statusDetail';
import { useExpandAll } from './use-expand-all';

function signedInCount(buddies: { status: BuddyStatus }[]): number {
  return buddies.filter(b => b.status !== 'offline').length;
}

/** Rendered inside `PageShell.Header`, which owns the 64px surface, its
    padding and its border; this is the row's content. */
const PAGE_BAR_ROW = {
  height: '100%',
  width: '100%',
  minWidth: 0,
} as const;

/** The artboard's two 30px controls sit on `bg1` with the hairline border,
    which is Mantine's `default` variant on the tokyo surface tokens. */
const CONTROL_SURFACE = {
  background: 'var(--tk-bg)',
  borderColor: 'var(--tk-border)',
  fontSize: 'var(--tk-fs-2xs)',
} as const;

const UNREAD_BADGE = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 18,
  padding: '0 var(--mantine-spacing-sm)',
  borderRadius: 'var(--mantine-radius-xl)',
  fontSize: 'var(--tk-fs-3xs)',
  fontWeight: 500,
  lineHeight: 1,
  border: '1px solid var(--tk-border)',
  color: 'var(--tk-muted-text)',
  whiteSpace: 'nowrap',
} as const;

/** Wide enough for `doing()`: a DM's bar carries each end's task line, and
    that is resolved from the same presence row the chips count. */
export type PageBarBuddy = DoingInput;

export interface PageBarProps {
  room: RoomSummary;
  buddies: PageBarBuddy[];
  /** The room's members with their presence: the bar counts who is in THIS
      room, the roster counts the fleet. */
  reachable?: boolean;
  /** Called after the mark-read POST has already landed: a reaction to the
      mark, not a request to make it (compare `RoomRail`'s `onMarkRead`,
      which does post it). */
  onMarkedRead?: (room: string) => void;
  /** Opens the pane picker to invite agents to this room. The button renders
      only when this is wired, and is disabled while the daemon is down. */
  onAddAgents?: () => void;
  /** A prop, not `Date.now()` internally, so a DM's task chips are testable
      without fake timers. @default Date.now() */
  now?: number;
}

function Dot({
  color,
  testId,
  hollow,
}: {
  color?: string;
  testId: string;
  hollow?: boolean;
}) {
  return (
    <Box
      component="span"
      data-testid={testId}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        flex: 'none',
        background: hollow ? 'transparent' : color,
        border: hollow ? '1px solid var(--tk-border)' : undefined,
      }}
    />
  );
}

/** The hash is an icon beside the title, as the artboard draws it, not a
    character in it; a DM is named by its pair. */
function roomTitle(room: RoomSummary): string {
  // A DM is named by its pair, never by its hashed room id (Law 5). A DM
  // that arrives without participants (a direct link to a malformed room)
  // gets a neutral label rather than leaking the hash.
  if (room.kind === 'dm') {
    return room.participants
      ? `${room.participants.a} ↔ ${room.participants.b}`
      : 'Direct message';
  }
  return room.room;
}

function markReadLabel(room: RoomSummary): string {
  return room.kind === 'dm'
    ? 'Mark conversation read'
    : `Mark #${room.room} read`;
}

function closeLabel(room: RoomSummary): string {
  return room.kind === 'dm' ? 'Close this conversation' : `Close #${room.room}`;
}

/** The ⋯ control and its one item. One component for the desk's page bar
    and the phone header; at the phone's 44px the item grows to match. */
export function RoomMenu({
  room,
  onClose,
  size = 30,
}: {
  room: RoomSummary;
  onClose?: (room: string) => void;
  size?: number;
}) {
  return (
    <Menu
      position="bottom-end"
      withinPortal
      radius="md"
      shadow="md"
      styles={{
        item: {
          minHeight: size >= 44 ? 44 : 24,
          color: 'var(--tk-fg)',
          // The 44px touch variant grows its type and padding to the tap
          // scale; the desk keeps Mantine's default item size.
          ...(size >= 44
            ? { fontSize: 'var(--tk-fs-2xs)', padding: '3.2px 9.6px' }
            : {}),
        },
        dropdown: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--tk-panel)',
        },
      }}
    >
      <Menu.Target>
        <ActionIcon
          variant="default"
          size={size}
          radius="md"
          aria-label="Room actions"
          data-testid="room-menu"
          styles={{ root: CONTROL_SURFACE }}
        >
          <Icon name="moreHorizontal" size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="room-menu-dropdown">
        <Menu.Item
          data-testid="room-menu-close"
          leftSection={<Icon name="close" size={14} />}
          onClick={() => onClose?.(room.room)}
        >
          {closeLabel(room)}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

const MUTED = { color: 'var(--tk-muted-text)' } as const;

const GROUP_LABEL = {
  fontSize: 'var(--tk-fs-4xs)',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--tk-muted-text)',
} as const;

/** One membership chip in place of the fanned-out live/idle/offline chips:
    a status-dot summary that opens the room's full roster on click. The
    roster groups by status so each row's status reads from its section, and
    the wake mode moves into the popover header so the bar sheds a chip. */
function RoomMembers({
  room,
  buddies,
  reachable,
  now,
  wakeMode,
}: {
  room: RoomSummary;
  buddies: PageBarBuddy[];
  reachable: boolean;
  now: number;
  wakeMode: string;
}) {
  const [opened, setOpened] = useState(false);
  const signedIn = signedInCount(buddies);
  const live = buddies.filter(b => b.status === 'live');
  const idle = buddies.filter(b => b.status === 'idle');
  const offline = buddies.filter(b => b.status === 'offline');
  const groups = [
    { key: 'live', word: STATUS_WORD.live, members: live },
    { key: 'idle', word: STATUS_WORD.idle, members: idle },
    { key: 'offline', word: STATUS_WORD.offline, members: offline },
  ].filter(g => g.members.length > 0);

  const roomLabel = room.kind === 'dm' ? 'conversation' : `#${room.room}`;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      withinPortal
      shadow="md"
      radius="md"
      width={276}
      trapFocus
      styles={{ dropdown: { padding: 0, background: 'var(--tk-panel)' } }}
    >
      <Popover.Target>
        <Button
          variant="default"
          size="xs"
          radius="md"
          data-testid="members-chip"
          aria-label={`Members of ${roomLabel}`}
          onClick={() => setOpened(o => !o)}
          leftSection={
            <Group gap={3} wrap="nowrap">
              {live.length > 0 && (
                <Dot color="var(--tk-dot-ok)" testId="members-dot-live" />
              )}
              {idle.length > 0 && (
                <Dot color="var(--tk-dot-warn)" testId="members-dot-idle" />
              )}
              {live.length === 0 && idle.length === 0 && (
                <Dot hollow testId="members-dot-off" />
              )}
            </Group>
          }
          rightSection={<AnimatedChevron opened={opened} size={14} />}
          // The same default/xs control surface as the add-agents and
          // mark-read buttons beside it, so the bar's controls all match.
          styles={{
            root: {
              ...CONTROL_SURFACE,
              fontWeight: 500,
              ...(opened ? { background: 'var(--ui-bg-4)' } : {}),
            },
          }}
        >
          {signedIn} in {roomLabel}
          {reachable ? '' : ' · last known'}
        </Button>
      </Popover.Target>
      <Popover.Dropdown data-testid="members-dropdown">
        <Group
          justify="space-between"
          wrap="nowrap"
          gap="sm"
          style={{
            padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-md)',
            borderBottom: '1px solid var(--tk-border-soft)',
          }}
        >
          <Text fw={700} size="sm">
            {signedIn} in {roomLabel}
          </Text>
          <Text
            component="span"
            data-testid="members-wakes"
            style={{ ...MUTED, fontSize: 'var(--tk-fs-3xs)' }}
          >
            wakes: {wakeMode}
          </Text>
        </Group>
        {reachable ? (
          <ScrollArea.Autosize
            mah={320}
            type="auto"
            scrollbars="y"
            styles={{ content: { minWidth: 0 } }}
          >
            <Stack
              gap="sm"
              style={{
                padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-xs)',
              }}
            >
              {groups.map(g => (
                <Box key={g.key}>
                  <Group
                    gap={6}
                    wrap="nowrap"
                    style={{
                      padding: '0 var(--mantine-spacing-sm)',
                      marginBottom: 3,
                    }}
                  >
                    <Text component="span" style={GROUP_LABEL}>
                      {g.word}
                    </Text>
                    <Text
                      component="span"
                      style={{ ...MUTED, fontSize: 'var(--tk-fs-3xs)' }}
                    >
                      {g.members.length}
                    </Text>
                  </Group>
                  <Stack gap={1}>
                    {g.members.map(b => (
                      <Box
                        key={b.handle}
                        data-testid={`members-row-${b.handle}`}
                        style={{ padding: '2px var(--mantine-spacing-sm)' }}
                      >
                        <AgentName
                          handle={b.handle}
                          variant="row"
                          reachable={reachable}
                          now={now}
                          task={doing(b, now)}
                        />
                      </Box>
                    ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        ) : (
          <Box style={{ padding: 'var(--mantine-spacing-md)' }}>
            <Text style={{ ...MUTED, fontSize: 'var(--tk-fs-2xs)' }}>
              presence withheld while the daemon is down
            </Text>
          </Box>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

export function PageBar({
  room,
  buddies,
  reachable = true,
  onMarkedRead,
  onAddAgents,
  now = Date.now(),
}: PageBarProps) {
  const [expandAll, setExpandAll] = useExpandAll();
  const handleMarkRead = () => {
    void postMarkRead(room.room)
      .then(() => onMarkedRead?.(room.room))
      .catch(() => {});
  };

  const title = (
    <>
      {room.kind !== 'dm' && (
        <Box
          component="span"
          style={{
            display: 'inline-flex',
            flex: 'none',
            color: 'var(--tk-muted-text)',
          }}
          data-testid="page-bar-hash"
        >
          <Icon name="hash" size={18} />
        </Box>
      )}
      <Text
        fw={700}
        size="xl"
        lh={1.35}
        truncate
        style={{ flex: 'none', maxWidth: '38%', minWidth: 0 }}
      >
        {roomTitle(room)}
      </Text>
      <Box style={{ width: 4.8, flex: 'none' }} />
    </>
  );

  const controls = (
    <>
      {onAddAgents && (
        <Button
          variant="default"
          size="xs"
          radius="md"
          mr="sm"
          data-testid="add-agents-button"
          aria-label={`Add agents to #${room.room}`}
          onClick={onAddAgents}
          disabled={!reachable}
          leftSection={<Icon name="userPlus" size={14} />}
          styles={{ root: { ...CONTROL_SURFACE, fontWeight: 500 } }}
        >
          add agents
        </Button>
      )}
      {room.unread > 0 && (
        <Button
          variant="default"
          size="xs"
          radius="md"
          data-testid="mark-read-button"
          aria-label={markReadLabel(room)}
          onClick={handleMarkRead}
          leftSection={<Icon name="check" size={14} />}
          rightSection={
            <Box component="span" style={UNREAD_BADGE}>
              {room.unread}
            </Box>
          }
          styles={{ root: CONTROL_SURFACE }}
        >
          mark read
        </Button>
      )}
      <Tooltip
        label={expandAll ? 'Clip long messages' : 'Show every message in full'}
        position="bottom"
        withinPortal
      >
        <ActionIcon
          variant={expandAll ? 'filled' : 'default'}
          color={expandAll ? 'accent' : undefined}
          size={30}
          radius="md"
          ml="sm"
          aria-label="Expand all messages"
          aria-pressed={expandAll}
          data-testid="expand-all-toggle"
          onClick={() => setExpandAll(!expandAll)}
          styles={{ root: expandAll ? undefined : CONTROL_SURFACE }}
        >
          <Icon
            name={expandAll ? 'foldVertical' : 'unfoldVertical'}
            size={16}
          />
        </ActionIcon>
      </Tooltip>
    </>
  );

  const wakeMode = room.kind === 'dm' ? 'all' : (room.defaultWake ?? 'mention');

  return (
    <Group
      align="center"
      wrap="nowrap"
      gap="sm"
      style={PAGE_BAR_ROW}
      data-testid="page-bar"
    >
      {title}
      <Group
        gap="sm"
        wrap="nowrap"
        style={{ flex: '1 1 0%', minWidth: 0, overflowX: 'auto' }}
      >
        <RoomMembers
          room={room}
          buddies={buddies}
          reachable={reachable}
          now={now}
          wakeMode={wakeMode}
        />
      </Group>
      <Group gap={0} ml="auto" wrap="nowrap">
        {controls}
      </Group>
    </Group>
  );
}
