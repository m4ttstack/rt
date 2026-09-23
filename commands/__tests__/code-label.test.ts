import { describe, expect, test } from "bun:test";
import { __test__ } from "../code.ts";

const { editorLabelFor } = __test__;

describe("editorLabelFor", () => {
  test("a known CLI or app launch reads as its known label", () => {
    expect(editorLabelFor("cursor")).toBe("Cursor");
    expect(editorLabelFor('open -a "Visual Studio Code"')).toBe("VS Code");
  });

  test("an app launch it does not know reads as the app's name", () => {
    expect(editorLabelFor('open -a "Antigravity IDE"')).toBe("Antigravity IDE");
    expect(editorLabelFor("open -a Nova")).toBe("Nova");
    expect(editorLabelFor("  open  -a   'Sublime Merge'  ")).toBe("Sublime Merge");
  });

  test("any other command reads as itself", () => {
    expect(editorLabelFor("nvim")).toBe("nvim");
    expect(editorLabelFor('open -a "Zed" --args -n')).toBe('open -a "Zed" --args -n');
  });
});
