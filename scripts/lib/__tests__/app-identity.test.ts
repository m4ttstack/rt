import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { parseDepsLock } from "../../../lib/bundle-layout.ts";
import {
  checkIdentities,
  iconSegments,
  landIdentities,
  readDeclaredIdentity,
  readStagedIdentity,
  serializeIdentity,
  stageIdentity,
} from "../app-identity.ts";

// Parity anchor: m4ttstack/apps apps/deck/src/registry/__fixtures__/bundle-resources/
// holds byte-identical files, and deck's bundled-identity test proves deck
// reads exactly these bytes as board's identity.
const FIXTURE = join(import.meta.dir, "fixtures", "bundle-resources", "apps", "board");
const SVG = readFileSync(join(FIXTURE, "src", "favicon.svg"), "utf8");

function appDir(manifest: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "app-identity-"));
  writeFileSync(join(dir, "mattstack.deck.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

const BOARD_SOURCE = {
  name: "board",
  displayName: "Board",
  description: "Open MRs ready for review.",
  icon: "./src/favicon.svg",
  port: 11006,
  includeInBundle: true,
  badge: "/api/badge",
  dev: { start: "bun src/server.ts" },
  bundle: { build: "bun run build", artifact: "dist/board" },
};

test("staging board's source manifest writes exactly the twin fixture's bytes", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-out-")), "identity");
  const id = stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": SVG }), out, "board");
  expect(id?.name).toBe("board");
  expect(readFileSync(join(out, "mattstack.deck.json"), "utf8")).toBe(readFileSync(join(FIXTURE, "mattstack.deck.json"), "utf8"));
  expect(readFileSync(join(out, "src", "favicon.svg"), "utf8")).toBe(SVG);
});

test("the fixture is already in the staged form", () => {
  const id = readDeclaredIdentity(FIXTURE)!;
  expect(serializeIdentity(id)).toBe(readFileSync(join(FIXTURE, "mattstack.deck.json"), "utf8"));
});

test("a manifest without displayName or icon stages nothing and clears a stale out dir", () => {
  const out = mkdtempSync(join(tmpdir(), "stage-stale-"));
  writeFileSync(join(out, "leftover"), "x");
  expect(stageIdentity(appDir({ name: "deck", bundle: { build: "b", artifact: "dist/deck" } }), out)).toBeNull();
  expect(existsSync(out)).toBe(false);
});

test("a manifest naming another app fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-name-")), "identity");
  expect(() => stageIdentity(appDir({ ...BOARD_SOURCE, name: "chat" }, { "src/favicon.svg": SVG }), out, "board")).toThrow(/does not match board/);
});

test("icon paths that escape, are absolute, or cross a dotted dir are refused", () => {
  expect(() => iconSegments("../x.svg")).toThrow(/\.\./);
  expect(() => iconSegments("./a/../../x.svg")).toThrow(/\.\./);
  expect(() => iconSegments("/etc/x.svg")).toThrow(/relative/);
  expect(() => iconSegments("./")).toThrow(/names no file/);
  expect(() => iconSegments("./my.assets/x.svg")).toThrow(/dot/);
  expect(iconSegments("./src/favicon.svg")).toEqual(["src", "favicon.svg"]);
});

test("a declared icon that is missing, oversize or not svg fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-icon-")), "identity");
  expect(() => stageIdentity(appDir(BOARD_SOURCE), out)).toThrow(/icon .* is missing, over 64 KB, or not an svg/);
  expect(() => stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": `<svg>${" ".repeat(64 * 1024)}</svg>` }), out)).toThrow(/over 64 KB/);
  expect(() => stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": "PNG" }), out)).toThrow(/not an svg/);
});

test("a badge off the app's own origin fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-badge-")), "identity");
  expect(() => stageIdentity(appDir({ ...BOARD_SOURCE, badge: "//evil.example/b" }, { "src/favicon.svg": SVG }), out)).toThrow(/badge/);
});

test("a name deck would reject fails staging", () => {
  const out = join(mkdtempSync(join(tmpdir(), "stage-badname-")), "identity");
  expect(() => stageIdentity(appDir({ ...BOARD_SOURCE, name: "Board" }, { "src/favicon.svg": SVG }), out)).toThrow(/name must match/);
});

function row(name: string, extra: Record<string, unknown> = {}) {
  return {
    name, version: "1.0.0", license: "MIT",
    url: `https://example.invalid/${name}.tgz`, sha256: "a".repeat(64),
    archive: "tar.gz", extract: name,
    bundlePath: `Contents/Helpers/${name}`, exec: [`Contents/Helpers/${name}`],
    exposeByDefault: false, entitlements: "jit", status: "bundled", kind: "helper",
    ...extra,
  };
}
const served = (port: number) => ({ serve: { port, args: [] } });
function tools(rows: object[]) {
  return parseDepsLock(JSON.stringify({ schema: 1, arch: "arm64", tools: rows })).tools;
}
function depsWithBoardIdentity(): string {
  const deps = mkdtempSync(join(tmpdir(), "land-deps-"));
  stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": SVG }), join(deps, "board-identity"), "board");
  return deps;
}

