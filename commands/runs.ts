/**
 * rt runs: the run DB.
 *   rt runs [--repo R] [--json]           list, newest first
 *   rt runs show <runId> [--repo R] [--json]
 *   rt runs abandon <runId> [--repo R] [--reason TEXT]
 * Reads go through the daemon's runs:* commands; the pipeline's write verbs
 * live in runs-write.ts and open the run DB directly.
 */
import { daemonQuery } from "../lib/daemon-client.ts";
import { resolveRepoArg } from "../lib/repo-arg.ts";
import { repoLabel } from "../lib/repo-label.ts";
import { parseIdentity } from "../lib/settings/identity.ts";
import { listRunRepoDirs } from "../lib/runs/store.ts";
import type { RunDetail, RunSummary } from "../packages/rt-client/src/commands.ts";

function fail(msg: string): never {
  console.error(`rt runs: ${msg}`);
  process.exit(1);
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const v = args[i + 1];
  // Dangling flag (nothing after it, or the next token is itself a flag)
  // must fail loudly -- silently falling back to "no value" here would
  // turn `rt runs --repo` into an unscoped list instead of an error.
  if (v === undefined || v.startsWith("--")) fail(`${flag} requires a value`);
  return v;
}

// Index-based scan (not value comparison — a positional that EQUALS a flag's
// value, e.g. `rt runs show abc --repo abc`, must still parse).
const FLAGS_WITH_VALUES = new Set(["--repo", "--reason"]);
function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++; // skip the flag's value slot
      continue;
    }
    return a;
  }
  return undefined;
}

const STATUS_ICON: Record<string, string> = { running: "●", done: "✓", failed: "✗", abandoned: "○", redirected: "»" };

export function formatRunLine(r: RunSummary): string {
  const icon = STATUS_ICON[r.status] ?? "?";
  const stage = r.status === "running" && r.current_stage ? `@ ${r.current_stage}` : "";
  const when = new Date(r.started_at).toISOString().slice(0, 16).replace("T", " ");
  return `${icon} ${r.id}  ${repoLabel(r.repo)}  ${r.work_type}  ${r.status} ${stage}  ${when}`;
}

export function formatRunDetail(d: RunDetail): string {
  const lines: string[] = [formatRunLine(d.run)];
  if (d.schemaAhead) lines.push("(newer schema than this rt knows; some data may be missing)");
  lines.push("", "stages:");
  for (const s of d.stages) {
    lines.push(`  ${STATUS_ICON[s.status] ?? "?"} ${s.name} (attempt ${s.attempt})`);
    if (s.reason) lines.push(`      reason: ${s.reason}`);
    if (s.detail_path) lines.push(`      detail: ${s.detail_path}`);
  }
  lines.push("", "fields:");
  for (const f of d.fields) lines.push(`  ${f.key} = ${f.value}  [${f.produced_by}]`);
  lines.push("", "decisions:");
  for (const dec of d.decisions) lines.push(`  ${dec.contract} ${dec.scope}: ${dec.selection}  [${dec.decided_by}]`);
  return lines.join("\n");
}

class UnresolvedRepoArg extends Error {}

/** Thrown by `resolveRunsRepoArg` when `arg` neither resolves through the
    identity resolver nor names an existing run directory. */
export class UnknownRunsRepo extends Error {
  constructor(readonly arg: string) {
    super(`unknown repo: ${arg}`);
  }
}

/**
 * On disk, a run dir's name is the raw identity id with "/" flattened to "-"
 * (e.g. "gitlab.com-acme-acme-dev" for "gitlab.com/acme/acme-dev"), never the
 * wire form resolveRepoArg returns (that form's ":" and "%" never named a
 * real dir). This only translates a resolved identity into the key that
 * already names them; it does not rename anything on disk.
 */
