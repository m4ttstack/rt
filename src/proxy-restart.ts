/**
 * Restart the portless proxy daemon.
 *
 * portless watches ~/.portless/routes.json with fs.watch, but that watcher dies
 * on long-lived proxies, after which route changes (a dev-port override, an app
 * renumber) never reach the running proxy and .localhost keeps serving the old
 * port. The only reliable fix is restarting the daemon, which runs as root.
 *
 * The board therefore shells out to sudo for ONE fixed command. There is no user
 * input anywhere in the argv: the label is a module constant, the array form
 * never goes through a shell, and the matching sudoers rule (see SUDOERS_LINE)
 * grants exactly this command and nothing else.
 */

/** The launchd label of the portless proxy daemon (/Library/LaunchDaemons). */
export const PROXY_LABEL = "system/sh.portless.proxy";

export const SUDOERS_PATH = "/etc/sudoers.d/local-apps-proxy-restart";

/**
 * The exact argv the board runs. Fixed at module scope: callers cannot pass a
 * label, a flag, or anything else into it.
 */
export function proxyRestartArgv(): string[] {
  return ["/usr/bin/sudo", "-n", "/bin/launchctl", "kickstart", "-k", PROXY_LABEL];
}

/** The single sudoers rule that authorizes the command above, for `user`. */
export function sudoersLine(user: string): string {
  return `${user} ALL=(root) NOPASSWD: /bin/launchctl kickstart -k ${PROXY_LABEL}`;
}

/**
 * The one-time install command handed to the user when the rule is missing.
 *
 * It writes to a `.tmp` name first (sudo ignores sudoers.d files containing a
 * dot, so the half-written file is inert), validates it with `visudo -c`, and
 * only then moves it into place. A malformed rule can break sudo entirely, so
 * the validate-before-activate order matters. umask 337 yields the 0440 mode
 * sudoers requires.
 */
export function sudoersInstallCommand(user: string): string {
  const tmp = `${SUDOERS_PATH}.tmp`;
  return (
    `sudo sh -c 'umask 337; printf "%s\\n" "${sudoersLine(user)}" > ${tmp} && ` +
    `visudo -c -f ${tmp} && mv ${tmp} ${SUDOERS_PATH} && echo INSTALLED || rm -f ${tmp}'`
  );
}

export type ProxyRestartResult =
  | { ok: true }
  | { ok: false; reason: "not-authorized" | "failed"; detail: string };

/**
 * True when sudo refused for lack of authorization rather than the command
 * itself failing. `sudo -n` never prompts, so it reports one of these instead.
 */
export function isNotAuthorized(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("password is required") ||
    s.includes("a password is required") ||
    s.includes("terminal is required") ||
    s.includes("askpass") ||
    s.includes("not allowed to execute") ||
    s.includes("may not run") ||
    s.includes("is not in the sudoers file")
  );
}

/** Run the restart. Never throws: failures come back as a typed result. */
export async function restartProxy(): Promise<ProxyRestartResult> {
  try {
    const proc = Bun.spawn(proxyRestartArgv(), { stderr: "pipe", stdout: "pipe" });
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code === 0) return { ok: true };
    const detail = stderr.trim().split("\n").slice(0, 3).join(" ").slice(0, 300);
    return {
      ok: false,
      reason: isNotAuthorized(stderr) ? "not-authorized" : "failed",
      detail: detail || `exit ${code}`,
    };
  } catch (err) {
    return { ok: false, reason: "failed", detail: String(err).slice(0, 300) };
  }
}
