/**
 * `rt settings explain --json`: the machine-readable branch added alongside
 * the wider rt_verb agent-safe set (task 13). Before this, --json on
 * explain was accepted as a declared flag but never read, so the command
 * always printed the colored scope-chain table regardless.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { settingsExplain } from "../settings-keys.ts";

describe("rt settings explain", () => {
  const origHome = process.env.HOME;
  let home: string;
  let logSpy: ReturnType<typeof spyOn<Console, "log">>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-explain-cli-")));
    process.env.HOME = home;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("--json prints exactly one parseable envelope with every scope rung", async () => {
    await settingsExplain(["rt.worktrees", "--json"]);

    expect(logSpy.mock.calls).toHaveLength(1);
    const payload = JSON.parse(logSpy.mock.calls[0]![0] as string);
    expect(payload.ok).toBe(true);
    expect(payload.key).toBe("rt.worktrees");
    expect(payload.rows.map((r: { scope: string }) => r.scope)).toEqual(["default", "team", "user", "machine"]);
    expect(payload.rows[0]).toMatchObject({ scope: "default", present: true, value: { onDeck: 0 } });
  });

  test("without --json prints the human scope-chain table instead", async () => {
    await settingsExplain(["rt.worktrees"]);

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("rt.worktrees"))).toBe(true);
    expect(lines.some((l) => l.startsWith("{"))).toBe(false);
  });
});
