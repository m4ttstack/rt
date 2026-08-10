import { test, expect } from "bun:test";
import { pickAsset, latestAssetUrl } from "./update.ts";

test("pickAsset matches this platform's naming", () => {
  expect(pickAsset("darwin", "arm64")).toBe("deck-darwin-arm64");
  expect(pickAsset("darwin", "x64")).toBe("deck-darwin-x64");
  expect(() => pickAsset("win32", "x64")).toThrow();
});

test("latestAssetUrl reads the SAME releases the installer uses", () => {
  expect(latestAssetUrl("deck-darwin-arm64")).toBe(
    "https://github.com/m4ttheweric/deck/releases/latest/download/deck-darwin-arm64",
  );
});
