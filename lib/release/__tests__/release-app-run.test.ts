import { describe, expect, test } from "bun:test";
import { notesHash, renderNotes, runReleaseApp, type ReleaseAppOptions, type ReleaseAppSeams } from "../release-app.ts";
import type { RunResult } from "../../subprocess.ts";

const LAST = "v2.13.0";
const NEXT = "v2.13.1";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const err = (stderr: string, exitCode = 1): RunResult => ({ stdout: "", stderr, exitCode });

interface Commit {
  sha: string;
  parent: string | null;
  files: string[];
  notes: string;
  subject: string;
}

interface Run {
  id: number;
  tag: string;
  status: string;
  conclusion: string | null;
  html_url: string;
}

/** A stateful stand-in for the rt checkout and GitHub: git is real commands over an in-memory graph, gh is the API calls this module makes. */
class World {
  commits = new Map<string, Commit>();
  main: string;
  localTags = new Map<string, string>();
  remoteTags = new Map<string, string>();
  runs = new Map<number, Run>();
  written = new Map<string, string>();
  calls: string[][] = [];
  logs: string[] = [];
  confirmAnswer = true;
  confirmPrompts: string[] = [];
  releaseConclusion = "success";
  releaseRunStatus = "completed";
  tagPushFails = false;
  patchFails: false | "moved" | "forbidden" | "network" = false;
  latestOverride: string | null = null;
  clock = Date.parse("2026-09-25T15:00:00Z");
  private seq = 100;

  constructor() {
    this.commit("c0", null, ["apps/board/index.ts", "RELEASE_NOTES.md"], `${LAST} notes\n`, "first");
    this.main = "c0";
    this.localTags.set(LAST, "c0");
    this.remoteTags.set(LAST, "c0");
    this.releaseRun(LAST, "success");
  }

  commit(sha: string, parent: string | null, files: string[], notes: string, subject: string): Commit {
    const c = { sha, parent, files, notes, subject };
    this.commits.set(sha, c);
    return c;
  }

  /** Lands a commit on main (simulating a normal push, not this module's own writes). */
  land(files: string[], edit: Partial<Pick<Commit, "notes" | "subject">> = {}): string {
    const parent = this.commits.get(this.main)!;
    const sha = `c${this.seq++}`;
    this.commit(sha, this.main, files, edit.notes ?? parent.notes, edit.subject ?? "a commit");
    this.main = sha;
    return sha;
  }

  releaseRun(tag: string, conclusion: string, status = "completed"): void {
    const id = this.seq++;
    this.runs.set(id, { id, tag, status, conclusion: status === "completed" ? conclusion : null, html_url: `https://github.com/m4ttstack/rt/actions/runs/${id}` });
  }

  resolve(ref: string): Commit | undefined {
    if (ref === "origin/main") return this.commits.get(this.main);
    return this.commits.get(this.localTags.get(ref) ?? ref);
  }

  /** Commits in a..b, newest first (matches `git log`/`git diff`'s own walk). */
  range(a: string, b: string): Commit[] {
    const stop = this.resolve(a)?.sha;
    const out: Commit[] = [];
    for (let c = this.resolve(b); c && c.sha !== stop; c = c.parent ? this.commits.get(c.parent) : undefined) out.push(c);
    return out;
  }

  isAncestorOrEqual(a: string, bRef: string): boolean {
    for (let c = this.resolve(bRef); c; c = c.parent ? this.commits.get(c.parent) : undefined) {
      if (c.sha === a) return true;
    }
    return false;
  }

  assets(tag: string): { name: string }[] {
    const ver = tag.slice(1);
    return [{ name: `mattstack-${ver}.dmg` }, { name: `mattstack-${ver}.zip` }, { name: "appcast.xml" }, { name: "SHA256SUMS" }];
  }

  latestTag(): string {
    return this.latestOverride ?? [...this.remoteTags.keys()].sort((x, y) => (x < y ? 1 : -1))[0]!;
  }

