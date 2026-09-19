import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { VerifySeams } from "../../lib/release/verify.ts";
import { releaseVerify } from "../release.ts";

const ok = (stdout: string) => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string) => Promise.resolve({ stdout: "", stderr, exitCode: 1 });

const RELEASE = {
  body: "notes\n",
  assets: [
    { name: "mattstack-2.10.2.dmg" },
    { name: "mattstack-2.10.2.zip" },
    { name: "appcast.xml" },
    { name: "SHA256SUMS" },
  ],
  isDraft: false,
  isPrerelease: false,
  publishedAt: "2026-09-18T21:07:55Z",
};

const RUNS = JSON.stringify([
  { databaseId: 111, event: "push", headBranch: "v2.10.2", url: "https://github.com/m4ttstack/rt/actions/runs/111" },
]);

/** A seam set whose every layer verifies clean for v2.10.2. */
function fakeSeams(overrides: Partial<VerifySeams> = {}): VerifySeams {
  return {
    repoRoot: "/repo",
    exec: (argv) => {
      const cmd = argv.join(" ");
      if (cmd.includes("describe")) return ok("v2.10.2\n");
      if (cmd.includes("run list")) return ok(RUNS);
      if (cmd.includes("run view")) return ok(JSON.stringify({ status: "completed", conclusion: "success" }));
      if (cmd.includes("git show")) return ok(RELEASE.body);
      if (cmd.includes("release view")) return ok(JSON.stringify(RELEASE));
      return fail("unexpected: " + cmd);
    },
    fetchJson: () => Promise.resolve({ tag_name: "v2.10.2", assets: RELEASE.assets }),
    now: () => new Date("2026-09-18T21:08:00Z").getTime(),
    sleep: async () => {},
    ...overrides,
  };
}

/**
 * Bun does not clear a previously-set nonzero process.exitCode when a later
 * assignment is `undefined` (only a number sticks), so priming/restoring
 * with `undefined` here would leak a failing exit code into the next test
 * in this file. Priming with 0 instead keeps every run isolated.
 */
async function run(args: string[], seams: VerifySeams): Promise<{ logs: string[]; exitCode: number | string | undefined }> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  process.exitCode = 0;
  try {
    await releaseVerify(args, {}, seams);
    return { logs, exitCode: process.exitCode };
  } finally {
    process.exitCode = 0;
    logSpy.mockRestore();
  }
}

afterEach(() => {
  process.exitCode = 0;
});

describe("rt release verify", () => {
  test("--json prints the contract envelope and exits clean when everything verifies", async () => {
    const { logs, exitCode } = await run(["v2.10.2", "--json"], fakeSeams());
    expect(logs).toHaveLength(1);
    const body = JSON.parse(logs[0]!);
    expect(body.contract).toBe(1);
    expect(body.tag).toBe("v2.10.2");
    expect(body.clean).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(exitCode ?? 0).toBe(0);
  });

  test("--json exits 1 when a layer is stale", async () => {
    const seams = fakeSeams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("release view")) return ok(JSON.stringify({ ...RELEASE, isDraft: true }));
        return fakeSeams().exec(argv);
      },
    });
    const { logs, exitCode } = await run(["v2.10.2", "--json"], seams);
    const body = JSON.parse(logs[0]!);
    expect(body.clean).toBe(false);
    expect(exitCode).toBe(1);
  });

  test("an explicit positional tag skips tag resolution (no git describe call)", async () => {
    let describeCalled = false;
    const seams = fakeSeams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("describe")) describeCalled = true;
        return fakeSeams().exec(argv);
      },
    });
    await run(["v2.10.2", "--json"], seams);
    expect(describeCalled).toBe(false);
  });

  test("omitting the tag resolves it via git describe", async () => {
    const { logs } = await run(["--json"], fakeSeams());
    const body = JSON.parse(logs[0]!);
    expect(body.tag).toBe("v2.10.2");
  });

  test("human output renders a checklist, the resolved tag, and a summary line", async () => {
    const { logs, exitCode } = await run(["v2.10.2"], fakeSeams());
    const out = logs.join("\n");
    expect(out).toContain("v2.10.2");
    expect(out).toContain("release run");
    expect(out).toContain("release notes");
    expect(out).toContain("releases/latest");
    expect(out).toMatch(/\d+ checks: \d+ ok, \d+ stale, \d+ pending, \d+ unverifiable/);
    expect(exitCode ?? 0).toBe(0);
  });

  test("--no-wait takes a single snapshot instead of polling", async () => {
    let viewCalls = 0;
    const seams = fakeSeams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("run view")) { viewCalls++; return ok(JSON.stringify({ status: "in_progress", conclusion: null })); }
        return fakeSeams().exec(argv);
      },
    });
    const { logs } = await run(["v2.10.2", "--no-wait", "--json"], seams);
    const body = JSON.parse(logs[0]!);
    expect(viewCalls).toBe(1);
    expect(body.pendingCount).toBeGreaterThan(0);
  });
});
