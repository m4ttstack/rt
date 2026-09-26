import { beforeEach, describe, expect, test } from "bun:test";
import { settingsHandler, type RtSettingsApi, type SettingsHandlerOptions } from "../server.ts";

interface FakeDef {
  key: string;
  type: string;
  scopes: string[];
  merge: string;
  description: string;
  secret?: boolean;
  teamLocked?: boolean;
  repoScoped?: boolean;
  default?: unknown;
  schema?: Record<string, unknown>;
  layerSchema?: Record<string, unknown>;
}

const DEFS: Record<string, FakeDef> = {
  "board.title": { key: "board.title", type: "string", scopes: ["user", "machine"], merge: "replace", description: "Board title", default: "Board" },
  "board.rtRepos": { key: "board.rtRepos", type: "array", scopes: ["machine"], merge: "replace", description: "Project map" },
  "rt.secretThing": { key: "rt.secretThing", type: "string", scopes: ["user"], merge: "replace", description: "A secret", secret: true },
  "rt.legacyThing": { key: "rt.legacyThing", type: "string", scopes: ["user"], merge: "replace", description: "Unmigrated" },
  "rt.repoRoots": { key: "rt.repoRoots", type: "array", scopes: ["machine"], merge: "replace", description: "Scan roots", schema: { type: "array", items: { type: "string" } } },
  "board.members": { key: "board.members", type: "array", scopes: ["team"], merge: "replace", description: "Roster" },
  "board.slack": {
    key: "board.slack",
    type: "object",
    scopes: ["team"],
    merge: "deep",
    description: "Slack posting",
    schema: { type: "object", required: ["webhookUrl"], properties: { webhookUrl: { type: "string" }, emoji: { type: "string" } } },
    layerSchema: { type: "object", properties: { webhookUrl: { type: "string" }, emoji: { type: "string" } } },
  },
  "rt.roles": { key: "rt.roles", type: "object", scopes: ["team", "user", "machine"], merge: "deep", description: "Role bindings", repoScoped: true, schema: { type: "object", properties: { dev: { type: "object" } } } },
};

const setCalls: unknown[][] = [];
const unsetCalls: unknown[][] = [];

// Injected through opts.rt, never mock.module — bun's module mock mutates the
// shared registry and would poison rt-client's own tests later in the run.
const RT = {
  allDefs: () => Object.values(DEFS),
  getDef: (key: string) => DEFS[key],
  isMigrated: (def: FakeDef) => def.key !== "rt.legacyThing",
  explainSetting: (key: string, opts?: { repoIdentity?: string | null }) => {
    if (key === "rt.legacyThing") {
      return [
        { scope: "user", file: "/home/user/settings.user.jsonc", present: false },
        { scope: "machine", file: "/home/user/local/settings.local.jsonc", present: false },
      ];
    }
    if (key === "board.title") {
      return [
        { scope: "user", file: "/home/user/settings.user.jsonc", present: true, value: "board.title-user-value", nonconforming: [{ path: [], message: "bad" }] },
        { scope: "machine", file: "/home/user/local/settings.local.jsonc", present: false },
      ];
    }
    if (key === "rt.secretThing") {
      return [
        {
          scope: "user",
          file: "/home/user/settings.user.jsonc",
          present: true,
          value: "rt.secretThing-user-value",
          invalid: 'field "x" looks like a path literal ("/Users/someone/secret")',
          nonconforming: [{ path: ["x"], message: "quoted /Users/someone/secret" }],
        },
        { scope: "machine", file: "/home/user/local/settings.local.jsonc", present: false },
      ];
    }
    if (key === "rt.roles") {
      const rows = [
        { scope: "user", file: "/home/user/settings.user.jsonc", present: true, value: { dev: { port: 3000 } }, nonconforming: [{ path: ["dev", "port"], message: "expected string, got number" }] },
        { scope: "machine", file: "/home/user/local/settings.local.jsonc", present: false },
      ];
      if (opts?.repoIdentity) {
        rows.push({ scope: "team.repo", file: "/home/team/settings.team.jsonc", present: true, value: { dev: { port: 3000 } }, nonconforming: [{ path: ["dev", "port"], message: "expected string, got number" }] });
      }
      return rows;
    }
    return [
      { scope: "user", file: "/home/user/settings.user.jsonc", present: true, value: `${key}-user-value` },
      { scope: "machine", file: "/home/user/local/settings.local.jsonc", present: false },
    ];
  },
  validateValue: (_def: FakeDef, value: unknown) =>
    value === "invalid" ? { ok: false, reason: "value is invalid" } : { ok: true },
  validateWrite: (_def: FakeDef, value: unknown) =>
    value === "invalid" ? { ok: false, reason: "value is invalid", issues: [{ path: [], message: "value is invalid" }] } : { ok: true },
  listUnregisteredSettings: () => [{ key: "board.rtRepos", scope: "machine", file: "/home/user/local/settings.local.jsonc" }],
  repoSectionsFor: (key: string) => (key === "rt.roles" ? [{ identity: "gitlab.example.com/acme/app", scopes: ["team"] }] : []),
  listStoreRepoIdentities: () => ["gitlab.example.com/acme/app"],
  setSetting: (...args: unknown[]) => {
    setCalls.push(args);
    if (args[0] === "board.title" && args[1] === "explode") throw new Error("rt: store refused the write");
  },
  unsetSetting: (...args: unknown[]) => {
    unsetCalls.push(args);
    if (args[0] === "board.title" && args[1] === "machine") throw new Error("rt: nothing to remove there");
    return true;
  },
} as unknown as RtSettingsApi;

