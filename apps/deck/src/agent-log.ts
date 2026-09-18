import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dlopen, FFIType, suffix } from 'bun:ffi';

/**
 * Point this process's stdout and stderr at
 * ~/.mattstack/deck/logs/agent.log before anything else runs. The launchd
 * agent plist is one shared file for every user on the Mac, so it cannot
 * carry a per-user StandardErrorPath; without this, a crash between spawn
 * and the first bind (the EADDRINUSE class) leaves zero log lines anywhere.
 * dup2 rather than stream patching so Bun's own panic output lands too.
 */
export function redirectAgentOutput(): void {
  if (process.platform !== 'darwin') return;
  try {
    const dir = join(homedir(), '.mattstack', 'deck', 'logs');
    mkdirSync(dir, { recursive: true });
    const logPath = join(dir, 'agent.log');
    // Rotate a previous run's content so the newest crash is never buried
    // under yesterday's; rename can't lose data the way truncation can.
    if (existsSync(logPath) && statSync(logPath).size > 512 * 1024) {
      renameSync(logPath, join(dir, `agent.${Date.now()}.log`));
    }
    const fd = openSync(logPath, 'a');
    const libc = dlopen(`libSystem.${suffix}`, {
      dup2: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
    });
    libc.symbols.dup2(fd, 1);
    libc.symbols.dup2(fd, 2);
    closeSync(fd);
    libc.close();
    console.log(
      `[agent-log] ${new Date().toISOString()} pid ${process.pid} serving`
    );
  } catch {
    // Non-fatal: output stays wherever the launcher pointed it.
  }
}
