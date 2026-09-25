import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  bundleRunTargets,
  globMatches,
  isAllowlisted,
  notesHash,
  pinOnlyLockProblems,
  teamFromProjectYml,
  changedCatalogEntries,
  dependencyNames,
  setBunLockWorkspaceVersion,
  workspaceGlobs,
  bumpPatch,
  nextPatchTag,
  setPackageVersion,
  eligibleApps,
  qualifyRow,
  resolvePhase,
  checkBotPrLock,
  checkCodesign,
  evaluateChecks,
  noteSubject,
  renderNotes,
  appAssetUrl,
} from "../release-app.ts";
import type { DepsRow } from "../preflight.ts";

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);

const appRow = (name: string, version: string, extra: Partial<DepsRow> = {}): DepsRow => ({
  name, version, repo: "m4ttstack/apps", subdir: `apps/${name}`,
  url: appAssetUrl(name, version),
  sha256: "0".repeat(64),
  status: "bundled",
  archive: "tar.gz",
  extract: name,
  ...extra,
} as DepsRow);

const ROWS: DepsRow[] = [
  { name: "jq", version: "1.8.2", url: "https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-macos-arm64" },
  appRow("deck", "1.1.1"),
  appRow("board", "0.1.7", { serve: { port: 11006, args: [] } }),
  { name: "gitq", version: "0.2.1", repo: "m4ttstack/gitq", url: "https://github.com/m4ttstack/gitq/releases/download/v0.2.1/gitq-darwin-arm64" },
  appRow("console", "0.1.3", { serve: { port: 11001, args: [] } }),
  appRow("chat", "0.1.3", { serve: { port: 11002, args: [] } }),
  appRow("boxscore", "0.1.0", { serve: { port: 11005, args: [] } }),
];

describe("versions", () => {
  test("bumpPatch bumps the last numeric segment", () => {
    expect(bumpPatch("0.1.7")).toBe("0.1.8");
    expect(bumpPatch("1.1.9")).toBe("1.1.10");
  });

  test("bumpPatch refuses anything that is not X.Y.Z", () => {
    expect(() => bumpPatch("0.1")).toThrow("X.Y.Z");
    expect(() => bumpPatch("0.1.7-beta")).toThrow("X.Y.Z");
  });

  test("nextPatchTag keeps the v prefix", () => {
    expect(nextPatchTag("v2.13.1")).toBe("v2.13.2");
    expect(() => nextPatchTag("2.13.1")).toThrow("vX.Y.Z");
  });

  test("setPackageVersion rewrites only the version value and keeps the formatting", () => {
    const text = `{\n  "name": "board",\n  "version": "0.1.7",\n  "dependencies": { "x": "0.1.7" }\n}\n`;
    const out = setPackageVersion(text, "0.1.7", "0.1.8");
    expect(out).toBe(`{\n  "name": "board",\n  "version": "0.1.8",\n  "dependencies": { "x": "0.1.7" }\n}\n`);
  });

  test("setPackageVersion refuses when the file is not at the expected version", () => {
    expect(() => setPackageVersion(`{ "version": "0.1.9" }`, "0.1.7", "0.1.8")).toThrow("0.1.9");
  });
});

describe("qualification", () => {
  test("eligibleApps is the apps-monorepo rows whose pin keeps the fast path", () => {
    expect(eligibleApps(ROWS).map((r) => r.name)).toEqual(["board", "console", "chat", "boxscore"]);
  });

  test("an eligible row qualifies", () => {
    expect(qualifyRow("board", ROWS).version).toBe("0.1.7");
  });

  test("an unknown name is refused with the eligible list", () => {
    expect(() => qualifyRow("nope", ROWS)).toThrow("board, console, chat, boxscore");
  });

  test("a standalone or tool row is refused as not an apps-monorepo row", () => {
    expect(() => qualifyRow("gitq", ROWS)).toThrow("not an apps-monorepo row");
    expect(() => qualifyRow("jq", ROWS)).toThrow("not an apps-monorepo row");
  });

  test("deck is refused because its pin keeps the full gate", () => {
    expect(() => qualifyRow("deck", ROWS)).toThrow("full gate");
    expect(() => qualifyRow("deck", ROWS)).toThrow("/rt:release");
  });
});

