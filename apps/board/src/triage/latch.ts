/**
 * The latch pass: read every done review state's MR, and act on the latch.
 *
 * Branch order is the design's safety property, not a style choice. The spent
 * check is unconditional and runs first, so no board-made resolve can ever be
 * read back as a human request, whatever the MR's approval state does
 * afterwards.
 */
import type { MRDetail } from '@mattstack/glance';
import {
  canonicalLatch,
  findLatches,
  requestCarriers,
  type LatchRef,
} from '../latch/discussions.ts';
import {
  postLatch,
  spendAllLatches,
  spendLatch,
  type LatchGateway,
} from '../latch/post.ts';
import type { ReReviewLaunch } from '../review-launch.ts';
import type { ReviewState } from '../review-state.ts';
import type { AuditEntry } from './audit.ts';
import type { ReReviewConfig, TriageConfig } from './config.ts';
import { emptyMrMemory, rollDay, type DispatchMemory } from './memory.ts';
import { decideRequest } from './nudge.ts';

export interface LatchMrFacts {
  mrUrl: string;
  iid: number;
  projectId: number;
  projectPath: string;
  /** Encoded daemon identity for rt queries on this MR's discussions.
      An unrecognized identity answers with an empty-but-ok result rather than
      an error, so the distinction matters: sending a bare repo name here would
      silently disable triage. */
  rtRepo: string;
  isApproved: boolean;
}

export interface LatchPassDeps {
  readReviewStates(): Map<string, ReviewState>;
  fetchLatchMrs(): Promise<LatchMrFacts[]>;
  readDetail(mr: LatchMrFacts): Promise<MRDetail | null>;
  gateway: LatchGateway;
  launchReReview(mrUrl: string, iid: number): Promise<ReReviewLaunch>;
  memory: DispatchMemory;
  /** Cooldown and budget only. The pass's on/off switch is `reReview`, never
      cfg.enabled: that flag is the doctor/nudge sweeps' per-developer opt-in. */
  cfg: TriageConfig;
  reReview: ReReviewConfig;
  appendAudit(entry: AuditEntry): void;
  notify(title: string, message: string): Promise<void>;
  now(): number;
}

export interface LatchPassResult {
  posted: number;
  dispatched: number;
  rejected: number;
  spent: number;
  repaired: number;
  skipped: number;
  failed: number;
}

/** How long a freshly-done review is left to the server before this pass will
    arm a latch for it. The server posts the instant the done signal lands, but
    both writers check for an existing latch through the daemon's discussion
    store, which within its staleness window cannot show a post seconds old:
    posting here inside that window double-posts. A genuinely missed post
    (server down or throwing) still lands on the first tick past the window. */
export const LATCH_POST_GRACE_MS = 5 * 60_000;

const DISPATCH_REPLY =
  "Re-review started. I'll comment again when the pass is done, and this latch is armed for next time.";
const refusalReply = (reason: string) =>
  `Not yet: ${reason}. Resolve this thread again once that clears and I'll pick it up.`;

