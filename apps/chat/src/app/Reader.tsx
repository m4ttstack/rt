import { useEffect, useState } from 'react';
import { Box, Group, Text, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { ChatMessage } from '@mattstack/rt-client';

import type { InboxCard as InboxCardData } from '../server/inbox';
import { AgentName, MESSAGE_HANDLE } from './AgentName';
import { useBuddies } from './buddies-context';
import { Composer, type ComposerBuddy } from './Composer';
import { dayLabel, localTime } from './day-label';
import { doing } from './doing';
import { HUMAN_HANDLE } from './human';
import classes from './inbox.module.css';
import { CtxChip, whereLabel } from './InboxCard';
import { MessageMarkdown } from './MessageMarkdown';
import { PHONE_BORDER, PHONE_TAP, tapButtonStyle } from './phone-chrome';
import { speakerHue } from './speaker-hue';
import prose from './transcript-prose.module.css';

const MUTED = 'var(--tk-muted-text)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';
const RULE_ACCENT = `color-mix(in srgb, ${ACCENT_TEXT} 45%, transparent)`;

/**
 * The opened message plus the one before it, in one request.
 *
 * `/api/chat/messages/:room` takes only `before` and `limit`; there is no
 * "around" endpoint, and `before` is EXCLUSIVE. Asking for the two messages
 * before `id + 1` is therefore exactly this window, and `+ 1` is safe as a
 * strict upper bound whether or not ids are contiguous, since they are
 * integers.
 */
function windowUrl(room: string, messageId: number): string {
  return `/api/chat/messages/${room}?before=${messageId + 1}&limit=2`;
}

/** A muted rules-either-side label, like the transcript's day boundary, but
    naming where the context above came from rather than when. */
function ContextLabel({ label }: { label: string }) {
  const rule = { flex: 1, height: 1, background: 'var(--tk-border-soft)' };
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      align="center"
      data-testid="reader-context-label"
      style={{
        color: MUTED,
        fontSize: 'var(--tk-fs-3xs)',
        fontWeight: 600,
        padding: 'var(--mantine-spacing-xs) 0',
      }}
    >
      <Box style={rule} />
      <span>{label}</span>
      <Box style={rule} />
    </Group>
  );
}

/** The phone header (`Phone.dc.html`): back, `.ctx` chip, `<handle> needs
    you`, open-room icon -- replaces `ReaderStrip` rather than squashing it,
    since there is no room at 390px for the day note or the "shown with the
    message before it" aside. */
function ReaderPhoneHeader({
  card,
  onBack,
  onOpenRoom,
}: {
  card: InboxCardData;
  onBack: () => void;
  onOpenRoom: () => void;
}) {
  const where = whereLabel(card);
  return (
    <Group
      wrap="nowrap"
      gap="xs"
      data-testid="reader-phone-header"
      style={{
        height: 56,
        flex: 'none',
        padding: '0 var(--mantine-spacing-sm) 0 2px',
        background: 'var(--tk-panel)',
        borderBottom: `1px solid ${PHONE_BORDER}`,
      }}
    >
      <UnstyledButton
        aria-label="Back to the inbox"
        data-testid="reader-back"
        onClick={onBack}
        style={tapButtonStyle(PHONE_TAP)}
      >
        <Icon name="chevronLeft" size={20} />
      </UnstyledButton>
      <CtxChip dm={card.kind === 'dm'}>{where}</CtxChip>
      <Text
        truncate
        fw={700}
        style={{ fontSize: 'var(--mantine-font-size-sm)', minWidth: 0 }}
      >
        {card.handle} needs you
      </Text>
      <Box style={{ flex: 1 }} />
      <UnstyledButton
        aria-label={`Open ${where}`}
        data-testid="reader-open-room"
        onClick={onOpenRoom}
        style={tapButtonStyle(PHONE_TAP)}
      >
        <Icon name="externalLink" size={18} />
      </UnstyledButton>
    </Group>
  );
}

/** The accent counterpart, marking the message the card pointed at. */
function OpenedDivider() {
  const rule = { flex: 1, height: 1, background: RULE_ACCENT };
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      align="center"
      data-testid="reader-divider"
      style={{
        color: ACCENT_TEXT,
        fontSize: 'var(--tk-fs-3xs)',
        fontWeight: 600,
        padding: 'var(--mantine-spacing-xs) 0',
      }}
    >
      <Box style={rule} />
      <span>the message you opened</span>
      <Box style={rule} />
    </Group>
  );
}

/** The transcript's own `.msg` anatomy, reused rather than restyled: a
    message reads the same wherever it is shown. */
function ReaderMessage({
  message,
  humanHandle,
  context = false,
}: {
  message: ChatMessage;
  humanHandle: string;
  context?: boolean;
}) {
  const ctx = useBuddies();
  const author = ctx?.byHandle.get(message.handle);
  const task = ctx?.reachable && author ? doing(author, ctx.now) : null;
  return (
    <div
      data-testid={
        context ? 'reader-context-message' : `reader-message-${message.id}`
      }
      className={context ? `${prose.msg} ${classes.context}` : prose.msg}
    >
      <div className={prose.hdr}>
        <AgentName
          handle={message.handle}
          variant="inline"
          hue={speakerHue(message.handle, humanHandle)}
          task={task}
          size={MESSAGE_HANDLE}
        />
        <Text
          size="xs"
          title={new Date(message.postedAt).toLocaleString()}
          style={{ color: MUTED }}
        >
          {localTime(message.postedAt)}
        </Text>
      </div>
      <div className={prose.prose}>
        <MessageMarkdown
          body={message.body}
          mentions={message.mentions}
          humanHandle={humanHandle}
        />
      </div>
    </div>
  );
}