describe("resolvePhase", () => {
  const never = () => Promise.reject(new Error("history should not be read"));

  test("apps main ahead of the pin means a human bumped it: build that version, skip the bump", async () => {
    const d = await resolvePhase({ name: "board", pinned: "0.1.7", shipped: "0.1.7", shippedBefore: "0.1.6", appsMain: "0.1.9", pinTag: "board-v0.1.7", appMoved: never });
    expect(d).toEqual({ phase: "bundle", target: "0.1.9" });
  });

  test("apps main behind the pin is refused", async () => {
    const d = await resolvePhase({ name: "board", pinned: "0.1.7", shipped: "0.1.7", shippedBefore: null, appsMain: "0.1.6", pinTag: "board-v0.1.7", appMoved: never });
    expect("refuse" in d && d.refuse).toContain("behind the pin");
  });

  test("a pin already moved since the last tag resumes at the notes", async () => {
    const d = await resolvePhase({ name: "board", pinned: "0.1.8", shipped: "0.1.7", shippedBefore: "0.1.7", appsMain: "0.1.8", pinTag: "board-v0.1.8", appMoved: never });
    expect(d).toEqual({ phase: "notes", target: "0.1.8" });
  });

  test("an unreleased app with new commits starts fresh at the next patch", async () => {
    const d = await resolvePhase({ name: "board", pinned: "0.1.7", shipped: "0.1.7", shippedBefore: "0.1.7", appsMain: "0.1.7", pinTag: "board-v0.1.7", appMoved: async () => true });
    expect(d).toEqual({ phase: "bump", target: "0.1.8" });
  });

  test("a last tag that moved this pin, with nothing new since, resumes at the tag", async () => {
    const d = await resolvePhase({ name: "board", pinned: "0.1.8", shipped: "0.1.8", shippedBefore: "0.1.7", appsMain: "0.1.8", pinTag: "board-v0.1.8", appMoved: async () => false });
    expect(d).toEqual({ phase: "released", target: "0.1.8" });
  });

  test("nothing new and nothing released is refused as an empty release", async () => {
    const d = await resolvePhase({ name: "board", pinned: "0.1.7", shipped: "0.1.7", shippedBefore: "0.1.7", appsMain: "0.1.7", pinTag: "board-v0.1.7", appMoved: async () => false });
    expect("refuse" in d && d.refuse).toContain("no commits under apps/board or its workspace packages since board-v0.1.7");
  });
});

describe("checkBotPrLock", () => {
  const lock = (rows: DepsRow[]) => JSON.stringify({ schema: 1, arch: "arm64", tools: rows }, null, 2);
  const base = lock(ROWS);
  const bumped = (name: string, version: string, sha = "f".repeat(64)) =>
    ROWS.map((r) => (r.name === name ? { ...r, version, url: appAssetUrl(name, version), sha256: sha } : r));

  test("a diff that moves only the app's row passes and returns the row", () => {
    const r = checkBotPrLock({ name: "board", version: "0.1.8", files: ["rt-tray/deps.lock"], baseLock: base, headLock: lock(bumped("board", "0.1.8")) });
    expect(r.problems).toEqual([]);
    expect(r.row?.sha256).toBe("f".repeat(64));
  });

  test("a second row changing is refused and named", () => {
    const head = bumped("board", "0.1.8").map((r) => (r.name === "chat" ? { ...r, version: "0.1.4" } : r));
    const r = checkBotPrLock({ name: "board", version: "0.1.8", files: ["rt-tray/deps.lock"], baseLock: base, headLock: lock(head) });
    expect(r.problems.join("; ")).toContain("rows other than board changed: chat");
  });

  test("a file besides deps.lock is refused", () => {
    const r = checkBotPrLock({ name: "board", version: "0.1.8", files: ["rt-tray/deps.lock", "cli.ts"], baseLock: base, headLock: lock(bumped("board", "0.1.8")) });
    expect(r.problems.join("; ")).toContain("cli.ts");
  });

  test("the wrong version or url on the app's row is refused", () => {
    const wrongVersion = checkBotPrLock({ name: "board", version: "0.1.8", files: ["rt-tray/deps.lock"], baseLock: base, headLock: lock(bumped("board", "0.1.9")) });
    expect(wrongVersion.problems.join("; ")).toContain("0.1.9");
    const head = bumped("board", "0.1.8").map((r) => (r.name === "board" ? { ...r, url: "https://example.com/board.tgz" } : r));
    const wrongUrl = checkBotPrLock({ name: "board", version: "0.1.8", files: ["rt-tray/deps.lock"], baseLock: base, headLock: lock(head) });
    expect(wrongUrl.problems.join("; ")).toContain("https://example.com/board.tgz");
  });

  test("a removed row is refused", () => {
    const head = bumped("board", "0.1.8").filter((r) => r.name !== "boxscore");
    const r = checkBotPrLock({ name: "board", version: "0.1.8", files: ["rt-tray/deps.lock"], baseLock: base, headLock: lock(head) });
    expect(r.problems.join("; ")).toContain("boxscore");
  });
});

