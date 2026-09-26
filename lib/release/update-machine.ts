/**
 * rt release update-machine... the rt:release skill's step 12 as one verb:
 * bring this developer's own machine (prod app, dev bundle, checkout sync,
 * daemon, and the served suite) up to a released tag, in that order, with a
 * verification sweep at the end.
 *
 * Every external effect goes through UpdateMachineSeams so this module stays
 * pure and testable; the real seams (network, exec, prompts, chat) live in
 * the command shell.
 */
import { homedir } from "os";
import { join } from "path";
import type { RunResult } from "../subprocess.ts";
import { UserActionableError } from "../setup/errors.ts";

export type LegId = "prod-app" | "dev-bundle" | "checkout-sync" | "daemon" | "served-suite" | "verify";
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
  /** The shared ~/Documents/GitHub/repo-tools checkout the dev daemon and deck's from-source apps run from. */
  sharedCheckoutPath: string;
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

/** The deck serving this Mac is the bundle's own; a `deck` on PATH can be a stale hand install. */
function bundleDeck(devNotRunning: boolean): string {
  return `${devNotRunning ? PROD_APP_PATH : DEV_APP_PATH}/Contents/Helpers/deck`;
}

const PROD_APP_LABEL = "prod app update";
const DEV_BUNDLE_LABEL = "dev bundle rebuild";
const CHECKOUT_SYNC_LABEL = "shared checkout sync";
const DAEMON_LABEL = "daemon restart";
const SERVED_SUITE_LABEL = "served suite restart";
const VERIFY_LABEL = "verification sweep";

/** deck's from-source apps this machine serves; each one's registry entry is re-pointed at the shared checkout when it still names the old one. */
const REGISTERED_APPS = ["board", "console", "chat", "boxscore", "deck"] as const;

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

/** GitHub's compare status for base...head: "ahead" or "identical" means head contains base. */
async function compareContains(seams: UpdateMachineSeams, base: string, head: string): Promise<{ status: string } | { error: string }> {
  const r = await seams.exec(["gh", "api", `repos/${RELEASE_REPO}/compare/${base}...${head}`, "--jq", ".status"]);
  if (r.exitCode === 0) return { status: r.stdout.trim() };
  const hint = /HTTP 404/.test(r.stderr) ? " (commit not on GitHub; is the shared checkout on an unpushed commit?)" : "";
  return { error: `${execTail(r)}${hint}` };
}

/** The dev daemon runs whatever the shared checkout holds, and main keeps
 *  moving during a release, so a later main that contains the released
 *  commit is as current as the tag itself. The checkout can also sit on
 *  another lane's pushed branch, which may contain the release without
 *  being merged, so the rev must also be on main. */
async function daemonRevCheck(
  seams: UpdateMachineSeams,
  sourceRev: string,
  sha: string,
): Promise<{ ok: true; exact: boolean } | { ok: false; reason: string }> {
  if (revMatches(sourceRev, sha)) return { ok: true, exact: true };
  if (!/^[0-9a-f]{4,40}$/.test(sourceRev)) return { ok: false, reason: `daemon reports source rev "${sourceRev}", which is not a commit sha` };
  const release = await compareContains(seams, sha, sourceRev);
  if ("error" in release) return { ok: false, reason: `could not compare daemon source rev ${sourceRev} with ${sha.slice(0, 12)}: ${release.error}` };
  if (release.status !== "ahead" && release.status !== "identical") {
    return { ok: false, reason: `daemon reports source rev ${sourceRev}, which does not contain ${sha.slice(0, 12)} (${release.status || "no status"})` };
  }
  const main = await compareContains(seams, sourceRev, "main");
  if ("error" in main) return { ok: false, reason: `could not compare daemon source rev ${sourceRev} with main: ${main.error}` };
  if (main.status !== "ahead" && main.status !== "identical") {
    return { ok: false, reason: `daemon source rev ${sourceRev} contains ${sha.slice(0, 12)} but is not on main (${main.status || "no status"})` };
  }
  return { ok: true, exact: false };
}

/** The tag exists in the shared checkout only after checkout-sync's pull; a caller
 *  whose checkout-sync leg was skipped or halted still gets a readable error here,
 *  never a crash. */
export async function deckVersionAtTag(seams: UpdateMachineSeams, tag: string): Promise<string> {
  const show = await seams.exec(["git", "show", `${tag}:apps/deck/package.json`], { cwd: seams.sharedCheckoutPath });
  if (show.exitCode !== 0) throw new Error(`git show ${tag}:apps/deck/package.json failed: ${execTail(show)}`);
  return (JSON.parse(show.stdout) as { version: string }).version;
}

