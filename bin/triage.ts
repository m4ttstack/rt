// Headless policy engine, second entry point of this repo (working name).
// rt cron is the intended caller (spec §5); a human running it by hand gets
// the same one idempotent evaluation pass. The board server NEVER runs this.
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { GitLabProvider, parseRepoId, type MRDetail } from "@mattstack/glance";
import { readDiscussions, readProjectMRs } from "@mattstack/rt-client";
import { loadConfig, loadGitLabToken, loadSwitchboardToken, repoIdentityField, resolveLaunchRepo, loadAgentSettings } from "../src/config.ts";
import { buildBoard, projectPathFromWebUrl } from "../src/data.ts";
import { doctorFilePath, readDoctorStates, writeDoctorState } from "../src/doctor-state.ts";
import { launchDoctor } from "../src/herdr.ts";
import { latchGateway } from "../src/latch/gateway.ts";
import { resolveLaunchSkill } from "../src/manifest-bindings.ts";
import { makeEnvelope } from "../src/peer/envelope.ts";
import { makeSwitchboardClient } from "../src/peer/client.ts";
import { markNudgeHandled, readNudges } from "../src/peer/nudges.ts";
import { drainOutbox, enqueueOutbox } from "../src/peer/outbox.ts";
import { launchReReview } from "../src/review-launch.ts";
import { readReviewStates } from "../src/review-state.ts";
import { appendAudit } from "../src/triage/audit.ts";
import { loadReReviewConfig, loadTriageConfig } from "../src/triage/config.ts";
import { runLatchPass, type LatchMrFacts } from "../src/triage/latch.ts";
import { MEMORY_PATH, readMemory, writeMemory } from "../src/triage/memory.ts";
import { runNudgePass } from "../src/triage/nudge.ts";
import { notifyEscalation } from "../src/triage/notify.ts";
import { collectProjectPRs } from "../src/triage/projects.ts";
import { numericPipelineId, runTriage } from "../src/triage/run.ts";
import {
  claimLease,
  DEFAULT_ATTENDANT_TTL_SECONDS,
  defaultAttendantsDir,
  heartbeatLease,
  readLease,
  readLeaseByBranch,
  releaseLease,
} from "../src/triage/attendant.ts";
import type { OwnMrFacts } from "../src/triage/edge.ts";

const LOCK_PATH = MEMORY_PATH + ".lock";
const LOCK_STALE_MS = 2 * 60_000;
const IDENTITY_TTL_MS = 24 * 60 * 60_000;

// Fully disabled is the common cron-invoked case: decide it BEFORE taking the
// lock, because process.exit() skips finally blocks and would strand the lock
// file. Two switches: board.triage gates the doctor/nudge sweeps, board.reReview
// gates the latch pass, and either one alone is reason to run.
const triage = loadTriageConfig();
const reReview = loadReReviewConfig();
if (!triage.enabled && !reReview.enabled) process.exit(0);

// One run at a time: cron debounces, but a slow run + a fresh trigger must
// not interleave dispatches. A stale lock (crashed run) is reclaimed.
// mkdir first: on a fresh install state/ does not exist yet and the lock
// write would crash before the first run ever created it via writeMemory.
mkdirSync(join(LOCK_PATH, ".."), { recursive: true });
if (existsSync(LOCK_PATH) && Date.now() - statSync(LOCK_PATH).mtimeMs < LOCK_STALE_MS) {
  process.exit(0);
}
writeFileSync(LOCK_PATH, String(process.pid));