describe("checkCodesign", () => {
  const SIGNED = [
    "Executable=/tmp/x/board",
    "Identifier=com.mattstack.helper.board",
    "Format=Mach-O thin (arm64)",
    "Authority=Developer ID Application: Matthew Goodwin (5BF66B3X4V)",
    "Authority=Developer ID Certification Authority",
    "Authority=Apple Root CA",
    "TeamIdentifier=5BF66B3X4V",
  ].join("\n");
  const TEAM = "5BF66B3X4V";

  test("the stable identifier plus a Developer ID authority passes", () => {
    expect(checkCodesign("board", SIGNED, TEAM)).toEqual([]);
  });

  test("a wrong identifier is refused and names what it found", () => {
    expect(checkCodesign("chat", SIGNED, TEAM).join("; ")).toContain("com.mattstack.helper.board");
  });

  test("an ad-hoc signature is refused", () => {
    const adhoc = "Identifier=com.mattstack.helper.board\nSignature=adhoc\n";
    expect(checkCodesign("board", adhoc, TEAM).join("; ")).toContain("Developer ID Application");
  });

  test("a Developer ID signature from another team is refused", () => {
    const other = SIGNED.replace("TeamIdentifier=5BF66B3X4V", "TeamIdentifier=ZZZZZZZZZZ");
    expect(checkCodesign("board", other, TEAM).join("; ")).toContain("TeamIdentifier is ZZZZZZZZZZ, expected 5BF66B3X4V");
  });

  test("the expected team is the one rt-tray/project.yml signs with", () => {
    const yml = readFileSync(join(import.meta.dir, "..", "..", "..", "rt-tray", "project.yml"), "utf8");
    expect(teamFromProjectYml(yml)).toBe("5BF66B3X4V");
    expect(() => teamFromProjectYml("settings:\n  base: {}\n")).toThrow("DEVELOPMENT_TEAM");
  });
});

describe("evaluateChecks", () => {
  test("zero pending and at least one pass is green", () => {
    expect(evaluateChecks([{ name: "checks", bucket: "pass" }, { name: "glitter-pty", bucket: "skipping" }])).toEqual({ state: "green" });
  });

  test("CodeRabbit is ignored whatever its state", () => {
    expect(evaluateChecks([{ name: "checks", bucket: "pass" }, { name: "CodeRabbit", bucket: "pending" }])).toEqual({ state: "green" });
    expect(evaluateChecks([{ name: "checks", bucket: "pass" }, { name: "CodeRabbit", bucket: "fail" }])).toEqual({ state: "green" });
  });

  test("a pending check waits", () => {
    expect(evaluateChecks([{ name: "checks", bucket: "pass" }, { name: "e2e", bucket: "pending" }])).toEqual({ state: "pending", pending: ["e2e"] });
  });

  test("no passing check yet waits, even with nothing pending", () => {
    expect(evaluateChecks([])).toEqual({ state: "pending", pending: [] });
    expect(evaluateChecks([{ name: "CodeRabbit", bucket: "pass" }])).toEqual({ state: "pending", pending: [] });
  });

  test("a failed or cancelled check blocks", () => {
    expect(evaluateChecks([{ name: "checks", bucket: "fail" }, { name: "e2e", bucket: "cancel" }, { name: "purity", bucket: "pass" }]))
      .toEqual({ state: "failed", failed: ["checks", "e2e"] });
  });
});

