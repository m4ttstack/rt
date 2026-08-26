import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import {
  Box,
  Group,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import type { BuddyStatus } from '@mattstack/rt-client';

import { Icon } from '@ui/icons';
import { notifications } from '@ui/notifications';
import { STATUS_WORD } from './statusDetail';

const MUTED = 'var(--tk-muted)';
const BORDER = 'var(--tk-border)';
const BORDER_SOFT = 'var(--tk-border-soft)';
const PURPLE = 'var(--tk-purple)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';

/**
 * `.accent-deep` has no direct `--tk-*` token (see RoomRail's own copy of
 * this derivation): the artboard's palette only defines it as a shade one
 * step past plain accent in light, and as plain accent again in dark.
 */
const ACCENT_DEEP =
  'light-dark(var(--mantine-color-accent-7), var(--mantine-color-accent-text))';
const ACCENT_ON = 'light-dark(var(--mantine-color-white), var(--tk-bg))';

const STATUS_TEXT_COLOR: Record<'live' | 'idle' | 'deaf', string> = {
  live: 'var(--mantine-color-ok-text)',
  idle: 'var(--mantine-color-warn-text)',
  deaf: 'var(--mantine-color-bad-text)',
};
const DOT_COLOR: Record<'live' | 'idle' | 'deaf', string> = {
  live: 'var(--tk-dot-ok)',
  idle: 'var(--tk-dot-warn)',
  deaf: 'var(--tk-dot-bad)',
};
const STATUS_ORDER: readonly ('live' | 'idle' | 'deaf')[] = [
  'live',
  'idle',
  'deaf',
];

export interface ComposerBuddy {
  handle: string;
  status: BuddyStatus;
}

export interface ComposerProps {
  /** The open room's slug -- the post route, the placeholder, and the
      popover's "not in #room" copy all key off it. */
  room: string;
  /** Handles already in the open room -- a DM's two participants, or a
      channel's current membership. What separates "insert @handle" from
      "not in #room -- DM instead" in the popover. */
  roomMembers: string[];
  /** The fleet, not the room -- same source `Roster` reads, so the popover
      can offer a DM to a buddy who has never joined this room. */
  buddies: ComposerBuddy[];
  /** @default 'matt'. There is no live source for this yet (see RoomRail's
      own unwired `humanHandle` prop) -- a caller passes a real handle once
      one exists. */
  humanHandle?: string;
  /** True inside a DM room: narrows the popover to the other participant
      and drops `@here` (there is nobody else to wake). @default false */
  isDm?: boolean;
  /** @default true. False disables the input and shows the daemon-down
      copy; the draft is never cleared. */
  daemonReachable?: boolean;
  /** Phone chrome: 16px input (below it, iOS zooms on focus), 44px tap
      targets, Enter is a newline -- only the button sends. @default false */
  phone?: boolean;
  /** Called with the DM room's slug once a "DM instead" send succeeds. */
  onNavigate?: (room: string) => void;
}

/**
 * The imperative surface `Roster`'s `onPick` drives (desktop panel and the
 * phone drawer's "tap to mention or DM" both go through this): a tap in
 * room inserts a mention at the caret, a tap outside it starts the same
 * DM-instead handoff the popover's own option triggers.
 */
export interface ComposerHandle {
  insertMention(handle: string): void;
  startDm(handle: string): void;
}

interface MentionToken {
  /** Index of the triggering `@` inside `value`. */
  start: number;
  /** Caret position when the token was last recomputed. */
  end: number;
  query: string;
}

/** An `@` token is only "active" when it starts at the beginning of the
    text or right after whitespace, and nothing typed since it opened has
    broken it with a space -- the same rule chat clients use everywhere. */
function detectMentionToken(text: string, caret: number): MentionToken | null {
  const uptoCaret = text.slice(0, caret);
  const atIndex = uptoCaret.lastIndexOf('@');
  if (atIndex === -1) return null;
  const before = atIndex > 0 ? uptoCaret[atIndex - 1] : undefined;
  if (before !== undefined && !/\s/.test(before)) return null;
  const query = uptoCaret.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { start: atIndex, end: caret, query };
}

function Dot({ status }: { status: 'live' | 'idle' | 'deaf' }) {
  return (
    <Box
      component="span"
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        flex: 'none',
        background: DOT_COLOR[status],
      }}
    />
  );
}

