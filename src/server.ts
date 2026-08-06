import { join, dirname, basename } from "path";
import { readFileSync, writeFileSync, mkdirSync, watch } from "fs";
import type { PullRequest, MRDetail } from "@mattstack/glance";
import { loadConfig, loadGitLabToken, loadSlackToken, saveMemberHidden, CONFIG_PATH } from "./config.ts";
import { aggregateSyncScope, boardDemand, buildBoard, buildRoster, type BoardMR, type SyncScopeRead } from "./data.ts";
import { summarizeDiscussions, threadStatusCounts, unresolvedReviewerCount } from "./discussions.ts";
import { readProjectMRs, readDiscussions, subscribe } from "@mattstack/rt-client";
import { SnapshotCache } from "./cache.ts";
import { isLocalRequest } from "./local.ts";
import { readReviewStates, pruneReviewStates, reviewFilePath, writeReviewState, parseReviewRequestBody, attachReviews, readReviewReport } from "./review-state.ts";
import { readRespondStates, pruneRespondStates, respondFilePath, writeRespondState, parseRespondRequestBody, attachResponds } from "./respond-state.ts";
import { readDoctorStates, pruneDoctorStates, doctorFilePath, writeDoctorState, parseDoctorRequestBody, attachDoctors } from "./doctor-state.ts";
import { launchReview, launchRespond, launchDoctor, launchResume, focusTab, reReviewResumePrompt } from "./herdr.ts";
import { readSlackRefs, attachSlack, resolveSlackRef, reactToMR, unreactFromMR, postToSlack, REVIEW_EMOJI } from "./slack.ts";
import { signalEmoji, isSignalKind, type AgentSignal } from "./agent-signal.ts";
import { renderMr, renderMulti, type MrFacts } from "./template.ts";

const cssPath = join(import.meta.dir, "style.css");
let css = readFileSync(cssPath, "utf-8");
const faviconPath = join(import.meta.dir, "favicon.svg");
const favicon = readFileSync(faviconPath, "utf-8");

const config = loadConfig();
// Optional: display-name lookups only. The board's data plane is rt.
const gitlabToken = loadGitLabToken();
// Optional: enables the Slack review-thread menu actions when a token is set.
const slackToken = loadSlackToken();

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
  const demand = boardDemand(config);
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
  await Promise.all(
    config.members.map(async (member) => {
      try {
        if (!gitlabToken) { memberNames.set(member.username, member.name ?? null); return; }
        const res = await fetch(
          `${config.gitlabHost}/api/v4/users?username=${encodeURIComponent(member.username)}`,
          { headers: { "PRIVATE-TOKEN": gitlabToken } },
        );
        const users = (await res.json()) as Array<{ username: string; name?: string }>;
        memberNames.set(member.username, users[0]?.name ?? member.name ?? null);
      } catch (err) {
        console.error(`name lookup failed for ${member.username}: ${err instanceof Error ? err.message : err}`);
        memberNames.set(member.username, member.name ?? null);
      }
    }),
  );
}
await refreshMemberNames();

