// src/cli/commands.ts
import { apiJson } from "./client.ts";
import { configInit } from "./config-init.ts";
import pkg from "../../package.json";

export const VERSION = pkg.version;

/** Frozen literal in the installer contract — see the adopt verb below. */
export const DECK_NOT_RUNNING = "deck not running";

// The product is Deck. The command is deck, not local: local is a shell
// reserved word in zsh and bash (zsh silently declares a variable, bash
// hard-errors), and reserved words beat PATH.
const USAGE = `deck: named https domains, supervision, and sharing for local apps

usage:
  deck status | list                       show every app
  deck url <name> [--public]               print its local url (or public url with --public)
  deck add <name> --port N                 route an app you run yourself
  deck add <name> --cmd "…" --dir PATH     register a supervised app
  deck config init                         scaffold mattstack.deck.json in cwd
  deck register [--dir PATH]               create/sync an app from its mattstack.deck.json
  deck alt <app> <name|off>                activate a declared serve overlay, or return to base
  deck cmd <app> <name>                    run a declared action command (dev mode only)
  deck remove <name> [--force]             unregister (registrar-owned; --force is the escape hatch)
  deck remove --managed                    unregister every app deck manages (installer's uninstall step)
  deck restart <name>                      kickstart its service
  deck restart --managed                   kickstart every app deck manages (installer's version-change step)
  deck logs <name> [--lines N]             tail stderr
  deck override <name> <port|off>          dev-port override for <name>.localhost
  deck publish <name> on|off               public visibility
  deck password <name> [--clear]           password gate (prompts)
  deck access <name> off | emails a,b | domains c,d    google sign-in gate
  deck adopt <name> [--as NEW] [--managed-by ID] [--json]   claim a user app as a mattstack product
  deck domain <domain>                     bind your own domain (cloudflared)
  deck migrate                             adopt existing plists + routes
  deck migrate --convert                   relabel adopted legacy apps to com.mattstack.deck.<name>
  deck remote <name> on|off                serve <name> publicly from Railway (on) or the tunnel (off)
  deck push <name>                         redeploy a remote app from the local checkout
  deck serve | setup | uninstall | update  platform lifecycle
  deck version`;

