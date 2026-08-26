import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import type { ChatMessage } from '@mattstack/rt-client';

const BORDER_SOFT = 'var(--tk-border-soft)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';
const ACCENT_WASH = `color-mix(in srgb, ${ACCENT_TEXT} var(--tk-wash), transparent)`;

export interface TranscriptProps {
  room: string;
  messages: ChatMessage[];
  /** The human's own handle -- a mention of it gets the `.at.me` wash. */
  humanHandle?: string;
  /** When set and >0, splits a `.divider` ("N new / mark read") before the
      last N messages. Not wired to a real read cursor yet -- there is no
      `lastReadId` in this prop surface -- but gives the divider a real,
      audit-reachable mount point. */
  unreadCount?: number;
  onMarkRead?: () => void;
  /** Task 7's `Composer`, rendered inside this SAME card below the
      messages -- the artboard draws one `.card` (scroll area, then the
      composer row), never two stacked cards. */
  footer?: ReactNode;
  /** Phone.dc.html draws the transcript with NO card of its own -- flush on
      the page background, no border or radius -- since the phone shell's
      own header and composer bar already read as chrome. @default false */
  bare?: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local time, deliberately -- never the UTC the timestamp is stored in. */
function formatLocalTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface BodyPart {
  type: 'text' | 'code';
  content: string;
}

/** Splits a message body on fenced ``` code blocks; everything outside a
    fence is plain prose (further parsed for mentions/inline code by the
    caller). */
function splitCodeFences(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  const fence = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(body))) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: body.slice(lastIndex, match.index) });
    }
    parts.push({
      type: 'code',
      content: match[1].replace(/^\n/, '').replace(/\n$/, ''),
    });
    lastIndex = fence.lastIndex;
  }
  if (lastIndex < body.length) {
    parts.push({ type: 'text', content: body.slice(lastIndex) });
  }
  return parts;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `@handle` -> `.at` (accent, 600), `.at.me` (plus the accent wash) when
    the handle is the human's own -- only for handles the message itself
    lists in `mentions`, never a bare `@word` guess. */
