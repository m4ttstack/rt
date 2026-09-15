import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSetting } from "../../settings/resolve.ts";
import { setSetting } from "../../settings/write.ts";
import { fakeProbes } from "./fakes.ts";
import {
  checkRepoRoot,
  clearStagedRepoRoot,
  detectCandidate,
  expandHome,
  promoteStagedRepoRoot,
  readStagedRepoRoot,
  stageRepoRoot,
  type RootStat,
} from "../repo-root.ts";

const HOME = "/Users/t";
const DIR = { isDirectory: true, writable: true };
const FILE = { isDirectory: false, writable: true };
const RO = { isDirectory: true, writable: false };
/** One fake per test: statPath answers for every path, exists answers the candidate scan. */
const p = (stat: RootStat = DIR, existing: string[] = []) => ({ home: HOME, statPath: () => stat, exists: (x: string) => existing.includes(x) });

describe("checkRepoRoot", () => {
  test("a writable directory is accepted and carries no warning", () => {
    expect(checkRepoRoot(p(DIR), "/Users/t/dev")).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test.each([["~/dev"], ["${home}/dev"]])("expands %s before validating", (raw) => {
    expect(checkRepoRoot(p(DIR), raw)).toEqual({ ok: true, path: "/Users/t/dev", tccWarning: null });
  });

  test("a path that does not exist is refused and says so", () => {
    const r = checkRepoRoot(p(null), "/Users/t/nope");
    expect(r).toEqual({ ok: false, detail: "/Users/t/nope does not exist" });
  });

  test("a file is refused as not a directory", () => {
    const r = checkRepoRoot(p(FILE), "/Users/t/notes.txt");
    expect(r).toEqual({ ok: false, detail: "/Users/t/notes.txt is not a directory" });
  });

  test("an unwritable directory is refused", () => {
    const r = checkRepoRoot(p(RO), "/Users/t/locked");
    expect(r).toEqual({ ok: false, detail: "/Users/t/locked is not writable" });
  });

  test("an empty path is refused rather than resolving to home", () => {
    expect(checkRepoRoot(p(DIR), "   ")).toEqual({ ok: false, detail: "no path given" });
  });

  // Advisory on purpose. It is the user's machine, and ~/Documents/GitHub is a
  // common convention; refusing would put rt's judgement back in place of
  // theirs, which is the defect this whole change removes.
  test.each([
    ["/Users/t/Documents/GitHub", "Documents"],
    ["/Users/t/Desktop/code", "Desktop"],
    ["/Users/t/Downloads/code", "Downloads"],
  ])("%s is ACCEPTED with a warning naming %s", (path, dirName) => {
    const r = checkRepoRoot(p(DIR), path);
    expect(r.ok).toBe(true);
    expect((r as { tccWarning: string | null }).tccWarning).toContain(dirName);
  });

  test("a directory merely NAMED Documents outside home is not warned about", () => {
    const r = checkRepoRoot(p(DIR), "/srv/Documents/code");
    expect((r as { tccWarning: string | null }).tccWarning).toBeNull();
  });
});

describe("detectCandidate", () => {
  test("returns the first candidate that exists", () => {
    expect(detectCandidate(p(DIR, ["/Users/t/code"]))).toBe("/Users/t/code");
  });

  test("follows list order when several exist", () => {
    expect(detectCandidate(p(DIR, ["/Users/t/code", "/Users/t/Documents/GitHub"]))).toBe("/Users/t/Documents/GitHub");
  });

  test("returns null when none exist, so nothing is suggested", () => {
    expect(detectCandidate(p(DIR, []))).toBeNull();
  });
});

describe("expandHome", () => {
  test.each([["~/dev", "/Users/t/dev"], ["${home}/dev", "/Users/t/dev"], ["/abs", "/abs"], ["~notahome", "~notahome"]])(
    "%s -> %s",
    (raw, want) => expect(expandHome({ home: HOME }, raw)).toBe(want),
  );
});

describe("staging", () => {
  const home = "/fake-home";

  test("a staged value round-trips", () => {
    const fp = fakeProbes({ home });
    stageRepoRoot(fp, "/fake-home/dev");
    expect(readStagedRepoRoot(fp)).toBe("/fake-home/dev");
  });

  test("a missing file reads null", () => {
    const fp = fakeProbes({ home });
    expect(readStagedRepoRoot(fp)).toBeNull();
  });

  test("a corrupt file reads null rather than throwing", () => {
    const fp = fakeProbes({ home, files: { "/fake-home/.mattstack/rt/repo-root.json": "{not json" } });
    expect(readStagedRepoRoot(fp)).toBeNull();
  });

  test("clearing removes it", () => {
    const fp = fakeProbes({ home });
    stageRepoRoot(fp, "/fake-home/dev");
    clearStagedRepoRoot(fp);
    expect(readStagedRepoRoot(fp)).toBeNull();
  });

  test("staging twice replaces the first value rather than appending", () => {
    const fp = fakeProbes({ home });
    stageRepoRoot(fp, "/fake-home/dev");
    stageRepoRoot(fp, "/fake-home/other");
    expect(readStagedRepoRoot(fp)).toBe("/fake-home/other");
  });
});

// promoteStagedRepoRoot writes through the real setSetting/getSetting seam,
// which reads process.env.HOME at call time... so each test gets its own real
// HOME rather than sharing the settings store the rest of this file's fakes
// never touch.
describe("promoteStagedRepoRoot", () => {
  const origHome = process.env.HOME;
  let home: string;
  const gitDir = () => join(home, ".mattstack", "user", ".git");

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-repo-root-home-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("staged with .git present promotes and clears", () => {
    const fp = fakeProbes({ home, dirs: { [gitDir()]: [] } });
    stageRepoRoot(fp, join(home, "dev"));
    expect(promoteStagedRepoRoot(fp)).toBe(true);
    expect(getSetting<string[]>("rt.repoRoots").value).toEqual([join(home, "dev")]);
    expect(readStagedRepoRoot(fp)).toBeNull();
  });

  test("staged without .git returns false, writes nothing and leaves the file", () => {
    const fp = fakeProbes({ home });
    stageRepoRoot(fp, join(home, "dev"));
    expect(promoteStagedRepoRoot(fp)).toBe(false);
    expect(getSetting<string[]>("rt.repoRoots").value).toEqual([]);
    expect(readStagedRepoRoot(fp)).toBe(join(home, "dev"));
  });

  test("nothing staged returns false", () => {
    const fp = fakeProbes({ home, dirs: { [gitDir()]: [] } });
    expect(promoteStagedRepoRoot(fp)).toBe(false);
  });
});
