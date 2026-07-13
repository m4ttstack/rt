import { join } from "path";
import { readFileSync } from "fs";
import { GitLabProvider } from "@forge-glance/sdk";
import { loadConfig, loadGitLabToken } from "./config.ts";
import { buildBoard } from "./data.ts";
import { SnapshotCache } from "./cache.ts";

const cssPath = join(import.meta.dir, "style.css");
let css = readFileSync(cssPath, "utf-8");

const config = loadConfig();
const provider = new GitLabProvider(config.gitlabHost, loadGitLabToken());

const cache = new SnapshotCache(async () => {
  const prs = await provider.fetchPullRequests({ state: "opened" });
  return buildBoard(prs, config);
});

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

interface RosterMember {
  username: string;
  name: string | null;
  count: number;
}

/** Members in config order, each with a resolved name and open-MR count. */
function buildRoster(mrs: { author: { username: string } }[]): RosterMember[] {
  return config.members.map((member) => ({
    username: member.username,
    name: memberNames.get(member.username) ?? member.name ?? null,
    count: mrs.filter((mr) => mr.author.username === member.username).length,
  }));
}

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

Bun.serve({
  port: config.port,
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
        return new Response(
          JSON.stringify({
            title: config.title,
            members: buildRoster(snapshot.mrs),
            mrs: snapshot.mrs,
            fetchedAt: snapshot.fetchedAt,
            fetchError: snapshot.fetchError,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      default:
        return new Response("not found", { status: 404 });
    }
  },
});

console.log(`mr-board serving on http://localhost:${config.port}`);
