import type { ChatMessage } from '@mattstack/rt-client';

export interface FoldEntry {
  folded: boolean;
  moreLines: number;
}

/** A fence toggles on any line that trims to a run of 3+ backticks or
    tildes; a blank line inside one never ends its block, matching how
    react-markdown itself would still render it as one fenced block. */
const FENCE_RE = /^(`{3,}|~{3,})/;

/** Source lines grouped the way markdown block splitting would: a blank
    line outside a fence starts a new block, one never starts inside one,
    and a fence is its own block start-to-finish even with no blank line
    before it -- CommonMark lets a fence interrupt a paragraph, and
    react-markdown renders it as a separate element either way, so a chat
    message like "heads up:\n```\n<trace>\n```" (a lead line running
    straight into a fence, no blank line -- exactly how agents post) must
    still fold the fence away, not leak it as part of the first block. */
function splitBlocks(body: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const opensOrCloses = FENCE_RE.exec(trimmed)?.[1];
    if (fence === null && opensOrCloses !== undefined) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      fence = opensOrCloses;
      current.push(line);
      continue;
    }
    if (fence !== null) {
      current.push(line);
      if (trimmed.startsWith(fence)) {
        fence = null;
        blocks.push(current);
        current = [];
      }
      continue;
    }
    if (trimmed === '') {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/** The text `MessageMarkdown` renders when `firstBlockOnly` is set: the
    first markdown block only, so a folded row never mounts a table or
    fenced block that sits later in the body. */
export function firstBlockOf(body: string): string {
  const [first] = splitBlocks(body);
  return first === undefined ? body : first.join('\n');
}

/** Source lines left after the first block, for the `foldrow` control's
    count. Blank separator lines between blocks are not counted -- they
    carry no content -- so a two-paragraph, one-line-each message reads
    "1 more line", not "2". */
function moreLinesAfterFirstBlock(body: string): number {
  const blocks = splitBlocks(body);
  if (blocks.length <= 1) return 0;
  let total = 0;
  for (const block of blocks.slice(1)) total += block.length;
  return total;
}

/** The read/unread split `Transcript`'s own divider draws
    (`messages.length - unreadCount`), clamped to a real index instead of
    the divider's own display sentinel. `foldPlan` and the divider must
    read this exact number, never two independently rounded ones, or the
    fold line and the "N new" rule could land on different messages. */
export function readBoundary(
  messagesLength: number,
  unreadCount: number | undefined
): number {
  const unread = unreadCount !== undefined && unreadCount > 0 ? unreadCount : 0;
  return Math.min(messagesLength, Math.max(0, messagesLength - unread));
}

/** Which messages fold to their first block. A message folds when it sits
    before the read boundary and is not the `#m-<id>` anchor; an anchored
    message renders whole even if it is otherwise read, and everything from
    the boundary on renders whole because it is what the room was opened to
    read. */
export function foldPlan(
  msgs: ChatMessage[],
  unreadCount: number | undefined,
  anchorId?: string
): Map<number, FoldEntry> {
  const boundary = readBoundary(msgs.length, unreadCount);
  const plan = new Map<number, FoldEntry>();
  msgs.forEach((msg, index) => {
    const anchored = anchorId !== undefined && anchorId === `m-${msg.id}`;
    const folded = index < boundary && !anchored;
    plan.set(msg.id, {
      folded,
      moreLines: folded ? moreLinesAfterFirstBlock(msg.body) : 0,
    });
  });
  return plan;
}
