import { describe, expect, test } from "bun:test";
import {
  classifyRows,
  normalizeVersion,
  pinnedTagFromUrl,
  upstreamForToolRow,
  checkGitState,
  checkGate,
  movedServedApps,
  keepsFastPath,
  checkStandaloneRows,
  checkToolRows,
  checkCatalog,
  checkExtension,
  checkSchemaLock,
  runPreflight,
  type PreflightSeams,
  type DepsRow,
} from "../preflight.ts";

const ok = (stdout: string) => Promise.resolve({ stdout, stderr: "", exitCode: 0 });
const failExec = () => Promise.resolve({ stdout: "", stderr: "boom", exitCode: 1 });

function seams(overrides: Partial<PreflightSeams> = {}): PreflightSeams {
  return {
    repoRoot: "/repo",
    exec: () => failExec(),
    fetchJson: () => Promise.reject(new Error("no network in test")),
    readFile: () => null,
    violations: () => [],
    ...overrides,
  };
}

const row = (r: Partial<DepsRow> & { name: string; version: string; url: string }): DepsRow => r as DepsRow;

const APP_ROW = row({
  name: "board", version: "0.1.4", repo: "m4ttstack/apps", subdir: "apps/board",
  url: "https://github.com/m4ttstack/apps/releases/download/board-v0.1.4/board-darwin-arm64.tgz",
});
const GITQ_ROW = row({
  name: "gitq", version: "0.2.1", repo: "m4ttstack/gitq",
  url: "https://github.com/m4ttstack/gitq/releases/download/v0.2.1/gitq-darwin-arm64",
});
const FB_ROW = row({
  name: "fast-browser", version: "0.1.3",
  url: "https://registry.npmjs.org/@mattstack/fast-browser/-/fast-browser-0.1.3.tgz",
});
const GH_ROW = row({
  name: "gh", version: "2.98.0",
  url: "https://github.com/cli/cli/releases/download/v2.98.0/gh_2.98.0_macOS_arm64.zip",
});
const NODE_ROW = row({
  name: "node", version: "24.19.0",
  url: "https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz",
});
const PORTLESS_ROW = row({
  name: "portless", version: "0.15.6",
  url: "https://registry.npmjs.org/portless/-/portless-0.15.6.tgz",
});
const GLAB_ROW = row({
  name: "glab", version: "1.114.0",
  url: "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/1.114.0/glab_1.114.0_darwin_arm64.tar.gz",
});

describe("normalizeVersion", () => {
  test("strips release-tag prefixes down to the bare version", () => {
    expect(normalizeVersion("v1.3.1")).toBe("1.3.1");
    expect(normalizeVersion("jq-1.8.2")).toBe("1.8.2");
    expect(normalizeVersion("bun-v1.4.2")).toBe("1.4.2");
    expect(normalizeVersion("board-v0.1.4")).toBe("0.1.4");
    expect(normalizeVersion("2.9.6")).toBe("2.9.6");
    expect(normalizeVersion("fast-browser-v0.1.1")).toBe("0.1.1");
  });
});

describe("pinnedTagFromUrl", () => {
  test("reads the release tag out of a GitHub download url", () => {
    expect(pinnedTagFromUrl(APP_ROW.url)).toBe("board-v0.1.4");
    expect(pinnedTagFromUrl(GITQ_ROW.url)).toBe("v0.2.1");
  });
  test("null for non-release urls", () => {
    expect(pinnedTagFromUrl(NODE_ROW.url)).toBeNull();
  });
});

describe("classifyRows", () => {
  test("splits standalone repos from everything else", () => {
    const rows = [APP_ROW, GITQ_ROW, FB_ROW, GH_ROW, NODE_ROW];
    const c = classifyRows(rows);
    expect(c.standalone.map((r) => r.name)).toEqual(["gitq", "fast-browser"]);
    expect(c.tools.map((r) => r.name)).toEqual(["board", "gh", "node"]);
  });
  test("a tree row is dropped: it has no upstream url or repo to diff against", () => {
    const treeRow = row({ name: "deck", version: "", url: "", source: "tree" });
    const c = classifyRows([treeRow, APP_ROW, GH_ROW]);
    expect(c.tools.map((r) => r.name)).toEqual(["board", "gh"]);
    expect(c.standalone).toEqual([]);
  });
});

