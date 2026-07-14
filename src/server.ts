import { join, dirname, basename } from "path";
import { readFileSync, watch } from "fs";
import { GitLabProvider, type PullRequest } from "@workforge/glance-sdk";
import { loadConfig, loadGitLabToken, saveMemberHidden, CONFIG_PATH } from "./config.ts";
import { buildBoard, buildRoster } from "./data.ts";
import { SnapshotCache } from "./cache.ts";
import { isLocalRequest } from "./local.ts";
import { readReviewStates, reviewFilePath, writeReviewState, parseReviewRequestBody, attachReviews } from "./review-state.ts";
import { launchReview, focusTab } from "./herdr.ts";

const cssPath = join(import.meta.dir, "style.css");
let css = readFileSync(cssPath, "utf-8");

const config = loadConfig();
const provider = new GitLabProvider(config.gitlabHost, loadGitLabToken());

/**
 * Fetch every configured project's opened MRs authored by a team member.
 *
 * The SDK's default `fetchPullRequests()` only returns the *token user's* own
 * MRs, so it can't see teammates' work. The `{ authorUsernames, projectPath }`
 * mode fetches members' MRs directly (one GraphQL query per author, full
 * dashboard fields) — no REST discovery pass needed.
 *
 * Each of those queries is heavy (pipelines, jobs, mergeability, discussions),
 * so firing all members at once makes GitLab's GraphQL time out its field
 * resolvers. Pace them in small concurrent batches instead. Only visible
 * members are fetched — hidden ones don't render anyway.
 */
const FETCH_CONCURRENCY = 4;

async function fetchTeamMRs(): Promise<PullRequest[]> {
  const authors = config.members.filter((m) => !m.hidden).map((m) => m.username);
  const byId = new Map<string, PullRequest>();
  for (const projectPath of config.projects) {
    for (let i = 0; i < authors.length; i += FETCH_CONCURRENCY) {
      const chunk = authors.slice(i, i + FETCH_CONCURRENCY);
      const results = await Promise.all(
        chunk.map((a) => provider.fetchPullRequests({ authorUsernames: [a], projectPath, state: "opened" })),
      );
      for (const pr of results.flat()) byId.set(pr.id, pr);
    }
  }
  return [...byId.values()];
}

const cache = new SnapshotCache(async () => buildBoard(await fetchTeamMRs(), config));

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
        const res = await provider.restRequest(
          "GET",
          `/api/v4/users?username=${encodeURIComponent(member.username)}`,
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
      case "/":
        return new Response(shell, { headers: { "content-type": "text/html; charset=utf-8" } });
      case "/style.css":
        css = readFileSync(cssPath, "utf-8");
        return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
      case "/app.js":
        return new Response(appJs, { headers: { "content-type": "text/javascript; charset=utf-8" } });
      case "/data.json": {
        void refreshMemberNames();
        const snapshot = await cache.get();
        // Hidden (checked-out) members drop from the sidebar, the "All" list,
        // and its counts — but stay in `allMembers` so the settings modal can
        // check them back in.
        const visible = config.members.filter((m) => !m.hidden);
        const visibleNames = new Set(visible.map((m) => m.username));
        const visibleMrs = snapshot.mrs.filter((mr) => visibleNames.has(mr.author.username));
        const reviews = readReviewStates();
        return new Response(
          JSON.stringify({
            title: config.title,
            defaultMember: config.defaultMember,
            members: buildRoster(visible, visibleMrs, memberNames),
            allMembers: config.members.map((m) => ({
              username: m.username,
              name: memberNames.get(m.username) ?? m.name ?? null,
              hidden: !!m.hidden,
              // Counted from the full snapshot so hidden members still show their number.
              count: snapshot.mrs.filter((mr) => mr.author.username === m.username).length,
            })),
            mrs: attachReviews(visibleMrs, reviews),
            local: isLocalRequest(req),
            fetchedAt: snapshot.fetchedAt,
            fetchError: snapshot.fetchError,
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
        // Full per-MR comment threads, fetched when the "N comments" drawer opens.
        // Per thread: status (resolved / author replied / awaiting author) plus
        // every non-system note with author, time, and full body.
        const { searchParams } = new URL(req.url);
        const repo = searchParams.get("repo");
        const iid = Number(searchParams.get("iid"));
        const author = searchParams.get("author");
        if (!repo || !iid) return new Response("expected repo & iid", { status: 400 });
        try {
          const detail = await provider.fetchMRDiscussions(repo, iid);
          const threads: Array<{
            status: "resolved" | "replied" | "awaiting";
            notes: Array<{ name: string; username: string | null; at: string; body: string }>;
          }> = [];
          for (const d of detail.discussions) {
            // GitLab puts resolvable/resolved on the notes, not the discussion.
            // A real comment thread has ≥1 resolvable note; this also skips
            // system notes and bot linkbacks (resolvable=false).
            const notes = d.notes.filter((n) => !n.system);
            const resolvable = notes.filter((n) => n.resolvable);
            if (!resolvable.length) continue;
            const resolved = resolvable.every((n) => n.resolved === true);
            const last = notes[notes.length - 1]!;
            const status = resolved ? "resolved" : author && last.author?.username === author ? "replied" : "awaiting";
            threads.push({
              status,
              notes: notes.map((n) => ({
                name: n.author?.name ?? n.author?.username ?? "?",
                username: n.author?.username ?? null,
                at: n.createdAt,
                body: n.body ?? "",
              })),
            });
          }
          // Actionable first (awaiting the author), then replied, then resolved.
          const rank = { awaiting: 0, replied: 1, resolved: 2 };
          threads.sort((a, b) => rank[a.status] - rank[b.status]);
          return new Response(JSON.stringify({ threads }), { headers: { "content-type": "application/json" } });
        } catch (err) {
          return new Response(`discussions fetch failed: ${err instanceof Error ? err.message : err}`, { status: 502 });
        }
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
        // Only launch for an MR the board is actually showing.
        const snapshot = await cache.get();
        if (!snapshot.mrs.some((mr) => mr.webUrl === parsed.mrUrl)) {
          return new Response(`unknown MR "${parsed.mrUrl}"`, { status: 400 });
        }
        // Dedup: a live review for this MR re-focuses its tab instead of spawning another.
        const existing = readReviewStates().get(parsed.mrUrl);
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
        })
          .then(({ tabId, workspaceId }) => writeReviewState(statePath, { status: "queued", tabId, workspaceId }))
          .catch((err) => {
            console.error(`review launch failed: ${err instanceof Error ? err.message : err}`);
            writeReviewState(statePath, { status: "error", message: "failed to launch review pane" });
          });
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },
});

console.log(`mr-board serving on http://localhost:${port}`);

// Warm the cache at startup so the first visitor after a (re)start gets a
// ready snapshot instead of waiting on the cold fetch.
void cache.get().catch(() => {});

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
      cache.invalidate();
      void refreshMemberNames();
      void cache.get().catch(() => {});
      console.log("config.json changed — reloaded members/settings (no restart needed)");
    } catch (err) {
      console.error(`config reload skipped (invalid): ${err instanceof Error ? err.message : err}`);
    }
  }, 150);
});
