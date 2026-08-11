import { expect, test } from "bun:test";
import { boardHtml, boardJs, vendorAsset } from "./board-assets";

test("shell references the client and the vendored assets", async () => {
  const html = await boardHtml().text();
  expect(html).toContain('src="/board.js"');
  expect(html).toContain('src="/vendor/oat.min.js"');
  expect(html).toContain('src="/vendor/lucide.min.js"');
  expect(html).toContain('src="/vendor/alpine.min.js"');
  expect(html).toContain('href="/vendor/oat.min.css"');
  expect(html).not.toContain("halfmoon");
  expect(boardHtml().headers.get("content-type")).toContain("text/html");

  const oat = html.indexOf('src="/vendor/oat.min.js"');
  const lucide = html.indexOf('src="/vendor/lucide.min.js"');
  const board = html.indexOf('src="/board.js"');
  const alpine = html.indexOf('src="/vendor/alpine.min.js"');
  expect(oat).toBeLessThan(lucide);
  expect(lucide).toBeLessThan(board);
  expect(board).toBeLessThan(alpine);
});

test("shell follows Oat component conventions without Bootstrap markup", async () => {
  const html = await boardHtml().text();

  expect(html).toContain('role="alert"');
  expect(html).toContain(":data-variant=");
  expect(html).toContain('class="table"');
  expect(html).toContain('role="switch"');
  expect(html).toContain("<dialog");
  expect(html).toContain("data-stderr");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('data-spinner="small"');

  expect(html).not.toContain("data-bs-");
  expect(html).not.toMatch(/\bbtn(?:-\w+)?\b/);
  expect(html).not.toContain("form-check");
  expect(html).not.toContain("modal-backdrop");
  expect(html).not.toContain("spinner-border");
  expect(html).not.toContain("text-bg-");
});

test("shell derives presentation from Oat defaults and Lucide icons", async () => {
  const html = await boardHtml().text();

  expect(html).toContain('data-lucide="external-link"');
  expect(html).toContain('data-lucide="lock-keyhole"');
  expect(html).toContain('data-lucide="refresh-cw"');
  expect(html).toContain('data-lucide="rotate-ccw"');
  expect(html).not.toContain("<svg");
  expect(html).not.toContain("↻");
  expect(html).not.toContain("⚡");
  expect(html).not.toContain(">×</button>");

  expect(html).not.toContain('class="table table-panel"');
  expect(html).not.toMatch(/\.table-panel|\.icon-button|\.dot\b|\.stderr-card/);
  expect(html).not.toContain("service-cell");
  expect(html).not.toContain("min-width: 58rem");
});

test("Lucide icons leave breathing room in compact Oat controls", async () => {
  const html = await boardHtml().text();
  const refreshButtons = html.match(
    /<button\b(?:(?!<\/button>)[\s\S])*data-lucide="refresh-cw"(?:(?!<\/button>)[\s\S])*<\/button>/g,
  );
  const icons = await Bun.file(new URL("./icons.js", import.meta.url)).text();

  expect(refreshButtons?.length).toBeGreaterThan(0);
  for (const button of refreshButtons ?? []) {
    expect(button).toContain('class="small outline"');
    expect(button).not.toMatch(/class="[^"]*\bicon\b/);
    expect(button).toContain('<i data-lucide="refresh-cw"></i>');
  }
  expect(icons).toContain("width: 14");
  expect(icons).toContain("height: 14");
  expect(icons).toContain('"max-width: none"');
});

test("edge controls do not let Oat tooltips create empty overflow", async () => {
  const html = await boardHtml().text();
  const header = html.match(/<header class="hstack justify-between">[\s\S]*?<\/header>/)?.[0];
  const actionCells = html.match(/<td class="align-right">[\s\S]*?<\/td>/g);

  expect(header).toBeDefined();
  expect(header).not.toMatch(/\b:?title=/);
  expect(actionCells?.length).toBeGreaterThan(0);
  for (const cell of actionCells ?? []) {
    expect(cell).not.toMatch(/\b:?title=/);
  }
});

