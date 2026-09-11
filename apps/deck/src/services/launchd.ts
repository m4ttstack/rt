import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { ServiceManager, ServiceSpec } from './manager.ts';
import { renderPlist } from './plist.ts';

export type Exec = (argv: string[]) => Promise<number>;

const realExec: Exec = async argv => {
  const proc = Bun.spawn(argv, { stderr: 'ignore', stdout: 'ignore' });
  return await proc.exited;
};

export function agentsDir(): string {
  return (
    process.env.LOCAL_AGENTS_DIR ?? join(homedir(), 'Library', 'LaunchAgents')
  );
}

// Unescape in reverse order of esc(): &lt; to <, &gt; to >, &amp; to & last.
// Reversing the order is critical: if &amp; was unescaped first, then & in
// &lt; would be replaced again, corrupting the result.
function unescapePlist(s: string): string {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function readInstalledPlist(label: string): string | null {
  try {
    return readFileSync(join(agentsDir(), `${label}.plist`), 'utf8');
  } catch {
    return null;
  }
}

/** ProgramArguments read back from an installed plist deck itself rendered
    (renderPlist's known shape); the plist stays the source of truth for
    "what is actually running" so no last-resolved command is stored. */
export function readInstalledProgramArguments(label: string): string[] | null {
  const array = readInstalledPlist(label)?.match(
    /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/
  );
  if (!array) return null;
  return [...array[1]!.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(m =>
    unescapePlist(m[1]!)
  );
}

/** WorkingDirectory read back from an installed plist, same contract as
    readInstalledProgramArguments: null when the plist or the key is absent. */
export function readInstalledWorkingDirectory(label: string): string | null {
  const match = readInstalledPlist(label)?.match(
    /<key>WorkingDirectory<\/key>\s*<string>([\s\S]*?)<\/string>/
  );
  return match ? unescapePlist(match[1]!) : null;
}

/** EnvironmentVariables read back from an installed plist, same contract. */
export function readInstalledEnvironment(
  label: string
): Record<string, string> | null {
  const dict = readInstalledPlist(label)?.match(
    /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/
  );
  if (!dict) return null;
  const env: Record<string, string> = {};
  for (const m of dict[1]!.matchAll(
    /<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g
  ))
    env[unescapePlist(m[1]!)] = unescapePlist(m[2]!);
  return env;
}

export class LaunchdManager implements ServiceManager {
  constructor(private exec: Exec = realExec) {}

  private plistPath(label: string): string {
    return join(agentsDir(), `${label}.plist`);
  }

  async install(spec: ServiceSpec): Promise<void> {
    mkdirSync(agentsDir(), { recursive: true });
    const path = this.plistPath(spec.label);
    writeFileSync(path, renderPlist(spec));
    const code = await this.exec(['launchctl', 'load', path]);
    if (code !== 0)
      throw new Error(`launchctl load failed for ${spec.label} (exit ${code})`);
  }

  async uninstall(label: string): Promise<void> {
    const path = this.plistPath(label);
    // Teardown must be idempotent: the plist may already be gone (removed
    // manually, or by a prior uninstall attempt) and the job already booted
    // out. Both are the desired end state, not failures, so a missing plist
    // is a no-op success without even shelling out to launchctl for a path
    // that cannot correspond to anything currently loaded from our own
    // bookkeeping.
    if (!existsSync(path)) return;
    // Unload before removing; a failed unload (already unloaded/booted out)
    // is not fatal, on purpose: launchctl's exit code does not reliably
    // distinguish "already not loaded" from other benign states. A genuine
    // failure still surfaces below, via rmSync actually failing to remove
    // the file (e.g. permission denied), which force:true does not swallow.
    await this.exec(['launchctl', 'unload', path]);
    rmSync(path, { force: true });
  }

  async kickstart(label: string): Promise<boolean> {
    const uid = process.getuid?.() ?? 0;
    return (
      (await this.exec([
        'launchctl',
        'kickstart',
        '-k',
        `gui/${uid}/${label}`,
      ])) === 0
    );
  }

  async isInstalled(label: string): Promise<boolean> {
    return existsSync(this.plistPath(label));
  }
}
