import type { BunPlugin } from "bun";
import { join, dirname, basename } from "path";
import { readFileSync, writeFileSync, mkdirSync, watch } from "fs";
import type { PullRequest, MRDetail } from "@mattstack/glance";
import { loadConfig, loadGitLabToken, loadSlackToken, loadSwitchboardToken, loadSwitchboardAdminToken, saveMemberHidden, saveSwitchboardUrl, parseConfig, CONFIG_PATH } from "./config.ts";
import { memoizeAsync } from "./memoize-async.ts";
import { resolveBoardSkill, type BoardSkillKind } from "./manifest-bindings.ts";
import { upsertEnvKeys } from "./env-file.ts";
import { aggregateSyncScope, boardDemand, buildBoard, buildRoster, projectPathFromWebUrl, type BoardMR, type SyncScopeRead } from "./data.ts";
import { GitLabProvider, ReadBackFailedError, NoteMutator, parseRepoId } from "@mattstack/glance";
import { summarizeDiscussions, threadStatusCounts, unresolvedReviewerCount } from "./discussions.ts";
import { readProjectMRs, readDiscussions, subscribe } from "@mattstack/rt-client";
import { SnapshotCache } from "./cache.ts";
import { isLocalRequest } from "./local.ts";
import { readReviewStates, pruneReviewStates, reviewFilePath, writeReviewState, parseReviewRequestBody, attachReviews, readReviewReport } from "./review-state.ts";
import { readRespondStates, pruneRespondStates, respondFilePath, writeRespondState, parseRespondRequestBody, attachResponds } from "./respond-state.ts";
import { readDoctorStates, pruneDoctorStates, doctorFilePath, writeDoctorState, parseDoctorRequestBody, attachDoctors } from "./doctor-state.ts";
import { readDrafts, heldDraftsByMr, attachDrafts, pruneDrafts, draftFilePath, writeDraft } from "./draft-state.ts";
import { launchReview, launchRespond, launchDoctor, launchResume, focusTab, operatorNoteParagraph, parseLaunchNote } from "./herdr.ts";
import { launchReReview } from "./review-launch.ts";
import { readSlackRefs, attachSlack, resolveSlackRef, reactToMR, unreactFromMR, postToSlack } from "./slack.ts";
import { signalEmoji, parseAgentSignal } from "./agent-signal.ts";
import { makeSwitchboardClient, type SwitchboardClient } from "./peer/client.ts";
import { type MaterializeDeps } from "./peer/inbox.ts";
import { makePeering } from "./peer/runtime.ts";
import { createInvite, joinSwitchboard, listPeerBoards } from "./peer/onboard.ts";
import { enqueueOutbox, drainOutbox, classifySend } from "./peer/outbox.ts";
import { makeEnvelope, canonicalUsername, type ReviewStatePayload, type ReReviewRequestPayload } from "./peer/envelope.ts";
import { writePeerReview, readPeerReviews, prunePeerReviews, attachPeerReviews, type PeerReviewState } from "./peer/peer-reviews.ts";
import {
  writeNudge, readNudges, pruneNudges,
  writeSentNudge, readSentNudges, resolveSentNudge, retireSentNudge, pruneSentNudges, sentNudgeDisplay,
  type SentNudgeDisplay,
} from "./peer/nudges.ts";
import { renderPost, sanitizeHeader, MAX_HEADER_LEN, type MrFacts } from "./template.ts";

/** Capture-harness mode: boot from a committed fixture dir instead of live
    config, serve canned endpoint responses, hold no tokens, start no relay.
    The seed of the permanent screenshot harness (see tests/capture.ts). */
const FIXTURE_DIR = process.env.BOARD_FIXTURE || null;
const fixtureFile = (name: string) => join(FIXTURE_DIR!, name);

const cssPath = join(import.meta.dir, "style.css");
let css = readFileSync(cssPath, "utf-8");
const faviconPath = join(import.meta.dir, "favicon.svg");
const favicon = readFileSync(faviconPath, "utf-8");
/** The board's own .env, written when /peer/join redeems an invite. */
const ENV_PATH = join(import.meta.dir, "..", ".env");

// `let`: /peer/join reassigns the whole config after persisting switchboard.url.
let config = FIXTURE_DIR
  ? parseConfig(readFileSync(fixtureFile("config.json"), "utf8"))
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
const getGitlabToken = memoizeAsync<string | null>(() => (FIXTURE_DIR ? Promise.resolve(null) : loadGitLabToken()), isTokenFailure);
// Optional: enables the Slack review-thread menu actions when a token is set.
const getSlackToken = memoizeAsync<string | null>(() => (FIXTURE_DIR ? Promise.resolve(null) : loadSlackToken()), isTokenFailure);
// Optional peer relay token -- see the peering-start block below.
const getSwitchboardToken = memoizeAsync<string | null>(() => (FIXTURE_DIR ? Promise.resolve(null) : loadSwitchboardToken()), isTokenFailure);
// Operator-only secret: its presence is what turns on this board's invite
// affordances. Absent, /peer/invite and /peer/boards answer 400 and the UI
// never offers them.
const getSwitchboardAdminToken = memoizeAsync<string | null>(() => (FIXTURE_DIR ? Promise.resolve(null) : loadSwitchboardAdminToken()), isTokenFailure);

/** Writes go straight to GitLab through glance; reads come from the rt daemon
    (see readProjectMRs). Built on demand so a tokenless install still boots --
    every caller has already refused the request when the token is missing. */
let gitlabProvider: GitLabProvider | undefined;
async function gitlab(): Promise<GitLabProvider> {
  const token = await getGitlabToken();
  if (!token) throw new Error("gitlab token not configured");
  gitlabProvider ??= new GitLabProvider(config.gitlabHost, token);
  return gitlabProvider;
}

// Optional peer relay. Both a configured url and a token are required; without
// either, peering stays unstarted and every peer feature (publish, poll,
// /nudge) is off, leaving the board exactly as it was. The runtime is startable
// later at runtime too, so joining a switchboard needs no restart.
const peerDeps: Omit<MaterializeDeps, "reportAuth"> = {
  writePeerReview,
  writeNudge,
  resolveSentNudge,
  retireSentNudge,
  log: (line) => console.error(line),
};
const peering = makePeering({ makeClient: makeSwitchboardClient, deps: peerDeps });
// Fire-and-forget: the daemon round trip must not hold up Bun.serve below.
void (async () => {
  const token = await getSwitchboardToken();
  if (config.switchboard.url && token) peering.start(config.switchboard.url, token);
})();

/** Send what's queued without making the caller wait on the relay. Anything
    still queued goes out on the next tick, so a failure here only costs
    latency -- it's logged, never thrown, since nothing awaits this. */
