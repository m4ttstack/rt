/**
 * rt release update-machine... the rt:release skill's step 12 as one verb:
 * bring this developer's own machine (prod app, dev bundle, daemon, and the
 * served suite) up to a released tag, in that order, with a verification
 * sweep at the end.
 *
 * Every external effect goes through UpdateMachineSeams so this module stays
 * pure and testable; the real seams (network, exec, prompts, chat) live in
 * the command shell.
 */
import type { RunResult } from "../subprocess.ts";
import { UserActionableError } from "../setup/errors.ts";

export type LegId = "prod-app" | "dev-bundle" | "daemon" | "served-suite" | "verify";
export type LegStatus = "ok" | "skipped" | "aborted" | "error" | "planned";

export interface LegResult {
  id: LegId;
  label: string;
  status: LegStatus;
  detail: string;
}

export interface UpdateMachineReport {
  tag: string;
  legs: LegResult[];
  /** The label of the first leg that ended aborted/error, halting every later state-changing leg; null when nothing halted. */
  haltedAfter: string | null;
  ok: boolean;
}

export interface UpdateMachineOptions {
  tag?: string;
  plan?: boolean;
  verifyOnly?: boolean;
  yes?: boolean;
}

export interface UpdateMachineSeams {
  /** This rt checkout's root, for reading its own rt-tray/deps.lock (the deck version pin). */
  repoRoot: string;
  /** The shared ~/Documents/GitHub/mattstack-apps checkout the served suite runs from. */
  appsCheckoutPath: string;
  /** A scratch directory for the downloaded dmg and the dev-bundle clone; empty when no mutating leg will run. */
  workDir: string;
  /** Numeric uid for the launchd gui/<uid>/... domain (process.getuid() in the real seam). */
  uid: number;
  /** True only when a human can answer a confirm prompt right now (a real TTY, RT_BATCH unset). */
  isTTY: boolean;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
  download(url: string, destPath: string): Promise<void>;
  readFile(path: string): string | null;
  confirm(message: string): Promise<boolean>;
  /** Posts to the #rt chat room; returns whether the post succeeded. */
  announce(message: string): Promise<boolean>;
  clock(): Date;
  sleep(ms: number): Promise<void>;
}

export const RELEASE_REPO = "m4ttstack/rt";
export const CHAT_ROOM = "rt";
const PROD_APP_PATH = "/Applications/mattstack.app";
const DEV_APP_PATH = "/Applications/mattstack-dev.app";
/** Anchored to the executable inside the bundle so pgrep never catches an unrelated
 *  process that merely mentions the bundle path (a `tail -f` on its log, an editor). */
const DEV_APP_ANCHOR = `${DEV_APP_PATH}/Contents/MacOS/`;
const DEV_DECK_LABEL = "com.mattstack.deck.dev";

const PROD_APP_LABEL = "prod app update";
const DEV_BUNDLE_LABEL = "dev bundle rebuild";
const DAEMON_LABEL = "daemon restart";
const SERVED_SUITE_LABEL = "served suite restart";
const VERIFY_LABEL = "verification sweep";

interface ReleaseContext {
  tag: string;
  ver: string;
  sha: string;
}

function errorLeg(id: LegId, label: string, detail: string): LegResult {
  return { id, label, status: "error", detail };
}
function okLeg(id: LegId, label: string, detail: string): LegResult {
  return { id, label, status: "ok", detail };
}
function abortedLeg(id: LegId, label: string, detail: string): LegResult {
  return { id, label, status: "aborted", detail };
}
function skippedLeg(id: LegId, label: string, detail: string): LegResult {
  return { id, label, status: "skipped", detail };
}

/** The tail of a failed command's output, for an error leg's detail. */
function execTail(r: RunResult): string {
  return (r.stderr || r.stdout).trim() || "no output";
}

function versionFromTag(tag: string): string {
  return tag.replace(/^v/, "");
}

async function resolveTag(seams: UpdateMachineSeams, explicit?: string): Promise<string> {
  if (explicit) {
    if (!/^v\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(explicit)) {
      throw new UserActionableError("update-machine-bad-tag", `--tag must look like a released tag (v<major>.<minor>.<patch>), got "${explicit}"`);
    }
    return explicit;
  }
  const r = await seams.exec(["gh", "api", `repos/${RELEASE_REPO}/releases/latest`, "--jq", ".tag_name"]);
  if (r.exitCode !== 0) {
    throw new UserActionableError("update-machine-resolve-tag-failed", `could not resolve the latest released tag: ${execTail(r)}`);
  }
  const tag = r.stdout.trim();
  if (!tag) throw new UserActionableError("update-machine-resolve-tag-failed", "gh api returned no tag_name for the latest release");
  return tag;
}

