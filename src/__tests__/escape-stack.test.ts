import { test, expect } from "bun:test";
import { pushLayer, handleEscape } from "../client/ui/layers.ts";

test("escape pops only the topmost layer, in LIFO order", () => {
  const fired: string[] = [];
  const popA = pushLayer(() => fired.push("a"));
  const popB = pushLayer(() => fired.push("b"));
  handleEscape();
  expect(fired).toEqual(["b"]);
  popB();
  handleEscape();
  expect(fired).toEqual(["b", "a"]);
  popA();
  handleEscape();
  expect(fired).toEqual(["b", "a"]);
});
