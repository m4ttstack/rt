import { describe, expect, test } from "bun:test";
import { appAssetUrl, BUNDLE_PR_AUTHOR, notesHash, renderNotes, runReleaseApp, type ReleaseAppOptions, type ReleaseAppSeams } from "../release-app.ts";
import type { RunResult } from "../../subprocess.ts";

const LAST = "v2.13.1";
const PREV = "v2.13.0";
const TEAM = "5BF66B3X4V";
const ASSET_SHA = "a".repeat(64);
const SIGNED = `Executable=/work/board-extract/board\nIdentifier=com.mattstack.helper.board\nAuthority=Developer ID Application: M (${TEAM})\nAuthority=Apple Root CA\nTeamIdentifier=${TEAM}\n`;
const PROJECT_YML = `settings:\n  base:\n    CODE_SIGN_STYLE: Manual\n    DEVELOPMENT_TEAM: ${TEAM}\n`;
const RUN_TOOLS: Record<string, { subdir: string; serve?: object }> = {
  deck: { subdir: "apps/deck" },
  board: { subdir: "apps/board", serve: { port: 11006, args: [] } },
  chat: { subdir: "apps/chat", serve: { port: 11002, args: [] } },
};

function lockText(versions: Record<string, string>, shas: Record<string, string> = {}, top: Record<string, unknown> = { schema: 1, arch: "arm64" }): string {
  const tools = Object.entries(RUN_TOOLS).map(([name, t]) => ({
    name, version: versions[name]!, repo: "m4ttstack/apps", subdir: t.subdir,
    url: appAssetUrl(name, versions[name]!), sha256: shas[name] ?? "0".repeat(64),
    archive: "tar.gz", extract: name, status: "bundled",
    ...(t.serve ? { serve: t.serve } : {}),
  }));
  return JSON.stringify({ ...top, tools }, null, 2);
}

const BASE_VERSIONS = { deck: "1.1.1", board: "0.1.7", chat: "0.1.3" };

const ROOT_PACKAGE = (react: string) => JSON.stringify({ name: "apps", workspaces: { packages: ["packages/*", "apps/*"], catalog: { react } } });
const APPS_FILES: Record<string, string> = {
  "package.json": ROOT_PACKAGE("^19.2.7"),
  "apps/board/package.json": JSON.stringify({ name: "board", dependencies: { "@mattstack/tui-kit": "workspace:*", react: "catalog:" } }),
  "apps/board/src/index.ts": "",
  "apps/chat/package.json": JSON.stringify({ name: "chat" }),
  "apps/deck/package.json": JSON.stringify({ name: "deck", dependencies: { "@mattstack/tui-kit": "workspace:*" } }),
  "packages/tui-kit/package.json": JSON.stringify({ name: "@mattstack/tui-kit", dependencies: { "@mattstack/app-kit": "^0.1.0" } }),
  "packages/app-kit/package.json": JSON.stringify({ name: "@mattstack/app-kit" }),
};

interface Commit { sha: string; parent: string | null; files: string[]; lock: string; notes: string; subject: string }
interface Run {
  id: number; workflow: "bundle" | "release"; status: string; conclusion: string | null; created_at: string; html_url: string; display_title: string; tag?: string;
  path?: string; headBranch?: string;
  /** Listed by the workflow runs endpoint but 404 when fetched by id. */
  gone?: boolean;
}
interface Pr {
  number: number; state: string; url: string; headRefOid: string; headRefName: string;
  author: { login: string }; isCrossRepository: boolean; files: string[]; lock: string; base: string; commitAuthor: string;
}
type ChecksPoll = { name: string; bucket: string }[] | "error" | "none";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const err = (stderr: string, exitCode = 1): RunResult => ({ stdout: "", stderr, exitCode });

/** A stateful stand-in for the rt checkout, GitHub (rt and apps) and the apps clone. */
class World {
  commits = new Map<string, Commit>();
  main: string;
  localTags = new Map<string, string>();
  remoteTags = new Map<string, string>();
  appsVersion = "0.1.7";
  appsHead = "ah0";
  appsLockVersions: Record<string, string> = { board: "0.1.7", chat: "0.1.3", deck: "1.1.1" };
  appsMovesDuringBump = false;
  /** Root package.json at apps tags, where it differs from main's. */
  appsRootAt: Record<string, string> = {};
  appsTags = new Set(["board-v0.1.6", "board-v0.1.7", "chat-v0.1.3", "deck-v1.1.1"]);
  /** Directories with commits on apps main after each tag. */
  appsMoved: Record<string, string[]> = { "board-v0.1.7": ["apps/board"] };
  appsSubjects = ["board: serve a setup page (#156)", "board: tidy the header"];
  runs = new Map<number, Run>();
  hideRunsOnFirstListing = false;
  prs: Pr[] = [];
  checks: ChecksPoll[] = [[{ name: "checks", bucket: "pass" }, { name: "CodeRabbit", bucket: "pending" }]];
  codesign = SIGNED;
  codesignStrictOk = true;
  assetSha = ASSET_SHA;
  bundleConclusion = "success";
  releaseConclusion = "success";
  releaseRunStatus = "completed";
  prMutate: ((pr: Pr) => void) | null = null;
  afterMerge: (() => void) | null = null;
  notesCommitExtraFiles: string[] = [];
  patchFails: false | "moved" | "forbidden" | "network" = false;
  tagPushFails = false;
  latestOverride: string | null = null;
  written = new Map<string, string>();
  calls: string[] = [];
  logs: string[] = [];
  confirmAnswer = true;
  confirmPrompts: string[] = [];
  clock = Date.parse("2026-09-25T15:00:00Z");
  private seq = 100;
  private runListings = 0;

  constructor() {
    this.commit("c0", null, [], lockText({ ...BASE_VERSIONS, board: "0.1.6" }), "prev notes\n", "chore(release): notes for v2.13.0");
    this.commit("c1", "c0", ["rt-tray/deps.lock", "RELEASE_NOTES.md"], lockText(BASE_VERSIONS), "last notes\n", "chore(release): notes for v2.13.1");
    this.main = "c1";
    for (const [t, c] of [[PREV, "c0"], [LAST, "c1"]] as const) {
      this.localTags.set(t, c);
      this.remoteTags.set(t, c);
      this.releaseRun(t, "success");
    }
  }

  commit(sha: string, parent: string | null, files: string[], lock: string, notes: string, subject = "a commit"): Commit {
    const c = { sha, parent, files, lock, notes, subject };
    this.commits.set(sha, c);
    return c;
  }

