import { join } from "path";

/** sizeof(sockaddr_un.sun_path) on macOS: a path of this many bytes or more never binds. */
export const SUN_PATH_MAX = 104;

export function termwrightSocketPath(dir: string, pid: number, id: number): string {
  return join(dir, `${pid}-${id}.sock`);
}

/** Refuses before the daemon spawns: a too-long path otherwise reads as a 10s "socket did not appear" timeout with no cause. */
export function assertSocketPathFits(path: string): void {
  const bytes = Buffer.byteLength(path);
  if (bytes >= SUN_PATH_MAX) {
    throw new Error(`Termwright socket path is ${bytes} bytes; macOS caps a Unix socket path below ${SUN_PATH_MAX}: ${path}`);
  }
}
