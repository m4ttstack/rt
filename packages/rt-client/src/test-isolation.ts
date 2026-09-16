/**
 * Test-run isolation for suites that repoint HOME at a throwaway directory.
 * An ambient RT_DAEMON_SOCK (herdr panes, agent shells) routes rtCommand at
 * a live daemon over the top of the fake HOME, so a repointed HOME alone is
 * not isolation. A test preload calls this BEFORE repointing HOME: it strips
 * the live pointers from the env and arms RT_TEST_FORBID_SOCKS, the list of
 * sockets rtCommand refuses to dispatch at (transport.ts).
 */
import { homedir } from "os";
import { join } from "path";

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
