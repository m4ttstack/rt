import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Select,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { BuddyStatus, RoomSummary } from '@mattstack/rt-client';

import { AgentName } from './AgentName';
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

const CHIP_BASE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--mantine-spacing-xs)',
  height: 22,
  borderRadius: 'var(--mantine-radius-md)',
  padding: '0 var(--mantine-spacing-sm)',
  fontSize: 'var(--tk-fs-3xs)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  border: '1px solid var(--mantine-color-default-border)',
  color: 'var(--tk-muted-text)',
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

export type RoomOrder = 'join' | 'name';

export interface PageBarBuddy {
  handle: string;
  status: BuddyStatus;
}

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
  /** The rail's sort, the artboard's `join order` select. */
  order?: RoomOrder;
  onOrderChange?: (order: RoomOrder) => void;
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

/** A chip whose count is at most two names its handles, so the stuck agent
    is read first rather than found last; each name carries its card. */
function NamesSuffix({ handles }: { handles: string[] }) {
  if (handles.length === 0 || handles.length > 2) return null;
  return (
    <>
      {': '}
      {handles.map((h, i) => (
        <span key={h}>
          {i > 0 && ', '}
          <AgentName handle={h} />
        </span>
      ))}
    </>
  );
}

/** The hash is an icon beside the title, as the artboard draws it, not a
    character in it; a DM is named by its pair. */
function roomTitle(room: RoomSummary): string {
  return room.kind === 'dm' && room.participants
    ? `${room.participants.a} ↔ ${room.participants.b}`
    : room.room;
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
        item: { minHeight: size >= 44 ? 44 : 24, color: 'var(--tk-fg)' },
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

export function PageBar({
  room,
  buddies,
  reachable = true,
  onMarkedRead,
  onAddAgents,
  order = 'join',
  onOrderChange,
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
      {onOrderChange && (
        <Select
          size="xs"
          radius="md"
          w={168}
          ml="sm"
          aria-label="Room order"
          data-testid="room-order"
          value={order}
          onChange={value => {
            if (value) onOrderChange(value as RoomOrder);
          }}
          allowDeselect={false}
          withCheckIcon={false}
          data={[
            { value: 'join', label: 'join order' },
            { value: 'name', label: 'by name' },
          ]}
          rightSection={<Icon name="chevronDown" size={14} />}
          styles={{ input: CONTROL_SURFACE }}
        />
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

  if (!reachable) {
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
          <Box component="span" style={CHIP_BASE} data-testid="chip-signed-in">
            {signedInCount(buddies)} in room · last known
          </Box>
          <Box component="span" style={CHIP_BASE} data-testid="chip-withheld">
            presence withheld
          </Box>
        </Group>
        <Group gap={0} ml="auto" wrap="nowrap">
          {controls}
        </Group>
      </Group>
    );
  }

  const wakeMode = room.kind === 'dm' ? 'all' : (room.defaultWake ?? 'mention');
  const live = buddies.filter(b => b.status === 'live');
  const idle = buddies.filter(b => b.status === 'idle');
  const offline = buddies.filter(b => b.status === 'offline');
  const signedInTotal = signedInCount(buddies);

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
        <Box component="span" style={CHIP_BASE} data-testid="chip-signed-in">
          {signedInTotal} in room
        </Box>
        {live.length > 0 && (
          <Box
            component="span"
            style={{
              ...CHIP_BASE,
              borderColor:
                'color-mix(in srgb, var(--mantine-color-ok-text) 45%, transparent)',
              color: 'var(--mantine-color-ok-text)',
            }}
            data-testid="chip-live"
          >
            <Dot color="var(--tk-dot-ok)" testId="dot-live" />
            {live.length} {STATUS_WORD.live}
            <NamesSuffix handles={live.map(b => b.handle)} />
          </Box>
        )}
        {idle.length > 0 && (
          <Box
            component="span"
            style={{
              ...CHIP_BASE,
              borderColor:
                'color-mix(in srgb, var(--mantine-color-warn-text) 45%, transparent)',
              color: 'var(--mantine-color-warn-text)',
            }}
            data-testid="chip-idle"
          >
            <Dot color="var(--tk-dot-warn)" testId="dot-idle" />
            {idle.length} {STATUS_WORD.idle}
            <NamesSuffix handles={idle.map(b => b.handle)} />
          </Box>
        )}
        {offline.length > 0 && (
          <Box component="span" style={CHIP_BASE} data-testid="chip-offline">
            <Dot hollow testId="dot-offline" />
            {offline.length} {STATUS_WORD.offline}
            <NamesSuffix handles={offline.map(b => b.handle)} />
          </Box>
        )}
        <Box component="span" style={CHIP_BASE} data-testid="chip-wakes">
          wakes: {wakeMode}
        </Box>
      </Group>
      <Group gap={0} ml="auto" wrap="nowrap">
        {controls}
      </Group>
    </Group>
  );
}
