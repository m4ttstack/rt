/**
 * resolveMrTarget / resolveRepoTarget: the MCP layer's one place that turns
 * {repoName, iid, mrUrl} into the serialized identity and iid the daemon
 * verbs take. Runs against a temp HOME with a seeded repo index and machine
 * store, the same stores the CLI's --repo resolver reads.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { REPO_INDEX_NS } from "../../repo-index.ts";
import { machineSettingsPath } from "../../rt-paths.ts";
import { closeStateDb, setKvValue } from "../../state/index.ts";
import { parseMrUrl, resolveMrTarget, resolveRepoTarget } from "../mr-target.ts";

const APP = "remote:gitlab.example.com%2Facme%2Fapp";
const SUB = "remote:gitlab.example.com%2Facme%2Fplatform%2Fapp";
const URL_APP = "https://gitlab.example.com/acme/app/-/merge_requests/7";

describe("parseMrUrl", () => {
  test("plain, subgroup and suffixed URLs", () => {
    expect(parseMrUrl(URL_APP)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl("https://gitlab.example.com/acme/platform/app/-/merge_requests/12/diffs")).toEqual({ host: "gitlab.example.com", projectPath: "acme/platform/app", iid: 12 });
    expect(parseMrUrl(`${URL_APP}#note_5`)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl(`${URL_APP}?tab=pipelines`)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl(`${URL_APP}/diffs?commit_id=abc#x`)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
    expect(parseMrUrl(`  ${URL_APP}  `)).toEqual({ host: "gitlab.example.com", projectPath: "acme/app", iid: 7 });
  });

  test("refuses http, a missing iid, an issue URL and garbage", () => {
    expect(parseMrUrl("http://gitlab.example.com/acme/app/-/merge_requests/7")).toBeNull();
    expect(parseMrUrl("https://gitlab.example.com/acme/app/-/merge_requests/")).toBeNull();
    expect(parseMrUrl("https://gitlab.example.com/acme/app/-/issues/7")).toBeNull();
    expect(parseMrUrl("not a url")).toBeNull();
  });
});

function withTempHome(): void {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });
}

describe("resolveMrTarget", () => {
  withTempHome();

  test("a serialized identity and iid pass through", async () => {
    expect(await resolveMrTarget({ repoName: APP, iid: 7 })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("an absolute checkout path derives the identity from its origin remote", async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-repo-")));
    execSync("git init -q", { cwd: repo });
    execSync("git remote add origin https://gitlab.example.com/acme/app.git", { cwd: repo });
    expect(await resolveMrTarget({ repoName: repo, iid: 7 })).toEqual({ ok: true, identity: APP, iid: 7 });
    rmSync(repo, { recursive: true, force: true });
  });

  test("a label matching exactly one registered repo resolves", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ repoName: "app", iid: 7 })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("an ambiguous label is refused naming every match", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/a/app");
    setKvValue(REPO_INDEX_NS, SUB, "/repos/b/app");
    const res = await resolveMrTarget({ repoName: "app", iid: 7 });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain(APP);
      expect(res.error).toContain(SUB);
      expect(res.error).toContain("pass the full identity");
    }
  });

  test("an unknown label is refused", async () => {
    expect(await resolveMrTarget({ repoName: "nope", iid: 7 })).toEqual({
      ok: false,
      error: 'repoName "nope" did not match a registered repo; pass its serialized identity, an absolute checkout path, or the label of exactly one registered repo',
    });
  });

  test("mrUrl alone supplies the registered identity and the iid, through subgroups and suffixes", async () => {
    setKvValue(REPO_INDEX_NS, SUB, "/repos/app");
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/platform/app/-/merge_requests/12/diffs#note_3" }))
      .toEqual({ ok: true, identity: SUB, iid: 12 });
  });

  test("mrUrl goes through identityFromRemote, so a machine-store override applies", async () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({
      "rt.repoIdentityOverrides": { "https://gitlab.example.com/acme/fork": "gitlab.example.com/acme/app" },
    }));
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/fork/-/merge_requests/3" }))
      .toEqual({ ok: true, identity: APP, iid: 3 });
  });

  test("mrUrl for a repo rt has not registered is refused, never guessed", async () => {
    expect(await resolveMrTarget({ mrUrl: URL_APP })).toEqual({
      ok: false,
      error: `mrUrl names gitlab.example.com/acme/app (${APP}), which is not registered with rt; run rt repos register in its checkout first`,
    });
  });

  test("a repo pinned by an override keyed on its ssh remote resolves from its https MR URL through the checkout's origin", async () => {
    const checkout = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-fork-")));
    execSync("git init -q", { cwd: checkout });
    execSync("git remote add origin git@gitlab.example.com:acme/fork.git", { cwd: checkout });
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({
      "rt.repoIdentityOverrides": { "git@gitlab.example.com:acme/fork.git": "gitlab.example.com/acme/app" },
    }));
    setKvValue(REPO_INDEX_NS, APP, checkout);
    setKvValue(REPO_INDEX_NS, "remote:gitlab.example.com%2Facme%2Fgone", "/repos/no-longer-here");
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/fork/-/merge_requests/3" }))
      .toEqual({ ok: true, identity: APP, iid: 3 });
    rmSync(checkout, { recursive: true, force: true });
  });

  test("an MR URL whose origin matches two registered checkouts is refused as ambiguous, naming both", async () => {
    const a = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-a-")));
    const b = realpathSync(mkdtempSync(join(tmpdir(), "rt-mr-target-b-")));
    for (const dir of [a, b]) {
      execSync("git init -q", { cwd: dir });
      execSync("git remote add origin git@gitlab.example.com:acme/app.git", { cwd: dir });
    }
    const TEAM_A = "remote:gitlab.example.com%2Fteam-a%2Fapp";
    const TEAM_B = "remote:gitlab.example.com%2Fteam-b%2Fapp";
    setKvValue(REPO_INDEX_NS, TEAM_A, a);
    setKvValue(REPO_INDEX_NS, TEAM_B, b);
    const res = await resolveMrTarget({ mrUrl: URL_APP });
    expect(res).toEqual({ ok: false, error: `mrUrl matches more than one registered repo: ${TEAM_A}, ${TEAM_B}; pass repoName to pick one` });
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  });

  test("repoName and mrUrl that resolve to different repos are refused", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    setKvValue(REPO_INDEX_NS, SUB, "/repos/sub");
    expect(await resolveMrTarget({ repoName: SUB, mrUrl: URL_APP })).toEqual({
      ok: false,
      error: `repoName resolves to ${SUB} but mrUrl names ${APP}; pass one of them, or make them agree`,
    });
  });

  test("iid and mrUrl that disagree are refused", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ iid: 8, mrUrl: URL_APP })).toEqual({ ok: false, error: "iid 8 does not match mrUrl's merge request 7" });
  });

  test("a repoName, iid and mrUrl that agree resolve", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveMrTarget({ repoName: "app", iid: 7, mrUrl: URL_APP })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("neither repoName nor mrUrl is refused before any lookup", async () => {
    expect(await resolveMrTarget({ iid: 7 })).toEqual({ ok: false, error: 'pass "repoName" or "mrUrl"' });
    expect(await resolveMrTarget({ repoName: "   ", iid: 7 })).toEqual({ ok: false, error: 'pass "repoName" or "mrUrl"' });
  });

  test("repoName without iid or mrUrl is refused", async () => {
    expect(await resolveMrTarget({ repoName: APP })).toEqual({ ok: false, error: 'pass "iid" or "mrUrl"' });
  });

  test("wrong-shaped fields are refused naming the field", async () => {
    expect(await resolveMrTarget({ repoName: 5, iid: 7 })).toEqual({ ok: false, error: '"repoName" must be a string' });
    expect(await resolveMrTarget({ repoName: APP, iid: "7" })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await resolveMrTarget({ repoName: APP, iid: 0 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await resolveMrTarget({ repoName: APP, iid: 1.5 })).toEqual({ ok: false, error: '"iid" must be a positive integer' });
    expect(await resolveMrTarget({ mrUrl: 7 })).toEqual({ ok: false, error: '"mrUrl" must be a string' });
    expect(await resolveMrTarget({ mrUrl: "https://gitlab.example.com/acme/app/-/issues/7" })).toEqual({
      ok: false,
      error: "mrUrl must look like https://<host>/<group>/<project>/-/merge_requests/<iid>",
    });
  });
});

describe("resolveRepoTarget", () => {
  withTempHome();

  test("repoName alone resolves with no iid", async () => {
    expect(await resolveRepoTarget({ repoName: APP })).toEqual({ ok: true, identity: APP, iid: undefined });
  });

  test("mrUrl alone names the project and carries its iid", async () => {
    setKvValue(REPO_INDEX_NS, APP, "/repos/app");
    expect(await resolveRepoTarget({ mrUrl: URL_APP })).toEqual({ ok: true, identity: APP, iid: 7 });
  });

  test("neither is refused", async () => {
    expect(await resolveRepoTarget({})).toEqual({ ok: false, error: 'pass "repoName" or "mrUrl"' });
  });
});