test("switch tooltips stay on the wrapper so Oat can render the thumb", async () => {
  const html = await boardHtml().text();
  // Every switch, not just the first: a title on the input hides the thumb, so
  // the guard is worth nothing if a later switch can skip it.
  const switches = [...html.matchAll(/<label[^>]*>[\s\S]*?<input type="checkbox"[\s\S]*?role="switch"[\s\S]*?>/g)]
    .map((m) => m[0]);

  expect(switches.length).toBeGreaterThan(0);
  for (const markup of switches) {
    const labelTag = markup.match(/<label[^>]*>/)?.[0] ?? "";
    // Asserted on the tag rather than as a literal prefix, so attribute order
    // stays the author's business.
    expect(labelTag).toMatch(/\s:title=/);
    expect(markup).toContain(":aria-label=");
    expect(markup).not.toMatch(/<input[\s\S]*?:title=/);
  }
});

test("client registers the Alpine board component and builds no HTML", async () => {
  const js = await boardJs().text();
  expect(js).toContain('Alpine.data("board"');
  expect(js).not.toContain("innerHTML");
  expect(js).not.toContain("data-bs-theme");
  expect(js).not.toContain("applyTheme");
  expect(boardJs().headers.get("content-type")).toContain("javascript");
});

test("Lucide initializer tree-shakes icons and processes Alpine templates", async () => {
  const source = Bun.file(new URL("./icons.js", import.meta.url));
  expect(await source.exists()).toBe(true);
  const js = await source.text();

  expect(js).toContain("createIcons");
  expect(js).toContain("inTemplates: true");
  expect(js).toContain("RefreshCw");
  expect(js).toContain("LockKeyhole");
  expect(js).not.toMatch(/import\s+\{\s*icons[,\s}]/);
});

test("vendor allowlist serves each known file with a plausible size", async () => {
  for (const name of ["oat.min.css", "oat.min.js", "lucide.min.js", "alpine.min.js"]) {
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

test("the access cell is two glyphs and a click target, not a dropdown", async () => {
  const html = await boardHtml().text();

  // The whole point of the change: no select survives anywhere on the board.
  expect(html).not.toContain("<select");
  expect(html).not.toContain('value="only-me"');
  expect(html).not.toContain('value="work-domain"');

  expect(html).toContain('data-lucide="user-round-check"');
  // The password state is one glyph in the cell now, never a pair of buttons.
  // Match the bare text, not ">set password<": the label sits on its own line
  // in the markup being removed, so the angle-bracketed form would pass
  // whether or not the button was ever deleted.
  expect(html).not.toContain("set password");
  expect(html).not.toContain(">remove</button>");
});

test("the client reads the oauth rule and builds no HTML", async () => {
  const js = await boardJs().text();
  expect(js).toContain("accessSummary");
  expect(js).toContain("openAccess");
  // prompt() was how the identity tiers were collected; the modal replaces it.
  expect(js).not.toContain("prompt(");
  expect(js).not.toContain("onTierChange");
});

// The icon bundle is a curated subset and lucide renders nothing for a name it
// was not given, leaving an empty <i> that still occupies its slot in the
// button's flex gap. That reads as off-centre text, not as a missing icon, so
// pin the two lists together rather than trusting a visual check.
test("every data-lucide name in the board is in the icon bundle", async () => {
  const html = await boardHtml().text();
  const used = new Set([...html.matchAll(/data-lucide="([a-z0-9-]+)"/g)].map((m) => m[1]!));
  expect(used.size).toBeGreaterThan(0);

  const source = await Bun.file(new URL("./icons.js", import.meta.url)).text();
  // createIcons() is keyed on the PascalCase export names; compare in the
  // kebab-case form the markup actually asks for. Lucide breaks a trailing
  // digit off as well (Trash2 -> trash-2), so that split runs before the
  // lower-to-upper one.
  const registered = new Set(
    [...source.matchAll(/^\s{4}([A-Z][A-Za-z0-9]*),$/gm)].map((m) =>
      m[1]!
        .replace(/([A-Za-z])([0-9])/g, "$1-$2")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase(),
    ),
  );
  expect(registered.size).toBeGreaterThan(0);

  const missing = [...used].filter((name) => !registered.has(name)).sort();
  expect(missing).toEqual([]);
});
