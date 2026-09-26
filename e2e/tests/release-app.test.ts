/**
 * e2e: `rt release app <name> --json` resolves a plan, or stops for notes
 * approval, from a real rt checkout without touching anything remote. Git is
 * real, pointed at a local bare repo built fresh per test: the served apps
 * live under `apps/<name>/` in this same repo, so no separate apps clone is
 * needed. `gh` is a shim answering only the read-only snapshot qualify takes
 * of the last tag's publish (never a mutating call) before it looks at the
 * diff at all.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, rt } from "../harness.ts";

const LAST = "v0.1.0";

const FAKE_GH = `#!/bin/bash
case "$*" in
  "api repos/m4ttstack/rt/actions/workflows/release.yml/runs?event=push&branch=${LAST}&per_page=5")
    printf '%s' '{"workflow_runs":[{"id":1,"html_url":"https://github.com/m4ttstack/rt/actions/runs/1"}]}' ;;
  "run view 1 --repo m4ttstack/rt --json status,conclusion")
    printf '%s' '{"status":"completed","conclusion":"success"}' ;;
  "release view ${LAST} --repo m4ttstack/rt --json body,assets,isDraft,isPrerelease,publishedAt")
    printf '%s' '{"body":"v0.1.0 notes\\n","assets":[{"name":"mattstack-0.1.0.dmg"},{"name":"mattstack-0.1.0.zip"},{"name":"appcast.xml"},{"name":"SHA256SUMS"}],"isDraft":false,"isPrerelease":false,"publishedAt":"2026-09-25T00:00:00Z"}' ;;
  *)
    echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
esac
`;

interface ReleaseAppBody {
  contract: number;
  status: string;
  lastTag: string | null;
  nextTag: string | null;
  notesHash: string | null;
  notes: string | null;
  steps: { id: string; status: string; detail: string; command?: string }[];
}

describe("rt release app", () => {
  let home: string;
  let cleanup: () => void;
  let seq = 0;
  let fakeBin: string;

  const git = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { cwd, env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1" }, stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString();
  };

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());
    fakeBin = join(home, "fake-bin");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "gh"), FAKE_GH);
    chmodSync(join(fakeBin, "gh"), 0o755);
  });

  afterAll(() => cleanup());

  /** A fresh origin: `v0.1.0` on main (its own release verifying clean), then one more commit writing `extraFiles`. */
  function makeOrigin(extraFiles: Record<string, string>): { bare: string; checkout: string } {
    const n = seq++;
    const seed = join(home, `seed-${n}`);
    mkdirSync(join(seed, "apps", "board"), { recursive: true });
    writeFileSync(join(seed, "apps", "board", "index.ts"), "export {};\n");
    writeFileSync(join(seed, "RELEASE_NOTES.md"), "v0.1.0 notes\n");
    git(seed, "init", "-q", "-b", "main");
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "first");
    git(seed, "tag", "-a", LAST, "-m", LAST);

    for (const [path, content] of Object.entries(extraFiles)) {
      const full = join(seed, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "second");

    const bare = join(home, `origin-${n}.git`);
    git(home, "clone", "-q", "--bare", seed, bare);
    const checkout = join(home, `checkout-${n}`);
    git(home, "clone", "-q", bare, checkout);
    return { bare, checkout };
  }

  function runCli(args: string[], checkout: string) {
    const bunDir = join(process.execPath, "..");
    return rt(args, { home, cwd: checkout, env: { PATH: `${fakeBin}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin` } });
  }

  test("a fast-path diff plans notes, tag and verify one patch up, and changes nothing", async () => {
    const { bare, checkout } = makeOrigin({ "apps/board/x.ts": "export {};\n", "RELEASE_NOTES.md": "v0.1.1 notes\n" });
    const refsBefore = git(home, "ls-remote", bare);

    const result = await runCli(["release", "app", "board", "--dry-run", "--json"], checkout);

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout) as ReleaseAppBody;
    expect(body.contract).toBe(1);
    expect(body.status).toBe("planned");
    expect(body.lastTag).toBe(LAST);
    expect(body.nextTag).toBe("v0.1.1");
    expect(body.steps.map((s) => s.id)).toEqual(["qualify", "notes", "tag", "verify"]);
    expect(body.notes).toContain("### board");

    expect(git(home, "ls-remote", bare)).toBe(refsBefore);
    expect(git(checkout, "tag", "--list", "v0.1.1")).toBe("");
  });

  test("a diff that leaves the fast path is declined, naming the offending file", async () => {
    const { bare, checkout } = makeOrigin({ "apps/board/x.ts": "export {};\n", "lib/x.ts": "export {};\n" });
    const refsBefore = git(home, "ls-remote", bare);

    const result = await runCli(["release", "app", "board", "--dry-run", "--json"], checkout);

    expect(result.exitCode).toBe(1);
    const body = JSON.parse(result.stdout) as ReleaseAppBody;
    expect(body.status).toBe("declined");
    expect(body.steps[0]).toMatchObject({ id: "qualify", status: "stopped" });
    expect(body.steps[0]!.detail).toContain("lib/x.ts");

    expect(git(home, "ls-remote", bare)).toBe(refsBefore);
  });

  test("without --yes-notes a run stops for approval and writes nothing", async () => {
    const { bare, checkout } = makeOrigin({ "apps/board/x.ts": "export {};\n" });
    const refsBefore = git(home, "ls-remote", bare);
    const notesBefore = readFileSync(join(checkout, "RELEASE_NOTES.md"), "utf8");

    const result = await runCli(["release", "app", "board", "--json"], checkout);

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout) as ReleaseAppBody;
    expect(body.status).toBe("awaiting-approval");
    expect(body.notesHash).toMatch(/^[0-9a-f]{12}$/);
    expect(body.steps.find((s) => s.id === "notes")).toMatchObject({ status: "stopped" });

    expect(git(home, "ls-remote", bare)).toBe(refsBefore);
    expect(git(checkout, "log", "--format=%s", "origin/main")).toBe("second\nfirst\n");
    expect(readFileSync(join(checkout, "RELEASE_NOTES.md"), "utf8")).toBe(notesBefore);
  });
});
