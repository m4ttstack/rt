import { describe, expect, test } from "bun:test";
import { appAssetUrl, runReleaseApp, type ReleaseAppOptions, type ReleaseAppSeams } from "../release-app.ts";
import type { RunResult } from "../../subprocess.ts";

const LAST = "v2.13.1";
const PREV = "v2.13.0";
const ASSET_SHA = "a".repeat(64);
const SIGNED = "Executable=/work/board-extract/board\nIdentifier=com.mattstack.helper.board\nAuthority=Developer ID Application: M (X)\nAuthority=Apple Root CA\n";
const RUN_TOOLS: Record<string, { subdir: string; serve?: object }> = {
  deck: { subdir: "apps/deck" },
  board: { subdir: "apps/board", serve: { port: 11006, args: [] } },
  chat: { subdir: "apps/chat", serve: { port: 11002, args: [] } },
};

function lockText(versions: Record<string, string>, shas: Record<string, string> = {}): string {
  const tools = Object.entries(RUN_TOOLS).map(([name, t]) => ({
    name, version: versions[name]!, repo: "m4ttstack/apps", subdir: t.subdir,
    url: appAssetUrl(name, versions[name]!), sha256: shas[name] ?? "0".repeat(64), status: "bundled",
    ...(t.serve ? { serve: t.serve } : {}),
  }));
  return JSON.stringify({ schema: 1, arch: "arm64", tools }, null, 2);
}

const BASE_VERSIONS = { deck: "1.1.1", board: "0.1.7", chat: "0.1.3" };

interface Commit { sha: string; parent: string | null; files: string[]; lock: string; notes: string }
interface Run { id: number; workflow: "bundle" | "release"; status: string; conclusion: string | null; created_at: string; html_url: string; jobs: string[]; tag?: string }
interface Pr { number: number; state: string; url: string; headRefOid: string; headRefName: string; files: string[]; lock: string; base: string }

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const err = (stderr: string, exitCode = 1): RunResult => ({ stdout: "", stderr, exitCode });

/** A stateful stand-in for the rt checkout, GitHub (rt and apps) and the apps clone. */
class World {
  commits = new Map<string, Commit>();
  main: string;
  localTags = new Map<string, string>();
  remoteTags = new Map<string, string>();
  appsVersion = "0.1.7";
  appsTags = new Set(["board-v0.1.6", "board-v0.1.7", "chat-v0.1.3"]);
  /** Pin tags that apps/<app> has moved past on apps main. */
  appsMovedSince = new Set(["board-v0.1.7"]);
  appsSubjects = ["board: serve a setup page (#156)", "board: tidy the header"];
  runs = new Map<number, Run>();
  prs: Pr[] = [];
  checks: { name: string; bucket: string }[][] = [[{ name: "checks", bucket: "pass" }, { name: "CodeRabbit", bucket: "pending" }]];
  codesign = SIGNED;
  assetSha = ASSET_SHA;
  bundleConclusion = "success";
  releaseConclusion = "success";
  prMutate: ((pr: Pr) => void) | null = null;
  patchFails = false;
  tagPushFails = false;
  written = new Map<string, string>();
  calls: string[] = [];
  logs: string[] = [];
  confirmAnswer = true;
  confirmPrompts: string[] = [];
  clock = Date.parse("2026-09-25T15:00:00Z");
  private seq = 100;

  constructor() {
    this.commit("c0", null, [], lockText({ ...BASE_VERSIONS, board: "0.1.6" }), "prev notes\n");
    this.commit("c1", "c0", ["rt-tray/deps.lock", "RELEASE_NOTES.md"], lockText(BASE_VERSIONS), "last notes\n");
    this.main = "c1";
    for (const [t, c] of [[PREV, "c0"], [LAST, "c1"]] as const) {
      this.localTags.set(t, c);
      this.remoteTags.set(t, c);
    }
  }

  commit(sha: string, parent: string | null, files: string[], lock: string, notes: string): Commit {
    const c = { sha, parent, files, lock, notes };
    this.commits.set(sha, c);
    return c;
  }