async function resolveCommit(seams: UpdateMachineSeams, tag: string): Promise<string> {
  const r = await seams.exec(["gh", "api", `repos/${RELEASE_REPO}/commits/${tag}`, "--jq", ".sha"]);
  if (r.exitCode !== 0) {
    throw new UserActionableError("update-machine-resolve-commit-failed", `could not resolve the commit for ${tag}: ${execTail(r)}`);
  }
  const sha = r.stdout.trim();
  if (!sha) throw new UserActionableError("update-machine-resolve-commit-failed", `gh api returned no sha for ${tag}`);
  return sha;
}

function parseShaSums(content: string, filename: string): string | null {
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[1] === filename) return parts[0]!;
  }
  return null;
}

/** hdiutil attach -plist emits an XML plist, not JSON; -quiet (dropped here) closes
 *  stdout entirely, so this is the only way to learn the real mount point.
 *  system-entities' order is filesystem-dependent (HFS+ lists the whole-disk
 *  GUID_partition_scheme entity last; APFS, what the real release dmg uses,
 *  lists it first), so the detach fallback just takes the last dev-entry in
 *  the plist: hdiutil detach accepts any dev-entry belonging to the
 *  attachment as a target for detaching the whole thing, so which one this
 *  picks doesn't matter. */
function parseAttachPlist(xml: string): { mountPoint: string | null; device: string | null } {
  const mountPoint = xml.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
  const devEntries = [...xml.matchAll(/<key>dev-entry<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]!);
  const device = devEntries.at(-1) ?? null;
  return { mountPoint, device };
}

function parseDaemonSourceRev(stdout: string): string | null {
  try {
    const data = (JSON.parse(stdout) as { data?: { identity?: { sourceRev?: string | null } } }).data;
    return data?.identity?.sourceRev ?? null;
  } catch {
    return null;
  }
}

/** The daemon's sourceRev and the target sha can be abbreviated to different
 *  lengths (git rev-parse --short vs a full sha), so neither side is assumed
 *  longer: a match is either prefixing the other. */
function revMatches(sourceRev: string, target: string): boolean {
  return sourceRev.startsWith(target) || target.startsWith(sourceRev);
}

function deckPinFromDepsLock(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tools: { name: string; version: string }[] };
    return parsed.tools.find((t) => t.name === "deck")?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * launchctl print has no start-time field. Nested sub-sections repeat their own
 * "state = active" lines, so only the FIRST (top-level) state/pid pair counts.
 */
function parseLaunchctlPid(stdout: string): number | null {
  const state = stdout.match(/^\s*state = (\S+)/m)?.[1];
  if (state !== "running") return null;
  const pid = stdout.match(/^\s*pid = (\d+)/m)?.[1];
  return pid ? Number(pid) : null;
}

function parsePsStartTime(stdout: string): Date | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function pgrepPids(seams: UpdateMachineSeams, pattern: string): Promise<number[]> {
  const r = await seams.exec(["pgrep", "-f", pattern]);
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

/** open(1) hands off to LaunchServices and returns before the app is actually up, so a single immediate pgrep cannot tell "still launching" from "never launched". */
async function pollForPids(seams: UpdateMachineSeams, pattern: string, attempts: number, delayMs: number): Promise<number[]> {
  for (let i = 0; i < attempts; i++) {
    const pids = await pgrepPids(seams, pattern);
    if (pids.length > 0) return pids;
    if (i < attempts - 1) await seams.sleep(delayMs);
  }
  return [];
}

async function waitForNoPids(seams: UpdateMachineSeams, pattern: string, attempts: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if ((await pgrepPids(seams, pattern)).length === 0) return true;
    if (i < attempts - 1) await seams.sleep(delayMs);
  }
  return (await pgrepPids(seams, pattern)).length === 0;
}

