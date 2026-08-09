/** The switchboard: a dumb store-and-forward relay for peer mr-boards.
    It understands envelopes, never payloads — no GitLab/Slack credentials,
    no MR titles. Deployed standalone (Railway); boards only call outbound. */
import { Database } from "bun:sqlite";
import { join } from "path";
import { parseDraftEnvelope } from "../src/peer/envelope.ts";
import { ENVELOPE_TTL_MS, SwitchboardStore } from "./store.ts";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function makeFetchHandler(store: SwitchboardStore, adminToken: string, now: () => number = Date.now) {
  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === "/healthz") return new Response("ok");

    if (pathname === "/boards") {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      if (bearer(req) !== adminToken) return new Response("unauthorized", { status: 401 });
      let body: unknown;
      try { body = await req.json(); } catch { return new Response("invalid json", { status: 400 }); }
      const username = (body as { username?: unknown })?.username;
      if (typeof username !== "string" || !username.trim()) return new Response("expected { username }", { status: 400 });
      return json(201, store.registerBoard(username));
    }

    const token = bearer(req);
    const username = token ? store.authBoard(token) : null;
    if (!username) return new Response("unauthorized", { status: 401 });

    if (pathname === "/envelopes") {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body: unknown;
      try { body = await req.json(); } catch { return new Response("invalid json", { status: 400 }); }
      const draft = parseDraftEnvelope(body);
      if (!draft) return new Response("expected a DraftEnvelope { id, to, type, sentAt, payload }", { status: 400 });
      const result = store.publish(username, draft, now());
      if (!result.ok) return json(422, { error: result.error });
      return json(201, { ok: true, delivered: result.delivered });
    }

    if (pathname === "/inbox") {
      if (req.method === "GET") return json(200, { envelopes: store.inbox(username) });
      return new Response("method not allowed", { status: 405 });
    }

    if (pathname === "/inbox/ack") {
      if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
      let body: unknown;
      try { body = await req.json(); } catch { return new Response("invalid json", { status: 400 }); }
      const ids = (body as { ids?: unknown })?.ids;
      if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) return new Response("expected { ids: string[] }", { status: 400 });
      return json(200, { ok: true, acked: store.ack(username, ids as string[]) });
    }

    return new Response("not found", { status: 404 });
  };
}

if (import.meta.main) {
  const adminToken = process.env.SWITCHBOARD_ADMIN_TOKEN;
  if (!adminToken) {
    console.error("SWITCHBOARD_ADMIN_TOKEN is required");
    process.exit(1);
  }
  const dbPath = process.env.SWITCHBOARD_DB || join(import.meta.dir, "switchboard.sqlite");
  const store = new SwitchboardStore(new Database(dbPath));
  const port = Number(process.env.PORT) || 7940;
  setInterval(() => store.prune(Date.now(), ENVELOPE_TTL_MS), 60 * 60_000);
  Bun.serve({ port, fetch: makeFetchHandler(store, adminToken) });
  console.log(`switchboard listening on :${port} (db: ${dbPath})`);
}
