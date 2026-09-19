import { describe, expect, test } from "bun:test";
import {
  requiredAssetNames,
  resolveTag,
  checkReleaseBody,
  checkReleaseAssets,
  checkReleaseState,
  checkLatest,
  checkRun,
  runVerify,
  type VerifySeams,
  type ReleaseData,
} from "../verify.ts";

const ok = (stdout: string) => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr: string) => Promise.resolve({ stdout: "", stderr, exitCode: 1 });

function seams(overrides: Partial<VerifySeams> = {}): VerifySeams {
  const sleeps: number[] = [];
  return {
    repoRoot: "/repo",
    exec: () => fail("no handler"),
    fetchJson: () => Promise.reject(new Error("no network in test")),
    now: () => 1_000_000,
    sleep: async (ms) => { sleeps.push(ms); },
    ...overrides,
  };
}

const RELEASE: ReleaseData = {
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

describe("requiredAssetNames", () => {
  test("derives the four asset names from a tag", () => {
    expect(requiredAssetNames("v2.10.2")).toEqual([
      "mattstack-2.10.2.dmg",
      "mattstack-2.10.2.zip",
      "appcast.xml",
      "SHA256SUMS",
    ]);
  });
});

describe("resolveTag", () => {
  test("resolves via the latest local v* tag, version-sorted", async () => {
    const s = seams({ exec: (argv) => (argv.join(" ").includes("tag --list") ? ok("v2.10.2\nv2.10.1\nv2.9.0\n") : fail("unexpected")) });
    const r = await resolveTag(s);
    expect(r.tag).toBe("v2.10.2");
    expect(r.row?.status).toBe("ok");
    expect(r.row?.detail).toContain("local v* tag");
  });

  test("prefers the local v* tag over anything git describe would report as nearest", async () => {
    // git describe --tags --abbrev=0 would happily return a nearer non-v tag;
    // resolveTag never calls it, so that ambiguity cannot leak in.
    const s = seams({ exec: (argv) => (argv.join(" ").includes("tag --list") ? ok("v2.10.2\n") : fail("unexpected")) });
    const r = await resolveTag(s);
    expect(r.tag).toBe("v2.10.2");
  });

  test("falls back to the newest GitHub release when no local v* tag exists", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("tag --list")) return ok("");
        if (cmd.includes("releases/latest")) return ok("v2.10.2\n");
        return fail("unexpected");
      },
    });
    const r = await resolveTag(s);
    expect(r.tag).toBe("v2.10.2");
    expect(r.row?.detail).toContain("newest GitHub release");
  });

  test("falls back when listing local tags itself fails", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("tag --list")) return fail("not a git repo");
        if (cmd.includes("releases/latest")) return ok("v2.10.2\n");
        return fail("unexpected");
      },
    });
    const r = await resolveTag(s);
    expect(r.tag).toBe("v2.10.2");
  });

  test("errors when both local tag listing and the GitHub API fail", async () => {
    const s = seams({ exec: () => fail("nope") });
    const r = await resolveTag(s);
    expect(r.tag).toBeNull();
    expect(r.row?.status).toBe("error");
  });
});

