import { describe, expect, test } from "bun:test";
import { createFileActions } from "../file-actions.ts";

function recorder(status: number | null = 0) {
  const calls: unknown[][] = [];
  const spawnSync = ((...args: unknown[]) => { calls.push(args); return { status }; }) as never;
  return { calls, actions: createFileActions(spawnSync) };
}

describe("file actions (rt nav's calls, lifted)", () => {
  test("copy pipes the text to pbcopy", () => {
    const { calls, actions } = recorder();
    actions.copy("/a b/[x].txt");
    expect(calls).toEqual([["pbcopy", [], { input: "/a b/[x].txt" }]]);
  });

  test("reveal selects a file in Finder and opens a folder", () => {
    const { calls, actions } = recorder();
    actions.reveal("/r/a.txt");
    actions.reveal("/r", "folder");
    expect(calls).toEqual([
      ["open", ["-R", "/r/a.txt"], { stdio: "ignore" }],
      ["open", ["/r"], { stdio: "ignore" }],
    ]);
  });

  test("open hands the path to its default app as one argument", () => {
    const { calls, actions } = recorder();
    actions.open("/r/a b.txt");
    expect(calls).toEqual([["open", ["/r/a b.txt"], { stdio: "ignore" }]]);
  });

  test("each action reports success only on a zero exit", () => {
    const ok = recorder(0).actions;
    expect([ok.copy("x"), ok.reveal("/r/a"), ok.open("/r/a")]).toEqual([true, true, true]);
    const failed = recorder(1).actions;
    expect([failed.copy("x"), failed.reveal("/r/a"), failed.open("/r/a")]).toEqual([false, false, false]);
    const unspawned = recorder(null).actions;
    expect([unspawned.copy("x"), unspawned.reveal("/r/a"), unspawned.open("/r/a")]).toEqual([false, false, false]);
  });
});
