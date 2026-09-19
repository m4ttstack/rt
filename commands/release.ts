/**
 * rt release — release-cycle verbs.
 *
 *   rt release preflight [--json]
 *
 * Read-only report of the release's mechanical checks (the rt:release skill's
 * steps 1-2c): git/tag state, picker conformance, pin freshness for every
 * vendored layer, catalog pin drift, extension currency, rt-client parity,
 * and which gate (fast vs full) the pending diff implies. Exit 0 only when
 * every layer is verified current; stale or unverifiable layers exit 1.
 */
import { readFileSync } from "fs";
import type { CommandContext } from "../lib/command-tree.ts";
import { envelope } from "../lib/setup/contract.ts";
import { runCapture } from "../lib/subprocess.ts";
import { runPreflight, type CheckRow, type PreflightSeams } from "../lib/release/preflight.ts";
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

const MARK: Record<CheckRow["status"], string> = { ok: "✓", stale: "✗", error: "!" };

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