  exec = async (argv: [string, ...string[]]): Promise<RunResult> => {
    this.calls.push(argv);
    const cmd = argv.join(" ");
    let m: RegExpMatchArray | null;

    if (cmd === "git fetch --quiet --tags origin main") return ok();
    if (cmd === "git rev-parse origin/main") return ok(`${this.main}\n`);
    if (cmd === "git ls-remote --tags --refs origin v*") {
      return ok([...this.remoteTags.entries()].map(([t, c]) => `${c}\trefs/tags/${t}`).join("\n") + "\n");
    }
    if (cmd === "git ls-remote origin refs/heads/main") return ok(`${this.main}\trefs/heads/main\n`);
    if ((m = cmd.match(/^git ls-remote --tags origin refs\/tags\/(\S+) refs\/tags\/\S+\^\{\}$/))) {
      const c = this.remoteTags.get(m[1]!);
      return ok(c ? `tagobj\trefs/tags/${m[1]}\n${c}\trefs/tags/${m[1]}^{}\n` : "");
    }
    if ((m = cmd.match(/^git diff --name-only (\S+)\.\.(\S+)$/))) {
      return ok([...new Set(this.range(m[1]!, m[2]!).flatMap((c) => c.files))].join("\n"));
    }
    if ((m = cmd.match(/^git log --format=%s (\S+)\.\.origin\/main -- apps\/(\S+)\/$/))) {
      const subjects = this.range(m[1]!, "origin/main").filter((c) => c.files.some((f) => f.startsWith(`apps/${m![2]}/`))).map((c) => c.subject);
      return ok(subjects.join("\n"));
    }
    if ((m = cmd.match(/^git log -1 --format=(\S+) (\S+)\.\.origin\/main -- RELEASE_NOTES\.md$/))) {
      const c = this.range(m[2]!, "origin/main").find((x) => x.files.includes("RELEASE_NOTES.md"));
      if (!c) return ok("");
      return ok(m[1] === "%H" ? c.sha : `${c.sha}\t${c.subject}`);
    }
    if ((m = cmd.match(/^git log -1 --format=%s (\S+)$/))) {
      const c = this.commits.get(m[1]!);
      return c ? ok(`${c.subject}\n`) : err("bad ref", 128);
    }
    if ((m = cmd.match(/^git merge-base --is-ancestor (\S+) (\S+)$/))) {
      return this.isAncestorOrEqual(m[1]!, m[2]!) ? ok() : err("", 1);
    }
    if ((m = cmd.match(/^git show (\S+):(\S+)$/))) {
      const c = this.resolve(m[1]!);
      if (!c) return err(`bad ref ${m[1]}`);
      return m[2] === "RELEASE_NOTES.md" ? ok(c.notes) : err(`fatal: path '${m[2]}' does not exist`, 128);
    }
    if ((m = cmd.match(/^git rev-parse (\S+)\^\{tree\}$/))) return ok(`tree-${m[1]}\n`);
    if ((m = cmd.match(/^git rev-parse -q --verify refs\/tags\/(\S+)\^\{commit\}$/))) {
      const c = this.localTags.get(m[1]!);
      return c ? ok(`${c}\n`) : err("", 1);
    }
    if ((m = cmd.match(/^git tag -a (\S+) (\S+) -m \S+$/))) {
      this.localTags.set(m[1]!, m[2]!);
      return ok();
    }
    if ((m = cmd.match(/^git push origin refs\/tags\/(\S+)$/))) {
      if (this.tagPushFails) return err("remote rejected");
      const tag = m[1]!;
      this.remoteTags.set(tag, this.localTags.get(tag)!);
      this.releaseRun(tag, this.releaseConclusion, this.releaseRunStatus);
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
      this.commit(sha, parent.sha, ["RELEASE_NOTES.md"], tree.tree[0]!.content, body.message);
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
      const runs = [...this.runs.values()].filter((r) => r.tag === m![1]);
      return ok(JSON.stringify({ workflow_runs: runs.map((r) => ({ id: r.id, html_url: r.html_url })) }));
    }
    if ((m = cmd.match(/^gh run view (\d+) --repo m4ttstack\/rt --json status,conclusion$/))) {
      const r = this.runs.get(Number(m[1]));
      return r ? ok(JSON.stringify({ status: r.status, conclusion: r.conclusion })) : err("no run");
    }
    if ((m = cmd.match(/^gh release view (\S+) --repo m4ttstack\/rt --json body,assets,isDraft,isPrerelease,publishedAt$/))) {
      const tag = m[1]!;
      const published = [...this.runs.values()].some((r) => r.tag === tag && r.status === "completed");
      if (!this.remoteTags.has(tag) || !published) return err("release not found");
      return ok(JSON.stringify({ body: this.commits.get(this.remoteTags.get(tag)!)!.notes, assets: this.assets(tag), isDraft: false, isPrerelease: false, publishedAt: new Date(this.clock).toISOString() }));
    }
    return err(`unexpected command: ${cmd}`);
  };

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
      confirm: async (message) => { this.confirmPrompts.push(message); return this.confirmAnswer; },
      log: (line) => { this.logs.push(line); },
      ...overrides,
    };
  }
}

