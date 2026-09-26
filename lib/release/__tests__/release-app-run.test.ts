import { describe, expect, test } from "bun:test";
import { runReleaseApp, type ReleaseAppSeams } from "../release-app.ts";
import type { RunResult } from "../../subprocess.ts";

const LAST = "v2.13.0";
const LAST_SHA = "c0";
const NOTES_SHA = "notessha1";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const err = (stderr: string, exitCode = 1): RunResult => ({ stdout: "", stderr, exitCode });

/** A stand-in for the rt checkout and GitHub, just enough to drive qualify, notes, tag and verify. */
function fakeSeams(o: { diff?: string[]; subjects?: Record<string, string[]> } = {}): ReleaseAppSeams & { calls: string[][]; notesCommitSha: string } {
  const diff = o.diff ?? [];
  const subjects = o.subjects ?? {};
  const calls: string[][] = [];

  const exec = async (argv: [string, ...string[]]): Promise<RunResult> => {
    calls.push(argv);
    const cmd = argv.join(" ");
    let m: RegExpMatchArray | null;

    if (cmd === "git fetch --quiet --tags origin main") return ok();
    if (cmd === "git rev-parse origin/main") return ok("mainsha0\n");
    if (cmd === "git status --porcelain") return ok("");
    if (cmd === "git ls-remote --tags --refs origin v*") return ok(`${LAST_SHA}\trefs/tags/${LAST}\n`);
    if ((m = cmd.match(/^git diff --name-only \S+\.\.origin\/main$/))) return ok(diff.join("\n"));
    if ((m = cmd.match(/^git log --format=%s (\S+)\.\.origin\/main -- apps\/(\S+)\/$/))) {
      return ok((subjects[m[2]!] ?? []).join("\n"));
    }
    if ((m = cmd.match(/^git log -1 --format=(\S+) (\S+)\.\.origin\/main -- RELEASE_NOTES\.md$/))) return ok("");
    if ((m = cmd.match(/^git show (\S+):RELEASE_NOTES\.md$/))) return ok("");
    if (cmd === "git add RELEASE_NOTES.md") return ok();
    if (cmd.startsWith("git commit -m")) return ok();
    if (cmd === "git rev-parse HEAD") return ok(`${NOTES_SHA}\n`);
    if ((m = cmd.match(/^git rev-parse -q --verify refs\/tags\/(\S+)\^\{commit\}$/))) return err("", 1);
    if ((m = cmd.match(/^git tag -a (\S+) (\S+) -m \S+$/))) return ok();
    if ((m = cmd.match(/^git ls-remote --tags origin refs\/tags\/(\S+) refs\/tags\/\S+\^\{\}$/))) return ok("");
    if (cmd.startsWith("git push")) return ok();
    return err(`unexpected command: ${cmd}`);
  };

  return {
    repoRoot: "/repo",
    exec,
    fetchJson: async () => ({}),
    now: () => 0,
    sleep: async () => {},
    isTTY: false,
    readFile: () => null,
    writeFile: () => {},
    confirm: async () => true,
    log: () => {},
    calls,
    notesCommitSha: NOTES_SHA,
  };
}

describe("runReleaseApp", () => {
  test("refuses an app that has not moved since the last tag", async () => {
    const seams = fakeSeams({ diff: ["apps/chat/x.ts", "RELEASE_NOTES.md"] });
    const report = await runReleaseApp(seams, { name: "board", dryRun: true });
    expect(report.status).toBe("declined");
    expect(report.steps[0]).toMatchObject({ id: "qualify", status: "stopped" });
    expect(report.steps[0]!.detail).toContain("board has not moved since v2.13.0");
  });

  test("refuses deck: it is not a served-only app", async () => {
    const seams = fakeSeams({ diff: ["apps/deck/x.ts"] });
    const report = await runReleaseApp(seams, { name: "deck", dryRun: true });
    expect(report.status).toBe("declined");
  });

  test("refuses a diff that leaves the fast path", async () => {
    const seams = fakeSeams({ diff: ["apps/board/x.ts", "lib/daemon.ts"] });
    const report = await runReleaseApp(seams, { name: "board", dryRun: true });
    expect(report.status).toBe("declined");
    expect(report.steps[0]!.detail).toContain("lib/daemon.ts");
  });

  test("dry run plans notes, tag and verify for every moved app", async () => {
    const seams = fakeSeams({ diff: ["apps/board/x.ts", "apps/chat/y.ts"], subjects: { board: ["board: fix a"], chat: ["chat: fix b"] } });
    const report = await runReleaseApp(seams, { name: "board", dryRun: true });
    expect(report.status).toBe("planned");
    expect(report.steps.map((s) => s.id)).toEqual(["qualify", "notes", "tag", "verify"]);
    expect(report.notes).toContain("### board");
    expect(report.notes).toContain("### chat");
    expect(report.nextTag).toBe("v2.13.1");
  });

  test("stops at the notes for approval, then tags the exercised sha on resume", async () => {
    const seams = fakeSeams({ diff: ["apps/board/x.ts"], subjects: { board: ["board: fix a"] } });
    const first = await runReleaseApp(seams, { name: "board" });
    expect(first.status).toBe("awaiting-approval");
    const second = await runReleaseApp(seams, { name: "board", yesNotes: first.notesHash! });
    expect(seams.calls).toContainEqual(["git", "tag", "-a", "v2.13.1", seams.notesCommitSha, "-m", "v2.13.1"]);
    expect(second.steps.find((s) => s.id === "tag")!.status).toBe("done");
  });
});