async function runCheckoutSyncLeg(seams: UpdateMachineSeams): Promise<LegResult> {
  const branch = (await seams.exec(["git", "branch", "--show-current"], { cwd: seams.sharedCheckoutPath })).stdout.trim();
  if (branch !== "main") {
    return abortedLeg("checkout-sync", CHECKOUT_SYNC_LABEL, `${seams.sharedCheckoutPath} is on branch "${branch}", not main; refusing to touch a shared checkout`);
  }
  const pull = await seams.exec(["git", "pull", "--ff-only"], { cwd: seams.sharedCheckoutPath });
  if (pull.exitCode !== 0) return errorLeg("checkout-sync", CHECKOUT_SYNC_LABEL, `git pull failed: ${execTail(pull)}`);
  const install = await seams.exec(["bun", "install", "--frozen-lockfile"], { cwd: seams.sharedCheckoutPath });
  if (install.exitCode !== 0) return errorLeg("checkout-sync", CHECKOUT_SYNC_LABEL, `bun install failed: ${execTail(install)}`);
  return okLeg("checkout-sync", CHECKOUT_SYNC_LABEL, "main pulled and installed");
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
 * an error detail plus what is left at destPath: the previous app, the new
 * one, or nothing safe to launch (a partial copy, or nothing at all).
 */
type ReplaceFailure = { error: string; atDest: "previous" | "new" | "unsafe" };

async function replaceApp(seams: UpdateMachineSeams, sourcePath: string, destPath: string): Promise<ReplaceFailure | null> {
  const asidePath = `${destPath}.update-machine-old`;

  const clearAside = await seams.exec(["rm", "-rf", asidePath]);
  if (clearAside.exitCode !== 0) {
    return { error: `could not clear a stale aside copy at ${asidePath}: ${execTail(clearAside)}`, atDest: "previous" };
  }

  const mv = await seams.exec(["mv", destPath, asidePath]);
  if (mv.exitCode !== 0) return { error: `could not move the current app aside: ${execTail(mv)}`, atDest: "previous" };

  const ditto = await seams.exec(["ditto", sourcePath, destPath]);
  if (ditto.exitCode !== 0) {
    const clearDest = await seams.exec(["rm", "-rf", destPath]);
    if (clearDest.exitCode !== 0) {
      return {
        error: `ditto failed and the broken app at ${destPath} could not be cleared to roll back (the previous app is at ${asidePath}): ${execTail(clearDest)}`,
        atDest: "unsafe",
      };
    }
    const rollback = await seams.exec(["mv", asidePath, destPath]);
    if (rollback.exitCode !== 0) {
      return { error: `ditto failed and rollback failed (the previous app is at ${asidePath}): ${execTail(rollback)}`, atDest: "unsafe" };
    }
    return { error: `ditto failed, restored the previous app: ${execTail(ditto)}`, atDest: "previous" };
  }

  const cleanup = await seams.exec(["rm", "-rf", asidePath]);
  if (cleanup.exitCode !== 0) {
    return { error: `replaced ${destPath}, but could not remove the aside copy at ${asidePath}: ${execTail(cleanup)}`, atDest: "new" };
  }
  return null;
}

/** deck has no JSON list; its table row is `name port health owner`, with
 *  optional ` !source` issue and ` [public:...]` suffixes after the owner. */
const DECK_LIST_ROW = /^(\S+)\s+(?:\d+|-)\s+(?:up|DOWN|-)\s+(\S+)(?:\s.*)?$/;

/** The owner filter `deck restart --managed` applies; deck list does not print kind, so a non-service rt row would still count. */
const UNMANAGED_DECK_OWNERS = new Set(["user", "deck", "local", "unregistered"]);

export function parseManagedDeckApps(raw: string): { apps: string[] } | { error: string } {
  const apps: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const m = DECK_LIST_ROW.exec(line.trimEnd());
    if (!m) return { error: `deck list printed a line that is not an app row: ${line.trim().slice(0, 200)}` };
    if (!UNMANAGED_DECK_OWNERS.has(m[2]!)) apps.push(m[1]!);
  }
  return { apps };
}

