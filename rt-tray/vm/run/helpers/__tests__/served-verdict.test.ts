import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { FIXTURES, JQ_DIR, runJq } from "./jq.ts";

const VERDICT = join(JQ_DIR, "served-verdict.jq");
const HOME = "/Users/tester";
const HELPERS = "/Applications/mattstack.app/Contents/Helpers";

interface CatalogApp { name: string; status: string; port: number; args: string[] }
interface Job { loaded: boolean; program: string | null; argv: string[]; cwd: string | null; pid: number | null; lastExit: string | null }

const PROD_APPS: CatalogApp[] = [
  { name: "board", status: "bundled", port: 11006, args: [] },
  { name: "boxscore", status: "bundled", port: 11005, args: [] },
  { name: "chat", status: "bundled", port: 11002, args: [] },
  { name: "console", status: "bundled", port: 11001, args: [] },
];
const TOOLS = ["deck", "gitq", "jq"];

// Field names and nesting follow deck's StatusRow (apps/deck/src/api/status.ts);
// `icon` is the URL deck 1.1.0 advertises once a bundled identity resolves.
function row(name: string, over: Record<string, unknown> = {}) {
  return {
    name, displayTld: "mattstack", url: `https://${name}.mattstack`, icon: `/api/apps/${name}/icon`,
    health: { ok: true, status: 200, ms: 1 }, managedBy: "rt", issues: [], ...over,
  };
}
function job(app: CatalogApp, over: Partial<Job> = {}): Job {
  const bin = `${HELPERS}/${app.name}`;
  return { loaded: true, program: bin, argv: [bin, ...app.args], cwd: `${HOME}/.mattstack/${app.name}`, pid: 4242, lastExit: null, ...over };
}
const notLoaded: Job = { loaded: false, program: null, argv: [], cwd: null, pid: null, lastExit: null };

interface Case {
  apps?: CatalogApp[];
  tools?: string[];
  status?: unknown;
  launchd?: Record<string, Job>;
  routes?: unknown;
  before?: unknown;
}

function verdict(c: Case = {}): { kind: string; msg: string }[] {
  const apps = c.apps ?? PROD_APPS;
  const tools = c.tools ?? TOOLS;
  const status = c.status !== undefined ? c.status : { devMode: false, apps: apps.map((a) => row(a.name)) };
  const launchd = c.launchd ?? {
    ...Object.fromEntries(apps.map((a) => [a.name, job(a)])),
    ...Object.fromEntries(tools.map((t) => [t, notLoaded])),
  };
  const routes = c.routes !== undefined ? c.routes : apps.map((a) => ({ hostname: `${a.name}.mattstack`, port: a.port, pid: 0 }));
  const dir = mkdtempSync(join(tmpdir(), "served-verdict-"));
  const file = (n: string, v: unknown) => { const p = join(dir, n); writeFileSync(p, JSON.stringify(v)); return p; };
  const out = runJq([
    "-r", "-n",
    "--slurpfile", "catalog", file("catalog.json", { apps, tools }),
    "--slurpfile", "status", file("status.json", status),
    "--slurpfile", "launchd", file("launchd.json", launchd),
    "--slurpfile", "routes", file("routes.json", routes),
    "--slurpfile", "before", file("before.json", c.before ?? null),
    "--arg", "helpers", HELPERS, "--arg", "home", HOME,
    "-f", VERDICT,
  ]);
  return out.trimEnd().split("\n").map((l) => {
    const [kind, ...rest] = l.split("\t");
    return { kind: kind!, msg: rest.join("\t") };
  });
}
const bads = (lines: { kind: string; msg: string }[]) => lines.filter((l) => l.kind === "bad").map((l) => l.msg);

