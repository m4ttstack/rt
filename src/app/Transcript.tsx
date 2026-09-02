import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import {
  Box,
  Button,
  Group,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import type { ChatMessage } from '@mattstack/rt-client';
import ScrollToBottom, {
  useAnimating,
  useScrollTo,
} from 'react-scroll-to-bottom';

import { AgentName } from './AgentName';
import { dayKey, dayLabel } from './day-label';
import { MessageMarkdown } from './MessageMarkdown';
import { NewPill } from './NewPill';
import { useRelayFrames, useRelayOpen } from './relay-socket';
import { speakerHue } from './speaker-hue';
import prose from './transcript-prose.module.css';
import scrollClasses from './transcript-scroll.module.css';
import { useExpandAll } from './use-expand-all';

/** The panel's horizontal insets, applied to the list content and the
    footer rather than the panel: the extra 17px on the left clears the
    sidebar's collapse trigger, which is a 34px button centred on the
    sidebar edge. */
const INNER_LEFT = 'calc(var(--mantine-spacing-xl) + 17px)';
const INNER_RIGHT = 'var(--mantine-spacing-xl)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';
/** A body taller than this (its unconstrained scrollHeight) folds behind a
    show more control; the anchored message is the one exception, since it
    mounted expanded on purpose. */
const COLLAPSE_AT = 480;
/** Messages per page: the newest page on open, and one page per older
    load. Agent posts run long, so this is one to two screens. */
export const PAGE_SIZE = 30;
/** How many older pages a `#m-<id>` link may pull in looking for its
    message before the viewer is left where the room opened. */
const ANCHOR_PAGES_MAX = 10;
/** How long the reader's row is held at its viewport offset after a prepend
    or an anchor scroll while the content above it settles: a fold applies
    a render after mount, and a fenced block's highlighter lands later
    still. Any gesture from the viewer ends the hold early. */
const HOLD_MS = 1500;
const HOLD_BREAKERS = [
  'wheel',
  'touchstart',
  'pointerdown',
  'keydown',
] as const;

/** Where message `id` sits in `view`, as an offset from the view's top. */
function rowOffset(view: HTMLElement, id: number): number | null {
  const el = document.getElementById(`m-${id}`);
  if (!el) return null;
  return el.getBoundingClientRect().top - view.getBoundingClientRect().top;
}

/** Puts message `id` back at viewport offset `offset` now, and again on
    every resize of `column` for HOLD_MS, until the viewer scrolls or
    clicks; `holds` keeps the one active hold so a new one ends the last.
    Returns the correction so a deferred park can apply it. */
function holdRow(
  view: HTMLElement,
  column: HTMLElement | null,
  id: number,
  offset: number,
  holds: RefObject<(() => void) | null>
): () => void {
  holds.current?.();
  const correct = () => {
    const now = rowOffset(view, id);
    if (now !== null && Math.abs(now - offset) > 1) {
      view.scrollTop += now - offset;
    }
  };
  correct();
  if (!column) return correct;
  const observer = new ResizeObserver(correct);
  observer.observe(column);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const name of HOLD_BREAKERS) view.removeEventListener(name, stop);
    if (holds.current === stop) holds.current = null;
  };
  const timer = setTimeout(stop, HOLD_MS);
  for (const name of HOLD_BREAKERS) {
    view.addEventListener(name, stop, { passive: true });
  }
  holds.current = stop;
  return correct;
}

type ScrollToFn = (
  top: number | '100%',
  options?: { behavior: 'auto' | 'smooth' }
) => void;

interface ScrollControl {
  /** Parks the viewer at the top `at` reports and stops the list following
      the bottom. */
  park: (at: () => number) => void;
  /** Jumps to the bottom and follows it again. */
  follow: () => void;
}

/** Lends the scroll library's own `scrollTo` to the transcript. Only that
    call reaches the library's follow-the-bottom state, which a bare
    `scrollIntoView` never clears, so the next content change while the
    list still counts as following snaps it back to the bottom. The state
    only clears while nothing is animating to the end, and every mount
    starts with such an animation, so a request made mid-animation waits
    for it to finish; `at` is read then, not when the request was made. */