  /** Lands a commit on main. */
  land(files: string[], edit: Partial<Pick<Commit, "lock" | "notes">> = {}): string {
    const parent = this.commits.get(this.main)!;
    const sha = `c${this.seq++}`;
    this.commit(sha, this.main, files, edit.lock ?? parent.lock, edit.notes ?? parent.notes);
    this.main = sha;
    return sha;
  }

  resolve(ref: string): Commit | undefined {
    if (ref === "origin/main") return this.commits.get(this.main);
    return this.commits.get(this.localTags.get(ref) ?? ref);
  }

  /** Commits in a..b, newest first. */
  range(a: string, b: string): Commit[] {
    const stop = this.resolve(a)?.sha;
    const out: Commit[] = [];
    for (let c = this.resolve(b); c && c.sha !== stop; c = c.parent ? this.commits.get(c.parent) : undefined) out.push(c);
    return out;
  }

  sortedLocalTags(): string[] {
    return [...this.localTags.keys()].sort((x, y) => (x < y ? 1 : -1));
  }

  private pkgText(): string {
    return `{\n  "name": "board",\n  "version": "${this.appsVersion}",\n  "private": true\n}\n`;
  }

  private dispatch(apps: string): RunResult {
    const id = this.seq++;
    const run: Run = {
      id, workflow: "bundle", status: "completed", conclusion: this.bundleConclusion,
      created_at: new Date(this.clock).toISOString(), html_url: `https://github.com/m4ttstack/rt/actions/runs/${id}`,
      jobs: ["plan", `build (${apps}, m4ttstack/apps, apps/${apps})`],
    };
    this.runs.set(id, run);
    if (this.bundleConclusion === "success") {
      this.appsTags.add(`${apps}-v${this.appsVersion}`);
      const current = JSON.parse(this.commits.get(this.main)!.lock) as { tools: { name: string; version: string }[] };
      const versions = Object.fromEntries(current.tools.map((t) => [t.name, t.version]));
      const pr: Pr = {
        number: id + 1000, state: "OPEN", url: `https://github.com/m4ttstack/rt/pull/${id + 1000}`,
        headRefOid: `prhead${id}`, headRefName: `bundle-ci/${id}`, files: ["rt-tray/deps.lock"],
        lock: lockText({ ...versions, [apps]: this.appsVersion }, { [apps]: ASSET_SHA }), base: this.main,
      };
      this.prMutate?.(pr);
      this.prs.push(pr);
    }
    return ok("");
  }

