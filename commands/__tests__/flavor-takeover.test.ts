/**
 * `rt flavor takeover <dev|prod>`: the work an app does when opened by hand.
 *
 * osascript/pkill/launchctl/open are PATH-prepended fakes that only log, so
 * nothing here quits an app or touches launchd; spawnSync must forward
 * `env: process.env` for Bun to honor the runtime PATH. The tray socket is a
 * real Bun.serve bound at TRAY_SOCK_PATH inside the isolated test HOME, and
 * `exists` denies the real /Applications so a machine's own installs never
 * decide an outcome.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readlinkSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { flavorTakeover, type TakeoverSeams } from "../flavor.ts";
import { TRAY_SOCK_PATH } from "../../lib/daemon-config.ts";
import { DEV_TRAY_APP_NAME, TRAY_APP_BUNDLE, TRAY_APP_NAME } from "../../lib/rt-paths.ts";
import { deleteKvValue, getKvValue, hasKvValue } from "../../lib/state/index.ts";

const HOME = process.env.HOME!;
const WRAPPER_PATH = join(HOME, ".local", "bin", "rt");
const PRELOAD = join(HOME, ".mattstack", "rt", "dev-restore-cwd.ts");
const FAKE_PROD_APP = join(HOME, "Applications", TRAY_APP_BUNDLE);
const FAKE_PROD_RT = join(FAKE_PROD_APP, "Contents", "MacOS", "rt");
const HAND_DECK_PLIST = join(HOME, "Library", "LaunchAgents", "com.mattstack.deck.plist");
const UID = process.getuid?.() ?? 501;
/** What standalone rt 2.5.x left at ~/.local/bin/rt: no marker line, no RT_LAUNCH_CWD. */
const STANDALONE_25_WRAPPER = `#!/bin/zsh\nexec "/Users/someone/.bun/bin/bun" run "/Users/someone/repo-tools/cli.ts" "$@"\n`;
const LEGACY_DEV_CONFIG = JSON.stringify({ sourcePath: "/Users/someone/repo-tools", bunPath: "/Users/someone/.bun/bin/bun" });
const LEGACY_DEV_CONFIGS = [join(HOME, ".rt", "dev-mode.json"), join(HOME, ".mattstack", "rt", "dev-mode.json")];

let fakeBinDir = "";
let logPath = "";
let originalPath = "";
let originalShell: string | undefined;
let server: ReturnType<typeof Bun.serve> | null = null;
let sourceDir = "";

function isolatedExists(path: string): boolean {
  return path.startsWith("/Applications/") ? false : existsSync(path);
}

function writeFake(name: string, body: string): void {
  const p = join(fakeBinDir, name);
  writeFileSync(p, body, { mode: 0o755 });
  chmodSync(p, 0o755);
}

function readLog(): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

/** The one-shot steps in call order; `launchctl list` polling is noise. */
function steps(): string[] {
  return readLog().filter((l) => !l.startsWith("launchctl list"));
}

/**
 * `launchctl list <label>` answers registered until `bootout` (or a
 * successful /flavor/retire, for the holder's own daemon label) unloads it.
 * `loaded` names the labels that start out registered.
 */
function setUpFakes(loaded: string[]): void {
  fakeBinDir = mkdtempSync(join(tmpdir(), "rt-takeover-fakebin-"));
  logPath = join(fakeBinDir, "calls.log");
  const state = join(fakeBinDir, "loaded");
  mkdirSync(state);
  for (const label of loaded) writeFileSync(join(state, label), "");

  writeFake("osascript", `#!/bin/sh\necho "osascript $*" >> "${logPath}"\nexit 0\n`);
  writeFake("pkill", `#!/bin/sh\necho "pkill $*" >> "${logPath}"\nexit 0\n`);
  writeFake("open", `#!/bin/sh\necho "open $*" >> "${logPath}"\nexit 0\n`);
  writeFake(
    "launchctl",
    [
      "#!/bin/sh",
      `echo "launchctl $*" >> "${logPath}"`,
      `case "$1" in`,
      `  list) if [ -f "${state}/$2" ]; then echo '{ "PID" = 1; };'; exit 0; fi; echo "Could not find service" 1>&2; exit 113 ;;`,
      `  bootout) rm -f "${state}/$(basename "$2")"; exit 0 ;;`,
      `  print) exit 113 ;;`,
      `esac`,
      `exit 0`,
      "",
    ].join("\n"),
  );

  originalPath = process.env.PATH ?? "";
  process.env.PATH = `${fakeBinDir}:${originalPath}`;
  // An unrecognised shell makes installShellIntegration a no-op.
  originalShell = process.env.SHELL;
  process.env.SHELL = "/bin/nonexistent-shell-for-tests";
  mkdirSync(join(HOME, ".mattstack", "rt"), { recursive: true });
}

