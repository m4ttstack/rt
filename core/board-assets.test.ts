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
  // the guard is worth nothing if a later switch can skip it. The lazy match
  // is bounded by a negative lookahead so it cannot cross a label boundary:
  // without that bound, an unrelated data-field label earlier in the page
  // would be swept forward and matched against a switch several elements
  // later, past its own closing tag, and wrongly blamed for that switch's
  // missing :title.
  const switches = [
    ...html.matchAll(
      /<label[^>]*>(?:(?!<\/?label\b)[\s\S])*?<input type="checkbox"(?:(?!<\/?label\b)[\s\S])*?role="switch"[\s\S]*?>/g,
    ),
  ].map((m) => m[0]);

  expect(switches.length).toBeGreaterThan(0);
  // Every switch on the page must be caught by the guard above, not just the
  // ones that happen to sit in a well-formed label: an unwrapped switch would
  // otherwise pass this test silently while rendering with no thumb at all.
  expect(switches.length).toBe([...html.matchAll(/role="switch"/g)].length);
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

test("the access dialog commits per control and never sends a half-typed value", async () => {
  const html = await boardHtml().text();
  const js = await boardJs().text();

  expect(html).toContain('x-if="accessModal"');
  expect(js).toContain("onPasswordSwitch");
  expect(js).toContain("onOauthSwitch");
  expect(js).toContain("applyOauth");

  // Turning a switch ON must send nothing: there is no valid value yet.
  // Both apply buttons are therefore disabled until the field has content.
  const dialog = html.match(/<template x-if="accessModal">[\s\S]*?<\/template>/)?.[0];
  expect(dialog).toBeDefined();
  expect(dialog).toMatch(/:disabled="!accessModal\.password/);
  expect(dialog).toMatch(/:disabled="!accessModal\.list/);
});

test("the access dialog is the last block on the board", async () => {
  // The switch test scans left to right: a label between two switches is
  // matched as the later switch's wrapper. This dialog's radio labels are only
  // safe while no switch follows them.
  const html = await boardHtml().text();
  const access = html.indexOf('x-if="accessModal"');
  const addModal = html.indexOf('x-if="addModal"');
  const editModal = html.indexOf('x-if="editModal"');
  expect(access).toBeGreaterThan(-1);
  // Asserted before the ordering comparisons below: indexOf returns -1 for a
  // deleted block, and -1 sorts before every real offset, so without this the
  // ordering checks would pass vacuously if addModal or editModal ever went
  // away.
  expect(addModal).toBeGreaterThan(-1);
  expect(editModal).toBeGreaterThan(-1);
  expect(access).toBeGreaterThan(addModal);
  expect(access).toBeGreaterThan(editModal);
  // The dialog's own two switches must be the last two on the page. Anything
  // after them would turn this dialog's radio labels into that switch's
  // wrapper as far as the guard above is concerned.
  const after = html.slice(access);
  expect([...after.matchAll(/role="switch"/g)]).toHaveLength(2);
});

// Loads the real board.js source and hands back the plain object
// Alpine.data("board", factory) would have registered, without pulling Alpine
// or a DOM library into the test run: document.addEventListener is stubbed to
// invoke its callback immediately, and Alpine.data is stubbed to capture the
// factory instead of registering it. The returned object's methods are the
// actual production code, called directly.
type BoardComponent = Record<string, any>;
type BoardFactory = () => BoardComponent;

async function loadBoardComponent(): Promise<BoardComponent> {
  const js = await boardJs().text();
  let factory: BoardFactory | undefined;
  const fakeDocument = { addEventListener: (_event: string, cb: () => void) => cb() };
  const fakeAlpine = { data: (_name: string, f: BoardFactory) => { factory = f; } };
  new Function("document", "Alpine", js)(fakeDocument, fakeAlpine);
  if (!factory) throw new Error("board.js never called Alpine.data(\"board\", ...)");
  return factory();
}

test("a failed password-switch request leaves the checkbox matching the unchanged server state", async () => {
  // :checked="accessModal.hasPassword || accessModal.pwOpen" is an Alpine
  // effect with fine-grained dependency tracking: it only re-runs when one of
  // those two reads actually changes value. A native checkbox flips its own
  // checked property on click, before "change" fires, so if the failure
  // branch below left hasPassword and pwOpen untouched (as it must -- the
  // server still has the old state) the effect would never re-fire and the
  // box would keep showing the click instead of the server. This asserts the
  // handler corrects event.target.checked by hand instead.
  const component = await loadBoardComponent();
  component.accessModal = {
    app: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: true, pwOpen: false, password: "", pwError: null, pwBusy: false,
    oauthOn: false, mode: "emails", list: "", oauthError: null, oauthBusy: false,
  };
  // The DOM has already flipped itself to false, exactly as a real click on a
  // real checkbox would before "change" fires.
  const ev = { target: { checked: false } };
  component.apiPut = async () => ({ ok: false, status: 500, json: async () => ({}) });

  await component.onPasswordSwitch(ev);

  expect(ev.target.checked).toBe(true); // snapped back: hasPassword is still true
  expect(component.accessModal.hasPassword).toBe(true); // state itself never moved
  expect(component.accessModal.pwError).toBeTruthy();
});

test("a network failure on the password switch also reverts the checkbox", async () => {
  // Same as above but through the res === null branch (apiPut's fetch threw
  // and was caught), not the res.ok === false branch, since they are two
  // different lines in the handler.
  const component = await loadBoardComponent();
  component.accessModal = {
    app: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: true, pwOpen: false, password: "", pwError: null, pwBusy: false,
    oauthOn: false, mode: "emails", list: "", oauthError: null, oauthBusy: false,
  };
  const ev = { target: { checked: false } };
  component.apiPut = async () => { throw new Error("network down"); };

  await component.onPasswordSwitch(ev);

  expect(ev.target.checked).toBe(true);
  expect(component.accessModal.hasPassword).toBe(true);
});

test("a failed oauth-switch request (Cloudflare 502) leaves the checkbox on", async () => {
  // This is the exact case sync-before-persist exists for: Cloudflare
  // rejects the change, the server keeps the previous rule, and the switch
  // must keep showing "on" rather than the click that asked to turn it off.
  const component = await loadBoardComponent();
  component.accessModal = {
    app: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: false, pwOpen: false, password: "", pwError: null, pwBusy: false,
    oauthOn: true, mode: "emails", list: "a@x.dev", oauthError: null, oauthBusy: false,
  };
  const ev = { target: { checked: false } };
  component.apiPut = async () => ({
    ok: false,
    status: 502,
    // The wire spelling the server actually sends (src/api/server.ts).
    json: async () => ({ error: "cloudflare-sync-failed", message: "Cloudflare rejected the change" }),
  });

  await component.onOauthSwitch(ev);

  expect(ev.target.checked).toBe(true);
  expect(component.accessModal.oauthOn).toBe(true);
  expect(component.accessModal.oauthError).toBe("Cloudflare rejected the change");
});

test("a turn-off that Cloudflare did not confirm still warns, even though it is a 200", async () => {
  // Sign-in off always takes effect locally, so the server answers 200 and
  // reports the edge's verdict in cfSynced. A skipped or failed teardown
  // leaves the Access app challenging visitors, so a silent 200 would have
  // the board showing an "off" the edge does not agree with. The CLI warns on
  // the same field; this is the board's half of that.
  const component = await loadBoardComponent();
  component.refresh = async () => {};
  component.accessModal = {
    app: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: false, pwOpen: false, password: "", pwError: null, pwBusy: false,
    oauthOn: true, mode: "emails", list: "a@x.dev", oauthError: null, oauthBusy: false,
  };
  const ev = { target: { checked: false } };
  component.apiPut = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, oauth: { mode: "off" }, cfSynced: false }),
  });

  await component.onOauthSwitch(ev);

  expect(component.accessModal.oauthOn).toBe(false); // the local change did happen
  expect(component.accessModal.oauthError).toContain("Cloudflare");
});

