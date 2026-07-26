import { expect, test } from "bun:test";
import { boardHtml, boardJs, vendorAsset } from "./board-assets";

test("shell references the client and the vendored assets", async () => {
  const html = await boardHtml().text();
  expect(html).toContain('src="/board.js"');
  expect(html).toContain('src="/vendor/oat.min.js"');
  expect(html).toContain('src="/vendor/alpine.min.js"');
  expect(html).toContain('href="/vendor/oat.min.css"');
  expect(html).not.toContain("halfmoon");
  expect(boardHtml().headers.get("content-type")).toContain("text/html");
});

test("shell follows Oat component conventions without Bootstrap markup", async () => {
  const html = await boardHtml().text();

  expect(html).toContain('role="alert"');
  expect(html).toContain(":data-variant=");
  expect(html).toContain('class="table table-panel"');
  expect(html).toContain('role="switch"');
  expect(html).toContain("<dialog");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('data-spinner="small"');

  expect(html).not.toContain("data-bs-");
  expect(html).not.toMatch(/\bbtn(?:-\w+)?\b/);
  expect(html).not.toContain("form-check");
  expect(html).not.toContain("modal-backdrop");
  expect(html).not.toContain("spinner-border");
  expect(html).not.toContain("text-bg-");
});

test("client registers the Alpine board component and builds no HTML", async () => {
  const js = await boardJs().text();
  expect(js).toContain('Alpine.data("board"');
  expect(js).not.toContain("innerHTML");
  expect(js).not.toContain("data-bs-theme");
  expect(js).not.toContain("applyTheme");
  expect(boardJs().headers.get("content-type")).toContain("javascript");
});

test("vendor allowlist serves each known file with a plausible size", async () => {
  for (const name of ["oat.min.css", "oat.min.js", "alpine.min.js"]) {
    const res = vendorAsset(name);
    expect(res).not.toBeNull();
    const bytes = await res!.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }
});

test("vendor allowlist rejects unknown names and traversal", () => {
  expect(vendorAsset("nope.css")).toBeNull();
  expect(vendorAsset("../settings.ts")).toBeNull();
  expect(vendorAsset("..%2Fserver.ts")).toBeNull();
  expect(vendorAsset("")).toBeNull();
  expect(vendorAsset("constructor")).toBeNull();
  expect(vendorAsset("toString")).toBeNull();
  expect(vendorAsset("__proto__")).toBeNull();
  expect(vendorAsset("hasOwnProperty")).toBeNull();
});