describe("checkRun", () => {
  // findRun filters server-side (event=push&branch=<tag>) so it finds any
  // tag's run in one call, not just one among the newest N.
  const runsFor = (id: number, url: string) => JSON.stringify({ workflow_runs: [{ id, html_url: url }] });
  const NO_RUNS = JSON.stringify({ workflow_runs: [] });
  const FOUND = runsFor(111, "https://github.com/m4ttstack/rt/actions/runs/111");

  test("ok when the tag's run is completed and successful", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) return ok(FOUND);
        if (cmd.includes("run view")) return ok(JSON.stringify({ status: "completed", conclusion: "success" }));
        return fail("unexpected");
      },
    });
    const row = await checkRun(s, "v2.10.2", false);
    expect(row.status).toBe("ok");
    expect(row.detail).toContain("111");
  });

  test("filters the run lookup by the exact tag, not just the newest runs", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) {
          expect(cmd).toContain("event=push");
          expect(cmd).toContain("branch=v0.1.0");
          return ok(runsFor(999, "https://x/999"));
        }
        if (cmd.includes("run view")) return ok(JSON.stringify({ status: "completed", conclusion: "success" }));
        return fail("unexpected");
      },
    });
    const row = await checkRun(s, "v0.1.0", false);
    expect(row.status).toBe("ok");
    expect(row.detail).toContain("999");
  });

  test("stale with a recovery hint when the run completed but failed", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) return ok(FOUND);
        if (cmd.includes("run view")) return ok(JSON.stringify({ status: "completed", conclusion: "failure" }));
        return fail("unexpected");
      },
    });
    const row = await checkRun(s, "v2.10.2", false);
    expect(row.status).toBe("stale");
    expect(row.detail).toContain("gh release delete");
    expect(row.detail).toContain("gh run rerun");
  });

  test("error when no push run matches the tag", async () => {
    const s = seams({ exec: (argv) => (argv.join(" ").includes("actions/workflows") ? ok(NO_RUNS) : fail("unexpected")) });
    const row = await checkRun(s, "v9.9.9", false);
    expect(row.status).toBe("error");
    expect(row.detail).toContain("v9.9.9");
  });

  test("error when the run lookup itself fails", async () => {
    const s = seams({ exec: () => fail("rate limited") });
    const row = await checkRun(s, "v2.10.2", false);
    expect(row.status).toBe("error");
  });

  test("tolerates transient poll failures and still reaches completed", async () => {
    let viewCalls = 0;
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) return ok(FOUND);
        if (cmd.includes("run view")) {
          viewCalls++;
          if (viewCalls < 3) return fail("transient api error");
          return ok(JSON.stringify({ status: "completed", conclusion: "success" }));
        }
        return fail("unexpected");
      },
    });
    const row = await checkRun(s, "v2.10.2", false);
    expect(row.status).toBe("ok");
    expect(viewCalls).toBe(3);
  });

  test("pending after exhausting bounded polling with no completion", async () => {
    const sleeps: number[] = [];
    const s = seams({
      sleep: async (ms) => { sleeps.push(ms); },
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) return ok(FOUND);
        if (cmd.includes("run view")) return ok(JSON.stringify({ status: "in_progress", conclusion: null }));
        return fail("unexpected");
      },
    });
    const row = await checkRun(s, "v2.10.2", false);
    expect(row.status).toBe("pending");
    expect(sleeps.length).toBeGreaterThan(0);
  });

  test("error (not pending) when every poll attempt fails to reach gh", async () => {
    const s = seams({
      sleep: async () => {},
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) return ok(FOUND);
        if (cmd.includes("run view")) return fail("connection reset");
        return fail("unexpected");
      },
    });
    const row = await checkRun(s, "v2.10.2", false);
    expect(row.status).toBe("error");
    expect(row.detail).toContain("111");
  });

  test("--no-wait takes a single snapshot with no sleeping", async () => {
    const sleeps: number[] = [];
    let viewCalls = 0;
    const s = seams({
      sleep: async (ms) => { sleeps.push(ms); },
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) return ok(FOUND);
        if (cmd.includes("run view")) { viewCalls++; return ok(JSON.stringify({ status: "in_progress", conclusion: null })); }
        return fail("unexpected");
      },
    });
    const row = await checkRun(s, "v2.10.2", true);
    expect(row.status).toBe("pending");
    expect(viewCalls).toBe(1);
    expect(sleeps.length).toBe(0);
  });
});