const opts = (o: Partial<ReleaseAppOptions> = {}): ReleaseAppOptions => ({ name: "board", ...o });
const lastStep = (r: { steps: { id: string; status: string; detail: string }[] }) => r.steps.at(-1)!;
const MUTATING = [/^gh api -X PATCH /, /git\/trees --input/, /git\/commits --input/, /^git tag -a /, /^git push /];
const mutations = (calls: string[][]) => calls.map((c) => c.join(" ")).filter((c) => MUTATING.some((re) => re.test(c)));

/** Drives a run to the approval stop and returns the notes hash it printed. */
async function toApproval(w: World, name = "board"): Promise<string> {
  const r = await runReleaseApp(w.seams(), opts({ name }));
  if (r.status !== "awaiting-approval") throw new Error(`expected awaiting-approval, got ${r.status}: ${JSON.stringify(r.steps)}`);
  return r.notesHash!;
}

describe("runReleaseApp: qualification", () => {
  test("refuses an app that has not moved since the last tag", async () => {
    const w = new World();
    w.land(["apps/chat/x.ts", "RELEASE_NOTES.md"]);
    const r = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(r.status).toBe("declined");
    expect(r.steps[0]).toMatchObject({ id: "qualify", status: "stopped" });
    expect(r.steps[0]!.detail).toContain(`board has not moved since ${LAST}`);
  });

  test("refuses deck: it is not a served-only app", async () => {
    const w = new World();
    w.land(["apps/deck/x.ts"]);
    const r = await runReleaseApp(w.seams(), opts({ name: "deck", dryRun: true }));
    expect(r.status).toBe("declined");
  });

  test("refuses a diff that leaves the fast path", async () => {
    const w = new World();
    w.land(["apps/board/x.ts", "lib/daemon.ts"]);
    const r = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(r.status).toBe("declined");
    expect(r.steps[0]!.detail).toContain("lib/daemon.ts");
  });
});

describe("runReleaseApp: --dry-run", () => {
  test("plans notes, tag and verify for every moved app", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    w.land(["apps/chat/y.ts"], { subject: "chat: fix b" });
    const r = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(r.status).toBe("planned");
    expect(r.steps.map((s) => s.id)).toEqual(["qualify", "notes", "tag", "verify"]);
    expect(r.notes).toContain("### board");
    expect(r.notes).toContain("### chat");
    expect(r.nextTag).toBe(NEXT);
    expect(mutations(w.calls)).toEqual([]);
  });

  test("marks notes already committed on main as done, not planned", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    w.tagPushFails = true;
    const first = await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    expect(lastStep(first)).toMatchObject({ id: "tag", status: "failed" });

    const plan = await runReleaseApp(w.seams(), opts({ dryRun: true }));
    expect(plan.status).toBe("planned");
    expect(plan.steps.find((s) => s.id === "notes")).toMatchObject({ status: "done" });
  });
});

describe("runReleaseApp: the approval flow", () => {
  test("stops at the notes for approval, then tags the exercised sha on resume", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const first = await runReleaseApp(w.seams(), opts());
    expect(first.status).toBe("awaiting-approval");
    const second = await runReleaseApp(w.seams(), opts({ yesNotes: first.notesHash! }));
    expect(second.status).toBe("released");
    const notesSha = w.remoteTags.get(NEXT)!;
    expect(w.calls).toContainEqual(["git", "tag", "-a", NEXT, notesSha, "-m", NEXT]);
    expect(second.steps.find((s) => s.id === "tag")!.status).toBe("done");
  });

  test("a stale --yes-notes hash stops for approval again, not a commit", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: "0".repeat(12) }));
    expect(r.status).toBe("awaiting-approval");
    expect(r.steps.find((s) => s.id === "notes")).toMatchObject({ status: "stopped" });
    expect(mutations(w.calls)).toEqual([]);
  });

  test("on a TTY, declining the prompt stops with nothing committed", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    w.confirmAnswer = false;
    const r = await runReleaseApp(w.seams({ isTTY: true }), opts());
    expect(r.status).toBe("declined");
    expect(w.confirmPrompts).toEqual([`Commit these notes and tag ${NEXT}?`]);
    expect(mutations(w.calls)).toEqual([]);
  });

  test("on a TTY, accepting the prompt commits, tags and verifies", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    w.confirmAnswer = true;
    const r = await runReleaseApp(w.seams({ isTTY: true }), opts());
    expect(r.status).toBe("released");
  });

  test("the notes commit is a fast-forward of the verified main, never forced", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    const mainBefore = w.main;
    await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    const patch = [...w.written.entries()].find(([k]) => k.endsWith("notes-ref.json"))!;
    const body = JSON.parse(patch[1]) as { sha: string; force: boolean };
    expect(body.force).toBe(false);
    expect(w.commits.get(body.sha)!.parent).toBe(mainBefore);
  });

  test("main moving under the notes commit fails with the resume command", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    w.patchFails = "moved";
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    expect(lastStep(r)).toMatchObject({ id: "notes", status: "failed" });
    expect(lastStep(r).detail).toContain("main moved from");
    expect(r.resume).toBe("rt release app board");
  });
});