/**
 * `ditto` onto an existing .app MERGES rather than replaces: stale files linger
 * and extras can break the code-signature seal. Move the current bundle aside,
 * ditto the new one into its place, and only delete the aside copy once that
 * succeeds; a failed ditto restores it so the machine is never left without
 * a working app.
 *
 * POSIX `mv src dst` moves src INSIDE dst instead of renaming it when dst
 * already exists as a directory, so every mv here is preceded by a checked
 * `rm -rf` of its own destination: a stale aside from a prior failed run
 * would otherwise break the first move, and a partially-ditto'd destPath
 * would break the rollback move the same way. Returns null on success, or
 * an error detail on failure.
 */
async function replaceApp(seams: UpdateMachineSeams, sourcePath: string, destPath: string): Promise<string | null> {
  const asidePath = `${destPath}.update-machine-old`;

  const clearAside = await seams.exec(["rm", "-rf", asidePath]);
  if (clearAside.exitCode !== 0) return `could not clear a stale aside copy at ${asidePath}: ${execTail(clearAside)}`;

  const mv = await seams.exec(["mv", destPath, asidePath]);
  if (mv.exitCode !== 0) return `could not move the current app aside: ${execTail(mv)}`;

  const ditto = await seams.exec(["ditto", sourcePath, destPath]);
  if (ditto.exitCode !== 0) {
    const clearDest = await seams.exec(["rm", "-rf", destPath]);
    if (clearDest.exitCode !== 0) {
      return `ditto failed and the broken app at ${destPath} could not be cleared to roll back (the previous app is at ${asidePath}): ${execTail(clearDest)}`;
    }
    const rollback = await seams.exec(["mv", asidePath, destPath]);
    if (rollback.exitCode !== 0) {
      return `ditto failed and rollback failed (the previous app is at ${asidePath}): ${execTail(rollback)}`;
    }
    return `ditto failed, restored the previous app: ${execTail(ditto)}`;
  }

  const cleanup = await seams.exec(["rm", "-rf", asidePath]);
  if (cleanup.exitCode !== 0) return `replaced ${destPath}, but could not remove the aside copy at ${asidePath}: ${execTail(cleanup)}`;
  return null;
}

async function managedAppNames(seams: UpdateMachineSeams): Promise<{ apps: string[] } | { error: string }> {
  const r = await seams.exec(["deck", "list", "--json"]);
  if (r.exitCode !== 0) return { error: `deck list --json failed: ${execTail(r)}` };
  try {
    const rows = JSON.parse(r.stdout) as { name: string; managed: boolean }[];
    return { apps: rows.filter((row) => row.managed).map((row) => row.name) };
  } catch (err) {
    return { error: `deck list --json returned unparseable output: ${String((err as Error).message ?? err)}` };
  }
}

async function managedAppPid(seams: UpdateMachineSeams, app: string): Promise<number | null> {
  const r = await seams.exec(["launchctl", "print", `gui/${seams.uid}/com.mattstack.deck.${app}`]);
  return parseLaunchctlPid(r.stdout);
}

/** launchd carries no start-time field, so freshness after a restart is: pid changed, or (same pid) its process start time (from `ps`) postdates the marker. */
interface RestartWitness {
  marker: Date;
  baselinePids: Map<string, number | null>;
}

async function snapshotPids(seams: UpdateMachineSeams, apps: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  for (const app of apps) map.set(app, await managedAppPid(seams, app));
  return map;
}

/** A NaN or unparseable ps timestamp fails the check rather than passing it, same as every other silent-fault path here. */
async function appIsFresh(seams: UpdateMachineSeams, app: string, witness: RestartWitness): Promise<boolean> {
  const pid = await managedAppPid(seams, app);
  if (pid === null) return false;
  if (pid !== witness.baselinePids.get(app)) return true;

  const ps = await seams.exec(["ps", "-p", String(pid), "-o", "lstart="]);
  const started = parsePsStartTime(ps.stdout);
  return started !== null && started.getTime() > witness.marker.getTime();
}

async function staleManagedApps(seams: UpdateMachineSeams, apps: string[], witness: RestartWitness): Promise<string[]> {
  const stale: string[] = [];
  for (const app of apps) {
    if (!(await appIsFresh(seams, app, witness))) stale.push(app);
  }
  return stale;
}

/** `deck restart` kicks a relaunch off; it is not a readiness guarantee. A single
 *  immediate check catches an app still mid-relaunch as stale, so this polls
 *  briefly before giving up on it. */