/** A tray answering /health as `flavor`; a retire unloads its daemon label and closes the socket shortly after. */
function serveTray(flavor: "dev" | "prod" | null): void {
  try { rmSync(TRAY_SOCK_PATH); } catch { /* absent */ }
  const label = flavor === "dev" ? "com.mattstack.daemon.dev" : "com.mattstack.daemon";
  server = Bun.serve({
    unix: TRAY_SOCK_PATH,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === "/flavor/retire") {
        appendFileSync(logPath, "retire\n");
        rmSync(join(fakeBinDir, "loaded", label), { force: true });
        const s = server;
        setTimeout(() => { try { s?.stop(true); } catch { /* already stopped */ } }, 100);
        return Response.json({ ok: true });
      }
      if (url.pathname === "/health") return Response.json(flavor ? { ok: true, app: "mattstack", flavor } : { ok: true });
      return new Response("not found", { status: 404 });
    },
  });
}

function installProdApp(): void {
  mkdirSync(dirname(FAKE_PROD_RT), { recursive: true });
  writeFileSync(FAKE_PROD_RT, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00]), { mode: 0o755 });
}

function devSource(): string {
  sourceDir = mkdtempSync(join(tmpdir(), "rt-takeover-src-"));
  writeFileSync(join(sourceDir, "cli.ts"), "");
  return sourceDir;
}

interface Run {
  out: string[];
  err: string[];
  exitCode: number | null;
}

async function run(args: string[], seams: Partial<TakeoverSeams> = {}): Promise<Run> {
  const r: Run = { out: [], err: [], exitCode: null };
  await flavorTakeover(args, {}, {
    exists: isolatedExists,
    resolveSourcePath: () => null,
    ownProdBundle: () => null,
    log: (l) => r.out.push(l),
    error: (l) => r.err.push(l),
    exit: ((code: number) => { r.exitCode = code; }) as unknown as (code: number) => never,
    ...seams,
  });
  return r;
}

