import { test, expect } from "bun:test";
import { pushLayer, handleEscape } from "@mattstack/tui-kit/hooks";

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

test("push/pop/push of the same closure identity in immediate succession converges to one live registration (StrictMode double-invoke)", () => {
  const fired: string[] = [];
  const popOuter = pushLayer(() => fired.push("outer"));
  const fn = () => fired.push("x");
  let pop = pushLayer(fn);
  pop(); // StrictMode's immediate cleanup of the first mount
  pop = pushLayer(fn); // StrictMode's second mount, same closure identity
  handleEscape();
  expect(fired).toEqual(["x"]);
  pop();
  handleEscape();
  expect(fired).toEqual(["x", "outer"]);
  popOuter();
});
