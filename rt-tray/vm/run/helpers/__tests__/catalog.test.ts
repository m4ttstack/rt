import { describe, expect, test } from "bun:test";
import { join } from "path";
import { JQ_DIR, runJq } from "./jq.ts";

const CATALOG = join(JQ_DIR, "catalog.jq");
const catalog = (tools: unknown[]) => JSON.parse(runJq(["-c", "-f", CATALOG], JSON.stringify({ schema: 1, arch: "arm64", tools })));
const row = (name: string, extra: Record<string, unknown> = {}) => ({ name, kind: "helper", status: "bundled", ...extra });

describe("catalog.jq", () => {
  test("helper rows with serve are apps, sorted by name; other helper rows are tools; buildtools are neither", () => {
    expect(catalog([
      row("jq"),
      row("chat", { serve: { port: 11002, args: [] } }),
      row("gitq"),
      row("board", { serve: { port: 11006, args: ["--quiet"] } }),
      { name: "sparkle", kind: "buildtool", status: "bundled" },
    ])).toEqual({
      apps: [
        { name: "board", status: "bundled", port: 11006, args: ["--quiet"] },
        { name: "chat", status: "bundled", port: 11002, args: [] },
      ],
      tools: ["gitq", "jq"],
    });
  });

  test("a pending serve row stays an app and keeps its status for the verdict to judge", () => {
    expect(catalog([row("boxscore", { status: "pending", serve: { port: 11005, args: [] } })]).apps)
      .toEqual([{ name: "boxscore", status: "pending", port: 11005, args: [] }]);
  });

  test("serve with no args means no args, and serve: null is a tool", () => {
    const c = catalog([row("console", { serve: { port: 11001 } }), row("deck", { serve: null })]);
    expect(c.apps).toEqual([{ name: "console", status: "bundled", port: 11001, args: [] }]);
    expect(c.tools).toEqual(["deck"]);
  });
});