function kickOutbox(client: SwitchboardClient): void {
  void drainOutbox((d) => client.publish(d)).catch((err) => {
    console.error(`peer: outbox drain failed: ${err instanceof Error ? err.message : err}`);
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
function attachPeerState<T extends { webUrl?: string | null }>(mrs: T[], now: number = Date.now()): Array<T & PeerAttachments> {
  const sent = readSentNudges();
  const inbound = new Map<string, Array<{ from: string; receivedAt: number }>>();
  for (const n of readNudges()) {
    // Handled nudges stay on disk for the outcome trail; only the ones still
    // awaiting a decision belong on the board.
    if (n.handled) continue;
    const entry = { from: n.from, receivedAt: n.receivedAt };
    const list = inbound.get(n.mrUrl);
    if (list) list.push(entry);
    else inbound.set(n.mrUrl, [entry]);
  }
  return attachPeerReviews(mrs, readPeerReviews()).map((mr) => {
    if (!mr.webUrl) return mr;
    const s = sent.get(mr.webUrl);
    const nudges = inbound.get(mr.webUrl);
    if (!s && !nudges) return mr;
    return {
      ...mr,
      ...(s ? { sentNudge: { display: sentNudgeDisplay(s, now), reviewer: s.reviewer, reason: s.resolution?.reason } } : {}),
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
    every project read, for the caller to fold into the snapshot. */
interface TeamMRsResult {
  prs: PullRequest[];
  dataSyncedAt: number | null;
  scopeUncovered: string[];
  scopeWindowDays: number | null;
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
  const errors: string[] = [];
  const reads: SyncScopeRead[] = [];
  const demand = boardDemand(config, port);
  for (const projectPath of config.projects) {
    const repoName = config.rtRepos[projectPath];
    if (!repoName) {
      errors.push(`${projectPath}: no rtRepos mapping in config.json`);
      continue;
    }
    const res = await readProjectMRs(repoName, force ? 0 : undefined, {}, demand);
    if (!res.ok || !res.data) {
      errors.push(`${projectPath}: ${res.error ?? "empty daemon response"}`);
      continue;
    }
    reads.push({ syncedAt: res.data.syncedAt, scope: res.data.scope });
    for (const entry of Object.values(res.data.mrs)) {
      if (entry.pr.state === "opened") byId.set(entry.pr.id, entry.pr);
    }
  }
  if (errors.length) throw new Error(errors.join(" · "));
  return { prs: [...byId.values()], ...aggregateSyncScope(reads) };
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
    : { skill: kind === "doctor" ? config.doctorSkill : "", source: "config" as const };
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
      chunk.map(async (m) => {
        try {
          if (!m.rtRepo) return;
          const res = await readDiscussions(m.rtRepo, m.iid);
          if (!res.ok || !res.data) return; // keep the coarse fallback
          const detail = { discussions: res.data.discussions } as MRDetail;
          const { threads, comments } = summarizeDiscussions(detail, m.author.username, config.botUsernames);
          m.reviewerComments = unresolvedReviewerCount(threads);
          m.threadSummary = threadStatusCounts(threads);
          m.generalComments = comments.length;
        } catch {
          // Keep the coarse fallback (unresolvedThreads) for this MR.
        }
      }),
    );
  }
}

let forceNextFetch = false;
const cache = new SnapshotCache(async () => {
  // Consume the flag up front: a failed forced fetch must not leave force
  // latched for the background refreshes that follow.
  const force = forceNextFetch;
  forceNextFetch = false;
  const { prs, dataSyncedAt, scopeUncovered, scopeWindowDays } = await fetchTeamMRs(force);
  const mrs = buildBoard(prs, config);
  await enrichReviewerComments(mrs);
  return { mrs, dataSyncedAt, scopeUncovered, scopeWindowDays };
});

/**
 * Fresh MRs for a single member. Reads the same project stores with a 20s
 * freshness demand: on live-granted repos the store is already event-fresh,
 * so this is a socket read, not an API fetch (spec §6 / review N3).
 */
async function fetchMemberMRs(username: string): Promise<BoardMR[]> {
  const out: PullRequest[] = [];
  const errors: string[] = [];
  for (const projectPath of config.projects) {
    const repoName = config.rtRepos[projectPath];
    if (!repoName) { errors.push(`${projectPath}: no rtRepos mapping in config.json`); continue; }
    const res = await readProjectMRs(repoName, 20_000);
    if (!res.ok || !res.data) { errors.push(`${projectPath}: ${res.error ?? "empty daemon response"}`); continue; }
    for (const entry of Object.values(res.data.mrs)) {
      if (entry.pr.state === "opened" && entry.pr.author?.username === username) out.push(entry.pr);
    }
  }
  if (errors.length) throw new Error(errors.join(" · "));
  const mrs = buildBoard(out, config);
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
    config.members.map(async (member) => {
      try {
        if (!token) { memberNames.set(member.username, member.name ?? null); return; }
        const user = await (await gitlab()).fetchUser(member.username);
        memberNames.set(member.username, user?.name ?? member.name ?? null);
      } catch (err) {
        console.error(`name lookup failed for ${member.username}: ${err instanceof Error ? err.message : err}`);
        memberNames.set(member.username, member.name ?? null);
      }
    }),
  );
}
// Fire-and-forget: a hung/down daemon must not delay Bun.serve() by the
// full getGitlabToken() timeout at boot. Every consumer already renders a
// null display name (falls back to member.name / username) until this
// resolves, same as the other void refreshMemberNames() call sites below.
void refreshMemberNames();

// ONE React in the bundle, pinned by resolved path.
//
// @mattstack/tui-kit is a `file:` dependency, and bun links it as a tree of
// per-file symlinks into the sibling checkout. A bundler REALPATHS a leaf
// before resolving that file's own imports, so a kit recipe's bare `react`
// specifier resolves from `~/Documents/GitHub/tui-kit/node_modules/...`, not
// from ours -- and bundlers key module identity by resolved path. The kit
// declares react/react-dom as PEER dependencies (correctly); that is simply
// not something an adopter's install can act on when the kit also has its own
// devDependency copy sitting next to the realpath'd source.
//
// Measured before this plugin existed: `react@19.2.8` from the kit's store AND
// `node_modules/react` from ours, both in one bundle -- so `<Icon>` (the first
// kit recipe the board renders) threw `Cannot read properties of null (reading
// 'useContext')` and React logged "You might have more than one copy of React
// in the same app". Same failure mode, same diagnosis technique, as the
// @soribashi/factory double instance in docs/tui-kit-devloop.md: group the
// emitted bundle's module-path comments by package root.
//
// `Bun.resolveSync` from THIS file's directory always lands in mr-board's own
// node_modules, so every react/react-dom specifier in the graph -- ours and
// the kit's alike -- collapses onto one copy.
//
// THE FILTER IS DELIBERATELY UNCONDITIONAL, and that is the thing to know if
// you land here chasing a React version conflict: it rewrites EVERY
// react/react-dom specifier in the graph onto mr-board's copy, third-party
// dependencies included (invadrs and react-markdown both import React today).
// A dependency that genuinely needed a different React major would be silently
// given ours and break at render, not at resolve -- so this plugin, not the
// lockfile, is where that investigation starts.
const reactSingleton: BunPlugin = {
  name: "react-singleton",
  setup(builder) {
    builder.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
      path: Bun.resolveSync(args.path, import.meta.dir),
    }));
  },
};

// Bundle the React client once at startup; served from memory.
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "client", "main.tsx")],
  target: "browser",
  minify: true,
  plugins: [reactSingleton],
});
if (!build.success) {
  console.error(build.logs.join("\n"));
  throw new Error("client bundle failed");
}
// The client entry imports the kit's theme.css + canvas.css, so the bundle is
// now a JS chunk *and* a CSS chunk. Discriminate on `kind`, not on the file
// extension: Bun tags each output ("entry-point" / "asset" / "chunk" /
// "sourcemap"), so turning on sourcemaps some day adds a `kind: "sourcemap"`
// output that these counts correctly ignore, while a real regression -- a
// second entry point, or a code-split chunk the shell does not serve -- still
// trips the assertion instead of sliding through an extension match.
//
// The CSS assertion is the load-bearing one: zero CSS outputs means those two
// imports silently vanished, which would boot the board with no token block at
// all (every var(--*) computing to `initial` -- black text on a transparent
// ground). Better a boot failure than a black board.
const jsOutputs = build.outputs.filter((o) => o.kind === "entry-point");
const cssOutputs = build.outputs.filter((o) => o.kind === "asset" && o.path.endsWith(".css"));
if (jsOutputs.length !== 1) throw new Error(`expected 1 JS entry-point output, got ${jsOutputs.length}`);
if (cssOutputs.length !== 1) throw new Error(`expected 1 CSS asset output (tui-kit theme + canvas), got ${cssOutputs.length}`);
const appJs = await jsOutputs[0]!.text();
const appCss = await cssOutputs[0]!.text();

