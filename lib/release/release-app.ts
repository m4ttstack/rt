/**
 * rt release app <name>... a single served-app patch release end to end:
 * qualify origin/main for the pin-only fast path, bump the app on apps main,
 * run bundle-apps, verify and merge its deps.lock PR, write and commit the
 * notes, tag, and verify the publish.
 *
 * Every step first detects whether it already happened, so a rerun after a
 * failure resumes where the last one stopped. Every external effect goes
 * through ReleaseAppSeams; the real seams live in commands/release.ts.
 */
import { join } from "path";
import type { RunResult } from "../subprocess.ts";
import { checkGate, classifyRows, compareVersions, keepsFastPath, pinnedTagFromUrl, type DepsRow } from "./preflight.ts";
import { pollRunCompletion, runVerify, type VerifyReport, type VerifySeams } from "./verify.ts";

export const APPS_REPO = "m4ttstack/apps";
export const RT_REPO = "m4ttstack/rt";
const LOCK_PATH = "rt-tray/deps.lock";

export type Phase = "bump" | "bundle" | "notes" | "released";

export type PhaseDecision = { phase: Phase; target: string } | { refuse: string };

export function appAssetUrl(name: string, version: string): string {
  return `https://github.com/${APPS_REPO}/releases/download/${name}-v${version}/${name}-darwin-arm64.tgz`;
}

export function appTagFor(name: string, version: string): string {
  return `${name}-v${version}`;
}

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

/** Rewrites the top-level version in place so the rest of package.json keeps its exact bytes. */
export function setPackageVersion(text: string, from: string, to: string): string {
  const re = /("version"\s*:\s*")([^"\\]*)(")/;
  const m = text.match(re);
  if (!m) throw new Error(`package.json has no "version" field`);
  if (m[2] !== from) throw new Error(`package.json is at ${m[2]}, expected ${from}`);
  const out = text.replace(re, (_all, open: string, _v: string, close: string) => `${open}${to}${close}`);
  if ((JSON.parse(out) as { version?: unknown }).version !== to) {
    throw new Error(`package.json's first "version" key is not its top-level version; bump it by hand`);
  }
  return out;
}

export function eligibleApps(rows: DepsRow[]): DepsRow[] {
  return classifyRows(rows).apps.filter((r) => keepsFastPath(r.name));
}

export function qualifyRow(name: string, rows: DepsRow[]): DepsRow {
  const eligible = eligibleApps(rows).map((r) => r.name).join(", ");
  const row = rows.find((r) => r.name === name);
  if (!row) throw new Error(`no ${LOCK_PATH} row named "${name}"; eligible apps: ${eligible}`);
  if (!classifyRows([row]).apps.length) {
    throw new Error(`${name} is not an apps-monorepo row in ${LOCK_PATH}; eligible apps: ${eligible}`);
  }
  if (!keepsFastPath(name)) {
    throw new Error(`${name}'s pin keeps the full gate (the walkthrough gates it), so it cannot ship on the fast path; cut it with the full /rt:release`);
  }
  return row;
}

/**
 * Where a run starts, read from remote state alone: `pinned` is origin/main's
 * pin, `shipped` the last v* tag's, `shippedBefore` the tag before that's, and
 * `appsMain` apps main's package.json version.
 */
export async function resolvePhase(o: {
  name: string;
  pinned: string;
  shipped: string;
  shippedBefore: string | null;
  appsMain: string;
  pinTag: string;
  appMoved: () => Promise<boolean>;
}): Promise<PhaseDecision> {
  const ahead = compareVersions(o.appsMain, o.pinned);
  if (ahead < 0) {
    return { refuse: `apps main has ${o.name} ${o.appsMain}, behind the pin ${o.pinned}; fix apps/${o.name}/package.json by hand` };
  }
  if (ahead > 0) return { phase: "bundle", target: o.appsMain };
  if (o.pinned !== o.shipped) return { phase: "notes", target: o.pinned };
  if (await o.appMoved()) return { phase: "bump", target: bumpPatch(o.pinned) };
  if (o.shippedBefore !== null && o.shippedBefore !== o.shipped) return { phase: "released", target: o.pinned };
  return { refuse: `nothing to release: no commits under apps/${o.name} since ${o.pinTag}` };
}

interface Lock {
  tools: DepsRow[];
  [key: string]: unknown;
}

export function checkBotPrLock(o: {
  name: string;
  version: string;
  files: string[];
  baseLock: string;
  headLock: string;
}): { row: DepsRow | null; problems: string[] } {
  const problems: string[] = [];
  const extra = o.files.filter((f) => f !== LOCK_PATH);
  if (extra.length) problems.push(`touches files besides ${LOCK_PATH}: ${extra.join(", ")}`);

  let base: Lock;
  let head: Lock;
  try {
    base = JSON.parse(o.baseLock) as Lock;
    head = JSON.parse(o.headLock) as Lock;
  } catch (err) {
    return { row: null, problems: [...problems, `deps.lock does not parse: ${String((err as Error).message ?? err)}`] };
  }

  const { tools: baseTools, ...baseTop } = base;
  const { tools: headTools, ...headTop } = head;
  if (JSON.stringify(baseTop) !== JSON.stringify(headTop)) problems.push("changes deps.lock's top-level fields");

  const baseRows = new Map(baseTools.map((r) => [r.name, r]));
  const headRows = new Map(headTools.map((r) => [r.name, r]));
  const others = [...new Set([...baseRows.keys(), ...headRows.keys()])]
    .filter((n) => n !== o.name && JSON.stringify(baseRows.get(n)) !== JSON.stringify(headRows.get(n)));
  if (others.length) problems.push(`rows other than ${o.name} changed: ${others.join(", ")}`);

  const row = headRows.get(o.name) ?? null;
  if (!row) {
    problems.push(`has no ${o.name} row`);
    return { row, problems };
  }
  if (row.version !== o.version) problems.push(`pins ${o.name} ${row.version}, expected ${o.version}`);
  const url = appAssetUrl(o.name, o.version);
  if (row.url !== url) problems.push(`pins url ${row.url}, expected ${url}`);
  if (!/^[0-9a-f]{64}$/.test(row.sha256 ?? "")) problems.push(`has no sha256 on the ${o.name} row`);
  return { row, problems };
}