describe("checkReleaseBody", () => {
  test("ok when the release body matches the committed RELEASE_NOTES.md", async () => {
    const s = seams({ exec: () => ok("notes\n") });
    const row = await checkReleaseBody(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("ok");
  });

  test("stale when the release body differs", async () => {
    const s = seams({ exec: () => ok("different notes\n") });
    const row = await checkReleaseBody(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("stale");
  });

  test("error when git show fails", async () => {
    const s = seams({ exec: () => fail("unknown revision") });
    const row = await checkReleaseBody(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("error");
  });
});

describe("checkReleaseAssets", () => {
  test("ok when all four assets are attached", () => {
    const row = checkReleaseAssets("v2.10.2", RELEASE);
    expect(row.status).toBe("ok");
  });

  test("stale listing the missing assets", () => {
    const row = checkReleaseAssets("v2.10.2", { ...RELEASE, assets: [{ name: "appcast.xml" }] });
    expect(row.status).toBe("stale");
    expect(row.detail).toContain("mattstack-2.10.2.dmg");
    expect(row.detail).toContain("SHA256SUMS");
  });
});

describe("checkReleaseState", () => {
  test("ok when published and not prerelease", () => {
    const row = checkReleaseState(RELEASE);
    expect(row.status).toBe("ok");
  });

  test("stale with a recovery hint when still a draft", () => {
    const row = checkReleaseState({ ...RELEASE, isDraft: true });
    expect(row.status).toBe("stale");
    expect(row.detail).toContain("gh release edit");
    expect(row.detail).toContain("--draft=false");
  });

  test("stale when marked prerelease", () => {
    const row = checkReleaseState({ ...RELEASE, isPrerelease: true });
    expect(row.status).toBe("stale");
  });
});

describe("checkLatest", () => {
  test("ok when the endpoint already resolves to the tag with all assets", async () => {
    const s = seams({ fetchJson: () => Promise.resolve({ tag_name: "v2.10.2", assets: RELEASE.assets }) });
    const row = await checkLatest(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("ok");
  });

  test("pending within the propagation window when the endpoint lags", async () => {
    const s = seams({
      now: () => new Date("2026-09-18T21:15:00Z").getTime(),
      fetchJson: () => Promise.resolve({ tag_name: "v2.10.1", assets: [] }),
    });
    const row = await checkLatest(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("pending");
  });

  test("stale once the propagation window has passed", async () => {
    const s = seams({
      now: () => new Date("2026-09-18T22:00:00Z").getTime(),
      fetchJson: () => Promise.resolve({ tag_name: "v2.10.1", assets: [] }),
    });
    const row = await checkLatest(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("stale");
  });

  test("stale (not pending) when the mismatch is a draft still not flipped public", async () => {
    const s = seams({
      now: () => new Date("2026-09-18T21:08:00Z").getTime(),
      fetchJson: () => Promise.resolve({ tag_name: "v2.10.1", assets: [] }),
    });
    const row = await checkLatest(s, "v2.10.2", { ...RELEASE, isDraft: true });
    expect(row.status).toBe("stale");
    expect(row.detail).toContain("draft");
  });

  test("stale with a missing-assets message when the tag already matches but an asset is still missing, even past the window", async () => {
    const s = seams({
      now: () => new Date("2026-09-18T22:00:00Z").getTime(),
      fetchJson: () => Promise.resolve({ tag_name: "v2.10.2", assets: [{ name: "appcast.xml" }] }),
    });
    const row = await checkLatest(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("stale");
    expect(row.detail).not.toContain("not v2.10.2");
    expect(row.detail).toContain("missing");
    expect(row.detail).toContain("mattstack-2.10.2.dmg");
  });

  test("error when the endpoint fetch throws", async () => {
    const s = seams({ fetchJson: () => Promise.reject(new Error("network down")) });
    const row = await checkLatest(s, "v2.10.2", RELEASE);
    expect(row.status).toBe("error");
  });
});

describe("runVerify", () => {
  const RUNS = JSON.stringify({ workflow_runs: [{ id: 111, html_url: "https://github.com/m4ttstack/rt/actions/runs/111" }] });

  function happyPathSeams(): VerifySeams {
    return seams({
      now: () => new Date("2026-09-18T21:08:00Z").getTime(),
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("actions/workflows")) return ok(RUNS);
        if (cmd.includes("run view")) return ok(JSON.stringify({ status: "completed", conclusion: "success" }));
        if (cmd.includes("git show")) return ok(RELEASE.body);
        if (cmd.includes("release view")) return ok(JSON.stringify(RELEASE));
        return fail("unexpected");
      },
      fetchJson: () => Promise.resolve({ tag_name: "v2.10.2", assets: RELEASE.assets }),
    });
  }

  test("clean report when every check passes for an explicit tag", async () => {
    const report = await runVerify(happyPathSeams(), { tag: "v2.10.2" });
    expect(report.tag).toBe("v2.10.2");
    expect(report.clean).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.staleCount).toBe(0);
    expect(report.pendingCount).toBe(0);
  });

  test("does not add a tag-resolution row when the tag is given explicitly", async () => {
    const report = await runVerify(happyPathSeams(), { tag: "v2.10.2" });
    expect(report.rows.find((r) => r.id === "tag")).toBeUndefined();
  });

  test("resolves the tag itself and adds a tag row when none is given", async () => {
    const s = happyPathSeams();
    const withTagList: VerifySeams = {
      ...s,
      exec: (argv, opts) => (argv.join(" ").includes("tag --list") ? ok("v2.10.2\n") : s.exec(argv, opts)),
    };
    const report = await runVerify(withTagList, {});
    expect(report.tag).toBe("v2.10.2");
    expect(report.rows.find((r) => r.id === "tag")?.status).toBe("ok");
  });

  test("short-circuits to a single error row when no tag can be resolved", async () => {
    const report = await runVerify(seams({ exec: () => fail("nope") }), {});
    expect(report.tag).toBeNull();
    expect(report.clean).toBe(false);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.status).toBe("error");
  });

  test("not clean when a layer is stale", async () => {
    const s = happyPathSeams();
    const withBadAssets: VerifySeams = {
      ...s,
      exec: (argv, opts) => (argv.join(" ").includes("release view") ? ok(JSON.stringify({ ...RELEASE, assets: [] })) : s.exec(argv, opts)),
    };
    const report = await runVerify(withBadAssets, { tag: "v2.10.2" });
    expect(report.clean).toBe(false);
    expect(report.staleCount).toBeGreaterThan(0);
  });
});