try {
  const boardConfig = loadConfig();
  const memory = readMemory();

  // The rt agent daemon's `repo` identity for a launch, resolved the same
  // way BoardMR.rtRepo is (config.rtRepos keyed by the MR's GitLab project
  // path), since this pipeline works from mrUrl alone and never builds a
  // BoardMR of its own.
  const repoForMrUrl = (mrUrl: string): string => {
    const projectPath = projectPathFromWebUrl(mrUrl, boardConfig.gitlabHost) ?? "";
    return resolveLaunchRepo(boardConfig.rtRepos[projectPath] ?? null, boardConfig.gitlabHost, projectPath, mrUrl);
  };

  // Own-MR identity from the GitLab token (ruling: never defaultMember),
  // cached so steady-state runs are pure socket reads.
  let username = memory.identity && Date.now() - memory.identity.fetchedAt < IDENTITY_TTL_MS ? memory.identity.username : null;
  if (!username) {
    const token = await loadGitLabToken();
    // Throw rather than process.exit(1): an exit here would skip the finally
    // block and strand the lock until the stale window reclaims it.
    if (!token) throw new Error("triage: no gitlab token available for identity");
    const user = await new GitLabProvider(boardConfig.gitlabHost, token).validateToken();
    username = user.username;
    memory.identity = { username, fetchedAt: Date.now() };
  }

  // SCOPE (review fix 1): triage's MR scope is deliberately the BOARD's
  // visibility scope -- buildBoard applies the member, own-draft, stale-window,
  // ticket-prefix, and project filters -- intersected with the token identity.
  // Tradeoff: an own MR the board filters out (stale, wrong ticket prefix, or
  // a draft when config.defaultMember differs from the token identity) is out
  // of auto-triage reach. In exchange, every doctor state and held draft the
  // engine writes lives inside the window the board renders, so the board's
  // prune sweeps (server.ts /data.json) can never silently delete live auto
  // state, the in-flight dedup always sees what the board sees (no duplicate
  // panes), and the concurrency cap never undercounts.
  const fetchOwnMrs = async (): Promise<OwnMrFacts[]> => {
    const { prs, tags } = await collectProjectPRs(boardConfig, readProjectMRs);
    return buildBoard(prs, boardConfig, undefined, tags)
      .filter((m) => m.author.username === username && m.webUrl)
      .map((m) => ({
        mrUrl: m.webUrl!,
        iid: m.iid,
        pipelineId: m.pipeline ? numericPipelineId(m.pipeline.id) : null,
        pipelineState: m.pipelineState,
        needsRebase: m.blockers.needsRebase,
        author: m.author.username,
        // BOARD-12: the stack chain is reconstructed from these three.
        sourceBranch: m.sourceBranch,
        targetBranch: m.targetBranch,
        isStacked: !!m.isStacked,
      }));
  };

  // The latch pass's mirror image of fetchOwnMrs: every MR this board holds a
  // done review state for, whatever its outcome, rather than the MRs this
  // identity authored. Approve-outcome states stay in scope so a half-finished
  // spend can be repaired; without them nothing ever would be.
  const fetchLatchMrs = async (): Promise<LatchMrFacts[]> => {
    const states = readReviewStates();
    const { prs, tags } = await collectProjectPRs(boardConfig, readProjectMRs);
    return buildBoard(prs, boardConfig, undefined, tags)
      .filter((m) => m.webUrl && states.get(m.webUrl)?.status === "done")
      .map((m) => ({
        mrUrl: m.webUrl!,
        iid: m.iid,
        projectId: parseRepoId(m.repositoryId),
        projectPath: projectPathFromWebUrl(m.webUrl!, boardConfig.gitlabHost) ?? "",
        // Encoded, not the bare rtRepos value: readDetail below passes this
        // straight to readDiscussions, which is daemon-identity-keyed.
        rtRepo: repoIdentityField(m.rtRepo) ?? "",
        isApproved: !!m.reviews.isApproved,
      }));
  };

  const result = await runTriage({
    triage,
    doctorCwd: boardConfig.doctorCwd || boardConfig.reviewCwd,
    doctorsWorkspace: boardConfig.doctorsWorkspace,
    ...loadAgentSettings(),
    repoForMr: repoForMrUrl,
    // Same resolved identity fetchOwnMrs just filtered by (MAT-351 re-check).
    identity: username,
    fetchOwnMrs,
    readDoctorStates,
    launchDoctor,
    writeDoctorState,
    doctorFilePath: (mrUrl) => doctorFilePath(mrUrl),
    appendAudit,
    notify: (title, message) => notifyEscalation(title, message, triage.notify),
    memory,
    writeMemory,
    now: () => Date.now(),
    // BOARD-10: one CI attendant per MR (plain files under ~/.mattstack/ci-attendants).
    attendants: {
      read: (mrUrl, iid) => readLease(defaultAttendantsDir(), mrUrl, iid, Date.now()),
      // BOARD-12: lets the stack preflight see an attendant on a parent MR
      // that falls outside the board's scope window.
      readByBranch: (branch) => readLeaseByBranch(defaultAttendantsDir(), branch, Date.now()),
      claim: (mrUrl, _iid, branch) =>
        claimLease(
          defaultAttendantsDir(),
          {
            mr: mrUrl,
            // BOARD-12: watch-ci has always recorded its branch; the doctor
            // now does too, so readByBranch sees both holders.
            branch,
            holder: "doctor",
            sessionLabel: "mr-board-triage",
            pid: process.pid,
            startedAt: Date.now(),
            heartbeatAt: Date.now(),
            ttlSeconds: DEFAULT_ATTENDANT_TTL_SECONDS,
          },
          Date.now(),
        ).ok,
      heartbeat: (mrUrl, iid) => heartbeatLease(defaultAttendantsDir(), mrUrl, iid, "doctor", Date.now()),
      release: (mrUrl, iid) => releaseLease(defaultAttendantsDir(), mrUrl, iid, "doctor"),
    },
  });
  console.log(`triage: dispatched ${result.dispatched}, escalated ${result.escalated}, skipped ${result.skipped}`);

  const switchboardToken = await loadSwitchboardToken();
  if (boardConfig.switchboard.url && switchboardToken) {
    const client = makeSwitchboardClient(boardConfig.switchboard.url, switchboardToken);
    const nudgeResult = await runNudgePass({
      readNudges,
      markNudgeHandled: (id, r, reason) => markNudgeHandled(id, r, reason),
      readReviewStates,
      launchReReview: (mrUrl, iid) =>
        launchReReview(mrUrl, iid, {
          cwd: boardConfig.reviewCwd,
          repo: repoForMrUrl(mrUrl),
          workspaceLabel: boardConfig.reviewsWorkspace,
          // BOARD-14: manifest binding when present, else "" (the generic wrapper) --
          // same resolution the board's own HTTP re-review launches use.
          skill: resolveLaunchSkill("review", mrUrl, boardConfig),
          ...loadAgentSettings(),
          claudeCommand: boardConfig.claudeCommand,
        }),
      publishOutcome: (to, payload) => enqueueOutbox(makeEnvelope(to, "nudge-outcome", payload)),
      memory,
      cfg: triage,
      appendAudit,
      notify: (title, message) => notifyEscalation(title, message, triage.notify),
      now: () => Date.now(),
    });
    await drainOutbox((d) => client.publish(d));
    console.log(`nudges: dispatched ${nudgeResult.dispatched}, rejected ${nudgeResult.rejected}, expired ${nudgeResult.expired}, skipped ${nudgeResult.skipped}`);
  }

  // The latch pass writes to GitLab, so without a token there is nothing it
  // can do. Both passes bank cooldown and budget counters into the same
  // memory, and this one runs whether or not a switchboard is configured, so
  // the persist below sits outside that block.
  const latchToken = await loadGitLabToken();
  if (latchToken && reReview.enabled) {
    try {
      const latchResult = await runLatchPass({
        readReviewStates,
        fetchLatchMrs,
        readDetail: async (mr) => {
          const res = await readDiscussions(mr.rtRepo, mr.iid);
          if (!res.ok || !res.data) return null;
          return { discussions: res.data.discussions } as MRDetail;
        },
        gateway: latchGateway(boardConfig.gitlabHost, latchToken),
        launchReReview: (mrUrl, iid) =>
          launchReReview(mrUrl, iid, {
            cwd: boardConfig.reviewCwd,
            repo: repoForMrUrl(mrUrl),
            workspaceLabel: boardConfig.reviewsWorkspace,
            skill: resolveLaunchSkill("review", mrUrl, boardConfig),
            ...loadAgentSettings(),
            claudeCommand: boardConfig.claudeCommand,
          }),
        memory,
        cfg: triage,
        reReview,
        appendAudit,
        notify: (title, message) => notifyEscalation(title, message, triage.notify),
        now: () => Date.now(),
      });
      console.log(`latch pass: ${JSON.stringify(latchResult)}`);
    } catch (err) {
      // The pass makes many unguarded GitLab calls. A throw here must not cost
      // BOTH passes their cooldown and budget counters, which the persist
      // below banks.
      console.error(`latch pass failed: ${err}`);
    }
  }
  writeMemory(memory);
} finally {
  rmSync(LOCK_PATH, { force: true });
}