test("a turn-off Cloudflare confirmed leaves no warning behind", async () => {
  const component = await loadBoardComponent();
  component.refresh = async () => {};
  component.accessModal = {
    app: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: false, pwOpen: false, password: "", pwError: null, pwBusy: false,
    oauthOn: true, mode: "emails", list: "a@x.dev", oauthError: "stale", oauthBusy: false,
  };
  component.apiPut = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, oauth: { mode: "off" }, cfSynced: true }),
  });

  await component.onOauthSwitch({ target: { checked: false } });

  expect(component.accessModal.oauthOn).toBe(false);
  expect(component.accessModal.oauthError).toBeNull();
});

test("switching the sign-in mode clears the other mode's list", async () => {
  // applyOauth reads m.list whichever radio is selected, so leaving
  // "a@x.dev, b@y.dev" in the field after a switch to "anyone at these
  // domains" would arm Apply with entries that are not domains at all.
  const component = await loadBoardComponent();
  component.accessModal = {
    app: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: false, pwOpen: false, password: "", pwError: null, pwBusy: false,
    oauthOn: true, mode: "domains", list: "a@x.dev, b@y.dev",
    oauthError: "old", oauthBusy: false,
  };

  component.onOauthMode();

  expect(component.accessModal.list).toBe("");
  expect(component.accessModal.oauthError).toBeNull();
});