/**
 * One `.opt` row. A deaf buddy always carries the deaf warning even when
 * they are also outside the room -- that is the one failure this whole
 * viewer exists to catch, so it is never displaced by the (lower-stakes)
 * DM-instead note. Clicking still routes on room membership alone: a
 * mention still lands in a deaf buddy's unread, it just won't wake them.
 */
function BuddyOption({
  handle,
  status,
  inRoom,
  room,
  onSelect,
}: {
  handle: string;
  status: 'live' | 'idle' | 'deaf';
  inRoom: boolean;
  room: string;
  onSelect: (handle: string, inRoom: boolean) => void;
}) {
  const subtext =
    status === 'deaf'
      ? {
          text: "won't see this until its tail restarts",
          color: STATUS_TEXT_COLOR.deaf,
        }
      : !inRoom
        ? { text: `not in #${room} — DM instead`, color: PURPLE }
        : undefined;

  return (
    <UnstyledButton
      data-testid={`composer-option-${handle}`}
      onClick={() => onSelect(handle, inRoom)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--mantine-spacing-sm)',
        height: 44,
        width: '100%',
        minWidth: 0,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-sm)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <Dot status={status} />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text component="span" size="sm" fw={600} truncate>
          {handle}
        </Text>
        {subtext && (
          <Text
            component="span"
            size="xs"
            truncate
            style={{ color: subtext.color }}
          >
            {subtext.text}
          </Text>
        )}
      </Stack>
      <Text
        component="span"
        size="xs"
        style={{ color: STATUS_TEXT_COLOR[status], flex: 'none' }}
      >
        {STATUS_WORD[status]}
      </Text>
    </UnstyledButton>
  );
}

/** `@here` sits last, with its cost named up front: waking a room is not
    free, and this is the moment to see the bill. */
function HereOption({
  count,
  onSelect,
}: {
  count: number;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      data-testid="composer-option-here"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 44,
        width: '100%',
        minWidth: 0,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-sm)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <Text
        component="span"
        size="sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          color: MUTED,
        }}
      >
        @here
        <Text
          component="span"
          size="xs"
          style={{ color: MUTED, marginLeft: 'auto' }}
        >
          wakes {count} agents
        </Text>
      </Text>
    </UnstyledButton>
  );
}