describe("upstreamForToolRow", () => {
  test("github release urls resolve to the repo", () => {
    expect(upstreamForToolRow(GH_ROW)).toEqual({ kind: "github", repo: "cli/cli" });
  });
  test("nodejs.org resolves to the LTS index", () => {
    expect(upstreamForToolRow(NODE_ROW)).toEqual({ kind: "node-lts" });
  });
  test("npm registry urls resolve to the package, scoped included", () => {
    expect(upstreamForToolRow(PORTLESS_ROW)).toEqual({ kind: "npm", pkg: "portless" });
    expect(upstreamForToolRow(FB_ROW)).toEqual({ kind: "npm", pkg: "@mattstack/fast-browser" });
  });
  test("gitlab package urls resolve to the project", () => {
    expect(upstreamForToolRow(GLAB_ROW)).toEqual({ kind: "gitlab", project: "gitlab-org%2Fcli" });
  });
});

describe("checkGitState", () => {
  const gitExec = (branch: string, porcelain: string, tag: string, count: string): PreflightSeams["exec"] =>
    (argv) => {
      const cmd = argv.join(" ");
      if (cmd.includes("--show-current")) return ok(`${branch}\n`);
      if (cmd.includes("status")) return ok(porcelain);
      if (cmd.includes("describe")) return ok(`${tag}\n`);
      if (cmd.includes("rev-list")) return ok(`${count}\n`);
      return failExec();
    };

  test("ok on main, clean, with commits since the tag", async () => {
    const s = seams({ exec: gitExec("main", "", "v2.10.2", "12") });
    const r = await checkGitState(s);
    expect(r.row.status).toBe("ok");
    expect(r.tag).toBe("v2.10.2");
    expect(r.commitsSinceTag).toBe(12);
  });

  test("stale off main or dirty", async () => {
    const off = await checkGitState(seams({ exec: gitExec("feature", "", "v2.10.2", "3") }));
    expect(off.row.status).toBe("stale");
    expect(off.row.detail).toContain("feature");
    const dirty = await checkGitState(seams({ exec: gitExec("main", " M lib/x.ts\n", "v2.10.2", "3") }));
    expect(dirty.row.status).toBe("stale");
  });

  test("error when git itself fails", async () => {
    const r = await checkGitState(seams());
    expect(r.row.status).toBe("error");
    expect(r.tag).toBeNull();
  });
});

function seamsWithDiff(files: string[]): PreflightSeams {
  return seams({
    exec: (argv) => {
      const cmd = argv.join(" ");
      if (cmd.includes("diff")) return ok(files.join("\n"));
      return failExec();
    },
  });
}

describe("checkGate by path", () => {
  const gate = (files: string[]) => checkGate(seamsWithDiff(files), "v2.13.0");
  test("a served app plus notes and website is fast", async () => {
    expect((await gate(["apps/board/src/a.ts", "RELEASE_NOTES.md", "website/docs/x.md"])).path).toBe("fast");
  });
  test("deck alone is full", async () => {
    expect((await gate(["apps/deck/src/main.ts"])).path).toBe("full");
  });
  test("a served app plus rt code is full", async () => {
    const g = await gate(["apps/board/src/a.ts", "lib/daemon.ts"]);
    expect(g.path).toBe("full");
    expect(g.reason).toContain("lib/daemon.ts");
  });
  test("notes alone is full: no served app moved", async () => {
    expect((await gate(["RELEASE_NOTES.md"])).path).toBe("full");
  });
  test("no diff is full", async () => {
    expect((await gate([])).path).toBe("full");
  });
  test("a named ref diffs against that ref", async () => {
    const calls: string[] = [];
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        calls.push(cmd);
        if (cmd === "git diff --name-only v2.10.2..origin/main") return ok("apps/board/src/a.ts\n");
        return failExec();
      },
    });
    const g = await checkGate(s, "v2.10.2", "origin/main");
    expect(g.path).toBe("fast");
    expect(calls).toContain("git diff --name-only v2.10.2..origin/main");
  });
  test("keepsFastPath names exactly the serve-only apps", () => {
    for (const name of ["board", "boxscore", "chat", "console", "gitq"]) expect(keepsFastPath(name)).toBe(true);
    for (const name of ["deck", "fast-browser", "bun"]) expect(keepsFastPath(name)).toBe(false);
  });
});