  /** Lands a commit on main. */
  land(files: string[], edit: Partial<Pick<Commit, "lock" | "notes" | "subject">> = {}): string {
    const parent = this.commits.get(this.main)!;
    const sha = `c${this.seq++}`;
    this.commit(sha, this.main, files, edit.lock ?? parent.lock, edit.notes ?? parent.notes, edit.subject ?? "a commit");
    this.main = sha;
    return sha;
  }

  releaseRun(tag: string, conclusion: string, status = "completed"): void {
    const id = this.seq++;
    this.runs.set(id, {
      id, workflow: "release", status, conclusion: status === "completed" ? conclusion : null, tag, display_title: tag,
      created_at: new Date(this.clock).toISOString(), html_url: `https://github.com/m4ttstack/rt/actions/runs/${id}`,
    });
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

  bunLockText(): string {
    const entries = Object.entries(this.appsLockVersions)
      .map(([app, v]) => `    "apps/${app}": {\n      "name": "${app}",\n      "version": "${v}",\n    },`).join("\n");
    return `{\n  "lockfileVersion": 1,\n  "workspaces": {\n    "": {\n      "name": "apps",\n    },\n${entries}\n  },\n}\n`;
  }

  private pkgText(): string {
    return `{\n  "name": "board",\n  "version": "${this.appsVersion}",\n  "private": true\n}\n`;
  }

  addBotPr(runId: number, version: string, extra: Partial<Pr> = {}): Pr {
    const current = JSON.parse(this.commits.get(this.main)!.lock) as { tools: { name: string; version: string }[] };
    const versions = Object.fromEntries(current.tools.map((t) => [t.name, t.version]));
    const pr: Pr = {
      number: runId + 1000, state: "OPEN", url: `https://github.com/m4ttstack/rt/pull/${runId + 1000}`,
      headRefOid: `prhead${runId}`, headRefName: `bundle-ci/${runId}`, author: { login: BUNDLE_PR_AUTHOR }, isCrossRepository: false, commitAuthor: "bundle-apps workflow",
      files: ["rt-tray/deps.lock"], lock: lockText({ ...versions, board: version }, { board: ASSET_SHA }), base: this.main, ...extra,
    };
    this.prMutate?.(pr);
    this.prs.push(pr);
    return pr;
  }

  private dispatch(apps: string, dryRun: boolean): RunResult {
    const id = this.seq++;
    this.runs.set(id, {
      id, workflow: "bundle", status: "completed", conclusion: this.bundleConclusion,
      created_at: new Date(this.clock).toISOString(), html_url: `https://github.com/m4ttstack/rt/actions/runs/${id}`,
      display_title: `Bundle apps: ${apps}${dryRun ? " (dry run)" : ""}`,
    });
    if (this.bundleConclusion === "success" && !dryRun) {
      this.appsTags.add(`${apps}-v${this.appsVersion}`);
      this.addBotPr(id, this.appsVersion);
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
    if (cmd === "git ls-remote --tags --refs origin v*") {
      return ok([...this.remoteTags.entries()].map(([t, c]) => `${c}\trefs/tags/${t}`).join("\n") + "\n");
    }
    if (cmd === "git ls-remote origin refs/heads/main") return ok(`${this.main}\trefs/heads/main\n`);
    if (cmd === "git rev-parse origin/main") return ok(`${this.main}\n`);
    if ((m = cmd.match(/^git show (\S+):(\S+)$/))) {
      const c = this.resolve(m[1]!);
      if (!c) return err(`bad ref ${m[1]}`);
      if (m[2] === "rt-tray/project.yml") return ok(PROJECT_YML);
      return ok(m[2] === "rt-tray/deps.lock" ? c.lock : c.notes);
    }
    if ((m = cmd.match(/^git diff --name-only (\S+)\.\.(\S+)$/))) {
      return ok([...new Set(this.range(m[1]!, m[2]!).flatMap((c) => c.files))].join("\n"));
    }
    if ((m = cmd.match(/^git log -1 --format=(\S+) (\S+)\.\.origin\/main -- (\S+)$/))) {
      const c = this.range(m[2]!, "origin/main").find((x) => x.files.includes(m![3]!));
      if (!c) return ok("");
      return ok(m[1] === "%H" ? c.sha : `${c.sha}\t${c.subject}`);
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
      this.releaseRun(tag, this.releaseConclusion, this.releaseRunStatus);
      return ok();
    }

    if (cmd.startsWith("git clone --bare --filter=blob:none --quiet https://github.com/m4ttstack/apps.git ")) return ok();
    if (/^git --git-dir \S+ fetch --quiet origin /.test(cmd)) return ok();
    if (/^git --git-dir \S+ ls-tree -r --name-only main$/.test(cmd)) return ok(Object.keys(APPS_FILES).join("\n") + "\n");
    if ((m = cmd.match(/^git --git-dir \S+ show (\S+):(\S+)$/))) {
      const [, ref, path] = m;
      if (ref !== "main" && path === "package.json" && this.appsRootAt[ref!]) return ok(this.appsRootAt[ref!]!);
      return path! in APPS_FILES ? ok(APPS_FILES[path!]!) : err(`fatal: path '${path}' does not exist in '${ref}'`, 128);
    }
    if ((m = cmd.match(/^git --git-dir \S+ rev-list --count (\S+)\.\.main -- (.+)$/))) {
      const paths = m[2]!.split(" ");
      return ok(`${(this.appsMoved[m[1]!] ?? []).filter((d) => paths.includes(d)).length}\n`);
    }
    if ((m = cmd.match(/^git --git-dir \S+ log --no-merges --format=%s (\S+)\.\.(\S+) -- (.+)$/))) {
      const to = m[2]!;
      const app = m[3]!.split(" ")[0]!.slice("apps/".length);
      if (!this.appsTags.has(to)) return err(`unknown revision ${to}`);
      const version = to.slice(`${app}-v`.length);
      const subjects = app === "board" ? this.appsSubjects : [`${app}: a fix (#9)`];
      return ok([...subjects, `${app} ${version}: version bump for the rt release`].join("\n") + "\n");
    }

    if (cmd === "gh api repos/m4ttstack/apps/git/ref/heads/main --jq .object.sha") return ok(`${this.appsHead}\n`);
    if ((m = cmd.match(/^gh api -H Accept: application\/vnd\.github\.raw\+json repos\/m4ttstack\/apps\/contents\/(\S+)\?ref=(\S+)$/))) {
      if (m[1] === "apps/board/package.json") return ok(this.pkgText());
      if (m[1] === "bun.lock") return ok(this.bunLockText());
      return err("gh: Not Found (HTTP 404)");
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/apps\/git\/commits\/(\S+) --jq \.tree\.sha$/))) return ok(`atree-${m[1]}\n`);
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/apps\/git\/trees --input (\S+) --jq \.sha$/))) {
      this.written.set("apps-tree-new", this.written.get(m[1]!)!);
      return ok("apps-tree-new\n");
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/apps\/git\/commits --input (\S+) --jq \.sha$/))) {
      const body = JSON.parse(this.written.get(m[1]!)!) as { message: string; parents: string[] };
      const sha = `ac${this.seq++}`;
      this.written.set(`apps-commit-${sha}`, JSON.stringify({ ...body, tree: JSON.parse(this.written.get("apps-tree-new")!) }));
      return ok(`${sha}\n`);
    }
    if ((m = cmd.match(/^gh api -X PATCH repos\/m4ttstack\/apps\/git\/refs\/heads\/main --input (\S+)$/))) {
      const ref = JSON.parse(this.written.get(m[1]!)!) as { sha: string; force: boolean };
      const commit = JSON.parse(this.written.get(`apps-commit-${ref.sha}`)!) as { parents: string[]; tree: { tree: { path: string; content: string }[] } };
      if (this.appsMovesDuringBump) {
        this.appsHead = "ah-someone-else";
        return err("gh: Update is not a fast forward (HTTP 422)");
      }
      if (commit.parents[0] !== this.appsHead || ref.force !== false) return err("gh: Update is not a fast forward (HTTP 422)");
      for (const entry of commit.tree.tree) {
        if (entry.path === "apps/board/package.json") this.appsVersion = (JSON.parse(entry.content) as { version: string }).version;
        if (entry.path === "bun.lock") this.appsLockVersions.board = entry.content.match(/"apps\/board": \{\n\s+"name": "board",\n\s+"version": "([^"]+)"/)![1]!;
      }
      this.appsHead = ref.sha;
      return ok("{}");
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/apps\/git\/ref\/tags\/(\S+)$/))) {
      return this.appsTags.has(m[1]!) ? ok("{}") : err("gh: Not Found (HTTP 404)");
    }
    if (cmd === "gh api repos/m4ttstack/rt/actions/workflows/bundle-apps.yml/runs?event=workflow_dispatch&per_page=20") {
      const hide = this.hideRunsOnFirstListing && this.runListings++ === 0;
      const runs = hide ? [] : [...this.runs.values()].filter((r) => r.workflow === "bundle").reverse();
      return ok(JSON.stringify({ workflow_runs: runs.map(({ id, status, conclusion, created_at, html_url, display_title }) => ({ id, status, conclusion, created_at, html_url, display_title })) }));
    }
    if (cmd.startsWith("gh workflow run bundle-apps.yml --repo m4ttstack/rt --ref main -f apps=")) {
      const apps = argv.find((a) => a.startsWith("apps="))!.slice("apps=".length);
      return this.dispatch(apps, argv.includes("dry_run=true"));
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/actions\/runs\/(\d+)$/))) {
      const r = this.runs.get(Number(m[1]));
      if (!r || r.gone) return err("gh: Not Found (HTTP 404)");
      const path = r.path ?? `.github/workflows/${r.workflow === "bundle" ? "bundle-apps" : "release"}.yml`;
      return ok(JSON.stringify({ id: r.id, path, head_branch: r.headBranch ?? (r.workflow === "bundle" ? "main" : r.tag), status: r.status }));
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/commits\/(\S+) --jq \.commit\.author\.name$/))) {
      const pr = this.prs.find((p) => p.headRefOid === m![1]);
      return pr ? ok(`${pr.commitAuthor}\n`) : err("gh: Not Found (HTTP 404)");
    }
    if ((m = cmd.match(/^gh run view (\d+) --repo m4ttstack\/rt --json status,conclusion$/))) {
      const r = this.runs.get(Number(m[1]));
      return r ? ok(JSON.stringify({ status: r.status, conclusion: r.conclusion })) : err("no run");
    }
    const prFields = "number,state,url,headRefOid,headRefName,author,isCrossRepository";
    if ((m = cmd.match(new RegExp(`^gh pr list --repo m4ttstack/rt --head (\\S+) --state all --json ${prFields}$`)))) {
      return ok(JSON.stringify(this.prs.filter((p) => p.headRefName === m![1])));
    }
    if (cmd === `gh pr list --repo m4ttstack/rt --state all --json ${prFields} --limit 50`) {
      return ok(JSON.stringify([...this.prs].reverse()));
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
      const poll = this.checks.length > 1 ? this.checks.shift()! : this.checks[0]!;
      if (poll === "error") return err("gh: HTTP 502: Bad Gateway");
      if (poll === "none") return err("no checks reported on the 'bundle-ci/1' branch");
      return { stdout: JSON.stringify(poll), stderr: "", exitCode: poll.some((c) => c.bucket === "pending") ? 8 : 0 };
    }
    if ((m = cmd.match(/^gh pr merge (\d+) --repo m4ttstack\/rt --squash --match-head-commit (\S+)$/))) {
      const pr = this.prs.find((p) => p.number === Number(m![1]))!;
      pr.state = "MERGED";
      this.land(["rt-tray/deps.lock"], { lock: pr.lock });
      this.afterMerge?.();
      return ok();
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/git\/trees --input (\S+) --jq \.sha$/))) {
      this.written.set("tree-new", this.written.get(m[1]!)!);
      return ok("tree-new\n");
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/git\/commits --input (\S+) --jq \.sha$/))) {
      const body = JSON.parse(this.written.get(m[1]!)!) as { message: string; parents: string[] };
      const tree = JSON.parse(this.written.get("tree-new")!) as { tree: { content: string }[] };
      const parent = this.commits.get(body.parents[0]!)!;
      const sha = `n${this.seq++}`;
      this.commit(sha, parent.sha, ["RELEASE_NOTES.md", ...this.notesCommitExtraFiles], parent.lock, tree.tree[0]!.content, body.message);
      return ok(`${sha}\n`);
    }
    if ((m = cmd.match(/^gh api -X PATCH repos\/m4ttstack\/rt\/git\/refs\/heads\/main --input (\S+)$/))) {
      const body = JSON.parse(this.written.get(m[1]!)!) as { sha: string; force: boolean };
      if (this.patchFails === "moved") {
        this.land(["website/docs/other.md"]);
        return err("gh: Update is not a fast forward (HTTP 422)");
      }
      if (this.patchFails === "forbidden") return err("gh: Resource not accessible by integration (HTTP 403)");
      if (this.patchFails === "network") return err("error connecting to api.github.com");
      const c = this.commits.get(body.sha)!;
      if (c.parent !== this.main || body.force !== false) return err("gh: Update is not a fast forward (HTTP 422)");
      this.main = c.sha;
      return ok("{}");
    }
    if ((m = cmd.match(/^gh api repos\/m4ttstack\/rt\/actions\/workflows\/release\.yml\/runs\?event=push&branch=(\S+)&per_page=5$/))) {
      const runs = [...this.runs.values()].filter((r) => r.workflow === "release" && r.tag === m![1]);
      return ok(JSON.stringify({ workflow_runs: runs.map((r) => ({ id: r.id, html_url: r.html_url })) }));
    }
    if ((m = cmd.match(/^gh release view (\S+) --repo m4ttstack\/rt --json body,assets,isDraft,isPrerelease,publishedAt$/))) {
      const tag = m[1]!;
      const published = [...this.runs.values()].some((r) => r.workflow === "release" && r.tag === tag && r.status === "completed");
      if (!this.remoteTags.has(tag) || !published) return err("release not found");
      return ok(JSON.stringify({ body: this.commits.get(this.remoteTags.get(tag)!)!.notes, assets: this.assets(tag), isDraft: false, isPrerelease: false, publishedAt: new Date(this.clock).toISOString() }));
    }

    if ((m = cmd.match(/^mkdir -p (\S+)$/))) return ok();
    if ((m = cmd.match(/^tar -xzf (\S+) -C (\S+)$/))) return ok();
    if ((m = cmd.match(/^codesign --verify --strict (\S+)$/))) return this.codesignStrictOk ? ok() : err(`${m[1]}: invalid signature (code or signature have been modified)`);
    if ((m = cmd.match(/^codesign -dvv (\S+)$/))) return { stdout: "", stderr: this.codesign, exitCode: 0 };
    return err(`unexpected command: ${cmd}`);
  };

  assets(tag: string): { name: string }[] {
    const ver = tag.slice(1);
    return [{ name: `mattstack-${ver}.dmg` }, { name: `mattstack-${ver}.zip` }, { name: "appcast.xml" }, { name: "SHA256SUMS" }];
  }

  latestTag(): string {
    return this.latestOverride ?? [...this.remoteTags.keys()].sort((x, y) => (x < y ? 1 : -1))[0]!;
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

const BOARD_SECTION = { app: "board", version: "0.1.8", subjects: ["board: serve a setup page (#156)", "board: tidy the header"] };
/** The hash of the notes a default world generates, the only approval --yes-notes accepts. */
const hashFor = (sections = [BOARD_SECTION], held: { app: string; version: string; pinTag: string }[] = []) =>
  notesHash(renderNotes({ sections, held, lastTag: LAST, nextTag: "v2.13.2" }));
const DEFAULT_HASH = hashFor();
const CHAT_SECTION = { app: "chat", version: "0.1.4", subjects: ["chat: a fix (#9)"] };

const opts = (o: Partial<ReleaseAppOptions> = {}): ReleaseAppOptions => ({ name: "board", dryRun: false, json: false, yesNotes: DEFAULT_HASH, ...o });

const MUTATING = [/^gh workflow run /, /^gh pr merge /, /^gh api -X PATCH /, /git\/trees --input/, /git\/commits --input/, /^git tag -a /, /^git push /];
const APPS_BUMPS = (calls: string[]) => calls.filter((c) => c.startsWith("gh api -X PATCH repos/m4ttstack/apps/"));
const mutations = (calls: string[]) => calls.filter((c) => MUTATING.some((re) => re.test(c)));
const lastStep = (r: { steps: { id: string; status: string; detail: string }[] }) => r.steps.at(-1)!;

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
    expect(r.notesHash).toMatch(/^[0-9a-f]{12}$/);
    expect(w.commits.get(w.main)!.notes).toBe(r.notes!);
    expect(w.commits.get(w.main)!.subject).toBe("chore(release): notes for v2.13.2 (board 0.1.8)");
    expect(w.calls.some((c) => c.startsWith("download https://github.com/m4ttstack/apps/releases/download/board-v0.1.8/board-darwin-arm64.tgz"))).toBe(true);
    expect(r.verify?.clean).toBe(true);
    expect(r.resume).toBeNull();
  });

  test("the notes commit is a fast-forward of the verified main, never forced", async () => {
    const w = new World();
    await runReleaseApp(w.seams(), opts());
    const patch = [...w.written.entries()].find(([k]) => k.endsWith("notes-ref.json"));
    expect(JSON.parse(patch![1])).toEqual({ sha: w.main, force: false });
  });

  test("CodeRabbit never holds the merge, and a PR with no checks yet or pending ones is waited out", async () => {
    const w = new World();
    w.checks = [
      "none",
      [{ name: "checks", bucket: "pending" }, { name: "CodeRabbit", bucket: "pending" }],
      [{ name: "checks", bucket: "pass" }, { name: "CodeRabbit", bucket: "pending" }],
    ];
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
    expect(w.calls.filter((c) => c.startsWith("gh pr checks")).length).toBe(3);
  });

  test("the last tag comes from origin: a local-only tag is ignored", async () => {
    const w = new World();
    w.localTags.set("v2.13.9", "c1");
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.lastTag).toBe("v2.13.1");
    expect(r.tag).toBe("v2.13.2");
    expect(r.status).toBe("released");
  });

  test("a shared workspace package change gives the app something to release", async () => {
    const w = new World();
    w.appsMoved = { "board-v0.1.7": ["packages/app-kit"] };
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
    expect(w.calls.some((c) => c.includes("rev-list --count board-v0.1.7..main -- apps/board packages/tui-kit packages/app-kit"))).toBe(true);
    expect(w.calls.some((c) => c.includes("log --no-merges --format=%s board-v0.1.7..board-v0.1.8 -- apps/board packages/tui-kit packages/app-kit"))).toBe(true);
  });
});

