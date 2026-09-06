import type { ChatMessage } from '@mattstack/rt-client';

/** Imported as a VALUE by both the Bun server (`src/server/inbox.ts`) and
    the browser bundle (`src/app/Transcript.tsx`), so this module must stay
    free of any runtime dependency -- `import type` only, nothing from
    `../server/**` or a client. */

/** `here` is never a real handle, so the daemon never puts it in `mentions`
    (unlike `matt`); detecting an ask means reading the body text itself. */
const HERE_RE = /(^|[^\w])@here\b/i;

/**
 * Daemon claims expire after five minutes and are not visible to a viewer,
 * so a reply is the only durable signal that an ask was answered. Shared by
 * the inbox's `open-ask` card and the transcript's `@here · unclaimed` chip,
 * so both read the same definition rather than drifting apart.
 */
export function isOpenAsk(
  msg: ChatMessage,
  laterInRoom: ChatMessage[]
): boolean {
  if (!HERE_RE.test(msg.body)) return false;
  return !laterInRoom.some(later => later.replyTo === msg.id);
}
