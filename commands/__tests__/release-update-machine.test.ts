import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { UpdateMachineSeams } from "../../lib/release/update-machine.ts";
import { releaseUpdateMachine } from "../release.ts";

const ok = (stdout = "") => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const SHA = "1234567890abcdef1234567890abcdef12345678";

/** The real `hdiutil attach ... -plist` shape: one system-entities dict per partition, mount-point only on the mountable one. */
const ATTACH_PLIST =
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>system-entities</key>\n\t<array>\n` +
  `\t\t<dict>\n\t\t\t<key>dev-entry</key>\n\t\t\t<string>/dev/disk14s1</string>\n\t\t\t<key>mount-point</key>\n\t\t\t<string>/Volumes/mattstack</string>\n\t\t</dict>\n` +
  `\t</array>\n</dict>\n</plist>\n`;

function fakeSeams(overrides: Partial<UpdateMachineSeams> = {}): UpdateMachineSeams {
  let devPid = "111";
  let appPid = 5000;
  return {
    repoRoot: "/repo",
    appsCheckoutPath: "/apps",
    workDir: "/work",
    uid: 501,
    isTTY: true,
    exec: (argv) => {
      const cmd = argv.join(" ");
      if (cmd.includes("releases/latest")) return ok("v2.11.0\n");
      if (cmd.includes("commits/")) return ok(`${SHA}\n`);
      if (cmd.startsWith("shasum")) return ok("cafefeed  /work/mattstack-2.11.0.dmg\n");
      if (cmd.startsWith("hdiutil attach")) return ok(ATTACH_PLIST);
      if (cmd.includes("Info.plist")) return ok("2.11.0\n");
      if (cmd === "rt daemon status --json") {
        return ok(JSON.stringify({ ok: true, state: "running", data: { identity: { flavor: "dev", version: "2.11.0", sourceRev: SHA.slice(0, 9) } } }));
      }
      if (cmd === "git branch --show-current") return ok("main\n");
      if (cmd === "/Applications/mattstack-dev.app/Contents/Helpers/deck list") return ok(`${"board".padEnd(24)} ${"11006".padEnd(6)} ${"up".padEnd(5)} rt\n`);
      // Every read after the restart snapshot sees a new pid, so board reads as cycled.
      if (cmd.startsWith("launchctl print")) return ok(`\tstate = running\n\tpid = ${++appPid}\n`);
      if (cmd === "/Applications/mattstack-dev.app/Contents/Helpers/deck --version") return ok("3.4.0\n");
      if (cmd.startsWith("kill")) {
        devPid = "";
        return ok("");
      }
      if (cmd.startsWith("open")) {
        devPid = "222";
        return ok("");
      }
      if (cmd.startsWith("pgrep")) return ok(devPid ? `${devPid}\n` : "");
      return ok("");
    },
    download: async () => {},
    readFile: (p) => (p.endsWith("SHA256SUMS") ? "cafefeed  mattstack-2.11.0.dmg\n" : p.endsWith("deps.lock") ? JSON.stringify({ tools: [{ name: "deck", version: "3.4.0" }] }) : null),
    confirm: async () => true,
    announce: async () => true,
    clock: () => new Date("2026-09-18T12:00:00.000Z"),
    sleep: async () => {},
    ...overrides,
  };
}

// Bun (unlike Node) leaves process.exitCode at its last numeric value when
// reassigned to undefined, so every reset here uses 0, never undefined --
// otherwise one failing-leg test's exitCode=1 sticks for the rest of the file.
async function run(args: string[], seams: UpdateMachineSeams): Promise<{ logs: string[]; exitCode: number }> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  process.exitCode = 0;
  try {
    await releaseUpdateMachine(args, {}, seams);
    return { logs, exitCode: process.exitCode as number };
  } finally {
    process.exitCode = 0;
    logSpy.mockRestore();
  }
}

/** exitUserError always calls the real process.exit, never a seam... spy on it to catch the code without killing the test process. */
async function runExpectingProcessExit(fn: () => Promise<void>): Promise<{ code: number | undefined; logs: string[] }> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return { code: undefined, logs };
  } catch {
    return { code: exitSpy.mock.calls.at(-1)?.[0] as number | undefined, logs };
  } finally {
    exitSpy.mockRestore();
    logSpy.mockRestore();
  }
}

afterEach(() => {
  process.exitCode = 0;
});

describe("rt release update-machine", () => {
  test("--yes --json prints the leg report and exits clean on a healthy machine", async () => {
    const { logs, exitCode } = await run(["--yes", "--json"], fakeSeams());
    expect(logs).toHaveLength(1);
    const body = JSON.parse(logs[0]!);
    expect(body.contract).toBe(1);
    expect(body.tag).toBe("v2.11.0");
    expect(body.ok).toBe(true);
    expect(body.legs).toHaveLength(5);
    expect(exitCode ?? 0).toBe(0);
  });

  test("human output renders a leg-by-leg checklist and a summary line", async () => {
    const { logs, exitCode } = await run(["--yes"], fakeSeams());
    const out = logs.join("\n");
    expect(out).toContain("prod app update");
    expect(out).toContain("verification sweep");
    expect(out).toContain("tag v2.11.0: clean");
    expect(exitCode ?? 0).toBe(0);
  });

  test("--plan prints the resolved legs and exits 0 without changing anything", async () => {
    const { logs, exitCode } = await run(["--plan", "--json"], fakeSeams());
    const body = JSON.parse(logs[0]!);
    expect(body.legs.every((l: { status: string }) => l.status === "planned")).toBe(true);
    expect(exitCode ?? 0).toBe(0);
  });

  test("--verify-only reports just the verify leg", async () => {
    const { logs } = await run(["--verify-only", "--json"], fakeSeams());
    const body = JSON.parse(logs[0]!);
    expect(body.legs).toHaveLength(1);
    expect(body.legs[0].id).toBe("verify");
  });

  test("a leg error exits 1 (human and --json alike)", async () => {
    const seams = fakeSeams({ exec: (argv) => (argv.join(" ").includes("Info.plist") ? ok("0.0.0\n") : fakeSeams().exec(argv)) });
    const { exitCode } = await run(["--yes", "--json"], seams);
    expect(exitCode).toBe(1);
  });

  test("non-interactive without --yes refuses via the real process.exit(2) and the contract error envelope", async () => {
    const seams = fakeSeams({ isTTY: false });
    const { code, logs } = await runExpectingProcessExit(() => releaseUpdateMachine(["--json"], {}, seams));
    expect(code).toBe(2);
    const body = JSON.parse(logs[0]!);
    expect(body.contract).toBe(1);
    expect(body.error.code).toBe("update-machine-noninteractive");
  });

  test("non-interactive without --yes, human mode, also exits 2", async () => {
    const seams = fakeSeams({ isTTY: false });
    const { code, logs } = await runExpectingProcessExit(() => releaseUpdateMachine([], {}, seams));
    expect(code).toBe(2);
    expect(logs[0]).toContain("release update-machine");
  });

  test("non-interactive with --verify-only never hits the refusal (read-only)", async () => {
    const seams = fakeSeams({ isTTY: false });
    const { exitCode } = await run(["--verify-only", "--json"], seams);
    expect(exitCode).toBe(0);
  });

  test("--plan and --verify-only together are refused via the real process.exit(2), not a silent pick-one", async () => {
    const seams = fakeSeams();
    const { code, logs } = await runExpectingProcessExit(() => releaseUpdateMachine(["--plan", "--verify-only", "--json"], {}, seams));
    expect(code).toBe(2);
    const body = JSON.parse(logs[0]!);
    expect(body.error.code).toBe("update-machine-plan-verify-only");
  });

  test("--tag overrides the latest-release resolution", async () => {
    const seams = fakeSeams();
    const { logs } = await run(["--plan", "--tag", "v9.9.9", "--json"], seams);
    const body = JSON.parse(logs[0]!);
    expect(body.tag).toBe("v9.9.9");
  });

  test("a halted run's human summary names the leg that halted it", async () => {
    const seams = fakeSeams({ exec: (argv) => (argv.join(" ").startsWith("shasum") ? ok("deadbeef  nope\n") : fakeSeams().exec(argv)) });
    const { logs } = await run(["--yes"], seams);
    const out = logs.join("\n");
    expect(out).toContain("halted after prod app update failed");
  });
});