async function managedAppNames(seams: UpdateMachineSeams, deck: string): Promise<{ apps: string[] } | { error: string }> {
  const r = await seams.exec([deck, "list"]);
  if (r.exitCode !== 0) return { error: `deck list failed: ${execTail(r)}` };
  // deck prints nothing and exits 0 when its API answers an error, and every
  // machine this runs on serves rt's apps, so an empty set is a failure.
  const parsed = parseManagedDeckApps(r.stdout);
  if ("apps" in parsed && parsed.apps.length === 0) return { error: "deck list reported no managed apps" };
  return parsed;
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

    const replaceFailure = await replaceApp(seams, `${mountPoint}/mattstack.app`, PROD_APP_PATH);
    if (replaceFailure) return errorLeg("prod-app", PROD_APP_LABEL, replaceFailure.error);

    return okLeg("prod-app", PROD_APP_LABEL, `${PROD_APP_PATH} replaced with ${ctx.tag} (sha256 verified)`);
  } finally {
    if (detachTarget) await seams.exec(["hdiutil", "detach", detachTarget, "-quiet"]);
  }
}

async function runDevBundleLeg(seams: UpdateMachineSeams, ctx: ReleaseContext, onNotRunning: () => void = () => {}): Promise<LegResult> {
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

  // The clone is fresh, so the workspace has never been installed.
  const install = await seams.exec(["bun", "install", "--frozen-lockfile"], { cwd: bundleDir });
  if (install.exitCode !== 0) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `bun install failed: ${execTail(install)}`);

  const buildApps = await seams.exec(["bun", "scripts/build-apps.ts", "--arch", "arm64"], { cwd: bundleDir });
  if (buildApps.exitCode !== 0) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `scripts/build-apps.ts failed: ${execTail(buildApps)}`);

  const build = await seams.exec(["rt-tray/build.sh", "dev"], { cwd: bundleDir });
  if (build.exitCode !== 0) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `build.sh dev failed: ${execTail(build)}`);

  // Opening the dev app by hand takes the Mac over from mattstack.app, so it
  // is relaunched only when it was the app running before.
  const runningBefore = await pgrepPids(seams, DEV_APP_ANCHOR);
  const wasRunning = runningBefore.length > 0;
  if (!wasRunning) onNotRunning();
  for (const pid of runningBefore) {
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
  const failure = await replaceApp(seams, `${bundleDir}/rt-tray/mattstack-dev.app`, DEV_APP_PATH);
  if (failure) {
    // The running copy was already quit above, so a failed swap reopens the
    // app replaceApp left in place, unless what is there is not safe to launch.
    if (failure.atDest === "unsafe") {
      return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `${failure.error}; not reopened, ${DEV_APP_PATH} is not safe to launch`);
    }
    if (!wasRunning) return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `${failure.error}; not reopened, it was not running`);
    const which = failure.atDest === "previous" ? "reopened the previous app" : "opened the new app";
    const reopen = await seams.exec(["open", DEV_APP_PATH]);
    const pids = reopen.exitCode === 0 ? await pollForPids(seams, DEV_APP_ANCHOR, 5, 500) : [];
    const tail = pids.length > 0 ? `${which} (pid ${pids[0]})` : `opening ${DEV_APP_PATH} did not bring up a process${reopen.exitCode === 0 ? "" : `: ${execTail(reopen)}`}`;
    return errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `${failure.error}; ${tail}`);
  }

  if (!wasRunning) {
    return okLeg("dev-bundle", DEV_BUNDLE_LABEL, `${DEV_APP_PATH} rebuilt at ${ctx.sha.slice(0, 12)}; not relaunched, it was not running`);
  }

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
 *  escape or a flag is refused before any call. A pull/ ref resolves through
 *  the API but its commit is absent from a plain clone, so it is refused too. */
