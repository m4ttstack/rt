/**
 * Owner-side invite watch: while an invite record is outstanding, ask the
 * switchboard whether the invitee has replied, and tell the owner once per
 * invite. The tray's member_joined banner then offers the confirm that runs
 * `rt team members sync`; nothing here adds a recipient on its own, because
 * the reply blob is unauthenticated input and the human check is the point.
 *
 * Pure of the daemon: `checkInviteReplies` takes every side effect through
 * `InviteReplyDeps`, and `lib/daemon.ts` wires the real records, relay,
 * notifier and kv-backed notified set into a sweep.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { NotifyEventInput } from "../notifier.ts";
import type { InviteRecords } from "../team/invite-records.ts";

export const MEMBER_JOINED_CATEGORY = "member_joined";
/** kv namespace: invite id -> { notifiedAt }, so each reply is announced once across daemon restarts. */
export const INVITE_REPLIES_NS = "invite-replies";

export interface InviteReplyDeps {
  /** Teams with an invite-records file on this machine. */
  slugs(): string[];
  records(slug: string): InviteRecords;
  readReply(id: string, creatorSecret: string): Promise<{ blob: string } | "none">;
  isNotified(inviteId: string): boolean;
  markNotified(inviteId: string): void;
  notify(event: NotifyEventInput): void;
  /** The user's member_joined notification preference; off means the relay is not even asked. */
  enabled(): boolean;
  now(): number;
  warn(message: string): void;
}

export interface InviteReplyOutcome {
  notified: { slug: string; handle: string; id: string }[];
}

export function memberJoinedEvent(slug: string, handle: string, inviteId: string): NotifyEventInput {
  return {
    id: `${MEMBER_JOINED_CATEGORY}:${slug}:${inviteId}`,
    title: `${handle} replied to your ${slug} invite`,
    message: `Add ${handle} to ${slug}? This runs rt team members sync: their key becomes a recipient and the team secrets are re-encrypted and pushed.`,
    category: MEMBER_JOINED_CATEGORY,
    team: slug,
    handle,
  };
}

export async function checkInviteReplies(deps: InviteReplyDeps): Promise<InviteReplyOutcome> {
  const notified: InviteReplyOutcome["notified"] = [];
  if (!deps.enabled()) return { notified };
  const now = deps.now();

  for (const slug of deps.slugs()) {
    for (const [handle, rec] of Object.entries(deps.records(slug))) {
      if (deps.isNotified(rec.id)) continue;
      if (Date.parse(rec.expiresAt) <= now) continue;

      let reply: { blob: string } | "none";
      try {
        reply = await deps.readReply(rec.id, rec.creatorSecret);
      } catch (err) {
        deps.warn(`invite ${rec.id} (${handle}, ${slug}): could not read the reply: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (reply === "none") continue;

      deps.notify(memberJoinedEvent(slug, handle, rec.id));
      deps.markNotified(rec.id);
      notified.push({ slug, handle, id: rec.id });
    }
  }

  return { notified };
}

/** Every `<slug>.json` under ~/.mattstack/rt/invites, the same file `readInviteRecords` reads. */
export function listInviteSlugs(home: string): string[] {
  const dir = join(home, ".mattstack", "rt", "invites");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length));
}
