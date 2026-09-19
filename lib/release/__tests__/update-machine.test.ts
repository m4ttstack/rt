import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../setup/errors.ts";
import { runUpdateMachine, type UpdateMachineSeams } from "../update-machine.ts";

const ok = (stdout = "", exitCode = 0) => Promise.resolve({ stdout, stderr: "", exitCode });

const RELEASED_SHA = "abc123def456abc123def456abc123def456abc";
const RELEASED_SHORT = RELEASED_SHA.slice(0, 12);
const TAG = "v2.11.0";
const START = new Date("2026-09-18T12:00:00.000Z");

interface Options {
  branch?: string;
  announceOk?: boolean;
  fetchDepsExit?: number;
  buildExit?: number;
  shaMismatch?: boolean;
  /** `fresh`: pid actually cycles on the broad `deck restart --managed`. `recovers` (default true): a targeted `deck restart <name>` retry cycles the pid when the broad restart didn't. */
  managed?: { name: string; fresh: boolean; recovers?: boolean; psUnparseable?: boolean }[];
  daemonCommit?: string;
  deckVersion?: string;
  prodVersion?: string;
  devPidBefore?: string;
  devPidAfter?: string;
}

/** Real `launchctl print` has no start-time field: top-level state/pid, tab-indented, nested sub-sections repeat their own "state = active" lines. */
const OLD_PS_TIME = "Thu Sep 18 09:00:00 2026";

/** A seam set representing a fully healthy machine: every leg succeeds cleanly. */
function fakeSeams(opts: Options = {}): { seams: UpdateMachineSeams; calls: string[] } {
  const calls: string[] = [];
  const managed = opts.managed ?? [{ name: "board", fresh: true }, { name: "chat", fresh: true }];
  const devPidBefore = opts.devPidBefore ?? "111";
  const devPidAfter = opts.devPidAfter ?? "222";
  let devPid = devPidBefore;
  const pids = new Map(managed.map((m, i) => [m.name, 1000 + i]));

  const seams: UpdateMachineSeams = {
    repoRoot: "/repo",
    appsCheckoutPath: "/apps",
    workDir: "/work",
    isTTY: true,
    exec: (argv) => {
      const cmd = argv.join(" ");
      calls.push(cmd);
      if (cmd.startsWith("gh api repos/m4ttstack/rt/releases/latest")) return ok(`${TAG}\n`);
      if (cmd.startsWith("gh api repos/m4ttstack/rt/commits/")) return ok(`${RELEASED_SHA}\n`);
      if (cmd.startsWith("shasum")) return ok(`${opts.shaMismatch ? "deadbeef" : "cafefeed"}  /work/mattstack-2.11.0.dmg\n`);
      if (cmd.startsWith("hdiutil attach")) return ok("/dev/disk4s1  Apple_HFS  /Volumes/mattstack\n");
      if (cmd.startsWith("hdiutil detach")) return ok("");
      if (cmd.startsWith("ditto")) return ok("");
      if (cmd.startsWith("git clone")) return ok("");
      if (cmd.startsWith("git checkout")) return ok("");
      if (cmd.startsWith("scripts/fetch-deps.sh")) return ok("", opts.fetchDepsExit ?? 0);
      if (cmd.startsWith("rt-tray/build.sh")) return ok("", opts.buildExit ?? 0);
      if (cmd.startsWith("pgrep")) return ok(devPid ? `${devPid}\n` : "");
      if (cmd.startsWith("kill")) return ok("");
      if (cmd.startsWith("open")) {
        devPid = devPidAfter;
        return ok("");
      }
      if (cmd === "rt daemon restart") return ok("");
      if (cmd === "rt daemon status --json") return ok(JSON.stringify({ commit: opts.daemonCommit ?? RELEASED_SHA }));
      if (cmd === "git branch --show-current") return ok(`${opts.branch ?? "main"}\n`);
      if (cmd === "git pull") return ok("");
      if (cmd === "deck restart --managed") {
        for (const m of managed) if (m.fresh) pids.set(m.name, pids.get(m.name)! + 1);
        return ok("");
      }
      if (cmd.startsWith("deck restart ")) {
        const name = argv[2]!;
        const row = managed.find((m) => m.name === name);
        if (row?.recovers !== false) pids.set(name, pids.get(name)! + 1);
        return ok("");
      }
      if (cmd === "deck list --json") {
        return ok(JSON.stringify(managed.map((m) => ({ name: m.name, managed: true }))));
      }
      if (cmd.startsWith("launchctl print")) {
        const name = cmd.split(".").pop()!;
        const pid = pids.get(name);
        return ok(pid !== undefined ? `\tstate = running\n\tpid = ${pid}\n\tsomething = { state = active\n\tpid = 99999\n\t}\n` : "\tstate = not running\n");
      }
      if (cmd.startsWith("ps -p")) {
        const name = managed.find((m) => pids.get(m.name) === Number(argv[2]))?.name;
        const row = managed.find((m) => m.name === name);
        return ok(row?.psUnparseable ? "garbage\n" : `${OLD_PS_TIME}\n`);
      }
      if (cmd === "deck --version") return ok(`${opts.deckVersion ?? "3.4.0"}\n`);
      if (cmd.includes("Info.plist")) return ok(`${opts.prodVersion ?? "2.11.0"}\n`);
      return Promise.resolve({ stdout: "", stderr: `unhandled: ${cmd}`, exitCode: 1 });
    },
    download: async (url, dest) => {
      calls.push(`download ${url} -> ${dest}`);
    },
    readFile: (path) => {
      calls.push(`readFile ${path}`);
      if (path.endsWith("SHA256SUMS")) return "cafefeed  mattstack-2.11.0.dmg\n";
      if (path.endsWith("deps.lock")) return JSON.stringify({ tools: [{ name: "deck", version: "3.4.0" }] });
      return null;
    },
    confirm: async () => true,
    announce: async (message) => {
      calls.push(`announce ${message}`);
      return opts.announceOk ?? true;
    },
    clock: () => START,
  };

  return { seams, calls };
}

