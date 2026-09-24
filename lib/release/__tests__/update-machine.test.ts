import { describe, expect, test } from "bun:test";
import { UserActionableError } from "../../setup/errors.ts";
import { runDevAppRebuild, runUpdateMachine, type UpdateMachineSeams } from "../update-machine.ts";

const ok = (stdout = "", exitCode = 0) => Promise.resolve({ stdout, stderr: "", exitCode });
const fail = (stderr = "boom", exitCode = 1) => Promise.resolve({ stdout: "", stderr, exitCode });

const RELEASED_SHA = "abc123def456abc123def456abc123def456abc";
const RELEASED_SHORT = RELEASED_SHA.slice(0, 9);
const TAG = "v2.11.0";
const START = new Date("2026-09-18T12:00:00.000Z");

interface Options {
  branch?: string;
  announceOk?: boolean;
  cloneExit?: number;
  checkoutExit?: number;
  fetchDepsExit?: number;
  buildExit?: number;
  killExit?: number;
  /** kill exits nonzero AND the pid is already gone (a genuine race with the process's own exit), not a real failure. */
  killRaceExit?: number;
  openExit?: number;
  shaMismatch?: boolean;
  attachExit?: number;
  attachNoMountPoint?: boolean;
  prodMvExit?: number;
  prodDittoExit?: number;
  devDittoExit?: number;
  daemonRestartExit?: number;
  pullExit?: number;
  deckRestartManagedExit?: number;
  deckListExit?: number;
  deckListBadJson?: boolean;
  depsLockMissing?: boolean;
  downloadThrows?: boolean;
  /** `fresh`: pid actually cycles on the broad `deck restart --managed`. `recovers` (default true): a targeted `deck restart <name>` retry cycles the pid when the broad restart didn't. */
  managed?: { name: string; fresh: boolean; recovers?: boolean; psUnparseable?: boolean; psTime?: "before" | "after"; settleAfterChecks?: number }[];
  daemonSourceRev?: string | null;
  deckVersion?: string;
  prodVersion?: string;
  devPidsBefore?: number[];
  devPidsAfter?: number[];
  /** Fails one exact command string. `failExactOccurrence` (1-indexed) targets a repeat of the same command; omit to fail every occurrence. */
  failExactCmd?: string;
  failExactCode?: number;
  failExactOccurrence?: number;
}

/** Real `launchctl print` has no start-time field: top-level state/pid, tab-indented, nested sub-sections repeat their own "state = active" lines. */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The real `ps -o lstart=` shape ("Thu Sep 18 09:00:00 2026") carries no zone, so
// parsePsStartTime's new Date(str) parses it in whatever timezone the runner is
// in. Building this string from START's UTC components (rather than a
// hand-written date, and rather than Date#toString's zone-bearing format) keeps
// the numbers deterministic; the full day of separation from START absorbs any
// zone the runner's parser applies, so "before"/"after" the marker stays true
// everywhere real timezones exist.
function lstartStyle(d: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} ${d.getUTCFullYear()}`;
}
const OLD_PS_TIME = lstartStyle(new Date(START.getTime() - 24 * 60 * 60 * 1000));
const NEW_PS_TIME = lstartStyle(new Date(START.getTime() + 24 * 60 * 60 * 1000));

/** The real hdiutil attach -plist shape, captured against a throwaway dmg
 *  (never a mattstack artifact): one entity per partition, each with its own
 *  dev-entry, and a mount-point only on the one actually mounted. Real entity
 *  order is filesystem-dependent (this fixture's HFS+ order happens to list
 *  the whole-disk GUID_partition_scheme entity last; APFS lists it first) --
 *  parseAttachPlist doesn't depend on the order, since any dev-entry in the
 *  attachment is a valid detach target for the whole thing. */
function attachPlistXml(mountPoint: string | null): string {
  const mountKey = mountPoint ? `\t\t\t<key>mount-point</key>\n\t\t\t<string>${mountPoint}</string>\n` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n\t<key>system-entities</key>\n\t<array>\n` +
    `\t\t<dict>\n\t\t\t<key>content-hint</key>\n\t\t\t<string>Apple_HFS</string>\n\t\t\t<key>dev-entry</key>\n\t\t\t<string>/dev/disk14s1</string>\n` +
    mountKey +
    `\t\t</dict>\n` +
    `\t\t<dict>\n\t\t\t<key>content-hint</key>\n\t\t\t<string>GUID_partition_scheme</string>\n\t\t\t<key>dev-entry</key>\n\t\t\t<string>/dev/disk14</string>\n\t\t\t<key>potentially-mountable</key>\n\t\t\t<false/>\n\t\t</dict>\n\t</array>\n</dict>\n</plist>\n`
  );
}