  exec = async (argv: [string, ...string[]]): Promise<RunResult> => {
    const cmd = argv.join(" ");
    this.calls.push(cmd);
    let m: RegExpMatchArray | null;

    if (cmd === "git fetch --quiet --tags origin main") {
      for (const [t, c] of this.remoteTags) this.localTags.set(t, c);
      return ok();
    }
    if (cmd === "git tag --list v* --sort=-version:refname") return ok(this.sortedLocalTags().join("\n") + "\n");
    if (cmd === "git rev-parse origin/main") return ok(`${this.main}\n`);
    if ((m = cmd.match(/^git show (\S+):(\S+)$/))) {
      const c = this.resolve(m[1]!);
      if (!c) return err(`bad ref ${m[1]}`);
      return ok(m[2] === "rt-tray/deps.lock" ? c.lock : c.notes);
    }
    if ((m = cmd.match(/^git diff --name-only (\S+)\.\.(\S+)$/))) {
      return ok([...new Set(this.range(m[1]!, m[2]!).flatMap((c) => c.files))].join("\n"));
    }
    if ((m = cmd.match(/^git log -1 --format=%H (\S+)\.\.origin\/main -- (\S+)$/))) {
      return ok(this.range(m[1]!, "origin/main").find((c) => c.files.includes(m![2]!))?.sha ?? "");
    }
    if ((m = cmd.match(/^git merge-base --is-ancestor (\S+) (\S+)$/))) {
      return this.range("none", m[2]!).some((c) => c.sha === m![1]) ? ok() : err("", 1);
    }
    if ((m = cmd.match(/^git rev-parse (\S+)\^\{tree\}$/))) return ok(`tree-${m[1]}\n`);
    if ((m = cmd.match(/^git rev-parse -q --verify refs\/tags\/(\S+)\^\{commit\}$/))) {
      const c = this.localTags.get(m[1]!);
      return c ? ok(`${c}\n`) : err("", 1);
    }
    if ((m = cmd.match(/^git rev-parse (\S+)\^\{commit\}$/))) {
      const c = this.resolve(m[1]!);
      return c ? ok(`${c.sha}\n`) : err("bad ref");
    }
    if ((m = cmd.match(/^git tag -a (\S+) (\S+) -m \S+$/))) {
      this.localTags.set(m[1]!, m[2]!);
      return ok();
    }
    if ((m = cmd.match(/^git ls-remote --tags origin refs\/tags\/(\S+) refs\/tags\/\S+\^\{\}$/))) {
      const c = this.remoteTags.get(m[1]!);
      return ok(c ? `tagobj\trefs/tags/${m[1]}\n${c}\trefs/tags/${m[1]}^{}\n` : "");
    }
    if ((m = cmd.match(/^git push origin refs\/tags\/(\S+)$/))) {
      if (this.tagPushFails) return err("remote rejected");
      const tag = m[1]!;
      this.remoteTags.set(tag, this.localTags.get(tag)!);
      const id = this.seq++;
      this.runs.set(id, {
        id, workflow: "release", status: "completed", conclusion: this.releaseConclusion, tag,
        created_at: new Date(this.clock).toISOString(), html_url: `https://github.com/m4ttstack/rt/actions/runs/${id}`, jobs: [],
      });
      return ok();
    }

    if (cmd.startsWith("git clone --bare --filter=blob:none --quiet https://github.com/m4ttstack/apps.git ")) return ok();
    if (/^git --git-dir \S+ fetch --quiet origin /.test(cmd)) return ok();
    if ((m = cmd.match(/^git --git-dir \S+ rev-list --count (\S+)\.\.main -- apps\/(\S+)$/))) return ok(this.appsMovedSince.has(m[1]!) ? "3\n" : "0\n");
    if ((m = cmd.match(/^git --git-dir \S+ log --no-merges --format=%s (\S+)\.\.(\S+) -- apps\/(\S+)$/))) {
      const [, , to, app] = m;
      if (!this.appsTags.has(to!)) return err(`unknown revision ${to}`);
      const version = to!.slice(`${app}-v`.length);
      const subjects = app === "board" ? this.appsSubjects : [`${app}: a fix (#9)`];
      return ok([...subjects, `${app} ${version}: version bump for the rt release`].join("\n") + "\n");
    }

    if (cmd === "gh api repos/m4ttstack/apps/contents/apps/board/package.json?ref=main") {
      return ok(JSON.stringify({ content: Buffer.from(this.pkgText()).toString("base64"), sha: `pkg-${this.appsVersion}` }));
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/apps\/git\/ref\/tags\/(\S+)$/))) {
      return this.appsTags.has(m[1]!) ? ok("{}") : err("gh: Not Found (HTTP 404)");
    }
    if (cmd.startsWith("gh api -X PUT repos/m4ttstack/apps/contents/apps/board/package.json ")) {
      const content = argv.find((a) => a.startsWith("content="))!.slice("content=".length);
      this.appsVersion = (JSON.parse(Buffer.from(content, "base64").toString("utf8")) as { version: string }).version;
      return ok("bumpcommit\n");
    }
    if (cmd === "gh api repos/m4ttstack/rt/actions/workflows/bundle-apps.yml/runs?event=workflow_dispatch&per_page=10") {
      const runs = [...this.runs.values()].filter((r) => r.workflow === "bundle").reverse();
      return ok(JSON.stringify({ workflow_runs: runs.map(({ id, status, conclusion, created_at, html_url }) => ({ id, status, conclusion, created_at, html_url })) }));
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/actions\/runs\/(\d+)\/jobs\?per_page=100 --jq \[\.jobs\[\]\.name\]$/))) {
      return ok(JSON.stringify(this.runs.get(Number(m[1]))?.jobs ?? []));
    }
    if (cmd.startsWith("gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref main -f apps=")) {
      return this.dispatch(argv[argv.indexOf("-f") + 1]!.slice("apps=".length));
    }
    if ((m = cmd.match(/^gh run view (\d+) --repo m4ttstack\/rt --json status,conclusion$/))) {
      const r = this.runs.get(Number(m[1]));
      return r ? ok(JSON.stringify({ status: r.status, conclusion: r.conclusion })) : err("no run");
    }
    if ((m = cmd.match(/^gh pr list --repo m4ttstack\/rt --head (\S+) --state all --json number,state,url,headRefOid,headRefName$/))) {
      return ok(JSON.stringify(this.prs.filter((p) => p.headRefName === m![1])));
    }
    if (cmd === "gh pr list --repo m4ttstack/rt --state open --json number,state,url,headRefOid,headRefName --limit 50") {
      return ok(JSON.stringify(this.prs.filter((p) => p.state === "OPEN")));
    }
    if ((m = cmd.match(/^gh pr view (\d+) --repo m4ttstack\/rt --json files --jq \[\.files\[\]\.path\]$/))) {
      return ok(JSON.stringify(this.prs.find((p) => p.number === Number(m![1]))!.files));
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/compare\/main\.\.\.(\S+) --jq \.merge_base_commit\.sha$/))) {
      return ok(`${this.prs.find((p) => p.headRefOid === m![1])!.base}\n`);
    }
    if ((m = cmd.match(/^gh api -H Accept: application\/vnd\.github\.raw\+json repos\/m4ttstack\/rt\/contents\/rt-tray\/deps\.lock\?ref=(\S+)$/))) {
      const pr = this.prs.find((p) => p.headRefOid === m![1]);
      return ok(pr ? pr.lock : this.commits.get(m[1]!)!.lock);
    }
    if ((m = cmd.match(/^gh pr checks (\d+) --repo m4ttstack\/rt --json name,bucket$/))) {
      const checks = this.checks.length > 1 ? this.checks.shift()! : this.checks[0]!;
      return { stdout: JSON.stringify(checks), stderr: "", exitCode: checks.some((c) => c.bucket === "pending") ? 8 : 0 };
    }
    if ((m = cmd.match(/^gh pr merge (\d+) --repo m4ttstack\/rt --squash --match-head-commit (\S+)$/))) {
      const pr = this.prs.find((p) => p.number === Number(m![1]))!;
      pr.state = "MERGED";
      this.land(["rt-tray/deps.lock"], { lock: pr.lock });
      return ok();
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/git\/trees --input (\S+) --jq \.sha$/))) {
      const body = JSON.parse(this.written.get(m[1]!)!) as { base_tree: string; tree: { path: string; content: string }[] };
      this.written.set("tree-new", JSON.stringify(body));
      return ok("tree-new\n");
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/git\/commits --input (\S+) --jq \.sha$/))) {
      const body = JSON.parse(this.written.get(m[1]!)!) as { message: string; parents: string[] };
      const tree = JSON.parse(this.written.get("tree-new")!) as { tree: { content: string }[] };
      const parent = this.commits.get(body.parents[0]!)!;
      const sha = `n${this.seq++}`;
      this.commit(sha, parent.sha, ["RELEASE_NOTES.md"], parent.lock, tree.tree[0]!.content);
      this.written.set(`message-${sha}`, body.message);
      return ok(`${sha}\n`);
    }
    if ((m = cmd.match(/^gh api -X PATCH repos\/m4ttstack\/rt\/git\/refs\/heads\/main --input (\S+)$/))) {
      const body = JSON.parse(this.written.get(m[1]!)!) as { sha: string; force: boolean };
      const c = this.commits.get(body.sha)!;
      if (this.patchFails || c.parent !== this.main || body.force !== false) return err("gh: Update is not a fast forward (HTTP 422)");
      this.main = c.sha;
      return ok("{}");
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/actions\/workflows\/release\.yml\/runs\?event=push&branch=(\S+)&per_page=5$/))) {
      const runs = [...this.runs.values()].filter((r) => r.workflow === "release" && r.tag === m![1]);
      return ok(JSON.stringify({ workflow_runs: runs.map((r) => ({ id: r.id, html_url: r.html_url })) }));
    }
    if ((m = cmd.match(/^gh release view (\S+) --repo m4ttstack\/rt --json body,assets,isDraft,isPrerelease,publishedAt$/))) {
      const tag = m[1]!;
      if (!this.remoteTags.has(tag)) return err("release not found");
      return ok(JSON.stringify({ body: this.commits.get(this.remoteTags.get(tag)!)!.notes, assets: this.assets(tag), isDraft: false, isPrerelease: false, publishedAt: new Date(this.clock).toISOString() }));
    }

    if ((m = cmd.match(/^mkdir -p (\S+)$/))) return ok();
    if ((m = cmd.match(/^tar -xzf (\S+) -C (\S+)$/))) return ok();
    if ((m = cmd.match(/^codesign -dvv (\S+)$/))) return { stdout: "", stderr: this.codesign, exitCode: 0 };
    return err(`unexpected command: ${cmd}`);
  };

  assets(tag: string): { name: string }[] {
    const ver = tag.slice(1);
    return [{ name: `mattstack-${ver}.dmg` }, { name: `mattstack-${ver}.zip` }, { name: "appcast.xml" }, { name: "SHA256SUMS" }];
  }

  latestTag(): string {
    return [...this.remoteTags.keys()].sort((x, y) => (x < y ? 1 : -1))[0]!;
  }

  seams(overrides: Partial<ReleaseAppSeams> = {}): ReleaseAppSeams {
    return {
      repoRoot: "/repo",
      exec: this.exec,
      fetchJson: async () => ({ tag_name: this.latestTag(), assets: this.assets(this.latestTag()) }),
      now: () => this.clock,
      sleep: async (ms) => { this.clock += ms; },
      isTTY: false,
      workDir: () => "/work",
      readFile: () => null,
      writeFile: (path, text) => { this.written.set(path, text); },
      download: async (url, dest) => { this.calls.push(`download ${url} ${dest}`); },
      sha256File: async () => this.assetSha,
      confirm: async (message) => { this.confirmPrompts.push(message); return this.confirmAnswer; },
      log: (line) => { this.logs.push(line); },
      ...overrides,
    };
  }
}

