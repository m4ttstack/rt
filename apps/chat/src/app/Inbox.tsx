import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Group,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type { InboxCard as InboxCardData, InboxPayload } from '../server/inbox';
import { Chip } from './Chip';
import type { ComposerBuddy } from './Composer';
import classes from './inbox.module.css';
import { CtxChip, InboxCard } from './InboxCard';
import { Reader } from './Reader';
import { isMsgTopic, useRelayFrames } from './relay-socket';

const MUTED = 'var(--tk-muted-text)';
const BORDER = 'var(--tk-border)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';

/** The card list's own width, from ANATOMY: wide enough for two lines of
    lead at the prose size, narrow enough to leave the reader the majority. */
const LIST_WIDTH = 560;

const EMPTY_INBOX: InboxPayload = {
  needsYou: [],
  openAsks: [],
  elsewhere: [],
};

export const UNREAD_BADGE = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 18,
  padding: '0 var(--mantine-spacing-sm)',
  borderRadius: 'var(--mantine-radius-xl)',
  fontSize: 'var(--tk-fs-3xs)',
  fontWeight: 500,
  lineHeight: 1,
  border: `1px solid ${BORDER}`,
  color: MUTED,
  whiteSpace: 'nowrap',
} as const;

/** The card list read top to bottom: what needs an answer, then what nobody
    has claimed. The reader's selection walks this same order. */
export function orderedCards(inbox: InboxPayload): InboxCardData[] {
  return [...inbox.needsYou, ...inbox.openAsks];
}

function elsewhereUnread(inbox: InboxPayload): number {
  return inbox.elsewhere.reduce((sum, row) => sum + row.unread, 0);
}

/** Everything the inbox knows is unread, cards included: what `mark all
    read` would clear if it ran right now. */
export function unreadTotal(inbox: InboxPayload): number {
  return inbox.needsYou.length + inbox.openAsks.length + elsewhereUnread(inbox);
}

/**
 * Fetches the inbox on mount (skipped when `seed` replaces it, the same test
 * seam the rest of the app uses) and again on any `chat/<room>/msg` frame:
 * a post is the one signal that what needs Matt may have changed. The
 * caller also refetches after a mark-read, which no frame announces.
 */
