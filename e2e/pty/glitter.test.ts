/**
 * The whole-binary gate for `rt glitter`: the real compiled rt spawning the
 * real rt-ui over a pty, keys in, git state out. Nothing is faked on either
 * side, so a break anywhere in the chain (intent emission, payload shape,
 * driver handling, the commit-time index rebuild) fails here.
 *
 * Every assertion reads git, never the rendered screen. Screen text appears
 * only in waits, where it is the one signal that a round trip finished --
 * asserting on it would make this a second, worse copy of the Go render
 * tests. Each wait keys on a state transition the board only paints once the
 * driver has come back from git, never on a fixed sleep. The History test is
 * the one screen-only exception: History changes no git state, so there is
 * nothing else to assert against.
 */
import { describe, test, expect, beforeAll, afterEach } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { createTestHome } from "../harness.ts";
import { startInteractive, type TermwrightSession } from "../interactive.ts";
import { createGlitterRepo, type GlitterRepo } from "../glitter-repo.ts";

const REPO_ROOT = import.meta.dir.replace("/e2e/pty", "");
const RT_UI_BIN = join(REPO_ROOT, "ui", "dist", "rt-ui");
const PAINT_TIMEOUT = 15_000;

beforeAll(() => {
  // The board is half of the binary under test; a run against a stale or
  // missing helper would gate nothing.
  // HOME is the run's throwaway dir, so the module cache lands in it and
  // must stay deletable.
  execFileSync("bun", ["run", "ui:build"], {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, GOFLAGS: [process.env.GOFLAGS, "-modcacherw"].filter(Boolean).join(" ") },
  });
  if (!existsSync(RT_UI_BIN)) throw new Error(`ui:build produced no binary at ${RT_UI_BIN}`);
});

let open: { session: TermwrightSession; repo: GlitterRepo; cleanupHome: () => void } | null = null;

afterEach(async () => {
  if (!open) return;
  await open.session.stop();
  open.repo.cleanup();
  open.cleanupHome();
  open = null;
});

async function openBoard(): Promise<{ session: TermwrightSession; repo: GlitterRepo }> {
  const repo = createGlitterRepo();
  const home = createTestHome();
  const session = await startInteractive({
    args: ["glitter"],
    home: home.path,
    cwd: repo.path,
    cols: 130,
    rows: 38,
    env: { RT_UI_BIN },
  });
  open = { session, repo, cleanupHome: home.cleanup };
  // The sandbox has four changes and every one starts checked, so this text
  // is also the assertion that the driver reached git and pushed a model.
  await session.waitForText("Commit 4 files", PAINT_TIMEOUT);
  return { session, repo };
}

/**
 * Types a summary and commits with ctrl+enter, then waits for the board to
 * repaint with nothing left to commit. Raw bytes rather than a hotkey helper
 * because the board negotiates the Kitty keyboard protocol, which encodes
 * ctrl+enter as a CSI-u sequence that a plain ctrl+ch cannot express.
 */
async function commit(session: TermwrightSession, summary: string, expectRemaining: number): Promise<void> {
  await session.press("c");
  await session.type(summary);
  await session.raw([0x1b, 0x5b, 0x31, 0x33, 0x3b, 0x35, 0x75]); // CSI 13;5u
  await session.waitForText(`Commit ${expectRemaining} files`, PAINT_TIMEOUT);
}

/** Commit leaves focus in the summary field, where a letter is text, not a keybinding. */
async function returnToList(session: TermwrightSession): Promise<void> {
  await session.press("Escape");
  await session.waitForIdle(300, PAINT_TIMEOUT);
}

