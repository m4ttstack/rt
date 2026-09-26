import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { PreflightSeams } from "../../lib/release/preflight.ts";
import { releasePreflight } from "../release.ts";

const ok = (stdout: string) => Promise.resolve({ stdout, stderr: "", exitCode: 0 });

const LOCK_REL = "packages/rt-client/src/settings/schema.lock.json";
const COMMITTED_LOCK = readFileSync(join(import.meta.dir, "..", "..", LOCK_REL), "utf8");

/**
 * A seam set whose only fault is a stale rt-client (npm behind source).
 * `prevLock` is what `git show <tag>:<lock>` answers; null makes git exit non-zero.
 */
function fakeSeams(
  rtClientSource: string,
  prevLock: string | null = COMMITTED_LOCK,
  committedLock: string = COMMITTED_LOCK,
  settingsCheck: string = '{"ok":true,"findings":[]}',
): PreflightSeams {
  return {
    repoRoot: "/repo",
    exec: (argv) => {
      const cmd = argv.join(" ");
      if (cmd === "bun run cli.ts settings check --json") return ok(`${settingsCheck}\n`);
      if (cmd === `git show v2.10.2:${LOCK_REL}`) {
        return prevLock === null
          ? Promise.resolve({ stdout: "", stderr: `fatal: path '${LOCK_REL}' does not exist in 'v2.10.2'`, exitCode: 128 })
          : ok(prevLock);
      }
      if (cmd.includes("--show-current")) return ok("main\n");
      if (cmd.includes("status")) return ok("");
      if (cmd.includes("describe")) return ok("v2.10.2\n");
      if (cmd.includes("rev-list")) return ok("4\n");
      if (cmd.includes("diff")) return ok("");
      if (cmd.includes("contents/runtime-lock.json")) {
        return ok(Buffer.from(JSON.stringify({
          runtime: { url: "https://github.com/m4ttheweric/playwright/releases/download/fast-browser-v0.1.1/x.tar.gz" },
          extension: {},
        })).toString("base64"));
      }
      if (cmd.includes("m4ttheweric/playwright")) return ok(JSON.stringify([{ tag_name: "fast-browser-v0.1.1" }]));
      return Promise.resolve({ stdout: "", stderr: "nope", exitCode: 1 });
    },
    fetchJson: (url) =>
      url.includes("rt-client") ? Promise.resolve({ version: "0.20.0" }) : Promise.reject(new Error("offline")),
    readFile: (p) => {
      if (p.endsWith("deps.lock")) return JSON.stringify({ schema: 1, arch: "arm64", tools: [] });
      if (p.endsWith("marketplace.json")) return JSON.stringify({ name: "m", plugins: [] });
      if (p.endsWith("packages/rt-client/package.json")) return JSON.stringify({ version: rtClientSource });
      if (p === join("/repo", LOCK_REL)) return committedLock;
      if (p === join("/repo", "packages/rt-client/src/settings/breaking-schema-changes.json")) return "{}";
      return null;
    },
    violations: () => [],
  };
}

async function run(args: string[], seams: PreflightSeams): Promise<{ logs: string[]; exitCode: number | string | undefined }> {
  const logs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  // Bun's process.exitCode setter ignores undefined once the value is truthy; 0 is the only value that clears it.
  const before = process.exitCode;
  process.exitCode = 0;
  try {
    await releasePreflight(args, {}, seams);
    return { logs, exitCode: process.exitCode };
  } finally {
    process.exitCode = before ?? 0;
    logSpy.mockRestore();
  }
}

afterEach(() => {
  process.exitCode = 0;
});

describe("rt release preflight", () => {
  test("--json prints the contract envelope and exits clean when nothing is stale", async () => {
    const { logs, exitCode } = await run(["--json"], fakeSeams("0.20.0"));
    expect(logs).toHaveLength(1);
    const body = JSON.parse(logs[0]!);
    expect(body.contract).toBe(1);
    expect(body.tag).toBe("v2.10.2");
    expect(body.clean).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(exitCode ?? 0).toBe(0);
  });

  test("--json exits 1 when a layer is stale", async () => {
    const { logs, exitCode } = await run(["--json"], fakeSeams("0.21.0"));
    const body = JSON.parse(logs[0]!);
    expect(body.clean).toBe(false);
    expect(body.staleCount).toBe(1);
    expect(exitCode).toBe(1);
  });

  test("human output renders a checklist and a summary line", async () => {
    const { logs, exitCode } = await run([], fakeSeams("0.21.0"));
    const out = logs.join("\n");
    expect(out).toContain("git state");
    expect(out).toContain("rt-client");
    expect(out).toContain("gate:");
    expect(out).toMatch(/1 stale/);
    expect(exitCode).toBe(1);
  });
});

