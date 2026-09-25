import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

/** The purity gate must catch a banned term in file CONTENT, in a file NAME,
    and in a COMMIT MESSAGE — each class leaked for real before it was added
    here. The banned term is assembled from fragments so this test file itself
    stays clean of it. */
const TERM = ["ass", "ured"].join("");
const SCRIPT = join(import.meta.dir, "../../scripts/repo-purity.sh");

function fixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "purity-fixture-"));
  execSync("git init -q .", { cwd: dir });
  execSync("git config user.email t@example.com && git config user.name t", { cwd: dir });
  mkdirSync(join(dir, "scripts"));
  cpSync(SCRIPT, join(dir, "scripts/repo-purity.sh"));
  writeFileSync(join(dir, "clean.md"), "a clean file about acme things\n");
  execSync("git add -A && git commit -qm 'clean baseline'", { cwd: dir });
  return dir;
}

function run(dir: string, env: Record<string, string> = {}): { code: number; out: string } {
  try {
    const out = execSync("sh scripts/repo-purity.sh 2>&1", { cwd: dir, env: { ...process.env, ...env } });
    return { code: 0, out: out.toString() };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString() };
  }
}

describe("repo-purity.sh", () => {
  test("clean tree passes", () => {
    const dir = fixtureRepo();
    expect(run(dir).code).toBe(0);
  });

  test("banned term in file content fails", () => {
    const dir = fixtureRepo();
    writeFileSync(join(dir, "doc.md"), `mentions ${TERM} explicitly\n`);
    execSync("git add -A", { cwd: dir });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("doc.md");
  });

  test("banned term in a FILE NAME fails even with clean content", () => {
    const dir = fixtureRepo();
    writeFileSync(join(dir, `${TERM}-notes.md`), "entirely clean content\n");
    execSync("git add -A", { cwd: dir });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${TERM}-notes.md`);
  });

  test("banned term in a COMMIT MESSAGE on the checked range fails", () => {
    const dir = fixtureRepo();
    writeFileSync(join(dir, "ok.md"), "clean\n");
    execSync(`git add -A && git commit -qm 'touch ${TERM} config'`, { cwd: dir });
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out.toLowerCase()).toContain("commit message");
  });

  test("a banned message at or before PURITY_BASE is already public and not judged", () => {
    const dir = fixtureRepo();
    execSync(`git commit -q --allow-empty -m 'touch ${TERM} config'`, { cwd: dir });
    const base = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    execSync("git commit -q --allow-empty -m 'clean follow-up'", { cwd: dir });
    expect(run(dir, { PURITY_BASE: base }).code).toBe(0);
  });

  test("a banned message after PURITY_BASE fails", () => {
    const dir = fixtureRepo();
    const base = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    execSync(`git commit -q --allow-empty -m 'touch ${TERM} config'`, { cwd: dir });
    const r = run(dir, { PURITY_BASE: base });
    expect(r.code).toBe(1);
    expect(r.out.toLowerCase()).toContain("commit message");
  });

  test("an unresolvable base warns and still judges the newest 30", () => {
    const dir = fixtureRepo();
    execSync(`git commit -q --allow-empty -m 'touch ${TERM} config'`, { cwd: dir });
    for (let i = 0; i < 3; i++) execSync(`git commit -q --allow-empty -m 'clean ${i}'`, { cwd: dir });
    const r = run(dir, { PURITY_BASE: "0000000000000000000000000000000000000000" });
    expect(r.code).toBe(1);
    expect(r.out).toContain("does not resolve");
  });

  test("a banned term in the PR title or body fails; clean PR text passes", () => {
    const dir = fixtureRepo();
    const base = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    const bad = run(dir, { PURITY_BASE: base, PURITY_PR_TEXT: `fix the ${TERM} importer` });
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("pull request title or body");
    expect(run(dir, { PURITY_BASE: base, PURITY_PR_TEXT: "fix the acme importer" }).code).toBe(0);
  });
});
