/**
 * rt release update-machine — the rt:release skill's step 12 as one verb:
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
  /** A scratch directory for the downloaded dmg and the dev-bundle clone. */
  workDir: string;
  isTTY: boolean;
  exec(argv: [string, ...string[]], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
  download(url: string, destPath: string): Promise<void>;
  readFile(path: string): string | null;
  confirm(message: string): Promise<boolean>;
  /** Posts to the #rt chat room; returns whether the post succeeded. */
  announce(message: string): Promise<boolean>;
  clock(): Date;
}

const RELEASE_REPO = "m4ttstack/rt";
const CHAT_ROOM = "rt";
const PROD_APP_PATH = "/Applications/mattstack.app";
const DEV_APP_PATH = "/Applications/mattstack-dev.app";

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

function versionFromTag(tag: string): string {
  return tag.replace(/^v/, "");
}

async function resolveTag(seams: UpdateMachineSeams, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const r = await seams.exec(["gh", "api", `repos/${RELEASE_REPO}/releases/latest`, "--jq", ".tag_name"]);
  const tag = r.stdout.trim();
  if (!tag) throw new Error("could not resolve the latest released tag");
  return tag;
}

async function resolveCommit(seams: UpdateMachineSeams, tag: string): Promise<string> {
  const r = await seams.exec(["gh", "api", `repos/${RELEASE_REPO}/commits/${tag}`, "--jq", ".sha"]);
  const sha = r.stdout.trim();
  if (!sha) throw new Error(`could not resolve the commit for ${tag}`);
  return sha;
}

function parseShaSums(content: string, filename: string): string | null {
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[1] === filename) return parts[0]!;
  }
  return null;
}

function parseMountPoint(stdout: string): string | null {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  const cols = last.trim().split(/\s+/);
  const mount = cols[cols.length - 1];
  return mount && mount.startsWith("/") ? mount : null;
}