function handle(req: Request, extra: SettingsHandlerOptions = {}): Promise<Response | null> {
  return settingsHandler(req, { rt: RT, ...extra });
}

function get(path: string, host = "console.mattstack"): Request {
  return new Request(`http://${host}${path}`);
}

function post(path: string, body: unknown, host = "console.mattstack"): Request {
  return new Request(`http://${host}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  setCalls.length = 0;
  unsetCalls.length = 0;
});

describe("settingsHandler routing", () => {
  test("returns null for non-settings routes so the host falls through", async () => {
    expect(await handle(get("/api/runs"))).toBeNull();
    expect(await handle(get("/"))).toBeNull();
  });

  test("defs lists every registered def with the writable flag computed", async () => {
    const res = await handle(get("/api/settings/defs"));
    const body = (await res!.json()) as { defs: Array<{ key: string; writable: boolean }> };
    const byKey = Object.fromEntries(body.defs.map((d) => [d.key, d]));
    expect(byKey["board.title"]!.writable).toBe(true);
    expect(byKey["board.rtRepos"]!.writable).toBe(false); // composite
    expect(byKey["rt.secretThing"]!.writable).toBe(false); // secret
    expect(byKey["rt.legacyThing"]!.writable).toBe(false); // unmigrated
  });

  test("defs?prefix= filters to one app's namespace", async () => {
    const res = await handle(get("/api/settings/defs?prefix=board."));
    const body = (await res!.json()) as { defs: Array<{ key: string }> };
    expect(body.defs.map((d) => d.key).sort()).toEqual(["board.members", "board.rtRepos", "board.slack", "board.title"]);
  });

  test("a custom basePath relocates every route", async () => {
    const res = await handle(get("/settings-kit/defs"), { basePath: "/settings-kit" });
    expect(res).not.toBeNull();
    expect(await handle(get("/api/settings/defs"), { basePath: "/settings-kit" })).toBeNull();
  });
});

describe("effective (0.1.1)", () => {
  test("defs carry the winning layer precomputed", async () => {
    const res = await handle(get("/api/settings/defs"));
    const body = (await res!.json()) as { defs: Array<{ key: string; effective: { scope: string | null; value?: unknown } }> };
    const byKey = Object.fromEntries(body.defs.map((d) => [d.key, d]));
    expect(byKey["board.title"]!.effective).toMatchObject({ scope: "user", value: "board.title-user-value" });
  });

  test("registry default wins when no layer is present; no-default keys report scope null", async () => {
    const res = await handle(get("/api/settings/defs"));
    const body = (await res!.json()) as { defs: Array<{ key: string; effective: { scope: string | null; value?: unknown; file: string | null } }> };
    const byKey = Object.fromEntries(body.defs.map((d) => [d.key, d]));
    expect(byKey["rt.legacyThing"]!.effective).toEqual({ scope: null, file: null });
  });

  test("a secret's effective carries scope but never the value", async () => {
    const res = await handle(get("/api/settings/defs"));
    const body = (await res!.json()) as { defs: Array<{ key: string; effective: Record<string, unknown> }> };
    const eff = Object.fromEntries(body.defs.map((d) => [d.key, d]))["rt.secretThing"]!.effective;
    expect(eff.scope).toBe("user");
    expect("value" in eff).toBe(false);
  });

  test("set responses include the fresh effective for in-place row patching", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.title", value: "My Board", scope: "user" }));
    const body = (await res!.json()) as { effective: { scope: string } };
    expect(body.effective.scope).toBe("user");
  });
});

describe("allowComposite (0.1.1)", () => {
  test("composite writes stay refused without the opt-in", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.rtRepos", value: [], scope: "machine" }));
    expect(res!.status).toBe(400);
  });

  test("the opt-in admits composite writes through the same ladder and flips writable", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.rtRepos", value: [{ project: "g/p", repo: "gitlab.com/g/p" }], scope: "machine" }), { allowComposite: true });
    expect(res!.status).toBe(200);
    expect(setCalls).toHaveLength(1);

    const defs = await handle(get("/api/settings/defs"), { allowComposite: true });
    const body = (await defs!.json()) as { defs: Array<{ key: string; writable: boolean }> };
    expect(Object.fromEntries(body.defs.map((d) => [d.key, d]))["board.rtRepos"]!.writable).toBe(true);
  });

  test("secrets and unmigrated keys stay unwritable even with the opt-in", async () => {
    const defs = await handle(get("/api/settings/defs"), { allowComposite: true });
    const body = (await defs!.json()) as { defs: Array<{ key: string; writable: boolean }> };
    const byKey = Object.fromEntries(body.defs.map((d) => [d.key, d]));
    expect(byKey["rt.secretThing"]!.writable).toBe(false);
    expect(byKey["rt.legacyThing"]!.writable).toBe(false);
  });
});

describe("explain", () => {
  test("returns def + rows for a known key", async () => {
    const res = await handle(get("/api/settings/explain/board.title"));
    const body = (await res!.json()) as { def: { key: string }; rows: Array<{ value?: unknown }> };
    expect(body.def.key).toBe("board.title");
    expect(body.rows[0]!.value).toBe("board.title-user-value");
  });

  test("404s an unknown key", async () => {
    const res = await handle(get("/api/settings/explain/nope.nothing"));
    expect(res!.status).toBe(404);
  });

  test("a secret key's rows carry presence but never values", async () => {
    const res = await handle(get("/api/settings/explain/rt.secretThing"));
    const body = (await res!.json()) as { rows: Array<Record<string, unknown>> };
    expect(body.rows[0]!.present).toBe(true);
    expect("value" in body.rows[0]!).toBe(false);
  });
});

describe("set guard ladder", () => {
  test("writes a valid staged value and returns fresh rows", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.title", value: "My Board", scope: "user" }));
    expect(res!.status).toBe(200);
    expect(setCalls).toEqual([["board.title", "My Board", "user", {}]]);
    const body = (await res!.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(2);
  });

  test.each([
    ["unknown key → 404", { key: "nope", value: 1, scope: "user" }, 404],
    ["secret → 400", { key: "rt.secretThing", value: "x", scope: "user" }, 400],
    ["composite → 400", { key: "board.rtRepos", value: [], scope: "machine" }, 400],
    ["scope not allowed → 400", { key: "board.title", value: "x", scope: "team" }, 400],
    ["unmigrated → 400", { key: "rt.legacyThing", value: "x", scope: "user" }, 400],
    ["invalid value → 400", { key: "board.title", value: "invalid", scope: "user" }, 400],
  ])("%s", async (_label, body, status) => {
    const res = await handle(post("/api/settings/set", body));
    expect(res!.status).toBe(status);
    expect(setCalls).toHaveLength(0);
  });

  test("a setSetting refusal answers 400 with rt's own message", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.title", value: "explode", scope: "user" }));
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain("rt: store refused");
  });
});

describe("write gate", () => {
  test("default gate refuses a non-local Host", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.title", value: "x", scope: "user" }, "board.example.com"));
    expect(res!.status).toBe(403);
    expect(setCalls).toHaveLength(0);
  });

  test("default gate admits localhost and *.mattstack; reads are never gated", async () => {
    for (const host of ["localhost:3000", "127.0.0.1:11006", "board.mattstack"]) {
      const res = await handle(post("/api/settings/set", { key: "board.title", value: "x", scope: "user" }, host));
      expect(res!.status).toBe(200);
    }
    const read = await handle(get("/api/settings/defs", "board.example.com"));
    expect(read!.status).toBe(200);
  });

  test("a host-supplied allowWrite replaces the default entirely", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.title", value: "x", scope: "user" }), { allowWrite: () => false });
    expect(res!.status).toBe(403);
  });
});

describe("unset (0.1.2)", () => {
  test("removes a key and returns fresh rows + effective for in-place patching", async () => {
    const res = await handle(post("/api/settings/unset", { key: "board.title", scope: "user" }));
    expect(res!.status).toBe(200);
    expect(unsetCalls).toEqual([["board.title", "user", {}]]);
    const body = (await res!.json()) as { rows: unknown[]; effective: { scope: string } };
    expect(body.rows).toHaveLength(2);
    expect(body.effective.scope).toBe("user");
  });

  test.each([
    ["unknown key → 404", { key: "nope", scope: "user" }, 404],
    ["secret → 400", { key: "rt.secretThing", scope: "user" }, 400],
    ["composite without opt-in → 400", { key: "board.rtRepos", scope: "machine" }, 400],
    ["scope not allowed → 400", { key: "board.title", scope: "team" }, 400],
    ["unmigrated → 400", { key: "rt.legacyThing", scope: "user" }, 400],
  ])("%s", async (_label, body, status) => {
    const res = await handle(post("/api/settings/unset", body));
    expect(res!.status).toBe(status);
    expect(unsetCalls).toHaveLength(0);
  });

  test("the composite opt-in admits composite unsets", async () => {
    const res = await handle(post("/api/settings/unset", { key: "board.rtRepos", scope: "machine" }), { allowComposite: true });
    expect(res!.status).toBe(200);
    expect(unsetCalls).toHaveLength(1);
  });

  test("an rt refusal answers 400 with rt's own message", async () => {
    const res = await handle(post("/api/settings/unset", { key: "board.title", scope: "machine" }));
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain("nothing to remove");
  });

  test("the write gate covers unset", async () => {
    const res = await handle(post("/api/settings/unset", { key: "board.title", scope: "user" }, "board.example.com"));
    expect(res!.status).toBe(403);
    expect(unsetCalls).toHaveLength(0);
  });
});

describe("allowComposite: 'shaped'", () => {
  const opts = { allowComposite: "shaped" as const };

  test("defs mark a shaped composite writable and an unshaped one not", async () => {
    const res = await handle(get("/api/settings/defs"), opts);
    const { defs } = (await res!.json()) as { defs: { key: string; writable: boolean }[] };
    const w = Object.fromEntries(defs.map((d) => [d.key, d.writable]));
    expect(w["rt.repoRoots"]).toBe(true);
    expect(w["board.rtRepos"]).toBe(false);
    expect(w["board.members"]).toBe(false);
  });

  test("writes a shaped composite whose value matches", async () => {
    const res = await handle(post("/api/settings/set", { key: "rt.repoRoots", scope: "machine", value: ["~/src"] }), opts);
    expect(res!.status).toBe(200);
    expect(setCalls).toHaveLength(1);
  });

  test("a bad value is refused by validateWrite, never a shape check", async () => {
    const res = await handle(post("/api/settings/set", { key: "rt.repoRoots", scope: "machine", value: "invalid" }), opts);
    expect(res!.status).toBe(400);
    expect(await res!.json()).toEqual({ error: "value is invalid", issues: [{ path: [], message: "value is invalid" }] });
    expect(setCalls).toHaveLength(0);
  });

  test("refuses an unshaped composite and an external one", async () => {
    const a = await handle(post("/api/settings/set", { key: "board.rtRepos", scope: "machine", value: [] }), opts);
    expect(await a!.json()).toEqual({ error: '"board.rtRepos" has no editable shape' });
    const b = await handle(post("/api/settings/set", { key: "board.members", scope: "team", value: [] }), opts);
    expect(await b!.json()).toEqual({ error: '"board.members" has no editable shape' });
    expect(setCalls).toHaveLength(0);
  });

  test("unset refuses an unshaped composite and an external one", async () => {
    const a = await handle(post("/api/settings/unset", { key: "board.rtRepos", scope: "machine" }), opts);
    expect(a!.status).toBe(400);
    expect(await a!.json()).toEqual({ error: '"board.rtRepos" has no editable shape' });
    const b = await handle(post("/api/settings/unset", { key: "board.members", scope: "team" }), opts);
    expect(b!.status).toBe(400);
    expect(await b!.json()).toEqual({ error: '"board.members" has no editable shape' });
    expect(unsetCalls).toHaveLength(0);
  });

  test("unset admits a shaped composite", async () => {
    const res = await handle(post("/api/settings/unset", { key: "rt.repoRoots", scope: "machine" }), opts);
    expect(res!.status).toBe(200);
    expect(unsetCalls).toEqual([["rt.repoRoots", "machine", {}]]);
  });

  test("allowComposite: true still admits every composite", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.rtRepos", scope: "machine", value: [] }), { allowComposite: true });
    expect(res!.status).toBe(200);
  });
});

describe("JSON-only writes", () => {
  test("a non-JSON media type is 415 on set and unset, and nothing is written", async () => {
    for (const path of ["/api/settings/set", "/api/settings/unset"]) {
      const res = await handle(
        new Request(`http://console.mattstack${path}`, {
          method: "POST",
          headers: { "content-type": "text/plain;x=application/json" },
          body: JSON.stringify({ key: "board.title", scope: "user", value: "x" }),
        }),
      );
      expect(res!.status).toBe(415);
    }
    expect(setCalls).toHaveLength(0);
    expect(unsetCalls).toHaveLength(0);
  });

  test("a charset parameter on application/json is fine", async () => {
    const res = await handle(
      new Request("http://console.mattstack/api/settings/set", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ key: "board.title", scope: "user", value: "x" }),
      }),
    );
    expect(res!.status).toBe(200);
  });
});

