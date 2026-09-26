/**
 * rt release app <name>: a served-app patch release end to end: qualify
 * origin/main for the path fast path, write and commit the notes, tag, and
 * verify the publish. Every step first detects whether it already happened,
 * so a rerun resumes.
 */
import { createHash } from "crypto";
import { join } from "path";
import type { RunResult } from "../subprocess.ts";
import { checkGate, compareVersions, keepsFastPath, movedServedApps } from "./preflight.ts";
import { runVerify, type VerifySeams } from "./verify.ts";

export const RT_REPO = "m4ttstack/rt";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function bumpPatch(version: string): string {
  const m = version.match(SEMVER);
  if (!m) throw new Error(`version ${version} is not X.Y.Z; bump it by hand`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function nextPatchTag(tag: string): string {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`last tag ${tag} is not vX.Y.Z`);
  return `v${bumpPatch(tag.slice(1))}`;
}

const DASHES = new RegExp(`\\s*[${String.fromCharCode(0x2013, 0x2014)}]\\s*`, "g");

/** An em or en dash in a commit subject reads badly in the release notes markdown. */
export function noteSubject(subject: string): string {
  return subject.trim().replace(DASHES, "... ");
}

export interface NotesSection {
  app: string;
  subjects: string[];
}

function listJoin(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function renderNotes(o: { sections: NotesSection[]; lastTag: string; nextTag: string }): string {
  const lines = [`A patch release that ships ${listJoin(o.sections.map((s) => s.app))}.`, ""];
  for (const s of o.sections) {
    lines.push(`### ${s.app}`, "");
    const bullets = s.subjects.length ? s.subjects.map(noteSubject) : [`no other commits under apps/${s.app}`];
    lines.push(...bullets.map((b) => `- ${b}`), "");
  }
  lines.push(`**Full Changelog**: https://github.com/${RT_REPO}/compare/${o.lastTag}...${o.nextTag}`, "");
  return lines.join("\n");
}

/** What `--yes-notes` binds an approval to: these exact notes, not whatever a later run generates. */
export function notesHash(notes: string): string {
  return createHash("sha256").update(notes).digest("hex").slice(0, 12);
}

export type Phase = "notes" | "released";
export type StepId = "qualify" | "notes" | "tag" | "verify";
export type StepStatus = "ok" | "done" | "planned" | "failed" | "stopped" | "pending";

export interface StepResult {
  id: StepId;
  label: string;
  status: StepStatus;
  detail: string;
  command?: string;
}

export type ReleaseStatus = "released" | "planned" | "awaiting-approval" | "declined" | "pending" | "failed";

export interface ReleaseAppReport {
  app: string;
  status: ReleaseStatus;
  lastTag: string | null;
  nextTag: string | null;
  steps: StepResult[];
  notes: string | null;
  notesHash: string | null;
  resume: string | null;
}

export interface ReleaseAppOptions {
  name: string;
  dryRun?: boolean;
  json?: boolean;
  /** The hash a stopped run printed for the notes it showed; null/omitted asks, or stops off a TTY. */
  yesNotes?: string | null;
}

export interface ReleaseAppSeams extends VerifySeams {
  /** True only when a human can answer the notes prompt (a real TTY, RT_BATCH unset). */
  isTTY: boolean;
  readFile(path: string): string | null;
  writeFile(path: string, text: string): void;
  confirm(message: string): Promise<boolean>;
  log(line: string): void;
}

const LABELS: Record<StepId, string> = {
  qualify: "qualify",
  notes: "release notes",
  tag: "tag",
  verify: "verify publish",
};

const STEP_MARK: Record<StepStatus, string> = { ok: "✓", done: "-", planned: "•", failed: "✗", stopped: "!", pending: "…" };

export function formatStep(s: StepResult): string {
  return `${STEP_MARK[s.status]} ${s.label}: ${s.detail}${s.command ? `\n    ${s.command}` : ""}`;
}

class StepFailure extends Error {
  constructor(readonly step: StepId, message: string, readonly resume: string | null) {
    super(message);
  }
}

const errMessage = (err: unknown): string => String((err as Error)?.message ?? err);

async function run(seams: ReleaseAppSeams, argv: [string, ...string[]], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  const r: RunResult = await seams.exec(argv, { timeoutMs: 60_000, ...opts });
  if (r.exitCode !== 0) throw new Error(`${argv.slice(0, 4).join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

const git = (seams: ReleaseAppSeams, args: string[], timeoutMs?: number): Promise<string> =>
  run(seams, ["git", ...args], { cwd: seams.repoRoot, ...(timeoutMs ? { timeoutMs } : {}) });

interface RemoteTag {
  name: string;
  sha: string;
}

/** origin's tags, never local ones: a local-only tag is a failed push or a stray, not a release. */
async function remoteTags(seams: ReleaseAppSeams): Promise<RemoteTag[]> {
  return (await git(seams, ["ls-remote", "--tags", "--refs", "origin", "v*"]))
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((l) => {
      const [sha, ref] = l.split(/\s+/);
      return { sha: sha!, name: (ref ?? "").replace(/^refs\/tags\//, "") };
    })
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t.name))
    .sort((a, b) => compareVersions(b.name.slice(1), a.name.slice(1)));
}

function newestReleaseTag(tags: RemoteTag[]): string {
  const newest = tags[0];
  if (!newest) throw new StepFailure("qualify", "origin has no vX.Y.Z tag; run this from an rt checkout", null);
  return newest.name;
}

async function refreshMain(seams: ReleaseAppSeams): Promise<{ headSha: string }> {
  await git(seams, ["fetch", "--quiet", "--tags", "origin", "main"], 120_000);
  const headSha = (await git(seams, ["rev-parse", "origin/main"])).trim();
  return { headSha };
}

interface Ctx {
  name: string;
  headSha: string;
  lastTag: string;
  nextTag: string;
  moved: string[];
}

async function qualify(seams: ReleaseAppSeams, name: string): Promise<Ctx> {
  if (!keepsFastPath(name)) throw new StepFailure("qualify", `${name} is not a served-only app; use the full release process`, null);
  const { headSha } = await refreshMain(seams);
  const lastTag = newestReleaseTag(await remoteTags(seams));
  const gate = await checkGate(seams, lastTag, "origin/main");
  if (gate.path !== "fast") throw new StepFailure("qualify", `not a fast-path diff since ${lastTag}: ${gate.reason}`, null);
  const files = (await git(seams, ["diff", "--name-only", `${lastTag}..origin/main`])).split("\n").map((f) => f.trim()).filter(Boolean);
  const moved = movedServedApps(files);
  if (!moved.includes(name)) throw new StepFailure("qualify", `${name} has not moved since ${lastTag} (moved: ${moved.join(", ") || "none"})`, null);
  return { name, headSha, lastTag, nextTag: nextPatchTag(lastTag), moved };
}

export async function notesSectionsFor(seams: ReleaseAppSeams, lastTag: string, apps: string[]): Promise<NotesSection[]> {
  const sections: NotesSection[] = [];
  for (const app of apps) {
    const out = await git(seams, ["log", "--format=%s", `${lastTag}..origin/main`, "--", `apps/${app}/`]);
    const subjects = out.split("\n").map((l) => l.trim()).filter(Boolean);
    sections.push({ app, subjects });
  }
  return sections;
}

/**
 * A tag newer than the one qualify read means an earlier run already
 * finished; a rerun then only re-verifies the publish.
 */
async function resolvePhase(seams: ReleaseAppSeams, ctx: Ctx): Promise<Phase> {
  const tags = await remoteTags(seams);
  return tags.some((t) => t.name === ctx.nextTag) ? "released" : "notes";
}

/**
 * Notes already on main count only when they are this tag's notes commit;
 * otherwise they describe a different (older or newer) release.
 */
async function committedNotes(seams: ReleaseAppSeams, ctx: Ctx): Promise<{ sha: string; text: string } | null> {
  const range = `${ctx.lastTag}..origin/main`;
  const line = (await git(seams, ["log", "-1", "--format=%H%x09%s", range, "--", "RELEASE_NOTES.md"])).trim();
  if (!line) return null;
  const tab = line.indexOf("\t");
  const sha = line.slice(0, tab);
  const subject = line.slice(tab + 1);
  const expected = `chore(release): notes for ${ctx.nextTag}`;
  if (subject !== expected) return null;
  return { sha, text: await git(seams, ["show", `${sha}:RELEASE_NOTES.md`]) };
}

/** A rerun after a crash mid-write must never land on top of an unrelated local edit. */
async function commitNotes(seams: ReleaseAppSeams, ctx: Ctx, notes: string): Promise<string> {
  const porcelain = (await git(seams, ["status", "--porcelain"])).trim();
  if (porcelain) {
    throw new StepFailure("notes", `the working tree is dirty (${porcelain.split("\n").length} change(s)); commit or stash before releasing`, null);
  }
  seams.writeFile(join(seams.repoRoot, "RELEASE_NOTES.md"), notes);
  await git(seams, ["add", "RELEASE_NOTES.md"]);
  await git(seams, ["commit", "-m", `chore(release): notes for ${ctx.nextTag}`]);
  const sha = (await git(seams, ["rev-parse", "HEAD"])).trim();
  await git(seams, ["push", "origin", "HEAD:main"], 120_000);
  return sha;
}

async function tagStep(seams: ReleaseAppSeams, ctx: Ctx, sha: string, rec: Recorder): Promise<void> {
  const tag = ctx.nextTag;
  const local = await seams.exec(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`], { cwd: seams.repoRoot });
  if (local.exitCode === 0) {
    const at = local.stdout.trim();
    if (at !== sha) {
      throw new StepFailure("tag", `local tag ${tag} points at ${at.slice(0, 9)}, not the notes commit ${sha.slice(0, 9)}`, `git tag -d ${tag}, then rt release app ${ctx.name}`);
    }
  } else {
    await git(seams, ["tag", "-a", tag, sha, "-m", tag]);
  }

  // Without the explicit ^{} pattern ls-remote prints only the tag object, never the commit it peels to.
  const remote = (await git(seams, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`])).split("\n").map((l) => l.trim()).filter(Boolean);
  if (remote.length) {
    const at = (remote.find((l) => l.endsWith("^{}")) ?? remote[0]!).split(/\s+/)[0]!;
    if (at !== sha) throw new StepFailure("tag", `origin's ${tag} points at ${at.slice(0, 9)}, not the notes commit ${sha.slice(0, 9)}; resolve it by hand`, null);
    return rec("tag", "done", `${tag} is already on origin at ${sha.slice(0, 9)}`);
  }
  await git(seams, ["push", "origin", `refs/tags/${tag}`], 120_000);
  rec("tag", "done", `pushed ${tag} at ${sha.slice(0, 9)}`);
}

type Recorder = (id: StepId, status: StepStatus, detail: string, command?: string) => void;

export async function runReleaseApp(seams: ReleaseAppSeams, rawOpts: ReleaseAppOptions): Promise<ReleaseAppReport> {
  const opts = { dryRun: false, json: false, yesNotes: null, ...rawOpts };
  const steps: StepResult[] = [];
  const rec: Recorder = (id, status, detail, command) => {
    const step: StepResult = { id, label: LABELS[id], status, detail, ...(command ? { command } : {}) };
    steps.push(step);
    seams.log(formatStep(step));
  };

  let lastTag: string | null = null;
  let nextTag: string | null = null;
  let notes: string | null = null;
  let hash: string | null = null;
  const report = (status: ReleaseStatus, resume: string | null = null): ReleaseAppReport => ({
    app: opts.name, status, lastTag, nextTag, steps, notes, notesHash: hash, resume,
  });
  const rerun = `rt release app ${opts.name}`;

  let ctx: Ctx;
  try {
    ctx = await qualify(seams, opts.name);
  } catch (err) {
    if (!(err instanceof StepFailure)) throw err;
    rec("qualify", "stopped", err.message);
    return report("declined");
  }
  lastTag = ctx.lastTag;
  nextTag = ctx.nextTag;
  rec("qualify", "ok", `origin/main is on the fast path since ${ctx.lastTag}; ${ctx.moved.join(", ")} moved; releasing ${opts.name} as ${ctx.nextTag}`);

  const sections = await notesSectionsFor(seams, ctx.lastTag, ctx.moved);
  notes = renderNotes({ sections, lastTag: ctx.lastTag, nextTag: ctx.nextTag });
  hash = notesHash(notes);

  if (opts.dryRun) {
    rec("notes", "planned", `generate RELEASE_NOTES.md for ${ctx.lastTag}..origin/main, approve them (--yes-notes <hash> off a terminal), commit them on main`);
    rec("tag", "planned", `tag ${ctx.nextTag} at the notes commit and push it`, `git tag -a ${ctx.nextTag} <notes commit> -m ${ctx.nextTag}`);
    rec("verify", "planned", "watch release.yml and check the published release", `rt release verify ${ctx.nextTag}`);
    return report("planned");
  }

  const phase = await resolvePhase(seams, ctx);
  if (phase === "released") {
    const tag = (await remoteTags(seams)).find((t) => t.name === ctx.nextTag)!;
    notes = await git(seams, ["show", `${tag.sha}:RELEASE_NOTES.md`]);
    hash = notesHash(notes);
    rec("notes", "done", `${ctx.nextTag} already ships these notes`);
    rec("tag", "done", `${ctx.nextTag} is on origin`);
  } else {
    let notesSha: string;
    const committed = await committedNotes(seams, ctx);
    if (committed) {
      notesSha = committed.sha;
      notes = committed.text;
      hash = notesHash(notes);
      rec("notes", "done", `RELEASE_NOTES.md for ${ctx.nextTag} is already committed on main (${committed.sha.slice(0, 9)})`);
    } else {
      if (opts.yesNotes !== null) {
        if (opts.yesNotes !== hash) {
          if (!opts.json) seams.log(`\n${notes}\nnotes hash ${hash}`);
          rec("notes", "stopped", `--yes-notes ${opts.yesNotes} does not match these notes (hash ${hash} for ${ctx.nextTag}): these notes need approval, nothing committed`);
          return report("awaiting-approval", `${rerun}${opts.json ? " --json" : ""} --yes-notes ${hash}`);
        }
      } else {
        if (!opts.json) seams.log(`\n${notes}\nnotes hash ${hash}`);
        if (opts.json || !seams.isTTY) {
          rec("notes", "stopped", `the notes for ${ctx.nextTag} (hash ${hash}) need approval; nothing committed`);
          return report("awaiting-approval", `${rerun}${opts.json ? " --json" : ""} --yes-notes ${hash}`);
        }
        if (!(await seams.confirm(`Commit these notes and tag ${ctx.nextTag}?`))) {
          rec("notes", "stopped", "declined at the prompt; nothing committed");
          return report("declined", rerun);
        }
      }
      try {
        notesSha = await commitNotes(seams, ctx, notes);
      } catch (err) {
        if (!(err instanceof StepFailure)) throw err;
        rec("notes", "failed", err.message);
        return report("failed", err.resume);
      }
      rec("notes", "ok", `committed RELEASE_NOTES.md for ${ctx.nextTag} on main (${notesSha.slice(0, 9)})`);
    }

    try {
      await tagStep(seams, ctx, notesSha, rec);
    } catch (err) {
      if (!(err instanceof StepFailure)) throw err;
      rec("tag", "failed", err.message);
      return report("failed", err.resume);
    }
  }

  try {
    const verify = await runVerify(seams, { tag: ctx.nextTag });
    if (verify.clean) {
      rec("verify", "ok", `${ctx.nextTag} is published: run, notes, assets, state and releases/latest all verify`);
      return report("released");
    }
    const runRow = verify.rows.find((r) => r.id === "run");
    if (runRow?.status === "pending" || (verify.staleCount === 0 && verify.errorCount === 0)) {
      rec("verify", "pending", runRow ? `${runRow.label}: ${runRow.detail ?? runRow.status}` : "still propagating");
      return report("pending", `rt release verify ${ctx.nextTag}`);
    }
    const open = verify.rows.filter((r) => r.status !== "ok").map((r) => `${r.label}: ${r.detail ?? r.status}`).join("; ");
    rec("verify", "failed", open);
    return report("failed", `rt release verify ${ctx.nextTag}`);
  } catch (err) {
    rec("verify", "failed", errMessage(err));
    return report("failed", `rt release verify ${ctx.nextTag}`);
  }
}