async function waitForFreshApps(seams: UpdateMachineSeams, apps: string[], witness: RestartWitness, attempts: number, delayMs: number): Promise<string[]> {
  let stale = await staleManagedApps(seams, apps, witness);
  for (let i = 1; i < attempts && stale.length > 0; i++) {
    await seams.sleep(delayMs);
    stale = await staleManagedApps(seams, apps, witness);
  }
  return stale;
}

async function runProdAppLeg(seams: UpdateMachineSeams, ctx: ReleaseContext): Promise<LegResult> {
  const dmgName = `mattstack-${ctx.ver}.dmg`;
  const dmgPath = `${seams.workDir}/${dmgName}`;
  const sumsPath = `${seams.workDir}/SHA256SUMS`;

  try {
    await seams.download(`https://github.com/${RELEASE_REPO}/releases/download/${ctx.tag}/${dmgName}`, dmgPath);
    await seams.download(`https://github.com/${RELEASE_REPO}/releases/download/${ctx.tag}/SHA256SUMS`, sumsPath);
  } catch (err) {
    return errorLeg("prod-app", PROD_APP_LABEL, `download failed: ${String((err as Error).message ?? err)}`);
  }

  const sums = seams.readFile(sumsPath);
  const expected = sums ? parseShaSums(sums, dmgName) : null;
  if (!expected) return errorLeg("prod-app", PROD_APP_LABEL, `${dmgName} not listed in SHA256SUMS`);

  const shaResult = await seams.exec(["shasum", "-a", "256", dmgPath]);
  const actual = shaResult.stdout.trim().split(/\s+/)[0] ?? "";
  if (actual !== expected) {
    return abortedLeg("prod-app", PROD_APP_LABEL, `sha256 mismatch for ${dmgName}: expected ${expected}, got ${actual || "nothing"}`);
  }

  // Never launches either copy: pre-2.8 updaters gate on ~/.local/bin/rt, and a
  // launched prod app's daemon seizes rt.sock from the dev daemon.
  const attach = await seams.exec(["hdiutil", "attach", dmgPath, "-nobrowse", "-plist"]);
  if (attach.exitCode !== 0) return errorLeg("prod-app", PROD_APP_LABEL, `hdiutil attach failed: ${execTail(attach)}`);

  const { mountPoint, device } = parseAttachPlist(attach.stdout);
  const detachTarget = mountPoint ?? device;

  try {
    if (!mountPoint) return errorLeg("prod-app", PROD_APP_LABEL, "hdiutil attach succeeded but its plist named no mount point");

    const replaceErr = await replaceApp(seams, `${mountPoint}/mattstack.app`, PROD_APP_PATH);
    if (replaceErr) return errorLeg("prod-app", PROD_APP_LABEL, replaceErr);

    return okLeg("prod-app", PROD_APP_LABEL, `${PROD_APP_PATH} replaced with ${ctx.tag} (sha256 verified)`);
  } finally {
    if (detachTarget) await seams.exec(["hdiutil", "detach", detachTarget, "-quiet"]);
  }
}

async function runDevBundleLeg(seams: UpdateMachineSeams, ctx: ReleaseContext): Promise<LegResult> {
  const bundleDir = `${seams.workDir}/rt-dev-bundle`;

  const clone = await seams.exec(["git", "clone", `https://github.com/${RELEASE_REPO}.git`, bundleDir]);
  if (clone.exitCode !== 0) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `git clone failed: ${execTail(clone)}`);

  const checkout = await seams.exec(["git", "checkout", ctx.sha], { cwd: bundleDir });
  if (checkout.exitCode !== 0) {
    return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `git checkout ${ctx.sha.slice(0, 12)} failed: ${execTail(checkout)}`);
  }

  const fetchDeps = await seams.exec(["scripts/fetch-deps.sh", "arm64"], { cwd: bundleDir });
  if (fetchDeps.exitCode !== 0) {
    return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `fetch-deps.sh failed: ${execTail(fetchDeps)}`);
  }
  const build = await seams.exec(["rt-tray/build.sh", "dev"], { cwd: bundleDir });
  if (build.exitCode !== 0) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `build.sh dev failed: ${execTail(build)}`);

  for (const pid of await pgrepPids(seams, DEV_APP_ANCHOR)) {
    const kill = await seams.exec(["kill", String(pid)]);
    if (kill.exitCode !== 0) {
      // A process that already exited between pgrep and kill (ESRCH) is not a failure.
      const stillRunning = (await pgrepPids(seams, DEV_APP_ANCHOR)).includes(pid);
      if (stillRunning) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `kill ${pid} failed: ${execTail(kill)}`);
    }
  }
  if (!(await waitForNoPids(seams, DEV_APP_ANCHOR, 5, 500))) {
    return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, "the running dev app did not exit after kill");
  }

  // Never rebuilds the blessed bundle in place; replaceApp swaps it wholesale.
  const replaceErr = await replaceApp(seams, `${bundleDir}/dist/mattstack-dev.app`, DEV_APP_PATH);
  if (replaceErr) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, replaceErr);

  const open = await seams.exec(["open", DEV_APP_PATH]);
  if (open.exitCode !== 0) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `open failed: ${execTail(open)}`);

  const pids = await pollForPids(seams, DEV_APP_ANCHOR, 5, 500);
  if (pids.length === 0) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, "dev app did not relaunch with a fresh pid");

  return okLeg(
    "dev-bundle",
    DEV_BUNDLE_LABEL,
    `${DEV_APP_PATH} rebuilt at ${ctx.sha.slice(0, 12)} and relaunched (pid ${pids[0]})`,
  );
}