const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${config.title.replace(/</g, "&lt;")}</title>
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap">
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

Bun.serve({
  port,
  // Loopback only (spec ruling 6): local-only gates are network-local, not
  // just Host-header-local (config.host, a wider-bind opt-in, retired).
  hostname: "127.0.0.1",
  // The cold fetch (paging the project MR list + batch-fetching) can exceed
  // Bun's 10s default; give it room so the first request doesn't time out.
  idleTimeout: 60,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (FIXTURE_DIR) {
      if (req.method !== "GET") return new Response("fixture mode is read-only", { status: 501 });
      switch (pathname) {
        case "/data.json":
          return new Response(readFileSync(fixtureFile("data.json"), "utf8"), { headers: { "content-type": "application/json" } });
        case "/discussions":
          return new Response(readFileSync(fixtureFile("discussions.json"), "utf8"), { headers: { "content-type": "application/json" } });
        case "/review/report":
          return new Response(readFileSync(fixtureFile("review-report.md"), "utf8"), { headers: { "content-type": "text/markdown" } });
        case "/peer/boards":
          return new Response(JSON.stringify({ boards: [] }), { headers: { "content-type": "application/json" } });
        case "/member": {
          const u = new URL(req.url).searchParams.get("u");
          const data = JSON.parse(readFileSync(fixtureFile("data.json"), "utf8")) as { mrs: Array<{ author: { username: string } }>; fetchedAt: number };
          return new Response(JSON.stringify({ mrs: data.mrs.filter((m) => m.author.username === u), fetchedAt: data.fetchedAt }), { headers: { "content-type": "application/json" } });
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
      case "/healthz":
        return new Response("ok");
      case "/events": {
        // One-way nudge channel: browsers re-pull /data.json on any message.
        let ctrl: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            ctrl = c;
            sseClients.add(c);
            c.enqueue(sseEncoder.encode("retry: 3000\n\n"));
          },
          cancel() {
            sseClients.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
          },
        });
      }
      case "/":
        return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } });
      // tui-kit's tokens + page canvas, bundled out of client/main.tsx. Linked
      // ahead of /style.css: the token block lives in @layer soribashi.tokens,
      // and canvas.css is unlayered but earlier, so the board's own unlayered
      // rules still win every conflict.
      case "/app.css":
        return new Response(appCss, { headers: { "content-type": "text/css; charset=utf-8" } });
      case "/style.css":
        css = readFileSync(cssPath, "utf-8");
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
      case "/favicon.svg":
        return new Response(favicon, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
      case "/app.js":
        return new Response(appJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    }
    // Resolved once per request, off the memoized getters above -- cheap
    // after the first daemon round trip, and every branch below expects a
    // plain string|null the way the removed module-level consts used to read.
    const [gitlabToken, slackToken, switchboardAdminToken] = await Promise.all([
      getGitlabToken(), getSlackToken(), getSwitchboardAdminToken(),
    ]);
    switch (pathname) {
      case "/member": {
        // Scoped refresh: just one member's MRs, cheap enough to poll often.
        const u = new URL(req.url).searchParams.get("u");
        if (!u || !config.members.some((m) => m.username === u && !m.hidden)) {
          return new Response("unknown member", { status: 400 });
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
                attachDoctors(attachResponds(attachReviews(mrs, readReviewStates()), readRespondStates()), readDoctorStates()),
                readSlackRefs(),
              ),
              heldDraftsByMr(readDrafts()),
            ),
          );
          return new Response(JSON.stringify({ mrs: withState, fetchedAt: Date.now() }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(`member fetch failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
      }
      case "/data.json": {
        void refreshMemberNames();
        // ?fresh=1 forces a cache-bypassing refetch (the manual refresh
        // button). Local-only: a tunnel visitor's fresh=1 degrades to a
        // plain cached read instead of a forced daemon sync (FIX 3).
        const wantsFresh = !!new URL(req.url).searchParams.get("fresh") && isLocalRequest(req);
        if (wantsFresh) forceNextFetch = true;
        const snapshot = wantsFresh ? await cache.forceRefresh() : await cache.get();
        // Hidden (checked-out) members drop from the sidebar, the "All" list,
        // and its counts — but stay in `allMembers` so the settings modal can
        // check them back in.
        const visible = config.members.filter((m) => !m.hidden);
        const visibleNames = new Set(visible.map((m) => m.username));
        const visibleMrs = snapshot.mrs.filter((mr) => visibleNames.has(mr.author.username));
        // Retain review/respond/doctor state for exactly as long as its MR is on
        // the board; prune once it merges/closes/goes stale and drops off. Gated
        // on a healthy, non-empty snapshot so a failed fetch (stale/empty data)
        // can't wipe live state. Keyed on the full board (all members, incl.
        // hidden), not just the visible subset.
        if (!snapshot.fetchError && snapshot.mrs.length > 0) {
          const onBoard = new Set(snapshot.mrs.map((m) => m.webUrl).filter((u): u is string => !!u));
          pruneReviewStates(onBoard);
          pruneRespondStates(onBoard);
          pruneDoctorStates(onBoard);
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
            allMembers: config.members.map((m) => ({
              username: m.username,
              name: memberNames.get(m.username) ?? m.name ?? null,
              hidden: !!m.hidden,
              // fetchTeamMRs does not filter by member at all (hidden or
              // otherwise) -- a checked-out member's MRs are still in
              // `snapshot.mrs`. null is deliberate anyway: it signals "not
              // tracked" for a hidden member rather than a real (and
              // possibly stale-looking) count for someone the sidebar no
              // longer shows -- the modal renders null as "—", not "0".
              count: m.hidden ? null : snapshot.mrs.filter((mr) => mr.author.username === m.username).length,
            })),
            mrs: attachPeerState(
              attachDrafts(
                attachSlack(attachDoctors(attachResponds(attachReviews(visibleMrs, reviews), responds), doctors), slackRefs),
                heldDraftsByMr(readDrafts()),
              ),
            ),
            local: isLocalRequest(req),
            canInvite: isLocalRequest(req) && !!switchboardAdminToken && !!config.switchboard.url,
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
            staleAfterDays: config.staleAfterDays,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      case "/settings": {
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const { username, hidden } = (body ?? {}) as { username?: unknown; hidden?: unknown };
        if (typeof username !== "string" || typeof hidden !== "boolean") {
          return new Response("expected { username: string, hidden: boolean }", { status: 400 });
        }
        if (!config.members.some((m) => m.username === username)) {
          return new Response(`unknown member "${username}"`, { status: 400 });
        }
        // Single writer: persist to config.json, then swap the in-memory members
        // so this and every subsequent /data.json reflect the new state.
        config.members = saveMemberHidden(username, hidden).members;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }
      case "/discussions": {
        // Reviewer-participated comment threads for the drawer, from the rt
        // daemon's discussions store. `repo` is the rt repo name (was a scoped
        // repositoryId before the rewire).
        const { searchParams } = new URL(req.url);
        const repo = searchParams.get("repo");
        const iid = Number(searchParams.get("iid"));
        const author = searchParams.get("author");
        if (!repo || !iid) return new Response("expected repo & iid", { status: 400 });
        const res = await readDiscussions(repo, iid);
        if (!res.ok || !res.data) {
          return new Response(`discussions read failed: ${res.error ?? "empty daemon response"}`, { status: 502 });
        }
        const detail = { discussions: res.data.discussions } as MRDetail;
        const { threads, comments } = summarizeDiscussions(detail, author, config.botUsernames);
        return new Response(JSON.stringify({ threads, comments }), { headers: { "content-type": "application/json" } });
      }
      case "/review": {
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!config.reviewCwd) return new Response("reviewCwd not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        if (!parsed) return new Response("expected { mrUrl: string, iid: number }", { status: 400 });
        const resume = (body as { resume?: unknown })?.resume === true;
        const reReview = (body as { reReview?: unknown })?.reReview === true;
        const noteParse = parseLaunchNote(body);
        if (!noteParse.ok) return new Response(noteParse.error, { status: 400 });
        const note = noteParse.note;
        // Only launch for an MR the board is actually showing.
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find((m) => m.webUrl === parsed.mrUrl);
        if (!mr) {
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        }
        const author = mrAuthorLabel(mr);
        const existing = readReviewStates().get(parsed.mrUrl);
        if (reReview) {
          // A live review re-focuses its tab rather than re-reviewing on top of it.
          if (existing?.tabId && (existing.status === "queued" || existing.status === "reviewing")) {
            try {
              await focusTab(existing.tabId);
              return new Response(JSON.stringify({ ok: true, focused: true }), { headers: { "content-type": "application/json" } });
            } catch {
              // tab is gone — fall through and start the re-review fresh
            }
          }
          // Resume-or-fresh lives in the launcher so triage can start the same
          // re-review off a peer's nudge. Spawn asynchronously; the badge
          // reflects progress via the state file.
          void launchReReview(parsed.mrUrl, parsed.iid, {
            cwd: config.reviewCwd,
            workspaceLabel: config.reviewsWorkspace,
            skill: resolveLaunchSkill("review", parsed.mrUrl),
            author,
            claudeCommand: config.claudeCommand,
            note,
          });
          return new Response(JSON.stringify({ ok: true, reReview: true }), { headers: { "content-type": "application/json" } });
        }
        if (resume) {
          const sessionId = existing?.sessionId;
          if (!sessionId) return new Response("no session id on file for this review", { status: 400 });
          const statePath = reviewFilePath(parsed.mrUrl);
          void launchResume(
            { mrUrl: parsed.mrUrl, iid: parsed.iid, cwd: config.reviewCwd, workspaceLabel: config.reviewsWorkspace, statePath, sessionId, workspaceKind: "review", author, claudeCommand: config.claudeCommand, prompt: note && operatorNoteParagraph(note) },
          )
            .then(({ tabId, workspaceId }) => writeReviewState(statePath, { status: existing?.status ?? "done", tabId, workspaceId }))
            .catch((err) => console.error(`review resume failed: ${err instanceof Error ? err.message : err}`));
          return new Response(JSON.stringify({ ok: true, resumed: true }), { headers: { "content-type": "application/json" } });
        }
        // Dedup: a live review for this MR re-focuses its tab instead of spawning another.
        if (existing && existing.tabId && (existing.status === "queued" || existing.status === "reviewing")) {
          try {
            await focusTab(existing.tabId);
            return new Response(JSON.stringify({ ok: true, focused: true }), { headers: { "content-type": "application/json" } });
          } catch {
            // tab is gone — fall through and start a fresh review
          }
        }
        const statePath = reviewFilePath(parsed.mrUrl);
        writeReviewState(statePath, { mrUrl: parsed.mrUrl, iid: parsed.iid, status: "queued" });
        // Spawn asynchronously; the badge reflects progress via the state file.
        void launchReview({
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          cwd: config.reviewCwd,
          workspaceLabel: config.reviewsWorkspace,
          statePath,
          skill: resolveLaunchSkill("review", parsed.mrUrl),
          author,
          claudeCommand: config.claudeCommand,
          note,
        })
          .then(({ tabId, workspaceId }) => writeReviewState(statePath, { status: "queued", tabId, workspaceId }))
          .catch((err) => {
            console.error(`review launch failed: ${err instanceof Error ? err.message : err}`);
            writeReviewState(statePath, { status: "error", message: "failed to launch review pane" });
          });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
      case "/respond": {
        // Launch the response-to-review skill in a fresh herdr pane for the
        // caller's own MR. Same shape as /review: local-only, dedup a running
        // response, kick the pane asynchronously, and let the state file
        // drive the badge.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        const cwd = config.respondCwd || config.reviewCwd;
        if (!cwd) return new Response("respondCwd (or reviewCwd) not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const parsed = parseRespondRequestBody(body);
        if (!parsed) return new Response("expected { mrUrl: string, iid: number }", { status: 400 });
        const resume = (body as { resume?: unknown })?.resume === true;
        const noteParse = parseLaunchNote(body);
        if (!noteParse.ok) return new Response(noteParse.error, { status: 400 });
        const note = noteParse.note;
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find((m) => m.webUrl === parsed.mrUrl);
        if (!mr) {
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        }
        const author = mrAuthorLabel(mr);
        const existing = readRespondStates().get(parsed.mrUrl);
        if (resume) {
          const sessionId = existing?.sessionId;
          if (!sessionId) return new Response("no session id on file for this response", { status: 400 });
          const statePath = respondFilePath(parsed.mrUrl);
          void launchResume(
            { mrUrl: parsed.mrUrl, iid: parsed.iid, cwd: cwd, workspaceLabel: config.respondsWorkspace, statePath, sessionId, workspaceKind: "respond", author, claudeCommand: config.claudeCommand, prompt: note && operatorNoteParagraph(note) },
          )
            .then(({ tabId, workspaceId }) => writeRespondState(statePath, { status: existing?.status ?? "done", tabId, workspaceId }))
            .catch((err) => console.error(`respond resume failed: ${err instanceof Error ? err.message : err}`));
          return new Response(JSON.stringify({ ok: true, resumed: true }), { headers: { "content-type": "application/json" } });
        }
        const inFlight = new Set(["queued", "triaging", "implementing", "drafting"]);
        if (existing && existing.tabId && inFlight.has(existing.status)) {
          try {
            await focusTab(existing.tabId);
            return new Response(JSON.stringify({ ok: true, focused: true }), { headers: { "content-type": "application/json" } });
          } catch {
            // tab is gone -- fall through and start a fresh response
          }
        }
        const statePath = respondFilePath(parsed.mrUrl);
        writeRespondState(statePath, { mrUrl: parsed.mrUrl, iid: parsed.iid, status: "queued" });
        void launchRespond({
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          cwd,
          workspaceLabel: config.respondsWorkspace,
          statePath,
          skill: resolveLaunchSkill("respond", parsed.mrUrl),
          author,
          claudeCommand: config.claudeCommand,
          note,
        })
          .then(({ tabId, workspaceId }) => writeRespondState(statePath, { status: "queued", tabId, workspaceId }))
          .catch((err) => {
            console.error(`respond launch failed: ${err instanceof Error ? err.message : err}`);
            writeRespondState(statePath, { status: "error", message: "failed to launch respond pane" });
          });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
      case "/doctor": {
        // Launch the MR-doctor skill to fix mechanical breakage (CI red /
        // merge conflicts) on the caller's MR. Same shape as /respond.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        const cwd = config.doctorCwd || config.reviewCwd;
        if (!cwd) return new Response("doctorCwd (or reviewCwd) not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const parsed = parseDoctorRequestBody(body);
        if (!parsed) return new Response("expected { mrUrl: string, iid: number }", { status: 400 });
        const noteParse = parseLaunchNote(body);
        if (!noteParse.ok) return new Response(noteParse.error, { status: 400 });
        const note = noteParse.note;
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find((m) => m.webUrl === parsed.mrUrl);
        if (!mr) {
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        }
        const author = mrAuthorLabel(mr);
        const existing = readDoctorStates().get(parsed.mrUrl);
        const inFlight = new Set(["queued", "diagnosing", "rebasing", "fixing", "watching"]);
        if (existing && existing.tabId && inFlight.has(existing.status)) {
          try {
            await focusTab(existing.tabId);
            return new Response(JSON.stringify({ ok: true, focused: true }), { headers: { "content-type": "application/json" } });
          } catch {
            // tab is gone -- fall through and start a fresh doctor session
          }
        }
        const statePath = doctorFilePath(parsed.mrUrl);
        writeDoctorState(statePath, { mrUrl: parsed.mrUrl, iid: parsed.iid, status: "queued", origin: "manual" });
        void launchDoctor({
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          cwd,
          workspaceLabel: config.doctorsWorkspace,
          statePath,
          skill: resolveLaunchSkill("doctor", parsed.mrUrl),
          author,
          claudeCommand: config.claudeCommand,
          note,
        })
          .then(({ tabId, workspaceId }) => writeDoctorState(statePath, { status: "queued", tabId, workspaceId }))
          .catch((err) => {
            console.error(`doctor launch failed: ${err instanceof Error ? err.message : err}`);
            writeDoctorState(statePath, { status: "error", message: "failed to launch doctor pane" });
          });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
      case "/drafts": {
        // The ONLY path from a held doctor draft to a GitLab note. The human
        // click is the approval (spec §6): the doctor tier writes drafts and
        // nothing here runs unattended.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const { mrUrl, kind, action } = (body ?? {}) as { mrUrl?: unknown; kind?: unknown; action?: unknown };
        if (typeof mrUrl !== "string" || typeof kind !== "string" || (action !== "post" && action !== "dismiss")) {
          return new Response('expected { mrUrl: string, kind: string, action: "post"|"dismiss" }', { status: 400 });
        }
        const draft = readDrafts().find((d) => d.mrUrl === mrUrl && d.kind === kind && d.status === "held");
        if (!draft) return new Response("no held draft for that MR/kind", { status: 404 });
        const path = draftFilePath(mrUrl, kind);
        if (action === "dismiss") {
          writeDraft(path, { status: "dismissed" });
          return new Response(JSON.stringify({ ok: true, dismissed: true }), { headers: { "content-type": "application/json" } });
        }
        if (!gitlabToken) return new Response("gitlab token not configured", { status: 400 });
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find((m) => m.webUrl === mrUrl);
        if (!mr) return new Response(`unknown MR "${mrUrl}"`, { status: 400 });
        try {
          const projectId = parseRepoId(mr.repositoryId);
          const mutator = new NoteMutator(config.gitlabHost, gitlabToken);
          const note = await mutator.createNote(projectId, mr.iid, draft.body);
          writeDraft(path, { status: "posted", postedNoteId: note.id });
          return new Response(JSON.stringify({ ok: true, posted: true, noteId: note.id }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(`note post failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
      }
      case "/agent/status":
      // Retained as harmless belt-and-braces, not because any caller can still
      // reach it: panes invoke the CLI as `bun run <path>/bin/review-status.ts`,
      // which bun re-reads from disk on every invocation, so even a pane
      // launched before this change runs the current CLI (posting to
      // /agent/status) the moment it next fires.
      case "/review/outcome": {
        // The launched agent's only channel back to the board. It reports the
        // lifecycle status it just wrote, and the board -- which already has the
        // channel indexed -- decides which slack reaction that means. Keeps the
        // agent out of slack entirely.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const signal = parseAgentSignal(body, pathname, (u) => readReviewStates().get(u)?.iid ?? 0);
        if (!signal) {
          return new Response("expected { mrUrl: string, iid: number, kind: review|respond|doctor, status: string, outcome?: string }", { status: 400 });
        }
        // Peer sync: tell the MR author's board where this review stands. Runs
        // before the emoji early-return below, so transitions that map to no
        // emoji still sync. Own policy (slack reactions) continues after; this
        // is pure relay traffic.
        // `defaultMember: "all"` is a view setting, not an identity, so there is
        // no way to tell this board's own MRs from a peer's. Without that, the
        // own-MR guard below can never match and the board would relay a
        // review-state for every MR on it, including publishing to itself.
        const pc = peering.current()?.client;
        if (pc && signal.kind === "review" && config.defaultMember !== "all") {
          const snapshotForPeer = await cache.get();
          const authorUsername = snapshotForPeer.mrs.find((m) => m.webUrl === signal.mrUrl)?.author.username;
          // Never relay a review of this board's own MR: the author is right
          // here, and the peer state files are for other people's boards.
          if (authorUsername && canonicalUsername(authorUsername) !== canonicalUsername(config.defaultMember)) {
            enqueueOutbox(makeEnvelope(authorUsername, "review-state", {
              mrUrl: signal.mrUrl, iid: signal.iid, status: signal.status,
              outcome: signal.outcome, updatedAt: Date.now(),
            } satisfies ReviewStatePayload));
            kickOutbox(pc);
          }
        }
        const emoji = signalEmoji(signal.kind, signal.status, config.slack.emoji, signal.outcome);
        if (!emoji) {
          return new Response(JSON.stringify({ ok: true, reacted: false }), { headers: { "content-type": "application/json" } });
        }
        // Only a wanted reaction needs slack configured -- most transitions map
        // to no emoji at all (see signalEmoji) and must not 400 on a Slack-less
        // install.
        if (!slackToken) return new Response("slack not configured", { status: 400 });
        // The sweeper usually resolves the ref first, but a review launched and
        // finished inside one sweep interval can beat it here.
        try {
          const existing = readSlackRefs().get(signal.mrUrl);
          if (existing?.status !== "found" || !existing.messageTs) {
            await resolveSlackRef(slackToken, config.slack.channel, signal.mrUrl, signal.iid);
          }
          const ref = await reactToMR(slackToken, signal.mrUrl, emoji);
          return new Response(JSON.stringify({ ok: true, reacted: true, reactions: ref.reactions ?? [] }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(`slack react failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
      }
      case "/draft": {
        // Flip one of your own MRs between draft and ready. GitLab has no draft
        // flag: the draft state IS the title prefix, so rewriting the title is
        // the whole operation, both directions. Gated to your own MRs on both
        // sides (the menu item only renders for them, and this refuses others').
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!gitlabToken) return new Response("gitlab token not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        const draft = (body as { draft?: unknown })?.draft;
        if (!parsed || typeof draft !== "boolean") {
          return new Response("expected { mrUrl: string, iid: number, draft: boolean }", { status: 400 });
        }
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find((m) => m.webUrl === parsed.mrUrl);
        if (!mr) return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        if (mr.author.username !== config.defaultMember) {
          return new Response("not your MR", { status: 403 });
        }
        if (mr.isDraft === draft) {
          return new Response(JSON.stringify({ ok: true, unchanged: true }), { headers: { "content-type": "application/json" } });
        }
        const path = projectPathFromWebUrl(parsed.mrUrl, config.gitlabHost);
        if (!path) return new Response(`could not derive a project path from "${parsed.mrUrl}"`, { status: 400 });
        try {
          // glance owns the title mechanics (on GitLab the draft state IS the
          // title prefix), reads the MR first since we send `draft` without a
          // title, and reads it back after to confirm the flag actually landed --
          // throwing instead of reporting a transition that did not happen.
          const updated = await (await gitlab()).updatePullRequest(path, parsed.iid, { draft });
          // The cached snapshot still has the old state; drop it so the next
          // /data.json reflects the flip instead of waiting out the cache TTL.
          cache.invalidate();
          return new Response(JSON.stringify({ ok: true, draft, title: updated.title }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`draft update failed for !${parsed.iid} (draft=${draft}): ${message}`);
          // glance retries its post-write read-back, rejections and a draft flag
          // that has not caught up alike (0.18.1, MAT-169), so getting here means
          // those retries were exhausted rather than never tried. The edit landed
          // before any of that ran either way, so ask GitLab what is actually true
          // instead of reporting a write that worked as a failure.
          const after = await (await gitlab()).fetchSingleMR(path, parsed.iid, null).catch(() => null);
          if (after?.draft === draft) {
            cache.invalidate();
            return new Response(JSON.stringify({ ok: true, draft, title: after.title, recovered: true }), {
              headers: { "content-type": "application/json" },
            });
          }
          // The read above is a guess at what happened; this is the SDK telling
          // us outright that the edit reached GitLab and only describing it back
          // failed (glance 0.19.0). That outranks a recovery read which may
          // itself have just failed -- the flip is applied, so 502-ing here
          // would report a succeeded write as a failure, which is the whole bug.
          if (err instanceof ReadBackFailedError && err.writeApplied) {
            cache.invalidate();
            return new Response(JSON.stringify({ ok: true, draft, recovered: true, verified: false }), {
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(`gitlab update failed: ${message}`, { status: 502 });
        }
      }
      case "/nudge": {
        // Ask a peer's agent for a re-review of YOUR OWN MR. The board only
        // relays the human's click; all policy runs in the peer's triage.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        const pc = peering.current()?.client;
        if (!pc) return new Response("switchboard not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        const reviewer = (body as { reviewer?: unknown })?.reviewer;
        if (!parsed || typeof reviewer !== "string" || !reviewer.trim()) {
          return new Response("expected { mrUrl: string, iid: number, reviewer: string }", { status: 400 });
        }
        const snapshot = await cache.get();
        const mr = snapshot.mrs.find((m) => m.webUrl === parsed.mrUrl);
        if (!mr) return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        if (mr.author.username !== config.defaultMember) return new Response("not your MR", { status: 403 });
        const draft = makeEnvelope(reviewer, "re-review-request", {
          mrUrl: parsed.mrUrl, iid: parsed.iid,
        } satisfies ReReviewRequestPayload);
        // Publish inline rather than queue-and-forget: a 4xx (usually 422, the
        // reviewer has no board on the switchboard) is permanent, and the drain
        // would drop it with only a log -- leaving the clicker an "ok" and a
        // chip reading "requested" for 48h for a send that can never happen.
        const status = await pc.publish(draft);
        const cls = classifySend(status);
        if (cls === "drop") {
          // 422 is the relay's unknown-recipient answer, and the only 4xx a
          // human can act on -- the rest are this board's problem, not theirs.
          const why = status === 422
            ? `reviewer "${canonicalUsername(reviewer)}" is not on the switchboard`
            : `nudge rejected by relay (${status})`;
          return new Response(why, { status: 409 });
        }
        // Retryable (network or 5xx): queue it for the 60s tick. The chip
        // honestly reads "requested" while the outbox keeps trying.
        if (cls === "retry") enqueueOutbox(draft);
        // Record the ask either way: an inbound outcome needs a file to resolve
        // against, even while the send is still queued.
        writeSentNudge({
          nudgeId: draft.id,
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          reviewer: canonicalUsername(reviewer),
          sentAt: Date.now(),
        });
        return new Response(JSON.stringify(cls === "retry" ? { ok: true, queued: true } : { ok: true }), {
          headers: { "content-type": "application/json" },
        });
      }
      case "/peer/invite": {
        // Mint a one-paste invite for a peer. Operator-only: needs the admin
        // token this board holds, which is also what /data.json's canInvite
        // reports so the UI never offers a button that can't work.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        // isLocal reads the Host header, which a cross-origin form can forge.
        // Requiring a json content-type takes that away: a form post can only
        // carry the text/plain-class types, and anything else trips a CORS
        // preflight the board never answers. The board's own client always
        // sends application/json.
        const ct = req.headers.get("content-type") ?? "";
        if (!ct.toLowerCase().includes("application/json")) return new Response("expected application/json", { status: 415 });
        if (!switchboardAdminToken || !config.switchboard.url) return new Response("inviting is not set up on this board", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const username = (body as { username?: unknown })?.username;
        if (typeof username !== "string" || !username.trim()) return new Response("expected { username }", { status: 400 });
        const r = await createInvite(username.trim(), { url: config.switchboard.url, adminToken: switchboardAdminToken });
        return new Response(r.body, { status: r.status, headers: r.status === 200 ? { "content-type": "application/json" } : undefined });
      }
      case "/peer/boards": {
        if (req.method !== "GET") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!switchboardAdminToken || !config.switchboard.url) return new Response("inviting is not set up on this board", { status: 400 });
        const r = await listPeerBoards({ url: config.switchboard.url, adminToken: switchboardAdminToken });
        return new Response(r.body, { status: r.status, headers: r.status === 200 ? { "content-type": "application/json" } : undefined });
      }
      case "/peer/join": {
        // Redeem an invite from the UI: persist url + token, then hot-start
        // peering, so joining costs no restart.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        // Same content-type gate as /peer/invite above: a forged Host header on
        // a cross-origin form must not be enough to re-point this board's
        // switchboard config.
        const ct = req.headers.get("content-type") ?? "";
        if (!ct.toLowerCase().includes("application/json")) return new Response("expected application/json", { status: 415 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const invite = (body as { invite?: unknown })?.invite;
        if (typeof invite !== "string" || !invite.trim()) return new Response("expected { invite }", { status: 400 });
        const r = await joinSwitchboard(invite, {
          defaultMember: config.defaultMember,
          persist(url, token) {
            // upsertEnvKeys reads "" as a removal, so an empty token must never
            // reach it: that would quietly delete the token line this board is
            // already peering with. Throwing here is the recovery answer. The
            // message is interpolated into onboard.ts's 500 body, which the join
            // UI shows verbatim, so it stays inside the onboarding vocabulary.
            if (!token) throw new Error("the switchboard sent nothing usable");
            // The two writes must land together or not at all. saveSwitchboardUrl
            // naming the new relay -- in config.json (unowned) or the machine
            // settings store (owned; see config.ts's saveSwitchboardUrl) --
            // while .env still holds the old token is the one state nothing
            // recovers from: this process keeps peering on the live handle,
            // but the next restart pairs the new url with the old token and
            // 401s forever. So put the url back if the token write fails,
            // and let the join report the failure.
            const previousUrl = config.switchboard.url;
            config = saveSwitchboardUrl(url);           // reparsed config swaps in
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
                    `the switchboard url (config.json or the settings store) may still name ${url} while .env holds the old token`,
                );
              }
              throw err;
            }
          },
          startPeering: (url, token) => peering.start(url, token),
        });
        return new Response(r.body, { status: r.status, headers: r.status === 200 ? { "content-type": "application/json" } : undefined });
      }
      case "/review/report": {
        // The agent's written review markdown for one MR. Read-only display
        // data, so it's available on the tunnel too (like the status badge),
        // not local-gated the way launching a review is.
        const mrUrl = new URL(req.url).searchParams.get("mr");
        if (!mrUrl) return new Response("expected ?mr=<url>", { status: 400 });
        const report = readReviewReport(mrUrl);
        if (report === null) return new Response("no review yet", { status: 404 });
        return new Response(report, { headers: { "content-type": "text/markdown; charset=utf-8" } });
      }
      case "/slack/resolve": {
        // Find (and cache) the MR's review-request message in the team channel.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!slackToken) return new Response("slack not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const parsed = parseReviewRequestBody(body);
        if (!parsed) return new Response("expected { mrUrl: string, iid: number }", { status: 400 });
        try {
          const ref = await resolveSlackRef(slackToken, config.slack.channel, parsed.mrUrl, parsed.iid);
          return new Response(
            JSON.stringify({ ok: true, status: ref.status, permalink: ref.permalink, reactions: ref.reactions ?? [] }),
            { headers: { "content-type": "application/json" } },
          );
        } catch (err) {
          return new Response(`slack resolve failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
      }
      case "/slack/post": {
        // Post an MR (or a summary of many MRs) to the configured channel and
        // write a slack ref pinned to the new message so reactions target it.
        // Item lines always render server-side from config templates against
        // the board cache. The header line is client-supplied, but
        // sanitizeHeader Slack-escapes it, so it cannot form a <url|anchor>
        // link, an <@user> mention, or an <!channel>/<!here> broadcast. A bare
        // URL in the header still auto-links (Slack does that itself); that's
        // accepted -- it's the local user's own words under their own token.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!slackToken) return new Response("slack not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const { mrUrls, header } = (body ?? {}) as { mrUrls?: unknown; header?: unknown };
        if (!Array.isArray(mrUrls) || mrUrls.length === 0 || !mrUrls.every((u) => typeof u === "string")) {
          return new Response("expected { mrUrls: string[] }", { status: 400 });
        }
        const headerOverride = header === undefined ? null : sanitizeHeader(header);
        if (header !== undefined && headerOverride === null) {
          return new Response(`"header" must be a non-empty string of at most ${MAX_HEADER_LEN} characters`, { status: 400 });
        }
        const snapshot = await cache.get();
        const byUrl = new Map(snapshot.mrs.map((m) => [m.webUrl, m] as const));
        const picked = (mrUrls as string[]).map((u) => byUrl.get(u)).filter((m): m is BoardMR => !!m);
        if (picked.length !== mrUrls.length) {
          return new Response("one or more mrUrls are not on the board", { status: 400 });
        }
        // Guard against duplicate posts: check for an existing ref file first,
        // and for MRs we've never resolved, sync the channel index and look for
        // the author's original review-request. If any MR already has a
        // message, don't post — cache the found ref (single) or 409 (multi).
        const existingRefs = readSlackRefs();
        const toResolve = picked.filter((m) => existingRefs.get(m.webUrl!)?.status !== "found");
        const freshlyFound: Array<{ iid: number; permalink?: string }> = [];
        try {
          for (const m of toResolve) {
            const ref = await resolveSlackRef(slackToken, config.slack.channel, m.webUrl!, m.iid);
            if (ref.status === "found") freshlyFound.push({ iid: m.iid, permalink: ref.permalink });
          }
        } catch (err) {
          return new Response(`slack resolve failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
        const previouslyFound = picked.filter((m) => existingRefs.get(m.webUrl!)?.status === "found");
        const alreadyIids = [...previouslyFound.map((m) => m.iid), ...freshlyFound.map((f) => f.iid)];
        if (alreadyIids.length) {
          if (picked.length === 1) {
            // Single-MR post: seamlessly link to the existing message instead of
            // posting a duplicate. The ref was just written by resolveSlackRef.
            const permalink = freshlyFound[0]?.permalink ?? existingRefs.get(picked[0]!.webUrl!)?.permalink;
            return new Response(JSON.stringify({ ok: true, linked: true, permalink }), {
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(
            `already in slack: ${alreadyIids.map((i) => `!${i}`).join(", ")}`,
            { status: 409 },
          );
        }
        const facts: MrFacts[] = picked.map((m) => ({
          iid: m.iid,
          title: m.title,
          url: m.webUrl ?? "",
          ticket: (m.title.match(/([A-Z]+-\d+)/)?.[1]) ?? "",
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
          headerOverride,
        );
        try {
          const refs = await postToSlack(
            slackToken,
            config.slack.channel,
            text,
            picked.map((m) => ({ webUrl: m.webUrl!, iid: m.iid })),
          );
          return new Response(JSON.stringify({ ok: true, posted: refs.length, permalink: refs[0]?.permalink }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(`slack post failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
      }
      case "/slack/react": {
        // Add or remove a review-signal reaction (eyes/speech_balloon/white_check_mark)
        // on the MR's cached review-request message. `remove: true` unreacts.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!slackToken) return new Response("slack not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const { mrUrl, emoji, remove } = (body ?? {}) as { mrUrl?: unknown; emoji?: unknown; remove?: unknown };
        const allowed = Object.values(config.slack.emoji);
        if (typeof mrUrl !== "string" || typeof emoji !== "string" || !allowed.includes(emoji)) {
          return new Response(`expected { mrUrl: string, emoji: one of ${allowed.join("|")}, remove?: boolean }`, { status: 400 });
        }
        try {
          const ref = remove === true
            ? await unreactFromMR(slackToken, mrUrl, emoji)
            : await reactToMR(slackToken, mrUrl, emoji);
          return new Response(JSON.stringify({ ok: true, reactions: ref.reactions ?? [] }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          return new Response(`slack react failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },
});

// The board's real port can differ from config.json when $PORT is set (see
// above); the status CLIs run in a separate process that never sees that env,
// so leave the resolved port where they can find it on disk instead.
// A stale or missing port file only costs the agents their Slack reactions,
// which is not worth refusing to serve over.
try {
  const boardPortDir = join(import.meta.dir, "..", "state");
  mkdirSync(boardPortDir, { recursive: true });
  writeFileSync(join(boardPortDir, "board-port"), String(port));
} catch (err) {
  console.error(
    `could not record the board port in state/board-port: ${err instanceof Error ? err.message : err} -- agent-driven Slack reactions may not reach this board`,
  );
}

console.log(`mr-board serving on http://localhost:${port}`);

// Warm the cache at startup so the first visitor after a (re)start gets a
// ready snapshot instead of waiting on the cold fetch.
void cache.get().catch(() => {});

/**
 * Background sweep: resolve Slack refs for every MR on the board that doesn't
 * have one yet, and retry `notfound` refs older than one sweep interval (an MR
 * posted just now won't be in the index until the next sync). Spaced calls so
 * a full board doesn't hammer Slack's rate limits. Failures per-MR are logged
 * and skipped — one bad MR shouldn't kill the sweep.
 */
const AUTO_RESOLVE_GAP_MS = 250;
let autoResolveTimer: ReturnType<typeof setTimeout> | undefined;
let autoResolveRunning = false;

async function autoResolveSlackRefs(): Promise<void> {
  if (autoResolveRunning) return;
  const slackToken = await getSlackToken();
  if (!slackToken) return;
  autoResolveRunning = true;
  try {
    const snapshot = await cache.get().catch(() => null);
    if (!snapshot) return;
    const refs = readSlackRefs();
    const retryAfter = Date.now() - config.slack.autoResolveIntervalMinutes * 60_000;
    const targets = snapshot.mrs.filter((mr) => {
      if (!mr.webUrl) return false;
      const ref = refs.get(mr.webUrl);
      if (!ref) return true;
      if (ref.status === "notfound" && ref.checkedAt < retryAfter) return true;
      return false;
    });
    if (!targets.length) return;
    for (const mr of targets) {
      try {
        await resolveSlackRef(slackToken, config.slack.channel, mr.webUrl!, mr.iid);
      } catch (err) {
        console.error(`auto-resolve !${mr.iid} failed: ${err instanceof Error ? err.message : err}`);
      }
      await new Promise((r) => setTimeout(r, AUTO_RESOLVE_GAP_MS));
    }
  } finally {
    autoResolveRunning = false;
  }
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
    void autoResolveSlackRefs().catch((err) =>
      console.error(`auto-resolve sweep failed: ${err instanceof Error ? err.message : err}`),
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
const RELAY_TYPES = new Set(["project-mrs", "discussions:update", "discussions:new-comments"]);
const RELAY_COALESCE_MS = 750;
const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseEncoder = new TextEncoder();

const SSE_HEARTBEAT_MS = 25_000;

function sseSend(frame: Uint8Array): void {
  for (const client of sseClients) {
    try { client.enqueue(frame); } catch { sseClients.delete(client); }
  }
}

function sseNudge(): void {
  sseSend(sseEncoder.encode("data: changed\n\n"));
}

// Comment frames keep quiet connections under Bun's idleTimeout and prune
// clients that vanished without a cancel. EventSource ignores comment lines.
setInterval(() => sseSend(sseEncoder.encode(": ping\n\n")), SSE_HEARTBEAT_MS);

let relayTimer: ReturnType<typeof setTimeout> | undefined;
const stopRelay = FIXTURE_DIR ? () => {} : subscribe((type, data) => {
  if (!RELAY_TYPES.has(type)) return;
  const repoName = (data as { repoName?: string } | null)?.repoName;
  if (!repoName || !Object.values(config.rtRepos).includes(repoName)) return;
  clearTimeout(relayTimer);
  relayTimer = setTimeout(() => {
    void cache.refreshNow().then(sseNudge).catch(() => {});
  }, RELAY_COALESCE_MS);
});
void stopRelay; // long-lived server; kept for symmetry/tests

// Hot-reload config.json so adding/removing members (or any setting) takes
// effect without a restart. Watch the directory — that survives editors that
// save atomically by swapping the file — and filter to our file. A mid-edit
// invalid file is ignored, keeping the last good config.
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
if (!FIXTURE_DIR) watch(dirname(CONFIG_PATH), (_event, filename) => {
  if (filename && filename !== basename(CONFIG_PATH)) return;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
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
      console.log("config.json changed — reloaded members/settings (no restart needed)");
    } catch (err) {
      console.error(`config reload skipped (invalid): ${err instanceof Error ? err.message : err}`);
    }
  }, 150);
});
