/**
 * One-shot setup for a fresh clone. Prompts for a GitLab token, runs the Slack
 * OAuth flow in the browser (each teammate mints their own xoxp token via the
 * shared internal app), and writes .env + config.json.
 *
 * Re-runnable: existing values are shown as defaults, blank input keeps them.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readEnvFile, upsertEnvKeys } from "../src/env-file.ts";
import { carrySwitchboard, classifySetupAnswer, redeemInvite } from "../src/peer/invite.ts";
import { canonicalUsername } from "../src/peer/envelope.ts";

// Slack app credentials are NOT checked in — bring your own app (see the README
// "Slack integration" section). setup reads SLACK_CLIENT_ID / SLACK_CLIENT_SECRET
// from .env (or the environment) and prompts for them when absent, so nothing
// secret ever lands in a tracked file.
const SLACK_REDIRECT_PORT = 53782;
const SLACK_REDIRECT_URI = `http://localhost:${SLACK_REDIRECT_PORT}/slack/callback`;
const SLACK_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "reactions:read",
  "reactions:write",
  "chat:write",
].join(",");

const ROOT = join(import.meta.dir, "..");
const ENV_PATH = join(ROOT, ".env");
const CONFIG_PATH = join(ROOT, "config.json");
const TEAM_CONFIG_PATH = join(ROOT, "config.team.json");
const EXAMPLE_CONFIG_PATH = join(ROOT, "config.example.json");
const CLAUDE_SKILLS = join(homedir(), ".claude", "skills");
const SKILLS_SRC = join(ROOT, "skills");

function ask(question: string, existing?: string): string {
  const suffix = existing ? ` [${maskIfSecret(question, existing)}]` : "";
  const answer = prompt(`${question}${suffix}:`) ?? "";
  return answer.trim() || existing || "";
}

function maskIfSecret(question: string, value: string): string {
  if (/token|secret/i.test(question)) return value.slice(0, 6) + "…";
  return value;
}

async function runSlackOAuth(clientId: string, clientSecret: string): Promise<string> {
  const state = crypto.randomUUID();
  const authorizeUrl =
    `https://slack.com/oauth/v2/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&user_scope=${encodeURIComponent(SLACK_USER_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(SLACK_REDIRECT_URI)}` +
    `&state=${state}`;

  console.log("\nOpening Slack in your browser to authorize the app…");
  console.log("If it doesn't open, visit:\n  " + authorizeUrl + "\n");

  return new Promise<string>((resolve, reject) => {
    const server = Bun.serve({
      port: SLACK_REDIRECT_PORT,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/slack/callback") {
          return new Response("not found", { status: 404 });
        }
        const err = url.searchParams.get("error");
        if (err) {
          server.stop(true);
          reject(new Error(`Slack denied the authorization: ${err}`));
          return html(`<h1>Authorization failed</h1><p>${escape(err)}</p>`, 400);
        }
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!code || returnedState !== state) {
          server.stop(true);
          reject(new Error("missing code or state mismatch"));
          return html("<h1>Invalid callback</h1>", 400);
        }
        try {
          const token = await exchangeCode(code, clientId, clientSecret);
          server.stop(true);
          resolve(token);
          return html("<h1>Done — you can close this tab.</h1>");
        } catch (e) {
          server.stop(true);
          reject(e);
          return html(`<h1>Token exchange failed</h1><p>${escape((e as Error).message)}</p>`, 500);
        }
      },
    });

    Bun.spawn(["open", authorizeUrl], { stdout: "ignore", stderr: "ignore" }).exited.catch(() => {});
  });
}

async function exchangeCode(code: string, clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: SLACK_REDIRECT_URI,
    }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string; authed_user?: { access_token?: string } };
  if (!data.ok) throw new Error(`oauth.v2.access failed: ${data.error}`);
  const token = data.authed_user?.access_token;
  if (!token) throw new Error("oauth.v2.access returned no user token");
  return token;
}

function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem}</style>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Base config to seed config.json from: a private config.team.json (a real
    roster) if present, else the shipped config.example.json template. */
function loadBaseConfig(): Record<string, unknown> {
  const base = existsSync(TEAM_CONFIG_PATH) ? TEAM_CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  if (!existsSync(base)) throw new Error(`no base config: expected ${TEAM_CONFIG_PATH} or ${EXAMPLE_CONFIG_PATH}`);
  return JSON.parse(readFileSync(base, "utf8"));
}

/** Symlink each skills/<dir> (with a `name:` in its SKILL.md frontmatter) into
    ~/.claude/skills/<name>, so the board's launched panes can invoke them.
    Idempotent: replaces a stale link, leaves a correct one. */