/** The ref lands in a gh api URL path, so anything shaped like a path
 *  escape or a flag is refused before any call. */
export function assertDevAppRef(ref: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes("..")) {
    throw new UserActionableError("dev-app-bad-ref", `the ref must be a branch, tag, or sha of ${RELEASE_REPO}, got "${ref}"`);
  }
}

/** The dev-bundle leg on its own, at any pushed ref of the rt repo rather
 *  than a released tag. The tray restarts its helpers only when the app
 *  version changes, and a dev build between releases keeps the last tag's
 *  version, so the deck helper is kickstarted here or it keeps running the
 *  replaced bundle's binary. The relaunched app may still be registering its
 *  agents, so a failed kickstart is retried briefly. */
export async function runDevAppRebuild(seams: UpdateMachineSeams, ref: string): Promise<{ sha: string; result: LegResult }> {
  assertDevAppRef(ref);
  const sha = await resolveCommit(seams, ref);
  const leg = await runDevBundleLeg(seams, { tag: ref, ver: "", sha });
  if (leg.status !== "ok") return { sha, result: leg };

  const kickstart: [string, ...string[]] = ["launchctl", "kickstart", "-k", `gui/${seams.uid}/${DEV_DECK_LABEL}`];
  let kick = await seams.exec(kickstart);
  for (let attempt = 1; attempt < 3 && kick.exitCode !== 0; attempt++) {
    await seams.sleep(1000);
    kick = await seams.exec(kickstart);
  }
  if (kick.exitCode !== 0) {
    return { sha, result: errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `${leg.detail}, but \`${kickstart.join(" ")}\` failed: ${execTail(kick)}`) };
  }
  return { sha, result: okLeg("dev-bundle", DEV_BUNDLE_LABEL, `${leg.detail}; deck helper restarted`) };
}

async function runDaemonLeg(seams: UpdateMachineSeams, ctx: ReleaseContext): Promise<LegResult> {
  // The dev daemon serves other sessions; the announce must land before it restarts
  // out from under them, and a failed announce refuses the restart outright.
  const announced = await seams.announce(`update-machine: restarting the rt daemon for ${ctx.tag} (${ctx.sha.slice(0, 12)})`);
  if (!announced) return abortedLeg("daemon", DAEMON_LABEL, "chat announce failed; refusing to restart the daemon");

  const restart = await seams.exec(["rt", "daemon", "restart"]);
  if (restart.exitCode !== 0) return errorLeg("daemon", DAEMON_LABEL, `rt daemon restart failed: ${execTail(restart)}`);

  const status = await seams.exec(["rt", "daemon", "status", "--json"]);
  const sourceRev = parseDaemonSourceRev(status.stdout);
  if (!sourceRev) return errorLeg("daemon", DAEMON_LABEL, "daemon reports no source rev (prod daemon?)");
  if (!revMatches(sourceRev, ctx.sha)) {
    return errorLeg("daemon", DAEMON_LABEL, `daemon reports source rev ${sourceRev}, expected it to prefix-match ${ctx.sha.slice(0, 12)}`);
  }
  return okLeg("daemon", DAEMON_LABEL, `daemon restarted and reports ${ctx.tag} (${sourceRev})`);
}

