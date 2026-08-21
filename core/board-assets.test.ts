import { expect, test } from "bun:test";
import { boardHtml, boardJs, boardCss } from "./board-assets";

test("shell references the React entry and its stylesheet", async () => {
  const html = await boardHtml().text();
  expect(html).toContain('src="/board.js"');
  expect(html).toContain('href="/board.css"');
  expect(html).toContain('<div id="root">');
  expect(html).toContain("<noscript>");
  expect(boardHtml().headers.get("content-type")).toContain("text/html");
});

test("no /vendor references remain anywhere in the shell", async () => {
  const html = await boardHtml().text();
  expect(html).not.toContain("/vendor/");
  expect(html).not.toContain("oat.min");
  expect(html).not.toContain("alpine.min");
  expect(html).not.toContain("lucide.min");
});

test("boardJs and boardCss serve the built artifacts with correct content-types", async () => {
  const js = await boardJs().text();
  const css = await boardCss().text();
  expect(js.length).toBeGreaterThan(0);
  expect(css.length).toBeGreaterThan(0);
  expect(boardJs().headers.get("content-type")).toContain("javascript");
  expect(boardCss().headers.get("content-type")).toContain("text/css");
});