describe("notes", () => {
  test("noteSubject qualifies apps PR numbers so they do not link to rt PRs", () => {
    expect(noteSubject("board: serve a setup page (#156)")).toBe("board: serve a setup page (m4ttstack/apps#156)");
  });

  test("noteSubject replaces em and en dashes", () => {
    const out = noteSubject(`fix the pane ${EM} for real ${EN} again`);
    expect(out).not.toContain(EM);
    expect(out).not.toContain(EN);
    expect(out).toBe("fix the pane... for real... again");
  });

  test("renderNotes writes a lead line, one section per app, and the Full Changelog link", () => {
    const notes = renderNotes({
      lastTag: "v2.13.1",
      nextTag: "v2.13.2",
      sections: [{ app: "board", version: "0.1.8", subjects: ["board: serve a setup page (#156)", "board: tidy the header"] }],
      held: [],
    });
    expect(notes).toBe([
      "A patch release that ships board 0.1.8.",
      "",
      "### Board 0.1.8",
      "",
      "- board: serve a setup page (m4ttstack/apps#156)",
      "- board: tidy the header",
      "",
      "**Full Changelog**: https://github.com/m4ttstack/rt/compare/v2.13.1...v2.13.2",
      "",
    ].join("\n"));
  });

  test("renderNotes lists every moved app in the lead and says so when an app has no subjects", () => {
    const notes = renderNotes({
      lastTag: "v2.13.1",
      nextTag: "v2.13.2",
      sections: [
        { app: "board", version: "0.1.8", subjects: ["a"] },
        { app: "chat", version: "0.1.4", subjects: [] },
        { app: "console", version: "0.1.4", subjects: ["b"] },
      ],
      held: [],
    });
    expect(notes.split("\n")[0]).toBe("A patch release that ships board 0.1.8, chat 0.1.4 and console 0.1.4.");
    expect(notes).toContain("### Chat 0.1.4\n\n- version bump only; no other commits under apps/chat\n");
  });
});

describe("the pin-only gate", () => {
  const lock = (rows: DepsRow[], top: Record<string, unknown> = { schema: 1, arch: "arm64" }) => JSON.stringify({ ...top, tools: rows });
  const moved = (name: string, version: string, extra: Partial<DepsRow> = {}) =>
    ROWS.map((r) => (r.name === name ? { ...r, version, url: appAssetUrl(name, version), sha256: "f".repeat(64), ...extra } : r));

  test("only RELEASE_NOTES.md and website/ ride along with deps.lock", () => {
    expect(isAllowlisted("RELEASE_NOTES.md")).toBe(true);
    expect(isAllowlisted("website/docs/x.md")).toBe(true);
    expect(isAllowlisted("rt-tray/deps.lock")).toBe(false);
    expect(isAllowlisted("lib/x.ts")).toBe(false);
  });

  test("a serve-only row moving its version, url and sha256 passes", () => {
    expect(pinOnlyLockProblems(lock(ROWS), lock(moved("chat", "0.1.4")))).toEqual([]);
  });

  test("any other field on a serve-only row is refused", () => {
    const problems = pinOnlyLockProblems(lock(ROWS), lock(moved("chat", "0.1.4", { license: "Apache-2.0" } as Partial<DepsRow>)));
    expect(problems.join("; ")).toContain("chat");
  });

  test("a full-gate row may not change at all, even only its sha256", () => {
    const head = moved("chat", "0.1.4").map((r) => (r.name === "deck" ? { ...r, sha256: "e".repeat(64) } : r));
    expect(pinOnlyLockProblems(lock(ROWS), lock(head)).join("; ")).toContain("deck");
  });

  test("a top-level field change is refused", () => {
    expect(pinOnlyLockProblems(lock(ROWS), lock(ROWS, { schema: 1, arch: "x86_64" })).join("; ")).toContain("top-level");
  });

  test("a removed row is refused", () => {
    expect(pinOnlyLockProblems(lock(ROWS), lock(ROWS.filter((r) => r.name !== "jq"))).join("; ")).toContain("jq");
  });
});

