/**
 * rt release app <name>: a served-app patch release end to end: qualify
 * origin/main for the path fast path, write and commit the notes, tag, and
 * verify the publish. Every step first detects whether it already happened,
 * so a rerun resumes: qualify always checks the newest tag's own verify
 * status before doing anything else. A clean newest tag that already covers
 * origin/main means nothing moved to release, so qualify declines; an
 * unverified one that already covers origin/main is re-checked instead of
 * refused; and before ever cutting a new tag, the newest tag must itself
 * have verified, or qualify refuses rather than stacking on top of it. An
 * already-committed notes commit is reused, and an existing local or remote
 * tag is confirmed rather than recreated.
 */
import { join } from "path";
import { createHash } from "crypto";
import type { RunResult } from "../subprocess.ts";
import { checkGate, compareVersions, keepsFastPath, movedServedApps } from "./preflight.ts";
import { runVerify, type VerifyReport, type VerifySeams } from "./verify.ts";

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
  /** A scratch directory, created on first use, for the gh api payload files. */
  workDir(): string;
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

const unverifiedSummary = (report: VerifyReport): string =>
  report.rows.filter((r) => r.status !== "ok").map((r) => `${r.label}: ${r.status}`).join(", ");

/** Every escaping error becomes a StepFailure carrying this step's id and resume, so the --json envelope is never empty. */
async function inStep<T>(id: StepId, resume: string | null, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StepFailure) throw err;
    throw new StepFailure(id, errMessage(err), resume);
  }
}

