/**
 * rt release — release-cycle verbs.
 *
 *   rt release preflight [--json]
 *   rt release verify [tag] [--json] [--no-wait]
 *   rt release update-machine [--tag <tag>] [--plan] [--verify-only] [--yes] [--json]
 *   rt release app <name> [--dry-run] [--json] [--yes-notes]
 *
 * Read-only report of the release's mechanical checks (the rt:release skill's
 * steps 1-2c): git/tag state, picker conformance, pin freshness for every
 * vendored layer, catalog pin drift, extension currency, and which gate
 * (fast vs full) the pending diff implies. Exit 0 only when every layer is
 * verified current; stale or unverifiable layers exit 1.
 *
 * `verify` confirms a tagged release actually published (step 10): the
 * release.yml run, the release body against the committed RELEASE_NOTES.md,
 * the four build assets, draft/prerelease state, and releases/latest
 * propagation. Exit 0 only when every check verifies; stale, unverifiable,
 * or still-propagating rows exit 1.
 *
 * update-machine runs the skill's step 12: bring this machine's prod app,
 * dev bundle, daemon, and served suite up to a released tag.
 *
 * `app` is the fast path for a single served-app fix: bump, bundle, merge the
 * pin, notes, tag and verify in one resumable run (lib/release/release-app.ts).
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/setup/errors.ts";
import { runCapture } from "../lib/subprocess.ts";
import { runPreflight, keepsFastPath, type CheckRow, type PreflightSeams } from "../lib/release/preflight.ts";
import { runVerify, type VerifyRow, type VerifySeams } from "../lib/release/verify.ts";
import { runUpdateMachine, CHAT_ROOM, type LegResult, type UpdateMachineOptions, type UpdateMachineSeams } from "../lib/release/update-machine.ts";
import {
  runReleaseApp,
  type ReleaseAppOptions,
  type ReleaseAppReport,
  type ReleaseAppSeams,
} from "../lib/release/release-app.ts";
import type { DepsRow } from "../lib/release/preflight.ts";
import type { SelectOption } from "../lib/pick-wrappers.ts";
import { conformanceViolations } from "../scripts/lib/picker-conformance.ts";
import { TREE } from "../lib/command-tree-def.ts";
import { flagValue } from "../lib/cli-args.ts";
import { confirm } from "../lib/ui/prompts.ts";
import { interactive } from "../lib/ui/gate.ts";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function createRealSeams(): Promise<PreflightSeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", ...opts }),
    fetchJson,
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    violations: () => conformanceViolations(TREE),
  };
}

async function createRealVerifySeams(): Promise<VerifySeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", ...opts }),
    fetchJson,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function parseVerifyArgs(args: string[]): { tag?: string; json: boolean; noWait: boolean } {
  const tag = args.find((a) => !a.startsWith("--"));
  return { tag, json: args.includes("--json"), noWait: args.includes("--no-wait") };
}

const MARK: Record<CheckRow["status"], string> = { ok: "✓", stale: "✗", error: "!" };
const VERIFY_MARK: Record<VerifyRow["status"], string> = { ok: "✓", stale: "✗", error: "!", pending: "…" };

export async function releasePreflight(args: string[], _ctx: CommandContext = {}, seams?: PreflightSeams): Promise<void> {
  const report = await runPreflight(seams ?? (await createRealSeams()));

  if (args.includes("--json")) {
    console.log(JSON.stringify(envelope(report)));
    if (!report.clean) process.exitCode = 1;
    return;
  }

  for (const row of report.rows) {
    const versions = row.pinned && row.current && row.pinned !== row.current ? ` ${row.pinned} → ${row.current}` : "";
    console.log(`${MARK[row.status]} ${row.label}${versions}: ${row.detail ?? row.status}`);
  }
  if (report.gate) console.log(`gate: ${report.gate.path} (${report.gate.reason})`);
  const okCount = report.rows.length - report.staleCount - report.errorCount;
  console.log(`${report.rows.length} checks: ${okCount} ok, ${report.staleCount} stale, ${report.errorCount} unverifiable`);
  if (!report.clean) process.exitCode = 1;
}

export async function releaseVerify(args: string[], _ctx: CommandContext = {}, seams?: VerifySeams): Promise<void> {
  const { tag, json, noWait } = parseVerifyArgs(args);
  const report = await runVerify(seams ?? (await createRealVerifySeams()), { tag, noWait });

  if (json) {
    console.log(JSON.stringify(envelope(report)));
    if (!report.clean) process.exitCode = 1;
    return;
  }

  console.log(`rt release verify ${report.tag ?? "(no tag resolved)"}`);
  for (const row of report.rows) {
    const versions = row.pinned && row.current && row.pinned !== row.current ? ` ${row.pinned} → ${row.current}` : "";
    console.log(`${VERIFY_MARK[row.status]} ${row.label}${versions}: ${row.detail ?? row.status}`);
  }
  const okCount = report.rows.length - report.staleCount - report.errorCount - report.pendingCount;
  console.log(`${report.rows.length} checks: ${okCount} ok, ${report.staleCount} stale, ${report.pendingCount} pending, ${report.errorCount} unverifiable`);
  if (!report.clean) process.exitCode = 1;
}

/** Only created for a run that can actually mutate anything -- --plan and --verify-only never touch it. */
export async function createRealUpdateMachineSeams(options: UpdateMachineOptions): Promise<UpdateMachineSeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  const needsWorkDir = !options.plan && !options.verifyOnly;
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    appsCheckoutPath: join(homedir(), "Documents", "GitHub", "mattstack-apps"),
    workDir: needsWorkDir ? mkdtempSync(join(tmpdir(), "rt-update-machine-")) : "",
    uid: process.getuid ? process.getuid() : 501,
    isTTY: interactive(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 600_000, ...opts }),
    download: async (url, destPath) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      await Bun.write(destPath, res);
    },
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    confirm: (message) => confirm({ message }),
    announce: async (message) => (await runCapture(["rt", "chat", "post", CHAT_ROOM, message], { timeoutMs: 30_000 })).exitCode === 0,
    clock: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