describe("rt release update-machine", () => {
  test("runs all five legs in order and reports ok when the machine is healthy", async () => {
    const { seams } = fakeSeams();
    const report = await runUpdateMachine(seams, { yes: true });
    expect(report.legs.map((l) => l.id)).toEqual(["prod-app", "dev-bundle", "daemon", "served-suite", "verify"]);
    expect(report.legs.every((l) => l.status === "ok")).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.tag).toBe(TAG);
  });

  test("--plan resolves and prints the legs without running any of them", async () => {
    const { seams, calls } = fakeSeams();
    const report = await runUpdateMachine(seams, { plan: true });
    expect(report.legs).toHaveLength(5);
    expect(report.legs.every((l) => l.status === "planned")).toBe(true);
    expect(report.ok).toBe(true);
    // Only the read-only tag resolution may have run; nothing state-changing did.
    expect(calls.some((c) => c.startsWith("ditto"))).toBe(false);
    expect(calls.some((c) => c.startsWith("download"))).toBe(false);
    expect(calls.some((c) => c === "rt daemon restart")).toBe(false);
    expect(calls.some((c) => c === "deck restart --managed")).toBe(false);
  });

  test("--verify-only runs only the verify leg", async () => {
    const { seams, calls } = fakeSeams();
    const report = await runUpdateMachine(seams, { verifyOnly: true });
    expect(report.legs.map((l) => l.id)).toEqual(["verify"]);
    expect(report.legs[0]!.status).toBe("ok");
    expect(calls.some((c) => c.startsWith("ditto"))).toBe(false);
    expect(calls.some((c) => c === "rt daemon restart")).toBe(false);
  });

  test("--yes skips every confirmation prompt", async () => {
    const { seams } = fakeSeams();
    let confirmCalls = 0;
    seams.confirm = async () => {
      confirmCalls++;
      return true;
    };
    await runUpdateMachine(seams, { yes: true });
    expect(confirmCalls).toBe(0);
  });

  test("on a TTY without --yes, each state-changing leg is gated by a confirm prompt", async () => {
    const { seams } = fakeSeams();
    const asked: string[] = [];
    seams.confirm = async (message) => {
      asked.push(message);
      return true;
    };
    await runUpdateMachine(seams, {});
    expect(asked).toHaveLength(4);
  });

  test("declining a leg's confirm prompt skips just that leg", async () => {
    const { seams } = fakeSeams();
    seams.confirm = async (message) => !message.toLowerCase().includes("dev bundle");
    const report = await runUpdateMachine(seams, {});
    const devLeg = report.legs.find((l) => l.id === "dev-bundle")!;
    expect(devLeg.status).toBe("skipped");
    expect(report.legs.filter((l) => l.status === "ok")).toHaveLength(4);
  });

  test("refuses to run on a non-interactive terminal without --yes, exit-coded via the contract error envelope", async () => {
    const { seams } = fakeSeams();
    seams.isTTY = false;
    await expect(runUpdateMachine(seams, {})).rejects.toThrow(UserActionableError);
  });

  test("non-interactive with --verify-only still runs (read-only, no confirmation needed)", async () => {
    const { seams } = fakeSeams();
    seams.isTTY = false;
    const report = await runUpdateMachine(seams, { verifyOnly: true });
    expect(report.legs[0]!.status).toBe("ok");
  });

  test("prod app: a sha256 mismatch aborts the leg before mounting or ditto-ing", async () => {
    const { seams, calls } = fakeSeams({ shaMismatch: true });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "prod-app")!;
    expect(leg.status).toBe("aborted");
    expect(leg.detail).toContain("sha256 mismatch");
    expect(calls.some((c) => c.startsWith("hdiutil attach"))).toBe(false);
    expect(calls.some((c) => c.startsWith("ditto") && c.includes("mattstack.app"))).toBe(false);
  });

  test("prod app: never launches either copy of mattstack.app", async () => {
    const { seams, calls } = fakeSeams();
    await runUpdateMachine(seams, { yes: true });
    expect(calls.some((c) => c.startsWith("open") && c.includes("mattstack.app") && !c.includes("mattstack-dev.app"))).toBe(false);
  });

  test("daemon: announces before restarting, and refuses to restart when the announce fails", async () => {
    const { seams, calls } = fakeSeams({ announceOk: false });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "daemon")!;
    expect(leg.status).toBe("aborted");
    expect(leg.detail).toContain("announce");
    expect(calls.some((c) => c === "rt daemon restart")).toBe(false);
    const announceIdx = calls.findIndex((c) => c.startsWith("announce"));
    expect(announceIdx).toBeGreaterThanOrEqual(0);
  });

  test("daemon: announce runs strictly before the restart call when it succeeds", async () => {
    const { seams, calls } = fakeSeams();
    await runUpdateMachine(seams, { yes: true });
    const announceIdx = calls.findIndex((c) => c.startsWith("announce"));
    const restartIdx = calls.findIndex((c) => c === "rt daemon restart");
    expect(announceIdx).toBeGreaterThanOrEqual(0);
    expect(restartIdx).toBeGreaterThan(announceIdx);
  });

  test("served suite: aborts and touches nothing when mattstack-apps is not on main", async () => {
    const { seams, calls } = fakeSeams({ branch: "some-feature" });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "served-suite")!;
    expect(leg.status).toBe("aborted");
    expect(leg.detail).toContain("not main");
    expect(calls.some((c) => c === "git pull")).toBe(false);
    expect(calls.some((c) => c === "deck restart --managed")).toBe(false);
  });

  test("served suite: restarts only the straggler by name and re-verifies", async () => {
    const { seams, calls } = fakeSeams({
      managed: [{ name: "board", fresh: true }, { name: "chat", fresh: false }],
    });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "served-suite")!;
    expect(leg.status).toBe("ok");
    expect(calls).toContain("deck restart chat");
    expect(calls).not.toContain("deck restart board");
  });

  test("served suite: still-stale stragglers after a retry fail the leg", async () => {
    const { seams } = fakeSeams({
      managed: [{ name: "console", fresh: false, recovers: false }],
    });
    // Retrying "console" never marks it fresh in this fake, so it stays stale.
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "served-suite")!;
    expect(leg.status).toBe("error");
    expect(leg.detail).toContain("console");
  });

  test("served suite: an unparseable ps start time counts as stale, never a silent pass", async () => {
    const { seams } = fakeSeams({
      managed: [{ name: "console", fresh: false, recovers: false, psUnparseable: true }],
    });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "served-suite")!;
    expect(leg.status).toBe("error");
    expect(leg.detail).toContain("console");
  });

  test("served suite: freshness reads the top-level pid, not a nested sub-section's", async () => {
    // The fake's launchctl print output always includes a nested "pid = 99999"
    // line inside a sub-section; a naive last-match parse would read that
    // instead of the real top-level pid and never see it change.
    const { seams } = fakeSeams();
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "served-suite")!;
    expect(leg.status).toBe("ok");
  });

  test("verify leg reports every mismatch it finds", async () => {
    const { seams } = fakeSeams({ prodVersion: "2.10.0", deckVersion: "3.0.0", daemonCommit: "deadbeef" });
    const report = await runUpdateMachine(seams, { verifyOnly: true });
    const leg = report.legs[0]!;
    expect(leg.status).toBe("error");
    expect(leg.detail).toContain("prod app is 2.10.0");
    expect(leg.detail).toContain("deck --version is 3.0.0");
    expect(leg.detail).toContain("daemon reports commit");
  });

  test("dev bundle: build failure surfaces as an error leg without opening the app", async () => {
    const { seams, calls } = fakeSeams({ buildExit: 1 });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "dev-bundle")!;
    expect(leg.status).toBe("error");
    expect(calls.some((c) => c.startsWith("open") && c.includes("mattstack-dev.app"))).toBe(false);
  });

  test("a --tag override skips the latest-release resolution", async () => {
    const { seams, calls } = fakeSeams();
    const report = await runUpdateMachine(seams, { yes: true, tag: "v9.9.9" });
    expect(report.tag).toBe("v9.9.9");
    expect(calls.some((c) => c.includes("releases/latest"))).toBe(false);
  });
});
