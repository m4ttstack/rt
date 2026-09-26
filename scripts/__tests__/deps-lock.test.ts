import { describe, expect, test } from "bun:test";
import type { DepsLockTool } from "../../lib/bundle-layout.ts";
import { toTsvRow } from "../lib/deps-lock.ts";

function tool(overrides: Partial<DepsLockTool> = {}): DepsLockTool {
  return {
    name: "fzf",
    version: "1.0.0",
    license: "MIT",
    url: "https://example.com/x",
    sha256: "a".repeat(64),
    archive: "raw",
    extract: "",
    bundlePath: "Contents/Helpers/fzf",
    exec: ["Contents/Helpers/fzf"],
    exposeByDefault: false,
    entitlements: "none",
    status: "bundled",
    kind: "helper",
    ...overrides,
  };
}

describe("deps-lock.ts TSV emitter", () => {
  test("emits 12 tab-separated fields in the documented order", () => {
    expect(toTsvRow(tool()).split("\t")).toHaveLength(12);
  });
  test("emits fields in the documented column order", () => {
    const t = tool({
      name: "toolname",
      version: "9.9.9",
      url: "https://example.com/toolname",
      sha256: "b".repeat(64),
      archive: "tar.gz",
      extract: "toolname",
      bundlePath: "Contents/Helpers/toolname",
      entitlements: "jit",
      status: "bundled",
      kind: "helper",
      exposeByDefault: true,
    });
    expect(toTsvRow(t).split("\t")).toEqual([
      "toolname",
      "9.9.9",
      "https://example.com/toolname",
      "b".repeat(64),
      "tar.gz",
      "toolname",
      "Contents/Helpers/toolname",
      "jit",
      "bundled",
      "helper",
      "true",
      "",
    ]);
  });
  test("throws rather than emit a field containing a tab", () => {
    expect(() => toTsvRow(tool({ version: "1.0\t0" }))).toThrow(/tab or newline/);
  });
  test("throws rather than emit a field containing a newline", () => {
    expect(() => toTsvRow(tool({ url: "https://example.com/x\ny" }))).toThrow(/tab or newline/);
  });
  test("throws rather than emit a field containing a carriage return", () => {
    expect(() => toTsvRow(tool({ extract: "a\rb" }))).toThrow(/tab or newline/);
  });
  test("a served app row still emits 12 fields and serve never reaches the TSV", () => {
    const cols = toTsvRow(tool({
      name: "board", bundlePath: "Contents/Helpers/board", exec: ["Contents/Helpers/board"],
      serve: { port: 11006, args: ["serve"] },
    })).split("\t");
    expect(cols).toHaveLength(12);
    expect(cols).not.toContain("11006");
  });
  test("a tree row's 12th field is its source, url and sha256 emit empty", () => {
    const { url: _u, sha256: _s, ...rest } = tool({ name: "board", source: "tree" });
    const cols = toTsvRow(rest as DepsLockTool).split("\t");
    expect(cols).toHaveLength(12);
    expect(cols[2]).toBe("");
    expect(cols[3]).toBe("");
    expect(cols[11]).toBe("tree");
  });
  test("a fetched row's 12th field is empty", () => {
    expect(toTsvRow(tool()).split("\t")[11]).toBe("");
  });
});
