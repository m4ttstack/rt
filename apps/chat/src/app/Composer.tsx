import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Paper,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import type { BuddyStatus } from '@mattstack/rt-client';

import { doing, type DoingLine } from './doing';
import { HUMAN_HANDLE } from './human';
import { STATUS_WORD } from './statusDetail';
import { useAutoGrowTextarea } from './use-auto-grow-textarea';

const MUTED = 'var(--tk-muted-text)';
const MUTED_DIM = 'var(--tk-muted)';
const INPUT_LINE_HEIGHT = 1.4;
const BORDER = 'var(--tk-border)';
const BORDER_SOFT = 'var(--tk-border-soft)';
const PURPLE = 'var(--tk-purple)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';

const STATUS_TEXT_COLOR: Record<'live' | 'idle', string> = {
  live: 'var(--mantine-color-ok-text)',
  idle: 'var(--mantine-color-warn-text)',
};
const DOT_COLOR: Record<'live' | 'idle', string> = {
  live: 'var(--tk-dot-ok)',
  idle: 'var(--tk-dot-warn)',
};
const STATUS_ORDER: readonly ('live' | 'idle')[] = ['live', 'idle'];
const BAD_TEXT = 'var(--mantine-color-bad-text)';

export interface ComposerBuddy {
  handle: string;
  status: BuddyStatus;
  branch?: string;
  cwd?: string;
  paneTitle?: string;
  statusText?: string;
}

export interface ComposerProps {
  /** The open room's slug -- the post route, the placeholder, and the
      popover's "not in #room" copy all key off it. */
  room: string;
  /** Handles already in the open room -- a DM's two participants, or a
      channel's current membership. What separates "insert @handle" from
      "not in #room -- DM instead" in the popover. */
  roomMembers: string[];
  /** The fleet, not the room -- same source `FleetTree` reads, so the
      popover can offer a DM to a buddy who has never joined this room. */
  buddies: ComposerBuddy[];
  /** @default HUMAN_HANDLE (`./human`), the same single source every other
      caller of the human's own handle reads. */
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
  /** A buddy outside the room was picked in the `@` popover: the caller
      opens the DM room and moves there; the draft stays in this instance. */
  onOpenDm?: (handle: string) => void;
  /**
   * Seeds the draft, and the mentions posted with it, so a reply can open
   * with its recipient already tagged. Read ONCE, at mount: a caller that
   * needs a different seed remounts this composer with a `key`, which is
   * also what discards the previous draft on purpose.
   */
  prefill?: { body: string; mentions?: string[] };
  /** Replaces the computed placeholder while the daemon is reachable. The
      daemon-down copy always wins over it: it is a failure state, not a
      caller's framing. */
  placeholder?: string;
  /** Called after a post has landed and the draft has cleared. */
  onPosted?: () => void;
}

/** The imperative surface the roster and the app drive: insert a mention at
    the caret, or take focus after a room change. */