function renderMentions(
  text: string,
  mentions: string[],
  humanHandle: string | undefined,
  keyPrefix: string
): React.ReactNode[] {
  if (mentions.length === 0) return [text];
  const pattern = mentions.map(escapeForRegExp).join('|');
  const regex = new RegExp(`@(${pattern})\\b`, 'g');
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    const handle = match[1];
    const isMe = handle === humanHandle;
    out.push(
      <Text
        key={`${keyPrefix}-m-${i++}`}
        component="span"
        fw={600}
        style={{
          color: ACCENT_TEXT,
          ...(isMe
            ? { background: ACCENT_WASH, borderRadius: 3, padding: '0 3px' }
            : {}),
        }}
      >
        @{handle}
      </Text>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

/** Inline `` `code` `` spans within prose -- split first, so an `@` inside a
    code span is never mistaken for a mention. */
function renderTextPart(
  text: string,
  mentions: string[],
  humanHandle: string | undefined,
  keyPrefix: string
): React.ReactNode[] {
  const chunks = text.split(/(`[^`]+`)/g);
  return chunks.map((chunk, i) => {
    if (chunk.length >= 2 && chunk.startsWith('`') && chunk.endsWith('`')) {
      return (
        <Box
          key={`${keyPrefix}-c-${i}`}
          component="code"
          style={{
            background: 'var(--ui-bg-3)',
            border: `1px solid ${BORDER_SOFT}`,
            borderRadius: 3,
            fontFamily: 'inherit',
            fontSize: '11.2px',
            padding: '0 3px',
          }}
        >
          {chunk.slice(1, -1)}
        </Box>
      );
    }
    return (
      <span key={`${keyPrefix}-t-${i}`}>
        {renderMentions(chunk, mentions, humanHandle, `${keyPrefix}-${i}`)}
      </span>
    );
  });
}

function MessageBody({
  message,
  humanHandle,
}: {
  message: ChatMessage;
  humanHandle: string | undefined;
}) {
  const parts = splitCodeFences(message.body);
  return (
    <Text
      component="div"
      style={{
        fontSize: '12.16px',
        lineHeight: 1.55,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {parts.map((part, i) =>
        part.type === 'code' ? (
          <Box
            key={`part-${i}`}
            component="pre"
            data-testid="code-block"
            style={{
              display: 'block',
              background: 'var(--ui-bg-1)',
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--mantine-radius-sm)',
              fontSize: '11.2px',
              lineHeight: 1.5,
              marginTop: 'var(--mantine-spacing-xs)',
              overflowX: 'auto',
              padding: 'var(--mantine-spacing-sm) var(--mantine-spacing-md)',
              whiteSpace: 'pre',
              fontFamily: 'inherit',
            }}
          >
            {part.content}
          </Box>
        ) : (
          <span key={`part-${i}`}>
            {renderTextPart(
              part.content,
              message.mentions,
              humanHandle,
              `p${i}`
            )}
          </span>
        )
      )}
    </Text>
  );
}

function MessageRow({
  message,
  humanHandle,
  isFirst,
}: {
  message: ChatMessage;
  humanHandle: string | undefined;
  isFirst: boolean;
}) {
  return (
    <Group
      align="flex-start"
      wrap="nowrap"
      gap="md"
      data-testid={`message-${message.id}`}
      style={{
        padding: '8.4px 0',
        minWidth: 0,
        borderTop: isFirst ? undefined : `1px solid ${BORDER_SOFT}`,
      }}
    >
      <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
        <Group gap="sm" wrap="nowrap" align="baseline">
          <Text size="sm" fw={600}>
            {message.handle}
          </Text>
          <Text size="xs" style={{ color: 'var(--tk-muted)' }}>
            {formatLocalTime(message.postedAt)}
          </Text>
        </Group>
        <MessageBody message={message} humanHandle={humanHandle} />
      </Stack>
    </Group>
  );
}

function wsUrl(): string {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

/** Dedupes incoming messages by id and keeps the list ordered -- a WS frame
    is a pointer, so the tail refetch it triggers may re-deliver rows the
    caller already has. */
function mergeMessages(
  prev: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const known = new Set(prev.map(m => m.id));
  const additions = incoming.filter(m => !known.has(m.id));
  if (additions.length === 0) return prev;
  return [...prev, ...additions].sort(
    (a, b) => a.postedAt - b.postedAt || a.id - b.id
  );
}

/**
 * The live transcript: message rows in one card, a WS-driven tail refetch
 * on a doorbell frame for THIS room, and an optional read-cursor divider.
 *
 * A WS frame carries only `{ id }` -- a pointer, never prose (chat owns the
 * message store; the journal is just the doorbell) -- so the handler here
 * never renders straight off the frame payload. It refetches the room's
 * tail (`GET /api/chat/messages/:room`) and merges by id; a frame for
 * another room's topic is dropped before any network call happens.
 */
export function Transcript({
  room,
  messages: initialMessages,
  humanHandle,
  unreadCount,
  onMarkRead,
  footer,
  bare = false,
}: TranscriptProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const roomRef = useRef(room);
  roomRef.current = room;

  // Re-seeds local state whenever the CALLER's own messages array changes
  // identity -- not just when `room` changes. The caller fetches
  // asynchronously, so its first render for a room almost always passes an
  // empty (or stale) array; syncing only on `room` would freeze this
  // component on that first snapshot forever once the real fetch resolves,
  // since `room` itself wouldn't change again.
  useEffect(() => {
    setMessages(initialMessages);
  }, [room, initialMessages]);

  useEffect(() => {
    const expectedTopic = `chat/${room}/msg`;
    const socket = new WebSocket(wsUrl());

    socket.onmessage = event => {
      let frame: { topic?: unknown } | undefined;
      try {
        frame = JSON.parse(String((event as { data: unknown }).data));
      } catch {
        return;
      }
      if (typeof frame?.topic !== 'string' || frame.topic !== expectedTopic)
        return;

      void fetch(`/api/chat/messages/${room}`)
        .then(res => res.json())
        .then((data: { messages?: ChatMessage[] }) => {
          if (roomRef.current !== room) return;
          setMessages(prev => mergeMessages(prev, data.messages ?? []));
        })
        .catch(() => {});
    };

    return () => socket.close();
  }, [room]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(`/api/chat/messages/${room}?before=${oldest.id}`);
      const data = (await res.json()) as { messages?: ChatMessage[] };
      const older = data.messages ?? [];
      if (older.length > 0) {
        setMessages(prev => {
          const known = new Set(prev.map(m => m.id));
          const additions = older.filter(m => !known.has(m.id));
          return [...additions, ...prev].sort(
            (a, b) => a.postedAt - b.postedAt || a.id - b.id
          );
        });
      }
    } catch {
      // The daemon being down is silence, not a crash -- the edge control
      // just stays put for a retry.
    } finally {
      setLoadingOlder(false);
    }
  }

  const dividerAt =
    unreadCount !== undefined &&
    unreadCount > 0 &&
    unreadCount < messages.length
      ? messages.length - unreadCount
      : -1;

  return (
    <Box
      style={{
        // The artboard's middle `.card`: takes the row's remaining width,
        // and `minWidth: 0` so a long pasted path wraps inside it rather
        // than widening the whole row.
        flex: 1,
        minWidth: 0,
        background: bare ? undefined : 'var(--ui-bg-2)',
        border: bare
          ? undefined
          : '1px solid var(--mantine-color-default-border)',
        borderRadius: bare ? undefined : 'var(--mantine-radius-md)',
        padding: bare
          ? undefined
          : 'var(--mantine-spacing-lg) var(--mantine-spacing-xl)',
      }}
      data-testid="transcript"
    >
      {messages.length > 0 && (
        <Box
          component="button"
          type="button"
          data-testid="transcript-edge"
          onClick={() => void loadOlder()}
          style={{
            width: '100%',
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            padding: '6px 0 4px',
            textAlign: 'center',
            fontSize: '10.56px',
            color: 'var(--tk-muted)',
          }}
        >
          {loadingOlder ? 'Loading older…' : 'Load older messages'}
        </Box>
      )}

      <Stack gap={0}>
        {messages.map((message, i) => (
          <Fragment key={message.id}>
            {i === dividerAt && (
              <Group
                gap="sm"
                wrap="nowrap"
                align="center"
                data-testid="transcript-divider"
                style={{
                  color: ACCENT_TEXT,
                  fontSize: '10.56px',
                  fontWeight: 600,
                  padding: 'var(--mantine-spacing-xs) 0',
                }}
              >
                <Box
                  style={{
                    flex: 1,
                    height: 1,
                    background: `color-mix(in srgb, ${ACCENT_TEXT} 45%, transparent)`,
                  }}
                />
                <span>{unreadCount} new</span>
                <span>·</span>
                <UnstyledButton
                  data-testid="transcript-mark-read"
                  onClick={onMarkRead}
                  style={{ color: ACCENT_TEXT, fontWeight: 600 }}
                >
                  mark read
                </UnstyledButton>
                <Box
                  style={{
                    flex: 1,
                    height: 1,
                    background: `color-mix(in srgb, ${ACCENT_TEXT} 45%, transparent)`,
                  }}
                />
              </Group>
            )}
            <MessageRow
              message={message}
              humanHandle={humanHandle}
              isFirst={i === 0}
            />
          </Fragment>
        ))}
      </Stack>

      {footer}
    </Box>
  );
}
