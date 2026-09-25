import { afterAll, describe, expect, test } from "bun:test";

test("leaves exitCode set", () => {
  process.exitCode = 1;
});

test("runs next", () => {
  expect(process.exitCode).toBeFalsy();
});

describe("an afterAll", () => {
  afterAll(() => {
    process.exitCode = 2;
  });

  test("runs before the afterAll leaks exitCode", () => {});
});

test("starts after the afterAll", () => {});

test("starts after the repair", () => {
  expect(process.exitCode).toBeFalsy();
});