describe("runReleaseApp: the version bump", () => {
  test("bumps package.json and the app's bun.lock workspace version in one fast-forward commit", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
    expect(APPS_BUMPS(w.calls).length).toBe(1);
    const commit = [...w.written.entries()].find(([k]) => k.startsWith("apps-commit-"))![1];
    const body = JSON.parse(commit) as { message: string; parents: string[]; tree: { base_tree: string; tree: { path: string; content: string }[] } };
    expect(body.parents).toEqual(["ah0"]);
    expect(body.tree.base_tree).toBe("atree-ah0");
    expect(body.tree.tree.map((e) => e.path)).toEqual(["apps/board/package.json", "bun.lock"]);
    expect(body.message).toBe("board 0.1.8: version bump for the rt release");
    expect(w.appsVersion).toBe("0.1.8");
    expect(w.appsLockVersions).toEqual({ board: "0.1.8", chat: "0.1.3", deck: "1.1.1" });
    const patch = [...w.written.entries()].find(([k, v]) => k.endsWith("apps-ref.json") && v.includes('"force"'))!;
    expect(JSON.parse(patch[1]).force).toBe(false);
  });

  test("a bun.lock that does not record the current pin refuses before anything changes", async () => {
    const w = new World();
    w.appsLockVersions.board = "0.1.6";
    const r = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(lastStep(r)).toMatchObject({ id: "qualify", status: "failed" });
    expect(lastStep(r).detail).toContain("bun.lock records apps/board at 0.1.6, not the pin 0.1.7");
    expect(mutations(w.calls)).toEqual([]);
  });

  test("apps main moving under the bump fails the step and says so", async () => {
    const w = new World();
    w.appsMovesDuringBump = true;
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "bump", status: "failed" });
    expect(lastStep(r).detail).toContain("apps main moved from ah0");
    expect(r.resume).toBe("rt release app board");
    expect(w.calls.some((c) => c.startsWith("gh workflow run"))).toBe(false);
  });

  test("a changed catalog entry the app uses is a change to release, and the notes name it", async () => {
    const w = new World();
    w.appsMoved = {};
    w.appsRootAt["board-v0.1.7"] = ROOT_PACKAGE("^19.2.0");
    const plan = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(plan.status).toBe("planned");
    expect(plan.appVersion).toBe("0.1.8");
    const r = await runReleaseApp(w.seams(), opts({ json: true, yesNotes: null }));
    expect(r.notes).toContain("- react ^19.2.0 → ^19.2.7 (workspace catalog)");
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
    expect(mutations(w.calls)).toEqual([]);
    expect(w.appsVersion).toBe("0.1.7");
  });

  test("a dry run of a half-finished release marks the finished steps done", async () => {
    const w = new World();
    w.checks = [[{ name: "checks", bucket: "fail" }]];
    await runReleaseApp(w.seams(), opts());
    const before = w.calls.length;
    const r = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(r.steps.map((s) => [s.id, s.status])).toEqual([
      ["qualify", "ok"], ["bump", "done"], ["bundle", "done"], ["pr", "planned"], ["notes", "planned"], ["tag", "planned"], ["verify", "planned"],
    ]);
    expect(mutations(w.calls.slice(before))).toEqual([]);
  });

  test("apps that moved since their pin are listed as held, in the plan and in the notes", async () => {
    const w = new World();
    w.appsMoved = { "board-v0.1.7": ["apps/board"], "chat-v0.1.3": ["apps/chat"] };
    const plan = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(plan.heldApps).toEqual([{ app: "chat", version: "0.1.3", pinTag: "chat-v0.1.3" }]);
    expect(plan.steps[0]!.detail).toContain("held at their pins: chat 0.1.3");
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hashFor([BOARD_SECTION], [{ app: "chat", version: "0.1.3", pinTag: "chat-v0.1.3" }]) }));
    expect(r.notes).toContain("### Held pins\n\n- chat stays at 0.1.3");
  });
});