test("movedServedApps names each served app directory in the diff once", () => {
  expect(movedServedApps(["apps/chat/a.ts", "apps/chat/b.ts", "apps/gitq/x.ts", "apps/deck/y.ts", "lib/z.ts"])).toEqual(["chat", "gitq"]);
});

describe("checkStandaloneRows", () => {
  test("falls back to the repo's package.json only on a 404 (no releases)", async () => {
    const notFound = () => Promise.resolve({ stdout: "", stderr: "gh: Not Found (HTTP 404)", exitCode: 1 });
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("releases/latest")) return notFound();
        if (cmd.includes("contents/package.json")) return ok(Buffer.from(JSON.stringify({ version: "0.1.3" })).toString("base64"));
        return failExec();
      },
    });
    const rows = await checkStandaloneRows(s, [FB_ROW]);
    expect(rows[0]!.status).toBe("ok");
    expect(rows[0]!.detail).toContain("package.json");
  });

  test("a transient releases/latest failure is an error row, never a silent fallback", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("contents/package.json")) return ok(Buffer.from(JSON.stringify({ version: "0.1.3" })).toString("base64"));
        return failExec();
      },
    });
    const rows = await checkStandaloneRows(s, [FB_ROW]);
    expect(rows[0]!.status).toBe("error");
  });

  test("compares each row against its repo's latest release", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("m4ttstack/gitq")) return ok("v0.2.1\n");
        if (cmd.includes("m4ttstack/fast-browser")) return ok("v0.1.4\n");
        return failExec();
      },
    });
    const rows = await checkStandaloneRows(s, [GITQ_ROW, FB_ROW]);
    expect(rows.find((r) => r.id === "standalone:gitq")!.status).toBe("ok");
    const fb = rows.find((r) => r.id === "standalone:fast-browser")!;
    expect(fb.status).toBe("stale");
    expect(fb.current).toBe("0.1.4");
  });
});

describe("checkToolRows", () => {
  test("github, npm, node-lts, and gitlab upstreams all compare", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("cli/cli")) return ok("v2.99.0\n");
        return failExec();
      },
      fetchJson: (url) => {
        if (url.includes("nodejs.org")) return Promise.resolve([{ version: "v24.19.0", lts: "Krypton" }]);
        if (url.includes("registry.npmjs.org/portless")) return Promise.resolve({ version: "0.15.6" });
        if (url.includes("gitlab.com")) return Promise.resolve([{ tag_name: "v1.114.0" }]);
        return Promise.reject(new Error(`unexpected ${url}`));
      },
    });
    const rows = await checkToolRows(s, [GH_ROW, NODE_ROW, PORTLESS_ROW, GLAB_ROW]);
    expect(rows.find((r) => r.id === "tool:gh")!.status).toBe("stale");
    expect(rows.find((r) => r.id === "tool:gh")!.current).toBe("2.99.0");
    expect(rows.find((r) => r.id === "tool:node")!.status).toBe("ok");
    expect(rows.find((r) => r.id === "tool:portless")!.status).toBe("ok");
    expect(rows.find((r) => r.id === "tool:glab")!.status).toBe("ok");
  });

  test("skips non-LTS entries when resolving node", async () => {
    const s = seams({
      fetchJson: () => Promise.resolve([{ version: "v25.0.0", lts: false }, { version: "v24.19.0", lts: "Krypton" }]),
    });
    const rows = await checkToolRows(s, [NODE_ROW]);
    expect(rows[0]!.status).toBe("ok");
  });
});

