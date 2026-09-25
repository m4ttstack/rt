import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { iconSegments, readDeclaredIdentity, serializeIdentity, stageIdentity } from "../app-identity.ts";

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