describe("runReleaseApp: qualification", () => {
  test("a change outside the pin allowlist refuses and points at the full release", async () => {
    const w = new World();
    w.land(["lib/team/invite.ts"]);
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("failed");
    expect(lastStep(r)).toMatchObject({ id: "qualify", status: "failed" });
    expect(lastStep(r).detail).toContain("lib/team/invite.ts");
    expect(lastStep(r).detail).toContain("/rt:release");
    expect(mutations(w.calls)).toEqual([]);
  });

  test("a website-only main is still on the fast path", async () => {
    const w = new World();
    w.land(["website/docs/guides/x.mdx"]);
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
  });

  test("an unreleased serve-only pin on main is allowed alongside", async () => {
    const w = new World();
    w.land(["rt-tray/deps.lock"], { lock: lockText({ ...BASE_VERSIONS, chat: "0.1.4" }) });
    w.appsTags.add("chat-v0.1.4");
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hashFor([BOARD_SECTION, CHAT_SECTION]) }));
    expect(r.status).toBe("released");
    expect(r.notes).toContain("A patch release that ships board 0.1.8 and chat 0.1.4.");
  });

  test("a deps.lock change beyond a serve-only pin move refuses, even when preflight's gate would pass it", async () => {
    const w = new World();
    w.land(["rt-tray/deps.lock"], { lock: lockText({ ...BASE_VERSIONS, chat: "0.1.4" }, { deck: "e".repeat(64) }) });
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "qualify", status: "failed" });
    expect(lastStep(r).detail).toContain("deck");
    expect(mutations(w.calls)).toEqual([]);
  });

  test("a pin moved below the version the last tag shipped is refused as a revert", async () => {
    const w = new World();
    w.land(["rt-tray/deps.lock"], { lock: lockText({ ...BASE_VERSIONS, board: "0.1.6" }) });
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "qualify", status: "failed" });
    expect(lastStep(r).detail).toContain("board 0.1.7 → 0.1.6");
    expect(lastStep(r).detail).toContain("revert");
    expect(r.resume).toBeNull();
    expect(mutations(w.calls)).toEqual([]);
  });

  test("deck is refused because its pin keeps the full gate", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts({ name: "deck" }));
    expect(lastStep(r)).toMatchObject({ id: "qualify", status: "failed" });
    expect(lastStep(r).detail).toContain("full gate");
  });

  test("an existing tag for the next app version is refused", async () => {
    const w = new World();
    w.appsTags.add("board-v0.1.8");
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "qualify", status: "failed" });
    expect(lastStep(r).detail).toContain("board-v0.1.8 already exists");
    expect(mutations(w.calls)).toEqual([]);
  });

  test("an app with no commits since its pin and no pending release is refused as empty", async () => {
    const w = new World();
    w.appsMoved = {};
    w.commits.get("c0")!.lock = lockText(BASE_VERSIONS);
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r).detail).toContain("nothing to release");
  });

  test("an unverified newest tag that shipped this app is re-verified instead of stacking a new release on it", async () => {
    const w = new World();
    for (const run of w.runs.values()) if (run.tag === LAST) run.conclusion = "failure";
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.tag).toBe(LAST);
    expect(r.steps[0]!.detail).toContain("has not verified");
    expect(lastStep(r)).toMatchObject({ id: "verify", status: "failed" });
    expect(r.resume).toBe(`rt release verify ${LAST}`);
    expect(mutations(w.calls)).toEqual([]);
  });

  test("an unverified newest tag that did not ship this app refuses with the verify command", async () => {
    const w = new World();
    w.commits.get("c0")!.lock = lockText(BASE_VERSIONS);
    for (const run of w.runs.values()) if (run.tag === LAST) run.conclusion = "failure";
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "qualify", status: "failed" });
    expect(lastStep(r).detail).toContain(`rt release verify ${LAST}`);
    expect(mutations(w.calls)).toEqual([]);
  });
});

