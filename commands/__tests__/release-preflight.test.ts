import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { PreflightSeams } from "../../lib/release/preflight.ts";
import { releasePreflight } from "../release.ts";

const ok = (stdout: string) => Promise.resolve({ stdout, stderr: "", exitCode: 0 });

/** A seam set whose only fault is a stale rt-client (npm behind source). */
function fakeSeams(rtClientSource: string): PreflightSeams {
  return {
    repoRoot: "/repo",
    exec: (argv) => {
      const cmd = argv.join(" ");
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
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    await releasePreflight(args, {}, seams);
    return { logs, exitCode: process.exitCode };
  } finally {
    process.exitCode = before;
    logSpy.mockRestore();
  }
}

afterEach(() => {
  process.exitCode = undefined;
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
