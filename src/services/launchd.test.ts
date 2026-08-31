import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-agents-"));
process.env.LOCAL_AGENTS_DIR = dir;
const { LaunchdManager, readInstalledProgramArguments } = await import("./launchd.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// launchctl itself is exercised only by the e2e smoke (LOCAL_E2E=1). Here we
// inject a recording exec so unit tests never touch real launchd.
test("install writes the plist then loads it; uninstall unloads then removes", async () => {
  const calls: string[][] = [];
  const mgr = new LaunchdManager(async (argv) => { calls.push(argv); return 0; });
  const spec = {
    label: "com.mattstack.deck.t1",
    programArguments: ["/bin/echo", "hi"],
    workingDirectory: "/tmp",
    environment: { PORT: "11111" },
    stdoutPath: "/tmp/t1.out.log",
    stderrPath: "/tmp/t1.err.log",
  };
  await mgr.install(spec);
  const plist = join(dir, "com.mattstack.deck.t1.plist");
  expect(existsSync(plist)).toBe(true);
  expect(readFileSync(plist, "utf8")).toContain("<string>/bin/echo</string>");
  expect(calls[0]).toEqual(["launchctl", "load", plist]);
  expect(await mgr.isInstalled("com.mattstack.deck.t1")).toBe(true);

  await mgr.uninstall("com.mattstack.deck.t1");
  expect(existsSync(plist)).toBe(false);
  expect(calls[1]).toEqual(["launchctl", "unload", plist]);
  expect(await mgr.isInstalled("com.mattstack.deck.t1")).toBe(false);
});

test("kickstart shells the gui-domain kickstart and reports exit ok", async () => {
  const calls: string[][] = [];
  const mgr = new LaunchdManager(async (argv) => { calls.push(argv); return 0; });
  expect(await mgr.kickstart("com.mattstack.deck.t1")).toBe(true);
  expect(calls[0]!.slice(0, 3)).toEqual(["launchctl", "kickstart", "-k"]);
  expect(calls[0]![3]).toMatch(/^gui\/\d+\/com\.mattstack\.deck\.t1$/);
});

test("uninstall is a no-op success when the plist file is already gone, without shelling out at all", async () => {
  const calls: string[][] = [];
  const mgr = new LaunchdManager(async (argv) => { calls.push(argv); return 0; });
  const label = "com.mattstack.deck.already-gone";
  const plist = join(dir, `${label}.plist`);
  expect(existsSync(plist)).toBe(false); // never installed in this test
  await mgr.uninstall(label); // must not throw
  expect(calls).toEqual([]); // nothing to unload against a plist that isn't there
});

test("uninstall treats a bootout of a non-loaded label (nonzero unload exit) as success", async () => {
  const label = "com.mattstack.deck.t2";
  const failingUnload = new LaunchdManager(async (argv) => (argv[1] === "unload" ? 3 : 0));
  await failingUnload.install({
    label,
    programArguments: ["/bin/echo", "hi"],
    workingDirectory: "/tmp",
    environment: { PORT: "11112" },
    stdoutPath: "/tmp/t2.out.log",
    stderrPath: "/tmp/t2.err.log",
  });
  const plist = join(dir, `${label}.plist`);
  expect(existsSync(plist)).toBe(true);
  await failingUnload.uninstall(label); // the nonzero unload exit must not be fatal
  expect(existsSync(plist)).toBe(false); // the file still comes down
});

test("uninstall still surfaces a genuine removal failure (not just a missing file)", async () => {
  const mgr = new LaunchdManager(async () => 0);
  const label = "com.mattstack.deck.t3";
  const plist = join(dir, `${label}.plist`);
  // A directory sitting where the plist is expected can never be removed by
  // a non-recursive rm: this stands in for a real permission-denied-style
  // failure that must NOT be swallowed as though it were "already gone".
  mkdirSync(plist);
  await expect(mgr.uninstall(label)).rejects.toBeTruthy();
});

test("readInstalledProgramArguments round-trips renderPlist, escapes included", async () => {
  const testDir = mkdtempSync(join(tmpdir(), "agents-"));
  process.env.LOCAL_AGENTS_DIR = testDir;
  try {
    const manager = new LaunchdManager(async () => 0);
    const spec = {
      label: "com.mattstack.deck.chat",
      programArguments: ["/usr/bin/env", "arg<with&odd>chars", "a&lt;b", "plain"],
      workingDirectory: "/tmp", environment: {}, stdoutPath: "/tmp/o", stderrPath: "/tmp/e",
    };
    await manager.install(spec);
    expect(readInstalledProgramArguments("com.mattstack.deck.chat")).toEqual(spec.programArguments);
    expect(readInstalledProgramArguments("com.mattstack.deck.ghost")).toBeNull();
  } finally {
    rmSync(testDir, { recursive: true, force: true });
    process.env.LOCAL_AGENTS_DIR = dir;
  }
});

test("readInstalledProgramArguments returns null for an existing plist lacking ProgramArguments", async () => {
  const testDir = mkdtempSync(join(tmpdir(), "agents-"));
  process.env.LOCAL_AGENTS_DIR = testDir;
  try {
    const label = "com.mattstack.deck.no-args";
    const plistPath = join(testDir, `${label}.plist`);
    const minimalPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
</dict>
</plist>
`;
    writeFileSync(plistPath, minimalPlist);
    expect(readInstalledProgramArguments(label)).toBeNull();
  } finally {
    rmSync(testDir, { recursive: true, force: true });
    process.env.LOCAL_AGENTS_DIR = dir;
  }
});