async function run(seams: ReleaseAppSeams, argv: [string, ...string[]], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  const r: RunResult = await seams.exec(argv, { timeoutMs: 60_000, ...opts });
  if (r.exitCode !== 0) throw new Error(`${argv.slice(0, 4).join(" ")} failed: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

const git = (seams: ReleaseAppSeams, args: string[], timeoutMs?: number): Promise<string> =>
  run(seams, ["git", ...args], { cwd: seams.repoRoot, ...(timeoutMs ? { timeoutMs } : {}) });

const gh = (seams: ReleaseAppSeams, args: string[]): Promise<string> => run(seams, ["gh", ...args]);

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

/** The commit a tag names, never the tag object: annotated tags need the explicit ^{} form to peel to it. */
async function peelTag(seams: ReleaseAppSeams, tag: string): Promise<string> {
  const lines = (await git(seams, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]))
    .split("\n").map((l) => l.trim()).filter(Boolean);
  const peeled = lines.find((l) => l.endsWith("^{}")) ?? lines[0];
  return peeled ? peeled.split(/\s+/)[0]! : "";
}

async function refreshMain(seams: ReleaseAppSeams): Promise<{ headSha: string }> {
  await git(seams, ["fetch", "--quiet", "--tags", "origin", "main"], 120_000);
  const headSha = (await git(seams, ["rev-parse", "origin/main"])).trim();
  return { headSha };
}

/**
 * Structural detection only, ignoring verify status: "released" when
 * origin/main is exactly the newest tag's release, either because its
 * commit sits at HEAD or because its own notes commit is the newest thing
 * on main with nothing but more notes committed after it; "notes" whenever
 * there is a new served-app diff to gate. `qualify` still has to consult the
 * newest tag's own verify status on top of this either way: a "released"
 * match whose tag already verified clean means nothing moved to release; a
 * "notes" match never cuts a new tag until the newest one has verified.
 */
async function resolvePhase(seams: ReleaseAppSeams, headSha: string, newestTag: string): Promise<Phase> {
  const peeled = await peelTag(seams, newestTag);
  if (!peeled) return "notes";
  if (peeled === headSha) return "released";
  const subject = (await git(seams, ["log", "-1", "--format=%s", peeled])).trim();
  if (subject !== `chore(release): notes for ${newestTag}`) return "notes";
  const ancestor = await seams.exec(["git", "merge-base", "--is-ancestor", peeled, "origin/main"], { cwd: seams.repoRoot });
  if (ancestor.exitCode !== 0) return "notes";
  const after = (await git(seams, ["diff", "--name-only", `${peeled}..origin/main`])).split("\n").map((l) => l.trim()).filter(Boolean);
  return after.every((f) => f === "RELEASE_NOTES.md") ? "released" : "notes";
}

interface Ctx {
  name: string;
  headSha: string;
  lastTag: string;
  nextTag: string;
  moved: string[];
  phase: Phase;
  /** The qualify step's own "ok" detail, phrased with whatever verify actually found. */
  qualifyDetail: string;
}

async function qualify(seams: ReleaseAppSeams, name: string): Promise<Ctx> {
  if (!keepsFastPath(name)) throw new StepFailure("qualify", `${name} is not a served-only app; use the full release process`, null);
  const { headSha } = await refreshMain(seams);
  const lastTag = newestReleaseTag(await remoteTags(seams));
  const structural = await resolvePhase(seams, headSha, lastTag);
  const verify = await runVerify(seams, { tag: lastTag, noWait: true, skipLatest: true });

  if (structural === "released") {
    if (verify.clean) throw new StepFailure("qualify", `${name} has not moved since ${lastTag}`, null);
    return {
      name, headSha, lastTag, nextTag: lastTag, moved: [], phase: "released",
      qualifyDetail: `${lastTag} has not moved since; its publish has not verified yet (${unverifiedSummary(verify)}), so re-checking it before any new release`,
    };
  }

  if (!verify.clean) {
    throw new StepFailure("qualify", `${lastTag} has not verified yet (${unverifiedSummary(verify)}); run rt release verify ${lastTag} first`, `rt release verify ${lastTag}`);
  }

  const gate = await checkGate(seams, lastTag, "origin/main");
  if (gate.path !== "fast") throw new StepFailure("qualify", `not a fast-path diff since ${lastTag}: ${gate.reason}`, null);
  const files = (await git(seams, ["diff", "--name-only", `${lastTag}..origin/main`])).split("\n").map((f) => f.trim()).filter(Boolean);
  const moved = movedServedApps(files);
  if (!moved.includes(name)) throw new StepFailure("qualify", `${name} has not moved since ${lastTag} (moved: ${moved.join(", ") || "none"})`, null);
  const nextTag = nextPatchTag(lastTag);
  return {
    name, headSha, lastTag, nextTag, moved, phase: "notes",
    qualifyDetail: `origin/main is on the fast path since ${lastTag}; ${moved.join(", ")} moved; releasing ${name} as ${nextTag}`,
  };
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
 * Notes already on main count only when they are this tag's notes commit;
 * otherwise they describe a different (older or hand-edited) release.
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

function writePayload(seams: ReleaseAppSeams, file: string, body: unknown): string {
  const path = join(seams.workDir(), file);
  seams.writeFile(path, JSON.stringify(body));
  return path;
}

/**
 * One commit of whole files on top of `parent`, then a fast-forward-only ref
 * update: never touches the operator's working tree, so a branch checked out
 * there, an untracked file, or a stale local main cannot wedge or misdirect
 * the release. A branch that moved underneath fails instead of being
 * overwritten.
 */
async function commitFiles(seams: ReleaseAppSeams, o: {
  step: StepId;
  parent: string;
  baseTree: string;
  files: { path: string; content: string }[];
  message: string;
  prefix: string;
  currentHead: () => Promise<string>;
  resume: string;
}): Promise<string> {
  const tree = (await gh(seams, ["api", `repos/${RT_REPO}/git/trees`, "--input",
    writePayload(seams, `${o.prefix}-tree.json`, { base_tree: o.baseTree, tree: o.files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })) }),
    "--jq", ".sha"])).trim();
  const commit = (await gh(seams, ["api", `repos/${RT_REPO}/git/commits`, "--input",
    writePayload(seams, `${o.prefix}-commit.json`, { message: o.message, tree, parents: [o.parent] }),
    "--jq", ".sha"])).trim();
  const update = await seams.exec(["gh", "api", "-X", "PATCH", `repos/${RT_REPO}/git/refs/heads/main`, "--input", writePayload(seams, `${o.prefix}-ref.json`, { sha: commit, force: false })], { timeoutMs: 60_000 });
  if (update.exitCode === 0) return commit;
  const reason = (update.stderr || update.stdout).trim();
  const head = o.parent.slice(0, 9);
  let now = "";
  try {
    now = await o.currentHead();
  } catch {
    now = "";
  }
  if (now && now !== o.parent) {
    throw new StepFailure(o.step, `main moved from ${head} to ${now.slice(0, 9)} before the commit landed; nothing changed`, o.resume);
  }
  if (/HTTP 40[13]|protected branch|not accessible|permission/i.test(reason)) {
    throw new StepFailure(o.step, `not allowed to update main (${reason}); check the gh token's scopes and the branch protection. Nothing changed`, null);
  }
  throw new StepFailure(o.step, `could not update main (${reason}); it is still at ${head}, so a rerun retries. Nothing changed`, o.resume);
}

async function commitNotes(seams: ReleaseAppSeams, ctx: Ctx, notes: string): Promise<string> {
  return commitFiles(seams, {
    step: "notes",
    parent: ctx.headSha,
    baseTree: (await git(seams, ["rev-parse", `${ctx.headSha}^{tree}`])).trim(),
    files: [{ path: "RELEASE_NOTES.md", content: notes }],
    message: `chore(release): notes for ${ctx.nextTag}`,
    prefix: "notes",
    currentHead: async () => (await git(seams, ["ls-remote", "origin", "refs/heads/main"], 30_000)).split(/\s+/)[0] ?? "",
    resume: `rt release app ${ctx.name}`,
  });
}

type Recorder = (id: StepId, status: StepStatus, detail: string, command?: string) => void;

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

  const remoteSha = await peelTag(seams, tag);
  if (remoteSha) {
    if (remoteSha !== sha) throw new StepFailure("tag", `origin's ${tag} points at ${remoteSha.slice(0, 9)}, not the notes commit ${sha.slice(0, 9)}; resolve it by hand`, null);
    return rec("tag", "done", `${tag} is already on origin at ${sha.slice(0, 9)}`);
  }
  await git(seams, ["push", "origin", `refs/tags/${tag}`], 120_000);
  rec("tag", "done", `pushed ${tag} at ${sha.slice(0, 9)}`);
}