describe("runReleaseApp: resume", () => {
  test("a version a human already bumped past the pin is built as is, with no bump", async () => {
    const w = new World();
    w.appsVersion = "0.1.9";
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hashFor([{ ...BOARD_SECTION, version: "0.1.9" }]) }));
    expect(r.status).toBe("released");
    expect(r.steps.find((s) => s.id === "bump")!.status).toBe("done");
    expect(r.appVersion).toBe("0.1.9");
    expect(APPS_BUMPS(w.calls)).toEqual([]);
  });

  function inFlightRun(w: World, title = "Bundle apps: board"): void {
    w.runs.set(7, { id: 7, workflow: "bundle", status: "in_progress", conclusion: null, created_at: "2026-09-25T14:59:00Z", html_url: "u7", display_title: title });
  }

  function finishRunSevenOnPoll(w: World): ReleaseAppSeams {
    const exec = w.exec;
    return w.seams({
      exec: async (argv) => {
        if (argv.join(" ") === "gh run view 7 --repo m4ttstack/rt --json status,conclusion" && w.runs.get(7)!.status !== "completed") {
          w.runs.get(7)!.status = "completed";
          w.runs.get(7)!.conclusion = "success";
          w.appsTags.add("board-v0.1.8");
          w.addBotPr(7, "0.1.8");
        }
        return exec(argv);
      },
    });
  }

  test("a run already in flight for the app is adopted, not dispatched again", async () => {
    const w = new World();
    w.appsVersion = "0.1.8";
    inFlightRun(w);
    const r = await runReleaseApp(finishRunSevenOnPoll(w), opts());
    expect(r.status).toBe("released");
    expect(w.calls.some((c) => c.startsWith("gh workflow run"))).toBe(false);
  });

  test("an in-flight run is watched even when its app tag already exists, so its PR is not missed", async () => {
    const w = new World();
    w.appsVersion = "0.1.8";
    w.appsTags.add("board-v0.1.8");
    inFlightRun(w);
    const r = await runReleaseApp(finishRunSevenOnPoll(w), opts());
    expect(r.status).toBe("released");
    expect(r.steps.find((s) => s.id === "bundle")!.status).toBe("ok");
  });

  test("a run still finishing when the PR is looked for is waited out, not reported as a missing PR", async () => {
    const w = new World();
    w.appsVersion = "0.1.8";
    w.appsTags.add("board-v0.1.8");
    inFlightRun(w);
    w.hideRunsOnFirstListing = true;
    const r = await runReleaseApp(finishRunSevenOnPoll(w), opts());
    expect(r.status).toBe("released");
    expect(r.steps.find((s) => s.id === "bundle")!.status).toBe("done");
  });

  test("a dry run or an all run for the app is never adopted", async () => {
    const w = new World();
    w.appsVersion = "0.1.8";
    inFlightRun(w, "Bundle apps: board (dry run)");
    w.runs.set(8, { id: 8, workflow: "bundle", status: "in_progress", conclusion: null, created_at: "2026-09-25T14:59:00Z", html_url: "u8", display_title: "Bundle apps: all" });
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("released");
    expect(w.calls.filter((c) => c.startsWith("gh workflow run")).length).toBe(1);
  });

  test("after a CI failure a rerun finds the published tag and open PR and merges it", async () => {
    const w = new World();
    w.checks = [[{ name: "checks", bucket: "fail" }]];
    const first = await runReleaseApp(w.seams(), opts());
    expect(first.status).toBe("failed");
    expect(lastStep(first)).toMatchObject({ id: "pr", status: "failed" });
    expect(first.resume).toContain("rt release app board");
    expect(w.prs[0]!.state).toBe("OPEN");

    w.checks = [[{ name: "checks", bucket: "pass" }]];
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.steps.find((s) => s.id === "bump")!.status).toBe("done");
    expect(second.steps.find((s) => s.id === "bundle")!.status).toBe("done");
    expect(w.calls.filter((c) => c.startsWith("gh workflow run")).length).toBe(1);
    expect(APPS_BUMPS(w.calls).length).toBe(1);
  });

  test("after declined notes a rerun resumes at the notes with the pin already merged", async () => {
    const w = new World();
    w.confirmAnswer = false;
    const first = await runReleaseApp(w.seams({ isTTY: true }), opts({ yesNotes: null }));
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
    expect(lastStep(first)).toMatchObject({ id: "tag", status: "failed" });
    const notesSha = w.main;

    w.tagPushFails = false;
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.steps.find((s) => s.id === "notes")!.status).toBe("done");
    expect(w.remoteTags.get("v2.13.2")).toBe(notesSha);
    expect(w.calls.filter((c) => c.includes("repos/m4ttstack/rt/git/commits")).length).toBe(1);
  });

  test("a RELEASE_NOTES.md commit with another subject is never reused as the notes commit", async () => {
    const w = new World();
    w.confirmAnswer = false;
    await runReleaseApp(w.seams({ isTTY: true }), opts({ yesNotes: null }));
    w.land(["RELEASE_NOTES.md"], { notes: "hand edit\n", subject: "docs: tidy the notes" });
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.steps.find((s) => s.id === "notes")!.status).toBe("ok");
    expect(r.notes).toContain("### Board 0.1.8");
  });

  test("notes committed before a later pin merge are stale and regenerated", async () => {
    const w = new World();
    w.land(["rt-tray/deps.lock"], { lock: lockText({ ...BASE_VERSIONS, chat: "0.1.4" }) });
    w.appsTags.add("chat-v0.1.4");
    w.land(["RELEASE_NOTES.md"], { notes: "chat only\n", subject: "chore(release): notes for v2.13.2 (chat 0.1.4)" });
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hashFor([BOARD_SECTION, CHAT_SECTION]) }));
    expect(r.status).toBe("released");
    expect(r.steps.find((s) => s.id === "notes")!.status).toBe("ok");
    expect(w.commits.get(w.remoteTags.get("v2.13.2")!)!.notes).toContain("### Board 0.1.8");
  });

  test("after a failed publish a rerun only re-verifies the pushed tag", async () => {
    const w = new World();
    w.releaseConclusion = "failure";
    const first = await runReleaseApp(w.seams(), opts());
    expect(lastStep(first)).toMatchObject({ id: "verify", status: "failed" });
    expect(first.resume).toBe("rt release verify v2.13.2");

    const before = mutations(w.calls).length;
    for (const r of w.runs.values()) if (r.tag === "v2.13.2") r.conclusion = "success";
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.tag).toBe("v2.13.2");
    expect(second.steps.map((s) => s.status)).toEqual(["ok", "done", "done", "done", "done", "done", "ok"]);
    expect(mutations(w.calls).length).toBe(before);
  });

  test("new commits after an unverified release still re-verify it first", async () => {
    const w = new World();
    w.releaseConclusion = "failure";
    await runReleaseApp(w.seams(), opts());
    w.appsMoved = { ...w.appsMoved, "board-v0.1.8": ["apps/board"] };
    const before = mutations(w.calls).length;
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.tag).toBe("v2.13.2");
    expect(lastStep(r)).toMatchObject({ id: "verify", status: "failed" });
    expect(mutations(w.calls).length).toBe(before);
  });
});

