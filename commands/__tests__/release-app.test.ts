import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { releaseApp } from "../release.ts";
import { appAssetUrl, type ReleaseAppOptions, type ReleaseAppReport, type ReleaseAppSeams } from "../../lib/release/release-app.ts";
import type { SelectOption } from "../../lib/pick-wrappers.ts";

const LOCK = JSON.stringify({
  schema: 1, arch: "arm64", tools: [
    { name: "jq", version: "1.8.2", url: "https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-macos-arm64" },
    { name: "deck", version: "1.1.1", repo: "m4ttstack/apps", subdir: "apps/deck", url: appAssetUrl("deck", "1.1.1") },
    { name: "board", version: "0.1.7", repo: "m4ttstack/apps", subdir: "apps/board", url: appAssetUrl("board", "0.1.7") },
    { name: "chat", version: "0.1.3", repo: "m4ttstack/apps", subdir: "apps/chat", url: appAssetUrl("chat", "0.1.3") },
  ],
});

function seams(): ReleaseAppSeams {
  return {
    repoRoot: "/repo",
    exec: async () => ({ stdout: "", stderr: "no exec in command tests", exitCode: 1 }),
    fetchJson: () => Promise.reject(new Error("no network")),
    now: () => 0,
    sleep: async () => {},
    isTTY: false,
    workDir: () => "/work",
    readFile: (path) => (path === "/repo/rt-tray/deps.lock" ? LOCK : null),
    writeFile: () => {},
    download: async () => {},
    sha256File: async () => "",
    confirm: async () => false,
    log: () => {},
  };
}

function report(status: ReleaseAppReport["status"], extra: Partial<ReleaseAppReport> = {}): ReleaseAppReport {
  return {
    app: "board", status, lastTag: "v2.13.1", tag: "v2.13.2", appVersion: "0.1.8", appTag: "board-v0.1.8",
    steps: [], notes: null, notesHash: null, heldApps: [], verify: null, resume: null, ...extra,
  };
}

interface Harness {
  runs: ReleaseAppOptions[];
  picks: SelectOption[][];
  logs: string[];
  exitCode: number;
  exitCalled: number | undefined;
}

async function invoke(args: string[], o: { tty?: boolean; pick?: string | null; result?: ReleaseAppReport } = {}): Promise<Harness> {
  const h: Harness = { runs: [], picks: [], logs: [], exitCode: 0, exitCalled: undefined };
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: o.tty ?? false, configurable: true });
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { h.logs.push(a.map(String).join(" ")); });
  const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
    h.exitCalled = code;
    throw new Error("process.exit sentinel");
  });
  process.exitCode = 0;
  try {
    await releaseApp(args, {}, {
      seams: seams(),
      pickApp: async (options) => { h.picks.push(options); return o.pick === undefined ? null : o.pick; },
      run: async (_s, opts) => { h.runs.push(opts); return o.result ?? report("released"); },
    });
  } catch (err) {
    if (!String(err).includes("process.exit sentinel")) throw err;
  } finally {
    h.exitCode = Number(process.exitCode ?? 0);
    process.exitCode = 0;
    exitSpy.mockRestore();
    logSpy.mockRestore();
    if (ttyDescriptor) Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
  }
  return h;
}

let savedBatch: string | undefined;
beforeEach(() => {
  savedBatch = process.env.RT_BATCH;
  delete process.env.RT_BATCH;
});
afterEach(() => {
  if (savedBatch === undefined) delete process.env.RT_BATCH;
  else process.env.RT_BATCH = savedBatch;
});