export interface ReaderProps {
  card: InboxCardData;
  /** @default HUMAN_HANDLE (`./human`). */
  humanHandle?: string;
  /** False disables the composer with the draft kept. @default true */
  daemonReachable?: boolean;
  /** The fleet, for the composer's `@` popover. */
  buddies: ComposerBuddy[];
  /** Members of THIS card's room, which is not necessarily the room the
      rest of the page has open. */
  roomMembers: string[];
  /** Leaves the inbox for the room, parked on this message. */
  onOpenRoom: () => void;
  /** A reply landed. It posts and nothing else: no cursor moves, so a
      caller must not treat this as a mark-read. */
  onReplied?: () => void;
  /** Phone chrome (`Phone.dc.html`): the 56px back/ctx/`needs you`/open-room
      header replaces `reader-strip`, and the composer takes the 16px input,
      44px targets. Required whenever `phone` is set -- it is the only way
      back to the list. @default false */
  phone?: boolean;
  onBack?: () => void;
}

/**
 * The right half of the inbox: the message a card pointed at, in full, with
 * the one before it above for context, and a composer already addressed to
 * its author.
 *
 * Replying posts and stops there. `chat:mark` has no per-message cursor
 * (`{handle, room}` only), so there is no cursor a reply could honestly
 * advance, and the footer says so rather than implying otherwise.
 */
export function Reader({
  card,
  humanHandle = HUMAN_HANDLE,
  daemonReachable = true,
  buddies,
  roomMembers,
  onOpenRoom,
  onReplied,
  phone = false,
  onBack,
}: ReaderProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { room, messageId } = card;

  useEffect(() => {
    let cancelled = false;
    // Clear first: a stale pair under a new card's header reads as the
    // wrong message having been opened.
    setMessages([]);
    fetch(windowUrl(room, messageId))
      .then(res => res.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [room, messageId]);

  const opened = messages.find(m => m.id === messageId);
  const before = messages.filter(m => m.id < messageId).at(-1);
  const where = whereLabel(card);

  const composer = (
    <Composer
      // A different card is a different draft: remounting is what
      // re-seeds the pre-tagged author and drops the previous one.
      key={messageId}
      room={room}
      roomMembers={roomMembers}
      buddies={buddies}
      humanHandle={humanHandle}
      isDm={card.kind === 'dm'}
      daemonReachable={daemonReachable}
      phone={phone}
      prefill={{ body: `@${card.handle} `, mentions: [card.handle] }}
      placeholder={`Reply in ${where} · @${card.handle} is already tagged`}
      onPosted={onReplied}
    />
  );

  return (
    <Box
      data-testid="reader"
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // The conversation stays on the near-white card surface, matching the
        // full-room transcript; the greyer page canvas (`--tk-bg`) read as
        // too dark behind the messages.
        background: 'var(--tk-card)',
      }}
    >
      {phone ? (
        <ReaderPhoneHeader
          card={card}
          onBack={() => onBack?.()}
          onOpenRoom={onOpenRoom}
        />
      ) : (
        <Group
          gap="sm"
          wrap="nowrap"
          align="center"
          data-testid="reader-strip"
          style={{
            height: 40,
            flex: 'none',
            padding: '0 var(--mantine-spacing-xl)',
            borderBottom: '1px solid var(--tk-border-soft)',
          }}
        >
          <CtxChip dm={card.kind === 'dm'}>{where}</CtxChip>
          <Text
            component="span"
            truncate
            data-testid="reader-note"
            style={{
              minWidth: 0,
              fontSize: 'var(--tk-fs-3xs)',
              color: MUTED,
            }}
          >
            {dayLabel(card.postedAt).toLowerCase()}
            {before ? ' · shown with the message before it' : ''}
          </Text>
          <Box style={{ flex: 1 }} />
          <UnstyledButton
            data-testid="reader-open-room"
            className={classes.link}
            aria-label={`Open ${where} at this message`}
            onClick={onOpenRoom}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flex: 'none',
              fontSize: 'var(--tk-fs-3xs)',
              fontWeight: 600,
              color: ACCENT_TEXT,
            }}
          >
            <Icon name="externalLink" size={12} />
            open {where}
          </UnstyledButton>
        </Group>
      )}

      <Box
        data-testid="reader-body"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: phone
            ? 'var(--mantine-spacing-sm) var(--mantine-spacing-md) 0'
            : '8px var(--mantine-spacing-xl) 0',
        }}
      >
        <div className={prose.col}>
          {before && (
            <>
              <ContextLabel label={`earlier in ${where}`} />
              <ReaderMessage
                message={before}
                humanHandle={humanHandle}
                context
              />
              <OpenedDivider />
            </>
          )}
          {opened ? (
            <ReaderMessage message={opened} humanHandle={humanHandle} />
          ) : (
            // The window fetch has not landed (or the message is gone from
            // the store): the card's own excerpt is still the truth about
            // what needs answering, so the panel is never blank.
            <Box
              data-testid="reader-excerpt-fallback"
              className={prose.msg}
              style={{ color: MUTED }}
            >
              {card.excerpt}
            </Box>
          )}
        </div>
      </Box>

      {phone ? (
        // Phone chrome already owns its own edge padding, background and
        // border-top: the desktop's centred, padded `.col` wrapper below
        // would double it.
        composer
      ) : (
        <Box
          style={{
            padding: '0 var(--mantine-spacing-xl) var(--mantine-spacing-md)',
          }}
        >
          <div className={prose.col}>{composer}</div>
        </Box>
      )}
    </Box>
  );
}
