import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runWriteVerb } from "../../../commands/runs-write.ts";

function scratch(): { root: string; tree: string; elsewhere: string } {
  const base = mkdtempSync(join(tmpdir(), "runs-cwd-"));
  const tree = join(base, "tree");
  const elsewhere = join(base, "elsewhere");
  mkdirSync(tree);
  mkdirSync(elsewhere);
  return { root: join(base, "runs"), tree, elsewhere };
}

describe("runWriteVerb cwd", () => {
  test("resolves the run by the cwd argument, not process.cwd()", async () => {
    const { root, tree, elsewhere } = scratch();
    const env = { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const started = await runWriteVerb("run-start", ["--repo", "r", "--work-type", "w", "--pipeline", "p"], env);
    const runDb = JSON.parse(started.out).runDb as string;
    const set = await runWriteVerb("field", ["set", "worktree", tree, "--stage", "provision"], { ...env, RT_RUN_DB: runDb });
    expect(set.code).toBe(0);

    const inTree = await runWriteVerb("snapshot", [], env, tree);
    expect(inTree.code).toBe(0);
    expect(JSON.parse(inTree.out).runDbResolved).toBe("worktree");

    const outside = await runWriteVerb("snapshot", [], env, elsewhere);
    expect(outside.code).toBe(2);
  });
});