test("accessSummary leads with 'not published' but still names the gates", async () => {
  // The cell is icon-only, so this sentence is the only textual route a
  // screen reader has to the password and sign-in state. An unpublished app
  // that drops the gates tells a screen-reader user nothing about them.
  const component = await loadBoardComponent();

  expect(component.accessSummary({ published: true, hasPassword: false, oauth: { mode: "off" } }))
    .toBe("open to anyone");
  expect(component.accessSummary({ published: false, hasPassword: false, oauth: { mode: "off" } }))
    .toBe("not published");
  expect(component.accessSummary({
    published: false, hasPassword: true, oauth: { mode: "domains", domains: ["corp.com"] },
  })).toBe("not published, password required, anyone at corp.com may sign in");
  expect(component.accessSummary({
    published: true, hasPassword: false, oauth: { mode: "emails", emails: ["a@x.dev", "b@x.dev"] },
  })).toBe("2 people may sign in");
});

test("the access dialog never prints a null public URL and keeps its warning slot outside the panel", async () => {
  const html = await boardHtml().text();

  // publicUrl is null on every row until a domain is bound, while published
  // can already be true, so the interpolation must be guarded on both.
  expect(html).toContain(`x-show="accessModal.published && accessModal.publicUrl"`);
  expect(html).toContain(`x-show="accessModal.published && !accessModal.publicUrl"`);

  // Both radios clear the field, so the other mode's entries never stay armed.
  expect([...html.matchAll(/@change="onOauthMode\(\)"/g)]).toHaveLength(2);

  // The oauth error slot must sit OUTSIDE the panel that x-shows on oauthOn:
  // a cfSynced:false warning is written at the same moment oauthOn goes false.
  const panel = html.indexOf(`x-show="accessModal.oauthOn"`);
  const alert = html.indexOf(`x-text="accessModal.oauthError"`);
  expect(panel).toBeGreaterThan(-1);
  expect(alert).toBeGreaterThan(panel);
  const between = html.slice(panel, alert);
  expect([...between.matchAll(/<\/span>/g)].length)
    .toBeGreaterThan([...between.matchAll(/<span\b/g)].length);
});

test("the allowlist field is a textarea, not a single line", async () => {
  const html = await boardHtml().text();

  // A single-line input showed only the tail of any real allowlist. Pin the
  // element type, not just the binding, so it cannot quietly regress.
  expect(html).toMatch(/<textarea[^>]*x-model="accessModal\.list"/);
  expect(html).not.toMatch(/<input[^>]*x-model="accessModal\.list"/);

  // Vertical only: a long address must not widen the dialog past its own
  // max-width, which is what an unconstrained textarea would do.
  expect(html).toContain("resize: vertical");
});

test("applyOauth accepts newline-separated and comma-separated lists alike", async () => {
  // The field is one-per-line, but a list pasted from prose arrives with
  // commas. Both must reach the wire as a clean array, with blank lines and
  // stray whitespace dropped rather than sent as empty entries.
  const sent: any[] = [];
  const component = await loadBoardComponent();
  component.refresh = async () => {};
  component.apiPut = async (_path: string, payload: unknown) => {
    sent.push(payload);
    return { ok: true, status: 200, json: async () => ({ ok: true, cfSynced: true }) };
  };
  const base = {
    app: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: false, pwOpen: false, password: "", pwError: null, pwBusy: false,
    oauthOn: true, oauthError: null, oauthBusy: false,
  };

  component.accessModal = { ...base, mode: "emails", list: "a@x.dev\n b@y.dev \n\n" };
  await component.applyOauth();
  expect(sent.at(-1)).toEqual({ mode: "emails", emails: ["a@x.dev", "b@y.dev"] });

  component.accessModal = { ...base, mode: "emails", list: "a@x.dev, b@y.dev" };
  await component.applyOauth();
  expect(sent.at(-1)).toEqual({ mode: "emails", emails: ["a@x.dev", "b@y.dev"] });

  component.accessModal = { ...base, mode: "domains", list: "corp.com\nother.dev,third.io" };
  await component.applyOauth();
  expect(sent.at(-1)).toEqual({ mode: "domains", domains: ["corp.com", "other.dev", "third.io"] });

  // A field holding only separators must not fire a request at all.
  component.accessModal = { ...base, mode: "emails", list: "\n , \n" };
  await component.applyOauth();
  expect(sent).toHaveLength(3);
});

test("a saved list reads back one per line", async () => {
  // openAccess seeds the textarea from the server's array; joining with ", "
  // would put a multi-entry list back on one line and undo the change.
  const component = await loadBoardComponent();
  component.openAccess({
    name: "demo", published: true, publicUrl: "https://demo.example",
    hasPassword: false, oauth: { mode: "emails", emails: ["a@x.dev", "b@y.dev"] },
  });
  expect(component.accessModal.list).toBe("a@x.dev\nb@y.dev");
});