const LEG_MARK: Record<LegResult["status"], string> = { ok: "✓", skipped: "-", aborted: "!", error: "✗", planned: "•" };

export async function releaseUpdateMachine(args: string[], _ctx: CommandContext = {}, seams?: UpdateMachineSeams): Promise<void> {
  const json = args.includes("--json");
  const options: UpdateMachineOptions = {
    tag: flagValue(args, "--tag"),
    plan: args.includes("--plan"),
    verifyOnly: args.includes("--verify-only"),
    yes: args.includes("--yes"),
  };

  const realSeams = seams ? null : await createRealUpdateMachineSeams(options);
  const cleanupWorkDir = () => {
    if (!realSeams?.workDir) return;
    try {
      rmSync(realSeams.workDir, { recursive: true, force: true });
    } catch {
      // best effort; a leftover scratch dir under tmpdir() is not worth failing the verb over
    }
  };

  // exitUserError calls the real process.exit, which never runs a pending finally,
  // so cleanup happens explicitly on this path before that call, not after it.
  let report;
  try {
    report = await runUpdateMachine(seams ?? realSeams!, options);
  } catch (err) {
    cleanupWorkDir();
    if (err instanceof UserActionableError) exitUserError(err, json, "release update-machine");
    throw err;
  }
  cleanupWorkDir();

  const failed = report.legs.some((l) => l.status === "aborted" || l.status === "error");

  if (json) {
    console.log(JSON.stringify(envelope(report)));
    if (failed) process.exitCode = 1;
    return;
  }

  for (const leg of report.legs) {
    console.log(`${LEG_MARK[leg.status]} ${leg.label}: ${leg.detail}`);
  }
  const summary = report.ok ? "clean" : report.haltedAfter ? `halted after ${report.haltedAfter} failed` : "problems above";
  console.log(`tag ${report.tag}: ${summary}`);
  if (failed) process.exitCode = 1;
}