export function checkCodesign(name: string, output: string): string[] {
  const lines = output.split("\n").map((l) => l.trim());
  const want = `com.mattstack.helper.${name}`;
  const id = lines.find((l) => l.startsWith("Identifier="))?.slice("Identifier=".length);
  const problems: string[] = [];
  if (id !== want) problems.push(`codesign Identifier is ${id ?? "missing"}, expected ${want}`);
  if (!lines.some((l) => l.startsWith("Authority=Developer ID Application"))) {
    problems.push("codesign shows no Developer ID Application authority (ad-hoc or unsigned)");
  }
  return problems;
}

export type ChecksVerdict =
  | { state: "green" }
  | { state: "pending"; pending: string[] }
  | { state: "failed"; failed: string[] };

/** Merge-on-green: zero pending and at least one pass, any fail blocks. CodeRabbit never counts either way. */
export function evaluateChecks(checks: { name: string; bucket: string }[]): ChecksVerdict {
  const relevant = checks.filter((c) => !/coderabbit/i.test(c.name));
  const failed = relevant.filter((c) => c.bucket === "fail" || c.bucket === "cancel").map((c) => c.name);
  if (failed.length) return { state: "failed", failed };
  const pending = relevant.filter((c) => c.bucket === "pending").map((c) => c.name);
  if (pending.length || !relevant.some((c) => c.bucket === "pass")) return { state: "pending", pending };
  return { state: "green" };
}

const DASHES = new RegExp(`\\s*[${String.fromCharCode(0x2013, 0x2014)}]\\s*`, "g");

