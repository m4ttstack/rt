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

function runScript(): string {
  return execFileSync("bash", [SCRIPT, "arm64"], {
    encoding: "utf8",
    env: { ...process.env, RT_DEPS_LOCK: lockPath, RT_DEPS_ROOT: depsRoot, RT_DEPS_CACHE: join(work, "cache") },
  });
}

function pin(tag: string, withIdentity: boolean): void {
  const stage = join(work, `stage-${tag}`);
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "toolx"), `#!/bin/sh\necho toolx ${tag}\n`);
  chmodSync(join(stage, "toolx"), 0o755);
  const entries = ["toolx"];
  if (withIdentity) {
    mkdirSync(join(stage, "identity", "src"), { recursive: true });
    writeFileSync(join(stage, "identity", "mattstack.deck.json"), '{"name":"toolx"}\n');
    writeFileSync(join(stage, "identity", "src", "favicon.svg"), "<svg></svg>\n");
    entries.push("identity");
  }
  const tgz = join(work, `toolx-${tag}.tgz`);
  execFileSync("tar", ["czf", tgz, "-C", stage, ...entries]);
  const sha = execFileSync("shasum", ["-a", "256", tgz], { encoding: "utf8" }).split(" ")[0]!;
  writeFileSync(lockPath, JSON.stringify({
    schema: 1, arch: "arm64",
    tools: [{
      name: "toolx", version: tag, license: "MIT",
      url: `file://${tgz}`, sha256: sha,
      archive: "tar.gz", extract: "toolx",
      bundlePath: "Contents/Helpers/toolx", exec: ["Contents/Helpers/toolx"],
      exposeByDefault: false, entitlements: "none", status: "bundled", kind: "helper",
    }],
  }));
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "fetch-identity-"));
  depsRoot = join(work, "deps");
  lockPath = join(work, "deps.lock");
  pin("1.0.0", true);
});

test("identity is materialized beside the binary with its own stamp", () => {
  runScript();
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity", "mattstack.deck.json"))).toBe(true);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity", "src", "favicon.svg"))).toBe(true);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity.sha256"))).toBe(true);
});

test("a deleted identity dir re-materializes despite a valid stamp", () => {
  rmSync(join(depsRoot, "arm64", "toolx-identity"), { recursive: true });
  runScript();
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity", "mattstack.deck.json"))).toBe(true);
});

test("an unchanged run with both present is a skip", () => {
  expect(runScript()).toContain("already unpacked");
});

test("a new pin without identity clears the old identity and its stamp", () => {
  pin("1.0.1", false);
  runScript();
  expect(existsSync(join(depsRoot, "arm64", "toolx"))).toBe(true);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity"))).toBe(false);
  expect(existsSync(join(depsRoot, "arm64", "toolx-identity.sha256"))).toBe(false);
});
