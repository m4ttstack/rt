import { readFileSync, rmSync, watch } from 'fs';
import { basename, dirname, join } from 'path';

import {
  deckAppUrl,
  ensureEventBridgeRule,
  type EventBridgeRule,
} from '@mattstack/app-server/event-bridge';
import { panesForOrigin, resolveOriginFocus } from '@mattstack/gate-kit/server';
import type { MRDetail, PullRequest } from '@mattstack/glance';
import {
  GitLabProvider,
  NoteMutator,
  parseRepoId,
  ReadBackFailedError,
} from '@mattstack/glance';
import {
  eventsHead,
  eventsList,
  gateAnswer as gateAnswerFacility,
  gateClose,
  gateList,
  gatePark,
  getSetting,
  paneList,
  readDiscussions,
  readProjectMRs,
  setSetting,
  subscribe,
} from '@mattstack/rt-client';
import { settingsHandler } from '@mattstack/settings-kit/server';
import pkg from '../package.json';
import { resumeAgentPane } from './agent-launch.ts';
import { signalEmoji, type AgentSignal } from './agent-signal.ts';
import {
  AGENT_STATUS_PATTERN,
  AgentStatusFeed,
  isAgentStatusTopic,
  readCursorFile,
  writeCursorFile,
} from './agent-status/feed.ts';
import { APP_ROOT, IS_COMPILED } from './app-root.ts';
import { SnapshotCache } from './cache.ts';
import { getClientAssets } from './client-assets.ts';
import {
  closeOnDone,
  type TabIdClearer,
  type TabIdResolver,
} from './close-on-done.ts';
import {
  applyRosterEdit,
  CONFIG_PATH,
  daemonRepoField,
  displayName,
  loadAgentSettings,
  loadConfig,
  loadGitLabToken,
  loadSlackToken,
  loadSwitchboardAdminToken,
  loadSwitchboardToken,
  parseConfig,
  repoIdentityField,
  resolveLaunchRepo,
  saveMemberHidden,
  saveRosterMembers,
  saveSwitchboardUrl,
  saveTabs,
} from './config.ts';
import {
  aggregateSyncScope,
  boardDemand,
  buildBoard,
  buildRoster,
  channelForMR,
  configuredSlackChannels,
  projectPathFromWebUrl,
  reviewSkillForTab,
  visibleMrsFor,
  type BoardMR,
  type SyncScopeRead,
} from './data.ts';
import {
  summarizeDiscussions,
  threadStatusCounts,
  unresolvedReviewerCount,
} from './discussions.ts';
import {
  attachDoctors,
  doctorFilePath,
  doctorResumeDispatchFields,
  parseDoctorRequestBody,
  pruneDoctorStates,
  readDoctorStates,
  writeDoctorState,
  type DoctorState,
  type DoctorStatus,
} from './doctor-state.ts';
import {
  attachDrafts,
  draftFilePath,
  heldDraftsByMr,
  pruneDrafts,
  readDrafts,
  writeDraft,
} from './draft-state.ts';
import { upsertEnvKeys } from './env-file.ts';
import faviconSvg from './favicon.svg' with { type: 'text' };
import { focusPane } from './focus-pane.ts';
import { answerGate } from './gates/answer.ts';
import { attachGates, GateCache } from './gates/cache.ts';
import {
  executeSweepAction,
  type ExecuteSweepActionIo,
} from './gates/execute-sweep-action.ts';
import {
  boardBridgeRule,
  ingestRelayFrame,
  reconcileGatesOnBoot,
  type GateEventFrame,
} from './gates/ingest.ts';
import { migrateLegacySessions } from './gates/legacy-session-migration.ts';
import {
  bootResumePass,
  buildResumers,
  handleAnsweredEvent,
  type GateResumeEventIo,
  type KindResumeIo,
} from './gates/resume.ts';
import { GATE_DIR, type GateAnswers } from './gates/store.ts';
import { planSweep, pruneOffBoardGates } from './gates/sweep.ts';
import {
  closeTab,
  dispatchPrompt,
  launchDoctor,
  launchLegacyResume,
  launchRespond,
  launchReview,
  mrTabLabel,
  parseLaunchNote,
  reopenPrompt,
  statusBinPath,
} from './herdr.ts';
import { findLatches, hasArmedLatch } from './latch/discussions.ts';
import { latchGateway } from './latch/gateway.ts';
import { postLatch, spendAllLatches } from './latch/post.ts';
import { isLocalRequest, requireJsonBody } from './local.ts';
import { resolveBoardSkill, type BoardSkillKind } from './manifest-bindings.ts';
import { memoizeAsync } from './memoize-async.ts';
import { parseMrActionBody, runMrAction } from './mr-action.ts';
import {
  makeSwitchboardClient,
  type SwitchboardClient,
} from './peer/client.ts';
import {
  canonicalUsername,
  makeEnvelope,
  type ReReviewRequestPayload,
  type ReviewStatePayload,
} from './peer/envelope.ts';
import { type MaterializeDeps } from './peer/inbox.ts';
import {
  pruneNudges,
  pruneSentNudges,
  readNudges,
  readSentNudges,
  resolveSentNudge,
  retireSentNudge,
  sentNudgeDisplay,
  writeNudge,
  writeSentNudge,
  type SentNudgeDisplay,
} from './peer/nudges.ts';
import {
  createInvite,
  joinSwitchboard,
  listPeerBoards,
} from './peer/onboard.ts';
import { classifySend, drainOutbox, enqueueOutbox } from './peer/outbox.ts';
import {
  attachPeerReviews,
  prunePeerReviews,
  readPeerReviews,
  writePeerReview,
  type PeerReviewState,
} from './peer/peer-reviews.ts';
import { makePeering } from './peer/runtime.ts';
import {
  attachResponds,
  parseRespondRequestBody,
  pruneRespondStates,
  readRespondReport,
  readRespondStates,
  respondFilePath,
  respondReportPath,
  writeRespondState,
  type RespondState,
  type RespondStatus,
} from './respond-state.ts';
import { launchReReview } from './review-launch.ts';
import {
  attachReviews,
  parseReviewRequestBody,
  pruneReviewStates,
  readReviewReport,
  readReviewStates,
  reviewFilePath,
  reviewReportPath,
  writeReviewState,
  type ReviewState,
  type ReviewStatus,
} from './review-state.ts';
import {
  attachSlack,
  postToSlack,
  reactToMR,
  readSlackRefs,
  resolveSlackRef,
  slackSweepTargets,
  sweepSlackRefs,
  unreactFromMR,
} from './slack.ts';
import styleCss from './style.css' with { type: 'text' };
import {
  MAX_HEADER_LEN,
  renderPost,
  sanitizeHeader,
  type MrFacts,
} from './template.ts';
import { loadReReviewConfig, loadTriageConfig } from './triage/config.ts';
import {
  readMemory,
  releaseMemoryLock,
  tryAcquireMemoryLock,
  writeRefreshedIdentity,
} from './triage/memory.ts';
import { manualDoctorFields, resolveDispatchIdentity } from './triage/run.ts';

/** Capture-harness mode: boot from a committed fixture dir instead of live
    config, serve canned endpoint responses, hold no tokens, start no relay.
    The seed of the permanent screenshot harness (see tests/capture.ts). */
const FIXTURE_DIR = process.env.BOARD_FIXTURE || null;
const fixtureFile = (name: string) => join(FIXTURE_DIR!, name);

// Bare semver, nothing else: the mattstack bundle gate compares this output
// against the rt-tray deps.lock row verbatim. Before config load, so a clean
// machine with no config can still ask. src/compiled.ts answers it even
// earlier for the standalone binary; this one covers `bun run src/server.ts`.
if (Bun.argv.includes('--version')) {
  console.log(pkg.version);
  process.exit(0);
}

// Baked at build/boot via text imports (embedded in the compiled binary); the
// /style.css route re-reads from disk in dev so CSS edits land on refresh.
const cssPath = join(import.meta.dir, 'style.css');
const favicon = faviconSvg;
/** The board's own .env, written when /peer/join redeems an invite. */
const ENV_PATH = join(APP_ROOT, '.env');

// `let`: /peer/join reassigns the whole config after persisting switchboard.url.
let config = FIXTURE_DIR
  ? parseConfig(readFileSync(fixtureFile('config.json'), 'utf8'))
  : loadConfig();

// Board secrets: env-first, then a daemon round trip -- resolved at most
// once per process (memoizeAsync), lazily on first use, not at import, so
// the board still boots with the daemon down. A daemon-sourced failure
// (down, gate-refused, not-configured -- indistinguishable here) is cached
// only briefly, not forever: a daemon restart at board boot is routine
// (every `rt daemon restart`/upgrade), and pinning null across it would
// leave the dependent feature dead until the board itself restarts.
const isTokenFailure = (v: string | null): boolean => v === null;

// Optional: display-name lookups only. The board's data plane is rt.
const getGitlabToken = memoizeAsync<string | null>(
  () => (FIXTURE_DIR ? Promise.resolve(null) : loadGitLabToken()),
  isTokenFailure
);
// Optional: enables the Slack review-thread menu actions when a token is set.
const getSlackToken = memoizeAsync<string | null>(
  () => (FIXTURE_DIR ? Promise.resolve(null) : loadSlackToken()),
  isTokenFailure
);
// Optional peer relay token -- see the peering-start block below.
const getSwitchboardToken = memoizeAsync<string | null>(
  () => (FIXTURE_DIR ? Promise.resolve(null) : loadSwitchboardToken()),
  isTokenFailure
);
// Operator-only secret: its presence is what turns on this board's invite
// affordances. Absent, /peer/invite and /peer/boards answer 400 and the UI
// never offers them.
const getSwitchboardAdminToken = memoizeAsync<string | null>(
  () => (FIXTURE_DIR ? Promise.resolve(null) : loadSwitchboardAdminToken()),
  isTokenFailure
);

/** Writes go straight to GitLab through glance; reads come from the rt daemon
    (see readProjectMRs). Built on demand so a tokenless install still boots --
    every caller has already refused the request when the token is missing. */
let gitlabProvider: GitLabProvider | undefined;
async function gitlab(): Promise<GitLabProvider> {
  const token = await getGitlabToken();
  if (!token) throw new Error('gitlab token not configured');
  gitlabProvider ??= new GitLabProvider(config.gitlabHost, token);
  return gitlabProvider;
}

// Daemon-backed gate rows for the board-row read (attachGates below). Fed by
// the relay handler below (ingestRelayFrame) and the boot gateList reconcile
// (reconcileGatesOnBoot).
const gateCache = new GateCache();

// Optional peer relay. Both a configured url and a token are required; without
// either, peering stays unstarted and every peer feature (publish, poll,
// /nudge) is off, leaving the board exactly as it was. The runtime is startable
// later at runtime too, so joining a switchboard needs no restart.
const peerDeps: Omit<MaterializeDeps, 'reportAuth'> = {
  writePeerReview,
  writeNudge,
  resolveSentNudge,
  retireSentNudge,
  log: line => console.error(line),
};
const peering = makePeering({
  makeClient: makeSwitchboardClient,
  deps: peerDeps,
});
// Fire-and-forget: the daemon round trip must not hold up Bun.serve below.
void (async () => {
  const token = await getSwitchboardToken();
  if (config.switchboard.url && token)
    peering.start(config.switchboard.url, token);
})();

/** Send what's queued without making the caller wait on the relay. Anything
    still queued goes out on the next tick, so a failure here only costs
    latency -- it's logged, never thrown, since nothing awaits this. */
function kickOutbox(client: SwitchboardClient): void {
  void drainOutbox(d => client.publish(d)).catch(err => {
    console.error(
      `peer: outbox drain failed: ${err instanceof Error ? err.message : err}`
    );
  });
}

/** Per-MR peer state for the board payload: how peers with a review of this MR
    are getting on, the nudge this board sent about its own MR, and the
    unhandled nudges peers sent here. */
interface PeerAttachments {
  peerReviews?: PeerReviewState[];
  sentNudge?: { display: SentNudgeDisplay; reviewer: string; reason?: string };
  nudges?: Array<{ from: string; receivedAt: number }>;
}

/** Fold every peer field onto the MRs, non-mutating. Read from disk per call
    like the review/respond/doctor attachments -- these files are small and a
    request already pays for far more. */
function attachPeerState<T extends { webUrl?: string | null }>(
  mrs: T[],
  now: number = Date.now()
): Array<T & PeerAttachments> {
  const sent = readSentNudges();
  const inbound = new Map<
    string,
    Array<{ from: string; receivedAt: number }>
  >();
  for (const n of readNudges()) {
    // Handled nudges stay on disk for the outcome trail; only the ones still
    // awaiting a decision belong on the board.
    if (n.handled) continue;
    const entry = { from: n.from, receivedAt: n.receivedAt };
    const list = inbound.get(n.mrUrl);
    if (list) list.push(entry);
    else inbound.set(n.mrUrl, [entry]);
  }
  return attachPeerReviews(mrs, readPeerReviews()).map(mr => {
    if (!mr.webUrl) return mr;
    const s = sent.get(mr.webUrl);
    const nudges = inbound.get(mr.webUrl);
    if (!s && !nudges) return mr;
    return {
      ...mr,
      ...(s
        ? {
            sentNudge: {
              display: sentNudgeDisplay(s, now),
              reviewer: s.reviewer,
              reason: s.resolution?.reason,
            },
          }
        : {}),
      ...(nudges ? { nudges } : {}),
    };
  });
}

