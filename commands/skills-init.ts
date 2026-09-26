/**
 * rt skills init [--repo <path>] [--zone <slug>] [--json]
 *
 * Scaffolds a zero-fill team pack named after its zone's namespace (roster
 * `work` only, every domain slot unbound), declares the repo in the zone,
 * materializes, compiles, checks, and installs the pack plugin on this
 * machine. Never commits; never writes into an existing pack directory.
 */
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, resolve } from "path";
import { resolveClaudeBin } from "../lib/claude-bin.ts";
import type { CommandContext } from "../lib/command-tree.ts";
import { updateRepoIndexAsync } from "../lib/repo-index.ts";
import { deriveRepoIdentity, serializeIdentity } from "../lib/settings/identity.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, userErrorPayload } from "../lib/setup/errors.ts";
import { createRealProbes } from "../lib/setup/probes.ts";
import { materializeSkills } from "../lib/setup/skills-materialize.ts";
import { createTeam } from "../lib/team/create.ts";
import { initPack, type InitDeps, type InitOutcome } from "../lib/skills/init.ts";
import { loadStepSource, resolvePluginRoots } from "../lib/skills/sources.ts";
import { textInput } from "../lib/ui/prompts.ts";
import { checkPack, compilePackAll } from "./skills.ts";
import { childEnv } from "../lib/subprocess.ts";

export type InitArgs = { repo: string; zone: string | null; json: boolean };

export function parseInitArgs(args: string[]): InitArgs {
  const out: InitArgs = { repo: process.cwd(), zone: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (flag: string): string => {
      const v = args[++i];
      if (!v || v.startsWith("--")) throw new UserActionableError("usage", `${flag} needs a value`);
      return v;
    };
    switch (a) {
      case "--repo": out.repo = resolve(value(a)); break;
      case "--zone": out.zone = value(a); break;
      case "--json": out.json = true; break;
      default: throw new UserActionableError("usage", `unrecognized argument "${a}"`);
    }
  }
  return out;
}