describe("rt release app: the omitted-name picker", () => {
  test("on a TTY it offers the eligible apps with their pinned versions and releases the pick", async () => {
    const h = await invoke([], { tty: true, pick: "chat" });
    expect(h.picks).toEqual([[
      { value: "board", label: "board", hint: "0.1.7" },
      { value: "chat", label: "chat", hint: "0.1.3" },
    ]]);
    expect(h.runs.map((r) => r.name)).toEqual(["chat"]);
  });

  test("cancelling the picker releases nothing and exits clean", async () => {
    const h = await invoke([], { tty: true, pick: null });
    expect(h.runs).toEqual([]);
    expect(h.exitCalled).toBeUndefined();
    expect(h.exitCode).toBe(0);
  });

  test("off a TTY it is the usage error, never a picker", async () => {
    const h = await invoke([], { tty: false });
    expect(h.picks).toEqual([]);
    expect(h.runs).toEqual([]);
    expect(h.exitCalled).toBe(2);
    expect(h.logs.join("\n")).toContain("usage: rt release app <name>");
  });

  test("--json on a TTY is the usage error as a JSON envelope", async () => {
    const h = await invoke(["--json"], { tty: true, pick: "board" });
    expect(h.picks).toEqual([]);
    expect(h.exitCalled).toBe(2);
    const body = JSON.parse(h.logs.at(-1)!) as { error: { code: string } };
    expect(body.error.code).toBe("usage");
  });

  test("RT_BATCH on a TTY is the usage error", async () => {
    process.env.RT_BATCH = "1";
    const h = await invoke([], { tty: true, pick: "board" });
    expect(h.picks).toEqual([]);
    expect(h.exitCalled).toBe(2);
  });
});

describe("rt release app: flags and output", () => {
  test("passes the name and every flag through, --yes-notes with its approval token", async () => {
    const h = await invoke(["board", "--dry-run", "--yes-notes", "0123456789ab"]);
    expect(h.runs).toEqual([{ name: "board", dryRun: true, json: false, yesNotes: "0123456789ab" }]);
  });

  test("the --yes-notes value is never mistaken for the app name", async () => {
    const h = await invoke(["--yes-notes", "0123456789ab", "board"]);
    expect(h.runs.map((r) => [r.name, r.yesNotes])).toEqual([["board", "0123456789ab"]]);
  });

  test("--yes-notes takes only a notes hash: the tag form is a usage error", async () => {
    for (const token of ["v2.13.2", "0123456789", "0123456789abcd", "0123456789AB"]) {
      const h = await invoke(["board", "--yes-notes", token]);
      expect(h.runs).toEqual([]);
      expect(h.exitCalled).toBe(2);
      expect(h.logs.join("\n")).toContain("--yes-notes <notes hash>");
    }
  });

  test("--yes-notes without a value is a usage error", async () => {
    const h = await invoke(["board", "--yes-notes"]);
    expect(h.runs).toEqual([]);
    expect(h.exitCalled).toBe(2);
  });

  test("no --yes-notes means no approval", async () => {
    const h = await invoke(["board"]);
    expect(h.runs[0]!.yesNotes).toBeNull();
  });

  test("a pending publish exits 1 and names the recheck", async () => {
    const h = await invoke(["board"], { result: report("pending", { resume: "rt release verify v2.13.2" }) });
    expect(h.exitCode).toBe(1);
    expect(h.logs.join("\n")).toContain("rt release verify v2.13.2");
  });

  test("--json prints the report in the envelope; an approval stop exits 0", async () => {
    const h = await invoke(["board", "--json"], { result: report("awaiting-approval", { notes: "notes\n", notesHash: "0123456789ab", resume: "rt release app board --json --yes-notes 0123456789ab" }) });
    const body = JSON.parse(h.logs.at(-1)!) as ReleaseAppReport & { contract: number };
    expect(body.contract).toBe(1);
    expect(body.status).toBe("awaiting-approval");
    expect(body.resume).toBe("rt release app board --json --yes-notes 0123456789ab");
    expect(h.exitCode).toBe(0);
  });

  test("a failed step exits 1 and names the step and the resume command", async () => {
    const h = await invoke(["board"], {
      result: report("failed", {
        steps: [{ id: "pr", label: "deps.lock PR", status: "failed", detail: "CI failed" }],
        resume: "rt release app board",
      }),
    });
    expect(h.exitCode).toBe(1);
    expect(h.logs.join("\n")).toContain("stopped at deps.lock PR");
    expect(h.logs.join("\n")).toContain("resume: rt release app board");
  });

  test("a released report prints the tag and exits 0", async () => {
    const h = await invoke(["board"]);
    expect(h.exitCode).toBe(0);
    expect(h.logs.join("\n")).toContain("released v2.13.2 with board 0.1.8");
  });

  test("a name that is not a plain app name is a usage error", async () => {
    const h = await invoke(["../board"]);
    expect(h.runs).toEqual([]);
    expect(h.exitCalled).toBe(2);
  });
});
