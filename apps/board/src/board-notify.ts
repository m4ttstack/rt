import { readFileSync } from "fs";
import { join } from "path";
import { APP_ROOT } from "./app-root.ts";
import type { AgentSignal } from "./agent-signal.ts";

const DEFAULT_PORT = 7930;

function validPort(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** The board's actual port can differ from the default when $PORT is set (see
    server.ts). Env wins because it's the most explicit override; the runtime
    port file is next because it reflects what the board is really listening
    on right now; 7930 is the last resort when the board has never written
    that file. config.json's `port` field retired with the settings
    migration (env PORT is now the sole override), so there is no longer a
    config.json tier here. */
export function readBoardPort(
  portFilePath: string = join(APP_ROOT, "state", "board-port"),
): number {
  const fromEnv = validPort(process.env.MR_BOARD_PORT);
  if (fromEnv !== undefined) return fromEnv;

  try {
    const fromFile = validPort(readFileSync(portFilePath, "utf8").trim());
    if (fromFile !== undefined) return fromFile;
  } catch {
    // no runtime port file yet -- fall through to the default
  }

  return DEFAULT_PORT;
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