function installSkills(): void {
  if (!existsSync(SKILLS_SRC)) return;
  mkdirSync(CLAUDE_SKILLS, { recursive: true });
  for (const dir of readdirSync(SKILLS_SRC)) {
    const skillMd = join(SKILLS_SRC, dir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const match = readFileSync(skillMd, "utf8").match(/^name:\s*(.+)$/m);
    if (!match) continue;
    const name = match[1]!.trim();
    const link = join(CLAUDE_SKILLS, name);
    const target = resolve(SKILLS_SRC, dir);
    let existing: string | null = null;
    try {
      existing = readlinkSync(link);
    } catch {
      // no symlink there
    }
    if (existing === target) continue;
    try {
      unlinkSync(link);
    } catch {
      // nothing to remove
    }
    symlinkSync(target, link);
    console.log(`Installed skill ${name}`);
  }
}

function loadExistingConfig(): Record<string, unknown> | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  console.log("mr-board setup\n");

  const env = readEnvFile(ENV_PATH);
  const existingConfig = loadExistingConfig();

  const gitlabToken = ask("GitLab personal access token (read_api scope)", env.GITLAB_TOKEN);
  if (!gitlabToken) {
    console.error("A GitLab token is required. Create one at https://gitlab.com/-/user_settings/personal_access_tokens");
    process.exit(1);
  }
  env.GITLAB_TOKEN = gitlabToken;

  const defaultMember = ask(
    "Your GitLab username (used as the default board view)",
    (existingConfig?.defaultMember as string) ?? "",
  );

  const reviewCwd = ask(
    "Absolute path to your local repo checkout for launching reviews (optional, blank to skip)",
    (existingConfig?.reviewCwd as string) ?? "",
  );

  const skipSlack = (ask("Set up Slack integration now? (Y/n)", "Y") || "Y").toLowerCase().startsWith("n");
  if (!skipSlack) {
    if (env.SLACK_TOKEN) {
      const reuse = (ask("An existing SLACK_TOKEN was found. Reuse it? (Y/n)", "Y") || "Y").toLowerCase().startsWith("n");
      if (reuse) env.SLACK_TOKEN = "";
    }
    if (!env.SLACK_TOKEN) {
      const clientId = ask("Slack app client id", env.SLACK_CLIENT_ID || process.env.SLACK_CLIENT_ID);
      const clientSecret = ask("Slack app client secret", env.SLACK_CLIENT_SECRET || process.env.SLACK_CLIENT_SECRET);
      if (!clientId || !clientSecret) {
        console.error("Slack setup needs a client id + secret from your own Slack app (see README). Skipping Slack.");
      } else {
        env.SLACK_CLIENT_ID = clientId;
        env.SLACK_CLIENT_SECRET = clientSecret;
        try {
          env.SLACK_TOKEN = await runSlackOAuth(clientId, clientSecret);
          console.log("Got Slack user token.");
        } catch (e) {
          console.error(`Slack OAuth failed: ${(e as Error).message}`);
          console.error("You can re-run `bun run setup` any time to try again. Continuing without a Slack token.");
        }
      }
    }
  }

  // Peer boards: one paste. An invite link joins outright; a bare URL falls back
  // to the manual token prompt; blank keeps whatever is already configured.
  let joined: { url: string } | null = null;
  const existingSw = existingConfig?.switchboard as { url?: string } | undefined;
  const answer = ask("Board invite for peer boards (paste the link; blank keeps current settings)", "");
  const classified = classifySetupAnswer(answer);
  if (classified.kind === "invalid") {
    console.error(classified.message);
  } else if (classified.kind === "manual-url") {
    const swToken = ask("Switchboard board token (from your operator)", env.SWITCHBOARD_TOKEN);
    if (swToken) {
      env.SWITCHBOARD_TOKEN = swToken;
      joined = { url: classified.url };
    } else {
      console.error("No token entered. Peer features stay disabled until SWITCHBOARD_TOKEN is set.");
    }
  } else if (classified.kind === "invite" && !defaultMember) {
    console.error("Peer boards need your username; set it above and re-run.");
  } else if (classified.kind === "invite") {
    // Redeem as late as possible (right before the .env write below) so a crash
    // between redeem and persist cannot burn the one-time invite (spec I4).
    const r = await redeemInvite(classified.url, classified.code, canonicalUsername(defaultMember), fetch);
    if (r.ok) {
      env.SWITCHBOARD_TOKEN = r.token;
      joined = { url: classified.url };
      console.log(`Joined peer boards as ${r.username}.`);
    } else {
      console.error(`Could not join peer boards: ${r.message}`);
    }
  }

  upsertEnvKeys(ENV_PATH, env);
  console.log(`Wrote ${ENV_PATH}`);

  const baseConfig = loadBaseConfig();
  const finalConfig = {
    ...baseConfig,
    defaultMember: defaultMember || "all",
    reviewCwd,
    ...carrySwitchboard(existingSw, joined),
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(finalConfig, null, 2) + "\n");
  console.log(`Wrote ${CONFIG_PATH}`);

  installSkills();

  console.log("\nDone. Start the board with:\n  bun run serve");
}

await main();
