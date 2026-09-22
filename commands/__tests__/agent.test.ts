import { describe, expect, test } from "bun:test";
import { __test__ } from "../agent.ts";

const { parseStartArgs, parseResumeArgs } = __test__;

describe("parseStartArgs", () => {
  test("full flag set", () => {
    const p = parseStartArgs([
      "--prompt", "do it", "--surface", "headless", "--model", "haiku",
      "--effort", "low", "--account", "a@b.c", "--label", "job7",
      "--caller", "board:review", "--workspace", "reviews", "--tab", "!7",
      "--extra-args", "--permission-mode plan",
    ]);
    expect(p).toEqual({
      prompt: "do it", surface: "headless", model: "haiku", effort: "low",
      account: "a@b.c", label: "job7", caller: "board:review",
      workspace: "reviews", tab: "!7", extraArgs: "--permission-mode plan",
    });
  });

  test("bad surface fails", () => {
    expect(() => parseStartArgs(["--surface", "tmux"])).toThrow(/surface/);
  });

  test("--prompt-file reads the file", () => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/agent-prompt-${process.pid}.txt`;
    require("fs").writeFileSync(path, "from file");
    expect(parseStartArgs(["--prompt-file", path]).prompt).toBe("from file");
  });

  test("--prompt and --prompt-file together fail", () => {
    expect(() => parseStartArgs(["--prompt", "a", "--prompt-file", "/x"])).toThrow(/one of/);
  });

  test("--bg sets bg: true", () => {
    expect(parseStartArgs(["--prompt", "hi", "--bg"])).toMatchObject({ bg: true });
  });

  test("omitting --bg leaves it undefined", () => {
    expect(parseStartArgs(["--prompt", "hi"]).bg).toBeUndefined();
  });

  test("--bg with --surface headless fails, naming --bg as a herdr-surface option", () => {
    expect(() => parseStartArgs(["--bg", "--surface", "headless"])).toThrow(/--bg is a herdr-surface option/);
  });

  test("--surface headless then --bg fails the same way regardless of flag order", () => {
    expect(() => parseStartArgs(["--surface", "headless", "--bg"])).toThrow(/--bg is a herdr-surface option/);
  });

  test("--bg as an --extra-args VALUE is not detected as the flag", () => {
    expect(parseStartArgs(["--extra-args", "--bg"]).bg).toBeUndefined();
    expect(parseStartArgs(["--extra-args", "--bg"]).extraArgs).toBe("--bg");
  });

  test("parseStartArgs: --provider codex", () => {
    const parsed = __test__.parseStartArgs(["--provider", "codex", "--prompt", "go"]);
    expect(parsed.provider).toBe("codex");
  });

  test("parseStartArgs: invalid --provider throws", () => {
    expect(() => __test__.parseStartArgs(["--provider", "cursor"])).toThrow(/invalid provider/);
  });

  test("parseStartArgs: --yolo sets the flag", () => {
    const parsed = __test__.parseStartArgs(["--yolo", "--prompt", "go"]);
    expect(parsed.yolo).toBe(true);
  });

  test("parseStartArgs: no --yolo leaves it undefined", () => {
    const parsed = __test__.parseStartArgs(["--prompt", "go"]);
    expect(parsed.yolo).toBeUndefined();
  });

  // false, not undefined: the daemon reads `payload.yolo ?? the setting`, so
  // only an explicit false can override a true agent.<provider>.yolo.
  test("parseStartArgs: --no-yolo sets yolo false, distinct from omitting it", () => {
    expect(__test__.parseStartArgs(["--no-yolo", "--prompt", "go"]).yolo).toBe(false);
  });

  test("parseStartArgs: --yolo and --no-yolo together throw", () => {
    expect(() => __test__.parseStartArgs(["--yolo", "--no-yolo"])).toThrow(/not both/);
  });
});

describe("parseResumeArgs", () => {
  test("id positional + optional prompt/surface", () => {
    expect(parseResumeArgs(["ag-12345678", "--prompt", "next", "--surface", "herdr"]))
      .toEqual({ id: "ag-12345678", prompt: "next", surface: "herdr" });
  });
  test("missing id fails", () => {
    expect(() => parseResumeArgs(["--prompt", "x"])).toThrow(/id/);
  });

  test("parseResumeArgs reads --workspace and --tab", () => {
    const r = parseResumeArgs(["ag-1", "--workspace", "reviews", "--tab", "⟲ !5", "--prompt", "go"]);
    expect(r).toMatchObject({ id: "ag-1", workspace: "reviews", tab: "⟲ !5", prompt: "go" });
  });
});

describe("withCallerAccount", () => {
  const { withCallerAccount } = __test__;
  const caller = async () => "alex@acme.test";

  test("a claude launch with no --account takes the caller's cswap account", async () => {
    expect(await withCallerAccount({}, () => "claude", caller)).toEqual({ account: "alex@acme.test" });
    expect(await withCallerAccount({ provider: "claude" }, () => "codex", caller)).toEqual({ provider: "claude", account: "alex@acme.test" });
  });

  test("an explicit --account wins and cswap is never asked", async () => {
    let asked = false;
    const spy = async () => { asked = true; return "alex@acme.test"; };
    expect(await withCallerAccount({ account: "other@example.com" }, () => "claude", spy)).toEqual({ account: "other@example.com" });
    expect(asked).toBe(false);
  });

  test("codex, by flag or by default, never gets an account", async () => {
    expect(await withCallerAccount({ provider: "codex" }, () => "claude", caller)).toEqual({ provider: "codex" });
    expect(await withCallerAccount({}, () => "codex", caller)).toEqual({});
  });

  test("a default-profile caller leaves the account unset", async () => {
    expect(await withCallerAccount({}, () => "claude", async () => undefined)).toEqual({});
  });
});