const opts = (o: Partial<ReleaseAppOptions> = {}): ReleaseAppOptions => ({ name: "board", dryRun: false, json: false, yesNotes: true, ...o });

const MUTATING = [/^gh api -X PUT /, /^gh workflow run /, /^gh pr merge /, /^gh api -X PATCH /, /git\/trees/, /git\/commits/, /^git tag -a /, /^git push /];
const mutations = (w: World) => w.calls.filter((c) => MUTATING.some((re) => re.test(c)));

describe("runReleaseApp: a fresh release", () => {
  test("bumps, bundles, verifies and merges the PR, commits notes, tags and verifies", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts());

    expect(r.status).toBe("released");
    expect(r.steps.map((s) => [s.id, s.status])).toEqual([
      ["qualify", "ok"], ["bump", "ok"], ["bundle", "ok"], ["pr", "ok"], ["notes", "ok"], ["tag", "ok"], ["verify", "ok"],
    ]);
    expect(r.tag).toBe("v2.13.2");
    expect(r.appVersion).toBe("0.1.8");
    expect(r.appTag).toBe("board-v0.1.8");
    expect(w.appsVersion).toBe("0.1.8");
    expect(w.prs[0]!.state).toBe("MERGED");
    expect(w.localTags.get("v2.13.2")).toBe(w.main);
    expect(w.remoteTags.get("v2.13.2")).toBe(w.main);
    expect(r.notes).toContain("### Board 0.1.8");
    expect(r.notes).toContain("- board: serve a setup page (m4ttstack/apps#156)");
    expect(r.notes).not.toContain("version bump for the rt release");
    expect(r.notes).toContain("compare/v2.13.1...v2.13.2");
    expect(w.commits.get(w.main)!.notes).toBe(r.notes!);
    expect(w.written.get(`message-${w.main}`)).toBe("chore(release): notes for v2.13.2 (board 0.1.8)");
    expect(w.calls.some((c) => c.startsWith("download https://github.com/m4ttstack/apps/releases/download/board-v0.1.8/board-darwin-arm64.tgz"))).toBe(true);
    expect(r.verify?.clean).toBe(true);
    expect(r.resume).toBeNull();
  });

  test("the notes commit is a fast-forward of the verified main, never forced", async () => {
    const w = new World();
    await runReleaseApp(w.seams(), opts());
    const patch = [...w.written.entries()].find(([, v]) => v.includes('"force"'));
    expect(JSON.parse(patch![1])).toEqual({ sha: w.main, force: false });
  });

  test("CodeRabbit never holds the merge and a pending check is waited out", async () => {
    const w = new World();
    w.checks = [
      [{ name: "checks", bucket: "pending" }, { name: "CodeRabbit", bucket: "pending" }],
      [{ name: "checks", bucket: "pass" }, { name: "CodeRabbit", bucket: "pending" }],
    ];
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
    expect(w.calls.filter((c) => c.startsWith("gh pr checks")).length).toBe(2);
  });
});

