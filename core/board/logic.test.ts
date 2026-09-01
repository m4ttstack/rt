import { test, expect } from "bun:test";
import {
  REFRESH_MS,
  RESTART_TIMEOUT_MS,
  HEAL_RECENT_MS,
  PROXY_WAIT_MS,
  subline,
  sublineHealthy,
  isPlatform,
  showDevLinkPrompt,
  showUnlinkButton,
  tunnelDomain,
  sections,
  tunnels,
  reconcileRestarting,
  autoBanner,
  addPayload,
  editPatch,
  type StatusData,
  type Row,
  type RestartingMap,
} from "./logic.ts";

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    name: "app",
    displayTld: "localhost",
    port: 3000,
    url: "http://app.localhost",
    publicUrl: null,
    health: { ok: true, status: 200, ms: 5 },
    service: { label: "com.deck.app", short: "app", pid: 111, lastExitStatus: null, unmanaged: null, stderr: [] },
    published: true,
    hasPassword: false,
    isTunnel: false,
    override: null,
    publicFollowsOverride: false,
    self: false,
    managedBy: "deck",
    icon: null,
    issues: [],
    record: { kind: "service", command: null, workingDirectory: null },
    oauth: { mode: "off" },
    ...overrides,
  };
}

function makeData(overrides: Partial<StatusData> = {}): StatusData {
  return {
    suffix: "localhost",
    canRestart: true,
    canManage: true,
    up: 2,
    total: 3,
    apps: [],
    orphans: [],
    nextPort: null,
    proxyStale: false,
    autoHeal: null,
    ...overrides,
  };
}

// ---- constants ----

test("constants match the oracle's timings", () => {
  expect(REFRESH_MS).toBe(5000);
  expect(RESTART_TIMEOUT_MS).toBe(30000);
  expect(HEAL_RECENT_MS).toBe(120000);
  expect(PROXY_WAIT_MS).toBe(45000);
});

// ---- subline ----

test("subline: null data reads loading", () => {
  expect(subline(null)).toBe("loading…");
});

test("subline: reports healthy/public/protected, no next-port or auto-refreshes", () => {
  const data = makeData({
    up: 2,
    total: 3,
    nextPort: 11012,
    apps: [
      makeRow({ published: true, hasPassword: false }),
      makeRow({ published: false, hasPassword: true }),
    ],
  });
  expect(subline(data)).toBe("2 of 3 healthy · 1 public · 1 protected");
});

test("subline: protected segment omitted when none are protected", () => {
  const data = makeData({
    up: 1,
    total: 1,
    apps: [makeRow({ published: true, hasPassword: false })],
  });
  expect(subline(data)).toBe("1 of 1 healthy · 1 public");
});

// ---- sublineHealthy ----

test("sublineHealthy: ok tone when every app is healthy", () => {
  const data = makeData({ up: 3, total: 3 });
  expect(sublineHealthy(data)).toEqual({ text: "3 of 3 healthy", ok: true });
});

test("sublineHealthy: bad tone when any app is unhealthy", () => {
  const data = makeData({ up: 3, total: 4 });
  expect(sublineHealthy(data)).toEqual({ text: "3 of 4 healthy", ok: false });
});

// ---- isPlatform ----

test("isPlatform: deck is platform-managed", () => {
  expect(isPlatform("deck")).toBe(true);
});

test("isPlatform: local is platform-managed (pre-rename)", () => {
  expect(isPlatform("local")).toBe(true);
});

test("showDevLinkPrompt: hidden on a public board (canManage false) even for an unlinked row", () => {
  expect(showDevLinkPrompt(makeRow({ devLink: "unlinked" }), false)).toBe(false);
  expect(showDevLinkPrompt(makeRow({ devLink: "broken" }), false)).toBe(false);
});

test("showDevLinkPrompt: shown for unlinked/broken rows when canManage is true, never for the platform's own row", () => {
  expect(showDevLinkPrompt(makeRow({ devLink: "unlinked" }), true)).toBe(true);
  expect(showDevLinkPrompt(makeRow({ devLink: "broken" }), true)).toBe(true);
  expect(showDevLinkPrompt(makeRow({ devLink: "linked" }), true)).toBe(false);
  expect(showDevLinkPrompt(makeRow({ devLink: "unlinked", self: true }), true)).toBe(false);
});