function ScrollHandle({ handle }: { handle: RefObject<ScrollControl | null> }) {
  const scrollTo = useScrollTo() as ScrollToFn;
  const [animating] = useAnimating();
  const animatingRef = useRef(animating);
  animatingRef.current = animating;
  const pending = useRef<(() => number | '100%') | null>(null);
  const flush = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    scrollTo(next(), { behavior: 'auto' });
  }, [scrollTo]);
  useEffect(() => {
    if (!animating) flush();
  }, [animating, flush]);
  useEffect(() => {
    const request = (next: () => number | '100%') => {
      pending.current = next;
      if (!animatingRef.current) flush();
    };
    handle.current = {
      park: at => request(at),
      follow: () => request(() => '100%'),
    };
    return () => {
      handle.current = null;
    };
  }, [handle, flush]);
  return null;
}

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
  /** An edge row above the older-messages control: the invite result line
      after a create-room or add-agents. Renders even with no messages yet,
      so a room created without inviting still shows it. */
  notice?: ReactNode;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local time, deliberately -- never the UTC the timestamp is stored in. */
function formatLocalTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [expanded, setExpanded] = useState(startExpanded);
  // App-wide override: when on, nothing folds and the per-message control
  // stays hidden, since there is nothing left to reveal.
  const [expandAll] = useExpandAll();

  // A fenced code block's highlighter loads lazily and can grow the body
  // well after this mounts, so a one-shot measurement would miss it; the
  // observer re-measures whenever the unclamped content settles. The fold
  // clip lives on an ancestor Box, never on this ref's own element, so
  // folding itself never re-triggers the observer.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setTall(el.scrollHeight > COLLAPSE_AT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [message.id]);

  const folded = tall && !expanded && !expandAll;
  // The wrapper shape stays IDENTICAL whether or not `tall` is true: a
  // position whose element type changes on re-render gets remounted by
  // React, which would drop the live CodeHighlight instance and reset the
  // fold. Only props/children vary here, never types.
  return (
    <Box
      data-testid={tall ? 'message-fold' : undefined}
      data-folded={tall ? (folded ? 'true' : 'false') : undefined}
    >
      <Box className={folded ? prose.fold : undefined}>
        <div ref={bodyRef} data-testid="message-body" className={prose.prose}>
          <MessageMarkdown
            body={message.body}
            mentions={message.mentions}
            humanHandle={humanHandle}
          />
        </div>
      </Box>
      {tall && !expandAll && (
        <UnstyledButton
          data-testid="fold-toggle"
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 'var(--mantine-spacing-xs)',
            fontSize: 'var(--tk-fs-3xs)',
            fontWeight: 600,
            color: ACCENT_TEXT,
          }}
        >
          {folded ? 'show more' : 'show less'}
        </UnstyledButton>
      )}
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

function YouBadge() {
  return (
    <Box
      component="span"
      data-testid="you-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 16,
        padding: '0 var(--mantine-spacing-sm)',
        borderRadius: 'var(--mantine-radius-xl)',
        fontSize: 'var(--tk-fs-4xs)',
        fontWeight: 500,
        lineHeight: 1,
        border: '1px solid var(--tk-border)',
        color: 'var(--tk-muted-text)',
      }}
    >
      you
    </Box>
  );
}

function MessageRow({
  message,
  humanHandle,
  anchored,
}: {
  message: ChatMessage;
  humanHandle: string | undefined;
  anchored: boolean;
}) {
  const mine = humanHandle !== undefined && message.handle === humanHandle;
  return (
    <div
      id={`m-${message.id}`}
      data-testid={`message-${message.id}`}
      data-mine={mine ? 'true' : undefined}
      className={mine ? `${prose.msg} ${prose.mine}` : prose.msg}
    >
      <div className={prose.hdr}>
        <AgentName
          handle={message.handle}
          variant="inline"
          hue={speakerHue(message.handle, humanHandle)}
        />
        {mine && <YouBadge />}
        <Text
          size="xs"
          title={new Date(message.postedAt).toLocaleString()}
          style={{ color: 'var(--tk-muted-text)' }}
        >
          {formatLocalTime(message.postedAt)}
        </Text>
      </div>
      <MessageBody
        message={message}
        humanHandle={humanHandle}
        startExpanded={anchored}
      />
    </div>
  );
}