describe("runReleaseApp: --dry-run", () => {
  test("resolves the whole plan and changes nothing", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(r.status).toBe("planned");
    expect(r.steps.map((s) => [s.id, s.status])).toEqual([
      ["qualify", "ok"], ["bump", "planned"], ["bundle", "planned"], ["pr", "planned"], ["notes", "planned"], ["tag", "planned"], ["verify", "planned"],
    ]);
    expect(r.tag).toBe("v2.13.2");
    expect(r.appVersion).toBe("0.1.8");
    expect(r.steps.find((s) => s.id === "bundle")!.command).toBe("gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref main -f apps=board -f dry_run=false");
    expect(r.steps.find((s) => s.id === "tag")!.command).toContain("git push origin refs/tags/v2.13.2");
    expect(mutations(w)).toEqual([]);
    expect(w.appsVersion).toBe("0.1.7");
  });

  test("a dry run of a half-finished release marks the finished steps done", async () => {
    const w = new World();
    w.checks = [[{ name: "checks", bucket: "fail" }]];
    await runReleaseApp(w.seams(), opts());
    const calls = w.calls.length;
    const r = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(r.steps.map((s) => [s.id, s.status])).toEqual([
      ["qualify", "ok"], ["bump", "done"], ["bundle", "done"], ["pr", "planned"], ["notes", "planned"], ["tag", "planned"], ["verify", "planned"],
    ]);
    expect(mutations({ ...w, calls: w.calls.slice(calls) } as World)).toEqual([]);
  });
});