describe("checkCatalog", () => {
  const catalog = JSON.stringify({
    name: "mattstack",
    plugins: [
      { name: "chat", source: "./plugins/chat" },
      { name: "mattstack", source: { source: "url", url: "https://github.com/m4ttstack/mattstack-skills.git", ref: "main", sha: "a".repeat(40) } },
      { name: "pinned", source: { source: "url", url: "https://example.com/x.git", sha: "c".repeat(40) } },
    ],
  });

  test("a plugin entry with no source is an error row, not a crash", async () => {
    const broken = JSON.stringify({ name: "m", plugins: [{ name: "broken" }] });
    const s = seams({ readFile: (p) => (p.endsWith("marketplace.json") ? broken : null) });
    const rows = await checkCatalog(s);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("error");
  });

  test("drift when a pinned ref's head moved", async () => {
    const s = seams({
      readFile: (p) => (p.endsWith("marketplace.json") ? catalog : null),
      exec: () => ok(`${"b".repeat(40)}\trefs/heads/main\n`),
    });
    const rows = await checkCatalog(s);
    const m = rows.find((r) => r.id === "catalog:mattstack")!;
    expect(m.status).toBe("stale");
    const inTree = rows.find((r) => r.id === "catalog:chat")!;
    expect(inTree.status).toBe("ok");
    const noRef = rows.find((r) => r.id === "catalog:pinned")!;
    expect(noRef.status).toBe("ok");
  });

  test("ok when the pin matches the ref head", async () => {
    const s = seams({
      readFile: (p) => (p.endsWith("marketplace.json") ? catalog : null),
      exec: () => ok(`${"a".repeat(40)}\trefs/heads/main\n`),
    });
    const rows = await checkCatalog(s);
    expect(rows.find((r) => r.id === "catalog:mattstack")!.status).toBe("ok");
  });
});

describe("checkExtension", () => {
  const lock = {
    runtime: { url: "https://github.com/m4ttheweric/playwright/releases/download/fast-browser-v0.1.1/fast-browser-mcp-0.1.1.tar.gz" },
    extension: { version: "0.2.11" },
  };
  const extExec = (tags: string[]): PreflightSeams["exec"] =>
    (argv) => {
      const cmd = argv.join(" ");
      if (cmd.includes("contents/runtime-lock.json")) return ok(Buffer.from(JSON.stringify(lock)).toString("base64"));
      if (cmd.includes("m4ttheweric/playwright")) return ok(JSON.stringify(tags.map((t) => ({ tag_name: t }))));
      return failExec();
    };

  test("ok when the pinned fork release is the newest fast-browser-v*", async () => {
    const r = await checkExtension(seams({ exec: extExec(["fast-browser-v0.1.1", "v1.99.0"]) }));
    expect(r.status).toBe("ok");
  });

  test("stale when the fork has a newer fast-browser-v* release", async () => {
    const r = await checkExtension(seams({ exec: extExec(["fast-browser-v0.1.2", "fast-browser-v0.1.1"]) }));
    expect(r.status).toBe("stale");
    expect(r.current).toBe("0.1.2");
  });

  test("picks the highest fork version even when the list is not newest-first", async () => {
    const r = await checkExtension(seams({ exec: extExec(["fast-browser-v0.1.1", "fast-browser-v0.1.10", "fast-browser-v0.1.2"]) }));
    expect(r.status).toBe("stale");
    expect(r.current).toBe("0.1.10");
  });
});