describe("schema on the wire", () => {
  test("/defs carries schema, layerSchema, storeVersion, issues and unregistered", async () => {
    const body = (await (await handle(get("/api/settings/defs")))!.json()) as any;
    const slack = body.defs.find((d: any) => d.key === "board.slack");
    expect(slack.schema.type).toBe("object");
    expect(slack.layerSchema.required).toBeUndefined();
    expect(slack.storeVersion).toBe(1);
    expect(body.unregistered).toEqual([{ key: "board.rtRepos", scope: "machine", file: "/home/user/local/settings.local.jsonc" }]);
  });

  test("a nonconforming explain row is an issue on /defs and on the explain row", async () => {
    const explain = (await (await handle(get("/api/settings/explain/board.title")))!.json()) as any;
    expect(explain.rows[0].nonconforming).toEqual([{ path: [], message: "bad" }]);
    const defs = (await (await handle(get("/api/settings/defs")))!.json()) as any;
    expect(defs.defs.find((d: any) => d.key === "board.title").issues[0]).toMatchObject({ scope: "user", kind: "nonconforming", path: [], message: "bad" });
  });

  test("a secret key's issues never carry a value, even a path-guard reason or nonconforming message that quotes one", async () => {
    const defs = (await (await handle(get("/api/settings/defs")))!.json()) as any;
    const secret = defs.defs.find((d: any) => d.key === "rt.secretThing");
    expect(secret.issues).toEqual([
      { scope: "user", file: "/home/user/settings.user.jsonc", kind: "invalid", path: [], message: "refused" },
      { scope: "user", file: "/home/user/settings.user.jsonc", kind: "nonconforming", path: ["x"], message: "does not match the schema" },
    ]);
    expect(secret.effective.invalid).toBe("refused");
    const explain = (await (await handle(get("/api/settings/explain/rt.secretThing")))!.json()) as any;
    expect(explain.rows[0].invalid).toBe("refused");
    expect(explain.rows[0].nonconforming).toEqual([{ path: ["x"], message: "does not match the schema" }]);
    expect(explain.def.effective.invalid).toBe("refused");
    expect(JSON.stringify(explain)).not.toContain("/Users/someone/secret");
    expect(JSON.stringify(defs)).not.toContain("/Users/someone/secret");
  });

  test("?repo= resolves repo rungs, repos[] lists sections, and repo is stamped only on repo-rung issues", async () => {
    const body = (await (await handle(get("/api/settings/defs?repo=gitlab.example.com%2Facme%2Fapp")))!.json()) as any;
    const roles = body.defs.find((d: any) => d.key === "rt.roles");
    expect(roles.effective.scope).toBe("team.repo");
    expect(roles.repos).toEqual([{ identity: "gitlab.example.com/acme/app", scopes: ["team"] }]);
    const userIssue = roles.issues.find((i: any) => i.scope === "user");
    const repoIssue = roles.issues.find((i: any) => i.scope === "team.repo");
    expect(userIssue.repo).toBeUndefined();
    expect(repoIssue.repo).toBe("gitlab.example.com/acme/app");
  });

  test("GET /repos lists store identities with labels", async () => {
    const body = (await (await handle(get("/api/settings/repos")))!.json()) as any;
    expect(body.repos).toEqual([{ identity: "gitlab.example.com/acme/app", label: "acme/app" }]);
  });

  test("/set forwards repo, uses validateWrite, and explains for the repo afterwards", async () => {
    const res = await handle(post("/api/settings/set", { key: "rt.roles", scope: "team", repo: "gitlab.example.com/acme/app", value: { dev: { port: 1 } } }), { allowComposite: true });
    expect(setCalls.at(-1)).toEqual(["rt.roles", { dev: { port: 1 } }, "team", { repoIdentity: "gitlab.example.com/acme/app" }]);
    const resBody = (await res!.json()) as any;
    expect(resBody.rows.some((r: any) => r.scope === "team.repo")).toBe(true);
    const bad = await handle(post("/api/settings/set", { key: "board.title", scope: "user", value: "invalid" }));
    expect(bad!.status).toBe(400);
    expect(await bad!.json()).toEqual({ error: "value is invalid", issues: [{ path: [], message: "value is invalid" }] });
  });

  test("an empty repo string is normalized to no repo, for both set and defs", async () => {
    const res = await handle(post("/api/settings/set", { key: "board.title", value: "My Board", scope: "user", repo: "" }));
    expect(res!.status).toBe(200);
    expect(setCalls.at(-1)).toEqual(["board.title", "My Board", "user", {}]);
    const body = (await (await handle(get("/api/settings/defs?repo=")))!.json()) as any;
    const roles = body.defs.find((d: any) => d.key === "rt.roles");
    expect(roles.effective.scope).toBe("user");
    expect(roles.repos).toEqual([{ identity: "gitlab.example.com/acme/app", scopes: ["team"] }]);
  });
});