export function renderInitOutcome(out: InitOutcome): string {
  if (!out.ok) {
    if (out.refused) return `rt skills init: ${out.detail}`;
    const remedy = out.remedy ?? "fix, then rt skills compile / check by hand";
    return [`rt skills init: ${out.code}: ${out.detail}`, `written so far (${remedy}):`, ...out.wrote.map((w) => `  ${w}`)].join("\n");
  }
  return [
    `pack ${out.pack.name} at ${out.pack.dir}`,
    `zone ${out.pack.zone}, marketplace ${out.pack.marketplace}, installed ${out.installed.plugin} ${out.installed.version}`,
    `repo manifest ${out.repo.manifest}`,
    "run /reload-plugins in your Claude session, then try:",
    `  ${out.tryNext}`,
  ].join("\n");
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function realDeps(opts: { json: boolean }): InitDeps {
  const p = createRealProbes();
  const claudeBin = resolveClaudeBin();
  const run = async (cmd: string, args: string[]) => {
    const proc = Bun.spawn([cmd, ...args], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, stdout, stderr };
  };
  return {
    fs: {
      exists: (path) => existsSync(path),
      readFile: (path) => (existsSync(path) ? readFileSync(path, "utf8") : null),
      writeFile: (path, text) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text);
      },
      mkdirp: (path) => mkdirSync(path, { recursive: true }),
      readDir: (path) => (existsSync(path) ? readdirSync(path) : []),
    },
    home: homedir(),
    gitRemote: async (dir) => {
      try {
        execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "pipe" });
      } catch {
        return { kind: "not-a-repo" };
      }
      try {
        const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        if (url) return { kind: "ok", url };
      } catch {
        // origin is unset or has no URL; fall through to the first remote.
      }
      let firstRemote: string | null = null;
      try {
        const remotes = execFileSync("git", ["-C", dir, "remote"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        firstRemote = remotes[0] ?? null;
      } catch {
        return { kind: "no-remote" };
      }
      if (!firstRemote) return { kind: "no-remote" };
      try {
        const url = execFileSync("git", ["-C", dir, "remote", "get-url", firstRemote], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
        return url ? { kind: "ok", url } : { kind: "no-remote" };
      } catch {
        return { kind: "no-remote" };
      }
    },
    isTTY: Boolean(process.stdin.isTTY) && !opts.json && !process.env.RT_BATCH,
    promptZone: async () => ({
      name: await textInput({ message: "Team name (a new zone will be created)", stderr: true }),
      remote: await textInput({ message: "Empty git remote URL for the team zone", stderr: true }),
    }),
    createZone: async (name, remote) => {
      const r = await createTeam(p, { name, remote, others: false });
      return { slug: r.slug, dir: r.dir };
    },
    engineDescription: (engine) => {
      try {
        return loadStepSource(engine, resolvePluginRoots()).description;
      } catch {
        return null;
      }
    },
    claude: claudeBin ? (args) => run(claudeBin, args) : null,
    registerRepo: async (dir) => {
      const identity = serializeIdentity(await deriveRepoIdentity(dir));
      const indexed = await updateRepoIndexAsync(identity, dir);
      if (!indexed.ok) throw new UserActionableError("locate-failed", `registering ${dir} failed: ${indexed.error}`);
      return identity;
    },
    materialize: async (repoName) => {
      const r = await materializeSkills(p, { repo: repoName });
      if (r.skipped) return { ok: false, detail: r.reason };
      const row = r.repos[0];
      return row ? { ok: row.ok, detail: row.detail } : { ok: false, detail: "materialize wrote nothing" };
    },
    // compilePackAll and checkPack resolve outside withCleanErrors, so a usage error from
    // pack resolution would escape as an uncaught throw and lose the `wrote` list.
    compile: async (packDir, manifest) => {
      try {
        return await compilePackAll({ packDir, manifest });
      } catch (err) {
        return { ok: false, errors: [message(err)] };
      }
    },
    check: async (packDir, manifest) => {
      try {
        return { drift: (await checkPack({ packDir, manifest })).drift };
      } catch (err) {
        console.error(`rt skills init: check threw: ${message(err)}`);
        return { drift: true };
      }
    },
  };
}

export async function skillsInit(args: string[], _ctx: CommandContext = {}, deps?: InitDeps): Promise<void> {
  let parsed: InitArgs;
  try {
    parsed = parseInitArgs(args);
  } catch (err) {
    if (err instanceof UserActionableError) {
      if (args.includes("--json")) {
        console.log(JSON.stringify(envelope({ error: { code: "usage", message: err.message } })));
      } else {
        console.error(`rt skills init: ${err.message}`);
      }
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  const resolvedDeps = deps ?? realDeps({ json: parsed.json });
  let out: InitOutcome;
  try {
    out = await initPack({ repoDir: parsed.repo, zone: parsed.zone }, resolvedDeps);
  } catch (err) {
    // A dep the pre-attempt setup calls directly (promptZone, createZone) can throw a
    // UserActionableError before initPack's own post-write attempt() wrapper is reached;
    // that must still refuse cleanly rather than crash to a bare stack.
    if (err instanceof UserActionableError) {
      if (parsed.json) {
        console.log(JSON.stringify(userErrorPayload(new UserActionableError(err.code, err.message, { ...err.extra, refused: true }))));
      } else {
        console.error(`rt skills init: ${err.message}`);
      }
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  if (parsed.json) {
    if (out.ok) {
      console.log(JSON.stringify(envelope(out)));
    } else if (out.refused) {
      console.log(JSON.stringify(userErrorPayload(new UserActionableError(out.code, out.detail, { refused: true }))));
    } else {
      console.log(JSON.stringify(userErrorPayload(new UserActionableError(out.code, out.detail, { refused: false, wrote: out.wrote }))));
    }
  } else {
    console.log(renderInitOutcome(out));
  }
  if (!out.ok) process.exitCode = out.refused ? 2 : 1;
}
