import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Group, Stack, Text, UnstyledButton } from '@mattstack/app-kit/core';
import type { ChatMessage } from '@mattstack/rt-client';
import ScrollToBottom, { useAtTop } from 'react-scroll-to-bottom';

import { CopyActionIcon } from '@mattstack/app-kit/core';
import { AgentName } from './AgentName';
import { dayKey, dayLabel } from './day-label';
import { NewPill } from './NewPill';
import bodyClasses from './transcript-body.module.css';
import scrollClasses from './transcript-scroll.module.css';

const BORDER_SOFT = 'var(--tk-border-soft)';
/** The panel's horizontal insets, applied to the list content and the
    footer rather than the panel: the extra 17px on the left clears the
    sidebar's collapse trigger, which is a 34px button centred on the
    sidebar edge. */
const INNER_LEFT = 'calc(var(--mantine-spacing-xl) + 17px)';
const INNER_RIGHT = 'var(--mantine-spacing-xl)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';
const ACCENT_WASH = `color-mix(in srgb, ${ACCENT_TEXT} var(--tk-wash), transparent)`;
/** A body taller than this (its unconstrained scrollHeight) folds behind a
    show more control; the anchored message is the one exception, since it
    mounted expanded on purpose. */
const COLLAPSE_AT = 480;

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
  /** Element id of the message a `#m-<id>` link points at; scrolled into
      view once per room+anchor, the first time it is in the list. */
  anchor?: string;
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

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const BULLET_RE = /^\s*[-*] /;
const NUMBERED_RE = /^\s*\d+[.)] /;
/** `*text*` or `_text_` with no space just inside the markers and no word
    character just outside, so `make_icon_swift` and `2*3*4` stay literal.
    Runs after the URL split, so an underscore inside a link is never read. */
const ITALIC_RE =
  /((?<![\w*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\w*])|(?<!\w)_(?!\s)[^_\n]+?(?<!\s)_(?!\w))/g;
/** Same source without `g`: `test` on a global regex advances `lastIndex`
    across calls, but `split` never resets it, so a second bare URL in one
    body would test false and render as text. Anchored, stateless. */
const URL_TEST = new RegExp(`^${URL_RE.source}$`);

/** `**bold**` and bare URLs inside a prose chunk that has already been split
    away from code spans, so neither markup form is ever read inside code. */
function renderInline(
  text: string,
  mentions: string[],
  humanHandle: string | undefined,
  keyPrefix: string
): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).flatMap((chunk, i) => {
    if (chunk.length > 4 && chunk.startsWith('**') && chunk.endsWith('**')) {
      return [
        <Text key={`${keyPrefix}-b-${i}`} component="strong" fw={600} inherit>
          {chunk.slice(2, -2)}
        </Text>,
      ];
    }
    return chunk.split(URL_RE).map((piece, j) =>
      URL_TEST.test(piece) ? (
        <a
          key={`${keyPrefix}-u-${i}-${j}`}
          href={piece}
          target="_blank"
          rel="noreferrer"
          style={{ color: ACCENT_TEXT, overflowWrap: 'anywhere' }}
        >
          {piece}
        </a>
      ) : (
        <span key={`${keyPrefix}-t-${i}-${j}`}>
          {renderItalic(piece, mentions, humanHandle, `${keyPrefix}-${i}-${j}`)}
        </span>
      )
    );
  });
}

function renderItalic(
  text: string,
  mentions: string[],
  humanHandle: string | undefined,
  keyPrefix: string
): React.ReactNode[] {
  return text.split(ITALIC_RE).map((piece, k) => {
    const wrapped =
      piece.length > 2 &&
      ((piece.startsWith('*') && piece.endsWith('*')) ||
        (piece.startsWith('_') && piece.endsWith('_')));
    return wrapped ? (
      <Text key={`${keyPrefix}-i-${k}`} component="em" fs="italic" inherit>
        {piece.slice(1, -1)}
      </Text>
    ) : (
      <span key={`${keyPrefix}-m-${k}`}>
        {renderMentions(piece, mentions, humanHandle, `${keyPrefix}-${k}`)}
      </span>
    );
  });
}