describe("runReleaseApp: the bot PR is verified before it merges", () => {
  test("a sha256 mismatch on the published asset refuses the merge", async () => {
    const w = new World();
    w.assetSha = "b".repeat(64);
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "pr", status: "failed" });
    expect(lastStep(r).detail).toContain("sha256");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a codesign identity mismatch refuses the merge and never runs the binary", async () => {
    const w = new World();
    w.codesign = "Identifier=board\nSignature=adhoc\n";
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r).detail).toContain("com.mattstack.helper.board");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
    expect(w.calls.some((c) => c.includes("board-extract/board --version"))).toBe(false);
  });

  test("a signature from another team refuses the merge", async () => {
    const w = new World();
    w.codesign = SIGNED.replace(`TeamIdentifier=${TEAM}`, "TeamIdentifier=ZZZZZZZZZZ");
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r).detail).toContain("TeamIdentifier is ZZZZZZZZZZ");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a binary failing codesign --verify --strict refuses the merge", async () => {
    const w = new World();
    w.codesignStrictOk = false;
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r).detail).toContain("codesign --verify --strict");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a PR that moves another row refuses the merge", async () => {
    const w = new World();
    w.prMutate = (pr) => { pr.lock = lockText({ ...BASE_VERSIONS, board: "0.1.8", chat: "0.1.9" }, { board: ASSET_SHA }); };
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r).detail).toContain("rows other than board changed: chat");
    expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a bundle-ci PR from another author or a fork is never merged", async () => {
    for (const edit of [{ author: { login: "someone-else" } }, { isCrossRepository: true }]) {
      const w = new World();
      w.prMutate = (pr) => Object.assign(pr, edit);
      const r = await runReleaseApp(w.seams(), opts());
      expect(lastStep(r)).toMatchObject({ id: "pr", status: "failed" });
      expect(lastStep(r).detail).toContain("not opened by the bundle workflow");
      expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
    }
  });

  test("a bundle-ci PR whose head commit or run is not the workflow's is never merged", async () => {
    const runOf = (w: World, pr: Pr) => w.runs.get(Number(pr.headRefName.slice("bundle-ci/".length)))!;
    const cases: [(w: World, pr: Pr) => void, string][] = [
      [(_w, pr) => { pr.commitAuthor = "Mallory"; }, 'head commit authored by "Mallory"'],
      [(w, pr) => { runOf(w, pr).headBranch = "evil"; }, "ran on evil, not main"],
      [(w, pr) => { runOf(w, pr).path = ".github/workflows/ci.yml"; }, "is .github/workflows/ci.yml, not .github/workflows/bundle-apps.yml"],
      [(w, pr) => { runOf(w, pr).gone = true; }, "does not exist"],
    ];
    for (const [edit, want] of cases) {
      const w = new World();
      w.prMutate = (pr) => edit(w, pr);
      const r = await runReleaseApp(w.seams(), opts());
      expect(lastStep(r)).toMatchObject({ id: "pr", status: "failed" });
      expect(lastStep(r).detail).toContain("not opened by the bundle workflow");
      expect(lastStep(r).detail).toContain(want);
      expect(r.resume).toBeNull();
      expect(w.calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
    }
  });

  test("a closed bot PR found by the scan, with no run to follow, gets the reopen message", async () => {
    const w = new World();
    w.appsVersion = "0.1.8";
    w.appsTags.add("board-v0.1.8");
    w.addBotPr(55, "0.1.8", { state: "CLOSED" });
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "pr", status: "failed" });
    expect(lastStep(r).detail).toContain("closed without merging");
    expect(r.resume).toContain("gh pr reopen 1055");
  });

  test("a closed bot PR is refused with a clear message", async () => {
    const w = new World();
    w.prMutate = (pr) => { pr.state = "CLOSED"; };
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "pr", status: "failed" });
    expect(lastStep(r).detail).toContain("closed without merging");
    expect(r.resume).toContain("gh pr reopen");
  });

  test("a failed bundle run names the rerun command", async () => {
    const w = new World();
    w.bundleConclusion = "failure";
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "bundle", status: "failed" });
    expect(r.resume).toMatch(/gh run rerun \d+ --failed --repo m4ttstack\/rt/);
  });

  test("gh pr checks failing repeatedly is an error, never pending", async () => {
    const w = new World();
    w.checks = ["error"];
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "pr", status: "failed" });
    expect(lastStep(r).detail).toContain("HTTP 502");
    expect(w.calls.filter((c) => c.startsWith("gh pr checks")).length).toBe(3);
  });
});

