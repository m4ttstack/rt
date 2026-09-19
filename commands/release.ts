/**
 * rt release — release-cycle verbs.
 *
 *   rt release preflight [--json]
 *   rt release verify [tag] [--json] [--no-wait]
 *   rt release update-machine [--tag <tag>] [--plan] [--verify-only] [--yes] [--json]
 *
 * Read-only report of the release's mechanical checks (the rt:release skill's
 * steps 1-2c): git/tag state, picker conformance, pin freshness for every
 * vendored layer, catalog pin drift, extension currency, rt-client parity,
 * and which gate (fast vs full) the pending diff implies. Exit 0 only when
 * every layer is verified current; stale or unverifiable layers exit 1.
 *
 * `verify` confirms a tagged release actually published (step 10): the
 * release.yml run, the release body against the committed RELEASE_NOTES.md,
 * the four build assets, draft/prerelease state, and releases/latest
 * propagation. Exit 0 only when every check verifies; stale, unverifiable,
 * or still-propagating rows exit 1.
 *
 * update-machine runs the skill's step 12: bring this machine's prod app,
 * dev bundle, daemon, and served suite up to a released tag.
 */
import { readFileSync, mkdtempSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { UserActionableError, exitUserError } from "../lib/setup/errors.ts";
import { runCapture } from "../lib/subprocess.ts";
import { runPreflight, type CheckRow, type PreflightSeams } from "../lib/release/preflight.ts";
import { runVerify, type VerifyRow, type VerifySeams } from "../lib/release/verify.ts";
import { runUpdateMachine, type LegResult, type UpdateMachineSeams } from "../lib/release/update-machine.ts";
import { conformanceViolations } from "../scripts/lib/picker-conformance.ts";
import { TREE } from "../lib/command-tree-def.ts";
import { flagValue } from "../lib/cli-args.ts";
import { confirm } from "../lib/ui/prompts.ts";

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

const CHAT_ROOM = "rt";

async function createRealUpdateMachineSeams(): Promise<UpdateMachineSeams> {
  const top = await runCapture(["git", "rev-parse", "--show-toplevel"]);
  return {
    repoRoot: top.exitCode === 0 ? top.stdout.trim() : process.cwd(),
    appsCheckoutPath: join(homedir(), "Documents", "GitHub", "mattstack-apps"),
    workDir: mkdtempSync(join(tmpdir(), "rt-update-machine-")),
    isTTY: process.stdin.isTTY === true,
    exec: (argv, opts) => runCapture(argv, { stderr: "pipe", timeoutMs: 600_000, ...opts }),
    download: async (url, destPath) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      await Bun.write(destPath, await res.arrayBuffer());
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
  };
}

const LEG_MARK: Record<LegResult["status"], string> = { ok: "✓", skipped: "-", aborted: "!", error: "✗", planned: "•" };

export async function releaseUpdateMachine(args: string[], _ctx: CommandContext = {}, seams?: UpdateMachineSeams): Promise<void> {
  const json = args.includes("--json");
  const options = {
    tag: flagValue(args, "--tag"),
    plan: args.includes("--plan"),
    verifyOnly: args.includes("--verify-only"),
    yes: args.includes("--yes"),
  };

  let report;
  try {
    report = await runUpdateMachine(seams ?? (await createRealUpdateMachineSeams()), options);
  } catch (err) {
    if (err instanceof UserActionableError) exitUserError(err, json, "release update-machine");
    throw err;
  }

  const failed = report.legs.some((l) => l.status === "aborted" || l.status === "error");

  if (json) {
    console.log(JSON.stringify(envelope(report)));
    if (failed) process.exitCode = 1;
    return;
  }

  for (const leg of report.legs) {
    console.log(`${LEG_MARK[leg.status]} ${leg.label}: ${leg.detail}`);
  }
  console.log(`tag ${report.tag}: ${report.ok ? "clean" : "problems above"}`);
  if (failed) process.exitCode = 1;
}
