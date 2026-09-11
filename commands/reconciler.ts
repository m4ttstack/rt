/**
 * rt reconciler: CLI over the executor reconciler's read-only status and
 * manual clear (lib/daemon/reconciler.ts). Thin over the rt-client
 * reconciler* wrappers, same idiom as commands/bg.ts.
 *
 *   rt reconciler status [--json]            last sweep snapshot
 *   rt reconciler clear <agentId> [--json]   clear one agent's reconciler state
 */
import { reconcilerClear as clientClear, reconcilerStatus as clientStatus } from "../packages/rt-client/src/index.ts";
import type { Commands, RtResponse } from "../packages/rt-client/src/index.ts";

function fail(msg: string): never {
  console.error(`rt reconciler: ${msg}`);
  process.exit(1);
}

function positional(args: string[]): string | undefined {
  for (const a of args) {
    if (!a.startsWith("--")) return a;
  }
  return undefined;
}

function unwrap<T>(res: RtResponse<T>, label: string): T {
  if (!res.ok || res.data === undefined) fail(res.error ?? `${label} failed`);
  return res.data;
}

export function renderStatus(data: Commands["reconciler:status"]["data"]): string {
  const lines = [
    `swept: ${data.sweptAt > 0 ? new Date(data.sweptAt).toISOString() : "never"}`,
    `herdr: ${data.herdrReachable ? "reachable" : "unreachable"}`,
    "",
  ];
  if (data.executors.length === 0) {
    lines.push("no known executors");
  } else {
    lines.push("executors:");
    const idWidth = Math.max(...data.executors.map((e) => e.agentId.length));
    for (const e of data.executors) {
      lines.push(`  ${e.agentId.padEnd(idWidth)}  ${e.state.padEnd(9)}  ${e.paneRef ?? "-"}`);
    }
  }
  return lines.join("\n");
}

export async function reconcilerStatus(args: string[]): Promise<void> {
  const data = unwrap(await clientStatus(), "status");
  if (args.includes("--json")) return void console.log(JSON.stringify({ ok: true, ...data }));
  console.log(renderStatus(data));
}

const CLEAR_USAGE = "usage: rt reconciler clear <agentId> [--json]";

export async function reconcilerClear(args: string[]): Promise<void> {
  const agentId = positional(args);
  if (!agentId) fail(CLEAR_USAGE);
  const data = unwrap(await clientClear({ agentId }), "clear");
  if (args.includes("--json")) return void console.log(JSON.stringify({ ok: true, ...data }));
  console.log(`cleared ${agentId}`);
}