afterEach(() => {
  try { server?.stop(true); } catch { /* already stopped */ }
  server = null;
  if (originalPath) process.env.PATH = originalPath;
  if (originalShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = originalShell;
  for (const p of [fakeBinDir, sourceDir, FAKE_PROD_APP, dirname(HAND_DECK_PLIST), join(HOME, ".mattstack", "deck")]) {
    if (p) rmSync(p, { recursive: true, force: true });
  }
  for (const p of [WRAPPER_PATH, PRELOAD, TRAY_SOCK_PATH, ...LEGACY_DEV_CONFIGS]) rmSync(p, { force: true });
  try { deleteKvValue("dev-mode", "config"); } catch { /* never opened */ }
});

describe("rt flavor takeover", () => {
  test("dev over a running prod app: retire, quit by prod's names, then the source wrapper; nothing is opened", async () => {
    setUpFakes(["com.mattstack.daemon"]);
    serveTray("prod");
    const src = devSource();

    const r = await run(["dev"], { resolveSourcePath: () => src });

    expect(r.exitCode).toBeNull();
    expect(steps()).toEqual([
      "retire",
      `osascript -e tell application "${TRAY_APP_NAME}" to quit`,
      `pkill -x ${TRAY_APP_NAME}`,
    ]);
    const wrapper = readFileSync(WRAPPER_PATH, "utf8");
    expect(wrapper).toContain("export MATTSTACK_FLAVOR=dev");
    expect(wrapper).toContain(`"${src}/cli.ts"`);
    expect(getKvValue<{ sourcePath?: string }>("dev-mode", "config", {}).sourcePath).toBe(src);
  }, 15_000);

  test("prod over a running dev app: quits by the dev names and links the bundled rt", async () => {
    setUpFakes(["com.mattstack.daemon.dev"]);
    serveTray("dev");
    installProdApp();
    mkdirSync(dirname(WRAPPER_PATH), { recursive: true });
    writeFileSync(WRAPPER_PATH, "#!/bin/zsh\n# mattstack-dev-mode\nexit 0\n", { mode: 0o755 });
    writeFileSync(PRELOAD, "export {};\n");

    const r = await run(["prod"]);

    expect(r.exitCode).toBeNull();
    expect(steps()).toEqual([
      "retire",
      `osascript -e tell application "${DEV_TRAY_APP_NAME}" to quit`,
      `pkill -x ${DEV_TRAY_APP_NAME}`,
    ]);
    expect(lstatSync(WRAPPER_PATH).isSymbolicLink()).toBe(true);
    expect(readlinkSync(WRAPPER_PATH)).toBe(FAKE_PROD_RT);
    expect(existsSync(PRELOAD)).toBe(false);
  }, 15_000);

  test("the other app not running: its still-loaded jobs are booted out, and no quit is sent to it by AppleScript", async () => {
    setUpFakes(["com.mattstack.daemon", "com.mattstack.deck"]);
    const src = devSource();

    const r = await run(["dev"], { resolveSourcePath: () => src });

    expect(r.exitCode).toBeNull();
    const s = steps();
    expect(s).not.toContain("retire");
    expect(s.some((l) => l.startsWith("osascript"))).toBe(false);
    expect(s).toContain(`launchctl bootout gui/${UID}/com.mattstack.daemon`);
    expect(s).toContain(`launchctl bootout gui/${UID}/com.mattstack.deck`);
    expect(s.some((l) => l.includes("com.mattstack.daemon.dev") || l.includes("com.mattstack.deck.dev"))).toBe(false);
  }, 15_000);

  test("the target's own tray holding the socket is never retired or quit", async () => {
    setUpFakes([]);
    serveTray("dev");
    const src = devSource();

    const r = await run(["dev"], { resolveSourcePath: () => src });

    expect(r.exitCode).toBeNull();
    expect(steps()).not.toContain("retire");
    expect(steps().some((l) => l.includes(`"${DEV_TRAY_APP_NAME}"`) || l === `pkill -x ${DEV_TRAY_APP_NAME}`)).toBe(false);
  }, 15_000);

  test("a failed retire boots the other daemon out directly", async () => {
    setUpFakes(["com.mattstack.daemon"]);
    try { rmSync(TRAY_SOCK_PATH); } catch { /* absent */ }
    server = Bun.serve({
      unix: TRAY_SOCK_PATH,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") return Response.json({ ok: true, app: "mattstack", flavor: "prod" });
        appendFileSync(logPath, "retire-refused\n");
        return Response.json({ ok: false, error: "nope" }, { status: 500 });
      },
    });
    const src = devSource();

    await run(["dev"], { resolveSourcePath: () => src });

    const s = steps();
    expect(s.indexOf("retire-refused")).toBeGreaterThan(-1);
    expect(s).toContain(`launchctl bootout gui/${UID}/com.mattstack.daemon`);
  }, 15_000);

  test("a retire that takes longer than a quick request is waited for, not booted out from under", async () => {
    setUpFakes(["com.mattstack.daemon"]);
    try { rmSync(TRAY_SOCK_PATH); } catch { /* absent */ }
    server = Bun.serve({
      unix: TRAY_SOCK_PATH,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") return Response.json({ ok: true, app: "mattstack", flavor: "prod" });
        await Bun.sleep(2_600);
        appendFileSync(logPath, "retire\n");
        rmSync(join(fakeBinDir, "loaded", "com.mattstack.daemon"), { force: true });
        const s = server;
        setTimeout(() => { try { s?.stop(true); } catch { /* already stopped */ } }, 100);
        return Response.json({ ok: true });
      },
    });
    const src = devSource();

    const r = await run(["dev", "--json"], { resolveSourcePath: () => src });

    expect(JSON.parse(r.out.join("\n")).retired).toBe(true);
    expect(steps().some((l) => l.startsWith("launchctl bootout"))).toBe(false);
  }, 20_000);

  test("dev with no known source checkout refuses before touching anything", async () => {
    setUpFakes(["com.mattstack.daemon"]);
    serveTray("prod");

    const r = await run(["dev", "--json"]);

    expect(r.exitCode).toBe(2);
    expect(JSON.parse(r.out.join("\n")).error.code).toBe("no-source-path");
    expect(steps()).toEqual([]);
    expect(existsSync(WRAPPER_PATH)).toBe(false);
  }, 15_000);

  test("prod with no prod app installed refuses and leaves the dev wrapper in place", async () => {
    setUpFakes(["com.mattstack.daemon.dev"]);
    serveTray("dev");
    mkdirSync(dirname(WRAPPER_PATH), { recursive: true });
    writeFileSync(WRAPPER_PATH, "#!/bin/zsh\n# mattstack-dev-mode\nexit 0\n", { mode: 0o755 });

    const r = await run(["prod"]);

    expect(r.exitCode).toBe(2);
    expect(steps()).toEqual([]);
    expect(readFileSync(WRAPPER_PATH, "utf8")).toContain("mattstack-dev-mode");
  }, 15_000);

  test("prod over a standalone rt 2.5.x machine: its markerless source wrapper is replaced, and no dev-mode.json is read", async () => {
    setUpFakes([]);
    installProdApp();
    mkdirSync(dirname(WRAPPER_PATH), { recursive: true });
    writeFileSync(WRAPPER_PATH, STANDALONE_25_WRAPPER, { mode: 0o755 });
    for (const p of LEGACY_DEV_CONFIGS) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, LEGACY_DEV_CONFIG);
    }

    const r = await run(["prod"]);

    expect(r.exitCode).toBeNull();
    expect(lstatSync(WRAPPER_PATH).isSymbolicLink()).toBe(true);
    expect(readlinkSync(WRAPPER_PATH)).toBe(FAKE_PROD_RT);
    for (const p of LEGACY_DEV_CONFIGS) expect(readFileSync(p, "utf8")).toBe(LEGACY_DEV_CONFIG);
    expect(hasKvValue("dev-mode", "config")).toBe(false);
  }, 15_000);

  test("dev over a foreign ~/.local/bin/rt: replaced by the marked source wrapper", async () => {
    setUpFakes([]);
    mkdirSync(dirname(WRAPPER_PATH), { recursive: true });
    writeFileSync(WRAPPER_PATH, STANDALONE_25_WRAPPER, { mode: 0o755 });
    const src = devSource();

    const r = await run(["dev"], { resolveSourcePath: () => src });

    expect(r.exitCode).toBeNull();
    const wrapper = readFileSync(WRAPPER_PATH, "utf8");
    expect(wrapper.split("\n")[1]).toBe("# mattstack-dev-mode");
    expect(wrapper).toContain(`"${src}/cli.ts"`);
  }, 15_000);

  test("prod run from the prod app's own bundle links that bundle, wherever it lives", async () => {
    setUpFakes([]);
    const elsewhere = join(HOME, "Downloads", TRAY_APP_BUNDLE);
    const elsewhereRt = join(elsewhere, "Contents", "MacOS", "rt");
    mkdirSync(dirname(elsewhereRt), { recursive: true });
    writeFileSync(elsewhereRt, Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), { mode: 0o755 });

    try {
      const r = await run(["prod"], { ownProdBundle: () => elsewhere });

      expect(r.exitCode).toBeNull();
      expect(readlinkSync(WRAPPER_PATH)).toBe(elsewhereRt);
    } finally {
      rmSync(join(HOME, "Downloads"), { recursive: true, force: true });
    }
  }, 15_000);

  test("a local write that fails refuses before the other app is retired", async () => {
    setUpFakes(["com.mattstack.daemon"]);
    serveTray("prod");
    const src = devSource();
    const localBin = dirname(WRAPPER_PATH);
    rmSync(localBin, { recursive: true, force: true });
    writeFileSync(localBin, "not a directory");

    try {
      const r = await run(["dev", "--json"], { resolveSourcePath: () => src });

      expect(r.exitCode).toBe(2);
      expect(JSON.parse(r.out.join("\n")).error.code).toBe("local-write");
      expect(steps()).toEqual([]);
    } finally {
      rmSync(localBin, { force: true });
    }
  }, 15_000);

  test("a missing or unknown target is a usage error", async () => {
    setUpFakes([]);
    expect((await run([])).exitCode).toBe(2);
    expect((await run(["staging"])).exitCode).toBe(2);
    expect(steps()).toEqual([]);
  });

  test("a loaded hand-installed deck agent is retired and archived", async () => {
    setUpFakes([]);
    mkdirSync(dirname(HAND_DECK_PLIST), { recursive: true });
    writeFileSync(HAND_DECK_PLIST, "<plist/>");
    writeFake(
      "launchctl",
      [
        "#!/bin/sh",
        `echo "launchctl $*" >> "${logPath}"`,
        `if [ "$1" = "print" ] && [ "$2" = "gui/${UID}/com.mattstack.deck" ]; then printf '\\tpath = %s\\n' "${HAND_DECK_PLIST}"; exit 0; fi`,
        `if [ "$1" = "list" ]; then echo "Could not find service" 1>&2; exit 113; fi`,
        `exit 0`,
        "",
      ].join("\n"),
    );
    const src = devSource();

    await run(["dev"], { resolveSourcePath: () => src });

    expect(steps()).toContain(`launchctl bootout gui/${UID}/com.mattstack.deck`);
    expect(existsSync(HAND_DECK_PLIST)).toBe(false);
  }, 15_000);

  test("--json reports what was done", async () => {
    setUpFakes(["com.mattstack.daemon"]);
    serveTray("prod");
    const src = devSource();

    const r = await run(["dev", "--json"], { resolveSourcePath: () => src });

    const body = JSON.parse(r.out.join("\n"));
    expect(body).toMatchObject({ ok: true, flavor: "dev", retired: true, rt: WRAPPER_PATH });
  }, 15_000);
});