async function runServedSuiteLeg(seams: UpdateMachineSeams): Promise<{ result: LegResult; witness: RestartWitness | null }> {
  const branch = (await seams.exec(["git", "branch", "--show-current"], { cwd: seams.appsCheckoutPath })).stdout.trim();
  if (branch !== "main") {
    return {
      result: abortedLeg(
        "served-suite",
        SERVED_SUITE_LABEL,
        `${seams.appsCheckoutPath} is on branch "${branch}", not main; refusing to touch a shared checkout`,
      ),
      witness: null,
    };
  }

  const pull = await seams.exec(["git", "pull"], { cwd: seams.appsCheckoutPath });
  if (pull.exitCode !== 0) return { result: errorLeg("served-suite", SERVED_SUITE_LABEL, `git pull failed: ${execTail(pull)}`), witness: null };

  const namesResult = await managedAppNames(seams);
  if ("error" in namesResult) return { result: errorLeg("served-suite", SERVED_SUITE_LABEL, namesResult.error), witness: null };
  const apps = namesResult.apps;

  const baselinePids = await snapshotPids(seams, apps);
  const witness: RestartWitness = { marker: seams.clock(), baselinePids };

  const restartAll = await seams.exec(["deck", "restart", "--managed"]);
  if (restartAll.exitCode !== 0) {
    return { result: errorLeg("served-suite", SERVED_SUITE_LABEL, `deck restart --managed failed: ${execTail(restartAll)}`), witness };
  }

  let stragglers = await waitForFreshApps(seams, apps, witness, 5, 500);
  if (stragglers.length > 0) {
    for (const app of stragglers) {
      const r = await seams.exec(["deck", "restart", app]);
      if (r.exitCode !== 0) {
        return { result: errorLeg("served-suite", SERVED_SUITE_LABEL, `deck restart ${app} failed: ${execTail(r)}`), witness };
      }
    }
    stragglers = await waitForFreshApps(seams, apps, witness, 5, 500);
    if (stragglers.length > 0) {
      return {
        result: errorLeg("served-suite", SERVED_SUITE_LABEL, `pid did not cycle for: ${stragglers.join(", ")}`),
        witness,
      };
    }
  }

  return { result: okLeg("served-suite", SERVED_SUITE_LABEL, "managed apps restarted and every pid cycled"), witness };
}

async function runVerifyLeg(seams: UpdateMachineSeams, ctx: ReleaseContext, witness: RestartWitness | null): Promise<LegResult> {
  const problems: string[] = [];

  const plist = await seams.exec(["defaults", "read", `${PROD_APP_PATH}/Contents/Info.plist`, "CFBundleShortVersionString"]);
  const prodVersion = plist.stdout.trim();
  if (plist.exitCode !== 0 || prodVersion !== ctx.ver) problems.push(`prod app is ${prodVersion || "unknown"}, expected ${ctx.ver}`);

  const devPid = (await pgrepPids(seams, DEV_APP_ANCHOR))[0];
  if (!devPid) problems.push("dev app has no running pid");

  const daemonStatus = await seams.exec(["rt", "daemon", "status", "--json"]);
  const sourceRev = parseDaemonSourceRev(daemonStatus.stdout);
  if (!sourceRev) problems.push("daemon reports no source rev (prod daemon?)");
  else if (!revMatches(sourceRev, ctx.sha)) problems.push(`daemon reports source rev ${sourceRev}, expected it to prefix-match ${ctx.sha.slice(0, 12)}`);

  const deckVersion = (await seams.exec(["deck", "--version"])).stdout.trim();
  const depsLockRaw = seams.readFile(`${seams.repoRoot}/rt-tray/deps.lock`);
  const pin = deckPinFromDepsLock(depsLockRaw);
  if (!pin) {
    problems.push(depsLockRaw ? "rt-tray/deps.lock has no readable deck pin" : "rt-tray/deps.lock not readable (run from the rt checkout, or deps.lock unreadable)");
  } else if (deckVersion !== pin) {
    problems.push(`deck --version is ${deckVersion || "unknown"}, deps.lock pins ${pin}`);
  }

  let staleNote = "";
  if (witness) {
    const namesResult = await managedAppNames(seams);
    if ("error" in namesResult) {
      problems.push(namesResult.error);
    } else {
      const stale = await staleManagedApps(seams, namesResult.apps, witness);
      if (stale.length > 0) problems.push(`managed app pid predates the restart: ${stale.join(", ")}`);
    }
  } else {
    staleNote = " (no restart marker this run; managed-app freshness not checked)";
  }

  if (problems.length > 0) return errorLeg("verify", VERIFY_LABEL, problems.join("; "));
  return okLeg(
    "verify",
    VERIFY_LABEL,
    `prod ${ctx.ver}, dev pid ${devPid}, daemon ${sourceRev}, deck ${deckVersion} all current${staleNote}`,
  );
}