test("showUnlinkButton: hidden on a public board (canManage false) even for a linked row", () => {
  expect(showUnlinkButton(makeRow({ devLink: "linked" }), false)).toBe(false);
});

test("showUnlinkButton: shown for a linked row when canManage is true, never for the platform's own row", () => {
  expect(showUnlinkButton(makeRow({ devLink: "linked" }), true)).toBe(true);
  expect(showUnlinkButton(makeRow({ devLink: "linked", self: true }), true)).toBe(false);
  expect(showUnlinkButton(makeRow({ devLink: "unlinked" }), true)).toBe(false);
});

test("isPlatform: user-managed and undefined are not platform", () => {
  expect(isPlatform("user")).toBe(false);
  expect(isPlatform(undefined)).toBe(false);
});

// ---- tunnelDomain ----

test("tunnelDomain: localhost suffix reads as empty", () => {
  expect(tunnelDomain(makeData({ suffix: "localhost" }))).toBe("");
});

test("tunnelDomain: public suffix passes through", () => {
  expect(tunnelDomain(makeData({ suffix: "example.com" }))).toBe("example.com");
});

// ---- sections ----

test("sections: mattstack-managed apps get their own titled section above 'your apps'", () => {
  const mine = makeRow({ name: "mine", managedBy: "user" });
  const product = makeRow({ name: "board", managedBy: "rt" });
  const out = sections(makeData({ apps: [mine, product] }));
  expect(out[0]).toEqual({ key: "mattstack", title: "mattstack", rows: [product] });
  expect(out[1]).toEqual({ key: "apps", title: "your apps", rows: [mine] });
});

test("sections: mattstack group sorts the platform (deck) row to the top, rest alphabetical", () => {
  const rows = [
    makeRow({ name: "gitq", managedBy: "rt" }),
    makeRow({ name: "deck", managedBy: "deck" }),
    makeRow({ name: "board", managedBy: "rt" }),
  ];
  const out = sections(makeData({ apps: rows }));
  expect(out[0]!.rows.map((r) => r.name)).toEqual(["deck", "board", "gitq"]);
});

test("sections: with no mattstack apps the list stays a single untitled 'apps' section", () => {
  const mine = makeRow({ name: "mine", managedBy: "user" });
  expect(sections(makeData({ apps: [mine] }))).toEqual([{ key: "apps", title: null, rows: [mine] }]);
});

test("sections: strays section appears only for non-tunnel orphans", () => {
  const stray = makeRow({ name: "stray", isTunnel: false });
  const data = makeData({ orphans: [stray] });
  const out = sections(data);
  expect(out).toHaveLength(2);
  expect(out[1]).toEqual({ key: "strays", title: "services without routes", rows: [stray] });
});

test("sections: tunnel-only orphans do not produce a strays section", () => {
  const data = makeData({ orphans: [makeRow({ isTunnel: true })] });
  expect(sections(data)).toHaveLength(1);
});

test("sections: null data yields an empty apps section", () => {
  expect(sections(null)).toEqual([{ key: "apps", title: null, rows: [] }]);
});

test("sections: devLink passes through onto the row untouched", () => {
  const row = makeRow({ name: "gitq", devLink: "linked" });
  const [group] = sections(makeData({ apps: [row] }));
  expect(group!.rows[0]!.devLink).toBe("linked");
});

test("sections: an unlinked row carries no commands", () => {
  const row = makeRow({ name: "gitq", devLink: "unlinked", commands: undefined });
  const [group] = sections(makeData({ apps: [row] }));
  expect(group!.rows[0]!.commands).toBeUndefined();
});

// ---- tunnels ----

test("tunnels: filters orphans down to isTunnel rows", () => {
  const tunnel = makeRow({ name: "cf", isTunnel: true });
  const stray = makeRow({ name: "stray", isTunnel: false });
  expect(tunnels(makeData({ orphans: [tunnel, stray] }))).toEqual([tunnel]);
});

test("tunnels: null data yields empty array", () => {
  expect(tunnels(null)).toEqual([]);
});

// ---- reconcileRestarting ----

test("reconcileRestarting: cleared on new pid + healthy", () => {
  const restarting: RestartingMap = { "com.deck.app": { pid: 111, at: 1000 } };
  const data = makeData({
    apps: [makeRow({ service: { label: "com.deck.app", short: "app", pid: 222, lastExitStatus: null, unmanaged: null, stderr: [] }, health: { ok: true, status: 200, ms: 1 } })],
  });
  expect(reconcileRestarting(restarting, data, 2000)).toEqual({});
});

