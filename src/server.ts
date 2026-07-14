import { join } from "path";
import { readFileSync } from "fs";
import { GitLabProvider, type PullRequest } from "@forge-glance/sdk";
import { loadConfig, loadGitLabToken, saveMemberHidden } from "./config.ts";
import { buildBoard, buildRoster, memberAuthoredIids, type RawMRRef } from "./data.ts";
import { SnapshotCache } from "./cache.ts";

const cssPath = join(import.meta.dir, "style.css");
let css = readFileSync(cssPath, "utf-8");

const config = loadConfig();
const provider = new GitLabProvider(config.gitlabHost, loadGitLabToken());

/**
 * Fetch every configured project's opened MRs authored by a team member.
 *
 * The SDK's `fetchPullRequests()` only returns the *token user's* own MRs, so
 * it can't see teammates' work. Instead we page the project MR list (which
 * lists all authors) to discover member-authored IIDs, then batch-fetch those
 * by IID to get the fully-normalized objects (pipeline, approvals, blockers)
 * the board renders.
 */
async function fetchTeamMRs(): Promise<PullRequest[]> {
  const out: PullRequest[] = [];
  for (const projectPath of config.projects) {
    const enc = encodeURIComponent(projectPath);
    const iids: number[] = [];
    for (let page = 1; ; ) {
      const res = await provider.restRequest(
        "GET",
        `/api/v4/projects/${enc}/merge_requests?state=opened&per_page=100&page=${page}`,
      );
      const list = (await res.json()) as RawMRRef[];
      iids.push(...memberAuthoredIids(list, config.members));
      const next = res.headers.get("x-next-page");
      if (!next) break;
      page = Number(next);
    }
    if (iids.length) {
      out.push(...(await provider.fetchPullRequests({ iids, projectPath, state: "opened" })));
    }
  }
  return out;
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
            mrs: visibleMrs,
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
      default:
        return new Response("not found", { status: 404 });
    }
  },
});

console.log(`mr-board serving on http://localhost:${port}`);

// Warm the cache at startup so the first visitor after a (re)start gets a
// ready snapshot instead of waiting on the cold fetch.
void cache.get().catch(() => {});