describe("versioned store names on the wire", () => {
  const FILE = "/home/user/settings.user.jsonc";
  const MIG_DEFS: Record<string, FakeDef> = {
    "t.rules": { key: "t.rules", type: "array", scopes: ["user"], merge: "replace", description: "Rules", repoScoped: true, schema: { type: "array" } },
    "t.staleRules": { key: "t.staleRules", type: "array", scopes: ["user"], merge: "replace", description: "Rules", schema: { type: "array" } },
    "t.secretRules": { key: "t.secretRules", type: "array", scopes: ["user"], merge: "replace", description: "Rules", secret: true },
  };
  const rowsFor = (key: string, label: "diverged" | "stale") => [
    { scope: "default", file: null, present: false },
    {
      scope: "user",
      file: FILE,
      present: true,
      value: [{ match: "herd/*" }],
      storeName: `${key}@2`,
      storedVersion: 2,
      authored: [{ match: "herd/*" }],
      olderLabel: label,
      olderNames: [{ storeName: key, storedVersion: 1, label, value: [{ match: "gate/*" }], authored: [{ pattern: "gate/*" }] }],
    },
  ];
  const pruneCalls: unknown[][] = [];
  const MIG_RT = {
    ...(RT as unknown as Record<string, unknown>),
    allDefs: () => Object.values(MIG_DEFS),
    getDef: (key: string) => MIG_DEFS[key],
    isMigrated: () => true,
    explainSetting: (key: string) => rowsFor(key, key === "t.staleRules" ? "stale" : "diverged"),
    repoSectionsFor: () => [],
    pruneStoreName: (...args: unknown[]) => {
      pruneCalls.push(args);
      if (args[1] === "t.rules@2") throw new Error('rt: "t.rules@2" is not an older store name of "t.rules"');
      return args[1] === "t.gone" ? { removed: false } : { removed: true, authored: [{ pattern: "gate/*" }] };
    },
  } as unknown as RtSettingsApi;
  const call = (req: Request) => settingsHandler(req, { rt: MIG_RT, allowComposite: true });

  beforeEach(() => {
    pruneCalls.length = 0;
  });

  test("/defs carries a diverged issue with storeName, olderValue and currentValue; stale is not an issue", async () => {
    const body = (await (await call(get("/api/settings/defs")))!.json()) as { defs: { key: string; issues: Record<string, unknown>[] }[] };
    const rules = body.defs.find((d) => d.key === "t.rules")!;
    expect(rules.issues).toEqual([
      expect.objectContaining({ scope: "user", file: FILE, kind: "diverged", path: [], storeName: "t.rules", olderValue: [{ match: "gate/*" }], currentValue: [{ match: "herd/*" }] }),
    ]);
    expect(typeof rules.issues[0]!.message).toBe("string");
    expect(body.defs.find((d) => d.key === "t.staleRules")!.issues).toEqual([]);
  });

  test("/explain rows carry storeName, storedVersion, authored and labeled older names", async () => {
    const body = (await (await call(get("/api/settings/explain/t.rules")))!.json()) as { rows: Record<string, unknown>[] };
    expect(body.rows[1]).toMatchObject({
      storeName: "t.rules@2",
      storedVersion: 2,
      authored: [{ match: "herd/*" }],
      olderLabel: "diverged",
      olderNames: [{ storeName: "t.rules", storedVersion: 1, label: "diverged", value: [{ match: "gate/*" }], authored: [{ pattern: "gate/*" }] }],
    });
    expect("storeName" in body.rows[0]!).toBe(false);
  });

  test("a secret def sends neither value on a diverged issue nor on its rows", async () => {
    const defs = (await (await call(get("/api/settings/defs")))!.json()) as { defs: { key: string; issues: Record<string, unknown>[] }[] };
    const issue = defs.defs.find((d) => d.key === "t.secretRules")!.issues[0]!;
    expect(issue).toMatchObject({ kind: "diverged", storeName: "t.secretRules" });
    expect("olderValue" in issue || "currentValue" in issue).toBe(false);
    const explain = (await (await call(get("/api/settings/explain/t.secretRules")))!.json()) as { rows: Record<string, unknown>[] };
    expect("authored" in explain.rows[1]!).toBe(false);
    expect(explain.rows[1]!.olderNames).toEqual([{ storeName: "t.secretRules", storedVersion: 1, label: "diverged" }]);
  });

  test("/prune calls pruneStoreName with the body and answers rows and effective", async () => {
    const res = (await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.rules", force: true, repo: "gitlab.example.com/acme/app" })))!;
    expect(res.status).toBe(200);
    expect(pruneCalls).toEqual([["t.rules", "t.rules", "user", { repoIdentity: "gitlab.example.com/acme/app", force: true }]]);
    const body = (await res.json()) as { rows: unknown[]; effective: unknown };
    expect(body.rows).toHaveLength(2);
    expect(body.effective).toBeDefined();
  });

  test("/prune answers 400 with rt's refusal, a missing storeName, or a name not in the store", async () => {
    const refused = (await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.rules@2" })))!;
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("is not an older store name");
    expect((await call(post("/api/settings/prune", { key: "t.rules", scope: "user" })))!.status).toBe(400);
    expect((await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.gone" })))!.status).toBe(400);
  });

  test("/prune is local-only, needs JSON, and refuses unknown and secret keys", async () => {
    expect((await call(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.rules" }, "settings.example.com")))!.status).toBe(403);
    const notJson = new Request("http://console.mattstack/api/settings/prune", { method: "POST", body: "x" });
    expect((await call(notJson))!.status).toBe(415);
    expect((await call(post("/api/settings/prune", { key: "t.nope", scope: "user", storeName: "t.nope" })))!.status).toBe(404);
    expect((await call(post("/api/settings/prune", { key: "t.secretRules", scope: "user", storeName: "t.secretRules" })))!.status).toBe(400);
    expect(pruneCalls).toEqual([]);
  });

  test("/prune refuses a scope the key does not allow, saying pruned rather than unset", async () => {
    const res = (await call(post("/api/settings/prune", { key: "t.rules", scope: "team", storeName: "t.rules" })))!;
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(`"t.rules" cannot be pruned in the team store`);
    expect(pruneCalls).toEqual([]);
  });

  test("/prune refuses a composite key under the default allowComposite, same as /set and /unset", async () => {
    const res = await settingsHandler(post("/api/settings/prune", { key: "t.rules", scope: "user", storeName: "t.rules" }), { rt: MIG_RT });
    expect(res!.status).toBe(400);
    expect(((await res!.json()) as { error: string }).error).toContain("composite value");
    expect(pruneCalls).toEqual([]);
  });
});