describe("runReleaseApp: resume", () => {
  test("a rerun after a mid-flight stop reuses the committed notes, not a fresh approval", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    w.tagPushFails = true;
    const first = await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    expect(lastStep(first)).toMatchObject({ id: "tag", status: "failed" });

    w.tagPushFails = false;
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.steps.find((s) => s.id === "notes")).toMatchObject({ status: "done" });
  });

  test("a RELEASE_NOTES.md commit with another subject is never reused as the notes commit", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    w.land(["RELEASE_NOTES.md"], { notes: "hand edit\n", subject: "docs: tidy the notes" });
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    expect(r.steps.find((s) => s.id === "notes")).toMatchObject({ status: "ok" });
    expect(r.notes).toContain("### board");
  });

  test("a local-only tag at another commit refuses the tag step", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    w.localTags.set(NEXT, "c0");
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    expect(lastStep(r)).toMatchObject({ id: "tag", status: "failed" });
    expect(lastStep(r).detail).toContain(`local tag ${NEXT} points at c0`);
  });

  test("an origin tag already at another commit refuses and points at manual resolution", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    const exec = w.exec;
    const seams = w.seams({
      exec: async (argv) => {
        if (argv.join(" ") === `git ls-remote --tags origin refs/tags/${NEXT} refs/tags/${NEXT}^{}`) {
          w.calls.push(argv);
          return ok(`tagobj\trefs/tags/${NEXT}\nc0\trefs/tags/${NEXT}^{}\n`);
        }
        return exec(argv);
      },
    });
    const r = await runReleaseApp(seams, opts({ yesNotes: hash }));
    expect(lastStep(r)).toMatchObject({ id: "tag", status: "failed" });
    expect(lastStep(r).detail).toContain(`origin's ${NEXT} points at c0`);
    expect(r.resume).toBeNull();
  });

  test("a release.yml run still in progress ends pending, not failed", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    w.releaseRunStatus = "in_progress";
    const r = await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    expect(r.status).toBe("pending");
    expect(lastStep(r)).toMatchObject({ id: "verify", status: "pending" });
    expect(r.resume).toBe(`rt release verify ${NEXT}`);
  });

  test("an unverified newest tag is re-verified instead of stacking a new release on it", async () => {
    const w = new World();
    for (const run of w.runs.values()) if (run.tag === LAST) run.conclusion = "failure";
    const r = await runReleaseApp(w.seams(), opts());
    expect(r.nextTag).toBe(LAST);
    expect(r.steps[0]!.detail).toContain("has not verified");
    expect(lastStep(r)).toMatchObject({ id: "verify", status: "failed" });
    expect(r.resume).toBe(`rt release verify ${LAST}`);
    expect(mutations(w.calls)).toEqual([]);
  });

  test("after a failed publish a rerun only re-verifies the pushed tag", async () => {
    const w = new World();
    w.land(["apps/board/x.ts"], { subject: "board: fix a" });
    const hash = await toApproval(w);
    w.releaseConclusion = "failure";
    const first = await runReleaseApp(w.seams(), opts({ yesNotes: hash }));
    expect(lastStep(first)).toMatchObject({ id: "verify", status: "failed" });
    expect(first.resume).toBe(`rt release verify ${NEXT}`);

    const before = w.calls.length;
    for (const run of w.runs.values()) if (run.tag === NEXT) run.conclusion = "success";
    const second = await runReleaseApp(w.seams(), opts());
    expect(second.status).toBe("released");
    expect(second.nextTag).toBe(NEXT);
    expect(second.steps.map((s) => s.status)).toEqual(["ok", "done", "done", "ok"]);
    expect(mutations(w.calls.slice(before))).toEqual([]);
  });
});