/** The top edge of the list: the only way to load older, and the row that
    reports a page in flight or a room with nothing older. Deliberately not
    a scroll trigger: the scroll library re-sticks to the bottom on a
    content change that lands within its 200ms scroll debounce, which a
    fast jump to the top plus an instant page did every time. */
function OlderEdge({
  loading,
  exhausted,
  onLoad,
}: {
  loading: boolean;
  exhausted: boolean;
  onLoad: () => void;
}) {
  return (
    <Box
      style={{
        padding: 'var(--mantine-spacing-sm) 0 var(--mantine-spacing-xs)',
        textAlign: 'center',
      }}
    >
      <Button
        variant="subtle"
        size="xs"
        loading={loading}
        disabled={exhausted}
        onClick={onLoad}
        data-testid="transcript-edge"
      >
        {exhausted ? 'no older messages' : 'load older messages'}
      </Button>
    </Box>
  );
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
 * The live transcript: message rows in one card, a tail refetch on a
 * doorbell frame for THIS room from the page's relay socket (not a socket
 * of its own), and an optional read-cursor divider.
 *
 * A relay frame carries only `{ id }` -- a pointer, never prose (chat owns
 * the message store; the journal is just the doorbell) -- so the handler
 * here never renders straight off the frame payload. It refetches the
 * room's tail (`GET /api/chat/messages/:room`) and merges by id; a frame for
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
  notice,
}: TranscriptProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [olderLoaded, setOlderLoaded] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newSinceAway, setNewSinceAway] = useState(0);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  // Set before an older page is prepended; consumed once the DOM has the
  // new rows, so the viewport stays on the message the viewer was reading.
  const pendingHold = useRef<{ id: number; offset: number } | null>(null);
  const hold = useRef<(() => void) | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const awayRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // The anchor effect keys on the list but must call the loader that sees
  // the current render's flags, so it goes through a ref refreshed each
  // render.
  const loadOlderRef = useRef<() => void>(() => {});
  const scrollHandle = useRef<ScrollControl | null>(null);

  // Re-seeds local state whenever the CALLER's own messages array changes
  // identity -- not just when `room` changes. The caller fetches
  // asynchronously, so its first render for a room almost always passes an
  // empty (or stale) array; syncing only on `room` would freeze this
  // component on that first snapshot forever once the real fetch resolves,
  // since `room` itself wouldn't change again.
  useEffect(() => {
    setMessages(initialMessages);
    // A first page with room to spare is the whole room. An empty array is
    // the caller's placeholder while its fetch is in flight, never a page.
    setOlderExhausted(
      initialMessages.length > 0 && initialMessages.length < PAGE_SIZE
    );
  }, [room, initialMessages]);

  useEffect(() => {
    setLoadingOlder(false);
    setOlderLoaded(false);
    setNewSinceAway(0);
    setAwayFromBottom(false);
    awayRef.current = false;
  }, [room]);

  // The `#m-<id>` anchor rt prints after a post and on a wake line. Scrolls
  // once per room+anchor, the first time the message is in the list, so a
  // later live merge or older-page load never yanks a viewer who scrolled
  // away back to it. A link below everything loaded pages older until the
  // message arrives or the page budget runs out; ids are monotonic, so an
  // id inside the loaded range that is not there is pruned or bogus and
  // earns no fetch.
  const anchorDone = useRef<string | null>(null);
  const anchorPaging = useRef({ target: '', pages: 0 });
  useEffect(() => {
    if (!anchor) return;
    const target = `${room}#${anchor}`;
    if (anchorDone.current === target) return;
    if (anchorPaging.current.target !== target) {
      anchorPaging.current = { target, pages: 0 };
    }
    const paging = anchorPaging.current;
    const id = Number(anchor.slice('m-'.length));
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      const view = scrollView();
      const offset = view ? rowOffset(view, id) : null;
      const correct =
        view && offset !== null
          ? holdRow(view, columnRef.current, id, offset, hold)
          : null;
      scrollHandle.current?.park(() => {
        correct?.();
        return view?.scrollTop ?? 0;
      });
      anchorDone.current = target;
      return;
    }
    if (loadingOlder) return;
    const oldest = messages[0];
    const below =
      oldest !== undefined && Number.isInteger(id) && id < oldest.id;
    if (below && !olderExhausted && paging.pages < ANCHOR_PAGES_MAX) {
      paging.pages += 1;
      loadOlderRef.current();
      return;
    }
    // The hunt is over without the message: pages were pulled for it, so
    // hand the viewer the bottom back rather than wherever it left them.
    if (paging.pages > 0) {
      scrollHandle.current?.follow();
      anchorDone.current = target;
    }
  }, [room, anchor, messages, olderExhausted, loadingOlder]);

  const refetchTail = useCallback(() => {
    void fetch(`/api/chat/messages/${room}?limit=${PAGE_SIZE}`)
      .then(res => res.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (roomRef.current !== room) return;
        const next = mergeMessages(messagesRef.current, data.messages ?? []);
        const added = next.length - messagesRef.current.length;
        if (added > 0 && awayRef.current) setNewSinceAway(n => n + added);
        setMessages(next);
      })
      .catch(() => {});
  }, [room]);
  useRelayFrames(frame => {
    if (frame.topic === `chat/${room}/msg`) refetchTail();
  });
  useRelayOpen(reconnect => {
    if (reconnect) refetchTail();
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetchTail();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetchTail]);

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

  useEffect(() => () => hold.current?.(), [room]);

  useLayoutEffect(() => {
    const pending = pendingHold.current;
    const view = scrollView();
    if (!pending || !view) return;
    pendingHold.current = null;
    holdRow(view, columnRef.current, pending.id, pending.offset, hold);
  }, [messages]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest || loadingOlder || olderExhausted) return;
    setLoadingOlder(true);
    // A short room can show the control while the list still follows the
    // bottom; without this the prepend would snap the viewer back down.
    scrollHandle.current?.park(() => scrollView()?.scrollTop ?? 0);
    // The request belongs to the room it was started for: a switch while it
    // is in flight must neither prepend its page to the new room nor leave
    // `loadingOlder` stuck.
    const forRoom = room;
    const current = () => roomRef.current === forRoom;
    try {
      const res = await fetch(
        `/api/chat/messages/${room}?before=${oldest.id}&limit=${PAGE_SIZE}`
      );
      if (!current()) return;
      // An error page is not an empty page: the edge stays retryable.
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: ChatMessage[] };
      if (!current()) return;
      const older = data.messages ?? [];
      if (older.length < PAGE_SIZE) setOlderExhausted(true);
      if (older.length > 0) {
        setOlderLoaded(true);
        const view = scrollView();
        const offset = view ? rowOffset(view, oldest.id) : null;
        pendingHold.current =
          offset === null ? null : { id: oldest.id, offset };
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
  loadOlderRef.current = () => void loadOlder();

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
          <ScrollHandle handle={scrollHandle} />
          <Box
            style={
              bare ? undefined : { padding: `0 ${INNER_RIGHT} 0 ${INNER_LEFT}` }
            }
          >
            <div
              ref={columnRef}
              className={prose.col}
              data-testid="transcript-column"
            >
              {notice && (
                <Box
                  data-testid="transcript-notice"
                  style={{
                    padding:
                      'var(--mantine-spacing-sm) 0 var(--mantine-spacing-xs)',
                    textAlign: 'left',
                    fontSize: 'var(--tk-fs-3xs)',
                    color: 'var(--tk-muted-text)',
                  }}
                >
                  {notice}
                </Box>
              )}
              {messages.length > 0 && (
                <OlderEdge
                  loading={loadingOlder}
                  exhausted={olderExhausted}
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
                          fontSize: 'var(--tk-fs-3xs)',
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
                      anchored={anchor === `m-${message.id}`}
                    />
                  </Fragment>
                ))}
              </Stack>
            </div>
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
          <div className={prose.col}>{footer}</div>
        </Box>
      )}
    </Box>
  );
}
