import { readFileSync } from "fs";
import { join } from "path";
import type { AgentSignal } from "./agent-signal.ts";

const DEFAULT_PORT = 7930;

export function readBoardPort(configPath: string = join(import.meta.dir, "..", "config.json")): number {
  try {
    const cfg = JSON.parse(readFileSync(configPath, "utf8")) as { port?: number };
    return cfg.port ?? DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/** Tell the board an agent moved to a new lifecycle status, so it can drop
    whatever slack reaction that status means (see signalEmoji). Best-effort by
    design: the state file the CLI already wrote is the source of truth, so a
    board that is down or restarting must never fail the agent's status write. */
export async function notifyBoard(signal: AgentSignal, port: number = readBoardPort()): Promise<void> {
  if (!signal.mrUrl) return;
  const url = `http://localhost:${port}/agent/status`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signal),
    });
    if (!res.ok) {
      console.error(`board /agent/status returned ${res.status}: ${await res.text().catch(() => "")}`);
    }
  } catch (err) {
    console.error(`board /agent/status unreachable: ${err instanceof Error ? err.message : err}`);
  }
}
