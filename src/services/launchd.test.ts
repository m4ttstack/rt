import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const dir = mkdtempSync(join(tmpdir(), "local-agents-"));
process.env.LOCAL_AGENTS_DIR = dir;
const { LaunchdManager } = await import("./launchd.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// launchctl itself is exercised only by the e2e smoke (LOCAL_E2E=1). Here we
// inject a recording exec so unit tests never touch real launchd.
test("install writes the plist then loads it; uninstall unloads then removes", async () => {
  const calls: string[][] = [];
  const mgr = new LaunchdManager(async (argv) => { calls.push(argv); return 0; });
  const spec = {
    label: "com.mattstack.local.t1",
    programArguments: ["/bin/echo", "hi"],
    workingDirectory: "/tmp",
    environment: { PORT: "11111" },
    stdoutPath: "/tmp/t1.out.log",
    stderrPath: "/tmp/t1.err.log",
  };
  await mgr.install(spec);
  const plist = join(dir, "com.mattstack.local.t1.plist");
  expect(existsSync(plist)).toBe(true);
  expect(readFileSync(plist, "utf8")).toContain("<string>/bin/echo</string>");
  expect(calls[0]).toEqual(["launchctl", "load", plist]);
  expect(await mgr.isInstalled("com.mattstack.local.t1")).toBe(true);

  await mgr.uninstall("com.mattstack.local.t1");
  expect(existsSync(plist)).toBe(false);
  expect(calls[1]).toEqual(["launchctl", "unload", plist]);
  expect(await mgr.isInstalled("com.mattstack.local.t1")).toBe(false);
});

test("kickstart shells the gui-domain kickstart and reports exit ok", async () => {
  const calls: string[][] = [];
  const mgr = new LaunchdManager(async (argv) => { calls.push(argv); return 0; });
  expect(await mgr.kickstart("com.mattstack.local.t1")).toBe(true);
  expect(calls[0]!.slice(0, 3)).toEqual(["launchctl", "kickstart", "-k"]);
  expect(calls[0]![3]).toMatch(/^gui\/\d+\/com\.mattstack\.local\.t1$/);
});