/**
 * Paced discussion-enrichment concurrency (still used by enrichReviewerComments
 * below); fetchTeamMRs itself is one socket read per project now.
 */
const FETCH_CONCURRENCY = 4;

/** fetchTeamMRs' result: the opened MRs plus the aggregated sync facts from
    every project read, for the caller to fold into the snapshot. `tags` is
    every tagged MR's codeowner sections, keyed by pr.id, for buildBoard to
    intersect against the configured tabs. */
interface TeamMRsResult {
  prs: PullRequest[];
  dataSyncedAt: number | null;
  scopeUncovered: string[];
  scopeWindowDays: number | null;
  scopeUncoveredSections: string[];
  scopeKnownSections: string[] | null;
  tags: Map<string, string[]>;
}

/**
 * Every mapped project's opened MRs from the rt daemon's project store —
 * one socket read per project, no forge traffic. A missing mapping or a
 * daemon-side refusal (down, grant missing) throws with the instructive
 * message, which SnapshotCache surfaces as /data.json's fetchError.
 * `force` is the manual-refresh path (the refresh button, spec §6). It asks
 * the daemon to sync before answering, unconditionally: a store can report
 * source "events" while still hours stale, so trusting the source to decide
 * whether to force was wrong. Forced syncs are cheap deltas, not full syncs.
 *
 * This is the only read that declares demand: it means "everything this
 * client needs" (the whole configured roster), so the daemon can size its
 * sync to cover it. fetchMemberMRs deliberately doesn't -- a one-member
 * demand would tell the daemon the roster is just that member.
 */
async function fetchTeamMRs(force = false): Promise<TeamMRsResult> {
  const byId = new Map<string, PullRequest>();
  const tags = new Map<string, string[]>();
  const errors: string[] = [];
  const reads: SyncScopeRead[] = [];
  const demand = boardDemand(config, port);
  for (const projectPath of config.projects) {
    const repoId = daemonRepoField(config, projectPath);
    if (!repoId) {
      errors.push(`${projectPath}: no rtRepos mapping in config.json`);
      continue;
    }
    const res = await readProjectMRs(repoId, force ? 0 : undefined, {}, demand);
    if (!res.ok || !res.data) {
      errors.push(`${projectPath}: ${res.error ?? 'empty daemon response'}`);
      continue;
    }
    reads.push({ syncedAt: res.data.syncedAt, scope: res.data.scope });
    for (const entry of Object.values(res.data.mrs)) {
      if (entry.pr.state !== 'opened') continue;
      byId.set(entry.pr.id, entry.pr);
      if (entry.codeownerSections?.length)
        tags.set(entry.pr.id, entry.codeownerSections);
    }
  }
  if (errors.length) throw new Error(errors.join(' · '));
  return { prs: [...byId.values()], ...aggregateSyncScope(reads), tags };
}

/** Author string for a herdr tab label: the display name, else the username. */
function mrAuthorLabel(mr: BoardMR): string {
  return mr.author.name ?? mr.author.username;
}

/** Resolve the skill a launch (review/respond/doctor) should delegate to for
    the MR at `mrUrl` -- the per-repo mattstack manifest binding when present,
    else config -- and log the choice once at launch time. review/respond
    have no config fallback (reviewSkill/respondSkill retired -- dead, always
    shadowed by the manifest); only doctor's config.doctorSkill is real. */
function resolveLaunchSkill(kind: BoardSkillKind, mrUrl: string): string {
  const project = projectPathFromWebUrl(mrUrl, config.gitlabHost);
  const resolved = project
    ? resolveBoardSkill(kind, project, config)
    : {
        skill: kind === 'doctor' ? config.doctorSkill : '',
        source: 'config' as const,
      };
  console.log(`${kind} skill: ${resolved.skill} (${resolved.source})`);
  return resolved.skill;
}

/**
 * Refine each MR's comment signal by fetching its discussions: reviewer threads
 * (with status) and general comments, minus bots/linkbacks. Fetched for EVERY
 * open MR each refresh — the cheap dashboard query only exposes the unresolved
 * count, which is 0 both for "never commented" and "all resolved", so the only
 * reliable way to detect an all-resolved / generally-commented MR is to fetch its
 * discussions. Paced (once per ~60s snapshot refresh) and best-effort — a failed
 * fetch keeps the coarse fallback (unresolvedThreads).
 */
async function enrichReviewerComments(mrs: BoardMR[]): Promise<void> {
  for (let i = 0; i < mrs.length; i += FETCH_CONCURRENCY) {
    const chunk = mrs.slice(i, i + FETCH_CONCURRENCY);
    await Promise.all(
      chunk.map(async m => {
        try {
          if (!m.rtRepo) return;
          const repoId = repoIdentityField(m.rtRepo);
          if (!repoId) return; // keep the coarse fallback — same as any other skip in this loop
          const res = await readDiscussions(repoId, m.iid);
          if (!res.ok || !res.data) return; // keep the coarse fallback
          const detail = { discussions: res.data.discussions } as MRDetail;
          const { threads, comments } = summarizeDiscussions(
            detail,
            m.author.username,
            config.botUsernames
          );
          m.reviewerComments = unresolvedReviewerCount(threads);
          m.threadSummary = threadStatusCounts(threads);
          m.generalComments = comments.length;
        } catch {
          // Keep the coarse fallback (unresolvedThreads) for this MR.
        }
      })
    );
  }
}

/** This MR's discussions, from the daemon store the snapshot refresh uses. */
async function readLatchDetail(mr: BoardMR): Promise<MRDetail | null> {
  if (!mr.rtRepo) return null;
  const repoId = repoIdentityField(mr.rtRepo);
  if (!repoId) return null;
  const res = await readDiscussions(repoId, mr.iid);
  if (!res.ok || !res.data) return null;
  return { discussions: res.data.discussions } as MRDetail;
}

/** The tabId a signal's launched pane is running in, from whichever of the
    three state stores its kind owns (see closeOnDone). */
const resolveSignalTabId: TabIdResolver = signal => {
  if (signal.kind === 'review')
    return readReviewStates().get(signal.mrUrl)?.tabId;
  if (signal.kind === 'respond')
    return readRespondStates().get(signal.mrUrl)?.tabId;
  return readDoctorStates().get(signal.mrUrl)?.tabId;
};

/** When that same state store was last written, from the same three maps
    resolveSignalTabId reads. */
const resolveSignalUpdatedAt = (signal: AgentSignal): number | undefined => {
  if (signal.kind === 'review')
    return readReviewStates().get(signal.mrUrl)?.updatedAt;
  if (signal.kind === 'respond')
    return readRespondStates().get(signal.mrUrl)?.updatedAt;
  return readDoctorStates().get(signal.mrUrl)?.updatedAt;
};

// "" (falsy), not omitted -- writeReviewState/writeRespondState/writeDoctorState
// all merge patch.tabId ?? prev.tabId, so leaving it out of the patch would
// keep the stale id and the next sweep would re-fire this same close.
const clearSignalTabId: TabIdClearer = signal => {
  if (signal.kind === 'review')
    writeReviewState(reviewFilePath(signal.mrUrl), {
      status: 'done',
      tabId: '',
    });
  else if (signal.kind === 'respond')
    writeRespondState(respondFilePath(signal.mrUrl), {
      status: 'done',
      tabId: '',
    });
  else
    writeDoctorState(doctorFilePath(signal.mrUrl), {
      status: 'done',
      tabId: '',
    });
};

let forceNextFetch = false;
const cache = new SnapshotCache(async () => {
  // Consume the flag up front: a failed forced fetch must not leave force
  // latched for the background refreshes that follow.
  const force = forceNextFetch;
  forceNextFetch = false;
  const {
    prs,
    dataSyncedAt,
    scopeUncovered,
    scopeWindowDays,
    scopeUncoveredSections,
    scopeKnownSections,
    tags,
  } = await fetchTeamMRs(force);
  const mrs = buildBoard(prs, config, undefined, tags);
  await enrichReviewerComments(mrs);
  return {
    mrs,
    dataSyncedAt,
    scopeUncovered,
    scopeWindowDays,
    scopeUncoveredSections,
    scopeKnownSections,
  };
});

/**
 * Fresh MRs for a single member. Reads the same project stores with a 20s
 * freshness demand: on live-granted repos the store is already event-fresh,
 * so this is a socket read, not an API fetch (spec §6 / review N3).
 */
async function fetchMemberMRs(username: string): Promise<BoardMR[]> {
  const out: PullRequest[] = [];
  const tags = new Map<string, string[]>();
  const errors: string[] = [];
  for (const projectPath of config.projects) {
    const repoId = daemonRepoField(config, projectPath);
    if (!repoId) {
      errors.push(`${projectPath}: no rtRepos mapping in config.json`);
      continue;
    }
    const res = await readProjectMRs(repoId, 20_000);
    if (!res.ok || !res.data) {
      errors.push(`${projectPath}: ${res.error ?? 'empty daemon response'}`);
      continue;
    }
    for (const entry of Object.values(res.data.mrs)) {
      if (entry.pr.state !== 'opened' || entry.pr.author?.username !== username)
        continue;
      out.push(entry.pr);
      if (entry.codeownerSections?.length)
        tags.set(entry.pr.id, entry.codeownerSections);
    }
  }
  if (errors.length) throw new Error(errors.join(' · '));
  const mrs = buildBoard(out, config, undefined, tags);
  await enrichReviewerComments(mrs);
  return mrs;
}

/** Display names resolved from GitLab profiles, keyed by username. Long TTL. */
const memberNames = new Map<string, string | null>();
let namesFetchedAt = 0;
const NAMES_TTL_MS = 60 * 60_000;

async function refreshMemberNames(): Promise<void> {
  if (namesFetchedAt && Date.now() - namesFetchedAt < NAMES_TTL_MS) return;
  namesFetchedAt = Date.now();
  const token = await getGitlabToken();
  await Promise.all(
    config.members.map(async member => {
      try {
        if (!token) {
          memberNames.set(member.username, displayName(member, null));
          return;
        }
        const user = await (await gitlab()).fetchUser(member.username);
        memberNames.set(member.username, displayName(member, user?.name));
      } catch (err) {
        console.error(
          `name lookup failed for ${member.username}: ${err instanceof Error ? err.message : err}`
        );
        memberNames.set(member.username, displayName(member, null));
      }
    })
  );
}
// Fire-and-forget: a hung/down daemon must not delay Bun.serve() by the
// full getGitlabToken() timeout at boot. Every consumer already renders a
// null display name (falls back to member.name / username) until this
// resolves, same as the other void refreshMemberNames() call sites below.
void refreshMemberNames();

// Client bundle: a fresh Bun.build at boot in dev, pre-built + embedded
// assets injected by src/compiled.ts when running as a standalone binary.
// The react-singleton constraint story lives in client-bundle.ts.
const { appJs, appCss } = await getClientAssets();

const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${config.title.replace(/</g, '&lt;')}</title>
<script>
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const applyTheme = () => {
    const mode = localStorage.getItem("mrs-theme") ?? "system";
    const dark = mode === "dark" || (mode === "system" && mq.matches);
    document.documentElement.classList.toggle("dark", dark);
  };
  applyTheme();
  mq.addEventListener("change", applyTheme);
  window.__applyTheme = applyTheme;
</script>
<!-- No webfont link: the UI font is a system stack, and the kit's JetBrains
     Mono (still carried by the mono-pinned surfaces) is inlined into /app.css
     as a data URI. Neither slot costs an external request or a fallback flash. -->
<link rel="stylesheet" href="/app.css">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;

// $PORT is authoritative (config.port retired) so a deployment (launchd/systemd)
// can pin the port the tunnel points at.
const port = Number(process.env.PORT) || 7930;