describe("runReleaseApp: notes approval", () => {
  test("--json without --yes-notes stops with the notes, their hash and a resume hint, committing nothing", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts({ json: true, yesNotes: null }));
    expect(r.status).toBe("awaiting-approval");
    expect(lastStep(r)).toMatchObject({ id: "notes", status: "stopped" });
    expect(r.notes).toContain("### Board 0.1.8");
    expect(r.resume).toBe(`rt release app board --json --yes-notes ${r.notesHash}`);
    expect(w.calls.some((c) => c.includes("repos/m4ttstack/rt/git/commits"))).toBe(false);
    expect(w.confirmPrompts).toEqual([]);
  });

  test("the shown hash approves exactly those notes", async () => {
    const w = new World();
    const first = await runReleaseApp(w.seams(), opts({ json: true, yesNotes: null }));
    const second = await runReleaseApp(w.seams(), opts({ json: true, yesNotes: first.notesHash }));
    expect(second.status).toBe("released");
    expect(second.notes).toBe(first.notes);
  });

  test("only the hash of these exact notes approves them: the tag form and a stale hash are refused", async () => {
    for (const token of ["v2.13.2", "v2.13.9", "0123456789ab", hashFor([{ ...BOARD_SECTION, subjects: ["board: an older line"] }])]) {
      const w = new World();
      const r = await runReleaseApp(w.seams(), opts({ json: true, yesNotes: token }));
      expect(lastStep(r)).toMatchObject({ id: "notes", status: "failed" });
      expect(lastStep(r).detail).toContain(`--yes-notes ${token} does not match`);
      expect(r.notes).toContain("### Board 0.1.8");
      expect(r.resume).toBe(`rt release app board --json --yes-notes ${r.notesHash}`);
      expect(lastStep(r).detail).toContain("review these notes");
      expect(w.calls.some((c) => c.includes("repos/m4ttstack/rt/git/commits"))).toBe(false);
    }
  });

  test("off a TTY without --yes-notes it prints the notes and their hash and stops", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: null }));
    expect(r.status).toBe("awaiting-approval");
    expect(w.logs.join("\n")).toContain("### Board 0.1.8");
    expect(w.logs.join("\n")).toContain(`notes hash ${r.notesHash}`);
    expect(r.resume).toBe(`rt release app board --yes-notes ${r.notesHash}`);
    expect(w.confirmPrompts).toEqual([]);
  });

  test("an approved prompt on a TTY carries on to the tag", async () => {
    const w = new World();
    const r = await runReleaseApp(w.seams({ isTTY: true }), opts({ yesNotes: null }));
    expect(r.status).toBe("released");
    expect(w.confirmPrompts.length).toBe(1);
  });
});