export function runDisplayKey(identity: string): string {
  const parsed = parseIdentity(identity);
  return parsed ? parsed.id.replace(/\//g, "-") : identity;
}

/**
 * Runs are keyed by their on-disk run-dir name: the display key derived
 * below for runs written after the cutover, but whatever key its pipeline
 * used for a run written before it. Resolve `--repo` like every other
 * command when the arg matches a known repo; when it doesn't, forward it
 * verbatim ONLY if a run dir already exists under that literal name (a
 * pre-cutover key). Otherwise the arg names nothing real and must error
 * rather than silently list zero runs.
 */
export async function resolveRunsRepoArg(arg: string): Promise<string> {
  try {
    const identity = await resolveRepoArg(arg, (msg): never => {
      throw new UnresolvedRepoArg(msg);
    });
    return runDisplayKey(identity);
  } catch (err) {
    if (err instanceof UnresolvedRepoArg) {
      if (listRunRepoDirs().includes(arg)) return arg;
      throw new UnknownRunsRepo(arg);
    }
    throw err;
  }
}

/**
 * Shared `--repo` handling for every runs subcommand: resolves the flag (if
 * present) and exits on an unknown repo, matching the output mode (`--json`
 * envelope vs plain stderr) the rest of each command already uses.
 */
async function resolveRepoFilter(args: string[]): Promise<string | undefined> {
  const repoArg = flagValue(args, "--repo");
  if (!repoArg) return undefined;
  try {
    return await resolveRunsRepoArg(repoArg);
  } catch (err) {
    if (!(err instanceof UnknownRunsRepo)) throw err;
    if (args.includes("--json")) {
      console.log(JSON.stringify({ ok: false, error: err.message }));
      process.exit(1);
    }
    fail(err.message);
  }
}

async function fetchRunsForPicker(args: string[]): Promise<RunSummary[]> {
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:list", { repo }, 10_000);
  if (!res || !res.ok) return [];
  return (res.data as { runs: RunSummary[] }).runs;
}

async function pickRunId(runs: RunSummary[], message: string): Promise<string | null> {
  const { filterableSelect } = await import("../lib/pick-wrappers.ts");
  const idWidth = Math.max(...runs.map((r) => r.id.length));
  const options = runs.map((r) => ({
    value: r.id,
    label: r.id.padEnd(idWidth),
    hint: `${repoLabel(r.repo)}  ${r.status}${r.current_stage ? ` @ ${r.current_stage}` : ""}`,
  }));
  return filterableSelect({ message, options, stderr: true });
}

export async function runsList(args: string[]): Promise<void> {
  const stray = positional(args);
  if (stray) {
    console.error(`rt runs: unknown subcommand "${stray}"\nusage: rt runs [--repo R] [--json] | rt runs <show|abandon|run-start|run-status|stage-start|stage-done|stage-fail|stage-redirect|field|decision|snapshot> ...`);
    process.exit(2);
  }
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:list", { repo }, 10_000);
  if (!res) fail("daemon unavailable — the run DB needs the rt daemon (rt daemon start)");
  if (!res.ok) fail(res.error ?? "list failed");
  const data = res.data as { runs: RunSummary[] };
  if (args.includes("--json")) { console.log(JSON.stringify(data)); return; }
  if (data.runs.length === 0) { console.log("no runs"); return; }
  for (const r of data.runs) console.log(formatRunLine(r));
}

export async function runsShow(args: string[]): Promise<void> {
  let runId = positional(args);
  const json = args.includes("--json");
  if (!runId) {
    const runs = process.stdin.isTTY && !json && !process.env.RT_BATCH
      ? await fetchRunsForPicker(args)
      : [];
    if (runs.length === 0) fail("usage: rt runs show <runId> [--repo <name>] [--json]");
    const picked = await pickRunId(runs, "pick a run to show");
    if (!picked) process.exit(0);
    runId = picked;
  }
  const repo = await resolveRepoFilter(args);
  const res = await daemonQuery("runs:get", { runId, repo }, 10_000);
  if (!res) fail("daemon unavailable — the run DB needs the rt daemon (rt daemon start)");
  if (!res.ok) fail(res.error ?? "get failed");
  const data = res.data as RunDetail;
  if (args.includes("--json")) { console.log(JSON.stringify(data)); return; }
  console.log(formatRunDetail(data));
}

export async function runsAbandon(args: string[]): Promise<void> {
  let runId = positional(args);
  const json = args.includes("--json");
  if (!runId) {
    const runs = process.stdin.isTTY && !json && !process.env.RT_BATCH
      ? await fetchRunsForPicker(args)
      : [];
    const targets = runs.filter((r) => r.status === "running");
    const pick = targets.length > 0 ? targets : runs;
    if (pick.length === 0) fail("abandon needs a run id");
    const picked = await pickRunId(pick, "pick a run to abandon");
    if (!picked) process.exit(0);
    runId = picked;
  }
  const repo = await resolveRepoFilter(args);
  const reason = flagValue(args, "--reason") ?? "reconciled by hand";
  const res = await daemonQuery("runs:abandon", { runId, repo, reason });
  if (!res) fail("daemon unavailable — the run DB needs the rt daemon (rt daemon start)");
  if (!res.ok) fail(res.error ?? "abandon failed");
  console.log(`abandoned ${runId}`);
}