describe("served-verdict.jq", () => {
  test("the healthy prod set passes with no bad line, and every catalog app is named", () => {
    const lines = verdict();
    expect(lines.every((l) => l.kind === "ok" || l.kind === "bad")).toBe(true);
    expect(bads(lines)).toEqual([]);
    for (const a of PROD_APPS) expect(lines.some((l) => l.msg.startsWith(`${a.name}: running`))).toBe(true);
    expect(lines.some((l) => l.msg.startsWith("no deps.lock tool is loaded as a deck app"))).toBe(true);
  });

  test("an empty catalog is one bad line, never a vacuous pass", () => {
    expect(verdict({ apps: [] })).toEqual([{ kind: "bad", msg: "deps.lock names no served apps: no helper row carries serve" }]);
  });

  test("deck not answering is one bad line", () => {
    expect(bads(verdict({ status: null }))).toEqual(["deck /api/v1/status did not answer with an apps list"]);
  });

  test("a pending serve row fails: the catalog names an app this bundle does not ship", () => {
    const apps = PROD_APPS.map((a) => (a.name === "boxscore" ? { ...a, status: "pending" } : a));
    expect(bads(verdict({ apps }))).toEqual(["boxscore: deps.lock serves it but its row is pending, so this bundle does not ship it"]);
  });

  test("a missing row, a user-owned row, and devMode each fail", () => {
    const status = { devMode: true, apps: [row("board"), row("chat", { managedBy: "user" }), row("console")] };
    expect(bads(verdict({ status }))).toEqual([
      "deck reports devMode true inside the prod bundle",
      "boxscore: no row in deck /api/v1/status (not registered, or no route)",
      'chat: managedBy is "user", wanted "rt"',
    ]);
  });

  test("a live pid is not health: an app whose probe fails is bad even while launchd holds a pid", () => {
    const status = { devMode: false, apps: PROD_APPS.map((a) => (a.name === "board" ? row("board", { health: { ok: false, status: null, ms: null } }) : row(a.name))) };
    expect(bads(verdict({ status }))).toEqual(['board: unhealthy: {"ok":false,"status":null,"ms":null}']);
  });

  test("an app whose status row advertises no icon fails: its bundled identity is missing", () => {
    const status = { devMode: false, apps: PROD_APPS.map((a) => (a.name === "chat" ? row("chat", { icon: null }) : row(a.name))) };
    expect(bads(verdict({ status }))).toEqual(["chat: no icon on its deck status row (bundled identity missing)"]);
  });

  // The capture was trimmed of `icon`, so every catalog row reads as iconless.
  test("a dev-lived capture reports boxscore serving source, and its iconless rows each fail", () => {
    const status = JSON.parse(readFileSync(join(FIXTURES, "deck-status-dev-lived.json"), "utf8"));
    expect(bads(verdict({ status }))).toEqual([
      "board: no icon on its deck status row (bundled identity missing)",
      "boxscore: dev-link issue: bundle for boxscore not installed; serving source",
      "boxscore: no icon on its deck status row (bundled identity missing)",
      "chat: no icon on its deck status row (bundled identity missing)",
      "console: no icon on its deck status row (bundled identity missing)",
    ]);
  });

  test("argv0 under the dev bundle, missing serve args, a wrong cwd and a refused spawn each fail", () => {
    const [board, boxscore, chat, consoleApp] = PROD_APPS as [CatalogApp, CatalogApp, CatalogApp, CatalogApp];
    const devBin = "/Applications/mattstack-dev.app/Contents/Helpers/board";
    const apps = PROD_APPS.map((a) => (a.name === "chat" ? { ...a, args: ["serve"] } : a));
    const launchd = {
      board: job(board, { program: devBin, argv: [devBin] }),
      boxscore: job(boxscore, { cwd: `${HOME}/Documents/GitHub/mattstack-apps/apps/boxscore` }),
      chat: job(chat),
      console: job(consoleApp, { pid: null, lastExit: "78: EX_CONFIG" }),
      deck: notLoaded, gitq: notLoaded, jq: notLoaded,
    };
    expect(bads(verdict({ apps, launchd }))).toEqual([
      `board: argv0 is "${devBin}", wanted ${HELPERS}/board`,
      `board: argv is ["${devBin}"], wanted ["${HELPERS}/board"]`,
      `boxscore: working directory is "${HOME}/Documents/GitHub/mattstack-apps/apps/boxscore", wanted ${HOME}/.mattstack/boxscore`,
      `chat: argv is ["${HELPERS}/chat"], wanted ["${HELPERS}/chat","serve"]`,
      "console: loaded but not running (last exit 78: EX_CONFIG)",
    ]);
  });

  // deck joins a route to a service by label substring (core/discover.ts
  // joinApps), so a row's own `service` can belong to another app entirely.
  test("an app with no launchd job fails by its exact label, whatever service the status row claims", () => {
    const status = {
      devMode: false,
      apps: PROD_APPS.map((a) => (a.name === "console" ? row("console", { service: { label: "com.mattstack.deck.console-docs", pid: 3238 } }) : row(a.name))),
    };
    const launchd = { ...Object.fromEntries(PROD_APPS.map((a) => [a.name, job(a)])), console: notLoaded };
    expect(bads(verdict({ status, launchd }))).toEqual(["console: com.mattstack.deck.console is not loaded in launchd"]);
  });

  test("a tool loaded as a deck app fails by name: the gitq CLI is never a served app", () => {
    const launchd = {
      ...Object.fromEntries(PROD_APPS.map((a) => [a.name, job(a)])),
      deck: notLoaded, jq: notLoaded,
      gitq: { loaded: true, program: `${HELPERS}/gitq`, argv: [`${HELPERS}/gitq`], cwd: `${HOME}/.mattstack/gitq`, pid: 99, lastExit: "1" },
    };
    expect(bads(verdict({ launchd }))).toEqual(["com.mattstack.deck.gitq is loaded, but deps.lock ships gitq as a tool, never an app"]);
  });

  test("with no pre-update snapshot, no line compares pids", () => {
    expect(verdict().filter((l) => l.msg.includes("update"))).toEqual([]);
  });

  // A Sparkle swap replaces Contents/Helpers/<name> at the same path, so a job
  // still on the deleted binary passes every other check.
  test("an app still on its pre-update process fails; one that restarted passes", () => {
    const before = Object.fromEntries(PROD_APPS.map((a) => [a.name, job(a, { pid: a.name === "board" ? 4242 : 1000 })]));
    const lines = verdict({ before });
    expect(bads(lines)).toEqual(["board: still the pre-update process (pid 4242)"]);
    expect(lines).toContainEqual({ kind: "ok", msg: "chat: restarted since the update (pid 1000, now 4242)" });
  });

  test("an app with no pre-update pid says so rather than passing silently", () => {
    const before = Object.fromEntries(PROD_APPS.map((a) => [a.name, a.name === "chat" ? notLoaded : job(a, { pid: 1000 })]));
    const lines = verdict({ before });
    expect(bads(lines)).toEqual([]);
    expect(lines).toContainEqual({ kind: "ok", msg: "chat: had no pre-update pid to compare" });
  });

  test("an app without its .mattstack route fails", () => {
    const routes = [{ hostname: "board.localhost", port: 11006, pid: 0 }, ...PROD_APPS.filter((a) => a.name !== "board").map((a) => ({ hostname: `${a.name}.mattstack`, port: a.port, pid: 0 }))];
    expect(bads(verdict({ routes }))).toEqual(["board: no board.mattstack route in ~/.portless/routes.json"]);
  });
});
