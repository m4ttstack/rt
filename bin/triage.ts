// Headless policy engine, second entry point of this repo (working name).
// rt cron is the intended caller (spec §5); a human running it by hand gets
// the same one idempotent evaluation pass. The board server NEVER runs this.
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { GitLabProvider, type PullRequest } from "@mattstack/glance";
import { readProjectMRs } from "@mattstack/rt-client";
import { loadConfig, loadGitLabToken, loadSwitchboardToken } from "../src/config.ts";
import { buildBoard } from "../src/data.ts";
import { doctorFilePath, readDoctorStates, writeDoctorState } from "../src/doctor-state.ts";
import { launchDoctor } from "../src/herdr.ts";
import { makeEnvelope } from "../src/peer/envelope.ts";
import { makeSwitchboardClient } from "../src/peer/client.ts";
import { markNudgeHandled, readNudges } from "../src/peer/nudges.ts";
import { drainOutbox, enqueueOutbox } from "../src/peer/outbox.ts";
import { launchReReview } from "../src/review-launch.ts";
import { readReviewStates } from "../src/review-state.ts";
import { appendAudit } from "../src/triage/audit.ts";
import { loadTriageConfig } from "../src/triage/config.ts";
import { MEMORY_PATH, readMemory, writeMemory } from "../src/triage/memory.ts";
import { runNudgePass } from "../src/triage/nudge.ts";
import { notifyEscalation } from "../src/triage/notify.ts";
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

// Disabled is the common cron-invoked case: decide it BEFORE taking the lock,
// because process.exit() skips finally blocks and would strand the lock file.
const triage = loadTriageConfig();
if (!triage.enabled) process.exit(0);

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

  // Own-MR identity from the GitLab token (ruling: never defaultMember),
  // cached so steady-state runs are pure socket reads.
  let username = memory.identity && Date.now() - memory.identity.fetchedAt < IDENTITY_TTL_MS ? memory.identity.username : null;
  if (!username) {
    const token = loadGitLabToken();
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
    const prs: PullRequest[] = [];
    for (const projectPath of boardConfig.projects) {
      const repoName = boardConfig.rtRepos[projectPath];
      if (!repoName) continue;
      const res = await readProjectMRs(repoName);
      if (!res.ok || !res.data) continue;
      for (const entry of Object.values(res.data.mrs)) prs.push(entry.pr as PullRequest);
    }
    return buildBoard(prs, boardConfig)
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

  const result = await runTriage({
    triage,
    doctorCwd: boardConfig.doctorCwd || boardConfig.reviewCwd,
    doctorsWorkspace: boardConfig.doctorsWorkspace,
    claudeCommand: boardConfig.claudeCommand,
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

  const switchboardToken = loadSwitchboardToken();
  if (boardConfig.switchboard.url && switchboardToken) {
    const client = makeSwitchboardClient(boardConfig.switchboard.url, switchboardToken);
    const nudgeResult = await runNudgePass({
      readNudges,
      markNudgeHandled: (id, r, reason) => markNudgeHandled(id, r, reason),
      readReviewStates,
      launchReReview: (mrUrl, iid) =>
        launchReReview(mrUrl, iid, {
          cwd: boardConfig.reviewCwd,
          workspaceLabel: boardConfig.reviewsWorkspace,
          skill: boardConfig.reviewSkill,
        }),
      publishOutcome: (to, payload) => enqueueOutbox(makeEnvelope(to, "nudge-outcome", payload)),
      memory,
      cfg: triage,
      appendAudit,
      notify: (title, message) => notifyEscalation(title, message, triage.notify),
      now: () => Date.now(),
    });
    await drainOutbox((d) => client.publish(d));
    writeMemory(memory);
    console.log(`nudges: dispatched ${nudgeResult.dispatched}, rejected ${nudgeResult.rejected}, expired ${nudgeResult.expired}, skipped ${nudgeResult.skipped}`);
  }
} finally {
  rmSync(LOCK_PATH, { force: true });
}