/** Bare #123 in an rt release body would link to rt's PR 123, not the apps PR the subject means. */
export function noteSubject(subject: string): string {
  return subject.trim().replace(/(^|[\s(])#(\d+)\b/g, `$1${APPS_REPO}#$2`).replace(DASHES, "... ");
}

export interface NotesSection {
  app: string;
  version: string;
  subjects: string[];
}

function listJoin(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function renderNotes(o: { sections: NotesSection[]; lastTag: string; nextTag: string }): string {
  const lines = [`A patch release that ships ${listJoin(o.sections.map((s) => `${s.app} ${s.version}`))}.`, ""];
  for (const s of o.sections) {
    lines.push(`### ${s.app.charAt(0).toUpperCase()}${s.app.slice(1)} ${s.version}`, "");
    const bullets = s.subjects.length ? s.subjects.map(noteSubject) : [`version bump only; no other commits under apps/${s.app}`];
    lines.push(...bullets.map((b) => `- ${b}`), "");
  }
  lines.push(`**Full Changelog**: https://github.com/${RT_REPO}/compare/${o.lastTag}...${o.nextTag}`, "");
  return lines.join("\n");
}

export function bumpSubject(name: string, version: string): string {
  return `${name} ${version}: version bump for the rt release`;
}

export type StepId = "qualify" | "bump" | "bundle" | "pr" | "notes" | "tag" | "verify";
export type StepStatus = "ok" | "done" | "planned" | "failed" | "stopped";

export interface StepResult {
  id: StepId;
  label: string;
  status: StepStatus;
  detail: string;
  command?: string;
}

export type ReleaseStatus = "released" | "planned" | "awaiting-approval" | "declined" | "failed";

export interface ReleaseAppReport {
  app: string;
  status: ReleaseStatus;
  /** The v* tag this release is cut from. */
  lastTag: string | null;
  /** The v* tag this release produces. */
  tag: string | null;
  appVersion: string | null;
  appTag: string | null;
  steps: StepResult[];
  notes: string | null;
  verify: VerifyReport | null;
  resume: string | null;
}

export interface ReleaseAppOptions {
  name: string;
  dryRun: boolean;
  json: boolean;
  yesNotes: boolean;
}

export interface ReleaseAppSeams extends VerifySeams {
  /** True only when a human can answer the notes prompt (a real TTY, RT_BATCH unset). */
  isTTY: boolean;
  /** A scratch directory, created on first use. */
  workDir(): string;
  readFile(path: string): string | null;
  writeFile(path: string, text: string): void;
  download(url: string, destPath: string): Promise<void>;
  sha256File(path: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
  log(line: string): void;
}

const LABELS: Record<StepId, string> = {
  qualify: "qualify",
  bump: "bump apps main",
  bundle: "bundle-apps run",
  pr: "deps.lock PR",
  notes: "release notes",
  tag: "tag",
  verify: "verify publish",
};

const STEP_MARK: Record<StepStatus, string> = { ok: "✓", done: "-", planned: "•", failed: "✗", stopped: "!" };

export function formatStep(s: StepResult): string {
  return `${STEP_MARK[s.status]} ${s.label}: ${s.detail}${s.command ? `\n    ${s.command}` : ""}`;
}

const BUNDLE_WORKFLOW = "bundle-apps.yml";
const RUN_DISCOVERY_ATTEMPTS = 36;
const RUN_DISCOVERY_INTERVAL_MS = 5_000;
/** A dispatched run's created_at comes from GitHub's clock, which can trail ours. */
const CLOCK_SKEW_MS = 60_000;
const CHECKS_POLL_ATTEMPTS = 160;
const CHECKS_POLL_INTERVAL_MS = 15_000;

class StepFailure extends Error {
  constructor(readonly step: StepId, message: string, readonly resume: string | null) {
    super(message);
  }
}

const errMessage = (err: unknown): string => String((err as Error)?.message ?? err);

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

const parseLock = (text: string): DepsRow[] => (JSON.parse(text) as Lock).tools;

const rawLock = (seams: ReleaseAppSeams, ref: string): Promise<string> =>
  gh(seams, ["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${RT_REPO}/contents/${LOCK_PATH}?ref=${ref}`]);

/** A blobless bare clone of apps, made on first use: `git log` over apps/<name> is the notes' source. */
class AppsHistory {
  private dir: string | null = null;

  constructor(private readonly seams: ReleaseAppSeams) {}

  private async gitDir(): Promise<string> {
    if (this.dir) return this.dir;
    const dir = join(this.seams.workDir(), "apps.git");
    await run(this.seams, ["git", "clone", "--bare", "--filter=blob:none", "--quiet", `https://github.com/${APPS_REPO}.git`, dir], { timeoutMs: 300_000 });
    this.dir = dir;
    return dir;
  }

  /** Picks up tags a bundle run minted after the clone was made. */
  async refresh(): Promise<void> {
    if (!this.dir) return;
    await run(this.seams, ["git", "--git-dir", this.dir, "fetch", "--quiet", "origin", "+refs/heads/main:refs/heads/main", "+refs/tags/*:refs/tags/*"], { timeoutMs: 300_000 });
  }

  async movedSince(tag: string, name: string): Promise<boolean> {
    const dir = await this.gitDir();
    return Number((await run(this.seams, ["git", "--git-dir", dir, "rev-list", "--count", `${tag}..main`, "--", `apps/${name}`])).trim()) > 0;
  }

  async subjects(from: string, to: string, name: string): Promise<string[]> {
    const dir = await this.gitDir();
    const out = await run(this.seams, ["git", "--git-dir", dir, "log", "--no-merges", "--format=%s", `${from}..${to}`, "--", `apps/${name}`]);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }
}

interface Ctx {
  name: string;
  lastTag: string;
  tag: string;
  headSha: string;
  mainRows: DepsRow[];
  lastRows: DepsRow[];
  pinned: string;
  appsMain: string;
  pkg: { text: string; sha: string };
  phase: Phase;
  target: string;
  appTag: string;
  runId: number | null;
  notesSha: string | null;
  notes: string | null;
  verify: VerifyReport | null;
  apps: AppsHistory;
}

type Recorder = (id: StepId, status: StepStatus, detail: string, command?: string) => void;

async function refreshMain(seams: ReleaseAppSeams): Promise<{ headSha: string; mainRows: DepsRow[] }> {
  await git(seams, ["fetch", "--quiet", "--tags", "origin", "main"], 120_000);
  const headSha = (await git(seams, ["rev-parse", "origin/main"])).trim();
  const mainRows = parseLock(await git(seams, ["show", `origin/main:${LOCK_PATH}`]));
  return { headSha, mainRows };
}

async function assertFastPath(seams: ReleaseAppSeams, lastTag: string, step: StepId): Promise<void> {
  const files = (await git(seams, ["diff", "--name-only", `${lastTag}..origin/main`])).split("\n").map((f) => f.trim()).filter(Boolean);
  if (!files.length) return;
  const gate = await checkGate(seams, lastTag, "origin/main");
  if (gate.path !== "fast") {
    throw new StepFailure(step, `origin/main has changes since ${lastTag} that leave the pin-only fast path (${gate.reason}); cut this release with the full /rt:release`, null);
  }
}

async function appsPackage(seams: ReleaseAppSeams, name: string): Promise<{ text: string; sha: string; version: string }> {
  const raw = JSON.parse(await gh(seams, ["api", `repos/${APPS_REPO}/contents/apps/${name}/package.json?ref=main`])) as { content: string; sha: string };
  const text = Buffer.from(raw.content, "base64").toString("utf8");
  const version = (JSON.parse(text) as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error(`apps/${name}/package.json on apps main has no version`);
  return { text, sha: raw.sha, version };
}

async function appTagExists(seams: ReleaseAppSeams, tag: string): Promise<boolean> {
  const r = await seams.exec(["gh", "api", `repos/${APPS_REPO}/git/ref/tags/${tag}`], { timeoutMs: 30_000 });
  if (r.exitCode === 0) return true;
  if (/HTTP 404|Not Found/i.test(`${r.stderr}\n${r.stdout}`)) return false;
  throw new Error(`gh api repos/${APPS_REPO}/git/ref/tags/${tag} failed: ${(r.stderr || r.stdout).trim()}`);
}

async function qualify(seams: ReleaseAppSeams, name: string): Promise<Ctx> {
  const refuse = (message: string) => new StepFailure("qualify", message, null);
  const { headSha, mainRows } = await refreshMain(seams);
  const tags = (await git(seams, ["tag", "--list", "v*", "--sort=-version:refname"])).split("\n").map((t) => t.trim()).filter(Boolean);
  if (!tags.length) throw refuse("no v* tag in this checkout; run this from an rt checkout");

  let row: DepsRow;
  try {
    row = qualifyRow(name, mainRows);
  } catch (err) {
    throw refuse(errMessage(err));
  }

  const rowsAt = async (tag: string) => parseLock(await git(seams, ["show", `${tag}:${LOCK_PATH}`]));
  const newest = tags[0]!;
  const previous = tags[1] ?? null;
  const newestRows = await rowsAt(newest);
  const previousRows = previous ? await rowsAt(previous) : null;
  const shipped = newestRows.find((r) => r.name === name)?.version;
  if (!shipped) throw refuse(`${name} has no row in ${newest}'s deps.lock; a first ship needs the full /rt:release`);
  await assertFastPath(seams, newest, "qualify");

  const pkg = await appsPackage(seams, name);
  const pinTag = pinnedTagFromUrl(row.url) ?? appTagFor(name, row.version);
  const apps = new AppsHistory(seams);
  const decision = await resolvePhase({
    name,
    pinned: row.version,
    shipped,
    shippedBefore: previousRows?.find((r) => r.name === name)?.version ?? null,
    appsMain: pkg.version,
    pinTag,
    appMoved: () => apps.movedSince(pinTag, name),
  });
  if ("refuse" in decision) throw refuse(decision.refuse);

  const appTag = appTagFor(name, decision.target);
  if (decision.phase === "bump" && (await appTagExists(seams, appTag))) {
    throw refuse(`tag ${appTag} already exists on ${APPS_REPO} while apps main still says ${row.version}; bump apps/${name}/package.json past it by hand, then rerun`);
  }
  const released = decision.phase === "released";
  return {
    name,
    lastTag: released ? previous! : newest,
    tag: released ? newest : nextPatchTag(newest),
    headSha,
    mainRows,
    lastRows: released ? previousRows! : newestRows,
    pinned: row.version,
    appsMain: pkg.version,
    pkg: { text: pkg.text, sha: pkg.sha },
    phase: decision.phase,
    target: decision.target,
    appTag,
    runId: null,
    notesSha: null,
    notes: null,
    verify: null,
    apps,
  };
}

function qualifyDetail(ctx: Ctx): string {
  if (ctx.phase === "released") return `${ctx.name} ${ctx.target} already shipped in ${ctx.tag} and apps/${ctx.name} has not moved since; checking that release`;
  return `origin/main is pin-only since ${ctx.lastTag}; ${ctx.name} pinned at ${ctx.pinned}, apps main at ${ctx.appsMain}; releasing ${ctx.name} ${ctx.target} as ${ctx.tag}`;
}

function doneDetail(ctx: Ctx): string {
  if (ctx.phase === "released") return `${ctx.name} ${ctx.target} already shipped in ${ctx.tag}`;
  if (ctx.phase === "notes") return `${ctx.name} ${ctx.target} is already pinned on main`;
  return `apps main already has ${ctx.name} ${ctx.appsMain}, past the pin ${ctx.pinned}`;
}

const pinMerged = (ctx: Ctx) => ctx.phase === "notes" || ctx.phase === "released";

async function bumpStep(seams: ReleaseAppSeams, ctx: Ctx, rec: Recorder): Promise<void> {
  if (ctx.phase !== "bump") return rec("bump", "done", doneDetail(ctx));
  const text = setPackageVersion(ctx.pkg.text, ctx.pinned, ctx.target);
  const sha = (await gh(seams, [
    "api", "-X", "PUT", `repos/${APPS_REPO}/contents/apps/${ctx.name}/package.json`,
    "-f", `message=${bumpSubject(ctx.name, ctx.target)}`,
    "-f", `content=${Buffer.from(text).toString("base64")}`,
    "-f", `sha=${ctx.pkg.sha}`,
    "-f", "branch=main",
    "--jq", ".commit.sha",
  ])).trim();
  rec("bump", "ok", `apps/${ctx.name}/package.json ${ctx.pinned} → ${ctx.target} on apps main (${sha.slice(0, 9)})`);
}

interface FoundRun {
  id: number;
  url: string;
}

/** `since` null means "a run still in flight"; otherwise any run created since then. */
async function findBundleRun(seams: ReleaseAppSeams, name: string, since: number | null): Promise<FoundRun | null> {
  const data = JSON.parse(await gh(seams, ["api", `repos/${RT_REPO}/actions/workflows/${BUNDLE_WORKFLOW}/runs?event=workflow_dispatch&per_page=10`])) as {
    workflow_runs: { id: number; html_url: string; created_at: string; status: string }[];
  };
  for (const r of data.workflow_runs) {
    if (since === null ? r.status === "completed" : Date.parse(r.created_at) < since - CLOCK_SKEW_MS) continue;
    // The plan job has to finish before the matrix legs exist, so a run this young cannot be told apart yet.
    const jobs = JSON.parse(await gh(seams, ["api", `repos/${RT_REPO}/actions/runs/${r.id}/jobs?per_page=100`, "--jq", "[.jobs[].name]"])) as string[];
    if (jobs.some((j) => j.startsWith(`build (${name},`))) return { id: r.id, url: r.html_url };
  }
  return null;
}

async function dispatchBundle(seams: ReleaseAppSeams, name: string): Promise<FoundRun> {
  const since = seams.now();
  const out = await gh(seams, ["workflow", "run", BUNDLE_WORKFLOW, "--repo", RT_REPO, "--ref", "main", "-f", `apps=${name}`, "-f", "dry_run=false"]);
  const printed = out.match(/\/actions\/runs\/(\d+)/);
  if (printed) return { id: Number(printed[1]), url: `https://github.com/${RT_REPO}/actions/runs/${printed[1]}` };
  for (let i = 0; i < RUN_DISCOVERY_ATTEMPTS; i++) {
    const found = await findBundleRun(seams, name, since);
    if (found) return found;
    await seams.sleep(RUN_DISCOVERY_INTERVAL_MS);
  }
  throw new StepFailure("bundle", `dispatched ${BUNDLE_WORKFLOW} for ${name} but found no run building it; look with gh run list --workflow ${BUNDLE_WORKFLOW} --repo ${RT_REPO}`, `rt release app ${name}`);
}

async function bundleStep(seams: ReleaseAppSeams, ctx: Ctx, rec: Recorder): Promise<void> {
  if (pinMerged(ctx)) return rec("bundle", "done", doneDetail(ctx));
  if (await appTagExists(seams, ctx.appTag)) return rec("bundle", "done", `${ctx.appTag} is already published on ${APPS_REPO}`);

  let found = await findBundleRun(seams, ctx.name, null);
  if (found) seams.log(`  adopting bundle-apps run ${found.id}, already building ${ctx.name} (${found.url})`);
  else found = await dispatchBundle(seams, ctx.name);
  ctx.runId = found.id;

  seams.log(`  watching bundle-apps run ${found.id} (${found.url})`);
  const poll = await pollRunCompletion(seams, found.id, false);
  if (poll.status !== "completed") {
    throw new StepFailure("bundle", `run ${found.id} is still ${poll.status} after ${poll.attempts} check(s) (${found.url})`, `rt release app ${ctx.name}`);
  }
  if (poll.conclusion !== "success") {
    throw new StepFailure("bundle", `run ${found.id} concluded ${poll.conclusion} (${found.url})`, `gh run rerun ${found.id} --failed --repo ${RT_REPO}, then rt release app ${ctx.name}`);
  }
  rec("bundle", "ok", `run ${found.id} built, signed and published ${ctx.appTag} (${found.url})`);
}

interface BotPr {
  number: number;
  state: string;
  url: string;
  headRefOid: string;
  headRefName: string;
}

const PR_FIELDS = "number,state,url,headRefOid,headRefName";

async function findBotPr(seams: ReleaseAppSeams, ctx: Ctx): Promise<BotPr | null> {
  if (ctx.runId !== null) {
    const list = JSON.parse(await gh(seams, ["pr", "list", "--repo", RT_REPO, "--head", `bundle-ci/${ctx.runId}`, "--state", "all", "--json", PR_FIELDS])) as BotPr[];
    return list[0] ?? null;
  }
  const open = (JSON.parse(await gh(seams, ["pr", "list", "--repo", RT_REPO, "--state", "open", "--json", PR_FIELDS, "--limit", "50"])) as BotPr[])
    .filter((p) => p.headRefName.startsWith("bundle-ci/"));
  for (const pr of open) {
    if (parseLock(await rawLock(seams, pr.headRefOid)).find((r) => r.name === ctx.name)?.version === ctx.target) return pr;
  }
  return null;
}

/** Never executes the binary: codesign reads the signature off disk. */
async function verifyBotPr(seams: ReleaseAppSeams, ctx: Ctx, pr: BotPr): Promise<void> {
  const refuse = (problem: string) =>
    new StepFailure("pr", `PR #${pr.number} ${problem}; not merging (${pr.url})`, `inspect ${pr.url}; once it is fixed or closed, rt release app ${ctx.name}`);

  const files = JSON.parse(await gh(seams, ["pr", "view", String(pr.number), "--repo", RT_REPO, "--json", "files", "--jq", "[.files[].path]"])) as string[];
  const base = (await gh(seams, ["api", `repos/${RT_REPO}/compare/main...${pr.headRefOid}`, "--jq", ".merge_base_commit.sha"])).trim();
  const { row, problems } = checkBotPrLock({
    name: ctx.name, version: ctx.target, files,
    baseLock: await rawLock(seams, base),
    headLock: await rawLock(seams, pr.headRefOid),
  });
  if (problems.length || !row) throw refuse(problems.join("; "));

  const dir = seams.workDir();
  const tgz = join(dir, `${ctx.name}-darwin-arm64.tgz`);
  await seams.download(row.url, tgz);
  const sha = await seams.sha256File(tgz);
  if (sha !== row.sha256) throw refuse(`pins sha256 ${row.sha256}, but the published asset hashes to ${sha}`);

  const extract = join(dir, `${ctx.name}-extract`);
  await run(seams, ["mkdir", "-p", extract]);
  await run(seams, ["tar", "-xzf", tgz, "-C", extract]);
  const cs = await seams.exec(["codesign", "-dvv", join(extract, ctx.name)], { timeoutMs: 30_000 });
  if (cs.exitCode !== 0) throw refuse(`ships a binary codesign cannot read: ${(cs.stderr || cs.stdout).trim()}`);
  const signing = checkCodesign(ctx.name, `${cs.stdout}\n${cs.stderr}`);
  if (signing.length) throw refuse(signing.join("; "));
}

async function waitForChecks(seams: ReleaseAppSeams, ctx: Ctx, pr: BotPr): Promise<void> {
  seams.log(`  waiting for CI on PR #${pr.number} (CodeRabbit is not waited on)`);
  let last: ChecksVerdict = { state: "pending", pending: [] };
  for (let i = 0; i < CHECKS_POLL_ATTEMPTS; i++) {
    const r = await seams.exec(["gh", "pr", "checks", String(pr.number), "--repo", RT_REPO, "--json", "name,bucket"], { timeoutMs: 30_000 });
    try {
      last = evaluateChecks(JSON.parse(r.stdout) as { name: string; bucket: string }[]);
    } catch {
      // gh prints prose, not JSON, until the first check registers on the PR.
      last = { state: "pending", pending: [] };
    }
    if (last.state === "green") return;
    if (last.state === "failed") {
      throw new StepFailure("pr", `CI failed on PR #${pr.number}: ${last.failed.join(", ")} (${pr.url})`,
        `rerun the failed checks (gh pr checks ${pr.number} --repo ${RT_REPO} names them; gh run rerun <run-id> --failed), then rt release app ${ctx.name}`);
    }
    await seams.sleep(CHECKS_POLL_INTERVAL_MS);
  }
  const waiting = last.state === "pending" && last.pending.length ? last.pending.join(", ") : "no check has passed yet";
  throw new StepFailure("pr", `CI on PR #${pr.number} is still pending after ${CHECKS_POLL_ATTEMPTS} checks (${waiting})`, `rt release app ${ctx.name}`);
}

async function prStep(seams: ReleaseAppSeams, ctx: Ctx, rec: Recorder): Promise<void> {
  if (pinMerged(ctx)) return rec("pr", "done", doneDetail(ctx));
  const resume = `rt release app ${ctx.name}`;
  const pr = await findBotPr(seams, ctx);
  if (!pr) {
    const run = ctx.runId !== null ? `gh run rerun ${ctx.runId} --failed --repo ${RT_REPO}` : `gh run rerun <run-id> --failed --repo ${RT_REPO}`;
    throw new StepFailure("pr", `no deps.lock PR pins ${ctx.name} ${ctx.target}; if the bundle run's pr job failed, rerun it with ${run}`, resume);
  }
  if (pr.state !== "MERGED") {
    await verifyBotPr(seams, ctx, pr);
    await waitForChecks(seams, ctx, pr);
    await gh(seams, ["pr", "merge", String(pr.number), "--repo", RT_REPO, "--squash", "--match-head-commit", pr.headRefOid]);
  }
  Object.assign(ctx, await refreshMain(seams));
  const pinnedNow = ctx.mainRows.find((r) => r.name === ctx.name)?.version;
  if (pinnedNow !== ctx.target) {
    throw new StepFailure("pr", `PR #${pr.number} is merged but origin/main pins ${ctx.name} ${pinnedNow}, not ${ctx.target}`, resume);
  }
  rec("pr", "ok", `merged PR #${pr.number} (${pr.url}): only ${ctx.name}'s row moved, sha256 and codesign verified, CI green`);
}

/** Notes already on main count only if they landed after the last pin move; otherwise they describe a smaller release. */
async function committedNotes(seams: ReleaseAppSeams, ctx: Ctx): Promise<{ sha: string; text: string } | null> {
  const range = `${ctx.lastTag}..origin/main`;
  const notesSha = (await git(seams, ["log", "-1", "--format=%H", range, "--", "RELEASE_NOTES.md"])).trim();
  if (!notesSha) return null;
  const lockSha = (await git(seams, ["log", "-1", "--format=%H", range, "--", LOCK_PATH])).trim();
  if (lockSha) {
    const r = await seams.exec(["git", "merge-base", "--is-ancestor", lockSha, notesSha], { cwd: seams.repoRoot });
    if (r.exitCode === 1) return null;
    if (r.exitCode !== 0) throw new Error(`git merge-base failed: ${(r.stderr || r.stdout).trim()}`);
  }
  return { sha: notesSha, text: await git(seams, ["show", `${notesSha}:RELEASE_NOTES.md`]) };
}

async function noteSections(ctx: Ctx): Promise<NotesSection[]> {
  const before = new Map(ctx.lastRows.map((r) => [r.name, r]));
  const moved = ctx.mainRows.filter((r) => before.get(r.name)?.version !== r.version);
  await ctx.apps.refresh();
  const sections: NotesSection[] = [];
  for (const r of moved) {
    const old = before.get(r.name);
    if (old && classifyRows([r]).apps.length) {
      const from = pinnedTagFromUrl(old.url) ?? appTagFor(r.name, old.version);
      const to = pinnedTagFromUrl(r.url) ?? appTagFor(r.name, r.version);
      const subjects = (await ctx.apps.subjects(from, to, r.name)).filter((s) => s !== bumpSubject(r.name, r.version));
      sections.push({ app: r.name, version: r.version, subjects });
    } else {
      sections.push({ app: r.name, version: r.version, subjects: [old ? `pin moves from ${old.version} to ${r.version}` : `first pin at ${r.version}`] });
    }
  }
  return sections;
}

/** Built with the git data API so the ref update is fast-forward only: main moving underneath fails instead of tagging unverified code. */
async function commitNotes(seams: ReleaseAppSeams, ctx: Ctx, notes: string, sections: NotesSection[]): Promise<string> {
  const payload = (file: string, body: unknown): string => {
    const path = join(seams.workDir(), file);
    seams.writeFile(path, JSON.stringify(body));
    return path;
  };
  const baseTree = (await git(seams, ["rev-parse", `${ctx.headSha}^{tree}`])).trim();
  const tree = (await gh(seams, ["api", `repos/${RT_REPO}/git/trees`, "--input",
    payload("notes-tree.json", { base_tree: baseTree, tree: [{ path: "RELEASE_NOTES.md", mode: "100644", type: "blob", content: notes }] }),
    "--jq", ".sha"])).trim();
  const summary = sections.map((s) => `${s.app} ${s.version}`).join(", ");
  const commit = (await gh(seams, ["api", `repos/${RT_REPO}/git/commits`, "--input",
    payload("notes-commit.json", { message: `chore(release): notes for ${ctx.tag} (${summary})`, tree, parents: [ctx.headSha] }),
    "--jq", ".sha"])).trim();
  const moved = await seams.exec(["gh", "api", "-X", "PATCH", `repos/${RT_REPO}/git/refs/heads/main`, "--input", payload("notes-ref.json", { sha: commit, force: false })], { timeoutMs: 60_000 });
  if (moved.exitCode !== 0) {
    throw new StepFailure("notes", `main moved past ${ctx.headSha.slice(0, 9)} before the notes commit landed (${(moved.stderr || moved.stdout).trim()}); nothing was tagged`, `rt release app ${ctx.name}`);
  }
  Object.assign(ctx, await refreshMain(seams));
  return commit;
}

type NotesOutcome = "continue" | "awaiting-approval" | "declined";

async function notesStep(seams: ReleaseAppSeams, ctx: Ctx, opts: ReleaseAppOptions, rec: Recorder): Promise<NotesOutcome> {
  if (ctx.phase === "released") {
    ctx.notesSha = (await git(seams, ["rev-parse", `${ctx.tag}^{commit}`])).trim();
    ctx.notes = await git(seams, ["show", `${ctx.tag}:RELEASE_NOTES.md`]);
    rec("notes", "done", doneDetail(ctx));
    return "continue";
  }
  await assertFastPath(seams, ctx.lastTag, "notes");
  const committed = await committedNotes(seams, ctx);
  if (committed) {
    ctx.notesSha = committed.sha;
    ctx.notes = committed.text;
    rec("notes", "done", `RELEASE_NOTES.md for ${ctx.tag} is already committed on main (${committed.sha.slice(0, 9)})`);
    return "continue";
  }

  const sections = await noteSections(ctx);
  ctx.notes = renderNotes({ sections, lastTag: ctx.lastTag, nextTag: ctx.tag });
  if (!opts.yesNotes) {
    if (!opts.json) seams.log(`\n${ctx.notes}`);
    if (opts.json || !seams.isTTY) {
      rec("notes", "stopped", `the notes for ${ctx.tag} need approval; nothing committed`);
      return "awaiting-approval";
    }
    if (!(await seams.confirm(`Commit these notes and tag ${ctx.tag}?`))) {
      rec("notes", "stopped", "declined at the prompt; nothing committed");
      return "declined";
    }
  }
  ctx.notesSha = await commitNotes(seams, ctx, ctx.notes, sections);
  rec("notes", "ok", `committed RELEASE_NOTES.md for ${ctx.tag} on main (${ctx.notesSha.slice(0, 9)})`);
  return "continue";
}

async function tagStep(seams: ReleaseAppSeams, ctx: Ctx, rec: Recorder): Promise<void> {
  const { tag } = ctx;
  const sha = ctx.notesSha!;
  const local = await seams.exec(["git", "rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`], { cwd: seams.repoRoot });
  let created = false;
  if (local.exitCode === 0) {
    const at = local.stdout.trim();
    if (at !== sha) {
      throw new StepFailure("tag", `local tag ${tag} points at ${at.slice(0, 9)}, not the notes commit ${sha.slice(0, 9)}`, `git tag -d ${tag}, then rt release app ${ctx.name}`);
    }
  } else {
    await git(seams, ["tag", "-a", tag, sha, "-m", tag]);
    created = true;
  }

  // Without the explicit ^{} pattern ls-remote prints only the tag object, never the commit it peels to.
  const remote = (await git(seams, ["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`])).split("\n").map((l) => l.trim()).filter(Boolean);
  if (remote.length) {
    const at = (remote.find((l) => l.endsWith("^{}")) ?? remote[0]!).split(/\s+/)[0]!;
    if (at !== sha) throw new StepFailure("tag", `origin's ${tag} points at ${at.slice(0, 9)}, not the notes commit ${sha.slice(0, 9)}; resolve it by hand`, null);
    return rec("tag", created ? "ok" : "done", `${tag} is already on origin at ${sha.slice(0, 9)}`);
  }
  await git(seams, ["push", "origin", `refs/tags/${tag}`], 120_000);
  rec("tag", "ok", `pushed ${tag} at ${sha.slice(0, 9)}`);
}

async function verifyStep(seams: ReleaseAppSeams, ctx: Ctx, rec: Recorder): Promise<void> {
  seams.log(`  watching release.yml for ${ctx.tag} (a real run takes 25-50 minutes)`);
  ctx.verify = await runVerify(seams, { tag: ctx.tag });
  if (!ctx.verify.clean) {
    const open = ctx.verify.rows.filter((r) => r.status !== "ok").map((r) => `${r.label}: ${r.detail ?? r.status}`);
    throw new StepFailure("verify", open.join("; "), `rt release verify ${ctx.tag}`);
  }
  rec("verify", "ok", `${ctx.tag} is published: run, notes, assets, state and releases/latest all verify`);
}

async function planRest(seams: ReleaseAppSeams, ctx: Ctx, rec: Recorder): Promise<void> {
  const { name, target, tag } = ctx;
  if (ctx.phase === "bump") {
    rec("bump", "planned", `apps/${name}/package.json ${ctx.pinned} → ${target} on apps main`,
      `gh api -X PUT repos/${APPS_REPO}/contents/apps/${name}/package.json (message "${bumpSubject(name, target)}")`);
  } else {
    rec("bump", "done", doneDetail(ctx));
  }

  if (pinMerged(ctx)) rec("bundle", "done", doneDetail(ctx));
  else if (ctx.phase === "bundle" && (await appTagExists(seams, ctx.appTag))) rec("bundle", "done", `${ctx.appTag} is already published on ${APPS_REPO}`);
  else {
    rec("bundle", "planned", `build, sign and publish ${ctx.appTag}, which opens the bot deps.lock PR`,
      `gh workflow run ${BUNDLE_WORKFLOW} --repo ${RT_REPO} --ref main -f apps=${name} -f dry_run=false`);
  }

  if (pinMerged(ctx)) rec("pr", "done", doneDetail(ctx));
  else {
    rec("pr", "planned",
      `check the bundle-ci PR moves only ${name}'s row, the published asset's sha256, and codesign Identifier=com.mattstack.helper.${name} with a Developer ID authority; wait for CI (not CodeRabbit); squash-merge`,
      `gh pr merge <bundle-ci PR> --repo ${RT_REPO} --squash --match-head-commit <head sha>`);
  }

  if (ctx.phase === "released") rec("notes", "done", doneDetail(ctx));
  else rec("notes", "planned", `generate RELEASE_NOTES.md for ${ctx.lastTag}..main, ask for approval, commit it on main (fast-forward only)`);

  rec("tag", "planned", `tag ${tag} at the notes commit and push it`, `git tag -a ${tag} <notes commit> -m ${tag} && git push origin refs/tags/${tag}`);
  rec("verify", "planned", "watch release.yml and check the published release", `rt release verify ${tag}`);
}

export async function runReleaseApp(seams: ReleaseAppSeams, opts: ReleaseAppOptions): Promise<ReleaseAppReport> {
  const steps: StepResult[] = [];
  const rec: Recorder = (id, status, detail, command) => {
    const step: StepResult = { id, label: LABELS[id], status, detail, ...(command ? { command } : {}) };
    steps.push(step);
    seams.log(formatStep(step));
  };
  let ctx: Ctx | null = null;
  const report = (status: ReleaseStatus, resume: string | null = null): ReleaseAppReport => ({
    app: opts.name,
    status,
    lastTag: ctx?.lastTag ?? null,
    tag: ctx?.tag ?? null,
    appVersion: ctx?.target ?? null,
    appTag: ctx?.appTag ?? null,
    steps,
    notes: ctx?.notes ?? null,
    verify: ctx?.verify ?? null,
    resume,
  });
  const rerun = `rt release app ${opts.name}`;

  try {
    const c = await inStep("qualify", rerun, () => qualify(seams, opts.name));
    ctx = c;
    rec("qualify", "ok", qualifyDetail(c));
    if (opts.dryRun) {
      await inStep("qualify", `${rerun} --dry-run`, () => planRest(seams, c, rec));
      return report("planned");
    }
    await inStep("bump", rerun, () => bumpStep(seams, c, rec));
    await inStep("bundle", rerun, () => bundleStep(seams, c, rec));
    await inStep("pr", rerun, () => prStep(seams, c, rec));
    const outcome = await inStep("notes", rerun, () => notesStep(seams, c, opts, rec));
    if (outcome === "awaiting-approval") return report(outcome, `${rerun} --yes-notes`);
    if (outcome === "declined") return report(outcome, rerun);
    await inStep("tag", rerun, () => tagStep(seams, c, rec));
    await inStep("verify", `rt release verify ${c.tag}`, () => verifyStep(seams, c, rec));
    return report("released");
  } catch (err) {
    if (!(err instanceof StepFailure)) throw err;
    rec(err.step, "failed", err.message);
    return report("failed", err.resume);
  }
}