async function finishVerify(
  seams: ReleaseAppSeams,
  tag: string,
  rec: Recorder,
  report: (status: ReleaseStatus, resume?: string | null) => ReleaseAppReport,
): Promise<ReleaseAppReport> {
  seams.log(`  watching release.yml for ${tag} (a real run takes 25-50 minutes)`);
  try {
    const verify = await runVerify(seams, { tag });
    if (verify.clean) {
      rec("verify", "ok", `${tag} is published: run, notes, assets, state and releases/latest all verify`);
      return report("released");
    }
    const runRow = verify.rows.find((r) => r.id === "run");
    if (runRow?.status === "pending" || (verify.staleCount === 0 && verify.errorCount === 0)) {
      rec("verify", "pending", runRow ? `${runRow.label}: ${runRow.detail ?? runRow.status}` : "still propagating");
      return report("pending", `rt release verify ${tag}`);
    }
    const open = verify.rows.filter((r) => r.status !== "ok").map((r) => `${r.label}: ${r.detail ?? r.status}`).join("; ");
    rec("verify", "failed", open);
    return report("failed", `rt release verify ${tag}`);
  } catch (err) {
    rec("verify", "failed", errMessage(err));
    return report("failed", `rt release verify ${tag}`);
  }
}

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
    ctx = await inStep("qualify", rerun, () => qualify(seams, opts.name));
  } catch (err) {
    if (!(err instanceof StepFailure)) throw err;
    if (err.resume === null) {
      rec("qualify", "stopped", err.message);
      return report("declined");
    }
    rec("qualify", "failed", err.message);
    return report("failed", err.resume);
  }
  lastTag = ctx.lastTag;
  nextTag = ctx.nextTag;

  if (ctx.phase === "released") {
    rec("qualify", "ok", ctx.qualifyDetail);
    try {
      notes = await git(seams, ["show", `${ctx.lastTag}:RELEASE_NOTES.md`]);
      hash = notesHash(notes);
    } catch {
      // no RELEASE_NOTES.md at this ref; the report simply carries no notes text
    }
    rec("notes", "done", `${ctx.lastTag} already ships these notes`);
    rec("tag", "done", `${ctx.lastTag} is on origin`);
    if (opts.dryRun) {
      rec("verify", "planned", `would re-verify ${ctx.lastTag}`, `rt release verify ${ctx.lastTag}`);
      return report("planned");
    }
    return finishVerify(seams, ctx.lastTag, rec, report);
  }

  rec("qualify", "ok", ctx.qualifyDetail);

  const sections = await inStep("notes", rerun, () => notesSectionsFor(seams, ctx.lastTag, ctx.moved));
  notes = renderNotes({ sections, lastTag: ctx.lastTag, nextTag: ctx.nextTag });
  hash = notesHash(notes);

  if (opts.dryRun) {
    const already = await inStep("notes", rerun, () => committedNotes(seams, ctx));
    if (already) {
      rec("notes", "done", `RELEASE_NOTES.md for ${ctx.nextTag} is already committed on main (${already.sha.slice(0, 9)})`);
    } else {
      rec("notes", "planned", `generate RELEASE_NOTES.md for ${ctx.lastTag}..origin/main, approve them (--yes-notes <hash> off a terminal), commit them on main`);
    }
    rec("tag", "planned", `tag ${ctx.nextTag} at the notes commit and push it`, `git tag -a ${ctx.nextTag} <notes commit> -m ${ctx.nextTag}`);
    rec("verify", "planned", "watch release.yml and check the published release", `rt release verify ${ctx.nextTag}`);
    return report("planned");
  }

  let notesSha: string;
  const committed = await inStep("notes", rerun, () => committedNotes(seams, ctx));
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
      let confirmed: boolean;
      try {
        confirmed = await inStep("notes", rerun, () => seams.confirm(`Commit these notes and tag ${ctx.nextTag}?`));
      } catch (err) {
        if (!(err instanceof StepFailure)) throw err;
        rec("notes", "failed", err.message);
        return report("failed", err.resume);
      }
      if (!confirmed) {
        rec("notes", "stopped", "declined at the prompt; nothing committed");
        return report("declined", rerun);
      }
    }
    try {
      notesSha = await inStep("notes", rerun, () => commitNotes(seams, ctx, notes!));
    } catch (err) {
      if (!(err instanceof StepFailure)) throw err;
      rec("notes", "failed", err.message);
      return report("failed", err.resume);
    }
    rec("notes", "ok", `committed RELEASE_NOTES.md for ${ctx.nextTag} on main (${notesSha.slice(0, 9)})`);
  }

  try {
    await inStep("tag", rerun, () => tagStep(seams, ctx, notesSha, rec));
  } catch (err) {
    if (!(err instanceof StepFailure)) throw err;
    rec("tag", "failed", err.message);
    return report("failed", err.resume);
  }

  return finishVerify(seams, ctx.nextTag, rec, report);
}
