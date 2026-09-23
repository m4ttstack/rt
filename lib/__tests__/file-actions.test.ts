import { describe, expect, test } from "bun:test";
import { createFileActions } from "../file-actions.ts";

function recorder() {
  const calls: unknown[][] = [];
  const spawnSync = ((...args: unknown[]) => { calls.push(args); return { status: 0 }; }) as never;
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
});
