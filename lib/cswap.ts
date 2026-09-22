import { homedir } from "os";
import { join } from "path";
import type { PaneAccount } from "../packages/rt-client/src/commands.ts";
import { runCapture } from "./subprocess.ts";

const ACCOUNT_LINE = /^\s*(\d+):\s+(\S+)(?:\s+\[([^\]]+)\])?/;
// The `$$` row is spend, not rate-limit headroom; it is skipped on purpose.
// Lazy label capture tolerates a colon inside the label itself (e.g. "Sub:Label:").
const HEADROOM_LINE = /^\s*[├└]\s+([^$\n]+?):\s+(\d+)%/;

export function parseCswapList(text: string): PaneAccount[] {
  const accounts: PaneAccount[] = [];
  const headroom: string[][] = [];
  for (const line of text.split("\n")) {
    const acct = ACCOUNT_LINE.exec(line);
    if (acct) {
      accounts.push({ slot: Number(acct[1]), email: acct[2]!, ...(acct[3] ? { alias: acct[3] } : {}) });
      headroom.push([]);
      continue;
    }
    const head = HEADROOM_LINE.exec(line);
    if (head && headroom.length) headroom[headroom.length - 1]!.push(`${head[1]!.trim()} ${head[2]}%`);
  }
  return accounts.map((a, i) => (headroom[i]!.length ? { ...a, headroom: headroom[i]!.join(" · ") } : a));
}

/** launchd's PATH does not carry ~/.local/bin, so resolve the binary explicitly. */
export function cswapBin(): string {
  return Bun.which("cswap") ?? join(homedir(), ".local", "bin", "cswap");
}

/** The account a `cswap run` caller is actually running as. Only the caller's
    env knows it: `cswap run` sets CLAUDE_CONFIG_DIR per terminal, while a
    bare `claude` launched by the daemon falls back to the global default
    profile, which can be a different account. Undefined for a default-profile
    caller, whose spawns already land on the same account. */
export async function callerCswapAccount(
  env: Record<string, string | undefined>,
  exec: typeof runCapture = runCapture,
): Promise<string | undefined> {
  if (!env.CLAUDE_CONFIG_DIR) return undefined;
  const res = await exec([cswapBin(), "list", "--json"], { timeoutMs: 5_000, env });
  if (res.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(res.stdout) as { activeAccountNumber?: number | null; accounts?: Array<{ number: number; email: string }> };
    return parsed.accounts?.find((a) => a.number === parsed.activeAccountNumber)?.email;
  } catch {
    return undefined;
  }
}

export async function listCswapAccounts(exec: typeof runCapture = runCapture): Promise<PaneAccount[]> {
  const res = await exec([cswapBin(), "list"], { timeoutMs: 5_000 });
  if (res.exitCode !== 0) return [];
  return parseCswapList(res.stdout);
}