describe("runReleaseApp: qualification", () => {
  test("a change outside the pin allowlist refuses and points at the full release", async () => {
    const w = new World();
    w.land(["lib/team/invite.ts"]);
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("failed");
    expect(r.steps.at(-1)).toMatchObject({ id: "qualify", status: "failed" });
    expect(r.steps.at(-1)!.detail).toContain("lib/team/invite.ts");
    expect(r.steps.at(-1)!.detail).toContain("/rt:release");
    expect(mutations(w)).toEqual([]);
  });

  test("an unreleased serve-only pin on main is allowed alongside", async () => {
    const w = new World();
    w.land(["rt-tray/deps.lock"], { lock: lockText({ ...BASE_VERSIONS, chat: "0.1.4" }) });
    w.appsTags.add("chat-v0.1.4");
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
    expect(r.notes).toContain("A patch release that ships board 0.1.8 and chat 0.1.4.");
  });

  test("deck is refused because its pin keeps the full gate", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts({ name: "deck" }));
    expect(r.steps.at(-1)).toMatchObject({ id: "qualify", status: "failed" });
    expect(r.steps.at(-1)!.detail).toContain("full gate");
  });

  test("an existing tag for the next app version is refused", async () => {
    const w = new World();
    w.appsTags.add("board-v0.1.8");
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.at(-1)).toMatchObject({ id: "qualify", status: "failed" });
    expect(r.steps.at(-1)!.detail).toContain("board-v0.1.8 already exists");
    expect(mutations(w)).toEqual([]);
  });

  test("an app with no commits since its pin and no pending release is refused as empty", async () => {
    const w = new World();
    w.appsMovedSince.clear();
    w.commits.get("c0")!.lock = lockText(BASE_VERSIONS);
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.at(-1)!.detail).toContain("nothing to release");
  });
});