describe("checkBotPrLock: the app's own row", () => {
  const lock = (rows: DepsRow[]) => JSON.stringify({ schema: 1, arch: "arm64", tools: rows });
  const head = (edit: Record<string, unknown>) =>
    ROWS.map((r) => (r.name === "board" ? { ...r, version: "0.1.8", url: appAssetUrl("board", "0.1.8"), sha256: "f".repeat(64), ...edit } : r));
  const check = (edit: Record<string, unknown>) =>
    checkBotPrLock({ name: "board", version: "0.1.8", files: ["rt-tray/deps.lock"], baseLock: lock(ROWS), headLock: lock(head(edit) as DepsRow[]) }).problems.join("; ");

  test("a field outside the pin and update-lock's fixed fields is refused", () => {
    expect(check({ serve: { port: 9999, args: [] } })).toContain("beyond version, url, sha256, status, archive and extract");
  });

  test("status, archive and extract must be update-lock's fixed values", () => {
    expect(check({ status: "pending" })).toContain('status to "pending"');
    expect(check({ archive: "zip" })).toContain('archive to "zip"');
    expect(check({ extract: "other" })).toContain('extract to "other"');
  });
});

describe("approval and run identity", () => {
  test("notesHash is a stable 12-hex digest of the exact notes", () => {
    expect(notesHash("a\n")).toMatch(/^[0-9a-f]{12}$/);
    expect(notesHash("a\n")).toBe(notesHash("a\n"));
    expect(notesHash("a\n")).not.toBe(notesHash("a \n"));
  });

  test("bundleRunTargets reads the apps a run builds and skips dry and all runs", () => {
    expect(bundleRunTargets("Bundle apps: board")).toEqual(["board"]);
    expect(bundleRunTargets("Bundle apps: board,chat")).toEqual(["board", "chat"]);
    expect(bundleRunTargets("Bundle apps: board (dry run)")).toBeNull();
    expect(bundleRunTargets("Bundle apps: all")).toBeNull();
    expect(bundleRunTargets("Bundle apps")).toBeNull();
  });

  test("bundle-apps.yml names its runs in the shape bundleRunTargets reads", () => {
    const yml = readFileSync(join(import.meta.dir, "..", "..", "..", ".github", "workflows", "bundle-apps.yml"), "utf8");
    const line = yml.split("\n").find((l) => l.startsWith("run-name:"));
    expect(line).toBe(`run-name: "Bundle apps: \${{ inputs.apps }}\${{ inputs.dry_run && ' (dry run)' || '' }}"`);
  });
});

describe("held pins in the notes", () => {
  test("renderNotes records every app held at a stale pin", () => {
    const notes = renderNotes({
      lastTag: "v2.13.1",
      nextTag: "v2.13.2",
      sections: [{ app: "board", version: "0.1.8", subjects: ["a"] }],
      held: [{ app: "chat", version: "0.1.3", pinTag: "chat-v0.1.3" }],
    });
    expect(notes).toContain("### Held pins\n\n- chat stays at 0.1.3; apps/chat has moved since chat-v0.1.3 and this release does not ship it\n");
    expect(notes.indexOf("### Held pins")).toBeLessThan(notes.indexOf("**Full Changelog**"));
  });

  test("no held pins, no section", () => {
    const notes = renderNotes({ lastTag: "v2.13.1", nextTag: "v2.13.2", sections: [{ app: "board", version: "0.1.8", subjects: ["a"] }], held: [] });
    expect(notes).not.toContain("Held pins");
  });
});

