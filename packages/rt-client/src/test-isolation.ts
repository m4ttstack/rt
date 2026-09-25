/**
 * Test-run isolation for suites that repoint HOME at a throwaway directory.
 * An ambient RT_DAEMON_SOCK (herdr panes, agent shells) routes rtCommand at
 * a live daemon over the top of the fake HOME, so a repointed HOME alone is
 * not isolation. A test preload calls this BEFORE repointing HOME: it strips
 * the live pointers from the env and arms RT_TEST_FORBID_SOCKS, the list of
 * sockets rtCommand refuses to dispatch at (transport.ts).
 *
 * The preload only runs when bun finds bunfig.toml in the cwd, so a test run
 * started anywhere else keeps the real HOME; a test that unsets HOME, or a
 * Bun.spawn child given no env, reaches it even with the preload loaded.
 * assertNotRealStoreInTest is the backstop: setSetting, unsetSetting, team
 * create and join, and the home-repo init seam call it before writing.
 */
import { spawnSync } from "child_process";
import { homedir, userInfo } from "os";
import { isAbsolute, join, resolve, sep } from "path";

/**
 * Strict by design: a JSON string is iterable and has .includes(), so an
 * unvalidated parse would let a malformed value corrupt the merge here or
 * silently disarm the transport guard. Anything but a string array throws.
 */
export function parseForbidSocks(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== "string")) {
    throw new Error("rt-client: RT_TEST_FORBID_SOCKS must be a JSON string array of socket paths");
  }
  return parsed;
}

export function guardTestDaemonEnv(env: NodeJS.ProcessEnv = process.env): void {
  const forbidden = new Set<string>();
  if (env.RT_TEST_FORBID_SOCKS) {
    for (const path of parseForbidSocks(env.RT_TEST_FORBID_SOCKS)) forbidden.add(path);
  }
  if (env.RT_DAEMON_SOCK) forbidden.add(env.RT_DAEMON_SOCK);
  if (env.RT_APP_SOCKET) forbidden.add(env.RT_APP_SOCKET);
  forbidden.add(join(env.HOME ?? homedir(), ".mattstack", "rt", "rt.sock"));
  delete env.RT_DAEMON_SOCK;
  delete env.RT_APP_SOCKET;
  env.RT_TEST_FORBID_SOCKS = JSON.stringify([...forbidden]);
}

const TEST_FILE = /[._](test|spec)\.[cm]?[jt]sx?$/;

/**
 * Which signal marks this process as a test run, or null outside one.
 * `bun test` sets NODE_ENV=test only when NODE_ENV is unset, so its entry
 * module (Bun.main is the running test file) is checked too. NODE_ENV also
 * marks a child a test spawned with the runner's env.
 */
export function testRunSignal(env: NodeJS.ProcessEnv, main: string | undefined): string | null {
  if (env.NODE_ENV === "test") return "NODE_ENV=test";
  if (env.VITEST !== undefined) return "VITEST set";
  if (main !== undefined && TEST_FILE.test(main)) return `entry module ${main}`;
  return null;
}

export interface StoreWriteCheck {
  target: string;
  account: string;
  home: string | undefined;
  signal: string;
}

/** The refusal message when `target` sits in the account's real ~/.mattstack, else null. */
export function realStoreRefusal({ target, account, home, signal }: StoreWriteCheck): string | null {
  const guarded = resolve(account, ".mattstack");
  const path = resolve(target);
  if (path !== guarded && !path.startsWith(`${guarded}${sep}`)) return null;
  const homeNote = home === undefined ? "HOME is unset" : `HOME is ${home}`;
  return (
    `rt: refusing to write ${path} during a test run (${signal}): it is under this account's real ${guarded} (${homeNote}). ` +
    "Run bun test from the repo root so the bunfig.toml test preload points HOME at a scratch dir. " +
    "If the preload was loaded, look for a test that unsets HOME or a Bun.spawn with no env."
  );
}

/** The home directory field of one passwd entry (`id -P` or `getent passwd`), or null. */
export function parsePasswdHome(line: string): string | null {
  const fields = line.trim().split(":");
  const dir = fields.length >= 7 ? fields[fields.length - 2] : undefined;
  return dir !== undefined && isAbsolute(dir) ? dir : null;
}

let accountHomeCache: string | undefined;

/**
 * The account's home from the user database. Under bun, os.userInfo().homedir
 * and os.homedir() both report the HOME the process started with, so a child
 * spawned with a scratch HOME would otherwise read that scratch dir as the
 * real home.
 */
export function accountHome(): string {
  accountHomeCache ??= lookupPasswdHome() ?? userInfo().homedir;
  return accountHomeCache;
}

function lookupPasswdHome(): string | null {
  const uid = process.getuid?.();
  if (uid === undefined) return null;
  const [cmd, ...args] = process.platform === "darwin" ? ["/usr/bin/id", "-P"] : ["getent", "passwd", String(uid)];
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
  return result.status === 0 ? parsePasswdHome(result.stdout) : null;
}

function entryModule(): string | undefined {
  return (globalThis as { Bun?: { main?: string } }).Bun?.main;
}

/** Throws before a test run writes into the account's real settings stores; a no-op outside test runs. */
export function assertNotRealStoreInTest(target: string): void {
  const signal = testRunSignal(process.env, entryModule());
  if (signal === null) return;
  const refusal = realStoreRefusal({ target, account: accountHome(), home: process.env.HOME, signal });
  if (refusal !== null) throw new Error(refusal);
}