describe("runReleaseApp: resume", () => {
  test("a version a human already bumped past the pin is built as is, with no bump", async () => {
    const w = new World();
    w.appsVersion = "0.1.9";
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
    expect(r.steps.find((s) => s.id === "bump")!.status).toBe("done");
    expect(r.appVersion).toBe("0.1.9");
    expect(w.calls.some((c) => c.startsWith("gh api -X PUT"))).toBe(false);
  });

  test("a run already in flight for the app is adopted, not dispatched again", async () => {
    const w = new World();
    w.appsVersion = "0.1.8";
    w.runs.set(7, { id: 7, workflow: "bundle", status: "in_progress", conclusion: null, created_at: "2026-09-25T14:59:00Z", html_url: "u7", jobs: ["plan", "build (board, m4ttstack/apps, apps/board)"] });
    const exec = w.exec;
    const seams = w.seams({
      exec: async (argv) => {
        if (argv.join(" ") === "gh run view 7 --repo m4ttstack/rt --json status,conclusion") {
          w.runs.get(7)!.status = "completed";
          w.runs.get(7)!.conclusion = "success";
          w.appsTags.add("board-v0.1.8");
          w.prs.push({
            number: 77, state: "OPEN", url: "pr77", headRefOid: "prhead7", headRefName: "bundle-ci/7", files: ["rt-tray/deps.lock"],
            lock: lockText({ ...BASE_VERSIONS, board: "0.1.8" }, { board: ASSET_SHA }), base: w.main,
          });
        }
        return exec(argv);
      },
    });
    const r = await runReleaseApp(seams, opts());
    expect(r.status).toBe("released");
    expect(w.calls.some((c) => c.startsWith("gh workflow run"))).toBe(false);
  });

  test("after a CI failure a rerun finds the published tag and open PR and merges it", async () => {
    const w = new World();
    w.checks = [[{ name: "checks", bucket: "fail" }]];
    const first = await runReleaseApp(w.seams(), opts());
    expect(first.status).toBe("failed");
    expect(first.steps.at(-1)).toMatchObject({ id: "pr", status: "failed" });
    expect(first.resume).toContain("rt release app board");
    expect(w.prs[0]!.state).toBe("OPEN");

    w.checks = [[{ name: "checks", bucket: "pass" }]];
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.steps.find((s) => s.id === "bump")!.status).toBe("done");
    expect(second.steps.find((s) => s.id === "bundle")!.status).toBe("done");
    expect(w.calls.filter((c) => c.startsWith("gh workflow run")).length).toBe(1);
    expect(w.calls.filter((c) => c.startsWith("gh api -X PUT")).length).toBe(1);
  });

  test("after declined notes a rerun resumes at the notes with the pin already merged", async () => {
    const w = new World();
    w.confirmAnswer = false;
    const first = await runReleaseApp(w.seams({ isTTY: true }), opts({ yesNotes: false }));
    expect(first.status).toBe("declined");
    expect(w.confirmPrompts).toEqual(["Commit these notes and tag v2.13.2?"]);
    expect(w.logs.join("\n")).toContain("### Board 0.1.8");

    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.steps.slice(1, 4).map((s) => s.status)).toEqual(["done", "done", "done"]);
    expect(second.notes).toContain("### Board 0.1.8");
  });

  test("after a failed tag push a rerun reuses the committed notes and pushes the tag", async () => {
    const w = new World();
    w.tagPushFails = true;
    const first = await runReleaseApp(w.seams(), opts());
    expect(first.steps.at(-1)).toMatchObject({ id: "tag", status: "failed" });
    const notesSha = w.main;

    w.tagPushFails = false;
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.steps.find((s) => s.id === "notes")!.status).toBe("done");
    expect(w.remoteTags.get("v2.13.2")).toBe(notesSha);
    expect(w.calls.filter((c) => c.includes("git/commits")).length).toBe(1);
  });

  test("after a failed publish a rerun only re-verifies the pushed tag", async () => {
    const w = new World();
    w.releaseConclusion = "failure";
    const first = await runReleaseApp(w.seams(), opts());
    expect(first.steps.at(-1)).toMatchObject({ id: "verify", status: "failed" });
    expect(first.resume).toBe("rt release verify v2.13.2");

    const before = mutations(w).length;
    for (const r of w.runs.values()) if (r.workflow === "release") r.conclusion = "success";
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.tag).toBe("v2.13.2");
    expect(second.steps.map((s) => s.status)).toEqual(["ok", "done", "done", "done", "done", "done", "ok"]);
    expect(mutations(w).length).toBe(before);
  });
});

