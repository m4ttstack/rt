import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const REPO = join(import.meta.dir, "..", "..");
const SCRIPT = join(REPO, "scripts", "fetch-deps.sh");

let work: string;
let lockPath: string;
let depsRoot: string;

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

// execFileSync with an argv array, not a shell string: a checkout or TMPDIR
// path containing a space would otherwise split into separate arguments.
function runScript(env: Record<string, string> = {}): string {
  return execFileSync("bash", [SCRIPT, "arm64"], {
    encoding: "utf8",
    env: { ...process.env, RT_DEPS_LOCK: lockPath, RT_DEPS_ROOT: depsRoot, RT_DEPS_CACHE: join(work, "cache"), ...env },
  });
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "fetch-tree-"));
  depsRoot = join(work, "deps");

  const stage = join(work, "stage");
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "toolx"), "#!/bin/sh\necho toolx 1.0.0\n");
  chmodSync(join(stage, "toolx"), 0o755);
  const tgz = join(work, "toolx-darwin-arm64.tgz");
  execFileSync("tar", ["czf", tgz, "-C", stage, "toolx"]);
  const sha = execFileSync("shasum", ["-a", "256", tgz], { encoding: "utf8" }).split(" ")[0]!;

  lockPath = join(work, "deps.lock");
  writeFileSync(lockPath, JSON.stringify({
    schema: 1, arch: "arm64",
    tools: [
      {
        name: "deck", version: "", license: "MIT", source: "tree",
        archive: "raw", extract: "", bundlePath: "Contents/Helpers/deck", exec: ["Contents/Helpers/deck"],
        exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
      },
      {
        name: "toolx", version: "1.0.0", license: "MIT",
        url: `file://${tgz}`, sha256: sha,
        archive: "tar.gz", extract: "toolx",
        bundlePath: "Contents/Helpers/toolx", exec: ["Contents/Helpers/toolx"],
        exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
      },
    ],
  }));
});

test("a tree row is skipped rather than fetched, and the fetched row still lands", () => {
  const out = runScript();
  expect(out).toContain("built from this checkout");
  expect(existsSync(join(depsRoot, "arm64", "toolx"))).toBe(true);
  expect(existsSync(join(depsRoot, "arm64", "deck"))).toBe(false);
});