function parseDaemonCommit(stdout: string): string | null {
  try {
    return (JSON.parse(stdout) as { commit?: string }).commit ?? null;
  } catch {
    return null;
  }
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

function parseLaunchctlStartTime(stdout: string): Date | null {
  const m = stdout.match(/start time = (.+)/);
  if (!m) return null;
  const d = new Date(m[1]!.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

async function managedAppNames(seams: UpdateMachineSeams): Promise<string[]> {
  const r = await seams.exec(["deck", "list", "--json"]);
  try {
    const rows = JSON.parse(r.stdout) as { name: string; managed: boolean }[];
    return rows.filter((row) => row.managed).map((row) => row.name);
  } catch {
    return [];
  }
}

/** Apps whose launchd start time does not postdate `since` -- i.e. never actually cycled. */
async function staleManagedApps(seams: UpdateMachineSeams, since: Date): Promise<string[]> {
  const apps = await managedAppNames(seams);
  const stale: string[] = [];
  for (const app of apps) {
    const r = await seams.exec(["launchctl", "print", `gui/501/com.mattstack.deck.${app}`]);
    const started = parseLaunchctlStartTime(r.stdout);
    if (!started || started.getTime() < since.getTime()) stale.push(app);
  }
  return stale;
}

async function runProdAppLeg(seams: UpdateMachineSeams, ctx: ReleaseContext): Promise<LegResult> {
  const dmgName = `mattstack-${ctx.ver}.dmg`;
  const dmgPath = `${seams.workDir}/${dmgName}`;
  const sumsPath = `${seams.workDir}/SHA256SUMS`;

  await seams.download(`https://github.com/${RELEASE_REPO}/releases/download/${ctx.tag}/${dmgName}`, dmgPath);
  await seams.download(`https://github.com/${RELEASE_REPO}/releases/download/${ctx.tag}/SHA256SUMS`, sumsPath);

  const sums = seams.readFile(sumsPath);
  const expected = sums ? parseShaSums(sums, dmgName) : null;
  if (!expected) {
    return { id: "prod-app", label: PROD_APP_LABEL, status: "error", detail: `${dmgName} not listed in SHA256SUMS` };
  }

  const shaResult = await seams.exec(["shasum", "-a", "256", dmgPath]);
  const actual = shaResult.stdout.trim().split(/\s+/)[0] ?? "";
  if (actual !== expected) {
    return {
      id: "prod-app",
      label: PROD_APP_LABEL,
      status: "aborted",
      detail: `sha256 mismatch for ${dmgName}: expected ${expected}, got ${actual || "nothing"}`,
    };
  }

  const attach = await seams.exec(["hdiutil", "attach", dmgPath, "-nobrowse", "-quiet"]);
  const mountPoint = parseMountPoint(attach.stdout);
  if (!mountPoint) {
    return { id: "prod-app", label: PROD_APP_LABEL, status: "error", detail: "hdiutil attach did not report a mount point" };
  }

  // Never launches either copy: pre-2.8 updaters gate on ~/.local/bin/rt, and a
  // launched prod app's daemon seizes rt.sock from the dev daemon.
  await seams.exec(["ditto", `${mountPoint}/mattstack.app`, PROD_APP_PATH]);
  await seams.exec(["hdiutil", "detach", mountPoint, "-quiet"]);

  return { id: "prod-app", label: PROD_APP_LABEL, status: "ok", detail: `${PROD_APP_PATH} replaced with ${ctx.tag} (sha256 verified)` };
}

async function runDevBundleLeg(seams: UpdateMachineSeams, ctx: ReleaseContext): Promise<LegResult> {
  const bundleDir = `${seams.workDir}/rt-dev-bundle`;
  await seams.exec(["git", "clone", `https://github.com/${RELEASE_REPO}.git`, bundleDir]);
  await seams.exec(["git", "checkout", ctx.sha], { cwd: bundleDir });

  const fetchDeps = await seams.exec(["scripts/fetch-deps.sh", "arm64"], { cwd: bundleDir });
  if (fetchDeps.exitCode !== 0) {
    return { id: "dev-bundle", label: DEV_BUNDLE_LABEL, status: "error", detail: `fetch-deps.sh failed: ${(fetchDeps.stderr || fetchDeps.stdout).trim() || "no output"}` };
  }
  const build = await seams.exec(["rt-tray/build.sh", "dev"], { cwd: bundleDir });
  if (build.exitCode !== 0) {
    return { id: "dev-bundle", label: DEV_BUNDLE_LABEL, status: "error", detail: `build.sh dev failed: ${(build.stderr || build.stdout).trim() || "no output"}` };
  }

  const before = await seams.exec(["pgrep", "-f", DEV_APP_PATH]);
  const oldPid = before.stdout.trim().split("\n")[0] || null;
  if (oldPid) await seams.exec(["kill", oldPid]);

  // Never rebuilds the blessed bundle in place; this ditto replaces it wholesale.
  await seams.exec(["ditto", `${bundleDir}/dist/mattstack-dev.app`, DEV_APP_PATH]);
  await seams.exec(["open", DEV_APP_PATH]);

  const after = await seams.exec(["pgrep", "-f", DEV_APP_PATH]);
  const newPid = after.stdout.trim().split("\n")[0] || null;
  if (!newPid || newPid === oldPid) {
    return { id: "dev-bundle", label: DEV_BUNDLE_LABEL, status: "error", detail: "dev app did not relaunch with a fresh pid" };
  }
  return {
    id: "dev-bundle",
    label: DEV_BUNDLE_LABEL,
    status: "ok",
    detail: `${DEV_APP_PATH} rebuilt at ${ctx.sha.slice(0, 12)} and relaunched (pid ${newPid})`,
  };
}

async function runDaemonLeg(seams: UpdateMachineSeams, ctx: ReleaseContext): Promise<LegResult> {
  // The dev daemon serves other sessions; the announce must land before it restarts
  // out from under them, and a failed announce refuses the restart outright.
  const announced = await seams.announce(`update-machine: restarting the rt daemon for ${ctx.tag} (${ctx.sha.slice(0, 12)})`);
  if (!announced) {
    return { id: "daemon", label: DAEMON_LABEL, status: "aborted", detail: "chat announce failed; refusing to restart the daemon" };
  }

  await seams.exec(["rt", "daemon", "restart"]);
  const status = await seams.exec(["rt", "daemon", "status", "--json"]);
  const commit = parseDaemonCommit(status.stdout);
  const short = ctx.sha.slice(0, 12);
  if (commit !== ctx.sha && commit !== short) {
    return { id: "daemon", label: DAEMON_LABEL, status: "error", detail: `daemon reports commit ${commit ?? "unknown"}, expected ${short}` };
  }
  return { id: "daemon", label: DAEMON_LABEL, status: "ok", detail: `daemon restarted and reports ${ctx.tag} (${short})` };
}

async function runServedSuiteLeg(seams: UpdateMachineSeams): Promise<{ result: LegResult; marker: Date | null }> {
  const branch = (await seams.exec(["git", "branch", "--show-current"], { cwd: seams.appsCheckoutPath })).stdout.trim();
  if (branch !== "main") {
    return {
      result: {
        id: "served-suite",
        label: SERVED_SUITE_LABEL,
        status: "aborted",
        detail: `${seams.appsCheckoutPath} is on branch "${branch}", not main; refusing to touch a shared checkout`,
      },
      marker: null,
    };
  }

  await seams.exec(["git", "pull"], { cwd: seams.appsCheckoutPath });

  const marker = seams.clock();
  await seams.exec(["deck", "restart", "--managed"]);

  let stragglers = await staleManagedApps(seams, marker);
  if (stragglers.length > 0) {
    for (const app of stragglers) await seams.exec(["deck", "restart", app]);
    stragglers = await staleManagedApps(seams, marker);
    if (stragglers.length > 0) {
      return {
        result: { id: "served-suite", label: SERVED_SUITE_LABEL, status: "error", detail: `pid did not cycle for: ${stragglers.join(", ")}` },
        marker,
      };
    }
  }

  return { result: { id: "served-suite", label: SERVED_SUITE_LABEL, status: "ok", detail: "managed apps restarted and every pid cycled" }, marker };
}

async function runVerifyLeg(seams: UpdateMachineSeams, ctx: ReleaseContext, marker: Date | null): Promise<LegResult> {
  const problems: string[] = [];
  const short = ctx.sha.slice(0, 12);

  const plist = await seams.exec(["defaults", "read", `${PROD_APP_PATH}/Contents/Info.plist`, "CFBundleShortVersionString"]);
  const prodVersion = plist.stdout.trim();
  if (prodVersion !== ctx.ver) problems.push(`prod app is ${prodVersion || "unknown"}, expected ${ctx.ver}`);

  const devPid = (await seams.exec(["pgrep", "-f", DEV_APP_PATH])).stdout.trim();
  if (!devPid) problems.push("dev app has no running pid");

  const daemonStatus = await seams.exec(["rt", "daemon", "status", "--json"]);
  const commit = parseDaemonCommit(daemonStatus.stdout);
  if (commit !== ctx.sha && commit !== short) problems.push(`daemon reports commit ${commit ?? "unknown"}, expected ${short}`);

  const deckVersion = (await seams.exec(["deck", "--version"])).stdout.trim();
  const pin = deckPinFromDepsLock(seams.readFile(`${seams.repoRoot}/rt-tray/deps.lock`));
  if (pin && deckVersion !== pin) problems.push(`deck --version is ${deckVersion || "unknown"}, deps.lock pins ${pin}`);

  let staleNote = "";
  if (marker) {
    const stale = await staleManagedApps(seams, marker);
    if (stale.length > 0) problems.push(`managed app pid predates the restart: ${stale.join(", ")}`);
  } else {
    staleNote = " (no restart marker this run; managed-app freshness not checked)";
  }

  if (problems.length > 0) {
    return { id: "verify", label: VERIFY_LABEL, status: "error", detail: problems.join("; ") };
  }
  return {
    id: "verify",
    label: VERIFY_LABEL,
    status: "ok",
    detail: `prod ${ctx.ver}, dev pid ${devPid}, daemon ${short}, deck ${deckVersion} all current${staleNote}`,
  };
}

function skipped(id: LegId, label: string): LegResult {
  return { id, label, status: "skipped", detail: "declined at the confirmation prompt" };
}

function describePlannedLeg(id: LegId, tag: string): string {
  switch (id) {
    case "prod-app":
      return `download and sha256-verify the ${tag} dmg, then ditto it over ${PROD_APP_PATH} (never launched)`;
    case "dev-bundle":
      return `build the dev bundle at ${tag} in a scratch tree, ditto it over ${DEV_APP_PATH}, and relaunch it`;
    case "daemon":
      return `announce in #${CHAT_ROOM}, then restart the rt daemon and confirm it reports ${tag}`;
    case "served-suite":
      return "pull mattstack-apps (main only) and deck restart --managed, restarting stragglers by name";
    case "verify":
      return "confirm prod version, dev pid, daemon commit, deck version, and every managed app's freshness";
  }
}

async function gateLeg(seams: UpdateMachineSeams, yes: boolean | undefined, label: string): Promise<boolean> {
  if (yes) return true;
  return seams.confirm(`Run ${label}?`);
}

export async function runUpdateMachine(seams: UpdateMachineSeams, options: UpdateMachineOptions = {}): Promise<UpdateMachineReport> {
  const tag = await resolveTag(seams, options.tag);
  const ver = versionFromTag(tag);

  if (options.verifyOnly) {
    const sha = await resolveCommit(seams, tag);
    const result = await runVerifyLeg(seams, { tag, ver, sha }, null);
    return { tag, legs: [result], ok: result.status === "ok" };
  }

  if (options.plan) {
    const legs: LegResult[] = (["prod-app", "dev-bundle", "daemon", "served-suite", "verify"] as LegId[]).map((id) => ({
      id,
      label: { "prod-app": PROD_APP_LABEL, "dev-bundle": DEV_BUNDLE_LABEL, daemon: DAEMON_LABEL, "served-suite": SERVED_SUITE_LABEL, verify: VERIFY_LABEL }[id],
      status: "planned",
      detail: describePlannedLeg(id, tag),
    }));
    return { tag, legs, ok: true };
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

  if (await gateLeg(seams, options.yes, PROD_APP_LABEL)) legs.push(await runProdAppLeg(seams, ctx));
  else legs.push(skipped("prod-app", PROD_APP_LABEL));

  if (await gateLeg(seams, options.yes, DEV_BUNDLE_LABEL)) legs.push(await runDevBundleLeg(seams, ctx));
  else legs.push(skipped("dev-bundle", DEV_BUNDLE_LABEL));

  if (await gateLeg(seams, options.yes, DAEMON_LABEL)) legs.push(await runDaemonLeg(seams, ctx));
  else legs.push(skipped("daemon", DAEMON_LABEL));

  let marker: Date | null = null;
  if (await gateLeg(seams, options.yes, SERVED_SUITE_LABEL)) {
    const { result, marker: m } = await runServedSuiteLeg(seams);
    legs.push(result);
    marker = m;
  } else {
    legs.push(skipped("served-suite", SERVED_SUITE_LABEL));
  }

  legs.push(await runVerifyLeg(seams, ctx, marker));

  const ok = legs.every((l) => l.status === "ok" || l.status === "skipped");
  return { tag, legs, ok };
}