describe("rt glitter through a pty", () => {
  test("opens on the working tree the sandbox actually has", async () => {
    const { repo } = await openBoard();
    expect(repo.staged()).toEqual(["config.json"]);
    expect(repo.log(1)).toEqual(["seed the sandbox"]);
  });

  test("space unchecks the cursor's file, and the commit then omits it", async () => {
    const { session, repo } = await openBoard();

    // The cursor opens on the first row, config.json (the list sorts
    // case-insensitively by path). termwright has no "space" key name.
    await session.raw([0x20]);
    await session.waitForText("Commit 3 files", PAINT_TIMEOUT);

    await commit(session, "pty gate commit", 0);

    expect(repo.log(1)).toEqual(["pty gate commit"]);

    // The unchecked file stayed out of the commit AND stayed modified in the
    // working tree: the index is rebuilt from the checkboxes, so an
    // unchecked file is left alone, not reverted.
    const committed = repo.git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(committed.sort()).toEqual(["NOTES.md", "src/legacy.ts", "src/parser.ts"]);
    expect(repo.git("status", "--porcelain", "config.json")).toContain("config.json");
  });

  test("a commit-time index rebuild discards staging done outside the board", async () => {
    const { session, repo } = await openBoard();

    // Stage a path the board has unchecked. GHD's model says the checkbox
    // wins: this must not reach the commit.
    await session.raw([0x20]); // uncheck config.json
    await session.waitForText("Commit 3 files", PAINT_TIMEOUT);
    repo.git("add", "config.json");
    expect(repo.staged()).toContain("config.json");

    await commit(session, "checkbox beats the index", 0);

    const committed = repo.git("show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
    expect(committed).not.toContain("config.json");
  });

  test("u undoes the last commit and leaves its changes in the tree", async () => {
    const { session, repo } = await openBoard();

    await commit(session, "commit to undo", 0);
    expect(repo.log(1)).toEqual(["commit to undo"]);

    await returnToList(session);
    await session.press("u");
    await session.waitForText("Commit 4 files", PAINT_TIMEOUT);

    expect(repo.log(1)).toEqual(["seed the sandbox"]);
    const status = repo.git("status", "--porcelain");
    expect(status).toContain("config.json");
    expect(status).toContain("src/parser.ts");
  });

  test("the History tab lists the sandbox's commit and shows its diff", async () => {
    // History changes no git state, so the screen is the only observable.
    const { session } = await openBoard();
    await session.press("2");
    await session.waitForText("seed the sandbox", PAINT_TIMEOUT);
    await session.waitForText("changed files", PAINT_TIMEOUT);
    await session.waitForText('"maxTokens": 2048', PAINT_TIMEOUT);
  });

  test("S stashes all changes under a Desktop-tagged entry, and R restores them", async () => {
    const { session, repo } = await openBoard();

    // Asserted before S is pressed: this is the canary that the
    // post-restore assertions below are exercising a real transition,
    // not a sandbox that already looked this way.
    expect(repo.git("stash", "list")).toBe("");

    await session.press("S");
    await session.waitForText("Stashed Changes", PAINT_TIMEOUT);

    const stashLog = repo.git("log", "-g", "--format=%gs", "refs/stash", "--")
      .split("\n")
      .filter(Boolean);
    expect(stashLog.length).toBe(1);
    expect(stashLog[0]).toContain("!!GitHub_Desktop<");
    expect(repo.git("status", "--porcelain")).toBe("");

    await session.press("h");
    await session.waitForText("Restore will move your stashed files", PAINT_TIMEOUT);

    await session.press("R");
    await session.waitForText("Commit 4 files", PAINT_TIMEOUT);

    expect(repo.git("stash", "list")).toBe("");
    const status = repo.git("status", "--porcelain");
    expect(status).toContain("config.json");
    expect(status).toContain("src/parser.ts");
    expect(status).toContain("src/legacy.ts");
    expect(status).toContain("NOTES.md");
  });

  test("ctrl-k opens the context menu's board-wide section, and esc closes it", async () => {
    // The context menu changes no git state, so the screen is the only observable.
    const { session } = await openBoard();
    await session.ctrl("k");
    await session.waitForText("Switch Branch…", PAINT_TIMEOUT);
    await session.waitForText("Reveal Repository in Finder", PAINT_TIMEOUT);

    await session.press("Escape");
    await session.waitForIdle(300, PAINT_TIMEOUT);
    const screen = await session.screen();
    expect(screen).not.toContain("Switch Branch…");
    expect(screen).not.toContain("Reveal Repository in Finder");
  });
});
