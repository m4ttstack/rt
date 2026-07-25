import { test, expect } from "bun:test";

import {
  isNotAuthorized,
  preflightArgv,
  proxyRestartArgv,
  sudoersInstallCommand,
  sudoersLine,
  PROXY_LABEL,
  SUDOERS_PATH,
} from "./proxy-restart.ts";

test("the restart argv is exactly the one fixed command, with no shell", () => {
  expect(proxyRestartArgv()).toEqual([
    "/usr/bin/sudo",
    "-n",
    "/bin/launchctl",
    "kickstart",
    "-k",
    "system/sh.portless.proxy",
  ]);
});

test("the argv takes no arguments, so nothing can be injected into it", () => {
  // Called with a stray argument (as a caller might), the result is unchanged.
  const sneaky = (proxyRestartArgv as (x?: unknown) => string[])("; rm -rf /");
  expect(sneaky).toEqual(proxyRestartArgv());
  expect(sneaky.join(" ")).not.toContain("rm");
});

test("-n is always present so sudo can never hang waiting for a password", () => {
  expect(proxyRestartArgv()).toContain("-n");
});

test("the preflight asks sudo whether the command is allowed, without running it", () => {
  const argv = preflightArgv();
  // `-l` lists/checks permission; it must never actually invoke launchctl.
  expect(argv).toEqual([
    "/usr/bin/sudo",
    "-n",
    "-l",
    "/bin/launchctl",
    "kickstart",
    "-k",
    PROXY_LABEL,
  ]);
  expect(argv).toContain("-l");
  // Same target command as the real restart, so the check cannot drift from it.
  expect(argv.slice(3)).toEqual(proxyRestartArgv().slice(2));
});

test("the sudoers rule authorizes the same command the board runs", () => {
  const line = sudoersLine("matt");
  expect(line).toBe(
    `matt ALL=(root) NOPASSWD: /bin/launchctl kickstart -k ${PROXY_LABEL}`,
  );
  // The granted command must match the argv after the sudo prefix.
  const granted = proxyRestartArgv().slice(2).join(" ");
  expect(line.endsWith(granted)).toBe(true);
});

test("the install command validates with visudo before activating the rule", () => {
  const cmd = sudoersInstallCommand("matt");
  const tmp = `${SUDOERS_PATH}.tmp`;
  // Writes to a dotted temp name (sudo ignores those), so a half-written or
  // invalid file is never live.
  expect(cmd).toContain(`> ${tmp}`);
  expect(cmd.indexOf(`visudo -c -f ${tmp}`)).toBeGreaterThan(cmd.indexOf(`> ${tmp}`));
  // ...and only moves it into place after validation passes.
  expect(cmd.indexOf(`mv ${tmp} ${SUDOERS_PATH}`)).toBeGreaterThan(
    cmd.indexOf(`visudo -c -f ${tmp}`),
  );
  expect(cmd).toContain("umask 337"); // 0440, the mode sudoers requires
  expect(cmd).toContain(sudoersLine("matt"));
});

test("isNotAuthorized recognizes sudo's refusal messages", () => {
  expect(isNotAuthorized("sudo: a password is required")).toBe(true);
  expect(isNotAuthorized("sudo: a terminal is required to read the password")).toBe(true);
  expect(
    isNotAuthorized("Sorry, user matt is not allowed to execute '/bin/launchctl' as root"),
  ).toBe(true);
  expect(isNotAuthorized("matt is not in the sudoers file")).toBe(true);
});

test("isNotAuthorized does not mistake a real command failure for a permission problem", () => {
  expect(isNotAuthorized("Could not find service in domain")).toBe(false);
  expect(isNotAuthorized("")).toBe(false);
});