/** The real `rt daemon status --json` shape: `data.identity.sourceRev`, not a top-level `.commit`. */
function daemonStatusJson(sourceRev: string | null | undefined): string {
  return JSON.stringify({ ok: true, state: "running", data: { identity: { flavor: "dev", version: "2.11.0", sourceRev: sourceRev ?? null }, pid: 4242 } });
}

/** A seam set representing a fully healthy machine: every leg succeeds cleanly. */
function fakeSeams(opts: Options = {}): { seams: UpdateMachineSeams; calls: string[] } {
  const calls: string[] = [];
  const managed = opts.managed ?? [{ name: "board", fresh: true }, { name: "chat", fresh: true }];
  const pids = new Map(managed.map((m, i) => [m.name, 1000 + i]));
  let devPids = opts.devPidsBefore ?? [111];
  const devPidsAfter = opts.devPidsAfter ?? [222];
  let failExactSeen = 0;
  const psChecks = new Map<string, number>();

  const seams: UpdateMachineSeams = {
    repoRoot: "/repo",
    appsCheckoutPath: "/apps",
    workDir: "/work",
    uid: 501,
    isTTY: true,
    exec: (argv) => {
      const cmd = argv.join(" ");
      calls.push(cmd);
      if (opts.failExactCmd && cmd === opts.failExactCmd) {
        failExactSeen++;
        if (!opts.failExactOccurrence || failExactSeen === opts.failExactOccurrence) return fail("injected failure", opts.failExactCode ?? 1);
      }
      if (cmd.startsWith("gh api repos/m4ttstack/rt/releases/latest")) return ok(`${TAG}\n`);
      if (cmd.startsWith("gh api repos/m4ttstack/rt/commits/")) return ok(`${RELEASED_SHA}\n`);
      if (cmd.startsWith("shasum")) return ok(`${opts.shaMismatch ? "deadbeef" : "cafefeed"}  /work/mattstack-2.11.0.dmg\n`);
      if (cmd.startsWith("hdiutil attach")) {
        if (opts.attachExit) return fail("attach failed", opts.attachExit);
        return ok(attachPlistXml(opts.attachNoMountPoint ? null : "/Volumes/mattstack"));
      }
      if (cmd.startsWith("hdiutil detach")) return ok("");
      if (cmd === "mv /Applications/mattstack.app /Applications/mattstack.app.update-machine-old") {
        return opts.prodMvExit ? fail("mv failed", opts.prodMvExit) : ok("");
      }
      if (cmd.startsWith("ditto") && cmd.includes("/Applications/mattstack.app")) {
        return opts.prodDittoExit ? fail("ditto failed", opts.prodDittoExit) : ok("");
      }
      if (cmd.startsWith("ditto") && cmd.includes("/Applications/mattstack-dev.app")) {
        return opts.devDittoExit ? fail("ditto failed", opts.devDittoExit) : ok("");
      }
      if (cmd.startsWith("mv") || cmd.startsWith("rm -rf")) return ok("");
      if (cmd.startsWith("git clone")) return opts.cloneExit ? fail("clone failed", opts.cloneExit) : ok("");
      if (cmd.startsWith("git checkout")) return opts.checkoutExit ? fail("checkout failed", opts.checkoutExit) : ok("");
      if (cmd.startsWith("scripts/fetch-deps.sh")) return ok("", opts.fetchDepsExit ?? 0);
      if (cmd.startsWith("rt-tray/build.sh")) return ok("", opts.buildExit ?? 0);
      if (cmd.startsWith("pgrep")) return ok(devPids.length ? `${devPids.join("\n")}\n` : "");
      if (cmd.startsWith("kill")) {
        const pid = Number(argv[1]);
        if (opts.killExit) return fail("kill failed", opts.killExit);
        if (opts.killRaceExit) {
          devPids = devPids.filter((p) => p !== pid);
          return fail("No such process", opts.killRaceExit);
        }
        devPids = devPids.filter((p) => p !== pid);
        return ok("");
      }
      if (cmd.startsWith("open")) {
        if (opts.openExit) return fail("open failed", opts.openExit);
        devPids = devPidsAfter;
        return ok("");
      }
      if (cmd === "rt daemon restart") return opts.daemonRestartExit ? fail("restart failed", opts.daemonRestartExit) : ok("");
      if (cmd === "rt daemon status --json") return ok(daemonStatusJson(opts.daemonSourceRev === undefined ? RELEASED_SHORT : opts.daemonSourceRev));
      if (cmd === "git branch --show-current") return ok(`${opts.branch ?? "main"}\n`);
      if (cmd === "git pull") return opts.pullExit ? fail("pull failed", opts.pullExit) : ok("");
      if (cmd === "deck restart --managed") {
        if (opts.deckRestartManagedExit) return fail("deck restart --managed failed", opts.deckRestartManagedExit);
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
        if (opts.deckListExit) return fail("deck list failed", opts.deckListExit);
        if (opts.deckListBadJson) return ok("not json");
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
        if (row?.psUnparseable) return ok("garbage\n");
        if (row?.settleAfterChecks) {
          const seen = (psChecks.get(name!) ?? 0) + 1;
          psChecks.set(name!, seen);
          return ok(`${seen >= row.settleAfterChecks ? NEW_PS_TIME : OLD_PS_TIME}\n`);
        }
        return ok(`${row?.psTime === "after" ? NEW_PS_TIME : OLD_PS_TIME}\n`);
      }
      if (cmd === "deck --version") return ok(`${opts.deckVersion ?? "3.4.0"}\n`);
      if (cmd.includes("Info.plist")) return ok(`${opts.prodVersion ?? "2.11.0"}\n`);
      return Promise.resolve({ stdout: "", stderr: `unhandled: ${cmd}`, exitCode: 1 });
    },
    download: async (url, dest) => {
      if (opts.downloadThrows) throw new Error("fetch failed: getaddrinfo ENOTFOUND");
      calls.push(`download ${url} -> ${dest}`);
    },
    readFile: (path) => {
      calls.push(`readFile ${path}`);
      if (path.endsWith("SHA256SUMS")) return "cafefeed  mattstack-2.11.0.dmg\n";
      if (path.endsWith("deps.lock")) return opts.depsLockMissing ? null : JSON.stringify({ tools: [{ name: "deck", version: "3.4.0" }] });
      return null;
    },
    confirm: async () => true,
    announce: async (message) => {
      calls.push(`announce ${message}`);
      return opts.announceOk ?? true;
    },
    clock: () => START,
    sleep: async () => {},
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
    expect(report.haltedAfter).toBeNull();
    expect(report.tag).toBe(TAG);
  });

  test("--plan resolves and prints the legs without running any of them", async () => {
    const { seams, calls } = fakeSeams();
    const report = await runUpdateMachine(seams, { plan: true });
    expect(report.legs).toHaveLength(5);
    expect(report.legs.every((l) => l.status === "planned")).toBe(true);
    expect(report.ok).toBe(true);
    // Only the read-only tag resolution may have run; nothing state-changing did.
    for (const prefix of ["ditto", "download", "git clone", "kill", "open", "mv", "hdiutil"]) {
      expect(calls.some((c) => c.startsWith(prefix))).toBe(false);
    }
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

  test("--plan and --verify-only together are refused, never silently picking one", async () => {
    const { seams } = fakeSeams();
    await expect(runUpdateMachine(seams, { plan: true, verifyOnly: true })).rejects.toThrow(UserActionableError);
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

  test("declining a leg's confirm prompt skips just that leg; later legs still run (decline keeps skip-and-continue)", async () => {
    const { seams } = fakeSeams();
    seams.confirm = async (message) => !message.toLowerCase().includes("dev bundle");
    const report = await runUpdateMachine(seams, {});
    const devLeg = report.legs.find((l) => l.id === "dev-bundle")!;
    expect(devLeg.status).toBe("skipped");
    expect(devLeg.detail).toContain("declined");
    expect(report.legs.filter((l) => l.status === "ok")).toHaveLength(4);
    expect(report.haltedAfter).toBeNull();
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

  describe("halt-on-failure", () => {
    test("a sha256 mismatch (aborted) halts every later state-changing leg, but the verify sweep still runs and the report names the halt", async () => {
      const { seams, calls } = fakeSeams({ shaMismatch: true });
      const report = await runUpdateMachine(seams, { yes: true });
      expect(report.legs.map((l) => l.status)).toEqual(["aborted", "skipped", "skipped", "skipped", "ok"]);
      expect(report.legs[4]!.id).toBe("verify");
      expect(report.haltedAfter).toBe("prod app update");
      for (const l of report.legs.slice(1, 4)) expect(l.detail).toContain("halted after");
      expect(calls.some((c) => c === "rt daemon restart")).toBe(false);
      expect(calls.some((c) => c === "deck restart --managed")).toBe(false);
      expect(calls.some((c) => c.startsWith("git clone"))).toBe(false);
    });

    test("an error leg (not just aborted) also halts every later state-changing leg", async () => {
      const { seams } = fakeSeams({ buildExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const [prodLeg, devLeg, daemonLeg, suiteLeg] = report.legs;
      expect(prodLeg!.status).toBe("ok");
      expect(devLeg!.status).toBe("error");
      expect(daemonLeg!.status).toBe("skipped");
      expect(suiteLeg!.status).toBe("skipped");
      expect(report.haltedAfter).toBe("dev bundle rebuild");
    });
  });

  describe("hdiutil attach", () => {
    test("prod app: parses the real -plist output (no -quiet) and detaches the mount point after a successful replace", async () => {
      const { seams, calls } = fakeSeams();
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "prod-app")!;
      expect(leg.status).toBe("ok");
      const attachCall = calls.find((c) => c.startsWith("hdiutil attach"))!;
      expect(attachCall).toContain("-plist");
      expect(attachCall).not.toContain("-quiet");
      expect(calls.some((c) => c === "ditto /Volumes/mattstack/mattstack.app /Applications/mattstack.app")).toBe(true);
      expect(calls.some((c) => c.startsWith("hdiutil detach /Volumes/mattstack"))).toBe(true);
    });

    test("prod app: a nonzero attach exit code fails the leg and never tries to detach", async () => {
      const { seams, calls } = fakeSeams({ attachExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "prod-app")!;
      expect(leg.status).toBe("error");
      expect(calls.some((c) => c.startsWith("hdiutil detach"))).toBe(false);
    });

    test("prod app: attach succeeds but the plist names no mount point still detaches, by device", async () => {
      const { seams, calls } = fakeSeams({ attachNoMountPoint: true });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "prod-app")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("no mount point");
      expect(calls.some((c) => c === "hdiutil detach /dev/disk14 -quiet")).toBe(true);
      expect(calls.some((c) => c.startsWith("ditto"))).toBe(false);
    });
  });

  describe("replace semantics (move-aside + ditto + rollback)", () => {
    test("prod app: a stale aside from a prior failed run is cleared before the initial move, not merged into", async () => {
      const { seams, calls } = fakeSeams();
      await runUpdateMachine(seams, { yes: true });
      const clearIdx = calls.indexOf("rm -rf /Applications/mattstack.app.update-machine-old");
      const mvIdx = calls.indexOf("mv /Applications/mattstack.app /Applications/mattstack.app.update-machine-old");
      expect(clearIdx).toBeGreaterThanOrEqual(0);
      expect(mvIdx).toBeGreaterThan(clearIdx);
    });

    test("prod app: a failed clear of a stale aside fails the leg before ever moving the current app", async () => {
      const { seams, calls } = fakeSeams({ failExactCmd: "rm -rf /Applications/mattstack.app.update-machine-old" });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "prod-app")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("stale aside");
      expect(calls.some((c) => c.startsWith("mv"))).toBe(false);
    });

    test("prod app: a ditto failure clears the broken destination before rolling back, instead of nesting into it", async () => {
      const { seams, calls } = fakeSeams({ prodDittoExit: 1 });
      await runUpdateMachine(seams, { yes: true });
      const dittoIdx = calls.findIndex((c) => c.startsWith("ditto") && c.includes("mattstack.app"));
      const clearDestIdx = calls.indexOf("rm -rf /Applications/mattstack.app");
      const rollbackIdx = calls.indexOf("mv /Applications/mattstack.app.update-machine-old /Applications/mattstack.app");
      expect(dittoIdx).toBeGreaterThanOrEqual(0);
      expect(clearDestIdx).toBeGreaterThan(dittoIdx);
      expect(rollbackIdx).toBeGreaterThan(clearDestIdx);
    });

    test("prod app: a failed cleanup of the aside copy after a successful replace still fails the leg", async () => {
      const { seams } = fakeSeams({
        failExactCmd: "rm -rf /Applications/mattstack.app.update-machine-old",
        failExactOccurrence: 2,
      });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "prod-app")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("aside copy");
    });

    test("prod app: a failed mv-aside fails the leg without ever ditto-ing, and still detaches", async () => {
      const { seams, calls } = fakeSeams({ prodMvExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "prod-app")!;
      expect(leg.status).toBe("error");
      expect(calls.some((c) => c.startsWith("ditto"))).toBe(false);
      expect(calls.some((c) => c.startsWith("hdiutil detach"))).toBe(true);
    });

    test("prod app: a failed ditto restores the previous app from the aside copy and still detaches", async () => {
      const { seams, calls } = fakeSeams({ prodDittoExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "prod-app")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("restored");
      expect(calls).toContain("mv /Applications/mattstack.app.update-machine-old /Applications/mattstack.app");
      expect(calls.some((c) => c.startsWith("hdiutil detach"))).toBe(true);
    });

    test("dev bundle: a failed ditto restores the previous bundle instead of leaving a merged mess", async () => {
      const { seams, calls } = fakeSeams({ devDittoExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "dev-bundle")!;
      expect(leg.status).toBe("error");
      expect(calls).toContain("mv /Applications/mattstack-dev.app.update-machine-old /Applications/mattstack-dev.app");
      expect(calls.some((c) => c.startsWith("open"))).toBe(false);
    });
  });

  test("a thrown download (transient 404, no timeout) is caught into an error leg, not an uncaught crash", async () => {
    const { seams } = fakeSeams({ downloadThrows: true });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "prod-app")!;
    expect(leg.status).toBe("error");
    expect(leg.detail).toContain("download failed");
  });

  test("prod app: never launches either copy of mattstack.app", async () => {
    const { seams, calls } = fakeSeams();
    await runUpdateMachine(seams, { yes: true });
    expect(calls.some((c) => c.startsWith("open") && c.includes("mattstack.app") && !c.includes("mattstack-dev.app"))).toBe(false);
  });

  describe("dev app process handling", () => {
    test("kills every matching pid, waits for exit, and relaunches with a fresh pid", async () => {
      const { seams, calls } = fakeSeams({ devPidsBefore: [111, 222], devPidsAfter: [333] });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "dev-bundle")!;
      expect(leg.status).toBe("ok");
      expect(calls).toContain("kill 111");
      expect(calls).toContain("kill 222");
      expect(leg.detail).toContain("pid 333");
    });

    test("a kill that fails to land fails the leg rather than proceeding to ditto over a live process", async () => {
      const { seams, calls } = fakeSeams({ killExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "dev-bundle")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("kill");
      expect(calls.some((c) => c.startsWith("ditto") && c.includes("mattstack-dev.app"))).toBe(false);
    });

    test("a kill that races the process's own exit (ESRCH) is tolerated, not an error", async () => {
      const { seams } = fakeSeams({ killRaceExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "dev-bundle")!;
      expect(leg.status).toBe("ok");
    });
  });

  test("dev bundle: build failure surfaces as an error leg without opening the app", async () => {
    const { seams, calls } = fakeSeams({ buildExit: 1 });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "dev-bundle")!;
    expect(leg.status).toBe("error");
    expect(calls.some((c) => c.startsWith("open") && c.includes("mattstack-dev.app"))).toBe(false);
  });

  describe("mutating exec exit codes", () => {
    const cases: { label: string; opt: keyof Options; legId: string }[] = [
      { label: "dev git clone", opt: "cloneExit", legId: "dev-bundle" },
      { label: "dev git checkout", opt: "checkoutExit", legId: "dev-bundle" },
      { label: "daemon restart", opt: "daemonRestartExit", legId: "daemon" },
      { label: "served git pull", opt: "pullExit", legId: "served-suite" },
      { label: "served deck restart --managed", opt: "deckRestartManagedExit", legId: "served-suite" },
    ];
    for (const { label, opt, legId } of cases) {
      test(`a failed ${label} fails its leg instead of reporting ok`, async () => {
        const { seams } = fakeSeams({ [opt]: 1 } as Options);
        const report = await runUpdateMachine(seams, { yes: true });
        const leg = report.legs.find((l) => l.id === legId)!;
        expect(leg.status).toBe("error");
      });
    }

    test("a failed targeted `deck restart <app>` straggler retry fails the leg", async () => {
      const { seams } = fakeSeams({ managed: [{ name: "chat", fresh: false }] });
      seams.exec = wrapExecFailingTargetedRestart(seams.exec);
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "served-suite")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("deck restart chat failed");
    });
  });

  describe("daemon source rev", () => {
    test("reads data.identity.sourceRev, not a fictional top-level .commit field", async () => {
      const { seams } = fakeSeams({ daemonSourceRev: RELEASED_SHORT });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "daemon")!;
      expect(leg.status).toBe("ok");
      expect(leg.detail).toContain(RELEASED_SHORT);
    });

    test("a null sourceRev (prod daemon) fails the leg with that detail, never a silent pass", async () => {
      const { seams } = fakeSeams({ daemonSourceRev: null });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "daemon")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("no source rev");
    });

    test("mutual-prefix compare matches either abbreviation direction", async () => {
      // Direction A: sourceRev (git rev-parse --short) is a prefix of the full target sha.
      const short = fakeSeams({ daemonSourceRev: RELEASED_SHA.slice(0, 8) }).seams;
      expect((await runUpdateMachine(short, { yes: true })).legs.find((l) => l.id === "daemon")!.status).toBe("ok");

      // Direction B: the full target sha is a prefix of a (contrived) longer sourceRev.
      const longer = fakeSeams({ daemonSourceRev: `${RELEASED_SHA}00` }).seams;
      expect((await runUpdateMachine(longer, { yes: true })).legs.find((l) => l.id === "daemon")!.status).toBe("ok");

      // Neither prefixes the other: a genuine mismatch still fails.
      const mismatch = fakeSeams({ daemonSourceRev: "deadbeef" }).seams;
      expect((await runUpdateMachine(mismatch, { yes: true })).legs.find((l) => l.id === "daemon")!.status).toBe("error");
    });

    test("verify leg also reads sourceRev via the mutual-prefix rule", async () => {
      const { seams } = fakeSeams({ daemonSourceRev: RELEASED_SHORT });
      const report = await runUpdateMachine(seams, { verifyOnly: true });
      expect(report.legs[0]!.status).toBe("ok");
    });
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

  test("served suite: polls for freshness instead of failing an app that is still mid-relaunch", async () => {
    const { seams, calls } = fakeSeams({
      managed: [{ name: "chat", fresh: false, recovers: false, settleAfterChecks: 3 }],
    });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "served-suite")!;
    expect(leg.status).toBe("ok");
    // It only needed time to come up, never a targeted restart.
    expect(calls.some((c) => c.startsWith("deck restart ") && c !== "deck restart --managed")).toBe(false);
  });

  test("served suite: still-stale stragglers after a retry fail the leg", async () => {
    const { seams } = fakeSeams({
      managed: [{ name: "console", fresh: false, recovers: false }],
    });
    const report = await runUpdateMachine(seams, { yes: true });
    const leg = report.legs.find((l) => l.id === "served-suite")!;
    expect(leg.status).toBe("error");
    expect(leg.detail).toContain("console");
  });

  describe("ps-lstart freshness, both directions", () => {
    test("an unparseable ps start time counts as stale, never a silent pass", async () => {
      const { seams } = fakeSeams({
        managed: [{ name: "console", fresh: false, recovers: false, psUnparseable: true }],
      });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "served-suite")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("console");
    });

    test("a same pid whose start time postdates the marker reads fresh", async () => {
      const { seams } = fakeSeams({
        managed: [{ name: "chat", fresh: false, recovers: false, psTime: "after" }],
      });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "served-suite")!;
      expect(leg.status).toBe("ok");
    });
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

  describe("deck list --json fails closed", () => {
    test("served suite: a nonzero deck list --json exit fails the leg instead of reporting every pid cycled", async () => {
      const { seams } = fakeSeams({ deckListExit: 1 });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "served-suite")!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("deck list");
    });

    test("served suite: unparseable deck list --json output fails the leg", async () => {
      const { seams } = fakeSeams({ deckListBadJson: true });
      const report = await runUpdateMachine(seams, { yes: true });
      const leg = report.legs.find((l) => l.id === "served-suite")!;
      expect(leg.status).toBe("error");
    });

    test("verify leg: a failing deck list --json is reported as a problem, not skipped silently", async () => {
      const { seams } = fakeSeams({ managed: [{ name: "board", fresh: true }] });
      // Let the served-suite leg's own deck list --json call succeed so it captures a
      // witness; only the verify leg's re-check call fails.
      seams.exec = wrapExecAllowFirstDeckList(seams.exec);
      const report = await runUpdateMachine(seams, { yes: true });
      const verifyLeg = report.legs.find((l) => l.id === "verify")!;
      expect(verifyLeg.status).toBe("error");
      expect(verifyLeg.detail).toContain("deck list");
    });
  });

  describe("a missing deps.lock is an error, never a silent skip", () => {
    test("verify leg: an unreadable deps.lock is reported, not skipped", async () => {
      const { seams } = fakeSeams({ depsLockMissing: true });
      const report = await runUpdateMachine(seams, { verifyOnly: true });
      const leg = report.legs[0]!;
      expect(leg.status).toBe("error");
      expect(leg.detail).toContain("deps.lock not readable");
      expect(leg.detail).toContain("rt checkout");
    });
  });

  test("verify leg reports every mismatch it finds", async () => {
    const { seams } = fakeSeams({ prodVersion: "2.10.0", deckVersion: "3.0.0", daemonSourceRev: "deadbeef" });
    const report = await runUpdateMachine(seams, { verifyOnly: true });
    const leg = report.legs[0]!;
    expect(leg.status).toBe("error");
    expect(leg.detail).toContain("prod app is 2.10.0");
    expect(leg.detail).toContain("deck --version is 3.0.0");
    expect(leg.detail).toContain("daemon reports source rev");
  });

  test("a --tag override skips the latest-release resolution", async () => {
    const { seams, calls } = fakeSeams();
    const report = await runUpdateMachine(seams, { yes: true, tag: "v9.9.9" });
    expect(report.tag).toBe("v9.9.9");
    expect(calls.some((c) => c.includes("releases/latest"))).toBe(false);
  });

  test("a malformed --tag is refused before it ever reaches a URL or path", async () => {
    const { seams, calls } = fakeSeams();
    await expect(runUpdateMachine(seams, { yes: true, tag: "latest" })).rejects.toThrow(UserActionableError);
    expect(calls.some((c) => c.includes("latest"))).toBe(false);
  });

  test("a --tag shape that could break out of a URL or path segment is refused", async () => {
    const { seams, calls } = fakeSeams();
    await expect(runUpdateMachine(seams, { yes: true, tag: "v1.0.0/../../etc" })).rejects.toThrow(UserActionableError);
    expect(calls.some((c) => c.includes("etc"))).toBe(false);
  });

  describe("resolveTag and resolveCommit exit codes", () => {
    test("a failed gh api releases/latest call raises a UserActionableError, not a bare crash", async () => {
      const { seams } = fakeSeams();
      seams.exec = wrapExecFailing(seams.exec, "releases/latest");
      await expect(runUpdateMachine(seams, { yes: true })).rejects.toThrow(UserActionableError);
    });

    test("a failed gh api commits/<tag> call raises a UserActionableError, not a bare crash", async () => {
      const { seams } = fakeSeams();
      seams.exec = wrapExecFailing(seams.exec, "commits/");
      await expect(runUpdateMachine(seams, { yes: true })).rejects.toThrow(UserActionableError);
    });
  });
});

describe("runDevAppRebuild", () => {
  test("resolves the ref and runs only the dev-bundle leg at that sha", async () => {
    const { seams, calls } = fakeSeams();
    const { sha, result } = await runDevAppRebuild(seams, "main");
    expect(sha).toBe(RELEASED_SHA);
    expect(result.id).toBe("dev-bundle");
    expect(result.status).toBe("ok");
    expect(calls).toContain("gh api repos/m4ttstack/rt/commits/main --jq .sha");
    expect(calls).toContain(`git checkout ${RELEASED_SHA}`);
    expect(calls.some((c) => c.startsWith("rt-tray/build.sh dev"))).toBe(true);
    expect(calls.some((c) => c.includes("/Applications/mattstack.app"))).toBe(false);
    expect(calls.some((c) => c.startsWith("rt daemon") || c.startsWith("deck "))).toBe(false);
  });

  test("a failed build is an error leg, and the running app is never touched", async () => {
    const { seams, calls } = fakeSeams({ buildExit: 1 });
    const { result } = await runDevAppRebuild(seams, "main");
    expect(result.status).toBe("error");
    expect(calls.some((c) => c.startsWith("kill") || c.startsWith("mv") || c.startsWith("ditto"))).toBe(false);
  });

  test("a ref that could break out of the URL path or read as a flag is refused before any call", async () => {
    for (const bad of ["../../etc", "-rf", "main branch", ""]) {
      const { seams, calls } = fakeSeams();
      await expect(runDevAppRebuild(seams, bad)).rejects.toThrow(UserActionableError);
      expect(calls).toEqual([]);
    }
  });
});

// --- Small exec-wrapping helpers for tests that need to fail exactly one call. ---

function wrapExecFailing(
  inner: UpdateMachineSeams["exec"],
  matchSubstring: string,
): UpdateMachineSeams["exec"] {
  return (argv, opts) => {
    if (argv.join(" ").includes(matchSubstring)) return Promise.resolve({ stdout: "", stderr: "gh: not found", exitCode: 1 });
    return inner(argv, opts);
  };
}

function wrapExecFailingTargetedRestart(inner: UpdateMachineSeams["exec"]): UpdateMachineSeams["exec"] {
  return (argv, opts) => {
    const cmd = argv.join(" ");
    if (cmd.startsWith("deck restart ") && cmd !== "deck restart --managed") {
      return Promise.resolve({ stdout: "", stderr: "socket blip", exitCode: 1 });
    }
    return inner(argv, opts);
  };
}

/** Lets the served-suite leg's deck list --json calls succeed, but fails it once the verify leg re-checks (its second overall invocation onward). */
function wrapExecAllowFirstDeckList(inner: UpdateMachineSeams["exec"]): UpdateMachineSeams["exec"] {
  let seen = 0;
  return (argv, opts) => {
    const cmd = argv.join(" ");
    if (cmd === "deck list --json") {
      seen++;
      if (seen > 1) return Promise.resolve({ stdout: "", stderr: "daemon gone", exitCode: 1 });
    }
    return inner(argv, opts);
  };
}
