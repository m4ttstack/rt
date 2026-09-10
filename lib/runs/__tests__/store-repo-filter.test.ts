/**
 * `resolveRunsRepoArg` (commands/runs.ts) against real on-disk run dirs.
 * commands/__tests__/runs.test.ts covers the CLI's daemon-payload shape with
 * a mocked daemon; this suite proves the derived display key actually names
 * the run dirs `listRuns` reads, and that an arg matching neither an index
 * entry nor a run dir errors instead of silently listing nothing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveRunsRepoArg, UnknownRunsRepo } from "../../../commands/runs.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { updateRepoIndex } from "../../repo-index.ts";
import { closeStateDb } from "../../state/index.ts";
import { listRuns, runsRoot } from "../store.ts";
import { runStart } from "../start.ts";
import { root as seedRunsRoot } from "./fixtures.ts";

const origHome = process.env.HOME;
const origCwd = process.cwd();
let home: string;
let reposRoot: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-runs-filter-home-")));
  reposRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-runs-filter-repos-")));
  process.env.HOME = home;
  closeStateDb();
  process.chdir(home);
});

afterEach(() => {
  process.chdir(origCwd);
  process.env.HOME = origHome;
  closeStateDb();
  rmSync(home, { recursive: true, force: true });
  rmSync(reposRoot, { recursive: true, force: true });
  delete process.env.RT_RUNS_ROOT;
});

function makeGitRepo(name: string, remote: string): string {
  const dir = realpathSync(mkdtempSync(join(reposRoot, `${name}-`)));
  execSync("git init -q -b main", { cwd: dir });
  execSync(`git remote add origin ${remote}`, { cwd: dir });
  return dir;
}

describe("resolveRunsRepoArg against real run dirs", () => {
  test("a resolved identity's display key lists the same runs as the raw display key", async () => {
    seedRunsRoot();

    const repoPath = makeGitRepo("acme-dev", "git@gitlab.com:acme/acme-dev.git");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    updateRepoIndex(identity, repoPath);

    // The convention observed on disk for pre-cutover run dirs: the raw
    // host/path id with "/" flattened to "-".
    const displayKey = "gitlab.com-acme-acme-dev";
    const started = runStart(runsRoot(), { repo: displayKey, workType: "feature", pipeline: "default", now: 1000 });
    expect(started.ok).toBe(true);

    const resolved = await resolveRunsRepoArg("acme-dev");
    expect(resolved).toBe(displayKey);

    const viaResolvedArg = listRuns(resolved);
    const viaRawDisplayKey = listRuns(displayKey);
    expect(viaResolvedArg).toHaveLength(1);
    expect(viaResolvedArg.map((r) => r.id)).toEqual(viaRawDisplayKey.map((r) => r.id));
  });

  test("an arg matching neither an index entry nor a run dir errors instead of listing nothing", async () => {
    seedRunsRoot();

    await expect(resolveRunsRepoArg("definitely-not-a-repo")).rejects.toThrow(UnknownRunsRepo);
    await expect(resolveRunsRepoArg("definitely-not-a-repo")).rejects.toThrow("unknown repo: definitely-not-a-repo");
  });

  test("an unresolvable arg naming an existing run dir is forwarded verbatim (pre-cutover key)", async () => {
    const runsDir = seedRunsRoot();
    mkdirSync(join(runsDir, "legacy-run-dir-name"), { recursive: true });

    const resolved = await resolveRunsRepoArg("legacy-run-dir-name");
    expect(resolved).toBe("legacy-run-dir-name");
  });
});