/** Blank-line paragraphs, `- ` and `1.` lists inside a prose part. Agents write
    markdown by reflex; this is the subset that gives their structure a
    place to land without rendering HTML. */
function renderBlocks(
  text: string,
  mentions: string[],
  humanHandle: string | undefined,
  keyPrefix: string
): React.ReactNode[] {
  const blocks = text.split(/\n{2,}/).filter(b => b.trim().length > 0);
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    const isBullets = lines.every(l => BULLET_RE.test(l));
    const isNumbered = !isBullets && lines.every(l => NUMBERED_RE.test(l));
    const key = `${keyPrefix}-blk-${i}`;
    if (isBullets || isNumbered) {
      const marker = isBullets ? BULLET_RE : NUMBERED_RE;
      return (
        <Box
          key={key}
          component={isBullets ? 'ul' : 'ol'}
          data-testid="message-list"
          style={{ margin: '4px 0', paddingLeft: 18 }}
        >
          {lines.map((l, j) => (
            <li key={`${key}-${j}`}>
              {renderTextPart(
                l.replace(marker, ''),
                mentions,
                humanHandle,
                `${key}-${j}`
              )}
            </li>
          ))}
        </Box>
      );
    }
    return (
      <Box
        key={key}
        component="p"
        data-testid="message-paragraph"
        style={{ margin: i === 0 ? 0 : '8px 0 0' }}
      >
        {renderTextPart(block, mentions, humanHandle, key)}
      </Box>
    );
  });
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
        {renderInline(chunk, mentions, humanHandle, `${keyPrefix}-${i}`)}
      </span>
    );
  });
}

