import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { launchEditorDetached } from "../code.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in editor CLI that writes its first argument to a file instead of opening anything. */
function recorder(): { command: string; recorded: () => string } {
  const dir = mkdtempSync(join(tmpdir(), "rt-launch-"));
  dirs.push(dir);
  const out = join(dir, "arg.txt");
  const script = join(dir, "record.sh");
  writeFileSync(script, `#!/bin/sh\nprintf '%s' "$1" > '${out}'\n`);
  chmodSync(script, 0o755);
  return { command: `'${script}'`, recorded: () => readFileSync(out, "utf8") };
}

describe("launchEditorDetached", () => {
  test("hands the target over as one literal argument, whatever the shell would make of it", async () => {
    const editor = recorder();
    const target = "/tmp/a b/it's \"q\" $HOME `id` [x]#!.txt";
    expect(await launchEditorDetached(editor.command, target, () => null)).toBe(true);
    expect(editor.recorded()).toBe(target);
  });

  test("a failing command falls through to the app-bundle fallback", async () => {
    const app = recorder();
    const asked: string[] = [];
    const ok = await launchEditorDetached("false", "/r/a.ts", (command) => {
      asked.push(command);
      return app.command;
    });
    expect(ok).toBe(true);
    expect(asked).toEqual(["false"]);
    expect(app.recorded()).toBe("/r/a.ts");
  });

  test("a failing command with no fallback reports failure", async () => {
    expect(await launchEditorDetached("false", "/r/a.ts", () => null)).toBe(false);
  });

  test("the default fallback has nothing for a command that is not a known editor", async () => {
    expect(await launchEditorDetached("false", "/r/a.ts")).toBe(false);
  });
});