test("land writes identity for served rows only and reports served rows without one", () => {
  const deps = depsWithBoardIdentity();
  stageIdentity(appDir({ ...BOARD_SOURCE, name: "gitq" }, { "src/favicon.svg": SVG }), join(deps, "gitq-identity"), "gitq");
  const resources = mkdtempSync(join(tmpdir(), "land-res-"));
  mkdirSync(join(resources, "apps", "stale"), { recursive: true });
  const result = landIdentities(tools([row("board", served(11006)), row("chat", served(11002)), row("gitq")]), deps, resources);
  expect(result).toEqual({ landed: ["board"], missing: ["chat"] });
  expect(readdirSync(join(resources, "apps"))).toEqual(["board"]);
  expect(readFileSync(join(resources, "apps", "board", "mattstack.deck.json"), "utf8")).toBe(readFileSync(join(FIXTURE, "mattstack.deck.json"), "utf8"));
  expect(readFileSync(join(resources, "apps", "board", "src", "favicon.svg"), "utf8")).toBe(SVG);
});

test("land copies only the manifest and its icon, never other files in the identity dir", () => {
  const deps = depsWithBoardIdentity();
  writeFileSync(join(deps, "board-identity", "extra.sh"), "echo hi\n");
  const resources = mkdtempSync(join(tmpdir(), "land-extra-"));
  landIdentities(tools([row("board", served(11006))]), deps, resources);
  expect(existsSync(join(resources, "apps", "board", "extra.sh"))).toBe(false);
});

test("land refuses an identity dir that names another app", () => {
  const deps = mkdtempSync(join(tmpdir(), "land-wrong-"));
  stageIdentity(appDir(BOARD_SOURCE, { "src/favicon.svg": SVG }), join(deps, "chat-identity"), "board");
  const resources = mkdtempSync(join(tmpdir(), "land-wrong-res-"));
  expect(() => landIdentities(tools([row("chat", served(11002))]), deps, resources)).toThrow(/names board, not chat/);
});

test("readStagedIdentity refuses a manifest that is not in the staged form", () => {
  const dir = appDir(BOARD_SOURCE, { "src/favicon.svg": SVG });
  expect(() => readStagedIdentity(dir, "board")).toThrow(/staged identity form/);
  expect(readStagedIdentity(FIXTURE, "board").displayName).toBe("Board");
});

test("check passes when Resources/apps holds exactly the served rows' identities", () => {
  const deps = depsWithBoardIdentity();
  const resources = mkdtempSync(join(tmpdir(), "check-ok-"));
  const t = tools([row("board", served(11006)), row("gitq")]);
  landIdentities(t, deps, resources);
  expect(checkIdentities(t, resources)).toEqual({ served: ["board"], problems: [] });
});

test("check names a served row with no identity and a stowaway dir", () => {
  const deps = depsWithBoardIdentity();
  const resources = mkdtempSync(join(tmpdir(), "check-bad-"));
  landIdentities(tools([row("board", served(11006))]), deps, resources);
  mkdirSync(join(resources, "apps", "gitq"), { recursive: true });
  const { problems } = checkIdentities(tools([row("board", served(11006)), row("chat", served(11002)), row("gitq")]), resources);
  expect(problems).toHaveLength(2);
  expect(problems.join("\n")).toContain("Resources/apps/gitq is not a served app in deps.lock");
  expect(problems.join("\n")).toContain("chat: served but ships no identity; re-run bundle-apps for chat");
});

test("check with no served rows and no Resources/apps is clean", () => {
  const resources = mkdtempSync(join(tmpdir(), "check-none-"));
  expect(checkIdentities(tools([row("gitq")]), resources)).toEqual({ served: [], problems: [] });
});

const CLI = join(import.meta.dir, "..", "app-identity.ts");
function lockFile(rows: object[]): string {
  const p = join(mkdtempSync(join(tmpdir(), "cli-lock-")), "deps.lock");
  writeFileSync(p, JSON.stringify({ schema: 1, arch: "arm64", tools: rows }));
  return p;
}
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args]);
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}

test("the land and check CLI round-trip, and check exits 1 on a gap", () => {
  const deps = depsWithBoardIdentity();
  const resources = mkdtempSync(join(tmpdir(), "cli-res-"));
  const lock = lockFile([row("board", served(11006))]);
  const land = cli("land", "--deps", deps, "--resources", resources, "--lock", lock);
  expect(land.code).toBe(0);
  expect(land.out).toContain("Resources/apps/board");
  const ok = cli("check", "--resources", resources, "--lock", lock);
  expect(ok.code).toBe(0);
  expect(ok.out).toContain("identity for board");
  const gap = cli("check", "--resources", resources, "--lock", lockFile([row("board", served(11006)), row("chat", served(11002))]));
  expect(gap.code).toBe(1);
  expect(gap.out).toContain("chat: served but ships no identity");
});

test("the CLI refuses an unknown mode and a flag with no value", () => {
  expect(cli("bogus").code).toBe(2);
  expect(cli("check", "--resources").code).toBe(2);
});