function MessageBody({
  message,
  humanHandle,
  startExpanded,
}: {
  message: ChatMessage;
  humanHandle: string | undefined;
  startExpanded: boolean;
}) {
  const parts = splitCodeFences(message.body);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [expanded, setExpanded] = useState(startExpanded);

  // Measures the unconstrained body once per message: a body's height only
  // changes with its content, so a ResizeObserver would be watching for an
  // event that never happens here.
  useLayoutEffect(() => {
    setTall((bodyRef.current?.scrollHeight ?? 0) > COLLAPSE_AT);
  }, [message.id]);

  const folded = tall && !expanded;
  const body = (
    <Text
      ref={bodyRef}
      component="div"
      data-testid="message-body"
      style={{
        fontSize: '12.16px',
        lineHeight: 1.55,
        // Agents post multi-line bodies; without this every newline collapses
        // into one paragraph.
        whiteSpace: 'pre-wrap',
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {parts.map((part, i) =>
        part.type === 'code' ? (
          <Box
            key={`part-${i}`}
            className={bodyClasses.codeWrap}
            data-testid="code-wrap"
          >
            <Box
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
            <Box className={bodyClasses.copy} data-testid="code-copy">
              <CopyActionIcon
                value={part.content}
                label="Copy"
                size="sm"
                variant="default"
                iconSize={14}
                aria-label="Copy code"
              />
            </Box>
          </Box>
        ) : (
          <span key={`part-${i}`}>
            {renderBlocks(part.content, message.mentions, humanHandle, `p${i}`)}
          </span>
        )
      )}
    </Text>
  );
  if (!tall) return body;
  return (
    <Box data-testid="message-fold" data-folded={folded ? 'true' : 'false'}>
      <Box className={folded ? bodyClasses.fold : undefined}>{body}</Box>
      <UnstyledButton
        data-testid="fold-toggle"
        onClick={() => setExpanded(e => !e)}
        style={{
          marginTop: 4,
          fontSize: '10.56px',
          fontWeight: 600,
          color: ACCENT_TEXT,
        }}
      >
        {folded ? 'show more' : 'show less'}
      </UnstyledButton>
    </Box>
  );
}

/** A muted counterpart of the read-cursor divider: rules either side, the
    day in the middle. */
function DayDivider({ label }: { label: string }) {
  const rule = {
    flex: 1,
    height: 1,
    background: 'var(--tk-border-soft)',
  } as const;
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      align="center"
      data-testid="day-divider"
      aria-label={label}
      style={{
        color: 'var(--tk-muted-text)',
        fontSize: '10.56px',
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

function MessageRow({
  message,
  humanHandle,
  isFirst,
  anchored,
}: {
  message: ChatMessage;
  humanHandle: string | undefined;
  isFirst: boolean;
  anchored: boolean;
}) {
  return (
    <Group
      align="flex-start"
      wrap="nowrap"
      gap="md"
      id={`m-${message.id}`}
      data-testid={`message-${message.id}`}
      style={{
        padding: '8.4px 0',
        minWidth: 0,
        borderTop: isFirst ? undefined : `1px solid ${BORDER_SOFT}`,
      }}
    >
      <Stack gap={1} style={{ minWidth: 0, flex: 1 }}>
        <Group gap="sm" wrap="nowrap" align="baseline">
          <AgentName handle={message.handle} variant="inline" />
          <Text
            size="xs"
            title={new Date(message.postedAt).toLocaleString()}
            style={{ color: 'var(--tk-muted-text)' }}
          >
            {formatLocalTime(message.postedAt)}
          </Text>
        </Group>
        <MessageBody
          message={message}
          humanHandle={humanHandle}
          startExpanded={anchored}
        />
      </Stack>
    </Group>
  );
}

/** The top edge of the list. Older pages load when the viewer scrolls to
    the top of a list that actually scrolls (`useAtTop` is also true for a
    list too short to scroll, which would page until the room ran dry);
    the row stays a button for short lists and for tests. */
function OlderEdge({
  loading,
  exhausted,
  scrollView,
  onLoad,
}: {
  loading: boolean;
  exhausted: boolean;
  scrollView: () => HTMLElement | null;
  onLoad: () => void;
}) {
  const [atTop] = useAtTop();
  useEffect(() => {
    if (!atTop || loading || exhausted) return;
    const view = scrollView();
    if (!view || view.scrollHeight <= view.clientHeight) return;
    onLoad();
  }, [atTop, loading, exhausted, scrollView, onLoad]);
  const label = exhausted
    ? 'no older messages'
    : loading
      ? 'Loading older…'
      : 'older messages · load on scroll';
  return (
    <Box
      component="button"
      type="button"
      data-testid="transcript-edge"
      onClick={onLoad}
      disabled={exhausted}
      style={{
        width: '100%',
        border: 0,
        background: 'transparent',
        cursor: exhausted ? 'default' : 'pointer',
        padding: '6px 0 4px',
        textAlign: 'center',
        fontSize: '10.56px',
        color: 'var(--tk-muted-text)',
      }}
    >
      {label}
    </Box>
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
  anchor,
  onMarkRead,
  footer,
  bare = false,
}: TranscriptProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [olderLoaded, setOlderLoaded] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newSinceAway, setNewSinceAway] = useState(0);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  // Set before an older page is prepended; consumed once the DOM has the
  // new rows, so the viewport stays on the message the viewer was reading.
  const anchorHeight = useRef<number | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const awayRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

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
    setOlderExhausted(false);
    setLoadingOlder(false);
    setOlderLoaded(false);
    setNewSinceAway(0);
    setAwayFromBottom(false);
    awayRef.current = false;
  }, [room]);

  // The `#m-<id>` anchor rt prints after a post and on a wake line. Scrolls
  // once per room+anchor, the first time the message is in the list, so a
  // later live merge or older-page load never yanks a viewer who scrolled
  // away back to it. Older pages are not fetched for it: a link past the
  // first page opens the room and only the scroll is skipped.
  const anchorDone = useRef<string | null>(null);
  useEffect(() => {
    if (!anchor) return;
    const target = `${room}#${anchor}`;
    if (anchorDone.current === target) return;
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    anchorDone.current = target;
  }, [room, anchor, messages]);

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
          const next = mergeMessages(messagesRef.current, data.messages ?? []);
          const added = next.length - messagesRef.current.length;
          if (added > 0 && awayRef.current) setNewSinceAway(n => n + added);
          setMessages(next);
        })
        .catch(() => {});
    };

    return () => socket.close();
  }, [room]);

  useEffect(() => {
    const view = scrollView();
    if (!view) return;
    const onScroll = () => {
      const away = view.scrollHeight - view.scrollTop - view.clientHeight > 4;
      awayRef.current = away;
      setAwayFromBottom(away);
      if (!away) setNewSinceAway(0);
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    return () => view.removeEventListener('scroll', onScroll);
  }, [room]);

  function scrollView(): HTMLElement | null {
    return (
      scrollBoxRef.current?.querySelector<HTMLElement>(
        `.${scrollClasses.view}`
      ) ?? null
    );
  }

  useLayoutEffect(() => {
    const before = anchorHeight.current;
    const view = scrollView();
    if (before === null || !view) return;
    anchorHeight.current = null;
    view.scrollTop += view.scrollHeight - before;
  }, [messages]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest || loadingOlder || olderExhausted) return;
    setLoadingOlder(true);
    // The request belongs to the room it was started for: a switch while it
    // is in flight must neither prepend its page to the new room nor leave
    // `loadingOlder` stuck.
    const forRoom = room;
    const current = () => roomRef.current === forRoom;
    try {
      const res = await fetch(`/api/chat/messages/${room}?before=${oldest.id}`);
      if (!current()) return;
      // An error page is not an empty page: the edge stays retryable.
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: ChatMessage[] };
      if (!current()) return;
      const older = data.messages ?? [];
      if (older.length === 0) setOlderExhausted(true);
      if (older.length > 0) {
        setOlderLoaded(true);
        anchorHeight.current = scrollView()?.scrollHeight ?? null;
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
      if (current()) setLoadingOlder(false);
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
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // The lightest surface, so the transcript reads a step above the
        // sidebar and roster panels on `bg2` either side of it.
        background: bare ? undefined : 'var(--tk-card)',
        // The sidebar's collapse trigger is a 34px button centred on the
        // sidebar edge, so 17px of it rides over this panel: the left
        // padding clears it, and nothing else, so text never sits under it.
        // Vertical padding only: the horizontal padding lives INSIDE the
        // scroll view (and on the footer), so the scrollbar hugs the panel's
        // edge instead of sitting inset beside the text.
        padding: bare ? undefined : 'var(--mantine-spacing-lg) 0',
      }}
      data-testid="transcript"
    >
      {/* Sticky-bottom scrolling, as console's chat does it: the
          list follows new messages while the viewer is at the bottom, and a
          follow button appears once they scroll up. The wrapper is the
          positioned box the absolute root fills. */}
      <Box
        ref={scrollBoxRef}
        data-testid="transcript-scroll"
        className={scrollClasses.box}
        style={{ flex: 1, minHeight: 0 }}
      >
        <ScrollToBottom
          className={scrollClasses.root}
          scrollViewClassName={scrollClasses.view}
          followButtonClassName={scrollClasses.follow}
          initialScrollBehavior="auto"
        >
          <Box
            style={
              bare ? undefined : { padding: `0 ${INNER_RIGHT} 0 ${INNER_LEFT}` }
            }
          >
            {messages.length > 0 && (
              <OlderEdge
                loading={loadingOlder}
                exhausted={olderExhausted}
                scrollView={scrollView}
                onLoad={() => void loadOlder()}
              />
            )}

            <Stack gap={0}>
              {messages.map((message, i) => (
                <Fragment key={message.id}>
                  {(i === 0
                    ? olderLoaded
                    : dayKey(messages[i - 1]!.postedAt) !==
                      dayKey(message.postedAt)) && (
                    <DayDivider label={dayLabel(message.postedAt)} />
                  )}
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
                    anchored={anchor === `m-${message.id}`}
                  />
                </Fragment>
              ))}
            </Stack>
          </Box>
        </ScrollToBottom>
        {awayFromBottom && (
          <NewPill
            count={newSinceAway}
            onClick={() => {
              const view = scrollView();
              if (!view) return;
              if (typeof view.scrollTo === 'function') {
                view.scrollTo({ top: view.scrollHeight, behavior: 'smooth' });
              } else {
                view.scrollTop = view.scrollHeight;
              }
            }}
          />
        )}
      </Box>
      {footer && (
        <Box
          style={
            bare ? undefined : { padding: `0 ${INNER_RIGHT} 0 ${INNER_LEFT}` }
          }
        >
          {footer}
        </Box>
      )}
    </Box>
  );
}