/**
 * The composer: an `@`-popover input, DM-instead handoff, and the two
 * write routes behind it. The server owns joining (`POST /api/chat/post`)
 * and opening a DM (`POST /api/chat/dm`) -- this component only ever calls
 * its own app routes, never rt-client.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      room,
      roomMembers,
      buddies,
      humanHandle = 'matt',
      isDm = false,
      daemonReachable = true,
      phone = false,
      onNavigate,
    },
    ref
  ) {
    const [value, setValue] = useState('');
    const [mentions, setMentions] = useState<string[]>([]);
    const [dmTarget, setDmTarget] = useState<string | undefined>(undefined);
    const [sending, setSending] = useState(false);
    const [token, setToken] = useState<MentionToken | null>(null);
    const [focused, setFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // The draft itself survives a room switch (same leniency as surviving a
    // daemon outage), but a DM-instead handoff is chosen IN a room's
    // context -- carrying it into the next room read as the banner naming
    // a target the room switch had nothing to do with.
    useEffect(() => {
      setDmTarget(undefined);
    }, [room]);

    const showPopover = token !== null && daemonReachable;

    const relevant = isDm
      ? buddies.filter(b => roomMembers.includes(b.handle))
      : buddies.filter(b => b.status !== 'offline');
    const query = (token?.query ?? '').toLowerCase();
    const filtered = query
      ? relevant.filter(b => b.handle.toLowerCase().startsWith(query))
      : relevant;
    const options = STATUS_ORDER.flatMap(status =>
      filtered.filter(
        (b): b is ComposerBuddy & { status: typeof status } =>
          b.status === status
      )
    );
    const hereCount = roomMembers.filter(h => h !== humanHandle).length;
    const showHere = !isDm && (query === '' || 'here'.startsWith(query));

    function closePopover() {
      setToken(null);
    }

    function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
      const next = e.target.value;
      setValue(next);
      const caret = e.target.selectionStart ?? next.length;
      setToken(detectMentionToken(next, caret));
    }

    function replaceToken(insert: string): number {
      if (!token) return value.length;
      const before = value.slice(0, token.start);
      const after = value.slice(token.end);
      setValue(before + insert + after);
      return before.length + insert.length;
    }

    function focusAt(caret: number) {
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        el?.focus();
        el?.setSelectionRange(caret, caret);
      });
    }

    function insertMention(handle: string) {
      const caret = replaceToken(`@${handle} `);
      setMentions(prev => (prev.includes(handle) ? prev : [...prev, handle]));
      closePopover();
      focusAt(caret);
    }

    function switchToDm(handle: string) {
      replaceToken('');
      setDmTarget(handle);
      closePopover();
      focusAt(0);
      textareaRef.current?.focus();
    }

    function insertHere() {
      const caret = replaceToken('@here ');
      closePopover();
      focusAt(caret);
    }

    function selectBuddy(handle: string, inRoom: boolean) {
      if (inRoom) insertMention(handle);
      else switchToDm(handle);
    }

    async function send() {
      const body = value.trim();
      // `sending` guards a double-submit: ↵ twice, or ↵ while the button's
      // tap is already in flight, posts the same message twice. The draft is
      // only cleared on success, so the second press has a body to send.
      if (!body || !daemonReachable || sending) return;
      setSending(true);
      try {
        if (dmTarget) {
          try {
            const res = await fetch('/api/chat/dm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: dmTarget, body }),
            });
            if (!res.ok) throw new Error('dm failed');
            const data = (await res.json()) as { room: string };
            setValue('');
            setMentions([]);
            setDmTarget(undefined);
            onNavigate?.(data.room);
          } catch {
            notifications.error("Couldn't send — the draft is kept.");
          }
          return;
        }

        try {
          const res = await fetch('/api/chat/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              room,
              body,
              mentions: mentions.length ? mentions : undefined,
            }),
          });
          if (!res.ok) throw new Error('post failed');
          setValue('');
          setMentions([]);
        } catch {
          notifications.error("Couldn't send — the draft is kept.");
        }
      } finally {
        setSending(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (e.key === 'Escape' && token) {
        e.preventDefault();
        closePopover();
        return;
      }
      if (e.key === 'Enter' && token) {
        // No live-narrowed single candidate to commit to -- swallow Enter
        // rather than posting the raw "@" token as message text.
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !phone) {
        e.preventDefault();
        void send();
      }
      // Phone: Enter always inserts a newline; only the button sends.
    }

    /** `Roster`'s onPick, not the popover: there is no `@`-token to replace,
      so this inserts at the caret (or the end, unfocused) instead. */
    function insertMentionAtCaret(handle: string) {
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? value.length;
      const before = value.slice(0, caret);
      const after = value.slice(caret);
      const needsSpace = before.length > 0 && !/\s$/.test(before);
      const inserted = `${needsSpace ? ' ' : ''}@${handle} `;
      setValue(before + inserted + after);
      setMentions(prev => (prev.includes(handle) ? prev : [...prev, handle]));
      focusAt(before.length + inserted.length);
    }

    useImperativeHandle(ref, () => ({
      insertMention: insertMentionAtCaret,
      startDm: (handle: string) => {
        setDmTarget(handle);
        focusAt(value.length);
      },
    }));

    // Phone drops each hint suffix -- the room-width placeholder wraps to a
    // second line at 375px otherwise, which a native placeholder has no
    // ellipsis for once it wraps rather than overflows.
    const placeholder = !daemonReachable
      ? phone
        ? 'rt daemon unreachable'
        : "Can't post — rt daemon unreachable. Your draft is kept."
      : dmTarget
        ? phone
          ? `Message ${dmTarget}`
          : `Message ${dmTarget} — will DM`
        : isDm
          ? phone
            ? `Message ${roomMembers.join(' ↔ ')}`
            : `Message ${roomMembers.join(' ↔ ')} — both will wake`
          : phone
            ? `Message #${room}`
            : `Message #${room} — @ to mention`;

    const inputBorderColor = !daemonReachable
      ? BORDER
      : focused
        ? ACCENT_TEXT
        : BORDER;

    return (
      <Box
        data-testid="composer"
        style={
          phone
            ? {
                position: 'relative',
                flex: 'none',
                padding:
                  '8px var(--mantine-spacing-lg) var(--mantine-spacing-lg)',
                background: 'var(--tk-panel)',
                borderTop: `1px solid ${BORDER}`,
              }
            : {
                position: 'relative',
                paddingTop: 'var(--mantine-spacing-md)',
                marginTop: 'var(--mantine-spacing-xs)',
                borderTop: `1px solid ${BORDER_SOFT}`,
              }
        }
      >
        <Popover
          opened={showPopover}
          onClose={closePopover}
          position="top-start"
          middlewares={{ flip: false, shift: true }}
          offset={6}
          width="target"
          withArrow={false}
          trapFocus={false}
          returnFocus={false}
          radius="md"
          withinPortal
        >
          <Popover.Target>
            <Group
              data-testid="composer-row"
              gap="sm"
              wrap="nowrap"
              align="center"
            >
              <Box
                data-testid="composer-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flex: 1,
                  minWidth: 0,
                  gap: 'var(--mantine-spacing-sm)',
                  minHeight: phone ? 44 : 36,
                  padding: '0 var(--mantine-spacing-md)',
                  background: !daemonReachable
                    ? 'var(--tk-panel)'
                    : 'var(--ui-bg-1)',
                  border: `1px solid ${inputBorderColor}`,
                  borderStyle: !daemonReachable ? 'dashed' : 'solid',
                  borderRadius: 'var(--mantine-radius-md)',
                  color: !daemonReachable ? MUTED : undefined,
                }}
              >
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={value}
                  disabled={!daemonReachable}
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder={placeholder}
                  aria-label="Message"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 0,
                    outline: 'none',
                    resize: 'none',
                    background: 'transparent',
                    color: 'inherit',
                    fontFamily: 'inherit',
                    fontSize: phone ? 16 : 'var(--mantine-font-size-md)',
                    lineHeight: 1.4,
                    padding: '8px 0',
                  }}
                />
                {!phone && daemonReachable && (
                  <Group gap={4} wrap="nowrap" style={{ flex: 'none' }}>
                    <Kbd>↵ send</Kbd>
                    <Kbd>⇧↵ newline</Kbd>
                  </Group>
                )}
              </Box>
              <UnstyledButton
                aria-label="Send"
                data-testid="composer-send"
                disabled={!daemonReachable}
                onClick={() => void send()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 'none',
                  width: phone ? 44 : 34,
                  height: phone ? 44 : 34,
                  borderRadius: 'var(--mantine-radius-md)',
                  background: !daemonReachable ? 'var(--ui-bg-4)' : ACCENT_DEEP,
                  color: !daemonReachable ? MUTED : ACCENT_ON,
                  cursor: !daemonReachable ? 'default' : 'pointer',
                }}
              >
                <Icon name="send" size={phone ? 18 : 16} />
              </UnstyledButton>
            </Group>
          </Popover.Target>
          <Popover.Dropdown
            data-testid="composer-popover"
            style={{
              background: 'var(--tk-panel)',
              border: `1px solid ${BORDER}`,
              borderRadius: 'var(--mantine-radius-md)',
              padding: 'var(--mantine-spacing-xs)',
              boxShadow:
                '0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18)',
            }}
          >
            <Stack gap={1}>
              {options.map(b => (
                <BuddyOption
                  key={b.handle}
                  handle={b.handle}
                  status={b.status as 'live' | 'idle' | 'deaf'}
                  inRoom={roomMembers.includes(b.handle)}
                  room={room}
                  onSelect={selectBuddy}
                />
              ))}
              {showHere && (
                <HereOption count={hereCount} onSelect={insertHere} />
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>

        <Group
          gap={4}
          wrap="nowrap"
          style={{ paddingTop: 'var(--mantine-spacing-xs)' }}
        >
          {!daemonReachable ? (
            <Text size="xs" style={{ color: STATUS_TEXT_COLOR.deaf }}>
              Can&apos;t post — rt daemon unreachable. Your draft is kept.
            </Text>
          ) : dmTarget ? (
            <>
              <Text size="xs" style={{ color: PURPLE }}>
                → direct message to {dmTarget}
              </Text>
              <UnstyledButton
                data-testid="composer-cancel-dm"
                onClick={() => setDmTarget(undefined)}
                style={{
                  fontSize: 'var(--mantine-font-size-xs)',
                  color: MUTED,
                }}
              >
                cancel
              </UnstyledButton>
            </>
          ) : (
            <>
              <Text size="xs" style={{ color: MUTED }}>
                posting as
              </Text>
              <Text size="xs" fw={600}>
                {humanHandle}
              </Text>
            </>
          )}
        </Group>
      </Box>
    );
  }
);

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      data-testid="composer-kbd"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 16,
        padding: '0 5px',
        border: `1px solid ${BORDER}`,
        borderBottomWidth: 2,
        borderRadius: 'var(--mantine-radius-sm)',
        fontSize: 9,
        color: MUTED,
        background: 'var(--ui-bg-3)',
      }}
    >
      {children}
    </Box>
  );
}