describe("runReleaseApp: the bot PR is verified before it merges", () => {
  test("a sha256 mismatch on the published asset refuses the merge", async () => {
    const w = new World();
    w.assetSha = "b".repeat(64);
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.at(-1)).toMatchObject({ id: "pr", status: "failed" });
    expect(r.steps.at(-1)!.detail).toContain("sha256");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a codesign identity mismatch refuses the merge and never runs the binary", async () => {
    const w = new World();
    w.codesign = "Identifier=board\nSignature=adhoc\n";
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.at(-1)!.detail).toContain("com.mattstack.helper.board");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
    expect(w.calls.some((c) => c.includes("board-extract/board --version"))).toBe(false);
  });

  test("a PR that moves another row refuses the merge", async () => {
    const w = new World();
    w.prMutate = (pr) => { pr.lock = lockText({ ...BASE_VERSIONS, board: "0.1.8", chat: "0.1.9" }, { board: ASSET_SHA }); };
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.at(-1)!.detail).toContain("rows other than board changed: chat");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a failed bundle run names the rerun command", async () => {
    const w = new World();
    w.bundleConclusion = "failure";
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.at(-1)).toMatchObject({ id: "bundle", status: "failed" });
    expect(r.resume).toMatch(/gh run rerun \d+ --failed --repo m4ttstack\/rt/);
  });
});

describe("runReleaseApp: notes approval", () => {
  test("--json without --yes-notes stops with the notes and a resume hint, committing nothing", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts({ json: true, yesNotes: false }));
    expect(r.status).toBe("awaiting-approval");
    expect(r.steps.at(-1)).toMatchObject({ id: "notes", status: "stopped" });
    expect(r.notes).toContain("### Board 0.1.8");
    expect(r.resume).toBe("rt release app board --yes-notes");
    expect(w.calls.some((c) => c.includes("git/commits"))).toBe(false);
    expect(w.confirmPrompts).toEqual([]);
  });

  test("off a TTY without --yes-notes it prints the notes and stops", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: false }));
    expect(r.status).toBe("awaiting-approval");
    expect(w.logs.join("\n")).toContain("### Board 0.1.8");
    expect(w.confirmPrompts).toEqual([]);
  });

  test("an approved prompt on a TTY carries on to the tag", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams({ isTTY: true }), opts({ yesNotes: false }));
    expect(r.status).toBe("released");
    expect(w.confirmPrompts.length).toBe(1);
  });

  test("main moving under the notes commit fails the step without tagging", async () => {
    const w = new World();
    w.patchFails = true;
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.at(-1)).toMatchObject({ id: "notes", status: "failed" });
    expect(r.resume).toBe("rt release app board");
    expect(w.calls.some((c) => c.startsWith("git tag -a"))).toBe(false);
  });
});