test("reconcileRestarting: cleared past RESTART_TIMEOUT_MS even if unhealthy", () => {
  const restarting: RestartingMap = { "com.deck.app": { pid: 111, at: 1000 } };
  const data = makeData({
    apps: [makeRow({ service: { label: "com.deck.app", short: "app", pid: 111, lastExitStatus: null, unmanaged: null, stderr: [] }, health: { ok: false, status: null, ms: null } })],
  });
  expect(reconcileRestarting(restarting, data, 1000 + RESTART_TIMEOUT_MS + 1)).toEqual({});
});

test("reconcileRestarting: kept while same pid or unhealthy, within timeout", () => {
  const restarting: RestartingMap = { "com.deck.app": { pid: 111, at: 1000 } };
  const data = makeData({
    apps: [makeRow({ service: { label: "com.deck.app", short: "app", pid: 111, lastExitStatus: null, unmanaged: null, stderr: [] }, health: { ok: false, status: null, ms: null } })],
  });
  expect(reconcileRestarting(restarting, data, 1500)).toEqual(restarting);
});

test("reconcileRestarting: pure -- input map is not mutated", () => {
  const restarting: RestartingMap = { "com.deck.app": { pid: 111, at: 1000 } };
  const snapshot = JSON.parse(JSON.stringify(restarting));
  const data = makeData({
    apps: [makeRow({ service: { label: "com.deck.app", short: "app", pid: 222, lastExitStatus: null, unmanaged: null, stderr: [] }, health: { ok: true, status: 200, ms: 1 } })],
  });
  reconcileRestarting(restarting, data, 2000);
  expect(restarting).toEqual(snapshot);
});

// ---- autoBanner ----

test("autoBanner: heal in-flight (ok null, recent) reads a restarting bad notice", () => {
  const data = makeData({ autoHeal: { at: 1000, ok: null } });
  const notice = autoBanner(data, 1000 + HEAL_RECENT_MS - 1);
  expect(notice?.kind).toBe("bad");
  expect(notice?.message).toContain("Restarting the proxy automatically");
});

test("autoBanner: proxyStale reads a bad notice mentioning reload proxy", () => {
  const data = makeData({ proxyStale: true });
  const notice = autoBanner(data, 1000);
  expect(notice?.kind).toBe("bad");
  expect(notice?.message).toContain("reload proxy");
});

test("autoBanner: recent successful heal reads an ok notice", () => {
  const data = makeData({ autoHeal: { at: 1000, ok: true } });
  const notice = autoBanner(data, 1000 + HEAL_RECENT_MS - 1);
  expect(notice?.kind).toBe("ok");
  expect(notice?.message).toContain("restarted automatically");
});

test("autoBanner: nothing to report reads null", () => {
  expect(autoBanner(makeData(), 1000)).toBeNull();
});

// ---- addPayload ----

test("addPayload: external app sends name and numeric staticPort", () => {
  expect(
    addPayload({ name: " ext ", external: true, command: "", workingDirectory: "", staticPort: "4100" }),
  ).toEqual({ name: "ext", staticPort: 4100 });
});

test("addPayload: service app sends name, whitespace-split command, workingDirectory", () => {
  expect(
    addPayload({
      name: "svc",
      external: false,
      command: "  bun run dev  ",
      workingDirectory: " /tmp/svc ",
      staticPort: "",
    }),
  ).toEqual({ name: "svc", command: ["bun", "run", "dev"], workingDirectory: "/tmp/svc" });
});

// ---- editPatch ----

test("editPatch: service kind adds command array and workingDirectory, port becomes numeric", () => {
  expect(
    editPatch({ name: "svc", port: "4200", kind: "service", command: "bun run dev", workingDirectory: "/tmp/svc" }),
  ).toEqual({ name: "svc", port: 4200, command: ["bun", "run", "dev"], workingDirectory: "/tmp/svc" });
});

test("editPatch: external kind omits command and workingDirectory", () => {
  expect(
    editPatch({ name: "ext", port: "4300", kind: "external", command: "", workingDirectory: "" }),
  ).toEqual({ name: "ext", port: 4300 });
});