const httpServer = Bun.serve({
  port,
  // Loopback only (spec ruling 6): local-only gates are network-local, not
  // just Host-header-local (config.host, a wider-bind opt-in, retired).
  hostname: '127.0.0.1',
  // The cold fetch (paging the project MR list + batch-fetching) can exceed
  // Bun's 10s default; give it room so the first request doesn't time out.
  idleTimeout: 60,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (FIXTURE_DIR) {
      if (req.method !== 'GET')
        return new Response('fixture mode is read-only', { status: 501 });
      switch (pathname) {
        case '/data.json':
          return new Response(readFileSync(fixtureFile('data.json'), 'utf8'), {
            headers: { 'content-type': 'application/json' },
          });
        case '/discussions':
          return new Response(
            readFileSync(fixtureFile('discussions.json'), 'utf8'),
            { headers: { 'content-type': 'application/json' } }
          );
        case '/review/report':
          return new Response(
            readFileSync(fixtureFile('review-report.md'), 'utf8'),
            { headers: { 'content-type': 'text/markdown' } }
          );
        case '/respond/report':
          return new Response(
            readFileSync(fixtureFile('respond-report.md'), 'utf8'),
            { headers: { 'content-type': 'text/markdown' } }
          );
        case '/peer/boards':
          return new Response(JSON.stringify({ boards: [] }), {
            headers: { 'content-type': 'application/json' },
          });
        case '/member': {
          const u = new URL(req.url).searchParams.get('u');
          const data = JSON.parse(
            readFileSync(fixtureFile('data.json'), 'utf8')
          ) as {
            mrs: Array<{ author: { username: string } }>;
            fetchedAt: number;
          };
          return new Response(
            JSON.stringify({
              mrs: data.mrs.filter(m => m.author.username === u),
              fetchedAt: data.fetchedAt,
            }),
            { headers: { 'content-type': 'application/json' } }
          );
        }
      }
    }
    // Health/SSE/static-asset routes need no board secret -- handled here,
    // BEFORE the token round trip below, so a wedged daemon (the exact thing
    // /healthz exists to let an operator detect) can never stall a health
    // check, the SSE nudge channel, or the page shell/assets it loads to
    // show that diagnosis. Falls through (no default case) to the main
    // switch for everything else.
    switch (pathname) {
      case '/healthz':
        return new Response('ok');
      case '/events': {
        // One-way nudge channel: browsers re-pull /data.json on any message.
        let ctrl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            sseClients.add(c);
            c.enqueue(sseEncoder.encode('retry: 3000\n\n'));
          },
          cancel() {
            sseClients.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
          },
        });
      }
      case '/':
        return new Response(shell, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      // tui-kit's tokens + page canvas, bundled out of client/main.tsx. Linked
      // ahead of /style.css: the token block lives in @layer soribashi.tokens,
      // and canvas.css is unlayered but earlier, so the board's own unlayered
      // rules still win every conflict.
      case '/app.css':
        return new Response(appCss, {
          headers: { 'content-type': 'text/css; charset=utf-8' },
        });
      case '/style.css': {
        const css = IS_COMPILED ? styleCss : readFileSync(cssPath, 'utf-8');
        return new Response(css, {
          headers: { 'content-type': 'text/css; charset=utf-8' },
        });
      }
      case '/favicon.svg':
        return new Response(favicon, {
          headers: { 'content-type': 'image/svg+xml; charset=utf-8' },
        });
      case '/app.js':
        return new Response(appJs, {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        });
    }
    // Store-backed settings for the ConfigModal — settings-kit answers its
    // own routes and falls through for everything else. Writes ride board's
    // locality rule; reads are as public as /data.json already is.
    if (pathname.startsWith('/api/settings/')) {
      const settingsRes = await settingsHandler(req, {
        allowWrite: isLocalRequest,
        allowComposite: true,
      });
      if (settingsRes) {
        // Board's config is a snapshot resolved once at boot (see `config`
        // below) and otherwise only refreshed by the config.json watcher --
        // a write through this very API would otherwise sit in the settings
        // store, correctly persisted, but invisible to this running process
        // until a manual restart. A modal edit is the same kind of change as
        // a config.json edit, so it gets the same live-reload treatment.
        if (req.method === 'POST' && settingsRes.ok)
          reloadConfig('settings changed');
        return settingsRes;
      }
    }

    // Resolved once per request, off the memoized getters above -- cheap
    // after the first daemon round trip, and every branch below expects a
    // plain string|null the way the removed module-level consts used to read.
    const [gitlabToken, slackToken, switchboardAdminToken] = await Promise.all([
      getGitlabToken(),
      getSlackToken(),
      getSwitchboardAdminToken(),
    ]);
    switch (pathname) {
      case '/member': {
        // Scoped refresh: just one member's MRs, cheap enough to poll often.
        const u = new URL(req.url).searchParams.get('u');
        // A codeowners tab's roster is inferred from the authors it shows, so
        // a scoped refresh there names someone off the config roster. Serving
        // them is safe (the snapshot already shows their tagged rows) and
        // without it the tab's 15s poll and refresh button 400 while filtered.
        const onRoster =
          !!u && config.members.some(m => m.username === u && !m.hidden);
        const taggedAuthor =
          !!u &&
          (await cache.get()).mrs.some(
            mr => mr.author.username === u && mr.codeownerSections.length > 0
          );
        if (!u || (!onRoster && !taggedAuthor)) {
          return new Response('unknown member', { status: 400 });
        }
        void refreshMemberNames();
        try {
          const mrs = await fetchMemberMRs(u);
          // Peer state too: a scoped refresh replaces that member's rows
          // wholesale on the client, so anything left off here would blink out
          // of the UI every 15s.
          const withState = attachPeerState(
            attachDrafts(
              attachSlack(
                attachGates(
                  attachDoctors(
                    attachResponds(
                      attachReviews(mrs, readReviewStates()),
                      readRespondStates()
                    ),
                    readDoctorStates()
                  ),
                  gateCache
                ),
                readSlackRefs()
              ),
              heldDraftsByMr(readDrafts())
            )
          );
          return new Response(
            JSON.stringify({ mrs: withState, fetchedAt: Date.now() }),
            {
              headers: { 'content-type': 'application/json' },
            }
          );
        } catch (err) {
          return new Response(
            `member fetch failed: ${err instanceof Error ? err.message : err}`,
            { status: 502 }
          );
        }
      }
      case '/data.json': {
        void refreshMemberNames();
        // ?fresh=1 forces a cache-bypassing refetch (the manual refresh
        // button). Local-only: a tunnel visitor's fresh=1 degrades to a
        // plain cached read instead of a forced daemon sync (FIX 3).
        const wantsFresh =
          !!new URL(req.url).searchParams.get('fresh') && isLocalRequest(req);
        if (wantsFresh) forceNextFetch = true;
        const snapshot = wantsFresh
          ? await cache.forceRefresh()
          : await cache.get();
        // Hidden (checked-out) members drop from the sidebar, the "All" list,
        // and its counts — but stay in `allMembers` so the settings modal can
        // check them back in.
        const visible = config.members.filter(m => !m.hidden);
        const visibleMrs = visibleMrsFor(snapshot.mrs, visible);
        // Retain review/respond/doctor state for exactly as long as its MR is on
        // the board; prune once it merges/closes/goes stale and drops off. Gated
        // on a healthy, non-empty snapshot so a failed fetch (stale/empty data)
        // can't wipe live state. Keyed on the full board (all members, incl.
        // hidden), not just the visible subset.
        if (!snapshot.fetchError && snapshot.mrs.length > 0) {
          const onBoard = new Set(
            snapshot.mrs.map(m => m.webUrl).filter((u): u is string => !!u)
          );
          pruneReviewStates(onBoard);
          pruneRespondStates(onBoard);
          pruneDoctorStates(onBoard);
          // Fire-and-forget: this sits on the /data.json request path and
          // must never block or fail the response on a slow/failed daemon call.
          void pruneOffBoardGates(gateCache.rows(), onBoard, {
            gateClose,
            logError: message => console.error(message),
          }).catch(err =>
            console.error(
              `gate prune failed: ${err instanceof Error ? err.message : err}`
            )
          );
          pruneDrafts(onBoard);
          prunePeerReviews(onBoard);
          pruneSentNudges(onBoard);
          pruneNudges(onBoard);
        }
        const reviews = readReviewStates();
        const responds = readRespondStates();
        const doctors = readDoctorStates();
        const slackRefs = readSlackRefs();
        return new Response(
          JSON.stringify({
            title: config.title,
            defaultMember: config.defaultMember,
            members: buildRoster(visible, visibleMrs, memberNames),
            allMembers: config.members.map(m => ({
              username: m.username,
              name: memberNames.get(m.username) ?? m.name ?? null,
              hidden: !!m.hidden,
              // fetchTeamMRs does not filter by member at all (hidden or
              // otherwise) -- a checked-out member's MRs are still in
              // `snapshot.mrs`. null is deliberate anyway: it signals "not
              // tracked" for a hidden member rather than a real (and
              // possibly stale-looking) count for someone the sidebar no
              // longer shows -- the modal renders null as "—", not "0".
              count: m.hidden
                ? null
                : snapshot.mrs.filter(mr => mr.author.username === m.username)
                    .length,
            })),
            mrs: attachPeerState(
              attachDrafts(
                attachSlack(
                  attachGates(
                    attachDoctors(
                      attachResponds(
                        attachReviews(visibleMrs, reviews),
                        responds
                      ),
                      doctors
                    ),
                    gateCache
                  ),
                  slackRefs
                ),
                heldDraftsByMr(readDrafts())
              )
            ),
            local: isLocalRequest(req),
            canInvite:
              isLocalRequest(req) &&
              !!switchboardAdminToken &&
              !!config.switchboard.url,
            peering: peering.current() ? peering.current()!.health() : null,
            slackEnabled: !!slackToken,
            slackEmoji: config.slack.emoji,
            slackTemplates: {
              single: config.slack.singleTemplate,
              multiHeader: config.slack.multiHeader,
              multiItem: config.slack.multiItem,
            },
            fetchedAt: snapshot.fetchedAt,
            fetchError: snapshot.fetchError,
            dataSyncedAt: snapshot.dataSyncedAt,
            scopeUncovered: snapshot.scopeUncovered,
            scopeWindowDays: snapshot.scopeWindowDays,
            scopeUncoveredSections: snapshot.scopeUncoveredSections,
            scopeKnownSections: snapshot.scopeKnownSections,
            staleAfterDays: config.staleAfterDays,
            tabs: config.tabs,
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      }
      case '/settings': {
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const { username, hidden } = (body ?? {}) as {
          username?: unknown;
          hidden?: unknown;
        };
        if (typeof username !== 'string' || typeof hidden !== 'boolean') {
          return new Response(
            'expected { username: string, hidden: boolean }',
            { status: 400 }
          );
        }
        if (!config.members.some(m => m.username === username)) {
          return new Response(`unknown member "${username}"`, { status: 400 });
        }
        // Single writer: persist to the latch-decided target, then swap the
        // in-memory members so this and every subsequent /data.json reflect
        // the new state. A fresh unknown-member throw here (the cached
        // `config` above raced a roster change) is still a 400, not a 500.
        try {
          config.members = saveMemberHidden(username, hidden).members;
        } catch (err) {
          if (err instanceof Error && /^unknown member /.test(err.message)) {
            return new Response(err.message, { status: 400 });
          }
          throw err;
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/roster': {
        // Add, drop, or rename a teammate. Sibling of /settings (which only
        // flips the hidden overlay): both are single-writer config mutations
        // that swap the in-memory roster so this and every later /data.json
        // agree. Every rule lives in applyRosterEdit; this only shapes the
        // request and persists the result.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const { action, username, name } = (body ?? {}) as {
          action?: unknown;
          username?: unknown;
          name?: unknown;
        };
        if (
          (action !== 'add' && action !== 'remove' && action !== 'rename') ||
          typeof username !== 'string' ||
          !username.trim()
        ) {
          return new Response(
            'expected { action: "add" | "remove" | "rename", username: string, name?: string }',
            { status: 400 }
          );
        }
        if (name !== undefined && typeof name !== 'string') {
          return new Response('name must be a string', { status: 400 });
        }
        const edit = applyRosterEdit(
          config.members,
          { action, username, name },
          config.defaultMember === 'all' ? null : config.defaultMember
        );
        if (!edit.ok) return new Response(edit.error, { status: 400 });
        try {
          config.members = saveRosterMembers(edit.members).members;
        } catch (err) {
          return new Response(
            `roster write failed: ${err instanceof Error ? err.message : err}`,
            { status: 500 }
          );
        }
        // A new member's MRs are not in the snapshot yet, and a dropped one's
        // must leave it: the next full fetch declares the new demand to rt.
        // A rename changes no demand, but the display name is cached for an
        // hour, so the lookup has to be re-armed either way.
        cache.invalidate();
        namesFetchedAt = 0;
        void refreshMemberNames();
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/tabs': {
        // Replace the tab list. Same single-writer contract as /roster: the
        // in-memory config swaps so /data.json agrees at once, and the cache
        // drops so the next fetch declares the new sections to rt.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const { tabs } = (body ?? {}) as { tabs?: unknown };
        if (!Array.isArray(tabs))
          return new Response('expected { tabs: TabConfig[] }', {
            status: 400,
          });
        try {
          config.tabs = saveTabs(tabs).tabs;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const status = /^tabs\b/.test(message) ? 400 : 500;
          return new Response(
            status === 400 ? message : `tabs write failed: ${message}`,
            { status }
          );
        }
        cache.invalidate();
        return new Response(JSON.stringify({ ok: true, tabs: config.tabs }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/discussions': {
        // Reviewer-participated comment threads for the drawer, from the rt
        // daemon's discussions store. `repo` is the rt repo name (was a scoped
        // repositoryId before the rewire).
        const { searchParams } = new URL(req.url);
        const repo = searchParams.get('repo');
        const iid = Number(searchParams.get('iid'));
        const author = searchParams.get('author');
        if (!repo || !iid)
          return new Response('expected repo & iid', { status: 400 });
        const repoId = repoIdentityField(repo);
        if (!repoId)
          return new Response(`"${repo}" is not a recognized repo identity`, {
            status: 400,
          });
        const res = await readDiscussions(repoId, iid);
        if (!res.ok || !res.data) {
          return new Response(
            `discussions read failed: ${res.error ?? 'empty daemon response'}`,
            { status: 502 }
          );
        }
        const detail = { discussions: res.data.discussions } as MRDetail;
        const { threads, comments } = summarizeDiscussions(
          detail,
          author,
          config.botUsernames
        );
        return new Response(JSON.stringify({ threads, comments }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/review': {
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        if (!config.reviewCwd)
          return new Response('reviewCwd not configured', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        if (!parsed)
          return new Response('expected { mrUrl: string, iid: number }', {
            status: 400,
          });
        const resume = (body as { resume?: unknown })?.resume === true;
        const reReview = (body as { reReview?: unknown })?.reReview === true;
        const tabId = (body as { tabId?: unknown })?.tabId;
        const noteParse = parseLaunchNote(body);
        if (!noteParse.ok)
          return new Response(noteParse.error, { status: 400 });
        const note = noteParse.note;
        // Only launch for an MR the board is actually showing.
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find(m => m.webUrl === parsed.mrUrl);
        if (!mr) {
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        }
        const author = mrAuthorLabel(mr);
        const existing = readReviewStates().get(parsed.mrUrl);
        const repo = resolveLaunchRepo(
          mr.rtRepo,
          config.gitlabHost,
          projectPathFromWebUrl(parsed.mrUrl, config.gitlabHost) ?? '',
          parsed.mrUrl
        );
        if (reReview) {
          // A live review re-focuses its tab rather than re-reviewing on top of it.
          if (
            existing?.tabId &&
            (existing.status === 'queued' || existing.status === 'reviewing')
          ) {
            try {
              await focusPane(existing);
              return new Response(JSON.stringify({ ok: true, focused: true }), {
                headers: { 'content-type': 'application/json' },
              });
            } catch {
              // tab is gone — fall through and start the re-review fresh
            }
          }
          // Resume-or-fresh lives in the launcher so triage can start the same
          // re-review off a peer's nudge. Spawn asynchronously; the badge
          // reflects progress via the state file.
          void launchReReview(parsed.mrUrl, parsed.iid, {
            cwd: config.reviewCwd,
            repo,
            workspaceLabel: config.reviewsWorkspace,
            skill: reviewSkillForTab(
              config,
              typeof tabId === 'string' ? tabId : undefined,
              parsed.mrUrl,
              resolveLaunchSkill
            ),
            author,
            ...loadAgentSettings(),
            claudeCommand: config.claudeCommand,
            note,
          });
          return new Response(JSON.stringify({ ok: true, reReview: true }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        if (resume) {
          const statePath = reviewFilePath(parsed.mrUrl);
          // A plain reopen (no --re-review) stays promptless and interactive --
          // it must NEVER carry the re-review slash command (that belongs only
          // to the /review re-review flow above). An operator note, if any, is
          // the only thing sent as the first message.
          const prompt = reopenPrompt(note);
          if (existing?.agentId) {
            void resumeAgentPane({
              agentId: existing.agentId,
              prompt,
              workspaceLabel: config.reviewsWorkspace,
              tabLabel: mrTabLabel(parsed.iid, author, '↺'),
            })
              .then(result => {
                if (result.focusedExisting) return;
                writeReviewState(statePath, {
                  status: existing?.status ?? 'done',
                  tabId: result.tabId,
                  workspaceId: result.workspaceId,
                  agentId: result.agentId,
                  paneId: result.paneId,
                });
              })
              .catch(err =>
                console.error(
                  `review resume failed: ${err instanceof Error ? err.message : err}`
                )
              );
            return new Response(JSON.stringify({ ok: true, resumed: true }), {
              headers: { 'content-type': 'application/json' },
            });
          }
          const sessionId = existing?.sessionId;
          if (!sessionId)
            return new Response('no session id on file for this review', {
              status: 400,
            });
          void launchLegacyResume({
            mrUrl: parsed.mrUrl,
            iid: parsed.iid,
            cwd: config.reviewCwd,
            repo,
            workspaceLabel: config.reviewsWorkspace,
            statePath,
            sessionId,
            workspaceKind: 'review',
            author,
            prompt,
            claudeCommand: config.claudeCommand,
          })
            .then(({ tabId, workspaceId }) =>
              writeReviewState(statePath, {
                status: existing?.status ?? 'done',
                tabId,
                workspaceId,
              })
            )
            .catch(err =>
              console.error(
                `review resume failed: ${err instanceof Error ? err.message : err}`
              )
            );
          return new Response(JSON.stringify({ ok: true, resumed: true }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        // Dedup: a live review for this MR re-focuses its tab instead of spawning another.
        if (
          existing &&
          existing.tabId &&
          (existing.status === 'queued' || existing.status === 'reviewing')
        ) {
          try {
            await focusPane(existing);
            return new Response(JSON.stringify({ ok: true, focused: true }), {
              headers: { 'content-type': 'application/json' },
            });
          } catch {
            // tab is gone — fall through and start a fresh review
          }
        }
        const statePath = reviewFilePath(parsed.mrUrl);
        writeReviewState(statePath, {
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          status: 'queued',
        });
        // Spawn asynchronously; the badge reflects progress via the state file.
        void launchReview({
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          cwd: config.reviewCwd,
          repo,
          workspaceLabel: config.reviewsWorkspace,
          statePath,
          skill: reviewSkillForTab(
            config,
            typeof tabId === 'string' ? tabId : undefined,
            parsed.mrUrl,
            resolveLaunchSkill
          ),
          author,
          ...loadAgentSettings(),
          note,
        })
          .then(result => {
            if (result.focusedExisting) return;
            writeReviewState(statePath, {
              status: 'queued',
              tabId: result.tabId,
              workspaceId: result.workspaceId,
              agentId: result.agentId,
              paneId: result.paneId,
            });
          })
          .catch(err => {
            console.error(
              `review launch failed: ${err instanceof Error ? err.message : err}`
            );
            writeReviewState(statePath, {
              status: 'error',
              message: 'failed to launch review pane',
            });
          });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/respond': {
        // Launch the response-to-review skill in a fresh herdr pane for the
        // caller's own MR. Same shape as /review: local-only, dedup a running
        // response, kick the pane asynchronously, and let the state file
        // drive the badge.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        const cwd = config.respondCwd || config.reviewCwd;
        if (!cwd)
          return new Response('respondCwd (or reviewCwd) not configured', {
            status: 400,
          });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseRespondRequestBody(body);
        if (!parsed)
          return new Response('expected { mrUrl: string, iid: number }', {
            status: 400,
          });
        const resume = (body as { resume?: unknown })?.resume === true;
        const noteParse = parseLaunchNote(body);
        if (!noteParse.ok)
          return new Response(noteParse.error, { status: 400 });
        const note = noteParse.note;
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find(m => m.webUrl === parsed.mrUrl);
        if (!mr) {
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        }
        const author = mrAuthorLabel(mr);
        const existing = readRespondStates().get(parsed.mrUrl);
        const repo = resolveLaunchRepo(
          mr.rtRepo,
          config.gitlabHost,
          projectPathFromWebUrl(parsed.mrUrl, config.gitlabHost) ?? '',
          parsed.mrUrl
        );
        if (resume) {
          const statePath = respondFilePath(parsed.mrUrl);
          // A plain reopen (no note) stays promptless and interactive -- same
          // rule as the review resume above.
          const prompt = reopenPrompt(note);
          if (existing?.agentId) {
            void resumeAgentPane({
              agentId: existing.agentId,
              prompt,
              workspaceLabel: config.respondsWorkspace,
              tabLabel: mrTabLabel(parsed.iid, author, '↺'),
            })
              .then(result => {
                if (result.focusedExisting) return;
                writeRespondState(statePath, {
                  status: existing?.status ?? 'done',
                  tabId: result.tabId,
                  workspaceId: result.workspaceId,
                  agentId: result.agentId,
                  paneId: result.paneId,
                });
              })
              .catch(err =>
                console.error(
                  `respond resume failed: ${err instanceof Error ? err.message : err}`
                )
              );
            return new Response(JSON.stringify({ ok: true, resumed: true }), {
              headers: { 'content-type': 'application/json' },
            });
          }
          const sessionId = existing?.sessionId;
          if (!sessionId)
            return new Response('no session id on file for this response', {
              status: 400,
            });
          void launchLegacyResume({
            mrUrl: parsed.mrUrl,
            iid: parsed.iid,
            cwd: cwd,
            repo,
            workspaceLabel: config.respondsWorkspace,
            statePath,
            sessionId,
            workspaceKind: 'respond',
            author,
            prompt,
            claudeCommand: config.claudeCommand,
          })
            .then(({ tabId, workspaceId }) =>
              writeRespondState(statePath, {
                status: existing?.status ?? 'done',
                tabId,
                workspaceId,
              })
            )
            .catch(err =>
              console.error(
                `respond resume failed: ${err instanceof Error ? err.message : err}`
              )
            );
          return new Response(JSON.stringify({ ok: true, resumed: true }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        const inFlight = new Set([
          'queued',
          'triaging',
          'implementing',
          'drafting',
        ]);
        if (existing && existing.tabId && inFlight.has(existing.status)) {
          try {
            await focusPane(existing);
            return new Response(JSON.stringify({ ok: true, focused: true }), {
              headers: { 'content-type': 'application/json' },
            });
          } catch {
            // tab is gone -- fall through and start a fresh response
          }
        }
        const statePath = respondFilePath(parsed.mrUrl);
        writeRespondState(statePath, {
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          status: 'queued',
        });
        void launchRespond({
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          cwd,
          repo,
          workspaceLabel: config.respondsWorkspace,
          statePath,
          skill: resolveLaunchSkill('respond', parsed.mrUrl),
          author,
          ...loadAgentSettings(),
          note,
        })
          .then(result => {
            if (result.focusedExisting) return;
            writeRespondState(statePath, {
              status: 'queued',
              tabId: result.tabId,
              workspaceId: result.workspaceId,
              agentId: result.agentId,
              paneId: result.paneId,
            });
          })
          .catch(err => {
            console.error(
              `respond launch failed: ${err instanceof Error ? err.message : err}`
            );
            writeRespondState(statePath, {
              status: 'error',
              message: 'failed to launch respond pane',
            });
          });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/doctor': {
        // Launch the MR-doctor skill to fix mechanical breakage (CI red /
        // merge conflicts) on the caller's MR. Same shape as /respond.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        const cwd = config.doctorCwd || config.reviewCwd;
        if (!cwd)
          return new Response('doctorCwd (or reviewCwd) not configured', {
            status: 400,
          });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseDoctorRequestBody(body);
        if (!parsed)
          return new Response('expected { mrUrl: string, iid: number }', {
            status: 400,
          });
        const noteParse = parseLaunchNote(body);
        if (!noteParse.ok)
          return new Response(noteParse.error, { status: 400 });
        const note = noteParse.note;
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find(m => m.webUrl === parsed.mrUrl);
        if (!mr) {
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        }
        const author = mrAuthorLabel(mr);
        const existing = readDoctorStates().get(parsed.mrUrl);
        const repo = resolveLaunchRepo(
          mr.rtRepo,
          config.gitlabHost,
          projectPathFromWebUrl(parsed.mrUrl, config.gitlabHost) ?? '',
          parsed.mrUrl
        );
        const inFlight = new Set([
          'queued',
          'diagnosing',
          'rebasing',
          'fixing',
          'watching',
        ]);
        if (existing && existing.tabId && inFlight.has(existing.status)) {
          try {
            await focusPane(existing);
            return new Response(JSON.stringify({ ok: true, focused: true }), {
              headers: { 'content-type': 'application/json' },
            });
          } catch {
            // tab is gone -- fall through and start a fresh doctor session
          }
        }
        const triage = loadTriageConfig();
        // Token validation happens here, OUTSIDE the lock, since it's a
        // network round-trip and the lock must never sit open for that long.
        const identityRead = readMemory();
        const identityBefore = identityRead.identity;
        const identity = await resolveDispatchIdentity(identityRead, async () =>
          (await gitlab()).validateToken()
        );
        // Only touch state/auto-dispatch.json when the identity actually
        // refreshed (a cache hit leaves identityRead.identity's reference
        // unchanged). bin/triage.ts serializes every access to this file
        // behind the same lock, so a slow pass and this manual launch never
        // clobber the SAME attempt budgets / lastHandledPipelineId /
        // budgetEscalatedDay in either direction; writeRefreshedIdentity
        // re-reads the CURRENT file under the lock rather than writing back
        // this stale pre-network-call snapshot, so a pass that wrote OTHER
        // fields during the round-trip is never reverted. A pass already
        // holding the lock just means this request's own identity refresh is
        // not persisted; it still applies to fixClasses below, and the next
        // request re-resolves it.
        if (identityRead.identity !== identityBefore) {
          const lockToken = tryAcquireMemoryLock();
          if (lockToken !== false) {
            try {
              writeRefreshedIdentity(identityRead.identity);
            } finally {
              releaseMemoryLock(lockToken);
            }
          }
        }
        // mode "rebase" is a scoped doctor: checkout tier (whose base
        // playbook is exactly worktree + rebase) with an EMPTY fix-class
        // allowlist, so CI triage and code fixes stay out of scope, plus a
        // note pinning the job to the rebase alone.
        const manual = manualDoctorFields(triage, mr.author.username, identity);
        const tier = parsed.mode === 'rebase' ? undefined : manual.tier;
        const fixClasses = parsed.mode === 'rebase' ? [] : manual.fixClasses;
        const launchNote =
          parsed.mode === 'rebase'
            ? [
                'rebase-only: rebase the source branch onto its target, resolve conflicts, and push; skip CI triage and any other fixes',
                note,
              ]
                .filter(Boolean)
                .join('. ')
            : note;
        const statePath = doctorFilePath(parsed.mrUrl);
        writeDoctorState(statePath, {
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          status: 'queued',
          origin: 'manual',
          tier,
          fixClasses,
        });
        void launchDoctor({
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          cwd,
          repo,
          workspaceLabel: config.doctorsWorkspace,
          statePath,
          skill: resolveLaunchSkill('doctor', parsed.mrUrl),
          author,
          ...loadAgentSettings(),
          note: launchNote,
          tier,
          fixClasses,
        })
          .then(result => {
            if (result.focusedExisting) return;
            writeDoctorState(statePath, {
              status: 'queued',
              tabId: result.tabId,
              workspaceId: result.workspaceId,
              agentId: result.agentId,
              paneId: result.paneId,
            });
          })
          .catch(err => {
            console.error(
              `doctor launch failed: ${err instanceof Error ? err.message : err}`
            );
            writeDoctorState(statePath, {
              status: 'error',
              message: 'failed to launch doctor pane',
            });
          });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/drafts': {
        // The ONLY path from a held doctor draft to a GitLab note. The human
        // click is the approval (spec §6): the doctor tier writes drafts and
        // nothing here runs unattended.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const { mrUrl, kind, action } = (body ?? {}) as {
          mrUrl?: unknown;
          kind?: unknown;
          action?: unknown;
        };
        if (
          typeof mrUrl !== 'string' ||
          typeof kind !== 'string' ||
          (action !== 'post' && action !== 'dismiss')
        ) {
          return new Response(
            'expected { mrUrl: string, kind: string, action: "post"|"dismiss" }',
            { status: 400 }
          );
        }
        const draft = readDrafts().find(
          d => d.mrUrl === mrUrl && d.kind === kind && d.status === 'held'
        );
        if (!draft)
          return new Response('no held draft for that MR/kind', {
            status: 404,
          });
        const path = draftFilePath(mrUrl, kind);
        if (action === 'dismiss') {
          writeDraft(path, { status: 'dismissed' });
          return new Response(JSON.stringify({ ok: true, dismissed: true }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        if (!gitlabToken)
          return new Response('gitlab token not configured', { status: 400 });
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find(m => m.webUrl === mrUrl);
        if (!mr) return new Response(`unknown MR "${mrUrl}"`, { status: 400 });
        try {
          const projectId = parseRepoId(mr.repositoryId);
          const mutator = new NoteMutator(config.gitlabHost, gitlabToken);
          const note = await mutator.createNote(projectId, mr.iid, draft.body);
          writeDraft(path, { status: 'posted', postedNoteId: note.id });
          return new Response(
            JSON.stringify({ ok: true, posted: true, noteId: note.id }),
            {
              headers: { 'content-type': 'application/json' },
            }
          );
        } catch (err) {
          return new Response(
            `note post failed: ${err instanceof Error ? err.message : err}`,
            { status: 502 }
          );
        }
      }
      case '/draft': {
        // Flip one of your own MRs between draft and ready. GitLab has no draft
        // flag: the draft state IS the title prefix, so rewriting the title is
        // the whole operation, both directions. Gated to your own MRs on both
        // sides (the menu item only renders for them, and this refuses others').
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        if (!gitlabToken)
          return new Response('gitlab token not configured', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        const draft = (body as { draft?: unknown })?.draft;
        if (!parsed || typeof draft !== 'boolean') {
          return new Response(
            'expected { mrUrl: string, iid: number, draft: boolean }',
            { status: 400 }
          );
        }
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find(m => m.webUrl === parsed.mrUrl);
        if (!mr)
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        if (mr.author.username !== config.defaultMember) {
          return new Response('not your MR', { status: 403 });
        }
        if (mr.isDraft === draft) {
          return new Response(JSON.stringify({ ok: true, unchanged: true }), {
            headers: { 'content-type': 'application/json' },
          });
        }
        const path = projectPathFromWebUrl(parsed.mrUrl, config.gitlabHost);
        if (!path)
          return new Response(
            `could not derive a project path from "${parsed.mrUrl}"`,
            { status: 400 }
          );
        try {
          // glance owns the title mechanics (on GitLab the draft state IS the
          // title prefix), reads the MR first since we send `draft` without a
          // title, and reads it back after to confirm the flag actually landed --
          // throwing instead of reporting a transition that did not happen.
          const updated = await (
            await gitlab()
          ).updatePullRequest(path, parsed.iid, { draft });
          // The cached snapshot still has the old state; drop it so the next
          // /data.json reflects the flip instead of waiting out the cache TTL.
          cache.invalidate();
          return new Response(
            JSON.stringify({ ok: true, draft, title: updated.title }),
            {
              headers: { 'content-type': 'application/json' },
            }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `draft update failed for !${parsed.iid} (draft=${draft}): ${message}`
          );
          // glance retries its post-write read-back, rejections and a draft flag
          // that has not caught up alike (0.18.1, MAT-169), so getting here means
          // those retries were exhausted rather than never tried. The edit landed
          // before any of that ran either way, so ask GitLab what is actually true
          // instead of reporting a write that worked as a failure.
          const after = await (
            await gitlab()
          )
            .fetchSingleMR(path, parsed.iid, null)
            .catch(() => null);
          if (after?.draft === draft) {
            cache.invalidate();
            return new Response(
              JSON.stringify({
                ok: true,
                draft,
                title: after.title,
                recovered: true,
              }),
              {
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          // The read above is a guess at what happened; this is the SDK telling
          // us outright that the edit reached GitLab and only describing it back
          // failed (glance 0.19.0). That outranks a recovery read which may
          // itself have just failed -- the flip is applied, so 502-ing here
          // would report a succeeded write as a failure, which is the whole bug.
          if (err instanceof ReadBackFailedError && err.writeApplied) {
            cache.invalidate();
            return new Response(
              JSON.stringify({
                ok: true,
                draft,
                recovered: true,
                verified: false,
              }),
              {
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          return new Response(`gitlab update failed: ${message}`, {
            status: 502,
          });
        }
      }
      case '/mr/action': {
        // Fire one GitLab-side MR action (merge / rebase / auto-merge arm or
        // cancel) from the row menu. Visibility is the client's job (the
        // view-model's button state); GitLab itself is the permission check.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        if (!gitlabToken)
          return new Response('gitlab token not configured', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseMrActionBody(body);
        if (!parsed) {
          return new Response(
            'expected { mrUrl: string, iid: number, action: merge|rebase|setAutoMerge|cancelAutoMerge }',
            { status: 400 }
          );
        }
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find(m => m.webUrl === parsed.mrUrl);
        if (!mr)
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        const path = projectPathFromWebUrl(parsed.mrUrl, config.gitlabHost);
        if (!path)
          return new Response(
            `could not derive a project path from "${parsed.mrUrl}"`,
            { status: 400 }
          );
        try {
          await runMrAction(await gitlab(), path, parsed.iid, parsed.action);
          // The cached snapshot predates the action; drop it so the next
          // /data.json reflects it instead of waiting out the cache TTL.
          cache.invalidate();
          return new Response(JSON.stringify({ ok: true }), {
            headers: { 'content-type': 'application/json' },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `mr action ${parsed.action} failed for !${parsed.iid}: ${message}`
          );
          return new Response(`gitlab ${parsed.action} failed: ${message}`, {
            status: 502,
          });
        }
      }
      case '/gate/answer': {
        // Answer a gate from the board UI, addressed by its own id -- an MR
        // can carry more than one live gate at once (review alongside
        // respond/doctor), so a card answers exactly the gate it renders,
        // never "whichever gate this MR has". The facility's gate:answer is
        // the single CAS arbiter; this proxies it (gates/answer.ts) and maps
        // the pure result onto HTTP status codes. Resume of a parked gate is
        // no longer triggered here -- it hangs off the gate/answered EVENT
        // (see gates/ingest.ts) so a console-answered gate resumes too.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const gateId = (body as { gateId?: unknown })?.gateId;
        const answers = (body as { answers?: unknown })?.answers;
        if (
          typeof gateId !== 'string' ||
          !gateId ||
          typeof answers !== 'object' ||
          answers === null ||
          Array.isArray(answers)
        ) {
          return new Response('expected { gateId: string, answers: object }', {
            status: 400,
          });
        }
        const result = await answerGate(gateId, answers as GateAnswers, {
          isAnswerable: id => {
            const row = gateCache.rows().find(r => r.id === id);
            return !!row && (row.status === 'open' || row.status === 'parked');
          },
          gateAnswer: gateAnswerFacility,
        });
        switch (result.kind) {
          case 'ok':
            return new Response(JSON.stringify({ ok: true }), {
              headers: { 'content-type': 'application/json' },
            });
          case 'conflict':
            return new Response(
              JSON.stringify({ ok: false, conflict: true, row: result.row }),
              {
                status: 409,
                headers: { 'content-type': 'application/json' },
              }
            );
          case 'not-found':
            return new Response(`unknown gate "${gateId}"`, { status: 404 });
          case 'invalid':
            return new Response(result.reason, { status: 400 });
          case 'unreachable':
            console.error(`gate answer: daemon unreachable: ${result.reason}`);
            return new Response('rt daemon unreachable, try again', {
              status: 502,
            });
        }
      }
      case '/gate/focus': {
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const gateId = (body as { gateId?: unknown })?.gateId;
        if (typeof gateId !== 'string' || !gateId)
          return new Response('expected { gateId: string }', { status: 400 });
        const row = gateCache.rows().find(r => r.id === gateId);
        if (!row)
          return new Response(`unknown gate "${gateId}"`, { status: 404 });
        const { panes, fetchFailed } = await panesForOrigin(
          row.origin ?? undefined,
          paneList
        );
        const resolved = resolveOriginFocus(row.origin ?? undefined, panes, {
          carryTabId: true,
        });
        if (!resolved.ok) {
          // The pane-list fetch itself failing is a different fact than the
          // fetch succeeding with no matching pane; say which one happened.
          const reason = fetchFailed
            ? 'could not list panes to match the origin worktree'
            : resolved.reason;
          return new Response(JSON.stringify({ ok: false, error: reason }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        try {
          const { focused } = await focusPane({
            paneId: resolved.paneId,
            tabId: resolved.tabId,
          });
          if (!focused) {
            return new Response(
              JSON.stringify({ ok: false, error: 'focus failed' }),
              {
                status: 502,
                headers: { 'content-type': 'application/json' },
              }
            );
          }
        } catch (err) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
            {
              status: 502,
              headers: { 'content-type': 'application/json' },
            }
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      case '/nudge': {
        // Ask a peer's agent for a re-review of YOUR OWN MR. The board only
        // relays the human's click; all policy runs in the peer's triage.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        const pc = peering.current()?.client;
        if (!pc)
          return new Response('switchboard not configured', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        const reviewer = (body as { reviewer?: unknown })?.reviewer;
        if (!parsed || typeof reviewer !== 'string' || !reviewer.trim()) {
          return new Response(
            'expected { mrUrl: string, iid: number, reviewer: string }',
            { status: 400 }
          );
        }
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find(m => m.webUrl === parsed.mrUrl);
        if (!mr)
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        if (mr.author.username !== config.defaultMember)
          return new Response('not your MR', { status: 403 });
        const draft = makeEnvelope(reviewer, 're-review-request', {
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
        } satisfies ReReviewRequestPayload);
        // Publish inline rather than queue-and-forget: a 4xx (usually 422, the
        // reviewer has no board on the switchboard) is permanent, and the drain
        // would drop it with only a log -- leaving the clicker an "ok" and a
        // chip reading "requested" for 48h for a send that can never happen.
        const status = await pc.publish(draft);
        const cls = classifySend(status);
        if (cls === 'drop') {
          // 422 is the relay's unknown-recipient answer, and the only 4xx a
          // human can act on -- the rest are this board's problem, not theirs.
          const why =
            status === 422
              ? `reviewer "${canonicalUsername(reviewer)}" is not on the switchboard`
              : `nudge rejected by relay (${status})`;
          return new Response(why, { status: 409 });
        }
        // Retryable (network or 5xx): queue it for the 60s tick. The chip
        // honestly reads "requested" while the outbox keeps trying.
        if (cls === 'retry') enqueueOutbox(draft);
        // Record the ask either way: an inbound outcome needs a file to resolve
        // against, even while the send is still queued.
        writeSentNudge({
          nudgeId: draft.id,
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          reviewer: canonicalUsername(reviewer),
          sentAt: Date.now(),
        });
        return new Response(
          JSON.stringify(
            cls === 'retry' ? { ok: true, queued: true } : { ok: true }
          ),
          {
            headers: { 'content-type': 'application/json' },
          }
        );
      }
      case '/peer/invite': {
        // Mint a one-paste invite for a peer. Operator-only: needs the admin
        // token this board holds, which is also what /data.json's canInvite
        // reports so the UI never offers a button that can't work.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        // isLocal reads the Host header, which a cross-origin form can forge.
        // Requiring a json content-type takes that away: a form post can only
        // carry the text/plain-class types, and anything else trips a CORS
        // preflight the board never answers. The board's own client always
        // sends application/json.
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        if (!switchboardAdminToken || !config.switchboard.url)
          return new Response('inviting is not set up on this board', {
            status: 400,
          });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const username = (body as { username?: unknown })?.username;
        if (typeof username !== 'string' || !username.trim())
          return new Response('expected { username }', { status: 400 });
        const r = await createInvite(username.trim(), {
          url: config.switchboard.url,
          adminToken: switchboardAdminToken,
        });
        return new Response(r.body, {
          status: r.status,
          headers:
            r.status === 200
              ? { 'content-type': 'application/json' }
              : undefined,
        });
      }
      case '/peer/boards': {
        if (req.method !== 'GET')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        if (!switchboardAdminToken || !config.switchboard.url)
          return new Response('inviting is not set up on this board', {
            status: 400,
          });
        const r = await listPeerBoards({
          url: config.switchboard.url,
          adminToken: switchboardAdminToken,
        });
        return new Response(r.body, {
          status: r.status,
          headers:
            r.status === 200
              ? { 'content-type': 'application/json' }
              : undefined,
        });
      }
      case '/peer/join': {
        // Redeem an invite from the UI: persist url + token, then hot-start
        // peering, so joining costs no restart.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        // Same content-type gate as /peer/invite above: a forged Host header on
        // a cross-origin form must not be enough to re-point this board's
        // switchboard config.
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const invite = (body as { invite?: unknown })?.invite;
        if (typeof invite !== 'string' || !invite.trim())
          return new Response('expected { invite }', { status: 400 });
        const r = await joinSwitchboard(invite, {
          defaultMember: config.defaultMember,
          persist(url, token) {
            // upsertEnvKeys reads "" as a removal, so an empty token must never
            // reach it: that would quietly delete the token line this board is
            // already peering with. Throwing here is the recovery answer. The
            // message is interpolated into onboard.ts's 500 body, which the join
            // UI shows verbatim, so it stays inside the onboarding vocabulary.
            if (!token) throw new Error('the switchboard sent nothing usable');
            // The two writes must land together or not at all. saveSwitchboardUrl
            // naming the new relay -- in config.json (unowned) or the machine
            // settings store (owned; see config.ts's saveSwitchboardUrl) --
            // while .env still holds the old token is the one state nothing
            // recovers from: this process keeps peering on the live handle,
            // but the next restart pairs the new url with the old token and
            // 401s forever. So put the url back if the token write fails,
            // and let the join report the failure.
            const previousUrl = config.switchboard.url;
            config = saveSwitchboardUrl(url); // reparsed config swaps in
            try {
              upsertEnvKeys(ENV_PATH, { SWITCHBOARD_TOKEN: token });
            } catch (err) {
              // A rollback that itself fails must not become the error the
              // operator sees: the token write is the real cause, and it is
              // what the 500 body explains. Log both and rethrow the original.
              try {
                config = saveSwitchboardUrl(previousUrl);
              } catch (rollbackErr) {
                console.error(
                  `peer: join could not save the switchboard token (${err instanceof Error ? err.message : err}), ` +
                    `and putting the previous url back failed too (${rollbackErr instanceof Error ? rollbackErr.message : rollbackErr}); ` +
                    `the switchboard url (config.json or the settings store) may still name ${url} while .env holds the old token`
                );
              }
              throw err;
            }
          },
          startPeering: (url, token) => peering.start(url, token),
        });
        return new Response(r.body, {
          status: r.status,
          headers:
            r.status === 200
              ? { 'content-type': 'application/json' }
              : undefined,
        });
      }
      case '/review/report': {
        // The agent's written review markdown for one MR. Read-only display
        // data, so it's available on the tunnel too (like the status badge),
        // not local-gated the way launching a review is.
        const mrUrl = new URL(req.url).searchParams.get('mr');
        if (!mrUrl) return new Response('expected ?mr=<url>', { status: 400 });
        const report = readReviewReport(mrUrl);
        if (report === null)
          return new Response('no review yet', { status: 404 });
        return new Response(report, {
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        });
      }
      case '/respond/report': {
        // The fill's written adjudication markdown for one MR -- same
        // read-only, tunnel-available shape as /review/report above.
        const mrUrl = new URL(req.url).searchParams.get('mr');
        if (!mrUrl) return new Response('expected ?mr=<url>', { status: 400 });
        const report = readRespondReport(mrUrl);
        if (report === null)
          return new Response('no respond report yet', { status: 404 });
        return new Response(report, {
          headers: { 'content-type': 'text/markdown; charset=utf-8' },
        });
      }
      case '/slack/resolve': {
        // Find (and cache) the MR's review-request message in the team channel.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        if (!slackToken)
          return new Response('slack not configured', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        if (!parsed)
          return new Response('expected { mrUrl: string, iid: number }', {
            status: 400,
          });
        const { channel } = (body ?? {}) as { channel?: unknown };
        const allowedChannels = configuredSlackChannels(config);
        if (
          channel !== undefined &&
          (typeof channel !== 'string' || !allowedChannels.includes(channel))
        ) {
          return new Response(
            `"channel" must be one of ${allowedChannels.join(', ')}`,
            { status: 400 }
          );
        }
        try {
          const snapshot = await cache.get();
          const mr = snapshot.mrs.find(m => m.webUrl === parsed.mrUrl);
          const resolvedChannel =
            typeof channel === 'string'
              ? channel
              : mr
                ? channelForMR(config, mr)
                : config.slack.channel;
          const ref = await resolveSlackRef(
            slackToken,
            resolvedChannel,
            parsed.mrUrl,
            parsed.iid
          );
          return new Response(
            JSON.stringify({
              ok: true,
              status: ref.status,
              permalink: ref.permalink,
              reactions: ref.reactions ?? [],
            }),
            { headers: { 'content-type': 'application/json' } }
          );
        } catch (err) {
          return new Response(
            `slack resolve failed: ${err instanceof Error ? err.message : err}`,
            { status: 502 }
          );
        }
      }
      case '/slack/refresh': {
        // Forced sweep for the posted-to-slack filter: every notfound ref is
        // re-checked against a fresh channel index; found refs are left alone.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        if (!slackToken)
          return new Response('slack not configured', { status: 400 });
        try {
          const { resolved, failed } = await runSlackSweep(true);
          return new Response(JSON.stringify({ ok: true, resolved, failed }), {
            headers: { 'content-type': 'application/json' },
          });
        } catch (err) {
          return new Response(
            `slack refresh failed: ${err instanceof Error ? err.message : err}`,
            { status: 502 }
          );
        }
      }
      case '/slack/post': {
        // Post an MR (or a summary of many MRs) to the configured channel and
        // write a slack ref pinned to the new message so reactions target it.
        // Item lines always render server-side from config templates against
        // the board cache. The header line is client-supplied, but
        // sanitizeHeader Slack-escapes it, so it cannot form a <url|anchor>
        // link, an <@user> mention, or an <!channel>/<!here> broadcast. A bare
        // URL in the header still auto-links (Slack does that itself); that's
        // accepted -- it's the local user's own words under their own token.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        if (!slackToken)
          return new Response('slack not configured', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const { mrUrls, header, channel } = (body ?? {}) as {
          mrUrls?: unknown;
          header?: unknown;
          channel?: unknown;
        };
        if (
          !Array.isArray(mrUrls) ||
          mrUrls.length === 0 ||
          !mrUrls.every(u => typeof u === 'string')
        ) {
          return new Response('expected { mrUrls: string[] }', { status: 400 });
        }
        const headerOverride =
          header === undefined ? null : sanitizeHeader(header);
        if (header !== undefined && headerOverride === null) {
          return new Response(
            `"header" must be a non-empty string of at most ${MAX_HEADER_LEN} characters`,
            { status: 400 }
          );
        }
        const allowedChannels = configuredSlackChannels(config);
        if (
          channel !== undefined &&
          (typeof channel !== 'string' || !allowedChannels.includes(channel))
        ) {
          return new Response(
            `"channel" must be one of ${allowedChannels.join(', ')}`,
            { status: 400 }
          );
        }
        const snapshot = await cache.get();
        const byUrl = new Map(snapshot.mrs.map(m => [m.webUrl, m] as const));
        const picked = (mrUrls as string[])
          .map(u => byUrl.get(u))
          .filter((m): m is BoardMR => !!m);
        if (picked.length !== mrUrls.length) {
          return new Response('one or more mrUrls are not on the board', {
            status: 400,
          });
        }
        // An explicit body channel (already validated above) always wins.
        // Otherwise derive per-MR: resolve/sweeper look in the tab's channel
        // via channelForMR, so a post with no explicit channel must land
        // there too, or the ref would pin the wrong channelId. A multi-MR
        // post only has one channel to post to, so every picked MR must
        // resolve to the same one.
        let targetChannel: string;
        if (typeof channel === 'string') {
          targetChannel = channel;
        } else {
          const resolved = new Set(picked.map(m => channelForMR(config, m)));
          if (resolved.size > 1) {
            return new Response('MRs span Slack channels; post them per tab', {
              status: 400,
            });
          }
          targetChannel = [...resolved][0]!;
        }
        // Guard against duplicate posts: check for an existing ref file first,
        // and for MRs we've never resolved, sync the channel index and look for
        // the author's original review-request. If any MR already has a
        // message, don't post — cache the found ref (single) or 409 (multi).
        const existingRefs = readSlackRefs();
        const toResolve = picked.filter(
          m => existingRefs.get(m.webUrl!)?.status !== 'found'
        );
        const freshlyFound: Array<{ iid: number; permalink?: string }> = [];
        try {
          for (const m of toResolve) {
            const ref = await resolveSlackRef(
              slackToken,
              targetChannel,
              m.webUrl!,
              m.iid
            );
            if (ref.status === 'found')
              freshlyFound.push({ iid: m.iid, permalink: ref.permalink });
          }
        } catch (err) {
          return new Response(
            `slack resolve failed: ${err instanceof Error ? err.message : err}`,
            { status: 502 }
          );
        }
        const previouslyFound = picked.filter(
          m => existingRefs.get(m.webUrl!)?.status === 'found'
        );
        const alreadyIids = [
          ...previouslyFound.map(m => m.iid),
          ...freshlyFound.map(f => f.iid),
        ];
        if (alreadyIids.length) {
          if (picked.length === 1) {
            // Single-MR post: seamlessly link to the existing message instead of
            // posting a duplicate. The ref was just written by resolveSlackRef.
            const permalink =
              freshlyFound[0]?.permalink ??
              existingRefs.get(picked[0]!.webUrl!)?.permalink;
            return new Response(
              JSON.stringify({ ok: true, linked: true, permalink }),
              {
                headers: { 'content-type': 'application/json' },
              }
            );
          }
          return new Response(
            `already in slack: ${alreadyIids.map(i => `!${i}`).join(', ')}`,
            { status: 409 }
          );
        }
        const facts: MrFacts[] = picked.map(m => ({
          iid: m.iid,
          title: m.title,
          url: m.webUrl ?? '',
          ticket: m.title.match(/([A-Z]+-\d+)/)?.[1] ?? '',
          author: m.author.username,
          sourceBranch: m.sourceBranch,
          targetBranch: m.targetBranch,
        }));
        // A supplied header forces the multi rendering even for one MR — the
        // single template has no header line to put it on. See renderPost.
        const text = renderPost(
          {
            single: config.slack.singleTemplate,
            multiHeader: config.slack.multiHeader,
            multiItem: config.slack.multiItem,
          },
          facts,
          headerOverride
        );
        try {
          const refs = await postToSlack(
            slackToken,
            targetChannel,
            text,
            picked.map(m => ({ webUrl: m.webUrl!, iid: m.iid }))
          );
          return new Response(
            JSON.stringify({
              ok: true,
              posted: refs.length,
              permalink: refs[0]?.permalink,
            }),
            {
              headers: { 'content-type': 'application/json' },
            }
          );
        } catch (err) {
          return new Response(
            `slack post failed: ${err instanceof Error ? err.message : err}`,
            { status: 502 }
          );
        }
      }
      case '/slack/react': {
        // Add or remove a review-signal reaction (eyes/speech_balloon/white_check_mark)
        // on the MR's cached review-request message. `remove: true` unreacts.
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        if (!isLocalRequest(req))
          return new Response('forbidden', { status: 403 });
        {
          const notJson = requireJsonBody(req);
          if (notJson) return notJson;
        }
        if (!slackToken)
          return new Response('slack not configured', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid json', { status: 400 });
        }
        const { mrUrl, emoji, remove } = (body ?? {}) as {
          mrUrl?: unknown;
          emoji?: unknown;
          remove?: unknown;
        };
        const allowed = Object.values(config.slack.emoji);
        if (
          typeof mrUrl !== 'string' ||
          typeof emoji !== 'string' ||
          !allowed.includes(emoji)
        ) {
          return new Response(
            `expected { mrUrl: string, emoji: one of ${allowed.join('|')}, remove?: boolean }`,
            { status: 400 }
          );
        }
        try {
          const ref =
            remove === true
              ? await unreactFromMR(slackToken, mrUrl, emoji)
              : await reactToMR(slackToken, mrUrl, emoji);
          return new Response(
            JSON.stringify({ ok: true, reactions: ref.reactions ?? [] }),
            {
              headers: { 'content-type': 'application/json' },
            }
          );
        } catch (err) {
          return new Response(
            `slack react failed: ${err instanceof Error ? err.message : err}`,
            { status: 502 }
          );
        }
      }
      default:
        return new Response('not found', { status: 404 });
    }
  },
});

console.log(`the board serving on http://localhost:${port}`);

// Warm the cache at startup so the first visitor after a (re)start gets a
// ready snapshot instead of waiting on the cold fetch.
void cache.get().catch(() => {});

/**
 * Background sweep: resolve Slack refs for every MR on the board that doesn't
 * have one yet, and retry `notfound` refs older than one sweep interval (an MR
 * posted just now won't be in the index until the next sync). `force` retries
 * every `notfound` ref regardless of age; the posted-to-slack filter's
 * on-demand refresh uses it. Sweeps are serialized: one requested mid-sweep
 * runs after the current one, never alongside it.
 */
let sweepChain: Promise<unknown> = Promise.resolve();
let autoResolveTimer: ReturnType<typeof setTimeout> | undefined;

async function sweepOnce(
  force: boolean
): Promise<{ resolved: number; failed: number }> {
  const slackToken = await getSlackToken();
  if (!slackToken) return { resolved: 0, failed: 0 };
  const snapshot = await cache.get().catch(() => null);
  if (!snapshot) return { resolved: 0, failed: 0 };
  const retryAfter =
    Date.now() - config.slack.autoResolveIntervalMinutes * 60_000;
  const targets = slackSweepTargets(snapshot.mrs, readSlackRefs(), {
    retryAfter,
    force,
  });
  const result = await sweepSlackRefs(
    slackToken,
    targets.map(mr => ({
      mrUrl: mr.webUrl!,
      iid: mr.iid,
      channel: channelForMR(config, mr),
    }))
  );
  for (const e of result.errors) console.error(`auto-resolve ${e}`);
  return { resolved: result.resolved, failed: result.failed };
}

function runSlackSweep(
  force = false
): Promise<{ resolved: number; failed: number }> {
  const run = () => sweepOnce(force);
  const result = sweepChain.then(run, run);
  sweepChain = result.catch(() => {});
  return result;
}

async function scheduleAutoResolve(): Promise<void> {
  const mins = config.slack.autoResolveIntervalMinutes;
  if (mins <= 0) {
    clearTimeout(autoResolveTimer);
    return;
  }
  const slackToken = await getSlackToken();
  // Cleared here, after this function's only await, not before it -- two
  // overlapping calls (e.g. boot racing a config reload) both suspend on the
  // same memoized getSlackToken() and resume in call order, so the second
  // one's clear reliably cancels whatever the first one just armed, instead
  // of both arming independently and orphaning a timer forever.
  clearTimeout(autoResolveTimer);
  if (!slackToken) return;
  const tick = () => {
    void runSlackSweep().catch(err =>
      console.error(
        `auto-resolve sweep failed: ${err instanceof Error ? err.message : err}`
      )
    );
    autoResolveTimer = setTimeout(tick, mins * 60_000);
  };
  // Kick a first sweep shortly after startup so the board fills in without a wait.
  autoResolveTimer = setTimeout(tick, 5_000);
}

void scheduleAutoResolve();

// ── rt relay → board push ────────────────────────────────────────────────
// An rt broadcast about a mapped repo means the store changed: refetch the
// snapshot (a socket read — the daemon already did the API work) and nudge
// every connected browser to re-pull /data.json. Coalesced so an event
// burst (one push = MR + pipeline + discussions frames) refreshes once.
const RELAY_TYPES = new Set([
  'project-mrs',
  'discussions:update',
  'discussions:new-comments',
]);
const RELAY_COALESCE_MS = 750;
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseEncoder = new TextEncoder();

const SSE_HEARTBEAT_MS = 25_000;

function sseSend(frame: Uint8Array): void {
  for (const client of sseClients) {
    try {
      client.enqueue(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

function sseNudge(): void {
  sseSend(sseEncoder.encode('data: changed\n\n'));
}

// Comment frames keep quiet connections under Bun's idleTimeout and prune
// clients that vanished without a cancel. EventSource ignores comment lines.
setInterval(() => sseSend(sseEncoder.encode(': ping\n\n')), SSE_HEARTBEAT_MS);

// ── Gate sweep: park unanswered gates, reconcile missed closes ────────────
const GATE_SWEEP_MS = 60_000;

// No wired escalation notifier fits a gate-park signal (notifyEscalation is
// triage/doctor-scoped and unused elsewhere); the console lines below are the
// courtesy notify -- the facility's own `gate/parked` event, relayed back
// through ingestRelayFrame, is what actually patches the cache and nudges
// SSE clients. Built fresh per sweep (not module-level) so a reassigned
// `config` -- e.g. after a switchboard-url save -- is picked up immediately.
function sweepActionIo(): ExecuteSweepActionIo {
  return {
    gatePark,
    closeTab,
    review: { writeState: writeReviewState, filePath: reviewFilePath },
    respond: { writeState: writeRespondState, filePath: respondFilePath },
    doctor: { writeState: writeDoctorState, filePath: doctorFilePath },
    now: () => Date.now(),
    graceMinutes: config.gateGraceMinutes,
    log: message => console.log(message),
    logError: message => console.error(message),
  };
}

// One KindResumeIo per resumable gate kind, built fresh per sweep/resume
// call (not module-level) since `config` can be reassigned (switchboard-url
// save) after boot -- same reasoning as sweepActionIo.
function reviewResumeIo(): KindResumeIo {
  return {
    readState: mrUrl => readReviewStates().get(mrUrl),
    writeState: (path, patch) =>
      writeReviewState(
        path,
        patch as Partial<ReviewState> & { status: ReviewStatus }
      ),
    filePath: reviewFilePath,
    resolveSkill: (mrUrl, tabId) =>
      reviewSkillForTab(config, tabId, mrUrl, resolveLaunchSkill),
    prompt: (mrUrl, statePath, skill, resumedGate, resolvePath) =>
      dispatchPrompt(
        'board:review',
        {
          mrUrl,
          statePath,
          statusBin: statusBinPath(),
          reportPath: reviewReportPath(statePath),
          skill,
          resumedGate,
        },
        resolvePath
      ),
    resumedStatus: 'reviewing',
    workspaceLabel: config.reviewsWorkspace,
  };
}

function respondResumeIo(): KindResumeIo {
  return {
    readState: mrUrl => readRespondStates().get(mrUrl),
    writeState: (path, patch) =>
      writeRespondState(
        path,
        patch as Partial<RespondState> & { status: RespondStatus }
      ),
    filePath: respondFilePath,
    resolveSkill: mrUrl => resolveLaunchSkill('respond', mrUrl),
    prompt: (mrUrl, statePath, skill, resumedGate, resolvePath) =>
      dispatchPrompt(
        'board:respond',
        {
          mrUrl,
          statePath,
          statusBin: statusBinPath(),
          reportPath: respondReportPath(statePath),
          skill,
          resumedGate,
        },
        resolvePath
      ),
    resumedStatus: 'implementing',
    workspaceLabel: config.respondsWorkspace,
  };
}

function doctorResumeIo(): KindResumeIo {
  return {
    readState: mrUrl => readDoctorStates().get(mrUrl),
    writeState: (path, patch) =>
      writeDoctorState(
        path,
        patch as Partial<DoctorState> & { status: DoctorStatus }
      ),
    filePath: doctorFilePath,
    resolveSkill: mrUrl => resolveLaunchSkill('doctor', mrUrl),
    prompt: (mrUrl, statePath, skill, resumedGate, resolvePath) =>
      dispatchPrompt(
        'board:doctor',
        {
          mrUrl,
          statePath,
          statusBin: statusBinPath(),
          skill,
          resumedGate,
          ...doctorResumeDispatchFields(readDoctorStates().get(mrUrl)),
        },
        resolvePath
      ),
    resumedStatus: 'fixing',
    workspaceLabel: config.doctorsWorkspace,
  };
}

function gateResumeIo(): GateResumeEventIo {
  // respond-plan and respond-post share one wrapper (board:respond) and one
  // state file -- the same KindResumeIo record answers for both kinds.
  const respond = respondResumeIo();
  return {
    resumers: buildResumers({
      review: reviewResumeIo(),
      respond,
      doctor: doctorResumeIo(),
    }),
    rowsForSubject: subject => gateCache.rowsFor(subject),
    applyRow: row => gateCache.applyRow(row),
    gateList,
    resumeAgentPane,
    notify: message => console.error(`gate resume: ${message}`),
  };
}

/** What one lifecycle transition means to this board. Fed only by the
    agent-status feed, in journal order; a replayed `done` is safe because
    every step here is idempotent (a latch is posted only when none is armed,
    a repeated Slack reaction is a no-op) and the one step that is not, the
    tab close, is guarded on `emittedAt`. */
async function handleAgentSignal(
  signal: AgentSignal,
  emittedAt: number
): Promise<void> {
  // Off the memoized getters, as the request handler resolves them: nothing
  // here rides a request, so neither token is already in scope.
  const [gitlabToken, slackToken] = await Promise.all([
    getGitlabToken(),
    getSlackToken(),
  ]);
  // Peer sync: tell the MR author's board where this review stands. Runs
  // before the emoji early-return below, so transitions that map to no
  // emoji still sync. Own policy (slack reactions) continues after; this
  // is pure relay traffic.
  // `defaultMember: "all"` is a view setting, not an identity, so there is
  // no way to tell this board's own MRs from a peer's. Without that, the
  // own-MR guard below can never match and the board would relay a
  // review-state for every MR on it, including publishing to itself.
  const pc = peering.current()?.client;
  if (pc && signal.kind === 'review' && config.defaultMember !== 'all') {
    const snapshotForPeer = await cache.get();
    const authorUsername = snapshotForPeer.mrs.find(
      m => m.webUrl === signal.mrUrl
    )?.author.username;
    // Never relay a review of this board's own MR: the author is right
    // here, and the peer state files are for other people's boards.
    if (
      authorUsername &&
      canonicalUsername(authorUsername) !==
        canonicalUsername(config.defaultMember)
    ) {
      enqueueOutbox(
        makeEnvelope(authorUsername, 'review-state', {
          mrUrl: signal.mrUrl,
          iid: signal.iid,
          status: signal.status,
          outcome: signal.outcome,
          updatedAt: emittedAt,
        } satisfies ReviewStatePayload)
      );
      kickOutbox(pc);
    }
  }
  // Arm a latch when a review lands with a comment outcome, spend it when
  // one lands approved. Best-effort, like every other side effect here:
  // the triage latch pass reconciles anything a down or throwing board
  // misses, so a failure must never fail the agent's status write.
  if (signal.kind === 'review' && signal.status === 'done' && gitlabToken) {
    try {
      const snapshot = await cache.get();
      const mr = snapshot.mrs.find(m => m.webUrl === signal.mrUrl);
      if (mr) {
        const projectId = parseRepoId(mr.repositoryId);
        const projectPath =
          projectPathFromWebUrl(signal.mrUrl, config.gitlabHost) ?? '';
        const gw = latchGateway(config.gitlabHost, gitlabToken);
        // Arming honours board.reReview; spending never does, since a
        // latch left armed on a team that switched re-review off is a
        // promise nothing keeps.
        if (signal.outcome === 'comment' && loadReReviewConfig().enabled) {
          const detail = await readLatchDetail(mr);
          // A live latch (armed, either resolved or not) already exists
          // for this MR -- a spent one must never suppress a fresh post,
          // or the feature disables itself forever the first time a
          // latch is ever spent.
          if (detail && !hasArmedLatch(findLatches(detail))) {
            await postLatch(gw, projectId, projectPath, signal.mrUrl, mr.iid);
          }
        } else if (signal.outcome === 'approve') {
          const detail = await readLatchDetail(mr);
          // Every latch found, not just the canonical one: an armed
          // duplicate left behind here is unreachable to the triage
          // pass's repair step once the canon it stops at is spent.
          if (detail)
            await spendAllLatches(
              gw,
              projectId,
              projectPath,
              mr.iid,
              findLatches(detail)
            );
        }
      }
    } catch (err) {
      console.error(
        `latch step failed for ${signal.mrUrl}: ${err instanceof Error ? err.message : err}`
      );
    }
  }
  // Close the launched pane's tab once its agent reports done -- error
  // never closes, so a failing pane stays open for forensics. Must run
  // above the emoji early-return below: most `done` signals have no
  // emoji and would never reach a close placed after it.
  // The status CLI writes the state file before it emits, so a live signal
  // always has updatedAt <= emittedAt. A newer write means a later transition
  // or launch superseded this event: the tab on file is not this event's to
  // close, nor its status this event's to overwrite with `done`.
  const stateUpdatedAt = resolveSignalUpdatedAt(signal);
  if (!(stateUpdatedAt !== undefined && stateUpdatedAt > emittedAt)) {
    closeOnDone(
      signal,
      resolveSignalTabId,
      tabId => closeTab(tabId),
      clearSignalTabId
    );
  }
  const emoji = signalEmoji(
    signal.kind,
    signal.status,
    config.slack.emoji,
    signal.outcome
  );
  // Most transitions map to no emoji at all (see signalEmoji), and a
  // Slack-less install has nothing to react with.
  if (!emoji || !slackToken) return;
  // The sweeper usually resolves the ref first, but a review launched and
  // finished inside one sweep interval can beat it here.
  try {
    const signalSnapshot = await cache.get();
    const signalMr = signalSnapshot.mrs.find(m => m.webUrl === signal.mrUrl);
    const signalChannel = signalMr
      ? channelForMR(config, signalMr)
      : config.slack.channel;
    const existing = readSlackRefs().get(signal.mrUrl);
    if (existing?.status !== 'found' || !existing.messageTs) {
      await resolveSlackRef(
        slackToken,
        signalChannel,
        signal.mrUrl,
        signal.iid
      );
    }
    await reactToMR(slackToken, signal.mrUrl, emoji);
  } catch (err) {
    console.error(
      `slack react failed for ${signal.mrUrl}: ${err instanceof Error ? err.message : err}`
    );
  }
}

const AGENT_STATUS_CURSOR_PATH = join(APP_ROOT, 'state', 'agent-status-cursor');

const agentStatusFeed = new AgentStatusFeed({
  eventsHead: () => eventsHead(),
  eventsList: (after, limit) =>
    eventsList({ pattern: AGENT_STATUS_PATTERN, after, limit }),
  readCursor: () => readCursorFile(AGENT_STATUS_CURSOR_PATH),
  writeCursor: cursor => writeCursorFile(AGENT_STATUS_CURSOR_PATH, cursor),
  handle: handleAgentSignal,
  appRoot: APP_ROOT,
  log: line => console.error(line),
});

function wakeAgentStatusFeed(): void {
  void agentStatusFeed
    .catchUp()
    .catch(err =>
      console.error(
        `agent-status feed failed: ${err instanceof Error ? err.message : err}`
      )
    );
}

// Reported once per gate id, not once per sweep pass -- an unrecognized kind
// stays retained (answered/closed included) until restart, and the sweep
// re-runs every GATE_SWEEP_MS forever.
const warnedUnknownGateIds = new Set<string>();

async function runGateSweep(): Promise<void> {
  const states = {
    reviews: readReviewStates(),
    responds: readRespondStates(),
    doctors: readDoctorStates(),
  };
  const actions = planSweep(
    gateCache.rows(),
    states,
    Date.now(),
    config.gateGraceMinutes * 60_000,
    row =>
      console.error(
        `gate sweep: unknown gate kind "${row.kind}" on ${row.subject}; skipping`
      ),
    warnedUnknownGateIds
  );
  const io = sweepActionIo();
  for (const action of actions) {
    await executeSweepAction(action, io);
  }
}

if (!FIXTURE_DIR) {
  setInterval(() => {
    void runGateSweep().catch(err =>
      console.error(
        `gate sweep failed: ${err instanceof Error ? err.message : err}`
      )
    );
    wakeAgentStatusFeed();
  }, GATE_SWEEP_MS);
}

// One-time migration: the board's own per-MR gate files (state/gates/) are
// retired now that the board-row read is fully daemon-backed (GateCache).
// Best-effort and silent on an already-clean install -- force skips the
// not-found case rather than checking existence first.
if (!FIXTURE_DIR) {
  try {
    rmSync(GATE_DIR, { recursive: true, force: true });
  } catch (err) {
    console.error(
      `gate file-store cleanup skipped: ${err instanceof Error ? err.message : err}`
    );
  }
}

// One-time migration: state/board-port retired with the HTTP notify path, and
// a stale copy misleads anyone reading the state dir into thinking the board
// still answers on that port.
if (!FIXTURE_DIR) {
  try {
    rmSync(join(APP_ROOT, 'state', 'board-port'), { force: true });
  } catch (err) {
    console.error(
      `board-port cleanup skipped: ${err instanceof Error ? err.message : err}`
    );
  }
}

// One-shot migration: review/respond states that predate rt agent adoption
// still carry a bare Claude sessionId with no agentId on file, so a resume
// would fall back to the dead `claude --resume` path instead of the
// facility's agent-pane resume. Best-effort and silent on a clean install.
if (!FIXTURE_DIR) {
  try {
    migrateLegacySessions(
      'review',
      readReviewStates(),
      reviewFilePath,
      writeReviewState,
      m => console.log(m)
    );
    migrateLegacySessions(
      'respond',
      readRespondStates(),
      respondFilePath,
      writeRespondState,
      m => console.log(m)
    );
  } catch (err) {
    console.error(
      `legacy session migration skipped: ${err instanceof Error ? err.message : err}`
    );
  }
}

let relayTimer: ReturnType<typeof setTimeout> | undefined;
const stopRelay = FIXTURE_DIR
  ? () => {}
  : subscribe((type, data) => {
      if (type === 'event') {
        const frame = data as { topic?: unknown; payload?: unknown } | null;
        if (typeof frame?.topic === 'string') {
          const gateFrame = {
            topic: frame.topic,
            payload: frame.payload,
          } satisfies GateEventFrame;
          ingestRelayFrame(gateCache, gateFrame, sseNudge);
          // Resume hangs off the event itself (not the board's own answer
          // endpoint) so a gate answered from any surface -- console, in-pane,
          // this board -- resumes the parked session the same way.
          if (frame.topic.startsWith('gate/answered/')) {
            void handleAnsweredEvent(gateFrame, gateResumeIo()).catch(err =>
              console.error(
                `gate answered resume failed: ${err instanceof Error ? err.message : err}`
              )
            );
          }
          // The push is a wake-up, never the delivery: the journal is read
          // from the cursor so a frame that raced a reconnect is not lost.
          if (isAgentStatusTopic(frame.topic)) wakeAgentStatusFeed();
        }
      }
      if (!RELAY_TYPES.has(type)) return;
      const repoName = (data as { repoName?: string } | null)?.repoName;
      // Relay events are keyed by the serialized identity now — compare
      // like-for-like. Recomputed per event (not cached): config hot-reloads on
      // config.json edits, so a cached Set could serve a stale allowlist.
      const trackedIds = new Set(
        Object.values(config.rtRepos)
          .map(repoIdentityField)
          .filter((id): id is string => id !== null)
      );
      if (!repoName || !trackedIds.has(repoName)) return;
      clearTimeout(relayTimer);
      relayTimer = setTimeout(() => {
        void cache
          .refreshNow()
          .then(sseNudge)
          .catch(() => {});
      }, RELAY_COALESCE_MS);
    });

if (!FIXTURE_DIR) {
  void reconcileGatesOnBoot(gateList, gateCache).catch(err =>
    console.error(
      `gate boot reconcile failed: ${err instanceof Error ? err.message : err}`
    )
  );
  // Independent of the cache reconcile above (reads the facility directly),
  // so it needs no ordering relative to it: catches an answered-parked gate
  // the board missed the live event for while it was down.
  void bootResumePass(gateResumeIo()).catch(err =>
    console.error(
      `gate boot resume pass failed: ${err instanceof Error ? err.message : err}`
    )
  );
  // Replays every transition emitted while the board was down. A board with
  // no cursor yet starts at the journal head instead and replays nothing.
  wakeAgentStatusFeed();
}

// Bridge-rule registration: upsert this board's gate-opened rule into
// `rt.notify.eventBridges` (merge-not-clobber -- see ensureEventBridgeRule),
// so a gate/opened/* event raises a desktop notification, with a click-through
// url, once the rt daemon side has registered that key. `deckAppUrl` awaits a
// local `/api/v1/status` round trip, so the whole reconcile runs async and is
// caught so a stale rt-client copy without the key yet (or any other
// read/write/lookup failure) never blocks boot -- just skip and log once.
function readEventBridges(): EventBridgeRule[] {
  return getSetting<EventBridgeRule[]>('rt.notify.eventBridges').value ?? [];
}
function writeEventBridges(next: EventBridgeRule[]): void {
  setSetting('rt.notify.eventBridges', next, 'user');
}
if (!FIXTURE_DIR) {
  void (async () => {
    try {
      const boardUrl = await deckAppUrl('board', `http://localhost:${port}`);
      ensureEventBridgeRule(
        readEventBridges,
        writeEventBridges,
        boardBridgeRule(boardUrl),
        { replacePatterns: ['board/gate/opened/*'] }
      );
    } catch (err) {
      console.error(
        `gate bridge-rule reconcile skipped: ${err instanceof Error ? err.message : err}`
      );
    }
  })();
}

// Hot-reload config.json so adding/removing members (or any setting) takes
// effect without a restart. Watch the directory — that survives editors that
// save atomically by swapping the file — and filter to our file. A mid-edit
// invalid file is ignored, keeping the last good config. A store-backed
// setting (rt settings set, or anything outside the /api/settings/ mount
// above) still needs a restart to be picked up here -- only a write through
// this process's own API refreshes live.
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
function reloadConfig(reason: string): void {
  try {
    Object.assign(config, loadConfig());
    namesFetchedAt = 0; // re-resolve display names, including new members
    // Stale, not dropped: checking a member in/out lands here (the board
    // writes config.json itself), and dropping the snapshot would stall every
    // reader for a full team refetch. Serve the old board until this lands.
    cache.markStale();
    void refreshMemberNames();
    void cache.get().catch(() => {});
    void scheduleAutoResolve();
    console.log(`${reason} — reloaded members/settings (no restart needed)`);
  } catch (err) {
    console.error(
      `config reload skipped (invalid): ${err instanceof Error ? err.message : err}`
    );
  }
}

if (!FIXTURE_DIR)
  watch(dirname(CONFIG_PATH), (_event, filename) => {
    if (filename && filename !== basename(CONFIG_PATH)) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => reloadConfig('config.json changed'), 150);
  });

// Graceful shutdown: Sparkle replaces the whole bundle on update (this
// process's inode vanishes mid-run) and launchd sends SIGTERM before its
// grace period expires either way. All board state writes are already
// synchronous (writeFileSync), so nothing here is flushing buffered data --
// the point is closing the two long-lived connections cleanly instead of
// leaking them past process exit: SSE clients so a browser's EventSource
// reconnects immediately rather than waiting out a TCP timeout, and the
// rt-relay websocket so it doesn't attempt to reconnect into a process that
// is already gone. server.stop() stops accepting new connections and lets
// in-flight requests finish before this handler's own return.
let shuttingDown = false;
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const client of sseClients) {
    try {
      client.close();
    } catch {
      /* already closed */
    }
  }
  sseClients.clear();
  stopRelay();
  httpServer.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