describe("workspace dependencies", () => {
  test("workspaceGlobs reads both workspace shapes", () => {
    expect(workspaceGlobs({ workspaces: ["apps/*"] })).toEqual(["apps/*"]);
    expect(workspaceGlobs({ workspaces: { packages: ["packages/*", "packages/tui-kit/workshop"] } })).toEqual(["packages/*", "packages/tui-kit/workshop"]);
    expect(workspaceGlobs({})).toEqual([]);
  });

  test("globMatches takes one segment under a /* glob, or the exact path", () => {
    expect(globMatches("packages/*", "packages/tui-kit")).toBe(true);
    expect(globMatches("packages/*", "packages/tui-kit/workshop")).toBe(false);
    expect(globMatches("packages/tui-kit/workshop", "packages/tui-kit/workshop")).toBe(true);
  });

  test("dependencyNames is every dependency whatever its specifier, dev ones included", () => {
    expect(Object.keys(dependencyNames({
      dependencies: { "@mattstack/tui-kit": "workspace:*", react: "catalog:" },
      devDependencies: { "@mattstack/app-server": "^0.1.0", typescript: "~6" },
    })).sort()).toEqual(["@mattstack/app-server", "@mattstack/tui-kit", "react", "typescript"]);
  });

  test("changedCatalogEntries reports only the catalog entries the app uses that moved", () => {
    const from = { workspaces: { catalog: { react: "^19.2.0", zod: "^4.0.0" }, catalogs: { ui: { hono: "^4.1.0" } } } };
    const to = { workspaces: { catalog: { react: "^19.2.7", zod: "^4.4.3" }, catalogs: { ui: { hono: "^4.1.0" } } } };
    const uses = [{ dep: "react", spec: "catalog:" }, { dep: "hono", spec: "catalog:ui" }, { dep: "left-pad", spec: "^1.0.0" }];
    expect(changedCatalogEntries(from, to, uses)).toEqual([{ dep: "react", from: "^19.2.0", to: "^19.2.7" }]);
    expect(changedCatalogEntries({ catalog: { react: "1" } }, { catalog: { react: "2" } }, [{ dep: "react", spec: "catalog:default" }]))
      .toEqual([{ dep: "react", from: "1", to: "2" }]);
  });
});

describe("the bun.lock workspace version", () => {
  const LOCK = [
    "{",
    '  "lockfileVersion": 1,',
    '  "workspaces": {',
    '    "": {',
    '      "name": "apps",',
    "    },",
    '    "apps/board": {',
    '      "name": "board",',
    '      "version": "0.1.7",',
    '      "dependencies": {',
    '        "left-pad": "0.1.7",',
    "      },",
    "    },",
    '    "apps/chat": {',
    '      "name": "chat",',
    '      "version": "0.1.7",',
    "    },",
    "  },",
    "}",
    "",
  ].join("\n");

  test("rewrites only the app's own workspace version", () => {
    const out = setBunLockWorkspaceVersion(LOCK, "board", "0.1.7", "0.1.8");
    expect(out).toBe(LOCK.replace('"name": "board",\n      "version": "0.1.7"', '"name": "board",\n      "version": "0.1.8"'));
    expect(out).toContain('"left-pad": "0.1.7"');
    expect(out).toContain('"name": "chat",\n      "version": "0.1.7"');
  });

  test("refuses when the lockfile does not record the pin", () => {
    expect(() => setBunLockWorkspaceVersion(LOCK, "board", "0.1.6", "0.1.7")).toThrow("bun.lock records apps/board at 0.1.7, not the pin 0.1.6");
  });

  test("refuses when the app has no workspace entry", () => {
    expect(() => setBunLockWorkspaceVersion(LOCK, "console", "0.1.3", "0.1.4")).toThrow("no apps/console workspace");
  });
});