async function createRealReleaseAppSeams(json: boolean): Promise<ReleaseAppSeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 60_000, ...opts }),
    fetchJson,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isTTY: interactive(),
    readFile: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (path, text) => writeFileSync(path, text),
    confirm: (message) => confirm({ message }),
    // --json owns stdout for the envelope, so progress goes to stderr there.
    log: (line) => void (json ? process.stderr : process.stdout).write(`${line}\n`),
  };
}

export interface ReleaseAppCommandDeps {
  seams?: ReleaseAppSeams;
  pickApp?: (options: SelectOption[]) => Promise<string | null>;
  run?: (seams: ReleaseAppSeams, opts: ReleaseAppOptions) => Promise<ReleaseAppReport>;
}

const RELEASE_APP_USAGE = "usage: rt release app <name> [--dry-run] [--json] [--yes-notes <notes hash>]";

async function pickReleaseApp(options: SelectOption[]): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  return filterableSelect({ message: "Release which app?", options, breadcrumb: ["rt", "release", "app"] });
}

/** The served apps this checkout's deps.lock builds from a tree, plus gitq; empty when it is not an rt checkout. */
function releaseAppOptions(seams: ReleaseAppSeams): SelectOption[] {
  const raw = seams.readFile(join(seams.repoRoot, "rt-tray", "deps.lock"));
  if (!raw) return [];
  try {
    const rows = (JSON.parse(raw) as { tools: DepsRow[] }).tools;
    return rows
      .filter((r) => ((r.source === "tree" && r.serve !== undefined) || r.name === "gitq") && keepsFastPath(r.name))
      .map((r) => ({ value: r.name, label: r.name, ...(r.version ? { hint: r.version } : {}) }));
  } catch {
    return [];
  }
}

function releaseAppSummary(report: ReleaseAppReport): string {
  switch (report.status) {
    case "released":
      return `released ${report.nextTag}`;
    case "planned":
      return `dry run: nothing changed; rerun without --dry-run to release ${report.app} as ${report.nextTag}`;
    case "awaiting-approval":
      return `the notes need approval; to accept them: ${report.resume}`;
    case "declined":
      return report.resume ? `declined; nothing committed or tagged. To regenerate and ask again: ${report.resume}` : `declined; nothing committed or tagged`;
    case "pending":
      return `${report.nextTag} is tagged but its publish has not verified yet; recheck with: ${report.resume}`;
    case "failed": {
      const step = report.steps.at(-1)?.label ?? "qualify";
      return report.resume ? `stopped at ${step}; resume: ${report.resume}` : `stopped at ${step}; this needs a decision, not a rerun`;
    }
  }
}

export async function releaseApp(args: string[], _ctx: CommandContext = {}, deps: ReleaseAppCommandDeps = {}): Promise<void> {
  const json = args.includes("--json");
  const seams = deps.seams ?? (await createRealReleaseAppSeams(json));
  const usage = () => exitUserError(new UserActionableError("usage", RELEASE_APP_USAGE), json, "release app");

  let yesNotes: string | null;
  try {
    yesNotes = flagValue(args, "--yes-notes") ?? null;
  } catch {
    return usage();
  }
  if (yesNotes !== null && !/^[0-9a-f]{12}$/.test(yesNotes)) return usage();
  const yesAt = args.indexOf("--yes-notes");
  let name = args.find((a, i) => !a.startsWith("--") && !(yesAt >= 0 && i === yesAt + 1));
  if (!name && process.stdin.isTTY && !json && !process.env.RT_BATCH) {
    const options = releaseAppOptions(seams);
    if (options.length) {
      const picked = await (deps.pickApp ?? pickReleaseApp)(options);
      if (!picked) return;
      name = picked;
    }
  }
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) usage();

  const report = await (deps.run ?? runReleaseApp)(seams, {
    name: name!,
    dryRun: args.includes("--dry-run"),
    json,
    yesNotes,
  });
  if (json) console.log(JSON.stringify(envelope(report)));
  else console.log(releaseAppSummary(report));
  if (report.status === "failed" || report.status === "declined" || report.status === "pending") process.exitCode = 1;
}