export function useInbox(seed?: InboxPayload): {
  inbox: InboxPayload;
  refetchInbox: () => void;
} {
  const [inbox, setInbox] = useState<InboxPayload>(seed ?? EMPTY_INBOX);
  const latestRequest = useRef(0);

  const refetchInbox = useCallback(() => {
    const requestId = ++latestRequest.current;
    fetch('/api/chat/inbox')
      .then(res => res.json())
      .then((data: Partial<InboxPayload>) => {
        // A newer refetch already superseded this one: dropping the stale
        // response keeps a slow request from clobbering fresher state.
        if (requestId !== latestRequest.current) return;
        setInbox({
          needsYou: data.needsYou ?? [],
          openAsks: data.openAsks ?? [],
          elsewhere: data.elsewhere ?? [],
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (seed !== undefined) return;
    refetchInbox();
    // Mount-only: `seed` is a one-time starting value, not a prop to re-sync on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRelayFrames(frame => {
    if (isMsgTopic(frame.topic)) refetchInbox();
  });

  return { inbox, refetchInbox };
}

/** `.sect`: an all-caps label, an optional note, then a rule to the edge. */
function Section({
  testId,
  label,
  note,
}: {
  testId: string;
  label: string;
  note?: string;
}) {
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      align="center"
      data-testid={testId}
      style={{ padding: '8px 0 4px' }}
    >
      <Text
        component="span"
        style={{
          flex: 'none',
          fontSize: 'var(--tk-fs-4xs)',
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: MUTED,
        }}
      >
        {label}
      </Text>
      {note && (
        <Text
          component="span"
          truncate
          style={{ minWidth: 0, fontSize: 'var(--tk-fs-3xs)', color: MUTED }}
        >
          {note}
        </Text>
      )}
      <Box
        style={{ flex: 1, height: 1, background: 'var(--tk-border-soft)' }}
      />
    </Group>
  );
}

export interface InboxBarProps {
  inbox: InboxPayload;
  /** False withholds every presence claim, leaving one honest chip. */
  reachable?: boolean;
  /** The per-room mark, for every room that has unread. */
  onMarkAllRead: () => void;
}

/**
 * The inbox's page bar: what the landing view is, in three counts, and the
 * one sweep that clears them.
 *
 * The artboard also draws a ⋯ beside the sweep. It is deliberately not built:
 * every action it could carry (open a room, mark everything read, change the
 * scheme) already has its own control on this page or in the rail, and a
 * menu whose only item duplicates the button beside it is chrome, not an
 * affordance.
 */
export function InboxBar({
  inbox,
  reachable = true,
  onMarkAllRead,
}: InboxBarProps) {
  const total = unreadTotal(inbox);
  const asks = inbox.openAsks.length;

  return (
    <Group
      align="center"
      wrap="nowrap"
      gap="sm"
      data-testid="inbox-bar"
      style={{ height: '100%', width: '100%', minWidth: 0 }}
    >
      <Box
        component="span"
        style={{ display: 'inline-flex', flex: 'none', color: MUTED }}
      >
        <Icon name="inbox" size={18} />
      </Box>
      <Text fw={700} size="xl" lh={1.35} truncate style={{ flex: 'none' }}>
        Inbox
      </Text>
      <Box style={{ width: 4.8, flex: 'none' }} />
      <Group
        gap="sm"
        wrap="nowrap"
        style={{ flex: '1 1 0%', minWidth: 0, overflowX: 'auto' }}
      >
        {reachable ? (
          <>
            {inbox.needsYou.length > 0 && (
              <Chip tone="accent" testId="inbox-chip-needs-you">
                @ {inbox.needsYou.length} need you
              </Chip>
            )}
            {asks > 0 && (
              <Chip
                tone="ok"
                testId="inbox-chip-open-asks"
                leftSection={
                  <Box
                    component="span"
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flex: 'none',
                      background: 'var(--tk-dot-ok)',
                    }}
                  />
                }
              >
                {asks} open ask{asks === 1 ? '' : 's'}
              </Chip>
            )}
            <Chip testId="inbox-chip-elsewhere">
              {elsewhereUnread(inbox)} unread elsewhere
            </Chip>
          </>
        ) : (
          <Chip testId="inbox-chip-withheld">
            last known · presence withheld
          </Chip>
        )}
      </Group>
      {total > 0 && (
        <Group gap={0} ml="auto" wrap="nowrap">
          <Button
            variant="default"
            size="xs"
            radius="md"
            data-testid="inbox-mark-all-read"
            aria-label="Mark everything read"
            onClick={onMarkAllRead}
            leftSection={<Icon name="check" size={14} />}
            rightSection={
              <Box component="span" style={UNREAD_BADGE}>
                {total}
              </Box>
            }
            styles={{
              root: {
                background: 'var(--tk-bg)',
                borderColor: BORDER,
                fontSize: 'var(--tk-fs-2xs)',
              },
            }}
          >
            mark all read
          </Button>
        </Group>
      )}
    </Group>
  );
}

export interface InboxProps {
  inbox: InboxPayload;
  /** False withholds presence and disables the reader's composer. */
  reachable?: boolean;
  /** A prop, not `Date.now()` internally, so card ages are testable without
      fake timers. @default Date.now() */
  now?: number;
  /** The fleet, for the reader composer's `@` popover. */
  buddies: ComposerBuddy[];
  /** Members of the OPEN CARD's room, which the caller fetches: a card can
      point at a room nothing else on the page has open. */
  readerMembers: string[];
  humanHandle?: string;
  /** The card the reader holds. The caller owns this so it can fetch that
      room's members alongside. */
  openCard?: InboxCardData;
  onOpenCard: (card: InboxCardData) => void;
  /** Clears one card's ROOM (see `InboxCard.onMarkRead`). */
  onMarkRoomRead: (room: string) => void;
  /** The per-room mark, for every room. */
  onMarkAllRead: () => void;
  onOpenRoom: (room: string, messageId: number) => void;
  /** A reply landed in the reader. Posting only: no cursor moved. */
  onReplied: () => void;
  /**
   * The phone (`PhoneInbox.dc.html`): one full-width column of cards, no
   * reader beside it -- a 560px list plus a reader does not fit a 390px
   * screen. A card tap still hands the card to `onOpenCard`, same as
   * desktop; the caller (`PhoneInboxPage`, App.tsx) is what swaps this list
   * for the reader route, not this component.
   */
  phone?: boolean;
}

/**
 * The landing view: a list of what actually needs Matt, and a reader beside
 * it so he can answer without leaving. Everything the fleet said that does
 * NOT need him collapses into one row of counts, on purpose ... 155 unread
 * in #rt is what kept him out of this app, and it is not a to-do list.
 */
export function Inbox({
  inbox,
  reachable = true,
  now = Date.now(),
  buddies,
  readerMembers,
  humanHandle,
  openCard,
  onOpenCard,
  onMarkRoomRead,
  onMarkAllRead,
  onOpenRoom,
  onReplied,
  phone = false,
}: InboxProps) {
  const asks = inbox.openAsks.length;
  const dmRows = inbox.elsewhere.filter(row => row.kind === 'dm');
  const roomRows = inbox.elsewhere.filter(row => row.kind !== 'dm');
  const dmUnread = dmRows.reduce((sum, row) => sum + row.unread, 0);

  const card = (item: InboxCardData) => (
    <InboxCard
      key={item.messageId}
      card={item}
      open={openCard?.messageId === item.messageId}
      reachable={reachable}
      now={now}
      onOpen={() => onOpenCard(item)}
      onMarkRead={() => onMarkRoomRead(item.room)}
      onOpenRoom={() => onOpenRoom(item.room, item.messageId)}
    />
  );

  return (
    <Group
      align="stretch"
      wrap="nowrap"
      gap={0}
      data-testid="inbox"
      style={{ flex: 1, minHeight: 0, minWidth: 0 }}
    >
      <Box
        data-testid="inbox-list"
        style={{
          width: phone ? '100%' : LIST_WIDTH,
          flex: phone ? 1 : 'none',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: '11.2px 14.4px',
          overflowY: 'auto',
          background: 'var(--tk-card)',
          borderRight: phone ? undefined : `1px solid ${BORDER}`,
        }}
      >
        {inbox.needsYou.length > 0 && (
          <>
            <Section
              testId="inbox-section-needs-you"
              label="NEEDS YOU"
              note={String(inbox.needsYou.length)}
            />
            {inbox.needsYou.map(card)}
          </>
        )}

        {asks > 0 && (
          <>
            <Section
              testId="inbox-section-open-asks"
              label="OPEN ASKS"
              note={`${asks} · @here, nobody claimed`}
            />
            {inbox.openAsks.map(card)}
          </>
        )}

        <Section testId="inbox-section-elsewhere" label="EVERYTHING ELSE" />
        <Group
          gap="sm"
          wrap="wrap"
          align="center"
          data-testid="inbox-elsewhere-row"
          style={{ padding: '2px 0' }}
        >
          <Group
            gap="sm"
            wrap="wrap"
            align="center"
            data-testid="inbox-elsewhere-chips"
            style={{ minWidth: 0 }}
          >
            {roomRows.map(row => (
              <CtxChip
                key={row.room}
                testId={`inbox-elsewhere-room-${row.room}`}
              >
                #{row.room} {row.unread}
              </CtxChip>
            ))}
            {dmRows.length > 0 && (
              <CtxChip dm testId="inbox-elsewhere-dm">
                {dmRows.length} DM{dmRows.length === 1 ? '' : 's'} · {dmUnread}
              </CtxChip>
            )}
          </Group>
          <Box style={{ flex: 1 }} />
          <UnstyledButton
            data-testid="inbox-elsewhere-mark-all"
            className={classes.link}
            aria-label="Mark everything read"
            onClick={onMarkAllRead}
            style={{
              flex: 'none',
              fontSize: 'var(--tk-fs-3xs)',
              fontWeight: 600,
              color: ACCENT_TEXT,
            }}
          >
            mark all read
          </UnstyledButton>
        </Group>
        <Text
          component="span"
          data-testid="inbox-elsewhere-note"
          style={{
            paddingTop: 2,
            fontSize: 'var(--tk-fs-3xs)',
            color: MUTED,
          }}
        >
          Nothing here mentions you or is waiting on an answer. Open a room from
          the tree when you want the full record.
        </Text>
      </Box>

      {phone ? null : openCard ? (
        <Reader
          card={openCard}
          humanHandle={humanHandle}
          daemonReachable={reachable}
          buddies={buddies}
          roomMembers={readerMembers}
          onOpenRoom={() => onOpenRoom(openCard.room, openCard.messageId)}
          onReplied={onReplied}
        />
      ) : (
        <Box
          data-testid="inbox-reader-empty"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--mantine-spacing-xl)',
            // Same near-white surface the open reader uses (see Reader.tsx).
            background: 'var(--tk-card)',
            color: MUTED,
          }}
        >
          <Text size="sm" style={{ color: MUTED }}>
            Nothing is waiting on you right now.
          </Text>
        </Box>
      )}
    </Group>
  );
}
