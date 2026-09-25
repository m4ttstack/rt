import { expect, test } from "bun:test";

test("breaks both HOME and exitCode", () => {
  process.env.HOME = undefined;
  process.exitCode = 1;
});

test("runs after breaking both", () => {
  expect(process.env.HOME).toStartWith("/");
  expect(process.exitCode).toBeFalsy();
});