// Bundle the React client once at startup; served from memory.
const build = await Bun.build({
  entrypoints: [join(import.meta.dir, "client.tsx")],
  target: "browser",
  minify: true,
});
if (!build.success) {
  console.error(build.logs.join("\n"));
  throw new Error("client bundle failed");
}
const appJs = await build.outputs[0]!.text();

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
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/app.js"></script>
</body>
</html>`;

// $PORT wins over config.port so a deployment (launchd/systemd) can pin the
// port the tunnel points at, independent of config.json.
const port = Number(process.env.PORT) || config.port;

Bun.serve({
  port,
  // The cold fetch (paging the project MR list + batch-fetching) can exceed
  // Bun's 10s default; give it room so the first request doesn't time out.
  idleTimeout: 60,
  async fetch(req) {
    const { pathname } = new URL(req.url);
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
      case "/style.css":
        css = readFileSync(cssPath, "utf-8");
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
      case "/favicon.svg":
        return new Response(favicon, { headers: { "content-type": "image/svg+xml; charset=utf-8" } });
      case "/app.js":
        return new Response(appJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      case "/member": {
        // Scoped refresh: just one member's MRs, cheap enough to poll often.
        const u = new URL(req.url).searchParams.get("u");
        if (!u || !config.members.some((m) => m.username === u && !m.hidden)) {
          return new Response("unknown member", { status: 400 });
        }
        void refreshMemberNames();
        try {
          const mrs = await fetchMemberMRs(u);
          const withState = attachSlack(
            attachDoctors(attachResponds(attachReviews(mrs, readReviewStates()), readRespondStates()), readDoctorStates()),
            readSlackRefs(),
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
              // Checked-out members are skipped by fetchTeamMRs, so their MRs
              // aren't in the snapshot and there's no count to report. null (not
              // 0, which reads as "no open MRs") — the modal renders it as "—".
              count: m.hidden ? null : snapshot.mrs.filter((mr) => mr.author.username === m.username).length,
            })),
            mrs: attachSlack(attachDoctors(attachResponds(attachReviews(visibleMrs, reviews), responds), doctors), slackRefs),
            local: isLocalRequest(req),
            slackEnabled: !!slackToken,
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
          const statePath = reviewFilePath(parsed.mrUrl);
          // Prior claude session on file: resume it and direct it to re-review, so
          // the agent keeps its memory of what it flagged. Otherwise launch a fresh
          // review with the re-review framing (the wrapper reads any prior report at
          // reportPath, and falls back to a normal review if the author hasn't acted).
          if (existing?.sessionId) {
            writeReviewState(statePath, { status: "reviewing" });
            void launchResume({
              mrUrl: parsed.mrUrl,
              iid: parsed.iid,
              cwd: config.reviewCwd,
              workspaceLabel: config.reviewsWorkspace,
              statePath,
              sessionId: existing.sessionId,
              workspaceKind: "review",
              prompt: reReviewResumePrompt(parsed.iid),
              tabPrefix: "⟲",
              author,
            })
              .then(({ tabId, workspaceId }) => writeReviewState(statePath, { status: "reviewing", tabId, workspaceId }))
              .catch((err) => {
                console.error(`re-review resume failed: ${err instanceof Error ? err.message : err}`);
                writeReviewState(statePath, { status: "error", message: "failed to launch re-review pane" });
              });
            return new Response(JSON.stringify({ ok: true, reReview: true, resumed: true }), { headers: { "content-type": "application/json" } });
          }
          writeReviewState(statePath, { mrUrl: parsed.mrUrl, iid: parsed.iid, status: "queued" });
          void launchReview({
            mrUrl: parsed.mrUrl,
            iid: parsed.iid,
            cwd: config.reviewCwd,
            workspaceLabel: config.reviewsWorkspace,
            statePath,
            skill: config.reviewSkill,
            channel: config.slack.channel,
            reReview: true,
            author,
          })
            .then(({ tabId, workspaceId }) => writeReviewState(statePath, { status: "queued", tabId, workspaceId }))
            .catch((err) => {
              console.error(`re-review launch failed: ${err instanceof Error ? err.message : err}`);
              writeReviewState(statePath, { status: "error", message: "failed to launch re-review pane" });
            });
          return new Response(JSON.stringify({ ok: true, reReview: true }), { headers: { "content-type": "application/json" } });
        }
        if (resume) {
          const sessionId = existing?.sessionId;
          if (!sessionId) return new Response("no session id on file for this review", { status: 400 });
          const statePath = reviewFilePath(parsed.mrUrl);
          void launchResume(
            { mrUrl: parsed.mrUrl, iid: parsed.iid, cwd: config.reviewCwd, workspaceLabel: config.reviewsWorkspace, statePath, sessionId, workspaceKind: "review", author },
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
          skill: config.reviewSkill,
          channel: config.slack.channel,
          author,
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
            { mrUrl: parsed.mrUrl, iid: parsed.iid, cwd: cwd, workspaceLabel: config.respondsWorkspace, statePath, sessionId, workspaceKind: "respond", author },
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
          skill: config.respondSkill,
          author,
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
        writeDoctorState(statePath, { mrUrl: parsed.mrUrl, iid: parsed.iid, status: "queued" });
        void launchDoctor({
          mrUrl: parsed.mrUrl,
          iid: parsed.iid,
          cwd,
          workspaceLabel: config.doctorsWorkspace,
          statePath,
          skill: config.doctorSkill,
          author,
        })
          .then(({ tabId, workspaceId }) => writeDoctorState(statePath, { status: "queued", tabId, workspaceId }))
          .catch((err) => {
            console.error(`doctor launch failed: ${err instanceof Error ? err.message : err}`);
            writeDoctorState(statePath, { status: "error", message: "failed to launch doctor pane" });
          });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
      case "/agent/status":
      case "/review/outcome": {
        // The launched agent's only channel back to the board. It reports the
        // lifecycle status it just wrote, and the board -- which already has the
        // channel indexed -- decides which slack reaction that means. Keeps the
        // agent out of slack entirely.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!slackToken) return new Response("slack not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const signal = parseAgentSignal(body, pathname);
        if (!signal) {
          return new Response("expected { mrUrl: string, iid: number, kind: review|respond|doctor, status: string, outcome?: string }", { status: 400 });
        }
        const emoji = signalEmoji(signal.kind, signal.status, signal.outcome);
        if (!emoji) {
          return new Response(JSON.stringify({ ok: true, reacted: false }), { headers: { "content-type": "application/json" } });
        }
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
        // Renders the text server-side from config templates so the client
        // can't inject arbitrary content.
        if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
        if (!isLocalRequest(req)) return new Response("forbidden", { status: 403 });
        if (!slackToken) return new Response("slack not configured", { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("invalid json", { status: 400 });
        }
        const { mrUrls } = (body ?? {}) as { mrUrls?: unknown };
        if (!Array.isArray(mrUrls) || mrUrls.length === 0 || !mrUrls.every((u) => typeof u === "string")) {
          return new Response("expected { mrUrls: string[] }", { status: 400 });
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
        const text = facts.length === 1
          ? renderMr(config.slack.singleTemplate, facts[0]!)
          : renderMulti(config.slack.multiHeader, config.slack.multiItem, facts);
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
        const allowed = Object.values(REVIEW_EMOJI) as string[];
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
  if (autoResolveRunning || !slackToken) return;
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

function scheduleAutoResolve(): void {
  if (autoResolveTimer) clearTimeout(autoResolveTimer);
  const mins = config.slack.autoResolveIntervalMinutes;
  if (!slackToken || mins <= 0) return;
  const tick = () => {
    void autoResolveSlackRefs().catch((err) =>
      console.error(`auto-resolve sweep failed: ${err instanceof Error ? err.message : err}`),
    );
    autoResolveTimer = setTimeout(tick, mins * 60_000);
  };
  // Kick a first sweep shortly after startup so the board fills in without a wait.
  autoResolveTimer = setTimeout(tick, 5_000);
}

scheduleAutoResolve();

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
const stopRelay = subscribe((type, data) => {
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
watch(dirname(CONFIG_PATH), (_event, filename) => {
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
      scheduleAutoResolve();
      console.log("config.json changed — reloaded members/settings (no restart needed)");
    } catch (err) {
      console.error(`config reload skipped (invalid): ${err instanceof Error ? err.message : err}`);
    }
  }, 150);
});

/** Parse an /agent/status body. `/review/outcome` is the pre-existing shape the
    review CLI used before the board owned the whole policy; panes launched
    before that change are long-lived, so their `{ mrUrl, outcome }` body is
    still accepted and filled out here. Deletable once no old pane can be live. */
function parseAgentSignal(body: unknown, pathname: string): AgentSignal | null {
  if (!body || typeof body !== "object") return null;
  const { mrUrl, iid, kind, status, outcome } = body as Record<string, unknown>;
  if (typeof mrUrl !== "string" || !mrUrl) return null;
  if (outcome !== undefined && typeof outcome !== "string") return null;
  if (pathname === "/review/outcome") {
    return { mrUrl, iid: readReviewStates().get(mrUrl)?.iid ?? 0, kind: "review", status: "done", outcome: outcome as string | undefined };
  }
  if (!isSignalKind(kind)) return null;
  if (typeof status !== "string" || !status) return null;
  if (typeof iid !== "number" || !Number.isFinite(iid)) return null;
  return { mrUrl, iid, kind, status, outcome: outcome as string | undefined };
}
