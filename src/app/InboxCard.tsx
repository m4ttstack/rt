import { Box, Group, Text, UnstyledButton } from '@mattstack/app-kit/core';

import type { InboxCard as InboxCardData } from '../server/inbox';
import { AgentName, type AgentNameSize } from './AgentName';
import { useBuddies } from './buddies-context';
import { Chip } from './Chip';
import { localTime } from './day-label';
import { doing, type DoingLine } from './doing';
import classes from './inbox.module.css';
import { MUTED_XS } from './presence-bits';
import { speakerHue } from './speaker-hue';
import { formatElapsed } from './statusDetail';

const BORDER = 'var(--tk-border)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';

/** `.ctx`: the small outlined token naming where a message lives, or (with
    `warn`) flagging an unclaimed `@here`. A DM's is `.ctx.dm`, in purple,
    and carries the pair -- the hashed room name is never rendered anywhere
    in this app. `dm` and `warn` are never both set on the same chip. */
export function CtxChip({
  children,
  dm = false,
  warn = false,
  testId,
}: {
  children: React.ReactNode;
  dm?: boolean;
  warn?: boolean;
  testId?: string;
}) {
  return (
    <Chip tone={warn ? 'warn' : dm ? 'dm' : 'muted'} testId={testId}>
      {children}
    </Chip>
  );
}

/** A DM is named by its pair, a room by its hash. Shared by the card, the
    reader strip and every label that has to say what a mark-read clears. */
export function whereLabel(card: InboxCardData): string {
  return card.kind === 'dm' && card.participants
    ? `${card.participants.a} ↔ ${card.participants.b}`
    : `#${card.room}`;
}

/** The card's own scale: the artboard's 12.16px handle beside a 10px sprite,
    a step under the message header's. */
const CARD_HANDLE: AgentNameSize = {
  font: 'var(--tk-fs-2xs)',
  avatar: 10,
};

/**
 * What the task line says while the daemon is down. `kind: 'path'` is not a
 * pretence about where the agent is: it is the dim `.doing.dim` treatment,
 * which exists for exactly this "nothing better known" case and is what the
 * DaemonDown artboard draws on a card.
 */
const WITHHELD_TASK: DoingLine = { text: 'last known', kind: 'path' };

/** An unanswered `@here` is measured by how long nobody has picked it up;
    everything else by how long it has been waiting for Matt. */
function ageLabel(card: InboxCardData, now: number): string {
  const elapsed = formatElapsed(now - card.postedAt);
  return card.reason === 'open-ask' ? `unclaimed ${elapsed}` : `${elapsed} ago`;
}

export interface InboxCardProps {
  card: InboxCardData;
  /** The card the reader is holding: accent border and wash. */
  open?: boolean;
  /** False withholds every presence claim (the task line) and every age,
      exactly as the rail and the page bar already do. @default true */
  reachable?: boolean;
  /** A prop, not `Date.now()` internally, so ages are testable without fake
      timers. @default Date.now() */
  now?: number;
  /** Opens this card in the reader beside the list. */
  onOpen: () => void;
  /**
   * Clears the card's ROOM, not the card. `chat:mark` takes `{handle, room}`
   * and has no per-message cursor, so this also clears that room's other
   * unread -- which is why the control names the room rather than saying a
   * bare "mark read".
   */
  onMarkRead: () => void;
  /** Leaves the inbox for the room, parked on this message. */
  onOpenRoom: () => void;
}

/**
 * One `.card2`: who posted, the first lines of what they said, and where it
 * lives. The whole card opens the reader; the two links in the meta row are
 * their own actions and never do that as a side effect.
 */
export function InboxCard({
  card,
  open = false,
  reachable = true,
  now = Date.now(),
  onOpen,
  onMarkRead,
  onOpenRoom,
}: InboxCardProps) {
  const ctx = useBuddies();
  const author = ctx?.byHandle.get(card.handle);
  const task = reachable && author ? doing(author, now) : null;
  const where = whereLabel(card);
  const isDm = card.kind === 'dm';

  return (
    <Box
      data-testid={`inbox-card-${card.messageId}`}
      data-open={open ? 'true' : undefined}
      className={classes.card}
      onClick={onOpen}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        padding: '9.6px 11.2px',
        borderRadius: 'var(--mantine-radius-md)',
        border: `1px solid ${open ? ACCENT_TEXT : BORDER}`,
        background: open
          ? `color-mix(in srgb, ${ACCENT_TEXT} var(--tk-wash), var(--tk-panel))`
          : 'var(--tk-panel)',
        cursor: 'pointer',
      }}
    >
      <Group gap="sm" wrap="nowrap" align="center" style={{ minWidth: 0 }}>
        {/* The handle, its repo token and its task line are one unit, the
            same one the message header renders -- only the scale differs, so
            the hue chip's hover wash and the `.doing.dim` fallback come with
            it rather than being restated here. */}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <AgentName
            handle={card.handle}
            variant="inline"
            hue={speakerHue(card.handle)}
            size={CARD_HANDLE}
            reachable={reachable}
            now={now}
            task={reachable ? task : WITHHELD_TASK}
          />
        </Box>
        <Text component="span" style={{ ...MUTED_XS, flex: 'none' }}>
          {localTime(card.postedAt)}
        </Text>
      </Group>

      {/* A real button, not just the card's own click: the lead is the
          keyboard path to the reader, and the card cannot be one itself
          without nesting the meta row's two buttons inside it. */}
      <UnstyledButton
        data-testid={`card-lead-${card.messageId}`}
        className={classes.lead}
        aria-label={`Read ${card.handle}'s message in ${where}`}
        onClick={event => {
          event.stopPropagation();
          onOpen();
        }}
        // Two lines of the message, no more: the card is a pointer at the
        // thing, and the reader beside it is where the thing is read.
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {card.excerpt}
      </UnstyledButton>

      <Group gap="sm" wrap="nowrap" align="center" style={{ minWidth: 0 }}>
        <CtxChip dm={isDm} testId={`card-ctx-${card.messageId}`}>
          {where}
        </CtxChip>
        <Text
          component="span"
          truncate
          data-testid={`card-age-${card.messageId}`}
          style={{ ...MUTED_XS, minWidth: 0 }}
        >
          {reachable ? ageLabel(card, now) : 'last known'}
        </Text>
        <Box style={{ flex: 1 }} />
        <UnstyledButton
          data-testid={`card-open-${card.messageId}`}
          className={classes.link}
          aria-label={`Open ${where} at this message`}
          onClick={event => {
            event.stopPropagation();
            onOpenRoom();
          }}
          style={{
            flex: 'none',
            fontSize: 'var(--tk-fs-3xs)',
            fontWeight: 600,
            color: ACCENT_TEXT,
          }}
        >
          open {where}
        </UnstyledButton>
        <Text component="span" style={MUTED_XS}>
          ·
        </Text>
        <UnstyledButton
          data-testid={`card-mark-read-${card.messageId}`}
          className={classes.link}
          aria-label={`Mark ${where} read`}
          onClick={event => {
            event.stopPropagation();
            onMarkRead();
          }}
          style={{
            flex: 'none',
            fontSize: 'var(--tk-fs-3xs)',
            fontWeight: 600,
            color: ACCENT_TEXT,
          }}
        >
          mark {where} read
        </UnstyledButton>
      </Group>
    </Box>
  );
}
