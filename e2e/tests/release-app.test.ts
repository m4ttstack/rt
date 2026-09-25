/**
 * e2e: `rt release app <name> --dry-run --json` resolves a full plan from a
 * real rt checkout without touching anything remote. Git is real, pointed at
 * local bare repos: the checkout's origin is one, and the apps clone URL is
 * rewritten to another through the test HOME's .gitconfig. `gh` is a shim
 * that journals every argv and answers only the two read-only calls a dry run
 * makes, so any mutating call would fail loudly and show in the journal.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createTestHome, rt } from "../harness.ts";

const FAKE_GH = `#!/bin/bash
echo "$*" >> "$FAKE_GH_LOG"
case "$*" in
  "api repos/m4ttstack/apps/git/ref/heads/main --jq .object.sha")
    echo appshead ;;
  "api -H Accept: application/vnd.github.raw+json repos/m4ttstack/apps/contents/apps/board/package.json?ref=appshead")
    printf '%s' "$FAKE_BOARD_PACKAGE" ;;
  "api -H Accept: application/vnd.github.raw+json repos/m4ttstack/apps/contents/bun.lock?ref=appshead")
    printf '%s' "$FAKE_APPS_BUNLOCK" ;;
  "api repos/m4ttstack/apps/git/ref/tags/"*)
    echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;
  "api repos/m4ttstack/rt/actions/workflows/release.yml/runs?event=push&branch=v0.1.1&per_page=5")
    printf '%s' '{"workflow_runs":[{"id":1,"html_url":"https://github.com/m4ttstack/rt/actions/runs/1"}]}' ;;
  "run view 1 --repo m4ttstack/rt --json status,conclusion")
    printf '%s' '{"status":"completed","conclusion":"success"}' ;;
  "release view v0.1.1 --repo m4ttstack/rt --json body,assets,isDraft,isPrerelease,publishedAt")
    printf '%s' "$FAKE_RELEASE_VIEW" ;;
  "api repos/m4ttstack/rt/actions/workflows/bundle-apps.yml/runs?event=workflow_dispatch&per_page=20")
    printf '%s' '{"workflow_runs":[]}' ;;
  *)
    echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
esac
`;

const asset = (name: string, version: string) =>
  `https://github.com/m4ttstack/apps/releases/download/${name}-v${version}/${name}-darwin-arm64.tgz`;

function lock(board: string): string {
  const row = (name: string, version: string, serve?: object) => ({
    name, version, repo: "m4ttstack/apps", subdir: `apps/${name}`, url: asset(name, version),
    sha256: "0".repeat(64), status: "bundled", ...(serve ? { serve } : {}),
  });
  return JSON.stringify({ schema: 1, arch: "arm64", tools: [row("deck", "1.1.1"), row("board", board, { port: 11006, args: [] }), row("chat", "0.1.3", { port: 11002, args: [] })] }, null, 2);
}

describe("rt release app --dry-run", () => {
  let home: string;
  let cleanup: () => void;
  let checkout: string;
  let ghLog: string;
  let fakeBin: string;
  let rtBare: string;
  let appsBare: string;

  const git = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", ...args], { cwd, env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1" }, stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString();
  };

  beforeAll(() => {
    ({ path: home, cleanup } = createTestHome());

    const appsSeed = join(home, "apps-seed");
    appsBare = join(home, "apps.git");
    mkdirSync(join(appsSeed, "apps", "board"), { recursive: true });
    git(appsSeed, "init", "-q", "-b", "main");
    writeFileSync(join(appsSeed, "apps", "board", "package.json"), `{\n  "name": "board",\n  "version": "0.1.7"\n}\n`);
    git(appsSeed, "add", "-A");
    git(appsSeed, "commit", "-q", "-m", "board 0.1.7: serve a setup page (#156)");
    git(appsSeed, "tag", "board-v0.1.7");
    git(appsSeed, "tag", "chat-v0.1.3");
    git(appsSeed, "tag", "deck-v1.1.1");
    writeFileSync(join(appsSeed, "apps", "board", "index.ts"), "export {};\n");
    git(appsSeed, "add", "-A");
    git(appsSeed, "commit", "-q", "-m", "board: fix the header (#160)");
    git(home, "clone", "-q", "--bare", appsSeed, appsBare);
    appendFileSync(join(home, ".gitconfig"), `[url "file://${appsBare}"]\n\tinsteadOf = https://github.com/m4ttstack/apps.git\n[uploadpack]\n\tallowFilter = true\n`);

    const rtSeed = join(home, "rt-seed");
    rtBare = join(home, "rt.git");
    mkdirSync(join(rtSeed, "rt-tray"), { recursive: true });
    git(rtSeed, "init", "-q", "-b", "main");
    writeFileSync(join(rtSeed, "rt-tray", "deps.lock"), lock("0.1.6"));
    writeFileSync(join(rtSeed, "RELEASE_NOTES.md"), "v0.1.0 notes\n");
    git(rtSeed, "add", "-A");
    git(rtSeed, "commit", "-q", "-m", "first");
    git(rtSeed, "tag", "-a", "v0.1.0", "-m", "v0.1.0");
    writeFileSync(join(rtSeed, "rt-tray", "deps.lock"), lock("0.1.7"));
    writeFileSync(join(rtSeed, "RELEASE_NOTES.md"), "v0.1.1 notes\n");
    git(rtSeed, "commit", "-q", "-am", "pin board 0.1.7");
    git(rtSeed, "tag", "-a", "v0.1.1", "-m", "v0.1.1");
    git(home, "clone", "-q", "--bare", rtSeed, rtBare);
    checkout = join(home, "rt");
    git(home, "clone", "-q", rtBare, checkout);

    fakeBin = join(home, "fake-bin");
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, "gh"), FAKE_GH);
    chmodSync(join(fakeBin, "gh"), 0o755);
    ghLog = join(home, "gh.log");
    writeFileSync(ghLog, "");
  });

  afterAll(() => cleanup());

  test("resolves versions, tags and commands, and changes nothing", async () => {
    const pkg = `{\n  "name": "board",\n  "version": "0.1.7"\n}\n`;
    const bunDir = join(process.execPath, "..");
    const refsBefore = [git(home, "ls-remote", rtBare), git(home, "ls-remote", appsBare)];
    const assets = ["mattstack-0.1.1.dmg", "mattstack-0.1.1.zip", "appcast.xml", "SHA256SUMS"].map((name) => ({ name }));
    const result = await rt(["release", "app", "board", "--dry-run", "--json"], {
      home,
      cwd: checkout,
      env: {
        PATH: `${fakeBin}:${bunDir}:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`,
        FAKE_GH_LOG: ghLog,
        FAKE_BOARD_PACKAGE: pkg,
        FAKE_APPS_BUNLOCK: `{\n  "lockfileVersion": 1,\n  "workspaces": {\n    "apps/board": {\n      "name": "board",\n      "version": "0.1.7",\n    },\n  },\n}\n`,
        FAKE_RELEASE_VIEW: JSON.stringify({ body: "v0.1.1 notes\n", assets, isDraft: false, isPrerelease: false, publishedAt: "2026-09-25T00:00:00Z" }),
      },
    });

    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout) as {
      contract: number; status: string; lastTag: string; tag: string; appVersion: string; appTag: string;
      steps: { id: string; status: string; command?: string }[];
    };
    expect(body.contract).toBe(1);
    expect(body.status).toBe("planned");
    expect(body.lastTag).toBe("v0.1.1");
    expect(body.tag).toBe("v0.1.2");
    expect(body.appVersion).toBe("0.1.8");
    expect(body.appTag).toBe("board-v0.1.8");
    expect(body.steps.map((s) => `${s.id}:${s.status}`)).toEqual([
      "qualify:ok", "bump:planned", "bundle:planned", "pr:planned", "notes:planned", "tag:planned", "verify:planned",
    ]);
    expect(body.steps.find((s) => s.id === "bundle")!.command).toBe("gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref main -f apps=board -f dry_run=false");

    expect(readFileSync(ghLog, "utf8").trim().split("\n")).toEqual([
      "api repos/m4ttstack/apps/git/ref/heads/main --jq .object.sha",
      "api -H Accept: application/vnd.github.raw+json repos/m4ttstack/apps/contents/apps/board/package.json?ref=appshead",
      "api repos/m4ttstack/rt/actions/workflows/release.yml/runs?event=push&branch=v0.1.1&per_page=5",
      "run view 1 --repo m4ttstack/rt --json status,conclusion",
      "release view v0.1.1 --repo m4ttstack/rt --json body,assets,isDraft,isPrerelease,publishedAt",
      "api repos/m4ttstack/apps/git/ref/tags/board-v0.1.8",
      "api -H Accept: application/vnd.github.raw+json repos/m4ttstack/apps/contents/bun.lock?ref=appshead",
      "api repos/m4ttstack/rt/actions/workflows/bundle-apps.yml/runs?event=workflow_dispatch&per_page=20",
    ]);
    expect(git(checkout, "tag", "--list", "v0.1.2")).toBe("");
    expect([git(home, "ls-remote", rtBare), git(home, "ls-remote", appsBare)]).toEqual(refsBefore);
  });
});
