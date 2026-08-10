import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export function stateDir(): string {
  return process.env.LOCAL_STATE_DIR ?? join(homedir(), ".mattstack", "local");
}

export function logsDir(): string {
  return join(stateDir(), "logs");
}

/** Where the CLI finds a running platform. Written at serve boot. */
export function writeApiInfo(port: number): void {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(join(stateDir(), "api.json"), JSON.stringify({ port, pid: process.pid }));
}

export function readApiInfo(): { port: number } | null {
  try {
    const parsed = JSON.parse(readFileSync(join(stateDir(), "api.json"), "utf8"));
    return Number.isInteger(parsed.port) ? { port: parsed.port } : null;
  } catch {
    return null;
  }
}