export async function runLatchPass(
  deps: LatchPassDeps
): Promise<LatchPassResult> {
  const result: LatchPassResult = {
    posted: 0,
    dispatched: 0,
    rejected: 0,
    spent: 0,
    repaired: 0,
    skipped: 0,
    failed: 0,
  };
  if (!deps.reReview.enabled) return result;
  // decideRequest refuses with "disabled" on cfg.enabled, which is the
  // doctor/nudge switch. A team with those sweeps off but re-review on must
  // not see every resolved latch answered "Not yet: disabled".
  const policy: TriageConfig = { ...deps.cfg, enabled: true };

  const reviews = deps.readReviewStates();
  const now = deps.now();
  const dayStamp = new Date(now).toISOString().slice(0, 10);
  const mrs = await deps.fetchLatchMrs();

  for (const mr of mrs) {
    // One MR's GitLab call throwing (an archived project, a 403 upload, a
    // transient 500) must not abort the tick and starve every MR queued
    // after it while the condition lasts.
    try {
      const review = reviews.get(mr.mrUrl);
      // A done state with no outcome records no verdict, so there is nothing to
      // arm and nothing to spend. decideRequest treats it the same way.
      if (!review || review.status !== 'done' || !review.outcome) {
        result.skipped++;
        continue;
      }
      const detail = await deps.readDetail(mr);
      if (!detail) {
        result.skipped++;
        continue;
      }
      const latches = findLatches(detail);
      const canon = canonicalLatch(latches);

      // Step 0: nothing to act on. A spent relic with no live latch is the
      // descoped case: arming a second review cycle is the server's job.
      if (!canon) {
        if (
          review.outcome === 'comment' &&
          now - review.updatedAt >= LATCH_POST_GRACE_MS
        ) {
          await postLatch(
            deps.gateway,
            mr.projectId,
            mr.projectPath,
            mr.mrUrl,
            mr.iid
          );
          deps.appendAudit({
            ts: now,
            mrUrl: mr.mrUrl,
            iid: mr.iid,
            event: 'latch',
            action: 'posted',
          });
          result.posted++;
        } else {
          result.skipped++;
        }
        continue;
      }

      // Step 1: spent wins over everything, unconditionally.
      if (canon.kind === 'spent') {
        if (!canon.resolved) {
          await spendLatch(
            deps.gateway,
            mr.projectId,
            mr.projectPath,
            mr.iid,
            canon
          );
          deps.appendAudit({
            ts: now,
            mrUrl: mr.mrUrl,
            iid: mr.iid,
            event: 'latch',
            action: 'repaired',
          });
          result.repaired++;
        } else {
          result.skipped++;
        }
        continue;
      }

      const carriers = requestCarriers(latches);

      // Step 2: armed and nobody has asked. Every duplicate gets spent here too:
      // the canon alone would leave an older armed-unresolved duplicate stuck
      // forever, since the next tick sees the now-spent canon and stops at step 1
      // before ever looking at it.
      if (carriers.length === 0) {
        if (review.outcome === 'approve') {
          await spendAll(deps, mr, latches);
          deps.appendAudit({
            ts: now,
            mrUrl: mr.mrUrl,
            iid: mr.iid,
            event: 'latch',
            action: 'spent',
          });
          result.spent++;
        } else {
          result.skipped++;
        }
        continue;
      }

      // Step 3: a human resolved a latch. An approved MR spends rather than
      // dispatching, whichever direction the approval came from. Every latch on
      // the MR, not just canon and the request carriers: an armed-unresolved
      // extra left out here would strand live on the next tick, which stops at
      // step 1 on the now-spent canon and never looks at it again.
      if (mr.isApproved || review.outcome === 'approve') {
        await spendAll(deps, mr, latches);
        deps.appendAudit({
          ts: now,
          mrUrl: mr.mrUrl,
          iid: mr.iid,
          event: 'latch',
          action: 'spent',
        });
        result.spent++;
        continue;
      }

      const m = rollDay(
        deps.memory.mrs[mr.mrUrl] ?? emptyMrMemory(dayStamp),
        dayStamp
      );
      deps.memory.mrs[mr.mrUrl] = m;
      const decision = decideRequest(
        {
          mrUrl: mr.mrUrl,
          iid: mr.iid,
          source: 'latch',
          receivedAt: null,
          handled: false,
        },
        review,
        m,
        policy,
        now
      );
      deps.appendAudit({
        ts: now,
        mrUrl: mr.mrUrl,
        iid: mr.iid,
        event: 'latch',
        decision: decision.action,
        reason: decision.reason,
        attempt: m.attemptsToday + 1,
      });

      if (decision.action !== 'dispatch') {
        await deps.gateway.createNote(
          mr.projectId,
          mr.iid,
          refusalReply(decision.reason),
          canon.discussionId
        );
        await consume(deps, mr, canon, carriers);
        await deps.notify(`re-review held off on !${mr.iid}`, decision.reason);
        result.rejected++;
        continue;
      }

      const launch = await deps.launchReReview(mr.mrUrl, mr.iid);
      if (launch.kind === 'error') {
        await deps.gateway.createNote(
          mr.projectId,
          mr.iid,
          refusalReply('the pane failed to start'),
          canon.discussionId
        );
        await consume(deps, mr, canon, carriers);
        deps.appendAudit({
          ts: now,
          mrUrl: mr.mrUrl,
          iid: mr.iid,
          event: 'latch',
          action: 'launch-failed',
          outcome: launch.message,
        });
        result.rejected++;
        continue;
      }

      // The launch already happened, so the attempt is charged before the
      // follow-up GitLab writes run: a write failing here must still count
      // against cooldown and budget, or a failing write turns into a launch
      // every tick.
      m.lastDispatchAt = now;
      m.attemptsToday++;
      await deps.gateway.createNote(
        mr.projectId,
        mr.iid,
        DISPATCH_REPLY,
        canon.discussionId
      );
      await consume(deps, mr, canon, carriers);
      await deps.notify(
        `re-review launched on !${mr.iid}`,
        'requested from the MR'
      );
      result.dispatched++;
    } catch (err) {
      console.error(
        `latch pass: !${mr.iid} (${mr.mrUrl}) failed: ${err instanceof Error ? err.message : err}`
      );
      result.failed++;
    }
  }
  return result;
}

/** Rearm the canonical latch and spend every OTHER copy carrying the request.
    Consuming the extras is what stops the request bit re-firing on the next
    re-entry into scope. */
async function consume(
  deps: LatchPassDeps,
  mr: LatchMrFacts,
  canon: LatchRef,
  carriers: LatchRef[]
): Promise<void> {
  if (canon.resolved) {
    await deps.gateway.unresolveDiscussion(
      mr.projectPath,
      mr.iid,
      canon.discussionId
    );
  }
  for (const c of carriers) {
    if (c.discussionId === canon.discussionId) continue;
    // "duplicate", not the approved default: the canon is being rearmed for
    // another cycle here, not approved, so this extra copy is going defunct
    // rather than recording a verdict that did not happen.
    await spendLatch(
      deps.gateway,
      mr.projectId,
      mr.projectPath,
      mr.iid,
      c,
      'duplicate'
    );
  }
}

/** Terminal disposal of every latch copy on an approved MR. */
async function spendAll(
  deps: LatchPassDeps,
  mr: LatchMrFacts,
  latches: LatchRef[]
): Promise<void> {
  await spendAllLatches(
    deps.gateway,
    mr.projectId,
    mr.projectPath,
    mr.iid,
    latches
  );
}
