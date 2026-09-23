/**
 * The GitHub token rt's forge calls use: the stored `rt/githubToken` secret,
 * else the local `gh` session. Without the fallback a machine with only a
 * `gh` login reads every PR as absent, which silently disables the picker's PR
 * state and merge-driven worktree cleanup.
 */

import { homedir } from "os";
import { runCapture } from "./subprocess.ts";

const GH_TTL_MS = 10 * 60_000;

export interface GhTokenSeams {
  ghToken(): Promise<string | null>;
  now(): number;
}

export interface ResolvedGithubToken {
  token: string;
  source: "stored" | "gh";
}

/** The daemon runs under launchd's minimal PATH, so gh is looked up in the usual install dirs too. */
function ghSearchPath(): string {
  const home = homedir();
  return ["/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, process.env.PATH ?? ""].join(":");
}

async function realGhToken(): Promise<string | null> {
  // test-setup.ts sets this so no unit test can read the developer's real gh login.
  if (process.env.RT_GH_TOKEN_FALLBACK === "off") return null;
  const gh = Bun.which("gh", { PATH: ghSearchPath() });
  if (!gh) return null;
  const res = await runCapture([gh, "auth", "token"], { timeoutMs: 5000 });
  const token = res.stdout.trim();
  return res.exitCode === 0 && token ? token : null;
}

export function createGithubTokenResolver(
  seams: GhTokenSeams = { ghToken: realGhToken, now: Date.now },
): (stored: string | undefined) => Promise<ResolvedGithubToken | null> {
  let cached: { token: string | null; at: number } | undefined;
  return async (stored) => {
    if (stored) return { token: stored, source: "stored" };
    if (!cached || seams.now() - cached.at > GH_TTL_MS) {
      cached = { token: await seams.ghToken(), at: seams.now() };
    }
    return cached.token ? { token: cached.token, source: "gh" } : null;
  };
}

export const resolveGithubToken = createGithubTokenResolver();