function describePlannedLeg(id: LegId, tag: string): string {
  switch (id) {
    case "prod-app":
      return `download and sha256-verify the ${tag} dmg, then move-aside-replace ${PROD_APP_PATH} (never launched)`;
    case "dev-bundle":
      return `build the dev bundle at ${tag} in a scratch tree, kill and wait out the running copy, move-aside-replace ${DEV_APP_PATH}, and relaunch it`;
    case "daemon":
      return `announce in #${CHAT_ROOM}, then restart the rt daemon and confirm its source rev matches ${tag}`;
    case "served-suite":
      return "pull mattstack-apps (main only) and deck restart --managed, restarting stragglers by name";
    case "verify":
      return "confirm prod version, dev pid, daemon source rev, deck version, and every managed app's freshness";
  }
}

async function gateLeg(seams: UpdateMachineSeams, yes: boolean | undefined, label: string): Promise<boolean> {
  if (yes) return true;
  return seams.confirm(`Run ${label}?`);
}

export async function runUpdateMachine(seams: UpdateMachineSeams, options: UpdateMachineOptions = {}): Promise<UpdateMachineReport> {
  if (options.plan && options.verifyOnly) {
    throw new UserActionableError("update-machine-plan-verify-only", "--plan and --verify-only are mutually exclusive; pick one");
  }

  const tag = await resolveTag(seams, options.tag);
  const ver = versionFromTag(tag);

  if (options.verifyOnly) {
    const sha = await resolveCommit(seams, tag);
    const result = await runVerifyLeg(seams, { tag, ver, sha }, null);
    return { tag, legs: [result], haltedAfter: null, ok: result.status === "ok" };
  }

  if (options.plan) {
    const legs: LegResult[] = (["prod-app", "dev-bundle", "daemon", "served-suite", "verify"] as LegId[]).map((id) => ({
      id,
      label: { "prod-app": PROD_APP_LABEL, "dev-bundle": DEV_BUNDLE_LABEL, daemon: DAEMON_LABEL, "served-suite": SERVED_SUITE_LABEL, verify: VERIFY_LABEL }[id],
      status: "planned",
      detail: describePlannedLeg(id, tag),
    }));
    return { tag, legs, haltedAfter: null, ok: true };
  }

  if (!options.yes && !seams.isTTY) {
    throw new UserActionableError(
      "update-machine-noninteractive",
      "refuses to run state-changing legs on a non-interactive terminal without --yes",
    );
  }

  const sha = await resolveCommit(seams, tag);
  const ctx: ReleaseContext = { tag, ver, sha };
  const legs: LegResult[] = [];
  let haltedAfter: string | null = null;

  async function runGatedLeg(id: LegId, label: string, run: () => Promise<LegResult>): Promise<void> {
    if (haltedAfter) {
      legs.push(skippedLeg(id, label, `not run: halted after ${haltedAfter} failed`));
      return;
    }
    if (!(await gateLeg(seams, options.yes, label))) {
      legs.push(skippedLeg(id, label, "declined at the confirmation prompt"));
      return;
    }
    const result = await run();
    legs.push(result);
    if (result.status === "aborted" || result.status === "error") haltedAfter = label;
  }

  await runGatedLeg("prod-app", PROD_APP_LABEL, () => runProdAppLeg(seams, ctx));
  await runGatedLeg("dev-bundle", DEV_BUNDLE_LABEL, () => runDevBundleLeg(seams, ctx));
  await runGatedLeg("daemon", DAEMON_LABEL, () => runDaemonLeg(seams, ctx));

  let witness: RestartWitness | null = null;
  await runGatedLeg("served-suite", SERVED_SUITE_LABEL, async () => {
    const { result, witness: w } = await runServedSuiteLeg(seams);
    witness = w;
    return result;
  });

  // Read-only: always runs and reports, halt or no halt.
  legs.push(await runVerifyLeg(seams, ctx, witness));

  const ok = legs.every((l) => l.status === "ok" || l.status === "skipped");
  return { tag, legs, haltedAfter, ok };
}
