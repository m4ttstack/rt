// src/cli/commands.ts
import { apiJson } from "./client.ts";
import pkg from "../../package.json";

export const VERSION = pkg.version;

// The product is Deck. The command is deck, not local: local is a shell
// reserved word in zsh and bash (zsh silently declares a variable, bash
// hard-errors), and reserved words beat PATH.
const USAGE = `deck: named https domains, supervision, and sharing for local apps

usage:
  deck status | list                       show every app
  deck add <name> --port N                 route an app you run yourself
  deck add <name> --cmd "…" --dir PATH     register a supervised app
  deck remove <name> [--force]             unregister (registrar-owned; --force is the escape hatch)
  deck restart <name>                      kickstart its service
  deck logs <name> [--lines N]             tail stderr
  deck override <name> <port|off>          dev-port override for <name>.localhost
  deck publish <name> on|off               public visibility
  deck password <name> [--clear]           password gate (prompts)
  deck access <name> off | emails a,b | domains c,d    google sign-in gate
  deck domain <domain>                     bind your own domain (cloudflared)
  deck migrate                             adopt existing plists + routes
  deck migrate --convert                   relabel adopted legacy apps to com.mattstack.deck.<name>
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
          io.out(`${row.name.padEnd(24)} ${String(row.port ?? "-").padEnd(6)} ${health.padEnd(5)} ${managed}${issues}`);
        }
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
      case "domain": {
        const [domain] = rest;
        if (!domain) { io.err(USAGE); return 2; }
        // Spec pillar c: the SAME guided flow captures the scoped CF Access
        // token — this prompt is the only surface that ever sets it.
        const current = await apiJson("/api/v1/settings");
        if (!current.body.hasCfToken) {
          io.out("A Google sign-in gate needs a Cloudflare API token");
          io.out("scoped to this zone: Access: Apps and Policies, Edit. Blank skips the sign-in gate.");
          const cfApiToken = promptFn("Cloudflare API token:")?.trim() ?? "";
          if (cfApiToken) {
            const cfZoneId = promptFn("Cloudflare zone id:")?.trim() ?? "";
            if (!cfZoneId) { io.err("a zone id is required with a token"); return 1; }
            const put = await apiJson("/api/v1/settings", {
              method: "PUT", body: JSON.stringify({ cfApiToken, cfZoneId }),
            });
            if (put.status !== 200) { io.err("storing the token failed"); return 1; }
            io.out("token stored (never echoed back — GET /settings reports booleans only).");
          }
        }
        const { status, body } = await apiJson("/api/v1/domain/bind", {
          method: "POST", body: JSON.stringify({ domain }),
        });
        if (status === 428) { io.err(`One step first: run \`${body.command}\`, then re-run this.`); return 1; }
        if (status !== 200) { io.err(body.error ?? `failed (${status})`); return 1; }
        io.out(`bound ${body.domain} — every published app is now https://<name>.${body.domain}`);
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