interface Io { out(s: string): void; err(s: string): void }

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function runCommand(
  argv: string[],
  io: Io,
  promptFn: (msg: string) => string | null = prompt,
): Promise<number> {
  const [verb, ...rest] = argv;
  try {
    switch (verb) {
      case "status":
      case "list": {
        // GET /api/v1/apps, not /api/v1/status: /apps returns every registered
        // record (live-joined where a route exists yet, synthesized otherwise),
        // per server.test.ts's own "freshly-registered app with no route yet"
        // coverage. /status only lists apps with an actual routes.json entry,
        // which a freshly `add`ed app won't have until the edge driver's alias
        // call lands (and never will against the fakes this CLI is tested with).
        const { body } = await apiJson("/api/v1/apps");
        for (const row of body.apps ?? []) {
          const health = row.health ? (row.health.ok ? "up" : "DOWN") : "-";
          const managed = row.managedBy ?? "unregistered";
          const issues = (row.issues ?? []).map((i: any) => ` !${i.source}`).join("");
          const origin = row.remote ? ` [public:railway/${row.remote.status}]` : "";
          io.out(`${row.name.padEnd(24)} ${String(row.port ?? "-").padEnd(6)} ${health.padEnd(5)} ${managed}${issues}${origin}`);
        }
        return 0;
      }
      case "url": {
        const [name] = rest;
        if (!name) { io.err(USAGE); return 2; }
        const wantPublic = rest.includes("--public");
        const { status, body } = await apiJson(`/api/v1/apps/${name}`);
        if (status === 404) { io.err(`unknown service: ${name}`); return 1; }
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        const row = body.row;
        if (wantPublic) {
          // publicUrl is set even for unpublished apps, so `published` is the
          // gate on whether the shareable URL actually resolves.
          if (!row?.published) { io.err(`${name} is not published; run \`deck publish ${name} on\``); return 1; }
          if (!row.publicUrl) { io.err(`${name} has no public url`); return 1; }
          io.out(row.publicUrl);
          return 0;
        }
        // A record with no route has a null url: it has no reachable address,
        // so it reads as not found rather than printing an empty line.
        if (!row?.url) { io.err(`unknown service: ${name}`); return 1; }
        io.out(row.url);
        return 0;
      }
      case "add": {
        const [name] = rest;
        if (!name) { io.err(USAGE); return 2; }
        const port = flag(rest, "--port");
        const cmd = flag(rest, "--cmd");
        const dir = flag(rest, "--dir");
        const payload = port
          ? { name, staticPort: Number(port) }
          : { name, command: (cmd ?? "").split(/\s+/).filter(Boolean), workingDirectory: dir };
        const { status, body } = await apiJson("/api/v1/apps", { method: "POST", body: JSON.stringify(payload) });
        if (status !== 201) { io.err(body.message || body.error || `failed (${status})`); return 1; }
        io.out(`registered ${name} on port ${body.record.port}`);
        return 0;
      }
      case "remove": {
        if (rest.includes("--managed")) {
          const { status, body } = await apiJson(`/api/v1/apps/managed/remove`, { method: "POST" });
          if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
          for (const name of body.removed ?? []) io.out(`removed ${name}`);
          for (const name of body.failed ?? []) io.err(`partly removed ${name} — the record was kept`);
          return body.ok === false ? 1 : 0;
        }
        const [name] = rest;
        if (!name) { io.err(USAGE); return 2; }
        const force = rest.includes("--force") ? "?force=true" : "";
        const { status, body } = await apiJson(`/api/v1/apps/${name}${force}`, { method: "DELETE" });
        if (status !== 200) { io.err(body.message || body.error || `failed (${status})`); return 1; }
        // A teardown whose drivers did not all succeed answers 200 with
        // ok:false and KEEPS the record (see unregisterApp). Reporting that
        // as "removed" sends someone off believing an app is gone while it
        // is still registered, still routed, and still on the board.
        if (body.ok === false) {
          const issues = (body.record?.issues ?? []) as Array<{ source: string; message: string }>;
          const detail = issues.map((i) => `${i.source}: ${i.message}`).join("; ");
          io.err(`partly removed ${name} — the record was kept${detail ? ` (${detail})` : ""}`);
          return 1;
        }
        io.out(`removed ${name}`);
        return 0;
      }
      case "restart": {
        if (rest.includes("--managed")) {
          const { status, body } = await apiJson(`/api/v1/apps/managed/restart`, { method: "POST" });
          if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
          for (const name of body.restarted ?? []) io.out(`restarted ${name}`);
          for (const f of (body.failed ?? []) as Array<{ name: string; error: string }>) io.err(`failed to restart ${f.name} — ${f.error}`);
          return body.ok === false ? 1 : 0;
        }
        const [name] = rest;
        if (!name) { io.err(USAGE); return 2; }
        const { status, body } = await apiJson(`/api/v1/apps/${name}/restart`, { method: "POST" });
        if (status !== 200 || body.ok === false) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out("restarted");
        return 0;
      }
      case "logs": {
        const [name] = rest;
        if (!name) { io.err(USAGE); return 2; }
        const lines = flag(rest, "--lines") ?? "40";
        const { body } = await apiJson(`/api/v1/apps/${name}/logs?lines=${lines}`);
        for (const l of body.stderr ?? []) io.out(l);
        return 0;
      }
      case "override": {
        const [name, port] = rest;
        if (!name || !port) { io.err(USAGE); return 2; }
        const devPort = port === "off" ? null : Number(port);
        const { status, body } = await apiJson(`/api/v1/apps/${name}/override`, {
          method: "PUT", body: JSON.stringify({ devPort }),
        });
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out(port === "off" ? "override cleared" : `\`${name}.localhost\` now serves port ${port}`);
        return 0;
      }
      case "publish": {
        const [name, onOff] = rest;
        if (!name || !onOff) { io.err(USAGE); return 2; }
        const { status, body } = await apiJson(`/api/v1/apps/${name}/publish`, {
          method: "PUT", body: JSON.stringify({ published: onOff === "on" }),
        });
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out(onOff === "on" ? `${name} is now public` : `${name} is now private`);
        return 0;
      }
      case "password": {
        const [name] = rest;
        if (!name) { io.err(USAGE); return 2; }
        const clearFlag = rest.includes("--clear");
        // An empty prompt result (Ctrl-D, blank enter) hits the API's own
        // clear-on-empty-string path, same as --clear. Track that so the
        // printed message never claims "set" when the real effect was a clear.
        const entered = clearFlag ? null : promptFn("password:");
        const password = clearFlag ? null : (entered ?? "");
        const { status, body } = await apiJson(`/api/v1/apps/${name}/password`, {
          method: "PUT", body: JSON.stringify({ password }),
        });
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        if (clearFlag) io.out("password cleared");
        else if (!entered) io.out("no password entered — password cleared");
        else io.out("password set");
        return 0;
      }
      case "access": {
        const [name, mode, value] = rest;
        if (!name || !mode) { io.err(USAGE); return 2; }
        let payload: Record<string, unknown>;
        if (mode === "off") {
          payload = { mode: "off" };
        } else if (mode === "emails" || mode === "domains") {
          const items = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          if (!items.length) { io.err(`${mode} needs a comma-separated list`); return 2; }
          payload = mode === "emails" ? { mode, emails: items } : { mode, domains: items };
        } else {
          io.err(USAGE);
          return 2;
        }
        const { status, body } = await apiJson(`/api/v1/apps/${name}/access`, {
          method: "PUT", body: JSON.stringify(payload),
        });
        if (status !== 200) { io.err(body.message || body.error || `failed (${status})`); return 1; }
        if (body.cfSynced === false) io.err("warning: Cloudflare sync failed, see the app's row on the board");
        io.out(mode === "off" ? "google sign-in off" : `google sign-in limited to ${mode}`);
        return 0;
      }
      case "adopt": {
        const [name] = rest;
        if (!name) { io.err(USAGE); return 2; }
        const as = flag(rest, "--as");
        const managedBy = flag(rest, "--managed-by");
        const asJson = rest.includes("--json");
        let status: number, body: any;
        try {
          ({ status, body } = await apiJson(`/api/v1/apps/${name}/adopt`, {
            method: "POST",
            body: JSON.stringify({ ...(as && { as }), ...(managedBy && { managedBy }) }),
          }));
        } catch {
          // The installer's apply step matches this string (frozen contract,
          // like the API's "unknown app"/"name taken"): it means "run `deck
          // setup` and retry", distinct from every real adoption failure.
          if (asJson) { io.out(JSON.stringify({ adopted: false, error: DECK_NOT_RUNNING })); return 1; }
          io.err("Deck isn't running. Start it with `deck serve` or install it with `deck setup`.");
          return 1;
        }
        if (status !== 200) {
          if (asJson) { io.out(JSON.stringify({ adopted: false, error: String(body.error ?? `failed (${status})`) })); return 1; }
          io.err(body.message || body.error || `failed (${status})`);
          return 1;
        }
        if (asJson) { io.out(JSON.stringify(body)); return 0; }
        const host = body.hostnames?.[0] ?? body.app?.name;
        io.out(body.changed
          ? `adopted ${name} — now ${host} (managed by ${body.app.managedBy})`
          : `already adopted — ${host}`);
        return 0;
      }
      case "config": {
        const [sub] = rest;
        if (sub !== "init") { io.err("usage: deck config init"); return 2; }
        return configInit(process.cwd(), io);
      }
      case "register": {
        const dir = flag(rest, "--dir") ?? process.cwd();
        const { status, body } = await apiJson("/api/v1/apps/register", {
          method: "POST", body: JSON.stringify({ dir }),
        });
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out(`registered ${body.record.name} on port ${body.record.port}`);
        return 0;
      }
      case "alt": {
        const [name, which] = rest;
        if (!name || !which) { io.err(USAGE); return 2; }
        const alt = which === "off" ? null : which;
        const { status, body } = await apiJson(`/api/v1/apps/${name}/alt`, {
          method: "POST", body: JSON.stringify({ alt }),
        });
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out(which === "off" ? `${name} back on its base config` : `${name} now on alt "${which}"`);
        return 0;
      }
      case "cmd": {
        const [app, name] = rest;
        if (!app || !name) { io.err(USAGE); return 2; }
        const { status, body } = await apiJson(`/api/v1/apps/${app}/commands/${name}`, { method: "POST" });
        if (status === 404) { io.err(`no such command (is deck in dev mode?): ${app} ${name}`); return 1; }
        if (status === 409) { io.err(`${app} is already running a command`); return 1; }
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out(`started ${app} ${name} (run ${body.runId})`);
        return 0;
      }
      case "domain": {
        const [domain] = rest;
        if (!domain) { io.err(USAGE); return 2; }
        // A Google sign-in gate needs a Cloudflare API token scoped to this
        // zone (Access: Apps and Policies, Edit) -- but this CLI no longer
        // collects or stores it. The rt daemon owns it now.
        io.out(
          "A Google sign-in gate needs a Cloudflare API token — store with: rt secrets set deck cfApiToken "
            + "(and: rt secrets set deck cfZoneId) — interactive prompt; add --stdin when piping from a script",
        );
        const { status, body } = await apiJson("/api/v1/domain/bind", {
          method: "POST", body: JSON.stringify({ domain }),
        });
        if (status === 428) { io.err(`One step first: run \`${body.command}\`, then re-run this.`); return 1; }
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out(`bound ${body.domain} — every published app is now https://<name>.${body.domain}`);
        return 0;
      }
      case "remote": {
        const [app, onOff] = rest;
        if (!app || (onOff !== "on" && onOff !== "off")) { io.err(USAGE); return 2; }
        const { status, body } = await apiJson(`/api/v1/apps/${app}/remote`, { method: "POST", body: JSON.stringify({ enabled: onOff === "on" }) });
        if (status === 428) { io.err("Railway needs a token... store with: rt secrets set deck railwayToken"); return 1; }
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        if (onOff === "off") { io.out(`${app} back on the tunnel (public: tunnel)`); return 0; }
        io.out(`${app} now served remotely: ${body.url} (cutover: ${body.cutover})`);
        return 0;
      }
      case "push": {
        const [app] = rest;
        if (!app) { io.err(USAGE); return 2; }
        const { status, body } = await apiJson(`/api/v1/apps/${app}/push`, { method: "POST" });
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        const lp = body.lastPush;
        io.out(`pushed ${app} @ ${lp.sha}${lp.dirty ? " (dirty)" : ""}`);
        return 0;
      }
      case "migrate": {
        const convert = rest.includes("--convert");
        const { body } = await apiJson("/api/v1/migrate", {
          method: "POST", body: JSON.stringify({ convert }),
        });
        if (convert) {
          io.out(`converted: ${body.converted?.join(", ") || "(none)"}`);
          io.out(`rolled back: ${body.rolledBack?.join(", ") || "(none)"}`);
        } else {
          io.out(`adopted: ${body.adopted?.join(", ") || "(none)"}`);
        }
        io.out(`skipped: ${body.skipped?.join(", ") || "(none)"}`);
        return 0;
      }
      case "version": {
        io.out(`deck ${VERSION}`);
        return 0;
      }
      case "--version": {
        // Bare semver, nothing else: the mattstack bundle gate compares this
        // output against the rt-tray deps.lock row verbatim.
        io.out(VERSION);
        return 0;
      }
      case "help":
      case "--help": {
        io.out(USAGE);
        return 0;
      }
      default:
        io.err(USAGE);
        return 2;
    }
  } catch (err) {
    io.err(String((err as Error).message ?? err));
    return 1;
  }
}