export interface ComposerHandle {
  insertMention(handle: string): void;
  focus(): void;
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

function Dot({ status }: { status: 'live' | 'idle' }) {
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
 * One `.opt` row. Clicking routes on room membership alone: a mention still
 * lands in an idle buddy's unread, it just doesn't wake them yet.
 */
function BuddyOption({
  handle,
  status,
  inRoom,
  room,
  task,
  onSelect,
}: {
  handle: string;
  status: 'live' | 'idle';
  inRoom: boolean;
  room: string;
  task: DoingLine | null;
  onSelect: (handle: string, inRoom: boolean) => void;
}) {
  const subtext = !inRoom
    ? { text: `not in #${room}, DM instead`, color: PURPLE }
    : task
      ? { text: task.text, color: task.kind === 'path' ? MUTED_DIM : MUTED }
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
 * The composer: an `@`-popover input and its one write route. Picking a
 * buddy outside the room hands off to `onOpenDm` instead of posting here --
 * opening a DM is the app's job, not this component's.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      room,
      roomMembers,
      buddies,
      humanHandle = HUMAN_HANDLE,
      isDm = false,
      daemonReachable = true,
      phone = false,
      onOpenDm,
      prefill,
      placeholder: placeholderProp,
      onPosted,
    },
    ref
  ) {
    // Lazy initialisers, never an effect keyed on `prefill`: an object
    // literal prop changes identity every render, so syncing on it would
    // overwrite whatever had been typed since.
    const [value, setValue] = useState(() => prefill?.body ?? '');
    const [mentions, setMentions] = useState<string[]>(
      () => prefill?.mentions ?? []
    );
    const [sending, setSending] = useState(false);
    const [token, setToken] = useState<MentionToken | null>(null);
    const [focused, setFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useAutoGrowTextarea(textareaRef, value);

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
      closePopover();
      onOpenDm?.(handle);
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
        onPosted?.();
      } catch {
        notifications.error("Couldn't send. The draft is kept.");
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

    /** `FleetTree`'s onPick, not the popover: there is no `@`-token to
      replace, so this inserts at the caret (or the end, unfocused) instead. */
    function insertMentionAtCaret(handle: string) {
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? value.length;
      // A repeat pick focuses instead of stacking another `@handle`: the
      // draft already carries the mention.
      const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`@${escaped}(?![A-Za-z0-9._-])`).test(value)) {
        focusAt(caret);
        return;
      }
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
      focus: () => focusAt(value.length),
    }));

    // Phone drops each hint suffix -- the room-width placeholder wraps to a
    // second line at 375px otherwise, which a native placeholder has no
    // ellipsis for once it wraps rather than overflows.
    const placeholder = !daemonReachable
      ? phone
        ? 'rt daemon unreachable'
        : "Can't post: rt daemon unreachable. Your draft is kept."
      : placeholderProp
        ? placeholderProp
        : isDm
          ? phone
            ? `Message ${roomMembers.join(' ↔ ')}`
            : `Message ${roomMembers.join(' ↔ ')} (both will wake)`
          : phone
            ? `Message #${room}`
            : `Message #${room} (@ to mention)`;

    const inputBorderColor = !daemonReachable
      ? BORDER
      : focused
        ? ACCENT_TEXT
        : BORDER_SOFT;
    const inputFontSize = phone ? 16 : 'var(--mantine-font-size-md)';
    const canSend = value.trim().length > 0 && daemonReachable && !sending;

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
              }
            : {
                position: 'relative',
                paddingTop: 'var(--mantine-spacing-sm)',
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
            <Paper
              data-testid="composer-input"
              pos="relative"
              miw={0}
              radius="lg"
              p="md"
              bg={!daemonReachable ? 'var(--tk-panel)' : 'var(--tk-card)'}
              c={!daemonReachable ? MUTED : undefined}
              bd={`1px ${!daemonReachable ? 'dashed' : 'solid'} ${inputBorderColor}`}
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
                data-testid="composer-row"
                style={{
                  display: 'block',
                  width: '100%',
                  minWidth: 0,
                  border: 0,
                  outline: 'none',
                  resize: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  fontFamily: 'inherit',
                  fontSize: inputFontSize,
                  lineHeight: INPUT_LINE_HEIGHT,
                  // Clears the floating send button; the Paper's `p` handles
                  // the rest, so there is no reserved bottom row.
                  paddingRight: 22,
                  maxHeight: phone ? '25vh' : '40vh',
                  overflowY: 'auto',
                }}
              />
              <ActionIcon
                aria-label="Send"
                data-testid="composer-send"
                disabled={!canSend}
                onClick={() => void send()}
                variant="filled"
                color="accent"
                radius="xl"
                size={phone ? 32 : 28}
                pos="absolute"
                right={phone ? 8 : 6}
                // Offset to sit centered on a single line of text (the `md`
                // padding plus half a line, less half the button); staying
                // bottom-anchored holds it there as the box grows upward.
                bottom={phone ? 7 : 9}
              >
                <Icon name="send" size={phone ? 18 : 15} />
              </ActionIcon>
            </Paper>
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
                  status={b.status as 'live' | 'idle'}
                  inRoom={roomMembers.includes(b.handle)}
                  room={room}
                  task={doing(b)}
                  onSelect={selectBuddy}
                />
              ))}
              {showHere && (
                <HereOption count={hereCount} onSelect={insertHere} />
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>

        {!daemonReachable && (
          <Group
            gap="xs"
            wrap="nowrap"
            style={{ paddingTop: 'var(--mantine-spacing-xs)' }}
          >
            <Text size="xs" style={{ color: BAD_TEXT }}>
              Can&apos;t post: rt daemon unreachable. Your draft is kept.
            </Text>
          </Group>
        )}
      </Box>
    );
  }
);
