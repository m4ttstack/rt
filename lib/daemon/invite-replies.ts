/**
 * Owner-side invite watch: while an invite record is outstanding, ask the
 * switchboard whether the invitee has replied, open the reply under the
 * invite's own key, and tell the owner once per invite. The tray's
 * member_joined banner then offers the confirm that runs
 * `rt team members sync`; nothing here adds a recipient on its own.
 *
 * The reply endpoint is unauthenticated, so a blob that does not open under
 * the invite's key is noise (or an attack), not a reply: it is warned once,
 * marked rejected so the sweep stops re-reading it, and never announced.
 *
 * Pure of the daemon: `checkInviteReplies` takes every side effect through
 * `InviteReplyDeps`, and `lib/daemon.ts` wires the real records, relay,
 * notifier and kv-backed notified set into a sweep. Warnings name handles
 * and teams, never invite ids: an id alone redeems or replies to an
 * outstanding invite.
 */

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { NotifyEventInput } from "../notifier.ts";
import type { InviteRecords } from "../team/invite-records.ts";

export const MEMBER_JOINED_CATEGORY = "member_joined";
/** kv namespace: invite id -> { outcome, at }, so each reply is handled once across daemon restarts. */
export const INVITE_REPLIES_NS = "invite-replies";

export type InviteReplyOutcomeKind = "notified" | "rejected";

export interface InviteReplyDeps {
  /** Teams with an invite-records file on this machine. */
  slugs(): string[];
  records(slug: string): InviteRecords;
  readReply(id: string, creatorSecret: string): Promise<{ blob: string } | "none">;
  /** Opens the reply under the invite's key (AAD = the invite id) and returns the invitee's age public key; throws when it does not open or is not a usable key. */
  openReply(blob: string, keyB64: string, id: string): Promise<string>;
  isNotified(inviteId: string): boolean;
  markNotified(inviteId: string, outcome: InviteReplyOutcomeKind): void;
  /** True once the event is durably queued; false leaves the invite for the next sweep. */
  notify(event: NotifyEventInput): boolean;
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
    message: `Add ${handle} to ${slug}? This runs rt team members sync: every invitee who has replied becomes a recipient, and the team secrets are re-encrypted and pushed.`,
    category: MEMBER_JOINED_CATEGORY,
    team: slug,
    handle,
  };
}

/** Same rule as the records reader: an unparsable expiry is expired, never live forever. */
function isLive(expiresAt: string, now: number): boolean {
  return Date.parse(expiresAt) >= now;
}

export async function checkInviteReplies(deps: InviteReplyDeps): Promise<InviteReplyOutcome> {
  const notified: InviteReplyOutcome["notified"] = [];
  if (!deps.enabled()) return { notified };
  const now = deps.now();

  for (const slug of deps.slugs()) {
    let records: InviteRecords;
    try {
      records = deps.records(slug);
    } catch (err) {
      deps.warn(`team ${slug}: could not read its invite records: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const [handle, rec] of Object.entries(records)) {
      if (!isInviteRecord(rec)) {
        deps.warn(`invite for ${handle} (${slug}): the record is malformed; skipping it`);
        continue;
      }
      if (deps.isNotified(rec.id)) continue;
      if (!isLive(rec.expiresAt, now)) continue;

      let reply: { blob: string } | "none";
      try {
        reply = await deps.readReply(rec.id, rec.creatorSecret);
      } catch (err) {
        deps.warn(`invite for ${handle} (${slug}): could not read the reply: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (reply === "none") continue;

      try {
        await deps.openReply(reply.blob, rec.keyB64, rec.id);
      } catch (err) {
        deps.warn(`invite for ${handle} (${slug}): the posted reply is not usable (${err instanceof Error ? err.message : String(err)}); ignoring it`);
        deps.markNotified(rec.id, "rejected");
        continue;
      }

      if (!deps.notify(memberJoinedEvent(slug, handle, rec.id))) continue;
      deps.markNotified(rec.id, "notified");
      notified.push({ slug, handle, id: rec.id });
    }
  }

  return { notified };
}

/** The records reader casts each parsed value; an older or hand-edited file can hold anything. */
function isInviteRecord(rec: unknown): rec is InviteRecords[string] {
  if (typeof rec !== "object" || rec === null) return false;
  const r = rec as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.creatorSecret === "string" && typeof r.keyB64 === "string" && typeof r.expiresAt === "string";
}

/** Every `<slug>.json` under ~/.mattstack/rt/invites, the same file `readInviteRecords` reads. */
export function listInviteSlugs(home: string): string[] {
  const dir = join(home, ".mattstack", "rt", "invites");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length));
}
