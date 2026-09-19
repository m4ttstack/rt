/**
 * rt release — release-cycle verbs.
 *
 *   rt release preflight [--json]
 *   rt release verify [tag] [--json] [--no-wait]
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
 */
import { readFileSync } from "fs";
import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { runCapture } from "../lib/subprocess.ts";
import { runPreflight, type CheckRow, type PreflightSeams } from "../lib/release/preflight.ts";
import { runVerify, type VerifyRow, type VerifySeams } from "../lib/release/verify.ts";
import { conformanceViolations } from "../scripts/lib/picker-conformance.ts";
import { TREE } from "../lib/command-tree-def.ts";

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