describe("rt release preflight schema-lock row", () => {
  const schemaRow = async (seams: PreflightSeams) => {
    const { logs } = await run(["--json"], seams);
    return (JSON.parse(logs[0]!).rows as { id: string; label: string; status: string; detail?: string }[]).find((r) => r.id === "schema-lock");
  };

  test("the committed lock matching the tag's lock is ok", async () => {
    expect(await schemaRow(fakeSeams("0.20.0"))).toMatchObject({ label: "schema lock", status: "ok" });
  });

  test("a key narrowed since the tag without a storeVersion bump is stale and named", async () => {
    const committed = JSON.parse(COMMITTED_LOCK) as Record<string, { storeVersion: number; schema: Record<string, unknown> }>;
    const key = Object.keys(committed)[0]!;
    const prev = { ...committed, [key]: { ...committed[key]!, schema: { ...committed[key]!.schema, type: [committed[key]!.schema.type, "null"] } } };

    const row = await schemaRow(fakeSeams("0.20.0", JSON.stringify(prev)));

    expect(row?.status).toBe("stale");
    expect(row?.detail).toContain(key);
  });

  test("no lock at the tag is ok and says so", async () => {
    expect(await schemaRow(fakeSeams("0.20.0", null))).toMatchObject({ status: "ok", detail: "no lock at v2.10.2" });
  });

  test("a bump since the tag with a matching migrateFrom entry is ok and lists the bump for the release notes", async () => {
    const tagLock = JSON.parse(COMMITTED_LOCK) as Record<string, { storeVersion: number; schema: Record<string, unknown> }>;
    const key = Object.keys(tagLock)[0]!;
    const bumped = { ...tagLock, [key]: { storeVersion: 2, schema: { type: "boolean" }, migrateFrom: { "1": tagLock[key]!.schema } } };
    const row = await schemaRow(fakeSeams("0.20.0", COMMITTED_LOCK, JSON.stringify(bumped)));
    expect(row?.status).toBe("ok");
    expect(row?.detail).toContain(`storeVersion bumps for the release notes: ${key} 1 -> 2`);
  });

  test("a key renamed and bumped since the tag lists the old name's storeVersion in the release notes", async () => {
    const tagLock = JSON.parse(COMMITTED_LOCK) as Record<string, { storeVersion: number; schema: Record<string, unknown> }>;
    const oldKey = Object.keys(tagLock)[0]!;
    const oldEntry = tagLock[oldKey]!;
    const heirKey = `${oldKey}.renamed`;
    const { [oldKey]: _removed, ...rest } = tagLock;
    const committed = {
      ...rest,
      [heirKey]: {
        storeVersion: oldEntry.storeVersion + 1,
        schema: { type: "boolean" },
        renamedFrom: [oldKey],
        migrateFrom: { [String(oldEntry.storeVersion)]: oldEntry.schema },
      },
    };

    const row = await schemaRow(fakeSeams("0.20.0", COMMITTED_LOCK, JSON.stringify(committed)));

    expect(row?.status).toBe("ok");
    expect(row?.detail).toContain(
      `storeVersion bumps for the release notes: ${oldKey} -> ${heirKey} ${oldEntry.storeVersion} -> ${oldEntry.storeVersion + 1}`,
    );
  });

  test("a bump since the tag with no migrateFrom entry is stale", async () => {
    const tagLock = JSON.parse(COMMITTED_LOCK) as Record<string, { storeVersion: number; schema: Record<string, unknown> }>;
    const key = Object.keys(tagLock)[0]!;
    const bumped = { ...tagLock, [key]: { storeVersion: 2, schema: { type: "boolean" } } };
    const row = await schemaRow(fakeSeams("0.20.0", COMMITTED_LOCK, JSON.stringify(bumped)));
    expect(row?.status).toBe("stale");
    expect(row?.detail).toContain(`${key}: no migrateFrom entry for version 1`);
  });
});

describe("rt release preflight settings-stores row", () => {
  const storesRow = async (seams: PreflightSeams) => {
    const { logs } = await run(["--json"], seams);
    return (JSON.parse(logs[0]!).rows as { id: string; label: string; status: string; detail?: string }[]).find((r) => r.id === "settings-stores");
  };

  test("a clean check of the real stores is ok", async () => {
    expect(await storesRow(fakeSeams("0.20.0"))).toMatchObject({ label: "settings stores", status: "ok" });
  });

  test("a value the migrations cannot carry, or a diverged name, is stale and named", async () => {
    const report = JSON.stringify({
      ok: false,
      findings: [
        { key: "rt.notify.eventBridges", scope: "user", kind: "nonconforming", issues: [{ path: [], message: "migration 1 -> 2 threw: boom" }] },
        { key: "rt.roles", scope: "team", repo: "gitlab.example.com/acme/app", kind: "diverged", storeName: "rt.roles", issues: [] },
        { key: "rt.worktrees", scope: "user", kind: "stale", storeName: "rt.worktrees", issues: [] },
      ],
    });
    const row = await storesRow(fakeSeams("0.20.0", COMMITTED_LOCK, COMMITTED_LOCK, report));
    expect(row?.status).toBe("stale");
    expect(row?.detail).toBe("rt.notify.eventBridges nonconforming in user; rt.roles diverged (rt.roles) in team/gitlab.example.com/acme/app");
  });

  test("no JSON from the check is an error", async () => {
    expect((await storesRow(fakeSeams("0.20.0", COMMITTED_LOCK, COMMITTED_LOCK, "boom")))?.status).toBe("error");
  });

  test("a repo-level merged finding (no scope) still names its repo", async () => {
    const report = JSON.stringify({
      ok: false,
      findings: [{ key: "rt.repoRoots", repo: "gitlab.example.com/acme/app", kind: "merged", storeName: "rt.repoRoots", issues: [] }],
    });
    const row = await storesRow(fakeSeams("0.20.0", COMMITTED_LOCK, COMMITTED_LOCK, report));
    expect(row?.status).toBe("stale");
    expect(row?.detail).toBe("rt.repoRoots merged (rt.repoRoots) in gitlab.example.com/acme/app");
  });
});
