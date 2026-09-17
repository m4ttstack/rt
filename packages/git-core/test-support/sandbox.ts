import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface Sandbox {
  dir: string;
  git(args: string[]): Promise<string>;
  write(rel: string, content: string): Promise<void>;
  commitAll(message: string): Promise<void>;
  addBareRemote(name?: string): Promise<string>;
  cleanup(): Promise<void>;
}

const IDENTITY = [
  "-c", "user.email=test@example.com",
  "-c", "user.name=Test",
  "-c", "commit.gpgsign=false",
];

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...IDENTITY, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} exited ${code}: ${err || out}`);
  }
  return out;
}

export async function makeSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "git-core-sb-"));
  const dir = join(root, "repo");
  await mkdir(dir, { recursive: true });
  await runGit(dir, ["init", "-b", "main"]);
  return {
    dir,
    git: (args) => runGit(dir, args),
    write: async (rel, content) => {
      const abs = join(dir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
    },
    commitAll: async (message) => {
      await runGit(dir, ["add", "-A"]);
      await runGit(dir, ["commit", "-m", message]);
    },
    addBareRemote: async (name = "origin") => {
      const remoteDir = join(root, `${name}.git`);
      // A bare repo's HEAD symref still defaults to a real branch name (e.g. "main"),
      // which makes denyDeleteCurrent block deleting that branch once pushed. Point
      // it at a branch no test pushes, so any pushed branch is deletable.
      await runGit(root, ["init", "--bare", "-b", "__unused__", remoteDir]);
      await runGit(dir, ["remote", "add", name, remoteDir]);
      return remoteDir;
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