export function assertDevAppRef(ref: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes("..") || ref.startsWith("pull/")) {
    throw new UserActionableError("dev-app-bad-ref", `the ref must be a branch, tag, or sha of ${RELEASE_REPO} (for a PR, its branch name), got "${ref}"`);
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

  // Managed apps run the bundle's Helpers/bun; one still running the binary
  // deleted with the old bundle loses its privacy grants (EPERM reading
  // ~/Documents). Retry only while the restarted deck is not answering:
  // restart --managed also fails when one app fails, and retrying that would
  // re-kill every healthy app each time.
  const deckCli = bundleDeck(false);
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await seams.exec([deckCli, "list"])).exitCode === 0) break;
    await seams.sleep(1000);
  }
  const managed: [string, ...string[]] = [deckCli, "restart", "--managed"];
  const restart = await seams.exec(managed);
  if (restart.exitCode !== 0) {
    return {
      sha,
      result: errorLeg("dev-bundle", DEV_BUNDLE_LABEL, `${leg.detail}; deck helper restarted, but \`${managed.join(" ")}\` failed: ${execTail(restart)}`),
    };
  }
  return { sha, result: okLeg("dev-bundle", DEV_BUNDLE_LABEL, `${leg.detail}; deck helper and managed apps restarted`) };
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
  const rev = await daemonRevCheck(seams, sourceRev, ctx.sha);
  if (!rev.ok) return errorLeg("daemon", DAEMON_LABEL, rev.reason);
  return okLeg(
    "daemon",
    DAEMON_LABEL,
    rev.exact ? `daemon restarted and reports ${ctx.tag} (${sourceRev})` : `daemon restarted on ${sourceRev}, which contains ${ctx.tag}`,
  );
}

interface DeckRegistryFile {
  apps?: Record<string, { dev?: { workingDirectory?: string } }>;
}

function parseDeckRegistry(raw: string | null): DeckRegistryFile {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as DeckRegistryFile;
  } catch {
    return {};
  }
}

/** deck registers a linked app by its source checkout; a row still pointing at the
 *  old apps checkout serves stale source until it is re-pointed at the shared one. */
async function reregisterMovedApps(seams: UpdateMachineSeams, deck: string): Promise<LegResult | null> {
  const registryPath = join(process.env.HOME ?? homedir(), ".mattstack", "deck", "registry.json");
  const registry = parseDeckRegistry(seams.readFile(registryPath));
  for (const app of REGISTERED_APPS) {
    const wanted = `${seams.sharedCheckoutPath}/apps/${app}`;
    if (registry.apps?.[app]?.dev?.workingDirectory === wanted) continue;
    const register = await seams.exec([deck, "register", "--dir", wanted]);
    if (register.exitCode !== 0) {
      return errorLeg("served-suite", SERVED_SUITE_LABEL, `deck register --dir ${wanted} failed for ${app}: ${execTail(register)}`);
    }
  }
  return null;
}

