import type { ChatMessage, RoomSummary } from '@mattstack/rt-client';

import { isOpenAsk } from '../shared/open-ask';

export interface InboxCard {
  room: string;
  kind: 'room' | 'dm';
  participants?: { a: string; b: string };
  messageId: number;
  handle: string;
  postedAt: number;
  excerpt: string;
  reason: 'mention' | 'dm-turn' | 'open-ask';
}

export interface InboxPayload {
  needsYou: InboxCard[];
  openAsks: InboxCard[];
  elsewhere: {
    room: string;
    kind: 'room' | 'dm';
    unread: number;
    mentions: number;
  }[];
}

const EXCERPT_CAP = 200;
const FENCE_RE = /```[\s\S]*?```/g;
const LINK_RE = /\[([^\]]*)\]\([^)]*\)/g;
const INLINE_CODE_RE = /`([^`]*)`/g;

/** Plain text for a 2-line clamp, not a faithful markdown render: fences are
    dropped whole rather than shown as an unreadable blob, and only the
    first paragraph survives, since that is what a clamp shows anyway. */
export function excerptFor(body: string): string {
  const firstParagraph =
    body
      .replace(FENCE_RE, '\n\n')
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .find(p => p.length > 0) ?? '';
  const plain = firstParagraph
    .replace(LINK_RE, '$1')
    .replace(INLINE_CODE_RE, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > EXCERPT_CAP
    ? `${plain.slice(0, EXCERPT_CAP).trimEnd()}...`
    : plain;
}

function roomKind(room: RoomSummary): 'room' | 'dm' {
  return room.kind === 'dm' ? 'dm' : 'room';
}

function toCard(
  room: RoomSummary,
  msg: ChatMessage,
  reason: InboxCard['reason']
): InboxCard {
  return {
    room: room.room,
    kind: roomKind(room),
    ...(room.participants ? { participants: room.participants } : {}),
    messageId: msg.id,
    handle: msg.handle,
    postedAt: msg.postedAt,
    excerpt: excerptFor(msg.body),
    reason,
  };
}

/**
 * `pagesByRoom` must already be narrowed to each room's unread messages
 * (the newest `min(unread, 50)`, per `RoomSummary.unread` -- there is no
 * cursor id anywhere to compare against). That narrowing is the caller's
 * job; this function trusts it and never reaches past what it is handed,
 * which is what makes "everything before the cursor" testable here.
 */
export function buildInbox(
  rooms: RoomSummary[],
  pagesByRoom: Map<string, ChatMessage[]>,
  humanHandle: string
): InboxPayload {
  const needsYou: InboxCard[] = [];
  const openAsks: InboxCard[] = [];
  const elsewhere: InboxPayload['elsewhere'] = [];

  for (const room of rooms) {
    if (room.unread <= 0) continue;
    if (room.kind === 'dm' && !room.participants) continue;

    const messages = pagesByRoom.get(room.room) ?? [];
    const isDm = room.kind === 'dm';
    const dmInvolvesHuman =
      isDm &&
      room.participants !== undefined &&
      (room.participants.a === humanHandle ||
        room.participants.b === humanHandle);

    let claimed = 0;
    let claimedMentions = 0;
    for (const msg of messages) {
      const isMention = msg.mentions.includes(humanHandle);
      const isDmTurn =
        !isMention && dmInvolvesHuman && msg.handle !== humanHandle;

      if (isMention || isDmTurn) {
        needsYou.push(toCard(room, msg, isMention ? 'mention' : 'dm-turn'));
        claimed += 1;
        if (isMention) claimedMentions += 1;
        continue;
      }

      if (!isDm) {
        const laterInRoom = messages.filter(m => m.id > msg.id);
        if (isOpenAsk(msg, laterInRoom)) {
          openAsks.push(toCard(room, msg, 'open-ask'));
          claimed += 1;
        }
      }
    }

    // The unread COUNT, not `messages.length`: a room capped at 50 fetched
    // messages can still owe more to "elsewhere" than it handed over.
    const remaining = room.unread - claimed;
    if (remaining > 0) {
      elsewhere.push({
        room: room.room,
        kind: roomKind(room),
        unread: remaining,
        // Mentions pulled into `needsYou` cards must not also count here, or
        // the same mention shows in both fields.
        mentions: Math.max(0, room.mentions - claimedMentions),
      });
    }
  }

  needsYou.sort((a, b) => b.postedAt - a.postedAt);
  openAsks.sort((a, b) => b.postedAt - a.postedAt);

  return { needsYou, openAsks, elsewhere };
}