describe("runReleaseApp: main moving or refusing mid-run", () => {
  test("a held app whose pin merges mid-run ships in the notes and is no longer listed as held", async () => {
    const w = new World();
    w.appsMoved = { "board-v0.1.7": ["apps/board"], "chat-v0.1.3": ["apps/chat"] };
    w.afterMerge = () => {
      w.appsTags.add("chat-v0.1.4");
      w.land(["rt-tray/deps.lock"], { lock: lockText({ ...BASE_VERSIONS, board: "0.1.8", chat: "0.1.4" }, { board: ASSET_SHA }) });
    };
    const r = await runReleaseApp(w.seams(), opts({ json: true, yesNotes: null }));
    expect(r.status).toBe("awaiting-approval");
    expect(r.notes).toContain("### Chat 0.1.4");
    expect(r.notes).not.toContain("Held pins");
    expect(r.heldApps).toEqual([]);
  });

  test("a pin reverted mid-run is caught at the notes, before anything is committed", async () => {
    const w = new World();
    w.afterMerge = () => {
      w.land(["rt-tray/deps.lock"], { lock: lockText({ ...BASE_VERSIONS, board: "0.1.8", chat: "0.1.2" }, { board: ASSET_SHA }) });
    };
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "notes", status: "failed" });
    expect(lastStep(r).detail).toContain("chat 0.1.3 → 0.1.2");
    expect(w.calls.some((c) => c.includes("repos/m4ttstack/rt/git/commits"))).toBe(false);
  });

  test("a non-pin merge landing mid-run is caught at the notes, before anything is committed", async () => {
    const w = new World();
    w.afterMerge = () => { w.land(["lib/team/invite.ts"]); };
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "notes", status: "failed" });
    expect(lastStep(r).detail).toContain("lib/team/invite.ts");
    expect(w.calls.some((c) => c.includes("repos/m4ttstack/rt/git/commits"))).toBe(false);
  });

  test("the commit being tagged is gated too", async () => {
    const w = new World();
    w.notesCommitExtraFiles = ["lib/x.ts"];
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "tag", status: "failed" });
    expect(lastStep(r).detail).toContain("lib/x.ts");
    expect(w.calls.some((c) => c.startsWith("git tag -a") || c.startsWith("git push"))).toBe(false);
  });

  test("main moving under the notes commit fails the step without tagging", async () => {
    const w = new World();
    w.patchFails = "moved";
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "notes", status: "failed" });
    expect(lastStep(r).detail).toContain("main moved from");
    expect(r.resume).toBe("rt release app board");
    expect(w.calls.some((c) => c.startsWith("git tag -a"))).toBe(false);
  });

  test("a refused ref update says so instead of blaming a moved main", async () => {
    const w = new World();
    w.patchFails = "forbidden";
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r).detail).toContain("not allowed to update main");
    expect(lastStep(r).detail).not.toContain("moved");
  });

  test("a network failure on the ref update says main has not moved", async () => {
    const w = new World();
    w.patchFails = "network";
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r).detail).toContain("could not update main");
    expect(r.resume).toBe("rt release app board");
  });

  test("a local-only tag at another commit refuses the tag step", async () => {
    const w = new World();
    w.localTags.set("v2.13.2", "c0");
    const r = await runReleaseApp(w.seams(), opts());
    expect(lastStep(r)).toMatchObject({ id: "tag", status: "failed" });
    expect(lastStep(r).detail).toContain("local tag v2.13.2 points at c0");
    expect(w.calls.some((c) => c.startsWith("git push"))).toBe(false);
  });

  test("a release.yml run still going after the watch ends pending, not failed, though the release does not exist yet", async () => {
    const w = new World();
    w.releaseRunStatus = "in_progress";
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("pending");
    expect(lastStep(r)).toMatchObject({ id: "verify", status: "pending" });
    expect(lastStep(r).detail).toContain("still in_progress");
    expect(r.resume).toBe("rt release verify v2.13.2");
  });

  test("a releases/latest that has not caught up yet ends pending, not failed", async () => {
    const w = new World();
    w.latestOverride = LAST;
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.status).toBe("pending");
    expect(lastStep(r)).toMatchObject({ id: "verify", status: "pending" });
    expect(r.resume).toBe("rt release verify v2.13.2");
  });
});