async function runServedSuiteLeg(seams: UpdateMachineSeams, deck: string): Promise<{ result: LegResult; witness: RestartWitness | null }> {
  const registerFailure = await reregisterMovedApps(seams, deck);
  if (registerFailure) return { result: registerFailure, witness: null };

  const namesResult = await managedAppNames(seams, deck);
  if ("error" in namesResult) return { result: errorLeg("served-suite", SERVED_SUITE_LABEL, namesResult.error), witness: null };
  const apps = namesResult.apps;

  const baselinePids = await snapshotPids(seams, apps);
  const witness: RestartWitness = { marker: seams.clock(), baselinePids };

  const restartAll = await seams.exec([deck, "restart", "--managed"]);
  if (restartAll.exitCode !== 0) {
    return { result: errorLeg("served-suite", SERVED_SUITE_LABEL, `deck restart --managed failed: ${execTail(restartAll)}`), witness };
  }

  let stragglers = await waitForFreshApps(seams, apps, witness, 5, 500);
  if (stragglers.length > 0) {
    for (const app of stragglers) {
      const r = await seams.exec([deck, "restart", app]);
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

/** The dev app, its daemon and its source rev are this Mac's only when the dev app was running. */
const DEV_NOT_RUNNING = "the dev app was not running, so this Mac runs mattstack.app";

async function runVerifyLeg(
  seams: UpdateMachineSeams,
  ctx: ReleaseContext,
  witness: RestartWitness | null,
  devNotRunning = false,
): Promise<LegResult> {
  const problems: string[] = [];

  const plist = await seams.exec(["defaults", "read", `${PROD_APP_PATH}/Contents/Info.plist`, "CFBundleShortVersionString"]);
  const prodVersion = plist.stdout.trim();
  if (plist.exitCode !== 0 || prodVersion !== ctx.ver) problems.push(`prod app is ${prodVersion || "unknown"}, expected ${ctx.ver}`);

  let devPid: number | undefined;
  let sourceRev: string | null = null;
  if (!devNotRunning) {
    devPid = (await pgrepPids(seams, DEV_APP_ANCHOR))[0];
    if (!devPid) problems.push("dev app has no running pid");

    const daemonStatus = await seams.exec(["rt", "daemon", "status", "--json"]);
    sourceRev = parseDaemonSourceRev(daemonStatus.stdout);
    if (!sourceRev) problems.push("daemon reports no source rev (prod daemon?)");
    else {
      const rev = await daemonRevCheck(seams, sourceRev, ctx.sha);
      if (!rev.ok) problems.push(rev.reason);
    }
  }

  const deck = bundleDeck(devNotRunning);
  const deckVersion = (await seams.exec([deck, "--version"])).stdout.trim();
  try {
    const deckAtTag = await deckVersionAtTag(seams, ctx.tag);
    if (deckVersion !== deckAtTag) problems.push(`deck --version is ${deckVersion || "unknown"}, the tree at ${ctx.tag} has ${deckAtTag}`);
  } catch (err) {
    problems.push((err as Error).message);
  }

  let staleNote = "";
  if (witness) {
    const namesResult = await managedAppNames(seams, deck);
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
  const devPart = devNotRunning
    ? ` (${DEV_NOT_RUNNING}: dev app and daemon source rev not checked)`
    : "";
  return okLeg(
    "verify",
    VERIFY_LABEL,
    devNotRunning
      ? `prod ${ctx.ver}, deck ${deckVersion} all current${devPart}${staleNote}`
      : `prod ${ctx.ver}, dev pid ${devPid}, daemon ${sourceRev}, deck ${deckVersion} all current${staleNote}`,
  );
}

function describePlannedLeg(id: LegId, tag: string): string {
  switch (id) {
    case "prod-app":
      return `download and sha256-verify the ${tag} dmg, then move-aside-replace ${PROD_APP_PATH} (never launched)`;
    case "dev-bundle":
      return `build the dev bundle at ${tag} in a scratch tree, kill and wait out the running copy, move-aside-replace ${DEV_APP_PATH}, and relaunch it`;
    case "checkout-sync":
      return "pull the shared rt checkout (main only) and bun install --frozen-lockfile";
    case "daemon":
      return `announce in #${CHAT_ROOM}, then restart the rt daemon and confirm its source rev matches ${tag}`;
    case "served-suite":
      return "re-register any managed app whose registry entry does not match the shared checkout, then deck restart --managed, restarting stragglers by name";
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
    const devNotRunning = (await pgrepPids(seams, DEV_APP_ANCHOR)).length === 0;
    const result = await runVerifyLeg(seams, { tag, ver, sha }, null, devNotRunning);
    return { tag, legs: [result], haltedAfter: null, ok: result.status === "ok" };
  }

  if (options.plan) {
    const legs: LegResult[] = (["prod-app", "dev-bundle", "checkout-sync", "daemon", "served-suite", "verify"] as LegId[]).map((id) => ({
      id,
      label: {
        "prod-app": PROD_APP_LABEL,
        "dev-bundle": DEV_BUNDLE_LABEL,
        "checkout-sync": CHECKOUT_SYNC_LABEL,
        daemon: DAEMON_LABEL,
        "served-suite": SERVED_SUITE_LABEL,
        verify: VERIFY_LABEL,
      }[id],
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
  // Read here, not in the dev-bundle leg: a declined or failed one never reaches its own pgrep.
  let devNotRunning = (await pgrepPids(seams, DEV_APP_ANCHOR)).length === 0;
  await runGatedLeg("dev-bundle", DEV_BUNDLE_LABEL, () => runDevBundleLeg(seams, ctx, () => { devNotRunning = true; }));
  await runGatedLeg("checkout-sync", CHECKOUT_SYNC_LABEL, () => runCheckoutSyncLeg(seams));
  if (devNotRunning) {
    legs.push(skippedLeg("daemon", DAEMON_LABEL,
      `not run: ${DEV_NOT_RUNNING}; mattstack.app keeps running the previous build until it is relaunched`));
  } else {
    await runGatedLeg("daemon", DAEMON_LABEL, () => runDaemonLeg(seams, ctx));
  }

  let witness: RestartWitness | null = null;
  await runGatedLeg("served-suite", SERVED_SUITE_LABEL, async () => {
    const { result, witness: w } = await runServedSuiteLeg(seams, bundleDeck(devNotRunning));
    witness = w;
    return result;
  });

  // Read-only: always runs and reports, halt or no halt.
  legs.push(await runVerifyLeg(seams, ctx, witness, devNotRunning));

  const ok = legs.every((l) => l.status === "ok" || l.status === "skipped");
  return { tag, legs, haltedAfter, ok };
}
