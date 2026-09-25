import { afterAll, describe, expect, test } from "bun:test";

test("breaks HOME", () => {
  process.env.HOME = undefined;
});

test("runs next", () => {
  expect(process.env.HOME).toStartWith("/");
});

describe("an afterAll", () => {
  afterAll(() => {
    process.env.HOME = "relative/home";
  });

  test("runs before the afterAll breaks HOME", () => {});
});

test("starts after the afterAll", () => {});

test("starts after the repair", () => {
  expect(process.env.HOME).toStartWith("/");
});

afterAll(() => {
  delete process.env.HOME;
});