describe("runPreflight", () => {
  test("aggregates rows, counts, and the clean flag", async () => {
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd.includes("--show-current")) return ok("main\n");
        if (cmd.includes("status")) return ok("");
        if (cmd.includes("describe")) return ok("v2.10.2\n");
        if (cmd.includes("rev-list")) return ok("4\n");
        if (cmd.includes("diff")) return ok("lib/x.ts\n");
        return failExec();
      },
      readFile: (p) => {
        if (p.endsWith("deps.lock")) return JSON.stringify({ schema: 1, arch: "arm64", tools: [] });
        if (p.endsWith("marketplace.json")) return JSON.stringify({ name: "m", plugins: [] });
        if (p.endsWith("packages/rt-client/package.json")) return JSON.stringify({ version: "0.20.0" });
        return null;
      },
      fetchJson: (url) =>
        url.includes("rt-client") ? Promise.resolve({ version: "0.20.0" }) : Promise.reject(new Error("x")),
      violations: () => [{ path: "release preflight" }],
    });
    const report = await runPreflight(s);
    expect(report.tag).toBe("v2.10.2");
    expect(report.gate?.path).toBe("full");
    const picker = report.rows.find((r) => r.id === "picker")!;
    expect(picker.status).toBe("stale");
    // git ok, picker stale, extension error (exec fails)
    expect(report.staleCount).toBeGreaterThanOrEqual(1);
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
    expect(report.clean).toBe(false);
  });

  test("clean report exits clean", async () => {
    const schemaLock = JSON.stringify({ "t.k": { storeVersion: 1, schema: { type: "string" } } });
    const s = seams({
      exec: (argv) => {
        const cmd = argv.join(" ");
        if (cmd === "bun run cli.ts settings check --json") return ok('{"ok":true,"findings":[]}\n');
        if (cmd === "git show v2.10.2:packages/rt-client/src/settings/schema.lock.json") return ok(schemaLock);
        if (cmd.includes("--show-current")) return ok("main\n");
        if (cmd.includes("status")) return ok("");
        if (cmd.includes("describe")) return ok("v2.10.2\n");
        if (cmd.includes("rev-list")) return ok("4\n");
        if (cmd.includes("diff")) return ok("");
        if (cmd.includes("contents/runtime-lock.json")) {
          return ok(Buffer.from(JSON.stringify({ runtime: { url: "https://github.com/m4ttheweric/playwright/releases/download/fast-browser-v0.1.1/x.tar.gz" }, extension: {} })).toString("base64"));
        }
        if (cmd.includes("m4ttheweric/playwright")) return ok(JSON.stringify([{ tag_name: "fast-browser-v0.1.1" }]));
        return failExec();
      },
      readFile: (p) => {
        if (p.endsWith("deps.lock")) return JSON.stringify({ schema: 1, arch: "arm64", tools: [] });
        if (p.endsWith("marketplace.json")) return JSON.stringify({ name: "m", plugins: [] });
        if (p.endsWith("packages/rt-client/package.json")) return JSON.stringify({ version: "0.20.0" });
        if (p.endsWith("packages/rt-client/src/settings/schema.lock.json")) return schemaLock;
        if (p.endsWith("packages/rt-client/src/settings/breaking-schema-changes.json")) return "{}";
        return null;
      },
      fetchJson: (url) =>
        url.includes("rt-client") ? Promise.resolve({ version: "0.20.0" }) : Promise.reject(new Error("x")),
    });
    const report = await runPreflight(s);
    expect(report.errorCount).toBe(0);
    expect(report.staleCount).toBe(0);
    expect(report.clean).toBe(true);
  });
});

describe("checkSchemaLock", () => {
  const LOCK = "packages/rt-client/src/settings/schema.lock.json";
  const committed = JSON.stringify({ "t.k": { storeVersion: 1, schema: { type: "string" } } });
  const lockSeams = (show: { exitCode: number; stdout?: string; stderr?: string }) =>
    seams({
      exec: (argv) =>
        argv.join(" ") === `git show v2.10.2:${LOCK}` ? Promise.resolve({ stdout: "", stderr: "", ...show }) : failExec(),
      readFile: (p) => (p.endsWith(LOCK) ? committed : p.endsWith("breaking-schema-changes.json") ? "{}" : null),
    });

  test("a lock path missing at the tag is ok with no lock at <tag>", async () => {
    const row = await checkSchemaLock(lockSeams({ exitCode: 128, stderr: `fatal: path '${LOCK}' does not exist in 'v2.10.2'` }), "v2.10.2");
    expect(row).toMatchObject({ status: "ok", detail: "no lock at v2.10.2" });
  });

  test("any other git show failure is an error row", async () => {
    const row = await checkSchemaLock(lockSeams({ exitCode: 128, stderr: "fatal: bad object v2.10.2" }), "v2.10.2");
    expect(row.status).toBe("error");
    expect(row.detail).toContain("bad object");
  });

  test("a malformed lock at the tag is an error row", async () => {
    const row = await checkSchemaLock(lockSeams({ exitCode: 0, stdout: "{ not json" }), "v2.10.2");
    expect(row.status).toBe("error");
    expect(row.detail).toContain("v2.10.2");
  });
});
